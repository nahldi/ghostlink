# GhostLink Phase 2 Test Plan

**Owner:** kurt  
**Date:** 2026-04-07  
**Status:** Ready before implementation  
**Spec:** `docs/specs/PHASE_1B_2_SPEC.md`

---

## Scope

Phase 2 is profiles, rules, and knowledge layering.

Primary outcomes:

1. Stable profile model separate from display labels
2. Layered inheritance for settings, skills, and rules
3. `AGENTS.md` ingest/review flow as an import layer, not the runtime source of truth
4. Effective-state visibility
5. Skills model moved off name-keyed assignment

This plan assumes:

- Phase 1A is complete
- Phase 1B identity storage/isolation is complete enough to support profile attachment and effective-state projection

---

## Hard Constraints From Audit

Validation must enforce these:

- skills cannot stay keyed only by display name
- `AGENTS.md` is an import/review layer, not automatic source of truth
- any `effective_state` implementation must be real, not a spec placeholder
- do not silently rely on unverified `[EXISTS]` claims from the spec
- Phase 2 must not smuggle in frontend store rekeying or unrelated control-plane work from Phase 3

If implementation depends on unsupported sync/async behavior or undefined inheritance semantics, Phase 2 fails.

---

## Validation Commands

After Phase 2 lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -c "import app; print(app.__version__)"`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`

If any previously green command fails, Phase 2 fails validation.

---

## Acceptance Buckets

## P2-1. Profile CRUD and Assignment

### Must Be True

- profiles are stored with stable `profile_id`
- agents can be assigned to profiles without depending on display-name identity
- deleting a profile that is still in use is rejected cleanly

### Suggested Tests

- `test_profile_create_read_update_delete`
- `test_profile_delete_rejected_when_agents_assigned`
- `test_agent_profile_assignment_persists`

### Failure Conditions

- profile identity depends on label/name text
- agent rename breaks profile assignment

---

## P2-2. Inheritance and Effective State

### Must Be True

- inheritance order is explicit and deterministic
- effective state merges the configured layers correctly
- system-level restrictions cannot be silently overridden by lower layers
- API exposes effective state and source-layer attribution accurately

### Suggested Tests

- `test_inheritance_resolution_order`
- `test_system_policy_cannot_be_overridden`
- `test_effective_state_endpoint_matches_expected_merge`
- `test_override_source_metadata_is_correct`

### Failure Conditions

- inheritance order changes by call path
- source-layer attribution is inaccurate
- empty/undefined override semantics are inconsistent

---

## P2-3. Skills Migration and Overrides

### Must Be True

- profile-level skills replace direct name-keyed assignment as the primary model
- agent-level skill overrides layer cleanly on top
- legacy `skills_config.json` migration preserves real config and assignments
- legacy compatibility calls still resolve through the new model

### Suggested Tests

- `test_profile_skill_assignment`
- `test_agent_skill_override_add_and_remove`
- `test_legacy_skills_config_migrates_to_profile_and_override_tables`
- `test_legacy_get_agent_skills_compat_still_works`
- `test_agent_rename_does_not_break_effective_skills`

### Failure Conditions

- migrated skills disappear
- custom skill config is dropped
- legacy callers break outright

---

## P2-4. `AGENTS.md` Import / Review

### Must Be True

- `AGENTS.md` parsing is import/review based, not auto-applied silently
- disk changes produce a diff/review flow
- operator can import, ignore, or review changes
- parser failure degrades safely rather than corrupting policy state

### Suggested Tests

- `test_agents_md_import_parses_and_stores_rules`
- `test_agents_md_diff_detects_disk_changes`
- `test_agents_md_reimport_clears_diff_state`
- `test_agents_md_parse_failure_returns_safe_fallback`

### Failure Conditions

- disk file changes auto-apply without review
- malformed `AGENTS.md` corrupts rules state

---

## P2-5. Frontend Effective-State Surfaces

### Must Be True

- operator can see current profile assignment
- effective-state viewer shows merged values and their source layer
- profile-related UI does not require Phase 3 task/control-plane work
- current UI remains usable even if profile features are disabled by config

### Suggested Tests

- `test_agent_info_panel_shows_profile_assignment`
- `test_effective_state_viewer_shows_layer_badges`
- `test_profile_manager_crud_flow`
- `test_agents_md_review_surface_handles_pending_diff`

### Failure Conditions

- UI hides inheritance source
- UI depends on unfinished Phase 3 infrastructure
- profile surfaces break older agents with no profile assigned

---

## Regression Checks

Keep these green:

- Phase 1A name/ID route compatibility
- Phase 1B identity/drift visibility
- pre-1A backup/restore and migration runner behavior
- current skills toggles still function through compatibility paths

---

## Manual Stress Checks

Run these before calling Phase 2 done:

1. Create one profile and attach multiple agents to it.
2. Change the profile model/settings and verify all attached agents reflect the change in effective state.
3. Add agent-specific overrides and confirm only that agent diverges.
4. Import an `AGENTS.md`, then change it on disk and verify the review/diff flow triggers without auto-applying.
5. Rename an agent and verify profile assignment and effective skills remain intact.

---

## Exit Rule

Phase 2 passes only if:

- profile identity is stable
- effective-state resolution is accurate and visible
- skills are no longer fundamentally tied to display names
- `AGENTS.md` is handled as an operator-reviewed import layer
- no Phase 3 operator control-plane work leaked into the tranche

If implementation drifts into task unification, context controls, stop/cancel, or broader control-plane work, reject it as out of scope.
