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

    for target in targets:
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
    global store, job_store, rule_store

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

    # If sender is an agent, clear thinking state immediately
    inst = registry.get(sender)
    if inst and inst.state == "thinking":
        inst.state = "active"
        inst._think_ts = 0  # type: ignore[attr-defined]
        await broadcast("status", {"agents": registry.get_public_list()})

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
    live = registry.get_public_list()
    live_names = {a["name"] for a in live}
    live_bases = {a["base"] for a in live}

    # Merge config from config.toml + persistent agents from settings
    agents_cfg = dict(CONFIG.get("agents", {}))
    for pa in _settings.get("persistentAgents", []):
        if pa["base"] not in agents_cfg:
            agents_cfg[pa["base"]] = {
                "command": pa.get("command", pa["base"]),
                "label": pa.get("label", pa["base"].capitalize()),
                "color": pa.get("color", "#a78bfa"),
                "cwd": pa.get("cwd", "."),
                "args": pa.get("args", []),
            }

    # Enrich live agents with config info
    for a in live:
        cfg = agents_cfg.get(a.get("base", ""), {})
        cwd_raw = cfg.get("cwd", ".")
        cwd_path = (BASE_DIR / cwd_raw).resolve() if not Path(cwd_raw).is_absolute() else Path(cwd_raw)
        a["workspace"] = str(cwd_path)
        a["command"] = cfg.get("command", a.get("base", ""))
        a["args"] = cfg.get("args", [])

    # Add offline agents from config + persistent that aren't live
    for name, cfg in agents_cfg.items():
        if name not in live_names and name not in live_bases:
            cwd_raw = cfg.get("cwd", ".")
            cwd_path = (BASE_DIR / cwd_raw).resolve() if not Path(cwd_raw).is_absolute() else Path(cwd_raw)
            live.append({
                "name": name,
                "base": name,
                "label": cfg.get("label", name.capitalize()),
                "color": cfg.get("color", "#a78bfa"),
                "slot": 0,
                "state": "offline",
                "registered_at": 0,
                "role": "",
                "workspace": str(cwd_path),
                "command": cfg.get("command", name),
                "args": cfg.get("args", []),
            })

    return {"agents": live}


@app.get("/api/settings")
async def get_settings():
    return _settings


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
    await broadcast("status", {"agents": registry.get_public_list()})
    return inst.to_dict()


@app.post("/api/deregister/{name}")
async def deregister_agent(name: str):
    ok = registry.deregister(name)
    if ok:
        await broadcast("status", {"agents": registry.get_public_list()})
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
    # Also add known CLIs not in config
    for name, cmd, label, color in [
        ("claude", "claude", "Claude", "#e8734a"),
        ("codex", "codex", "Codex", "#10a37f"),
        ("gemini", "gemini", "Gemini", "#4285f4"),
    ]:
        if not any(t["base"] == name for t in templates):
            import shutil as _shutil
            if _shutil.which(cmd):
                templates.append({
                    "base": name, "command": cmd, "label": label,
                    "color": color, "defaultCwd": ".", "defaultArgs": [],
                    "available": True,
                })
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

    # Update config.toml if cwd or args differ
    if cwd or extra_args:
        if base not in CONFIG.get("agents", {}):
            CONFIG.setdefault("agents", {})[base] = {
                "command": command,
                "label": label or base.capitalize(),
                "color": cfg.get("color", "#a78bfa"),
            }
        if cwd:
            CONFIG["agents"][base]["cwd"] = cwd
        if extra_args:
            CONFIG["agents"][base]["args"] = extra_args

        # Write config as TOML manually
        try:
            lines = []
            # Server section
            for section in ["server", "routing", "images", "mcp"]:
                if section in CONFIG:
                    lines.append(f"[{section}]")
                    for k, v in CONFIG[section].items():
                        if isinstance(v, str):
                            lines.append(f'{k} = "{v}"')
                        else:
                            lines.append(f"{k} = {v}")
                    lines.append("")
            # Agents
            for aname, acfg in CONFIG.get("agents", {}).items():
                lines.append(f"[agents.{aname}]")
                for k, v in acfg.items():
                    if isinstance(v, str):
                        lines.append(f'{k} = "{v}"')
                    elif isinstance(v, list):
                        items = ", ".join(f'"{x}"' for x in v)
                        lines.append(f"{k} = [{items}]")
                    else:
                        lines.append(f"{k} = {v}")
                lines.append("")
            CONFIG_PATH.write_text("\n".join(lines), "utf-8")
        except Exception:
            pass  # Non-fatal: wrapper still reads existing config

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
        _agent_processes[base] = proc

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
    """Kill a running agent by deregistering and stopping its tmux session."""
    # Deregister from the server
    ok = registry.deregister(name)

    # Try to kill the tmux session
    session_name = f"aichttr-{name}"
    try:
        subprocess.run(
            ["tmux", "kill-session", "-t", session_name],
            capture_output=True, timeout=5,
        )
    except Exception:
        pass

    # Kill the wrapper process if we spawned it
    proc = _agent_processes.pop(name, None)
    if proc:
        try:
            proc.terminate()
        except Exception:
            pass

    if ok:
        await broadcast("status", {"agents": registry.get_public_list()})
    return {"ok": ok or proc is not None}


@app.post("/api/heartbeat/{agent_name}")
async def heartbeat(agent_name: str, request: Request):
    inst = registry.get(agent_name)
    if inst:
        old_state = inst.state
        try:
            body = await request.json()
            if body.get("active"):
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
            agents_cfg = CONFIG.get("agents", {})
            all_agents = registry.get_public_list()
            live_names = {a["base"] for a in all_agents}
            for a in all_agents:
                cfg = agents_cfg.get(a.get("base", ""), {})
                cwd_raw = cfg.get("cwd", ".")
                a["workspace"] = str((BASE_DIR / cwd_raw).resolve())
                a["command"] = cfg.get("command", a.get("base", ""))
                a["args"] = cfg.get("args", [])
            for name, cfg in agents_cfg.items():
                if name not in live_names:
                    cwd_raw = cfg.get("cwd", ".")
                    all_agents.append({
                        "name": name, "base": name, "label": cfg.get("label", name.capitalize()),
                        "color": cfg.get("color", "#a78bfa"), "slot": 0, "state": "offline",
                        "registered_at": 0, "role": "", "workspace": str((BASE_DIR / cwd_raw).resolve()),
                        "command": cfg.get("command", name), "args": cfg.get("args", []),
                    })
            await broadcast("status", {"agents": all_agents})
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
