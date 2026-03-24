"""Channel management routes."""
from __future__ import annotations

import deps
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/api/channels")
async def get_channels():
    return {"channels": deps._settings.get("channels", ["general"])}


@router.post("/api/channels")
async def create_channel(request: Request):
    body = await request.json()
    name = body.get("name", "").strip().lower()
    if not name or len(name) > 20:
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
    if not new_name or len(new_name) > 20:
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
        raise RuntimeError("database not initialized")
    cursor = await deps.store._db.execute(
        "SELECT sender, text, timestamp FROM messages WHERE channel = ? ORDER BY id DESC LIMIT 100",
        (name,),
    )
    rows = await cursor.fetchall()
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
    """Save settings to disk. Expects DATA_DIR to be set in deps."""
    import json
    settings_path = deps.DATA_DIR / "settings.json"
    with open(settings_path, "w") as f:
        json.dump(deps._settings, f, indent=2)
