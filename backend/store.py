"""Message store backed by SQLite via aiosqlite."""

from __future__ import annotations

import asyncio
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
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to);
"""

FTS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    text, sender, channel,
    content='messages', content_rowid='id'
);
"""

FTS_TRIGGERS = """
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, text, sender, channel)
    VALUES (new.id, new.text, new.sender, new.channel);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, text, sender, channel)
    VALUES ('delete', old.id, old.text, old.sender, old.channel);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, text, sender, channel)
    VALUES ('delete', old.id, old.text, old.sender, old.channel);
    INSERT INTO messages_fts(rowid, text, sender, channel)
    VALUES (new.id, new.text, new.sender, new.channel);
END;
"""

MIGRATION_REACTIONS = """
ALTER TABLE messages ADD COLUMN reactions TEXT NOT NULL DEFAULT '{}';
"""


class MessageStore:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        self._db: aiosqlite.Connection | None = None
        self._on_message: list[MsgCallback] = []
        self._reaction_lock = asyncio.Lock()

    async def init(self):
        # v3.3.3: Recover from empty/corrupt DB files before connecting
        db_file = Path(self.db_path)
        if db_file.exists() and db_file.stat().st_size == 0:
            import logging as _log
            _log.getLogger(__name__).warning("Database file is empty (0 bytes): %s", self.db_path)

            # BUG-082: Remove stale journal/WAL/SHM files that would cause
            # "disk I/O error" when SQLite tries to replay them on a 0-byte DB
            for suffix in ("-journal", "-wal", "-shm"):
                stale = Path(self.db_path + suffix)
                if stale.exists():
                    try:
                        stale.unlink()
                        _log.getLogger(__name__).info("Removed stale %s file: %s", suffix, stale)
                    except OSError as e:
                        _log.getLogger(__name__).warning("Could not remove %s: %s", stale, e)

            bak = db_file.with_suffix(".db.bak")
            if bak.exists() and bak.stat().st_size > 0:
                import shutil
                _log.getLogger(__name__).info("Restoring from backup: %s", bak)
                shutil.copy2(str(bak), str(db_file))
            # else: leave the 0-byte file — SQLite will initialize it as a fresh DB

        self._db = await aiosqlite.connect(self.db_path)
        self._db.row_factory = aiosqlite.Row
        # v2.4.0: WAL mode for better concurrent read performance
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute("PRAGMA synchronous=NORMAL")
        await self._db.execute("PRAGMA cache_size=-64000")  # 64MB cache
        await self._db.execute("PRAGMA busy_timeout=5000")  # 5s retry on lock
        await self._db.executescript(DB_SCHEMA)
        await self._db.commit()
        # Migrate: add reactions column if missing
        try:
            await self._db.executescript(MIGRATION_REACTIONS)
            await self._db.commit()
        except Exception:
            pass  # Column already exists — expected on subsequent runs
        # FTS5 full-text search index
        try:
            await self._db.executescript(FTS_SCHEMA)
            await self._db.executescript(FTS_TRIGGERS)
            await self._db.commit()
            # Rebuild FTS index from existing messages (first time only)
            cursor = await self._db.execute("SELECT COUNT(*) FROM messages_fts")
            try:
                fts_count = (await cursor.fetchone())[0]
            finally:
                await cursor.close()
            cursor = await self._db.execute("SELECT COUNT(*) FROM messages")
            try:
                msg_count = (await cursor.fetchone())[0]
            finally:
                await cursor.close()
            if fts_count == 0 and msg_count > 0:
                await self._db.execute("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')")
                await self._db.commit()
        except Exception as e:
            import logging
            logging.getLogger(__name__).info("FTS5 not available (non-critical): %s", e)

    async def close(self):
        if self._db:
            await self._db.close()
            # BUG-083: Create backup on clean shutdown
            self._create_backup()

    def _create_backup(self):
        """Create a .bak copy of the database for crash recovery."""
        import shutil
        import logging as _log
        db_file = Path(self.db_path)
        if db_file.exists() and db_file.stat().st_size > 0:
            bak = db_file.with_suffix(".db.bak")
            try:
                shutil.copy2(str(db_file), str(bak))
                _log.getLogger(__name__).info("Database backup created: %s", bak)
            except OSError as e:
                _log.getLogger(__name__).warning("Failed to create backup: %s", e)

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
            uid = _uuid.uuid4().hex
        now = time.time()
        time_str = time.strftime("%H:%M:%S", time.localtime(now))

        if self._db is None:
            raise RuntimeError("MessageStore not initialized — call await store.init() first")
        cursor = await self._db.execute(
            """INSERT INTO messages
               (uid, sender, text, type, timestamp, time, channel, reply_to, attachments, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (uid, sender, text, msg_type, now, time_str, channel, reply_to, attachments, metadata),
        )
        await self._db.commit()
        try:
            lastrowid = cursor.lastrowid
        finally:
            await cursor.close()
        msg = {
            "id": lastrowid,
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
        if self._db is None:
            raise RuntimeError("MessageStore not initialized — call await store.init() first")
        cursor = await self._db.execute(
            "SELECT * FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?",
            (channel, count),
        )
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [self._row_to_dict(r) for r in reversed(rows)]

    async def get_since(self, since_id: int, channel: str = "general") -> list[dict]:
        if self._db is None:
            raise RuntimeError("MessageStore not initialized — call await store.init() first")
        cursor = await self._db.execute(
            "SELECT * FROM messages WHERE channel = ? AND id > ? ORDER BY id",
            (channel, since_id),
        )
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [self._row_to_dict(r) for r in rows]

    async def pin(self, msg_id: int, pinned: bool) -> dict | None:
        if self._db is None:
            raise RuntimeError("MessageStore not initialized — call await store.init() first")
        await self._db.execute(
            "UPDATE messages SET pinned = ? WHERE id = ?",
            (1 if pinned else 0, msg_id),
        )
        await self._db.commit()
        cursor = await self._db.execute("SELECT * FROM messages WHERE id = ?", (msg_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else None

    async def delete(self, msg_ids: list[int]) -> list[int]:
        if self._db is None:
            raise RuntimeError("MessageStore not initialized — call await store.init() first")
        deleted = []
        for mid in msg_ids:
            cursor = await self._db.execute("DELETE FROM messages WHERE id = ?", (mid,))
            try:
                rowcount = cursor.rowcount
            finally:
                await cursor.close()
            if rowcount:
                deleted.append(mid)
        await self._db.commit()
        return deleted

    async def react(self, msg_id: int, emoji: str, sender: str) -> dict | None:
        """Toggle a reaction on a message. Returns updated reactions dict."""
        import json
        if self._db is None:
            raise RuntimeError("MessageStore not initialized — call await store.init() first")
        async with self._reaction_lock:
            cursor = await self._db.execute("SELECT reactions FROM messages WHERE id = ?", (msg_id,))
            try:
                row = await cursor.fetchone()
            finally:
                await cursor.close()
            if not row:
                return None
            try:
                reactions = json.loads(row["reactions"]) if row["reactions"] else {}
            except (json.JSONDecodeError, TypeError):
                reactions = {}
            users = list(reactions.get(emoji, []))
            if sender in users:
                users.remove(sender)
            else:
                # Cap unique emoji at 50 and users per emoji at 100
                if emoji not in reactions and len(reactions) >= 50:
                    return reactions
                if len(users) >= 100:
                    return reactions
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

    async def edit(self, msg_id: int, new_text: str) -> dict | None:
        """Edit a message's text. Returns updated message or None."""
        if self._db is None:
            raise RuntimeError("MessageStore not initialized — call await store.init() first")
        await self._db.execute("UPDATE messages SET text = ? WHERE id = ?", (new_text, msg_id))
        await self._db.commit()
        return await self.get_by_id(msg_id)

    async def get_by_id(self, msg_id: int) -> dict | None:
        """Get a single message by ID."""
        if self._db is None:
            raise RuntimeError("MessageStore not initialized — call await store.init() first")
        cursor = await self._db.execute("SELECT * FROM messages WHERE id = ?", (msg_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else None

    async def update_metadata(self, msg_id: int, metadata: str) -> bool:
        """Update a message's metadata field."""
        if self._db is None:
            raise RuntimeError("MessageStore not initialized — call await store.init() first")
        await self._db.execute("UPDATE messages SET metadata = ? WHERE id = ?", (metadata, msg_id))
        await self._db.commit()
        return True

    async def rename_channel(self, old_name: str, new_name: str) -> int:
        """Rename all messages in a channel. Returns count of updated rows."""
        if self._db is None:
            raise RuntimeError("MessageStore not initialized — call await store.init() first")
        cursor = await self._db.execute(
            "UPDATE messages SET channel = ? WHERE channel = ?", (new_name, old_name)
        )
        await self._db.commit()
        try:
            return cursor.rowcount
        finally:
            await cursor.close()

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
