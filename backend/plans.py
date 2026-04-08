from __future__ import annotations

import json
import time
import uuid
from typing import Any

import aiosqlite

from migrations import apply_migrations

PLANS_SQL = """
CREATE TABLE IF NOT EXISTS agent_plans (
    plan_id              TEXT PRIMARY KEY NOT NULL,
    agent_name           TEXT NOT NULL DEFAULT '',
    channel              TEXT NOT NULL DEFAULT 'general',
    prompt               TEXT NOT NULL DEFAULT '',
    status               TEXT NOT NULL DEFAULT 'pending_approval',
    steps                TEXT NOT NULL DEFAULT '[]',
    files                TEXT NOT NULL DEFAULT '[]',
    estimated_tokens     INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd   REAL NOT NULL DEFAULT 0,
    estimated_seconds    INTEGER NOT NULL DEFAULT 0,
    cost_threshold_usd   REAL NOT NULL DEFAULT 0,
    metadata             TEXT NOT NULL DEFAULT '{}',
    decision_note        TEXT NOT NULL DEFAULT '',
    created_at           REAL NOT NULL,
    decided_at           REAL DEFAULT NULL,
    updated_at           REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_plans_channel ON agent_plans(channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_plans_agent ON agent_plans(agent_name, created_at DESC);
"""


async def _migration_create_agent_plans(db: aiosqlite.Connection) -> None:
    await db.executescript(PLANS_SQL)


PLAN_MIGRATIONS = [("20260408_create_agent_plans", _migration_create_agent_plans)]


async def init_plans_db(db: aiosqlite.Connection) -> None:
    await apply_migrations(db, PLAN_MIGRATIONS)


def _json_text(value: Any, fallback: str) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value)
    except Exception:
        return fallback


def build_plan(prompt: str, files: list[str] | None = None) -> dict[str, Any]:
    prompt = str(prompt or "").strip()
    file_list = [str(item).strip() for item in (files or []) if str(item).strip()]
    words = len(prompt.split())
    steps = [
        "Review the request and identify the target outcome",
        f"Inspect the affected files: {', '.join(file_list[:5])}" if file_list else "Identify the affected files and relevant runtime surfaces",
        "Implement the required changes",
        "Run validation and check for regressions",
        "Summarize the outcome and any remaining risks",
    ]
    estimated_tokens = max(350, min(12000, 400 + words * 35 + len(file_list) * 180))
    estimated_seconds = max(45, min(3600, 60 + words * 2 + len(file_list) * 45))
    estimated_cost_usd = round(estimated_tokens / 1000 * 0.003, 4)
    return {
        "steps": steps,
        "files": file_list,
        "estimated_tokens": estimated_tokens,
        "estimated_seconds": estimated_seconds,
        "estimated_cost_usd": estimated_cost_usd,
    }


async def create_plan(
    db: aiosqlite.Connection,
    *,
    agent_name: str,
    channel: str,
    prompt: str,
    files: list[str] | None = None,
    cost_threshold_usd: float = 0.0,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    await init_plans_db(db)
    plan = build_plan(prompt, files)
    now = time.time()
    plan_id = uuid.uuid4().hex
    await db.execute(
        """
        INSERT INTO agent_plans (
            plan_id, agent_name, channel, prompt, status, steps, files,
            estimated_tokens, estimated_cost_usd, estimated_seconds,
            cost_threshold_usd, metadata, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            plan_id,
            agent_name,
            channel,
            prompt,
            _json_text(plan["steps"], "[]"),
            _json_text(plan["files"], "[]"),
            int(plan["estimated_tokens"]),
            float(plan["estimated_cost_usd"]),
            int(plan["estimated_seconds"]),
            float(cost_threshold_usd or 0.0),
            _json_text(metadata or {}, "{}"),
            now,
            now,
        ),
    )
    await db.commit()
    return await get_plan(db, plan_id)


async def get_plan(db: aiosqlite.Connection, plan_id: str) -> dict[str, Any]:
    await init_plans_db(db)
    cursor = await db.execute("SELECT * FROM agent_plans WHERE plan_id = ? LIMIT 1", (plan_id,))
    try:
        row = await cursor.fetchone()
    finally:
        await cursor.close()
    if not row:
        raise KeyError(plan_id)
    return _row_to_dict(row)


async def list_plans(
    db: aiosqlite.Connection,
    *,
    channel: str = "",
    agent_name: str = "",
    status: str = "",
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    await init_plans_db(db)
    clauses: list[str] = []
    params: list[Any] = []
    if channel:
        clauses.append("channel = ?")
        params.append(channel)
    if agent_name:
        clauses.append("agent_name = ?")
        params.append(agent_name)
    if status:
        clauses.append("status = ?")
        params.append(status)
    query = "SELECT * FROM agent_plans"
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([max(1, min(limit, 500)), max(0, offset)])
    cursor = await db.execute(query, params)
    try:
        rows = await cursor.fetchall()
    finally:
        await cursor.close()
    return [_row_to_dict(row) for row in rows]


async def update_plan_status(db: aiosqlite.Connection, plan_id: str, status: str, note: str = "") -> dict[str, Any]:
    await init_plans_db(db)
    now = time.time()
    await db.execute(
        """
        UPDATE agent_plans
        SET status = ?, decision_note = ?, decided_at = ?, updated_at = ?
        WHERE plan_id = ?
        """,
        (status, str(note or ""), now, now, plan_id),
    )
    await db.commit()
    return await get_plan(db, plan_id)


def _row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "plan_id": row["plan_id"],
        "agent_name": row["agent_name"],
        "channel": row["channel"],
        "prompt": row["prompt"],
        "status": row["status"],
        "steps": json.loads(row["steps"] or "[]"),
        "files": json.loads(row["files"] or "[]"),
        "estimated_tokens": row["estimated_tokens"],
        "estimated_cost_usd": row["estimated_cost_usd"],
        "estimated_seconds": row["estimated_seconds"],
        "cost_threshold_usd": row["cost_threshold_usd"],
        "metadata": json.loads(row["metadata"] or "{}"),
        "decision_note": row["decision_note"],
        "created_at": row["created_at"],
        "decided_at": row["decided_at"],
        "updated_at": row["updated_at"],
    }
