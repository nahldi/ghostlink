"""Phase 1 backend tests for paged exports and dead-process cleanup."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

import deps


class _DeadProc:
    def __init__(self, pid: int, exit_code: int = 0):
        self.pid = pid
        self._exit_code = exit_code
        self.wait_calls = 0

    def poll(self):
        return self._exit_code

    def wait(self, timeout=None):
        self.wait_calls += 1
        return self._exit_code


class _LiveProc:
    def __init__(self, pid: int):
        self.pid = pid

    def poll(self):
        return None


class _TrackedLiveProc(_LiveProc):
    def terminate(self):
        self.terminated = True


class _TrackedDeadProc(_DeadProc):
    def terminate(self):
        self.terminated = True


@pytest.fixture
async def phase1_store(tmp_path: Path):
    from registry import AgentRegistry
    from store import MessageStore

    store = MessageStore(tmp_path / "messages.db")
    await store.init()
    deps.store = store
    deps.registry = AgentRegistry()
    try:
        yield store
    finally:
        await store.close()


@pytest.mark.asyncio
async def test_export_channel_clamps_limit_and_reports_pagination(phase1_store):
    from routes.misc import export_channel

    for index in range(1205):
        await phase1_store.add("alice", f"export entry {index}", channel="general")

    result = await export_channel(channel="general", format="json", limit=5000)

    assert result["count"] == 1000
    assert result["limit"] == 1000
    assert result["offset"] == 0
    assert result["total"] == 1205
    assert result["has_more"] is True
    assert result["truncated"] is True
    assert result["messages"][0]["text"] == "export entry 0"
    assert result["messages"][-1]["text"] == "export entry 999"


@pytest.mark.asyncio
async def test_share_conversation_supports_offset_windows(phase1_store):
    from routes.misc import share_conversation

    await phase1_store.add("alice", "first", channel="general")
    await phase1_store.add("bob", "second", channel="general")
    await phase1_store.add("alice", "third", channel="general")

    result = await share_conversation(channel="general", limit=2, offset=1)

    assert result["message_count"] == 2
    assert result["total_messages"] == 3
    assert result["offset"] == 1
    assert result["has_more"] is False
    assert "second" in result["html"]
    assert "third" in result["html"]
    assert "first" not in result["html"]


@pytest.mark.asyncio
async def test_cleanup_stale_reaps_dead_pending_and_agent_processes(monkeypatch):
    from routes.agents import cleanup_stale

    dead_pending = _DeadProc(101)
    dead_agent = _DeadProc(202)
    live_pending = _LiveProc(303)
    live_agent = _LiveProc(404)

    deps._pending_spawns.clear()
    deps._agent_processes.clear()
    deps._pending_spawns[dead_pending.pid] = dead_pending
    deps._pending_spawns[live_pending.pid] = live_pending
    deps._agent_processes["dead-agent"] = dead_agent
    deps._agent_processes["live-agent"] = live_agent

    def fake_run(*_args, **_kwargs):
        return subprocess.CompletedProcess(args=["tmux"], returncode=0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = await cleanup_stale()

    assert result["ok"] is True
    assert "pending:101" in result["cleaned"]
    assert "process:dead-agent" in result["cleaned"]
    assert 101 not in deps._pending_spawns
    assert "dead-agent" not in deps._agent_processes
    assert deps._pending_spawns[303] is live_pending
    assert deps._agent_processes["live-agent"] is live_agent
    assert dead_pending.wait_calls == 1
    assert dead_agent.wait_calls == 1


@pytest.mark.asyncio
async def test_kill_agent_skips_stale_recycled_process_record(monkeypatch):
    from routes.agents import kill_agent
    from registry import AgentRegistry

    class _Inst:
        def __init__(self, name: str):
            self.name = name
            self.agent_id = "agent-1"

    stale = _TrackedLiveProc(505)
    deps.registry = AgentRegistry()
    deps.registry.register("codex")
    monkeypatch.setattr("routes.agents._resolve_agent", lambda name: _Inst(name))
    monkeypatch.setattr(deps, "is_same_process", lambda record: False)
    monkeypatch.setattr(subprocess, "run", lambda *_args, **_kwargs: subprocess.CompletedProcess(args=["tmux"], returncode=0, stdout="", stderr=""))
    deps._agent_processes.clear()
    deps._agent_processes["codex"] = deps.ProcessRecord(proc=stale, pid=505, created_at=1.0, command=("ghostlink",), owner="codex")

    result = await kill_agent("codex")

    assert bool(result["ok"]) is True
    assert getattr(stale, "terminated", False) is False
