"""GhostLink — FastAPI backend with WebSocket hub."""

from __future__ import annotations

__version__ = "5.0.21"

import json
import importlib
import os
import subprocess
import sys
import time
import collections
import functools
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # type: ignore

import asyncio
import logging
import secrets

from datetime import datetime

try:
    import aiohttp
    HAS_AIOHTTP = True
except ImportError:
    HAS_AIOHTTP = False

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

import deps

log = logging.getLogger(__name__)

from store import MessageStore
from registry import AgentRegistry
from router import MessageRouter
from jobs import JobStore
from rules import RuleStore
from skills import SkillsRegistry
from schedules import ScheduleStore, cron_matches
from sessions import SessionManager
from branches import BranchManager
from providers import ProviderRegistry
from bridges import BridgeManager
from plugin_sdk import Marketplace, HookManager, event_bus, EVENTS, SKILL_PACKS, SafetyScanner
from security import SecretsManager, ExecPolicy, AuditLog, DataManager
import mcp_bridge
import plugin_loader

# ── Config ──────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.toml"

if not CONFIG_PATH.exists():
    print(f"ERROR: Config file not found at {CONFIG_PATH}")
    print("Create a config.toml with at least a [server] section. See README.md.")
    sys.exit(1)

try:
    with open(CONFIG_PATH, "rb") as f:
        CONFIG = tomllib.load(f)
except Exception as e:
    print(f"ERROR: Failed to parse config.toml: {e}")
    sys.exit(1)

# Validate required config sections
_REQUIRED_SECTIONS = {
    "server": ["port", "data_dir"],
}
for section, keys in _REQUIRED_SECTIONS.items():
    if section not in CONFIG:
        print(f"ERROR: config.toml missing [{section}] section.")
        print(f"Required keys: {', '.join(keys)}")
        print("See README.md for config.toml format.")
        sys.exit(1)
    for key in keys:
        if key not in CONFIG[section]:
            print(f"WARNING: config.toml [{section}] missing '{key}' — using default.")

SERVER = CONFIG.get("server", {})
PORT = int(os.environ.get("PORT", SERVER.get("port", 8300)))
HOST = os.environ.get("HOST", SERVER.get("host", "127.0.0.1"))
DATA_DIR = Path(SERVER.get("data_dir", "./data"))
STATIC_DIR = Path(SERVER.get("static_dir", "../frontend/dist"))

ROUTING = CONFIG.get("routing", {})
MAX_HOPS = int(ROUTING.get("max_agent_hops", 4))
DEFAULT_ROUTING = ROUTING.get("default", "none")

IMAGES = CONFIG.get("images", {})
UPLOAD_DIR = Path(IMAGES.get("upload_dir", "./uploads"))
MAX_SIZE_MB = int(IMAGES.get("max_size_mb", 10))

# Resolve relative paths from backend dir
if not DATA_DIR.is_absolute():
    DATA_DIR = BASE_DIR / DATA_DIR
if not STATIC_DIR.is_absolute():
    STATIC_DIR = BASE_DIR / STATIC_DIR
# Fallback: packaged app puts frontend at ../frontend/ (not ../frontend/dist/)
if not STATIC_DIR.exists() or not (STATIC_DIR / "index.html").exists():
    alt = STATIC_DIR.parent
    if (alt / "index.html").exists():
        STATIC_DIR = alt
if not UPLOAD_DIR.is_absolute():
    UPLOAD_DIR = BASE_DIR / UPLOAD_DIR

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ── Initialise deps with config values ──────────────────────────────

deps.BASE_DIR = BASE_DIR
deps.DATA_DIR = DATA_DIR
deps.UPLOAD_DIR = UPLOAD_DIR
deps.STATIC_DIR = STATIC_DIR
deps.CONFIG = CONFIG
deps.MAX_HOPS = MAX_HOPS
deps.PORT = PORT
deps.HOST = HOST
deps.MAX_SIZE_MB = MAX_SIZE_MB

# ── Global state (set here, aliased into deps in lifespan) ───────────

registry = AgentRegistry()
router_msg = MessageRouter(max_hops=MAX_HOPS, default_routing=DEFAULT_ROUTING)
_ws_token = secrets.token_urlsafe(32)

# Set into deps now so routes can reference before lifespan completes
deps.registry = registry
deps.router_inst = router_msg
deps._ws_token = _ws_token

# ── Usage tracking ───────────────────────────────────────────────────

_USAGE_LOG_MAX = 10000
_usage_log: list[dict] = []

# Share usage log with deps
deps._usage_log = _usage_log


def _estimate_cost(provider: str, model: str, input_tok: int, output_tok: int) -> float:
    """Estimate cost in USD based on rough per-1M-token pricing."""
    PRICING = {
        "anthropic": {"input": 3.0, "output": 15.0},
        "openai": {"input": 2.5, "output": 10.0},
        "google": {"input": 1.25, "output": 5.0},
        "groq": {"input": 0.05, "output": 0.10},
        "together": {"input": 0.20, "output": 0.20},
        "deepseek": {"input": 0.14, "output": 0.28},
        "mistral": {"input": 2.0, "output": 6.0},
        "cohere": {"input": 0.50, "output": 1.50},
        "perplexity": {"input": 1.0, "output": 5.0},
    }
    rates = PRICING.get(provider, {"input": 1.0, "output": 3.0})
    return round((input_tok * rates["input"] + output_tok * rates["output"]) / 1_000_000, 6)


async def _track_usage(agent: str, provider: str, model: str, input_tokens: int, output_tokens: int):
    """Record token usage for cost tracking. v2.5.0: capped to prevent memory leak."""
    if len(_usage_log) >= _USAGE_LOG_MAX:
        dropped = _USAGE_LOG_MAX // 5
        del _usage_log[:dropped]
        log.info("Usage log trimmed: dropped %d oldest entries (cap %d)", dropped, _USAGE_LOG_MAX)
    _usage_log.append({
        "ts": datetime.utcnow().isoformat(),
        "agent": agent,
        "provider": provider,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost": _estimate_cost(provider, model, input_tokens, output_tokens),
    })


# ── Settings ─────────────────────────────────────────────────────────

SETTINGS_PATH = DATA_DIR / "settings.json"
# deps._settings is already initialised with defaults in deps.py — sync MAX_HOPS
deps._settings["loopGuard"] = MAX_HOPS

_http_session: "aiohttp.ClientSession | None" = None


def _load_settings():
    if SETTINGS_PATH.exists():
        try:
            with open(SETTINGS_PATH) as f:
                saved = json.load(f)
            deps._settings.update(saved)
        except (json.JSONDecodeError, OSError) as e:
            log.warning("Failed to load settings.json: %s — using defaults", e)


def _save_settings():
    with open(SETTINGS_PATH, "w") as f:
        json.dump(deps._settings, f, indent=2)


@functools.lru_cache(maxsize=256)
def _schedule_cooldown_seconds(cron_expr: str) -> float:
    import datetime

    now = datetime.datetime.now(datetime.timezone.utc).replace(second=0, microsecond=0)
    first_match: datetime.datetime | None = None

    for minute_offset in range(0, 60 * 24 * 366):
        candidate = now + datetime.timedelta(minutes=minute_offset)
        if not cron_matches(cron_expr, candidate.timestamp()):
            continue
        if first_match is None:
            first_match = candidate
            continue
        return max(60.0, (candidate - first_match).total_seconds())

    return 60.0


def _require_startup_attr(module_name: str, attr_name: str):
    try:
        module = importlib.import_module(module_name)
    except Exception as exc:
        log.exception("Startup import failed for %s", module_name)
        raise RuntimeError(f"Startup import failed for {module_name}") from exc

    try:
        return getattr(module, attr_name)
    except AttributeError as exc:
        log.exception("Startup import missing %s.%s", module_name, attr_name)
        raise RuntimeError(f"Startup import missing {module_name}.{attr_name}") from exc


# ── Server logs ──────────────────────────────────────────────────────

_MAX_LOG_ENTRIES = 500


class _UILogHandler(logging.Handler):
    """Captures log records for the UI log viewer."""
    def emit(self, record):
        try:
            entry = {
                "timestamp": record.created,
                "level": record.levelname,
                "module": record.module,
                "message": self.format(record),
            }
            deps._server_logs.append(entry)
        except Exception:
            pass  # Log handler must never raise — would cause infinite recursion


# Attach log handler
_ui_handler = _UILogHandler()
_ui_handler.setLevel(logging.DEBUG)
_ui_handler.setFormatter(logging.Formatter("%(message)s"))
logging.getLogger().addHandler(_ui_handler)
logging.getLogger("uvicorn.access").addHandler(_ui_handler)


# ── Lifespan ────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _http_session

    _load_settings()
    deps._settings["_server_start"] = time.time()
    if not HAS_AIOHTTP:
        log.warning("aiohttp is not installed; pooled outbound HTTP features are disabled")

    # v2.5.2: Use ghostlink_v2.db to avoid stale journal corruption
    db_path = DATA_DIR / "ghostlink_v2.db"
    store = MessageStore(db_path)
    await store.init()

    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    job_store = JobStore(db)
    await job_store.init()
    rule_store = RuleStore(db)
    await rule_store.init()
    schedule_store = ScheduleStore(db)
    await schedule_store.init()
    skills_registry = SkillsRegistry(DATA_DIR)
    session_manager = SessionManager(DATA_DIR)
    branch_manager = BranchManager(DATA_DIR)
    secrets_manager = SecretsManager(DATA_DIR)
    provider_registry = ProviderRegistry(DATA_DIR)
    bridge_manager = BridgeManager(DATA_DIR, store=store, registry=registry, server_port=PORT)
    marketplace = Marketplace(DATA_DIR)
    hook_manager = HookManager(DATA_DIR, server_port=PORT)
    hook_manager.register_all()
    exec_policy = ExecPolicy(DATA_DIR)
    audit_log = AuditLog(DATA_DIR)
    data_manager = DataManager(DATA_DIR, store=store)
    # v3.6.0: Worktree manager for agent isolation + automation manager
    WorktreeManager = _require_startup_attr("worktree", "WorktreeManager")
    AutomationManager = _require_startup_attr("automations", "AutomationManager")
    worktree_manager = WorktreeManager(str(BASE_DIR))
    automation_manager = AutomationManager(DATA_DIR)
    audit_log.log("server_start", {"version": __version__, "port": PORT})

    # Publish all stores into deps so route modules can access them
    deps.store = store
    deps.job_store = job_store
    deps.rule_store = rule_store
    deps.schedule_store = schedule_store
    deps.skills_registry = skills_registry
    deps.session_manager = session_manager
    deps.branch_manager = branch_manager
    deps.provider_registry = provider_registry
    deps.bridge_manager = bridge_manager
    deps.marketplace = marketplace
    deps.hook_manager = hook_manager
    deps.secrets_manager = secrets_manager
    deps.exec_policy = exec_policy
    deps.audit_log = audit_log
    deps.data_manager = data_manager
    deps.worktree_manager = worktree_manager
    deps.automation_manager = automation_manager

    # v4.4.0: Remote runner + A2A bridge + user auth
    RemoteRunner = _require_startup_attr("remote_runner", "RemoteRunner")
    deps.remote_runner = RemoteRunner(server_port=PORT)
    UserManager = _require_startup_attr("auth", "UserManager")
    deps.user_manager = UserManager(DATA_DIR)
    A2ABridge = _require_startup_attr("a2a_bridge", "A2ABridge")
    setup_a2a = _require_startup_attr("a2a_bridge", "setup_routes")
    deps.a2a_bridge = A2ABridge(server_version=__version__)
    setup_a2a(app, deps.a2a_bridge)
    AutonomousManager = _require_startup_attr("autonomous", "AutonomousManager")
    deps.autonomous_manager = AutonomousManager()
    MemoryGraph = _require_startup_attr("memory_graph", "MemoryGraph")
    deps.memory_graph = MemoryGraph(DATA_DIR)
    SpecializationEngine = _require_startup_attr("specialization", "SpecializationEngine")
    deps.specialization = SpecializationEngine(DATA_DIR)
    RAGPipeline = _require_startup_attr("rag", "RAGPipeline")
    deps.rag_pipeline = RAGPipeline(DATA_DIR)

    # Broadcast new messages via WebSocket
    async def on_msg(msg: dict):
        await deps.broadcast("message", msg)
    store.on_message(on_msg)

    # Start MCP bridge for agent CLIs (dual transport)
    import threading
    mcp_cfg = CONFIG.get("mcp", {})
    mcp_bridge.configure(
        store=store,
        registry=registry,
        settings=deps._settings,
        data_dir=DATA_DIR,
        server_port=PORT,
        rule_store=rule_store,
        job_store=job_store,
        router=router_msg,
        mcp_http_port=int(mcp_cfg.get("http_port", 0)),
        mcp_sse_port=int(mcp_cfg.get("sse_port", 0)),
    )
    http_thread = threading.Thread(target=mcp_bridge.run_http_server, daemon=True)
    http_thread.start()
    print(f"  MCP bridge (HTTP) started on port {mcp_bridge.MCP_HTTP_PORT}")

    sse_thread = threading.Thread(target=mcp_bridge.run_sse_server, daemon=True)
    sse_thread.start()
    print(f"  MCP bridge (SSE) started on port {mcp_bridge.MCP_SSE_PORT}")

    # Capture the running event loop for use by background threads
    _main_loop = asyncio.get_running_loop()
    deps._main_loop = _main_loop

    from routes.agents import (
        _get_agent_workspace_path,
        _read_text_file_for_diff,
        add_workspace_change,
        add_replay_event,
        cache_file_diff,
        set_agent_browser_state,
        set_agent_presence,
        set_terminal_stream,
    )

    def _dispatch(coro):
        try:
            asyncio.run_coroutine_threadsafe(coro, _main_loop)
        except Exception as e:
            log.debug("Background dispatch failed: %s", e)

    def _presence_snapshot(agent_name: str) -> dict:
        with deps._agent_state_lock:
            return dict(deps._agent_presence.get(agent_name, {}))

    def _trim_text(value: object, limit: int = 180) -> str:
        text = str(value or "").strip().replace("\r", "")
        return text[:limit]

    def _last_terminal_line(output: str) -> str:
        for line in reversed(output.splitlines()):
            if line.strip():
                return line.strip()[:180]
        return ""

    def _parse_artifact_path(result: str) -> str:
        prefix = "Screenshot saved: "
        if not result.startswith(prefix):
            return ""
        artifact = result[len(prefix):]
        if " (" in artifact:
            artifact = artifact.split(" (", 1)[0]
        return artifact.strip()

    def _scan_workspace_state(root: Path, max_depth: int = 3) -> dict[str, float]:
        files: dict[str, float] = {}
        skip_dirs = {"node_modules", "__pycache__", ".git", ".venv", "venv", "dist"}
        visible_dotfiles = {".gitignore"}
        try:
            for current_root, dirs, filenames in os.walk(root):
                current_path = Path(current_root)
                rel_root = current_path.relative_to(root)
                if len(rel_root.parts) >= max_depth:
                    dirs[:] = []
                else:
                    dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]
                for filename in filenames:
                    if filename.startswith(".") and filename not in visible_dotfiles:
                        continue
                    full_path = current_path / filename
                    try:
                        files[str(full_path.relative_to(root))] = full_path.stat().st_mtime
                    except OSError:
                        continue
        except Exception:
            return files
        return files

    def _tool_surface(tool_name: str, args: dict) -> tuple[str, str, str]:
        if tool_name == "web_fetch":
            return "browser", "Reading page", _trim_text(args.get("url"))
        if tool_name == "web_search":
            return "browser", "Searching web", _trim_text(args.get("query"))
        if tool_name == "browser_snapshot":
            return "browser", "Capturing browser", _trim_text(args.get("url"))
        if tool_name == "code_execute":
            language = _trim_text(args.get("language") or "python")
            return "terminal", "Running code", language
        if tool_name == "chat_read":
            channel = _trim_text(args.get("channel") or "general")
            return "messages", "Reading conversation", channel
        if tool_name == "chat_send":
            channel = _trim_text(args.get("channel") or "general")
            return "messages", "Writing reply", channel
        if tool_name == "delegate":
            return "coordination", "Delegating task", _trim_text(args.get("agent"))
        if tool_name.startswith("memory_"):
            return "memory", "Updating memory", _trim_text(args.get("key") or args.get("query"))
        return "tool", f"Using {tool_name}", ""

    def _on_pre_tool_use(data: dict):
        agent = str(data.get("agent", "")).strip()
        tool_name = str(data.get("tool", "")).strip()
        args = data.get("args") if isinstance(data.get("args"), dict) else {}
        if not agent or not tool_name:
            return
        surface, status, detail = _tool_surface(tool_name, args)
        if tool_name in {"web_fetch", "web_search", "browser_snapshot"}:
            _dispatch(add_replay_event(
                agent,
                "tool_start",
                title=status,
                detail=detail,
                surface="browser",
                url=str(args.get("url", "")),
                query=str(args.get("query", "")),
                tool=tool_name,
            ))
            _dispatch(set_agent_browser_state(
                agent,
                mode=tool_name,
                status=status,
                url=str(args.get("url", "")),
                query=str(args.get("query", "")),
                title=detail,
            ))
            return
        _dispatch(add_replay_event(
            agent,
            "tool_start",
            title=status,
            detail=detail,
            surface=surface,
            url=str(args.get("url", "")),
            query=str(args.get("query", "")),
            command=str(args.get("language", "")) if tool_name == "code_execute" else "",
            tool=tool_name,
        ))
        _dispatch(set_agent_presence(
            agent,
            surface=surface,
            status=status,
            detail=detail,
            tool=tool_name,
            url=str(args.get("url", "")),
            query=str(args.get("query", "")),
            command=str(args.get("language", "")) if tool_name == "code_execute" else "",
        ))

    def _on_post_tool_use(data: dict):
        agent = str(data.get("agent", "")).strip()
        tool_name = str(data.get("tool", "")).strip()
        args = data.get("args") if isinstance(data.get("args"), dict) else {}
        result = _trim_text(data.get("result", ""), 400)
        if not agent or not tool_name:
            return
        if tool_name in {"web_fetch", "web_search", "browser_snapshot"}:
            status = {
                "web_fetch": "Page loaded",
                "web_search": "Search results ready",
                "browser_snapshot": "Snapshot captured",
            }.get(tool_name, "Browser updated")
            artifact_path = _parse_artifact_path(result) if tool_name == "browser_snapshot" else ""
            artifact_url = f"/api/agents/{agent}/browser/artifact" if artifact_path else ""
            _dispatch(set_agent_browser_state(
                agent,
                mode=tool_name,
                status="Browser error" if result.lower().startswith(("error", "failed")) else status,
                url=str(args.get("url", "")),
                query=str(args.get("query", "")),
                title=_trim_text(args.get("url") or args.get("query") or status),
                preview=result,
                artifact_path=artifact_path,
            ))
            _dispatch(add_replay_event(
                agent,
                "tool_result",
                title=status,
                detail=result,
                surface="browser",
                url=str(args.get("url", "")),
                query=str(args.get("query", "")),
                tool=tool_name,
                metadata={"artifact_path": artifact_path, "artifact_url": artifact_url, "status": status},
            ))
            return
        surface, status, detail = _tool_surface(tool_name, args)
        done_status = "Completed" if tool_name.startswith("memory_") else status
        _dispatch(add_replay_event(
            agent,
            "tool_result",
            title=done_status,
            detail=result or detail,
            surface=surface,
            url=str(args.get("url", "")),
            query=str(args.get("query", "")),
            command=str(args.get("language", "")) if tool_name == "code_execute" else "",
            tool=tool_name,
        ))
        _dispatch(set_agent_presence(
            agent,
            surface=surface,
            status=done_status,
            detail=result or detail,
            tool=tool_name,
        ))

    event_bus.on("pre_tool_use", _on_pre_tool_use)
    event_bus.on("post_tool_use", _on_post_tool_use)

    # Start schedule checker background thread
    _schedule_stop = threading.Event()

    def _schedule_checker():
        """Check enabled schedules every 60 seconds and trigger matched agents."""
        while not _schedule_stop.is_set():
            try:
                schedules = asyncio.run_coroutine_threadsafe(
                    schedule_store.list_enabled(), _main_loop
                ).result(timeout=5)
                now = time.time()
                for sched in schedules:
                    if cron_matches(sched["cron_expr"], now):
                        cooldown = _schedule_cooldown_seconds(sched["cron_expr"])
                        try:
                            claimed = asyncio.run_coroutine_threadsafe(
                                schedule_store.claim_due_run(sched["id"], cooldown, now),
                                _main_loop,
                            ).result(timeout=5)
                        except Exception as e:
                            log.warning("Schedule claim failed for %s: %s", sched["id"], e)
                            continue
                        if not claimed:
                            continue
                        agent = sched.get("agent", "")
                        command = sched.get("command", "")
                        channel = sched.get("channel", "general")
                        if agent and command:
                            queue_file = DATA_DIR / f"{agent}_queue.jsonl"
                            try:
                                with open(queue_file, "a") as f:
                                    f.write(json.dumps({"channel": channel, "scheduled": True}) + "\n")
                            except Exception as e:
                                log.warning("Schedule queue write failed for %s: %s", agent, e)
                            try:
                                asyncio.run_coroutine_threadsafe(
                                    store.add(sender="system", text=f"Scheduled: @{agent} — {command}", msg_type="system", channel=channel),
                                    _main_loop,
                                ).result(timeout=5)
                            except Exception as e:
                                log.warning("Schedule message post failed: %s", e)
                if deps.automation_manager:
                    try:
                        asyncio.run_coroutine_threadsafe(
                            deps.automation_manager.process_due_schedules(now),
                            _main_loop,
                        ).result(timeout=5)
                    except Exception as e:
                        log.warning("Workflow schedule processing failed: %s", e)
            except Exception as e:
                log.warning("Schedule checker error: %s", e)
            _schedule_stop.wait(60)

    sched_thread = threading.Thread(target=_schedule_checker, daemon=True)
    sched_thread.start()
    print("  Schedule checker started (checks every 60s)")

    # Agent health monitor — detects crashed agents and marks them offline
    _health_stop = threading.Event()
    HEALTH_CHECK_INTERVAL = 30
    HEARTBEAT_STALE_THRESHOLD = 45

    def _health_monitor():
        while not _health_stop.is_set():
            try:
                for inst in registry.get_all():
                    last_hb = deps._last_heartbeats.get(inst.name, inst.registered_at)
                    elapsed = time.time() - last_hb
                    if elapsed > HEARTBEAT_STALE_THRESHOLD and inst.state not in ("offline", "pending"):
                        inst.state = "offline"
                        log.info("Agent %s marked offline (no heartbeat for %.0fs)", inst.name, elapsed)
                        _dispatch(set_agent_presence(
                            inst.name,
                            surface="session",
                            status="Offline",
                            detail="Heartbeat lost",
                            state="offline",
                        ))
                        try:
                            from app_helpers import get_full_agent_list
                            asyncio.run_coroutine_threadsafe(
                                deps.broadcast("status", {"agents": get_full_agent_list()}),
                                _main_loop,
                            ).result(timeout=5)
                        except Exception as e:
                            log.debug("Health monitor broadcast failed: %s", e)
            except Exception as e:
                log.debug("Health monitor error: %s", e)
            _health_stop.wait(HEALTH_CHECK_INTERVAL)

    health_thread = threading.Thread(target=_health_monitor, daemon=True)
    health_thread.start()
    print("  Health monitor started (checks every 30s)")

    _terminal_stop = threading.Event()

    def _terminal_monitor():
        while not _terminal_stop.is_set():
            try:
                for inst in registry.get_all():
                    session_name = f"ghostlink-{inst.name}"
                    output = ""
                    active = False
                    try:
                        result = subprocess.run(
                            ["tmux", "capture-pane", "-t", session_name, "-p", "-S", "-120"],
                            capture_output=True,
                            text=True,
                            timeout=2,
                        )
                        if result.returncode == 0:
                            output = result.stdout[-12000:]
                            active = True
                    except Exception:
                        pass

                    with deps._agent_state_lock:
                        previous = dict(deps._terminal_streams.get(inst.name, {}))
                    if output != previous.get("output", "") or active != previous.get("active", False):
                        _dispatch(set_terminal_stream(inst.name, output, active))
                        current_presence = _presence_snapshot(inst.name)
                        stale = time.time() - float(current_presence.get("updated_at", 0) or 0) > 10
                        if active and (current_presence.get("surface") in ("", "idle", "session", "terminal", "thinking") or stale):
                            line = _last_terminal_line(output)
                            _dispatch(set_agent_presence(
                                inst.name,
                                surface="terminal",
                                status="Running command" if line else "Terminal active",
                                detail=line or "Live session attached",
                                command=line,
                                state=inst.state,
                            ))
            except Exception as e:
                log.debug("Terminal monitor error: %s", e)
            _terminal_stop.wait(1.0)

    terminal_thread = threading.Thread(target=_terminal_monitor, daemon=True)
    terminal_thread.start()
    print("  Terminal stream monitor started (checks every 1s)")

    _workspace_stop = threading.Event()

    def _workspace_monitor():
        workspace_state: dict[str, dict[str, float]] = {}
        workspace_content: dict[str, dict[str, str]] = {}
        while not _workspace_stop.is_set():
            try:
                for inst in registry.get_all():
                    workspace = _get_agent_workspace_path(inst.name)
                    if not workspace.is_dir():
                        workspace_state.pop(inst.name, None)
                        continue
                    new_state = _scan_workspace_state(workspace)
                    old_state = workspace_state.get(inst.name)
                    workspace_state[inst.name] = new_state
                    content_state = workspace_content.setdefault(inst.name, {})
                    if old_state is None:
                        for rel_path in list(new_state)[:500]:
                            content_state[rel_path] = _read_text_file_for_diff(workspace / rel_path)
                        continue

                    changes: list[tuple[str, str]] = []
                    for rel_path, mtime in new_state.items():
                        if rel_path not in old_state:
                            changes.append(("created", rel_path))
                        elif old_state[rel_path] != mtime:
                            changes.append(("modified", rel_path))
                    for rel_path in old_state:
                        if rel_path not in new_state:
                            changes.append(("deleted", rel_path))

                    for action, rel_path in changes[:20]:
                        _dispatch(add_workspace_change(inst.name, action, rel_path))
                        full_path = workspace / rel_path
                        if action == "deleted":
                            before = content_state.pop(rel_path, "")
                            _dispatch(cache_file_diff(inst.name, rel_path, before, "", action))
                            continue
                        before = content_state.get(rel_path, "")
                        after = _read_text_file_for_diff(full_path)
                        content_state[rel_path] = after
                        if before != after:
                            _dispatch(cache_file_diff(inst.name, rel_path, before, after, action))
            except Exception as e:
                log.debug("Workspace monitor error: %s", e)
            _workspace_stop.wait(2.0)

    workspace_thread = threading.Thread(target=_workspace_monitor, daemon=True)
    workspace_thread.start()
    print("  Workspace monitor started (checks every 2s)")

    # Load plugins
    try:
        plugin_loader.load_plugins(_app, store=store, registry=registry, mcp_bridge_module=mcp_bridge)
    except Exception as e:
        log.exception("Plugin loading failed during startup: %s", e)

    # Start enabled channel bridges
    try:
        bridge_manager.start_all_enabled()
        print("  Channel bridges initialized")
    except Exception as e:
        log.exception("Failed to start enabled channel bridges: %s", e)

    # Plugin management endpoints (registered here because they need plugin_loader)
    @_app.get("/api/plugins")
    async def api_list_plugins():
        return {"plugins": plugin_loader.list_plugins()}

    @_app.post("/api/plugins/{name}/enable")
    async def api_enable_plugin(name: str):
        ok = plugin_loader.enable_plugin(name)
        return {"ok": ok, "note": "Restart server to apply" if ok else "Plugin not disabled"}

    @_app.post("/api/plugins/{name}/disable")
    async def api_disable_plugin(name: str):
        ok = plugin_loader.disable_plugin(name)
        return {"ok": ok, "note": "Restart server to apply" if ok else "Plugin not enabled"}

    @_app.post("/api/plugins/install")
    async def api_install_plugin(request: Request):
        body = await request.json()
        name = body.get("name", "").strip()
        code = body.get("code", "")
        if not name or not code:
            return JSONResponse({"error": "name and code required"}, 400)
        issues = SafetyScanner.scan(code)
        critical = [i for i in issues if i["severity"] == "critical"]
        if critical:
            return JSONResponse({"error": f"Safety scan failed: {critical[0]['message']}", "issues": issues}, 400)
        result = plugin_loader.install_plugin(name, code, body.get("description", ""), body.get("version", "1.0.0"))
        return result

    @_app.delete("/api/plugins/{name}")
    async def api_uninstall_plugin(name: str):
        ok = plugin_loader.uninstall_plugin(name)
        return {"ok": ok}

    # v2.4.0: Create shared HTTP connection pool
    if HAS_AIOHTTP:
        _http_session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=30),
            connector=aiohttp.TCPConnector(limit=100, ttl_dns_cache=300),
        )
        deps._http_session = _http_session
        print("  HTTP connection pool started (100 connections)")

    yield

    # Shutdown
    if _http_session:
        await _http_session.close()
    _schedule_stop.set()
    _health_stop.set()
    _terminal_stop.set()
    _workspace_stop.set()
    bridge_manager.stop_all()
    await store.close()
    await db.close()


# ── Rate Limiting ──────────────────────────────────────────────────

_rate_limits: dict[str, collections.deque] = {}
_RATE_LIMIT_WINDOW = 60
_RATE_LIMIT_MAX = 300
_rate_limit_last_cleanup = time.time()
_RATE_LIMIT_MAX_IPS = 10000  # Max tracked IPs to prevent memory leak

app = FastAPI(title="GhostLink", lifespan=lifespan)

_LOCALHOST_IPS = {"127.0.0.1", "::1", "localhost"}
_REMOTE_LOCAL_ONLY_PATHS = {
    "/api/tunnel/start",
    "/api/tunnel/stop",
    "/api/tunnel/status",
    "/api/ws-token",
}


def _is_local_client(host: str | None) -> bool:
    return (host or "").lower() in _LOCALHOST_IPS


def _has_valid_remote_access_token(request: Request) -> bool:
    expected = deps._tunnel_access_token
    if not expected:
        return False
    token = (
        request.headers.get("X-GhostLink-Access-Token")
        or request.query_params.get("access_token")
    )
    return bool(token) and secrets.compare_digest(token, expected)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Simple IP-based rate limiting for API endpoints. Localhost is exempt."""
    global _rate_limit_last_cleanup
    if request.url.path.startswith("/api/"):
        client_ip = request.client.host if request.client else "unknown"
        if client_ip not in _LOCALHOST_IPS:
            now = time.time()
            if client_ip not in _rate_limits:
                _rate_limits[client_ip] = collections.deque()
            dq = _rate_limits[client_ip]
            while dq and dq[0] < now - _RATE_LIMIT_WINDOW:
                dq.popleft()
            if len(dq) >= _RATE_LIMIT_MAX:
                return JSONResponse(
                    {"error": "Rate limit exceeded. Try again later."},
                    status_code=429,
                )
            dq.append(now)
            if now - _rate_limit_last_cleanup > 60:
                _rate_limit_last_cleanup = now
                stale = [ip for ip, d in _rate_limits.items() if not d or d[-1] < now - _RATE_LIMIT_WINDOW]
                for ip in stale:
                    _rate_limits.pop(ip, None)
                # Hard cap to prevent unbounded growth
                if len(_rate_limits) > _RATE_LIMIT_MAX_IPS:
                    oldest = sorted(_rate_limits, key=lambda ip: _rate_limits[ip][-1] if _rate_limits[ip] else 0)
                    for ip in oldest[:len(_rate_limits) - _RATE_LIMIT_MAX_IPS]:
                        _rate_limits.pop(ip, None)
    return await call_next(request)


@app.middleware("http")
async def remote_access_middleware(request: Request, call_next):
    """Require the per-tunnel bearer token for non-local API access."""
    if not request.url.path.startswith("/api/"):
        return await call_next(request)

    client_ip = request.client.host if request.client else "unknown"
    if _is_local_client(client_ip):
        return await call_next(request)

    if request.url.path in _REMOTE_LOCAL_ONLY_PATHS:
        return JSONResponse({"error": "Localhost only"}, status_code=403)

    if not _has_valid_remote_access_token(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    return await call_next(request)


# ── WebSocket endpoint ──────────────────────────────────────────────

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    client_host = ws.client.host if ws.client else "127.0.0.1"
    if not _is_local_client(client_host):
        access_token = ws.query_params.get("access_token")
        if not deps._tunnel_access_token or not access_token or not secrets.compare_digest(access_token, deps._tunnel_access_token):
            await ws.close(code=4001, reason="Unauthorized")
            return
    await ws.accept()
    async with deps._ws_clients_lock:
        deps._ws_clients.add(ws)
    try:
        while True:
            data = await ws.receive_text()
            try:
                parsed = json.loads(data)
                msg_type = parsed.get("type", "")
                if msg_type == "ping":
                    await ws.send_text('{"type":"pong"}')
                elif msg_type == "typing":
                    await deps.broadcast("typing", {
                        "sender": parsed.get("sender", ""),
                        "channel": parsed.get("channel", "general"),
                    })
                elif msg_type == "workspace_presence":
                    from routes import phase4_7 as _workspace_routes
                    await _workspace_routes.update_workspace_presence(id(ws), parsed)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        try:
            from routes import phase4_7 as _workspace_routes
            await _workspace_routes.remove_workspace_presence(id(ws))
        except Exception:
            pass
        async with deps._ws_clients_lock:
            deps._ws_clients.discard(ws)


# ── Include route modules ───────────────────────────────────────────

from routes import jobs as _r_jobs
from routes import rules as _r_rules
from routes import schedules as _r_schedules
from routes import sessions as _r_sessions
from routes import security as _r_security
from routes import bridges as _r_bridges
from routes import messages as _r_messages
from routes import channels as _r_channels
from routes import agents as _r_agents
from routes import search as _r_search
from routes import plugins as _r_plugins
from routes import providers as _r_providers
from routes import misc as _r_misc
from routes import phase4_7 as _r_phase4_7

app.include_router(_r_jobs.router)
app.include_router(_r_rules.router)
app.include_router(_r_schedules.router)
app.include_router(_r_sessions.router)
app.include_router(_r_security.router)
app.include_router(_r_bridges.router)
app.include_router(_r_messages.router)
app.include_router(_r_channels.router)
app.include_router(_r_agents.router)
app.include_router(_r_search.router)
app.include_router(_r_plugins.router)
app.include_router(_r_providers.router)
app.include_router(_r_misc.router)
app.include_router(_r_phase4_7.router)


# ── Serve uploads ───────────────────────────────────────────────────

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


# ── Serve frontend (SPA fallback) ──────────────────────────────────

@app.middleware("http")
async def spa_middleware(request: Request, call_next):
    response = await call_next(request)
    if response.status_code == 404:
        req_path = request.url.path
        if req_path.startswith("/api/") or req_path.startswith("/uploads/") or req_path == "/ws":
            return response

        if not STATIC_DIR.exists():
            return response

        file_path = (STATIC_DIR / req_path.lstrip("/")).resolve()
        if file_path.is_relative_to(STATIC_DIR.resolve()) and file_path.is_file():
            return FileResponse(file_path)

        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(index)

    return response


# ── Entrypoint ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    def _cleanup_ports():
        import subprocess as _sp
        for port in [PORT, 8200, 8201]:
            for cmd in [f"kill $(lsof -ti:{port}) 2>/dev/null", f"fuser -k {port}/tcp 2>/dev/null"]:
                try:
                    _sp.run(["bash", "-c", cmd], capture_output=True, timeout=3)
                except Exception:
                    pass
        import time as _t
        _t.sleep(1)

    _cleanup_ports()

    print(f"GhostLink starting on http://{HOST}:{PORT}")
    uvicorn.run(
        "app:app",
        host=HOST,
        port=PORT,
        reload=False,
        log_level="info",
    )
