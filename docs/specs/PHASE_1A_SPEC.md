# Phase 1A Implementation Spec: UUID-Keyed Identity & SQLite Persistence

**Version:** 1.0  
**Date:** 2026-04-06  
**Status:** Draft  
**Scope:** Backend identity rekeying, SQLite persistence, data path unification, provider adapter interface  
**Precondition:** No code changes in this document. This is a spec only.

---

## Table of Contents

1. [Identity Record Schema](#1-identity-record-schema)
2. [SQLite Persistence Layer](#2-sqlite-persistence-layer)
3. [Data Path Unification](#3-data-path-unification)
4. [Registry Migration Plan](#4-registry-migration-plan)
5. [Provider Adapter Interface](#5-provider-adapter-interface)
6. [API Changes](#6-api-changes)
7. [Frontend Changes](#7-frontend-changes)
8. [Regression Risk Map](#8-regression-risk-map)
9. [Acceptance Tests](#9-acceptance-tests)
10. [Rollback Plan](#10-rollback-plan)

---

## 1. Identity Record Schema

### 1.1 Current State

`backend/registry.py` defines `AgentInstance` as a dataclass with 17 fields. Instances are stored in an in-memory dict keyed by `name` (a string like `"claude"` or `"claude-2"`). The name is derived from the `base` + slot number and is used as the primary key everywhere: queue files, memory directories, worktree paths, process tracking, MCP cursors, approval files, and all API endpoints.

### 1.2 New Schema: AgentIdentityRecord

Replace `AgentInstance` with `AgentIdentityRecord`. The new dataclass lives in `backend/registry.py`.

```python
import hashlib
import secrets
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Optional

TOKEN_TTL = 3600  # 1 hour default


def _uuid7() -> str:
    """Generate a UUID v7 (time-ordered, random).

    UUID v7 embeds a Unix millisecond timestamp in the high 48 bits,
    making them sortable by creation time. The remaining bits are random.

    Format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
    where y is one of {8, 9, a, b} (variant 1).
    """
    timestamp_ms = int(time.time() * 1000)
    # 48-bit timestamp
    time_bits = timestamp_ms & ((1 << 48) - 1)
    # 12-bit random (version nibble replaced below)
    rand_a = secrets.randbits(12)
    # 62-bit random (variant bits replaced below)
    rand_b = secrets.randbits(62)

    # Assemble: time_high (32) | time_mid (16) | ver(4)+rand_a(12) | var(2)+rand_b(62)
    uuid_int = (time_bits >> 16) << 96  # time_high: bits 96-127
    uuid_int |= (time_bits & 0xFFFF) << 80  # time_mid: bits 80-95
    uuid_int |= 0x7 << 76  # version 7: bits 76-79
    uuid_int |= (rand_a & 0xFFF) << 64  # rand_a: bits 64-75
    uuid_int |= 0x2 << 62  # variant 1: bits 62-63
    uuid_int |= rand_b & ((1 << 62) - 1)  # rand_b: bits 0-61

    return str(uuid.UUID(int=uuid_int))


@dataclass
class AgentIdentityRecord:
    # ── Immutable identifiers ──────────────────────────────────────
    agent_id: str = field(default_factory=_uuid7)
    """Permanent UUID v7. Never changes across restarts or renames."""

    session_id: str = field(default_factory=_uuid7)
    """New UUID v7 generated on every spawn/restart."""

    parent_agent_id: Optional[str] = None
    """Set when this agent was spawned by delegation from another agent."""

    # ── Display / classification ───────────────────────────────────
    name: str = ""
    """Mutable display name (e.g. 'claude', 'claude-2'). Used in chat @mentions.
    May change on rename. NOT used as a key anywhere internally after Phase 1A."""

    base: str = ""
    """Immutable provider type: 'claude', 'codex', 'gemini', 'grok', 'aider',
    'goose', 'copilot', 'ollama', etc. Set at registration, never changes."""

    label: str = ""
    """Human-friendly display label (e.g. 'Code Reviewer', 'Frontend Lead').
    Shown in the UI agent bar and chat messages."""

    color: str = "#d2bbff"
    """Hex color for avatar/badge. Defaults per base via _COLORS lookup."""

    slot: int = 1
    """Instance number within the same base type. First instance = 1."""

    # ── Runtime state ──────────────────────────────────────────────
    state: str = "pending"
    """One of: 'pending', 'active', 'thinking', 'idle', 'paused', 'offline'."""

    role: str = ""
    """One of: '', 'manager', 'worker', 'peer'. Empty string = unassigned."""

    # ── Workspace ──────────────────────────────────────────────────
    workspace: str = ""
    """Absolute project directory path where the agent operates."""

    workspace_id: str = ""
    """Stable hash of workspace path. Used to group agents by workspace
    independent of path formatting differences. Computed as:
    hashlib.sha256(os.path.normpath(os.path.abspath(workspace)).encode()).hexdigest()[:16]"""

    # ── Profile link (Phase 2) ─────────────────────────────────────
    profile_id: Optional[str] = None
    """Links to the profile system in Phase 2. Null until Phase 2 is implemented."""

    # ── Model configuration ────────────────────────────────────────
    model: str = ""
    """Model override for this agent (e.g. 'claude-sonnet-4-20250514')."""

    failover_model: str = ""
    """Fallback model if primary model fails or is rate-limited."""

    # ── Behavior ───────────────────────────────────────────────────
    response_mode: str = "mentioned"
    """One of: 'mentioned', 'always', 'listen', 'silent'.
    Controls when the agent responds to chat messages."""

    thinking_level: str = ""
    """One of: '', 'off', 'minimal', 'low', 'medium', 'high'.
    Empty string = provider default."""

    auto_approve: bool = False
    """When True, automatically approve all permission prompts."""

    # ── Runner / transport ─────────────────────────────────────────
    runner: str = "tmux"
    """Agent runtime: 'tmux' or 'mcp'."""

    transport: str = "cli"
    """Communication transport: 'cli', 'api', 'mcp', 'local'.
    - cli: Agent runs as a CLI process (tmux or headless)
    - api: Agent communicates via HTTP API calls
    - mcp: Agent uses MCP protocol directly
    - local: Agent runs in-process (Ollama, etc.)"""

    # ── Capabilities ───────────────────────────────────────────────
    capabilities: list[str] = field(default_factory=list)
    """List of capability flags. Examples:
    ['code_edit', 'web_search', 'image_gen', 'shell_exec', 'mcp_native'].
    Used for skill routing and feature gating."""

    auth_scope: str = "full"
    """What this agent is allowed to access. One of:
    'full', 'read_only', 'sandbox', 'restricted'.
    Enforced by the MCP bridge and route guards."""

    # ── Authentication ─────────────────────────────────────────────
    token: str = field(default_factory=lambda: secrets.token_hex(16))
    """Bearer token for MCP bridge authentication."""

    token_issued_at: float = field(default_factory=time.time)
    """Unix timestamp of when current token was issued."""

    token_ttl: float = field(default_factory=lambda: TOKEN_TTL)
    """Token lifetime in seconds. Default: 3600 (1 hour)."""

    # ── Artifact namespace ─────────────────────────────────────────
    artifact_namespace: str = ""
    """Where this agent's artifacts live. Defaults to agent_id.
    Format: 'data/artifacts/{agent_id}/'. Used for screenshots,
    generated images, downloaded files, etc."""

    # ── Rename history ─────────────────────────────────────────────
    rename_history: list[dict] = field(default_factory=list)
    """Immutable append-only list of name changes.
    Each entry: {'old_name': str, 'new_name': str, 'timestamp': float}.
    Used for audit trail and backward-compatible name resolution."""

    # ── Timestamps ─────────────────────────────────────────────────
    created_at: float = field(default_factory=time.time)
    """When the agent identity was first created (persists across restarts)."""

    registered_at: float = field(default_factory=time.time)
    """When the agent last registered with the server (updated on re-register)."""

    # ── Identity injection tracking ────────────────────────────────
    soul_hash: str = ""
    """SHA-256 hash of the last injected identity text.
    Used for drift detection: if the hash of current soul != soul_hash,
    the identity has drifted and needs re-injection.
    Computed as: hashlib.sha256(identity_text.encode()).hexdigest()[:32]"""

    last_injection_at: float = 0.0
    """Unix timestamp of the last successful identity injection."""

    injection_count: int = 0
    """Total number of identity injections performed for this agent."""

    # ── Methods ────────────────────────────────────────────────────

    def to_dict(self) -> dict:
        """Full dict including sensitive fields. For internal use only."""
        d = asdict(self)
        # Ensure rename_history is serializable
        d["rename_history"] = list(d.get("rename_history", []))
        d["capabilities"] = list(d.get("capabilities", []))
        return d

    def public_dict(self) -> dict:
        """Dict safe for API responses (no token, no auth internals)."""
        d = self.to_dict()
        d.pop("token", None)
        d.pop("token_issued_at", None)
        d.pop("token_ttl", None)
        d.pop("auth_scope", None)
        d.pop("soul_hash", None)
        return d

    def is_token_expired(self) -> bool:
        return time.time() - self.token_issued_at > self.token_ttl

    def rotate_token(self) -> str:
        self.token = secrets.token_hex(16)
        self.token_issued_at = time.time()
        return self.token

    def record_injection(self, identity_text: str) -> None:
        """Record that an identity injection was performed."""
        self.soul_hash = hashlib.sha256(identity_text.encode()).hexdigest()[:32]
        self.last_injection_at = time.time()
        self.injection_count += 1

    def rename(self, new_name: str) -> None:
        """Record a name change in the immutable history."""
        self.rename_history.append({
            "old_name": self.name,
            "new_name": new_name,
            "timestamp": time.time(),
        })
        self.name = new_name
```

### 1.3 Field Compatibility Matrix

| New Field | Old Field | Migration |
|-----------|-----------|-----------|
| `agent_id` | (none) | Generated on first insert |
| `session_id` | (none) | Generated on every register |
| `parent_agent_id` | (none) | Null for existing agents |
| `name` | `name` | Direct copy |
| `base` | `base` | Direct copy |
| `label` | `label` | Direct copy |
| `color` | `color` | Direct copy |
| `slot` | `slot` | Direct copy |
| `state` | `state` | Direct copy |
| `role` | `role` | Direct copy |
| `workspace` | `workspace` | Direct copy |
| `workspace_id` | (none) | Computed from `workspace` |
| `profile_id` | (none) | Null |
| `model` | `model` | Direct copy |
| `failover_model` | `failoverModel` | Rename (snake_case) |
| `response_mode` | `responseMode` | Rename (snake_case) |
| `thinking_level` | `thinkingLevel` | Rename (snake_case) |
| `auto_approve` | `autoApprove` | Rename (snake_case) |
| `runner` | `runner` | Direct copy |
| `transport` | (none) | Default `"cli"` |
| `capabilities` | (none) | Empty list |
| `auth_scope` | (none) | Default `"full"` |
| `token` | `token` | Direct copy |
| `token_issued_at` | `token_issued_at` | Direct copy |
| `token_ttl` | `token_ttl` | Direct copy |
| `artifact_namespace` | (none) | Set to `agent_id` on creation |
| `rename_history` | (none) | Empty list |
| `created_at` | (none) | `registered_at` value |
| `registered_at` | `registered_at` | Direct copy |
| `soul_hash` | (none) | Empty string |
| `last_injection_at` | (none) | 0.0 |
| `injection_count` | (none) | 0 |

### 1.4 API Field Naming Convention

The backend uses **snake_case** internally and in the database. The API returns **snake_case**. The frontend uses **camelCase** in TypeScript interfaces. A mapping layer in the frontend converts between the two. This is a breaking change from the current mixed convention (e.g., `responseMode` in both Python and TS). The migration must update both sides.

**Decision:** The backend transitions fully to snake_case. The API returns snake_case. The frontend adds a thin mapping function for fields it needs in camelCase.

---

## 2. SQLite Persistence Layer

### 2.1 Database Location

```
data/ghostlink.db
```

This is the same `data/` directory used by `app.py` for `DATA_DIR`. The database file lives alongside `ghostlink_v2.db` (the message store) and the existing `settings.json`, `skills_config.json`, etc.

### 2.2 PRAGMA Settings

Applied on every connection open:

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA cache_size = -2000;  -- 2MB cache
```

### 2.3 Schema

```sql
-- Schema version: tracked via PRAGMA user_version
-- Phase 1A = user_version 1

CREATE TABLE IF NOT EXISTS agents (
    -- Primary key
    agent_id        TEXT PRIMARY KEY NOT NULL,

    -- Session tracking
    session_id      TEXT NOT NULL,
    parent_agent_id TEXT,

    -- Display / classification
    name            TEXT NOT NULL,
    base            TEXT NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    color           TEXT NOT NULL DEFAULT '#d2bbff',
    slot            INTEGER NOT NULL DEFAULT 1,

    -- Runtime state
    state           TEXT NOT NULL DEFAULT 'offline',
    role            TEXT NOT NULL DEFAULT '',

    -- Workspace
    workspace       TEXT NOT NULL DEFAULT '',
    workspace_id    TEXT NOT NULL DEFAULT '',

    -- Profile link (Phase 2)
    profile_id      TEXT,

    -- Model configuration
    model           TEXT NOT NULL DEFAULT '',
    failover_model  TEXT NOT NULL DEFAULT '',

    -- Behavior
    response_mode   TEXT NOT NULL DEFAULT 'mentioned',
    thinking_level  TEXT NOT NULL DEFAULT '',
    auto_approve    INTEGER NOT NULL DEFAULT 0,  -- boolean as int

    -- Runner / transport
    runner          TEXT NOT NULL DEFAULT 'tmux',
    transport       TEXT NOT NULL DEFAULT 'cli',

    -- Capabilities (JSON array stored as TEXT)
    capabilities    TEXT NOT NULL DEFAULT '[]',

    -- Auth
    auth_scope      TEXT NOT NULL DEFAULT 'full',
    token           TEXT NOT NULL,
    token_issued_at REAL NOT NULL,
    token_ttl       REAL NOT NULL DEFAULT 3600.0,

    -- Artifact namespace
    artifact_namespace TEXT NOT NULL DEFAULT '',

    -- Rename history (JSON array stored as TEXT)
    rename_history  TEXT NOT NULL DEFAULT '[]',

    -- Timestamps
    created_at      REAL NOT NULL,
    registered_at   REAL NOT NULL,

    -- Identity injection
    soul_hash       TEXT NOT NULL DEFAULT '',
    last_injection_at REAL NOT NULL DEFAULT 0.0,
    injection_count INTEGER NOT NULL DEFAULT 0
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agents_token ON agents(token);
CREATE INDEX IF NOT EXISTS idx_agents_base ON agents(base);
CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
CREATE INDEX IF NOT EXISTS idx_agents_workspace_id ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agents_state ON agents(state);
```

### 2.4 Migration Strategy

Use `PRAGMA user_version` to track schema versions:

```python
def _get_schema_version(conn) -> int:
    return conn.execute("PRAGMA user_version").fetchone()[0]

def _set_schema_version(conn, version: int):
    conn.execute(f"PRAGMA user_version = {version}")

def _migrate(conn):
    version = _get_schema_version(conn)
    if version < 1:
        # Phase 1A: create initial schema
        conn.executescript(_SCHEMA_V1)
        _set_schema_version(conn, 1)
    # Future: if version < 2: ... Phase 2 migrations
```

### 2.5 Connection Management

FastAPI runs in an async context with multiple threads (for sync MCP handlers). SQLite connections are NOT thread-safe. Strategy:

```python
import sqlite3
import threading

_thread_local = threading.local()

def _get_conn(db_path: str) -> sqlite3.Connection:
    """Get a thread-local SQLite connection."""
    if not hasattr(_thread_local, "conn") or _thread_local.conn is None:
        conn = sqlite3.connect(db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA foreign_keys = ON")
        _thread_local.conn = conn
    return _thread_local.conn
```

The `AgentRegistry` class holds the `db_path` and uses `_get_conn()` for every operation. The in-memory `_instances` dict remains as a **hot cache** for fast lookups, but the DB is the source of truth.

### 2.6 CRUD Operations

All operations acquire the registry's `_lock` (a `threading.Lock`) before modifying the cache or writing to the DB.

```python
class AgentRegistry:
    def __init__(self, db_path: str):
        self._db_path = db_path
        self._instances: dict[str, AgentIdentityRecord] = {}  # keyed by agent_id
        self._name_index: dict[str, str] = {}  # name -> agent_id (for backward compat)
        self._token_index: dict[str, str] = {}  # token -> agent_id (for fast auth)
        self._lock = threading.Lock()
        self._init_db()
        self._load_from_db()
```

#### register(base, label, color) -> AgentIdentityRecord

1. Acquire `_lock`.
2. Check `len(self._instances) < MAX_AGENTS`.
3. Compute slot, name (existing logic).
4. Create `AgentIdentityRecord` with new `agent_id`, `session_id`.
5. INSERT into SQLite.
6. Add to `_instances[agent_id]`, `_name_index[name]`, `_token_index[token]`.
7. Return record.

#### get_by_id(agent_id) -> AgentIdentityRecord | None

1. Return `_instances.get(agent_id)`.

#### get_by_name(name) -> AgentIdentityRecord | None

1. Look up `agent_id = _name_index.get(name)`.
2. Return `_instances.get(agent_id)`.

#### get_by_token(token) -> AgentIdentityRecord | None

1. Look up `agent_id = _token_index.get(token)`.
2. Return `_instances.get(agent_id)`.
3. If found, check `is_token_expired()`.

#### get_all() -> list[AgentIdentityRecord]

1. Acquire `_lock`.
2. Return `list(self._instances.values())`.

#### update(agent_id, **fields) -> bool

1. Acquire `_lock`.
2. Get record from `_instances`.
3. If `name` changed: update `_name_index` (remove old, add new), record rename in `rename_history`.
4. If `token` changed: update `_token_index`.
5. Apply field updates to the record.
6. UPDATE in SQLite (only changed columns).
7. Return True.

#### deregister(agent_id_or_name) -> bool

1. Acquire `_lock`.
2. Resolve to `agent_id` (check `_instances` first, then `_name_index`).
3. Remove from `_instances`, `_name_index`, `_token_index`.
4. UPDATE state to `'offline'` in SQLite (do NOT delete -- preserve history).
5. Return True if found.

#### get(name) -> AgentIdentityRecord | None  (backward-compatible alias)

1. Delegates to `get_by_name(name)`.
2. This method exists solely for backward compatibility during migration.

### 2.7 Server Restart Recovery

On startup (`_load_from_db()`):

1. SELECT all agents WHERE `state != 'offline'`.
2. For each: set `state = 'offline'` in DB (they may not actually be running).
3. Load all records into `_instances` cache (including offline ones for name resolution).
4. Build `_name_index` and `_token_index`.
5. When a wrapper process re-registers (POST `/api/register`), match by `base` + `slot` to find the existing `agent_id`, generate a new `session_id`, update `state` to `'active'`, rotate token.

**Key invariant:** The `agent_id` survives server restarts. The `session_id` does not.

---

## 3. Data Path Unification

### 3.1 Current State (BUG)

Two different data root paths are used for agent-scoped data:

| Consumer | Path Used | Example Full Path |
|----------|-----------|-------------------|
| `routes/agents.py` (soul, notes, memories, feedback) | `DATA_DIR / "agents"` | `data/agents/claude/memory/` |
| `mcp_bridge.py` (memory_save/load/list/search) | `_data_dir` (= `DATA_DIR`) | `data/claude/memory/` |
| `wrapper.py` (set_soul during spawn) | `data_dir` (from config.toml) | `data/claude/soul.txt` |
| `app.py` (queue files) | `DATA_DIR` | `data/claude_queue.jsonl` |

**This means**: When the routes/agents.py UI panel reads agent memories via `/api/agents/claude/memories`, it reads from `data/agents/claude/memory/`. But when the MCP bridge's `memory_save` tool writes, it writes to `data/claude/memory/`. **These are different directories.** A memory saved via MCP may not appear in the UI, and vice versa.

### 3.2 Canonical Data Path Convention

All agent-scoped data will live under:

```
data/agents/{agent_id}/
```

Directory layout per agent:

```
data/agents/{agent_id}/
    memory/          -- per-key JSON memory files
    soul.txt         -- identity/personality prompt
    notes.txt        -- scratch pad
    artifacts/       -- screenshots, generated images, downloads
```

Non-agent-scoped files remain directly under `data/`:

```
data/
    ghostlink.db           -- agent registry (new)
    ghostlink_v2.db        -- message store (existing)
    settings.json          -- app settings
    skills_config.json     -- skill assignments
    skills/                -- custom skill definitions
    logs/                  -- spawn logs
    provider-config/       -- per-instance MCP configs
    {name}_queue.jsonl     -- trigger queue (remains name-based, see 3.4)
    {name}_approval.json   -- approval response (remains name-based, see 3.4)
```

### 3.3 Files That Need Path Updates

| File | Current Path | New Path | Change Required |
|------|-------------|----------|-----------------|
| `routes/agents.py` L1259 | `DATA_DIR / "agents"` passed to `get_soul()` | `DATA_DIR / "agents"` (no change -- already correct target dir) | Add `agent_id` subdirectory instead of `name` |
| `mcp_bridge.py` L853 | `_data_dir` passed to `get_agent_memory()` | `_data_dir / "agents"` | Change to match routes |
| `wrapper.py` L932 | `data_dir` passed to `set_soul()` | `data_dir / "agents"` | Change to match routes |
| `agent_memory.py` L33 | `data_dir / self.agent_name / "memory"` | `data_dir / self.agent_id / "memory"` | Accept `agent_id` parameter instead of `agent_name` |
| `agent_memory.py` L300 | `data_dir / agent_name / "soul.txt"` | `data_dir / agent_id / "soul.txt"` | Accept `agent_id` parameter |
| `agent_memory.py` L324 | `data_dir / agent_name / "notes.txt"` | `data_dir / agent_id / "notes.txt"` | Accept `agent_id` parameter |
| `routes/misc.py` L256 | `data_dir / "memory"` (cross-agent search) | Must scan `data_dir / "agents" / */memory/` | Update glob pattern |

### 3.4 Queue and Approval Files

Queue files (`{name}_queue.jsonl`) and approval files (`{name}_approval.json`) remain **name-based** in Phase 1A. Rationale:

- The wrapper process uses the name to construct the queue file path.
- The wrapper knows its name from registration but would need extra work to know its agent_id.
- Queue files are ephemeral (deleted after processing).
- Moving to agent_id-based queue paths is deferred to Phase 1B when the wrapper is fully id-aware.

**Migration note:** In Phase 1A, the registry's `get_by_name()` lookup ensures queue file routing still works. The name remains unique per active agent. If an agent is renamed, the queue path updates via `set_runtime_identity()` in `wrapper.py` (L862), which already handles this.

### 3.5 Data Migration Procedure

1. On first startup with the new code, check if `data/agents/` exists.
2. For each directory in `data/` that looks like an agent name (matches `^[a-zA-Z0-9_-]{1,50}$` AND is not a known non-agent directory like `skills`, `logs`, `provider-config`):
   a. Look up the agent_id by name in the registry DB.
   b. If found: rename `data/{name}/` to `data/agents/{agent_id}/`.
   c. If not found (orphaned data): leave in place, log a warning.
3. For each directory in `data/agents/` that is name-based (not a UUID):
   a. Same lookup and rename logic.
4. Log all migrations performed.

---

## 4. Registry Migration Plan

### 4.1 backend/registry.py -- _instances dict rekey

**Current:** `_instances: dict[str, AgentInstance]` keyed by `name`.  
**After:** `_instances: dict[str, AgentIdentityRecord]` keyed by `agent_id`.

**Changes:**

| Location | Before | After |
|----------|--------|-------|
| `__init__` | `self._instances: dict[str, AgentInstance] = {}` | `self._instances: dict[str, AgentIdentityRecord] = {}` + `self._name_index: dict[str, str] = {}` + `self._token_index: dict[str, str] = {}` |
| `register()` | `self._instances[name] = inst` | `self._instances[inst.agent_id] = inst` + `self._name_index[name] = inst.agent_id` + `self._token_index[inst.token] = inst.agent_id` |
| `deregister(name)` | `self._instances.pop(name, None)` | Resolve name to agent_id via `_name_index`, then pop from all three dicts |
| `get(name)` | `self._instances.get(name)` | `self._instances.get(self._name_index.get(name, ""))` |
| `get_all()` | `list(self._instances.values())` | No change (values are still records) |
| `set_state(name, state)` | `self._instances.get(name)` | Resolve via `_name_index` first |
| `resolve_token(token)` | Linear scan of all instances | `self._instances.get(self._token_index.get(token, ""))` -- O(1) instead of O(n) |
| `_occupied_slots(base)` | Iterates `.values()` | No change needed (still iterates values) |

**Backward compatibility:** The `get(name)` method is preserved as an alias for `get_by_name()`. All existing callers that do `registry.get("claude")` continue to work.

### 4.2 backend/mcp_bridge.py

**Current name-keyed state:**

```python
_presence: dict[str, float] = {}          # name -> timestamp
_activity: dict[str, bool] = {}           # name -> bool
_activity_ts: dict[str, float] = {}       # name -> timestamp
_cursors: dict[str, dict[str, int]] = {}  # name -> {channel -> msg_id}
_empty_read_count: dict[str, int] = {}    # name -> count
```

**After:** All remain keyed by `name` in Phase 1A.

**Rationale:** The MCP bridge resolves identity via `_resolve_identity()`, which returns the agent's `name` (not `agent_id`). Rekeying the bridge internals to `agent_id` requires `_resolve_identity()` to return the full record or agent_id instead of name. This is a Phase 1B change.

**Phase 1A change for mcp_bridge.py:**
- `_resolve_identity()` continues to return `(name, error)`.
- `cleanup_agent(name)` continues to accept name.
- Queue file paths in `_trigger_mentions()` (L301) remain name-based.
- Memory tool calls resolve the identity to a name, then the `AgentMemory` class uses `agent_id` (looked up from registry) for the directory path.

**Specific changes:**

| Location | Change |
|----------|--------|
| L853 `get_agent_memory(_data_dir, identity)` | Change to `get_agent_memory(_data_dir / "agents", _resolve_agent_id(identity))` where `_resolve_agent_id` looks up agent_id from registry by name |
| L872 `get_agent_memory(_data_dir, identity)` | Same change |
| L900 `get_agent_memory(_data_dir, identity)` | Same change |
| L920 `get_agent_memory(_data_dir, identity)` | Same change |

New helper function:

```python
def _resolve_agent_id(name: str) -> str:
    """Look up agent_id from name via registry. Falls back to name if not found."""
    if _registry:
        inst = _registry.get(name)
        if inst:
            return inst.agent_id
    return name  # fallback for safety
```

### 4.3 backend/agent_memory.py

**Current:** `AgentMemory.__init__` takes `agent_name: str`, creates `data_dir / agent_name / "memory"`.  
**After:** Constructor accepts an opaque `agent_key: str` (which callers pass as `agent_id`). The internal `_sanitize_agent_name` function is renamed to `_sanitize_key` (it already validates `^[a-zA-Z0-9_-]{1,50}$`, which UUIDs with hyphens satisfy).

**Changes:**

| Location | Before | After |
|----------|--------|-------|
| L22 `_sanitize_agent_name` | Validates name | Rename to `_sanitize_agent_key`, expand regex to allow UUID format (`^[a-zA-Z0-9_-]{1,64}$`) |
| L31 `__init__(self, data_dir, agent_name)` | `self.agent_name = _sanitize_agent_name(agent_name)` | `self.agent_key = _sanitize_agent_key(agent_key)` |
| L33 `self.memory_dir` | `data_dir / self.agent_name / "memory"` | `data_dir / self.agent_key / "memory"` |
| L76 `entry["agent"]` | `self.agent_name` | `self.agent_key` |
| L184 `_memory_cache` | Keyed by `f"{data_dir}:{agent_name}"` | Keyed by `f"{data_dir}:{agent_key}"` |
| L223 `get_agent_memory(data_dir, agent_name)` | Accepts name | Rename param to `agent_key` |
| L297 `get_soul(data_dir, agent_name)` | Uses name for path | Accept `agent_key` |
| L309 `set_soul(data_dir, agent_name, soul)` | Uses name for path | Accept `agent_key` |
| L321 `get_notes(data_dir, agent_name)` | Uses name for path | Accept `agent_key` |
| L333 `set_notes(data_dir, agent_name, content)` | Uses name for path | Accept `agent_key` |
| L188 `search_all_memories` | Iterates dirs, uses `agent_dir.name` as agent_name | Continue using dir name, but results now include `agent_id` field derived from dir name |

### 4.4 backend/skills.py

**Current:** `_agent_skills: dict[str, list[str]]` keyed by agent name.  
**After:** Keyed by `agent_id`.

**Changes:**

| Location | Before | After |
|----------|--------|-------|
| L245 `_agent_skills` | `dict[str, list[str]]` keyed by name | Keyed by agent_id |
| L246 `_skill_config` | `dict[str, dict]` keyed by `"{name}:{skill_id}"` | Keyed by `"{agent_id}:{skill_id}"` |
| All methods (`get_agent_skills`, `set_agent_skills`, etc.) | Accept `agent_name: str` | Accept `agent_id: str` |
| `skills_config.json` | Contains name-keyed data | Migration: on first load, resolve names to agent_ids via registry |

**Migration for skills_config.json:**

```python
def _migrate_skills_config(self, registry):
    """One-time migration: rename name keys to agent_id keys."""
    changed = False
    new_agent_skills = {}
    for key, skills in self._agent_skills.items():
        inst = registry.get_by_name(key)
        if inst:
            new_agent_skills[inst.agent_id] = skills
            changed = True
        else:
            new_agent_skills[key] = skills  # keep as-is if unresolvable
    if changed:
        self._agent_skills = new_agent_skills
        # Same for _skill_config
        new_skill_config = {}
        for key, config in self._skill_config.items():
            parts = key.split(":", 1)
            if len(parts) == 2:
                inst = registry.get_by_name(parts[0])
                if inst:
                    new_skill_config[f"{inst.agent_id}:{parts[1]}"] = config
                    continue
            new_skill_config[key] = config
        self._skill_config = new_skill_config
        self._save()
```

**Callers that must pass agent_id instead of name:**
- `routes/agents.py` L1244: `deps.skills_registry.enable_skill(agent_name, skill_id)` -- must resolve agent_id first
- `routes/agents.py` L1246: `deps.skills_registry.disable_skill(agent_name, skill_id)` -- same

### 4.5 backend/wrapper.py

**Current:** `_identity` dict tracks `name`, `queue`, `token`.  
**After:** Add `agent_id` and `session_id` fields.

**Changes:**

| Location | Before | After |
|----------|--------|-------|
| L744-748 `_identity` dict | `{"name": ..., "queue": ..., "token": ...}` | Add `"agent_id": registration.get("agent_id", "")`, `"session_id": registration.get("session_id", "")` |
| L751-753 `get_identity()` | Returns `(name, queue_file)` | No change to signature -- callers expect (name, queue) |
| L855-878 `set_runtime_identity()` | Updates name, queue, token | Also update agent_id if provided (for re-registration) |
| L932 `set_soul(data_dir, assigned_name, soul)` | Uses name | Use `set_soul(data_dir / "agents", agent_id, soul)` |
| L746-747 Queue file path | `data_dir / f"{assigned_name}_queue.jsonl"` | Remains name-based (Phase 1A) |
| L401 Approval file path | `data_dir / f"{current_name}_approval.json"` | Remains name-based (Phase 1A) |

The wrapper's `_register()` function (L272) sends a POST to `/api/register`. The response must now include `agent_id` and `session_id` in addition to the existing fields.

### 4.6 backend/deps.py

**Current name-keyed state dicts:**

```python
_agent_processes: dict[str, subprocess.Popen]     # name -> process
_last_heartbeats: dict[str, float]                 # name -> timestamp
_thinking_buffers: dict[str, dict]                 # name -> {text, updated_at, active}
_agent_presence: dict[str, dict]                   # name -> presence payload
_agent_browser_state: dict[str, dict]              # name -> browser state
_terminal_streams: dict[str, dict]                 # name -> terminal output
_mcp_invocation_logs: dict[str, deque]             # name -> MCP log entries
_file_diff_cache: dict[str, dict[str, dict]]       # name -> {path -> diff}
```

**Phase 1A decision:** These remain keyed by `name`.

**Rationale:** These are all ephemeral in-memory caches that reset on server restart. They are populated by agent activity during a session and cleaned up by `cleanup_agent_state(agent_name)`. Rekeying them to `agent_id` requires updating every caller across routes, MCP bridge, and wrapper. This is deferred to Phase 1B.

**Phase 1A change:** `cleanup_agent_state` continues to accept `agent_name`. The `_agent_processes` dict key changes from `name` to `name` (no change). The `_pending_spawns` dict is keyed by PID (no change).

### 4.7 backend/routes/agents.py

**Current:** All endpoints use `{name}` as the path parameter:
- `POST /api/deregister/{name}`
- `POST /api/kill-agent/{name}`
- `GET /api/agents/{name}/soul`
- `POST /api/agents/{name}/soul`
- `GET /api/agents/{name}/notes`
- `POST /api/agents/{name}/notes`
- `GET /api/agents/{name}/health`
- `GET /api/agents/{name}/config`
- `POST /api/agents/{name}/config`
- `GET /api/agents/{name}/memories`
- `GET /api/agents/{name}/memories/{key}`
- `DELETE /api/agents/{name}/memories/{key}`
- `POST /api/agents/{name}/feedback`
- `POST /api/agents/{name}/terminal/open`
- And others...

**After:** See Section 6 (API Changes) for the full plan.

### 4.8 backend/worktree.py

**Current:** `_worktrees: dict[str, Path]` keyed by `agent_name`. Worktree paths use name: `.ghostlink-worktrees/{agent_name}`. Branch names use name: `ghostlink-{agent_name}`.

**After:** Keyed by `agent_id`. Worktree paths become `.ghostlink-worktrees/{agent_id}`. Branch names become `ghostlink-{agent_id}`.

**Changes:**

| Location | Before | After |
|----------|--------|-------|
| L23 `_worktrees` | `dict[str, Path]` keyed by name | Keyed by agent_id |
| L37 `create_worktree(agent_name)` | Param is name | Param is `agent_id` |
| L44 worktree dir | `.ghostlink-worktrees / agent_name` | `.ghostlink-worktrees / agent_id` |
| L45 branch name | `ghostlink-{agent_name}` | `ghostlink-{agent_id}` |
| L79 `remove_worktree(agent_name)` | Param is name | Param is `agent_id` |
| L119 `get_worktree_path(agent_name)` | Param is name | Param is `agent_id` |
| L123 `merge_changes(agent_name)` | Param is name | Param is `agent_id` |

**Callers that must pass agent_id:**
- `routes/agents.py` L487: `worktree_manager.create_worktree(inst.name)` -> `inst.agent_id`
- `routes/agents.py` L543-544: `worktree_manager.merge_changes(name)` / `.remove_worktree(name)` -> resolve agent_id first
- `routes/agents.py` L880-882: Same pattern in kill-agent

### 4.9 frontend/src/types/index.ts -- Agent interface

**Current:**
```typescript
export interface Agent {
  name: string;
  base: string;
  label: string;
  color: string;
  state: 'active' | 'idle' | 'pending' | 'offline' | 'thinking' | 'paused';
  slot: number;
  role?: 'manager' | 'worker' | 'peer';
  responseMode?: 'mentioned' | 'always' | 'listen' | 'silent';
  parent?: string;
  workspace?: string;
  command?: string;
  args?: string[];
  registered_at?: number;
  runner?: 'tmux' | 'mcp';
}
```

**After:**
```typescript
export interface Agent {
  id: string;                // agent_id (UUID v7) -- NEW primary key
  session_id?: string;       // NEW
  parent_agent_id?: string;  // NEW (replaces `parent`)
  name: string;
  base: string;
  label: string;
  color: string;
  state: 'active' | 'idle' | 'pending' | 'offline' | 'thinking' | 'paused';
  slot: number;
  role?: 'manager' | 'worker' | 'peer';
  response_mode?: 'mentioned' | 'always' | 'listen' | 'silent';
  workspace?: string;
  workspace_id?: string;     // NEW
  model?: string;
  failover_model?: string;
  thinking_level?: string;
  auto_approve?: boolean;
  runner?: 'tmux' | 'mcp';
  transport?: 'cli' | 'api' | 'mcp' | 'local';
  capabilities?: string[];
  created_at?: number;
  registered_at?: number;
  rename_history?: Array<{ old_name: string; new_name: string; timestamp: number }>;
}
```

### 4.10 frontend/src/stores/chatStore.ts -- Record maps

**Current:** All `Record<string, ...>` maps are keyed by `agent.name`.

**After:** All `Record<string, ...>` maps rekey by `agent.id` (= `agent_id`).

**Changes to the ChatState interface (lines 97-121):**

| Field | Current Key | New Key |
|-------|-------------|---------|
| `thinkingStreams` | `agent.name` | `agent.id` |
| `_thinkingTimestamps` | `agent.name` | `agent.id` |
| `agentPresence` | `agent.name` | `agent.id` |
| `browserStates` | `agent.name` | `agent.id` |
| `terminalStreams` | `agent.name` | `agent.id` |
| `mcpLogs` | `agent.name` | `agent.id` |
| `workspaceChanges` | `agent.name` | `agent.id` |
| `agentReplay` | `agent.name` | `agent.id` |
| `fileDiffs` | `agent.name` | `agent.id` |

**Implementation detail:** The WebSocket events (`thinking_stream`, `agent_presence`, `browser_state`, `terminal_stream`, `workspace_change`, `agent_replay`, `file_diff`, `mcp_invocation`) currently include an `agent` field with the agent's name. After Phase 1A, they must also include `agent_id`. The frontend uses `agent_id` as the map key but displays the `agent` (name) field in the UI.

**setAgents cleanup logic (L226-244):** Currently builds `activeNames` set and cleans up by name. Change to build `activeIds` set and clean up by id.

### 4.11 Additional Files Using Agent Name as Key

Found via codebase search:

| File | Usage | Change |
|------|-------|--------|
| `backend/app.py` L663 | `DATA_DIR / f"{agent}_queue.jsonl"` | Remains name-based (Phase 1A) |
| `backend/app_helpers.py` L142 | `deps.DATA_DIR / f"{target}_queue.jsonl"` | Remains name-based |
| `backend/automations.py` L435 | `deps.DATA_DIR / f"{agent}_queue.jsonl"` | Remains name-based |
| `backend/plugin_sdk.py` L637 | `self._data_dir / f"{agent}_queue.jsonl"` | Remains name-based |
| `backend/router.py` | Agent name routing logic | No change (routes by name, which is fine) |
| `backend/mcp_proxy.py` | `agent_name` field on proxy | Phase 1B |
| `backend/wrapper_mcp.py` | MCP mode wrapper | Inherits from wrapper.py changes |
| `backend/a2a_bridge.py` | Agent-to-agent bridge | Phase 1B |
| `backend/remote_runner.py` | Remote agent runner | Phase 1B |
| `backend/memory_graph.py` | Knowledge graph | Phase 1B |

---

## 5. Provider Adapter Interface

### 5.1 Abstract Base Class

File: `backend/provider_adapter.py` (new file)

```python
from __future__ import annotations

import abc
from dataclasses import dataclass
from pathlib import Path


@dataclass
class InjectionResult:
    """Result of an identity injection attempt."""
    success: bool
    method: str          # 'system_prompt_file', 'context_file', 'cli_flag', etc.
    file_path: str       # Path to the file that was written (if any)
    error: str = ""      # Error message if success=False
    reinject_supported: bool = False  # Whether mid-session re-injection is possible


class ProviderAdapter(abc.ABC):
    """Abstract interface for provider-specific identity injection.

    Each provider (Claude, Codex, Gemini, etc.) has different mechanisms
    for injecting identity context and MCP configuration. This interface
    abstracts those differences.
    """

    @property
    @abc.abstractmethod
    def provider_name(self) -> str:
        """Return the base provider name (e.g., 'claude', 'codex')."""

    @abc.abstractmethod
    def inject_identity(
        self,
        agent_id: str,
        identity_text: str,
        worktree_path: Path,
    ) -> InjectionResult:
        """Inject identity text into the agent's workspace.

        This writes the appropriate context file(s) for the provider
        so the agent knows who it is when it starts.

        Args:
            agent_id: The agent's permanent UUID.
            identity_text: The full identity prompt text.
            worktree_path: The agent's working directory.

        Returns:
            InjectionResult with success status and file path.
        """

    @abc.abstractmethod
    def inject_mcp(
        self,
        server_url: str,
        token: str,
        worktree_path: Path,
    ) -> InjectionResult:
        """Configure MCP server connection for the agent.

        Writes the provider-specific MCP configuration so the agent
        can connect to the GhostLink MCP bridge.

        Args:
            server_url: The MCP server URL (e.g., http://127.0.0.1:8200/mcp).
            token: Bearer token for authentication.
            worktree_path: The agent's working directory.

        Returns:
            InjectionResult with success status.
        """

    @abc.abstractmethod
    def supports_mid_session_reinject(self) -> bool:
        """Whether this provider supports re-injecting identity mid-session.

        Some providers (like Claude) read the system prompt file on every
        turn, allowing identity updates without restart. Others (like Codex)
        only read AGENTS.md at startup.

        Returns:
            True if identity can be updated while the agent is running.
        """

    def reinject_identity(
        self,
        agent_id: str,
        identity_text: str,
        worktree_path: Path,
    ) -> bool:
        """Re-inject identity into a running agent session.

        Default implementation just calls inject_identity() and returns
        success. Providers that don't support re-injection should
        override this to return False.

        Args:
            agent_id: The agent's permanent UUID.
            identity_text: The updated identity prompt text.
            worktree_path: The agent's working directory.

        Returns:
            True if re-injection was performed successfully.
        """
        if not self.supports_mid_session_reinject():
            return False
        result = self.inject_identity(agent_id, identity_text, worktree_path)
        return result.success

    @abc.abstractmethod
    def get_instruction_file_path(self, worktree_path: Path) -> Path:
        """Return the path to the provider's instruction/context file.

        This is the file the provider reads for system instructions.
        Used for drift detection (hash the file, compare to soul_hash).

        Args:
            worktree_path: The agent's working directory.

        Returns:
            Absolute path to the instruction file.
        """
```

### 5.2 Concrete Adapters

#### ClaudeAdapter

```python
class ClaudeAdapter(ProviderAdapter):
    """Claude Code (Anthropic) — reads .claude/settings.json and system prompt files."""

    @property
    def provider_name(self) -> str:
        return "claude"

    def inject_identity(self, agent_id, identity_text, worktree_path):
        # Write to .ghostlink/identity.md in the worktree
        identity_dir = worktree_path / ".ghostlink"
        identity_dir.mkdir(parents=True, exist_ok=True)
        identity_file = identity_dir / "identity.md"
        identity_file.write_text(identity_text, "utf-8")
        return InjectionResult(
            success=True,
            method="system_prompt_file",
            file_path=str(identity_file),
            reinject_supported=True,
        )

    def inject_mcp(self, server_url, token, worktree_path):
        # Claude Code: --mcp-config flag pointing to a JSON file
        # File written by wrapper._write_claude_mcp_config()
        # This adapter just defines the pattern; actual file is written
        # by the MCP inject system in wrapper.py
        return InjectionResult(
            success=True,
            method="mcp_config_flag",
            file_path="",  # Set by caller
        )

    def supports_mid_session_reinject(self):
        return True
        # Claude Code re-reads --append-system-prompt-file on every turn

    def get_instruction_file_path(self, worktree_path):
        return worktree_path / ".ghostlink" / "identity.md"
```

**CLI flags:** `claude --mcp-config {path} --append-system-prompt-file {identity_file}`
**Reinject:** Supported. Claude Code re-reads the system prompt file on every turn.
**File location:** `{worktree}/.ghostlink/identity.md`

#### CodexAdapter

```python
class CodexAdapter(ProviderAdapter):
    @property
    def provider_name(self):
        return "codex"

    def inject_identity(self, agent_id, identity_text, worktree_path):
        # Codex reads AGENTS.override.md from the project root
        # Also respects CODEX_HOME env var for global config
        identity_file = worktree_path / "AGENTS.override.md"
        identity_file.write_text(identity_text, "utf-8")
        return InjectionResult(
            success=True,
            method="agents_override_file",
            file_path=str(identity_file),
            reinject_supported=False,
        )

    def inject_mcp(self, server_url, token, worktree_path):
        # Codex: -c mcp_servers.ghostlink.url="{url}"
        return InjectionResult(success=True, method="cli_flag", file_path="")

    def supports_mid_session_reinject(self):
        return False
        # Codex reads AGENTS.md only at startup

    def get_instruction_file_path(self, worktree_path):
        return worktree_path / "AGENTS.override.md"
```

**CLI flags:** `codex -c mcp_servers.ghostlink.url="{url}"`
**Environment:** `CODEX_HOME` can be set to isolate per-agent global config.
**Reinject:** NOT supported. AGENTS.override.md is read once at startup.
**File location:** `{worktree}/AGENTS.override.md`

#### GeminiAdapter

```python
class GeminiAdapter(ProviderAdapter):
    @property
    def provider_name(self):
        return "gemini"

    def inject_identity(self, agent_id, identity_text, worktree_path):
        # Gemini reads GEMINI.md from the project root
        identity_file = worktree_path / "GEMINI.md"
        identity_file.write_text(identity_text, "utf-8")
        return InjectionResult(
            success=True,
            method="gemini_md_file",
            file_path=str(identity_file),
            reinject_supported=True,
        )

    def inject_mcp(self, server_url, token, worktree_path):
        # Gemini: GEMINI_CLI_SYSTEM_SETTINGS_PATH env var pointing to settings JSON
        # Settings JSON contains mcpServers config
        return InjectionResult(success=True, method="env_settings_file", file_path="")

    def supports_mid_session_reinject(self):
        return True
        # Gemini re-reads GEMINI.md on each turn

    def get_instruction_file_path(self, worktree_path):
        return worktree_path / "GEMINI.md"
```

**Environment:** `GEMINI_CLI_SYSTEM_SETTINGS_PATH={path_to_settings.json}`
**Settings JSON:** Contains `mcpServers` config with `httpUrl` and `url` fields.
**Reinject:** Supported. GEMINI.md is re-read.
**File location:** `{worktree}/GEMINI.md`

#### GrokAdapter

```python
class GrokAdapter(ProviderAdapter):
    @property
    def provider_name(self):
        return "grok"

    def inject_identity(self, agent_id, identity_text, worktree_path):
        grok_dir = worktree_path / ".grok"
        grok_dir.mkdir(parents=True, exist_ok=True)
        identity_file = grok_dir / "GROK.md"
        identity_file.write_text(identity_text, "utf-8")
        return InjectionResult(
            success=True,
            method="grok_md_file",
            file_path=str(identity_file),
            reinject_supported=True,
        )

    def inject_mcp(self, server_url, token, worktree_path):
        # Grok: --mcp-config flag (same pattern as Claude)
        return InjectionResult(success=True, method="mcp_config_flag", file_path="")

    def supports_mid_session_reinject(self):
        return True

    def get_instruction_file_path(self, worktree_path):
        return worktree_path / ".grok" / "GROK.md"
```

**CLI flags:** `grok --mcp-config {path}`
**Reinject:** Supported.
**File location:** `{worktree}/.grok/GROK.md`

#### AiderAdapter

```python
class AiderAdapter(ProviderAdapter):
    @property
    def provider_name(self):
        return "aider"

    def inject_identity(self, agent_id, identity_text, worktree_path):
        # Aider: .aider.conf.yml with read parameter pointing to identity file
        identity_file = worktree_path / ".ghostlink" / "identity.md"
        identity_file.parent.mkdir(parents=True, exist_ok=True)
        identity_file.write_text(identity_text, "utf-8")

        # Write .aider.conf.yml
        conf_file = worktree_path / ".aider.conf.yml"
        conf_content = f"read:\n  - {identity_file.name}\n"
        # Merge with existing conf if present
        if conf_file.exists():
            existing = conf_file.read_text("utf-8")
            if "read:" not in existing:
                conf_content = existing.rstrip() + "\n" + conf_content
            # else: existing read config takes precedence
            else:
                conf_content = existing  # don't overwrite existing read config

        conf_file.write_text(conf_content, "utf-8")
        return InjectionResult(
            success=True,
            method="aider_conf_read",
            file_path=str(identity_file),
            reinject_supported=False,
        )

    def inject_mcp(self, server_url, token, worktree_path):
        # Aider doesn't natively support MCP -- uses proxy
        return InjectionResult(success=True, method="proxy", file_path="")

    def supports_mid_session_reinject(self):
        return False

    def get_instruction_file_path(self, worktree_path):
        return worktree_path / ".ghostlink" / "identity.md"
```

**CLI flags:** `aider --read {identity_file} --yes`
**Config:** `.aider.conf.yml` with `read:` directive.
**Reinject:** NOT supported.
**File location:** `{worktree}/.ghostlink/identity.md`

#### GooseAdapter

```python
class GooseAdapter(ProviderAdapter):
    @property
    def provider_name(self):
        return "goose"

    def inject_identity(self, agent_id, identity_text, worktree_path):
        identity_file = worktree_path / ".goosehints"
        identity_file.write_text(identity_text, "utf-8")
        return InjectionResult(
            success=True,
            method="goosehints_file",
            file_path=str(identity_file),
            reinject_supported=True,
        )

    def inject_mcp(self, server_url, token, worktree_path):
        # Goose: GOOSE_MCP_CONFIG env var
        return InjectionResult(success=True, method="env_config", file_path="")

    def supports_mid_session_reinject(self):
        return True

    def get_instruction_file_path(self, worktree_path):
        return worktree_path / ".goosehints"
```

**Environment:** `GOOSE_MCP_CONFIG={path_to_config.json}`
**Reinject:** Supported.
**File location:** `{worktree}/.goosehints`

#### CopilotAdapter

```python
class CopilotAdapter(ProviderAdapter):
    @property
    def provider_name(self):
        return "copilot"

    def inject_identity(self, agent_id, identity_text, worktree_path):
        identity_file = worktree_path / ".agent.md"
        identity_file.write_text(identity_text, "utf-8")
        return InjectionResult(
            success=True,
            method="agent_md_file",
            file_path=str(identity_file),
            reinject_supported=False,
        )

    def inject_mcp(self, server_url, token, worktree_path):
        # Copilot doesn't natively support MCP -- uses proxy
        return InjectionResult(success=True, method="proxy", file_path="")

    def supports_mid_session_reinject(self):
        return False

    def get_instruction_file_path(self, worktree_path):
        return worktree_path / ".agent.md"
```

**CLI flags:** `gh copilot chat`
**Reinject:** NOT supported.
**File location:** `{worktree}/.agent.md`

#### OllamaAdapter

```python
class OllamaAdapter(ProviderAdapter):
    @property
    def provider_name(self):
        return "ollama"

    def inject_identity(self, agent_id, identity_text, worktree_path):
        # Ollama: --system flag with inline text
        # Write to file for reference, but actual injection is via CLI flag
        identity_file = worktree_path / ".ghostlink" / "identity.md"
        identity_file.parent.mkdir(parents=True, exist_ok=True)
        identity_file.write_text(identity_text, "utf-8")
        return InjectionResult(
            success=True,
            method="system_flag",
            file_path=str(identity_file),
            reinject_supported=False,
        )

    def inject_mcp(self, server_url, token, worktree_path):
        # Ollama doesn't support MCP natively
        return InjectionResult(success=True, method="none", file_path="")

    def supports_mid_session_reinject(self):
        return False

    def get_instruction_file_path(self, worktree_path):
        return worktree_path / ".ghostlink" / "identity.md"
```

**CLI flags:** `ollama run {model} --system "{identity_text}"`
**Reinject:** NOT supported (system prompt set at start).
**File location:** `{worktree}/.ghostlink/identity.md` (reference copy)

### 5.3 Adapter Registry

```python
_ADAPTERS: dict[str, type[ProviderAdapter]] = {
    "claude": ClaudeAdapter,
    "codex": CodexAdapter,
    "gemini": GeminiAdapter,
    "grok": GrokAdapter,
    "aider": AiderAdapter,
    "goose": GooseAdapter,
    "copilot": CopilotAdapter,
    "ollama": OllamaAdapter,
}

def get_adapter(base: str) -> ProviderAdapter:
    """Get the adapter for a provider base name."""
    cls = _ADAPTERS.get(base)
    if cls is None:
        # Fallback: generic adapter that writes .ghostlink/identity.md
        return GenericAdapter(base)
    return cls()
```

### 5.4 Integration with wrapper.py

The adapter system replaces the current inline identity injection logic in `wrapper.py` (L916-960). The wrapper calls:

```python
adapter = get_adapter(agent)
result = adapter.inject_identity(agent_id, context_text, project_dir)
if result.success:
    log.info("Identity injected via %s to %s", result.method, result.file_path)
```

This is called after registration but before launching the agent CLI process.

---

## 6. API Changes

### 6.1 Registration Response

**Before:**
```json
{
  "name": "claude",
  "base": "claude",
  "label": "Claude",
  "color": "#e8734a",
  "slot": 1,
  "state": "active",
  "token": "abc123...",
  "registered_at": 1712345678.0,
  ...
}
```

**After:**
```json
{
  "agent_id": "019...",
  "session_id": "019...",
  "name": "claude",
  "base": "claude",
  "label": "Claude",
  "color": "#e8734a",
  "slot": 1,
  "state": "active",
  "token": "abc123...",
  "registered_at": 1712345678.0,
  "created_at": 1712345678.0,
  ...
}
```

### 6.2 Dual Lookup on All Agent Endpoints

All endpoints currently using `{name}` path parameter will accept both name and UUID:

```python
def _resolve_agent_param(identifier: str) -> AgentIdentityRecord | None:
    """Resolve an agent by name or agent_id."""
    # Try as agent_id first (UUID format)
    inst = deps.registry.get_by_id(identifier)
    if inst:
        return inst
    # Fall back to name lookup
    return deps.registry.get_by_name(identifier)
```

**No URL changes.** The path remains `/api/agents/{name}` but the `{name}` parameter can now be either a name or a UUID. This preserves backward compatibility with existing frontend code and wrapper processes.

### 6.3 New Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agents/{id}/rename` | POST | Rename an agent. Body: `{"name": "new-name"}`. Records in rename_history. |
| `/api/agents/{id}/session` | GET | Get current session_id and session metadata. |

### 6.4 Modified Endpoints

| Endpoint | Change |
|----------|--------|
| `GET /api/status` | Each agent dict in `agents` array now includes `id` (agent_id), `session_id` |
| `POST /api/register` | Response includes `agent_id`, `session_id` |
| `POST /api/heartbeat` | Response includes `agent_id` for identity confirmation |
| All `/api/agents/{name}/*` | Accept both name and agent_id as the path parameter |

### 6.5 Breaking Changes

1. **Field renames in API responses:** `responseMode` -> `response_mode`, `thinkingLevel` -> `thinking_level`, `autoApprove` -> `auto_approve`, `failoverModel` -> `failover_model`. The frontend must update to use snake_case field names.

2. **Mitigation:** During migration, the backend can return BOTH camelCase and snake_case versions of renamed fields for one release cycle:
   ```python
   d["response_mode"] = d["responseMode"] = inst.response_mode
   ```

---

## 7. Frontend Changes

### 7.1 Agent Interface Update

See Section 4.9 for the full new interface. The key addition is the `id` field (agent_id).

### 7.2 Record Map Rekeying

Every `Record<string, ...>` map in `chatStore.ts` that is keyed by agent name must be rekeyed by `agent.id`.

**Affected fields and their setter functions:**

| Field | Setter | Current Key Source | New Key Source |
|-------|--------|-------------------|----------------|
| `thinkingStreams` | `setThinkingStream(agent, ...)` | `agent` (name string) | `agent` (id string, from WS event's `agent_id` field) |
| `agentPresence` | `setAgentPresence(presence)` | `presence.agent` (name) | `presence.agent_id` (new field in WS event) |
| `browserStates` | `setBrowserState(state)` | `state.agent` (name) | `state.agent_id` |
| `terminalStreams` | `setTerminalStream(stream)` | `stream.agent` (name) | `stream.agent_id` |
| `mcpLogs` | `addMcpInvocation(agent, entry)` | `agent` (name) | `agent` (id, passed by caller) |
| `workspaceChanges` | `addWorkspaceChange(change)` | `change.agent` (name) | `change.agent_id` |
| `agentReplay` | `addAgentReplayEvent(event)` | `event.agent` (name) | `event.agent_id` |
| `fileDiffs` | `setFileDiff(diff)` | `diff.agent` (name) | `diff.agent_id` |

### 7.3 Agent Display Logic

The UI continues to display `agent.name` (or `agent.label`) everywhere users see agent names. The `id` is used only for internal keying. Components that need to look up agent data by name (e.g., when parsing @mentions in chat messages) use a helper:

```typescript
function findAgentByName(agents: Agent[], name: string): Agent | undefined {
  return agents.find(a => a.name === name);
}

function findAgentById(agents: Agent[], id: string): Agent | undefined {
  return agents.find(a => a.id === id);
}
```

### 7.4 WebSocket Event Handling

The WebSocket event handler in the frontend must be updated to extract `agent_id` from events and use it as the map key. The `agent` (name) field remains in events for display purposes.

**Example change for thinking_stream:**

```typescript
// Before:
case 'thinking_stream':
  useChatStore.getState().setThinkingStream(data.agent, data.text, data.active);
  break;

// After:
case 'thinking_stream':
  useChatStore.getState().setThinkingStream(data.agent_id || data.agent, data.text, data.active);
  break;
```

The `|| data.agent` fallback ensures backward compatibility during rollout.

### 7.5 Components Requiring Changes

Any component that:
1. Reads from a `Record<string, ...>` map using `agent.name` as key
2. Passes agent name to API calls where agent_id would be better
3. Uses `cockpitAgent` (currently stores name, should store id)

Specific components to audit (non-exhaustive):
- Agent bar (displays agents, opens cockpit)
- Cockpit panel (all data lookups)
- Chat message renderer (resolves agent names for avatars)
- Typing indicator
- Settings panel (agent configuration)

---

## 8. Regression Risk Map

### 8.1 Registry Rekey

| Risk | What Breaks | Detection | Rollback | Test |
|------|------------|-----------|----------|------|
| `registry.get(name)` returns None | All endpoints using `registry.get(name)` return 404 | Any API call to `/api/agents/{name}/*` returns 404 for a known-active agent | Revert `get()` to use `_instances[name]` directly | Test: register agent, call `registry.get(name)`, assert not None |
| `_name_index` out of sync with `_instances` | Agent found by id but not by name, or vice versa | Heartbeat fails, agent shows as offline | Add assertion in `register()` and `deregister()` that indices are consistent | Test: register, rename, deregister -- check indices at each step |
| `resolve_token()` regression | MCP tool calls fail with "stale or unknown token" | Agent stops responding to @mentions | Fall back to linear scan if `_token_index` misses | Test: register, call resolve_token, assert match |

### 8.2 Data Path Change

| Risk | What Breaks | Detection | Rollback | Test |
|------|------------|-----------|----------|------|
| Memory saved to old path, read from new path | Agent memories appear empty | `memory_list` returns empty for an agent that has saved memories | Check both paths in `_resolve_key_path` | Test: save memory, change path convention, load memory |
| Soul not found after path change | Agent spawns without identity | Agent introduces itself generically instead of with its role | Fall back to old path if new path doesn't exist | Test: set soul at old path, verify it loads from new path after migration |
| Migration misses some directories | Orphaned data under old path | Startup log shows "orphaned data" warnings | Keep old directories, don't delete during migration | Test: create data at old path, run migration, verify data at new path |

### 8.3 API Field Renames

| Risk | What Breaks | Detection | Rollback | Test |
|------|------------|-----------|----------|------|
| Frontend reads `responseMode`, backend sends `response_mode` | Agent config panel shows undefined values | Visual inspection of agent config panel | Send both field names during migration period | Test: verify API response contains both camelCase and snake_case fields |

### 8.4 Frontend Rekey

| Risk | What Breaks | Detection | Rollback | Test |
|------|------------|-----------|----------|------|
| Cockpit data lookups return undefined | Cockpit panel shows blank for active agent | Open cockpit for any agent, verify data appears | Fall back to name-based key if id-based lookup returns undefined | Test: spawn agent, open cockpit, verify thinking stream / terminal / presence all render |
| Typing indicator breaks | No typing indicator appears when agents are active | Watch chat while agent is responding | Ensure WS events include both `agent` and `agent_id` | Test: trigger agent response, verify typing indicator |
| setAgents cleanup deletes data for active agents | Cockpit data disappears intermittently | Agent data flickers in/out of cockpit panel | Ensure `activeIds` set matches current agent list | Test: spawn 3 agents, verify all cockpit data persists across status updates |

### 8.5 SQLite Persistence

| Risk | What Breaks | Detection | Rollback | Test |
|------|------------|-----------|----------|------|
| WAL mode not enabled | Concurrent writes block (busy errors under load) | SQLite "database is locked" errors in logs | Verify PRAGMA journal_mode returns 'wal' on startup | Test: concurrent register calls, verify no lock errors |
| Thread-local connection not isolated | "ProgrammingError: SQLite objects created in a thread can only be used in that same thread" | Crash/500 on any agent API call | Use `check_same_thread=False` and thread-local storage | Test: call registry from multiple threads concurrently |
| DB file permissions | Server can't create/write ghostlink.db | Startup crash with PermissionError | Fall back to in-memory-only mode with warning | Test: run server, verify DB file created with correct permissions |

### 8.6 Provider Adapters

| Risk | What Breaks | Detection | Rollback | Test |
|------|------------|-----------|----------|------|
| Identity file written to wrong path | Agent starts without identity | Agent doesn't know its name or role | `get_instruction_file_path()` returns the expected path; verify file exists after injection | Test: inject identity, verify file at expected path |
| MCP config not merged with existing | Agent loses project-specific MCP servers | Agent can't use project tools | Preserve `_read_project_mcp_servers()` merge logic | Test: create .mcp.json with custom server, spawn agent, verify both servers in config |

---

## 9. Acceptance Tests

### 9.1 Two Same-Model Agents Coexist with Isolated Identity

```
GIVEN the server is running
WHEN I spawn two Claude agents (claude and claude-2)
THEN each has a unique agent_id (UUID v7)
AND each has a unique session_id
AND each has a separate memory directory: data/agents/{agent_id}/memory/
AND each has a separate soul file: data/agents/{agent_id}/soul.txt
AND each has a separate worktree: .ghostlink-worktrees/{agent_id}/
AND memory_save from claude does NOT appear in claude-2's memory_list
AND chat_who shows both agents with correct names
```

### 9.2 Rename an Agent

```
GIVEN agent "claude" is registered with agent_id "019-abc..."
WHEN I POST /api/agents/claude/rename with {"name": "architect"}
THEN the agent's name changes to "architect"
AND the agent's agent_id remains "019-abc..."
AND rename_history contains [{"old_name": "claude", "new_name": "architect", ...}]
AND registry.get_by_name("architect") returns the agent
AND registry.get_by_name("claude") returns None
AND registry.get_by_id("019-abc...") returns the agent with name="architect"
AND the agent's memory directory does NOT change (still data/agents/{agent_id}/memory/)
AND the agent's soul file does NOT change (still data/agents/{agent_id}/soul.txt)
AND skills_config.json still maps to the same agent (by agent_id, not name)
AND the queue file path updates to {new_name}_queue.jsonl
AND @mentions using the new name trigger the agent
```

### 9.3 Server Restart Recovery

```
GIVEN agents "claude" and "gemini" are registered and active
WHEN the server process restarts
THEN on startup, the DB contains both agents with state="offline"
AND the in-memory cache is populated from DB
AND when claude's wrapper re-registers (POST /api/register with base="claude")
THEN the server matches to the existing agent_id (by base + slot)
AND a new session_id is generated
AND the token is rotated
AND state is set to "active"
AND the agent_id in the response matches the original
```

### 9.4 Kill and Respawn

```
GIVEN agent "claude" has agent_id "019-abc..." and session_id "019-def..."
WHEN I POST /api/kill-agent/claude
THEN the agent's state is set to "offline" in DB
AND in-memory cache is updated
WHEN I POST /api/spawn-agent with {"base": "claude"}
THEN the new registration matches to agent_id "019-abc..."
AND a new session_id "019-ghi..." is generated (different from "019-def...")
AND the agent's memory, soul, notes are preserved (same agent_id directory)
```

### 9.5 Delegation Records parent_agent_id

```
GIVEN agent "claude" (agent_id "019-abc...") is active
WHEN "claude" calls the delegate MCP tool to spawn a worker
THEN the new agent has parent_agent_id = "019-abc..."
AND the new agent has its own unique agent_id
AND chat_who shows the parent relationship
```

### 9.6 Token Rotation

```
GIVEN agent "claude" has token "token-1"
WHEN the token expires (after token_ttl seconds)
AND the wrapper sends a heartbeat
THEN the server rotates the token to "token-2"
AND the heartbeat response includes the new token
AND the wrapper updates its local token
AND the MCP proxy updates its token
AND subsequent MCP tool calls use "token-2"
AND the agent_id does NOT change
AND the session_id does NOT change
```

### 9.7 MCP Tool Calls Resolve to Correct agent_id

```
GIVEN agents "claude" (agent_id "019-abc...") and "claude-2" (agent_id "019-def...")
WHEN claude-2 calls memory_save(sender="claude-2", key="test", content="hello")
THEN the memory is saved to data/agents/019-def.../memory/test.json
AND NOT to data/agents/019-abc.../memory/
AND memory_list(sender="claude-2") returns ["test"]
AND memory_list(sender="claude") does NOT include "test"
```

### 9.8 Memory Paths Use agent_id

```
GIVEN agent "claude" has agent_id "019-abc..."
WHEN memory is saved via MCP (memory_save) with key "project_notes"
THEN the file is created at data/agents/019-abc.../memory/project_notes.json
AND when accessed via API (GET /api/agents/claude/memories)
THEN the same file is read (because both resolve to the same agent_id path)
```

### 9.9 Worktree Paths Use agent_id

```
GIVEN agent "claude" has agent_id "019-abc..."
WHEN the agent is registered and worktree isolation is enabled
THEN the worktree is created at .ghostlink-worktrees/019-abc.../
AND the git branch is named ghostlink-019-abc...
AND after a rename to "architect", the worktree path does NOT change
```

### 9.10 Frontend Correctly Displays by Name, Keys by ID

```
GIVEN agent "claude" with agent_id "019-abc..." is active and thinking
WHEN the frontend receives a thinking_stream WS event with agent_id="019-abc...", agent="claude"
THEN the thinking stream is stored in thinkingStreams["019-abc..."]
AND the UI displays "claude" (or the label) next to the thinking indicator
AND the cockpit panel shows data for agent_id "019-abc..."
AND after a rename to "architect", the thinking stream data is NOT lost
  (because the map key "019-abc..." didn't change)
```

---

## 10. Rollback Plan

### 10.1 Feature Flag

A feature flag `GHOSTLINK_IDENTITY_V2` controls whether the new identity system is active:

```python
# In backend/deps.py or config.toml
IDENTITY_V2 = os.environ.get("GHOSTLINK_IDENTITY_V2", "1") == "1"
```

When `IDENTITY_V2 = False`:
- `AgentRegistry` uses the old `AgentInstance` class and name-keyed dict.
- No SQLite persistence (in-memory only, as before).
- Data paths remain unchanged.
- API responses use camelCase field names.
- Frontend uses name-keyed maps.

When `IDENTITY_V2 = True` (default after Phase 1A merge):
- Full new behavior.

### 10.2 Database Backward Migration

If Phase 1A is deployed and then rolled back:

1. The `data/ghostlink.db` file is ignored (old code doesn't read it).
2. Agent state returns to purely in-memory (lost on restart, as before).
3. Data directories under `data/agents/{agent_id}/` are NOT automatically moved back to `data/{name}/`.

**Manual migration script for rollback:**

```python
#!/usr/bin/env python3
"""Rollback Phase 1A: move agent data from UUID dirs back to name dirs."""
import json
import sqlite3
from pathlib import Path

db = sqlite3.connect("data/ghostlink.db")
db.row_factory = sqlite3.Row

for row in db.execute("SELECT agent_id, name FROM agents"):
    agent_id = row["agent_id"]
    name = row["name"]
    src = Path("data/agents") / agent_id
    dst = Path("data/agents") / name
    if src.exists() and not dst.exists():
        src.rename(dst)
        print(f"Moved {src} -> {dst}")

db.close()
```

### 10.3 Git Revert Strategy

All Phase 1A changes are made in a single feature branch (`phase-1a-identity`). To revert:

```bash
git revert --no-commit HEAD~N..HEAD  # where N = number of Phase 1A commits
git commit -m "Revert Phase 1A identity changes"
```

The frontend and backend changes must be reverted together. Partial reverts (e.g., backend only) will break the system.

### 10.4 Data Safety

- The SQLite database is additive (no existing data is deleted).
- The data directory migration copies/renames but does NOT delete the original until confirmed.
- The `skills_config.json` migration preserves the original keys if resolution fails.
- All migration steps are logged for audit.

---

## Appendix A: File Impact Summary

| File | Scope of Change | Phase |
|------|----------------|-------|
| `backend/registry.py` | Major rewrite: new dataclass, UUID keys, SQLite, indexes | 1A |
| `backend/agent_memory.py` | Moderate: accept agent_id, update paths | 1A |
| `backend/skills.py` | Moderate: rekey dicts, migration function | 1A |
| `backend/worktree.py` | Moderate: rekey dict, update paths | 1A |
| `backend/wrapper.py` | Minor: add agent_id to identity, update soul path | 1A |
| `backend/mcp_bridge.py` | Minor: add _resolve_agent_id helper, update memory paths | 1A |
| `backend/deps.py` | Minor: add feature flag, no dict rekey yet | 1A |
| `backend/routes/agents.py` | Moderate: dual lookup, update data paths, agent_id in responses | 1A |
| `backend/provider_adapter.py` | New file: abstract + 8 concrete adapters | 1A |
| `frontend/src/types/index.ts` | Minor: add id field and new optional fields | 1A |
| `frontend/src/stores/chatStore.ts` | Moderate: rekey all Record maps by id | 1A |
| `backend/mcp_proxy.py` | Deferred | 1B |
| `backend/a2a_bridge.py` | Deferred | 1B |
| `backend/remote_runner.py` | Deferred | 1B |
| `backend/memory_graph.py` | Deferred | 1B |
| `backend/router.py` | No change needed | - |
| `backend/app.py` | Minor: pass db_path to registry constructor | 1A |

## Appendix B: Invariants

These invariants MUST hold at all times after Phase 1A:

1. **agent_id is permanent.** Once assigned, an agent_id NEVER changes, even across renames, restarts, or server migrations.
2. **session_id is ephemeral.** A new session_id is generated on every spawn/restart.
3. **name is unique among active agents.** Two active agents cannot share the same name. Offline agents may share names with active ones (the active one wins in name resolution).
4. **token maps to exactly one agent.** The token index has no collisions.
5. **Data paths use agent_id.** All persistent agent data (memory, soul, notes, artifacts) is stored under `data/agents/{agent_id}/`.
6. **Queue/approval files use name.** Ephemeral trigger files remain name-based (Phase 1A only).
7. **The DB is the source of truth.** The in-memory cache is a performance optimization. On any inconsistency, the DB wins.
8. **Backward compatibility via dual lookup.** Any endpoint accepting a name also accepts an agent_id. Name-based lookups continue to work.
