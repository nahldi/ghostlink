"""Job store backed by SQLite."""

from __future__ import annotations

import time
import uuid as _uuid
import aiosqlite

JOBS_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uid         TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open',
    channel     TEXT NOT NULL DEFAULT 'general',
    created_by  TEXT NOT NULL DEFAULT '',
    assignee    TEXT NOT NULL DEFAULT '',
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);
"""


class JobStore:
    def __init__(self, db: aiosqlite.Connection):
        self._db = db

    async def init(self):
        await self._db.executescript(JOBS_SCHEMA)
        await self._db.commit()

    async def create(
        self,
        title: str,
        channel: str = "general",
        created_by: str = "",
        assignee: str = "",
        body: str = "",
        job_type: str = "",
    ) -> dict:
        now = time.time()
        uid = _uuid.uuid4().hex
        cursor = await self._db.execute(
            """INSERT INTO jobs (uid, type, title, body, status, channel, created_by, assignee, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)""",
            (uid, job_type, title, body, channel, created_by, assignee, now, now),
        )
        await self._db.commit()
        try:
            lastrowid = cursor.lastrowid
        finally:
            await cursor.close()
        return await self._get_by_id(lastrowid)  # type: ignore

    async def update(self, job_id: int, updates: dict) -> dict | None:
        allowed = {"status", "title", "assignee", "body", "sort_order"}
        sets = {k: v for k, v in updates.items() if k in allowed}
        if not sets:
            return await self._get_by_id(job_id)
        sets["updated_at"] = time.time()
        cols = ", ".join(f"{k} = ?" for k in sets)
        vals = list(sets.values()) + [job_id]
        await self._db.execute(f"UPDATE jobs SET {cols} WHERE id = ?", vals)
        await self._db.commit()
        return await self._get_by_id(job_id)

    async def delete(self, job_id: int) -> bool:
        cursor = await self._db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        await self._db.commit()
        try:
            return cursor.rowcount > 0
        finally:
            await cursor.close()

    async def list_jobs(self, channel: str | None = None, status: str | None = None) -> list[dict]:
        query = "SELECT * FROM jobs"
        params: list = []
        clauses = []
        if channel:
            clauses.append("channel = ?")
            params.append(channel)
        if status:
            clauses.append("status = ?")
            params.append(status)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY sort_order, id"
        cursor = await self._db.execute(query, params)
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [self._row_to_dict(r) for r in rows]

    async def _get_by_id(self, job_id: int) -> dict:
        cursor = await self._db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else {}

    @staticmethod
    def _row_to_dict(row) -> dict:
        return {
            "id": row["id"],
            "uid": row["uid"],
            "type": row["type"],
            "title": row["title"],
            "body": row["body"],
            "status": row["status"],
            "channel": row["channel"],
            "created_by": row["created_by"],
            "assignee": row["assignee"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "sort_order": row["sort_order"],
        }
