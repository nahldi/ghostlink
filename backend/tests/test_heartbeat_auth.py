"""Route-level tests for heartbeat authentication and token rotation."""

from __future__ import annotations

import time
from pathlib import Path

import pytest

import deps


class _DummyRequest:
    def __init__(self, body: dict | None = None, headers: dict[str, str] | None = None):
        self._body = body or {}
        self.headers = headers or {}

    async def json(self) -> dict:
        return self._body


@pytest.fixture
def heartbeat_env(tmp_data_dir: Path):
    from registry import AgentRegistry

    deps.DATA_DIR = tmp_data_dir
    deps.registry = AgentRegistry()
    deps._last_heartbeats.clear()
    deps._agent_presence.clear()
    deps._settings["username"] = "You"

    async def _broadcast(*_args, **_kwargs):
        return None

    deps.broadcast = _broadcast
    return {"registry": deps.registry}


@pytest.mark.asyncio
async def test_heartbeat_rejects_missing_bearer_token(heartbeat_env):
    from routes import agents

    inst = heartbeat_env["registry"].register("codex")
    before = deps._last_heartbeats.get(inst.name)

    response = await agents.heartbeat(inst.name, _DummyRequest())

    assert response.status_code == 401
    assert response.body == b'{"error":"unauthorized"}'
    assert deps._last_heartbeats.get(inst.name) == before


@pytest.mark.asyncio
async def test_heartbeat_rejects_token_for_different_agent(heartbeat_env):
    from routes import agents

    codex = heartbeat_env["registry"].register("codex")
    claude = heartbeat_env["registry"].register("claude")

    response = await agents.heartbeat(
        codex.name,
        _DummyRequest(headers={"authorization": f"Bearer {claude.token}"}),
    )

    assert response.status_code == 401
    assert response.body == b'{"error":"unauthorized"}'
    assert codex.name not in deps._last_heartbeats


@pytest.mark.asyncio
async def test_heartbeat_accepts_matching_bearer_token(heartbeat_env):
    from routes import agents

    inst = heartbeat_env["registry"].register("codex")

    result = await agents.heartbeat(
        inst.name,
        _DummyRequest(headers={"authorization": f"Bearer {inst.token}"}),
    )

    assert result["ok"] is True
    assert result["name"] == inst.name
    assert deps._last_heartbeats[inst.name] > 0


@pytest.mark.asyncio
async def test_heartbeat_rotates_expired_matching_token(heartbeat_env):
    from routes import agents

    inst = heartbeat_env["registry"].register("codex")
    old_token = inst.token
    inst.token_issued_at = time.time() - inst.token_ttl - 1

    result = await agents.heartbeat(
        inst.name,
        _DummyRequest(headers={"authorization": f"Bearer {old_token}"}),
    )

    assert result["ok"] is True
    assert result["token"] == inst.token
    assert inst.token != old_token
