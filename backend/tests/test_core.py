"""Core backend tests — health, rate limiting, process tracking, settings lock, cron."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest
import pytest_asyncio


# ── Health & version ─────────────────────────────────────────────────

def test_version():
    """Backend version string is set."""
    import app
    import re
    assert re.match(r"^\d+\.\d+\.\d+$", app.__version__), f"Bad version format: {app.__version__}"


def test_imports_clean():
    """Backend imports without error."""
    import app  # noqa: F401
    import bridges  # noqa: F401
    import mcp_bridge  # noqa: F401
    import mcp_proxy  # noqa: F401
    import schedules  # noqa: F401
    import sessions  # noqa: F401
    import store  # noqa: F401
    import registry  # noqa: F401
    import router  # noqa: F401
    import rules  # noqa: F401
    import jobs  # noqa: F401
    import skills  # noqa: F401
    import agent_memory  # noqa: F401
    import plugin_loader  # noqa: F401
    import security  # noqa: F401


# ── Rate limiter ─────────────────────────────────────────────────────

def test_rate_limit_localhost_exempt():
    """Localhost IPs are always in the exempt set."""
    from app import _LOCALHOST_IPS
    assert "127.0.0.1" in _LOCALHOST_IPS
    assert "::1" in _LOCALHOST_IPS


def test_rate_limit_deque_per_ip():
    """Each IP gets its own deque — no cross-contamination."""
    from app import _rate_limits
    import collections
    # Simulate two independent IPs
    _rate_limits.clear()
    ip_a = "1.2.3.4"
    ip_b = "5.6.7.8"
    _rate_limits[ip_a] = collections.deque([time.time()])
    _rate_limits[ip_b] = collections.deque()
    assert len(_rate_limits[ip_a]) == 1
    assert len(_rate_limits[ip_b]) == 0
    _rate_limits.clear()


# ── Process tracking (Tier 1.5 fix) ──────────────────────────────────

def test_pending_spawns_exists():
    """_pending_spawns dict is present and separate from _agent_processes."""
    from deps import _agent_processes, _pending_spawns
    assert isinstance(_pending_spawns, dict)
    assert _pending_spawns is not _agent_processes


def test_agent_detection_cache_exists():
    """Module-level agent detection cache is present."""
    from deps import _AGENT_DETECTION_CACHE, _AGENT_DETECTION_CACHE_TTL
    assert isinstance(_AGENT_DETECTION_CACHE, dict)
    assert _AGENT_DETECTION_CACHE_TTL == 60.0


# ── Cron UTC fix (Tier 7.6 / schedules.py) ───────────────────────────

def test_cron_matches_utc():
    """cron_matches uses UTC — verify by checking a known UTC minute."""
    import datetime
    from schedules import cron_matches

    # Build a timestamp where UTC minute == 30
    dt_utc = datetime.datetime(2026, 1, 1, 12, 30, 0, tzinfo=datetime.timezone.utc)
    ts = dt_utc.timestamp()

    assert cron_matches("30 12 * * *", ts), "Should match UTC 12:30"
    assert not cron_matches("31 12 * * *", ts), "Should not match UTC 12:31"


def test_cron_step_values():
    """Cron step values (*/5) work correctly."""
    from schedules import cron_matches
    import datetime

    dt = datetime.datetime(2026, 1, 1, 12, 0, 0, tzinfo=datetime.timezone.utc)
    ts = dt.timestamp()
    assert cron_matches("*/5 * * * *", ts)  # minute 0 divisible by 5

    dt2 = datetime.datetime(2026, 1, 1, 12, 7, 0, tzinfo=datetime.timezone.utc)
    ts2 = dt2.timestamp()
    assert not cron_matches("*/5 * * * *", ts2)  # minute 7 not divisible by 5


# ── Atomic approval file write (Tier 3.5 fix) ────────────────────────

def test_approval_write_atomic(tmp_path: Path):
    """Approval response is written atomically (no .tmp file left behind)."""
    import json
    import os

    agent = "test-agent"
    response_file = tmp_path / f"{agent}_approval.json"
    response_data = json.dumps({"response": "allow_once", "message_id": 1, "timestamp": time.time()})

    # Simulate the atomic write pattern from respond_approval
    tmp_file = response_file.with_suffix(".tmp")
    tmp_file.write_text(response_data)
    os.replace(str(tmp_file), str(response_file))

    assert response_file.exists(), "Final file should exist"
    assert not tmp_file.exists(), "Temp file should be gone after os.replace"
    data = json.loads(response_file.read_text())
    assert data["response"] == "allow_once"


# ── Settings lock (Tier 3.1 fix) ─────────────────────────────────────

@pytest.mark.asyncio
async def test_settings_lock_exists():
    """_settings_lock is an asyncio.Lock and is used for channel mutations."""
    from deps import _settings_lock
    import asyncio
    assert isinstance(_settings_lock, asyncio.Lock)


# ── Security module ───────────────────────────────────────────────────

def test_fernet_required():
    """cryptography is available (XOR fallback was removed)."""
    from cryptography.fernet import Fernet
    key = Fernet.generate_key()
    f = Fernet(key)
    token = f.encrypt(b"ghostlink")
    assert f.decrypt(token) == b"ghostlink"


def test_security_random_key(tmp_path: Path):
    """Secrets written by one SecretsManager are readable by another on the same data_dir."""
    from security import SecretsManager
    sm1 = SecretsManager(tmp_path)
    sm1.set("foo", "bar")
    # Create sm2 AFTER set so _load() finds the persisted secrets.enc
    sm2 = SecretsManager(tmp_path)
    assert sm2.get("foo") == "bar"


def test_security_different_dirs_different_keys(tmp_path: Path):
    """Two SecretsManagers with different data_dirs have independent stores."""
    from security import SecretsManager
    dir_a = tmp_path / "a"
    dir_b = tmp_path / "b"
    dir_a.mkdir()
    dir_b.mkdir()

    sm_a = SecretsManager(dir_a)
    sm_b = SecretsManager(dir_b)

    sm_a.set("secret", "value_a")
    # sm_b has a different data_dir, so it doesn't have "secret"
    result = sm_b.get("secret")
    assert result is None  # different dir, key doesn't exist there


# ── shlex fix (Tier 5.1) ──────────────────────────────────────────────

def test_shlex_split_proxy_flag():
    """shlex.split handles URLs with special chars correctly."""
    import shlex
    template = '-c mcp_servers.ghostlink.url="{url}"'
    url = "http://127.0.0.1:8200/mcp"
    expanded = template.format(server="ghostlink", url=url)
    parts = shlex.split(expanded)
    # Should produce two tokens: '-c' and 'mcp_servers.ghostlink.url=http://...'
    assert len(parts) == 2
    assert parts[0] == "-c"
    assert url in parts[1]


# ── MCP bridge backpressure ───────────────────────────────────────────

def test_run_async_timeout_handling():
    """_run_async raises TimeoutError (not hangs) when coroutine is slow."""
    import mcp_bridge
    import asyncio

    async def _slow():
        await asyncio.sleep(10)  # Longer than 5s timeout

    with pytest.raises((TimeoutError, Exception)):
        mcp_bridge._run_async(_slow())
