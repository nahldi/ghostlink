"""AI Chattr — FastAPI backend with WebSocket hub."""

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

import subprocess

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

# Track spawned agent processes
_agent_processes: dict[str, subprocess.Popen] = {}

from store import MessageStore
from registry import AgentRegistry
from router import MessageRouter
from jobs import JobStore
from rules import RuleStore
from skills import SkillsRegistry
import mcp_bridge

# ── Config ──────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.toml"

with open(CONFIG_PATH, "rb") as f:
    CONFIG = tomllib.load(f)

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
if not UPLOAD_DIR.is_absolute():
    UPLOAD_DIR = BASE_DIR / UPLOAD_DIR

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ── Global state ────────────────────────────────────────────────────

store: MessageStore
skills_registry: SkillsRegistry
job_store: JobStore
rule_store: RuleStore
registry = AgentRegistry()
router = MessageRouter(max_hops=MAX_HOPS, default_routing=DEFAULT_ROUTING)

# Settings (in-memory, persisted to JSON)
SETTINGS_PATH = DATA_DIR / "settings.json"
_settings: dict = {
    "username": "You",
    "title": "AI Chattr",
    "theme": "dark",
    "fontSize": 14,
    "loopGuard": MAX_HOPS,
    "notificationSounds": True,
    "channels": ["general"],
}


def _load_settings():
    global _settings
    if SETTINGS_PATH.exists():
        with open(SETTINGS_PATH) as f:
            saved = json.load(f)
        _settings.update(saved)


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
    """Parse @mentions in messages and write to agent queue files."""
    import re
    mentions = re.findall(r"@(\w[\w-]*)", text)
    if not mentions:
        return

    agent_names = [inst.name for inst in registry.get_all()]
    targets = []

    if "all" in mentions:
        targets = [n for n in agent_names if n != sender]
    else:
        targets = [m for m in mentions if m in agent_names and m != sender]

    # Loop guard via router
    targets = router.get_targets(sender, text, channel, agent_names)

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
                f.write(json.dumps({"channel": channel}) + "\n")
        except Exception:
            pass


# ── WebSocket hub ───────────────────────────────────────────────────

_ws_clients: set[WebSocket] = set()


async def broadcast(event_type: str, data: dict):
    payload = json.dumps({"type": event_type, "data": data})
    dead: list[WebSocket] = []
    for ws in _ws_clients:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _ws_clients.discard(ws)


# ── Lifespan ────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    global store, job_store, rule_store, skills_registry

    _load_settings()

    db_path = DATA_DIR / "aichttr.db"
    store = MessageStore(db_path)
    await store.init()

    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    job_store = JobStore(db)
    await job_store.init()
    rule_store = RuleStore(db)
    await rule_store.init()
    skills_registry = SkillsRegistry(DATA_DIR)

    # Broadcast new messages via WebSocket
    async def on_msg(msg: dict):
        await broadcast("message", msg)
    store.on_message(on_msg)

    # Start MCP bridge for agent CLIs (dual transport)
    import threading
    mcp_bridge.configure(
        store=store,
        registry=registry,
        settings=_settings,
        data_dir=DATA_DIR,
        server_port=PORT,
        rule_store=rule_store,
        job_store=job_store,
        router=router,
    )
    http_thread = threading.Thread(target=mcp_bridge.run_http_server, daemon=True)
    http_thread.start()
    print(f"  MCP bridge (HTTP) started on port {mcp_bridge.MCP_HTTP_PORT}")

    sse_thread = threading.Thread(target=mcp_bridge.run_sse_server, daemon=True)
    sse_thread.start()
    print(f"  MCP bridge (SSE) started on port {mcp_bridge.MCP_SSE_PORT}")

    yield

    await store.close()
    await db.close()


app = FastAPI(title="AI Chattr", lifespan=lifespan)


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
    sender = body.get("sender", "You")
    text = body.get("text", "")
    channel = body.get("channel", "general")
    reply_to = body.get("reply_to")
    attachments = body.get("attachments", [])

    if not text.strip():
        return JSONResponse({"error": "empty message"}, 400)

    msg = await store.add(
        sender=sender,
        text=text,
        channel=channel,
        reply_to=reply_to,
        attachments=json.dumps(attachments),
    )

    # Route @mentions to agent wrappers
    _route_mentions(sender, text, channel)

    # Don't force-clear thinking — let the heartbeat activity monitor handle it naturally.
    # If the agent is still working after sending, glow stays. If idle, heartbeat clears it.

    return msg


@app.post("/api/messages/{msg_id}/pin")
async def pin_message(msg_id: int, request: Request):
    body = await request.json()
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


@app.delete("/api/messages/{msg_id}")
async def delete_message(msg_id: int):
    deleted = await store.delete([msg_id])
    if deleted:
        await broadcast("delete", {"message_ids": deleted})
        return {"ok": True}
    return JSONResponse({"error": "not found"}, 404)


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
    _settings.update(body)
    _save_settings()
    # Sync loop guard to router
    if "loopGuard" in body:
        router.max_hops = int(body["loopGuard"])
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
    await store._db.execute(
        "UPDATE messages SET channel = ? WHERE channel = ?",
        (new_name, name),
    )
    await store._db.commit()
    await broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in channels]})
    return {"channels": channels}


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
        await broadcast("status", {"agents": _get_full_agent_list()})
    return {"ok": ok}


@app.get("/api/agent-templates")
async def agent_templates():
    """Return available agent CLI templates with defaults."""
    agents_cfg = CONFIG.get("agents", {})
    templates = []
    for name, cfg in agents_cfg.items():
        import shutil as _shutil
        cmd = cfg.get("command", name)
        available = _shutil.which(cmd) is not None
        templates.append({
            "base": name,
            "command": cmd,
            "label": cfg.get("label", name.capitalize()),
            "color": cfg.get("color", "#a78bfa"),
            "defaultCwd": cfg.get("cwd", "."),
            "defaultArgs": cfg.get("args", []),
            "available": available,
        })
    # Scan for all known AI CLI agents
    KNOWN_AGENTS = [
        ("claude", "claude", "Claude", "#e8734a", "Anthropic", ["--dangerously-skip-permissions"]),
        ("codex", "codex", "Codex", "#10a37f", "OpenAI", ["--sandbox", "danger-full-access", "-a", "never"]),
        ("gemini", "gemini", "Gemini", "#4285f4", "Google", ["-y"]),
        ("grok", "grok", "Grok", "#ff6b35", "xAI", []),
        ("copilot", "github-copilot", "Copilot", "#6cc644", "GitHub", []),
        ("aider", "aider", "Aider", "#14b8a6", "Aider", ["--yes"]),
        ("goose", "goose", "Goose", "#f59e0b", "Block", []),
        ("pi", "pi", "Pi", "#8b5cf6", "Inflection", []),
        ("cursor", "cursor", "Cursor", "#7c3aed", "Cursor", []),
        ("cody", "cody", "Cody", "#ff5543", "Sourcegraph", []),
        ("continue", "continue", "Continue", "#0ea5e9", "Continue", []),
        ("opencode", "opencode", "OpenCode", "#22c55e", "OpenCode", []),
    ]
    for name, cmd, label, color, provider, default_args in KNOWN_AGENTS:
        if not any(t["base"] == name for t in templates):
            import shutil as _shutil
            available = _shutil.which(cmd) is not None
            templates.append({
                "base": name, "command": cmd, "label": label,
                "color": color, "defaultCwd": ".", "defaultArgs": default_args,
                "available": available, "provider": provider,
            })
        else:
            # Add provider to existing template
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
    ps_exe = _shutil.which("powershell.exe") or "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"

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
        return JSONResponse({"error": f"'{command}' not found on PATH"}, 400)

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

    try:
        proc = subprocess.Popen(
            spawn_args,
            cwd=str(BASE_DIR),
            env=os.environ.copy(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Store by base name — wrapper will register with a unique instance name
        _agent_processes[f"{base}_{proc.pid}"] = proc

        import asyncio
        await asyncio.sleep(3)

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

    # Only kill this specific agent's tmux session
    session_name = f"aichttr-{name}"
    try:
        subprocess.run(
            ["tmux", "kill-session", "-t", session_name],
            capture_output=True, timeout=5,
        )
    except Exception:
        pass

    # Only kill the wrapper process for THIS agent
    proc = _agent_processes.pop(name, None)
    if proc:
        try:
            proc.terminate()
        except Exception:
            pass

    if ok:
        await broadcast("status", {"agents": _get_full_agent_list()})
    return {"ok": ok or proc is not None}


@app.post("/api/cleanup")
async def cleanup_stale():
    """Kill stale tmux sessions, clear orphaned processes, free resources."""
    cleaned = []

    # Find all aichttr tmux sessions
    try:
        result = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}"],
                                capture_output=True, text=True, timeout=5)
        sessions = [s.strip() for s in result.stdout.strip().split("\n") if s.strip().startswith("aichttr-")]
    except Exception:
        sessions = []

    # Check which sessions have no registered agent
    live_names = {inst.name for inst in registry.get_all()}
    for session in sessions:
        agent_name = session.replace("aichttr-", "")
        if agent_name not in live_names:
            try:
                subprocess.run(["tmux", "kill-session", "-t", session], capture_output=True, timeout=5)
                cleaned.append(session)
            except Exception:
                pass

    # Kill orphaned wrapper processes
    for key, proc in list(_agent_processes.items()):
        try:
            if proc.poll() is not None:  # Process already exited
                _agent_processes.pop(key, None)
                cleaned.append(f"process:{key}")
        except Exception:
            pass

    return {"ok": True, "cleaned": cleaned, "count": len(cleaned)}


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
    """Full-text search across messages."""
    if not q.strip():
        return {"results": []}
    assert store._db is not None
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
        old_state = inst.state
        try:
            body = await request.json()
            if body.get("active"):
                # Glow whenever agent is doing anything — but skip first 15s (startup noise)
                if time.time() - inst.registered_at > 15:
                    inst.state = "thinking"
                    inst._think_ts = time.time()  # type: ignore[attr-defined]
            else:
                # Stay "thinking" for 3s after last active report to prevent flicker
                last_think = getattr(inst, '_think_ts', 0)
                if old_state == "thinking" and (time.time() - last_think) < 3:
                    pass  # keep thinking
                else:
                    inst.state = "active"
        except Exception:
            last_think = getattr(inst, '_think_ts', 0)
            if old_state == "thinking" and (time.time() - last_think) < 3:
                pass
            else:
                inst.state = "active"
        # Broadcast state change so frontend sees thinking glow
        if inst.state != old_state:
            await broadcast("status", {"agents": _get_full_agent_list()})
        return {"ok": True, "name": inst.name}
    return JSONResponse({"error": "not found"}, 404)


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


# ── Serve uploads ───────────────────────────────────────────────────

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


# ── Serve frontend (SPA fallback) ──────────────────────────────────

if STATIC_DIR.exists():
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(index)
        return JSONResponse({"error": "not found"}, 404)


# ── Entrypoint ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print(f"AI Chattr starting on http://{HOST}:{PORT}")
    uvicorn.run(
        "app:app",
        host=HOST,
        port=PORT,
        reload=False,
        log_level="info",
    )
