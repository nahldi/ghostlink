# GhostLink Phase 6 Test Plan

**Owner:** kurt  
**Date:** 2026-04-08  
**Status:** Ready before implementation  
**Spec:** `docs/specs/PHASE_5_6_SPEC.md`  
**Roadmap:** `roadmap-pt2.md`

---

## Scope

Phase 6 is memory and intelligence.

Primary outcomes:

1. Four-layer memory stratification with migration from the current flat model
2. Selective identity reinforcement and drift-triggered reinjection
3. Weighted recall with tags, recency, frequency, and importance scoring
4. Observational memory with confidence-scored workspace hints
5. Cross-agent memory coordination with write isolation and promotion flow
6. Prompt cache diagnostics and alerting

This phase is about making memory useful without turning it into a bag of stale JSON lies.

---

## Hard Constraints

Validation must enforce these:

- Phase 6 must integrate with the existing memory systems already present in live code; it cannot quietly build a parallel unused memory stack
- Phase 6 must reconcile `MemoryGraph` and `RAGPipeline` with the new memory model instead of leaving both old and new retrieval paths active with contradictory behavior
- identity memory must never be evicted or degraded by workspace/session pressure
- workspace/session eviction and promotion behavior must be truthful and deterministic
- schema migration from the current flat memory entries must be additive and non-destructive
- reinjection must strengthen identity without scrambling active task state
- weighted recall must be measurably better or at least not worse than the existing simple retrieval on known-good queries
- observational memory must remain workspace-scoped, reviewable, and removable
- cross-agent coordination must preserve write isolation; agents cannot silently edit each other’s namespaces
- prompt-cache diagnostics must use real provider/runtime signals where available and label estimates honestly where they are inferred
- any new background observation, diagnostics, or coordination work must not materially degrade request latency or memory read paths

If Phase 6 ships a smarter-looking UI over corrupted memory state, fake cache numbers, or identity drift that still leaks through, reject it.

---

## Validation Commands

After Phase 6 lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -c "import app; print(app.__version__)"`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`

If any previously green command fails, or memory migration leaves unreadable entries behind, Phase 6 fails validation.

---

## Acceptance Buckets

## P6-1. Memory Stratification and Migration

### Must Be True

- identity, workspace, and session layers exist with the documented storage semantics
- current flat-schema entries migrate safely into workspace-layer entries
- existing soul/identity data migrates into the identity layer
- existing `MemoryGraph` / `RAGPipeline` initialization paths reconcile with the new storage model instead of silently bypassing it
- session-end promotion produces workspace summaries instead of silent data loss
- token-budget eviction respects layer rules and metadata

### Suggested Tests

- `test_flat_schema_entries_migrate_to_workspace_layer_without_loss`
- `test_existing_soul_data_migrates_to_identity_layer`
- `test_memorygraph_and_ragpipeline_resolve_through_reconciled_memory_model`
- `test_identity_layer_is_never_evicted_under_budget_pressure`
- `test_session_end_promotes_qualifying_items_to_workspace_summary`
- `test_workspace_eviction_removes_lowest_scored_items_first`

### Failure Conditions

- migration drops entries or corrupts old keys
- identity data still lives in ad hoc side files after rollout
- workspace/session pressure can evict identity memory

---

## P6-2. Cross-Layer Search and Weighted Recall

### Must Be True

- search can filter by layer and tag
- result ordering follows the declared weighted scoring model
- word-match boosts still preserve backward-compatible relevance on obvious matches
- `last_accessed` and `access_count` update on load/search hits atomically
- configurable weights change ranking predictably

### Suggested Tests

- `test_cross_layer_search_honors_layer_filter`
- `test_tag_filtered_search_excludes_nonmatching_items`
- `test_weighted_scoring_orders_results_by_recency_frequency_and_importance`
- `test_word_match_boost_preserves_obvious_exact_match_priority`
- `test_access_metadata_updates_on_read_and_search_hit`
- `test_custom_weight_override_changes_ranking_predictably`

### Failure Conditions

- search ranking is effectively random after migration
- access metadata drifts or only updates in memory
- weighted recall performs worse than the old simple search on known-good fixtures

---

## P6-3. Identity Reinforcement and Drift Detection

### Must Be True

- reinforcement triggers at the documented critical boundaries
- resumed or compacted sessions keep the same agent identity while receiving the right reinjection
- drift detection can flag real identity loss without constant false alarms
- reinjection strengthens current task continuity instead of causing conversational resets
- identity block size stays inside the declared token budget

### Suggested Tests

- `test_context_compaction_triggers_identity_reinjection`
- `test_resume_creates_new_session_with_same_agent_identity_and_reinjection`
- `test_drift_score_threshold_triggers_automatic_reinforcement`
- `test_reinjection_preserves_current_task_anchor`
- `test_identity_block_respects_token_budget`
- `test_false_positive_drift_does_not_spam_reinjection`

### Failure Conditions

- compaction or resume can still leave the agent identity-blind
- reinjection repeats full history or derails the active task
- drift heuristics fire so often they become noise

---

## P6-4. Observational Memory

### Must Be True

- observation engine records structural patterns only, not intrusive content analysis
- confidence increases with repeated observations and low-confidence noise stays out of context
- operators can review and delete observational entries
- disabling the observation engine prevents new observational entries from being created
- observation batching avoids write-amplification

### Suggested Tests

- `test_repeated_tool_pattern_creates_observational_memory_with_confidence_growth`
- `test_low_confidence_observation_is_not_included_in_context`
- `test_deleted_observation_does_not_reappear_without_new_evidence`
- `test_disabling_observation_engine_prevents_new_entries`
- `test_observation_batching_limits_write_frequency`

### Failure Conditions

- observation engine floods memory with trivial events
- deleted observations immediately respawn from stale buffers
- observations analyze message content or personal data instead of structural behavior

---

## P6-5. Cross-Agent Memory Coordination

### Must Be True

- agents write only to their own namespace
- shared namespace reads are available without exposing private per-agent namespaces
- promotions require the documented approval path
- conflicting agent memories are detected and surfaced
- memory coordination emits the right events for hooks/plugins

### Suggested Tests

- `test_agent_write_isolation_blocks_cross_namespace_writes`
- `test_shared_namespace_is_readable_without_private_namespace_leakage`
- `test_promotion_requires_and_records_approval`
- `test_conflicting_agent_memories_raise_conflict_event`
- `test_memory_written_and_promoted_events_emit_expected_payloads`

### Failure Conditions

- agents can mutate another agent’s memory namespace
- shared/promotion flows bypass approval
- conflict detection misses obvious contradictory entries

---

## P6-6. Prompt Cache Diagnostics

### Must Be True

- cache hit/miss accounting stays consistent with provider/runtime metadata
- stable identity prefixes do not create contradictory cache keys for equivalent requests after reinforcement/memory layering changes
- estimated values are clearly marked when direct cache data does not exist
- savings calculations stay non-negative and pricing-consistent
- alert thresholds fire only after the configured sustained miss pattern
- diagnostics collection does not meaningfully slow request completion

### Suggested Tests

- `test_provider_cache_metadata_maps_to_consistent_hit_miss_counts`
- `test_identity_reinforcement_keeps_cache_key_behavior_stable_for_equivalent_requests`
- `test_estimated_cache_stats_are_marked_inferred_when_provider_lacks_direct_signals`
- `test_estimated_savings_are_nonnegative_and_pricing_consistent`
- `test_low_cache_hit_rate_threshold_emits_alert_after_configured_window`
- `test_cache_diagnostics_collection_stays_within_latency_budget`

### Failure Conditions

- cache stats contradict raw provider usage data
- estimated numbers are presented as hard facts
- diagnostics logic adds noticeable latency to normal requests

---

## Frontend Memory and Diagnostics Surfaces

These checks matter because Phase 6 adds a lot of invisible backend state the UI can easily misrepresent:

- `test_memory_inspector_layer_counts_match_backend_state`
- `test_memory_inspector_tag_filter_matches_backend_search`
- `test_drift_indicator_matches_backend_drift_state`
- `test_conflict_resolution_ui_matches_coordination_backend_records`
- `test_cache_diagnostics_dashboard_matches_backend_aggregates_and_alerts`

Failure if the operator UI tells a cleaner story than the underlying memory system.

---

## Regression Checks

Keep these green:

- Phase 1B identity isolation and reinjection behavior
- Phase 2 rules/effective-state layering, especially around `AGENTS.md` and workspace context
- Phase 3 task continuity and operator control surfaces
- Phase 3.5 checkpoint/replay compatibility with reinforced identity and promoted summaries
- Phase 4B prompt-cache optimization and cost accounting feeding diagnostics
- Phase 5 collaboration/workspace coordination boundaries when cross-agent memory is enabled
- existing `MemoryGraph` and `RAGPipeline` startup/init paths
- cache behavior for equivalent requests before and after identity reinforcement changes

Phase 6 is allowed to improve memory quality. It is not allowed to quietly break the current startup, retrieval, or identity stack to do it.

---

## Manual Stress Checks

Run these before calling Phase 6 done:

1. Migrate a workspace with existing flat memory entries and verify every old entry still loads with backfilled metadata.
2. Fill workspace memory to its token budget and verify only the lowest-scored workspace items evict while identity entries remain untouched.
3. Force a session end with several high-importance session items and verify a promoted summary appears in workspace memory with truthful lineage.
4. Simulate context compaction and then resume a task after disconnect; verify identity reinforcement happens without losing current-task continuity.
5. Generate repeated structural behavior, like consistent tool usage and file affinity, and verify observational entries appear with growing confidence but can still be deleted cleanly.
6. Have two agents write contradictory workspace observations and verify the conflict is surfaced instead of silently overwriting one with the other.
7. Run providers with both direct cache metadata and inferred-only cache behavior, then verify the diagnostics UI distinguishes measured versus estimated values.

---

## Exit Rule

Phase 6 passes only if:

- memory migration is lossless and layer semantics are real
- identity reinforcement reduces drift without derailing active work
- recall quality is weighted, explainable, and not obviously worse than the old model
- observational and shared memory stay reviewable, bounded, and permission-safe
- cache diagnostics are truthful about what is measured versus inferred

If the system remembers more things but trusts the wrong ones, forgets the important ones, or can’t explain its own memory state, Phase 6 is not done.
