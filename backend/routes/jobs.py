"""Job management routes."""
from __future__ import annotations

import deps
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

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
    return job


@router.patch("/api/jobs/{job_id}")
async def update_job(job_id: int, request: Request):
    body = await request.json()
    job = await deps.job_store.update(job_id, body)
    if job:
        await deps.broadcast("job_update", job)
        return job
    return JSONResponse({"error": "not found"}, 404)


@router.delete("/api/jobs/{job_id}")
async def delete_job(job_id: int):
    ok = await deps.job_store.delete(job_id)
    return {"ok": ok}
