"""Agent registry — tracks connected agent instances and persisted identity rows."""

from __future__ import annotations

import secrets
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field

import aiosqlite

from migrations import apply_migrations

TOKEN_TTL = 3600  # 1 hour default

AGENTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS agents (
    agent_id         TEXT PRIMARY KEY NOT NULL,
    name             TEXT NOT NULL,
    base             TEXT NOT NULL,
    label            TEXT NOT NULL DEFAULT '',
    color            TEXT NOT NULL DEFAULT '#d2bbff',
    slot             INTEGER NOT NULL DEFAULT 1,
    state            TEXT NOT NULL DEFAULT 'offline',
    token            TEXT NOT NULL,
    token_issued_at  REAL NOT NULL,
    token_ttl        REAL NOT NULL DEFAULT 3600.0,
    registered_at    REAL NOT NULL,
    created_at       REAL NOT NULL,
    role             TEXT NOT NULL DEFAULT '',
    profile_id       TEXT NOT NULL DEFAULT 'default',
    workspace        TEXT NOT NULL DEFAULT '',
    response_mode    TEXT NOT NULL DEFAULT 'mentioned',
    thinking_level   TEXT NOT NULL DEFAULT '',
    model            TEXT NOT NULL DEFAULT '',
    failover_model   TEXT NOT NULL DEFAULT '',
    auto_approve     INTEGER NOT NULL DEFAULT 0,
    runner           TEXT NOT NULL DEFAULT 'tmux'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_live_name ON agents(name, state);
CREATE INDEX IF NOT EXISTS idx_agents_base ON agents(base);
CREATE INDEX IF NOT EXISTS idx_agents_slot ON agents(base, slot);
CREATE INDEX IF NOT EXISTS idx_agents_state ON agents(state);
"""


async def _migration_create_agents_table(db: aiosqlite.Connection) -> None:
    await db.executescript(AGENTS_TABLE_SQL)


async def _migration_add_profile_id(db: aiosqlite.Connection) -> None:
    cursor = await db.execute("PRAGMA table_info(agents)")
    try:
        rows = await cursor.fetchall()
    finally:
        await cursor.close()
    columns = {row[1] if not isinstance(row, aiosqlite.Row) else row["name"] for row in rows}
    if "profile_id" not in columns:
        await db.execute("ALTER TABLE agents ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'default'")


REGISTRY_MIGRATIONS = [
    ("20260408_create_agents_table", _migration_create_agents_table),
    ("20260408_add_agents_profile_id", _migration_add_profile_id),
]


@dataclass
class AgentInstance:
    agent_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    name: str = ""
    base: str = ""
    label: str = ""
    color: str = ""
    slot: int = 1
    state: str = "pending"
    token: str = field(default_factory=lambda: secrets.token_hex(16))
    registered_at: float = field(default_factory=time.time)
    created_at: float = field(default_factory=time.time)
    token_issued_at: float = field(default_factory=time.time)
    token_ttl: float = field(default_factory=lambda: TOKEN_TTL)
    role: str = ""
    profile_id: str = "default"
    workspace: str = ""
    responseMode: str = "mentioned"
    thinkingLevel: str = ""
    model: str = ""
    failoverModel: str = ""
    autoApprove: bool = False
    runner: str = "tmux"

    def to_dict(self) -> dict:
        return asdict(self)

    def public_dict(self) -> dict:
        d = self.to_dict()
        d.pop("token", None)
        d.pop("token_issued_at", None)
        d.pop("token_ttl", None)
        return d

    def is_token_expired(self) -> bool:
        return time.time() - self.token_issued_at > self.token_ttl

    def rotate_token(self) -> str:
        self.token = secrets.token_hex(16)
        self.token_issued_at = time.time()
        return self.token


def _agent_from_row(row: aiosqlite.Row) -> AgentInstance:
    return AgentInstance(
        agent_id=row["agent_id"],
        name=row["name"],
        base=row["base"],
        label=row["label"],
        color=row["color"],
        slot=int(row["slot"]),
        state=row["state"],
        token=row["token"],
        registered_at=float(row["registered_at"]),
        created_at=float(row["created_at"]),
        token_issued_at=float(row["token_issued_at"]),
        token_ttl=float(row["token_ttl"]),
        role=row["role"],
        profile_id=row["profile_id"] if "profile_id" in row.keys() else "default",
        workspace=row["workspace"],
        responseMode=row["response_mode"],
        thinkingLevel=row["thinking_level"],
        model=row["model"],
        failoverModel=row["failover_model"],
        autoApprove=bool(row["auto_approve"]),
        runner=row["runner"],
    )


def _agent_db_params(inst: AgentInstance) -> tuple:
    return (
        inst.agent_id,
        inst.name,
        inst.base,
        inst.label,
        inst.color,
        inst.slot,
        inst.state,
        inst.token,
        inst.token_issued_at,
        inst.token_ttl,
        inst.registered_at,
        inst.created_at,
        inst.role,
        inst.profile_id,
        inst.workspace,
        inst.responseMode,
        inst.thinkingLevel,
        inst.model,
        inst.failoverModel,
        1 if inst.autoApprove else 0,
        inst.runner,
    )


async def init_registry_db(db: aiosqlite.Connection) -> None:
    await apply_migrations(db, REGISTRY_MIGRATIONS)


async def persist_agent(db: aiosqlite.Connection, inst: AgentInstance) -> None:
    await init_registry_db(db)
    await db.execute(
        """
        INSERT INTO agents (
            agent_id, name, base, label, color, slot, state, token,
            token_issued_at, token_ttl, registered_at, created_at, role,
            profile_id, workspace, response_mode, thinking_level, model, failover_model,
            auto_approve, runner
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
            name = excluded.name,
            base = excluded.base,
            label = excluded.label,
            color = excluded.color,
            slot = excluded.slot,
            state = excluded.state,
            token = excluded.token,
            token_issued_at = excluded.token_issued_at,
            token_ttl = excluded.token_ttl,
            registered_at = excluded.registered_at,
            role = excluded.role,
            profile_id = excluded.profile_id,
            workspace = excluded.workspace,
            response_mode = excluded.response_mode,
            thinking_level = excluded.thinking_level,
            model = excluded.model,
            failover_model = excluded.failover_model,
            auto_approve = excluded.auto_approve,
            runner = excluded.runner
        """,
        _agent_db_params(inst),
    )
    await db.commit()


async def load_persisted_agents(db: aiosqlite.Connection) -> list[AgentInstance]:
    await init_registry_db(db)
    cursor = await db.execute(
        "SELECT * FROM agents ORDER BY registered_at DESC, created_at DESC"
    )
    try:
        rows = await cursor.fetchall()
    finally:
        await cursor.close()
    return [_agent_from_row(row) for row in rows]


# Default color palette per agent base name
_COLORS = {
    "claude": "#e8734a",
    "codex": "#10a37f",
    "gemini": "#4285f4",
    "qwen": "#ffb784",
    "grok": "#ff84a2",
    "copilot": "#84ffa2",
}


class AgentRegistry:
    MAX_AGENTS = 20  # Prevent resource exhaustion from unbounded spawning

    def __init__(self):
        self._instances: dict[str, AgentInstance] = {}
        self._id_index: dict[str, AgentInstance] = {}
        self._persisted_by_id: dict[str, AgentInstance] = {}
        self._persisted_name_index: dict[str, str] = {}
        self._lock = threading.Lock()

    def _occupied_slots(self, base: str) -> set[int]:
        return {inst.slot for inst in self._instances.values() if inst.base == base}

    def _next_available_slot(self, base: str) -> int:
        occupied = self._occupied_slots(base)
        slot = 2
        while slot in occupied:
            slot += 1
        return slot

    def _remember_persisted(self, inst: AgentInstance) -> None:
        self._persisted_by_id[inst.agent_id] = inst
        self._persisted_name_index[inst.name] = inst.agent_id

    def load_persisted(self, instances: list[AgentInstance]) -> None:
        with self._lock:
            self._persisted_by_id.clear()
            self._persisted_name_index.clear()
            for inst in instances:
                self._remember_persisted(inst)

    def register(self, base: str, label: str = "", color: str = "") -> AgentInstance:
        with self._lock:
            if len(self._instances) >= self.MAX_AGENTS:
                raise ValueError(f"Maximum agent limit reached ({self.MAX_AGENTS})")
            if not label:
                label = base.capitalize()
            if not color:
                color = _COLORS.get(base, "#d2bbff")

            occupied = self._occupied_slots(base)
            if 1 not in occupied and base not in self._instances:
                name = base
                slot = 1
            else:
                slot = self._next_available_slot(base)
                name = f"{base}-{slot}"

            inst = AgentInstance(
                name=name,
                base=base,
                label=label,
                color=color,
                slot=slot,
                state="active",
            )
            self._instances[name] = inst
            self._id_index[inst.agent_id] = inst
            self._remember_persisted(inst)
            return inst

    def deregister(self, name: str) -> AgentInstance | None:
        with self._lock:
            inst = self._instances.pop(name, None)
            if inst is None:
                return None
            inst.state = "offline"
            self._id_index.pop(inst.agent_id, None)
            self._remember_persisted(inst)
            return inst

    def get(self, name: str) -> AgentInstance | None:
        return self._instances.get(name)

    def get_by_id(self, agent_id: str) -> AgentInstance | None:
        with self._lock:
            return self._id_index.get(agent_id) or self._persisted_by_id.get(agent_id)

    def get_by_name(self, name: str) -> AgentInstance | None:
        with self._lock:
            live = self._instances.get(name)
            if live is not None:
                return live
            agent_id = self._persisted_name_index.get(name)
            if agent_id:
                return self._persisted_by_id.get(agent_id)
            return None

    def resolve(self, identifier: str) -> AgentInstance | None:
        with self._lock:
            if identifier in self._id_index:
                return self._id_index[identifier]
            if identifier in self._persisted_by_id:
                return self._persisted_by_id[identifier]
            if identifier in self._instances:
                return self._instances[identifier]
            agent_id = self._persisted_name_index.get(identifier)
            if agent_id:
                return self._persisted_by_id.get(agent_id)
            return None

    def get_all(self) -> list[AgentInstance]:
        with self._lock:
            return list(self._instances.values())

    def get_public_list(self) -> list[dict]:
        with self._lock:
            return [inst.public_dict() for inst in self._instances.values()]

    def get_persisted_public_list(self) -> list[dict]:
        with self._lock:
            live_ids = set(self._id_index)
            persisted = [
                inst.public_dict()
                for agent_id, inst in self._persisted_by_id.items()
                if agent_id not in live_ids
            ]
        persisted.sort(key=lambda item: item.get("registered_at", 0), reverse=True)
        return persisted

    def set_state(self, name: str, state: str):
        with self._lock:
            inst = self._instances.get(name)
            if inst:
                inst.state = state
                self._remember_persisted(inst)

    def resolve_token(self, token: str) -> AgentInstance | None:
        with self._lock:
            for inst in self._instances.values():
                if inst.token == token:
                    return inst
            return None
