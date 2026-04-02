"""Tests for routes/misc.py — settings, webhooks, upload, usage, server-config."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

import deps


class _DummyRequest:
    """Minimal Request mock for route-level tests."""
    def __init__(self, body: dict | None = None, client_host: str = "127.0.0.1"):
        self._body = body or {}
        self.client = type("C", (), {"host": client_host})()

    async def json(self) -> dict:
        return self._body


class _DummyUploadFile:
    """Minimal UploadFile mock."""
    def __init__(self, content: bytes, filename: str = "test.png", content_type: str = "image/png"):
        self._content = content
        self.filename = filename
        self.content_type = content_type

    async def read(self) -> bytes:
        return self._content


@pytest.fixture
def misc_env(tmp_data_dir: Path):
    """Set up deps for misc route tests."""
    deps.DATA_DIR = tmp_data_dir
    deps.UPLOAD_DIR = tmp_data_dir / "uploads"
    deps.UPLOAD_DIR.mkdir(exist_ok=True)
    deps.MAX_SIZE_MB = 10

    deps._settings.update({
        "data_dir": str(tmp_data_dir),
        "_server_start": time.time() - 120,
        "port": 8399,
        "username": "TestUser",
        "theme": "dark",
        "channels": ["general"],
    })
    deps._webhooks.clear()
    deps._usage_log.clear()

    from registry import AgentRegistry
    from router import MessageRouter
    deps.registry = AgentRegistry()
    deps.router_inst = MessageRouter(max_hops=4, default_routing="none")

    async def _broadcast(*_a, **_k):
        return None
    deps.broadcast = _broadcast

    return {"data_dir": tmp_data_dir}


# ── /api/settings GET ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_settings_returns_current(misc_env):
    from routes.misc import get_settings
    result = await get_settings()
    assert result["username"] == "TestUser"
    assert result["theme"] == "dark"
    assert "persistentAgents" in result


# ── /api/settings POST ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_save_settings_updates_allowed_keys(misc_env):
    from routes.misc import save_settings
    result = await save_settings(_DummyRequest({"username": "NewName", "theme": "cyberpunk"}))
    assert result["username"] == "NewName"
    assert result["theme"] == "cyberpunk"
    assert deps._settings["username"] == "NewName"


@pytest.mark.asyncio
async def test_save_settings_rejects_unknown_keys(misc_env):
    from routes.misc import save_settings
    await save_settings(_DummyRequest({"username": "Test", "_secret_key": "evil"}))
    assert "_secret_key" not in deps._settings


@pytest.mark.asyncio
async def test_save_settings_updates_loop_guard(misc_env):
    from routes.misc import save_settings
    await save_settings(_DummyRequest({"loopGuard": 8}))
    assert deps.router_inst.max_hops == 8


@pytest.mark.asyncio
async def test_save_settings_updates_auto_route(misc_env):
    from routes.misc import save_settings
    await save_settings(_DummyRequest({"autoRoute": "smart"}))
    assert deps.router_inst.default_routing == "smart"


@pytest.mark.asyncio
async def test_save_settings_auto_route_bool_true(misc_env):
    from routes.misc import save_settings
    await save_settings(_DummyRequest({"autoRoute": True}))
    assert deps.router_inst.default_routing == "all"


# ── /api/webhooks CRUD ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_webhooks_empty(misc_env):
    from routes.misc import list_webhooks
    result = await list_webhooks()
    assert result == {"webhooks": []}


@pytest.mark.asyncio
async def test_create_webhook_valid(misc_env):
    from routes.misc import create_webhook
    result = await create_webhook(_DummyRequest({"url": "https://example.com/hook", "events": ["message"]}))
    assert result["url"] == "https://example.com/hook"
    assert result["active"] is True
    assert result["events"] == ["message"]
    assert len(deps._webhooks) == 1


@pytest.mark.asyncio
async def test_create_webhook_rejects_invalid_url(misc_env):
    from routes.misc import create_webhook
    result = await create_webhook(_DummyRequest({"url": "not-a-url"}))
    assert result.status_code == 400


@pytest.mark.asyncio
async def test_create_webhook_rejects_empty_url(misc_env):
    from routes.misc import create_webhook
    result = await create_webhook(_DummyRequest({"url": ""}))
    assert result.status_code == 400


@pytest.mark.asyncio
async def test_update_webhook(misc_env):
    from routes.misc import create_webhook, update_webhook
    wh = await create_webhook(_DummyRequest({"url": "https://example.com/hook"}))
    result = await update_webhook(wh["id"], _DummyRequest({"active": False}))
    assert result["active"] is False


@pytest.mark.asyncio
async def test_update_webhook_not_found(misc_env):
    from routes.misc import update_webhook
    result = await update_webhook("wh-nonexistent", _DummyRequest({"active": False}))
    assert result.status_code == 404


@pytest.mark.asyncio
async def test_update_webhook_rejects_bad_url(misc_env):
    from routes.misc import create_webhook, update_webhook
    wh = await create_webhook(_DummyRequest({"url": "https://example.com/hook"}))
    result = await update_webhook(wh["id"], _DummyRequest({"url": "ftp://bad"}))
    assert result.status_code == 400


@pytest.mark.asyncio
async def test_delete_webhook(misc_env):
    from routes.misc import create_webhook, delete_webhook
    wh = await create_webhook(_DummyRequest({"url": "https://example.com/hook"}))
    result = await delete_webhook(wh["id"])
    assert result["ok"] is True
    assert len(deps._webhooks) == 0


@pytest.mark.asyncio
async def test_delete_webhook_nonexistent(misc_env):
    from routes.misc import delete_webhook
    result = await delete_webhook("wh-nonexistent")
    assert result["ok"] is False


# ── /api/upload ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_rejects_non_image(misc_env):
    from routes.misc import upload_image
    result = await upload_image(_DummyUploadFile(b"hello", "test.txt", "text/plain"))
    assert result.status_code == 400


@pytest.mark.asyncio
async def test_upload_rejects_oversized(misc_env):
    deps.MAX_SIZE_MB = 1
    from routes.misc import upload_image
    # 1.5MB of data
    result = await upload_image(_DummyUploadFile(b"\x89PNG" + b"\x00" * (1_500_000), "big.png", "image/png"))
    assert result.status_code == 400


@pytest.mark.asyncio
async def test_upload_rejects_bad_magic(misc_env):
    from routes.misc import upload_image
    result = await upload_image(_DummyUploadFile(b"NOT_AN_IMAGE_FILE", "fake.png", "image/png"))
    assert result.status_code == 400


@pytest.mark.asyncio
async def test_upload_accepts_valid_png(misc_env):
    from routes.misc import upload_image
    # PNG magic bytes
    png_header = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    result = await upload_image(_DummyUploadFile(png_header, "test.png", "image/png"))
    assert "url" in result
    assert result["url"].startswith("/uploads/")
    assert result["url"].endswith(".png")


@pytest.mark.asyncio
async def test_upload_rejects_unsupported_extension(misc_env):
    from routes.misc import upload_image
    # Valid JPEG magic but .bmp extension
    jpeg_header = b"\xff\xd8\xff\xe0" + b"\x00" * 100
    result = await upload_image(_DummyUploadFile(jpeg_header, "test.bmp", "image/bmp"))
    assert result.status_code == 400


# ── /api/usage ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_usage_empty(misc_env):
    from routes.misc import get_usage
    result = await get_usage()
    assert result["entry_count"] == 0
    assert result["total_cost"] == 0


@pytest.mark.asyncio
async def test_usage_with_entries(misc_env):
    deps._usage_log.append({
        "ts": "2026-04-01T00:00:00",
        "agent": "claude",
        "provider": "anthropic",
        "model": "opus",
        "input_tokens": 1000,
        "output_tokens": 500,
        "cost": 0.0105,
    })
    from routes.misc import get_usage
    result = await get_usage()
    assert result["entry_count"] == 1
    assert result["total_cost"] == 0.0105
    assert result["total_input_tokens"] == 1000


# ── /api/server-config ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_server_config_returns_structure(misc_env):
    from routes.misc import get_server_config
    result = await get_server_config()
    assert "server" in result
    assert "routing" in result
    assert "mcp" in result
    assert result["server"]["port"] == deps.PORT
    assert result["routing"]["max_hops"] == 4
