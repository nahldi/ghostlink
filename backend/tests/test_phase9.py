from __future__ import annotations

import json
from pathlib import Path

import aiosqlite
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import deps
from plans import init_plans_db
from profiles import init_profiles_db
from registry import AgentRegistry, init_registry_db
from routes import agents as agent_routes
from skills import SkillsRegistry
from store import MessageStore
from task_store import TaskStore


@pytest_asyncio.fixture
async def phase9_env(tmp_path: Path):
    runtime_db_path = tmp_path / "ghostlink_v2.db"
    runtime_db = await aiosqlite.connect(str(runtime_db_path))
    runtime_db.row_factory = aiosqlite.Row
    await init_registry_db(runtime_db)
    await init_profiles_db(runtime_db)
    await init_plans_db(runtime_db)
    task_store = TaskStore(runtime_db)
    await task_store.init()

    message_db_path = tmp_path / "messages.db"
    store = MessageStore(message_db_path)
    await store.init()

    old_data_dir = deps.DATA_DIR
    old_base_dir = deps.BASE_DIR
    old_runtime_db = deps.runtime_db
    old_store = deps.store
    old_task_store = deps.task_store
    old_registry = deps.registry
    old_skills = deps.skills_registry
    old_settings = dict(deps._settings)

    deps.DATA_DIR = tmp_path
    deps.BASE_DIR = tmp_path
    deps.runtime_db = runtime_db
    deps.store = store
    deps.task_store = task_store
    deps.registry = AgentRegistry()
    deps.skills_registry = SkillsRegistry(tmp_path, runtime_db)
    deps._settings.clear()
    deps._settings.update(old_settings)
    await deps.skills_registry.init()

    try:
        yield {"runtime_db": runtime_db, "store": store, "task_store": task_store, "tmp_path": tmp_path}
    finally:
        await store.close()
        await runtime_db.close()
        deps.DATA_DIR = old_data_dir
        deps.BASE_DIR = old_base_dir
        deps.runtime_db = old_runtime_db
        deps.store = old_store
        deps.task_store = old_task_store
        deps.registry = old_registry
        deps.skills_registry = old_skills
        deps._settings.clear()
        deps._settings.update(old_settings)


@pytest.mark.asyncio
async def test_plan_creation_and_approval_flow(phase9_env):
    app = FastAPI()
    app.include_router(agent_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        created = await client.post(
            "/api/plans",
            json={
                "agent_name": "tyson",
                "channel": "general",
                "prompt": "Refactor the task runner and update tests",
                "files": ["backend/task_store.py", "backend/tests/test_task_routes.py"],
                "cost_threshold_usd": 1.5,
            },
        )
        plan_id = created.json()["plan_id"]
        listed = await client.get("/api/plans", params={"channel": "general", "agent_name": "tyson"})
        approved = await client.post(f"/api/plans/{plan_id}/approve", json={"note": "looks good"})
        fetched = await client.get(f"/api/plans/{plan_id}")
        execution_task = await phase9_env["task_store"].get_by_source_ref("plan", plan_id)
        updated_task = await phase9_env["task_store"].update_status(execution_task["task_id"], "running")
        listed_after_approval = await client.get("/api/plans", params={"channel": "general", "agent_name": "tyson"})
        fetched_after_task_update = await client.get(f"/api/plans/{plan_id}")
        messages = await phase9_env["store"].get_recent(10, "general")

    assert created.status_code == 200
    created_payload = created.json()
    assert created_payload["status"] == "pending_approval"
    assert len(created_payload["steps"]) >= 4
    assert created_payload["files"] == ["backend/task_store.py", "backend/tests/test_task_routes.py"]
    assert created_payload["estimated_tokens"] > 0
    assert created_payload["estimated_cost_usd"] > 0
    assert listed.status_code == 200
    assert listed.json()["plans"][0]["plan_id"] == plan_id

    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["decision_note"] == "looks good"
    assert approved.json()["execution_task"]["source_ref"] == plan_id
    assert approved.json()["execution_task"]["status"] == "queued"

    assert fetched.status_code == 200
    assert fetched.json()["status"] == "approved"
    assert execution_task is not None
    assert execution_task["status"] == "queued"
    assert execution_task["source_type"] == "plan"
    assert execution_task["metadata"]["queued_from_plan_approval"] is True
    assert updated_task is not None
    assert updated_task["status"] == "running"
    assert listed_after_approval.status_code == 200
    assert listed_after_approval.json()["plans"][0]["execution_task"]["status"] == "running"
    assert fetched_after_task_update.status_code == 200
    assert fetched_after_task_update.json()["execution_task"]["status"] == "running"
    assert any(msg["type"] == "approval_request" for msg in messages)
    assert any("Execution queued" in msg["text"] for msg in messages)
    assert any("@tyson Approved plan ready to execute:" in msg["text"] for msg in messages)


@pytest.mark.asyncio
async def test_conversation_export_markdown_preserves_code_blocks_tool_summary_and_attachment_links(phase9_env):
    await phase9_env["store"].add(
        sender="tyson",
        text="```python\nprint('hello')\n```",
        channel="builds",
        attachments=json.dumps([{"name": "diagram.png", "url": "https://example.test/diagram.png"}]),
        metadata=json.dumps({"tool_name": "shell_exec", "tool_result": "pytest passed"}),
    )
    await phase9_env["store"].add(
        sender="ned",
        text="UI is wired.",
        channel="builds",
        metadata=json.dumps({"image_url": "https://example.test/screenshot.png"}),
    )

    app = FastAPI()
    app.include_router(agent_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        exported = await client.get("/api/conversations/builds/export-markdown")

    assert exported.status_code == 200
    payload = exported.json()
    markdown = payload["markdown"]
    assert "# Conversation Export: #builds" in markdown
    assert "```python\nprint('hello')\n```" in markdown
    assert "Tool: `shell_exec`" in markdown
    assert "Result: pytest passed" in markdown
    assert "[diagram.png](https://example.test/diagram.png)" in markdown
    assert payload["message_count"] == 2


@pytest.mark.asyncio
async def test_plan_mode_settings_and_evaluation_routes(phase9_env):
    app = FastAPI()
    app.include_router(agent_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        default_settings = await client.get("/api/plans/settings")
        updated_settings = await client.post(
            "/api/plans/settings",
            json={"planModeEnabled": True, "autoThresholdUsd": 0.25},
        )
        evaluated_above = await client.post(
            "/api/plans/evaluate",
            json={
                "prompt": "Refactor task routing and update validation coverage",
                "files": ["backend/router.py", "backend/tests/test_router.py"],
                "estimatedCostUsd": 0.40,
            },
        )
        evaluated_below = await client.post(
            "/api/plans/evaluate",
            json={
                "prompt": "Rename a label",
                "files": ["frontend/src/App.tsx"],
                "estimatedCostUsd": 0.05,
            },
        )
        created = await client.post(
            "/api/plans",
            json={
                "agent_name": "tyson",
                "channel": "general",
                "prompt": "Apply the approved backend refactor",
            },
        )

    assert default_settings.status_code == 200
    assert default_settings.json()["plan_mode_enabled"] is False
    assert updated_settings.status_code == 200
    assert updated_settings.json() == {"plan_mode_enabled": True, "auto_threshold_usd": 0.25}

    assert evaluated_above.status_code == 200
    above_payload = evaluated_above.json()
    assert above_payload["requires_plan"] is True
    assert above_payload["reason"] == "estimated cost exceeds threshold"
    assert above_payload["auto_threshold_usd"] == 0.25
    assert above_payload["settings"]["plan_mode_enabled"] is True
    assert len(above_payload["steps"]) >= 4

    assert evaluated_below.status_code == 200
    below_payload = evaluated_below.json()
    assert below_payload["requires_plan"] is False
    assert below_payload["reason"] == "estimated cost below threshold"

    assert created.status_code == 200
    assert created.json()["cost_threshold_usd"] == 0.25
