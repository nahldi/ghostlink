# GhostLink Phase 8.5 Test Plan

**Owner:** kurt  
**Date:** 2026-04-08  
**Status:** Ready before implementation  
**Spec:** `roadmap-pt2.md` Phase 8.5  
**Roadmap:** `UNIFIED_ROADMAP.md`, `roadmap-pt2.md`

---

## Scope

Phase 8.5 is agent and skill productization.

Primary outcomes:

1. Versioned agent profiles and skills with compatibility metadata
2. Rollout channels for private, beta, and stable distribution
3. Workspace and org distribution for packaged assets
4. Rollback and deprecation flows that do not leave dirty mixed state behind
5. Policy-gated promotion and health telemetry per released version

This phase is deployment safety, not a prettier settings page. If a bad rollout cannot be contained or reversed cleanly, reject it.

---

## Hard Constraints

Validation must enforce these:

- versioning must be additive; existing unversioned profiles/skills cannot become unreadable
- version resolution must be deterministic and explainable
- rollback must return the workspace to a clean, truthful prior state without orphaned metadata
- mixed-version coexistence must be explicit and safe; if a combination is unsupported, the system must reject it clearly
- compatibility metadata must be enforced, not just displayed
- promotion from beta to stable must respect Phase 4A policy gates
- deprecation notices and forced removal must be truthful and auditable
- per-version health metrics must come from real usage/eval/cost signals, not hardcoded vanity counters

If Phase 8.5 ships marketplace gloss over broken rollback, fake compatibility, or uncontrolled rollouts, reject it.

---

## Validation Commands

After Phase 8.5 lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -m py_compile versioning.py skills.py registry.py app.py deps.py`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`

If any Phase 4.5, 5, 6, 7, or 8 gate regresses while productization lands, Phase 8.5 fails.

---

## Acceptance Buckets

## P8.5-1. Versioned Assets and Resolution

### Must Be True

- profiles and skills can be stored and resolved by explicit version
- compatibility metadata is persisted and surfaced with each version
- resolution rules are deterministic for pinned and default cases
- old unversioned assets remain readable or are migrated additively

### Suggested Tests

- `test_profile_version_records_persist_with_compatibility_metadata`
- `test_skill_version_records_persist_with_dependency_metadata`
- `test_version_resolution_is_deterministic_for_pinned_and_default_selection`
- `test_unversioned_assets_migrate_or_remain_readable_without_loss`

### Failure Conditions

- version lookup changes result order unpredictably
- compatibility metadata is stored but ignored
- migration strands old assets in unreadable state

---

## P8.5-2. Rollout Channels and Promotion Policy

### Must Be True

- versions can move through `private`, `beta`, and `stable` channels truthfully
- promotion from beta to stable respects policy approval
- channel membership is reflected accurately in backend and UI
- denied promotions do not partially update rollout state

### Suggested Tests

- `test_version_channel_promotion_updates_visibility_truthfully`
- `test_beta_to_stable_promotion_requires_policy_approval`
- `test_denied_promotion_does_not_mutate_channel_state`
- `test_channel_membership_ui_matches_backend_truth`

### Failure Conditions

- stable promotion bypasses policy
- denied promotions leave half-promoted records behind
- UI channel badges diverge from backend truth

---

## P8.5-3. Workspace and Org Distribution

### Must Be True

- assets can be distributed within a workspace and across an org using the documented visibility rules
- recipients get the correct version and channel state
- distribution failures are explicit and recoverable
- removal from distribution does not silently delete local pinned copies unless policy says so

### Suggested Tests

- `test_workspace_distribution_makes_version_available_to_expected_recipients`
- `test_org_distribution_respects_scope_boundaries`
- `test_distribution_failure_is_reported_without_partial_visibility_leak`
- `test_unpublish_does_not_destroy_pinned_local_version_without_explicit_action`

### Failure Conditions

- workspace/org boundaries leak assets incorrectly
- distribution failures leave partially visible versions
- unpublish destroys data that should remain pinned locally

---

## P8.5-4. Rollback and Deprecation

### Must Be True

- operator can roll back from version N+1 to N cleanly
- rollback restores the prior effective version without stale metadata or mixed-state leftovers
- deprecation notices are visible before forced removal
- forced deprecation removes the version on schedule and leaves a truthful migration path

### Suggested Tests

- `test_profile_rollback_restores_previous_effective_version_cleanly`
- `test_skill_rollback_cleans_up_new_version_state`
- `test_deprecation_notice_is_visible_before_forced_removal`
- `test_forced_deprecation_removes_version_and_preserves_migration_target`

### Failure Conditions

- rollback leaves ghost references to the newer version
- forced deprecation hard-deletes without notice or migration path
- effective state after rollback is ambiguous

---

## P8.5-5. Mixed-Version Coexistence and Compatibility Enforcement

### Must Be True

- two agents can run different supported versions safely when rollout requires it
- incompatible versions are rejected clearly before activation
- capability and platform requirements are enforced, not decorative
- mixed-version state remains inspectable in the UI

### Suggested Tests

- `test_supported_mixed_versions_can_coexist_in_one_workspace`
- `test_incompatible_version_activation_is_rejected_before_runtime`
- `test_missing_capability_requirement_blocks_install_or_activation`
- `test_mixed_version_ui_reports_real_active_versions_per_agent`

### Failure Conditions

- incompatible versions can activate and then fail at runtime
- mixed-version state is hidden or misleading
- capability checks only exist in the UI

---

## P8.5-6. Health Telemetry and Auditability

### Must Be True

- each released version reports real usage, error, cost, and eval-linked health data
- health metrics are attributable to the correct version/channel
- rollback, promotion, deprecation, and forced removal actions are auditable
- dashboards do not invent health scores when data is missing

### Suggested Tests

- `test_version_health_dashboard_uses_real_usage_and_error_signals`
- `test_cost_and_eval_metrics_are_attributed_to_correct_version`
- `test_promotion_and_rollback_actions_write_audit_records`
- `test_missing_health_data_is_labeled_unknown_not_healthy`

### Failure Conditions

- health metrics aggregate across versions incorrectly
- audit trail misses rollout-critical actions
- dashboard labels unknown data as healthy or stable

---

## Exit Criteria

Phase 8.5 passes only if all of these are true:

- operator can publish, promote, pin, roll back, and deprecate profile/skill versions cleanly
- compatibility and capability requirements are enforced before activation
- mixed-version rollout is either safe and truthful or explicitly blocked
- per-version health metrics are real and attributable
- rollback and deprecation leave no dirty productization state behind
- earlier roadmap gates remain green
