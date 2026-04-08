# GhostLink Pre-1A Test Plan

**Owner:** kurt  
**Date:** 2026-04-07  
**Status:** Ready for implementation pairing with Jeff's mini-spec  
**Scope:** Pre-1A prerequisite fixes only

---

## Purpose

Phase 1A should not start on top of live production bugs and storage drift.

This test plan covers the three prerequisite items agreed by audit:

1. Fix the live soul/notes path mismatch
2. Fix the backup/restore/diagnostics DB name mismatch
3. Add a lightweight SQLite migration runner suitable for Phase 1A

Nothing else belongs in this tranche.

---

## In Scope

- `backend/agent_memory.py`
- `backend/routes/agents.py`
- `backend/routes/misc.py`
- `backend/app.py`
- one minimal migration helper/module if Tyson needs it
- backend tests for the above

## Out Of Scope

- stable `agent_id`
- registry persistence rows
- dual name/ID lookup
- frontend changes
- worktree changes
- provider adapter redesign
- reconnect protocol changes

Those belong to locked Phase 1A, not pre-1A.

---

## Required Checks

## P0. Baseline Must Still Pass

Before and after the pre-1A changes:

- `cd backend && python -m pytest tests/ -q`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`

If any previously green command fails, the tranche is blocked.

---

## P1. Soul / Notes Path Fix

### Goal

Wrapper writes and API reads must converge on the same persistent location.

### Acceptance Tests

1. Wrapper-written soul is readable from the soul API.
2. Wrapper-written notes are readable from the notes API.
3. Existing legacy data under `data/{name}/` is still readable after the fix.
4. If lazy migration is used, first access migrates legacy soul/notes into the canonical location.
5. MCP memory behavior is not regressed by the path changes.

### Suggested Test Cases

- `test_api_reads_wrapper_written_soul`
- `test_api_reads_wrapper_written_notes`
- `test_legacy_soul_path_is_migrated_or_read_compatibly`
- `test_legacy_notes_path_is_migrated_or_read_compatibly`
- `test_memory_search_all_still_finds_existing_entries`

### Failure Conditions

- API still reads `data/agents/...` while wrapper writes `data/{name}/...`
- legacy soul/notes become unreadable
- migration deletes data without recreating it at the canonical path

---

## P2. DB Name Drift Fix

### Goal

Diagnostics, backup, and restore must target the live runtime DB `ghostlink_v2.db`, not the deprecated `ghostlink.db`.

### Acceptance Tests

1. `/api/diagnostics` checks the live DB file.
2. `/api/backup` includes `ghostlink_v2.db`.
3. `/api/restore` accepts and restores `ghostlink_v2.db`.
4. Backup includes persistent agent data directories needed by the identity work.

### Suggested Test Cases

- `test_diagnostics_uses_live_runtime_db`
- `test_backup_includes_ghostlink_v2_db`
- `test_restore_accepts_ghostlink_v2_db_archive`
- `test_backup_includes_agent_data_directory`

### Failure Conditions

- any route still hardcodes `ghostlink.db`
- backup omits the live DB
- restore only accepts the old archive name

---

## P3. Lightweight Migration Runner

### Goal

Phase 1A needs one consistent way to apply additive schema changes without scattering ad hoc table creation.

### Acceptance Tests

1. Startup applies pending migrations exactly once.
2. Re-running startup is idempotent.
3. Migration state is persisted in SQLite.
4. A failed migration surfaces a hard error instead of silently continuing with partial state.

### Suggested Test Cases

- `test_migrations_apply_once_on_startup`
- `test_migrations_are_idempotent`
- `test_migration_state_is_recorded`
- `test_failed_migration_aborts_startup_or_returns_clear_error`

### Failure Conditions

- migrations rerun on every startup
- schema state depends on import order
- partial migration failure leaves runtime pretending startup succeeded

---

## Manual Verification

After Tyson lands the changes:

1. Write soul/notes through the wrapper path for a test agent.
2. Read them back through `/api/agents/{name}/soul` and `/api/agents/{name}/notes`.
3. Hit `/api/backup` and inspect the zip for:
   - `ghostlink_v2.db`
   - agent data directory contents
4. Run `/api/diagnostics` and confirm it reports on the live DB.
5. Restart the backend twice and confirm migrations do not reapply or corrupt state.

---

## Exit Rule

Pre-1A is done only when:

- all baseline commands still pass
- the two live production bugs are fixed
- migration plumbing exists and is idempotent
- no extra Phase 1A work leaked into this tranche

If Tyson touches `agent_id`, frontend state keys, provider adapters, or reconnect semantics here, that is scope drift and should be rejected.
