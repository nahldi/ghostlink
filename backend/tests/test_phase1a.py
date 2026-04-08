from __future__ import annotations

import json
from pathlib import Path

import aiosqlite
import pytest

import deps


class _DummyRequest:
    def __init__(self, body: dict | None = None):
        self._body = body or {}
        self.headers: dict[str, str] = {}

    async def json(self) -> dict:
        return self._body


@pytest.fixture
async def phase1a_env(tmp_path: Path):
    from registry import AgentRegistry, init_registry_db
    from router import MessageRouter

    db_path = tmp_path / "ghostlink_v2.db"
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA busy_timeout=5000")
    await init_registry_db(db)

    deps.DATA_DIR = tmp_path
    deps.BASE_DIR = tmp_path
    deps.runtime_db = db
    deps.registry = AgentRegistry()
    deps.router_inst = MessageRouter(max_hops=4, default_routing="none")
    deps._pending_spawns.clear()
    deps._agent_processes.clear()
    deps._last_heartbeats.clear()
    deps._thinking_buffers.clear()
    deps._settings["persistentAgents"] = []
    deps.CONFIG = {"agents": {}}
    deps.worktree_manager = None
    deps.automation_manager = None

    async def _broadcast(*_args, **_kwargs):
        return None

    deps.broadcast = _broadcast
    try:
        yield {"db": db, "data_dir": tmp_path}
    finally:
        await db.close()
        deps.runtime_db = None


@pytest.mark.asyncio
async def test_register_response_and_status_include_agent_id(phase1a_env):
    from app_helpers import get_full_agent_list
    from routes import agents

    result = await agents.register_agent(_DummyRequest({"base": "codex"}))
    assert len(result["agent_id"]) == 32
    int(result["agent_id"], 16)

    status_agents = get_full_agent_list()
    assert status_agents[0]["agent_id"] == result["agent_id"]


@pytest.mark.asyncio
async def test_registry_rows_persist_and_reload_offline(phase1a_env):
    from registry import AgentRegistry, load_persisted_agents
    from routes import agents

    result = await agents.register_agent(_DummyRequest({"base": "codex"}))
    await agents.deregister_agent(result["name"])

    reloaded = AgentRegistry()
    reloaded.load_persisted(await load_persisted_agents(phase1a_env["db"]))

    by_id = reloaded.get_by_id(result["agent_id"])
    by_name = reloaded.resolve(result["name"])
    assert by_id is not None
    assert by_name is not None
    assert by_id.agent_id == result["agent_id"]
    assert by_id.state == "offline"
    assert by_name.agent_id == result["agent_id"]


@pytest.mark.asyncio
async def test_soul_notes_and_memories_routes_accept_agent_id(phase1a_env):
    from agent_memory import get_agent_memory
    from routes import agents

    result = await agents.register_agent(_DummyRequest({"base": "codex"}))
    agent_id = result["agent_id"]

    soul_response = await agents.api_set_soul(result["name"], _DummyRequest({"soul": "You are a reviewer."}))
    assert soul_response == {"ok": True}
    soul_by_id = await agents.api_get_soul(agent_id)
    assert soul_by_id["soul"] == "You are a reviewer."

    notes_response = await agents.api_set_notes(result["name"], _DummyRequest({"content": "ship it"}))
    assert notes_response == {"ok": True}
    notes_by_id = await agents.api_get_notes(agent_id)
    assert notes_by_id["notes"] == "ship it"

    mem = get_agent_memory(deps.DATA_DIR, agent_id)
    mem.save("task", "finish phase 1a")
    memory_by_id = await agents.api_get_agent_memory(agent_id, "task")
    assert memory_by_id["value"]["content"] == "finish phase 1a"


@pytest.mark.asyncio
async def test_deregister_marks_row_offline_not_deleted(phase1a_env):
    from routes import agents

    result = await agents.register_agent(_DummyRequest({"base": "codex"}))
    response = await agents.deregister_agent(result["name"])
    assert response == {"ok": True}

    cursor = await phase1a_env["db"].execute(
        "SELECT state FROM agents WHERE agent_id = ?",
        (result["agent_id"],),
    )
    try:
        row = await cursor.fetchone()
    finally:
        await cursor.close()
    assert row is not None
    assert row["state"] == "offline"
