# GhostLink Phase 3.5 Test Plan

**Owner:** kurt  
**Date:** 2026-04-07  
**Status:** Ready before implementation  
**Spec:** `docs/specs/PHASE_3_3_5_SPEC.md`

---

## Scope

Phase 3.5 is durable execution and replay.

Primary outcomes:

1. Task-level checkpoint store
2. Resume after crash/interruption
3. Read-only replay and live replay
4. Forked execution branches
5. Pause/resume primitives
6. Replay-safe vs replay-blocked side-effect handling
7. Artifact lineage tied to tasks and checkpoints

This plan assumes Phase 3 is already green. Phase 3.5 is not a workspace snapshot feature refresh. The old file-level `CheckpointPanel` is not the thing being tested here.

---

## Hard Constraints

Validation must enforce these:

- checkpoints must represent real task execution state, not just file snapshots
- resume must come from the latest real checkpoint, not from guessed in-memory defaults
- read-only replay must not execute replay-blocked tools
- forked runs must be independent tasks with independent state after the fork point
- pause/resume must affect live execution, not only UI status badges
- artifact lineage must connect tasks, checkpoints, and produced artifacts truthfully
- defaults for replay classification must fail closed

If implementation hand-waves any of those, Phase 3.5 fails.

---

## Validation Commands

After Phase 3.5 lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -c "import app; print(app.__version__)"`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`

If any previously green command fails, Phase 3.5 fails validation.

---

## Acceptance Buckets

## P35-1. Checkpoint Store

### Must Be True

- a real `checkpoints` table exists in the runtime DB
- checkpoints are created at the required triggers:
  - `task_start`
  - `completion`
  - `pre_tool` for write tools when enabled
  - `post_tool`
  - delegation boundaries when implemented
- each checkpoint is linked to `task_id` and ordered by `sequence_num`
- `state_snapshot` contains the required execution sections instead of an empty placeholder

### Suggested Tests

- `test_checkpoint_created_at_required_triggers`
- `test_checkpoint_snapshot_contains_required_sections`
- `test_checkpoint_sequence_is_monotonic_per_task`
- `test_manual_checkpoint_api_creates_checkpoint`

### Failure Conditions

- checkpoint rows are really workspace snapshots in disguise
- trigger coverage is incomplete or fake
- sequence ordering is unstable

---

## P35-2. Crash Resume

### Must Be True

- interrupted tasks are detectable after heartbeat loss or simulated crash
- resume loads the latest checkpoint for the interrupted task
- pending write actions are surfaced explicitly on resume
- resumed execution preserves task linkage and provenance

### Suggested Tests

- `test_interrupted_task_detected_after_heartbeat_gap`
- `test_resume_after_simulated_crash_uses_latest_checkpoint`
- `test_resume_surfaces_pending_actions_before_retry`
- `test_resumed_task_keeps_trace_and_task_identity`

### Failure Conditions

- crash recovery restarts from scratch without using the checkpoint store
- pending actions are retried blindly
- resumed work loses task identity or trace linkage

---

## P35-3. Replay

### Must Be True

- read-only replay displays original trace history without executing blocked tools
- live replay creates a new task and diverges independently from the source
- replay events are clearly marked as replayed
- replay can start from a chosen checkpoint, not only from the beginning

### Suggested Tests

- `test_read_only_replay_displays_original_trace_without_tool_execution`
- `test_live_replay_creates_new_task_and_diverges`
- `test_replay_from_checkpoint_uses_selected_state`
- `test_replay_events_are_marked_replay_true`

### Failure Conditions

- replay silently re-executes side-effectful tools in read-only mode
- live replay mutates the original task
- replay always starts from the latest state regardless of operator choice

---

## P35-4. Fork Independence

### Must Be True

- fork creates a new task with a new `task_id`
- the forked task starts from the chosen checkpoint state
- subsequent mutations on the fork do not mutate the original branch
- operator can see fork provenance from the source task/checkpoint

### Suggested Tests

- `test_fork_creates_independent_task`
- `test_fork_initial_state_matches_source_checkpoint`
- `test_forked_mutations_do_not_change_original_branch`
- `test_fork_provenance_is_visible_in_task_metadata`

### Failure Conditions

- fork is just a duplicate label on the same task row
- branch state bleeds between original and fork

---

## P35-5. Pause / Resume

### Must Be True

- pause reaches the live runtime and halts work at the next safe boundary
- paused tasks report truthful paused status
- resume restores execution from the paused state without losing progress
- operator can tell whether pause/resume succeeded or failed

### Suggested Tests

- `test_pause_signal_stops_live_work`
- `test_paused_task_reports_truthful_status`
- `test_resume_restores_execution_without_state_loss`
- `test_pause_or_resume_failure_is_operator_visible`

### Failure Conditions

- pause only updates UI state
- resumed work restarts from zero without using saved state

---

## P35-6. Side-Effect Boundaries

### Must Be True

- every replayable tool has an explicit replay classification
- unspecified tools default to `replay_blocked`
- `replay_safe` tools execute during replay
- `replay_blocked` tools are skipped and their original result is displayed
- `replay_requires_confirmation` tools prompt or are skipped according to replay mode

### Suggested Tests

- `test_unknown_tool_defaults_to_replay_blocked`
- `test_replay_blocked_tool_is_not_executed`
- `test_replay_safe_tool_executes_normally`
- `test_confirmation_required_tool_prompts_or_skips_correctly`

### Failure Conditions

- unknown tools execute during replay by default
- blocked tools still cause external side effects

---

## P35-7. Artifact Lineage

### Must Be True

- artifacts are persisted with task, checkpoint, and trace linkage
- repeated writes create a lineage chain via parent/superseded references
- artifact views can jump back to the producing checkpoint
- artifact lineage remains accurate across replay and forked execution

### Suggested Tests

- `test_file_write_creates_artifact_record`
- `test_artifact_supersession_chain_is_recorded`
- `test_artifact_links_back_to_checkpoint`
- `test_replay_and_fork_artifacts_preserve_lineage_truthfully`

### Failure Conditions

- lineage is reconstructable only from raw logs
- replay artifacts overwrite original lineage instead of branching it

---

## Retention / Compaction

These checks are mandatory in this phase because checkpoint volume can explode:

- `test_checkpoint_compaction_keeps_start_completion_and_every_nth`
- `test_checkpoint_retention_deletes_old_rows`
- `test_large_checkpoint_truncates_context_window_before_core_state`

Failure if checkpoint retention silently deletes the only resumable state for an active task.

---

## Regression Checks

Keep these green:

- Phase 1A identity and persistent agent lookup
- Phase 1B identity drift and effective-state behavior
- Phase 2 profile/effective-state surfaces
- Phase 3 unified task, cancel, context-control, and audit behavior

Phase 3.5 is additive. It must not break the Phase 3 operator plane to land replay.

---

## Manual Stress Checks

Run these before calling Phase 3.5 done:

1. Start a long-running task and verify checkpoints appear at the expected moments.
2. Simulate an interruption, reconnect, and resume from the latest checkpoint.
3. Run a read-only replay and confirm blocked tools are not executed.
4. Run a live replay from an intermediate checkpoint and verify it creates a new task.
5. Fork a task from a checkpoint and confirm later state diverges cleanly.
6. Pause live work, then resume it, and verify no state is lost.
7. Inspect one produced artifact and follow its lineage back to the checkpoint that created it.

---

## Exit Rule

Phase 3.5 passes only if:

- checkpointing is real and durable
- crash resume is truthful
- replay respects side-effect boundaries
- forks are independent
- pause/resume controls affect live execution
- artifact lineage is visible and accurate

If implementation is mostly timeline cosmetics without durable state recovery, reject it.
