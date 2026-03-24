"""Rules management routes."""
from __future__ import annotations

import deps
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/api/rules")
async def list_rules():
    rules = await deps.rule_store.list_all()
    return {"rules": rules}


@router.get("/api/rules/active")
async def active_rules():
    return await deps.rule_store.active_list()


@router.post("/api/rules")
async def propose_rule(request: Request):
    body = await request.json()
    rule = await deps.rule_store.propose(
        text=body.get("text", ""),
        author=body.get("author", ""),
        reason=body.get("reason", ""),
    )
    rules = await deps.rule_store.list_all()
    await deps.broadcast("rule_update", {"rules": rules})
    return rule


@router.patch("/api/rules/{rule_id}")
async def update_rule(rule_id: int, request: Request):
    body = await request.json()
    rule = await deps.rule_store.update(rule_id, body)
    if rule:
        rules = await deps.rule_store.list_all()
        await deps.broadcast("rule_update", {"rules": rules})
        return rule
    return JSONResponse({"error": "not found"}, 404)
