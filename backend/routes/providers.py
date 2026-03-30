"""Provider registry routes."""
from __future__ import annotations

import deps
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/api/providers")
async def get_providers():
    """Get all available providers, capabilities, and free options."""
    return deps.provider_registry.get_provider_status()


@router.post("/api/providers/configure")
async def configure_provider(request: Request):
    """Set API key or preference for a provider."""
    body = await request.json()
    pid = body.get("provider", "").strip()
    if not pid:
        return JSONResponse({"error": "provider required"}, 400)

    from providers import PROVIDERS, CAPABILITY_PRIORITY
    if pid not in PROVIDERS:
        return JSONResponse({"error": f"unknown provider: {pid}"}, 400)

    config_updates = {}
    if "api_key" in body:
        api_key = str(body["api_key"]).strip()
        config_updates[f"{pid}_api_key"] = api_key
    if "preferred_for" in body:
        capability = str(body["preferred_for"]).strip()
        if capability not in CAPABILITY_PRIORITY:
            return JSONResponse({"error": f"unknown capability: {capability}"}, 400)
        config_updates[f"preferred_{capability}"] = pid

    deps.provider_registry.save_config(config_updates)
    return {"ok": True, "status": deps.provider_registry.get_provider_status()}


@router.post("/api/providers/{provider_id}/test")
async def test_provider_key(provider_id: str):
    """Test if the configured API key for a provider works."""
    import urllib.request, urllib.error
    from providers import PROVIDERS
    pdef = PROVIDERS.get(provider_id)
    if not pdef:
        return JSONResponse({"error": "unknown provider"}, 404)
    key = deps.provider_registry.get_api_key(provider_id)
    if not key:
        return JSONResponse({"error": "no API key configured"}, 400)

    test_urls = {
        "anthropic": ("https://api.anthropic.com/v1/messages", {"x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}),
        "openai": ("https://api.openai.com/v1/models", {"Authorization": f"Bearer {key}"}),
        "google": ("https://generativelanguage.googleapis.com/v1beta/models", {"x-goog-api-key": key}),
        "xai": ("https://api.x.ai/v1/models", {"Authorization": f"Bearer {key}"}),
        "groq": ("https://api.groq.com/openai/v1/models", {"Authorization": f"Bearer {key}"}),
        "together": ("https://api.together.xyz/v1/models", {"Authorization": f"Bearer {key}"}),
        "huggingface": ("https://huggingface.co/api/whoami-v2", {"Authorization": f"Bearer {key}"}),
    }

    if provider_id not in test_urls:
        return {"ok": True, "message": "Key saved (no test available for this provider)"}

    url, headers = test_urls[provider_id]
    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                return {"ok": True, "message": "API key verified"}
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return JSONResponse({"error": "Invalid API key — authentication failed"}, 401)
        if e.code == 429:
            return {"ok": True, "message": "Key valid (rate limited — try again later)"}
        if e.code >= 500:
            return {"ok": True, "message": f"Key accepted (provider returned {e.code} — may be temporary)"}
        return {"ok": True, "message": f"Key accepted (status {e.code})"}
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Provider test failed for %s: %s", provider_id, e)
        return JSONResponse({"error": "Connection failed — check your network and try again"}, 500)

    return {"ok": True, "message": "Key appears valid"}


@router.get("/api/providers/{provider_id}/models")
async def get_provider_models(provider_id: str):
    """Get available models for a specific provider."""
    from providers import PROVIDERS
    pdef = PROVIDERS.get(provider_id)
    if not pdef:
        return JSONResponse({"error": "unknown provider"}, 404)
    return {
        "provider": provider_id,
        "name": pdef["name"],
        "available": deps.provider_registry.is_provider_available(provider_id),
        "models": pdef["models"],
        "capabilities": pdef["capabilities"],
    }


@router.get("/api/providers/resolve/{capability}")
async def resolve_provider(capability: str):
    """Find the best available provider for a capability."""
    result = deps.provider_registry.resolve_capability(capability)
    if result:
        return result
    return JSONResponse({"error": f"no provider available for '{capability}'"}, 404)
