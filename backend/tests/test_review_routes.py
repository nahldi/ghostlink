from __future__ import annotations

from pathlib import Path

import aiosqlite
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import deps
from audit_store import AuditStore
from code_review import init_review_db
from routes import review as review_routes


@pytest_asyncio.fixture
async def review_env(tmp_path: Path):
    db_path = tmp_path / "ghostlink_v2.db"
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    await init_review_db(db)
    deps.runtime_db = db
    deps.audit_store = AuditStore(db)
    await deps.audit_store.init()
    try:
        yield {"db": db}
    finally:
        await db.close()
        deps.runtime_db = None
        deps.audit_store = None


@pytest.mark.asyncio
async def test_review_returns_structured_findings(review_env):
    app = FastAPI()
    app.include_router(review_routes.router)
    diff_text = """diff --git a/demo.py b/demo.py
+++ b/demo.py
@@ -0,0 +1,2 @@
+print("debug")
+# TODO remove
"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post("/api/review", json={"diff_text": diff_text})
    assert response.status_code == 200
    payload = response.json()
    assert payload["review_id"]
    assert len(payload["findings"]) >= 2
    assert all("severity" in finding and "line" in finding for finding in payload["findings"])


@pytest.mark.asyncio
async def test_dismissed_finding_creates_rule_and_suppresses_future_match(review_env):
    app = FastAPI()
    app.include_router(review_routes.router)
    diff_text = """diff --git a/demo.py b/demo.py
+++ b/demo.py
@@ -0,0 +1,1 @@
+print("debug")
"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        first = await client.post("/api/review", json={"diff_text": diff_text})
        finding_id = first.json()["findings"][0]["finding_id"]
        corrected = await client.post(
            f"/api/review/{finding_id}/correct",
            json={"correction_type": "dismiss", "correction_text": "do not flag this exact debug line again"},
        )
        second = await client.post("/api/review", json={"diff_text": diff_text})
        rules = await client.get("/api/review/rules")
    assert corrected.status_code == 200
    assert corrected.json()["rule"] is not None
    assert second.status_code == 200
    assert second.json()["findings"] == []
    assert len(rules.json()["rules"]) == 1


@pytest.mark.asyncio
async def test_manual_rule_applies_to_new_review_and_rule_crud_works(review_env):
    app = FastAPI()
    app.include_router(review_routes.router)
    diff_text = """diff --git a/demo.ts b/demo.ts
+++ b/demo.ts
@@ -0,0 +1,1 @@
+dangerouslySetInnerHTML={{ __html: value }}
"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        created = await client.post(
            "/api/review/rules",
            json={
                "rule_text": "Flag dangerous HTML injection",
                "category": "security",
                "match_text": "dangerouslySetInnerHTML",
                "suggestion": "Prefer safe rendering over dangerouslySetInnerHTML",
                "severity": "high",
            },
        )
        reviewed = await client.post("/api/review", json={"diff_text": diff_text})
        deleted = await client.delete(f"/api/review/rules/{created.json()['rule']['rule_id']}")
        rules = await client.get("/api/review/rules")
    assert created.status_code == 200
    findings = reviewed.json()["findings"]
    assert len(findings) == 1
    assert findings[0]["category"] == "security"
    assert deleted.status_code == 200
    assert rules.json()["rules"] == []
