"""GhostLink — FastAPI backend with WebSocket hub."""

from __future__ import annotations

import json
import os
import sys
import time
import uuid as _uuid
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # type: ignore

import asyncio
import logging
import re
import subprocess

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

log = logging.getLogger(__name__)

# Track spawned agent processes
_agent_processes: dict[str, subprocess.Popen] = {}
_agent_lock = asyncio.Lock()

# Agent name validation (prevents path traversal)
_VALID_AGENT_NAME = re.compile(r'^[a-zA-Z0-9_-]{1,50}$')

from store import MessageStore
from registry import AgentRegistry
from router import MessageRouter
from jobs import JobStore
from rules import RuleStore
from skills import SkillsRegistry
from schedules import ScheduleStore, cron_matches
from sessions import SessionManager
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
    alt = STATIC_DIR.parent  # Try one level up (../frontend/ instead of ../frontend/dist/)
    if (alt / "index.html").exists():
        STATIC_DIR = alt
if not UPLOAD_DIR.is_absolute():
    UPLOAD_DIR = BASE_DIR / UPLOAD_DIR

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ── Global state ────────────────────────────────────────────────────

store: MessageStore
skills_registry: SkillsRegistry
job_store: JobStore
schedule_store: ScheduleStore
rule_store: RuleStore
session_manager: SessionManager
provider_registry: ProviderRegistry
bridge_manager: BridgeManager
marketplace: Marketplace
hook_manager: HookManager
secrets_manager: SecretsManager
exec_policy: ExecPolicy
audit_log: AuditLog
data_manager: DataManager
registry = AgentRegistry()
router = MessageRouter(max_hops=MAX_HOPS, default_routing=DEFAULT_ROUTING)

# Settings (in-memory, persisted to JSON)
SETTINGS_PATH = DATA_DIR / "settings.json"
_settings: dict = {
    "username": "You",
    "title": "GhostLink",
    "theme": "dark",
    "fontSize": 14,
    "loopGuard": MAX_HOPS,
    "notificationSounds": True,
    "channels": ["general"],
}
_settings_lock = asyncio.Lock()


def _load_settings():
    global _settings
    if SETTINGS_PATH.exists():
        try:
            with open(SETTINGS_PATH) as f:
                saved = json.load(f)
            _settings.update(saved)
        except (json.JSONDecodeError, OSError) as e:
            log.warning("Failed to load settings.json: %s — using defaults", e)


def _save_settings():
    with open(SETTINGS_PATH, "w") as f:
        json.dump(_settings, f, indent=2)


def _get_full_agent_list() -> list[dict]:
    """Get ALL agents — live from registry + offline from config. Never loses agents."""
    live = registry.get_public_list()
    live_names = {a["name"] for a in live}
    live_bases = {a["base"] for a in live}
    agents_cfg = CONFIG.get("agents", {})

    # Enrich live agents
    for a in live:
        cfg = agents_cfg.get(a.get("base", ""), {})
        cwd_raw = cfg.get("cwd", ".")
        cwd_path = str((BASE_DIR / cwd_raw).resolve()) if not Path(cwd_raw).is_absolute() else cwd_raw
        a["workspace"] = cwd_path
        a["command"] = cfg.get("command", a.get("base", ""))
        a["args"] = cfg.get("args", [])

    # Add persistent agents from settings
    for pa in _settings.get("persistentAgents", []):
        if pa["base"] not in agents_cfg and pa["base"] not in live_bases:
            agents_cfg[pa["base"]] = {
                "command": pa.get("command", pa["base"]),
                "label": pa.get("label", pa["base"].capitalize()),
                "color": pa.get("color", "#a78bfa"),
                "cwd": pa.get("cwd", "."),
                "args": pa.get("args", []),
            }

    # Add offline agents from config
    for name, cfg in agents_cfg.items():
        if name not in live_names and name not in live_bases:
            cwd_raw = cfg.get("cwd", ".")
            cwd_path = str((BASE_DIR / cwd_raw).resolve()) if not Path(cwd_raw).is_absolute() else cwd_raw
            live.append({
                "name": name, "base": name,
                "label": cfg.get("label", name.capitalize()),
                "color": cfg.get("color", "#a78bfa"),
                "slot": 0, "state": "offline",
                "registered_at": 0, "role": "",
                "workspace": cwd_path,
                "command": cfg.get("command", name),
                "args": cfg.get("args", []),
            })
    return live


# ── Mention routing ─────────────────────────────────────────────────

def _route_mentions(sender: str, text: str, channel: str):
    """Parse @mentions and route based on responseMode.

    Routing rules:
    - 'mentioned' (default): only when @mentioned
    - 'always': receives ALL messages
    - 'listen': receives ALL messages (agent decides whether to respond)
    - 'silent': never receives messages (observe only)
    """
    import re
    mentions = re.findall(r"@(\w[\w-]*)", text)

    agent_names = [inst.name for inst in registry.get_all()]
    targets = []

    if mentions:
        if "all" in mentions:
            targets = [n for n in agent_names if n != sender]
        else:
            targets = [m for m in mentions if m in agent_names and m != sender]

        # Loop guard via router
        targets = router.get_targets(sender, text, channel, agent_names)

    # Add agents with 'always' or 'listen' responseMode (even without @mention)
    for inst in registry.get_all():
        if inst.name == sender:
            continue
        if inst.name in targets:
            continue
        if getattr(inst, 'responseMode', 'mentioned') in ('always', 'listen'):
            targets.append(inst.name)

    if not targets:
        return

    # Skip paused agents
    targets = [t for t in targets if not (registry.get(t) and registry.get(t).state == "paused")]

    for target in targets:
        # Mark agent as triggered so thinking state activates
        inst = registry.get(target)
        if inst:
            inst._was_triggered = True  # type: ignore[attr-defined]

        queue_file = DATA_DIR / f"{target}_queue.jsonl"
        try:
            with open(queue_file, "a", encoding="utf-8") as f:
                try:
                    import fcntl
                    fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                    try:
                        f.write(json.dumps({"channel": channel}) + "\n")
                    finally:
                        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
                except ImportError:
                    # Windows: fcntl not available, write without locking
                    f.write(json.dumps({"channel": channel}) + "\n")
        except Exception as e:
            log.warning("Queue write failed for %s: %s", target, e)


# ── WebSocket hub ───────────────────────────────────────────────────

_ws_clients: set[WebSocket] = set()


async def broadcast(event_type: str, data: dict):
    payload = json.dumps({"type": event_type, "data": data})
    dead: list[WebSocket] = []
    for ws in list(_ws_clients):
        try:
            await ws.send_text(payload)
        except Exception as e:
            log.debug("WebSocket send failed, removing client: %s", e)
            dead.append(ws)
    for ws in dead:
        _ws_clients.discard(ws)
    # Deliver to active webhooks (non-blocking)
    import threading as _th
    _th.Thread(target=_deliver_webhooks, args=(event_type, data), daemon=True).start()


def _deliver_webhooks(event_type: str, data: dict):
    """Fire-and-forget POST to all matching active webhooks. Runs in background thread."""
    import urllib.request
    payload = json.dumps({"event": event_type, "data": data, "timestamp": time.time()}).encode()
    for wh in list(_webhooks):  # Copy list to avoid mutation during iteration
        if not wh.get("active"):
            continue
        events = wh.get("events", [])
        if events and event_type not in events:
            continue
        url = wh.get("url", "")
        if not url or not url.startswith(("http://", "https://")):
            continue
        try:
            req = urllib.request.Request(
                url, data=payload, method="POST",
                headers={"Content-Type": "application/json", "User-Agent": "GhostLink-Webhook/1.0"},
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception as e:
            log.debug("Webhook delivery failed for %s: %s", wh["id"], e)


# ── Lifespan ────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    global store, job_store, rule_store, schedule_store, skills_registry, session_manager, provider_registry, bridge_manager, marketplace, hook_manager, secrets_manager, exec_policy, audit_log, data_manager

    _load_settings()
    _settings["_server_start"] = time.time()

    db_path = DATA_DIR / "ghostlink.db"
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
    provider_registry = ProviderRegistry(DATA_DIR)
    bridge_manager = BridgeManager(DATA_DIR, store=store, registry=registry)
    marketplace = Marketplace(DATA_DIR)
    hook_manager = HookManager(DATA_DIR, server_port=PORT)
    hook_manager.register_all()
    secrets_manager = SecretsManager(DATA_DIR)
    exec_policy = ExecPolicy(DATA_DIR)
    audit_log = AuditLog(DATA_DIR)
    data_manager = DataManager(DATA_DIR, store=store)
    audit_log.log("server_start", {"version": "2.1.0", "port": PORT})

    # Broadcast new messages via WebSocket
    async def on_msg(msg: dict):
        await broadcast("message", msg)
    store.on_message(on_msg)

    # Start MCP bridge for agent CLIs (dual transport)
    import threading
    mcp_cfg = CONFIG.get("mcp", {})
    mcp_bridge.configure(
        store=store,
        registry=registry,
        settings=_settings,
        data_dir=DATA_DIR,
        server_port=PORT,
        rule_store=rule_store,
        job_store=job_store,
        router=router,
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
                        # Don't re-trigger within the same minute
                        if now - sched.get("last_run", 0) < 55:
                            continue
                        agent = sched.get("agent", "")
                        command = sched.get("command", "")
                        channel = sched.get("channel", "general")
                        if agent and command:
                            # Write to agent's queue file to trigger them
                            queue_file = DATA_DIR / f"{agent}_queue.jsonl"
                            try:
                                with open(queue_file, "a") as f:
                                    f.write(json.dumps({"channel": channel, "scheduled": True}) + "\n")
                            except Exception as e:
                                log.warning("Schedule queue write failed for %s: %s", agent, e)
                            # Post a system message about the trigger
                            try:
                                asyncio.run_coroutine_threadsafe(
                                    store.add(sender="system", text=f"Scheduled: @{agent} — {command}", msg_type="system", channel=channel),
                                    _main_loop,
                                ).result(timeout=5)
                            except Exception as e:
                                log.warning("Schedule message post failed: %s", e)
                        # Mark as run
                        try:
                            asyncio.run_coroutine_threadsafe(
                                schedule_store.mark_run(sched["id"]),
                                _main_loop,
                            ).result(timeout=5)
                        except Exception as e:
                            log.warning("Schedule mark_run failed for %s: %s", sched["id"], e)
            except Exception as e:
                log.warning("Schedule checker error: %s", e)
            _schedule_stop.wait(60)

    sched_thread = threading.Thread(target=_schedule_checker, daemon=True)
    sched_thread.start()
    print("  Schedule checker started (checks every 60s)")

    # Agent health monitor — detects crashed agents and marks them offline
    _health_stop = threading.Event()
    _last_heartbeats: dict[str, float] = {}
    HEALTH_CHECK_INTERVAL = 30  # seconds
    HEARTBEAT_STALE_THRESHOLD = 45  # mark offline if no heartbeat for this long

    def _health_monitor():
        while not _health_stop.is_set():
            try:
                for inst in registry.get_all():
                    last_hb = _last_heartbeats.get(inst.name, inst.registered_at)
                    elapsed = time.time() - last_hb
                    if elapsed > HEARTBEAT_STALE_THRESHOLD and inst.state not in ("offline", "pending"):
                        old_state = inst.state
                        inst.state = "offline"
                        log.info("Agent %s marked offline (no heartbeat for %.0fs)", inst.name, elapsed)
                        try:
                            asyncio.run_coroutine_threadsafe(
                                broadcast("status", {"agents": _get_full_agent_list()}),
                                _main_loop,
                            ).result(timeout=5)
                        except Exception:
                            pass
            except Exception as e:
                log.debug("Health monitor error: %s", e)
            _health_stop.wait(HEALTH_CHECK_INTERVAL)

    health_thread = threading.Thread(target=_health_monitor, daemon=True)
    health_thread.start()
    print("  Health monitor started (checks every 30s)")

    # Load plugins
    plugin_loader.load_plugins(app, store=store, registry=registry, mcp_bridge_module=mcp_bridge)

    # Start enabled channel bridges
    bridge_manager.start_all_enabled()
    print("  Channel bridges initialized")

    # Plugin management endpoints
    @app.get("/api/plugins")
    async def api_list_plugins():
        return {"plugins": plugin_loader.list_plugins()}

    @app.post("/api/plugins/{name}/enable")
    async def api_enable_plugin(name: str):
        ok = plugin_loader.enable_plugin(name)
        return {"ok": ok, "note": "Restart server to apply" if ok else "Plugin not disabled"}

    @app.post("/api/plugins/{name}/disable")
    async def api_disable_plugin(name: str):
        ok = plugin_loader.disable_plugin(name)
        return {"ok": ok, "note": "Restart server to apply" if ok else "Plugin not enabled"}

    @app.post("/api/plugins/install")
    async def api_install_plugin(request: Request):
        body = await request.json()
        name = body.get("name", "").strip()
        code = body.get("code", "")
        if not name or not code:
            return JSONResponse({"error": "name and code required"}, 400)
        # AST-based safety scan before install
        issues = SafetyScanner.scan(code)
        critical = [i for i in issues if i["severity"] == "critical"]
        if critical:
            return JSONResponse({"error": f"Safety scan failed: {critical[0]['message']}", "issues": issues}, 400)
        result = plugin_loader.install_plugin(name, code, body.get("description", ""), body.get("version", "1.0.0"))
        return result

    @app.delete("/api/plugins/{name}")
    async def api_uninstall_plugin(name: str):
        ok = plugin_loader.uninstall_plugin(name)
        return {"ok": ok}

    yield

    _schedule_stop.set()
    _health_stop.set()
    bridge_manager.stop_all()
    await store.close()
    await db.close()


# ── Rate Limiting ──────────────────────────────────────────────────

import collections

_rate_limits: dict[str, collections.deque] = {}
_RATE_LIMIT_WINDOW = 60  # seconds
_RATE_LIMIT_MAX = 300  # requests per window per IP (increased for UI rapid actions)
_rate_limit_last_cleanup = time.time()


@asynccontextmanager
async def _rate_limit_lifespan(_app: FastAPI):
    async with lifespan(_app):
        yield


app = FastAPI(title="GhostLink", lifespan=lifespan)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Simple IP-based rate limiting for API endpoints."""
    global _rate_limit_last_cleanup
    if request.url.path.startswith("/api/"):
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        if client_ip not in _rate_limits:
            _rate_limits[client_ip] = collections.deque()
        dq = _rate_limits[client_ip]
        # Remove old entries
        while dq and dq[0] < now - _RATE_LIMIT_WINDOW:
            dq.popleft()
        if len(dq) >= _RATE_LIMIT_MAX:
            return JSONResponse(
                {"error": "Rate limit exceeded. Try again later."},
                status_code=429,
            )
        dq.append(now)
        # Periodic cleanup of stale IP entries (every 5 minutes)
        if now - _rate_limit_last_cleanup > 300:
            _rate_limit_last_cleanup = now
            stale = [ip for ip, dq in _rate_limits.items() if not dq or dq[-1] < now - _RATE_LIMIT_WINDOW]
            for ip in stale:
                _rate_limits.pop(ip, None)
    return await call_next(request)


# ── WebSocket endpoint ──────────────────────────────────────────────

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    _ws_clients.add(ws)
    try:
        while True:
            data = await ws.receive_text()
            try:
                parsed = json.loads(data)
                if parsed.get("type") == "typing":
                    await broadcast("typing", {
                        "sender": parsed.get("sender", ""),
                        "channel": parsed.get("channel", "general"),
                    })
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(ws)


# ── Message API ─────────────────────────────────────────────────────

@app.get("/api/messages")
async def get_messages(channel: str = "general", since_id: int = 0, limit: int = 50):
    if since_id:
        msgs = await store.get_since(since_id, channel)
    else:
        msgs = await store.get_recent(limit, channel)
    return {"messages": msgs}


@app.post("/api/send")
async def send_message(request: Request):
    body = await request.json()
    sender = (body.get("sender", "You") or "").strip()
    text = (body.get("text", "") or "")
    channel = (body.get("channel", "general") or "").strip()
    reply_to = body.get("reply_to")
    attachments = body.get("attachments", [])
    msg_type = (body.get("type", "chat") or "chat").strip()
    raw_metadata = body.get("metadata", "{}")

    # Validate msg_type — whitelist allowed values
    _ALLOWED_TYPES = {"chat", "system", "decision", "job_proposal", "rule_proposal", "progress", "approval_request"}
    if msg_type not in _ALLOWED_TYPES:
        msg_type = "chat"

    # Normalize metadata to JSON string
    if isinstance(raw_metadata, dict):
        metadata_str = json.dumps(raw_metadata)
    elif isinstance(raw_metadata, str):
        metadata_str = raw_metadata
    else:
        metadata_str = "{}"

    if not text.strip():
        return JSONResponse({"error": "empty message"}, 400)
    if not sender or len(sender) > 100:
        return JSONResponse({"error": "invalid sender (1-100 chars)"}, 400)
    if len(text) > 102400:
        return JSONResponse({"error": "message too long (max 100KB)"}, 400)
    if not channel or len(channel) > 50:
        return JSONResponse({"error": "invalid channel name (1-50 chars)"}, 400)

    msg = await store.add(
        sender=sender,
        text=text,
        msg_type=msg_type,
        channel=channel,
        reply_to=reply_to,
        attachments=json.dumps(attachments),
        metadata=metadata_str,
    )

    # Route @mentions to agent wrappers
    _route_mentions(sender, text, channel)

    # Forward to channel bridges (Discord, Telegram, etc.)
    try:
        bridge_manager.handle_ghostlink_message(sender, text, channel)
    except Exception:
        pass

    # Emit event for hooks
    event_bus.emit("on_message", {"sender": sender, "text": text, "channel": channel, "id": msg.get("id")})

    return msg


@app.post("/api/messages/{msg_id}/pin")
async def pin_message(msg_id: int, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    pinned = body.get("pinned", True)
    result = await store.pin(msg_id, pinned)
    if result:
        await broadcast("pin", {"message_id": msg_id, "pinned": pinned})
        return result
    return JSONResponse({"error": "not found"}, 404)


@app.post("/api/messages/{msg_id}/react")
async def react_message(msg_id: int, request: Request):
    body = await request.json()
    emoji = body.get("emoji", "")
    sender = body.get("sender", "You")
    if not emoji:
        return JSONResponse({"error": "emoji required"}, 400)
    reactions = await store.react(msg_id, emoji, sender)
    if reactions is None:
        return JSONResponse({"error": "not found"}, 404)
    await broadcast("reaction", {"message_id": msg_id, "reactions": reactions})
    return {"message_id": msg_id, "reactions": reactions}


@app.patch("/api/messages/{msg_id}")
async def edit_message(msg_id: int, request: Request):
    body = await request.json()
    new_text = (body.get("text", "") or "").strip()
    if not new_text:
        return JSONResponse({"error": "text required"}, 400)
    if len(new_text) > 102400:
        return JSONResponse({"error": "message too long"}, 400)
    msg = await store.edit(msg_id, new_text)
    if not msg:
        return JSONResponse({"error": "not found"}, 404)
    await broadcast("message_edit", {"message_id": msg_id, "text": new_text})
    return msg


@app.post("/api/messages/{msg_id}/bookmark")
async def bookmark_message(msg_id: int, request: Request):
    body = await request.json()
    bookmarked = body.get("bookmarked", True)
    # Bookmarks are stored client-side — this endpoint just acknowledges
    # and broadcasts so other clients can sync
    await broadcast("bookmark", {"message_id": msg_id, "bookmarked": bookmarked})
    return {"message_id": msg_id, "bookmarked": bookmarked}


@app.post("/api/messages/{msg_id}/progress-update")
async def progress_update(msg_id: int, request: Request):
    """Internal: broadcast a progress metadata update to all WebSocket clients."""
    body = await request.json()
    metadata = body.get("metadata", "{}")
    await broadcast("message_edit", {"message_id": msg_id, "metadata": metadata})
    return {"ok": True}


@app.delete("/api/messages/{msg_id}")
async def delete_message(msg_id: int):
    # Block deletion of system/join messages
    if store._db:
        cursor = await store._db.execute(
            "SELECT type FROM messages WHERE id = ?", (msg_id,)
        )
        row = await cursor.fetchone()
        if row and row[0] in ("system", "join"):
            return JSONResponse({"error": "cannot delete system messages"}, 403)
    deleted = await store.delete([msg_id])
    if deleted:
        await broadcast("delete", {"message_ids": deleted})
        return {"ok": True}
    return JSONResponse({"error": "not found"}, 404)


@app.post("/api/messages/bulk-delete")
async def bulk_delete_messages(request: Request):
    body = await request.json()
    ids = body.get("ids", [])
    if not ids or not isinstance(ids, list):
        return JSONResponse({"error": "ids must be a non-empty list"}, 400)
    if len(ids) > 200:
        return JSONResponse({"error": "max 200 messages per request"}, 400)
    # Sanitize: coerce to int, skip any non-numeric values
    safe_ids = []
    for i in ids:
        try:
            safe_ids.append(int(i))
        except (ValueError, TypeError):
            continue
    if not safe_ids:
        return JSONResponse({"error": "no valid ids"}, 400)
    # Filter out system/join messages — these are structural and should not be deleted
    if store._db:
        placeholders = ",".join("?" * len(safe_ids))
        cursor = await store._db.execute(
            f"SELECT id FROM messages WHERE id IN ({placeholders}) AND type IN ('system', 'join')",
            tuple(safe_ids),
        )
        protected = {row[0] for row in await cursor.fetchall()}
        if protected:
            safe_ids = [i for i in safe_ids if i not in protected]
        if not safe_ids:
            return JSONResponse({"error": "cannot delete system messages"}, 403)
    deleted = await store.delete(safe_ids)
    if deleted:
        await broadcast("delete", {"message_ids": deleted})
    return {"ok": True, "deleted": deleted or []}


@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        return JSONResponse({"error": "only images allowed"}, 400)

    data = await file.read()
    if len(data) > MAX_SIZE_MB * 1024 * 1024:
        return JSONResponse({"error": f"max {MAX_SIZE_MB}MB"}, 400)

    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "png"
    name = f"{_uuid.uuid4().hex[:12]}.{ext}"
    path = UPLOAD_DIR / name
    with open(path, "wb") as f:
        f.write(data)

    return {"url": f"/uploads/{name}", "name": name}


# ── Status & Settings ──────────────────────────────────────────────

@app.get("/api/status")
async def get_status():
    return {"agents": _get_full_agent_list()}


@app.get("/api/settings")
async def get_settings():
    # Merge config.toml agents into persistentAgents if not already there
    result = dict(_settings)
    persistent = list(result.get("persistentAgents", []))
    persistent_bases = {p["base"] for p in persistent}
    agents_cfg = CONFIG.get("agents", {})
    for name, cfg in agents_cfg.items():
        if name not in persistent_bases:
            cwd_raw = cfg.get("cwd", ".")
            cwd_resolved = str((BASE_DIR / cwd_raw).resolve()) if not Path(cwd_raw).is_absolute() else cwd_raw
            persistent.append({
                "base": name,
                "label": cfg.get("label", name.capitalize()),
                "command": cfg.get("command", name),
                "args": cfg.get("args", []),
                "cwd": cwd_resolved,
                "color": cfg.get("color", "#a78bfa"),
            })
    result["persistentAgents"] = persistent
    return result


@app.post("/api/settings")
async def save_settings(request: Request):
    body = await request.json()
    # Whitelist allowed settings keys to prevent arbitrary injection
    _ALLOWED_SETTINGS = {
        "username", "title", "theme", "fontSize", "loopGuard", "notificationSounds",
        "channels", "persistentAgents", "autoRoute", "connectedAgents",
        "quietHoursStart", "quietHoursEnd", "soundEnabled", "soundVolume",
        "soundPerAgent", "timezone", "timeFormat", "voiceLanguage",
    }
    filtered = {k: v for k, v in body.items() if k in _ALLOWED_SETTINGS}
    async with _settings_lock:
        _settings.update(filtered)
        _save_settings()
    # Sync loop guard to router
    if "loopGuard" in body:
        router.max_hops = int(body["loopGuard"])
    # Sync auto-route toggle to router
    if "autoRoute" in body:
        val = body["autoRoute"]
        if isinstance(val, str) and val in ("none", "all", "smart"):
            router.default_routing = val
        elif val is True:
            router.default_routing = "all"
        else:
            router.default_routing = "none"
    return _settings


# ── Channels ────────────────────────────────────────────────────────

@app.get("/api/channels")
async def get_channels():
    return {"channels": _settings.get("channels", ["general"])}


@app.post("/api/channels")
async def create_channel(request: Request):
    body = await request.json()
    name = body.get("name", "").strip().lower()
    if not name or len(name) > 20:
        return JSONResponse({"error": "invalid name"}, 400)
    channels = _settings.get("channels", ["general"])
    if name in channels:
        return JSONResponse({"error": "exists"}, 409)
    if len(channels) >= 8:
        return JSONResponse({"error": "max 8 channels"}, 400)
    channels.append(name)
    _settings["channels"] = channels
    _save_settings()
    await broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in channels]})
    return {"channels": channels}


@app.delete("/api/channels/{name}")
async def delete_channel(name: str):
    channels = _settings.get("channels", ["general"])
    if name == "general":
        return JSONResponse({"error": "cannot delete general"}, 400)
    if name not in channels:
        return JSONResponse({"error": "not found"}, 404)
    channels.remove(name)
    _settings["channels"] = channels
    _save_settings()
    await broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in channels]})
    return {"channels": channels}


@app.patch("/api/channels/{name}")
async def rename_channel(name: str, request: Request):
    body = await request.json()
    new_name = body.get("name", "").strip().lower()
    if not new_name or len(new_name) > 20:
        return JSONResponse({"error": "invalid name"}, 400)
    channels = _settings.get("channels", ["general"])
    if name not in channels:
        return JSONResponse({"error": "not found"}, 404)
    if new_name in channels:
        return JSONResponse({"error": "name already exists"}, 409)
    idx = channels.index(name)
    channels[idx] = new_name
    _settings["channels"] = channels
    _save_settings()
    # Update messages in the renamed channel
    await store.rename_channel(name, new_name)
    await broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in channels]})
    return {"channels": channels}


@app.get("/api/channels/{name}/summary")
async def channel_summary(name: str):
    """Generate a summary of recent channel activity."""
    channels = _settings.get("channels", ["general"])
    if name not in channels:
        return JSONResponse({"error": "channel not found"}, 404)
    if store._db is None:
        raise RuntimeError("database not initialized")
    cursor = await store._db.execute(
        "SELECT sender, text, timestamp FROM messages WHERE channel = ? ORDER BY id DESC LIMIT 100",
        (name,),
    )
    rows = await cursor.fetchall()
    if not rows:
        return {"channel": name, "summary": "No messages yet.", "message_count": 0, "participants": [], "topics": []}
    rows.reverse()

    participants: dict[str, int] = {}
    words: dict[str, int] = {}
    for sender, text, _ts in rows:
        participants[sender] = participants.get(sender, 0) + 1
        for word in text.lower().split():
            clean = word.strip(".,!?@#()[]{}\"'`*_~")
            if len(clean) > 3 and clean not in {"this", "that", "with", "from", "have", "been", "will", "they", "their", "what", "when", "your", "just", "about", "like", "would", "could", "should", "there", "here", "some", "also", "more", "than", "very"}:
                words[clean] = words.get(clean, 0) + 1

    top_participants = sorted(participants.items(), key=lambda x: -x[1])[:5]
    top_topics = sorted(words.items(), key=lambda x: -x[1])[:10]
    topic_words = [w for w, _ in top_topics]

    first_ts = rows[0][2]
    last_ts = rows[-1][2]
    summary_parts = [
        f"{len(rows)} messages in #{name}",
        f"from {len(participants)} participant{'s' if len(participants) != 1 else ''}.",
    ]
    if top_participants:
        summary_parts.append(f"Most active: {', '.join(p for p, _ in top_participants[:3])}.")
    if topic_words:
        summary_parts.append(f"Key topics: {', '.join(topic_words[:5])}.")

    return {
        "channel": name,
        "summary": " ".join(summary_parts),
        "message_count": len(rows),
        "participants": [{"name": p, "count": c} for p, c in top_participants],
        "topics": topic_words,
        "first_message": first_ts,
        "last_message": last_ts,
    }


# ── Agent Registry ──────────────────────────────────────────────────

@app.post("/api/register")
async def register_agent(request: Request):
    body = await request.json()
    base = body.get("base", body.get("name", ""))
    label = body.get("label", "")
    color = body.get("color", "")
    if not base:
        return JSONResponse({"error": "base required"}, 400)
    inst = registry.register(base, label, color)
    await broadcast("status", {"agents": _get_full_agent_list()})
    return inst.to_dict()


@app.post("/api/deregister/{name}")
async def deregister_agent(name: str):
    ok = registry.deregister(name)
    if ok:
        mcp_bridge.cleanup_agent(name)
        await broadcast("status", {"agents": _get_full_agent_list()})
    return {"ok": ok}


@app.get("/api/agent-templates")
async def agent_templates(connected: str = ""):
    """Return available agent CLI templates with defaults.
    Pass connected=claude,gemini,codex to mark agents detected by the desktop auth system."""
    import shutil as _shutil
    # Agents the desktop auth system has verified as connected
    _connected_set = set(c.strip() for c in connected.split(",") if c.strip())
    # Also include connected agents saved by the desktop launcher
    stored = _settings.get("connectedAgents", [])
    if isinstance(stored, list):
        _connected_set.update(stored)

    # API key env vars that indicate an agent is usable even without CLI
    _API_KEY_ENV = {
        "claude": ["ANTHROPIC_API_KEY"],
        "codex": ["OPENAI_API_KEY"],
        "gemini": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        "grok": ["XAI_API_KEY"],
    }

    # Cache detection results so we don't re-run slow WSL checks on every call
    _available_cache: dict[str, bool] = {}

    def _is_available(name: str, cmd: str) -> bool:
        """Check if agent is available via CLI binary, API key, WSL, or desktop auth."""
        # Desktop auth already verified this agent is connected
        if name in _connected_set:
            return True
        # Map provider names from auth system to agent base names
        _PROVIDER_TO_BASE = {"anthropic": "claude", "openai": "codex", "google": "gemini", "github": "copilot"}
        if _PROVIDER_TO_BASE.get(name, name) in _connected_set or name in [_PROVIDER_TO_BASE.get(c, c) for c in _connected_set]:
            return True

        if name in _available_cache:
            return _available_cache[name]

        result = _check_available(name, cmd)
        _available_cache[name] = result
        return result

    def _check_available(name: str, cmd: str) -> bool:
        if _shutil.which(cmd):
            return True
        # Check API keys
        for key in _API_KEY_ENV.get(name, []):
            if os.environ.get(key):
                return True
        # Check in WSL — try multiple methods for maximum compatibility
        wsl_checks = [
            f'which {cmd} 2>/dev/null',
            f'command -v {cmd} 2>/dev/null',
            # Check common npm global paths directly
            f'test -f "$HOME/.nvm/versions/node/*/bin/{cmd}" 2>/dev/null && echo found',
            f'test -f "/usr/local/bin/{cmd}" 2>/dev/null && echo found',
            f'ls $(npm root -g 2>/dev/null)/.bin/{cmd} 2>/dev/null',
        ]
        for check in wsl_checks:
            try:
                r = subprocess.run(
                    ['wsl', 'bash', '-lc', check],
                    capture_output=True, timeout=8,
                )
                if r.returncode == 0 and r.stdout.strip():
                    return True
            except Exception:
                pass
        return False

    agents_cfg = CONFIG.get("agents", {})
    templates = []
    for name, cfg in agents_cfg.items():
        cmd = cfg.get("command", name)
        templates.append({
            "base": name,
            "command": cmd,
            "label": cfg.get("label", name.capitalize()),
            "color": cfg.get("color", "#a78bfa"),
            "defaultCwd": cfg.get("cwd", "."),
            "defaultArgs": cfg.get("args", []),
            "available": _is_available(name, cmd),
        })
    # Scan for all known AI CLI agents
    KNOWN_AGENTS = [
        ("claude", "claude", "Claude", "#e8734a", "Anthropic", ["--dangerously-skip-permissions"]),
        ("codex", "codex", "Codex", "#10a37f", "OpenAI", ["--sandbox", "danger-full-access", "-a", "never"]),
        ("gemini", "gemini", "Gemini", "#4285f4", "Google", ["-y"]),
        ("grok", "grok", "Grok", "#ff6b35", "xAI", []),
        ("copilot", "gh", "Copilot", "#6cc644", "GitHub", ["copilot"]),
        ("aider", "aider", "Aider", "#14b8a6", "Aider", ["--yes"]),
        ("goose", "goose", "Goose", "#f59e0b", "Block", []),
        ("pi", "pi", "Pi", "#8b5cf6", "Inflection", []),
        ("cursor", "cursor", "Cursor", "#7c3aed", "Cursor", []),
        ("cody", "cody", "Cody", "#ff5543", "Sourcegraph", []),
        ("continue", "continue", "Continue", "#0ea5e9", "Continue", []),
        ("opencode", "opencode", "OpenCode", "#22c55e", "OpenCode", []),
        ("ollama", "ollama", "Ollama", "#ffffff", "Ollama (Local)", []),
    ]
    for name, cmd, label, color, provider, default_args in KNOWN_AGENTS:
        if not any(t["base"] == name for t in templates):
            templates.append({
                "base": name, "command": cmd, "label": label,
                "color": color, "defaultCwd": ".", "defaultArgs": default_args,
                "available": _is_available(name, cmd), "provider": provider,
            })
        else:
            for t in templates:
                if t["base"] == name:
                    t["provider"] = provider
    return {"templates": templates}


@app.post("/api/pick-folder")
async def pick_folder():
    """Open the native OS folder picker and return the WSL-compatible path."""
    import re

    def win_to_wsl(p: str) -> str:
        p = p.strip().replace("\\", "/").rstrip("/")
        m = re.match(r"^([A-Za-z]):/(.*)$", p)
        if m:
            return f"/mnt/{m.group(1).lower()}/{m.group(2)}"
        return p

    # Try Windows folder picker via PowerShell (WSL)
    ps_script = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$f = New-Object System.Windows.Forms.FolderBrowserDialog;"
        "$f.Description = 'Select workspace folder';"
        "$f.ShowNewFolderButton = $true;"
        "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }"
    )
    # Find powershell
    import shutil as _shutil
    ps_exe = _shutil.which("powershell.exe")
    if not ps_exe:
        return JSONResponse({"error": "powershell.exe not found — not running on WSL?"}, 500)

    try:
        result = subprocess.run(
            [ps_exe, "-NoProfile", "-Command", ps_script],
            capture_output=True, text=True, timeout=120,
        )
        win_path = result.stdout.strip()
        if not win_path:
            return JSONResponse({"error": "No folder selected"}, 400)
        wsl_path = win_to_wsl(win_path)
        return {"windowsPath": win_path, "path": wsl_path}
    except FileNotFoundError:
        return JSONResponse({"error": "powershell.exe not available — not running on WSL?"}, 500)
    except subprocess.TimeoutExpired:
        return JSONResponse({"error": "Folder picker timed out"}, 408)


@app.post("/api/spawn-agent")
async def spawn_agent(request: Request):
    """Spawn a new agent wrapper process."""
    body = await request.json()
    base = body.get("base", "").strip()
    label = body.get("label", "").strip()
    cwd = body.get("cwd", "").strip()
    extra_args = body.get("args", [])

    if not base:
        return JSONResponse({"error": "base is required"}, 400)

    # Resolve the agent command
    agents_cfg = CONFIG.get("agents", {})
    cfg = agents_cfg.get(base, {})
    command = cfg.get("command", base)

    import shutil as _shutil
    if not _shutil.which(command):
        # Check WSL — agent CLIs are often installed there
        found_in_wsl = False
        for check in [f'which {command} 2>/dev/null', f'command -v {command} 2>/dev/null']:
            try:
                r = subprocess.run(['wsl', 'bash', '-lc', check], capture_output=True, timeout=8)
                if r.returncode == 0 and r.stdout.strip():
                    found_in_wsl = True
                    break
            except Exception:
                pass
        if not found_in_wsl:
            return JSONResponse({"error": f"'{command}' not found on PATH or in WSL"}, 400)

    # Update in-memory config for this session (don't overwrite config.toml)
    if cwd or extra_args:
        if base not in CONFIG.get("agents", {}):
            CONFIG.setdefault("agents", {})[base] = {
                "command": command,
                "label": label or base.capitalize(),
                "color": cfg.get("color", "#a78bfa"),
                "cwd": cwd or ".",
                "args": extra_args or [],
            }
        else:
            if cwd:
                CONFIG["agents"][base]["cwd"] = cwd
            if extra_args:
                CONFIG["agents"][base]["args"] = extra_args

    # Build the wrapper command
    wrapper_path = str(BASE_DIR / "wrapper.py")
    venv_python = str(BASE_DIR.parent / ".venv" / "bin" / "python")
    if not Path(venv_python).exists():
        venv_python = sys.executable

    spawn_args = [venv_python, wrapper_path, base, "--headless"]
    if label:
        spawn_args.extend(["--label", label])
    # Pass agent-specific args (e.g. --dangerously-skip-permissions for claude)
    # These go after "--" so wrapper passes them through to the CLI
    if extra_args:
        spawn_args.append("--")
        spawn_args.extend(extra_args)

    try:
        spawn_env = os.environ.copy()
        if cwd:
            spawn_env["GHOSTLINK_AGENT_CWD"] = cwd
        proc = subprocess.Popen(
            spawn_args,
            cwd=str(BASE_DIR),
            env=spawn_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        # Store by base name — wrapper will register with a unique instance name
        async with _agent_lock:
            _agent_processes[f"{base}_{proc.pid}"] = proc

        import asyncio
        await asyncio.sleep(3)

        # Check if process died immediately (CLI not found, etc)
        if proc.poll() is not None:
            stderr_output = ""
            try:
                stderr_output = proc.stderr.read().decode("utf-8", errors="replace").strip() if proc.stderr else ""
            except Exception:
                pass
            error_msg = stderr_output or f"Agent '{base}' exited immediately. Is the '{command}' CLI installed and authenticated?"
            log.warning("Agent spawn failed for %s: %s", base, error_msg)
            async with _agent_lock:
                _agent_processes.pop(f"{base}_{proc.pid}", None)
            return JSONResponse({"error": error_msg}, 400)

        return {
            "ok": True,
            "pid": proc.pid,
            "base": base,
            "message": f"Agent '{base}' spawning (pid {proc.pid})",
        }
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@app.post("/api/kill-agent/{name}")
async def kill_agent(name: str):
    """Kill a specific agent by name. Only affects the named agent, never others."""
    # Only deregister this specific agent
    ok = registry.deregister(name)
    if ok:
        mcp_bridge.cleanup_agent(name)

    # Only kill this specific agent's tmux session
    session_name = f"ghostlink-{name}"
    try:
        subprocess.run(
            ["tmux", "kill-session", "-t", session_name],
            capture_output=True, timeout=5,
        )
    except Exception as e:
        log.debug("tmux kill-session for %s: %s", name, e)

    # Only kill the wrapper process for THIS specific agent
    # Processes are stored as {base}_{pid} — match exact name prefix only
    async with _agent_lock:
        proc = _agent_processes.pop(name, None)
        if proc is None:
            # Scan for keys matching this exact agent name + "_" (pid suffix)
            for key in list(_agent_processes):
                if key.startswith(name + "_"):
                    proc = _agent_processes.pop(key, None)
                    break
    if proc:
        try:
            proc.terminate()
        except Exception as e:
            log.debug("Process terminate for %s: %s", name, e)

    if ok:
        await broadcast("status", {"agents": _get_full_agent_list()})
    return {"ok": ok or proc is not None}


@app.post("/api/cleanup")
async def cleanup_stale():
    """Kill stale tmux sessions, clear orphaned processes, free resources."""
    cleaned = []

    # Find all ghostlink tmux sessions
    try:
        result = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}"],
                                capture_output=True, text=True, timeout=5)
        sessions = [s.strip() for s in result.stdout.strip().split("\n") if s.strip().startswith("ghostlink-")]
    except Exception as e:
        log.debug("tmux list-sessions: %s", e)
        sessions = []

    # Check which sessions have no registered agent
    live_names = {inst.name for inst in registry.get_all()}
    for session in sessions:
        agent_name = session.replace("ghostlink-", "")
        if agent_name not in live_names:
            try:
                subprocess.run(["tmux", "kill-session", "-t", session], capture_output=True, timeout=5)
                cleaned.append(session)
            except Exception as e:
                log.debug("Failed to kill stale session %s: %s", session, e)

    # Kill orphaned wrapper processes
    async with _agent_lock:
        for key, proc in list(_agent_processes.items()):
            try:
                if proc.poll() is not None:  # Process already exited
                    _agent_processes.pop(key, None)
                    cleaned.append(f"process:{key}")
            except Exception as e:
                log.debug("Process cleanup for %s: %s", key, e)

    return {"ok": True, "cleaned": cleaned, "count": len(cleaned)}


@app.post("/api/shutdown")
async def shutdown_server():
    """Gracefully stop the backend server. Kills all agents first, then exits."""
    import asyncio, signal

    # Kill all running agents first
    async with _agent_lock:
        for inst in list(registry.get_all()):
            try:
                proc = _agent_processes.get(inst.name)
                if proc and proc.poll() is None:
                    proc.terminate()
            except Exception as e:
                log.debug("Shutdown: failed to terminate %s: %s", inst.name, e)

    # Broadcast shutdown notice to all connected WebSocket clients
    try:
        await broadcast("system", {"event": "server_shutdown", "message": "Server is shutting down"})
    except Exception as e:
        log.debug("Shutdown broadcast failed: %s", e)

    # Schedule the actual shutdown after response is sent
    async def _do_shutdown():
        await asyncio.sleep(0.5)
        os.kill(os.getpid(), signal.SIGTERM)

    asyncio.get_event_loop().create_task(_do_shutdown())
    return {"ok": True, "message": "Server shutting down"}


# ── Skills ──────────────────────────────────────────────────────────

@app.get("/api/skills")
async def list_skills(category: str = "", search: str = ""):
    """List all available skills, optionally filtered."""
    skills = skills_registry.get_all_skills()
    if category:
        skills = [s for s in skills if s.get("category", "").lower() == category.lower()]
    if search:
        q = search.lower()
        skills = [s for s in skills if q in s["name"].lower() or q in s.get("description", "").lower()]
    return {"skills": skills, "categories": skills_registry.get_categories()}


@app.get("/api/skills/agent/{agent_name}")
async def get_agent_skills(agent_name: str):
    """Get enabled skills for a specific agent."""
    enabled = skills_registry.get_agent_skills(agent_name)
    all_skills = skills_registry.get_all_skills()
    result = []
    for s in all_skills:
        result.append({**s, "enabled": s["id"] in enabled})
    return {"skills": result, "agent": agent_name}


@app.post("/api/skills/agent/{agent_name}/toggle")
async def toggle_agent_skill(agent_name: str, request: Request):
    """Enable or disable a skill for an agent."""
    body = await request.json()
    skill_id = body.get("skillId", "")
    enabled = body.get("enabled", True)
    if enabled:
        skills_registry.enable_skill(agent_name, skill_id)
    else:
        skills_registry.disable_skill(agent_name, skill_id)
    return {"ok": True, "agent": agent_name, "skillId": skill_id, "enabled": enabled}


@app.post("/api/agents/{name}/pause")
async def pause_agent(name: str):
    inst = registry.get(name)
    if not inst:
        return JSONResponse({"error": "not found"}, 404)
    inst.state = "paused"
    await broadcast("status", {"agents": _get_full_agent_list()})
    return {"ok": True, "state": "paused"}


@app.post("/api/agents/{name}/resume")
async def resume_agent(name: str):
    inst = registry.get(name)
    if not inst:
        return JSONResponse({"error": "not found"}, 404)
    inst.state = "active"
    await broadcast("status", {"agents": _get_full_agent_list()})
    return {"ok": True, "state": "active"}


@app.get("/api/search")
async def search_messages(q: str = "", channel: str = "", sender: str = "", limit: int = 50):
    """Full-text search across messages using FTS5 with LIKE fallback."""
    if not q.strip():
        return {"results": []}
    if store._db is None:
        raise RuntimeError("Database not initialized. Call init() first.")

    # Try FTS5 first (much faster)
    try:
        fts_query = "SELECT m.* FROM messages m JOIN messages_fts f ON m.id = f.rowid WHERE messages_fts MATCH ?"
        fts_params: list = [q.strip()]
        if channel:
            fts_query += " AND m.channel = ?"
            fts_params.append(channel)
        if sender:
            fts_query += " AND m.sender = ?"
            fts_params.append(sender)
        fts_query += " ORDER BY m.id DESC LIMIT ?"
        fts_params.append(limit)
        cursor = await store._db.execute(fts_query, fts_params)
        rows = await cursor.fetchall()
    except Exception:
        # FTS5 not available or query syntax error — fall back to LIKE
        query = "SELECT * FROM messages WHERE text LIKE ? COLLATE NOCASE"
        params: list = [f"%{q}%"]
        if channel:
            query += " AND channel = ?"
            params.append(channel)
        if sender:
            query += " AND sender = ?"
            params.append(sender)
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        cursor = await store._db.execute(query, params)
        rows = await cursor.fetchall()
    return {"results": [store._row_to_dict(r) for r in rows], "query": q}


@app.post("/api/heartbeat/{agent_name}")
async def heartbeat(agent_name: str, request: Request):
    inst = registry.get(agent_name)
    if inst:
        _last_heartbeats[agent_name] = time.time()
        old_state = inst.state
        # Check if agent was triggered by @mention — activate thinking immediately
        was_triggered = getattr(inst, '_was_triggered', False)
        if was_triggered:
            inst.state = "thinking"
            inst._think_ts = time.time()  # type: ignore[attr-defined]
            inst._was_triggered = False  # type: ignore[attr-defined]
        try:
            body = await request.json()
            if body.get("active"):
                # Glow whenever agent is doing anything — skip first 5s (startup noise)
                if time.time() - inst.registered_at > 5:
                    inst.state = "thinking"
                    inst._think_ts = time.time()  # type: ignore[attr-defined]
            else:
                # Stay "thinking" for 3s after last active report to prevent flicker
                last_think = getattr(inst, '_think_ts', 0)
                if old_state == "thinking" and (time.time() - last_think) < 3:
                    pass  # keep thinking
                elif not was_triggered:
                    inst.state = "active"
        except Exception:
            last_think = getattr(inst, '_think_ts', 0)
            if old_state == "thinking" and (time.time() - last_think) < 3:
                pass
            elif not was_triggered:
                inst.state = "active"
        # Broadcast state change so frontend sees thinking glow
        if inst.state != old_state:
            await broadcast("status", {"agents": _get_full_agent_list()})
        result: dict = {"ok": True, "name": inst.name}
        # Rotate token if expired — wrapper picks up the new token
        if inst.is_token_expired():
            result["token"] = inst.rotate_token()
        return result
    return JSONResponse({"error": "not found"}, 404)


# ── Agent Thinking Stream ────────────────────────────────────────────

_thinking_buffers: dict[str, dict] = {}  # agent_name → {text, updated_at, active}


@app.post("/api/agents/{agent_name}/thinking")
async def update_thinking(agent_name: str, request: Request):
    """Update an agent's thinking buffer. Called by wrapper during active processing."""
    body = await request.json()
    text = body.get("text", "")
    active = body.get("active", True)

    _thinking_buffers[agent_name] = {
        "text": text[-2000:] if text else "",  # Cap at 2KB
        "updated_at": time.time(),
        "active": active,
    }

    # Broadcast to all connected WebSocket clients
    await broadcast("thinking_stream", {
        "agent": agent_name,
        "text": text[-2000:] if text else "",
        "active": active,
    })

    return {"ok": True}


@app.get("/api/agents/{agent_name}/thinking")
async def get_thinking(agent_name: str):
    """Get current thinking buffer for an agent."""
    buf = _thinking_buffers.get(agent_name)
    if not buf or time.time() - buf.get("updated_at", 0) > 30:
        return {"text": "", "active": False}
    return buf


# ── Approval Prompts ───────────────────────────────────────────────

@app.post("/api/approval/respond")
async def respond_approval(request: Request):
    """Respond to an agent's permission prompt. Writes response file for wrapper to pick up."""
    body = await request.json()
    agent_name = (body.get("agent", "") or "").strip()
    response = (body.get("response", "") or "").strip()
    message_id = body.get("message_id", 0)

    if not agent_name or not response:
        return JSONResponse({"error": "agent and response required"}, 400)
    if not _VALID_AGENT_NAME.match(agent_name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    if response not in ("allow_once", "allow_session", "deny"):
        return JSONResponse({"error": "response must be allow_once, allow_session, or deny"}, 400)

    # Write response file that the wrapper polls for
    response_file = DATA_DIR / f"{agent_name}_approval.json"
    response_file.write_text(json.dumps({
        "response": response,
        "message_id": message_id,
        "timestamp": time.time(),
    }))

    # Update the approval message metadata to mark it as responded
    if message_id and store._db:
        try:
            cursor = await store._db.execute("SELECT metadata FROM messages WHERE id = ?", (message_id,))
            row = await cursor.fetchone()
            if row:
                try:
                    meta = json.loads(row["metadata"]) if row["metadata"] else {}
                except (json.JSONDecodeError, TypeError):
                    meta = {}
                meta["responded"] = response
                await store._db.execute(
                    "UPDATE messages SET metadata = ? WHERE id = ?",
                    (json.dumps(meta), message_id),
                )
                await store._db.commit()
        except Exception as e:
            log.warning("Failed to update approval message metadata: %s", e)

    # Broadcast so all connected clients see the response
    await broadcast("approval_response", {
        "agent": agent_name,
        "response": response,
        "message_id": message_id,
    })

    return {"ok": True}


# ── Jobs ────────────────────────────────────────────────────────────

@app.get("/api/jobs")
async def list_jobs(channel: str | None = None, status: str | None = None):
    jobs = await job_store.list_jobs(channel, status)
    return {"jobs": jobs}


@app.post("/api/jobs")
async def create_job(request: Request):
    body = await request.json()
    job = await job_store.create(
        title=body.get("title", ""),
        channel=body.get("channel", "general"),
        created_by=body.get("created_by", ""),
        assignee=body.get("assignee", ""),
        body=body.get("body", ""),
        job_type=body.get("type", ""),
    )
    await broadcast("job_update", job)
    return job


@app.patch("/api/jobs/{job_id}")
async def update_job(job_id: int, request: Request):
    body = await request.json()
    job = await job_store.update(job_id, body)
    if job:
        await broadcast("job_update", job)
        return job
    return JSONResponse({"error": "not found"}, 404)


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: int):
    ok = await job_store.delete(job_id)
    return {"ok": ok}


# ── Rules ───────────────────────────────────────────────────────────

@app.get("/api/rules")
async def list_rules():
    rules = await rule_store.list_all()
    return {"rules": rules}


@app.get("/api/rules/active")
async def active_rules():
    return await rule_store.active_list()


@app.post("/api/rules")
async def propose_rule(request: Request):
    body = await request.json()
    rule = await rule_store.propose(
        text=body.get("text", ""),
        author=body.get("author", ""),
        reason=body.get("reason", ""),
    )
    rules = await rule_store.list_all()
    await broadcast("rule_update", {"rules": rules})
    return rule


@app.patch("/api/rules/{rule_id}")
async def update_rule(rule_id: int, request: Request):
    body = await request.json()
    rule = await rule_store.update(rule_id, body)
    if rule:
        rules = await rule_store.list_all()
        await broadcast("rule_update", {"rules": rules})
        return rule
    return JSONResponse({"error": "not found"}, 404)


# ── Schedules ─────────────────────────────────────────────────────────

@app.get("/api/schedules")
async def list_schedules():
    schedules = await schedule_store.list_all()
    return {"schedules": schedules}


@app.post("/api/schedules")
async def create_schedule(request: Request):
    body = await request.json()
    sched = await schedule_store.create(
        cron_expr=body.get("cron_expr", "*/5 * * * *"),
        agent=body.get("agent", ""),
        command=body.get("command", ""),
        channel=body.get("channel", "general"),
        enabled=body.get("enabled", True),
    )
    return sched


@app.patch("/api/schedules/{sched_id}")
async def update_schedule(sched_id: int, request: Request):
    body = await request.json()
    sched = await schedule_store.update(sched_id, body)
    if sched:
        return sched
    return JSONResponse({"error": "not found"}, 404)


@app.delete("/api/schedules/{sched_id}")
async def delete_schedule(sched_id: int):
    ok = await schedule_store.delete(sched_id)
    return {"ok": ok}


# ── Sessions ───────────────────────────────────────────────────────────

@app.get("/api/session-templates")
async def get_session_templates():
    return {"templates": session_manager.get_templates()}


@app.post("/api/session-templates")
async def save_session_template(request: Request):
    body = await request.json()
    template = session_manager.save_template(body)
    return template


@app.delete("/api/session-templates/{tpl_id}")
async def delete_session_template(tpl_id: str):
    ok = session_manager.delete_template(tpl_id)
    return {"ok": ok}


@app.get("/api/sessions/{channel}")
async def get_session(channel: str):
    session = session_manager.get_session(channel)
    return {"session": session}


@app.post("/api/sessions/{channel}/start")
async def start_session(channel: str, request: Request):
    body = await request.json()
    template_id = body.get("template_id")
    cast = body.get("cast", {})
    topic = body.get("topic", "")
    if not template_id:
        return JSONResponse({"error": "template_id required"}, 400)
    try:
        session = session_manager.start_session(channel, template_id, cast, topic)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, 404)
    # Broadcast session start as system message
    phase = session["phases"][0] if session["phases"] else {}
    msg_text = f"Session started: **{session['template_name']}**"
    if topic:
        msg_text += f" — {topic}"
    await store.add("system", msg_text, "system", channel)
    if phase:
        await store.add("system", f"**Phase 1: {phase['name']}** — {phase.get('prompt', '')}", "system", channel)
    await broadcast("session_update", {"channel": channel, "session": session})
    return session


@app.post("/api/sessions/{channel}/advance")
async def advance_session(channel: str):
    prev = session_manager.get_session(channel)
    if not prev:
        return JSONResponse({"error": "no active session"}, 404)
    prev_phase = prev["current_phase"]
    session = session_manager.advance_turn(channel)
    if session and session["status"] == "completed":
        await store.add("system", f"Session completed: **{session['template_name']}**", "system", channel)
    elif session and session["current_phase"] != prev_phase and session["current_phase"] < len(session.get("phases", [])):
        phase = session["phases"][session["current_phase"]]
        await store.add("system", f"**Phase {session['current_phase'] + 1}: {phase['name']}** — {phase.get('prompt', '')}", "system", channel)
    await broadcast("session_update", {"channel": channel, "session": session})
    return {"session": session}


@app.post("/api/sessions/{channel}/end")
async def end_session(channel: str):
    session = session_manager.end_session(channel)
    if session:
        await store.add("system", f"Session ended: **{session['template_name']}**", "system", channel)
        await broadcast("session_update", {"channel": channel, "session": session})
    return {"session": session}


@app.post("/api/sessions/{channel}/pause")
async def pause_session(channel: str):
    session = session_manager.pause_session(channel)
    await broadcast("session_update", {"channel": channel, "session": session})
    return {"session": session}


@app.post("/api/sessions/{channel}/resume")
async def resume_session(channel: str):
    session = session_manager.resume_session(channel)
    await broadcast("session_update", {"channel": channel, "session": session})
    return {"session": session}


@app.get("/api/sessions/{channel}/prompt")
async def get_session_prompt(channel: str):
    prompt = session_manager.get_current_prompt(channel)
    return {"prompt": prompt}


# ── Activity ──────────────────────────────────────────────────────────

_activity_log: list[dict] = []

@app.get("/api/activity")
async def get_activity(limit: int = 50):
    return {"events": _activity_log[-limit:]}


# ── Server Logs ──────────────────────────────────────────────────────

_server_logs: list[dict] = []
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
            _server_logs.append(entry)
            if len(_server_logs) > _MAX_LOG_ENTRIES:
                _server_logs.pop(0)
        except Exception:
            pass


# Attach log handler
_ui_handler = _UILogHandler()
_ui_handler.setLevel(logging.DEBUG)
_ui_handler.setFormatter(logging.Formatter("%(message)s"))
logging.getLogger().addHandler(_ui_handler)
logging.getLogger("uvicorn.access").addHandler(_ui_handler)


@app.get("/api/logs")
async def get_server_logs(limit: int = 100, level: str = ""):
    """Get recent server log entries for the UI log viewer."""
    logs = list(_server_logs)
    if level:
        logs = [l for l in logs if l["level"] == level.upper()]
    return {"logs": logs[-limit:]}


# ── Server Config (read-only view for UI) ──────────────────────────

@app.get("/api/server-config")
async def get_server_config():
    """Return current server configuration for the UI config viewer."""
    return {
        "server": {
            "port": PORT,
            "host": HOST,
            "data_dir": str(DATA_DIR),
            "static_dir": str(STATIC_DIR),
            "upload_dir": str(UPLOAD_DIR),
            "max_upload_mb": MAX_SIZE_MB,
        },
        "routing": {
            "default": router.default_routing,
            "max_hops": router.max_hops,
        },
        "mcp": {
            "http_port": mcp_bridge.MCP_HTTP_PORT,
            "sse_port": mcp_bridge.MCP_SSE_PORT,
        },
        "uptime": time.time() - _settings.get("_server_start", time.time()),
        "agents_online": len([i for i in registry.get_all() if i.state in ("active", "thinking")]),
        "total_messages": 0,  # Would need a count query
    }


# ── Usage tracking ───────────────────────────────────────────────────

_usage: dict[str, int] = {}  # agent -> token count

@app.get("/api/usage")
async def get_usage():
    total = sum(_usage.values())
    # Rough cost estimate: $3 per 1M tokens average
    return {"total_tokens": total, "by_agent": dict(_usage), "estimated_cost": (total / 1_000_000) * 3}


@app.post("/api/usage")
async def report_usage(request: Request):
    body = await request.json()
    agent = body.get("agent", "unknown")
    tokens = body.get("tokens", 0)
    _usage[agent] = _usage.get(agent, 0) + tokens
    return {"ok": True, "agent": agent, "total": _usage[agent]}


# ── URL Preview (OpenGraph) ──────────────────────────────────────────

import urllib.request as _urllib_request
import html.parser as _html_parser

class _OGParser(_html_parser.HTMLParser):
    """Extract OpenGraph meta tags from HTML."""
    def __init__(self):
        super().__init__()
        self.og: dict[str, str] = {}
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        if tag == "meta":
            d = dict(attrs)
            prop = d.get("property", "")
            name = d.get("name", "")
            content = d.get("content", "")
            if prop.startswith("og:"):
                self.og[prop[3:]] = content
            elif name == "description" and "description" not in self.og:
                self.og["description"] = content

    def handle_data(self, data):
        if self._in_title:
            self.title += data

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False


def _is_private_url(url: str) -> bool:
    """Block requests to private/internal IP ranges to prevent SSRF."""
    from urllib.parse import urlparse
    import ipaddress
    try:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        # Block obvious internal hostnames
        if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"):
            return True
        if host.endswith(".local") or host.endswith(".internal"):
            return True
        # Try to resolve and check IP range
        try:
            import socket
            ip = socket.gethostbyname(host)
            addr = ipaddress.ip_address(ip)
            if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
                return True
        except (socket.gaierror, ValueError):
            pass
    except Exception:
        return True
    return False


@app.get("/api/preview")
async def url_preview(url: str = ""):
    """Fetch OpenGraph metadata for a URL. Returns title, description, image, site_name."""
    if not url or not url.startswith("https://") and not url.startswith("http://"):
        return JSONResponse({"error": "valid http(s) URL required"}, 400)
    if _is_private_url(url):
        return JSONResponse({"error": "cannot fetch internal/private URLs"}, 400)
    try:
        # Disable redirect following to prevent SSRF bypass
        class _NoRedirect(_urllib_request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        opener = _urllib_request.build_opener(_NoRedirect)
        req = _urllib_request.Request(url, headers={"User-Agent": "GhostLink/1.0"})
        with opener.open(req, timeout=5) as resp:
            raw = resp.read(51200)
            html_text = raw.decode("utf-8", errors="replace")
        parser = _OGParser()
        parser.feed(html_text)
        return {
            "url": url,
            "title": parser.og.get("title", parser.title.strip()),
            "description": parser.og.get("description", ""),
            "image": parser.og.get("image", ""),
            "site_name": parser.og.get("site_name", ""),
        }
    except Exception:
        return JSONResponse({"error": "failed to fetch URL"}, 500)


# ── Webhooks ─────────────────────────────────────────────────────────

_webhooks: list[dict] = []

@app.get("/api/webhooks")
async def list_webhooks():
    return {"webhooks": _webhooks}


@app.post("/api/webhooks")
async def create_webhook(request: Request):
    body = await request.json()
    url = (body.get("url", "") or "").strip()
    if not url or not url.startswith(("http://", "https://")):
        return JSONResponse({"error": "valid http/https URL required"}, 400)
    events = body.get("events", [])
    if not isinstance(events, list):
        events = []
    wh = {
        "id": f"wh-{int(time.time())}",
        "url": url,
        "events": [str(e) for e in events],
        "active": True,
        "created_at": time.time(),
    }
    _webhooks.append(wh)
    return wh


@app.post("/api/webhook/{wh_id}")
async def update_webhook(wh_id: str, request: Request):
    body = await request.json()
    _ALLOWED_WH_KEYS = {"url", "events", "active"}
    for wh in _webhooks:
        if wh["id"] == wh_id:
            for k, v in body.items():
                if k in _ALLOWED_WH_KEYS:
                    if k == "url" and not str(v).startswith(("http://", "https://")):
                        return JSONResponse({"error": "valid http/https URL required"}, 400)
                    wh[k] = v
            return wh
    return JSONResponse({"error": "not found"}, 404)


@app.delete("/api/webhook/{wh_id}")
async def delete_webhook(wh_id: str):
    global _webhooks
    before = len(_webhooks)
    _webhooks = [w for w in _webhooks if w["id"] != wh_id]
    return {"ok": len(_webhooks) < before}


# ── Security — Secrets, Exec Policy, Audit, GDPR ────────────────────

@app.get("/api/security/secrets")
async def list_secrets():
    """List stored secret keys (values redacted)."""
    return {"secrets": secrets_manager.list_keys()}


@app.post("/api/security/secrets")
async def set_secret(request: Request):
    """Store a secret (API key, token, etc.)."""
    body = await request.json()
    key = (body.get("key", "") or "").strip()
    value = (body.get("value", "") or "").strip()
    if not key or not value:
        return JSONResponse({"error": "key and value required"}, 400)
    if len(key) > 100 or len(value) > 10000:
        return JSONResponse({"error": "key max 100 chars, value max 10000 chars"}, 400)
    secrets_manager.set(key, value)
    audit_log.log("secret_set", {"key": key}, actor="user")
    return {"ok": True, "key": key}


@app.delete("/api/security/secrets/{key}")
async def delete_secret(key: str):
    ok = secrets_manager.delete(key)
    if ok:
        audit_log.log("secret_delete", {"key": key}, actor="user")
    return {"ok": ok}


@app.get("/api/security/exec-policies")
async def list_exec_policies():
    return {"policies": exec_policy.list_policies()}


@app.get("/api/security/exec-policy/{agent_name}")
async def get_exec_policy(agent_name: str):
    return {"policy": exec_policy.get_policy(agent_name)}


@app.post("/api/security/exec-policy/{agent_name}")
async def set_exec_policy(agent_name: str, request: Request):
    body = await request.json()
    policy = exec_policy.set_policy(agent_name, body)
    audit_log.log("exec_policy_update", {"agent": agent_name}, actor="user")
    return {"ok": True, "policy": policy}


@app.post("/api/security/check-command")
async def check_command(request: Request):
    """Check if a command would be allowed for an agent."""
    body = await request.json()
    agent = body.get("agent", "")
    command = body.get("command", "")
    if not command:
        return JSONResponse({"error": "command required"}, 400)
    result = exec_policy.check_command(agent, command)
    return result


@app.get("/api/security/audit-log")
async def get_audit_log(limit: int = 100, event_type: str = ""):
    return {"entries": audit_log.get_recent(limit, event_type)}


@app.get("/api/security/retention")
async def get_retention():
    return {"policy": data_manager.get_retention()}


@app.post("/api/security/retention")
async def set_retention(request: Request):
    body = await request.json()
    data_manager.save_retention(body)
    audit_log.log("retention_update", body, actor="user")
    return {"ok": True, "policy": data_manager.get_retention()}


@app.get("/api/security/export")
async def export_data():
    """Export all user data as ZIP (GDPR data portability)."""
    from fastapi.responses import Response
    zip_bytes = await data_manager.export_all_data()
    audit_log.log("data_export", {"size": len(zip_bytes)}, actor="user")
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=ghostlink-export.zip"},
    )


@app.post("/api/security/delete-all")
async def delete_all_data(request: Request):
    """Delete all user data (GDPR right to erasure). Requires confirmation."""
    body = await request.json()
    if body.get("confirm") != "DELETE_ALL_DATA":
        return JSONResponse({"error": "Send {confirm: 'DELETE_ALL_DATA'} to confirm"}, 400)
    result = await data_manager.delete_all_data()
    return result


@app.post("/api/security/apply-retention")
async def apply_retention():
    """Apply retention policy — delete old messages."""
    result = await data_manager.apply_retention()
    if result.get("ok"):
        audit_log.log("retention_applied", result, actor="system")
    return result


# ── GhostHub Marketplace ─────────────────────────────────────────────

@app.get("/api/marketplace")
async def browse_marketplace(category: str = "", search: str = ""):
    """Browse available plugins in the GhostHub marketplace."""
    plugins = marketplace.browse(category, search)
    categories = marketplace.get_categories()
    return {"plugins": plugins, "categories": categories}


@app.post("/api/marketplace/{plugin_id}/install")
async def install_marketplace_plugin(plugin_id: str):
    """Install a plugin from the GhostHub marketplace."""
    result = marketplace.install(plugin_id)
    if result.get("ok"):
        return result
    return JSONResponse(result, 400)


@app.post("/api/marketplace/{plugin_id}/uninstall")
async def uninstall_marketplace_plugin(plugin_id: str):
    """Uninstall a marketplace plugin."""
    result = marketplace.uninstall(plugin_id)
    return result


@app.post("/api/plugins/scan")
async def scan_plugin_code(request: Request):
    """Scan plugin code for safety issues (AST-based analysis)."""
    body = await request.json()
    code = body.get("code", "")
    if not code:
        return JSONResponse({"error": "code required"}, 400)
    issues = SafetyScanner.scan(code)
    return {"issues": issues, "safe": len([i for i in issues if i["severity"] == "critical"]) == 0}


# ── Skill Packs ──────────────────────────────────────────────────────

@app.get("/api/skill-packs")
async def list_skill_packs():
    """List available skill packs."""
    return {"packs": SKILL_PACKS}


@app.post("/api/skill-packs/{pack_id}/apply")
async def apply_skill_pack(pack_id: str, request: Request):
    """Apply a skill pack to an agent — enables all skills in the pack."""
    body = await request.json()
    agent_name = body.get("agent", "")
    if not agent_name:
        return JSONResponse({"error": "agent name required"}, 400)

    pack = next((p for p in SKILL_PACKS if p["id"] == pack_id), None)
    if not pack:
        return JSONResponse({"error": "skill pack not found"}, 404)

    for skill_id in pack["skills"]:
        skills_registry.enable_skill(agent_name, skill_id)

    return {"ok": True, "agent": agent_name, "pack": pack_id, "skills_enabled": pack["skills"]}


# ── Hooks (Event-Driven Automation) ─────────────────────────────────

@app.get("/api/hooks")
async def list_hooks():
    """List all automation hooks."""
    return {"hooks": hook_manager.list_hooks(), "events": EVENTS}


@app.post("/api/hooks")
async def create_hook(request: Request):
    """Create a new automation hook."""
    body = await request.json()
    name = body.get("name", "").strip()
    event = body.get("event", "").strip()
    action = body.get("action", "message").strip()
    config = body.get("config", {})

    if not name or not event:
        return JSONResponse({"error": "name and event required"}, 400)
    if action not in ("message", "notify", "trigger"):
        return JSONResponse({"error": f"Invalid action: {action}. Must be message, notify, or trigger"}, 400)

    result = hook_manager.create_hook(name, event, action, config)
    if result.get("ok"):
        return result
    return JSONResponse(result, 400)


@app.patch("/api/hooks/{hook_id}")
async def update_hook(hook_id: str, request: Request):
    """Update an automation hook."""
    body = await request.json()
    result = hook_manager.update_hook(hook_id, body)
    if result.get("ok"):
        return result
    return JSONResponse(result, 404)


@app.delete("/api/hooks/{hook_id}")
async def delete_hook(hook_id: str):
    """Delete an automation hook."""
    result = hook_manager.delete_hook(hook_id)
    return result


# ── Channel Bridges (Discord, Telegram, Slack, WhatsApp, Webhook) ────

@app.get("/api/bridges")
async def list_bridges():
    """Get all bridge configurations and status."""
    return {"bridges": bridge_manager.get_all()}


@app.post("/api/bridges/{platform}/configure")
async def configure_bridge(platform: str, request: Request):
    """Configure a channel bridge."""
    body = await request.json()
    if platform not in ("discord", "telegram", "slack", "whatsapp", "webhook"):
        return JSONResponse({"error": "unknown platform"}, 400)
    result = bridge_manager.configure(platform, body)
    return result


@app.post("/api/bridges/{platform}/start")
async def start_bridge(platform: str):
    """Start a configured bridge."""
    result = bridge_manager.start_bridge(platform)
    if result.get("ok"):
        return result
    return JSONResponse(result, 400)


@app.post("/api/bridges/{platform}/stop")
async def stop_bridge(platform: str):
    """Stop a running bridge."""
    result = bridge_manager.stop_bridge(platform)
    return result


@app.post("/api/bridges/inbound")
async def bridge_inbound(request: Request):
    """Receive messages from external platforms via webhook."""
    body = await request.json()
    sender = body.get("sender", "external")
    text = body.get("text", "")
    channel = body.get("channel", "general")
    platform = body.get("platform", "webhook")

    # Validate platform to prevent spoofing
    _VALID_PLATFORMS = {"discord", "telegram", "slack", "whatsapp", "webhook"}
    if platform not in _VALID_PLATFORMS:
        return JSONResponse({"error": "invalid platform"}, 400)
    # Sanitize sender name
    sender = sender[:50].replace(":", "_") if sender else "external"

    if not text.strip():
        return JSONResponse({"error": "text required"}, 400)

    # Verify webhook secret if configured
    cfg = bridge_manager.get_config("webhook")
    secret = cfg.get("secret", "")
    if secret:
        import hashlib, hmac
        sig = request.headers.get("X-GhostLink-Signature", "")
        raw = await request.body()
        expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return JSONResponse({"error": "invalid signature"}, 403)

    msg = await store.add(
        sender=f"{platform}:{sender}",
        text=text,
        channel=channel,
    )
    _route_mentions(f"{platform}:{sender}", text, channel)
    return msg


# ── Inbound Webhooks (external triggers) ─────────────────────────────

@app.post("/api/trigger")
async def inbound_trigger(request: Request):
    """External services can POST here to trigger agents or send messages.

    Body: {
        "text": "Deploy completed for v1.3.0",     # Message text (required)
        "agent": "claude",                          # Agent to @mention (optional)
        "channel": "general",                       # Target channel (default: general)
        "source": "github-actions",                 # Source label (optional)
        "event": "deploy",                          # Event type label (optional)
    }
    """
    body = await request.json()
    text = body.get("text", "").strip()
    if not text:
        return JSONResponse({"error": "text is required"}, 400)

    agent = body.get("agent", "").strip()
    channel = body.get("channel", "general").strip()
    source = body.get("source", "webhook").strip()
    event_type = body.get("event", "trigger").strip()

    # Build message with @mention if agent specified
    if agent:
        msg_text = f"@{agent} [{source}/{event_type}] {text}"
    else:
        msg_text = f"[{source}/{event_type}] {text}"

    msg = await store.add(sender="system", text=msg_text, msg_type="system", channel=channel)
    await broadcast("message", msg)

    # Route to mentioned agent
    if agent:
        _route_mentions("system", msg_text, channel)

    return {"ok": True, "message_id": msg.get("id"), "routed_to": agent or None}


@app.post("/api/trigger/{agent_name}")
async def trigger_agent(agent_name: str, request: Request):
    """Directly trigger a specific agent with a message.

    Body: {
        "text": "Check the latest PR",             # Message/task text
        "channel": "general",                       # Channel (default: general)
    }
    """
    body = await request.json()
    text = body.get("text", "").strip()
    channel = body.get("channel", "general").strip()

    if not text:
        return JSONResponse({"error": "text is required"}, 400)

    inst = registry.get(agent_name)
    if not inst:
        return JSONResponse({"error": f"agent '{agent_name}' not found"}, 404)

    msg_text = f"@{agent_name} {text}"
    msg = await store.add(sender="system", text=msg_text, msg_type="system", channel=channel)
    await broadcast("message", msg)
    _route_mentions("system", msg_text, channel)

    return {"ok": True, "message_id": msg.get("id"), "agent": agent_name}


# ── Providers ────────────────────────────────────────────────────────

@app.get("/api/providers")
async def get_providers():
    """Get all available providers, capabilities, and free options."""
    return provider_registry.get_provider_status()


@app.post("/api/providers/configure")
async def configure_provider(request: Request):
    """Set API key or preference for a provider.

    Body: {
        "provider": "groq",
        "api_key": "gsk_...",            // Optional: set API key
        "preferred_for": "chat",          // Optional: set as preferred for capability
    }
    """
    body = await request.json()
    pid = body.get("provider", "").strip()
    if not pid:
        return JSONResponse({"error": "provider required"}, 400)

    from providers import PROVIDERS, CAPABILITY_PRIORITY
    if pid not in PROVIDERS:
        return JSONResponse({"error": f"unknown provider: {pid}"}, 400)

    config_updates = {}
    if "api_key" in body:
        api_key = str(body["api_key"]).strip()
        config_updates[f"{pid}_api_key"] = api_key
    if "preferred_for" in body:
        capability = str(body["preferred_for"]).strip()
        if capability not in CAPABILITY_PRIORITY:
            return JSONResponse({"error": f"unknown capability: {capability}"}, 400)
        config_updates[f"preferred_{capability}"] = pid

    provider_registry.save_config(config_updates)
    return {"ok": True, "status": provider_registry.get_provider_status()}


@app.post("/api/providers/{provider_id}/test")
async def test_provider_key(provider_id: str):
    """Test if the configured API key for a provider works."""
    import urllib.request, urllib.error
    from providers import PROVIDERS
    pdef = PROVIDERS.get(provider_id)
    if not pdef:
        return JSONResponse({"error": "unknown provider"}, 404)
    key = provider_registry.get_api_key(provider_id)
    if not key:
        return JSONResponse({"error": "no API key configured"}, 400)

    # Quick validation request per provider
    test_urls = {
        "anthropic": ("https://api.anthropic.com/v1/messages", {"x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}),
        "openai": ("https://api.openai.com/v1/models", {"Authorization": f"Bearer {key}"}),
        "google": ("https://generativelanguage.googleapis.com/v1beta/models", {"x-goog-api-key": key}),
        "xai": ("https://api.x.ai/v1/models", {"Authorization": f"Bearer {key}"}),
        "groq": ("https://api.groq.com/openai/v1/models", {"Authorization": f"Bearer {key}"}),
        "together": ("https://api.together.xyz/v1/models", {"Authorization": f"Bearer {key}"}),
        "huggingface": ("https://huggingface.co/api/whoami-v2", {"Authorization": f"Bearer {key}"}),
    }

    if provider_id not in test_urls:
        return {"ok": True, "message": "Key saved (no test available for this provider)"}

    url, headers = test_urls[provider_id]
    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                return {"ok": True, "message": "API key verified"}
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return JSONResponse({"error": "Invalid API key — authentication failed"}, 401)
        return {"ok": True, "message": f"Key accepted (status {e.code})"}
    except Exception as e:
        log.warning("Provider test failed for %s: %s", provider_id, e)
        return JSONResponse({"error": "Connection failed — check your network and try again"}, 500)

    return {"ok": True, "message": "Key appears valid"}


@app.get("/api/providers/{provider_id}/models")
async def get_provider_models(provider_id: str):
    """Get available models for a specific provider."""
    from providers import PROVIDERS
    pdef = PROVIDERS.get(provider_id)
    if not pdef:
        return JSONResponse({"error": "unknown provider"}, 404)
    has_key = provider_registry.get_api_key(provider_id) is not None
    return {
        "provider": provider_id,
        "name": pdef["name"],
        "available": has_key or pdef.get("local", False),
        "models": pdef["models"],
        "capabilities": pdef["capabilities"],
    }


@app.get("/api/providers/resolve/{capability}")
async def resolve_provider(capability: str):
    """Find the best available provider for a capability (chat, image, video, tts, stt, etc.)."""
    result = provider_registry.resolve_capability(capability)
    if result:
        return result
    return JSONResponse({"error": f"no provider available for '{capability}'"}, 404)


# ── Export ───────────────────────────────────────────────────────────

@app.get("/api/export")
async def export_channel(channel: str = "general", format: str = "markdown"):
    if store._db is None:
        raise RuntimeError("Database not initialized. Call init() first.")
    cursor = await store._db.execute(
        "SELECT * FROM messages WHERE channel = ? ORDER BY id ASC",
        [channel],
    )
    rows = await cursor.fetchall()
    msgs = [store._row_to_dict(r) for r in rows]

    import html as _html

    if format == "json":
        return {"messages": msgs, "channel": channel, "count": len(msgs)}
    elif format == "html":
        ch_escaped = _html.escape(channel)
        html_lines = [f"<html><head><title>#{ch_escaped}</title></head><body style='background:#09090f;color:#e0dff0;font-family:sans-serif;padding:2rem'>"]
        html_lines.append(f"<h1>#{ch_escaped}</h1>")
        for m in msgs:
            color = "#38bdf8" if m.get("type") == "chat" and m["sender"] not in [a.name for a in registry.get_all()] else "#a78bfa"
            sender_escaped = _html.escape(m["sender"])
            text_escaped = _html.escape(m["text"])
            time_escaped = _html.escape(m.get("time", ""))
            html_lines.append(f"<div style='margin:1rem 0;padding:0.75rem;border-radius:8px;background:rgba(255,255,255,0.03)'><b style='color:{color}'>{sender_escaped}</b> <small style='color:#666'>{time_escaped}</small><p>{text_escaped}</p></div>")
        html_lines.append("</body></html>")
        return {"html": "\n".join(html_lines), "filename": f"{channel}-export.html"}
    else:
        md_lines = [f"# #{channel}\n"]
        for m in msgs:
            md_lines.append(f"**{m['sender']}** ({m.get('time', '')})\n{m['text']}\n---")
        md = "\n\n".join(md_lines)
        return {"markdown": md, "filename": f"{channel}-export.md"}


@app.get("/api/share")
async def share_conversation(channel: str = "general"):
    """Generate a self-contained shareable HTML page for a conversation."""
    if store._db is None:
        raise RuntimeError("Database not initialized.")
    cursor = await store._db.execute(
        "SELECT * FROM messages WHERE channel = ? ORDER BY id ASC", [channel],
    )
    rows = await cursor.fetchall()
    msgs = [store._row_to_dict(r) for r in rows]
    agent_colors = {inst.name: inst.color for inst in registry.get_all()}

    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GhostLink — #{channel}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#09090f;color:#e0dff0;font-family:'Inter',system-ui,sans-serif;padding:2rem;max-width:800px;margin:0 auto}}
h1{{font-size:1.5rem;margin-bottom:1.5rem;color:#a78bfa}}
.msg{{margin:0.75rem 0;padding:1rem;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05)}}
.sender{{font-weight:700;font-size:0.875rem;margin-bottom:0.25rem}}
.time{{color:#666;font-size:0.75rem;margin-left:0.5rem;font-weight:400}}
.text{{font-size:0.875rem;line-height:1.6;white-space:pre-wrap;word-wrap:break-word}}
.footer{{margin-top:2rem;text-align:center;color:#444;font-size:0.75rem}}
pre{{background:rgba(0,0,0,0.3);padding:0.75rem;border-radius:8px;overflow-x:auto;font-size:0.8rem}}
code{{font-family:'JetBrains Mono',monospace}}
</style></head><body>
<h1>#{channel}</h1>
"""

    for m in msgs:
        color = agent_colors.get(m["sender"], "#38bdf8")
        text_escaped = (m["text"]
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;"))
        html += f'<div class="msg"><div class="sender" style="color:{color}">{m["sender"]}<span class="time">{m.get("time","")}</span></div><div class="text">{text_escaped}</div></div>\n'

    html += f'<div class="footer">Exported from GhostLink — {len(msgs)} messages</div></body></html>'

    return {"html": html, "filename": f"{channel}-share.html", "message_count": len(msgs)}


# ── Hierarchy ────────────────────────────────────────────────────────

@app.get("/api/hierarchy")
async def get_hierarchy():
    agents = _get_full_agent_list()
    tree: dict[str, list[str]] = {}
    for a in agents:
        role = a.get("role")
        parent = a.get("parent")
        if role == "manager":
            tree.setdefault(a["name"], [])
        if parent:
            tree.setdefault(parent, []).append(a["name"])
    return {"agents": agents, "tree": tree}


# ── Agent soul, notes, health, config, memories ──────────────────────

from agent_memory import AgentMemory, get_agent_memory, get_soul, set_soul, get_notes, set_notes

_agent_dir = DATA_DIR / "agents"


@app.get("/api/agents/{name}/soul")
async def api_get_soul(name: str):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    return {"soul": get_soul(_agent_dir, name)}


@app.post("/api/agents/{name}/soul")
async def api_set_soul(name: str, request: Request):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    body = await request.json()
    set_soul(_agent_dir, name, body.get("content", ""))
    return {"ok": True}


@app.get("/api/agents/{name}/notes")
async def api_get_notes(name: str):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    return {"notes": get_notes(_agent_dir, name)}


@app.post("/api/agents/{name}/notes")
async def api_set_notes(name: str, request: Request):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    body = await request.json()
    set_notes(_agent_dir, name, body.get("content", ""))
    return {"ok": True}


@app.get("/api/agents/{name}/health")
async def agent_health(name: str):
    inst = registry.get(name)
    if not inst:
        return JSONResponse({"error": "not found", "healthy": False}, 404)
    is_alive = inst.state in ("active", "thinking", "idle", "paused")
    return {"name": name, "healthy": is_alive, "state": inst.state}


@app.get("/api/agents/{name}/config")
async def get_agent_config(name: str):
    inst = registry.get(name)
    if not inst:
        return JSONResponse({"error": "not found"}, 404)
    return {
        "name": inst.name,
        "base": inst.base,
        "label": inst.label,
        "color": inst.color,
        "workspace": getattr(inst, "workspace", None),
        "command": getattr(inst, "command", None),
        "args": getattr(inst, "args", []),
        "role": getattr(inst, "role", None),
        "responseMode": getattr(inst, "responseMode", "mentioned"),
        "thinkingLevel": getattr(inst, "thinkingLevel", ""),
        "model": getattr(inst, "model", ""),
        "failoverModel": getattr(inst, "failoverModel", ""),
        "autoApprove": getattr(inst, "autoApprove", False),
    }


@app.post("/api/agents/{name}/config")
async def set_agent_config(name: str, request: Request):
    inst = registry.get(name)
    if not inst:
        return JSONResponse({"error": "not found"}, 404)
    body = await request.json()
    _CONFIG_VALIDATORS = {
        "label": lambda v: isinstance(v, str) and 0 < len(v) <= 50,
        "color": lambda v: isinstance(v, str) and len(v) <= 20,
        "role": lambda v: isinstance(v, str) and v in ("", "manager", "worker", "peer"),
        "workspace": lambda v: isinstance(v, str) and len(v) <= 500,
        "responseMode": lambda v: isinstance(v, str) and v in ("mentioned", "always", "listen", "silent"),
        "thinkingLevel": lambda v: isinstance(v, str) and v in ("", "off", "minimal", "low", "medium", "high"),
        "model": lambda v: isinstance(v, str) and len(v) <= 100,
        "failoverModel": lambda v: isinstance(v, str) and len(v) <= 100,
        "autoApprove": lambda v: isinstance(v, bool),
    }
    for key, validator in _CONFIG_VALIDATORS.items():
        if key in body:
            if not validator(body[key]):
                return JSONResponse({"error": f"invalid value for {key}"}, 400)
            setattr(inst, key, body[key])
    if any(k in body for k in ("role", "responseMode", "thinkingLevel", "model", "autoApprove")):
        await broadcast("status", {"agents": _get_full_agent_list()})
    return {"ok": True}


@app.get("/api/agents/{name}/memories")
async def list_agent_memories(name: str):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    mem = get_agent_memory(_agent_dir, name)
    return {"memories": mem.list_all()}


@app.get("/api/agents/{name}/memories/{key}")
async def api_get_agent_memory(name: str, key: str):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    mem = get_agent_memory(_agent_dir, name)
    val = mem.load(key)
    if val is None:
        return JSONResponse({"error": "not found"}, 404)
    return {"key": key, "value": val}


@app.delete("/api/agents/{name}/memories/{key}")
async def api_delete_agent_memory(name: str, key: str):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    mem = get_agent_memory(_agent_dir, name)
    ok = mem.delete(key)
    return {"ok": ok}


# ── Plugins ───────────────────────────────────────────────────────

# Note: GET /api/plugins is defined in lifespan (line 470)


# ── Terminal Peek & Visible Terminal ──────────────────────────────

@app.post("/api/agents/{name}/terminal/open")
async def open_terminal(name: str):
    """Open a visible terminal window attached to the agent's tmux session."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    session_name = f"ghostlink-{name}"
    # Check if session exists
    try:
        result = subprocess.run(
            ["tmux", "has-session", "-t", session_name],
            capture_output=True, timeout=3,
        )
        if result.returncode != 0:
            return JSONResponse({"error": f"No active session for {name}"}, 404)
    except Exception:
        return JSONResponse({"error": "tmux not available"}, 500)

    # Open a new terminal window attached to the tmux session
    # On WSL: open Windows Terminal with wsl tmux attach
    # On native Linux/macOS: open a terminal emulator
    try:
        import shutil as _shutil
        # Try Windows Terminal (wt.exe) first
        wt = _shutil.which("wt.exe")
        if wt:
            subprocess.Popen(
                ["wt.exe", "wsl", "tmux", "attach-session", "-t", session_name],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            return {"ok": True, "method": "windows-terminal"}

        # Fallback: try cmd.exe
        cmd_exe = _shutil.which("cmd.exe")
        if cmd_exe:
            subprocess.Popen(
                [cmd_exe, "/c", "start", "wsl", "tmux", "attach-session", "-t", session_name],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            return {"ok": True, "method": "cmd"}

        # Native Linux/macOS: try common terminal emulators
        for term in ["gnome-terminal", "xterm", "konsole", "alacritty", "kitty"]:
            if _shutil.which(term):
                subprocess.Popen(
                    [term, "--", "tmux", "attach-session", "-t", session_name],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                return {"ok": True, "method": term}

        return JSONResponse({"error": "No terminal emulator found"}, 500)
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@app.get("/api/agents/{name}/terminal")
async def peek_terminal(name: str, lines: int = 30):
    """Capture the last N lines from an agent's tmux pane."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    session_name = f"ghostlink-{name}"
    try:
        result = subprocess.run(
            ["tmux", "capture-pane", "-t", session_name, "-p", "-S", f"-{lines}"],
            capture_output=True, text=True, timeout=3,
        )
        if result.returncode != 0:
            return {"name": name, "output": "", "active": False}
        return {"name": name, "output": result.stdout, "active": True}
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"name": name, "output": "", "active": False}


# ── Dashboard / Analytics ──────────────────────────────────────────

@app.get("/api/dashboard")
async def get_dashboard():
    """Aggregated dashboard data — messages, tokens, agents, activity."""
    if store._db is None:
        raise RuntimeError("Database not initialized.")

    # Message stats
    cursor = await store._db.execute("SELECT COUNT(*) as cnt FROM messages")
    total_msgs = (await cursor.fetchone())["cnt"]

    cursor = await store._db.execute(
        "SELECT channel, COUNT(*) as cnt FROM messages GROUP BY channel ORDER BY cnt DESC"
    )
    msgs_by_channel = {row["channel"]: row["cnt"] for row in await cursor.fetchall()}

    cursor = await store._db.execute(
        "SELECT sender, COUNT(*) as cnt FROM messages WHERE type = 'chat' GROUP BY sender ORDER BY cnt DESC LIMIT 10"
    )
    msgs_by_sender = {row["sender"]: row["cnt"] for row in await cursor.fetchall()}

    # Messages over time (last 24 hours, hourly buckets)
    day_ago = time.time() - 86400
    cursor = await store._db.execute(
        "SELECT CAST((timestamp - ?) / 3600 AS INTEGER) as hour, COUNT(*) as cnt "
        "FROM messages WHERE timestamp > ? GROUP BY hour ORDER BY hour",
        (day_ago, day_ago),
    )
    hourly = {row["hour"]: row["cnt"] for row in await cursor.fetchall()}

    # Agent stats
    agents = _get_full_agent_list()
    online = [a for a in agents if a.get("state") in ("active", "thinking")]

    # Token usage
    total_tokens = sum(_usage.values())

    return {
        "total_messages": total_msgs,
        "messages_by_channel": msgs_by_channel,
        "messages_by_sender": msgs_by_sender,
        "hourly_messages": hourly,
        "agents_total": len(agents),
        "agents_online": len(online),
        "total_tokens": total_tokens,
        "usage_by_agent": dict(_usage),
        "estimated_cost": (total_tokens / 1_000_000) * 3,
        "channels": len(_settings.get("channels", ["general"])),
        "uptime_seconds": time.time() - _settings.get("_server_start", time.time()),
    }


# ── Agent Feedback ─────────────────────────────────────────────────

@app.post("/api/agents/{name}/feedback")
async def agent_feedback(name: str, request: Request):
    """Record thumbs up/down feedback on an agent's message. Stores in agent memory for learning."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    body = await request.json()
    message_id = body.get("message_id", 0)
    rating = body.get("rating", "")  # "up" or "down"
    if rating not in ("up", "down"):
        return JSONResponse({"error": "rating must be 'up' or 'down'"}, 400)

    # Get the message text for context
    msg_text = ""
    if message_id and store._db:
        cursor = await store._db.execute("SELECT text FROM messages WHERE id = ?", (message_id,))
        row = await cursor.fetchone()
        if row:
            msg_text = row["text"][:200]  # Keep preview only

    # Store feedback in agent memory
    mem = get_agent_memory(_agent_dir, name)
    feedback_key = "_feedback"
    existing = mem.load(feedback_key)
    feedback_list = []
    if existing and isinstance(existing.get("content"), str):
        try:
            feedback_list = json.loads(existing["content"])
        except (json.JSONDecodeError, TypeError):
            feedback_list = []

    feedback_list.append({
        "message_id": message_id,
        "rating": rating,
        "preview": msg_text,
        "timestamp": time.time(),
    })
    # Keep last 50 feedback entries
    feedback_list = feedback_list[-50:]
    mem.save(feedback_key, json.dumps(feedback_list))

    # Update message reactions to show the feedback visually
    if message_id:
        emoji = "👍" if rating == "up" else "👎"
        await store.react(message_id, emoji, _settings.get("username", "You"))

    return {"ok": True, "agent": name, "rating": rating, "total_feedback": len(feedback_list)}


# ── Session Snapshots ──────────────────────────────────────────────

@app.get("/api/snapshot")
async def export_snapshot():
    """Export the entire session state as a JSON snapshot (agents, channels, settings, messages)."""
    if store._db is None:
        raise RuntimeError("Database not initialized.")
    # Get all messages across all channels
    cursor = await store._db.execute("SELECT * FROM messages ORDER BY id ASC")
    rows = await cursor.fetchall()
    msgs = [store._row_to_dict(r) for r in rows]
    # Get jobs
    jobs = await job_store.list_jobs()
    # Get rules
    rules = await rule_store.list_all()
    return {
        "version": "1.0.0",
        "exported_at": time.time(),
        "settings": dict(_settings),
        "agents": _get_full_agent_list(),
        "channels": _settings.get("channels", ["general"]),
        "messages": msgs,
        "jobs": jobs,
        "rules": rules,
    }


@app.post("/api/snapshot/import")
async def import_snapshot(request: Request):
    """Import a session snapshot. Merges messages, replaces settings."""
    body = await request.json()
    imported_msgs = body.get("messages", [])
    imported_settings = body.get("settings", {})
    imported_channels = body.get("channels", [])

    # Merge settings (keep existing channels, merge the rest) with type validation
    _safe_validators = {
        "username": lambda v: isinstance(v, str) and len(v) <= 50,
        "theme": lambda v: isinstance(v, str) and v in ("dark", "light", "cyberpunk", "terminal", "ocean", "sunset", "midnight", "rosegold", "arctic"),
        "fontSize": lambda v: isinstance(v, (int, float)) and 8 <= v <= 32,
        "loopGuard": lambda v: isinstance(v, (int, float)) and 1 <= v <= 20,
        "notificationSounds": lambda v: isinstance(v, bool),
        "autoRoute": lambda v: isinstance(v, (str, bool)),
    }
    for k, validator in _safe_validators.items():
        if k in imported_settings and validator(imported_settings[k]):
            _settings[k] = imported_settings[k]

    # Merge channels
    existing = set(_settings.get("channels", ["general"]))
    for ch in imported_channels:
        existing.add(ch)
    _settings["channels"] = sorted(existing)
    _save_settings()

    # Import messages (skip duplicates by uid)
    if store._db is None:
        raise RuntimeError("Database not initialized.")
    cursor = await store._db.execute("SELECT uid FROM messages")
    existing_uids = {row["uid"] for row in await cursor.fetchall()}

    imported_count = 0
    for msg in imported_msgs:
        if msg.get("uid") and msg["uid"] not in existing_uids:
            await store.add(
                sender=msg.get("sender", "unknown"),
                text=msg.get("text", ""),
                msg_type=msg.get("type", "chat"),
                channel=msg.get("channel", "general"),
                uid=msg.get("uid", ""),
                metadata=json.dumps(msg.get("metadata", {})) if isinstance(msg.get("metadata"), dict) else str(msg.get("metadata", "{}")),
            )
            imported_count += 1

    await broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in _settings["channels"]]})
    return {"ok": True, "imported_messages": imported_count, "channels": _settings["channels"]}


# ── Message Templates ─────────────────────────────────────────────

_TEMPLATES_PATH = DATA_DIR / "templates.json"


def _load_templates() -> list[dict]:
    if _TEMPLATES_PATH.exists():
        try:
            return json.loads(_TEMPLATES_PATH.read_text("utf-8"))
        except Exception:
            return []
    return []


def _save_templates(templates: list[dict]):
    _TEMPLATES_PATH.write_text(json.dumps(templates, indent=2), "utf-8")


@app.get("/api/templates")
async def list_templates():
    return {"templates": _load_templates()}


@app.post("/api/templates")
async def create_template(request: Request):
    body = await request.json()
    name = (body.get("name", "") or "").strip()
    text = (body.get("text", "") or "").strip()
    if not name or not text:
        return JSONResponse({"error": "name and text required"}, 400)
    templates = _load_templates()
    template = {
        "id": f"tpl-{int(time.time())}",
        "name": name,
        "text": text,
        "category": (body.get("category", "") or "").strip(),
        "created_at": time.time(),
    }
    templates.append(template)
    _save_templates(templates)
    return template


@app.delete("/api/templates/{tpl_id}")
async def delete_template(tpl_id: str):
    templates = _load_templates()
    before = len(templates)
    templates = [t for t in templates if t.get("id") != tpl_id]
    _save_templates(templates)
    return {"ok": len(templates) < before}


# ── Agent DM Channels ─────────────────────────────────────────────

@app.post("/api/dm-channel")
async def create_dm_channel(request: Request):
    """Create or get a DM channel between two agents."""
    body = await request.json()
    agent1 = (body.get("agent1", "") or "").strip()
    agent2 = (body.get("agent2", "") or "").strip()
    if not agent1 or not agent2:
        return JSONResponse({"error": "agent1 and agent2 required"}, 400)
    # Deterministic channel name (sorted for consistency)
    pair = sorted([agent1, agent2])
    dm_name = f"dm-{pair[0]}-{pair[1]}"
    # Add to channels if not exists
    channels = _settings.get("channels", ["general"])
    if dm_name not in channels:
        channels.append(dm_name)
        _settings["channels"] = channels
        _save_settings()
        await broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in channels]})
    return {"channel": dm_name, "agents": pair}


# ── Cloudflare Tunnel (Remote Session) ──────────────────────────────

import asyncio as _asyncio
import re as _re

_tunnel_process: subprocess.Popen | None = None
_tunnel_url: str | None = None


@app.post("/api/tunnel/start")
async def tunnel_start():
    global _tunnel_process, _tunnel_url
    if _tunnel_process and _tunnel_process.poll() is None:
        return JSONResponse({"url": _tunnel_url, "pid": _tunnel_process.pid, "already": True})

    try:
        proc = subprocess.Popen(
            ["cloudflared", "tunnel", "--url", f"http://127.0.0.1:{PORT}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError:
        return JSONResponse({"error": "cloudflared not found. Install it first."}, 500)

    url_pattern = _re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
    found_url: str | None = None

    # cloudflared prints the URL to stderr — read in a thread to avoid blocking
    import threading, time

    lines_buf: list[str] = []

    def _read_stderr():
        assert proc.stderr
        for raw in proc.stderr:
            lines_buf.append(raw.decode("utf-8", errors="replace"))

    t = threading.Thread(target=_read_stderr, daemon=True)
    t.start()

    deadline = time.time() + 15
    while time.time() < deadline:
        for line in lines_buf:
            m = url_pattern.search(line)
            if m:
                found_url = m.group(0)
                break
        if found_url:
            break
        await _asyncio.sleep(0.3)

    if not found_url:
        proc.kill()
        stderr_text = "\n".join(lines_buf)
        return JSONResponse({"error": "Timed out waiting for tunnel URL", "stderr": stderr_text}, 500)

    _tunnel_process = proc
    _tunnel_url = found_url
    return {"url": found_url, "pid": proc.pid}


@app.post("/api/tunnel/stop")
async def tunnel_stop():
    global _tunnel_process, _tunnel_url
    if _tunnel_process:
        _tunnel_process.kill()
        _tunnel_process.wait()
        _tunnel_process = None
        _tunnel_url = None
    return {"ok": True}


@app.get("/api/tunnel/status")
async def tunnel_status():
    active = _tunnel_process is not None and _tunnel_process.poll() is None
    if not active:
        return {"active": False, "url": None}
    return {"active": True, "url": _tunnel_url}


# ── Serve uploads ───────────────────────────────────────────────────

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


# ── Serve frontend (SPA fallback) ──────────────────────────────────
# Always register the middleware — check STATIC_DIR at request time, not module load.

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
    print(f"GhostLink starting on http://{HOST}:{PORT}")
    uvicorn.run(
        "app:app",
        host=HOST,
        port=PORT,
        reload=False,
        log_level="info",
    )
