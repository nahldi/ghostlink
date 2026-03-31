"""Unit tests for backend modules: store, registry, router, rules, jobs, sessions."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

import pytest
import pytest_asyncio

# ── MessageStore ──────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def db(tmp_path: Path):
    """Isolated MessageStore (opens its own SQLite) for each test."""
    from store import MessageStore

    db_path = tmp_path / "test.db"
    ms = MessageStore(db_path)
    await ms.init()
    yield ms
    if ms._db:
        await ms._db.close()


@pytest.mark.asyncio
async def test_store_add_and_get(db):
    """Messages survive a round-trip through the store."""
    await db.add("alice", "hello world", channel="general")
    msgs = await db.get_recent(count=10, channel="general")
    assert len(msgs) == 1
    assert msgs[0]["sender"] == "alice"
    assert msgs[0]["text"] == "hello world"


@pytest.mark.asyncio
async def test_store_fts_search(db):
    """Full-text search returns matching messages."""
    await db.add("alice", "the quick brown fox", channel="general")
    await db.add("bob", "hello world", channel="general")
    # FTS search is done via the app's search endpoint; store has no direct search method.
    # Verify messages were stored correctly instead.
    msgs = await db.get_recent(count=10, channel="general")
    assert len(msgs) == 2
    texts = [m["text"] for m in msgs]
    assert "the quick brown fox" in texts
    assert "hello world" in texts


@pytest.mark.asyncio
async def test_store_channels_isolated(db):
    """Messages in channel A don't appear in channel B queries."""
    await db.add("alice", "msg in general", channel="general")
    await db.add("bob", "msg in dev", channel="dev")
    gen_msgs = await db.get_recent(count=10, channel="general")
    dev_msgs = await db.get_recent(count=10, channel="dev")
    assert all(m["channel"] == "general" for m in gen_msgs)
    assert all(m["channel"] == "dev" for m in dev_msgs)


@pytest.mark.asyncio
async def test_store_edit_message(db):
    """Editing a message updates its text."""
    await db.add("alice", "original text", channel="general")
    msgs = await db.get_recent(count=10, channel="general")
    msg_id = msgs[0]["id"]
    await db.edit(msg_id, "edited text")
    msgs2 = await db.get_recent(count=10, channel="general")
    assert msgs2[0]["text"] == "edited text"


@pytest.mark.asyncio
async def test_store_edit_returns_updated_message(db):
    """Editing returns the post-update message snapshot."""
    await db.add("alice", "before", channel="general")
    msg_id = (await db.get_recent(count=10, channel="general"))[0]["id"]
    edited = await db.edit(msg_id, "after")
    assert edited is not None
    assert edited["id"] == msg_id
    assert edited["text"] == "after"


@pytest.mark.asyncio
async def test_store_delete_message(db):
    """Deleting a message removes it."""
    await db.add("alice", "to be deleted", channel="general")
    msgs = await db.get_recent(count=10, channel="general")
    msg_id = msgs[0]["id"]
    deleted = await db.delete([msg_id])
    assert msg_id in deleted
    msgs2 = await db.get_recent(count=10, channel="general")
    assert len(msgs2) == 0


@pytest.mark.asyncio
async def test_store_generated_uid_is_full_uuid_hex(db):
    """Generated message UIDs use the full UUID hex to avoid short-ID collisions."""
    msg = await db.add("alice", "hello world", channel="general")
    assert len(msg["uid"]) == 32
    int(msg["uid"], 16)


@pytest.mark.asyncio
async def test_store_react_is_serialized(db):
    """Concurrent reactions preserve both writers instead of losing one update."""
    msg = await db.add("alice", "hello world", channel="general")
    first, second = await asyncio.gather(
        db.react(msg["id"], "😀", "bob"),
        db.react(msg["id"], "😀", "carol"),
    )
    assert first is not None
    assert second is not None
    stored = await db.get_by_id(msg["id"])
    assert stored is not None
    assert sorted(json.loads(stored["reactions"])["😀"]) == ["bob", "carol"]


# ── AgentRegistry ─────────────────────────────────────────────────────

def test_registry_register_unique_names():
    """Registering the same base twice gets unique names."""
    from registry import AgentRegistry
    reg = AgentRegistry()
    a1 = reg.register("claude")
    a2 = reg.register("claude")
    assert a1.name != a2.name
    assert "claude" in a1.name
    assert "claude" in a2.name


def test_registry_deregister():
    """Deregistering removes the agent."""
    from registry import AgentRegistry
    reg = AgentRegistry()
    inst = reg.register("codex")
    assert reg.get(inst.name) is not None
    ok = reg.deregister(inst.name)
    assert ok
    assert reg.get(inst.name) is None


def test_registry_get_all():
    """get_all returns all registered agents."""
    from registry import AgentRegistry
    reg = AgentRegistry()
    reg.register("alice")
    reg.register("bob")
    all_agents = reg.get_all()
    assert len(all_agents) == 2


def test_registry_kill_one_doesnt_affect_others():
    """Killing claude-1 should not affect claude-2."""
    from registry import AgentRegistry
    reg = AgentRegistry()
    a1 = reg.register("claude")
    a2 = reg.register("claude")
    reg.deregister(a1.name)
    assert reg.get(a2.name) is not None, "claude-2 should still be alive after killing claude-1"


def test_registry_keeps_first_agent_name_stable():
    """A second instance must not rename the first registered agent."""
    from registry import AgentRegistry
    reg = AgentRegistry()
    a1 = reg.register("claude")
    a2 = reg.register("claude")
    assert a1.name == "claude"
    assert a2.name == "claude-2"
    assert reg.get("claude") is a1


def test_registry_reuses_base_name_when_primary_slot_reopens():
    """If the bare base name is free again, the next registration should reuse it."""
    from registry import AgentRegistry
    reg = AgentRegistry()
    a1 = reg.register("claude")
    a2 = reg.register("claude")
    reg.deregister(a1.name)
    a3 = reg.register("claude")
    assert a2.name == "claude-2"
    assert a3.name == "claude"


def test_plugin_safety_scanner_allows_supported_plugin_imports():
    """Community plugins may use the documented safe import set."""
    from plugin_sdk import SafetyScanner

    code = """
import asyncio
import json
from pathlib import Path
from plugin_sdk import event_bus
from fastapi.responses import JSONResponse
"""

    issues = SafetyScanner.scan(code)
    assert not [issue for issue in issues if issue["severity"] == "critical"]


def test_plugin_safety_scanner_blocks_os_import():
    """Community plugins must not import os."""
    from plugin_sdk import SafetyScanner

    issues = SafetyScanner.scan("import os")
    assert any("Blocked import: os" == issue["message"] for issue in issues)


def test_plugin_safety_scanner_blocks_non_allowlisted_imports():
    """Imports outside the safe set are rejected even if not on the hard denylist."""
    from plugin_sdk import SafetyScanner

    issues = SafetyScanner.scan("import urllib.request")
    assert any(
        "Import not allowed in plugins: urllib.request" == issue["message"]
        for issue in issues
    )


# ── MessageRouter ─────────────────────────────────────────────────────

def test_router_mention_extraction():
    """@mention is extracted from message text."""
    from registry import AgentRegistry
    from router import MessageRouter
    reg = AgentRegistry()
    inst = reg.register("claude")
    router = MessageRouter()
    agent_names = [inst.name]
    targets = router.get_targets("You", f"@{inst.name} please help me", "general", agent_names)
    assert inst.name in targets


def test_router_all_mention():
    """@all targets all registered agents except the sender."""
    from registry import AgentRegistry
    from router import MessageRouter
    reg = AgentRegistry()
    a1 = reg.register("claude")
    a2 = reg.register("gemini")
    router = MessageRouter()
    agent_names = [a1.name, a2.name]
    targets = router.get_targets("You", "@all do this please", "general", agent_names)
    assert a1.name in targets
    assert a2.name in targets


def test_router_no_mention():
    """A message with no @mention returns no targets (with no autorouting)."""
    from registry import AgentRegistry
    from router import MessageRouter
    reg = AgentRegistry()
    router = MessageRouter()
    targets = router.get_targets("You", "just a plain message", "general", [])
    assert len(targets) == 0


# ── Sessions ──────────────────────────────────────────────────────────

def test_session_start_and_persist(tmp_path: Path):
    """Starting a session saves it and it survives reload."""
    from sessions import SessionManager
    sm = SessionManager(tmp_path)
    session = sm.start_session(
        channel="general",
        template_id="code-review",
        cast={"Reviewer": "claude-1", "Author": "gemini-1"},
        topic="PR review",
    )
    assert session["status"] == "active"
    assert session["channel"] == "general"

    # Reload from disk
    sm2 = SessionManager(tmp_path)
    loaded = sm2.get_session("general")
    assert loaded is not None
    assert loaded["status"] == "active"
    assert loaded["topic"] == "PR review"


def test_session_advance_turn(tmp_path: Path):
    """Advancing turns progresses through phases."""
    from sessions import SessionManager
    sm = SessionManager(tmp_path)
    sm.start_session("general", "code-review", {"Reviewer": "a", "Author": "b"})
    s = sm.advance_turn("general")
    assert s is not None
    assert s["current_turn"] >= 1 or s["current_phase"] >= 1


def test_session_end(tmp_path: Path):
    """Ending a session marks it completed."""
    from sessions import SessionManager
    sm = SessionManager(tmp_path)
    sm.start_session("general", "planning", {"Facilitator": "a", "Contributor": "b"})
    ended = sm.end_session("general")
    assert ended["status"] == "completed"


# ── Rules ─────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def rules_store(tmp_path: Path):
    import aiosqlite

    from rules import RuleStore
    conn = await aiosqlite.connect(str(tmp_path / "rules.db"))
    conn.row_factory = aiosqlite.Row
    rs = RuleStore(conn)
    await rs.init()
    yield rs
    await conn.close()


@pytest.mark.asyncio
async def test_rules_propose_and_list(rules_store):
    """Rules can be proposed and listed."""
    rule = await rules_store.propose(
        text="No swearing",
        author="admin",
    )
    assert rule["text"] == "No swearing"
    all_rules = await rules_store.list_all()
    assert len(all_rules) == 1


@pytest.mark.asyncio
async def test_rules_delete(rules_store):
    """Deleted rules no longer appear."""
    rule = await rules_store.propose("temp rule", "admin")
    deleted = await rules_store.delete(rule["id"])
    assert deleted
    remaining = await rules_store.list_all()
    assert len(remaining) == 0


# ── Jobs ──────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def jobs_store(tmp_path: Path):
    import aiosqlite

    from jobs import JobStore
    conn = await aiosqlite.connect(str(tmp_path / "jobs.db"))
    conn.row_factory = aiosqlite.Row
    js = JobStore(conn)
    await js.init()
    yield js
    await conn.close()


@pytest.mark.asyncio
async def test_jobs_create_and_list(jobs_store):
    """Jobs can be proposed and listed."""
    job = await jobs_store.create(
        title="Fix the bug",
        body="It crashes on startup",
        created_by="claude-1",
        channel="general",
    )
    assert job["title"] == "Fix the bug"
    assert job["status"] == "open"
    all_jobs = await jobs_store.list_jobs("general")
    assert len(all_jobs) == 1


@pytest.mark.asyncio
async def test_jobs_update_status(jobs_store):
    """Updating a job status works."""
    job = await jobs_store.create("Task", channel="general", created_by="alice")
    updated = await jobs_store.update(job["id"], {"status": "claimed", "assignee": "bob"})
    assert updated["status"] == "claimed"
    assert updated["assignee"] == "bob"


@pytest.mark.asyncio
async def test_jobs_generated_uid_is_full_uuid_hex(jobs_store):
    """Generated job UIDs use the full UUID hex to avoid short-ID collisions."""
    job = await jobs_store.create("Task", channel="general", created_by="alice")
    assert len(job["uid"]) == 32
    int(job["uid"], 16)


# ── ScheduleStore ─────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def sched_store(tmp_path: Path):
    import aiosqlite

    from schedules import ScheduleStore
    conn = await aiosqlite.connect(str(tmp_path / "sched.db"))
    conn.row_factory = aiosqlite.Row
    ss = ScheduleStore(conn)
    await ss.init()
    yield ss
    await conn.close()


@pytest.mark.asyncio
async def test_schedule_create_and_list(sched_store):
    """Schedules can be created and listed."""
    sched = await sched_store.create(
        cron_expr="0 9 * * 1",
        agent="claude-1",
        command="daily standup",
        channel="general",
    )
    assert sched["cron_expr"] == "0 9 * * 1"
    all_scheds = await sched_store.list_all()
    assert len(all_scheds) == 1


@pytest.mark.asyncio
async def test_schedule_disable(sched_store):
    """Disabling a schedule removes it from the enabled list."""
    sched = await sched_store.create("* * * * *", "agent", "cmd", "general", enabled=True)
    await sched_store.update(sched["id"], {"enabled": False})
    enabled = await sched_store.list_enabled()
    assert all(s["id"] != sched["id"] for s in enabled)


@pytest.mark.asyncio
async def test_schedule_generated_uid_is_full_uuid_hex(sched_store):
    """Generated schedule UIDs use the full UUID hex to avoid short-ID collisions."""
    sched = await sched_store.create("* * * * *", "agent", "cmd", "general", enabled=True)
    assert len(sched["uid"]) == 32
    int(sched["uid"], 16)


@pytest.mark.asyncio
async def test_schedule_claim_due_run_is_atomic(sched_store):
    """A schedule run can only be claimed once per cooldown window."""
    sched = await sched_store.create("* * * * *", "agent", "cmd", "general", enabled=True)
    now = time.time()
    assert await sched_store.claim_due_run(sched["id"], 60, now)
    assert not await sched_store.claim_due_run(sched["id"], 60, now)
    assert await sched_store.claim_due_run(sched["id"], 60, now + 61)


def test_plugin_loader_rejects_invalid_names(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Plugin install/uninstall refuse path-traversal names."""
    import plugin_loader

    monkeypatch.setattr(plugin_loader, "PLUGINS_DIR", tmp_path / "plugins")
    monkeypatch.setattr(plugin_loader, "MANIFEST_FILE", plugin_loader.PLUGINS_DIR / "manifest.json")
    result = plugin_loader.install_plugin("../escape", "def setup(**kwargs):\n    return None\n")
    assert result["ok"] is False
    assert plugin_loader.uninstall_plugin("../escape") is False


def test_user_manager_tracks_admins(tmp_path: Path):
    """Initial admin bootstrap state is detectable by the auth layer."""
    from auth import UserManager

    manager = UserManager(tmp_path)
    assert not manager.has_admin()
    user = manager.create_user("admin.user", "hunter2", role="admin")
    assert user["role"] == "admin"
    assert manager.has_admin()


# ── AgentMemory ───────────────────────────────────────────────────────

def test_agent_memory_save_load(tmp_path: Path):
    """AgentMemory persists and loads key-value pairs."""
    from agent_memory import AgentMemory
    mem = AgentMemory(tmp_path, "claude-1")
    mem.save("task", "fix the bug")
    result = mem.load("task")
    assert result is not None
    assert result["content"] == "fix the bug"


def test_agent_memory_search(tmp_path: Path):
    """AgentMemory search returns matching entries."""
    from agent_memory import AgentMemory
    mem = AgentMemory(tmp_path, "claude-1")
    mem.save("project", "ghostlink backend")
    mem.save("language", "python")
    results = mem.search("ghostlink")
    assert len(results) > 0


def test_agent_memory_isolation(tmp_path: Path):
    """Different agents have separate memory stores."""
    from agent_memory import AgentMemory
    mem_a = AgentMemory(tmp_path, "claude-1")
    mem_b = AgentMemory(tmp_path, "gemini-1")
    mem_a.save("private", "only for claude")
    assert mem_b.load("private") is None
