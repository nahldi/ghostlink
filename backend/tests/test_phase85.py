from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import aiosqlite
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import deps
from policy import PolicyEngine
from profiles import init_profiles_db
from registry import AgentRegistry, init_registry_db
from routes import agents as agent_routes
from skills import SkillsRegistry


@pytest_asyncio.fixture
async def phase85_env(tmp_path: Path):
    db_path = tmp_path / "ghostlink_v2.db"
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    await init_registry_db(db)
    await init_profiles_db(db)

    old_data_dir = deps.DATA_DIR
    old_base_dir = deps.BASE_DIR
    old_runtime_db = deps.runtime_db
    old_registry = deps.registry
    old_skills = deps.skills_registry
    old_policy = deps.policy_engine

    deps.DATA_DIR = tmp_path
    deps.BASE_DIR = tmp_path
    deps.runtime_db = db
    deps.registry = AgentRegistry()
    deps.skills_registry = SkillsRegistry(tmp_path, db)
    await deps.skills_registry.init()
    deps.policy_engine = PolicyEngine(db, tmp_path)
    await deps.policy_engine.init()

    try:
        yield {"db": db, "tmp_path": tmp_path}
    finally:
        await db.close()
        deps.DATA_DIR = old_data_dir
        deps.BASE_DIR = old_base_dir
        deps.runtime_db = old_runtime_db
        deps.registry = old_registry
        deps.skills_registry = old_skills
        deps.policy_engine = old_policy


@pytest.mark.asyncio
async def test_profile_version_publish_and_list_include_snapshot_and_compatibility(phase85_env):
    app = FastAPI()
    app.include_router(agent_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        created = await client.post(
            "/api/profiles",
            json={"name": "Backend Pack", "description": "Owns backend", "base_provider": "codex"},
        )
        profile_id = created.json()["profile_id"]
        await client.put(f"/api/profiles/{profile_id}/settings", json={"model": "gpt-5.4-mini"})
        await client.put(f"/api/profiles/{profile_id}/skills", json={"skill_ids": ["git-ops", "web-search"]})
        published = await client.post(
            f"/api/profiles/{profile_id}/versions",
            json={
                "version": "1.0.0",
                "changelog": "Initial private release",
                "compatibility": {
                    "min_platform_version": "5.7.2",
                    "required_capabilities": ["profiles", "skills"],
                    "provider_requirements": ["openai"],
                },
                "channel": "private",
                "distribution_scope": "workspace",
            },
        )
        listed = await client.get(f"/api/profiles/{profile_id}/versions")

    assert published.status_code == 200
    payload = published.json()
    assert payload["version"] == "1.0.0"
    assert payload["compatibility"]["required_capabilities"] == ["profiles", "skills"]
    assert payload["payload"]["settings"]["model"] == "gpt-5.4-mini"
    assert {item["skill_id"] for item in payload["payload"]["skills"] if item["enabled"]} == {"git-ops", "web-search"}

    assert listed.status_code == 200
    assert listed.json()["versions"][0]["version"] == "1.0.0"


@pytest.mark.asyncio
async def test_stable_promotion_is_policy_gated(phase85_env, monkeypatch: pytest.MonkeyPatch):
    app = FastAPI()
    app.include_router(agent_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        created = await client.post("/api/profiles", json={"name": "Release Candidate"})
        profile_id = created.json()["profile_id"]
        await client.post(f"/api/profiles/{profile_id}/versions", json={"version": "1.1.0-beta.1", "channel": "beta"})

        async def _deny(*_args, **_kwargs):
            return {"decision": "ask", "reason": "manual-review-required"}

        monkeypatch.setattr(deps.policy_engine, "evaluate", _deny)
        blocked = await client.post(f"/api/profiles/{profile_id}/versions/1.1.0-beta.1/promote", json={"channel": "stable"})

        async def _allow(*_args, **_kwargs):
            return {"decision": "allow", "reason": "approved"}

        monkeypatch.setattr(deps.policy_engine, "evaluate", _allow)
        promoted = await client.post(f"/api/profiles/{profile_id}/versions/1.1.0-beta.1/promote", json={"channel": "stable"})

    assert blocked.status_code == 403
    assert "promotion blocked" in blocked.json()["error"]
    assert promoted.status_code == 200
    assert promoted.json()["channel"] == "stable"


@pytest.mark.asyncio
async def test_profile_rollback_restores_prior_snapshot_state(phase85_env):
    app = FastAPI()
    app.include_router(agent_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        created = await client.post("/api/profiles", json={"name": "Rollback Profile", "description": "v1"})
        profile_id = created.json()["profile_id"]
        await client.put(f"/api/profiles/{profile_id}/settings", json={"model": "gpt-5.4-mini"})
        await client.put(f"/api/profiles/{profile_id}/skills", json={"skill_ids": ["git-ops"]})
        await client.post(f"/api/profiles/{profile_id}/rules", json={"content": "Keep tests green", "rule_type": "custom"})
        await client.post(f"/api/profiles/{profile_id}/versions", json={"version": "1.0.0", "channel": "beta"})

        await client.put(f"/api/profiles/{profile_id}", json={"description": "v2"})
        await client.put(f"/api/profiles/{profile_id}/settings", json={"model": "o3"})
        await client.put(f"/api/profiles/{profile_id}/skills", json={"skill_ids": ["web-search"]})
        rollback = await client.post(f"/api/profiles/{profile_id}/versions/1.0.0/rollback")
        profile = await client.get(f"/api/profiles/{profile_id}")

    assert rollback.status_code == 200
    assert rollback.json()["ok"] is True
    payload = profile.json()
    assert payload["description"] == "v1"
    assert payload["settings"]["model"] == "gpt-5.4-mini"
    assert {item["skill_id"] for item in payload["skills"] if item["enabled"]} == {"git-ops"}
    assert payload["rules"][0]["content"] == "Keep tests green"


@pytest.mark.asyncio
async def test_skill_version_publish_rejects_unknown_compatibility(phase85_env):
    app = FastAPI()
    app.include_router(agent_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post(
            "/api/skills/git-ops/versions",
            json={
                "version": "1.0.0",
                "compatibility": {"required_capabilities": ["teleportation"]},
            },
        )

    assert response.status_code == 400
    assert "unsupported required capabilities" in response.json()["error"]


@pytest.mark.asyncio
async def test_productization_routes_match_frontend_contract(phase85_env, monkeypatch: pytest.MonkeyPatch):
    app = FastAPI()
    app.include_router(agent_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        created = await client.post("/api/profiles", json={"name": "Productized Profile"})
        profile_id = created.json()["profile_id"]
        await client.post(
            f"/api/profiles/{profile_id}/versions",
            json={"version": "1.0.0", "channel": "beta", "changelog": "Initial beta"},
        )

        async def _allow(*_args, **_kwargs):
            return {"decision": "allow", "reason": "approved"}

        monkeypatch.setattr(deps.policy_engine, "evaluate", _allow)
        promoted = await client.post(
            f"/api/productization/assets/profile/{profile_id}/promote",
            json={"version": "1.0.0", "channel": "stable"},
        )
        assets = await client.get("/api/productization/assets")
        rolled_back = await client.post(
            f"/api/productization/assets/profile/{profile_id}/rollback",
            json={"version": "1.0.0"},
        )

    assert promoted.status_code == 200
    assert promoted.json()["ok"] is True
    assert promoted.json()["asset"]["channel"] == "stable"

    assert assets.status_code == 200
    payload = assets.json()
    profile_asset = next(item for item in payload["assets"] if item["kind"] == "profile" and item["asset_id"] == profile_id)
    assert profile_asset["template"] is False
    assert profile_asset["versions"][0]["channel"] == "stable"
    assert "health" in profile_asset["versions"][0]

    assert rolled_back.status_code == 200
    assert rolled_back.json()["ok"] is True


@pytest.mark.asyncio
async def test_skill_rollback_restores_saved_skill_snapshot(phase85_env):
    skills_dir = phase85_env["tmp_path"] / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)
    skill_path = skills_dir / "custom-skill.json"
    skill_path.write_text(
        '{"id":"custom-skill","name":"Custom Skill","description":"v1","category":"Development"}',
        encoding="utf-8",
    )

    app = FastAPI()
    app.include_router(agent_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        published = await client.post(
            "/api/skills/custom-skill/versions",
            json={"version": "1.0.0", "channel": "beta", "changelog": "Initial skill release"},
        )
        skill_path.write_text(
            '{"id":"custom-skill","name":"Custom Skill","description":"v2","category":"Development"}',
            encoding="utf-8",
        )
        rolled_back = await client.post(
            "/api/productization/assets/skill/custom-skill/rollback",
            json={"version": "1.0.0"},
        )
        assets = await client.get("/api/productization/assets")

    assert published.status_code == 200
    assert rolled_back.status_code == 200
    assert rolled_back.json()["ok"] is True
    restored = next(item for item in deps.skills_registry.get_all_skills() if item["id"] == "custom-skill")
    assert restored["description"] == "v1"
    skill_asset = next(item for item in assets.json()["assets"] if item["kind"] == "skill" and item["asset_id"] == "custom-skill")
    assert skill_asset["versions"][0]["version"] == "1.0.0"


@pytest.mark.asyncio
async def test_productization_assets_include_aggregated_health_metrics(phase85_env):
    app = FastAPI()
    app.include_router(agent_routes.router)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        created = await client.post("/api/profiles", json={"name": "Health Profile"})
        profile_id = created.json()["profile_id"]
        await client.post(f"/api/profiles/{profile_id}/versions", json={"version": "2.0.0", "channel": "beta"})
        first = await client.post(
            f"/api/productization/assets/profile/{profile_id}/versions/2.0.0/health",
            json={"event_type": "run", "ok": True, "cost_usd": 1.25, "eval_score": 0.8},
        )
        second = await client.post(
            f"/api/productization/assets/profile/{profile_id}/versions/2.0.0/health",
            json={"event_type": "run", "ok": False, "cost_usd": 0.75, "eval_score": 0.6},
        )
        assets = await client.get("/api/productization/assets")

    assert first.status_code == 200
    assert second.status_code == 200
    profile_asset = next(item for item in assets.json()["assets"] if item["kind"] == "profile" and item["asset_id"] == profile_id)
    health = profile_asset["versions"][0]["health"]
    assert health["sample_count"] == 2
    assert health["error_rate"] == 0.5
    assert health["cost_usd"] == 2.0
    assert health["eval_score"] == 0.7
