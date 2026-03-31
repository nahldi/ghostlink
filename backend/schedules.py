"""Schedule store backed by SQLite — cron-like scheduled tasks for agents."""

from __future__ import annotations

import time
import uuid as _uuid

import aiosqlite

SCHEDULES_SCHEMA = """
CREATE TABLE IF NOT EXISTS schedules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uid         TEXT NOT NULL,
    cron_expr   TEXT NOT NULL DEFAULT '* * * * *',
    agent       TEXT NOT NULL DEFAULT '',
    command     TEXT NOT NULL DEFAULT '',
    channel     TEXT NOT NULL DEFAULT 'general',
    enabled     INTEGER NOT NULL DEFAULT 1,
    last_run    REAL NOT NULL DEFAULT 0,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);
"""


class ScheduleStore:
    def __init__(self, db: aiosqlite.Connection):
        self._db = db

    async def init(self):
        await self._db.executescript(SCHEDULES_SCHEMA)
        await self._db.commit()

    async def create(
        self,
        cron_expr: str,
        agent: str = "",
        command: str = "",
        channel: str = "general",
        enabled: bool = True,
    ) -> dict:
        now = time.time()
        uid = _uuid.uuid4().hex
        cursor = await self._db.execute(
            """INSERT INTO schedules (uid, cron_expr, agent, command, channel, enabled, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (uid, cron_expr, agent, command, channel, 1 if enabled else 0, now, now),
        )
        await self._db.commit()
        try:
            lastrowid = cursor.lastrowid
        finally:
            await cursor.close()
        return await self._get_by_id(lastrowid)  # type: ignore

    async def update(self, sched_id: int, updates: dict) -> dict | None:
        allowed = {"cron_expr", "agent", "command", "channel", "enabled", "last_run"}
        sets = {k: v for k, v in updates.items() if k in allowed}
        if not sets:
            return await self._get_by_id(sched_id)
        if "enabled" in sets:
            sets["enabled"] = 1 if sets["enabled"] else 0
        sets["updated_at"] = time.time()
        cols = ", ".join(f"{k} = ?" for k in sets)
        vals = list(sets.values()) + [sched_id]
        await self._db.execute(f"UPDATE schedules SET {cols} WHERE id = ?", vals)
        await self._db.commit()
        return await self._get_by_id(sched_id)

    async def delete(self, sched_id: int) -> bool:
        cursor = await self._db.execute("DELETE FROM schedules WHERE id = ?", (sched_id,))
        await self._db.commit()
        try:
            return cursor.rowcount > 0
        finally:
            await cursor.close()

    async def list_all(self) -> list[dict]:
        cursor = await self._db.execute("SELECT * FROM schedules ORDER BY id")
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [self._row_to_dict(r) for r in rows]

    async def list_enabled(self) -> list[dict]:
        cursor = await self._db.execute(
            "SELECT * FROM schedules WHERE enabled = 1 ORDER BY id"
        )
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [self._row_to_dict(r) for r in rows]

    async def mark_run(self, sched_id: int):
        now = time.time()
        await self._db.execute(
            "UPDATE schedules SET last_run = ?, updated_at = ? WHERE id = ?",
            (now, now, sched_id),
        )
        await self._db.commit()

    async def claim_due_run(self, sched_id: int, cooldown_seconds: float, now: float | None = None) -> bool:
        """Atomically mark a schedule as running only if its cooldown elapsed."""
        if now is None:
            now = time.time()
        threshold = now - max(0.0, cooldown_seconds)
        cursor = await self._db.execute(
            """
            UPDATE schedules
               SET last_run = ?, updated_at = ?
             WHERE id = ?
               AND enabled = 1
               AND last_run <= ?
            """,
            (now, now, sched_id, threshold),
        )
        await self._db.commit()
        try:
            return cursor.rowcount > 0
        finally:
            await cursor.close()

    async def _get_by_id(self, sched_id: int) -> dict:
        cursor = await self._db.execute("SELECT * FROM schedules WHERE id = ?", (sched_id,))
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
            "cron_expr": row["cron_expr"],
            "agent": row["agent"],
            "command": row["command"],
            "channel": row["channel"],
            "enabled": bool(row["enabled"]),
            "last_run": row["last_run"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }


def cron_matches(cron_expr: str, ts: float | None = None) -> bool:
    """Check if a cron expression matches the given timestamp (or now).

    Supports standard 5-field cron: minute hour day_of_month month day_of_week.
    Supports: *, specific numbers, comma-separated lists, ranges (e.g. 1-5),
    and step values (e.g. */5).
    """
    import datetime
    if ts is None:
        ts = time.time()
    # Use UTC consistently so cron expressions behave the same regardless of server timezone
    dt = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc)
    parts = cron_expr.strip().split()
    if len(parts) != 5:
        return False

    values = [dt.minute, dt.hour, dt.day, dt.month, dt.isoweekday() % 7]  # 0=Sun
    ranges = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 6)]

    for field_val, field_expr, (lo, hi) in zip(values, parts, ranges):
        if not _field_matches(field_val, field_expr, lo, hi):
            return False
    return True


def _field_matches(value: int, expr: str, lo: int, hi: int) -> bool:
    """Check if a single cron field expression matches a value."""
    for part in expr.split(","):
        part = part.strip()
        if part == "*":
            return True
        if "/" in part:
            base, step_str = part.split("/", 1)
            try:
                step = int(step_str)
            except ValueError:
                continue
            if base == "*":
                if value % step == 0:
                    return True
            else:
                try:
                    base_val = int(base)
                    if value >= base_val and (value - base_val) % step == 0:
                        return True
                except ValueError:
                    continue
        elif "-" in part:
            try:
                a, b = part.split("-", 1)
                if int(a) <= value <= int(b):
                    return True
            except ValueError:
                continue
        else:
            try:
                if int(part) == value:
                    return True
            except ValueError:
                continue
    return False
