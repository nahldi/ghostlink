"""Route-level tests for provider configuration and key verification."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

import deps


class _DummyRequest:
    def __init__(self, body: dict):
        self._body = body

    async def json(self) -> dict:
        return self._body


class _DummyProviderRegistry:
    def __init__(self):
        self.saved: dict | None = None
        self.keys: dict[str, str] = {}
        self.status = {
            "providers": [],
            "capabilities": {},
            "free_options": [],
            "total_configured": 0,
        }
        self.available: dict[str, bool] = {}
        self.resolved: dict[str, dict | None] = {}

    def get_provider_status(self):
        return self.status

    def save_config(self, updates: dict):
        self.saved = updates

    def get_api_key(self, provider_id: str) -> str | None:
        return self.keys.get(provider_id)

    def is_provider_available(self, provider_id: str) -> bool:
        return self.available.get(provider_id, False)

    def resolve_capability(self, capability: str) -> dict | None:
        return self.resolved.get(capability)


@pytest.mark.asyncio
async def test_configure_provider_saves_api_key_and_preference(monkeypatch: pytest.MonkeyPatch):
    from routes import providers as provider_routes

    registry = _DummyProviderRegistry()
    monkeypatch.setattr(deps, "provider_registry", registry)

    response = await provider_routes.configure_provider(_DummyRequest({
        "provider": "openai",
        "api_key": "sk-test-123",
        "preferred_for": "chat",
    }))

    assert response["ok"] is True
    assert registry.saved == {
        "openai_api_key": "sk-test-123",
        "preferred_chat": "openai",
    }


@pytest.mark.asyncio
async def test_configure_provider_rejects_unknown_capability(monkeypatch: pytest.MonkeyPatch):
    from routes import providers as provider_routes

    monkeypatch.setattr(deps, "provider_registry", _DummyProviderRegistry())

    response = await provider_routes.configure_provider(_DummyRequest({
        "provider": "openai",
        "preferred_for": "not-real",
    }))

    assert response.status_code == 400
    assert json.loads(response.body) == {"error": "unknown capability: not-real"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider_id", "expected_url"),
    [
        ("mistral", "https://api.mistral.ai/v1/models"),
        ("openrouter", "https://openrouter.ai/api/v1/models"),
        ("deepseek", "https://api.deepseek.com/models"),
        ("perplexity", "https://api.perplexity.ai/chat/completions"),
        ("cohere", "https://api.cohere.com/v2/models"),
    ],
)
async def test_test_provider_key_uses_expected_url_for_expanded_providers(
    monkeypatch: pytest.MonkeyPatch,
    provider_id: str,
    expected_url: str,
):
    from routes import providers as provider_routes

    registry = _DummyProviderRegistry()
    registry.keys[provider_id] = "secret-key"
    monkeypatch.setattr(deps, "provider_registry", registry)

    captured: dict[str, object] = {}

    class _DummyResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def _fake_urlopen(req, timeout=0):
        captured["url"] = req.full_url
        captured["headers"] = dict(req.header_items())
        captured["method"] = req.get_method()
        captured["timeout"] = timeout
        return _DummyResponse()

    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen)

    response = await provider_routes.test_provider_key(provider_id)

    assert response == {"ok": True, "message": "API key verified"}
    assert captured["url"] == expected_url
    assert captured["method"] == "GET"
    assert captured["timeout"] == 10
    headers = captured["headers"]
    assert headers["Authorization"] == "Bearer secret-key"


@pytest.mark.asyncio
async def test_test_provider_key_rejects_missing_key(monkeypatch: pytest.MonkeyPatch):
    from routes import providers as provider_routes

    monkeypatch.setattr(deps, "provider_registry", _DummyProviderRegistry())

    response = await provider_routes.test_provider_key("openai")

    assert response.status_code == 400
    assert json.loads(response.body) == {"error": "no API key configured"}


@pytest.mark.asyncio
async def test_test_provider_key_maps_auth_errors_to_401(monkeypatch: pytest.MonkeyPatch):
    import urllib.error

    from routes import providers as provider_routes

    registry = _DummyProviderRegistry()
    registry.keys["openai"] = "bad-key"
    monkeypatch.setattr(deps, "provider_registry", registry)

    def _fake_urlopen(req, timeout=0):
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", hdrs=None, fp=None)

    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen)

    response = await provider_routes.test_provider_key("openai")

    assert response.status_code == 401
    assert json.loads(response.body) == {"error": "Invalid API key — authentication failed"}


@pytest.mark.asyncio
async def test_get_provider_models_uses_registry_availability(monkeypatch: pytest.MonkeyPatch):
    from routes import providers as provider_routes

    registry = _DummyProviderRegistry()
    registry.available["openai"] = True
    monkeypatch.setattr(deps, "provider_registry", registry)

    response = await provider_routes.get_provider_models("openai")

    assert response["provider"] == "openai"
    assert response["available"] is True
    assert "gpt-5.4" in response["models"]


@pytest.mark.asyncio
async def test_resolve_provider_returns_404_when_unavailable(monkeypatch: pytest.MonkeyPatch):
    from routes import providers as provider_routes

    monkeypatch.setattr(deps, "provider_registry", _DummyProviderRegistry())

    response = await provider_routes.resolve_provider("chat")

    assert response.status_code == 404
    assert json.loads(response.body) == {"error": "no provider available for 'chat'"}
