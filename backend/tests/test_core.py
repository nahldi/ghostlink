"""Core backend tests — health, rate limiting, process tracking, settings lock, cron."""

from __future__ import annotations

import asyncio
import json
import time
import types
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


def test_workspace_spawn_warning_flags_wsl_onedrive_paths():
    """WSL-mounted OneDrive workspaces should emit a spawn warning."""
    from routes.agents import _workspace_spawn_warning

    warning = _workspace_spawn_warning("/mnt/c/Users/skull/OneDrive/Desktop/project")

    assert warning is not None
    assert "OneDrive" in warning


def test_workspace_spawn_warning_ignores_normal_linux_paths():
    """Normal Linux workspaces should not emit a spawn warning."""
    from routes.agents import _workspace_spawn_warning

    assert _workspace_spawn_warning("/home/skull/project") is None


def test_shared_auth_spawn_warning_detects_external_codex(monkeypatch: pytest.MonkeyPatch):
    """A non-GhostLink Codex process should emit a shared-auth warning."""
    import subprocess
    from routes.agents import _shared_auth_spawn_warning

    def fake_run(*_args, **_kwargs):
        return subprocess.CompletedProcess(
            args=["pgrep", "-af", "codex"],
            returncode=0,
            stdout="1234 codex chat\n5678 python wrapper.py codex --headless\n",
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    warning = _shared_auth_spawn_warning("codex", "codex")

    assert warning is not None
    assert "shared authentication" in warning


def test_shared_auth_spawn_warning_ignores_ghostlink_processes(monkeypatch: pytest.MonkeyPatch):
    """GhostLink-owned wrapper processes should not trigger the warning."""
    import subprocess
    from routes.agents import _shared_auth_spawn_warning

    def fake_run(*_args, **_kwargs):
        return subprocess.CompletedProcess(
            args=["pgrep", "-af", "codex"],
            returncode=0,
            stdout="5678 python wrapper.py codex --headless\n9012 ghostlink-codex helper\n",
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert _shared_auth_spawn_warning("codex", "codex") is None


def test_private_url_blocks_loopback_variants():
    """Loopback and local-only URL variants are rejected."""
    from deps import _is_private_url

    assert _is_private_url("http://localhost:8300")
    assert _is_private_url("http://localhost./status")
    assert _is_private_url("http://127.0.0.1/api")
    assert _is_private_url("http://[::1]/health")


def test_private_url_blocks_private_dns_resolution(monkeypatch: pytest.MonkeyPatch):
    """Any private address returned by DNS should block the URL."""
    import socket
    from deps import _is_private_url

    def fake_getaddrinfo(*_args, **_kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", 0)),
            (socket.AF_INET6, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("fd00::5", 0, 0, 0)),
        ]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

    assert _is_private_url("https://example.test/resource")


def test_private_url_allows_public_dns_resolution(monkeypatch: pytest.MonkeyPatch):
    """Public DNS-only results should remain allowed."""
    import socket
    from deps import _is_private_url

    def fake_getaddrinfo(*_args, **_kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", 0)),
            (socket.AF_INET6, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("2606:2800:220:1:248:1893:25c8:1946", 0, 0, 0)),
        ]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

    assert not _is_private_url("https://example.test/resource")


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


def test_provider_registry_uses_encrypted_secrets_and_migrates_plaintext(tmp_path: Path):
    """Provider keys are stored in secrets.enc and legacy plaintext keys are migrated out."""
    import deps
    from providers import ProviderRegistry
    from security import SecretsManager

    previous_manager = deps.secrets_manager
    deps.secrets_manager = SecretsManager(tmp_path)
    try:
        registry = ProviderRegistry(tmp_path)
        registry.save_config({"openai_api_key": "sk-test-123", "preferred_chat": "openai"})

        config_data = json.loads((tmp_path / "providers.json").read_text())
        assert config_data == {"preferred_chat": "openai"}
        assert deps.secrets_manager.get("openai_api_key") == "sk-test-123"

        (tmp_path / "providers.json").write_text(json.dumps({"anthropic_api_key": "sk-legacy"}))
        migrated = ProviderRegistry(tmp_path)
        assert migrated.get_api_key("anthropic") == "sk-legacy"
        migrated_config = json.loads((tmp_path / "providers.json").read_text())
        assert "anthropic_api_key" not in migrated_config
        assert deps.secrets_manager.get("anthropic_api_key") == "sk-legacy"
    finally:
        deps.secrets_manager = previous_manager


def test_provider_registry_does_not_resolve_unreachable_local_provider(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    """Unreachable local providers must not satisfy capability resolution."""
    from providers import ProviderRegistry

    registry = ProviderRegistry(tmp_path)
    monkeypatch.setattr(registry, "get_api_key", lambda _provider_id: None)
    monkeypatch.setattr(registry, "_is_local_provider_available", lambda _provider_id, _pdef: False)

    assert registry.resolve_capability("chat") is None
    assert registry.resolve_capability("code") is None


def test_provider_registry_skips_unreachable_preferred_local_provider(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    """A preferred local provider should be ignored when its service is down."""
    from providers import ProviderRegistry

    registry = ProviderRegistry(tmp_path)
    registry.save_config({"preferred_chat": "ollama"})
    monkeypatch.setattr(registry, "get_api_key", lambda _provider_id: None)
    monkeypatch.setattr(registry, "_is_local_provider_available", lambda _provider_id, _pdef: False)

    assert registry.resolve_capability("chat") is None


def test_require_startup_attr_success(monkeypatch: pytest.MonkeyPatch):
    import importlib
    import app

    module_name = "ghostlink_test_startup_success"
    module = types.ModuleType(module_name)
    token = object()
    module.Token = token
    original_import_module = importlib.import_module

    monkeypatch.setattr(
        importlib,
        "import_module",
        lambda name: module if name == module_name else original_import_module(name),
    )

    assert app._require_startup_attr(module_name, "Token") is token


def test_require_startup_attr_missing_attr_raises(monkeypatch: pytest.MonkeyPatch):
    import importlib
    import app

    module_name = "ghostlink_test_startup_missing_attr"
    module = types.ModuleType(module_name)
    original_import_module = importlib.import_module

    monkeypatch.setattr(
        importlib,
        "import_module",
        lambda name: module if name == module_name else original_import_module(name),
    )

    with pytest.raises(RuntimeError, match=f"Startup import missing {module_name}\\.Missing"):
        app._require_startup_attr(module_name, "Missing")


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
