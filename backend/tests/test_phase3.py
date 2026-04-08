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


class _DummyCtx:
    def __init__(self, token: str):
        headers = {"authorization": f"Bearer {token}"}
        self.request_context = type(
            "RequestContext",
            (),
            {"request": type("Request", (), {"headers": headers})()},
        )()


@pytest_asyncio.fixture
async def phase3_env(tmp_path: Path):
    from audit_store import AuditStore
    from profiles import init_profiles_db
    from registry import AgentRegistry, init_registry_db
    from router import MessageRouter
    from skills import SkillsRegistry
    from store import MessageStore
    from task_store import TaskStore
    from security import DataManager

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
    deps.job_store = __import__("jobs").JobStore(db, task_store=deps.task_store)
    await deps.job_store.init()
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
        job_store=deps.job_store,
    )
    try:
        yield {"db": db, "data_dir": tmp_path, "events": events}
    finally:
        if getattr(message_store, "_db", None) is not None:
            await message_store._db.close()
        await db.close()
        deps.runtime_db = None


@pytest.mark.asyncio
async def test_job_creation_mirrors_into_task_store(phase3_env):
    job = await deps.job_store.create(title="Unify task board", channel="general", created_by="jeff", assignee="tyson")
    task = await deps.task_store.get_by_source_ref("job", job["uid"])
    assert task is not None
    assert task["title"] == "Unify task board"
    assert task["source_type"] == "job"


@pytest.mark.asyncio
async def test_chat_read_respects_mentions_only_context(phase3_env):
    from routes import agents

    registered = await agents.register_agent(_DummyRequest({"base": "codex", "label": "Tyson"}))
    await deps.store.add(sender="jeff", text="general note", channel="general")
    await deps.store.add(sender="jeff", text=f"ping @{registered['name']}", channel="general")
    deps._settings["channel_context"]["general"] = {
        "mode": "mentions_only",
        "visible_agents": [],
        "hidden_agents": [],
        "max_history": 0,
        "include_system_messages": True,
        "include_progress_messages": True,
    }

    result = mcp_bridge.chat_read(channel="general", ctx=_DummyCtx(registered["token"]))
    payload = json.loads(result)
    assert len(payload) == 1
    assert f"@{registered['name']}" in payload[0]["text"]


@pytest.mark.asyncio
async def test_task_cancel_creates_signal_and_broadcasts(phase3_env):
    from routes import agents, tasks

    registered = await agents.register_agent(_DummyRequest({"base": "codex", "label": "Tyson"}))
    task = await tasks.create_task(
        _DummyRequest({"title": "Stop running tests", "agent_name": registered["name"], "created_by": "jeff"})
    )
    cancelled = await tasks.cancel_task(task["task_id"])
    assert cancelled["status"] == "cancelled"
    signal_path = phase3_env["data_dir"] / "agents" / registered["agent_id"] / f".cancel_{task['task_id']}"
    assert signal_path.exists()
    assert any(event == "task_update" for event, _payload in phase3_env["events"])


@pytest.mark.asyncio
async def test_chat_progress_updates_task_and_broadcasts(phase3_env):
    from routes import agents, tasks

    registered = await agents.register_agent(_DummyRequest({"base": "codex"}))
    task = await tasks.create_task(
        _DummyRequest({"title": "Build Phase 3", "agent_name": registered["name"], "created_by": "jeff"})
    )
    result = mcp_bridge.chat_progress(
        sender=registered["name"],
        channel="general",
        title="Build Phase 3",
        steps=["plan", "code", "test"],
        current=2,
        total=3,
        task_id=task["task_id"],
        ctx=_DummyCtx(registered["token"]),
    )
    updated = await deps.task_store.get(task["task_id"])
    assert "step 2/3" in result
    assert updated["progress_pct"] == 66
    assert updated["progress_step"] == "code"
    assert any(event == "task_progress" for event, _payload in phase3_env["events"])


@pytest.mark.asyncio
async def test_audit_search_export_and_retention(phase3_env):
    from routes import audit

    await deps.audit_store.record(
        "task.created",
        actor="jeff",
        action="created task",
        actor_type="human",
        agent_name="tyson",
        task_id="task123",
        channel="general",
        detail={"policy": "manual"},
        timestamp=1.0,
    )
    events = await audit.search_audit_events(event_type="task.created", agent="tyson")
    assert len(events["events"]) == 1
    csv_response = await audit.export_audit(format="csv", event_type="task.created")
    assert "task.created" in csv_response.body.decode()

    deps.data_manager.save_retention({"enabled": True, "delete_audit_events": True, "audit_max_age_days": 1})
    result = await deps.data_manager.apply_retention()
    assert result["deleted_audit_events"] == 1
