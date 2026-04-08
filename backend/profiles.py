from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

import aiosqlite

from agents_md import compute_agents_md_diff, parse_agents_md
from migrations import apply_migrations

DEFAULT_PROFILE_ID = "default"
PROFILE_SCALAR_KEYS = ("model", "thinkingLevel", "responseMode", "failoverModel")
PROFILE_BOOL_KEYS = ("autoApprove",)
SYSTEM_POLICY = {
    "responseMode": "mentioned",
    "thinkingLevel": "",
    "failoverModel": "",
    "model": "",
    "autoApprove": False,
    "forbidden_skills": [],
    "allowed_skills": [],
    "rules": [],
}

PROFILES_SQL = """
CREATE TABLE IF NOT EXISTS profiles (
    profile_id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    base_provider TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_settings (
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (profile_id, key)
);
CREATE TABLE IF NOT EXISTS profile_skills (
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    config TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (profile_id, skill_id)
);
CREATE TABLE IF NOT EXISTS profile_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL,
    content TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_skill_overrides (
    agent_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    action TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (agent_id, skill_id)
);
CREATE TABLE IF NOT EXISTS workspace_settings (
    workspace_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (workspace_id, key)
);
CREATE TABLE IF NOT EXISTS workspace_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'workspace',
    priority INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_agents_md (
    workspace_id TEXT PRIMARY KEY NOT NULL,
    imported_raw TEXT NOT NULL DEFAULT '',
    pending_raw TEXT NOT NULL DEFAULT '',
    pending_diff TEXT NOT NULL DEFAULT '',
    updated_at REAL NOT NULL DEFAULT 0
);
"""


async def _migration_create_profile_tables(db: aiosqlite.Connection) -> None:
    await db.executescript(PROFILES_SQL)


PROFILE_MIGRATIONS = [("20260408_create_profile_tables", _migration_create_profile_tables)]


async def init_profiles_db(db: aiosqlite.Connection) -> None:
    await apply_migrations(db, PROFILE_MIGRATIONS)
    await ensure_default_profile(db)


async def _ensure_profiles_ready(db: aiosqlite.Connection) -> None:
    await init_profiles_db(db)


async def ensure_default_profile(db: aiosqlite.Connection) -> None:
    now = time.time()
    await db.execute(
        """
        INSERT INTO profiles (profile_id, name, description, base_provider, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id) DO NOTHING
        """,
        (DEFAULT_PROFILE_ID, "Default", "Built-in default profile", "", now, now),
    )
    await db.commit()


async def list_profiles(db: aiosqlite.Connection) -> list[dict]:
    await _ensure_profiles_ready(db)
    cursor = await db.execute(
        "SELECT profile_id, name, description, base_provider, created_at, updated_at FROM profiles ORDER BY name"
    )
    try:
        rows = await cursor.fetchall()
    finally:
        await cursor.close()
    return [dict(row) for row in rows]


async def create_profile(db: aiosqlite.Connection, name: str, description: str = "", base_provider: str = "") -> dict:
    await _ensure_profiles_ready(db)
    profile_id = uuid.uuid4().hex
    now = time.time()
    await db.execute(
        """
        INSERT INTO profiles (profile_id, name, description, base_provider, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (profile_id, name, description, base_provider, now, now),
    )
    await db.commit()
    return await get_profile(db, profile_id)


async def get_profile(db: aiosqlite.Connection, profile_id: str) -> dict:
    await _ensure_profiles_ready(db)
    cursor = await db.execute(
        "SELECT profile_id, name, description, base_provider, created_at, updated_at FROM profiles WHERE profile_id = ?",
        (profile_id,),
    )
    try:
        row = await cursor.fetchone()
    finally:
        await cursor.close()
    if row is None:
        raise KeyError(profile_id)
    settings = await get_profile_settings(db, profile_id)
    skills = await get_profile_skills(db, profile_id)
    rules = await get_profile_rules(db, profile_id)
    result = dict(row)
    result["settings"] = settings
    result["skills"] = skills
    result["rules"] = rules
    return result


async def update_profile(db: aiosqlite.Connection, profile_id: str, body: dict) -> dict:
    await _ensure_profiles_ready(db)
    existing = await get_profile(db, profile_id)
    await db.execute(
        """
        UPDATE profiles
        SET name = ?, description = ?, base_provider = ?, updated_at = ?
        WHERE profile_id = ?
        """,
        (
            body.get("name", existing["name"]),
            body.get("description", existing["description"]),
            body.get("base_provider", existing["base_provider"]),
            time.time(),
            profile_id,
        ),
    )
    await db.commit()
    return await get_profile(db, profile_id)


async def delete_profile(db: aiosqlite.Connection, profile_id: str) -> bool:
    await _ensure_profiles_ready(db)
    if profile_id == DEFAULT_PROFILE_ID:
        raise ValueError("default profile cannot be deleted")
    cursor = await db.execute("SELECT COUNT(*) AS count FROM agents WHERE profile_id = ?", (profile_id,))
    try:
        row = await cursor.fetchone()
    finally:
        await cursor.close()
    if row and int(row["count"]) > 0:
        raise ValueError("profile is still assigned to one or more agents")
    await db.execute("DELETE FROM profiles WHERE profile_id = ?", (profile_id,))
    await db.execute("DELETE FROM profile_settings WHERE profile_id = ?", (profile_id,))
    await db.execute("DELETE FROM profile_skills WHERE profile_id = ?", (profile_id,))
    await db.execute("DELETE FROM profile_rules WHERE profile_id = ?", (profile_id,))
    await db.commit()
    return True


async def get_profile_settings(db: aiosqlite.Connection, profile_id: str) -> dict[str, Any]:
    await _ensure_profiles_ready(db)
    cursor = await db.execute("SELECT key, value FROM profile_settings WHERE profile_id = ?", (profile_id,))
    try:
        rows = await cursor.fetchall()
    finally:
        await cursor.close()
    result: dict[str, Any] = {}
    for row in rows:
        result[row["key"]] = json.loads(row["value"])
    return result


async def set_profile_settings(db: aiosqlite.Connection, profile_id: str, settings: dict[str, Any]) -> dict[str, Any]:
    await _ensure_profiles_ready(db)
    for key, value in settings.items():
        await db.execute(
            """
            INSERT INTO profile_settings (profile_id, key, value)
            VALUES (?, ?, ?)
            ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value
            """,
            (profile_id, key, json.dumps(value)),
        )
    await db.execute("UPDATE profiles SET updated_at = ? WHERE profile_id = ?", (time.time(), profile_id))
    await db.commit()
    return await get_profile_settings(db, profile_id)


async def get_profile_skills(db: aiosqlite.Connection, profile_id: str) -> list[dict]:
    await _ensure_profiles_ready(db)
    cursor = await db.execute(
        "SELECT skill_id, enabled, config FROM profile_skills WHERE profile_id = ? ORDER BY skill_id",
        (profile_id,),
    )
    try:
        rows = await cursor.fetchall()
    finally:
        await cursor.close()
    return [
        {"skill_id": row["skill_id"], "enabled": bool(row["enabled"]), "config": json.loads(row["config"] or "{}")}
        for row in rows
    ]


async def set_profile_skills(
    db: aiosqlite.Connection,
    profile_id: str,
    skill_ids: list[str],
    builtin_skills: list[dict],
) -> list[dict]:
    await _ensure_profiles_ready(db)
    builtin_ids = [skill["id"] for skill in builtin_skills]
    desired = set(skill_ids or builtin_ids)
    await db.execute("DELETE FROM profile_skills WHERE profile_id = ?", (profile_id,))
    for skill_id in sorted(desired):
        await db.execute(
            "INSERT INTO profile_skills (profile_id, skill_id, enabled, config) VALUES (?, ?, 1, '{}')",
            (profile_id, skill_id),
        )
    await db.commit()
    return await get_profile_skills(db, profile_id)


async def toggle_profile_skill(db: aiosqlite.Connection, profile_id: str, skill_id: str, enabled: bool) -> None:
    await _ensure_profiles_ready(db)
    if enabled:
        await db.execute(
            """
            INSERT INTO profile_skills (profile_id, skill_id, enabled, config)
            VALUES (?, ?, 1, '{}')
            ON CONFLICT(profile_id, skill_id) DO UPDATE SET enabled = 1
            """,
            (profile_id, skill_id),
        )
    else:
        await db.execute("DELETE FROM profile_skills WHERE profile_id = ? AND skill_id = ?", (profile_id, skill_id))
    await db.commit()


async def get_profile_rules(db: aiosqlite.Connection, profile_id: str) -> list[dict]:
    await _ensure_profiles_ready(db)
    cursor = await db.execute(
        "SELECT id, rule_type, content, priority, created_at FROM profile_rules WHERE profile_id = ? ORDER BY priority, id",
        (profile_id,),
    )
    try:
        rows = await cursor.fetchall()
    finally:
        await cursor.close()
    return [dict(row) for row in rows]


async def add_profile_rule(db: aiosqlite.Connection, profile_id: str, content: str, rule_type: str = "custom", priority: int = 0) -> dict:
    await _ensure_profiles_ready(db)
    now = time.time()
    cursor = await db.execute(
        "INSERT INTO profile_rules (profile_id, rule_type, content, priority, created_at) VALUES (?, ?, ?, ?, ?)",
        (profile_id, rule_type, content, priority, now),
    )
    await db.commit()
    rule_id = cursor.lastrowid
    await cursor.close()
    cursor = await db.execute(
        "SELECT id, rule_type, content, priority, created_at FROM profile_rules WHERE id = ?",
        (rule_id,),
    )
    try:
        row = await cursor.fetchone()
    finally:
        await cursor.close()
    return dict(row)


async def delete_profile_rule(db: aiosqlite.Connection, profile_id: str, rule_id: int) -> bool:
    await _ensure_profiles_ready(db)
    await db.execute("DELETE FROM profile_rules WHERE profile_id = ? AND id = ?", (profile_id, rule_id))
    await db.commit()
    return True


async def get_workspace_policy(db: aiosqlite.Connection, workspace_id: str) -> dict[str, Any]:
    await _ensure_profiles_ready(db)
    settings_cursor = await db.execute(
        "SELECT key, value FROM workspace_settings WHERE workspace_id = ?",
        (workspace_id,),
    )
    try:
        setting_rows = await settings_cursor.fetchall()
    finally:
        await settings_cursor.close()
    rules_cursor = await db.execute(
        "SELECT id, content, source, priority, created_at FROM workspace_rules WHERE workspace_id = ? ORDER BY priority, id",
        (workspace_id,),
    )
    try:
        rule_rows = await rules_cursor.fetchall()
    finally:
        await rules_cursor.close()
    meta_cursor = await db.execute(
        "SELECT imported_raw, pending_raw, pending_diff, updated_at FROM workspace_agents_md WHERE workspace_id = ?",
        (workspace_id,),
    )
    try:
        meta_row = await meta_cursor.fetchone()
    finally:
        await meta_cursor.close()
    settings = {row["key"]: json.loads(row["value"]) for row in setting_rows}
    rules = [dict(row) for row in rule_rows]
    agents_md = dict(meta_row) if meta_row else {"imported_raw": "", "pending_raw": "", "pending_diff": "", "updated_at": 0}
    agents_md["has_pending"] = bool(agents_md.get("pending_diff"))
    return {"workspace_id": workspace_id, "settings": settings, "rules": rules, "agents_md": agents_md}


async def scan_agents_md(db: aiosqlite.Connection, workspace_id: str) -> dict[str, Any]:
    await _ensure_profiles_ready(db)
    parsed = parse_agents_md(Path(workspace_id))
    policy = await get_workspace_policy(db, workspace_id)
    imported_raw = policy["agents_md"].get("imported_raw", "")
    pending_diff = compute_agents_md_diff(imported_raw, parsed["raw"])
    await db.execute(
        """
        INSERT INTO workspace_agents_md (workspace_id, imported_raw, pending_raw, pending_diff, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
            pending_raw = excluded.pending_raw,
            pending_diff = excluded.pending_diff,
            updated_at = excluded.updated_at
        """,
        (workspace_id, imported_raw, parsed["raw"], pending_diff, time.time()),
    )
    await db.commit()
    return {"workspace_id": workspace_id, "parsed": parsed, "pending_diff": pending_diff, "has_pending": bool(pending_diff)}


async def import_agents_md(db: aiosqlite.Connection, workspace_id: str) -> dict[str, Any]:
    await _ensure_profiles_ready(db)
    scanned = await scan_agents_md(db, workspace_id)
    parsed = scanned["parsed"]
    await db.execute("DELETE FROM workspace_rules WHERE workspace_id = ? AND source = 'agents_md'", (workspace_id,))
    for rule in parsed["workspace_rules"]:
        await db.execute(
            "INSERT INTO workspace_rules (workspace_id, content, source, priority, created_at) VALUES (?, ?, 'agents_md', 0, ?)",
            (workspace_id, rule, time.time()),
        )
    await db.execute(
        """
        INSERT INTO workspace_agents_md (workspace_id, imported_raw, pending_raw, pending_diff, updated_at)
        VALUES (?, ?, '', '', ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
            imported_raw = excluded.imported_raw,
            pending_raw = '',
            pending_diff = '',
            updated_at = excluded.updated_at
        """,
        (workspace_id, parsed["raw"], time.time()),
    )
    await db.commit()
    return await get_workspace_policy(db, workspace_id)


async def ignore_agents_md(db: aiosqlite.Connection, workspace_id: str) -> dict[str, Any]:
    await _ensure_profiles_ready(db)
    await db.execute(
        """
        INSERT INTO workspace_agents_md (workspace_id, imported_raw, pending_raw, pending_diff, updated_at)
        VALUES (?, '', '', '', ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
            pending_raw = '',
            pending_diff = '',
            updated_at = excluded.updated_at
        """,
        (workspace_id, time.time()),
    )
    await db.commit()
    return await get_workspace_policy(db, workspace_id)


async def compute_effective_state(
    db: aiosqlite.Connection,
    *,
    agent_row: dict[str, Any],
    workspace_id: str,
    profile_settings: dict[str, Any],
    profile_skills: list[str],
    workspace_policy: dict[str, Any],
    agent_skill_additions: list[str],
    agent_skill_removals: list[str],
) -> dict[str, Any]:
    await _ensure_profiles_ready(db)
    effective: dict[str, Any] = {"sources": {}, "rules": []}
    workspace_settings = workspace_policy.get("settings", {})
    system_settings = dict(SYSTEM_POLICY)

    for key in PROFILE_SCALAR_KEYS:
        if agent_row.get(key):
            effective[key] = agent_row[key]
            effective["sources"][key] = "agent"
        elif profile_settings.get(key):
            effective[key] = profile_settings[key]
            effective["sources"][key] = "profile"
        elif workspace_settings.get(key):
            effective[key] = workspace_settings[key]
            effective["sources"][key] = "workspace"
        else:
            effective[key] = system_settings.get(key, "")
            effective["sources"][key] = "system"

    for key in PROFILE_BOOL_KEYS:
        if key in agent_row and agent_row[key] is not None:
            effective[key] = bool(agent_row[key])
            effective["sources"][key] = "agent"
        elif key in profile_settings:
            effective[key] = bool(profile_settings[key])
            effective["sources"][key] = "profile"
        elif key in workspace_settings:
            effective[key] = bool(workspace_settings[key])
            effective["sources"][key] = "workspace"
        else:
            effective[key] = bool(system_settings.get(key, False))
            effective["sources"][key] = "system"

    forbidden = set(system_settings.get("forbidden_skills", []))
    allowed = set(workspace_settings.get("allowed_skills", [])) or None
    enabled = (set(profile_skills) | set(agent_skill_additions)) - set(agent_skill_removals)
    if allowed is not None:
        enabled &= allowed
    enabled -= forbidden
    effective["enabled_skills"] = sorted(enabled)
    effective["sources"]["enabled_skills"] = {
        "profile": sorted(profile_skills),
        "agent_additions": sorted(agent_skill_additions),
        "agent_removals": sorted(agent_skill_removals),
        "workspace_allowed": sorted(allowed) if allowed is not None else [],
        "system_forbidden": sorted(forbidden),
    }

    effective_rules: list[dict[str, Any]] = []
    for rule in system_settings.get("rules", []):
        effective_rules.append({"content": rule, "source": "system"})
    for rule in workspace_policy.get("rules", []):
        effective_rules.append({"content": rule["content"], "source": "workspace"})
    for rule in await get_profile_rules(db, agent_row["profile_id"]):
        effective_rules.append({"content": rule["content"], "source": "profile"})
    for rule in agent_row.get("rules", []):
        effective_rules.append({"content": rule, "source": "agent"})
    effective["rules"] = effective_rules
    effective["sources"]["rules"] = [rule["source"] for rule in effective_rules]
    effective["profile_id"] = agent_row["profile_id"]
    return effective
