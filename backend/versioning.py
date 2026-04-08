from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

import aiosqlite

from migrations import apply_migrations
from providers import PROVIDERS
from profiles import (
    add_profile_rule,
    delete_profile_rule,
    get_profile,
    get_profile_settings,
    get_profile_skills,
    get_profile_rules,
    set_profile_settings,
    set_profile_skills,
    update_profile,
)

VERSIONING_SQL = """
CREATE TABLE IF NOT EXISTS asset_versions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_type          TEXT NOT NULL,
    asset_id            TEXT NOT NULL,
    version             TEXT NOT NULL,
    channel             TEXT NOT NULL DEFAULT 'private',
    distribution_scope  TEXT NOT NULL DEFAULT 'workspace',
    distribution_target TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'active',
    changelog           TEXT NOT NULL DEFAULT '',
    compatibility       TEXT NOT NULL DEFAULT '{}',
    dependencies        TEXT NOT NULL DEFAULT '[]',
    payload             TEXT NOT NULL DEFAULT '{}',
    created_by          TEXT NOT NULL DEFAULT '',
    created_at          REAL NOT NULL,
    updated_at          REAL NOT NULL,
    deprecated_at       REAL DEFAULT NULL,
    deprecation_message TEXT NOT NULL DEFAULT '',
    replacement_version TEXT NOT NULL DEFAULT '',
    rollback_from       TEXT NOT NULL DEFAULT '',
    UNIQUE(asset_type, asset_id, version)
);
CREATE INDEX IF NOT EXISTS idx_asset_versions_asset ON asset_versions(asset_type, asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_versions_channel ON asset_versions(asset_type, channel);

CREATE TABLE IF NOT EXISTS asset_version_health (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_type  TEXT NOT NULL,
    asset_id    TEXT NOT NULL,
    version     TEXT NOT NULL,
    event_type  TEXT NOT NULL DEFAULT 'run',
    ok          INTEGER NOT NULL DEFAULT 1,
    cost_usd    REAL NOT NULL DEFAULT 0,
    eval_score  REAL DEFAULT NULL,
    metadata    TEXT NOT NULL DEFAULT '{}',
    created_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_asset_health_asset ON asset_version_health(asset_type, asset_id, version, created_at DESC);
"""

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
ROLLOUT_CHANNELS = {"private", "beta", "stable"}
DISTRIBUTION_SCOPES = {"workspace", "org"}
PLATFORM_CAPABILITIES = {
    "profiles",
    "skills",
    "versioning",
    "distribution",
    "rollout_channels",
    "rollback",
    "deprecation",
    "telemetry",
}


async def _migration_create_asset_versions(db: aiosqlite.Connection) -> None:
    await db.executescript(VERSIONING_SQL)


VERSIONING_MIGRATIONS = [("20260408_create_asset_versions", _migration_create_asset_versions)]


async def init_versioning_db(db: aiosqlite.Connection) -> None:
    await apply_migrations(db, VERSIONING_MIGRATIONS)


def _json_text(value: Any, fallback: str) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value)
    except Exception:
        return fallback


def _version_tuple(value: str) -> tuple[int, int, int]:
    core = value.split("+", 1)[0].split("-", 1)[0]
    major, minor, patch = core.split(".", 2)
    return (int(major), int(minor), int(patch))


def _platform_version() -> str:
    try:
        from app import __version__

        return str(__version__)
    except Exception:
        return "0.0.0"


def validate_version_string(version: str) -> str:
    version = str(version or "").strip()
    if not SEMVER_RE.match(version):
        raise ValueError("version must be semver-like (example: 1.2.3)")
    return version


def validate_compatibility(metadata: dict[str, Any] | None) -> dict[str, Any]:
    metadata = dict(metadata or {})
    min_platform = str(metadata.get("min_platform_version") or "").strip()
    if min_platform:
        validate_version_string(min_platform)
        if _version_tuple(min_platform) > _version_tuple(_platform_version()):
            raise ValueError("minimum platform version is not supported by this GhostLink runtime")
    required_capabilities = [str(item).strip() for item in metadata.get("required_capabilities", []) if str(item).strip()]
    missing_capabilities = sorted(set(required_capabilities) - PLATFORM_CAPABILITIES)
    if missing_capabilities:
        raise ValueError(f"unsupported required capabilities: {', '.join(missing_capabilities)}")
    provider_requirements = [str(item).strip() for item in metadata.get("provider_requirements", []) if str(item).strip()]
    unknown_providers = sorted(set(provider_requirements) - set(PROVIDERS))
    if unknown_providers:
        raise ValueError(f"unknown provider requirements: {', '.join(unknown_providers)}")
    metadata["required_capabilities"] = required_capabilities
    metadata["provider_requirements"] = provider_requirements
    return metadata


async def list_asset_versions(db: aiosqlite.Connection, asset_type: str, asset_id: str) -> list[dict[str, Any]]:
    await init_versioning_db(db)
    cursor = await db.execute(
        """
        SELECT * FROM asset_versions
        WHERE asset_type = ? AND asset_id = ?
        ORDER BY created_at DESC, id DESC
        """,
        (asset_type, asset_id),
    )
    try:
        rows = await cursor.fetchall()
    finally:
        await cursor.close()
    return [_row_to_dict(row) for row in rows]


async def get_asset_version(db: aiosqlite.Connection, asset_type: str, asset_id: str, version: str) -> dict[str, Any]:
    await init_versioning_db(db)
    cursor = await db.execute(
        """
        SELECT * FROM asset_versions
        WHERE asset_type = ? AND asset_id = ? AND version = ?
        LIMIT 1
        """,
        (asset_type, asset_id, version),
    )
    try:
        row = await cursor.fetchone()
    finally:
        await cursor.close()
    if not row:
        raise KeyError(version)
    return _row_to_dict(row)


async def publish_asset_version(
    db: aiosqlite.Connection,
    *,
    asset_type: str,
    asset_id: str,
    version: str,
    payload: dict[str, Any],
    changelog: str = "",
    compatibility: dict[str, Any] | None = None,
    dependencies: list[dict[str, Any]] | None = None,
    channel: str = "private",
    distribution_scope: str = "workspace",
    distribution_target: str = "",
    created_by: str = "",
) -> dict[str, Any]:
    await init_versioning_db(db)
    version = validate_version_string(version)
    channel = str(channel or "private").strip().lower()
    if channel not in ROLLOUT_CHANNELS:
        raise ValueError("invalid rollout channel")
    distribution_scope = str(distribution_scope or "workspace").strip().lower()
    if distribution_scope not in DISTRIBUTION_SCOPES:
        raise ValueError("invalid distribution scope")
    compatibility = validate_compatibility(compatibility)
    dependencies = list(dependencies or [])
    now = time.time()
    await db.execute(
        """
        INSERT INTO asset_versions (
            asset_type, asset_id, version, channel, distribution_scope, distribution_target,
            status, changelog, compatibility, dependencies, payload, created_by, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_type, asset_id, version) DO UPDATE SET
            channel = excluded.channel,
            distribution_scope = excluded.distribution_scope,
            distribution_target = excluded.distribution_target,
            changelog = excluded.changelog,
            compatibility = excluded.compatibility,
            dependencies = excluded.dependencies,
            payload = excluded.payload,
            created_by = excluded.created_by,
            updated_at = excluded.updated_at
        """,
        (
            asset_type,
            asset_id,
            version,
            channel,
            distribution_scope,
            distribution_target,
            str(changelog or ""),
            _json_text(compatibility, "{}"),
            _json_text(dependencies, "[]"),
            _json_text(payload, "{}"),
            str(created_by or ""),
            now,
            now,
        ),
    )
    await db.commit()
    return await get_asset_version(db, asset_type, asset_id, version)


async def promote_asset_version(
    db: aiosqlite.Connection,
    *,
    asset_type: str,
    asset_id: str,
    version: str,
    channel: str,
) -> dict[str, Any]:
    await init_versioning_db(db)
    channel = str(channel or "").strip().lower()
    if channel not in ROLLOUT_CHANNELS:
        raise ValueError("invalid rollout channel")
    now = time.time()
    await db.execute(
        """
        UPDATE asset_versions
        SET channel = ?, updated_at = ?
        WHERE asset_type = ? AND asset_id = ? AND version = ?
        """,
        (channel, now, asset_type, asset_id, version),
    )
    await db.commit()
    return await get_asset_version(db, asset_type, asset_id, version)


async def deprecate_asset_version(
    db: aiosqlite.Connection,
    *,
    asset_type: str,
    asset_id: str,
    version: str,
    message: str,
    replacement_version: str = "",
) -> dict[str, Any]:
    await init_versioning_db(db)
    now = time.time()
    await db.execute(
        """
        UPDATE asset_versions
        SET status = 'deprecated',
            deprecated_at = ?,
            deprecation_message = ?,
            replacement_version = ?,
            updated_at = ?
        WHERE asset_type = ? AND asset_id = ? AND version = ?
        """,
        (now, str(message or ""), str(replacement_version or ""), now, asset_type, asset_id, version),
    )
    await db.commit()
    return await get_asset_version(db, asset_type, asset_id, version)


async def rollback_profile_version(db: aiosqlite.Connection, profile_id: str, version: str) -> dict[str, Any]:
    record = await get_asset_version(db, "profile", profile_id, version)
    payload = dict(record.get("payload") or {})
    await update_profile(
        db,
        profile_id,
        {
            "name": payload.get("name", ""),
            "description": payload.get("description", ""),
            "base_provider": payload.get("base_provider", ""),
        },
    )
    await set_profile_settings(db, profile_id, dict(payload.get("settings") or {}))
    skill_entries = payload.get("skills") if isinstance(payload.get("skills"), list) else []
    skill_ids = [str(item.get("skill_id") or "").strip() for item in skill_entries if item.get("enabled")]
    await set_profile_skills(db, profile_id, skill_ids, list(payload.get("builtin_skills") or []))
    current_rules = await get_profile_rules(db, profile_id)
    for rule in current_rules:
        await delete_profile_rule(db, profile_id, int(rule["id"]))
    for rule in payload.get("rules", []) if isinstance(payload.get("rules"), list) else []:
        await add_profile_rule(
            db,
            profile_id,
            str(rule.get("content") or ""),
            str(rule.get("rule_type") or "custom"),
            int(rule.get("priority") or 0),
        )
    await db.execute(
        """
        UPDATE asset_versions
        SET rollback_from = ?, updated_at = ?
        WHERE asset_type = 'profile' AND asset_id = ? AND version = ?
        """,
        (profile_id, time.time(), profile_id, version),
    )
    await db.commit()
    return await get_profile(db, profile_id)


async def rollback_skill_version(data_dir: Path, db: aiosqlite.Connection, skill_id: str, version: str) -> dict[str, Any]:
    record = await get_asset_version(db, "skill", skill_id, version)
    payload = dict(record.get("payload") or {})
    skills_dir = Path(data_dir) / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)
    payload["id"] = skill_id
    (skills_dir / f"{skill_id}.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    await db.execute(
        """
        UPDATE asset_versions
        SET rollback_from = ?, updated_at = ?
        WHERE asset_type = 'skill' AND asset_id = ? AND version = ?
        """,
        (skill_id, time.time(), skill_id, version),
    )
    await db.commit()
    return payload


async def record_asset_health_event(
    db: aiosqlite.Connection,
    *,
    asset_type: str,
    asset_id: str,
    version: str,
    event_type: str = "run",
    ok: bool = True,
    cost_usd: float = 0.0,
    eval_score: float | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    await init_versioning_db(db)
    await db.execute(
        """
        INSERT INTO asset_version_health (
            asset_type, asset_id, version, event_type, ok, cost_usd, eval_score, metadata, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            asset_type,
            asset_id,
            version,
            str(event_type or "run"),
            1 if ok else 0,
            float(cost_usd or 0.0),
            eval_score,
            _json_text(metadata or {}, "{}"),
            time.time(),
        ),
    )
    await db.commit()


async def get_asset_health(db: aiosqlite.Connection, asset_type: str, asset_id: str, version: str) -> dict[str, Any]:
    await init_versioning_db(db)
    cursor = await db.execute(
        """
        SELECT ok, cost_usd, eval_score
        FROM asset_version_health
        WHERE asset_type = ? AND asset_id = ? AND version = ?
        ORDER BY created_at DESC
        """,
        (asset_type, asset_id, version),
    )
    try:
        rows = await cursor.fetchall()
    finally:
        await cursor.close()
    if not rows:
        return {"error_rate": 0.0, "cost_usd": 0.0, "eval_score": None, "sample_count": 0}
    sample_count = len(rows)
    error_count = sum(1 for row in rows if not bool(row["ok"]))
    total_cost = sum(float(row["cost_usd"] or 0.0) for row in rows)
    eval_values = [float(row["eval_score"]) for row in rows if row["eval_score"] is not None]
    return {
        "error_rate": round(error_count / sample_count, 4),
        "cost_usd": round(total_cost, 4),
        "eval_score": round(sum(eval_values) / len(eval_values), 4) if eval_values else None,
        "sample_count": sample_count,
    }


async def snapshot_profile(db: aiosqlite.Connection, profile_id: str, builtin_skills: list[dict[str, Any]]) -> dict[str, Any]:
    profile = await get_profile(db, profile_id)
    return {
        "profile_id": profile["profile_id"],
        "name": profile["name"],
        "description": profile["description"],
        "base_provider": profile.get("base_provider", ""),
        "settings": await get_profile_settings(db, profile_id),
        "skills": await get_profile_skills(db, profile_id),
        "rules": await get_profile_rules(db, profile_id),
        "builtin_skills": builtin_skills,
    }


def snapshot_skill(skill: dict[str, Any]) -> dict[str, Any]:
    return dict(skill or {})


def _row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "asset_type": row["asset_type"],
        "asset_id": row["asset_id"],
        "version": row["version"],
        "channel": row["channel"],
        "distribution_scope": row["distribution_scope"],
        "distribution_target": row["distribution_target"],
        "status": row["status"],
        "changelog": row["changelog"],
        "compatibility": json.loads(row["compatibility"] or "{}"),
        "dependencies": json.loads(row["dependencies"] or "[]"),
        "payload": json.loads(row["payload"] or "{}"),
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "deprecated_at": row["deprecated_at"],
        "deprecation_message": row["deprecation_message"],
        "replacement_version": row["replacement_version"],
        "rollback_from": row["rollback_from"],
    }
