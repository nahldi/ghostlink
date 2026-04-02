"""Tests for ops endpoints: /api/health, /api/diagnostics, /api/backup, /api/restore."""

from __future__ import annotations

import io
import json
import time
import zipfile
from pathlib import Path

import pytest

import deps


@pytest.fixture
def ops_env(tmp_data_dir: Path):
    """Set up deps for ops endpoint tests."""
    deps.DATA_DIR = tmp_data_dir
    deps._settings["data_dir"] = str(tmp_data_dir)
    deps._settings["_server_start"] = time.time() - 60
    deps._settings["port"] = 8399
    deps._settings["username"] = "TestUser"

    from registry import AgentRegistry
    deps.registry = AgentRegistry()

    async def _broadcast(*_args, **_kwargs):
        return None
    deps.broadcast = _broadcast

    return {"data_dir": tmp_data_dir}


# ── /api/health ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health_returns_ok(ops_env):
    from routes.misc import health_check
    result = await health_check()
    assert result["status"] == "ok"
    assert result["version"] == "5.7.0"
    assert result["uptime"] >= 0


# ── /api/diagnostics ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_diagnostics_returns_checks(ops_env):
    from routes.misc import diagnostics
    result = await diagnostics()
    assert "status" in result
    assert "checks" in result
    check_names = [c["name"] for c in result["checks"]]
    assert "python" in check_names
    assert "disk_space" in check_names
    assert "agents" in check_names
    assert "dependencies" in check_names


@pytest.mark.asyncio
async def test_diagnostics_reports_missing_db(ops_env):
    from routes.misc import diagnostics
    result = await diagnostics()
    db_check = next(c for c in result["checks"] if c["name"] == "database")
    assert db_check["status"] == "warn"
    assert "not found" in db_check["detail"]


@pytest.mark.asyncio
async def test_diagnostics_reports_existing_db(ops_env):
    import sqlite3
    db_path = ops_env["data_dir"] / "ghostlink.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE test (id INTEGER PRIMARY KEY)")
    conn.close()

    from routes.misc import diagnostics
    result = await diagnostics()
    db_check = next(c for c in result["checks"] if c["name"] == "database")
    assert db_check["status"] == "ok"
    assert "integrity=ok" in db_check["detail"]


@pytest.mark.asyncio
async def test_diagnostics_python_check_ok(ops_env):
    import sys
    from routes.misc import diagnostics
    result = await diagnostics()
    py_check = next(c for c in result["checks"] if c["name"] == "python")
    assert py_check["status"] == "ok"
    assert f"{sys.version_info.major}.{sys.version_info.minor}" in py_check["detail"]


# ── /api/backup ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_backup_creates_valid_zip(ops_env):
    from routes.misc import create_backup
    response = await create_backup()
    assert response.media_type == "application/zip"

    # Read the ZIP from the streaming response body
    body_chunks = []
    async for chunk in response.body_iterator:
        body_chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode())
    body = b"".join(body_chunks)

    zf = zipfile.ZipFile(io.BytesIO(body))
    assert "settings.json" in zf.namelist()
    # Verify settings are valid JSON
    settings = json.loads(zf.read("settings.json"))
    assert isinstance(settings, dict)


@pytest.mark.asyncio
async def test_backup_includes_database(ops_env):
    import sqlite3
    db_path = ops_env["data_dir"] / "ghostlink.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE test (id INTEGER PRIMARY KEY)")
    conn.close()

    from routes.misc import create_backup
    response = await create_backup()
    body_chunks = []
    async for chunk in response.body_iterator:
        body_chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode())
    body = b"".join(body_chunks)

    zf = zipfile.ZipFile(io.BytesIO(body))
    assert "ghostlink.db" in zf.namelist()


# ── /api/restore ─────────────────────────────────────────────────────

class _DummyUploadFile:
    """Minimal UploadFile mock for restore tests."""
    def __init__(self, content: bytes, filename: str = "backup.zip"):
        self._content = content
        self.filename = filename

    async def read(self) -> bytes:
        return self._content


@pytest.mark.asyncio
async def test_restore_rejects_invalid_zip(ops_env):
    from routes.misc import restore_backup
    result = await restore_backup(_DummyUploadFile(b"not a zip"))
    assert result.status_code == 400
    body = json.loads(result.body)
    assert "Invalid ZIP" in body["error"]


@pytest.mark.asyncio
async def test_restore_rejects_path_traversal(ops_env):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("../../../etc/passwd", "pwned")
    buf.seek(0)

    from routes.misc import restore_backup
    result = await restore_backup(_DummyUploadFile(buf.read()))
    assert result.status_code == 400
    body = json.loads(result.body)
    assert "Unexpected file" in body["error"] or "Invalid path" in body["error"]


@pytest.mark.asyncio
async def test_restore_rejects_unexpected_files(ops_env):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("malicious_script.py", "import os; os.system('rm -rf /')")
    buf.seek(0)

    from routes.misc import restore_backup
    result = await restore_backup(_DummyUploadFile(buf.read()))
    assert result.status_code == 400
    body = json.loads(result.body)
    assert "Unexpected file" in body["error"]


@pytest.mark.asyncio
async def test_restore_valid_backup(ops_env):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("settings.json", json.dumps({"theme": "cyberpunk", "username": "Restored"}))
    buf.seek(0)

    from routes.misc import restore_backup
    result = await restore_backup(_DummyUploadFile(buf.read()))
    assert isinstance(result, dict)
    assert result["restored"] >= 1
    assert "settings" in result["files"]
    # Verify settings were actually merged
    assert deps._settings.get("theme") == "cyberpunk"
    assert deps._settings.get("username") == "Restored"


@pytest.mark.asyncio
async def test_restore_preserves_runtime_keys(ops_env):
    original_start = deps._settings.get("_server_start")
    original_port = deps._settings.get("port")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("settings.json", json.dumps({
            "theme": "ocean",
            "_server_start": 0,
            "port": 9999,
        }))
    buf.seek(0)

    from routes.misc import restore_backup
    result = await restore_backup(_DummyUploadFile(buf.read()))
    assert isinstance(result, dict)
    # Runtime keys should be preserved, not overwritten
    assert deps._settings["_server_start"] == original_start
    assert deps._settings["port"] == original_port
