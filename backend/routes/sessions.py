"""Session management routes."""
from __future__ import annotations

import deps
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/api/session-templates")
async def get_session_templates():
    return {"templates": deps.session_manager.get_templates()}


@router.post("/api/session-templates")
async def save_session_template(request: Request):
    body = await request.json()
    template = deps.session_manager.save_template(body)
    return template


@router.delete("/api/session-templates/{tpl_id}")
async def delete_session_template(tpl_id: str):
    ok = deps.session_manager.delete_template(tpl_id)
    return {"ok": ok}


@router.get("/api/sessions/{channel}")
async def get_session(channel: str):
    session = deps.session_manager.get_session(channel)
    return {"session": session}


@router.post("/api/sessions/{channel}/start")
async def start_session(channel: str, request: Request):
    body = await request.json()
    template_id = body.get("template_id")
    cast = body.get("cast", {})
    topic = body.get("topic", "")
    if not template_id:
        return JSONResponse({"error": "template_id required"}, 400)
    try:
        session = deps.session_manager.start_session(channel, template_id, cast, topic)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, 404)
    # Broadcast session start as system message
    phase = session["phases"][0] if session["phases"] else {}
    msg_text = f"Session started: **{session['template_name']}**"
    if topic:
        msg_text += f" — {topic}"
    await deps.store.add("system", msg_text, "system", channel)
    if phase:
        await deps.store.add("system", f"**Phase 1: {phase['name']}** — {phase.get('prompt', '')}", "system", channel)
    await deps.broadcast("session_update", {"channel": channel, "session": session})
    return session


@router.post("/api/sessions/{channel}/advance")
async def advance_session(channel: str):
    prev = deps.session_manager.get_session(channel)
    if not prev:
        return JSONResponse({"error": "no active session"}, 404)
    prev_phase = prev["current_phase"]
    session = deps.session_manager.advance_turn(channel)
    if session and session["status"] == "completed":
        await deps.store.add("system", f"Session completed: **{session['template_name']}**", "system", channel)
    elif session and session["current_phase"] != prev_phase and session["current_phase"] < len(session.get("phases", [])):
        phase = session["phases"][session["current_phase"]]
        await deps.store.add("system", f"**Phase {session['current_phase'] + 1}: {phase['name']}** — {phase.get('prompt', '')}", "system", channel)
    await deps.broadcast("session_update", {"channel": channel, "session": session})
    return {"session": session}


@router.post("/api/sessions/{channel}/end")
async def end_session(channel: str):
    session = deps.session_manager.end_session(channel)
    if session:
        await deps.store.add("system", f"Session ended: **{session['template_name']}**", "system", channel)
        await deps.broadcast("session_update", {"channel": channel, "session": session})
    return {"session": session}


@router.post("/api/sessions/{channel}/pause")
async def pause_session(channel: str):
    session = deps.session_manager.pause_session(channel)
    await deps.broadcast("session_update", {"channel": channel, "session": session})
    return {"session": session}


@router.post("/api/sessions/{channel}/resume")
async def resume_session(channel: str):
    session = deps.session_manager.resume_session(channel)
    await deps.broadcast("session_update", {"channel": channel, "session": session})
    return {"session": session}


@router.get("/api/sessions/{channel}/prompt")
async def get_session_prompt(channel: str):
    prompt = deps.session_manager.get_current_prompt(channel)
    return {"prompt": prompt}
