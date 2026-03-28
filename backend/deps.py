"""Shared application state — imported by route modules.
Set by app.py lifespan before any requests are served.
"""
from __future__ import annotations

import asyncio
import collections
import json
import logging
import subprocess
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from store import MessageStore
    from registry import AgentRegistry
    from router import MessageRouter
    from jobs import JobStore
    from rules import RuleStore
    from schedules import ScheduleStore
    from sessions import SessionManager
    from skills import SkillsRegistry
    from providers import ProviderRegistry
    from bridges import BridgeManager
    from plugin_sdk import Marketplace, HookManager
    from security import SecretsManager, ExecPolicy, AuditLog, DataManager

log = logging.getLogger(__name__)

# ── Core stores (set by lifespan in app.py) ─────────────────────────

store: "MessageStore | None" = None
registry: "AgentRegistry | None" = None
router_inst: "MessageRouter | None" = None
job_store: "JobStore | None" = None
rule_store: "RuleStore | None" = None
schedule_store: "ScheduleStore | None" = None
session_manager: "SessionManager | None" = None
skills_registry: "SkillsRegistry | None" = None
provider_registry: "ProviderRegistry | None" = None
bridge_manager: "BridgeManager | None" = None
marketplace: "Marketplace | None" = None
hook_manager: "HookManager | None" = None
secrets_manager: "SecretsManager | None" = None
exec_policy: "ExecPolicy | None" = None
audit_log: "AuditLog | None" = None
data_manager: "DataManager | None" = None
worktree_manager: "WorktreeManager | None" = None  # v3.6.0
automation_manager: "AutomationManager | None" = None  # v3.6.0
remote_runner: "RemoteRunner | None" = None  # v4.4.0
user_manager: "UserManager | None" = None  # v4.4.0
a2a_bridge: "A2ABridge | None" = None  # v4.4.0
autonomous_manager: "AutonomousManager | None" = None  # v4.5.0
memory_graph: "MemoryGraph | None" = None  # v4.5.0
specialization: "SpecializationEngine | None" = None  # v4.5.0
rag_pipeline: "RAGPipeline | None" = None  # v4.5.0

# ── Process tracking (set by spawn/register routes) ──────────────────

_agent_processes: dict[str, subprocess.Popen] = {}
_pending_spawns: dict[int, subprocess.Popen] = {}
_agent_lock = asyncio.Lock()
_last_heartbeats: dict[str, float] = {}
_AGENT_DETECTION_CACHE: dict[str, tuple[bool, float]] = {}
_AGENT_DETECTION_CACHE_TTL = 60.0

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

# ── Activity / server logs ───────────────────────────────────────────

_activity_log: collections.deque[dict] = collections.deque(maxlen=100)
_server_logs: collections.deque[dict] = collections.deque(maxlen=500)

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
    from urllib.parse import urlparse
    import ipaddress
    try:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"):
            return True
        if host.endswith(".local") or host.endswith(".internal"):
            return True
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


def _deliver_webhooks(event_type: str, data: dict):
    """Fire-and-forget POST to all matching active webhooks. Runs in background thread."""
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
        try:
            req = urllib.request.Request(
                url, data=payload, method="POST",
                headers={"Content-Type": "application/json", "User-Agent": "GhostLink-Webhook/1.0"},
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception as e:
            log.debug("Webhook delivery failed for %s: %s", wh["id"], e)
