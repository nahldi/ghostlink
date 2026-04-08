"""Unified task routes."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import deps

router = APIRouter()


def _resolve_agent(identifier: str):
    if not deps.registry or not identifier:
        return None
    inst = deps.registry.resolve(identifier)
    if inst:
        return inst
    return deps.registry.get(identifier)


async def _record_audit(event_type: str, actor: str, action: str, **kwargs) -> None:
    if deps.audit_store is not None:
        await deps.audit_store.record(event_type, actor, action, **kwargs)
    if deps.audit_log is not None:
        deps.audit_log.log(event_type, kwargs.get("detail", {}), actor=actor or "system")


def _cancel_signal_path(task: dict) -> Path | None:
    agent_id = task.get("agent_id") or ""
    agent_name = task.get("agent_name") or ""
    if agent_id:
        return deps.DATA_DIR / "agents" / agent_id / f".cancel_{task['task_id']}"
    if agent_name:
        return deps.DATA_DIR / "agents" / agent_name / f".cancel_{task['task_id']}"
    return None


@router.get("/api/tasks")
async def list_tasks(
    channel: str | None = None,
    agent: str | None = None,
    status: str | None = None,
    trace_id: str | None = None,
    parent_task_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    tasks = await deps.task_store.list_tasks(
        channel=channel,
        agent_name=agent,
        status=status,
        trace_id=trace_id,
        parent_task_id=parent_task_id,
        limit=limit,
        offset=offset,
    )
    return {"tasks": tasks}


@router.post("/api/tasks")
async def create_task(request: Request):
    body = await request.json()
    title = str(body.get("title", "") or "").strip()
    if not title:
        return JSONResponse({"error": "title required"}, 400)
    agent_name = str(body.get("agent_name", body.get("agent", "")) or "").strip()
    inst = _resolve_agent(agent_name) if agent_name else None
    task = await deps.task_store.create(
        title=title[:200],
        description=str(body.get("description", "") or "")[:4000],
        channel=str(body.get("channel", "general") or "general")[:80] or "general",
        agent_id=getattr(inst, "agent_id", None),
        agent_name=getattr(inst, "name", None) if inst else (agent_name or None),
        profile_id=getattr(inst, "profile_id", None),
        source_type=str(body.get("source_type", "manual") or "manual"),
        source_ref=str(body.get("source_ref", "") or "") or None,
        parent_task_id=str(body.get("parent_task_id", "") or "") or None,
        trace_id=str(body.get("trace_id", "") or "") or None,
        priority=int(body.get("priority", 0) or 0),
        created_by=str(body.get("created_by", "") or ""),
        metadata=body.get("metadata", {}),
    )
    await deps.broadcast("task_update", task)
    await _record_audit(
        "task.created",
        actor=task.get("created_by", "") or "user",
        action="created task",
        agent_id=task.get("agent_id"),
        agent_name=task.get("agent_name"),
        task_id=task.get("task_id"),
        trace_id=task.get("trace_id"),
        channel=task.get("channel"),
        profile_id=task.get("profile_id"),
        detail={"title": task.get("title"), "source_type": task.get("source_type")},
    )
    return task


@router.get("/api/tasks/{task_id}")
async def get_task(task_id: str):
    task = await deps.task_store.get(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, 404)
    return task


@router.patch("/api/tasks/{task_id}")
async def update_task(task_id: str, request: Request):
    body = await request.json()
    task = await deps.task_store.update(
        task_id,
        title=body.get("title"),
        description=body.get("description"),
        status=body.get("status"),
        priority=body.get("priority"),
        channel=body.get("channel"),
        trace_id=body.get("trace_id"),
        error=body.get("error"),
        metadata=body.get("metadata"),
    )
    if not task:
        return JSONResponse({"error": "not found"}, 404)
    await deps.broadcast("task_update", task)
    return task


@router.post("/api/tasks/{task_id}/progress")
async def update_task_progress(task_id: str, request: Request):
    body = await request.json()
    steps = body.get("steps", [])
    total = int(body.get("total", len(steps)) or len(steps))
    pct = int(body.get("pct", 0) or 0)
    task = await deps.task_store.update_progress(
        task_id,
        pct=pct,
        step=str(body.get("step", "") or "")[:200],
        total=total,
        steps_data=steps if isinstance(steps, list) else [],
    )
    if not task:
        return JSONResponse({"error": "not found"}, 404)
    payload = {
        "task_id": task["task_id"],
        "agent_name": task.get("agent_name"),
        "progress_pct": task["progress_pct"],
        "progress_step": task["progress_step"],
        "progress_total": task["progress_total"],
        "steps": task["progress_data"].get("steps", task["progress_data"]) if isinstance(task["progress_data"], dict) else task["progress_data"],
        "updated_at": task["updated_at"],
    }
    await deps.broadcast("task_progress", payload)
    return task


@router.post("/api/tasks/{task_id}/cancel")
async def cancel_task(task_id: str):
    task = await deps.task_store.cancel(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, 404)
    signal_path = _cancel_signal_path(task)
    if signal_path is not None:
        signal_path.parent.mkdir(parents=True, exist_ok=True)
        signal_path.write_text(
            json.dumps({"task_id": task["task_id"], "agent_name": task.get("agent_name", "")}),
            encoding="utf-8",
        )
    await deps.broadcast("task_update", task)
    await _record_audit(
        "task.cancelled",
        actor="user",
        action="cancelled task",
        agent_id=task.get("agent_id"),
        agent_name=task.get("agent_name"),
        task_id=task.get("task_id"),
        trace_id=task.get("trace_id"),
        channel=task.get("channel"),
        profile_id=task.get("profile_id"),
        detail={"signal_path": str(signal_path) if signal_path else ""},
    )
    return task


@router.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str):
    ok = await deps.task_store.delete(task_id)
    return {"ok": ok}
