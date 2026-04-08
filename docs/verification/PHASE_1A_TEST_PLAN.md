# GhostLink Phase 1A Test Plan

**Owner:** kurt  
**Date:** 2026-04-07  
**Status:** Ready for Tyson implementation / post-implementation validation  
**Spec:** `docs/specs/PHASE_1A_SPEC.md` v2.0

---

## Scope

Phase 1A is backend-only and locked to four deliverables:

1. Stable `agent_id` on registry records
2. SQLite persistence for registry rows
3. Dual lookup by display name or `agent_id`
4. Memory/soul/notes path migration from `data/agents/{name}/` to `data/agents/{agent_id}/`

Everything else is out of scope.

## Explicit Non-Scope Checks

Reject the tranche if it includes:

- frontend state rekeying
- provider adapter redesign
- worktree key migration
- reconnect protocol redesign
- queue or approval file rekeying
- profile/task/trace identity expansion

---

## Validation Commands

Run these after Phase 1A lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -c "import app; print(app.__version__)"`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`

If any previously green command fails, Phase 1A fails validation.

---

## Acceptance Buckets

## A1. Stable `agent_id`

### Must Be True

- each new registry record gets a 32-char hex `agent_id`
- `agent_id` is assigned once and does not change during normal state transitions
- `agent_id` is included in:
  - `POST /api/register`
  - `GET /api/status`

### Suggested Tests

- `test_register_response_includes_agent_id`
- `test_status_includes_agent_id`
- `test_agent_id_is_hex_and_stable`

### Failure Conditions

- `agent_id` missing from live API payloads
- `agent_id` regenerated on heartbeat, config change, or deregister/register within the persisted row model

---

## A2. Registry Persistence

### Must Be True

- Phase 1A uses the live runtime DB `ghostlink_v2.db`
- an `agents` table exists
- registry rows persist after registration
- deregistration marks rows offline instead of deleting them
- restart reloads stored rows as offline records

### Suggested Tests

- `test_agents_table_created`
- `test_register_persists_agent_row`
- `test_deregister_marks_agent_offline`
- `test_registry_loads_offline_rows_on_startup`

### Failure Conditions

- new identity data goes to a second DB
- rows disappear on deregister
- restart loses persisted registry rows

---

## A3. Dual Name / ID Lookup

### Must Be True

- existing name-based behavior still works
- registry exposes ID-based lookup
- backend route resolution accepts either display name or `agent_id`
- current frontend contract does not need a route rewrite

### Suggested Tests

- `test_registry_get_by_name_still_works`
- `test_registry_get_by_id_works`
- `test_route_accepts_name_identifier`
- `test_route_accepts_agent_id_identifier`

### Failure Conditions

- name lookup regresses
- routes only work with IDs
- frontend-facing route shapes change

---

## A4. ID-Keyed Persistent Storage

### Must Be True

- memory path becomes `data/agents/{agent_id}/memory/`
- soul path becomes `data/agents/{agent_id}/soul.txt`
- notes path becomes `data/agents/{agent_id}/notes.txt`
- legacy `data/agents/{name}/...` content is readable and migrates forward
- `search_all_memories()` scans the ID-keyed directories

### Suggested Tests

- `test_memory_writes_to_agent_id_path`
- `test_soul_writes_to_agent_id_path`
- `test_notes_writes_to_agent_id_path`
- `test_legacy_agent_name_storage_migrates_forward`
- `test_search_all_memories_uses_agent_id_layout`

### Failure Conditions

- storage remains keyed by display name
- legacy agent data becomes unreadable
- path migration touches queue/worktree/provider files

---

## Regression Checks

These are required even if the core acceptance tests pass:

- existing `/api/agents/{name}/soul` and `/api/agents/{name}/notes` routes still work
- pre-1A backup/restore fixes remain intact
- pre-1A migration runner remains idempotent
- `pre_tool_use` remains fail-closed
- `post_tool_use` remains fail-open

---

## Manual Spot Checks

After tests pass:

1. Register an agent and record its `agent_id`.
2. Write soul/notes/memory for that agent.
3. Confirm files land under `data/agents/{agent_id}/`.
4. Deregister and restart backend.
5. Confirm the stored row still exists offline with the same `agent_id`.
6. Resolve the same agent by both display name and `agent_id`.

---

## Exit Rule

Phase 1A passes only if:

- all four deliverables are present
- no deferred work leaked in
- all baseline commands still pass
- legacy data remains readable during migration
- backend compatibility for the current frontend is preserved

If Tyson lands extra identity work outside the four deliverables, that is scope creep and should be rejected even if tests pass.
