"""Channel bridge routes — Discord, Telegram, Slack, WhatsApp, Webhook."""
from __future__ import annotations

import deps
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/api/bridges")
async def list_bridges():
    """Get all bridge configurations and status."""
    return {"bridges": deps.bridge_manager.get_all()}


@router.post("/api/bridges/{platform}/configure")
async def configure_bridge(platform: str, request: Request):
    """Configure a channel bridge."""
    body = await request.json()
    if platform not in ("discord", "telegram", "slack", "whatsapp", "webhook"):
        return JSONResponse({"error": "unknown platform"}, 400)
    result = deps.bridge_manager.configure(platform, body)
    return result


@router.post("/api/bridges/{platform}/start")
async def start_bridge(platform: str):
    """Start a configured bridge."""
    result = deps.bridge_manager.start_bridge(platform)
    if result.get("ok"):
        return result
    return JSONResponse(result, 400)


@router.post("/api/bridges/{platform}/stop")
async def stop_bridge(platform: str):
    """Stop a running bridge."""
    result = deps.bridge_manager.stop_bridge(platform)
    return result


@router.post("/api/bridges/inbound")
async def bridge_inbound(request: Request):
    """Receive messages from external platforms via webhook."""
    body = await request.json()
    sender = body.get("sender", "external")
    text = body.get("text", "")
    channel = body.get("channel", "general")
    platform = body.get("platform", "webhook")

    # Validate platform to prevent spoofing
    _VALID_PLATFORMS = {"discord", "telegram", "slack", "whatsapp", "webhook"}
    if platform not in _VALID_PLATFORMS:
        return JSONResponse({"error": "invalid platform"}, 400)
    # Sanitize sender name
    sender = sender[:50].replace(":", "_") if sender else "external"

    if not text.strip():
        return JSONResponse({"error": "text required"}, 400)

    # Verify webhook secret if configured
    cfg = deps.bridge_manager.get_config("webhook")
    secret = cfg.get("secret", "")
    if secret:
        import hashlib, hmac
        sig = request.headers.get("X-GhostLink-Signature", "")
        raw = await request.body()
        expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return JSONResponse({"error": "invalid signature"}, 403)

    msg = await deps.store.add(
        sender=f"{platform}:{sender}",
        text=text,
        channel=channel,
    )
    from app_helpers import route_mentions
    route_mentions(f"{platform}:{sender}", text, channel)
    return msg
