from __future__ import annotations

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
async def phase2_env(tmp_path: Path):
    from profiles import init_profiles_db
    from registry import AgentRegistry, init_registry_db
    from router import MessageRouter
    from skills import SkillsRegistry

    db_path = tmp_path / "ghostlink_v2.db"
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    await init_registry_db(db)
    await init_profiles_db(db)

    deps.DATA_DIR = tmp_path
    deps.BASE_DIR = tmp_path
    deps.runtime_db = db
    deps.registry = AgentRegistry()
    deps.router_inst = MessageRouter(max_hops=4, default_routing="none")
    deps.skills_registry = SkillsRegistry(tmp_path, db)
    await deps.skills_registry.init()
    deps._pending_spawns.clear()
    deps._agent_processes.clear()
    deps._last_heartbeats.clear()
    deps._thinking_buffers.clear()
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
async def test_profile_create_read_update_delete(phase2_env):
    from routes import agents

    created = await agents.api_create_profile(_DummyRequest({"name": "Backend Developer", "description": "Owns backend", "base_provider": "codex"}))
    assert created["name"] == "Backend Developer"
    fetched = await agents.api_get_profile(created["profile_id"])
    assert fetched["description"] == "Owns backend"
    updated = await agents.api_update_profile(created["profile_id"], _DummyRequest({"description": "Owns Python backend"}))
    assert updated["description"] == "Owns Python backend"
    deleted = await agents.api_delete_profile(created["profile_id"])
    assert deleted == {"ok": True}


@pytest.mark.asyncio
async def test_agent_profile_assignment_persists(phase2_env):
    from routes import agents

    profile = await agents.api_create_profile(_DummyRequest({"name": "Reviewer"}))
    registered = await agents.register_agent(_DummyRequest({"base": "codex"}))
    response = await agents.set_agent_config(registered["name"], _DummyRequest({"profile_id": profile["profile_id"]}))
    assert response == {"ok": True}

    cursor = await phase2_env["db"].execute("SELECT profile_id FROM agents WHERE agent_id = ?", (registered["agent_id"],))
    try:
        row = await cursor.fetchone()
    finally:
        await cursor.close()
    assert row["profile_id"] == profile["profile_id"]


@pytest.mark.asyncio
async def test_effective_state_endpoint_matches_expected_merge(phase2_env):
    from routes import agents

    profile = await agents.api_create_profile(_DummyRequest({"name": "Backend Developer"}))
    await agents.api_set_profile_settings(profile["profile_id"], _DummyRequest({"model": "claude-sonnet", "thinkingLevel": "high"}))
    await agents.api_set_profile_skills(profile["profile_id"], _DummyRequest({"skill_ids": ["web-search", "git-ops"]}))
    registered = await agents.register_agent(_DummyRequest({"base": "codex"}))
    await agents.set_agent_config(
        registered["name"],
        _DummyRequest({"profile_id": profile["profile_id"], "responseMode": "always", "autoApprove": True}),
    )
    await agents.toggle_agent_skill(registered["name"], _DummyRequest({"skillId": "shell-exec", "enabled": True}))

    effective = await agents.api_get_effective_state(registered["name"])
    merged = effective["effective_state"]
    assert merged["model"] == "claude-sonnet"
    assert merged["thinkingLevel"] == "high"
    assert merged["responseMode"] == "always"
    assert merged["autoApprove"] is True
    assert "shell-exec" in merged["enabled_skills"]
    assert merged["sources"]["model"] == "profile"
    assert merged["sources"]["responseMode"] == "agent"


@pytest.mark.asyncio
async def test_agents_md_review_import_flow(phase2_env):
    from routes import agents

    workspace = phase2_env["data_dir"] / "workspace"
    workspace.mkdir(parents=True)
    (workspace / "AGENTS.md").write_text(
        "# Team\n\n## Workspace Rules\n- Keep tests green\n\n## Jeff\nRole: Architect\n- Owns specs\n",
        encoding="utf-8",
    )

    scanned = await agents.api_scan_agents_md(_DummyRequest({"workspace_id": str(workspace)}))
    assert scanned["has_pending"] is True
    imported = await agents.api_import_agents_md(_DummyRequest({"workspace_id": str(workspace)}))
    assert imported["agents_md"]["has_pending"] is False
    assert any(rule["content"] == "Keep tests green" for rule in imported["rules"])
