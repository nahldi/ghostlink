"""GhostLink Plugin SDK — framework for building, distributing, and managing plugins.

Provides:
- Plugin lifecycle management (setup, teardown, events)
- GhostHub marketplace integration (browse, install, update)
- Skill Packs (curated bundles)
- Hook system (event-driven automation)
- Safety scanning (AST-based, not string matching)
"""

from __future__ import annotations

import ast
import json
import logging
import time
import threading
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger(__name__)


# ── Plugin Event System ──────────────────────────────────────────────

class EventBus:
    """Central event bus for plugin hooks and automation."""

    def __init__(self):
        self._handlers: dict[str, list[Callable]] = {}
        self._lock = threading.Lock()

    def on(self, event: str, handler: Callable):
        """Register a handler for an event (no duplicates)."""
        with self._lock:
            handlers = self._handlers.setdefault(event, [])
            if handler not in handlers:
                handlers.append(handler)

    def off(self, event: str, handler: Callable):
        """Remove a handler."""
        with self._lock:
            handlers = self._handlers.get(event, [])
            if handler in handlers:
                handlers.remove(handler)

    def emit(self, event: str, data: dict | None = None):
        """Emit an event to all registered handlers."""
        with self._lock:
            handlers = list(self._handlers.get(event, []))
        for handler in handlers:
            try:
                handler(data or {})
            except Exception as e:
                log.warning("Event handler error for %s: %s", event, e)

    def list_events(self) -> list[str]:
        with self._lock:
            return list(self._handlers.keys())

    def handler_count(self, event: str) -> int:
        with self._lock:
            return len(self._handlers.get(event, []))


# Global event bus
event_bus = EventBus()

# Standard events
EVENTS = {
    "on_message": "Fired when a new message is sent",
    "on_agent_join": "Fired when an agent registers",
    "on_agent_leave": "Fired when an agent deregisters",
    "on_agent_thinking": "Fired when an agent starts processing",
    "on_agent_idle": "Fired when an agent finishes processing",
    "on_approval_request": "Fired when an agent needs permission",
    "on_approval_response": "Fired when user responds to approval",
    "on_channel_create": "Fired when a channel is created",
    "on_channel_delete": "Fired when a channel is deleted",
    "on_schedule_trigger": "Fired when a scheduled task runs",
    "on_bridge_message": "Fired when a message arrives from external bridge",
    "on_server_start": "Fired when the server starts",
    "on_server_stop": "Fired when the server shuts down",
    # v3.4.0: Lifecycle hooks for MCP tool execution
    "pre_tool_use": "Fired before an MCP tool is called (data: agent, tool, args)",
    "post_tool_use": "Fired after an MCP tool completes (data: agent, tool, args, result)",
}


# ── AST-Based Safety Scanner ────────────────────────────────────────

class SafetyScanner:
    """Scans Python plugin code for dangerous patterns using AST analysis."""

    # Dangerous function names
    BLOCKED_CALLS = {
        "eval", "exec", "compile", "__import__", "getattr", "setattr",
        "delattr", "globals", "locals", "vars",
    }

    # Dangerous module imports
    BLOCKED_IMPORTS = {
        "subprocess", "shutil", "ctypes", "socket",
        "multiprocessing", "signal",
    }

    # Allowed imports (whitelist for safe plugins)
    ALLOWED_IMPORTS = {
        "json", "re", "time", "datetime", "math", "hashlib", "hmac",
        "base64", "urllib.parse", "collections", "functools", "itertools",
        "typing", "pathlib", "logging", "dataclasses", "enum",
    }

    @classmethod
    def scan(cls, code: str) -> list[dict]:
        """Scan code and return list of safety issues found."""
        issues = []
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            return [{"severity": "error", "message": f"Syntax error: {e}", "line": getattr(e, 'lineno', 0)}]

        for node in ast.walk(tree):
            # Check function calls
            if isinstance(node, ast.Call):
                name = cls._get_call_name(node)
                if name in cls.BLOCKED_CALLS:
                    issues.append({
                        "severity": "critical",
                        "message": f"Blocked function call: {name}()",
                        "line": node.lineno,
                    })

            # Check imports
            if isinstance(node, ast.Import):
                for alias in node.names:
                    root = alias.name.split(".")[0]
                    if root in cls.BLOCKED_IMPORTS:
                        issues.append({
                            "severity": "critical",
                            "message": f"Blocked import: {alias.name}",
                            "line": node.lineno,
                        })

            if isinstance(node, ast.ImportFrom):
                if node.module:
                    root = node.module.split(".")[0]
                    if root in cls.BLOCKED_IMPORTS:
                        issues.append({
                            "severity": "critical",
                            "message": f"Blocked import: from {node.module}",
                            "line": node.lineno,
                        })

            # Check attribute access on os module
            if isinstance(node, ast.Attribute):
                if isinstance(node.value, ast.Name) and node.value.id == "os":
                    if node.attr in ("system", "popen", "exec", "execv", "execvp", "spawn"):
                        issues.append({
                            "severity": "critical",
                            "message": f"Blocked os.{node.attr} call",
                            "line": node.lineno,
                        })

        return issues

    @staticmethod
    def _get_call_name(node: ast.Call) -> str:
        if isinstance(node.func, ast.Name):
            return node.func.id
        if isinstance(node.func, ast.Attribute):
            return node.func.attr
        return ""


# ── GhostHub Marketplace ────────────────────────────────────────────

# Built-in marketplace registry — plugins available for one-click install
MARKETPLACE_REGISTRY: list[dict] = [
    {
        "id": "auto-greet",
        "name": "Auto Greet",
        "description": "Automatically greet new agents when they join with a welcome message",
        "version": "1.0.0",
        "author": "GhostLink",
        "category": "Automation",
        "downloads": 0,
        "code": '''"""Auto-greet — sends a welcome message when agents join."""
__version__ = "1.0.0"

def setup(app, store, registry, mcp_bridge, **kwargs):
    from plugin_sdk import event_bus
    def on_join(data):
        import asyncio
        name = data.get("name", "")
        if name and store:
            try:
                loop = asyncio.get_event_loop()
                asyncio.run_coroutine_threadsafe(
                    store.add(sender="system", text=f"Welcome {name}! Type @{name} to start a conversation.", msg_type="system", channel="general"),
                    loop
                )
            except Exception:
                pass
    event_bus.on("on_agent_join", on_join)
''',
    },
    {
        "id": "daily-standup",
        "name": "Daily Standup",
        "description": "Posts a daily standup prompt to all agents at a configured time",
        "version": "1.0.0",
        "author": "GhostLink",
        "category": "Automation",
        "downloads": 0,
        "code": '''"""Daily Standup — posts standup prompt on schedule."""
__version__ = "1.0.0"

def setup(app, store, registry, mcp_bridge, **kwargs):
    from plugin_sdk import event_bus
    def on_schedule(data):
        import asyncio
        if data.get("command", "").lower().startswith("standup"):
            if store:
                try:
                    loop = asyncio.get_event_loop()
                    asyncio.run_coroutine_threadsafe(
                        store.add(sender="system", text="@all Daily standup: What did you work on? What are you working on next? Any blockers?", msg_type="system", channel="general"),
                        loop
                    )
                except Exception:
                    pass
    event_bus.on("on_schedule_trigger", on_schedule)
''',
    },
    {
        "id": "message-logger",
        "name": "Message Logger",
        "description": "Logs all messages to a file for compliance and audit trails",
        "version": "1.0.0",
        "author": "GhostLink",
        "category": "Compliance",
        "downloads": 0,
        "code": '''"""Message Logger — logs all messages to file."""
__version__ = "1.0.0"

import json, time
from pathlib import Path

_log_file = None

def setup(app, store, registry, mcp_bridge, **kwargs):
    global _log_file
    from plugin_sdk import event_bus
    data_dir = Path(__file__).parent.parent / "data"
    _log_file = data_dir / "message_log.jsonl"

    def on_message(data):
        if _log_file:
            try:
                entry = {"timestamp": time.time(), "sender": data.get("sender"), "text": data.get("text", "")[:500], "channel": data.get("channel")}
                with open(_log_file, "a") as f:
                    f.write(json.dumps(entry) + "\\n")
            except Exception:
                pass
    event_bus.on("on_message", on_message)
''',
    },
    {
        "id": "auto-archive",
        "name": "Auto Archive",
        "description": "Automatically archives channels with no activity for 7 days",
        "version": "1.0.0",
        "author": "GhostLink",
        "category": "Automation",
        "downloads": 0,
        "code": '''"""Auto Archive — archives inactive channels."""
__version__ = "1.0.0"

def setup(app, store, registry, mcp_bridge, **kwargs):
    pass  # Requires schedule integration — placeholder
''',
    },
    {
        "id": "sentiment-tracker",
        "name": "Sentiment Tracker",
        "description": "Tracks message sentiment and shows mood indicators per agent",
        "version": "1.0.0",
        "author": "GhostLink",
        "category": "Analytics",
        "downloads": 0,
        "code": '''"""Sentiment Tracker — basic keyword-based sentiment analysis."""
__version__ = "1.0.0"

def setup(app, store, registry, mcp_bridge, **kwargs):
    from fastapi import Request
    from fastapi.responses import JSONResponse

    _sentiments = {}
    _POSITIVE = {"great", "good", "awesome", "excellent", "perfect", "nice", "thanks", "love", "happy", "agree"}
    _NEGATIVE = {"bad", "wrong", "error", "fail", "bug", "broken", "terrible", "hate", "disagree", "issue"}

    from plugin_sdk import event_bus
    def on_message(data):
        sender = data.get("sender", "")
        text = (data.get("text", "") or "").lower()
        words = set(text.split())
        pos = len(words & _POSITIVE)
        neg = len(words & _NEGATIVE)
        if sender:
            prev = _sentiments.get(sender, {"positive": 0, "negative": 0, "neutral": 0})
            if pos > neg: prev["positive"] += 1
            elif neg > pos: prev["negative"] += 1
            else: prev["neutral"] += 1
            _sentiments[sender] = prev
    event_bus.on("on_message", on_message)

    @app.get("/api/plugins/sentiment")
    async def get_sentiments():
        return {"sentiments": _sentiments}
''',
    },
]


class Marketplace:
    """GhostHub marketplace — browse, install, and manage community plugins."""

    def __init__(self, data_dir: Path):
        self._data_dir = data_dir
        self._registry = list(MARKETPLACE_REGISTRY)
        self._installed: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._load_state()

    def _state_path(self) -> Path:
        return self._data_dir / "marketplace.json"

    def _load_state(self):
        path = self._state_path()
        if path.exists():
            try:
                self._installed = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                pass

    def _save_state(self):
        self._state_path().parent.mkdir(parents=True, exist_ok=True)
        self._state_path().write_text(json.dumps(self._installed, indent=2))

    def browse(self, category: str = "", search: str = "") -> list[dict]:
        """Browse available marketplace plugins."""
        results = []
        for plugin in self._registry:
            if category and plugin.get("category", "").lower() != category.lower():
                continue
            if search:
                q = search.lower()
                if q not in plugin["name"].lower() and q not in plugin.get("description", "").lower():
                    continue
            results.append({
                "id": plugin["id"],
                "name": plugin["name"],
                "description": plugin.get("description", ""),
                "version": plugin.get("version", "1.0.0"),
                "author": plugin.get("author", ""),
                "category": plugin.get("category", ""),
                "downloads": plugin.get("downloads", 0),
                "installed": plugin["id"] in self._installed,
                "installed_version": self._installed.get(plugin["id"], {}).get("version"),
            })
        return results

    def install(self, plugin_id: str) -> dict:
        """Install a plugin from the marketplace (thread-safe)."""
        with self._lock:
            return self._install_locked(plugin_id)

    def _install_locked(self, plugin_id: str) -> dict:
        plugin = next((p for p in self._registry if p["id"] == plugin_id), None)
        if not plugin:
            return {"ok": False, "error": "Plugin not found in marketplace"}

        code = plugin.get("code", "")
        if not code:
            return {"ok": False, "error": "Plugin has no code"}

        # Safety scan
        issues = SafetyScanner.scan(code)
        critical = [i for i in issues if i["severity"] == "critical"]
        if critical:
            return {"ok": False, "error": f"Safety scan failed: {critical[0]['message']}", "issues": issues}

        # Install via plugin_loader
        from plugin_loader import install_plugin
        result = install_plugin(plugin_id, code, plugin.get("description", ""), plugin.get("version", "1.0.0"))
        if result.get("ok"):
            self._installed[plugin_id] = {
                "version": plugin.get("version", "1.0.0"),
                "installed_at": time.time(),
            }
            self._save_state()
            plugin["downloads"] = plugin.get("downloads", 0) + 1

        return result

    def uninstall(self, plugin_id: str) -> dict:
        """Uninstall a marketplace plugin."""
        from plugin_loader import uninstall_plugin
        ok = uninstall_plugin(plugin_id)
        if ok:
            self._installed.pop(plugin_id, None)
            self._save_state()
        return {"ok": ok}

    def get_categories(self) -> list[str]:
        cats = set()
        for p in self._registry:
            if p.get("category"):
                cats.add(p["category"])
        return sorted(cats)


# ── Skill Packs ─────────────────────────────────────────────────────

SKILL_PACKS: list[dict] = [
    {
        "id": "developer",
        "name": "Developer Pack",
        "description": "Essential skills for software development — git ops, code review, test runner, dependency scanner",
        "icon": "code",
        "skills": ["git-ops", "code-analysis", "test-runner", "dep-scanner", "shell-exec", "api-test"],
        "color": "#10b981",
    },
    {
        "id": "research",
        "name": "Research Pack",
        "description": "Research and knowledge tools — web search, PDF reader, knowledge graph, AI search",
        "icon": "search",
        "skills": ["web-search", "web-fetch", "pdf-reader", "ai-search", "knowledge-graph"],
        "color": "#3b82f6",
    },
    {
        "id": "creative",
        "name": "Creative Pack",
        "description": "Creative and visual tools — image analysis, screenshot, diagram generator, text transform",
        "icon": "palette",
        "skills": ["image-analysis", "screenshot", "diagram-gen", "text-transform", "translate"],
        "color": "#f59e0b",
    },
    {
        "id": "devops",
        "name": "DevOps Pack",
        "description": "Infrastructure and operations — Docker, database, shell, API testing, monitoring",
        "icon": "cloud",
        "skills": ["docker-manage", "database-query", "shell-exec", "api-test", "web-perf"],
        "color": "#8b5cf6",
    },
    {
        "id": "communication",
        "name": "Communication Pack",
        "description": "Messaging and notifications — Slack, Discord, email, translation",
        "icon": "forum",
        "skills": ["slack-notify", "email-send", "translate", "notes"],
        "color": "#ec4899",
    },
]


# ── Hook System ─────────────────────────────────────────────────────

class HookManager:
    """Manages user-defined automation hooks."""

    def __init__(self, data_dir: Path, server_port: int = 8300):
        self._data_dir = data_dir
        self._server_port = server_port
        self._hooks_file = data_dir / "hooks.json"
        self._hooks: list[dict] = []
        self._load()

    def _load(self):
        if self._hooks_file.exists():
            try:
                self._hooks = json.loads(self._hooks_file.read_text())
            except (json.JSONDecodeError, OSError):
                self._hooks = []

    def _save(self):
        self._hooks_file.parent.mkdir(parents=True, exist_ok=True)
        self._hooks_file.write_text(json.dumps(self._hooks, indent=2))

    def list_hooks(self) -> list[dict]:
        return list(self._hooks)

    def create_hook(self, name: str, event: str, action: str, config: dict | None = None) -> dict:
        """Create a new automation hook.

        Args:
            name: Human-readable name
            event: Event to listen for (from EVENTS)
            action: Action type — "message" (send a message), "notify" (log), "trigger" (trigger agent)
            config: Action-specific config (channel, text, agent, etc.)
        """
        if event not in EVENTS:
            return {"ok": False, "error": f"Unknown event: {event}. Valid: {', '.join(EVENTS.keys())}"}

        hook = {
            "id": f"hook-{int(time.time())}",
            "name": name,
            "event": event,
            "action": action,
            "config": config or {},
            "enabled": True,
            "created_at": time.time(),
            "trigger_count": 0,
        }
        self._hooks.append(hook)
        self._save()

        # Register with event bus
        self._register_hook(hook)

        return {"ok": True, "hook": hook}

    def update_hook(self, hook_id: str, updates: dict) -> dict:
        for hook in self._hooks:
            if hook["id"] == hook_id:
                for k in ("name", "enabled", "config"):
                    if k in updates:
                        hook[k] = updates[k]
                self._save()
                return {"ok": True, "hook": hook}
        return {"ok": False, "error": "Hook not found"}

    def delete_hook(self, hook_id: str) -> dict:
        before = len(self._hooks)
        self._hooks = [h for h in self._hooks if h["id"] != hook_id]
        if len(self._hooks) < before:
            self._save()
            return {"ok": True}
        return {"ok": False, "error": "Hook not found"}

    def register_all(self):
        """Register all enabled hooks with the event bus."""
        for hook in self._hooks:
            if hook.get("enabled"):
                self._register_hook(hook)

    def _register_hook(self, hook: dict):
        """Register a single hook with the event bus."""
        if not hook.get("enabled"):
            return

        action = hook.get("action", "")
        config = hook.get("config", {})

        def handler(data, _hook=hook, _action=action, _config=config):
            _hook["trigger_count"] = _hook.get("trigger_count", 0) + 1
            log.info("Hook triggered: %s (event: %s, action: %s)", _hook["name"], _hook["event"], _action)

            if _action == "message":
                # Send a message to a channel
                import urllib.request
                channel = _config.get("channel", "general")
                text = _config.get("text", f"Hook '{_hook['name']}' triggered")
                try:
                    body = json.dumps({"sender": "system", "text": text, "channel": channel, "type": "system"}).encode()
                    req = urllib.request.Request(
                        f"http://127.0.0.1:{self._server_port}/api/send",
                        data=body, method="POST",
                        headers={"Content-Type": "application/json"},
                    )
                    urllib.request.urlopen(req, timeout=5)
                except Exception as e:
                    log.debug("Hook message send failed: %s", e)

            elif _action == "notify":
                log.info("Hook notification [%s]: %s — data: %s", _hook["name"], _config.get("text", ""), data)

            elif _action == "trigger":
                # Write to agent's queue file to trigger them
                agent = _config.get("agent", "")
                if agent:
                    queue_file = self._data_dir / f"{agent}_queue.jsonl"
                    try:
                        with open(queue_file, "a", encoding="utf-8") as f:
                            f.write(json.dumps({"channel": _config.get("channel", "general"), "hook": _hook["name"]}) + "\n")
                    except Exception as e:
                        log.debug("Hook trigger write failed: %s", e)

        event_bus.on(hook["event"], handler)
