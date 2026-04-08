# Phase 1A Implementation Spec: Identity Foundation Lock

**Version:** 2.0  
**Date:** 2026-04-07  
**Status:** Audited locked spec  
**Scope:** Backend-only identity foundation work

---

## Audit Lock

This document replaces the earlier oversized Phase 1A draft.

The prior draft pulled four separate problems into one phase:
- stable storage identity
- registry/database persistence
- wrapper re-registration and reconnect semantics
- provider/runtime injection and frontend rekeying

That was a bad trade. The live codebase does not support a safe big-bang version of that plan.

**Phase 1A is now locked to four deliverables only:**
1. Stable `agent_id` added to registry records
2. SQLite persistence for registry state
3. Dual name/ID lookup compatibility
4. Unified memory/soul/notes paths under `data/agents/{agent_id}/`

Everything else is deferred.

---

## 1. What Phase 1A Does

### Goals

- Stop treating display name as the only durable identity handle
- Persist registry rows so agent state is not purely in-memory
- Let backend routes resolve an agent by either display name or `agent_id`
- Move persistent agent data off `data/{agent_name}/...` and onto an ID-keyed path

### Explicit non-goals

These are **not** part of Phase 1A:

- no provider adapter abstraction
- no new `backend/provider_adapter.py`
- no frontend `chatStore` rekey
- no WebSocket payload contract change that forces frontend ID adoption
- no worktree key migration
- no queue/approval file migration away from display names
- no restart/reconnect protocol redesign for ambiguous same-base agents
- no full identity schema with `task_id`, `context_id`, `trace_id`, `profile_id`, or `parent_agent_id`
- no backend-wide snake_case API migration

Those items move to later phases:
- runtime/provider injection: Phase 1B
- frontend/operator ID adoption: after backend compatibility lands
- worktree isolation and worktree key migration: Phase 5
- trace/task/profile expansion: Phases 2 and 3+

---

## 2. Current Code Reality

Verified against the live code on 2026-04-07:

- `backend/registry.py` stores agents in `_instances: dict[str, AgentInstance]` keyed by display name only.
- `POST /api/register` in [backend/routes/agents.py](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/backend/routes/agents.py) allocates a fresh runtime name from `base` and slot. It does not support robust reattachment to a prior persisted record.
- `backend/agent_memory.py` stores memory, soul, and notes at `data/{agent_name}/...`.
- `backend/worktree.py` is still keyed by agent name.
- `frontend/src/stores/chatStore.ts` is still keyed by agent name.
- No `backend/provider_adapter.py` exists.

This means Phase 1A must be limited to foundation work that does not require a wrapper protocol redesign or a frontend state rewrite.

---

## 3. Deliverable 1: Stable `agent_id`

### 3.1 Registry record

Extend `AgentInstance` with one new durable field:

```python
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
    token_issued_at: float = field(default_factory=time.time)
    token_ttl: float = field(default_factory=lambda: TOKEN_TTL)
    role: str = ""
    workspace: str = ""
    responseMode: str = "mentioned"
    thinkingLevel: str = ""
    model: str = ""
    failoverModel: str = ""
    autoApprove: bool = False
    runner: str = "tmux"
```

### 3.2 ID format

- Use `uuid.uuid4().hex` for Phase 1A.
- Do **not** introduce UUID v7 in this phase.
- Time-sortable IDs are nice, but they are not worth adding a new dependency before the core migration is stable.

### 3.3 Stability guarantee

Phase 1A guarantees:
- every live agent record gets a stable `agent_id`
- persistent agent storage uses `agent_id`, not display name
- rename-safe storage becomes possible

Phase 1A does **not** guarantee:
- perfect `agent_id` reuse across backend restarts for multiple same-base agents
- wrapper/session reattachment without ambiguity

That reconnect problem is deferred because the current `/api/register` contract does not carry enough identity to solve it safely.

---

## 4. Deliverable 2: SQLite Registry Persistence

### 4.1 Database file

Use the existing runtime GhostLink SQLite database, which is currently:

```text
data/ghostlink_v2.db
```

Do not create a second identity-specific database.

Audit note: some ops/backup code still references the old `ghostlink.db` name. Phase 1A must extend the live runtime DB, not revive the deprecated filename.

### 4.2 Schema

Add one table for persisted registry rows:

```sql
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
    workspace        TEXT NOT NULL DEFAULT '',
    response_mode    TEXT NOT NULL DEFAULT 'mentioned',
    thinking_level   TEXT NOT NULL DEFAULT '',
    model            TEXT NOT NULL DEFAULT '',
    failover_model   TEXT NOT NULL DEFAULT '',
    auto_approve     INTEGER NOT NULL DEFAULT 0,
    runner           TEXT NOT NULL DEFAULT 'tmux'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_live_name ON agents(name);
CREATE INDEX IF NOT EXISTS idx_agents_base ON agents(base);
CREATE INDEX IF NOT EXISTS idx_agents_slot ON agents(base, slot);
CREATE INDEX IF NOT EXISTS idx_agents_state ON agents(state);
```

### 4.3 Naming rule

Database columns use snake_case.

API responses remain backward compatible with current frontend field names:
- keep `responseMode`
- keep `thinkingLevel`
- keep `failoverModel`
- keep `autoApprove`

The DB can be clean without forcing a frontend contract break in the same phase.

### 4.4 Persistence behavior

- On successful register, write or update the agent row.
- On deregister, mark the row `offline`; do not delete it.
- On backend startup, load rows into an offline cache if needed, but do not pretend that ambiguous wrapper reattachment is solved.
- Token rotation and current runtime state continue to work from the in-memory instance first, then persist back to SQLite.

---

## 5. Deliverable 3: Dual Name/ID Lookup

### 5.1 Registry API additions

Add:

```python
def get_by_id(self, agent_id: str) -> AgentInstance | None: ...
def get_by_name(self, name: str) -> AgentInstance | None: ...
def resolve(self, identifier: str) -> AgentInstance | None: ...
```

`resolve()` tries `agent_id` first, then falls back to `name`.

### 5.2 Route behavior

Existing routes keep their current path shape:

```text
/api/agents/{name}/...
```

But `{name}` now becomes a generic identifier parameter in the backend resolver. That preserves frontend compatibility while enabling backend use of `agent_id`.

### 5.3 Compatibility rule

- Display name remains the primary operator-facing identifier.
- `agent_id` becomes the durable storage/API-safe identifier.
- Phase 1A must not require any frontend route rewrite.

---

## 6. Deliverable 4: Path Unification

### 6.1 New canonical layout

Persistent agent data moves to:

```text
data/agents/{agent_id}/memory/
data/agents/{agent_id}/soul.txt
data/agents/{agent_id}/notes.txt
```

### 6.2 Compatibility behavior

Phase 1A must support existing data under:

```text
data/{agent_name}/memory/
data/{agent_name}/soul.txt
data/{agent_name}/notes.txt
```

Resolution order:
1. canonical ID path
2. legacy name path

If legacy data is found, migrate it forward into the canonical path.

### 6.3 Scope boundary

Only these persistent paths are changing in Phase 1A:
- memory
- soul
- notes

These remain name-based for now:
- queue files
- approval files
- worktree paths
- provider config filenames

That split is intentional. Phase 1A fixes durable state first and leaves ephemeral/runtime IPC alone.

---

## 7. Re-registration and Restart Boundaries

This is the blocker that killed the previous draft.

### 7.1 What is deferred

The following are **out of scope** for Phase 1A:

- matching a reconnecting wrapper to a prior persisted row when multiple same-base agents exist
- preserving `agent_id` across ambiguous restart order
- issuing a new `session_id` on every re-register
- seamless wrapper-to-record reattachment after backend crash/restart

### 7.2 Why it is deferred

Current `/api/register` only receives `base`, optional label/color/role, and runtime metadata.
It does not carry a durable wrapper identity that can safely disambiguate:
- old `claude`
- old `claude-2`
- new `claude`
- reconnecting `claude-2`

Trying to fake that match in Phase 1A would create silent identity swaps, which is worse than admitting the gap.

### 7.3 What Phase 1A does instead

Phase 1A lays the storage groundwork:
- durable `agent_id`
- persisted rows
- ID-safe storage paths
- name/ID route compatibility

Full reconnect semantics move to a later phase with an explicit wrapper protocol change.

---

## 8. API Contract

### 8.1 Registration response

`POST /api/register` now includes `agent_id` in the response.

It does **not** introduce a new required frontend contract beyond that.

### 8.2 Status payload

`GET /api/status` includes `agent_id` for each agent.

Frontend may ignore it in Phase 1A.

### 8.3 No forced camelCase break

Do not convert current config fields to snake_case in API responses during Phase 1A.

That change would drag frontend work into a backend foundation phase for no payoff.

---

## 9. File Ownership

### `tyson` only

Phase 1A is backend-only.

Primary files:
- [backend/registry.py](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/backend/registry.py)
- [backend/routes/agents.py](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/backend/routes/agents.py)
- [backend/agent_memory.py](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/backend/agent_memory.py)
- [backend/mcp_bridge.py](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/backend/mcp_bridge.py)
- [backend/deps.py](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/backend/deps.py)
- backend persistence/test helpers as needed

Not in Phase 1A ownership:
- no `frontend/src/stores/chatStore.ts`
- no `frontend/src/hooks/useWebSocket.ts`
- no `backend/worktree.py` key migration
- no provider-specific wrapper injection redesign

---

## 10. Acceptance Tests

### T1. Register assigns a durable ID

Given a freshly registered agent:
- response includes `agent_id`
- registry resolves by both `name` and `agent_id`
- public status payload includes `agent_id`

### T2. Persistent row exists

After register:
- SQLite `agents` table contains one row for the agent
- row uses the same `agent_id`
- deregister marks `state='offline'` rather than deleting the row

### T3. Dual lookup works on routes

For a route such as soul/notes/memories:
- `/api/agents/{name}/...` works
- `/api/agents/{agent_id}/...` also works

### T4. Memory path uses `agent_id`

Saving memory for an agent writes to:

```text
data/agents/{agent_id}/memory/{key}.json
```

and not the legacy display-name path.

### T5. Legacy path migration works

If legacy files exist under `data/{name}/...`:
- first read/write migrates them into `data/agents/{agent_id}/...`
- subsequent reads use the canonical path

### T6. Rename-safe storage

If an agent display label or name changes later:
- `agent_id` storage path does not move
- memory/soul/notes remain readable from the same canonical directory

---

## 11. Rollback

### Code rollback

- Revert backend-only identity changes together.
- API contract remains backward compatible, so rollback impact is limited to loss of `agent_id` support.

### Data rollback

- SQLite row data is additive.
- Canonical ID-keyed directories remain valid even if old code ignores them.
- No automatic reverse-migration of files back to display-name directories is required in rollback.

---

## 12. Deferred Follow-up List

These items must stay out of Phase 1A and be handled later:

- wrapper/session re-registration protocol
- provider-specific injection abstraction
- frontend store rekey to `agent_id`
- WebSocket payload expansion to carry `agent_id`
- worktree key migration
- artifact/task/trace/profile linkage on the identity record

If any implementation plan for Phase 1A includes those, it is out of spec.
