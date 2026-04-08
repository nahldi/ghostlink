from __future__ import annotations

import json

import pytest

import cli


@pytest.mark.asyncio
async def test_doctor_reports_unreachable_backend(capsys):
    class _Args:
        port = 9999
        output = "json"

    async def _fail(*_args, **_kwargs):
        raise RuntimeError("connect failed")

    original_get = cli._http_get
    cli._http_get = _fail
    try:
        exit_code = await cli.cmd_doctor(_Args())
    finally:
        cli._http_get = original_get

    captured = json.loads(capsys.readouterr().out)
    assert exit_code == 1
    assert captured["status"] == "error"
    assert captured["checks"][0]["name"] == "backend"


@pytest.mark.asyncio
async def test_doctor_reports_healthy_backend(capsys):
    class _Args:
        port = 8300
        output = "json"

    async def _get(_port: int, path: str):
        if path == "/api/health":
            return {"status": "ok", "uptime": 12.5}
        if path == "/api/diagnostics":
            return {"status": "ok", "checks": [{"name": "database", "status": "ok", "detail": "ok"}]}
        raise AssertionError(path)

    original_get = cli._http_get
    cli._http_get = _get
    try:
        exit_code = await cli.cmd_doctor(_Args())
    finally:
        cli._http_get = original_get

    captured = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert captured["status"] == "ok"
    assert [item["name"] for item in captured["checks"][:2]] == ["backend", "database"]
