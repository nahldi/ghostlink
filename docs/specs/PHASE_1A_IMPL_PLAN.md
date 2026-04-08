# Phase 1A Implementation Plan

**For:** tyson (backend execution agent)
**Spec:** `docs/specs/PHASE_1A_SPEC.md` v2.0
**Prerequisites:** Gate 0 passes (all tests green, tree clean)
**Estimated effort:** 12-18 hours across 6 steps

---

## Build Sequence

Do these in order. Each step ends with "run all tests, verify nothing broke." Do NOT skip ahead.

### Step 0: Fix the backup/health DB name bug (pre-Phase 1A cleanup)

**Why first:** `routes/misc.py` references `ghostlink.db` but the live DB is `ghostlink_v2.db`. If we don't fix this now, the backup/restore system will interact with the wrong file after Phase 1A adds an `agents` table to `ghostlink_v2.db`.

**Files:** `backend/routes/misc.py`

**Changes:**
1. `misc.py:172` — health check: change `data_dir / "ghostlink.db"` to use the actual runtime DB path (get it from `deps` or hardcode `ghostlink_v2.db`)
2. `misc.py:245-247` — backup: change `db_path = data_dir / "ghostlink.db"` to `data_dir / "ghostlink_v2.db"` and update the archive name
3. `misc.py:295+` — restore: same DB name fix
4. Add `data/agents/` to the backup zip (it currently only backs up `data/memory/` which doesn't exist — agent data lives under `data/agents/` or `data/{name}/`)
5. Update `test_ops_endpoints.py` if it references the old DB name

**Verify:** `cd backend && python -m pytest tests/ -q` passes. `/api/backup` produces a zip containing `ghostlink_v2.db` and any agent data dirs.

---

### Step 1: Add `agent_id` to AgentInstance (non-breaking)

**Files:** `backend/registry.py`

**Changes:**
1. Add `import uuid` at the top
2. Add `agent_id: str = field(default_factory=lambda: uuid.uuid4().hex)` as the FIRST field on `AgentInstance` (before `name`)
3. Add a `_id_index: dict[str, AgentInstance]` alongside the existing `_instances` dict
4. In `register()`: after creating the instance, also store it in `_id_index[inst.agent_id] = inst`
5. In `deregister()`: also remove from `_id_index`
6. Add `get_by_id(self, agent_id: str) -> AgentInstance | None`
7. Add `resolve(self, identifier: str) -> AgentInstance | None` — tries `_id_index` first, then `_instances`

**Do NOT change:** `get(name)` still works exactly as before. No existing callers break.

**Verify:** `cd backend && python -m pytest tests/ -q` passes. Registration still works. `inst.agent_id` is a 32-char hex string.

---

### Step 2: Add SQLite persistence for registry

**Files:** `backend/app.py`, `backend/registry.py` (or new `backend/identity_store.py` — keep it simple, one module)

**Changes:**
1. In `app.py` startup (around line 336-350 where DB is initialized), add `CREATE TABLE IF NOT EXISTS agents (...)` using the schema from PHASE_1A_SPEC.md Section 4.2
2. Add a `persist_agent(db, inst)` function: `INSERT OR REPLACE INTO agents` with all fields from the instance
3. Add a `load_agents(db)` function: `SELECT * FROM agents` -> returns list of `AgentInstance` with `state='offline'`
4. In `app.py` startup, after creating the DB connection, call `load_agents()` and populate `registry._instances` and `registry._id_index` with offline records
5. In `routes/agents.py` `register_agent()`: after `deps.registry.register()`, call `persist_agent()` to write the row
6. In `routes/agents.py` `deregister_agent()`: update the row to `state='offline'` instead of deleting
7. In the heartbeat handler: periodically persist state changes (or persist on state transitions only)

**Key decisions:**
- Use the EXISTING `ghostlink_v2.db` connection (the one at `app.py:337`). Do NOT create a new DB file.
- Column names are snake_case. API response field names stay camelCase. Map between them in the persist/load functions.
- `created_at` is set once on first insert and never changes. `registered_at` updates on re-registration.

**Verify:** `cd backend && python -m pytest tests/ -q` passes. Kill the backend, restart it, and check that agents appear as offline in `/api/status` with their original `agent_id`.

---

### Step 3: Add dual name/ID lookup to routes

**Files:** `backend/routes/agents.py`

**Changes:**
1. Create a helper function at the top of the file:
```python
def _resolve_agent(identifier: str) -> AgentInstance | None:
    """Resolve agent by name or agent_id."""
    return deps.registry.resolve(identifier)
```
2. Replace `deps.registry.get(name)` / `deps.registry.get(agent_name)` calls with `_resolve_agent(name)` / `_resolve_agent(agent_name)` in ALL route handlers. This is a mechanical find-and-replace. There are ~44 routes.
3. Do NOT rename the URL path parameter from `{name}` to `{identifier}`. Keep the name `{name}` in the route definition — it's just a FastAPI parameter name, it doesn't constrain what value is passed.
4. Update `/api/status` response to include `agent_id` in each agent dict (in `app_helpers.py:get_full_agent_list()`)
5. Update `/api/register` response to include `agent_id`

**Verify:** `cd backend && python -m pytest tests/ -q` passes. All existing routes work with display name. Routes also work when you pass `agent_id` instead of name.

---

### Step 4: Unify memory/soul/notes paths

**Files:** `backend/agent_memory.py`, `backend/mcp_bridge.py`

**Changes:**

**4a. Fix the path split bug (soul/notes):**
1. In `agent_memory.py`, change all path construction to use `data_dir / "agents" / agent_identifier / ...` as the canonical path
2. Add a fallback: if canonical path doesn't exist but `data_dir / agent_name / ...` does, migrate the legacy data forward (copy files to canonical path, then delete legacy)
3. The `agent_identifier` should be `agent_id` when available, falling back to `agent_name` during transition

**4b. Fix the MCP bridge path:**
1. In `mcp_bridge.py`, the memory tools use `_data_dir / agent_name / "memory"`. Change to `_data_dir / "agents" / agent_id / "memory"`
2. The `_data_dir` in mcp_bridge.py needs to be aligned with the canonical path used by `agent_memory.py`
3. Update `search_all_memories()` to scan `data_dir / "agents" / * / "memory"` instead of `data_dir / * / "memory"`

**4c. Fix the wrapper soul write path:**
1. In `wrapper.py:932`, `set_soul(data_dir, assigned_name, soul)` still writes to `data/{name}/soul.txt` today. The locked Phase 1A target is `data/agents/{agent_id}/...`, with temporary fallback to legacy name-keyed paths during migration. The wrapper call site does not need a separate Phase 1A patch if `agent_memory.py` becomes the single canonical path layer.

**Migration approach:** Lazy migration on first access.
- When `get_soul()`, `get_notes()`, `get_agent_memory()`, or `save_memory()` is called:
  - Check canonical path first (`data/agents/{agent_id}/...`)
  - If not found, check legacy path (`data/{agent_name}/...`)
  - If found at legacy path, copy to canonical path, delete legacy
  - Return from canonical path
- This means existing data migrates automatically as agents are accessed. No separate migration script needed.

**Verify:** `cd backend && python -m pytest tests/ -q` passes. Agent soul/notes are readable via both the API and MCP bridge. Existing agent data in `data/claude/`, `data/codex/` etc. migrates on first access.

---

### Step 5: Update backup/restore to include new paths

**Files:** `backend/routes/misc.py`

**Changes:**
1. Backup: add `data/agents/` directory to the zip (recurse like the existing `data/memory/` handler)
2. Restore: extract `data/agents/` from the zip
3. Remove or keep the old `data/memory/` backup for backward compat (keep it — old backups might have data there)

**Verify:** `/api/backup` zip contains `ghostlink_v2.db` AND `data/agents/` directory with agent data.

---

### Step 6: Write acceptance tests

**Files:** `backend/tests/test_phase1a.py` (new file)

**Tests to write (matching spec T1-T6):**

```
test_register_assigns_durable_id          # T1
test_persistent_row_exists                # T2
test_deregister_marks_offline             # T2
test_dual_lookup_by_name                  # T3
test_dual_lookup_by_id                    # T3
test_memory_path_uses_agent_id            # T4
test_legacy_path_migration                # T5
test_rename_safe_storage                  # T6
test_status_includes_agent_id             # T1 (API contract)
test_register_response_includes_agent_id  # T1 (API contract)
```

**Verify:** `cd backend && python -m pytest tests/ -q` passes including all new tests. Run Gate 1A checklist from VALIDATION_MATRIX.md.

---

## Intermediate Checkpoints

After EACH step:
1. `cd backend && python -m pytest tests/ -q` — all tests pass
2. `git diff` — review your changes, make sure no unintended files are modified
3. No ownership violations — only touch files listed in this plan

After ALL steps:
1. Run Gate 0 from VALIDATION_MATRIX.md
2. Run Gate 1A from VALIDATION_MATRIX.md
3. Post results to Discord with exact test output

---

## Files Modified (Complete List)

| File | Step | What Changes |
|------|------|-------------|
| `backend/routes/misc.py` | 0, 5 | Fix DB name, add agents/ to backup |
| `backend/registry.py` | 1 | Add `agent_id`, `_id_index`, `get_by_id()`, `resolve()` |
| `backend/app.py` | 2 | Create `agents` table, load persisted agents on startup |
| `backend/routes/agents.py` | 3 | Use `_resolve_agent()` for all lookups, include `agent_id` in register response |
| `backend/app_helpers.py` | 3 | Include `agent_id` in status payload |
| `backend/agent_memory.py` | 4 | Canonical path `data/agents/{id}/`, legacy fallback + migration |
| `backend/mcp_bridge.py` | 4 | Fix memory tool paths to use `data/agents/{id}/memory/` |
| `backend/tests/test_phase1a.py` | 6 | New test file for T1-T6 |
| `backend/tests/test_ops_endpoints.py` | 0 | Fix DB name reference |

---

## What NOT to Touch

- `frontend/` — nothing. Phase 1A is backend-only.
- `backend/wrapper.py` — no protocol changes. Soul write path fix happens through `agent_memory.py`.
- `backend/worktree.py` — no key migration.
- Queue files (`{name}_queue.jsonl`) — stay name-based.
- Provider config files — stay name-based.

---

## Rollback Plan

If Phase 1A breaks something badly:
1. The `agents` SQLite table is additive — dropping it returns to pre-1A behavior
2. `agent_id` field on `AgentInstance` is ignored by all existing callers if not used
3. Path migration is one-way but the legacy fallback means old paths are still checked
4. Worst case: `git revert` the Phase 1A commits and the system returns to name-only behavior
