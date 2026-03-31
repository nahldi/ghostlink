"""Rules store backed by SQLite."""

from __future__ import annotations

import time

import aiosqlite

RULES_SCHEMA = """
CREATE TABLE IF NOT EXISTS rules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    author     TEXT NOT NULL DEFAULT '',
    reason     TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL
);
"""


class RuleStore:
    def __init__(self, db: aiosqlite.Connection):
        self._db = db
        self.epoch = 0

    async def init(self):
        await self._db.executescript(RULES_SCHEMA)
        await self._db.commit()
        # Count active rules to set initial epoch
        cursor = await self._db.execute(
            "SELECT COUNT(*) FROM rules WHERE status = 'active'"
        )
        row = await cursor.fetchone()
        self.epoch = row[0] if row else 0

    async def propose(self, text: str, author: str = "", reason: str = "") -> dict:
        now = time.time()
        cursor = await self._db.execute(
            "INSERT INTO rules (text, status, author, reason, created_at) VALUES (?, 'pending', ?, ?, ?)",
            (text, author, reason, now),
        )
        await self._db.commit()
        return await self._get_by_id(cursor.lastrowid)  # type: ignore

    async def activate(self, rule_id: int) -> dict | None:
        active_count = await self._count_active()
        if active_count >= 10:
            return None
        await self._db.execute(
            "UPDATE rules SET status = 'active' WHERE id = ?", (rule_id,)
        )
        await self._db.commit()
        self.epoch += 1
        return await self._get_by_id(rule_id)

    async def update(self, rule_id: int, updates: dict) -> dict | None:
        allowed = {"text", "status", "reason"}
        sets = {k: v for k, v in updates.items() if k in allowed}
        if not sets:
            return await self._get_by_id(rule_id)
        if "status" in sets and sets["status"] == "active":
            return await self.activate(rule_id)
        cols = ", ".join(f"{k} = ?" for k in sets)
        vals = list(sets.values()) + [rule_id]
        await self._db.execute(f"UPDATE rules SET {cols} WHERE id = ?", vals)
        await self._db.commit()
        if "status" in sets:
            self.epoch += 1
        return await self._get_by_id(rule_id)

    async def delete(self, rule_id: int) -> bool:
        cursor = await self._db.execute("DELETE FROM rules WHERE id = ?", (rule_id,))
        await self._db.commit()
        return cursor.rowcount > 0

    async def list_all(self) -> list[dict]:
        cursor = await self._db.execute(
            "SELECT * FROM rules ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
        return [self._row_to_dict(r) for r in rows]

    async def active_list(self) -> dict:
        cursor = await self._db.execute(
            "SELECT text FROM rules WHERE status = 'active' ORDER BY created_at"
        )
        rows = await cursor.fetchall()
        return {"epoch": self.epoch, "rules": [r["text"] for r in rows]}

    async def _count_active(self) -> int:
        cursor = await self._db.execute(
            "SELECT COUNT(*) FROM rules WHERE status = 'active'"
        )
        row = await cursor.fetchone()
        return row[0] if row else 0

    async def _get_by_id(self, rule_id: int) -> dict:
        cursor = await self._db.execute(
            "SELECT * FROM rules WHERE id = ?", (rule_id,)
        )
        row = await cursor.fetchone()
        return self._row_to_dict(row) if row else {}

    @staticmethod
    def _row_to_dict(row) -> dict:
        return {
            "id": row["id"],
            "text": row["text"],
            "status": row["status"],
            "author": row["author"],
            "reason": row["reason"],
            "created_at": row["created_at"],
        }
