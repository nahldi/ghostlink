# GhostLink Phase 4.5 Test Plan

**Owner:** kurt  
**Date:** 2026-04-08  
**Status:** Ready before implementation  
**Spec:** `docs/specs/PHASE_4_SPEC.md`

---

## Scope

Phase 4.5 is evals and trace grading.

Primary outcomes:

1. Golden task corpus and auto-generated manifest
2. Scenario matrix and runnable mandatory subset
3. Trace grading across correctness, safety, policy, cost, latency, tool-use, provenance, and interrupt handling
4. Hard regression gates and soft trend alerts
5. Benchmark result storage and query surfaces
6. CI gate checker for baseline comparison

This phase is about trustworthy release gates. Cosmetic dashboards without real grading and blocking logic do not pass.

---

## Hard Constraints

Validation must enforce these:

- golden tasks must be executable artifacts, not markdown wishlists
- grading must operate on stored traces and produce structured scores
- `safety` and `policy_compliance` hard floors must actually block
- “no new failures” must compare against a prior baseline, not just the current average
- mandatory subset runtime has to stay inside the stated CI budget
- human overrides must be explicit and stored, not silently replacing automated scores

If the implementation can show charts but cannot block a bad regression, Phase 4.5 fails.

---

## Validation Commands

After Phase 4.5 lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -c "import app; print(app.__version__)"`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`
- `python -m pytest test/golden/ --eval-subset=mandatory -v`
- `python scripts/check_eval_gates.py --baseline=.eval-baseline.json --results=.eval-results.json`

If any previously green command fails, Phase 4.5 fails validation.

---

## Acceptance Buckets

## P45-1. Golden Task Corpus

### Must Be True

- there are at least the minimum required golden tasks across the spec categories
- each task file matches the documented JSON shape
- `manifest.json` is generated from the task directory and matches the actual corpus
- tasks declare provider/profile/sandbox requirements honestly

### Suggested Tests

- `test_minimum_golden_task_count_and_category_coverage`
- `test_golden_task_schema_validation`
- `test_manifest_is_regenerated_from_task_files`
- `test_task_requirements_round_trip_from_manifest`

### Failure Conditions

- task corpus is incomplete or hand-waved
- manifest is stale or manually curated instead of derived

---

## P45-2. Scenario Matrix and Mandatory Subset

### Must Be True

- the mandatory subset resolves to the documented scenario count
- subset selection logic is deterministic
- the mandatory subset completes within the stated CI runtime target
- extended and optional matrices do not contaminate the mandatory gate

### Suggested Tests

- `test_mandatory_subset_contains_expected_44_scenarios`
- `test_subset_selection_is_deterministic`
- `test_mandatory_subset_runtime_within_target`
- `test_extended_matrix_is_excluded_from_ci_gate`

### Failure Conditions

- CI subset drifts run to run
- mandatory path balloons past the runtime budget

---

## P45-3. Trace Grading

### Must Be True

- grader consumes stored traces and golden task expectations
- per-dimension scores are produced and persisted
- composite score uses the declared weights
- subjective dimensions that need review are flagged, not faked as automated

### Suggested Tests

- `test_known_good_trace_scores_passing_composite`
- `test_known_bad_trace_fails_correctness_floor`
- `test_grade_report_includes_all_dimensions`
- `test_composite_score_uses_task_weights`
- `test_interrupt_handling_sets_needs_review_when_not_automatable`

### Failure Conditions

- grader operates on ad hoc strings instead of trace structures
- composite math does not match configured weights
- subjective review is silently auto-passed

---

## P45-4. Hard Gates

### Must Be True

- `safety < 0.90` blocks
- `policy_compliance < 0.90` blocks
- `correctness < 0.50` blocks
- average composite for the mandatory set must be `>= 0.80`
- any task that passed in the prior baseline and now fails blocks the gate

### Suggested Tests

- `test_safety_floor_blocks_gate`
- `test_policy_floor_blocks_gate`
- `test_correctness_floor_blocks_gate`
- `test_composite_floor_blocks_gate`
- `test_no_new_failures_rule_blocks_regression`

### Failure Conditions

- hard-floor failures are reduced to warnings
- a rising average hides a newly failing task

---

## P45-5. Soft Alerts

### Must Be True

- cost regression over threshold emits a warning but does not block
- latency regression over threshold emits a warning but does not block
- unnecessary tool-use regression over threshold emits a warning but does not block
- soft alerts are visible in stored results and benchmark surfaces

### Suggested Tests

- `test_cost_regression_emits_soft_alert`
- `test_latency_regression_emits_soft_alert`
- `test_tool_use_regression_emits_soft_alert`
- `test_soft_alerts_are_visible_in_benchmark_results`

### Failure Conditions

- soft alerts block merges
- soft alerts disappear from the stored output

---

## P45-6. Benchmark Storage and Queries

### Must Be True

- every eval run persists benchmark rows with run/task/provider/model/profile/sandbox metadata
- benchmark results can be queried by provider, model, profile, version, and date range
- historical trend queries are consistent across repeated runs
- human overrides are stored and marked as authoritative

### Suggested Tests

- `test_benchmark_results_persist_with_full_metadata`
- `test_dashboard_query_filters_by_provider`
- `test_dashboard_query_filters_by_version_range`
- `test_human_override_is_stored_and_marked_authoritative`

### Failure Conditions

- benchmark storage drops key dimensions
- dashboard queries aggregate against incomplete or mismatched data

---

## P45-7. CI Gate Checker

### Must Be True

- `check_eval_gates.py` reads baseline and results files correctly
- hard-gate failures return non-zero exit
- passing results return zero exit
- emergency skip path, if present, is explicit and auditable

### Suggested Tests

- `test_gate_checker_exits_nonzero_on_hard_failure`
- `test_gate_checker_exits_zero_on_pass`
- `test_gate_checker_reports_failing_task_and_reason`
- `test_skip_path_requires_explicit_override_signal`

### Failure Conditions

- gate checker only prints warnings and returns zero
- failure output does not identify the breaking task/dimension

---

## Frontend Benchmark Surfaces

These checks matter because operators need truthful eval visibility:

- `test_benchmark_summary_matches_backend_aggregates`
- `test_per_provider_view_matches_benchmark_results`
- `test_task_drill_down_shows_trace_and_grading_breakdown`
- `test_hard_gate_status_matches_gate_checker_output`
- `test_regression_highlights_match_historical_data`

Failure if the dashboard is prettier than it is truthful.

---

## Regression Checks

Keep these green:

- Phase 4A policy records used by grading
- Phase 4B cost and routing records used by grading
- Phase 3.5 trace and provenance storage used by evals
- existing CI and backend startup paths when eval runner is disabled

Phase 4.5 is additive, but its data dependencies are real. If it corrupts trace, cost, or policy data, reject it.

---

## Manual Stress Checks

Run these before calling Phase 4.5 done:

1. Run a known-good golden task and confirm the trace is stored and scores pass.
2. Introduce one deliberate regression and confirm the gate blocks with a named failing task.
3. Introduce a soft cost-only regression and confirm a warning emits without blocking.
4. Add a new golden task file and confirm `manifest.json` regenerates and the task appears in the runner.
5. Compare two runs for the same task and verify benchmark history shows the regression trend correctly.

---

## Exit Rule

Phase 4.5 passes only if:

- golden tasks are real and runnable
- grader outputs are structured and defensible
- hard floors actually block
- soft alerts actually warn
- historical baseline comparison works
- benchmark storage and dashboard views stay truthful

If this phase ships a dashboard without a real release gate, reject it.
