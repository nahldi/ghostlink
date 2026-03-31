"""Route-level tests for conversation branching."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

import deps


class _DummyRequest:
    def __init__(self, body: dict):
        self._body = body

    async def json(self) -> dict:
        return self._body


@pytest.fixture
def branch_env(tmp_path: Path, tmp_data_dir: Path):
    import aiosqlite

    from branches import BranchManager
    from jobs import JobStore
    from registry import AgentRegistry
    from router import MessageRouter
    from sessions import SessionManager
    from store import MessageStore

    async def _setup():
        store = MessageStore(tmp_path / "messages.db")
        await store.init()
        db = await aiosqlite.connect(str(tmp_path / "jobs.db"))
        db.row_factory = aiosqlite.Row
        jobs = JobStore(db)
        await jobs.init()

        deps.store = store
        deps.job_store = jobs
        deps.registry = AgentRegistry()
        deps.router_inst = MessageRouter()
        deps.branch_manager = BranchManager(tmp_data_dir)
        deps.session_manager = SessionManager(tmp_data_dir)
        deps.DATA_DIR = tmp_data_dir
        deps._settings["channels"] = ["general"]

        async def _broadcast(*_args, **_kwargs):
            return None

        deps.broadcast = _broadcast
        return {"store": store, "db": db}

    env = asyncio.run(_setup())
    try:
        yield env
    finally:
        asyncio.run(env["store"].close())
        asyncio.run(env["db"].close())


@pytest.mark.asyncio
async def test_branch_creation_copies_messages_with_provenance_and_reply_mapping(branch_env):
    from routes import channels

    first = await deps.store.add("alice", "Initial idea", channel="general")
    second = await deps.store.add("bob", "Replying", channel="general", reply_to=first["id"])
    third = await deps.store.add("carol", "Later message", channel="general")
    await deps.store.pin(first["id"], True)
    await deps.store._db.execute("UPDATE messages SET reactions = ? WHERE id = ?", ('{"🔥":["bob"]}', second["id"]))
    await deps.store._db.commit()

    response = await channels.create_branch(_DummyRequest({
        "name": "Alt approach",
        "parent_channel": "general",
        "fork_message_id": second["id"],
    }))
    assert response["ok"] is True
    branch_id = response["channel"]

    branch_messages = await deps.store.get_recent(10, branch_id)
    assert len(branch_messages) == 2
    assert [msg["text"] for msg in branch_messages] == ["Initial idea", "Replying"]
    assert branch_messages[1]["reply_to"] == branch_messages[0]["id"]

    first_meta = json.loads(branch_messages[0]["metadata"])
    second_meta = json.loads(branch_messages[1]["metadata"])
    assert first_meta["branch_source"]["channel"] == "general"
    assert first_meta["branch_source"]["message_id"] == first["id"]
    assert second_meta["branch_source"]["message_id"] == second["id"]
    assert branch_messages[0]["pinned"] is True
    assert branch_messages[1]["reactions"] == '{"🔥":["bob"]}'
    assert all(msg["id"] != first["id"] for msg in branch_messages)

    listing = await channels.list_branches("general")
    assert listing["branches"][0]["id"] == branch_id
    assert listing["branches"][0]["message_count"] == 2
    assert listing["branches"][0]["fork_message_id"] == second["id"]
    assert third["text"] not in [msg["text"] for msg in branch_messages]


@pytest.mark.asyncio
async def test_branch_delete_removes_branch_messages_and_jobs(branch_env):
    from routes import channels

    msg = await deps.store.add("alice", "Seed", channel="general")
    created = await channels.create_branch(_DummyRequest({
        "name": "Cleanup branch",
        "parent_channel": "general",
        "fork_message_id": msg["id"],
    }))
    branch_id = created["channel"]

    await deps.store.add("alice", "Branch only", channel=branch_id)
    await deps.job_store.create("Branch job", channel=branch_id, created_by="alice")

    deleted = await channels.delete_branch(branch_id)
    assert deleted["ok"] is True
    assert (await channels.list_branches("general"))["branches"] == []
    assert await deps.store.get_recent(10, branch_id) == []
    assert await deps.job_store.list_jobs(branch_id) == []
    assert branch_id not in deps._settings["channels"]

