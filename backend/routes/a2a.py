from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.responses import StreamingResponse

import deps

router = APIRouter()


def _manager():
    return deps.a2a_bridge


@router.get("/.well-known/agent-card.json")
async def well_known_agent_card(agent: str = ""):
    manager = _manager()
    if manager is None:
        return JSONResponse({"error": "A2A not initialized"}, 503)
    return manager.generate_agent_card(agent or None)


@router.get("/api/a2a/card")
async def api_agent_card(agent: str = ""):
    manager = _manager()
    if manager is None:
        return JSONResponse({"error": "A2A not initialized"}, 503)
    return manager.get_api_card(agent or None)


@router.put("/api/a2a/card")
async def update_api_agent_card(request: Request):
    manager = _manager()
    if manager is None:
        return JSONResponse({"error": "A2A not initialized"}, 503)
    body = await request.json()
    return manager.update_api_card(body if isinstance(body, dict) else {})


@router.get("/api/a2a/discovered")
async def list_discovered_agents():
    manager = _manager()
    if manager is None:
        return {"agents": []}
    return {"agents": manager.list_discovered()}


@router.post("/api/a2a/discover")
async def discover_agent(request: Request):
    manager = _manager()
    if manager is None:
        return JSONResponse({"error": "A2A not initialized"}, 503)
    body = await request.json()
    endpoint = str(body.get("endpoint") or body.get("url") or "").strip()
    if not endpoint:
        return JSONResponse({"error": "endpoint required"}, 400)
    try:
        discovered = await manager.discover(endpoint)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, 400)
    return {
        "source_url": discovered["card_url"],
        "fetched_at": discovered["discovered_at"],
        "agents": [discovered["frontend_card"]],
        "agent_card": discovered["frontend_card"],
    }


async def _delegate_remote_agent(request: Request):
    manager = _manager()
    if manager is None:
        return JSONResponse({"error": "A2A not initialized"}, 503)
    body = await request.json()
    endpoint = str(body.get("endpoint") or body.get("target_url") or "").strip()
    target_agent = str(body.get("target_agent") or body.get("remote_agent_id") or "").strip()
    prompt = str(body.get("prompt") or "").strip()
    if not endpoint or not target_agent or not prompt:
        return JSONResponse({"error": "endpoint, target_agent, and prompt required"}, 400)
    result = await manager.invoke_remote(
        endpoint=endpoint,
        target_agent=target_agent,
        prompt=prompt,
        local_agent_id=str(body.get("local_agent_id") or ""),
        local_agent_name=str(body.get("local_agent_name") or ""),
        channel=str(body.get("channel") or "general"),
    )
    if result.get("ok") and deps.task_store is not None:
        task = await deps.task_store.get(str(result.get("task_id") or ""))
        return {
            "ok": True,
            "task": task,
            "remote_task_id": result.get("remote_task_id"),
            "target_agent_id": target_agent,
        }
    return result


@router.post("/api/a2a/invoke")
async def invoke_remote_agent(request: Request):
    return await _delegate_remote_agent(request)


@router.post("/api/a2a/delegate")
async def delegate_remote_agent(request: Request):
    return await _delegate_remote_agent(request)


@router.get("/api/a2a/tasks/{task_id}")
async def get_a2a_task(task_id: str):
    if deps.task_store is None:
        return JSONResponse({"error": "Task store not initialized"}, 503)
    task = await deps.task_store.get(task_id)
    if not task or task.get("source_type") != "a2a":
        return JSONResponse({"error": "not found"}, 404)
    return task


@router.post("/api/a2a/tasks/{task_id}/refresh")
async def refresh_a2a_task(task_id: str):
    manager = _manager()
    if manager is None:
        return JSONResponse({"error": "A2A not initialized"}, 503)
    try:
        result = await manager.refresh_remote_task(task_id)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, 404)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, 400)
    if not result.get("ok"):
        return JSONResponse(result, 502)
    return result


@router.get("/api/a2a/tasks/{task_id}/stream")
async def stream_a2a_task(task_id: str, limit: int = 5, interval_ms: int = 100):
    if deps.task_store is None:
        return JSONResponse({"error": "Task store not initialized"}, 503)

    async def _iter_events():
        emitted = 0
        last_updated = None
        while emitted < max(1, min(limit, 50)):
            task = await deps.task_store.get(task_id)
            if not task or task.get("source_type") != "a2a":
                yield "event: error\ndata: " + json.dumps({"error": "not found"}) + "\n\n"
                return
            updated_at = task.get("updated_at")
            if updated_at != last_updated:
                payload = {
                    "task_id": task["task_id"],
                    "status": task.get("status"),
                    "progress_pct": task.get("progress_pct"),
                    "progress_step": task.get("progress_step"),
                    "progress_data": task.get("progress_data"),
                    "source_ref": task.get("source_ref"),
                    "error": task.get("error"),
                }
                yield "event: task\ndata: " + json.dumps(payload) + "\n\n"
                last_updated = updated_at
                emitted += 1
                if task.get("status") in {"completed", "failed", "cancelled"}:
                    return
            await asyncio.sleep(max(0.02, min(interval_ms / 1000.0, 2.0)))

    return StreamingResponse(_iter_events(), media_type="text/event-stream")


@router.post("/a2a")
async def a2a_rpc(request: Request):
    manager = _manager()
    if manager is None:
        return JSONResponse({"jsonrpc": "2.0", "error": {"code": -32000, "message": "A2A not initialized"}}, 503)
    if not manager.verify_request_headers(dict(request.headers)):
        return JSONResponse(
            {"jsonrpc": "2.0", "error": {"code": -32002, "message": "A2A authentication failed"}},
            status_code=401,
        )
    body = await request.json()
    result = await manager.handle_rpc(body)
    status_code = 400 if result.get("error", {}).get("code") == -32600 else 200
    return JSONResponse(result, status_code=status_code)
