"""Channel management routes."""
from __future__ import annotations

import json
import re
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import deps

router = APIRouter()
_CHANNEL_NAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9_-]{0,19})$")


@router.get("/api/channels")
async def get_channels():
    return {"channels": deps._settings.get("channels", ["general"])}


@router.post("/api/channels")
async def create_channel(request: Request):
    body = await request.json()
    name = body.get("name", "").strip().lower()
    if not _CHANNEL_NAME_RE.fullmatch(name):
        return JSONResponse({"error": "invalid name"}, 400)
    async with deps._settings_lock:
        channels = list(deps._settings.get("channels", ["general"]))
        if name in channels:
            return JSONResponse({"error": "exists"}, 409)
        if len(channels) >= 8:
            return JSONResponse({"error": "max 8 channels"}, 400)
        channels.append(name)
        deps._settings["channels"] = channels
        _save_settings()
    await deps.broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in channels]})
    return {"channels": channels}


@router.delete("/api/channels/{name}")
async def delete_channel(name: str):
    if name == "general":
        return JSONResponse({"error": "cannot delete general"}, 400)
    async with deps._settings_lock:
        channels = list(deps._settings.get("channels", ["general"]))
        if name not in channels:
            return JSONResponse({"error": "not found"}, 404)
        channels.remove(name)
        deps._settings["channels"] = channels
        _save_settings()
    await deps.broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in channels]})
    return {"channels": channels}


@router.patch("/api/channels/{name}")
async def rename_channel(name: str, request: Request):
    body = await request.json()
    new_name = body.get("name", "").strip().lower()
    if not _CHANNEL_NAME_RE.fullmatch(new_name):
        return JSONResponse({"error": "invalid name"}, 400)
    async with deps._settings_lock:
        channels = list(deps._settings.get("channels", ["general"]))
        if name not in channels:
            return JSONResponse({"error": "not found"}, 404)
        if new_name in channels:
            return JSONResponse({"error": "name already exists"}, 409)
        idx = channels.index(name)
        channels[idx] = new_name
        deps._settings["channels"] = channels
        _save_settings()
    # Update messages in the renamed channel
    await deps.store.rename_channel(name, new_name)
    await deps.broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in channels]})
    return {"channels": channels}


@router.get("/api/channels/{name}/summary")
async def channel_summary(name: str):
    """Generate a summary of recent channel activity."""
    channels = deps._settings.get("channels", ["general"])
    if name not in channels:
        return JSONResponse({"error": "channel not found"}, 404)
    if deps.store._db is None:
        return JSONResponse({"error": "database unavailable"}, 503)
    try:
        cursor = await deps.store._db.execute(
            "SELECT sender, text, timestamp FROM messages WHERE channel = ? ORDER BY id DESC LIMIT 100",
            (name,),
        )
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
    except Exception as e:
        return JSONResponse({"error": "database unavailable", "detail": str(e)}, 503)
    if not rows:
        return {"channel": name, "summary": "No messages yet.", "message_count": 0, "participants": [], "topics": []}
    rows.reverse()

    participants: dict[str, int] = {}
    words: dict[str, int] = {}
    for sender, text, _ts in rows:
        participants[sender] = participants.get(sender, 0) + 1
        for word in text.lower().split():
            clean = word.strip(".,!?@#()[]{}\"'`*_~")
            if len(clean) > 3 and clean not in {"this", "that", "with", "from", "have", "been", "will", "they", "their", "what", "when", "your", "just", "about", "like", "would", "could", "should", "there", "here", "some", "also", "more", "than", "very"}:
                words[clean] = words.get(clean, 0) + 1

    top_participants = sorted(participants.items(), key=lambda x: -x[1])[:5]
    top_topics = sorted(words.items(), key=lambda x: -x[1])[:10]
    topic_words = [w for w, _ in top_topics]

    first_ts = rows[0][2]
    last_ts = rows[-1][2]
    summary_parts = [
        f"{len(rows)} messages in #{name}",
        f"from {len(participants)} participant{'s' if len(participants) != 1 else ''}.",
    ]
    if top_participants:
        summary_parts.append(f"Most active: {', '.join(p for p, _ in top_participants[:3])}.")
    if topic_words:
        summary_parts.append(f"Key topics: {', '.join(topic_words[:5])}.")

    return {
        "channel": name,
        "summary": " ".join(summary_parts),
        "message_count": len(rows),
        "participants": [{"name": p, "count": c} for p, c in top_participants],
        "topics": topic_words,
        "first_message": first_ts,
        "last_message": last_ts,
    }


def _save_settings():
    from app_helpers import save_settings
    save_settings()


def _default_context() -> dict:
    return {
        "mode": "full",
        "visible_agents": [],
        "hidden_agents": [],
        "max_history": 0,
        "include_system_messages": True,
        "include_progress_messages": True,
    }


@router.get("/api/channels/{name}/context")
async def get_channel_context(name: str):
    channels = deps._settings.get("channels", ["general"])
    if name not in channels:
        return JSONResponse({"error": "channel not found"}, 404)
    contexts = deps._settings.get("channel_context", {})
    payload = contexts.get(name, _default_context()) if isinstance(contexts, dict) else _default_context()
    return {"channel": name, "context": payload}


@router.put("/api/channels/{name}/context")
async def set_channel_context(name: str, request: Request):
    channels = deps._settings.get("channels", ["general"])
    if name not in channels:
        return JSONResponse({"error": "channel not found"}, 404)
    body = await request.json()
    mode = str(body.get("mode", "full") or "full").strip().lower()
    if mode not in {"full", "mentions_only", "recent", "filtered"}:
        return JSONResponse({"error": "invalid mode"}, 400)
    payload = _default_context()
    payload.update(
        {
            "mode": mode,
            "visible_agents": [str(v) for v in body.get("visible_agents", body.get("visibleAgents", [])) if str(v).strip()],
            "hidden_agents": [str(v) for v in body.get("hidden_agents", body.get("hiddenAgents", [])) if str(v).strip()],
            "max_history": max(0, int(body.get("max_history", body.get("maxHistory", 0)) or 0)),
            "include_system_messages": bool(body.get("include_system_messages", body.get("includeSystemMessages", True))),
            "include_progress_messages": bool(body.get("include_progress_messages", body.get("includeProgressMessages", True))),
        }
    )
    async with deps._settings_lock:
        contexts = deps._settings.setdefault("channel_context", {})
        if not isinstance(contexts, dict):
            contexts = {}
            deps._settings["channel_context"] = contexts
        contexts[name] = payload
        _save_settings()
    await deps.broadcast("channel_context", {"channel": name, "context": payload})
    return {"channel": name, "context": payload}


async def _clone_branch_messages(parent_channel: str, branch_channel: str, fork_message_id: int) -> tuple[int, float]:
    if deps.store is None or deps.store._db is None:
        raise RuntimeError("Message store not initialized")

    cursor = await deps.store._db.execute(
        "SELECT * FROM messages WHERE channel = ? AND id <= ? ORDER BY id",
        (parent_channel, fork_message_id),
    )
    try:
        rows = await cursor.fetchall()
    finally:
        await cursor.close()

    reply_map: dict[int, int] = {}
    message_count = 0
    last_activity = 0.0

    for row in rows:
        source = deps.store._row_to_dict(row)
        reply_to = source.get("reply_to")
        if reply_to is not None:
            reply_to = reply_map.get(int(reply_to))

        metadata_payload: dict = {}
        try:
            metadata_payload = json.loads(source.get("metadata", "{}") or "{}")
        except (json.JSONDecodeError, TypeError, ValueError):
            metadata_payload = {}
        metadata_payload.update({
            "branch_source": {
                "channel": parent_channel,
                "message_id": source["id"],
                "uid": source.get("uid", ""),
            }
        })

        copied = await deps.store.add(
            sender=source["sender"],
            text=source["text"],
            msg_type=source["type"],
            channel=branch_channel,
            attachments=source.get("attachments", "[]"),
            reply_to=reply_to,
            metadata=json.dumps(metadata_payload),
        )
        await deps.store.update_metadata(copied["id"], json.dumps(metadata_payload))
        if source.get("pinned"):
            await deps.store.pin(copied["id"], True)
        try:
            await deps.store._db.execute(
                "UPDATE messages SET reactions = ? WHERE id = ?",
                (source.get("reactions", "{}"), copied["id"]),
            )
            await deps.store._db.commit()
        except Exception:
            pass

        reply_map[int(source["id"])] = copied["id"]
        message_count += 1
        last_activity = max(last_activity, float(source.get("timestamp", 0) or 0))

    return message_count, last_activity


@router.get("/api/branches")
async def list_branches(channel: str = ""):
    if not channel:
        return JSONResponse({"error": "channel required"}, 400)
    if not deps.branch_manager:
        return {"branches": []}
    return {"branches": deps.branch_manager.list_branches(channel)}


@router.post("/api/branches")
async def create_branch(request: Request):
    if not deps.branch_manager:
        return JSONResponse({"error": "Branch manager not initialized"}, 500)
    if deps.store is None:
        return JSONResponse({"error": "Message store not initialized"}, 500)

    body = await request.json()
    name = deps.branch_manager.normalize_name(body.get("name", ""))
    parent_channel = str(body.get("parent_channel", "") or "").strip().lower()
    fork_message_id = body.get("fork_message_id")

    if not name:
        return JSONResponse({"error": "name required"}, 400)
    if parent_channel not in deps._settings.get("channels", ["general"]):
        return JSONResponse({"error": "parent channel not found"}, 404)
    try:
        fork_message_id = int(fork_message_id)
    except (TypeError, ValueError):
        return JSONResponse({"error": "fork_message_id required"}, 400)

    fork_message = await deps.store.get_by_id(fork_message_id)
    if not fork_message or fork_message.get("channel") != parent_channel:
        return JSONResponse({"error": "fork message not found in parent channel"}, 404)

    base_channel = deps.branch_manager.make_channel_id(name)
    branch_channel = base_channel
    suffix = 2
    existing_channels = set(deps._settings.get("channels", ["general"]))
    while branch_channel in existing_channels or deps.branch_manager.channel_exists(branch_channel):
        candidate = f"{base_channel[: max(1, 20 - len(str(suffix)) - 1)]}-{suffix}"
        branch_channel = candidate[:20]
        suffix += 1
    if not deps.branch_manager.is_valid_channel(branch_channel):
        return JSONResponse({"error": "unable to allocate branch channel"}, 400)

    async with deps._settings_lock:
        channels = list(deps._settings.get("channels", ["general"]))
        channels.append(branch_channel)
        deps._settings["channels"] = channels
        _save_settings()

    branch = deps.branch_manager.create_branch(
        branch_id=branch_channel,
        name=name,
        parent_channel=parent_channel,
        fork_message_id=fork_message_id,
        fork_message_text=str(fork_message.get("text", "")),
    )
    message_count, last_activity = await _clone_branch_messages(parent_channel, branch_channel, fork_message_id)
    branch = deps.branch_manager.update_branch_stats(
        branch_channel,
        message_count=message_count,
        last_activity=last_activity or time.time(),
    ) or branch

    await deps.broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in deps._settings["channels"]]})
    await deps.broadcast("branch_update", {"action": "created", "branch": branch})
    return {"ok": True, "branch": branch, "channel": branch_channel}


@router.delete("/api/branches/{branch_id}")
async def delete_branch(branch_id: str):
    if not deps.branch_manager or deps.store is None or deps.store._db is None:
        return JSONResponse({"error": "Branch manager not initialized"}, 500)

    branch = deps.branch_manager.delete_branch(branch_id)
    if not branch:
        return JSONResponse({"error": "branch not found"}, 404)

    async with deps._settings_lock:
        channels = list(deps._settings.get("channels", ["general"]))
        if branch_id in channels:
            channels.remove(branch_id)
            deps._settings["channels"] = channels
            _save_settings()

    if deps.session_manager and deps.session_manager.get_session(branch_id):
        deps.session_manager.end_session(branch_id)
    if deps.store._db is not None:
        await deps.store._db.execute("DELETE FROM messages WHERE channel = ?", (branch_id,))
        await deps.store._db.commit()
    if getattr(deps, "job_store", None) and getattr(deps.job_store, "_db", None) is not None:
        await deps.job_store._db.execute("DELETE FROM jobs WHERE channel = ?", (branch_id,))
        await deps.job_store._db.commit()

    await deps.broadcast("channel_update", {"channels": [{"name": c, "unread": 0} for c in deps._settings["channels"]]})
    await deps.broadcast("branch_update", {"action": "deleted", "branch": branch})
    return {"ok": True}
