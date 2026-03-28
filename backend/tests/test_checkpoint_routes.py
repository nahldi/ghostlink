"""Route-level tests for agent workspace checkpoints."""

from __future__ import annotations

from pathlib import Path

import pytest

import deps


class _DummyRequest:
    def __init__(self, body: dict):
        self._body = body

    async def json(self) -> dict:
        return self._body


@pytest.fixture
def checkpoint_env(tmp_path: Path, tmp_data_dir: Path):
    from registry import AgentRegistry

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "src").mkdir()
    (workspace / "src" / "app.ts").write_text("export const value = 1;\n", encoding="utf-8")
    (workspace / "README.md").write_text("# GhostLink\n", encoding="utf-8")

    deps.registry = AgentRegistry()
    agent = deps.registry.register("codex")
    agent.workspace = str(workspace)
    deps.DATA_DIR = tmp_data_dir
    deps._activity_log.clear()
    deps._agent_replay_log.clear()
    deps._agent_presence.clear()

    async def _broadcast(*_args, **_kwargs):
        return None

    deps.broadcast = _broadcast
    return {"agent": agent.name, "workspace": workspace}


@pytest.mark.asyncio
async def test_checkpoint_lifecycle_restores_workspace(checkpoint_env):
    from routes import agents

    agent = checkpoint_env["agent"]
    workspace = checkpoint_env["workspace"]

    created = await agents.create_agent_checkpoint(agent, _DummyRequest({"label": "Before restore"}))
    assert created["ok"] is True
    checkpoint = created["checkpoint"]
    assert checkpoint["label"] == "Before restore"
    assert checkpoint["file_count"] == 2
    assert checkpoint["size_bytes"] > 0

    listing = await agents.list_agent_checkpoints(agent)
    assert [item["id"] for item in listing["checkpoints"]] == [checkpoint["id"]]

    (workspace / "src" / "app.ts").write_text("export const value = 2;\n", encoding="utf-8")
    (workspace / "src" / "extra.ts").write_text("export const extra = true;\n", encoding="utf-8")
    (workspace / "README.md").unlink()

    restored = await agents.restore_agent_checkpoint(agent, checkpoint["id"])
    assert restored["ok"] is True
    assert restored["stats"]["created"] == 1
    assert restored["stats"]["modified"] == 1
    assert restored["stats"]["deleted"] == 1

    assert (workspace / "src" / "app.ts").read_text("utf-8") == "export const value = 1;\n"
    assert (workspace / "README.md").read_text("utf-8") == "# GhostLink\n"
    assert not (workspace / "src" / "extra.ts").exists()

    deleted = await agents.delete_agent_checkpoint(agent, checkpoint["id"])
    assert deleted["ok"] is True
    after_delete = await agents.list_agent_checkpoints(agent)
    assert after_delete["checkpoints"] == []

    replay_types = [event.get("type") for event in deps._agent_replay_log]
    assert "checkpoint_create" in replay_types
    assert "checkpoint_restore" in replay_types
    assert "checkpoint_delete" in replay_types
    assert deps._agent_presence[agent]["surface"] == "checkpoints"


@pytest.mark.asyncio
async def test_checkpoint_restore_rejects_invalid_checkpoint_id(checkpoint_env):
    from routes import agents

    agent = checkpoint_env["agent"]
    response = await agents.restore_agent_checkpoint(agent, "../escape")
    assert response.status_code == 400
    assert response.body == b'{"error":"invalid checkpoint id"}'

