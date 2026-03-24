"""Test fixtures for GhostLink backend tests."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import AsyncGenerator

import pytest
import pytest_asyncio

# Add backend dir to path so imports work
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture(scope="session")
def event_loop_policy():
    return asyncio.DefaultEventLoopPolicy()


@pytest.fixture
def tmp_data_dir(tmp_path: Path) -> Path:
    """Temporary data directory for each test."""
    data = tmp_path / "data"
    data.mkdir()
    return data


@pytest.fixture
def tmp_config_toml(tmp_path: Path, tmp_data_dir: Path) -> Path:
    """Write a minimal config.toml for testing."""
    cfg_path = tmp_path / "config.toml"
    cfg_path.write_text(
        f'[server]\nport = 8399\ndata_dir = "{tmp_data_dir}"\nstatic_dir = ""\n'
        f'[mcp]\nhttp_port = 8499\nsse_port = 8498\n'
    )
    return cfg_path


@pytest_asyncio.fixture
async def test_client(tmp_data_dir: Path, tmp_config_toml: Path, monkeypatch):
    """FastAPI async test client with isolated SQLite DB and temp data dir.

    Patches CONFIG and DATA_DIR so no real filesystem side effects occur.
    """
    from httpx import AsyncClient, ASGITransport

    # Patch environment before importing app
    monkeypatch.chdir(tmp_config_toml.parent)
    monkeypatch.setenv("GHOSTLINK_TEST", "1")

    # Lazy import after patching
    import importlib
    import app as _app_module

    # Override data dir and settings path so tests don't touch real data
    monkeypatch.setattr(_app_module, "DATA_DIR", tmp_data_dir)
    monkeypatch.setattr(_app_module, "_settings", {
        "channels": ["general"],
        "username": "You",
        "theme": "dark",
    })

    transport = ASGITransport(app=_app_module.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client
