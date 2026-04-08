"""Shared SQLite migration runner for GhostLink runtime databases."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable, Sequence

import aiosqlite

MigrationFn = Callable[[aiosqlite.Connection], Awaitable[None]]
Migration = tuple[str, MigrationFn]

_MIGRATION_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY NOT NULL,
    applied_at REAL NOT NULL
);
"""


async def ensure_migration_table(db: aiosqlite.Connection) -> None:
    await db.execute(_MIGRATION_TABLE_SQL)
    await db.commit()


async def get_applied_migrations(db: aiosqlite.Connection) -> set[str]:
    await ensure_migration_table(db)
    cursor = await db.execute("SELECT name FROM schema_migrations")
    try:
        rows = await cursor.fetchall()
    finally:
        await cursor.close()
    return {str(row[0]) for row in rows}


async def apply_migrations(
    db: aiosqlite.Connection,
    migrations: Sequence[Migration],
) -> list[str]:
    applied = await get_applied_migrations(db)
    newly_applied: list[str] = []
    for name, migration in migrations:
        if name in applied:
            continue
        try:
            await db.execute("BEGIN")
            await migration(db)
            await db.execute(
                "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
                (name, time.time()),
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise
        applied.add(name)
        newly_applied.append(name)
    return newly_applied
