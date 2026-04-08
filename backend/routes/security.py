"""Security routes — secrets, exec policy, audit log, GDPR."""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

import deps

router = APIRouter()


@router.get("/api/security/secrets")
async def list_secrets():
    """List stored secret keys (values redacted)."""
    return {"secrets": deps.secrets_manager.list_keys()}


@router.post("/api/security/secrets")
async def set_secret(request: Request):
    """Store a secret (API key, token, etc.)."""
    body = await request.json()
    key = (body.get("key", "") or "").strip()
    value = (body.get("value", "") or "").strip()
    if not key or not value:
        return JSONResponse({"error": "key and value required"}, 400)
    if len(key) > 100 or len(value) > 10000:
        return JSONResponse({"error": "key max 100 chars, value max 10000 chars"}, 400)
    deps.secrets_manager.set(key, value)
    deps.audit_log.log("secret_set", {"key": key}, actor="user")
    return {"ok": True, "key": key}


@router.delete("/api/security/secrets/{key}")
async def delete_secret(key: str):
    ok = deps.secrets_manager.delete(key)
    if ok:
        deps.audit_log.log("secret_delete", {"key": key}, actor="user")
    return {"ok": ok}


@router.get("/api/security/exec-policies")
async def list_exec_policies():
    return {"policies": deps.exec_policy.list_policies()}


@router.get("/api/security/exec-policy/{agent_name}")
async def get_exec_policy(agent_name: str):
    return {"policy": deps.exec_policy.get_policy(agent_name)}


@router.post("/api/security/exec-policy/{agent_name}")
async def set_exec_policy(agent_name: str, request: Request):
    body = await request.json()
    policy = deps.exec_policy.set_policy(agent_name, body)
    deps.audit_log.log("exec_policy_update", {"agent": agent_name}, actor="user")
    return {"ok": True, "policy": policy}


@router.get("/api/security/policy-rules")
async def list_policy_rules():
    if deps.policy_engine is None:
        return {"rules": []}
    return {"rules": await deps.policy_engine.list_rules()}


@router.post("/api/security/policy-rules")
async def create_policy_rule(request: Request):
    if deps.policy_engine is None:
        return JSONResponse({"error": "policy engine unavailable"}, 503)
    body = await request.json()
    await deps.policy_engine.upsert_rule(
        scope_type=str(body.get("scope_type", "environment") or "environment"),
        scope_id=str(body.get("scope_id", "*") or "*"),
        action=str(body.get("action", "*") or "*"),
        tier=str(body.get("tier", "high_risk_write") or "high_risk_write"),
        behavior=str(body.get("behavior", "ask") or "ask"),
        priority=int(body.get("priority", 0) or 0),
        conditions=body.get("conditions", {}) if isinstance(body.get("conditions", {}), dict) else {},
        created_by=str(body.get("created_by", "user") or "user"),
        enabled=bool(body.get("enabled", True)),
    )
    deps.audit_log.log("policy_rule_upsert", {"scope_type": body.get("scope_type", ""), "scope_id": body.get("scope_id", "*"), "action": body.get("action", "*")}, actor="user")
    return {"ok": True, "rules": await deps.policy_engine.list_rules()}


@router.get("/api/security/egress-rules")
async def list_egress_rules():
    if deps.policy_engine is None:
        return {"rules": []}
    return {"rules": await deps.policy_engine.list_egress_rules()}


@router.post("/api/security/egress-rules")
async def create_egress_rule(request: Request):
    if deps.policy_engine is None:
        return JSONResponse({"error": "policy engine unavailable"}, 503)
    body = await request.json()
    await deps.policy_engine.add_egress_rule(
        scope_type=str(body.get("scope_type", "environment") or "environment"),
        scope_id=str(body.get("scope_id", "*") or "*"),
        rule_type=str(body.get("rule_type", "allow") or "allow"),
        domain=str(body.get("domain", "") or "").strip().lower(),
        protocol=str(body.get("protocol", "*") or "*"),
        port=int(body.get("port", 0) or 0),
        priority=int(body.get("priority", 0) or 0),
    )
    deps.audit_log.log("egress_rule_upsert", {"scope_type": body.get("scope_type", ""), "scope_id": body.get("scope_id", "*"), "domain": body.get("domain", "")}, actor="user")
    return {"ok": True, "rules": await deps.policy_engine.list_egress_rules()}


@router.get("/api/security/secret-scopes")
async def list_secret_scopes():
    if deps.policy_engine is None:
        return {"scopes": []}
    return {"scopes": await deps.policy_engine.list_secret_scopes()}


@router.post("/api/security/secret-scopes")
async def bind_secret_scope(request: Request):
    if deps.policy_engine is None:
        return JSONResponse({"error": "policy engine unavailable"}, 503)
    body = await request.json()
    key = str(body.get("secret_key", "") or "").strip()
    if not key:
        return JSONResponse({"error": "secret_key required"}, 400)
    await deps.policy_engine.bind_secret_scope(
        key,
        str(body.get("scope_type", "environment") or "environment"),
        str(body.get("scope_id", "*") or "*"),
    )
    deps.audit_log.log("secret_scope_bind", {"secret_key": key, "scope_type": body.get("scope_type", ""), "scope_id": body.get("scope_id", "*")}, actor="user")
    return {"ok": True, "scopes": await deps.policy_engine.list_secret_scopes()}


@router.post("/api/security/trusted-hooks")
async def trust_hook_signature(request: Request):
    if deps.policy_engine is None:
        return JSONResponse({"error": "policy engine unavailable"}, 503)
    body = await request.json()
    hook_name = str(body.get("hook_name", "") or "").strip()
    signature = str(body.get("signature", "") or "").strip()
    if not hook_name or not signature:
        return JSONResponse({"error": "hook_name and signature required"}, 400)
    await deps.policy_engine.trust_hook_signature(hook_name, signature)
    deps.audit_log.log("trusted_hook_signature", {"hook_name": hook_name}, actor="user")
    return {"ok": True}


@router.get("/api/security/circuit-events")
async def list_circuit_events(limit: int = 100):
    if deps.policy_engine is None:
        return {"events": []}
    return {"events": await deps.policy_engine.list_circuit_events(limit)}


@router.post("/api/security/check-command")
async def check_command(request: Request):
    """Check if a command would be allowed for an agent."""
    body = await request.json()
    agent = body.get("agent", "")
    command = body.get("command", "")
    if not command:
        return JSONResponse({"error": "command required"}, 400)
    result = await deps.exec_policy.check_command_async(
        agent,
        command,
        task_id=str(body.get("task_id", "") or ""),
        profile_id=str(body.get("profile_id", "") or ""),
        sandbox_tier=str(body.get("sandbox_tier", "none") or "none"),
        sandbox_root=str(body.get("sandbox_root", "") or ""),
        policy_snapshot=body.get("policy_snapshot"),
    )
    return result


@router.get("/api/security/audit-log")
async def get_audit_log(limit: int = 100, event_type: str = ""):
    return {"entries": deps.audit_log.get_recent(limit, event_type)}


@router.get("/api/security/tool-log")
async def get_tool_log(limit: int = 100, agent: str = ""):
    """Get MCP tool usage log — every tool call with agent, tool name, timestamps."""
    entries = deps.audit_log.get_recent(limit * 2, "tool_use")
    if agent:
        entries = [e for e in entries if e.get("actor") == agent]
    return {"entries": entries[-limit:]}


@router.get("/api/security/permission-presets")
async def get_permission_presets():
    """List available permission presets for agents."""
    from sandbox import list_presets
    return {"presets": list_presets()}


@router.get("/api/security/sandbox-modes")
async def get_sandbox_modes():
    """List available sandbox modes based on installed tools."""
    from sandbox import SandboxManager
    mgr = SandboxManager()
    return {"modes": mgr.get_available_modes()}


@router.get("/api/security/retention")
async def get_retention():
    return {"policy": deps.data_manager.get_retention()}


@router.post("/api/security/retention")
async def set_retention(request: Request):
    body = await request.json()
    deps.data_manager.save_retention(body)
    deps.audit_log.log("retention_update", body, actor="user")
    return {"ok": True, "policy": deps.data_manager.get_retention()}


@router.get("/api/security/export")
async def export_data():
    """Export all user data as ZIP (GDPR data portability)."""
    zip_bytes = await deps.data_manager.export_all_data()
    deps.audit_log.log("data_export", {"size": len(zip_bytes)}, actor="user")
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=ghostlink-export.zip"},
    )


@router.post("/api/security/delete-all")
async def delete_all_data(request: Request):
    """Delete all user data (GDPR right to erasure). Requires confirmation."""
    body = await request.json()
    if body.get("confirm") != "DELETE_ALL_DATA":
        return JSONResponse({"error": "Send {confirm: 'DELETE_ALL_DATA'} to confirm"}, 400)
    result = await deps.data_manager.delete_all_data()
    return result


@router.post("/api/security/apply-retention")
async def apply_retention():
    """Apply retention policy — delete old messages."""
    result = await deps.data_manager.apply_retention()
    if result.get("ok"):
        deps.audit_log.log("retention_applied", result, actor="system")
    return result
