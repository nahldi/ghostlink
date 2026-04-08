"""Shared application state — imported by route modules.
Set by app.py lifespan before any requests are served.
"""
from __future__ import annotations

import asyncio
import collections
import json
import logging
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

try:
    import psutil
except ImportError:
    psutil = None

if TYPE_CHECKING:
    import aiosqlite
    from a2a import A2AManager
    from auth import UserManager
    from automations import AutomationManager
    from autonomous import AutonomousManager
    from branches import BranchManager
    from bridges import BridgeManager
    from jobs import JobStore
    from memory_graph import MemoryGraph
    from observer import ObservationEngine
    from plugin_sdk import HookManager, Marketplace
    from policy import PolicyEngine
    from providers import ProviderRegistry
    from cost import CostTracker
    from evals import EvalEngine
    from rag import RAGPipeline
    from registry import AgentRegistry
    from remote_runner import RemoteRunner
    from router import MessageRouter
    from rules import RuleStore
    from schedules import ScheduleStore
    from audit_store import AuditStore
    from bg_executor import BackgroundExecutor
    from checkpoints import CheckpointStore
    from security import AuditLog, DataManager, ExecPolicy, SecretsManager
    from sessions import SessionManager
    from skills import SkillsRegistry
    from specialization import SpecializationEngine
    from store import MessageStore
    from task_store import TaskStore
    from worktree import WorktreeManager
    from transport import ProviderTransportManager

log = logging.getLogger(__name__)

# ── Core stores (set by lifespan in app.py) ─────────────────────────

store: MessageStore | None = None
registry: AgentRegistry | None = None
router_inst: MessageRouter | None = None
job_store: JobStore | None = None
rule_store: RuleStore | None = None
schedule_store: ScheduleStore | None = None
task_store: TaskStore | None = None
audit_store: AuditStore | None = None
checkpoint_store: CheckpointStore | None = None
policy_engine: PolicyEngine | None = None
session_manager: SessionManager | None = None
branch_manager: BranchManager | None = None
skills_registry: SkillsRegistry | None = None
provider_registry: ProviderRegistry | None = None
cost_tracker: CostTracker | None = None
transport_manager: ProviderTransportManager | None = None
eval_engine: EvalEngine | None = None
bridge_manager: BridgeManager | None = None
marketplace: Marketplace | None = None
hook_manager: HookManager | None = None
secrets_manager: SecretsManager | None = None
exec_policy: ExecPolicy | None = None
audit_log: AuditLog | None = None
data_manager: DataManager | None = None
worktree_manager: WorktreeManager | None = None  # v3.6.0
bg_executor: BackgroundExecutor | None = None  # v5.x
automation_manager: AutomationManager | None = None  # v3.6.0
remote_runner: RemoteRunner | None = None  # v4.4.0
user_manager: UserManager | None = None  # v4.4.0
a2a_bridge: A2AManager | None = None  # v4.4.0
autonomous_manager: AutonomousManager | None = None  # v4.5.0
memory_graph: MemoryGraph | None = None  # v4.5.0
specialization: SpecializationEngine | None = None  # v4.5.0
rag_pipeline: RAGPipeline | None = None  # v4.5.0
observer_engine: ObservationEngine | None = None  # v6.0.0
runtime_db: aiosqlite.Connection | None = None

# ── Process tracking (set by spawn/register routes) ──────────────────

_agent_processes: dict[str, subprocess.Popen] = {}
_pending_spawns: dict[int, subprocess.Popen] = {}
_agent_lock = asyncio.Lock()
_last_heartbeats: dict[str, float] = {}
_AGENT_DETECTION_CACHE: dict[str, tuple[bool, float]] = {}
_AGENT_DETECTION_CACHE_TTL = 60.0


@dataclass
class ProcessRecord:
    proc: subprocess.Popen
    pid: int
    created_at: float | None = None
    executable: str = ""
    command: tuple[str, ...] = ()
    owner: str = ""
    token: str = ""

    def __getattr__(self, item: str):
        return getattr(self.proc, item)


def _safe_cmdline(proc: Any) -> tuple[str, ...]:
    try:
        cmdline = proc.cmdline()
    except Exception:
        return ()
    return tuple(str(part) for part in cmdline if str(part).strip())


def capture_process_record(proc: subprocess.Popen, *, owner: str = "", token: str = "") -> ProcessRecord:
    created_at = None
    executable = ""
    command: tuple[str, ...] = ()
    if psutil is not None:
        try:
            live = psutil.Process(proc.pid)
            created_at = float(live.create_time())
            executable = str(live.exe() or "")
            command = _safe_cmdline(live)
        except Exception:
            pass
    return ProcessRecord(
        proc=proc,
        pid=int(proc.pid),
        created_at=created_at,
        executable=executable,
        command=command,
        owner=owner,
        token=token,
    )


def is_same_process(record: ProcessRecord | subprocess.Popen | None) -> bool:
    if record is None:
        return False
    if not isinstance(record, ProcessRecord):
        try:
            return record.poll() is None
        except Exception:
            return False
    try:
        if record.proc.poll() is not None:
            return False
    except Exception:
        return False
    if psutil is None:
        return True
    try:
        live = psutil.Process(record.pid)
    except Exception:
        return False
    try:
        if record.created_at is not None and abs(float(live.create_time()) - record.created_at) > 0.001:
            return False
        if record.executable:
            live_exe = str(live.exe() or "")
            if live_exe and live_exe != record.executable:
                return False
        if record.command:
            live_cmd = _safe_cmdline(live)
            if live_cmd and live_cmd != record.command:
                return False
    except Exception:
        return False
    return True


def _unwrap_process(record: ProcessRecord | subprocess.Popen | None) -> subprocess.Popen | None:
    if record is None:
        return None
    if isinstance(record, ProcessRecord):
        return record.proc
    return record


def snapshot_process_bookkeeping() -> dict[str, Any]:
    live_registry = {inst.name for inst in registry.get_all()} if registry else set()
    tracked_agents = set(_agent_processes.keys())
    stale_pending = []
    stale_agents = []
    for pid, record in _pending_spawns.items():
        if not is_same_process(record):
            stale_pending.append(pid)
    for name, record in _agent_processes.items():
        if not is_same_process(record):
            stale_agents.append(name)
    return {
        "tracked_agent_processes": len(_agent_processes),
        "tracked_pending_spawns": len(_pending_spawns),
        "registry_agents": len(live_registry),
        "registry_missing_processes": sorted(live_registry - tracked_agents),
        "orphaned_process_records": sorted(tracked_agents - live_registry),
        "stale_pending_pids": stale_pending,
        "stale_agent_records": stale_agents,
    }


def _finalize_process(proc: subprocess.Popen) -> None:
    try:
        proc.wait(timeout=0)
    except Exception:
        pass


async def reap_dead_agent_processes() -> list[str]:
    cleaned: list[str] = []

    async with _agent_lock:
        for pid, record in list(_pending_spawns.items()):
            try:
                if is_same_process(record):
                    continue
            except Exception as exc:
                log.debug("Pending spawn poll failed for pid %s: %s", pid, exc)
            _pending_spawns.pop(pid, None)
            proc = _unwrap_process(record)
            if proc is not None:
                _finalize_process(proc)
            cleaned.append(f"pending:{pid}")

        for name, record in list(_agent_processes.items()):
            try:
                if is_same_process(record):
                    continue
            except Exception as exc:
                log.debug("Agent process poll failed for %s: %s", name, exc)
            _agent_processes.pop(name, None)
            proc = _unwrap_process(record)
            if proc is not None:
                _finalize_process(proc)
            cleaned.append(f"process:{name}")

    return cleaned


async def watch_agent_process_exit(proc: subprocess.Popen, label: str = "") -> None:
    pid = getattr(proc, "pid", None)
    if pid is None:
        return

    try:
        exit_code = await asyncio.to_thread(proc.wait)
    except Exception as exc:
        log.debug("Process watcher failed for %s (pid %s): %s", label or "agent", pid, exc)
        return

    cleaned = await reap_dead_agent_processes()
    if cleaned:
        log.info(
            "Cleaned exited agent process %s (pid %s, exit %s): %s",
            label or "agent",
            pid,
            exit_code,
            ", ".join(cleaned),
        )

# ── WebSocket clients ────────────────────────────────────────────────

_ws_clients: set = set()
_ws_clients_lock = asyncio.Lock()

# ── Webhooks ─────────────────────────────────────────────────────────

_webhooks: list[dict] = []

# ── Settings ─────────────────────────────────────────────────────────

_settings: dict = {
    "username": "You",
    "title": "GhostLink",
    "theme": "dark",
    "fontSize": 14,
    "loopGuard": 4,
    "notificationSounds": True,
    "channels": ["general"],
}
_settings_lock = asyncio.Lock()

# ── Configuration (set during startup) ──────────────────────────────

DATA_DIR: Any = None
UPLOAD_DIR: Any = None
BASE_DIR: Any = None
STATIC_DIR: Any = None
CONFIG: dict = {}
MAX_HOPS: int = 4
PORT: int = 8300
HOST: str = "127.0.0.1"
MAX_SIZE_MB: int = 10
_ws_token: str = ""

# ── Usage tracking ───────────────────────────────────────────────────

_USAGE_LOG_MAX = 10000
_usage_log: list[dict] = []

# ── HTTP session ─────────────────────────────────────────────────────

_http_session: Any = None

# ── Main event loop reference (set in lifespan) ──────────────────────

_main_loop: Any = None

# ── Thinking buffers ─────────────────────────────────────────────────

_thinking_buffers: dict[str, dict] = {}  # agent_name → {text, updated_at, active}

# ── Tunnel state ─────────────────────────────────────────────────────

_tunnel_process: Any = None
_tunnel_url: Any = None
_tunnel_access_token: str = ""

# ── Activity / server logs ───────────────────────────────────────────

_activity_log: collections.deque[dict] = collections.deque(maxlen=100)
_server_logs: collections.deque[dict] = collections.deque(maxlen=500)
_agent_presence: dict[str, dict] = {}
_agent_browser_state: dict[str, dict] = {}
_terminal_streams: dict[str, dict] = {}
_mcp_invocation_logs: dict[str, collections.deque] = {}  # per-agent MCP invocation logs
_MCP_LOG_MAXLEN = 200  # max entries per agent
_MCP_LOG_MAX_AGENTS = 50  # max agents tracked
_workspace_changes: collections.deque[dict] = collections.deque(maxlen=500)
_agent_replay_log: collections.deque[dict] = collections.deque(maxlen=2000)
_file_diff_cache: dict[str, dict[str, dict]] = {}
_FILE_DIFF_MAX_PER_AGENT = 100  # max diffs cached per agent
_agent_state_lock = threading.Lock()
_workspace_collaborators: dict[str, dict] = {}
_workspace_ws_users: dict[int, str] = {}


def cleanup_agent_state(agent_name: str) -> None:
    """Remove all in-memory state for a deregistered agent.

    Call this when an agent is killed or deregistered to prevent
    unbounded growth of per-agent caches and presence data.
    """
    _agent_presence.pop(agent_name, None)
    _agent_browser_state.pop(agent_name, None)
    _terminal_streams.pop(agent_name, None)
    _mcp_invocation_logs.pop(agent_name, None)
    _file_diff_cache.pop(agent_name, None)
    _last_heartbeats.pop(agent_name, None)
    # _pending_spawns is keyed by PID, cleaned by reap_dead_agent_processes()


def get_or_create_mcp_log(agent_name: str) -> collections.deque:
    """Get (or create) a capped MCP invocation log for an agent."""
    if agent_name not in _mcp_invocation_logs:
        # Evict oldest agent if at capacity
        if len(_mcp_invocation_logs) >= _MCP_LOG_MAX_AGENTS:
            oldest = next(iter(_mcp_invocation_logs))
            del _mcp_invocation_logs[oldest]
        _mcp_invocation_logs[agent_name] = collections.deque(maxlen=_MCP_LOG_MAXLEN)
    return _mcp_invocation_logs[agent_name]


def set_file_diff(agent_name: str, path: str, diff: dict) -> None:
    """Cache a file diff for an agent, with per-agent cap."""
    if agent_name not in _file_diff_cache:
        _file_diff_cache[agent_name] = {}
    cache = _file_diff_cache[agent_name]
    if len(cache) >= _FILE_DIFF_MAX_PER_AGENT and path not in cache:
        # Remove oldest entry
        oldest_key = next(iter(cache))
        del cache[oldest_key]
    cache[path] = diff

# ── Agent name validation ────────────────────────────────────────────

import re as _re

_VALID_AGENT_NAME = _re.compile(r'^[a-zA-Z0-9_-]{1,50}$')


# ── WebSocket broadcast ──────────────────────────────────────────────

async def broadcast(event_type: str, data: dict):
    """Broadcast a JSON event to all connected WebSocket clients and webhooks."""
    payload = json.dumps({"type": event_type, "data": data})
    async with _ws_clients_lock:
        clients = list(_ws_clients)

    dead = []
    for ws in clients:
        try:
            await ws.send_text(payload)
        except Exception as e:
            log.debug("WebSocket send failed, removing client: %s", e)
            dead.append(ws)
    if dead:
        async with _ws_clients_lock:
            for ws in dead:
                _ws_clients.discard(ws)
    # Deliver to active webhooks (non-blocking)
    import threading as _th
    _th.Thread(target=_deliver_webhooks, args=(event_type, data), daemon=True).start()


def _is_private_url(url: str) -> bool:
    """Block requests to private/internal IP ranges to prevent SSRF."""
    import ipaddress
    import socket
    from urllib.parse import urlparse

    def _is_blocked_address(host_or_ip: str) -> bool:
        candidate = host_or_ip.strip().rstrip(".")
        if not candidate:
            return True

        if "%" in candidate:
            candidate = candidate.split("%", 1)[0]

        try:
            addr = ipaddress.ip_address(candidate)
            return (
                addr.is_private
                or addr.is_loopback
                or addr.is_link_local
                or addr.is_reserved
                or addr.is_multicast
                or addr.is_unspecified
            )
        except ValueError:
            pass

        try:
            infos = socket.getaddrinfo(candidate, None, proto=socket.IPPROTO_TCP)
        except socket.gaierror:
            return False

        for info in infos:
            sockaddr = info[4]
            if not sockaddr:
                continue
            resolved_ip = sockaddr[0]
            if _is_blocked_address(resolved_ip):
                return True
        return False

    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return True
        host = (parsed.hostname or "").strip().rstrip(".").lower()
        if not host:
            return True
        if host == "localhost":
            return True
        if host.endswith(".local") or host.endswith(".internal"):
            return True
        return _is_blocked_address(host)
    except Exception:
        return True


def _deliver_webhooks(event_type: str, data: dict):
    """Fire-and-forget POST to all matching active webhooks. Runs in background thread."""
    from policy import PolicyContext
    import urllib.request
    payload = json.dumps({"event": event_type, "data": data, "timestamp": time.time()}).encode()
    for wh in list(_webhooks):
        if not wh.get("active"):
            continue
        events = wh.get("events", [])
        if events and event_type not in events:
            continue
        url = wh.get("url", "")
        if not url or not url.startswith(("http://", "https://")):
            continue
        if _is_private_url(url):
            log.warning("Blocked webhook to private URL: %s", url)
            continue
        if policy_engine is not None:
            try:
                context = PolicyContext(
                    workspace_id=str(BASE_DIR or "*"),
                    domain="",
                    protocol="*",
                    port=0,
                    metadata={"webhook_id": wh.get("id", ""), "event_type": event_type},
                )
                verdict = asyncio.run(policy_engine.check_egress(url, context))
                if not verdict.get("allowed"):
                    log.warning("Blocked webhook by egress policy %s: %s", wh.get("id", ""), verdict.get("reason", "denied"))
                    continue
            except Exception as e:
                log.warning("Webhook policy evaluation failed for %s: %s", wh.get("id", ""), e)
                continue
        try:
            req = urllib.request.Request(
                url, data=payload, method="POST",
                headers={"Content-Type": "application/json", "User-Agent": "GhostLink-Webhook/1.0"},
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception as e:
            log.debug("Webhook delivery failed for %s: %s", wh["id"], e)
