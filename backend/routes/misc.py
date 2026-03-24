"""Miscellaneous routes — status, settings, upload, pick-folder, preview, webhooks,
server-config, usage, export, share, hierarchy, snapshot, templates, DM channels,
tunnel, dashboard, and triggers.
"""
from __future__ import annotations

import asyncio as _asyncio
import html as _html
import html.parser as _html_parser
import json
import os
import re as _re
import subprocess
import time
import urllib.request as _urllib_request
import uuid as _uuid
from pathlib import Path

import deps
from fastapi import APIRouter, Request, UploadFile, File
from fastapi.responses import JSONResponse

router = APIRouter()

# ── Image upload helpers ──────────────────────────────────────────────

_IMAGE_MAGIC = {
    b"\x89PNG": "png",
    b"\xff\xd8\xff": "jpg",
    b"GIF87a": "gif",
    b"GIF89a": "gif",
    b"RIFF": "webp",
}
_ALLOWED_IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "svg"}


# ── URL preview helper ────────────────────────────────────────────────

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


def _save_settings():
    settings_path = deps.DATA_DIR / "settings.json"
    with open(settings_path, "w") as f:
        json.dump(deps._settings, f, indent=2)


# ── Endpoints ─────────────────────────────────────────────────────────

@router.get("/api/ws-token")
async def get_ws_token(request: Request):
    client_host = request.client.host if request.client else "127.0.0.1"
    if client_host not in ("127.0.0.1", "::1"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Localhost only")
    return {"token": deps._ws_token}


@router.get("/api/status")
async def get_status():
    from app_helpers import get_full_agent_list
    return {"agents": get_full_agent_list()}


@router.get("/api/settings")
async def get_settings():
    result = dict(deps._settings)
    persistent = list(result.get("persistentAgents", []))
    persistent_bases = {p["base"] for p in persistent}
    agents_cfg = deps.CONFIG.get("agents", {})
    for name, cfg in agents_cfg.items():
        if name not in persistent_bases:
            cwd_raw = cfg.get("cwd", ".")
            cwd_resolved = str((deps.BASE_DIR / cwd_raw).resolve()) if not Path(cwd_raw).is_absolute() else cwd_raw
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


@router.post("/api/settings")
async def save_settings(request: Request):
    body = await request.json()
    _ALLOWED_SETTINGS = {
        "username", "title", "theme", "fontSize", "loopGuard", "notificationSounds",
        "channels", "persistentAgents", "autoRoute", "connectedAgents",
        "quietHoursStart", "quietHoursEnd", "soundEnabled", "soundVolume",
        "soundPerAgent", "timezone", "timeFormat", "voiceLanguage",
    }
    filtered = {k: v for k, v in body.items() if k in _ALLOWED_SETTINGS}
    async with deps._settings_lock:
        deps._settings.update(filtered)
        _save_settings()
    if "loopGuard" in body:
        deps.router_inst.max_hops = int(body["loopGuard"])
    if "autoRoute" in body:
        val = body["autoRoute"]
        if isinstance(val, str) and val in ("none", "all", "smart"):
            deps.router_inst.default_routing = val
        elif val is True:
            deps.router_inst.default_routing = "all"
        else:
            deps.router_inst.default_routing = "none"
    return deps._settings


@router.post("/api/upload")
async def upload_image(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        return JSONResponse({"error": "only images allowed"}, 400)

    data = await file.read()
    if len(data) > deps.MAX_SIZE_MB * 1024 * 1024:
        return JSONResponse({"error": f"max {deps.MAX_SIZE_MB}MB"}, 400)

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "png"
    if ext == "svg":
        if not data[:256].lstrip().lower().startswith((b"<?xml", b"<svg")):
            return JSONResponse({"error": "invalid SVG file"}, 400)
    else:
        magic_ok = False
        for magic, _ in _IMAGE_MAGIC.items():
            if data[:len(magic)] == magic:
                magic_ok = True
                break
        if not magic_ok:
            return JSONResponse({"error": "invalid image file — magic bytes mismatch"}, 400)
        if data[:4] == b"RIFF" and data[8:12] != b"WEBP":
            return JSONResponse({"error": "invalid image file — not a valid WebP"}, 400)

    if ext not in _ALLOWED_IMAGE_EXTS:
        return JSONResponse({"error": f"unsupported extension: {ext}"}, 400)

    name = f"{_uuid.uuid4().hex[:12]}.{ext}"
    path = deps.UPLOAD_DIR / name
    with open(path, "wb") as f:
        f.write(data)

    return {"url": f"/uploads/{name}", "name": name}


@router.post("/api/pick-folder")
async def pick_folder():
    """Open the native OS folder picker and return the WSL-compatible path."""
    def win_to_wsl(p: str) -> str:
        p = p.strip().replace("\\", "/").rstrip("/")
        m = _re.match(r"^([A-Za-z]):/(.*)$", p)
        if m:
            return f"/mnt/{m.group(1).lower()}/{m.group(2)}"
        return p

    ps_script = (
        "$shell = New-Object -ComObject Shell.Application;"
        "$folder = $shell.BrowseForFolder(0, 'Select workspace folder', 0x40, 0);"
        "if ($folder) { $folder.Self.Path } else { '' }"
    )
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


@router.get("/api/preview")
async def url_preview(url: str = ""):
    """Fetch OpenGraph metadata for a URL."""
    if not url or not url.startswith("https://") and not url.startswith("http://"):
        return JSONResponse({"error": "valid http(s) URL required"}, 400)
    if deps._is_private_url(url):
        return JSONResponse({"error": "cannot fetch internal/private URLs"}, 400)
    try:
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

@router.get("/api/webhooks")
async def list_webhooks():
    return {"webhooks": deps._webhooks}


@router.post("/api/webhooks")
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
    deps._webhooks.append(wh)
    return wh


@router.post("/api/webhook/{wh_id}")
async def update_webhook(wh_id: str, request: Request):
    body = await request.json()
    _ALLOWED_WH_KEYS = {"url", "events", "active"}
    for wh in deps._webhooks:
        if wh["id"] == wh_id:
            for k, v in body.items():
                if k in _ALLOWED_WH_KEYS:
                    if k == "url" and not str(v).startswith(("http://", "https://")):
                        return JSONResponse({"error": "valid http/https URL required"}, 400)
                    wh[k] = v
            return wh
    return JSONResponse({"error": "not found"}, 404)


@router.delete("/api/webhook/{wh_id}")
async def delete_webhook(wh_id: str):
    before = len(deps._webhooks)
    deps._webhooks[:] = [w for w in deps._webhooks if w["id"] != wh_id]
    return {"ok": len(deps._webhooks) < before}


# ── Server Config ─────────────────────────────────────────────────────

@router.get("/api/server-config")
async def get_server_config():
    """Return current server configuration for the UI config viewer."""
    import mcp_bridge
    return {
        "server": {
            "port": deps.PORT,
            "host": deps.HOST,
            "data_dir": str(deps.DATA_DIR),
            "static_dir": str(deps.STATIC_DIR),
            "upload_dir": str(deps.UPLOAD_DIR),
            "max_upload_mb": deps.MAX_SIZE_MB,
        },
        "routing": {
            "default": deps.router_inst.default_routing,
            "max_hops": deps.router_inst.max_hops,
        },
        "mcp": {
            "http_port": mcp_bridge.MCP_HTTP_PORT,
            "sse_port": mcp_bridge.MCP_SSE_PORT,
        },
        "uptime": time.time() - deps._settings.get("_server_start", time.time()),
        "agents_online": len([i for i in deps.registry.get_all() if i.state in ("active", "thinking")]),
        "total_messages": 0,
    }


# ── Usage tracking ────────────────────────────────────────────────────

@router.get("/api/usage")
async def get_usage():
    """Return token usage and cost data."""
    return {
        "entries": deps._usage_log[-1000:],
        "total_cost": round(sum(e["cost"] for e in deps._usage_log), 4),
        "total_input_tokens": sum(e["input_tokens"] for e in deps._usage_log),
        "total_output_tokens": sum(e["output_tokens"] for e in deps._usage_log),
        "entry_count": len(deps._usage_log),
    }


# ── Export ───────────────────────────────────────────────────────────

@router.get("/api/export")
async def export_channel(channel: str = "general", format: str = "markdown"):
    if deps.store._db is None:
        raise RuntimeError("Database not initialized. Call init() first.")
    cursor = await deps.store._db.execute(
        "SELECT * FROM messages WHERE channel = ? ORDER BY id ASC",
        [channel],
    )
    rows = await cursor.fetchall()
    msgs = [deps.store._row_to_dict(r) for r in rows]

    if format == "json":
        return {"messages": msgs, "channel": channel, "count": len(msgs)}
    elif format == "html":
        ch_escaped = _html.escape(channel)
        html_lines = [f"<html><head><title>#{ch_escaped}</title></head><body style='background:#09090f;color:#e0dff0;font-family:sans-serif;padding:2rem'>"]
        html_lines.append(f"<h1>#{ch_escaped}</h1>")
        for m in msgs:
            color = "#38bdf8" if m.get("type") == "chat" and m["sender"] not in [a.name for a in deps.registry.get_all()] else "#a78bfa"
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


@router.get("/api/share")
async def share_conversation(channel: str = "general"):
    """Generate a self-contained shareable HTML page for a conversation."""
    if deps.store._db is None:
        raise RuntimeError("Database not initialized.")
    cursor = await deps.store._db.execute(
        "SELECT * FROM messages WHERE channel = ? ORDER BY id ASC", [channel],
    )
    rows = await cursor.fetchall()
    msgs = [deps.store._row_to_dict(r) for r in rows]
    agent_colors = {inst.name: inst.color for inst in deps.registry.get_all()}

    html_out = f"""<!DOCTYPE html>
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
        html_out += f'<div class="msg"><div class="sender" style="color:{color}">{m["sender"]}<span class="time">{m.get("time","")}</span></div><div class="text">{text_escaped}</div></div>\n'

    html_out += f'<div class="footer">Exported from GhostLink — {len(msgs)} messages</div></body></html>'

    return {"html": html_out, "filename": f"{channel}-share.html", "message_count": len(msgs)}


# ── Hierarchy ─────────────────────────────────────────────────────────

@router.get("/api/hierarchy")
async def get_hierarchy():
    from app_helpers import get_full_agent_list
    agents = get_full_agent_list()
    tree: dict[str, list[str]] = {}
    for a in agents:
        role = a.get("role")
        parent = a.get("parent")
        if role == "manager":
            tree.setdefault(a["name"], [])
        if parent:
            tree.setdefault(parent, []).append(a["name"])
    return {"agents": agents, "tree": tree}


# ── Dashboard / Analytics ─────────────────────────────────────────────

@router.get("/api/dashboard")
async def get_dashboard():
    """Aggregated dashboard data — messages, tokens, agents, activity."""
    if deps.store._db is None:
        raise RuntimeError("Database not initialized.")

    cursor = await deps.store._db.execute("SELECT COUNT(*) as cnt FROM messages")
    total_msgs = (await cursor.fetchone())["cnt"]

    cursor = await deps.store._db.execute(
        "SELECT channel, COUNT(*) as cnt FROM messages GROUP BY channel ORDER BY cnt DESC"
    )
    msgs_by_channel = {row["channel"]: row["cnt"] for row in await cursor.fetchall()}

    cursor = await deps.store._db.execute(
        "SELECT sender, COUNT(*) as cnt FROM messages WHERE type = 'chat' GROUP BY sender ORDER BY cnt DESC LIMIT 10"
    )
    msgs_by_sender = {row["sender"]: row["cnt"] for row in await cursor.fetchall()}

    day_ago = time.time() - 86400
    cursor = await deps.store._db.execute(
        "SELECT CAST((timestamp - ?) / 3600 AS INTEGER) as hour, COUNT(*) as cnt "
        "FROM messages WHERE timestamp > ? GROUP BY hour ORDER BY hour",
        (day_ago, day_ago),
    )
    hourly = {row["hour"]: row["cnt"] for row in await cursor.fetchall()}

    from app_helpers import get_full_agent_list
    agents = get_full_agent_list()
    online = [a for a in agents if a.get("state") in ("active", "thinking")]

    # NOTE: _usage is a legacy reference from the original code — intentionally using _usage_log
    total_tokens = sum(e.get("input_tokens", 0) + e.get("output_tokens", 0) for e in deps._usage_log)
    usage_by_agent: dict[str, int] = {}
    for e in deps._usage_log:
        agent = e.get("agent", "")
        usage_by_agent[agent] = usage_by_agent.get(agent, 0) + e.get("input_tokens", 0) + e.get("output_tokens", 0)

    return {
        "total_messages": total_msgs,
        "messages_by_channel": msgs_by_channel,
        "messages_by_sender": msgs_by_sender,
        "hourly_messages": hourly,
        "agents_total": len(agents),
        "agents_online": len(online),
        "total_tokens": total_tokens,
        "usage_by_agent": usage_by_agent,
        "estimated_cost": (total_tokens / 1_000_000) * 3,
        "channels": len(deps._settings.get("channels", ["general"])),
        "uptime_seconds": time.time() - deps._settings.get("_server_start", time.time()),
    }


# ── Session Snapshots ─────────────────────────────────────────────────

@router.get("/api/snapshot")
async def export_snapshot():
    """Export the entire session state as a JSON snapshot."""
    if deps.store._db is None:
        raise RuntimeError("Database not initialized.")
    cursor = await deps.store._db.execute("SELECT * FROM messages ORDER BY id ASC")
    rows = await cursor.fetchall()
    msgs = [deps.store._row_to_dict(r) for r in rows]
    jobs = await deps.job_store.list_jobs()
    rules = await deps.rule_store.list_all()
    from app_helpers import get_full_agent_list
    return {
        "version": "1.0.0",
        "exported_at": time.time(),
        "settings": dict(deps._settings),
        "agents": get_full_agent_list(),
        "channels": deps._settings.get("channels", ["general"]),
        "messages": msgs,
        "jobs": jobs,
        "rules": rules,
    }


@router.post("/api/snapshot/import")
async def import_snapshot(request: Request):
    """Import a session snapshot. Merges messages, replaces settings."""
    body = await request.json()
    imported_msgs = body.get("messages", [])
    imported_settings = body.get("settings", {})
    imported_channels = body.get("channels", [])

    _safe_validators = {
        "username": lambda v: isinstance(v, str) and len(v) <= 50,
        "theme": lambda v: isinstance(v, str) and v in ("dark", "light", "cyberpunk", "terminal", "ocean", "sunset", "midnight", "rosegold", "arctic"),
        "fontSize": lambda v: isinstance(v, (int, float)) and 8 <= v <= 32,
        "loopGuard": lambda v: isinstance(v, (int, float)) and 1 <= v <= 20,
        "notificationSounds": lambda v: isinstance(v, bool),
        "autoRoute": lambda v: isinstance(v, (str, bool)),
    }
    async with deps._settings_lock:
        for k, validator in _safe_validators.items():
            if k in imported_settings and validator(imported_settings[k]):
                deps._settings[k] = imported_settings[k]
        existing = set(deps._settings.get("channels", ["general"]))
        for ch in imported_channels:
            existing.add(ch)
        deps._settings["channels"] = sorted(existing)
        _save_settings()

    if deps.store._db is None:
        raise RuntimeError("Database not initialized.")
    cursor = await deps.store._db.execute("SELECT uid FROM messages")
    existing_uids = {row["uid"] for row in await cursor.fetchall()}

    imported_count = 0
    for msg in imported_msgs:
        if msg.get("uid") and msg["uid"] not in existing_uids:
            await deps.store.add(
                sender=msg.get("sender", "unknown"),
                text=msg.get("text", ""),
                msg_type=msg.get("type", "chat"),
                channel=msg.get("channel", "general"),
                uid=msg.get("uid", ""),
                metadata=json.dumps(msg.get("metadata", {})) if isinstance(msg.get("metadata"), dict) else str(msg.get("metadata", "{}")),
            )
            imported_count += 1

    await deps.broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in deps._settings["channels"]]})
    return {"ok": True, "imported_messages": imported_count, "channels": deps._settings["channels"]}


# ── Message Templates ─────────────────────────────────────────────────

def _templates_path():
    return deps.DATA_DIR / "templates.json"


def _load_templates() -> list[dict]:
    p = _templates_path()
    if p.exists():
        try:
            return json.loads(p.read_text("utf-8"))
        except Exception:
            return []
    return []


def _save_templates(templates: list[dict]):
    _templates_path().write_text(json.dumps(templates, indent=2), "utf-8")


@router.get("/api/templates")
async def list_templates():
    return {"templates": _load_templates()}


@router.post("/api/templates")
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


@router.delete("/api/templates/{tpl_id}")
async def delete_template(tpl_id: str):
    templates = _load_templates()
    before = len(templates)
    templates = [t for t in templates if t.get("id") != tpl_id]
    _save_templates(templates)
    return {"ok": len(templates) < before}


# ── Agent DM Channels ─────────────────────────────────────────────────

@router.post("/api/dm-channel")
async def create_dm_channel(request: Request):
    """Create or get a DM channel between two agents."""
    body = await request.json()
    agent1 = (body.get("agent1", "") or "").strip()
    agent2 = (body.get("agent2", "") or "").strip()
    if not agent1 or not agent2:
        return JSONResponse({"error": "agent1 and agent2 required"}, 400)
    pair = sorted([agent1, agent2])
    dm_name = f"dm-{pair[0]}-{pair[1]}"
    broadcast_needed = False
    async with deps._settings_lock:
        channels = list(deps._settings.get("channels", ["general"]))
        if dm_name not in channels:
            channels.append(dm_name)
            deps._settings["channels"] = channels
            _save_settings()
            broadcast_needed = True
    if broadcast_needed:
        await deps.broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in channels]})
    return {"channel": dm_name, "agents": pair}


# ── Cloudflare Tunnel ─────────────────────────────────────────────────

@router.post("/api/tunnel/start")
async def tunnel_start():
    if deps._tunnel_process and deps._tunnel_process.poll() is None:
        return JSONResponse({"url": deps._tunnel_url, "pid": deps._tunnel_process.pid, "already": True})

    try:
        proc = subprocess.Popen(
            ["cloudflared", "tunnel", "--url", f"http://127.0.0.1:{deps.PORT}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError:
        return JSONResponse({"error": "cloudflared not found. Install it first."}, 500)

    url_pattern = _re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
    found_url: str | None = None

    import threading
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

    deps._tunnel_process = proc
    deps._tunnel_url = found_url
    return {"url": found_url, "pid": proc.pid}


@router.post("/api/tunnel/stop")
async def tunnel_stop():
    if deps._tunnel_process:
        deps._tunnel_process.kill()
        deps._tunnel_process.wait()
        deps._tunnel_process = None
        deps._tunnel_url = None
    return {"ok": True}


@router.get("/api/tunnel/status")
async def tunnel_status():
    active = deps._tunnel_process is not None and deps._tunnel_process.poll() is None
    if not active:
        return {"active": False, "url": None}
    return {"active": True, "url": deps._tunnel_url}


# ── Inbound triggers ─────────────────────────────────────────────────

@router.post("/api/trigger")
async def inbound_trigger(request: Request):
    """External services can POST here to trigger agents or send messages."""
    body = await request.json()
    text = body.get("text", "").strip()
    if not text:
        return JSONResponse({"error": "text is required"}, 400)

    agent = body.get("agent", "").strip()
    channel = body.get("channel", "general").strip()
    source = body.get("source", "webhook").strip()
    event_type = body.get("event", "trigger").strip()

    if agent:
        msg_text = f"@{agent} [{source}/{event_type}] {text}"
    else:
        msg_text = f"[{source}/{event_type}] {text}"

    msg = await deps.store.add(sender="system", text=msg_text, msg_type="system", channel=channel)
    await deps.broadcast("message", msg)

    if agent:
        from app_helpers import route_mentions
        route_mentions("system", msg_text, channel)

    return {"ok": True, "message_id": msg.get("id"), "routed_to": agent or None}


@router.post("/api/trigger/{agent_name}")
async def trigger_agent(agent_name: str, request: Request):
    """Directly trigger a specific agent with a message."""
    body = await request.json()
    text = body.get("text", "").strip()
    channel = body.get("channel", "general").strip()

    if not text:
        return JSONResponse({"error": "text is required"}, 400)

    inst = deps.registry.get(agent_name)
    if not inst:
        return JSONResponse({"error": f"agent '{agent_name}' not found"}, 404)

    msg_text = f"@{agent_name} {text}"
    msg = await deps.store.add(sender="system", text=msg_text, msg_type="system", channel=channel)
    await deps.broadcast("message", msg)
    from app_helpers import route_mentions
    route_mentions("system", msg_text, channel)

    return {"ok": True, "message_id": msg.get("id"), "agent": agent_name}
