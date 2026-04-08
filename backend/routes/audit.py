"""Structured audit routes."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse, PlainTextResponse

import deps

router = APIRouter()


@router.get("/api/audit/events")
async def search_audit_events(
    event_type: str = "",
    actor: str = "",
    agent: str = "",
    task_id: str = "",
    trace_id: str = "",
    channel: str = "",
    provider: str = "",
    outcome: str = "",
    since: float | None = None,
    until: float | None = None,
    limit: int = 100,
    offset: int = 0,
):
    events = await deps.audit_store.search(
        event_type=event_type or None,
        actor=actor or None,
        agent_name=agent or None,
        task_id=task_id or None,
        trace_id=trace_id or None,
        channel=channel or None,
        provider=provider or None,
        outcome=outcome or None,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )
    return {"events": events}


@router.get("/api/audit/events/{event_id}")
async def get_audit_event(event_id: str):
    event = await deps.audit_store.get(event_id)
    if not event:
        return JSONResponse({"error": "not found"}, 404)
    return event


@router.get("/api/audit/export")
async def export_audit(
    format: str = "json",
    event_type: str = "",
    actor: str = "",
    agent: str = "",
    task_id: str = "",
    trace_id: str = "",
    channel: str = "",
    provider: str = "",
    outcome: str = "",
    since: float | None = None,
    until: float | None = None,
    limit: int = 1000,
):
    filters = {
        "event_type": event_type or None,
        "actor": actor or None,
        "agent_name": agent or None,
        "task_id": task_id or None,
        "trace_id": trace_id or None,
        "channel": channel or None,
        "provider": provider or None,
        "outcome": outcome or None,
        "since": since,
        "until": until,
        "limit": limit,
    }
    if format == "csv":
        csv_text = await deps.audit_store.export_csv(**filters)
        return PlainTextResponse(csv_text, media_type="text/csv")
    if format != "json":
        return JSONResponse({"error": "format must be json or csv"}, 400)
    return {"events": await deps.audit_store.export_json(**filters)}


@router.get("/api/audit/stats")
async def audit_stats(limit: int = 1000):
    return await deps.audit_store.stats(limit=limit)
