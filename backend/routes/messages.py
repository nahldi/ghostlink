"""Message API routes."""
from __future__ import annotations

import json
import unicodedata

import deps
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from plugin_sdk import event_bus

router = APIRouter()

_ALLOWED_MESSAGE_TYPES = {"chat", "system", "decision", "job_proposal", "rule_proposal", "progress", "approval_request"}
_EMOJI_BASE_RANGES = (
    (0x2600, 0x27BF),
    (0x1F000, 0x1FAFF),
)
_EMOJI_ALLOWED_CODEPOINTS = {
    0x200D,  # zero-width joiner
    0x20E3,  # keycap
    0xFE0E,  # text presentation selector
    0xFE0F,  # emoji presentation selector
}
_EMOJI_ALLOWED_SINGLETONS = {
    0x00A9,  # copyright
    0x00AE,  # registered
    0x203C,
    0x2049,
    0x2122,
    0x2139,
    0x3030,
    0x303D,
    0x3297,
    0x3299,
}
_KEYCAP_BASES = set("0123456789#*")


async def _message_exists(message_id: int) -> bool:
    if deps.store is None or deps.store._db is None:
        raise RuntimeError("Message store not initialized")
    cursor = await deps.store._db.execute("SELECT 1 FROM messages WHERE id = ? LIMIT 1", (message_id,))
    try:
        row = await cursor.fetchone()
    finally:
        await cursor.close()
    return row is not None


def _is_valid_emoji(value: str) -> bool:
    if not value or len(value) > 16:
        return False

    keycap_candidate = True
    saw_base = False

    for char in value:
        codepoint = ord(char)
        if char.isspace() or unicodedata.category(char).startswith("C"):
            return False

        if char not in _KEYCAP_BASES and codepoint not in _EMOJI_ALLOWED_CODEPOINTS:
            keycap_candidate = False

        if 0x1F1E6 <= codepoint <= 0x1F1FF or 0x1F3FB <= codepoint <= 0x1F3FF:
            saw_base = True
            continue

        if codepoint in _EMOJI_ALLOWED_CODEPOINTS:
            continue

        if codepoint in _EMOJI_ALLOWED_SINGLETONS or any(start <= codepoint <= end for start, end in _EMOJI_BASE_RANGES):
            saw_base = True
            continue

        return False

    return saw_base or (keycap_candidate and "\u20E3" in value)


@router.get("/api/messages")
async def get_messages(channel: str = "general", since_id: int = 0, limit: int = 50):
    limit = max(1, min(limit, 500))  # Clamp to 1-500, prevent negative/unbounded
    if since_id:
        msgs = await deps.store.get_since(since_id, channel)
    else:
        msgs = await deps.store.get_recent(limit, channel)
    return {"messages": msgs}


@router.post("/api/send")
async def send_message(request: Request):
    # v2.3.0: Restrict /api/send to localhost
    client_host = request.client.host if request.client else "127.0.0.1"
    if client_host not in ("127.0.0.1", "::1"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="External access denied")
    body = await request.json()
    sender = (body.get("sender", "You") or "").strip()
    text = (body.get("text", "") or "")
    channel = (body.get("channel", "general") or "").strip()
    reply_to = body.get("reply_to")
    if reply_to is not None:
        try:
            reply_to = int(reply_to)
        except (ValueError, TypeError):
            return JSONResponse({"error": "reply_to must be an integer"}, 400)
        if reply_to <= 0:
            return JSONResponse({"error": "reply_to must be a positive integer"}, 400)
        if not await _message_exists(reply_to):
            return JSONResponse({"error": "reply_to message not found"}, 400)
    attachments = body.get("attachments", [])
    msg_type = (body.get("type", "chat") or "chat").strip()
    raw_metadata = body.get("metadata", "{}")

    # Validate msg_type — whitelist allowed values
    if msg_type not in _ALLOWED_MESSAGE_TYPES:
        msg_type = "chat"

    # Normalize metadata to JSON string
    if isinstance(raw_metadata, dict):
        metadata_str = json.dumps(raw_metadata)
    elif isinstance(raw_metadata, str):
        metadata_str = raw_metadata
    else:
        metadata_str = "{}"

    if not text.strip():
        return JSONResponse({"error": "empty message"}, 400)
    if not sender or len(sender) > 100:
        return JSONResponse({"error": "invalid sender (1-100 chars)"}, 400)
    if len(text) > 102400:
        return JSONResponse({"error": "message too long (max 100KB)"}, 400)
    if not channel or len(channel) > 50:
        return JSONResponse({"error": "invalid channel name (1-50 chars)"}, 400)

    metadata_payload = {}
    try:
        metadata_payload = json.loads(metadata_str) if metadata_str else {}
    except (json.JSONDecodeError, TypeError, ValueError):
        metadata_payload = {}

    msg = await deps.store.add(
        sender=sender,
        text=text,
        msg_type=msg_type,
        channel=channel,
        reply_to=reply_to,
        attachments=json.dumps(attachments),
        metadata=metadata_str,
    )

    # Route @mentions to agent wrappers
    from app_helpers import route_mentions
    route_mentions(sender, text, channel)

    # Forward to channel bridges (Discord, Telegram, etc.)
    try:
        deps.bridge_manager.handle_ghostlink_message(
            sender,
            text,
            channel,
            msg_type=msg_type,
            message_id=msg.get("id"),
            metadata=metadata_payload,
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Bridge forwarding failed for %s: %s", channel, e)

    # Emit event for hooks
    event_bus.emit("on_message", {"sender": sender, "text": text, "channel": channel, "id": msg.get("id")})
    if getattr(deps, "automation_manager", None):
        await deps.automation_manager.process_trigger("event", {
            "event": "message_received",
            "sender": sender,
            "text": text,
            "channel": channel,
            "message_id": msg.get("id"),
            "workflow_generated": bool(metadata_payload.get("workflow_generated")),
        })

    return msg


@router.post("/api/messages/{msg_id}/pin")
async def pin_message(msg_id: int, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    pinned = body.get("pinned", True)
    result = await deps.store.pin(msg_id, pinned)
    if result:
        await deps.broadcast("pin", {"message_id": msg_id, "pinned": pinned})
        return result
    return JSONResponse({"error": "not found"}, 404)


@router.post("/api/messages/{msg_id}/react")
async def react_message(msg_id: int, request: Request):
    body = await request.json()
    emoji = body.get("emoji", "")
    sender = body.get("sender", "You")
    if not emoji:
        return JSONResponse({"error": "emoji required"}, 400)
    if not _is_valid_emoji(emoji):
        return JSONResponse({"error": "invalid emoji"}, 400)
    reactions = await deps.store.react(msg_id, emoji, sender)
    if reactions is None:
        return JSONResponse({"error": "not found"}, 404)
    await deps.broadcast("reaction", {"message_id": msg_id, "reactions": reactions})
    return {"message_id": msg_id, "reactions": reactions}


@router.patch("/api/messages/{msg_id}")
async def edit_message(msg_id: int, request: Request):
    body = await request.json()
    new_text = (body.get("text", "") or "").strip()
    if not new_text:
        return JSONResponse({"error": "text required"}, 400)
    if len(new_text) > 102400:
        return JSONResponse({"error": "message too long"}, 400)
    msg = await deps.store.edit(msg_id, new_text)
    if not msg:
        return JSONResponse({"error": "not found"}, 404)
    await deps.broadcast("message_edit", {"message_id": msg_id, "text": new_text})
    return msg


@router.post("/api/messages/{msg_id}/bookmark")
async def bookmark_message(msg_id: int, request: Request):
    body = await request.json()
    bookmarked = body.get("bookmarked", True)
    # Bookmarks are stored client-side — this endpoint just acknowledges
    # and broadcasts so other clients can sync
    await deps.broadcast("bookmark", {"message_id": msg_id, "bookmarked": bookmarked})
    return {"message_id": msg_id, "bookmarked": bookmarked}


@router.post("/api/messages/{msg_id}/progress-update")
async def progress_update(msg_id: int, request: Request):
    """Internal: broadcast a progress metadata update to all WebSocket clients."""
    body = await request.json()
    metadata = body.get("metadata", "{}")
    await deps.broadcast("message_edit", {"message_id": msg_id, "metadata": metadata})
    return {"ok": True}


@router.delete("/api/messages/{msg_id}")
async def delete_message(msg_id: int):
    # Block deletion of system/join messages
    if deps.store._db:
        cursor = await deps.store._db.execute(
            "SELECT type FROM messages WHERE id = ?", (msg_id,)
        )
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        if row and row[0] in ("system", "join"):
            return JSONResponse({"error": "cannot delete system messages"}, 403)
    deleted = await deps.store.delete([msg_id])
    if deleted:
        await deps.broadcast("delete", {"message_ids": deleted})
        return {"ok": True}
    return JSONResponse({"error": "not found"}, 404)


@router.post("/api/messages/bulk-delete")
async def bulk_delete_messages(request: Request):
    body = await request.json()
    ids = body.get("ids", [])
    if not ids or not isinstance(ids, list):
        return JSONResponse({"error": "ids must be a non-empty list"}, 400)
    if len(ids) > 200:
        return JSONResponse({"error": "max 200 messages per request"}, 400)
    # Sanitize: coerce to int, skip any non-numeric values
    safe_ids = []
    for i in ids:
        try:
            safe_ids.append(int(i))
        except (ValueError, TypeError):
            continue
    if not safe_ids:
        return JSONResponse({"error": "no valid ids"}, 400)
    # Filter out system/join messages — these are structural and should not be deleted
    if deps.store._db:
        placeholders = ",".join("?" * len(safe_ids))
        cursor = await deps.store._db.execute(
            f"SELECT id FROM messages WHERE id IN ({placeholders}) AND type IN ('system', 'join')",
            tuple(safe_ids),
        )
        try:
            protected = {row[0] for row in await cursor.fetchall()}
        finally:
            await cursor.close()
        if protected:
            safe_ids = [i for i in safe_ids if i not in protected]
        if not safe_ids:
            return JSONResponse({"error": "cannot delete system messages"}, 403)
    deleted = await deps.store.delete(safe_ids)
    if deleted:
        await deps.broadcast("delete", {"message_ids": deleted})
    return {"ok": True, "deleted": deleted or []}


@router.post("/api/stream-token")
async def stream_token(request: Request):
    """Broadcast a token stream event to all WebSocket clients.
    Used by MCP bridge chat_stream_token to enable real-time token streaming."""
    body = await request.json()
    message_id = body.get("message_id")
    token = body.get("token", "")
    done = body.get("done", False)
    if not message_id:
        return JSONResponse({"error": "message_id required"}, 400)
    await deps.broadcast("token_stream", {"message_id": message_id, "token": token, "done": done})
    return {"ok": True}
