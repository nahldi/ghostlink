"""API routes for Phase 4-7 features.

Exposes REST endpoints for:
- Autonomous agent plans
- Memory graph (semantic search)
- RAG pipeline (document upload/search)
- Agent specialization (feedback)
- Remote agent execution
- User auth
- Workflow management
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import deps

log = logging.getLogger(__name__)
router = APIRouter()
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_RULE_SCOPES = {"project", "user", "agent"}
_RULE_CATEGORIES = {"behavior", "format", "safety", "workflow", "style"}
_PERSONA_CATEGORIES = {"developer", "reviewer", "architect", "writer", "researcher", "devops", "security", "custom"}


def _json_path(name: str) -> Path:
    return Path(deps.DATA_DIR or ".") / name


def _load_json_file(name: str, default: dict) -> dict:
    path = _json_path(name)
    if not path.exists():
        return dict(default)
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return dict(default)


def _save_json_file(name: str, payload: dict) -> None:
    path = _json_path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    tmp.replace(path)


def _ensure_safe_id(value: str, field: str = "id") -> str | None:
    cleaned = (value or "").strip()
    if not _SAFE_ID_RE.fullmatch(cleaned):
        return None
    return cleaned


def _username_color(username: str) -> str:
    palette = ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#10b981"]
    return palette[sum(ord(ch) for ch in username) % len(palette)]


def list_live_workspace_collaborators() -> list[dict]:
    collaborators = list(deps._workspace_collaborators.values())
    collaborators.sort(key=lambda item: ((item.get("status") != "active"), item.get("username", "").lower()))
    return collaborators


async def broadcast_workspace_collaborators() -> None:
    await deps.broadcast("workspace_presence", {"collaborators": list_live_workspace_collaborators()})


async def broadcast_workspace_invites() -> None:
    invites = (await list_workspace_invites())["invites"]
    await deps.broadcast("workspace_invites", {"invites": invites})


def _is_local_request(request: Request) -> bool:
    host = request.client.host if request.client else "127.0.0.1"
    return host in ("127.0.0.1", "::1", "localhost")


def _get_session_user(request: Request) -> dict | None:
    if not deps.user_manager:
        return None
    auth_header = request.headers.get("Authorization", "")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return deps.user_manager.validate_token(token.strip())


# ── Autonomous Agent (Phase 7.1) ──────────────────────────────────

@router.post("/api/autonomous/plan")
async def create_plan(request: Request):
    """Create an autonomous plan from a goal."""
    if not deps.autonomous_manager:
        return JSONResponse({"error": "Autonomous manager not initialized"}, 503)
    body = await request.json()
    goal = body.get("goal", "")
    agent = body.get("agent", "")
    subtasks = body.get("subtasks", [])
    if not goal or not agent or not subtasks:
        return JSONResponse({"error": "goal, agent, and subtasks required"}, 400)
    plan = deps.autonomous_manager.create_plan(
        goal, agent, subtasks,
        channel=body.get("channel", "general"),
        require_approval=body.get("require_approval", True),
    )
    return deps.autonomous_manager._plan_to_dict(plan)


@router.get("/api/autonomous/plans")
async def list_plans(agent: str = ""):
    if not deps.autonomous_manager:
        return {"plans": []}
    return {"plans": deps.autonomous_manager.list_plans(agent or None)}


@router.post("/api/autonomous/plans/{plan_id}/start")
async def start_plan(plan_id: str):
    if not deps.autonomous_manager:
        return JSONResponse({"error": "not initialized"}, 503)
    st = deps.autonomous_manager.start_execution(plan_id)
    if not st:
        return JSONResponse({"error": "Plan not found or no pending tasks"}, 404)
    return {"subtask": {"id": st.id, "label": st.label, "status": st.status}}


@router.post("/api/autonomous/plans/{plan_id}/advance")
async def advance_plan(plan_id: str, request: Request):
    if not deps.autonomous_manager:
        return JSONResponse({"error": "not initialized"}, 503)
    body = await request.json()
    st = deps.autonomous_manager.advance(
        plan_id, body.get("subtask_id", ""),
        result=body.get("result", ""), error=body.get("error", ""),
    )
    if st:
        return {"next": {"id": st.id, "label": st.label, "status": st.status}}
    plan = deps.autonomous_manager.get_plan(plan_id)
    return {"next": None, "plan_status": plan.status if plan else "unknown", "summary": plan.summary if plan else ""}


@router.post("/api/autonomous/plans/{plan_id}/cancel")
async def cancel_plan(plan_id: str):
    if not deps.autonomous_manager:
        return JSONResponse({"error": "not initialized"}, 503)
    return {"ok": deps.autonomous_manager.cancel(plan_id)}


# ── Memory Graph (Phase 7.2) ─────────────────────────────────────

@router.post("/api/memory-graph/add")
async def memory_graph_add(request: Request):
    if not deps.memory_graph:
        return JSONResponse({"error": "Memory graph not initialized"}, 503)
    body = await request.json()
    agent = body.get("agent", "")
    key = body.get("key", "")
    content = body.get("content", "")
    if not agent or not key or not content:
        return JSONResponse({"error": "agent, key, and content required"}, 400)
    node = deps.memory_graph.add(agent, key, content, tags=body.get("tags", []))
    return {"id": node.id, "connections": node.connections}


@router.get("/api/memory-graph/search")
async def memory_graph_search(q: str = "", agent: str = "", limit: int = 5):
    if not deps.memory_graph:
        return {"results": []}
    return {"results": deps.memory_graph.search(q, agent=agent or None, limit=limit)}


@router.get("/api/memory-graph/related/{node_id}")
async def memory_graph_related(node_id: str, depth: int = 1):
    if not deps.memory_graph:
        return {"related": []}
    return {"related": deps.memory_graph.get_related(node_id, depth)}


@router.get("/api/memory-graph/stats")
async def memory_graph_stats():
    if not deps.memory_graph:
        return {}
    return deps.memory_graph.stats()


@router.get("/api/memory-graph/agent/{agent}")
async def memory_graph_agent(agent: str):
    if not deps.memory_graph:
        return {}
    return deps.memory_graph.get_agent_knowledge(agent)


# ── RAG Pipeline (Phase 7.4) ─────────────────────────────────────

@router.post("/api/rag/upload")
async def rag_upload(request: Request):
    if not deps.rag_pipeline:
        return JSONResponse({"error": "RAG pipeline not initialized"}, 503)
    body = await request.json()
    filename = body.get("filename", "")
    content = body.get("content", "")
    if not filename or not content:
        return JSONResponse({"error": "filename and content required"}, 400)
    result = deps.rag_pipeline.upload(
        filename, content,
        channel=body.get("channel", "general"),
        uploaded_by=body.get("uploaded_by", "user"),
    )
    if "error" in result:
        return JSONResponse(result, 400)
    return result


@router.get("/api/rag/search")
async def rag_search(q: str = "", channel: str = "", limit: int = 5):
    if not deps.rag_pipeline:
        return {"results": []}
    return {"results": deps.rag_pipeline.search(q, channel=channel or None, limit=limit)}


@router.get("/api/rag/documents")
async def rag_documents(channel: str = ""):
    if not deps.rag_pipeline:
        return {"documents": []}
    return {"documents": deps.rag_pipeline.list_documents(channel=channel or None)}


@router.delete("/api/rag/documents/{doc_id:path}")
async def rag_delete(doc_id: str):
    if not deps.rag_pipeline:
        return JSONResponse({"error": "not initialized"}, 503)
    return {"ok": deps.rag_pipeline.delete_document(doc_id)}


# ── Specialization / Feedback (Phase 7.3) ─────────────────────────

@router.post("/api/specialization/feedback")
async def specialization_feedback(request: Request):
    if not deps.specialization:
        return JSONResponse({"error": "Specialization engine not initialized"}, 503)
    body = await request.json()
    return deps.specialization.record_feedback(
        agent=body.get("agent", ""),
        message_text=body.get("message_text", ""),
        feedback_type=body.get("feedback_type", ""),
        correction_text=body.get("correction_text", ""),
        channel=body.get("channel", "general"),
    )


@router.get("/api/specialization/stats/{agent}")
async def specialization_stats(agent: str):
    if not deps.specialization:
        return {}
    return deps.specialization.get_stats(agent)


@router.get("/api/specialization/adjustments/{agent}")
async def specialization_adjustments(agent: str):
    if not deps.specialization:
        return {"adjustments": []}
    return {"adjustments": deps.specialization.get_adjustments(agent)}


# ── Remote Execution (Phase 6.1) ─────────────────────────────────

@router.post("/api/remote/spawn-docker")
async def remote_spawn_docker(request: Request):
    if not deps.remote_runner:
        return JSONResponse({"error": "Remote runner not initialized"}, 503)
    body = await request.json()
    try:
        ra = deps.remote_runner.spawn_docker(
            body.get("base", ""), body.get("name", ""),
            body.get("workspace", "."), image=body.get("image", "ghostlink-agent:latest"),
            env=body.get("env", {}),
        )
        return {"name": ra.name, "host": ra.host, "state": ra.state, "error": ra.error}
    except RuntimeError as e:
        return JSONResponse({"error": str(e)}, 400)


@router.post("/api/remote/spawn-ssh")
async def remote_spawn_ssh(request: Request):
    if not deps.remote_runner:
        return JSONResponse({"error": "Remote runner not initialized"}, 503)
    body = await request.json()
    try:
        ra = deps.remote_runner.spawn_ssh(
            body.get("base", ""), body.get("name", ""),
            body.get("host", ""), workspace=body.get("workspace", "~"),
            user=body.get("user"), env=body.get("env", {}),
        )
        return {"name": ra.name, "host": ra.host, "state": ra.state, "error": ra.error}
    except RuntimeError as e:
        return JSONResponse({"error": str(e)}, 400)


@router.get("/api/remote/agents")
async def remote_list():
    if not deps.remote_runner:
        return {"agents": []}
    return {"agents": deps.remote_runner.list_agents()}


@router.post("/api/remote/stop/{name}")
async def remote_stop(name: str):
    if not deps.remote_runner:
        return JSONResponse({"error": "not initialized"}, 503)
    return {"ok": deps.remote_runner.stop(name)}


# ── User Auth (Phase 6.2) ────────────────────────────────────────

@router.post("/api/auth/login")
async def auth_login(request: Request):
    if not deps.user_manager or not deps.user_manager.is_enabled():
        return {"token": "anonymous", "role": "admin", "multi_user": False}
    body = await request.json()
    token = deps.user_manager.authenticate(body.get("username", ""), body.get("password", ""))
    if not token:
        return JSONResponse({"error": "Invalid credentials"}, 401)
    user = deps.user_manager.validate_token(token)
    return {"token": token, "username": user["username"], "role": user["role"], "multi_user": True}


@router.post("/api/auth/register")
async def auth_register(request: Request):
    if not deps.user_manager:
        return JSONResponse({"error": "Auth not initialized"}, 503)
    body = await request.json()
    requested_role = body.get("role", "member")
    try:
        if not deps.user_manager.has_admin():
            if not _is_local_request(request):
                return JSONResponse({"error": "Initial admin bootstrap is localhost only"}, 403)
            requested_role = "admin"
        else:
            session_user = _get_session_user(request)
            if not session_user or session_user.get("role") != "admin":
                return JSONResponse({"error": "Admin authentication required"}, 403)
        user = deps.user_manager.create_user(
            body.get("username", ""), body.get("password", ""),
            role=requested_role,
        )
        return user
    except ValueError as e:
        return JSONResponse({"error": str(e)}, 400)


@router.get("/api/auth/users")
async def auth_list_users(request: Request):
    if not deps.user_manager:
        return {"users": []}
    session_user = _get_session_user(request)
    if not session_user or session_user.get("role") != "admin":
        return JSONResponse({"error": "Admin authentication required"}, 403)
    return {"users": deps.user_manager.list_users()}


@router.post("/api/auth/logout")
async def auth_logout(request: Request):
    if not deps.user_manager:
        return {"ok": True}
    body = await request.json()
    deps.user_manager.logout(body.get("token", ""))
    return {"ok": True}


# ── Personas (Phase 5) ────────────────────────────────────────────

@router.get("/api/personas")
async def list_personas():
    data = _load_json_file("personas.json", {"personas": []})
    personas = data.get("personas", [])
    if not isinstance(personas, list):
        personas = []
    return {"personas": personas}


@router.post("/api/personas")
async def create_persona(request: Request):
    body = await request.json()
    name = (body.get("name", "") or "").strip()
    instructions = (body.get("instructions", "") or "").strip()
    description = (body.get("description", "") or "").strip()
    if not name or not instructions or not description:
        return JSONResponse({"error": "name, description, and instructions required"}, 400)

    category = (body.get("category", "custom") or "custom").strip()
    if category not in _PERSONA_CATEGORIES:
        return JSONResponse({"error": "invalid category"}, 400)

    persona = {
        "id": secrets.token_hex(8),
        "name": name[:80],
        "role": (body.get("role", category) or category).strip()[:40],
        "description": description[:500],
        "icon": (body.get("icon", "person") or "person").strip()[:40],
        "color": (body.get("color", "#8b5cf6") or "#8b5cf6").strip()[:20],
        "instructions": instructions[:8000],
        "skills": [str(skill).strip()[:60] for skill in body.get("skills", []) if str(skill).strip()][:12],
        "category": category,
        "author": (body.get("author") or deps._settings.get("username") or "GhostLink").strip()[:80],
        "installs": int(body.get("installs", 0) or 0),
        "rating": body.get("rating"),
        "created_at": time.time(),
    }

    data = _load_json_file("personas.json", {"personas": []})
    personas = data.get("personas", [])
    if not isinstance(personas, list):
        personas = []
    personas.append(persona)
    _save_json_file("personas.json", {"personas": personas})
    return {"ok": True, "persona": persona}


@router.patch("/api/personas/{persona_id}")
async def update_persona(persona_id: str, request: Request):
    safe_id = _ensure_safe_id(persona_id, "persona id")
    if not safe_id:
        return JSONResponse({"error": "invalid persona id"}, 400)

    body = await request.json()
    data = _load_json_file("personas.json", {"personas": []})
    personas = data.get("personas", [])
    if not isinstance(personas, list):
        personas = []

    for persona in personas:
        if persona.get("id") != safe_id:
            continue
        if "name" in body and str(body["name"]).strip():
            persona["name"] = str(body["name"]).strip()[:80]
        if "description" in body and str(body["description"]).strip():
            persona["description"] = str(body["description"]).strip()[:500]
        if "instructions" in body and str(body["instructions"]).strip():
            persona["instructions"] = str(body["instructions"]).strip()[:8000]
        if "role" in body and str(body["role"]).strip():
            persona["role"] = str(body["role"]).strip()[:40]
        if "icon" in body and str(body["icon"]).strip():
            persona["icon"] = str(body["icon"]).strip()[:40]
        if "color" in body and str(body["color"]).strip():
            persona["color"] = str(body["color"]).strip()[:20]
        if "category" in body:
            category = str(body["category"]).strip()
            if category not in _PERSONA_CATEGORIES:
                return JSONResponse({"error": "invalid category"}, 400)
            persona["category"] = category
        if "skills" in body and isinstance(body["skills"], list):
            persona["skills"] = [str(skill).strip()[:60] for skill in body["skills"] if str(skill).strip()][:12]
        _save_json_file("personas.json", {"personas": personas})
        return {"ok": True, "persona": persona}

    return JSONResponse({"error": "persona not found"}, 404)


@router.delete("/api/personas/{persona_id}")
async def delete_persona(persona_id: str):
    safe_id = _ensure_safe_id(persona_id, "persona id")
    if not safe_id:
        return JSONResponse({"error": "invalid persona id"}, 400)

    data = _load_json_file("personas.json", {"personas": []})
    personas = data.get("personas", [])
    if not isinstance(personas, list):
        personas = []
    kept = [persona for persona in personas if persona.get("id") != safe_id]
    if len(kept) == len(personas):
        return JSONResponse({"error": "persona not found"}, 404)
    _save_json_file("personas.json", {"personas": kept})
    return {"ok": True}


# ── Custom Rules (Phase 6) ─────────────────────────────────────────

@router.get("/api/custom-rules")
async def list_custom_rules():
    data = _load_json_file("custom_rules.json", {"rules": []})
    rules = data.get("rules", [])
    if not isinstance(rules, list):
        rules = []
    return {"rules": rules}


@router.post("/api/custom-rules")
async def create_custom_rule(request: Request):
    body = await request.json()
    scope = (body.get("scope", "") or "").strip()
    category = (body.get("category", "") or "").strip()
    text = (body.get("text", "") or "").strip()
    agent = (body.get("agent", "") or "").strip()

    if scope not in _RULE_SCOPES:
        return JSONResponse({"error": "invalid scope"}, 400)
    if category not in _RULE_CATEGORIES:
        return JSONResponse({"error": "invalid category"}, 400)
    if not text:
        return JSONResponse({"error": "text required"}, 400)
    if agent and not deps._VALID_AGENT_NAME.fullmatch(agent):
        return JSONResponse({"error": "invalid agent"}, 400)

    rule = {
        "id": secrets.token_hex(8),
        "scope": scope,
        "agent": agent or None,
        "category": category,
        "text": text[:2000],
        "enabled": bool(body.get("enabled", True)),
        "created_at": time.time(),
    }

    data = _load_json_file("custom_rules.json", {"rules": []})
    rules = data.get("rules", [])
    if not isinstance(rules, list):
        rules = []
    rules.append(rule)
    _save_json_file("custom_rules.json", {"rules": rules})
    return {"ok": True, "rule": rule}


@router.patch("/api/custom-rules/{rule_id}")
async def update_custom_rule(rule_id: str, request: Request):
    safe_id = _ensure_safe_id(rule_id, "rule id")
    if not safe_id:
        return JSONResponse({"error": "invalid rule id"}, 400)

    body = await request.json()
    data = _load_json_file("custom_rules.json", {"rules": []})
    rules = data.get("rules", [])
    if not isinstance(rules, list):
        rules = []

    for rule in rules:
        if rule.get("id") != safe_id:
            continue
        if "enabled" in body:
            rule["enabled"] = bool(body["enabled"])
        if "text" in body and str(body["text"]).strip():
            rule["text"] = str(body["text"]).strip()[:2000]
        if "category" in body:
            category = str(body["category"]).strip()
            if category not in _RULE_CATEGORIES:
                return JSONResponse({"error": "invalid category"}, 400)
            rule["category"] = category
        _save_json_file("custom_rules.json", {"rules": rules})
        return {"ok": True, "rule": rule}

    return JSONResponse({"error": "rule not found"}, 404)


@router.delete("/api/custom-rules/{rule_id}")
async def delete_custom_rule(rule_id: str):
    safe_id = _ensure_safe_id(rule_id, "rule id")
    if not safe_id:
        return JSONResponse({"error": "invalid rule id"}, 400)

    data = _load_json_file("custom_rules.json", {"rules": []})
    rules = data.get("rules", [])
    if not isinstance(rules, list):
        rules = []
    kept = [rule for rule in rules if rule.get("id") != safe_id]
    if len(kept) == len(rules):
        return JSONResponse({"error": "rule not found"}, 404)
    _save_json_file("custom_rules.json", {"rules": kept})
    return {"ok": True}


# ── Collaborative Workspace (Phase 7) ──────────────────────────────

@router.get("/api/workspace/collaborators")
async def list_workspace_collaborators():
    if deps._workspace_collaborators:
        return {"collaborators": list_live_workspace_collaborators()}

    if not deps.user_manager or not deps.user_manager.is_enabled():
        return {"collaborators": []}

    collaborators = []
    seen = set()
    for session in deps.user_manager.list_active_sessions():
        username = session.get("username", "")
        if not username or username in seen:
            continue
        seen.add(username)
        collaborators.append({
            "id": username,
            "username": username,
            "color": _username_color(username),
            "status": "active",
            "viewing": None,
            "cursor": None,
            "joined_at": session.get("created_at", time.time()),
            "last_seen": session.get("last_seen", session.get("created_at", time.time())),
            "connections": 1,
        })
    return {"collaborators": collaborators}


@router.get("/api/workspace/invites")
async def list_workspace_invites():
    data = _load_json_file("workspace_invites.json", {"invites": []})
    invites = data.get("invites", [])
    if not isinstance(invites, list):
        invites = []
    now = time.time()
    active = [
        invite for invite in invites
        if float(invite.get("expires_at", 0) or 0) > now
        and int(invite.get("uses", 0) or 0) < int(invite.get("max_uses", 0) or 0)
    ]
    if len(active) != len(invites):
        _save_json_file("workspace_invites.json", {"invites": active})
    return {"invites": active}


@router.post("/api/workspace/invites")
async def create_workspace_invite(request: Request):
    body = await request.json()
    max_uses = int(body.get("max_uses", 5) or 5)
    expires_hours = int(body.get("expires_hours", 24) or 24)
    if max_uses < 1 or max_uses > 100:
        return JSONResponse({"error": "max_uses must be between 1 and 100"}, 400)
    if expires_hours < 1 or expires_hours > 24 * 30:
        return JSONResponse({"error": "expires_hours must be between 1 and 720"}, 400)

    invite = {
        "id": secrets.token_hex(8),
        "code": secrets.token_urlsafe(9),
        "created_at": time.time(),
        "expires_at": time.time() + expires_hours * 3600,
        "uses": 0,
        "max_uses": max_uses,
        "created_by": deps._settings.get("username", "You"),
    }

    data = _load_json_file("workspace_invites.json", {"invites": []})
    invites = data.get("invites", [])
    if not isinstance(invites, list):
        invites = []
    invites.append(invite)
    _save_json_file("workspace_invites.json", {"invites": invites})
    await broadcast_workspace_invites()
    return {"ok": True, "invite": invite}


@router.post("/api/workspace/invites/redeem")
async def redeem_workspace_invite(request: Request):
    body = await request.json()
    code = (body.get("code", "") or "").strip()
    if not code:
        return JSONResponse({"error": "invite code required"}, 400)

    data = _load_json_file("workspace_invites.json", {"invites": []})
    invites = data.get("invites", [])
    if not isinstance(invites, list):
        invites = []

    now = time.time()
    for invite in invites:
        if invite.get("code") != code:
            continue
        if float(invite.get("expires_at", 0) or 0) <= now:
            return JSONResponse({"error": "invite expired"}, 400)
        if int(invite.get("uses", 0) or 0) >= int(invite.get("max_uses", 0) or 0):
            return JSONResponse({"error": "invite exhausted"}, 400)
        invite["uses"] = int(invite.get("uses", 0) or 0) + 1
        invite["redeemed_at"] = now
        _save_json_file("workspace_invites.json", {"invites": invites})
        await broadcast_workspace_invites()
        return {"ok": True, "invite": invite}

    return JSONResponse({"error": "invite not found"}, 404)


@router.delete("/api/workspace/invites/{invite_id}")
async def delete_workspace_invite(invite_id: str):
    safe_id = _ensure_safe_id(invite_id, "invite id")
    if not safe_id:
        return JSONResponse({"error": "invalid invite id"}, 400)

    data = _load_json_file("workspace_invites.json", {"invites": []})
    invites = data.get("invites", [])
    if not isinstance(invites, list):
        invites = []
    kept = [invite for invite in invites if invite.get("id") != safe_id]
    if len(kept) == len(invites):
        return JSONResponse({"error": "invite not found"}, 404)
    _save_json_file("workspace_invites.json", {"invites": kept})
    await broadcast_workspace_invites()
    return {"ok": True}


async def update_workspace_presence(connection_id: int, payload: dict) -> None:
    username = (payload.get("username", "") or "").strip()
    if not username:
        return

    current_user = deps._workspace_ws_users.get(connection_id)
    now = time.time()
    next_presence = {
        "id": username,
        "username": username[:80],
        "color": (payload.get("color") or _username_color(username)).strip()[:20],
        "status": (payload.get("status") or "active").strip() if payload.get("status") in {"active", "idle", "away"} else "active",
        "viewing": (payload.get("viewing") or "").strip()[:160] or None,
        "cursor": payload.get("cursor") if isinstance(payload.get("cursor"), dict) else None,
        "joined_at": float(payload.get("joined_at") or now),
        "last_seen": now,
        "connections": 1,
    }

    if current_user and current_user != username:
        existing = deps._workspace_collaborators.get(current_user)
        if existing:
            remaining = max(0, int(existing.get("connections", 1)) - 1)
            if remaining <= 0:
                deps._workspace_collaborators.pop(current_user, None)
            else:
                existing["connections"] = remaining

    deps._workspace_ws_users[connection_id] = username
    existing = deps._workspace_collaborators.get(username)
    if existing:
        existing_connections = max(1, int(existing.get("connections", 1)))
        next_presence["connections"] = existing_connections if current_user == username else existing_connections + 1
        next_presence["joined_at"] = float(existing.get("joined_at", next_presence["joined_at"]))
        if next_presence["cursor"] is None:
            next_presence["cursor"] = existing.get("cursor")
        if next_presence["viewing"] is None:
            next_presence["viewing"] = existing.get("viewing")
    deps._workspace_collaborators[username] = next_presence
    await broadcast_workspace_collaborators()


async def remove_workspace_presence(connection_id: int) -> None:
    username = deps._workspace_ws_users.pop(connection_id, None)
    if not username:
        return
    existing = deps._workspace_collaborators.get(username)
    if not existing:
        return
    remaining = max(0, int(existing.get("connections", 1)) - 1)
    if remaining <= 0:
        deps._workspace_collaborators.pop(username, None)
    else:
        existing["connections"] = remaining
        existing["last_seen"] = time.time()
    await broadcast_workspace_collaborators()
