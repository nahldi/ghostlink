# GhostLink Phase 5 Test Plan

**Owner:** kurt  
**Date:** 2026-04-08  
**Status:** Ready before implementation  
**Spec:** `docs/specs/PHASE_5_6_SPEC.md`  
**Roadmap:** `roadmap-pt2.md`

---

## Scope

Phase 5 is multi-agent execution.

Primary outcomes:

1. Per-agent/task git worktree isolation keyed by stable `agent_id`
2. Background and async agent execution with checkpoint-backed resume
3. Lifecycle hooks with trusted blocking behavior
4. Deep `AGENTS.md` parsing, overlay, and watcher support
5. Arena mode with operator-visible comparison and winner selection
6. Spec-driven execution with acceptance-criteria tracking
7. Multi-agent collaboration patterns with truthful lineage

This phase is where GhostLink stops pretending to be single-agent orchestration with extra tabs. Isolation, concurrency, and audit truth all have to be real.

---

## Hard Constraints

Validation must enforce these:

- worktrees must be keyed by stable `agent_id`, not display name
- merge conflict detection must happen before the real merge touches the main tree
- merge commits for accepted work must use `--no-ff` and preserve task/agent attribution
- background tasks must run as isolated OS processes, not fake async wrappers around the current foreground path
- checkpoint resume must restore the same task/worktree identity after crash or cancel-safe interruption
- hook trust rules must still fail closed for blocking hooks
- `AGENTS.md` must remain read-only input; GhostLink must never write back to it
- arena mode must use real Phase 4A policy, Phase 4B budget, and Phase 4.5 eval signals
- OneDrive and Windows path/locking risks must be tested explicitly because Phase 5 multiplies them
- supervisor/collaboration lineage must be attributable across subtasks, artifacts, and merges

If Phase 5 ships background agents without durable recovery, worktrees without traceable merges, or arena without truthful comparison data, reject it.

---

## Validation Commands

After Phase 5 lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -c "import app; print(app.__version__)"`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`
- `git worktree list`
- `git log --merges --oneline -n 20`

If any previously green command fails, or the worktree/merge state is dirty after validation, Phase 5 fails validation.

---

## Acceptance Buckets

## P5-1. Worktree Isolation

### Must Be True

- each agent or task gets a separate worktree rooted under `.ghostlink/worktrees/<agent_id>`
- branch naming uses the hierarchical `ghostlink/<agent_id>/<task_id-or-default>` format
- reverse name lookup does not reintroduce name-keyed collisions
- `repo_map.py` excludes the new worktree root
- `.ghostlink/` runtime state stays out of git tracking

### Suggested Tests

- `test_worktree_keyed_by_agent_id_not_display_name`
- `test_two_same_model_agents_get_distinct_worktrees`
- `test_task_scoped_branch_name_uses_agent_id_and_task_id`
- `test_repo_map_excludes_dot_ghostlink_worktrees`
- `test_runtime_worktree_metadata_is_gitignored`

### Failure Conditions

- display-name reuse can attach a new task to the wrong worktree
- worktree metadata pollutes repo indexing or git status

---

## P5-2. Merge Safety and Attribution

### Must Be True

- dry-run conflict detection runs before the actual merge
- clean merges create forced merge commits with `--no-ff`
- merge commit message includes agent/task attribution
- failed merge probes leave the main tree clean
- disconnect handling does not auto-merge unsafe background or arena work

### Suggested Tests

- `test_can_merge_reports_conflicts_before_real_merge`
- `test_clean_merge_creates_no_ff_merge_commit`
- `test_merge_commit_message_includes_agent_and_task_metadata`
- `test_failed_merge_probe_leaves_main_tree_clean`
- `test_disconnect_preserves_background_or_arena_worktree_until_resolution`

### Failure Conditions

- conflict detection dirties the main tree
- successful merges fast-forward with no audit marker
- disconnect path still auto-merges everything

---

## P5-3. Worktree Health and Windows/OneDrive Risk

### Must Be True

- health reports include existence, git validity, dirty-file count, last activity, stale status, and disk usage
- stale disconnected worktrees are identified without touching active ones
- long-path and file-lock failures are surfaced honestly on Windows
- OneDrive-synced workspace behavior is validated for task-scoped worktrees

### Suggested Tests

- `test_worktree_health_report_contains_required_fields`
- `test_stale_disconnected_worktree_flagging_does_not_mark_active_task`
- `test_windows_locked_worktree_is_reported_not_silently_deleted`
- `test_long_path_warning_fires_before_worktree_creation_failure`
- `test_onedrive_backed_workspace_preserves_task_scoped_worktree_isolation`

### Failure Conditions

- health monitoring only reports happy-path existence
- Windows path or lock failures cause silent cleanup loss

---

## P5-4. Background Execution

### Must Be True

- background tasks use separate OS processes with bounded concurrency
- queued, starting, running, completed, failed, cancelled, and resuming states are truthful
- progress, output, diff, elapsed time, and cost are queryable while tasks run
- cancel stops at a safe boundary instead of hard-killing mid-write unless explicitly forced
- resume after crash uses the stored checkpoint and original worktree lineage

### Suggested Tests

- `test_background_task_runs_in_separate_process`
- `test_background_task_respects_default_concurrency_limit`
- `test_task_state_machine_transitions_are_truthful`
- `test_running_task_exposes_progress_output_diff_and_cost`
- `test_cancel_requests_safe_boundary_shutdown`
- `test_crashed_background_task_resumes_from_checkpoint_with_same_worktree`

### Failure Conditions

- background mode is only a UI label over the foreground runtime
- resumed work starts from scratch or loses attribution
- orphaned processes survive server shutdown

---

## P5-5. Lifecycle Hooks

### Must Be True

- required new lifecycle events fire in deterministic order
- hook errors are contained and reported without crashing the server
- blocking hooks remain policy-governed and trust-checked
- checkpoint injection for state-changing tool calls happens through the intended hook path

### Suggested Tests

- `test_lifecycle_events_fire_in_expected_order`
- `test_hook_exception_does_not_crash_server_process`
- `test_unsigned_blocking_hook_registration_is_rejected`
- `test_background_write_tool_triggers_checkpoint_via_hook_path`
- `test_nonblocking_hook_failure_is_audited_not_silently_swallowed`

### Failure Conditions

- event order is inconsistent across runs
- untrusted blocking hooks can register or execute

---

## P5-6. AGENTS.md Overlay

### Must Be True

- parser extracts commands, style, testing, and workflow hints from markdown without inventing schema
- nearest-file resolution works predictably in monorepos
- parsed hints appear in effective-state at the documented precedence layer
- watcher detects changes and emits `agents_md_changed`
- GhostLink never writes to `AGENTS.md`

### Suggested Tests

- `test_agents_md_parser_extracts_structured_hints_from_markdown`
- `test_nearest_agents_md_wins_in_monorepo_layout`
- `test_agents_md_overlay_appears_at_correct_precedence_layer`
- `test_agents_md_change_emits_event_within_poll_window`
- `test_no_code_path_writes_back_to_agents_md`

### Failure Conditions

- hints bypass system policy precedence
- watcher misses edits or thrashes on unchanged files
- any implementation path modifies `AGENTS.md`

---

## P5-7. Arena Mode

### Must Be True

- arena dispatch creates isolated contestant tasks and worktrees
- comparison view shows diffs, cost, timing, test results, and eval/grading data
- budget-exceeded contestants remain visible with partial output
- selecting a winner merges only the winner and cleans up losers
- arena metadata persists for audit and benchmark linkage

### Suggested Tests

- `test_arena_dispatch_creates_isolated_contestant_tasks`
- `test_arena_comparison_view_includes_diff_cost_time_tests_and_eval_scores`
- `test_budget_exceeded_contestant_remains_visible_with_partial_output`
- `test_arena_winner_merge_keeps_losers_unmerged_and_cleans_up`
- `test_arena_results_link_into_phase45_benchmark_history`

### Failure Conditions

- arena is just parallel execution with no trustworthy comparison state
- loser branches can leak into the main tree
- eval linkage is missing, making arena results non-benchmarkable

---

## P5-8. Spec-Driven Execution

### Must Be True

- structured specs can be stored, parsed, linked to tasks, and surfaced in execution state
- acceptance criteria progress is tracked truthfully during execution
- spec-driven progress and final outcome survive restart/replay
- removing the feature cleanly falls back to normal task execution

### Suggested Tests

- `test_spec_document_parses_and_links_to_task`
- `test_acceptance_criteria_progress_updates_truthfully`
- `test_spec_progress_survives_restart_and_replay`
- `test_spec_driven_task_without_spec_falls_back_cleanly`

### Failure Conditions

- spec progress is hand-entered UI state disconnected from task execution
- acceptance criteria counts drift from the stored spec

---

## P5-9. Collaboration and Provenance

### Must Be True

- supervisor-created subtasks get distinct task ids and ownership
- worker outputs preserve artifact lineage back to the originating task/spec/checkpoint
- merged results remain attributable to the producing worker
- collaboration does not allow unauthorized write overlap outside defined worktrees

### Suggested Tests

- `test_supervisor_decomposition_creates_distinct_subtasks`
- `test_worker_artifacts_link_back_to_source_task_and_checkpoint`
- `test_final_merge_preserves_worker_attribution`
- `test_collaboration_respects_worktree_write_boundaries`

### Failure Conditions

- subtask lineage is reconstructable only from logs
- collaboration mode allows hidden write overlap in the same tree

---

## Frontend Operator Surfaces

These checks matter because Phase 5 adds a lot of state that can lie to the operator if the UI gets hand-wavy:

- `test_worktree_panel_matches_backend_health_state`
- `test_background_task_dashboard_matches_backend_task_state_machine`
- `test_agents_md_effective_state_view_matches_backend_overlay`
- `test_arena_view_matches_backend_comparison_and_winner_state`
- `test_spec_progress_surface_matches_backend_acceptance_counts`

Failure if the frontend shows a cleaner story than the backend truth.

---

## Regression Checks

Keep these green:

- Phase 1A stable `agent_id` identity contract
- Phase 1B reinjection and same-workspace identity isolation
- Phase 2 effective-state precedence model
- Phase 3 task identity and operator control plane
- Phase 3.5 checkpoint/replay/artifact lineage
- Phase 4A policy, hook trust, and governance
- Phase 4B cost tracking and budget enforcement
- Phase 4.5 eval storage and grading inputs used by arena

Phase 5 is an integration-heavy phase. If it weakens prior safety or attribution guarantees, reject it even if the new features appear to work.

---

## Manual Stress Checks

Run these before calling Phase 5 done:

1. Launch two same-model agents on separate tasks and verify distinct worktrees, distinct diffs, and no identity bleed.
2. Force a merge conflict, confirm the pre-merge report identifies the files, and verify the main tree stays clean after the failed probe.
3. Run three background tasks with the default concurrency limit and verify queued tasks promote correctly when a slot frees up.
4. Simulate a background-agent crash after a write tool call, then resume and verify the checkpoint, worktree, and task lineage all continue from the same identity.
5. Edit a repo `AGENTS.md`, wait for watcher refresh, and verify the effective-state view updates without GhostLink rewriting the file.
6. Run an arena with at least three contestants, force one to hit budget exhaustion, and verify comparison still shows its partial output plus eval data.
7. Complete an arena selection and confirm only the winner merges with a `--no-ff` commit while loser worktrees are discarded.
8. Run the same flow inside a OneDrive-backed workspace on Windows and verify worktree creation, cleanup, and lock/path warnings behave truthfully.

---

## Exit Rule

Phase 5 passes only if:

- worktree isolation is real and auditable
- background execution is durable, bounded, and recoverable
- hook trust and policy enforcement remain intact
- `AGENTS.md` support is useful without becoming a mutating config system
- arena results are comparable, attributable, and wired into eval history
- collaboration lineage stays truthful across subtasks and merges

If GhostLink can run more agents but cannot prove who changed what, why it merged, or how it recovered, Phase 5 is not done.
