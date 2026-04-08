"""Unified task store backed by SQLite."""

from __future__ import annotations

import json
import time
import uuid as _uuid

import aiosqlite

TASK_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         TEXT    NOT NULL UNIQUE,
    parent_task_id  TEXT    DEFAULT NULL,
    source_type     TEXT    NOT NULL DEFAULT 'manual',
    source_ref      TEXT    DEFAULT NULL,
    title           TEXT    NOT NULL,
    description     TEXT    NOT NULL DEFAULT '',
    status          TEXT    NOT NULL DEFAULT 'queued',
    agent_id        TEXT    DEFAULT NULL,
    agent_name      TEXT    DEFAULT NULL,
    channel         TEXT    NOT NULL DEFAULT 'general',
    profile_id      TEXT    DEFAULT NULL,
    trace_id        TEXT    DEFAULT NULL,
    priority        INTEGER NOT NULL DEFAULT 0,
    progress_pct    INTEGER NOT NULL DEFAULT 0,
    progress_step   TEXT    NOT NULL DEFAULT '',
    progress_total  INTEGER NOT NULL DEFAULT 0,
    progress_data   TEXT    NOT NULL DEFAULT '{}',
    created_by      TEXT    NOT NULL DEFAULT '',
    created_at      REAL    NOT NULL,
    started_at      REAL    DEFAULT NULL,
    completed_at    REAL    DEFAULT NULL,
    updated_at      REAL    NOT NULL,
    error           TEXT    DEFAULT NULL,
    metadata        TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_name);
CREATE INDEX IF NOT EXISTS idx_tasks_channel ON tasks(channel);
CREATE INDEX IF NOT EXISTS idx_tasks_trace ON tasks(trace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
"""

VALID_STATUSES = {
    "queued",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
    "awaiting_external",
    "awaiting_approval",
    "awaiting_input",
}


def _json_text(value: object, fallback: str) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value or json.loads(fallback))
    except Exception:
        return fallback


class TaskStore:
    def __init__(self, db: aiosqlite.Connection):
        self._db = db

    async def init(self):
        await self._db.executescript(TASK_SCHEMA)
        await self._db.commit()

    async def create(
        self,
        *,
        title: str,
        description: str = "",
        channel: str = "general",
        agent_id: str | None = None,
        agent_name: str | None = None,
        profile_id: str | None = None,
        source_type: str = "manual",
        source_ref: str | None = None,
        parent_task_id: str | None = None,
        trace_id: str | None = None,
        priority: int = 0,
        created_by: str = "",
        status: str = "queued",
        metadata: dict | str | None = None,
    ) -> dict:
        now = time.time()
        task_id = _uuid.uuid4().hex
        status = status if status in VALID_STATUSES else "queued"
        progress_data = "{}"
        cursor = await self._db.execute(
            """
            INSERT INTO tasks (
                task_id, parent_task_id, source_type, source_ref, title, description, status,
                agent_id, agent_name, channel, profile_id, trace_id, priority,
                progress_pct, progress_step, progress_total, progress_data,
                created_by, created_at, started_at, completed_at, updated_at, error, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', 0, ?, ?, ?, NULL, NULL, ?, NULL, ?)
            """,
            (
                task_id,
                parent_task_id,
                source_type,
                source_ref,
                title,
                description,
                status,
                agent_id,
                agent_name,
                channel,
                profile_id,
                trace_id,
                priority,
                progress_data,
                created_by,
                now,
                now,
                _json_text(metadata, "{}"),
            ),
        )
        await self._db.commit()
        try:
            lastrowid = cursor.lastrowid
        finally:
            await cursor.close()
        return await self._get_by_id(lastrowid)

    async def get(self, task_id: str) -> dict | None:
        cursor = await self._db.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else None

    async def get_by_source_ref(self, source_type: str, source_ref: str) -> dict | None:
        cursor = await self._db.execute(
            "SELECT * FROM tasks WHERE source_type = ? AND source_ref = ? ORDER BY id DESC LIMIT 1",
            (source_type, source_ref),
        )
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else None

    async def list_tasks(
        self,
        *,
        channel: str | None = None,
        agent_id: str | None = None,
        agent_name: str | None = None,
        status: str | None = None,
        parent_task_id: str | None = None,
        trace_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        query = "SELECT * FROM tasks"
        params: list[object] = []
        clauses: list[str] = []
        if channel:
            clauses.append("channel = ?")
            params.append(channel)
        if agent_id:
            clauses.append("agent_id = ?")
            params.append(agent_id)
        if agent_name:
            clauses.append("agent_name = ?")
            params.append(agent_name)
        if status:
            clauses.append("status = ?")
            params.append(status)
        if parent_task_id:
            clauses.append("parent_task_id = ?")
            params.append(parent_task_id)
        if trace_id:
            clauses.append("trace_id = ?")
            params.append(trace_id)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?"
        params.extend([max(1, min(limit, 500)), max(0, offset)])
        cursor = await self._db.execute(query, params)
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [self._row_to_dict(row) for row in rows]

    async def update(self, task_id: str, **updates) -> dict | None:
        allowed = {
            "title",
            "description",
            "status",
            "source_type",
            "source_ref",
            "agent_id",
            "agent_name",
            "channel",
            "profile_id",
            "trace_id",
            "priority",
            "error",
            "metadata",
            "progress_pct",
            "progress_step",
            "progress_total",
            "progress_data",
            "started_at",
            "completed_at",
        }
        sets = {k: v for k, v in updates.items() if k in allowed}
        if "status" in sets and sets["status"] not in VALID_STATUSES:
            sets["status"] = "queued"
        if "metadata" in sets:
            sets["metadata"] = _json_text(sets["metadata"], "{}")
        if "progress_data" in sets:
            sets["progress_data"] = _json_text(sets["progress_data"], "{}")
        if not sets:
            return await self.get(task_id)
        sets["updated_at"] = time.time()
        cols = ", ".join(f"{k} = ?" for k in sets)
        vals = list(sets.values()) + [task_id]
        await self._db.execute(f"UPDATE tasks SET {cols} WHERE task_id = ?", vals)
        await self._db.commit()
        return await self.get(task_id)

    async def update_status(self, task_id: str, status: str, error: str | None = None) -> dict | None:
        now = time.time()
        updates: dict[str, object] = {"status": status, "error": error}
        if status == "running":
            updates["started_at"] = now
        if status in {"completed", "failed", "cancelled"}:
            updates["completed_at"] = now
        return await self.update(task_id, **updates)

    async def update_progress(
        self,
        task_id: str,
        pct: int,
        step: str,
        total: int,
        steps_data: list[dict],
    ) -> dict | None:
        pct = max(0, min(100, int(pct)))
        return await self.update(
            task_id,
            progress_pct=pct,
            progress_step=step[:200],
            progress_total=max(0, int(total)),
            progress_data=steps_data,
        )

    async def cancel(self, task_id: str, error: str | None = None) -> dict | None:
        return await self.update_status(task_id, "cancelled", error=error)

    async def delete(self, task_id: str) -> bool:
        cursor = await self._db.execute("DELETE FROM tasks WHERE task_id = ?", (task_id,))
        await self._db.commit()
        try:
            return cursor.rowcount > 0
        finally:
            await cursor.close()

    async def get_pending_cancellation(self, agent_name: str = "", agent_id: str = "") -> dict | None:
        clauses = ["status = 'cancelled'", "COALESCE(json_extract(metadata, '$.cancel_signal_delivered'), 0) != 1"]
        params: list[object] = []
        if agent_id:
            clauses.append("agent_id = ?")
            params.append(agent_id)
        elif agent_name:
            clauses.append("agent_name = ?")
            params.append(agent_name)
        else:
            return None
        cursor = await self._db.execute(
            f"""
            SELECT * FROM tasks
            WHERE {' AND '.join(clauses)}
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """,
            params,
        )
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else None

    async def get_pending_pause(self, agent_name: str = "", agent_id: str = "") -> dict | None:
        clauses = ["status = 'paused'", "COALESCE(json_extract(metadata, '$.pause_signal_delivered'), 0) != 1"]
        params: list[object] = []
        if agent_id:
            clauses.append("agent_id = ?")
            params.append(agent_id)
        elif agent_name:
            clauses.append("agent_name = ?")
            params.append(agent_name)
        else:
            return None
        cursor = await self._db.execute(
            f"""
            SELECT * FROM tasks
            WHERE {' AND '.join(clauses)}
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """,
            params,
        )
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else None

    async def mark_cancel_signal_delivered(self, task_id: str) -> dict | None:
        task = await self.get(task_id)
        if not task:
            return None
        metadata = dict(task.get("metadata", {}))
        metadata["cancel_signal_delivered"] = True
        metadata["cancel_signal_delivered_at"] = time.time()
        return await self.update(task_id, metadata=metadata)

    async def mark_pause_signal_delivered(self, task_id: str) -> dict | None:
        task = await self.get(task_id)
        if not task:
            return None
        metadata = dict(task.get("metadata", {}))
        metadata["pause_signal_delivered"] = True
        metadata["pause_signal_delivered_at"] = time.time()
        return await self.update(task_id, metadata=metadata)

    async def _get_by_id(self, row_id: int) -> dict | None:
        cursor = await self._db.execute("SELECT * FROM tasks WHERE id = ?", (row_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else None

    @staticmethod
    def _row_to_dict(row) -> dict:
        if row is None:
            return {}
        progress_data = row["progress_data"] or "{}"
        metadata = row["metadata"] or "{}"
        try:
            progress_parsed = json.loads(progress_data)
        except Exception:
            progress_parsed = {}
        try:
            metadata_parsed = json.loads(metadata)
        except Exception:
            metadata_parsed = {}
        return {
            "id": row["id"],
            "task_id": row["task_id"],
            "parent_task_id": row["parent_task_id"],
            "source_type": row["source_type"],
            "source_ref": row["source_ref"],
            "title": row["title"],
            "description": row["description"],
            "status": row["status"],
            "agent_id": row["agent_id"],
            "agent_name": row["agent_name"],
            "channel": row["channel"],
            "profile_id": row["profile_id"],
            "trace_id": row["trace_id"],
            "priority": row["priority"],
            "progress_pct": row["progress_pct"],
            "progress_step": row["progress_step"],
            "progress_total": row["progress_total"],
            "progress_data": progress_parsed,
            "created_by": row["created_by"],
            "created_at": row["created_at"],
            "started_at": row["started_at"],
            "completed_at": row["completed_at"],
            "updated_at": row["updated_at"],
            "error": row["error"],
            "metadata": metadata_parsed,
        }
