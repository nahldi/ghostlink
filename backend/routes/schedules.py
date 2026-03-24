"""Schedule management routes."""
from __future__ import annotations

import deps
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/api/schedules")
async def list_schedules():
    schedules = await deps.schedule_store.list_all()
    return {"schedules": schedules}


@router.post("/api/schedules")
async def create_schedule(request: Request):
    body = await request.json()
    sched = await deps.schedule_store.create(
        cron_expr=body.get("cron_expr", "*/5 * * * *"),
        agent=body.get("agent", ""),
        command=body.get("command", ""),
        channel=body.get("channel", "general"),
        enabled=body.get("enabled", True),
    )
    return sched


@router.patch("/api/schedules/{sched_id}")
async def update_schedule(sched_id: int, request: Request):
    body = await request.json()
    sched = await deps.schedule_store.update(sched_id, body)
    if sched:
        return sched
    return JSONResponse({"error": "not found"}, 404)


@router.delete("/api/schedules/{sched_id}")
async def delete_schedule(sched_id: int):
    ok = await deps.schedule_store.delete(sched_id)
    return {"ok": ok}
