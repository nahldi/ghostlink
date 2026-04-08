"""Durable execution checkpoints for tasks."""

from __future__ import annotations

import json
import time
import uuid as _uuid

import aiosqlite

CHECKPOINT_SCHEMA = """
CREATE TABLE IF NOT EXISTS checkpoints (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    checkpoint_id   TEXT    NOT NULL UNIQUE,
    task_id         TEXT    NOT NULL,
    agent_id        TEXT    DEFAULT NULL,
    agent_name      TEXT    NOT NULL,
    session_id      TEXT    DEFAULT NULL,
    trace_id        TEXT    DEFAULT NULL,
    sequence_num    INTEGER NOT NULL DEFAULT 0,
    trigger         TEXT    NOT NULL,
    state_snapshot  TEXT    NOT NULL DEFAULT '{}',
    pending_actions TEXT    NOT NULL DEFAULT '[]',
    worktree_ref    TEXT    DEFAULT NULL,
    artifact_refs   TEXT    NOT NULL DEFAULT '[]',
    context_window  TEXT    NOT NULL DEFAULT '{}',
    metadata        TEXT    NOT NULL DEFAULT '{}',
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    created_at      REAL    NOT NULL,
    expires_at      REAL    DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_cp_task ON checkpoints(task_id);
CREATE INDEX IF NOT EXISTS idx_cp_agent ON checkpoints(agent_name);
CREATE INDEX IF NOT EXISTS idx_cp_trace ON checkpoints(trace_id);
CREATE INDEX IF NOT EXISTS idx_cp_seq ON checkpoints(task_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_cp_created ON checkpoints(created_at);
"""

MAX_SNAPSHOT_BYTES = 1_000_000


def _json_text(value: object, fallback: str) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value or json.loads(fallback))
    except Exception:
        return fallback


class CheckpointStore:
    def __init__(self, db: aiosqlite.Connection):
        self._db = db

    async def init(self):
        await self._db.executescript(CHECKPOINT_SCHEMA)
        await self._db.commit()

    async def create(
        self,
        task_id: str,
        agent_name: str,
        trigger: str,
        state_snapshot: dict,
        *,
        agent_id: str | None = None,
        pending_actions: list | None = None,
        worktree_ref: str | None = None,
        artifact_refs: list | None = None,
        session_id: str | None = None,
        trace_id: str | None = None,
        context_window: dict | None = None,
        metadata: dict | None = None,
        expires_at: float | None = None,
    ) -> dict:
        checkpoint_id = _uuid.uuid4().hex
        sequence_num = await self._next_sequence_num(task_id)
        state_payload = dict(state_snapshot or {})
        state_text = _json_text(state_payload, "{}")
        if len(state_text.encode("utf-8")) > MAX_SNAPSHOT_BYTES:
            state_payload = dict(state_payload)
            state_payload["context_window"] = {"truncated": True}
            state_text = _json_text(state_payload, "{}")
        pending_text = _json_text(pending_actions or [], "[]")
        artifact_text = _json_text(artifact_refs or [], "[]")
        context_text = _json_text(context_window or {}, "{}")
        metadata_text = _json_text(metadata or {}, "{}")
        size_bytes = len(state_text.encode("utf-8"))
        now = time.time()
        cursor = await self._db.execute(
            """
            INSERT INTO checkpoints (
                checkpoint_id, task_id, agent_id, agent_name, session_id, trace_id, sequence_num,
                trigger, state_snapshot, pending_actions, worktree_ref, artifact_refs, context_window,
                metadata, size_bytes, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                checkpoint_id,
                task_id,
                agent_id,
                agent_name,
                session_id,
                trace_id,
                sequence_num,
                trigger,
                state_text,
                pending_text,
                worktree_ref,
                artifact_text,
                context_text,
                metadata_text,
                size_bytes,
                now,
                expires_at,
            ),
        )
        await self._db.commit()
        try:
            row_id = cursor.lastrowid
        finally:
            await cursor.close()
        return await self._get_by_id(row_id)

    async def get(self, checkpoint_id: str) -> dict | None:
        cursor = await self._db.execute("SELECT * FROM checkpoints WHERE checkpoint_id = ?", (checkpoint_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else None

    async def get_latest(self, task_id: str) -> dict | None:
        cursor = await self._db.execute(
            "SELECT * FROM checkpoints WHERE task_id = ? ORDER BY sequence_num DESC, id DESC LIMIT 1",
            (task_id,),
        )
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else None

    async def list_for_task(self, task_id: str) -> list[dict]:
        cursor = await self._db.execute(
            "SELECT * FROM checkpoints WHERE task_id = ? ORDER BY sequence_num ASC, id ASC",
            (task_id,),
        )
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [self._row_to_dict(row) for row in rows]

    async def list_for_agent(self, agent_name: str, limit: int = 50) -> list[dict]:
        cursor = await self._db.execute(
            "SELECT * FROM checkpoints WHERE agent_name = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            (agent_name, max(1, min(limit, 200))),
        )
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [self._row_to_dict(row) for row in rows]

    async def delete(self, checkpoint_id: str) -> bool:
        cursor = await self._db.execute("DELETE FROM checkpoints WHERE checkpoint_id = ?", (checkpoint_id,))
        await self._db.commit()
        try:
            return cursor.rowcount > 0
        finally:
            await cursor.close()

    async def compact(self, task_id: str, keep_every_n: int = 5) -> int:
        checkpoints = await self.list_for_task(task_id)
        if len(checkpoints) <= 3:
            return 0
        keep_ids = set()
        for idx, cp in enumerate(checkpoints):
            if idx == 0 or idx == len(checkpoints) - 1 or cp["trigger"] in {"task_start", "completion"} or idx % max(1, keep_every_n) == 0:
                keep_ids.add(cp["checkpoint_id"])
        delete_ids = [cp["checkpoint_id"] for cp in checkpoints if cp["checkpoint_id"] not in keep_ids]
        if not delete_ids:
            return 0
        placeholders = ",".join("?" * len(delete_ids))
        cursor = await self._db.execute(f"DELETE FROM checkpoints WHERE checkpoint_id IN ({placeholders})", delete_ids)
        await self._db.commit()
        try:
            return cursor.rowcount
        finally:
            await cursor.close()

    async def apply_retention(self, max_age_days: int) -> int:
        cutoff = time.time() - (max_age_days * 86400)
        cursor = await self._db.execute("DELETE FROM checkpoints WHERE created_at < ?", (cutoff,))
        await self._db.commit()
        try:
            return cursor.rowcount
        finally:
            await cursor.close()

    async def _next_sequence_num(self, task_id: str) -> int:
        cursor = await self._db.execute("SELECT COALESCE(MAX(sequence_num), 0) FROM checkpoints WHERE task_id = ?", (task_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return int((row[0] if row else 0) or 0) + 1

    async def _get_by_id(self, row_id: int) -> dict | None:
        cursor = await self._db.execute("SELECT * FROM checkpoints WHERE id = ?", (row_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else None

    @staticmethod
    def _row_to_dict(row) -> dict:
        def _parse(value: str, fallback):
            try:
                return json.loads(value or json.dumps(fallback))
            except Exception:
                return fallback
        return {
            "id": row["id"],
            "checkpoint_id": row["checkpoint_id"],
            "task_id": row["task_id"],
            "agent_id": row["agent_id"],
            "agent_name": row["agent_name"],
            "session_id": row["session_id"],
            "trace_id": row["trace_id"],
            "sequence_num": row["sequence_num"],
            "trigger": row["trigger"],
            "state_snapshot": _parse(row["state_snapshot"], {}),
            "pending_actions": _parse(row["pending_actions"], []),
            "worktree_ref": row["worktree_ref"],
            "artifact_refs": _parse(row["artifact_refs"], []),
            "context_window": _parse(row["context_window"], {}),
            "metadata": _parse(row["metadata"], {}),
            "size_bytes": row["size_bytes"],
            "created_at": row["created_at"],
            "expires_at": row["expires_at"],
        }
