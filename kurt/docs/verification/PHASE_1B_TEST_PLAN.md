# GhostLink Phase 1B Test Plan

**Owner:** kurt  
**Date:** 2026-04-07  
**Status:** Ready before implementation  
**Spec:** `docs/specs/PHASE_1B_2_SPEC.md`

---

## Scope

Phase 1B is runtime identity isolation and reinjection only.

Primary outcomes:

1. Per-agent identity storage under `backend/data/agents/{agent_id}/`
2. Reinjection lifecycle handling for spawn, reconnect, resume, delegation, model switch, and compaction
3. Shared workspace collision prevention for same-provider agents
4. Identity drift detection and operator visibility

This test plan assumes Phase 1A has already passed.

---

## Hard Constraints From Audit

These are not optional; validation must enforce them:

- Do not assume `CLAUDE_CODE_CONFIG_DIR` or `CODEX_CONFIG_DIR` exist.
- Do not assume Codex supports `--config-dir`.
- Do not assume persistent-session providers can be reinjected mid-session without restart.
- Do not treat shared workspace instruction files as solved unless the implementation actually isolates them.
- Do not rely on line-number claims in the spec without verifying live code.

If implementation depends on unverified provider behavior, Phase 1B fails.

---

## Validation Commands

After Phase 1B lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -c "import app; print(app.__version__)"`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`

If any previously green command fails, Phase 1B fails validation.

---

## Acceptance Buckets

## B1. Per-Agent Identity Storage

### Must Be True

- every agent has a per-agent directory keyed by `agent_id`
- `IDENTITY.md`, `SOUL.md`, `NOTES.md`, `state.json`, and injection artifacts live under that directory
- current soul/notes content survives migration from earlier Phase 1A layout
- missing or corrupt `state.json` is reconstructible from authoritative server state

### Suggested Tests

- `test_identity_files_created_under_agent_id`
- `test_state_json_rebuilt_when_missing`
- `test_phase1a_soul_notes_migrate_to_phase1b_layout`
- `test_identity_projection_matches_registry_record`

### Failure Conditions

- directory keyed by display name instead of `agent_id`
- migration drops existing soul/notes/memory content
- filesystem files become the source of truth instead of SQLite/server state

---

## B2. Spawn-Time Isolation

### Must Be True

- spawn writes identity artifacts for the correct agent
- two same-provider agents in one workspace do not share one mutable identity file as the source of truth
- Gemini remains per-instance if already isolated
- any fallback behavior that still touches a shared workspace file is explicitly marked degraded and detectable

### Suggested Tests

- `test_same_provider_agents_do_not_share_effective_identity_source`
- `test_spawn_writes_provider_specific_identity_artifact`
- `test_gemini_per_instance_settings_remain_isolated`
- `test_degraded_shared_path_mode_sets_drift_or_warning_flag`

### Failure Conditions

- second same-provider agent silently inherits the first agent’s identity
- implementation claims isolation but still only writes `.claude/instructions.md` or `.codex/instructions.md` in a shared root without any verified isolation layer

---

## B3. Reinjection Lifecycle

### Must Be True

- spawn trigger performs full identity injection
- reconnect/resume/model-switch behavior is correct per provider runtime model
- exec-per-trigger providers get fresh identity on the next run
- persistent providers do not fake reinjection if restart is required
- delegation appends delegation context without overwriting child identity

### Suggested Tests

- `test_spawn_trigger_records_injection_state`
- `test_exec_per_trigger_provider_gets_fresh_identity_after_reconnect`
- `test_persistent_provider_reports_restart_required_for_reinject`
- `test_delegation_adds_parent_context_without_identity_overwrite`
- `test_model_switch_requires_restart_for_persistent_provider`

### Failure Conditions

- code claims reinjection happened when it could not have
- child agent soul is overwritten during delegation
- reconnect logic depends on provider behavior that is not actually present

---

## B4. Drift Detection

### Must Be True

- drift is detectable and surfaced when identity may no longer match runtime state
- compaction or resume edge cases for persistent providers produce a state flag or operator-visible event
- drift state is attached to the agent surface and not silently ignored

### Suggested Tests

- `test_drift_flag_set_when_compaction_or_identity_gap_detected`
- `test_identity_drift_event_broadcasts_to_clients`
- `test_state_json_records_last_inject_trigger_and_hash`

### Failure Conditions

- drift detection is promised but never emitted
- state file does not track enough metadata to explain what happened

---

## B5. Backward Compatibility

### Must Be True

- Phase 1A routes and identity records still work
- no frontend store rekey is required in Phase 1B unless Jeff explicitly splits a compatibility slice
- no worktree-wide regressions are introduced for non-git or OneDrive-constrained workspaces
- OneDrive-backed workspaces either support the isolation path cleanly or degrade explicitly to a weaker fallback without silent identity collision

### Suggested Tests

- `test_phase1a_status_and_lookup_still_work`
- `test_phase1b_does_not_require_frontend_agent_map_rekey`
- `test_non_git_workspace_fallback_does_not_crash_spawn`
- `test_onedrive_worktree_isolation_or_explicit_fallback`

### Failure Conditions

- frontend must change just to keep Phase 1B alive
- worktree-based isolation hard-fails in unsupported environments without a guarded fallback

---

## Regression Checks

Keep these green:

- `pre_tool_use` remains fail-closed
- `post_tool_use` remains fail-open
- Phase 1A ID lookup still works by name and by `agent_id`
- pre-1A migration runner still works and remains idempotent
- backup/restore still includes the current runtime DB and agent data

---

## Manual Stress Checks

Run these before calling Phase 1B done:

1. Spawn two same-provider agents in one workspace.
2. Confirm each has distinct identity artifacts and effective state.
3. Send work to both and verify no cross-contamination of identity.
4. Force a reconnect/resume path.
5. Verify drift/reinject behavior matches the provider type:
   - exec-per-trigger: fresh identity on next execution
   - persistent: warning/flag or restart path, not fake reinjection
6. Repeat the same-provider isolation check from a OneDrive-backed workspace path and verify:
   - worktree isolation works, or
   - the fallback path is explicit, operator-visible, and does not silently merge identities

---

## Exit Rule

Phase 1B passes only if:

- same-provider agents no longer depend on one shared workspace identity file for correctness
- reinjection behavior is truthful per provider/runtime
- drift is detectable and visible
- no Phase 2 profile/rules/skills work leaked into the tranche

If implementation smuggles in profiles, frontend rekeying, or speculative provider flags, reject it as scope creep or false confidence.
