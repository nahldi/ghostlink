"""Unit tests for outbound bridge retry behavior."""

from __future__ import annotations

import io
import urllib.error
from pathlib import Path

import pytest


class _DummyResponse:
    def __init__(self, payload: bytes = b"{}"):
        self._payload = payload

    def read(self) -> bytes:
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


@pytest.fixture
def slack_bridge(tmp_path: Path):
    from bridges import SlackBridge

    return SlackBridge(
        {"url": "https://hooks.slack.test/services/demo", "options": {"retry_attempts": 3}},
        store=None,
        registry=None,
        data_dir=tmp_path,
    )


def test_request_with_retry_retries_transient_http_errors(
    slack_bridge,
    monkeypatch: pytest.MonkeyPatch,
):
    attempts: list[int] = []
    sleeps: list[float] = []

    def _fake_urlopen(req, timeout=0):
        attempts.append(timeout)
        if len(attempts) < 3:
            raise urllib.error.HTTPError(req.full_url, 503, "Service Unavailable", hdrs=None, fp=io.BytesIO())
        return _DummyResponse()

    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen)
    monkeypatch.setattr("time.sleep", lambda delay: sleeps.append(delay))

    slack_bridge.send_outbound("codex", "hello", "general")

    assert len(attempts) == 3
    assert sleeps == [0.5, 1.0]


def test_request_with_retry_does_not_retry_non_transient_http_errors(
    slack_bridge,
    monkeypatch: pytest.MonkeyPatch,
):
    attempts: list[int] = []
    sleeps: list[float] = []

    def _fake_urlopen(req, timeout=0):
        attempts.append(timeout)
        raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", hdrs=None, fp=io.BytesIO())

    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen)
    monkeypatch.setattr("time.sleep", lambda delay: sleeps.append(delay))

    slack_bridge.send_outbound("codex", "hello", "general")

    assert len(attempts) == 1
    assert sleeps == []


def test_telegram_outbound_retries_but_long_poll_does_not(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    from bridges import TelegramBridge

    bridge = TelegramBridge(
        {"token": "abc123", "channel_map": {"general": "123"}, "options": {"retry_attempts": 3}},
        store=None,
        registry=None,
        data_dir=tmp_path,
    )

    attempts: list[str] = []
    sleeps: list[float] = []
    send_attempts = 0

    def _fake_urlopen(req, timeout=0):
        nonlocal send_attempts
        attempts.append(req.full_url)
        if req.full_url.endswith("/getUpdates"):
            raise urllib.error.URLError("temporary network failure")
        send_attempts += 1
        if send_attempts < 3:
            raise urllib.error.URLError("temporary network failure")
        return _DummyResponse(b'{"ok": true, "result": {}}')

    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen)
    monkeypatch.setattr("time.sleep", lambda delay: sleeps.append(delay))

    bridge._tg_request("getUpdates", {})
    assert sleeps == []

    bridge.send_outbound("codex", "hello", "general")
    assert sleeps == [0.5, 1.0]


def test_outbound_rate_limit_sleeps_for_same_destination(
    slack_bridge,
    monkeypatch: pytest.MonkeyPatch,
):
    monotonic_values = iter([0.0, 0.1, 0.35])
    sleeps: list[float] = []
    calls = 0

    def _fake_urlopen(req, timeout=0):
        nonlocal calls
        calls += 1
        return _DummyResponse()

    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen)
    monkeypatch.setattr("time.sleep", lambda delay: sleeps.append(delay))
    monkeypatch.setattr("time.monotonic", lambda: next(monotonic_values))

    slack_bridge.send_outbound("codex", "one", "general")
    slack_bridge.send_outbound("codex", "two", "general")

    assert calls == 2
    assert sleeps == pytest.approx([0.25])


def test_outbound_rate_limit_is_scoped_per_destination(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    from bridges import TelegramBridge

    bridge = TelegramBridge(
        {
            "token": "abc123",
            "channel_map": {"general": "111", "dev": "222"},
            "options": {"min_send_interval_s": 0.35},
        },
        store=None,
        registry=None,
        data_dir=tmp_path,
    )

    monotonic_values = iter([0.0, 0.0, 0.1, 0.1])
    sleeps: list[float] = []
    send_attempts = 0

    def _fake_urlopen(req, timeout=0):
        nonlocal send_attempts
        send_attempts += 1
        return _DummyResponse(b'{"ok": true, "result": {}}')

    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen)
    monkeypatch.setattr("time.sleep", lambda delay: sleeps.append(delay))
    monkeypatch.setattr("time.monotonic", lambda: next(monotonic_values))

    bridge.send_outbound("codex", "one", "general")
    bridge.send_outbound("codex", "two", "dev")

    assert send_attempts == 2
    assert sleeps == []
