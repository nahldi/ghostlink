from __future__ import annotations

import json
import time
from pathlib import Path
from types import SimpleNamespace

import aiosqlite
import pytest
import pytest_asyncio

import deps
import mcp_bridge
from cost import CostTracker
from providers import ProviderRegistry
from registry import AgentRegistry
from task_store import TaskStore


class _DummyCtx:
    def __init__(self, token: str):
        self.request_context = SimpleNamespace(
            request=SimpleNamespace(headers={"authorization": f"Bearer {token}"})
        )


async def _wait_for_task(task_store: TaskStore, task_id: str, *, status: str, timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        task = await task_store.get(task_id)
        if task and task.get("status") == status:
            return task
        await __import__("asyncio").sleep(0.05)
    raise AssertionError(f"task {task_id} did not reach {status}")


@pytest_asyncio.fixture
async def phase7_env(tmp_path: Path):
    db_path = tmp_path / "ghostlink_v2.db"
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row

    deps.DATA_DIR = tmp_path
    deps.BASE_DIR = tmp_path
    deps.runtime_db = db
    deps._usage_log = []
    deps._USAGE_LOG_MAX = 10000
    deps._settings = {"channels": ["general"], "budgets": {}}
    deps.registry = AgentRegistry()
    deps.task_store = TaskStore(db)
    await deps.task_store.init()
    deps.provider_registry = ProviderRegistry(tmp_path)
    deps.cost_tracker = CostTracker(db)
    await deps.cost_tracker.init()
    events: list[tuple[str, dict]] = []

    async def _broadcast(event_type: str, payload: dict):
        events.append((event_type, payload))

    deps.broadcast = _broadcast
    mcp_bridge.configure(
        store=None,
        registry=deps.registry,
        settings=deps._settings,
        data_dir=tmp_path,
        task_store=deps.task_store,
    )
    try:
        yield {"db": db, "tmp_path": tmp_path, "events": events}
    finally:
        await db.close()
        deps.runtime_db = None
        deps.registry = None
        deps.task_store = None
        deps.provider_registry = None
        deps.cost_tracker = None


@pytest.mark.asyncio
async def test_generate_music_gracefully_degrades_into_failed_task(phase7_env):
    inst = deps.registry.register("codex")
    result = mcp_bridge.generate_music("codex", "lofi beat", ctx=_DummyCtx(inst.token))
    payload = json.loads(result)
    assert payload["ok"] is False
    assert "No music generation provider configured" in payload["error"]
    task = await _wait_for_task(deps.task_store, payload["task_id"], status="failed")
    assert task["error"] == payload["error"]
    assert task["metadata"]["media_kind"] == "music"


@pytest.mark.asyncio
async def test_generate_music_creates_audio_artifact_and_progress_steps(monkeypatch: pytest.MonkeyPatch, phase7_env):
    inst = deps.registry.register("codex")
    monkeypatch.setenv("MINIMAX_API_KEY", "test-key")

    def _fake_transport_request(*args, **kwargs):
        return {"json": {"data": {"audio": "ff00aa11", "status": 2}}}

    monkeypatch.setattr(mcp_bridge, "_transport_request", _fake_transport_request)

    raw = mcp_bridge.generate_music(
        "codex",
        "night drive synthwave",
        genre="synthwave",
        mood="moody",
        tempo="midtempo",
        ctx=_DummyCtx(inst.token),
    )
    payload = json.loads(raw)

    assert payload["ok"] is True
    task = await _wait_for_task(deps.task_store, payload["task_id"], status="completed")
    assert task["metadata"]["artifact_type"] == "audio"
    assert task["metadata"]["mime_type"] == "audio/mpeg"
    assert task["metadata"]["media"]["artifact_type"] == "audio"
    assert task["progress_total"] == 4
    steps = task["progress_data"]
    assert [step["label"] for step in steps] == ["routing", "generating", "finalizing", "completed"]
    assert steps[-1]["status"] == "active"

    usage = await deps.cost_tracker.usage_snapshot()
    assert usage["entry_count"] == 1
    assert usage["entries"][0]["provider"] == "minimax"
    assert usage["entries"][0]["metadata"]["media_kind"] == "music"


@pytest.mark.asyncio
async def test_generate_video_creates_async_task_and_cost_record(monkeypatch: pytest.MonkeyPatch, phase7_env):
    inst = deps.registry.register("codex")

    def _fake_execute(meta: dict) -> dict:
        return {
            "artifact_path": str(phase7_env["tmp_path"] / "generated" / "video" / "clip.mp4"),
            "provider": "google",
            "model": "veo-3.1-generate-preview",
            "cost_usd": 0.75,
            "metadata": {"duration": meta["duration"], "aspect_ratio": meta["aspect_ratio"]},
        }

    monkeypatch.setattr(mcp_bridge, "_execute_video_generation", _fake_execute)
    monkeypatch.setattr(mcp_bridge, "_resolve_media_provider", lambda capability, provider="auto": ("google", ""))

    raw = mcp_bridge.generate_video("codex", "camera pushes into a neon city", ctx=_DummyCtx(inst.token))
    payload = json.loads(raw)

    assert payload["ok"] is True
    task = await _wait_for_task(deps.task_store, payload["task_id"], status="completed")
    assert task["metadata"]["artifact_path"].endswith("clip.mp4")
    assert task["metadata"]["media_kind"] == "video"
    assert task["metadata"]["artifact_type"] == "video"
    assert task["metadata"]["mime_type"] == "video/mp4"
    assert task["metadata"]["media"]["artifact_path"].endswith("clip.mp4")

    usage = await deps.cost_tracker.usage_snapshot()
    assert usage["entry_count"] == 1
    assert usage["entries"][0]["task_id"] == payload["task_id"]
    assert usage["entries"][0]["provider"] == "google"
    assert usage["entries"][0]["metadata"]["media_kind"] == "video"


@pytest.mark.asyncio
async def test_image_edit_writes_completed_artifact_metadata(monkeypatch: pytest.MonkeyPatch, phase7_env):
    inst = deps.registry.register("codex")
    source = phase7_env["tmp_path"] / "source.png"
    source.write_bytes(b"fake-image")

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    def _fake_transport_request(*args, **kwargs):
        return {"json": {"data": [{"url": "https://example.test/edited.png"}]}}

    monkeypatch.setattr(mcp_bridge, "_transport_request", _fake_transport_request)

    raw = mcp_bridge.image_edit(
        "codex",
        str(source),
        "remove the background and widen the frame",
        mode="outpaint",
        ctx=_DummyCtx(inst.token),
    )
    payload = json.loads(raw)

    assert payload["ok"] is True
    task = await _wait_for_task(deps.task_store, payload["task_id"], status="completed")
    assert task["metadata"]["media_kind"] == "image_edit"
    assert task["metadata"]["artifact_path"] == "https://example.test/edited.png"
    assert task["metadata"]["artifact_type"] == "image"
    assert task["metadata"]["media"]["artifact_path"] == "https://example.test/edited.png"
    assert task["metadata"]["mode"] == "outpaint"
    assert task["metadata"]["image_edit"]["mode"] == "outpaint"
    assert task["metadata"]["image_edit"]["source_image_path"] == str(source)

    usage = await deps.cost_tracker.usage_snapshot()
    assert usage["entry_count"] == 1
    assert usage["entries"][0]["model"] == "dall-e-3"
    assert usage["entries"][0]["metadata"]["media_kind"] == "image_edit"
