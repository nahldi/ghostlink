from __future__ import annotations

import asyncio
import json
import time
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
def introspect_env(tmp_path: Path):
    deps.DATA_DIR = tmp_path
    deps._settings = {
        "channels": ["general"],
        "username": "You",
        "_server_start": time.time() - 120,
    }
    deps._settings_lock = asyncio.Lock()
    deps._server_logs.clear()
    deps._mcp_tool_stats.clear()
    deps._usage_log.clear()

    from registry import AgentRegistry
    from security import AuditLog, SecretsManager
    from providers import ProviderRegistry

    deps.registry = AgentRegistry()
    deps.audit_log = AuditLog(tmp_path)
    deps.secrets_manager = SecretsManager(tmp_path)
    deps.provider_registry = ProviderRegistry(tmp_path)
    deps.task_store = None
    deps.store = type("Store", (), {"_db": None})()
    return {"data_dir": tmp_path}


@pytest.mark.asyncio
async def test_introspect_memory_empty_state(introspect_env):
    from routes.introspect import introspect_memory

    result = await introspect_memory()

    assert result == {
        "agents": [],
        "totals": {"agents": 0, "entries": 0, "tokens": 0},
    }


@pytest.mark.asyncio
async def test_introspect_memory_returns_summary_only(introspect_env, monkeypatch: pytest.MonkeyPatch):
    import agent_memory
    from agent_memory import get_agent_memory
    from registry import AgentRegistry, init_registry_db
    from routes import agents
    from routes.introspect import introspect_memory

    db = await aiosqlite.connect(str(introspect_env["data_dir"] / "ghostlink_v2.db"))
    db.row_factory = aiosqlite.Row
    await init_registry_db(db)
    deps.runtime_db = db
    deps.registry = AgentRegistry()

    async def _broadcast(*_args, **_kwargs):
        return None

    deps.broadcast = _broadcast
    try:
        registered = await agents.register_agent(_DummyRequest({"base": "codex"}))
        mem = get_agent_memory(deps.DATA_DIR, registered["agent_id"])
        monkeypatch.setattr(
            agent_memory.AgentMemory,
            "_detect_conflicts",
            lambda self, entry: entry.get("key") == "api_secret",
        )
        mem.save("api_secret", "OPENAI_API_KEY=sk-test-secret-value", layer="workspace", tags=["routing"])

        result = await introspect_memory()

        assert result["totals"]["agents"] == 1
        assert result["totals"]["entries"] == 1
        assert result["totals"]["tokens"] > 0
        agent = result["agents"][0]
        assert agent["agent_name"] == registered["name"]
        assert agent["layers"]["workspace"]["entry_count"] == 1
        assert agent["has_conflicts"] is True
        assert "content" not in json.dumps(result).lower()
        assert "sk-test-secret-value" not in json.dumps(result)
    finally:
        await db.close()
        deps.runtime_db = None


@pytest.mark.asyncio
async def test_introspect_tools_uses_safe_aggregates(introspect_env):
    from routes.introspect import introspect_tools

    deps._mcp_tool_stats["web_fetch"] = {
        "invocation_count": 2,
        "success_count": 1,
        "failure_count": 1,
        "last_used": time.time(),
        "raw_args": {"authorization": "Bearer super-secret"},
    }

    result = await introspect_tools()

    tool = next(item for item in result["tools"] if item["name"] == "web_fetch")
    assert tool["invocation_count"] == 2
    assert tool["success_count"] == 1
    assert tool["failure_count"] == 1
    assert tool["policy_mode"] == "ask"
    payload = json.dumps(result)
    assert "super-secret" not in payload
    assert "raw_args" not in payload


@pytest.mark.asyncio
async def test_introspect_stats_zero_state(introspect_env):
    from routes.introspect import introspect_stats
    import app as app_module

    result = await introspect_stats()

    assert result["agents"] == {"total": 0, "active": 0}
    assert result["tasks"] == {"total": 0, "running": 0, "completed": 0, "failed": 0}
    assert result["messages"] == {"total": 0}
    assert result["routes"]["modules"] >= 0
    assert result["routes"]["endpoints"] >= 0
    assert result["tools"]["mcp_tools"] == 32
    assert result["providers"]["total"] == 21
    assert result["skills"]["total"] == 28
    assert result["personas"]["total"] == 14
    assert result["version"] == app_module.__version__
