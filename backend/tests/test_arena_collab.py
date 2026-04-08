from __future__ import annotations

import asyncio
from pathlib import Path

import aiosqlite
import pytest
import pytest_asyncio

import deps
from arena import ArenaDispatcher
from audit_store import AuditStore
from autonomous import AutonomousManager
from collab import CollaborationManager
from task_store import TaskStore


@pytest_asyncio.fixture
async def arena_collab_env(tmp_path: Path):
    db = await aiosqlite.connect(str(tmp_path / "ghostlink_v2.db"))
    db.row_factory = aiosqlite.Row
    old_task_store = deps.task_store
    old_audit_store = deps.audit_store
    old_main_loop = getattr(deps, "_main_loop", None)
    deps.task_store = TaskStore(db)
    deps.audit_store = AuditStore(db)
    deps._main_loop = asyncio.get_running_loop()
    await deps.task_store.init()
    await deps.audit_store.init()
    try:
        yield
    finally:
        deps.task_store = old_task_store
        deps.audit_store = old_audit_store
        deps._main_loop = old_main_loop
        await db.close()


@pytest.mark.asyncio
async def test_arena_dispatcher_creates_tasks_and_comparison_data(arena_collab_env):
    dispatcher = ArenaDispatcher()
    run = await dispatcher.create_run(
        task_description="Implement the backend slice",
        channel="general",
        contestants=[
            {"agent_id": "agent-a", "agent_name": "codex"},
            {"agent_id": "agent-b", "agent_name": "claude"},
        ],
    )

    assert run.arena_id
    assert len(run.contestants) == 2
    assert all(contestant.task_id for contestant in run.contestants)

    await dispatcher.update_contestant(
        run.arena_id,
        "agent-a",
        state="completed",
        diff_stat={"files_changed": 2, "insertions": 10, "deletions": 1},
        eval_scores={"correctness": 0.92},
        time_elapsed_seconds=15.0,
    )
    await dispatcher.update_contestant(
        run.arena_id,
        "agent-b",
        state="budget_exceeded",
        cost={"input_tokens": 100, "output_tokens": 80, "estimated_cost_usd": 0.42},
    )

    comparison = dispatcher.comparison_view(run.arena_id)
    assert comparison is not None
    assert comparison["state"] == "comparing"
    assert comparison["contestants"][0]["task_id"]
    assert comparison["contestants"][0]["diff_stat"]["files_changed"] == 2
    assert comparison["contestants"][1]["state"] == "budget_exceeded"

    resolved = await dispatcher.resolve_winner(run.arena_id, "agent-a")
    assert resolved is not None
    assert resolved["state"] == "resolved"
    assert resolved["winner_agent_id"] == "agent-a"


@pytest.mark.asyncio
async def test_collaboration_manager_tracks_supervisor_sessions_and_message_pool(arena_collab_env):
    manager = CollaborationManager()
    autonomous = AutonomousManager()
    plan = autonomous.create_plan(
        "Ship the review UI",
        "supervisor",
        [
            {"label": "Build panel", "assignee": "worker-1"},
            {"label": "Write tests", "assignee": "worker-2"},
        ],
    )

    session = await manager.create_supervisor_session(
        supervisor_id="supervisor-id",
        worker_ids=["worker-1", "worker-2"],
        plan=plan,
        authority_level=2,
        artifact_lineage_root="lineage-root",
    )
    assert session.session_id
    listed = manager.list_supervisor_sessions("supervisor-id")
    assert listed[0]["authority_level"] == 2
    assert listed[0]["plan"]["plan_id"] == plan.plan_id

    message = await manager.publish_message(
        publisher_agent_id="worker-1",
        message_type="test_result",
        namespace=plan.plan_id,
        payload={"status": "passed"},
    )
    assert message["namespace"] == plan.plan_id

    acked = await manager.ack_message(plan.plan_id, message["message_id"], "supervisor-id")
    assert acked is not None
    assert acked["subscribers_acked"] == ["supervisor-id"]
