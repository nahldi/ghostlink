"""Integration tests — multi-module pipelines.

Tests the complete data flows between modules:
- Message store + router + registry pipeline
- Agent registry lifecycle (register → heartbeat → deregister)
- Job lifecycle (create → claim → complete)
- Secret store round-trip
- Approval file atomic write / read back
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path

import pytest
import pytest_asyncio

# ── Message pipeline: store + registry + router ─────────────────────

@pytest_asyncio.fixture
async def pipeline(tmp_path: Path):
    """Full message pipeline: store + registry + router."""
    from registry import AgentRegistry
    from router import MessageRouter
    from store import MessageStore

    ms = MessageStore(tmp_path / "msgs.db")
    await ms.init()
    reg = AgentRegistry()
    rtr = MessageRouter()

    yield ms, reg, rtr

    if ms._db:
        await ms._db.close()


@pytest.mark.asyncio
async def test_message_stored_and_routed(pipeline):
    """Message added to store is routable via @mention."""
    ms, reg, rtr = pipeline
    inst = reg.register("claude")

    msg = await ms.add("You", f"@{inst.name} please help", channel="general")
    assert msg["sender"] == "You"

    # Router resolves mention
    targets = rtr.get_targets("You", f"@{inst.name} please help", "general", [inst.name])
    assert inst.name in targets


@pytest.mark.asyncio
async def test_message_edit_and_delete_pipeline(pipeline):
    """Edit then delete a message — store reflects both changes."""
    ms, _, _ = pipeline
    msg = await ms.add("alice", "initial text", channel="general")

    await ms.edit(msg["id"], "updated text")
    msgs = await ms.get_recent(10, "general")
    assert msgs[0]["text"] == "updated text"

    deleted = await ms.delete([msg["id"]])
    assert msg["id"] in deleted
    remaining = await ms.get_recent(10, "general")
    assert len(remaining) == 0


@pytest.mark.asyncio
async def test_all_mention_routes_all_agents(pipeline):
    """@all message targets every registered agent."""
    ms, reg, rtr = pipeline
    a1 = reg.register("claude")
    a2 = reg.register("gemini")
    a3 = reg.register("codex")

    agent_names = [a1.name, a2.name, a3.name]
    targets = rtr.get_targets("You", "@all stand by", "general", agent_names)
    for name in agent_names:
        assert name in targets


@pytest.mark.asyncio
async def test_channel_isolation_in_pipeline(pipeline):
    """Messages in different channels are retrieved independently."""
    ms, _, _ = pipeline
    await ms.add("alice", "msg in general", channel="general")
    await ms.add("bob", "msg in dev", channel="dev")
    await ms.add("charlie", "another in general", channel="general")

    gen = await ms.get_recent(10, "general")
    dev = await ms.get_recent(10, "dev")

    assert len(gen) == 2
    assert len(dev) == 1
    assert all(m["channel"] == "general" for m in gen)
    assert all(m["channel"] == "dev" for m in dev)


# ── Agent registry lifecycle ─────────────────────────────────────────

def test_agent_lifecycle_register_get_deregister():
    """Full agent lifecycle: register → lookup → deregister."""
    from registry import AgentRegistry
    reg = AgentRegistry()

    inst = reg.register("claude", label="Claude AI")
    assert inst.name.startswith("claude")

    # Lookup by name
    found = reg.get(inst.name)
    assert found is not None
    assert found.name == inst.name

    # Deregister
    ok = reg.deregister(inst.name)
    assert ok
    assert reg.get(inst.name) is None


def test_agent_state_transitions():
    """Agent state can transition through lifecycle states."""
    from registry import AgentRegistry
    reg = AgentRegistry()

    inst = reg.register("codex")
    # Default state
    assert inst.state in ("idle", "active", "pending")

    # Transition to thinking
    inst.state = "thinking"
    fetched = reg.get(inst.name)
    assert fetched.state == "thinking"

    # Transition to offline
    inst.state = "offline"
    assert reg.get(inst.name).state == "offline"


def test_multiple_agents_same_base_independent():
    """Two agents with same base are independent — killing one doesn't affect the other."""
    from registry import AgentRegistry
    reg = AgentRegistry()

    a1 = reg.register("claude")
    a2 = reg.register("claude")
    assert a1.name != a2.name

    reg.deregister(a1.name)

    assert reg.get(a1.name) is None
    assert reg.get(a2.name) is not None


# ── Job lifecycle ─────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def job_store_inst(tmp_path: Path):
    import aiosqlite

    from jobs import JobStore
    conn = await aiosqlite.connect(str(tmp_path / "jobs.db"))
    conn.row_factory = aiosqlite.Row
    js = JobStore(conn)
    await js.init()
    yield js
    await conn.close()


@pytest.mark.asyncio
async def test_job_full_lifecycle(job_store_inst):
    """Job: create → claim → complete."""
    js = job_store_inst

    job = await js.create(title="Refactor auth", channel="general", created_by="You")
    assert job["status"] == "open"
    job_id = job["id"]

    # Claim it
    claimed = await js.update(job_id, {"status": "claimed", "assignee": "claude-1"})
    assert claimed["status"] == "claimed"
    assert claimed["assignee"] == "claude-1"

    # Complete it
    done = await js.update(job_id, {"status": "done"})
    assert done["status"] == "done"

    # Verify listing by status
    open_jobs = await js.list_jobs("general", status="open")
    done_jobs = await js.list_jobs("general", status="done")
    assert len(open_jobs) == 0
    assert len(done_jobs) == 1


@pytest.mark.asyncio
async def test_job_delete_removes_from_list(job_store_inst):
    """Deleted job no longer appears in list."""
    js = job_store_inst
    job = await js.create(title="Temp task", channel="general", created_by="You")
    ok = await js.delete(job["id"])
    assert ok
    remaining = await js.list_jobs("general")
    assert not any(j["id"] == job["id"] for j in remaining)


# ── Secret store round-trip ───────────────────────────────────────────

def test_secrets_round_trip(tmp_path: Path):
    """Write → read back via same manager, and via fresh manager (persisted key)."""
    from security import SecretsManager

    sm = SecretsManager(tmp_path)
    sm.set("api_key", "sk-test-1234567890")
    sm.set("token", "tok_abc")

    assert sm.get("api_key") == "sk-test-1234567890"
    assert sm.get("token") == "tok_abc"

    # Fresh manager reads same data (key persists on disk)
    sm2 = SecretsManager(tmp_path)
    assert sm2.get("api_key") == "sk-test-1234567890"
    assert sm2.get("token") == "tok_abc"


def test_secrets_delete(tmp_path: Path):
    """Deleting a secret removes it."""
    from security import SecretsManager

    sm = SecretsManager(tmp_path)
    sm.set("temp", "value")
    sm.delete("temp")
    assert sm.get("temp") is None


def test_secrets_isolation(tmp_path: Path):
    """Secrets from different dirs don't cross-contaminate."""
    from security import SecretsManager

    dir_a = tmp_path / "a"
    dir_b = tmp_path / "b"
    dir_a.mkdir()
    dir_b.mkdir()

    SecretsManager(dir_a).set("key", "value_a")
    result = SecretsManager(dir_b).get("key")
    assert result is None


# ── Approval file: atomic write + read ──────────────────────────────

def test_approval_atomic_write_and_read(tmp_path: Path):
    """Approval response written atomically is readable without corruption."""
    response_data = json.dumps({
        "response": "allow_once",
        "message_id": 42,
        "timestamp": time.time(),
    })
    agent = "claude-1"
    response_file = tmp_path / f"{agent}_approval.json"
    tmp_file = response_file.with_suffix(".tmp")

    # Simulate atomic write (as in app.py respond_approval)
    tmp_file.write_text(response_data)
    os.replace(str(tmp_file), str(response_file))

    assert response_file.exists()
    assert not tmp_file.exists()

    data = json.loads(response_file.read_text())
    assert data["response"] == "allow_once"
    assert data["message_id"] == 42


# ── Rules + jobs concurrent creation ─────────────────────────────────

@pytest_asyncio.fixture
async def rules_store_inst(tmp_path: Path):
    import aiosqlite

    from rules import RuleStore
    conn = await aiosqlite.connect(str(tmp_path / "rules.db"))
    conn.row_factory = aiosqlite.Row
    rs = RuleStore(conn)
    await rs.init()
    yield rs
    await conn.close()


@pytest.mark.asyncio
async def test_rules_concurrent_proposals(rules_store_inst):
    """Multiple rules proposed concurrently are all stored correctly."""
    rs = rules_store_inst

    proposals = ["No profanity", "Be concise", "Cite sources", "Ask before deleting"]
    tasks = [rs.propose(text=p, author="admin") for p in proposals]
    results = await asyncio.gather(*tasks)

    assert len(results) == 4
    all_rules = await rs.list_all()
    stored_texts = [r["text"] for r in all_rules]
    for p in proposals:
        assert p in stored_texts


@pytest.mark.asyncio
async def test_rules_update_and_delete_pipeline(rules_store_inst):
    """Rule proposed, updated, then deleted — clean state throughout."""
    rs = rules_store_inst

    rule = await rs.propose("Draft rule", "alice")
    assert rule["text"] == "Draft rule"

    # Update the rule text
    updated = await rs.update(rule["id"], {"text": "Final rule"})
    assert updated["text"] == "Final rule"

    # Delete it
    deleted = await rs.delete(rule["id"])
    assert deleted

    remaining = await rs.list_all()
    assert len(remaining) == 0


# ── AgentMemory multi-agent isolation ────────────────────────────────

def test_agent_memory_multi_agent_isolation(tmp_path: Path):
    """Multiple agents have completely separate memory namespaces."""
    from agent_memory import AgentMemory

    agents = ["claude-1", "gemini-1", "codex-1"]
    for agent in agents:
        mem = AgentMemory(tmp_path, agent)
        mem.save("private_key", f"data_for_{agent}")

    for agent in agents:
        mem = AgentMemory(tmp_path, agent)
        result = mem.load("private_key")
        assert result is not None
        assert result["content"] == f"data_for_{agent}"

    # Cross-agent: claude-1's key is not visible to gemini-1
    mem_b = AgentMemory(tmp_path, "gemini-1")
    # gemini-1 has its own private_key, but not claude-1's
    # (both have the same key name but different content)
    result = mem_b.load("private_key")
    assert result["content"] == "data_for_gemini-1"


def test_agent_memory_search_cross_agent(tmp_path: Path):
    """Search is scoped to the requesting agent's memory only."""
    from agent_memory import AgentMemory

    mem_a = AgentMemory(tmp_path, "claude-1")
    mem_b = AgentMemory(tmp_path, "gemini-1")

    mem_a.save("project", "ghostlink integration tests")
    mem_b.save("project", "unrelated project xyz")

    results_a = mem_a.search("ghostlink")
    results_b = mem_b.search("ghostlink")

    assert len(results_a) > 0
    assert len(results_b) == 0  # gemini-1 has no "ghostlink" in memory


def test_search_all_memories_cross_agent(tmp_path: Path):
    """search_all_memories finds results across multiple agents."""
    from agent_memory import AgentMemory, search_all_memories

    mem_a = AgentMemory(tmp_path, "claude-1")
    mem_b = AgentMemory(tmp_path, "gemini-1")
    mem_c = AgentMemory(tmp_path, "codex-1")

    mem_a.save("design", "React component architecture for dashboard")
    mem_b.save("research", "React performance optimization techniques")
    mem_c.save("notes", "Python backend refactoring plan")

    # Search for "React" should find results from claude-1 and gemini-1
    results = search_all_memories(tmp_path, "React")
    assert len(results) == 2
    agents_found = {r["agent"] for r in results}
    assert "claude-1" in agents_found
    assert "gemini-1" in agents_found
    assert "codex-1" not in agents_found

    # Search for "plan" should find codex-1
    results = search_all_memories(tmp_path, "plan")
    assert len(results) == 1
    assert results[0]["agent"] == "codex-1"

    # Search for nonexistent term returns empty
    results = search_all_memories(tmp_path, "zzz_nonexistent")
    assert len(results) == 0
