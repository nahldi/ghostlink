"""Unified task routes."""
from __future__ import annotations

import json
from pathlib import Path
import uuid as _uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import deps

router = APIRouter()
_PAUSED_STATES = {"paused", "awaiting_input", "awaiting_approval", "awaiting_external"}
_REPLAY_SAFE_TOOLS = {"chat_read", "chat_who", "chat_channels", "chat_rules", "chat_claim", "set_thinking", "chat_progress", "chat_react"}


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


def _pause_signal_path(task: dict) -> Path | None:
    agent_id = task.get("agent_id") or ""
    agent_name = task.get("agent_name") or ""
    if agent_id:
        return deps.DATA_DIR / "agents" / agent_id / f".pause_{task['task_id']}"
    if agent_name:
        return deps.DATA_DIR / "agents" / agent_name / f".pause_{task['task_id']}"
    return None


def _resume_message(task: dict, checkpoint: dict | None) -> str:
    step = ""
    if checkpoint:
        snapshot = checkpoint.get("state_snapshot", {})
        step = str(snapshot.get("task", {}).get("progress_step", "") or "")
    detail = f" Last completed step: {step}." if step else ""
    return f"[SYSTEM] Resuming task '{task['title']}' from checkpoint.{detail}"


async def _create_checkpoint(task: dict, trigger: str, *, metadata: dict | None = None, pending_actions: list | None = None) -> dict | None:
    if deps.checkpoint_store is None:
        return None
    inst = _resolve_agent(task.get("agent_name", "") or "")
    task_metadata = dict(task.get("metadata", {}))
    snapshot = {
        "task": {
            "task_id": task["task_id"],
            "status": task["status"],
            "progress_pct": task.get("progress_pct", 0),
            "progress_step": task.get("progress_step", ""),
            "progress_data": task.get("progress_data", {}),
        },
        "agent_identity": {
            "agent_id": task.get("agent_id", "") or getattr(inst, "agent_id", ""),
            "agent_name": task.get("agent_name", ""),
            "session_id": task_metadata.get("session_id", ""),
            "profile_id": task.get("profile_id", "") or getattr(inst, "profile_id", ""),
            "capabilities": task_metadata.get("capabilities", []),
        },
        "execution_context": {
            "channel": task.get("channel", "general"),
            "last_message_id": task_metadata.get("last_message_id", 0),
            "read_cursor": task_metadata.get("read_cursor", {}),
            "active_tools": task_metadata.get("active_tools", []),
            "pending_approvals": task_metadata.get("pending_approvals", []),
        },
        "plan_state": task_metadata.get("plan_state", {}),
        "artifact_log": task_metadata.get("artifact_log", []),
        "tool_journal": task_metadata.get("tool_journal", []),
    }
    return await deps.checkpoint_store.create(
        task["task_id"],
        task.get("agent_name") or "",
        trigger,
        snapshot,
        agent_id=task.get("agent_id"),
        pending_actions=pending_actions or task_metadata.get("pending_actions", []),
        worktree_ref=task_metadata.get("worktree_ref"),
        artifact_refs=task_metadata.get("artifact_refs", []),
        session_id=task_metadata.get("session_id"),
        trace_id=task.get("trace_id"),
        context_window=task_metadata.get("context_window", {}),
        metadata=metadata or {},
    )


async def _append_task_journal(task_id: str, entry: dict) -> dict | None:
    task = await deps.task_store.get(task_id)
    if not task:
        return None
    metadata = dict(task.get("metadata", {}))
    journal = list(metadata.get("tool_journal", []))
    journal.append(entry)
    metadata["tool_journal"] = journal[-50:]
    return await deps.task_store.update(task_id, metadata=metadata)


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
    metadata = dict(body.get("metadata", {}) or {})
    if deps.policy_engine is not None:
        from policy import PolicyContext

        snapshot_context = PolicyContext(
            agent_name=getattr(inst, "name", None) if inst else agent_name,
            agent_id=getattr(inst, "agent_id", "") if inst else "",
            profile_id=getattr(inst, "profile_id", "") if inst else "",
            task_id="",
            workspace_id=str(getattr(inst, "workspace", "") or deps.BASE_DIR),
            session_mode=str(metadata.get("session_mode", "") or ""),
            sandbox_tier=str(metadata.get("sandbox_tier", "none") or "none"),
            sandbox_root=str(metadata.get("sandbox_root", "") or ""),
        )
        metadata["policy_snapshot"] = await deps.policy_engine.snapshot_for_task(snapshot_context)
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
        metadata=metadata,
    )
    await _create_checkpoint(task, "task_start", metadata={"automatic": True})
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
    previous = await deps.task_store.get(task_id)
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
    if "status" in body and body.get("status") != (previous or {}).get("status"):
        trigger = "completion" if task["status"] in {"completed", "failed", "cancelled"} else "status_change"
        await _create_checkpoint(task, trigger, metadata={"automatic": True, "previous_status": (previous or {}).get("status", "")})
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
    await _create_checkpoint(task, "progress_step", metadata={"automatic": True})
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
    await _create_checkpoint(task, "manual", metadata={"reason": "cancelled"})
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


@router.get("/api/tasks/{task_id}/checkpoints")
async def list_task_checkpoints(task_id: str):
    if deps.checkpoint_store is None:
        return JSONResponse({"error": "not implemented"}, 501)
    return {"checkpoints": await deps.checkpoint_store.list_for_task(task_id)}


@router.get("/api/checkpoints/{checkpoint_id}")
async def get_checkpoint(checkpoint_id: str):
    if deps.checkpoint_store is None:
        return JSONResponse({"error": "not implemented"}, 501)
    checkpoint = await deps.checkpoint_store.get(checkpoint_id)
    if not checkpoint:
        return JSONResponse({"error": "not found"}, 404)
    return checkpoint


@router.post("/api/tasks/{task_id}/checkpoints")
async def create_task_checkpoint(task_id: str, request: Request):
    task = await deps.task_store.get(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, 404)
    body = await request.json()
    checkpoint = await _create_checkpoint(
        task,
        "manual",
        metadata={"label": str(body.get("label", "") or "").strip(), "manual": True},
    )
    return {"ok": True, "checkpoint": checkpoint}


@router.delete("/api/checkpoints/{checkpoint_id}")
async def delete_checkpoint(checkpoint_id: str):
    if deps.checkpoint_store is None:
        return JSONResponse({"error": "not implemented"}, 501)
    return {"ok": await deps.checkpoint_store.delete(checkpoint_id)}


@router.post("/api/tasks/{task_id}/checkpoints/compact")
async def compact_task_checkpoints(task_id: str, request: Request):
    if deps.checkpoint_store is None:
        return JSONResponse({"error": "not implemented"}, 501)
    body = await request.json()
    deleted = await deps.checkpoint_store.compact(task_id, keep_every_n=max(1, int(body.get("keep_every_n", 5) or 5)))
    return {"ok": True, "deleted": deleted}


@router.post("/api/tasks/{task_id}/pause")
async def pause_task(task_id: str):
    task = await deps.task_store.get(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, 404)
    await _create_checkpoint(task, "manual", metadata={"reason": "pause"})
    paused = await deps.task_store.update_status(task_id, "paused")
    signal_path = _pause_signal_path(paused)
    if signal_path is not None:
        signal_path.parent.mkdir(parents=True, exist_ok=True)
        signal_path.write_text(json.dumps({"task_id": task_id, "agent_name": paused.get("agent_name", "")}), encoding="utf-8")
    await deps.broadcast("task_update", paused)
    await _record_audit("task.paused", actor="user", action="paused task", task_id=task_id, agent_name=paused.get("agent_name"), trace_id=paused.get("trace_id"), channel=paused.get("channel"))
    return paused


@router.post("/api/tasks/{task_id}/resume")
async def resume_task(task_id: str):
    task = await deps.task_store.get(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, 404)
    if task["status"] not in _PAUSED_STATES and task["status"] != "interrupted":
        return JSONResponse({"error": "task is not paused"}, 400)
    resumed = await deps.task_store.update_status(task_id, "running")
    signal_path = _pause_signal_path(resumed)
    if signal_path is not None:
        signal_path.unlink(missing_ok=True)
    checkpoint = await deps.checkpoint_store.get_latest(task_id) if deps.checkpoint_store is not None else None
    metadata = dict(resumed.get("metadata", {}))
    metadata["resume_message"] = _resume_message(resumed, checkpoint)
    resumed = await deps.task_store.update(task_id, metadata=metadata)
    await deps.broadcast("task_update", resumed)
    await _create_checkpoint(resumed, "status_change", metadata={"reason": "resume", "automatic": True})
    await _record_audit("task.resumed", actor="user", action="resumed task", task_id=task_id, agent_name=resumed.get("agent_name"), trace_id=resumed.get("trace_id"), channel=resumed.get("channel"))
    return resumed


@router.post("/api/tasks/{task_id}/fork")
async def fork_task(task_id: str, request: Request):
    task = await deps.task_store.get(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, 404)
    if deps.checkpoint_store is None:
        return JSONResponse({"error": "not implemented"}, 501)
    body = await request.json()
    checkpoint_id = str(body.get("checkpoint_id", "") or "")
    checkpoint = await deps.checkpoint_store.get(checkpoint_id) if checkpoint_id else await deps.checkpoint_store.get_latest(task_id)
    if not checkpoint:
        return JSONResponse({"error": "checkpoint not found"}, 404)
    source_snapshot = dict(checkpoint.get("state_snapshot", {}))
    fork_trace_id = _uuid.uuid4().hex
    forked = await deps.task_store.create(
        title=f"Fork: {task['title']}"[:200],
        description=task.get("description", ""),
        channel=task.get("channel", "general"),
        agent_id=task.get("agent_id"),
        agent_name=task.get("agent_name"),
        profile_id=task.get("profile_id"),
        source_type="fork",
        source_ref=checkpoint["checkpoint_id"],
        parent_task_id=task["task_id"],
        trace_id=fork_trace_id,
        created_by="user",
        status="queued",
        metadata={
            "forked_from_task_id": task["task_id"],
            "forked_from_checkpoint_id": checkpoint["checkpoint_id"],
            "forked_from_trace_id": task.get("trace_id"),
            "artifact_refs": checkpoint.get("artifact_refs", []),
            "plan_state": source_snapshot.get("plan_state", {}),
            "artifact_log": source_snapshot.get("artifact_log", []),
            "tool_journal": [],
            "policy_snapshot": dict(task.get("metadata", {})).get("policy_snapshot", {}),
        },
    )
    await deps.checkpoint_store.create(
        forked["task_id"],
        forked.get("agent_name") or "",
        "task_start",
        source_snapshot,
        agent_id=forked.get("agent_id"),
        trace_id=forked.get("trace_id"),
        artifact_refs=checkpoint.get("artifact_refs", []),
        metadata={"forked_from_checkpoint_id": checkpoint["checkpoint_id"], "forked_from_task_id": task["task_id"]},
    )
    await deps.broadcast("task_update", forked)
    return {"ok": True, "task": forked}


@router.post("/api/tasks/{task_id}/replay")
async def replay_task(task_id: str, request: Request):
    task = await deps.task_store.get(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, 404)
    if deps.checkpoint_store is None:
        return JSONResponse({"error": "not implemented"}, 501)
    body = await request.json()
    checkpoint_id = str(body.get("checkpoint_id", "") or "")
    mode = str(body.get("mode", "readonly") or "readonly").strip().lower()
    checkpoint = await deps.checkpoint_store.get(checkpoint_id) if checkpoint_id else await deps.checkpoint_store.get_latest(task_id)
    if not checkpoint:
        return JSONResponse({"error": "checkpoint not found"}, 404)
    metadata = dict(task.get("metadata", {}))
    tool_journal = checkpoint.get("state_snapshot", {}).get("tool_journal", [])
    replay_state = {
        "active": True,
        "mode": mode,
        "source_task_id": task_id,
        "source_checkpoint_id": checkpoint["checkpoint_id"],
        "journal_entries": len(tool_journal),
        "replay_blocked_tools": [
            entry.get("tool_name")
            for entry in tool_journal
            if entry.get("classification") != "replay_safe"
        ],
        "started_at": __import__("time").time(),
    }
    if mode == "live":
        forked = await fork_task(task_id, _SyntheticRequest({"checkpoint_id": checkpoint["checkpoint_id"]}))
        replay_state["fork_task_id"] = forked["task"]["task_id"]
    metadata["replay_state"] = replay_state
    updated = await deps.task_store.update(task_id, metadata=metadata)
    return {"ok": True, "replay": replay_state, "task": updated}


@router.get("/api/tasks/{task_id}/replay/status")
async def replay_status(task_id: str):
    task = await deps.task_store.get(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, 404)
    return {"replay": dict(task.get("metadata", {})).get("replay_state", {"active": False})}


@router.post("/api/tasks/{task_id}/replay/stop")
async def stop_replay(task_id: str):
    task = await deps.task_store.get(task_id)
    if not task:
        return JSONResponse({"error": "not found"}, 404)
    metadata = dict(task.get("metadata", {}))
    replay_state = dict(metadata.get("replay_state", {}))
    replay_state["active"] = False
    replay_state["stopped_at"] = __import__("time").time()
    metadata["replay_state"] = replay_state
    updated = await deps.task_store.update(task_id, metadata=metadata)
    return {"ok": True, "replay": updated.get("metadata", {}).get("replay_state", {})}


class _SyntheticRequest:
    def __init__(self, body: dict):
        self._body = body

    async def json(self) -> dict:
        return self._body
