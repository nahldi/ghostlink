"""Message store backed by SQLite via aiosqlite."""

from __future__ import annotations

import time
import aiosqlite
from pathlib import Path
from typing import Any, Callable, Awaitable

MsgCallback = Callable[[dict], Awaitable[None]]

DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    uid        TEXT NOT NULL,
    sender     TEXT NOT NULL,
    text       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'chat',
    timestamp  REAL NOT NULL,
    time       TEXT NOT NULL,
    channel    TEXT NOT NULL DEFAULT 'general',
    reply_to   INTEGER,
    pinned     INTEGER NOT NULL DEFAULT 0,
    attachments TEXT NOT NULL DEFAULT '[]',
    metadata   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
"""

MIGRATION_REACTIONS = """
ALTER TABLE messages ADD COLUMN reactions TEXT NOT NULL DEFAULT '{}';
"""


class MessageStore:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        self._db: aiosqlite.Connection | None = None
        self._on_message: list[MsgCallback] = []

    async def init(self):
        self._db = await aiosqlite.connect(self.db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(DB_SCHEMA)
        await self._db.commit()
        # Migrate: add reactions column if missing
        try:
            await self._db.executescript(MIGRATION_REACTIONS)
            await self._db.commit()
        except Exception:
            pass  # Column already exists

    async def close(self):
        if self._db:
            await self._db.close()

    def on_message(self, cb: MsgCallback):
        self._on_message.append(cb)

    async def add(
        self,
        sender: str,
        text: str,
        msg_type: str = "chat",
        channel: str = "general",
        attachments: str = "[]",
        reply_to: int | None = None,
        metadata: str = "{}",
        uid: str = "",
    ) -> dict:
        import uuid as _uuid
        if not uid:
            uid = str(_uuid.uuid4())[:8]
        now = time.time()
        time_str = time.strftime("%H:%M:%S", time.localtime(now))

        assert self._db is not None
        cursor = await self._db.execute(
            """INSERT INTO messages
               (uid, sender, text, type, timestamp, time, channel, reply_to, attachments, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (uid, sender, text, msg_type, now, time_str, channel, reply_to, attachments, metadata),
        )
        await self._db.commit()
        msg = {
            "id": cursor.lastrowid,
            "uid": uid,
            "sender": sender,
            "text": text,
            "type": msg_type,
            "timestamp": now,
            "time": time_str,
            "channel": channel,
            "reply_to": reply_to,
            "pinned": False,
            "attachments": attachments,
            "metadata": metadata,
            "reactions": "{}",
        }
        for cb in self._on_message:
            await cb(msg)
        return msg

    async def get_recent(self, count: int = 50, channel: str = "general") -> list[dict]:
        assert self._db is not None
        cursor = await self._db.execute(
            "SELECT * FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?",
            (channel, count),
        )
        rows = await cursor.fetchall()
        return [self._row_to_dict(r) for r in reversed(rows)]

    async def get_since(self, since_id: int, channel: str = "general") -> list[dict]:
        assert self._db is not None
        cursor = await self._db.execute(
            "SELECT * FROM messages WHERE channel = ? AND id > ? ORDER BY id",
            (channel, since_id),
        )
        rows = await cursor.fetchall()
        return [self._row_to_dict(r) for r in rows]

    async def pin(self, msg_id: int, pinned: bool) -> dict | None:
        assert self._db is not None
        await self._db.execute(
            "UPDATE messages SET pinned = ? WHERE id = ?",
            (1 if pinned else 0, msg_id),
        )
        await self._db.commit()
        cursor = await self._db.execute("SELECT * FROM messages WHERE id = ?", (msg_id,))
        row = await cursor.fetchone()
        return self._row_to_dict(row) if row else None

    async def delete(self, msg_ids: list[int]) -> list[int]:
        assert self._db is not None
        deleted = []
        for mid in msg_ids:
            cursor = await self._db.execute("DELETE FROM messages WHERE id = ?", (mid,))
            if cursor.rowcount:
                deleted.append(mid)
        await self._db.commit()
        return deleted

    async def react(self, msg_id: int, emoji: str, sender: str) -> dict | None:
        """Toggle a reaction on a message. Returns updated reactions dict."""
        import json
        assert self._db is not None
        cursor = await self._db.execute("SELECT reactions FROM messages WHERE id = ?", (msg_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        try:
            reactions = json.loads(row["reactions"]) if row["reactions"] else {}
        except (json.JSONDecodeError, TypeError):
            reactions = {}
        users = reactions.get(emoji, [])
        if sender in users:
            users.remove(sender)
        else:
            users.append(sender)
        if users:
            reactions[emoji] = users
        else:
            reactions.pop(emoji, None)
        await self._db.execute(
            "UPDATE messages SET reactions = ? WHERE id = ?",
            (json.dumps(reactions), msg_id),
        )
        await self._db.commit()
        return reactions

    @staticmethod
    def _row_to_dict(row: Any) -> dict:
        return {
            "id": row["id"],
            "uid": row["uid"],
            "sender": row["sender"],
            "text": row["text"],
            "type": row["type"],
            "timestamp": row["timestamp"],
            "time": row["time"],
            "channel": row["channel"],
            "reply_to": row["reply_to"],
            "pinned": bool(row["pinned"]),
            "attachments": row["attachments"],
            "metadata": row["metadata"],
            "reactions": row["reactions"] if "reactions" in row.keys() else "{}",
        }
