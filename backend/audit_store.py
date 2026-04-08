"""Structured audit events stored in SQLite."""

from __future__ import annotations

import csv
import io
import json
import time
import uuid as _uuid
from datetime import datetime, timezone

import aiosqlite

AUDIT_SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     TEXT    NOT NULL UNIQUE,
    timestamp    REAL    NOT NULL,
    event_type   TEXT    NOT NULL,
    actor        TEXT    NOT NULL DEFAULT '',
    actor_type   TEXT    NOT NULL DEFAULT 'system',
    agent_id     TEXT    DEFAULT NULL,
    agent_name   TEXT    DEFAULT NULL,
    task_id      TEXT    DEFAULT NULL,
    trace_id     TEXT    DEFAULT NULL,
    channel      TEXT    DEFAULT NULL,
    provider     TEXT    DEFAULT NULL,
    profile_id   TEXT    DEFAULT NULL,
    action       TEXT    NOT NULL DEFAULT '',
    outcome      TEXT    NOT NULL DEFAULT 'ok',
    detail       TEXT    NOT NULL DEFAULT '{}',
    cost_usd     REAL    DEFAULT NULL,
    duration_ms  INTEGER DEFAULT NULL,
    created_at   REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_events(agent_name);
CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_events(task_id);
CREATE INDEX IF NOT EXISTS idx_audit_trace ON audit_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_channel ON audit_events(channel);
"""


def _iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


class AuditStore:
    def __init__(self, db: aiosqlite.Connection):
        self._db = db

    async def init(self):
        await self._db.executescript(AUDIT_SCHEMA)
        await self._db.commit()

    async def record(
        self,
        event_type: str,
        actor: str,
        action: str,
        *,
        outcome: str = "ok",
        actor_type: str = "system",
        agent_id: str | None = None,
        agent_name: str | None = None,
        task_id: str | None = None,
        trace_id: str | None = None,
        channel: str | None = None,
        provider: str | None = None,
        profile_id: str | None = None,
        detail: dict | None = None,
        cost_usd: float | None = None,
        duration_ms: int | None = None,
        timestamp: float | None = None,
    ) -> dict:
        now = timestamp or time.time()
        event_id = _uuid.uuid4().hex
        cursor = await self._db.execute(
            """
            INSERT INTO audit_events (
                event_id, timestamp, event_type, actor, actor_type, agent_id, agent_name,
                task_id, trace_id, channel, provider, profile_id, action, outcome,
                detail, cost_usd, duration_ms, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                now,
                event_type,
                actor,
                actor_type,
                agent_id,
                agent_name,
                task_id,
                trace_id,
                channel,
                provider,
                profile_id,
                action,
                outcome,
                json.dumps(detail or {}),
                cost_usd,
                duration_ms,
                time.time(),
            ),
        )
        await self._db.commit()
        try:
            row_id = cursor.lastrowid
        finally:
            await cursor.close()
        return await self._get_by_id(row_id)

    async def get(self, event_id: str) -> dict | None:
        cursor = await self._db.execute("SELECT * FROM audit_events WHERE event_id = ?", (event_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else None

    async def search(
        self,
        *,
        event_type: str | None = None,
        actor: str | None = None,
        agent_name: str | None = None,
        task_id: str | None = None,
        trace_id: str | None = None,
        channel: str | None = None,
        provider: str | None = None,
        outcome: str | None = None,
        since: float | None = None,
        until: float | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        query = "SELECT * FROM audit_events"
        params: list[object] = []
        clauses: list[str] = []
        for column, value in (
            ("event_type", event_type),
            ("actor", actor),
            ("agent_name", agent_name),
            ("task_id", task_id),
            ("trace_id", trace_id),
            ("channel", channel),
            ("provider", provider),
            ("outcome", outcome),
        ):
            if value:
                clauses.append(f"{column} = ?")
                params.append(value)
        if since is not None:
            clauses.append("timestamp >= ?")
            params.append(since)
        if until is not None:
            clauses.append("timestamp <= ?")
            params.append(until)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?"
        params.extend([max(1, min(limit, 500)), max(0, offset)])
        cursor = await self._db.execute(query, params)
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [self._row_to_dict(row) for row in rows]

    async def count(self, **filters) -> int:
        rows = await self.search(limit=5000, offset=0, **filters)
        return len(rows)

    async def export_json(self, **filters) -> list[dict]:
        return await self.search(limit=min(int(filters.pop("limit", 1000)), 5000), **filters)

    async def export_csv(self, **filters) -> str:
        rows = await self.export_json(**filters)
        buf = io.StringIO()
        writer = csv.DictWriter(
            buf,
            fieldnames=[
                "event_id",
                "timestamp_iso",
                "event_type",
                "actor",
                "actor_type",
                "agent_name",
                "task_id",
                "trace_id",
                "channel",
                "provider",
                "action",
                "outcome",
                "cost_usd",
                "duration_ms",
                "detail_json",
            ],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "event_id": row["event_id"],
                    "timestamp_iso": row["timestamp_iso"],
                    "event_type": row["event_type"],
                    "actor": row["actor"],
                    "actor_type": row["actor_type"],
                    "agent_name": row["agent_name"],
                    "task_id": row["task_id"],
                    "trace_id": row["trace_id"],
                    "channel": row["channel"],
                    "provider": row["provider"],
                    "action": row["action"],
                    "outcome": row["outcome"],
                    "cost_usd": row["cost_usd"],
                    "duration_ms": row["duration_ms"],
                    "detail_json": json.dumps(row["detail"]),
                }
            )
        return buf.getvalue()

    async def stats(self, limit: int = 1000) -> dict:
        rows = await self.search(limit=limit)
        by_event: dict[str, int] = {}
        by_agent: dict[str, int] = {}
        by_outcome: dict[str, int] = {}
        for row in rows:
            by_event[row["event_type"]] = by_event.get(row["event_type"], 0) + 1
            agent_name = row.get("agent_name") or ""
            if agent_name:
                by_agent[agent_name] = by_agent.get(agent_name, 0) + 1
            by_outcome[row["outcome"]] = by_outcome.get(row["outcome"], 0) + 1
        return {"by_event_type": by_event, "by_agent": by_agent, "by_outcome": by_outcome}

    async def apply_retention(self, max_age_days: int) -> int:
        cutoff = time.time() - (max_age_days * 86400)
        cursor = await self._db.execute("DELETE FROM audit_events WHERE timestamp < ?", (cutoff,))
        await self._db.commit()
        try:
            return cursor.rowcount
        finally:
            await cursor.close()

    async def _get_by_id(self, row_id: int) -> dict | None:
        cursor = await self._db.execute("SELECT * FROM audit_events WHERE id = ?", (row_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return self._row_to_dict(row) if row else None

    @staticmethod
    def _row_to_dict(row) -> dict:
        detail = {}
        try:
            detail = json.loads(row["detail"] or "{}")
        except Exception:
            detail = {}
        return {
            "id": row["id"],
            "event_id": row["event_id"],
            "timestamp": row["timestamp"],
            "timestamp_iso": _iso(row["timestamp"]),
            "event_type": row["event_type"],
            "actor": row["actor"],
            "actor_type": row["actor_type"],
            "agent_id": row["agent_id"],
            "agent_name": row["agent_name"],
            "task_id": row["task_id"],
            "trace_id": row["trace_id"],
            "channel": row["channel"],
            "provider": row["provider"],
            "profile_id": row["profile_id"],
            "action": row["action"],
            "outcome": row["outcome"],
            "detail": detail,
            "cost_usd": row["cost_usd"],
            "duration_ms": row["duration_ms"],
            "created_at": row["created_at"],
        }
