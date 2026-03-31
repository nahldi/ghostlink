"""Job management routes."""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import deps

router = APIRouter()


@router.get("/api/jobs")
async def list_jobs(channel: str | None = None, status: str | None = None):
    jobs = await deps.job_store.list_jobs(channel, status)
    return {"jobs": jobs}


@router.post("/api/jobs")
async def create_job(request: Request):
    body = await request.json()
    job = await deps.job_store.create(
        title=body.get("title", ""),
        channel=body.get("channel", "general"),
        created_by=body.get("created_by", ""),
        assignee=body.get("assignee", ""),
        body=body.get("body", ""),
        job_type=body.get("type", ""),
    )
    await deps.broadcast("job_update", job)
    if getattr(deps, "automation_manager", None):
        await deps.automation_manager.process_trigger("event", {
            "event": "job_created",
            "job_id": job.get("id"),
            "title": job.get("title", ""),
            "channel": job.get("channel", "general"),
            "assignee": job.get("assignee", ""),
            "status": job.get("status", ""),
        })
    return job


@router.patch("/api/jobs/{job_id}")
async def update_job(job_id: int, request: Request):
    body = await request.json()
    job = await deps.job_store.update(job_id, body)
    if job:
        await deps.broadcast("job_update", job)
        if getattr(deps, "automation_manager", None):
            event_name = "job_completed" if job.get("status") == "done" else "job_updated"
            await deps.automation_manager.process_trigger("event", {
                "event": event_name,
                "job_id": job.get("id"),
                "title": job.get("title", ""),
                "channel": job.get("channel", "general"),
                "assignee": job.get("assignee", ""),
                "status": job.get("status", ""),
            })
        return job
    return JSONResponse({"error": "not found"}, 404)


@router.delete("/api/jobs/{job_id}")
async def delete_job(job_id: int):
    ok = await deps.job_store.delete(job_id)
    return {"ok": ok}
