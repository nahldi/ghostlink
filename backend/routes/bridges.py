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
    import hashlib, hmac as _hmac, json as _json

    # Read raw body first — needed for signature verification before parsing
    raw = await request.body()
    if not raw:
        return JSONResponse({"error": "empty body"}, 400)

    # Verify webhook signature BEFORE parsing body (defense in depth)
    cfg = deps.bridge_manager.get_config("webhook")
    raw_secret = cfg.get("secret", "")
    secret = raw_secret.strip() if isinstance(raw_secret, str) else ""
    if raw_secret is not None and raw_secret != "" and not secret:
        return JSONResponse({"error": "webhook secret misconfigured"}, 503)

    if secret:
        # Support multiple signature schemes:
        # - X-GhostLink-Signature: HMAC-SHA256 (our native format)
        # - X-Slack-Signature: Slack v0 scheme (v0:timestamp:body)
        # - X-Hub-Signature-256: Meta/WhatsApp scheme (sha256=hex)
        sig = request.headers.get("X-GhostLink-Signature", "")
        slack_sig = request.headers.get("X-Slack-Signature", "")
        meta_sig = request.headers.get("X-Hub-Signature-256", "")

        verified = False
        if sig:
            expected = _hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
            verified = _hmac.compare_digest(sig, expected)
        elif slack_sig:
            ts = request.headers.get("X-Slack-Request-Timestamp", "")
            base = f"v0:{ts}:".encode() + raw
            expected = "v0=" + _hmac.new(secret.encode(), base, hashlib.sha256).hexdigest()
            verified = _hmac.compare_digest(slack_sig, expected)
        elif meta_sig and meta_sig.startswith("sha256="):
            expected = "sha256=" + _hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
            verified = _hmac.compare_digest(meta_sig, expected)

        if not verified:
            return JSONResponse({"error": "invalid signature"}, 403)

    # Parse body after signature verification
    try:
        body = _json.loads(raw)
    except (ValueError, _json.JSONDecodeError):
        return JSONResponse({"error": "invalid JSON"}, 400)

    platform = body.get("platform", "webhook")
    _VALID_PLATFORMS = {"discord", "telegram", "slack", "whatsapp", "webhook"}
    if platform not in _VALID_PLATFORMS:
        return JSONResponse({"error": "invalid platform"}, 400)

    sender = body.get("sender", "external")
    sender = sender[:50].replace(":", "_") if sender else "external"
    text = body.get("text", "")
    channel = body.get("channel", "general")

    if not text.strip():
        return JSONResponse({"error": "text required"}, 400)

    msg = await deps.store.add(
        sender=f"{platform}:{sender}",
        text=text,
        channel=channel,
    )
    from app_helpers import route_mentions
    route_mentions(f"{platform}:{sender}", text, channel)
    return msg
