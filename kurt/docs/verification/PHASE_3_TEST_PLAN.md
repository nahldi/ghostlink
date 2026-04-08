# GhostLink Phase 3 Test Plan

**Owner:** kurt  
**Date:** 2026-04-07  
**Status:** Ready before implementation  
**Reference:** `roadmap-pt1.md`, `UNIFIED_ROADMAP.md`

---

## Scope

Phase 3 is the operator control plane.

Primary outcomes:

1. Unified task model and dashboard
2. Structured progress visibility
3. Thinking-level controls
4. Context visibility controls
5. Stop/cancel surfaces
6. Provenance, tracing, and operator auditability surfaces

This plan is intentionally limited to Phase 3. Checkpoint/replay/fork behavior belongs to Phase 3.5.

---

## Hard Constraints

Validation must enforce these:

- Phase 3 cannot pretend tracing exists if the underlying trace substrate is absent
- unified task UI must reflect real backend task sources, not just one subsystem
- context visibility must affect real read behavior, not just UI labels
- stop/cancel must affect live agent execution, not just local UI state
- auditability must be searchable and attributable, not raw-log archaeology

If implementation ships a cosmetic dashboard without control or provenance truth, Phase 3 fails.

---

## Validation Commands

After Phase 3 lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -c "import app; print(app.__version__)"`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`

If any previously green command fails, Phase 3 fails validation.

---

## Acceptance Buckets

## P3-1. Unified Task Surface

### Must Be True

- a single task API/model exposes queued/running/completed work regardless of source
- task list can show jobs, agent tasks, and scheduled work together
- task filtering by agent, status, and type is accurate

### Suggested Tests

- `test_unified_tasks_endpoint_includes_all_sources`
- `test_task_dashboard_filters_by_agent_status_type`
- `test_task_updates_reflect_realtime_backend_changes`

### Failure Conditions

- one task subsystem is omitted
- the UI merges incompatible shapes with fake placeholders

---

## P3-2. Structured Progress

### Must Be True

- progress is step-based and attributable to agents/tasks
- step updates stream in real time
- completion percentage is derived from real progress state

### Suggested Tests

- `test_progress_steps_stream_to_ui`
- `test_completion_percentage_matches_step_state`
- `test_progress_remains_correct_after_reconnect`

### Failure Conditions

- progress is just free text with no real structure
- reconnect loses in-flight progress state

---

## P3-3. Thinking Level and Context Controls

### Must Be True

- thinking-level changes persist and affect the correct backend config
- per-channel context visibility exists and changes agent read scope
- UI reflects the current setting accurately

### Suggested Tests

- `test_thinking_level_change_persists`
- `test_context_visibility_filters_chat_read`
- `test_context_visibility_state_matches_backend`

### Failure Conditions

- setting changes only update the UI
- agents can still read hidden context after the filter changes

---

## P3-4. Stop / Cancel Control

### Must Be True

- stop/cancel reaches the live agent process or runtime control path
- cancelled work transitions to a truthful terminal state
- operator can tell whether cancel succeeded or failed

### Suggested Tests

- `test_stop_button_cancels_live_execution`
- `test_cancelled_task_reports_terminal_status`
- `test_cancel_failure_is_operator_visible`

### Failure Conditions

- stop only hides UI activity
- process keeps running after “cancelled”

---

## P3-5. Provenance and Auditability

### Must Be True

- operator can trace who did what, when, and why
- provenance covers prompts, tool calls, artifacts, approvals, and task state changes
- audit search/filter/export works on structured data

### Suggested Tests

- `test_audit_search_filters_by_agent_status_time`
- `test_provenance_chain_links_prompt_tool_artifact_review`
- `test_audit_export_contains_structured_history`
- `test_approval_trace_is_attributable`

### Failure Conditions

- provenance requires reading raw logs manually
- export loses attribution or ordering

---

## Regression Checks

Keep these green:

- Phase 1A identity and Phase 1B drift/effective-state surfaces
- Phase 2 profile/effective-state resolution
- pre-1A backup/restore and migration runner behavior
- existing jobs/rules/schedules behavior that feeds into the unified task layer

---

## Manual Stress Checks

Run these before calling Phase 3 done:

1. Queue work from multiple sources at once.
2. Verify the unified task surface shows all of it coherently.
3. Cancel a running task and confirm the runtime actually stops.
4. Change context visibility for a busy channel and confirm agent reads change accordingly.
5. Reconstruct one task’s full provenance chain from the operator surfaces without opening raw logs.

---

## Exit Rule

Phase 3 passes only if:

- the operator can see real task state across systems
- the operator can control live work
- provenance and auditability are structured and searchable
- context/thinking controls affect actual backend behavior
- no Phase 3.5 checkpoint/replay scope leaked in prematurely

If implementation is mostly presentation without real control or audit truth, reject it.
