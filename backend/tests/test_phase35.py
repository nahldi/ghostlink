from __future__ import annotations

import json
from pathlib import Path

import aiosqlite
import pytest
import pytest_asyncio

import deps
import mcp_bridge


class _DummyRequest:
    def __init__(self, body: dict | None = None):
        self._body = body or {}
        self.headers: dict[str, str] = {}

    async def json(self) -> dict:
        return self._body


@pytest_asyncio.fixture
async def phase35_env(tmp_path: Path):
    from audit_store import AuditStore
    from checkpoints import CheckpointStore
    from profiles import init_profiles_db
    from registry import AgentRegistry, init_registry_db
    from router import MessageRouter
    from security import DataManager
    from skills import SkillsRegistry
    from store import MessageStore
    from task_store import TaskStore

    db_path = tmp_path / "ghostlink_v2.db"
    message_store = MessageStore(db_path)
    await message_store.init()

    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    await init_registry_db(db)
    await init_profiles_db(db)

    deps.DATA_DIR = tmp_path
    deps.BASE_DIR = tmp_path
    deps.runtime_db = db
    deps.store = message_store
    deps.registry = AgentRegistry()
    deps.router_inst = MessageRouter(max_hops=4, default_routing="none")
    deps.task_store = TaskStore(db)
    await deps.task_store.init()
    deps.audit_store = AuditStore(db)
    await deps.audit_store.init()
    deps.checkpoint_store = CheckpointStore(db)
    await deps.checkpoint_store.init()
    deps.skills_registry = SkillsRegistry(tmp_path, db)
    await deps.skills_registry.init()
    deps.data_manager = DataManager(tmp_path, store=message_store, audit_store=deps.audit_store)
    deps._settings = {"channels": ["general"], "channel_context": {}, "username": "You"}
    deps._pending_spawns.clear()
    deps._agent_processes.clear()
    deps._last_heartbeats.clear()
    deps._thinking_buffers.clear()
    deps.worktree_manager = None
    deps.automation_manager = None
    deps._main_loop = __import__("asyncio").get_running_loop()
    events: list[tuple[str, dict]] = []

    async def _broadcast(event: str, payload: dict):
        events.append((event, payload))
        return None

    deps.broadcast = _broadcast
    mcp_bridge.configure(
        store=message_store,
        registry=deps.registry,
        settings=deps._settings,
        data_dir=tmp_path,
        task_store=deps.task_store,
    )
    try:
        yield {"db": db, "data_dir": tmp_path, "events": events}
    finally:
        if getattr(message_store, "_db", None) is not None:
            await message_store._db.close()
        await db.close()
        deps.runtime_db = None


@pytest.mark.asyncio
async def test_task_create_and_progress_create_checkpoints(phase35_env):
    from routes import agents, tasks

    registered = await agents.register_agent(_DummyRequest({"base": "codex", "label": "Tyson"}))
    created = await tasks.create_task(_DummyRequest({"title": "Resume-safe build", "agent_name": registered["name"], "created_by": "jeff"}))
    checkpoints = await deps.checkpoint_store.list_for_task(created["task_id"])
    assert [cp["trigger"] for cp in checkpoints] == ["task_start"]

    updated = await tasks.update_task_progress(created["task_id"], _DummyRequest({"pct": 50, "step": "Testing", "total": 2, "steps": [{"label": "Code", "status": "done"}, {"label": "Testing", "status": "active"}]}))
    assert updated["progress_step"] == "Testing"
    checkpoints = await deps.checkpoint_store.list_for_task(created["task_id"])
    assert checkpoints[-1]["trigger"] == "progress_step"
    assert checkpoints[-1]["state_snapshot"]["task"]["progress_step"] == "Testing"


@pytest.mark.asyncio
async def test_pause_and_resume_create_signal_and_restore_message(phase35_env):
    from routes import agents, tasks

    registered = await agents.register_agent(_DummyRequest({"base": "codex"}))
    created = await tasks.create_task(_DummyRequest({"title": "Pause me", "agent_name": registered["name"], "created_by": "jeff"}))
    paused = await tasks.pause_task(created["task_id"])
    pause_signal = phase35_env["data_dir"] / "agents" / registered["agent_id"] / f".pause_{created['task_id']}"
    assert paused["status"] == "paused"
    assert pause_signal.exists()

    resumed = await tasks.resume_task(created["task_id"])
    assert resumed["status"] == "running"
    assert "Resuming task" in resumed["metadata"]["resume_message"]


@pytest.mark.asyncio
async def test_fork_creates_independent_task_from_checkpoint(phase35_env):
    from routes import agents, tasks

    registered = await agents.register_agent(_DummyRequest({"base": "codex"}))
    created = await tasks.create_task(_DummyRequest({"title": "Fork source", "agent_name": registered["name"], "created_by": "jeff", "trace_id": "trace-root"}))
    await tasks.update_task_progress(created["task_id"], _DummyRequest({"pct": 100, "step": "Done", "total": 1, "steps": [{"label": "Done", "status": "done"}]}))
    latest = await deps.checkpoint_store.get_latest(created["task_id"])
    forked = await tasks.fork_task(created["task_id"], _DummyRequest({"checkpoint_id": latest["checkpoint_id"]}))
    assert forked["task"]["task_id"] != created["task_id"]
    assert forked["task"]["parent_task_id"] == created["task_id"]
    assert forked["task"]["source_ref"] == latest["checkpoint_id"]
    assert forked["task"]["trace_id"]
    assert forked["task"]["trace_id"] != created["trace_id"]
    assert forked["task"]["metadata"]["forked_from_trace_id"] == created["trace_id"]
    fork_checkpoints = await deps.checkpoint_store.list_for_task(forked["task"]["task_id"])
    assert fork_checkpoints[0]["metadata"]["forked_from_checkpoint_id"] == latest["checkpoint_id"]


@pytest.mark.asyncio
async def test_replay_status_distinguishes_readonly_and_live(phase35_env):
    from routes import agents, tasks

    registered = await agents.register_agent(_DummyRequest({"base": "codex"}))
    created = await tasks.create_task(_DummyRequest({"title": "Replay source", "agent_name": registered["name"], "created_by": "jeff", "trace_id": "trace-replay"}))
    await deps.task_store.update(
        created["task_id"],
        metadata={
            "tool_journal": [
                {"tool_name": "chat_read", "classification": "replay_safe"},
                {"tool_name": "code_execute", "classification": "replay_blocked"},
            ]
        },
    )
    created = await deps.task_store.get(created["task_id"])
    checkpoint = await tasks.create_task_checkpoint(created["task_id"], _DummyRequest({"label": "Replay marker"}))
    replay = await tasks.replay_task(created["task_id"], _DummyRequest({"checkpoint_id": checkpoint["checkpoint"]["checkpoint_id"], "mode": "readonly"}))
    assert replay["replay"]["mode"] == "readonly"
    assert replay["replay"]["replay_blocked_tools"] == ["code_execute"]
    status = await tasks.replay_status(created["task_id"])
    assert status["replay"]["active"] is True

    live = await tasks.replay_task(created["task_id"], _DummyRequest({"checkpoint_id": checkpoint["checkpoint"]["checkpoint_id"], "mode": "live"}))
    assert live["replay"]["fork_task_id"]
    forked = await deps.task_store.get(live["replay"]["fork_task_id"])
    assert forked["trace_id"]
    assert forked["trace_id"] != created["trace_id"]
    stopped = await tasks.stop_replay(created["task_id"])
    assert stopped["replay"]["active"] is False


@pytest.mark.asyncio
async def test_checkpoint_compaction_and_retention(phase35_env):
    from routes import agents, tasks

    registered = await agents.register_agent(_DummyRequest({"base": "codex"}))
    created = await tasks.create_task(_DummyRequest({"title": "Compact me", "agent_name": registered["name"], "created_by": "jeff"}))
    for idx in range(6):
        await tasks.update_task_progress(created["task_id"], _DummyRequest({"pct": idx * 10, "step": f"step-{idx}", "total": 6, "steps": [{"label": f"step-{idx}", "status": "active"}]}))
    before = await deps.checkpoint_store.list_for_task(created["task_id"])
    assert len(before) >= 7
    compacted = await tasks.compact_task_checkpoints(created["task_id"], _DummyRequest({"keep_every_n": 3}))
    assert compacted["deleted"] > 0

    deps.data_manager.save_retention({"enabled": True, "delete_checkpoints": True, "checkpoint_max_age_days": 0})
    retention = await deps.data_manager.apply_retention()
    assert "deleted_checkpoints" in retention
