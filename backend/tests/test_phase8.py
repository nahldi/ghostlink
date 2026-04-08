from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import aiosqlite
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import deps
from a2a import A2AManager
from policy import PolicyEngine
from registry import AgentRegistry
from routes import a2a as a2a_routes
from task_store import TaskStore


@pytest_asyncio.fixture
async def phase8_env(tmp_path: Path):
    db_path = tmp_path / "ghostlink_v2.db"
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row

    old_data_dir = deps.DATA_DIR
    old_registry = deps.registry
    old_task_store = deps.task_store
    old_policy_engine = deps.policy_engine
    old_a2a = deps.a2a_bridge
    old_user_manager = deps.user_manager
    old_host = getattr(deps, "HOST", "127.0.0.1")
    old_port = getattr(deps, "PORT", 8300)
    old_audit_store = deps.audit_store

    deps.DATA_DIR = tmp_path
    deps.HOST = "127.0.0.1"
    deps.PORT = 8300
    deps._settings = {}
    deps.registry = AgentRegistry()
    deps.task_store = TaskStore(db)
    await deps.task_store.init()
    deps.policy_engine = PolicyEngine(db, tmp_path)
    await deps.policy_engine.init()
    deps.a2a_bridge = A2AManager(tmp_path, server_version="test")
    deps.user_manager = SimpleNamespace()
    deps.audit_store = None
    try:
        yield {"db": db, "tmp_path": tmp_path}
    finally:
        await db.close()
        deps.DATA_DIR = old_data_dir
        deps.registry = old_registry
        deps.task_store = old_task_store
        deps.policy_engine = old_policy_engine
        deps.a2a_bridge = old_a2a
        deps.user_manager = old_user_manager
        deps.HOST = old_host
        deps.PORT = old_port
        deps.audit_store = old_audit_store


@pytest.mark.asyncio
async def test_agent_card_serves_at_well_known_endpoint(phase8_env):
    deps.registry.register("codex", label="Tyson")
    app = FastAPI()
    app.include_router(a2a_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get("/.well-known/agent-card.json", params={"agent": "codex"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "codex"
    assert payload["id"]
    assert payload["url"].endswith("/a2a")
    assert payload["auth"]["type"] == "bearer"
    assert payload["provider"] == "codex"


@pytest.mark.asyncio
async def test_remote_agent_card_discovery_from_configured_endpoint(phase8_env, monkeypatch: pytest.MonkeyPatch):
    async def _fake_fetch(url: str):
        assert url == "https://remote.example/.well-known/agent-card.json"
        return {
            "id": "remote-agent",
            "name": "Remote Agent",
            "url": "https://remote.example/a2a",
            "capabilities": {"streaming": False},
        }

    monkeypatch.setattr(deps.a2a_bridge, "_fetch_json", _fake_fetch)

    discovered = await deps.a2a_bridge.discover("https://remote.example")

    assert discovered["endpoint"] == "https://remote.example"
    assert discovered["card"]["name"] == "Remote Agent"
    assert deps.a2a_bridge.list_discovered()[0]["card"]["id"] == "remote-agent"


@pytest.mark.asyncio
async def test_a2a_card_put_persists_frontend_shape(phase8_env):
    app = FastAPI()
    app.include_router(a2a_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.put(
            "/api/a2a/card",
            json={
                "name": "GhostLink Node",
                "description": "A2A-ready node",
                "url": "https://ghostlink.local",
                "skills": ["planning", "execution"],
                "capabilities": ["delegate", "streaming"],
                "default_input_modes": ["text"],
                "default_output_modes": ["text", "artifact"],
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "GhostLink Node"
    assert payload["url"] == "https://ghostlink.local/a2a"
    assert payload["skills"] == ["planning", "execution"]
    assert payload["capabilities"] == ["delegate", "streaming"]


@pytest.mark.asyncio
async def test_inbound_a2a_request_is_checked_by_policy_before_execution(phase8_env, monkeypatch: pytest.MonkeyPatch):
    calls: list[tuple[str, str, str]] = []

    async def _deny(action: str, tier: str, context, *, snapshot=None):
        calls.append((action, tier, context.agent_name))
        return {"decision": "ask", "reason": "manual-review-required"}

    monkeypatch.setattr(deps.policy_engine, "evaluate", _deny)

    result = await deps.a2a_bridge.handle_rpc(
        {
            "jsonrpc": "2.0",
            "id": "rpc-1",
            "method": "tasks/send",
            "params": {
                "id": "remote-task-1",
                "agent_id": "codex",
                "message": {"parts": [{"type": "text", "text": "Review this patch"}]},
                "metadata": {"source_agent_name": "Remote Agent", "trace_id": "trace-1"},
            },
        }
    )

    assert calls == [("a2a_inbound", "external_messaging", "Remote Agent")]
    assert result["error"]["message"].startswith("Inbound A2A blocked")
    assert await deps.task_store.list_tasks(limit=10) == []


@pytest.mark.asyncio
async def test_outbound_a2a_invocation_creates_mapped_ghostlink_task(phase8_env, monkeypatch: pytest.MonkeyPatch):
    inst = deps.registry.register("codex", label="Tyson")

    async def _fake_post(url: str, payload: dict):
        assert url == "https://remote.example/a2a"
        assert payload["method"] == "tasks/send"
        return {"jsonrpc": "2.0", "id": payload["id"], "result": {"id": "remote-task-42", "status": {"state": "working"}}}

    monkeypatch.setattr(deps.a2a_bridge, "_post_json", _fake_post)

    result = await deps.a2a_bridge.invoke_remote(
        endpoint="https://remote.example",
        target_agent="remote-agent",
        prompt="Analyze the migration plan",
        local_agent_id=inst.agent_id,
        local_agent_name=inst.name,
        channel="general",
    )

    assert result["ok"] is True
    task = await deps.task_store.get(result["task_id"])
    assert task is not None
    assert task["source_type"] == "a2a"
    assert task["source_ref"] == "remote-task-42"
    assert task["status"] == "awaiting_external"
    assert task["trace_id"].startswith("a2a-")
    assert task["metadata"]["endpoint"] == "https://remote.example"


@pytest.mark.asyncio
async def test_route_contract_matches_frontend_discovery_and_delegate_shapes(phase8_env, monkeypatch: pytest.MonkeyPatch):
    inst = deps.registry.register("codex", label="Tyson")
    app = FastAPI()
    app.include_router(a2a_routes.router)

    async def _fake_fetch(url: str):
        return {
            "id": "remote-1",
            "name": "Remote Planner",
            "description": "Handles planning",
            "url": "https://remote.example/a2a",
            "skills": [{"name": "planning"}],
            "capabilities": {"streaming": False, "delegate": True},
            "defaultInputModes": ["text"],
            "defaultOutputModes": ["text"],
        }

    async def _fake_post(url: str, payload: dict):
        return {"jsonrpc": "2.0", "id": payload["id"], "result": {"id": "remote-task-42", "status": {"state": "working"}}}

    monkeypatch.setattr(deps.a2a_bridge, "_fetch_json", _fake_fetch)
    monkeypatch.setattr(deps.a2a_bridge, "_post_json", _fake_post)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        discovery = await client.post("/api/a2a/discover", json={"url": "https://remote.example/.well-known/agent-card.json"})
        delegation = await client.post(
            "/api/a2a/delegate",
            json={
                "target_url": "https://remote.example",
                "remote_agent_id": "remote-1",
                "local_agent_name": inst.name,
                "title": "Delegate plan",
                "prompt": "Analyze the migration plan",
                "channel": "general",
            },
        )

    assert discovery.status_code == 200
    discovery_payload = discovery.json()
    assert discovery_payload["source_url"] == "https://remote.example/.well-known/agent-card.json"
    assert discovery_payload["agents"][0]["name"] == "Remote Planner"
    assert discovery_payload["agents"][0]["skills"] == ["planning"]

    assert delegation.status_code == 200
    delegation_payload = delegation.json()
    assert delegation_payload["ok"] is True
    assert delegation_payload["remote_task_id"] == "remote-task-42"
    assert delegation_payload["target_agent_id"] == "remote-1"
    assert delegation_payload["task"]["source_type"] == "a2a"


@pytest.mark.asyncio
async def test_a2a_task_routes_expose_local_status_and_stream(phase8_env):
    task = await deps.task_store.create(
        title="A2A delegate: remote-1",
        description="Analyze the migration plan",
        channel="general",
        source_type="a2a",
        source_ref="remote-task-42",
        status="awaiting_external",
        metadata={"endpoint": "https://remote.example"},
    )
    await deps.task_store.update_progress(
        task["task_id"],
        75,
        "awaiting_remote",
        3,
        {"steps": [{"label": "routing", "status": "completed"}, {"label": "delegating", "status": "completed"}, {"label": "awaiting_remote", "status": "active"}]},
    )

    app = FastAPI()
    app.include_router(a2a_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get(f"/api/a2a/tasks/{task['task_id']}")
        stream = await client.get(f"/api/a2a/tasks/{task['task_id']}/stream", params={"limit": 1, "interval_ms": 1})

    assert response.status_code == 200
    payload = response.json()
    assert payload["source_type"] == "a2a"
    assert payload["progress_step"] == "awaiting_remote"

    assert stream.status_code == 200
    assert "text/event-stream" in stream.headers["content-type"]
    assert '"status": "awaiting_external"' in stream.text
    assert '"source_ref": "remote-task-42"' in stream.text


@pytest.mark.asyncio
async def test_a2a_task_refresh_maps_remote_completion_into_local_task(phase8_env, monkeypatch: pytest.MonkeyPatch):
    task = await deps.task_store.create(
        title="A2A delegate: remote-1",
        description="Analyze the migration plan",
        channel="general",
        source_type="a2a",
        source_ref="remote-task-42",
        status="awaiting_external",
        metadata={"endpoint": "https://remote.example", "target_agent": "remote-1"},
    )

    async def _fake_post(url: str, payload: dict):
        assert url == "https://remote.example/a2a"
        assert payload["method"] == "tasks/get"
        assert payload["params"]["id"] == "remote-task-42"
        return {
            "jsonrpc": "2.0",
            "id": payload["id"],
            "result": {
                "id": "remote-task-42",
                "status": {"state": "completed"},
                "artifact": {"type": "text", "text": "done"},
            },
        }

    monkeypatch.setattr(deps.a2a_bridge, "_post_json", _fake_post)

    app = FastAPI()
    app.include_router(a2a_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post(f"/api/a2a/tasks/{task['task_id']}/refresh")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["task"]["status"] == "completed"
    assert payload["task"]["progress_step"] == "completed"
    assert payload["task"]["metadata"]["remote_status"]["state"] == "completed"
    assert payload["task"]["metadata"]["remote_artifact"]["text"] == "done"


@pytest.mark.asyncio
async def test_a2a_task_refresh_maps_remote_failure_into_local_task(phase8_env, monkeypatch: pytest.MonkeyPatch):
    task = await deps.task_store.create(
        title="A2A delegate: remote-1",
        description="Analyze the migration plan",
        channel="general",
        source_type="a2a",
        source_ref="remote-task-77",
        status="awaiting_external",
        metadata={"endpoint": "https://remote.example", "target_agent": "remote-1"},
    )

    async def _fake_post(url: str, payload: dict):
        assert url == "https://remote.example/a2a"
        return {
            "jsonrpc": "2.0",
            "id": payload["id"],
            "result": {
                "id": "remote-task-77",
                "status": {"state": "failed", "message": "remote provider failure"},
            },
        }

    monkeypatch.setattr(deps.a2a_bridge, "_post_json", _fake_post)

    app = FastAPI()
    app.include_router(a2a_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post(f"/api/a2a/tasks/{task['task_id']}/refresh")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["task"]["status"] == "failed"
    assert payload["task"]["error"] == "remote provider failure"
    assert payload["task"]["metadata"]["remote_error"] == "remote provider failure"
    assert payload["task"]["metadata"]["remote_status"]["state"] == "failed"


@pytest.mark.asyncio
async def test_a2a_rpc_rejects_missing_shared_key_when_configured(phase8_env):
    deps._settings["a2a_shared_key"] = "super-secret"
    app = FastAPI()
    app.include_router(a2a_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post(
            "/a2a",
            json={"jsonrpc": "2.0", "id": "rpc-1", "method": "tasks/get", "params": {"id": "remote-task-1"}},
        )

    assert response.status_code == 401
    assert response.json()["error"]["message"] == "A2A authentication failed"


@pytest.mark.asyncio
async def test_a2a_rpc_accepts_bearer_shared_key_when_configured(phase8_env):
    deps._settings["a2a_shared_key"] = "super-secret"
    app = FastAPI()
    app.include_router(a2a_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post(
            "/a2a",
            headers={"Authorization": "Bearer super-secret"},
            json={"jsonrpc": "2.0", "id": "rpc-2", "method": "tasks/get", "params": {"id": "remote-task-1"}},
        )

    assert response.status_code == 200
    assert response.json()["result"]["status"]["state"] == "unknown"
