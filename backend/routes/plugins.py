"""Plugin, marketplace, skill-pack, and hooks routes.

Note: GET/POST/DELETE /api/plugins/* (enable/disable/install/uninstall) are
registered inside lifespan in app.py since they need plugin_loader. Only the
routes that don't depend on lifespan state are here.
"""
from __future__ import annotations

import deps
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from plugin_sdk import SafetyScanner, SKILL_PACKS, EVENTS

router = APIRouter()


# ── GhostHub Marketplace ─────────────────────────────────────────────

@router.get("/api/marketplace")
async def browse_marketplace(category: str = "", search: str = ""):
    """Browse available plugins in the GhostHub marketplace."""
    plugins = deps.marketplace.browse(category, search)
    categories = deps.marketplace.get_categories()
    return {"plugins": plugins, "categories": categories}


@router.post("/api/marketplace/{plugin_id}/install")
async def install_marketplace_plugin(plugin_id: str):
    """Install a plugin from the GhostHub marketplace."""
    result = deps.marketplace.install(plugin_id)
    if result.get("ok"):
        return result
    return JSONResponse(result, 400)


@router.post("/api/marketplace/{plugin_id}/uninstall")
async def uninstall_marketplace_plugin(plugin_id: str):
    """Uninstall a marketplace plugin."""
    result = deps.marketplace.uninstall(plugin_id)
    return result


@router.post("/api/plugins/scan")
async def scan_plugin_code(request: Request):
    """Scan plugin code for safety issues (AST-based analysis)."""
    body = await request.json()
    code = body.get("code", "")
    if not code:
        return JSONResponse({"error": "code required"}, 400)
    issues = SafetyScanner.scan(code)
    return {"issues": issues, "safe": len([i for i in issues if i["severity"] == "critical"]) == 0}


# ── Skill Packs ──────────────────────────────────────────────────────

@router.get("/api/skill-packs")
async def list_skill_packs():
    """List available skill packs."""
    return {"packs": SKILL_PACKS}


@router.post("/api/skill-packs/{pack_id}/apply")
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
        deps.skills_registry.enable_skill(agent_name, skill_id)

    return {"ok": True, "agent": agent_name, "pack": pack_id, "skills_enabled": pack["skills"]}


# ── Hooks (Event-Driven Automation) ─────────────────────────────────

@router.get("/api/hooks")
async def list_hooks():
    """List all automation hooks."""
    return {"hooks": deps.hook_manager.list_hooks(), "events": EVENTS}


@router.post("/api/hooks")
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

    result = deps.hook_manager.create_hook(name, event, action, config)
    if result.get("ok"):
        return result
    return JSONResponse(result, 400)


@router.patch("/api/hooks/{hook_id}")
async def update_hook(hook_id: str, request: Request):
    """Update an automation hook."""
    body = await request.json()
    result = deps.hook_manager.update_hook(hook_id, body)
    if result.get("ok"):
        return result
    return JSONResponse(result, 404)


@router.delete("/api/hooks/{hook_id}")
async def delete_hook(hook_id: str):
    """Delete an automation hook."""
    result = deps.hook_manager.delete_hook(hook_id)
    return result
