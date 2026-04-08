from __future__ import annotations

from pathlib import Path

import pytest

import deps
from identity_inject import get_effective_state, inject_identity, record_identity_reinforcement
from tests.test_phase1a import _DummyRequest, phase1a_env
from wrapper_mcp import _compose_exec_prompt


@pytest.mark.asyncio
async def test_identity_files_created_under_agent_id(phase1a_env):
    from routes import agents

    result = await agents.register_agent(_DummyRequest({"base": "codex", "label": "Tyson"}))
    agent_id = result["agent_id"]

    inject_identity(
        agent_id=agent_id,
        agent_name=result["name"],
        agent_base="codex",
        label="Tyson",
        role="Backend Execution",
        data_dir=deps.DATA_DIR,
        project_dir=phase1a_env["data_dir"],
        mcp_settings_path=None,
        trigger="spawn",
    )

    agent_dir = phase1a_env["data_dir"] / "agents" / agent_id
    assert (agent_dir / "IDENTITY.md").exists()
    assert (agent_dir / "SOUL.md").exists()
    assert (agent_dir / "NOTES.md").exists()
    assert (agent_dir / "state.json").exists()
    assert (agent_dir / "injection" / "context.md").exists()

    effective_state = await agents.api_get_effective_state(result["name"])
    assert effective_state["agent_id"] == agent_id
    assert effective_state["last_inject_trigger"] == "spawn"
    assert effective_state["drift_detected"] is False


@pytest.mark.asyncio
async def test_state_json_rebuilt_when_missing(phase1a_env):
    from routes import agents

    result = await agents.register_agent(_DummyRequest({"base": "codex"}))
    agent_dir = phase1a_env["data_dir"] / "agents" / result["agent_id"]
    agent_dir.mkdir(parents=True, exist_ok=True)
    state_path = agent_dir / "state.json"
    state_path.unlink(missing_ok=True)

    effective_state = await agents.api_get_effective_state(result["name"])
    assert effective_state["agent_id"] == result["agent_id"]
    assert effective_state["display_name"] == result["name"]
    assert effective_state["injection_count"] == 0


@pytest.mark.asyncio
async def test_degraded_shared_path_mode_sets_drift_flag(phase1a_env):
    from routes import agents

    result = await agents.register_agent(_DummyRequest({"base": "claude", "label": "Jeff"}))
    inject_result = inject_identity(
        agent_id=result["agent_id"],
        agent_name=result["name"],
        agent_base="claude",
        label="Jeff",
        role="Architect",
        data_dir=deps.DATA_DIR,
        project_dir=phase1a_env["data_dir"],
        mcp_settings_path=None,
        trigger="spawn",
    )

    assert inject_result["degraded"] is True
    state = get_effective_state(deps.DATA_DIR, result["agent_id"])
    assert state["drift_detected"] is True
    assert state["degraded_reason"] == "shared_workspace_identity_file"


@pytest.mark.asyncio
async def test_identity_drift_route_broadcasts_event(phase1a_env):
    from routes import agents

    result = await agents.register_agent(_DummyRequest({"base": "claude"}))
    seen: list[tuple[str, dict]] = []

    async def _broadcast(event: str, payload: dict):
        seen.append((event, payload))

    deps.broadcast = _broadcast
    response = await agents.api_identity_drift(result["name"], _DummyRequest({"reason": "compaction_detected"}))
    assert response == {"ok": True, "reason": "compaction_detected"}
    state = get_effective_state(deps.DATA_DIR, result["agent_id"])
    assert state["drift_detected"] is True
    assert state["drift_score"] == 1.0
    assert state["reinforcement_pending"] is True
    assert any(event == "identity_drift" for event, _payload in seen)


@pytest.mark.asyncio
async def test_identity_reinforcement_clears_pending_drift_state(phase1a_env):
    from routes import agents

    result = await agents.register_agent(_DummyRequest({"base": "codex"}))
    await agents.api_identity_drift(result["name"], _DummyRequest({"reason": "compaction_detected"}))
    state = record_identity_reinforcement(deps.DATA_DIR, result["agent_id"], trigger="compaction_reinjection")

    assert state["drift_detected"] is False
    assert state["drift_score"] == 0.0
    assert state["reinforcement_pending"] is False
    assert state["reinforcement_count"] >= 1
    assert state["last_reinforcement_at"] > 0


def test_exec_prompt_uses_identity_context(tmp_path: Path):
    agent_id = "abc123"
    context_dir = tmp_path / "agents" / agent_id / "injection"
    context_dir.mkdir(parents=True, exist_ok=True)
    (context_dir / "context.md").write_text("IDENTITY CONTEXT", encoding="utf-8")

    prompt = _compose_exec_prompt(
        {"GHOSTLINK_DATA_DIR": str(tmp_path), "GHOSTLINK_AGENT_ID": agent_id},
        "codex",
        "mcp read #backend",
    )
    assert "IDENTITY CONTEXT" in prompt
    assert "mcp read #backend" in prompt
