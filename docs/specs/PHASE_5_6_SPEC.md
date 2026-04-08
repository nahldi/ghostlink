# Phase 5 & 6 Implementation Specification

> **Status:** Audited later-phase design
> **Author:** jeff (spec owner)
> **Date:** 2026-04-07
> **Prerequisite phases:** 3.5 (durable execution), 4A (policy engine), 4B (cost control), 4.5 (evals)
> **Target version:** v6.x - v7.x
> **Primary implementor:** tyson (backend), ned (frontend)

> **2026-04-07 audit note:** This spec is intentionally later-phase design, not implementation-ready truth. It depends on foundations that do not exist yet in live code: stable Phase 1A `agent_id`, automatic crash-safe checkpointing, and a less tmux-coupled execution runtime. Treat every "current implementation" section below as audited against the actual code before building on it.

---

## Table of Contents

- [Phase 5: Multi-Agent Execution](#phase-5-multi-agent-execution)
  - [5.1 Per-Agent Git Worktree Isolation](#51-per-agent-git-worktree-isolation)
  - [5.2 Background/Async Agent Execution](#52-backgroundasync-agent-execution)
  - [5.3 Lifecycle Hooks](#53-lifecycle-hooks)
  - [5.4 AGENTS.md Deep Support](#54-agentsmd-deep-support)
  - [5.5 Arena/Competition Mode](#55-arenacompetition-mode)
  - [5.6 Spec-Driven Development](#56-spec-driven-development)
  - [5.7 Agent Collaboration Patterns](#57-agent-collaboration-patterns)
  - [5.8 Prerequisites Check](#58-prerequisites-check)
  - [5.9 Acceptance Tests, Regression Risks, Rollback Plan](#59-acceptance-tests-regression-risks-rollback-plan)
- [Phase 6: Memory and Intelligence](#phase-6-memory-and-intelligence)
  - [6.1 Full Memory Stratification](#61-full-memory-stratification)
  - [6.2 Selective Identity Reinforcement](#62-selective-identity-reinforcement)
  - [6.3 Weighted Recall and Tagging](#63-weighted-recall-and-tagging)
  - [6.4 Observational Memory](#64-observational-memory)
  - [6.5 Cross-Agent Memory Coordination](#65-cross-agent-memory-coordination)
  - [6.6 Prompt Cache Diagnostics](#66-prompt-cache-diagnostics)
  - [6.7 Acceptance Tests, Regression Risks, Rollback Plan](#67-acceptance-tests-regression-risks-rollback-plan)

---

# Phase 5: Multi-Agent Execution

## 5.1 Per-Agent Git Worktree Isolation

### Current Implementation (backend/worktree.py)

The `WorktreeManager` class already exists and provides basic worktree isolation. Verified state of the current code:

- **Keying:** Worktrees are keyed by `agent_name` (string), stored in `self._worktrees: dict[str, Path]`.
- **Path layout:** `.ghostlink-worktrees/<agent_name>` under `base_workspace`.
- **Branch naming:** `ghostlink-<agent_name>`.
- **Creation:** `git worktree add -b <branch> <dir> HEAD`. Falls back to `git worktree add <dir> <branch>` if the branch already exists.
- **Merge:** `merge_changes()` does `git add -A && git commit` in the worktree, then `git merge <branch> --no-edit` in `base_workspace`. There is no `--no-ff` flag -- the merge uses fast-forward when possible.
- **Cleanup:** `remove_worktree()` runs `git worktree remove --force`, then `git worktree prune`, then `git branch -D`, then `shutil.rmtree` as a safety net.
- **Integration:** `routes/agents.py` calls `create_worktree()` on register and `merge_changes() + remove_worktree()` on deregister/kill. Access is guarded by `hasattr(deps, "worktree_manager") and deps.worktree_manager`.
- **Initialization:** `app.py` creates `WorktreeManager(str(BASE_DIR))` and stores it on `deps.worktree_manager`.
- **Exclusion:** `repo_map.py` already excludes `.ghostlink-worktrees` from indexing.

### What Must Change

#### 5.1.1 Key Migration: agent_name to agent_id

This section is blocked on Phase 1A actually landing a stable `agent_id`. Today, live code still keys the registry and worktrees by display name. The current worktree keying uses `agent_name`, which is a display name derived from `base` + slot number (e.g., `claude`, `claude-2`). Display names can collide across sessions if a different agent reuses the same slot.

**Changes required:**

```python
class WorktreeManager:
    def __init__(self, base_workspace: str):
        self.base_workspace = Path(base_workspace)
        # KEY CHANGE: agent_id (stable UUID) instead of agent_name (display name)
        self._worktrees: dict[str, Path] = {}  # agent_id -> worktree path
```

- `create_worktree(agent_id: str, task_id: str | None = None)` -- accepts `agent_id` from the Phase 1A identity record. Optionally accepts `task_id` for task-scoped worktrees.
- Path layout changes to: `.ghostlink/worktrees/<agent_id>` (not `.ghostlink-worktrees/<agent_name>`). The `.ghostlink/` directory is already conventional for GhostLink runtime state; worktrees move under it.
- Branch naming changes to: `ghostlink/<agent_id>/<task_id>` when task_id is present, or `ghostlink/<agent_id>/default` when absent. Slash-separated branches form a hierarchy visible in `git branch --list 'ghostlink/*'`.
- A reverse lookup `_agent_id_by_name: dict[str, str]` maps display names to agent_ids for backward compatibility during the transition.
- `repo_map.py` exclusion updates from `.ghostlink-worktrees` to `.ghostlink/worktrees`.
- `.gitignore` at project root should include `.ghostlink/` to prevent worktree metadata from being committed.

#### 5.1.2 Merge Strategy: --no-ff for Traceability

The current `merge_changes()` uses the default merge strategy, which fast-forwards when possible. Fast-forward merges lose the branch topology -- there is no merge commit to mark where an agent's work was integrated.

**Change:** Replace `git merge <branch> --no-edit` with:

```
git merge <branch> --no-ff --no-edit -m "ghostlink: merge <agent_name> (<agent_id>) task <task_id>"
```

The `--no-ff` flag forces a merge commit even when fast-forward is possible. The merge commit message includes agent identity and task reference for audit trail.

#### 5.1.3 Conflict Detection Before Merge

The current implementation attempts the merge and reports the conflict after it fails. This leaves the main working tree in a dirty merge state that the operator must manually resolve.

**New flow -- detect before attempting:**

```python
def can_merge(self, agent_id: str) -> dict:
    """Check if an agent's worktree can be cleanly merged.
    Returns {"clean": bool, "conflicting_files": list[str], "stats": dict}.
    """
    branch = self._branch_name(agent_id)
    # 1. Run git diff --stat to get change summary
    # 2. Run git merge-tree (Git 2.38+) or git merge --no-commit --no-ff
    #    to test the merge without applying it
    # 3. If conflicts detected, abort and return conflict details
    # 4. If clean, abort the test merge and return clean=True
```

Implementation uses `git merge-tree --write-tree <base> <branch>` (available since Git 2.38). On Windows with older Git, fall back to `git merge --no-commit --no-ff` followed by `git merge --abort`.

The merge flow becomes:
1. `can_merge()` -- dry run, returns conflict report
2. Operator reviews conflicts (if any) via frontend panel
3. `merge_changes()` -- executes the actual merge (only if `can_merge` passed or operator overrides)

#### 5.1.4 Worktree Health Monitoring

New method on `WorktreeManager`:

```python
def health_check(self) -> list[dict]:
    """Check health of all active worktrees.
    Returns list of health reports per worktree.
    """
```

Each report includes:
- `agent_id`: which agent owns it
- `path`: filesystem path
- `branch`: git branch name
- `exists`: whether the directory exists on disk
- `git_valid`: whether `git worktree list` recognizes it
- `last_commit_ts`: timestamp of the most recent commit in the worktree (used for stale detection)
- `uncommitted_changes`: count of dirty files
- `stale`: True if no commit activity for a configurable timeout (default 30 minutes)
- `disk_usage_bytes`: size of the worktree directory

A background timer calls `health_check()` every 5 minutes. Stale worktrees are flagged in the operator dashboard. Worktrees that are both stale and disconnected (agent no longer registered) are candidates for automatic cleanup.

#### 5.1.5 Cleanup on Agent Disconnect

Current behavior: on deregister, `merge_changes()` runs unconditionally followed by `remove_worktree()`. This auto-merges everything, which is unsafe for background tasks or arena mode.

**New behavior:**

| Scenario | On Disconnect |
|---|---|
| Normal interactive agent | Prompt operator: "Agent X disconnected with uncommitted changes. Merge / Discard / Keep?" |
| Background task (completed) | Merge is already handled by the background task lifecycle. Worktree stays until operator confirms. |
| Background task (in-progress, crashed) | Worktree preserved. Phase 3.5 checkpoint resume uses the same worktree. |
| Arena contestant | Worktree preserved until arena completes and operator selects winner. |
| Stale + disconnected (no registered agent) | Auto-cleanup after configurable grace period (default 1 hour). |

Implementation: `remove_worktree()` gains a `force: bool = False` parameter. Without `force`, it only removes worktrees that have been merged or explicitly discarded. The deregister route calls a new `on_agent_disconnect(agent_id)` method that evaluates the scenario table above.

#### 5.1.6 Windows Compatibility

Git worktrees are fully supported on Windows. Verified considerations:

- **Path length:** Windows has a 260-character path limit by default. The worktree path `.ghostlink/worktrees/<agent_id>` adds ~50 characters to the project path. Projects with deep nesting near the limit may hit issues. Mitigation: detect long paths and warn. Enable `git config core.longpaths true` in the worktree on creation.
- **File locking:** Windows locks open files. `shutil.rmtree` can fail if an editor or process has a file open in the worktree. The current `ignore_errors=True` handles this, but the health monitor should flag locked worktrees.
- **Symlinks:** Git worktrees use `.git` files (not symlinks) to reference the main repo. This works on Windows without symlink permissions.
- **Git version:** `git merge-tree --write-tree` requires Git 2.38+. Windows Git installers commonly ship 2.40+. The code should check `git --version` and fall back to `git merge --no-commit` for older versions.
- **`.ghostlink-worktrees` in current code uses `Path` objects consistently**, which handles `\` vs `/` automatically. The migration to `.ghostlink/worktrees` preserves this.
- **No `fcntl` dependency.** The current `worktree.py` uses only `subprocess`, `shutil`, and `pathlib` -- all Windows-safe. The `mcp_bridge.py` already handles the `fcntl` import gracefully (`fcntl = None` on Windows).

### File Changes

| File | Change |
|---|---|
| `backend/worktree.py` | Rewrite keying, add `can_merge()`, `health_check()`, `on_agent_disconnect()`, `--no-ff` merge |
| `backend/routes/agents.py` | Pass `agent_id` instead of `agent_name` to worktree calls; new worktree status endpoint |
| `backend/deps.py` | No change (already has `worktree_manager` slot) |
| `backend/app.py` | No change (already initializes `WorktreeManager`) |
| `backend/repo_map.py` | Update exclusion from `.ghostlink-worktrees` to `.ghostlink/worktrees` |
| `frontend/` (ned) | New `WorktreePanel.tsx` component |

---

## 5.2 Background/Async Agent Execution

### Audit Constraint: This Is New Runtime Work

Live GhostLink does not have a lightweight non-tmux background executor waiting to be switched on. The wrapper/runtime path is still heavily tmux-oriented, and background execution in this phase is a significant refactor, not a one-line launch-mode tweak.

### Execution Model

Background agents run as **separate OS processes**, not threads. Rationale:
- Agent CLIs (claude, codex, gemini) are external processes already launched via `subprocess` in `wrapper.py`. Running them in a thread provides no isolation.
- A crashed background agent must not take down the GhostLink server.
- Process isolation enables per-agent resource limits (future: cgroups on Linux, Job Objects on Windows).

The background task executor is a new module `backend/bg_executor.py` that manages process lifecycle.

### Task State Machine

```
                     +----------+
                     | created  |
                     +----+-----+
                          |
                   (enqueue)
                          |
                     +----v-----+
                     | queued   |
                     +----+-----+
                          |
                   (slot available, policy check passes)
                          |
                     +----v-----+
                     | starting |  <-- worktree created, checkpoint initialized
                     +----+-----+
                          |
                   (process launched)
                          |
                     +----v-----+
              +------| running  |------+
              |      +----+-----+      |
              |           |            |
        (crash/error)  (success)  (user cancel)
              |           |            |
         +----v---+  +----v-----+  +---v------+
         | failed |  | completed|  | cancelled|
         +--------+  +----------+  +----------+
              |
        (has checkpoint? resume)
              |
         +----v-----+
         | resuming  |  --> running
         +----------+
```

### Process Management

```python
@dataclass
class BackgroundTask:
    task_id: str               # from Phase 3 task system
    agent_id: str              # from Phase 1A identity record
    agent_name: str            # display name for UI
    worktree_path: Path | None # from WorktreeManager
    process: subprocess.Popen | None
    state: TaskState           # enum from state machine above
    created_at: float
    started_at: float | None
    completed_at: float | None
    progress: TaskProgress     # structured progress data
    checkpoint_id: str | None  # Phase 3.5 checkpoint reference
    cancel_requested: bool
    output_log: Path           # file path for stdout/stderr capture
```

The executor maintains a `dict[str, BackgroundTask]` keyed by `task_id`.

**Concurrency limit:** Configurable max concurrent background tasks (default: 3). Tasks beyond the limit remain in `queued` state. The operator can adjust this in settings.

### Dashboard Integration

Background tasks appear in the Phase 3 task dashboard with:
- State indicator (icon + color for each state)
- Progress bar (percentage) and current step description
- Time elapsed / estimated remaining
- Files modified count (from worktree `git status`)
- Token cost so far (from Phase 4B cost tracking)
- Action buttons: View Output, Cancel, View Diff

### Progress Reporting

Background agents report progress via structured events written to a progress file:

```json
{
  "task_id": "abc123",
  "step": 3,
  "total_steps": 7,
  "percentage": 42,
  "description": "Running test suite",
  "files_modified": ["src/auth.py", "tests/test_auth.py"],
  "timestamp": 1712400000.0
}
```

The progress file lives at `data/<agent_id>/progress/<task_id>.json`. The agent writes to it via the existing `chat_progress` MCP tool. The dashboard polls this file (or uses file-system watchers on supported platforms).

### Notification on Completion

When a background task reaches `completed`, `failed`, or `cancelled`:
1. A system message is posted to the relevant channel via `chat_send` with `msg_type: "system"`.
2. The `on_agent_idle` event fires on the EventBus.
3. On desktop (Electron): a system tray notification is shown via the Electron main process.
4. The task dashboard entry updates to show the final state with a "Review" button.

### User Interaction with Background Agents

| Action | Mechanism |
|---|---|
| Check status | GET `/api/tasks/<task_id>` returns current state, progress, cost |
| View output | GET `/api/tasks/<task_id>/output` streams the output log file |
| Cancel | POST `/api/tasks/<task_id>/cancel` sets `cancel_requested = True`; the agent finishes its current tool call then exits |
| View diff | GET `/api/tasks/<task_id>/diff` returns `git diff` from the worktree |
| Resume (after crash) | POST `/api/tasks/<task_id>/resume` restores from Phase 3.5 checkpoint |

### Checkpoint Integration (Phase 3.5)

Background tasks MUST checkpoint. This is a hard requirement, not optional.

Audit note: live code does **not** auto-checkpoint from hooks today. `pre_tool_use` / `post_tool_use` exist on the EventBus, but there is no automatic checkpoint creation path behind them yet. This section describes required new behavior, not current behavior.

- **Checkpoint frequency:** After every tool call that modifies state (file write, API call, database mutation). Read-only tool calls do not trigger checkpoints.
- **Checkpoint content:** Current task state, tool call history, files modified, worktree commit hash, progress data, identity record.
- **Resume flow:** On resume, the executor restores the checkpoint, recreates the worktree from the checkpoint's commit hash, and relaunches the agent process with context from the checkpoint.
- **Integration point:** The `pre_tool_use` / `post_tool_use` hooks in `mcp_bridge.py` are the natural injection point. After `post_tool_use` fires for a write tool, the checkpoint is created.

### File Changes

| File | Change |
|---|---|
| New `backend/bg_executor.py` | Background task executor, process management, state machine |
| `backend/routes/agents.py` | New endpoints for background task CRUD and status |
| `backend/mcp_bridge.py` | Checkpoint injection in post_tool_use for background tasks |
| `backend/wrapper.py` | Background launch mode (no tmux, direct subprocess) |
| `frontend/` (ned) | Background task UI in task dashboard, notification center |

---

## 5.3 Lifecycle Hooks

### Current Hook System (backend/plugin_sdk.py)

The existing `EventBus` in `plugin_sdk.py` provides:
- `on(event, handler)` / `off(event, handler)` -- register/remove Python callables
- `emit(event, data, fail_closed=False)` -- fire event; if `fail_closed=True`, exceptions propagate (blocks the operation)
- 15 standard events defined in the `EVENTS` dict
- `HookManager` class for user-defined automation hooks stored in `data/hooks.json`
- Hook actions: `message` (post to chat), `notify` (log), `trigger` (write to agent queue)
- Integration: `pre_tool_use` fires with `fail_closed=True` in `mcp_bridge.py` (line ~1710). `post_tool_use` fires with `fail_closed=False` (line ~1732). `on_agent_join` fires on register. `on_agent_leave` fires on deregister. `on_message` fires on message post.

Audit note: the live hook schema uses an `action` field with `message|notify|trigger` semantics. Any Phase 5 design that introduces a `type` field or shell/http execution modes is defining a new hook contract and migration, not extending an already-matching schema.

### Gap Analysis: GhostLink vs Claude Code Hooks

Claude Code supports 25+ hook events. GhostLink currently implements 15. The following table maps Claude Code events against GhostLink's current state and the target state for Phase 5.

| Claude Code Event | GhostLink Current | Phase 5 Target | Classification |
|---|---|---|---|
| PreToolUse | `pre_tool_use` (exists, fail_closed) | Keep, extend data payload | Fail-closed |
| PostToolUse | `post_tool_use` (exists, fail_open) | Keep, add result detail | Fail-open |
| AgentStart | Not present | Add as `on_agent_start` | Fail-open |
| AgentStop | Not present | Add as `on_agent_stop` | Fail-open |
| SessionStart | Not present | Add as `on_session_start` | Fail-open |
| SessionEnd | Not present | Add as `on_session_end` | Fail-open |
| PreSend | Not present | Add as `pre_send` | Fail-closed |
| PostReceive | Not present | Add as `post_receive` | Fail-open |
| PreCompact | Not present | Add as `pre_compact` | Fail-open |
| PostCompact | Not present | Add as `post_compact` | Fail-open |
| PermissionRequest | `on_approval_request` (exists) | Rename to align, keep fail-open | Fail-open |
| PermissionResponse | `on_approval_response` (exists) | Keep | Fail-open |
| TaskCreated | Not present | Add | Fail-open |
| TaskCompleted | Not present | Add | Fail-open |
| TaskFailed | Not present | Add | Fail-open |
| PreDelegation | Not present | Add as `pre_delegation` | Fail-closed |
| PostDelegation | Not present | Add as `post_delegation` | Fail-open |
| PreCheckpoint | Not present | Add | Fail-open |
| PostCheckpoint | Not present | Add | Fail-open |
| WorktreeCreated | Not present | Add | Fail-open |
| WorktreeMerged | Not present | Add | Fail-open |
| BudgetWarning | Not present | Add (from Phase 4B) | Fail-open |
| BudgetExhausted | Not present | Add (from Phase 4B) | Fail-closed |

**Total Phase 5 events: 28** (15 existing + 13 new).

### Hook Execution Models

Phase 5 extends the hook system to support three execution models beyond the current Python-callable-only approach:

#### Model 1: Python Callback (existing)

```python
event_bus.on("pre_tool_use", my_handler_function)
```

Used by internal plugins and marketplace plugins. Subject to `SafetyScanner` validation for marketplace code.

#### Model 2: Shell Command

```json
{
  "event": "pre_tool_use",
  "type": "command",
  "command": "python scripts/check_file_size.py",
  "timeout_ms": 5000,
  "failure_behavior": "block"
}
```

The hook manager spawns the command as a subprocess. Event data is passed via stdin as JSON. The command's exit code determines the result:
- `0` = success (action proceeds)
- `2` = block (action is prevented for fail-closed events)
- Any other non-zero = error (treated as block for fail-closed, warn for fail-open)

Stdout is captured as the hook's output message (displayed in logs/UI). Stderr is captured for diagnostics.

#### Model 3: HTTP Webhook

```json
{
  "event": "post_tool_use",
  "type": "http",
  "url": "https://hooks.example.com/ghostlink",
  "method": "POST",
  "timeout_ms": 3000,
  "failure_behavior": "log",
  "headers": {"X-Hook-Secret": "${HOOK_SECRET}"}
}
```

Event data is POSTed as JSON. Response status code determines result (2xx = success, 4xx/5xx = failure). URL is validated against the Phase 4A egress allowlist and SSRF protections.

### Fail-Closed vs Fail-Open Classification

**Fail-closed events** prevent the action if any hook raises an error or returns a blocking exit code. These are security-critical checkpoints:
- `pre_tool_use` -- block dangerous tool calls
- `pre_send` -- block outbound messages that violate policy
- `pre_delegation` -- block unauthorized delegation
- `budget_exhausted` -- block requests when budget is spent

**Fail-open events** log the error and allow the action to proceed. These are observability and automation hooks:
- `post_tool_use`, `post_receive`, `on_message`, `on_agent_join`, `on_agent_leave`, all `on_*` events, `task_created`, `task_completed`, checkpoint events, worktree events

### Hook Configuration Format

Hooks are configured in `data/hooks.json` (existing location) with an extended schema:

```json
{
  "hooks": [
    {
      "id": "hook-1712400000",
      "name": "File size limit",
      "event": "pre_tool_use",
      "type": "command",
      "command": "python hooks/check_file_size.py --max 1048576",
      "timeout_ms": 5000,
      "failure_behavior": "block",
      "enabled": true,
      "signed": false,
      "trust_source": "local",
      "filter": {
        "tool": ["code_execute", "file_write"],
        "agent": "*"
      },
      "created_at": 1712400000,
      "trigger_count": 0
    }
  ]
}
```

New fields vs current schema:
- `type`: `"callback"` | `"command"` | `"http"` (current system only supports `"callback"` implicitly)
- `timeout_ms`: max execution time before the hook is killed (default 5000)
- `failure_behavior`: `"block"` | `"warn"` | `"log"` (replaces the binary fail_closed param)
- `signed`: whether this hook has a valid signature (Phase 4A)
- `trust_source`: `"builtin"` | `"local"` | `"marketplace"` | `"external"`
- `filter`: optional filter to narrow which tool calls or agents trigger the hook

### Policy Engine Integration (Phase 4A)

- Hooks with `failure_behavior: "block"` must be either `signed: true` or `trust_source: "builtin"` or `trust_source: "local"`. Unsigned external hooks cannot use `block` mode.
- Hook execution is logged in the Phase 3/3.5 audit trail with: hook_id, event, result, execution_time_ms, exit_code.
- The policy engine can define rules that require specific hooks to be present for certain tool categories (e.g., "all file_write tools must have a file_size_check hook registered").

### Built-In Hooks (Ship with GhostLink)

| Hook | Event | Behavior | Description |
|---|---|---|---|
| `file_size_check` | `pre_tool_use` | block | Blocks file writes exceeding configurable max size (default 1MB) |
| `secrets_scan` | `post_tool_use` | warn | Scans file write output for common secret patterns (API keys, passwords) |
| `cost_check` | `pre_send` | block | Blocks requests when agent is within 5% of budget limit |
| `delegation_policy` | `pre_delegation` | block | Validates delegation against authority hierarchy |

### File Changes

| File | Change |
|---|---|
| `backend/plugin_sdk.py` | Add 13 new events to `EVENTS` dict; extend `HookManager` with command/http execution; add filter support |
| `backend/mcp_bridge.py` | Add emit calls for new events (pre_send, post_receive, task lifecycle, checkpoint events) |
| `backend/routes/agents.py` | Add emit calls for session/agent lifecycle events |
| `backend/worktree.py` | Add emit calls for worktree events |
| New `backend/hooks.py` | Command and HTTP hook executors, timeout management, exit code semantics |
| `frontend/` (ned) | `HooksConfig.tsx` for hook management UI |

---

## 5.4 AGENTS.md Deep Support

### Parsing

`AGENTS.md` is parsed as raw markdown. No custom DSL -- standard markdown with conventional section headers. The parser extracts structured hints from these sections:

| Section Header | Extracted Data | Example |
|---|---|---|
| `# Commands` or `## Commands` | Shell commands the agent can/should run | `npm test`, `cargo build` |
| `# Style` or `## Coding Style` | Code style preferences | "Use 4-space indentation", "Prefer const over let" |
| `# Boundaries` or `## Restrictions` | Things the agent must not do | "Never modify package-lock.json directly" |
| `# Testing` or `## Test Requirements` | Testing expectations | "All new functions must have unit tests" |
| `# Structure` or `## File Structure` | Project layout guidance | "Components go in src/components/" |
| `# Role` or `## Agent Role` | Role description for the agent | "You are a backend engineer focused on API design" |

The parser is intentionally lenient. It uses heading-level detection (any `#` through `####`) and content extraction between headings. Unrecognized sections are preserved as freeform guidance.

### Implementation

New module: `backend/agents_md.py`

```python
@dataclass
class AgentsMdHints:
    commands: list[str]
    style_rules: list[str]
    boundaries: list[str]
    testing_rules: list[str]
    structure_hints: list[str]
    role_description: str
    raw_sections: dict[str, str]  # heading -> content for unrecognized sections
    source_path: Path
    last_modified: float

def parse_agents_md(path: Path) -> AgentsMdHints | None:
    """Parse an AGENTS.md file into structured hints."""

def find_agents_md(workspace: Path) -> list[Path]:
    """Find all AGENTS.md files in workspace. Nearest file wins in monorepos.
    Searches: workspace root, then subdirectories up to 3 levels deep."""

class AgentsMdWatcher:
    """Watch AGENTS.md files for changes, re-parse, emit event."""
    def __init__(self, workspace: Path, event_bus: EventBus):
        ...
    def start(self):
        """Start a background thread that polls for file changes every 10 seconds."""
    def stop(self):
        ...
```

### Overlay onto Runtime Identity and Rules

`AGENTS.md` content is layered into the Phase 2 rules architecture at a specific precedence level:

```
system policy (highest) > workspace policy > AGENTS.md overlay > user memory > task memory (lowest)
```

The overlay mechanism:
1. `AgentsMdWatcher` detects a change and re-parses.
2. Parsed hints are converted to rule-format entries compatible with the Phase 2 rules system.
3. The rules engine's `get_effective_rules(agent_id)` method includes `AGENTS.md` rules at the correct layer.
4. `EventBus` emits `agents_md_changed` event with the new hints.

### Write-Back Policy

**GhostLink NEVER writes to AGENTS.md.** It is a read-only input. The file belongs to the project, not to GhostLink. This is a hard constraint enforced at the code level -- the `AgentsMdWatcher` and parser have no write methods.

### File Changes

| File | Change |
|---|---|
| New `backend/agents_md.py` | Parser, watcher, hint data structures |
| `backend/plugin_sdk.py` | Add `agents_md_changed` event |
| `backend/app.py` | Initialize `AgentsMdWatcher` on startup |
| `frontend/` (ned) | Display AGENTS.md contribution in effective-state view |

---

## 5.5 Arena/Competition Mode

### Flow

1. **Operator triggers arena:** Selects a task and number of contestants (2-8). Optionally specifies which agent bases to use (e.g., 2x claude + 1x codex) or "any N".
2. **Dispatch:** The arena dispatcher creates N copies of the task, each assigned to a different agent. Each agent gets its own worktree (Section 5.1). No inter-agent communication during arena execution.
3. **Execution:** All agents work in parallel. Phase 4B cost tracking is active per agent. Phase 4A policy applies to all agents. Background execution (Section 5.2) manages the processes.
4. **Completion or timeout:** When all agents finish (or a configurable timeout expires, default 30 minutes), the arena enters the comparison phase. Agents that hit their budget limit stop with partial output.
5. **Comparison view:** Frontend displays side-by-side:
   - Diff (unified diff of each agent's changes vs the original)
   - Token cost per agent
   - Time taken per agent
   - Test results (if the spec includes a test command)
   - Eval scores (from Phase 4.5 graders: correctness, safety, cost efficiency)
6. **Selection:** Operator picks the winning output. The winning agent's worktree branch is merged to the main branch (using `--no-ff`).
7. **Cleanup:** Losing agents' worktrees are discarded. All arena metadata is preserved in the audit trail.

### Data Model

```python
@dataclass
class ArenaRun:
    arena_id: str                  # unique identifier
    task_description: str          # the original task
    spec_id: str | None            # optional Phase 5.6 spec reference
    contestants: list[ArenaContestant]
    state: Literal["running", "comparing", "resolved", "cancelled"]
    created_at: float
    timeout_seconds: int
    resolved_at: float | None
    winner_agent_id: str | None

@dataclass
class ArenaContestant:
    agent_id: str
    agent_name: str
    task_id: str                   # Phase 3 task reference
    worktree_path: Path
    state: Literal["running", "completed", "failed", "timeout", "budget_exceeded"]
    cost: dict                     # {input_tokens, output_tokens, estimated_cost_usd}
    time_elapsed_seconds: float
    eval_scores: dict | None       # Phase 4.5 grader results
    diff_stat: dict | None         # {files_changed, insertions, deletions}
```

### Prerequisites

- Phase 4A (policy) must be complete: arena execution is autonomous multi-agent work that requires governance.
- Phase 4.5 (evals) should be available: eval scoring is the primary objective comparison mechanism. Without evals, comparison is manual-only (still functional, but less useful).
- Phase 4B (cost) must be complete: per-agent budget enforcement prevents runaway spend during arena.

### File Changes

| File | Change |
|---|---|
| New `backend/arena.py` | Arena dispatcher, contestant management, comparison data assembly |
| `backend/routes/agents.py` | Arena CRUD endpoints |
| `backend/bg_executor.py` | Arena-aware task execution (no merge on completion, wait for selection) |
| `frontend/` (ned) | `ArenaView.tsx` with side-by-side comparison |

---

## 5.6 Spec-Driven Development

### Spec Format

Specs are structured markdown documents with machine-readable acceptance criteria:

```markdown
# Spec: Add user authentication

## Description
Implement JWT-based authentication for the REST API.

## File Scope
- backend/auth.py (new)
- backend/routes/auth.py (new)
- backend/middleware.py (modify)
- tests/test_auth.py (new)

## Constraints
- Must use PyJWT library (already in requirements.txt)
- Token expiry: 1 hour
- Refresh token expiry: 7 days

## Acceptance Criteria
- [ ] POST /api/auth/login accepts email + password and returns JWT
- [ ] POST /api/auth/refresh accepts refresh token and returns new JWT
- [ ] Protected routes return 401 without valid JWT
- [ ] Token expiry is enforced (expired token returns 401)
- [ ] Passwords are hashed with bcrypt, never stored in plaintext
- [ ] Unit tests cover all acceptance criteria
```

### Storage

```python
@dataclass
class Spec:
    spec_id: str
    title: str
    description: str
    file_scope: list[str]
    constraints: list[str]
    criteria: list[AcceptanceCriterion]
    created_at: float
    updated_at: float
    linked_task_id: str | None
    linked_agent_id: str | None
    linked_worktree: str | None
    status: Literal["draft", "active", "completed", "abandoned"]

@dataclass
class AcceptanceCriterion:
    criterion_id: str
    text: str
    met: bool
    met_at: float | None
    evidence: str | None  # agent's explanation of how it was satisfied
```

Specs are stored as JSON files in `data/specs/<spec_id>.json`. The spec parser can also read markdown files and convert them to the structured format.

### Agent Interaction

When an agent is assigned a task with a linked spec:
1. The spec content is included in the agent's task context (injected by the wrapper or MCP bridge).
2. The agent reports progress against individual criteria via a new MCP tool `spec_progress`:
   ```json
   {"spec_id": "abc", "criterion_id": "c1", "met": true, "evidence": "Implemented POST /api/auth/login with JWT response"}
   ```
3. Progress updates are visible in the operator dashboard in real-time.

### Integration with Phase 3 Task System

Specs are linked to tasks via `linked_task_id`. A task can have at most one spec. When a spec's task completes, the spec status is updated based on criteria completion:
- All criteria met -> `completed`
- Task completed but criteria incomplete -> stays `active` (operator reviews)
- Task failed -> spec stays `active` for reassignment

### File Changes

| File | Change |
|---|---|
| New `backend/specs.py` | Spec CRUD, markdown parser, progress tracking |
| `backend/mcp_bridge.py` | New `spec_progress` MCP tool |
| `backend/routes/agents.py` | Spec CRUD endpoints |
| `frontend/` (ned) | `SpecEditor.tsx` with criteria checklist and progress tracking |

---

## 5.7 Agent Collaboration Patterns

### Pattern 1: Supervisor (Initial Implementation)

One agent acts as coordinator. It decomposes a goal into subtasks, assigns them to worker agents, and aggregates results.

This builds on the existing `AutonomousManager` in `backend/autonomous.py`, which already has:
- `AutonomousPlan` with subtasks
- `Subtask` with assignee field
- Status tracking per subtask

**Extensions needed:**

```python
@dataclass
class SupervisorSession:
    supervisor_id: str          # agent_id of the supervisor
    worker_ids: list[str]       # agent_ids of workers
    plan: AutonomousPlan        # from autonomous.py
    authority_level: int        # supervisor's authority (from Phase 2 profile)
    artifact_lineage_root: str  # Phase 3.5 lineage graph root node
```

The supervisor communicates with workers via the existing `chat_send` / `chat_read` MCP tools, using @mentions. The supervisor uses `delegate` MCP tool to formally assign subtasks. Workers report completion via `chat_send` to the supervisor.

Artifact lineage (Phase 3.5) tracks the provenance chain: supervisor creates plan -> worker produces artifact -> supervisor aggregates. Every handoff is a lineage edge.

### Pattern 2: Pub-Sub Message Pool (Design Only -- Deferred)

A shared structured message pool where agents publish typed messages and subscribe to types they care about. Based on MetaGPT's shared message pool.

```python
@dataclass
class PoolMessage:
    message_id: str
    publisher_agent_id: str
    message_type: str          # e.g., "code_review_request", "test_result", "design_decision"
    namespace: str             # task_id or workspace_id scope
    payload: dict
    published_at: float
    subscribers_acked: list[str]  # agent_ids that have read this
```

**Deferred rationale:** The supervisor pattern covers the most common multi-agent workflow (hierarchical task decomposition). Pub-sub is useful for peer-to-peer collaboration but adds complexity. Defer until real usage patterns in Phase 5 reveal whether peer-to-peer is needed.

### Pattern 3: Hierarchical Authority (Design Only -- Deferred)

Agents have authority levels defined in their Phase 2 profiles:

| Level | Role | Capabilities |
|---|---|---|
| 0 | Worker | Execute assigned subtasks only |
| 1 | Senior worker | Execute subtasks, provide feedback to other workers |
| 2 | Supervisor | Decompose tasks, assign workers, override worker output |
| 3 | Architect | Define specs, approve merges, override supervisors |

Higher-authority agents can override lower-authority agents' outputs. Authority is enforced by the policy engine (Phase 4A) -- a worker cannot merge to a branch that an architect has locked.

**Deferred rationale:** Authority levels are meaningful only after the supervisor pattern proves stable. Adding authority without the collaboration patterns that need it creates unused complexity.

### When to Use Which Pattern

| Scenario | Recommended Pattern |
|---|---|
| Single complex task with clear subtasks | Supervisor |
| Code review / feedback loop | Supervisor (reviewer = supervisor, author = worker) |
| Peer agents sharing discoveries | Pub-sub (deferred; use @mentions in chat for now) |
| Multi-team with different responsibilities | Hierarchical authority (deferred; use separate supervisor sessions for now) |
| Arena / competition | None (agents work independently) |

### File Changes

| File | Change |
|---|---|
| `backend/autonomous.py` | Extend with `SupervisorSession`, artifact lineage integration |
| `backend/registry.py` | Add `authority_level` field to `AgentInstance` |
| `backend/mcp_bridge.py` | Extend `delegate` tool with supervisor context |
| New `backend/collaboration.py` | Pub-sub message pool (deferred, schema only) |

---

## 5.8 Prerequisites Check

| Phase 5 Feature | Hard Prerequisite | Soft Prerequisite |
|---|---|---|
| 5.1 Worktree isolation | Phase 1A (agent_id for keying) | None |
| 5.2 Background execution | Phase 3.5 (durable execution for checkpoints) | Phase 4B (cost tracking for background spend visibility) |
| 5.3 Lifecycle hooks | Phase 4A (policy for hook trust/signing) | None |
| 5.4 AGENTS.md support | Phase 2 (rules system for overlay) | None |
| 5.5 Arena mode | Phase 4A (policy for autonomous execution) | Phase 4.5 (evals for automated grading) |
| 5.6 Spec-driven dev | Phase 3 (task system for linking) | None |
| 5.7 Collaboration | Phase 3.5 (artifact lineage for provenance) | Phase 5.1 (worktrees for worker isolation) |

**Implementation order within Phase 5:**
1. 5.1 (worktree refactor) -- foundation for everything else
2. 5.3 (hooks) -- needed by background execution and arena
3. 5.2 (background execution) -- uses worktrees and hooks
4. 5.4 (AGENTS.md) -- independent, can parallel with 5.2
5. 5.6 (spec-driven) -- independent, can parallel with 5.2
6. 5.7 (collaboration/supervisor) -- uses worktrees and background execution
7. 5.5 (arena) -- uses all of the above

---

## 5.9 Acceptance Tests, Regression Risks, Rollback Plan

### Acceptance Tests

| ID | Test | Expected Result |
|---|---|---|
| T5.1.1 | Two agents register concurrently; each gets a separate worktree with non-overlapping file scopes. Both produce independent diffs. | Both worktrees exist, branches are independent, diffs don't conflict. |
| T5.1.2 | Agent's worktree is merged with `--no-ff`. Verify the merge commit exists and contains agent_id in the message. | `git log --merges` shows the merge commit with correct metadata. |
| T5.1.3 | `can_merge()` detects a conflicting file change before merge attempt. | Returns `{"clean": false, "conflicting_files": ["src/shared.py"]}`. |
| T5.1.4 | Worktree health check detects a stale worktree (no commits for 30+ minutes). | Health report includes `"stale": true`. |
| T5.1.5 | On Windows: worktree creation and merge complete successfully with paths under 260 chars. | No path-length errors. |
| T5.2.1 | Background task completes and operator receives notification in the task dashboard. | Task state is `completed`, system message appears in channel. |
| T5.2.2 | Background task is cancelled via API. Agent stops within 10 seconds. | Task state is `cancelled`, process is terminated. |
| T5.2.3 | Background task crashes. Resume from checkpoint restores state and worktree. Agent continues from last checkpoint. | Resumed task completes from where it left off. |
| T5.2.4 | Background task shows progress updates (percentage, step description) in dashboard. | Dashboard shows live progress. |
| T5.3.1 | A `block`-type hook on `pre_tool_use` raises an error. The tool call is prevented. | Tool returns error message, action is not executed. |
| T5.3.2 | A `warn`-type hook on `post_tool_use` raises an error. The action proceeds, warning is logged. | Tool result is returned, warning appears in logs. |
| T5.3.3 | A shell command hook times out (exceeds `timeout_ms`). | Hook is killed, treated as failure per `failure_behavior`. |
| T5.3.4 | An unsigned external hook attempts to register as `block`-type. | Registration is rejected by policy engine. |
| T5.4.1 | AGENTS.md from a test repo is parsed. Style rules appear in effective state, but do not override system policy. | Effective state shows AGENTS.md contribution at correct precedence level. |
| T5.4.2 | AGENTS.md is modified on disk. Watcher detects change within 10 seconds and re-parses. | `agents_md_changed` event fires with updated hints. |
| T5.5.1 | Arena with 3 agents (non-overlapping file scopes). All complete. Comparison view shows diffs, costs, and eval scores. | All three diffs are visible, costs are accurate, eval scores are present. |
| T5.5.2 | Operator selects winner. Winner's branch is merged. Losers' worktrees are cleaned up. | Winner's changes appear in main branch. Loser worktrees are removed. |
| T5.5.3 | One arena agent hits budget limit. Its partial output appears in comparison. | Partial output is visible with `budget_exceeded` state. |
| T5.6.1 | Spec with 5 acceptance criteria. Agent marks 3 as met during execution. Dashboard shows 3/5 progress. | Progress tracking is accurate and updates in real-time. |
| T5.7.1 | Supervisor decomposes a task into 3 subtasks. Workers complete all 3. Supervisor aggregates results. | All subtasks show `done` state, artifact lineage graph is connected. |

### Regression Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Worktree keying migration breaks existing agent registration flow | High | Feature flag: `use_agent_id_worktrees`. Defaults to `False` until Phase 1A is complete. Falls back to agent_name keying when False. |
| Background process leaks (orphaned processes) | High | Process health monitor in bg_executor.py. On server shutdown, SIGTERM all background processes. Process group tracking on Unix. |
| Hook execution crashes main server process | Critical | All hook execution is wrapped in try/except. Command hooks run in subprocess. HTTP hooks have timeout. The EventBus `fail_closed` flag already catches exceptions per handler, not globally. |
| Arena mode creates excessive disk usage (N worktrees) | Medium | Disk space check before arena creation. Max worktree count limit (configurable, default 8). Automatic cleanup of completed arenas after 1 hour. |
| AGENTS.md watcher creates excessive filesystem polling | Low | 10-second poll interval (not inotify/FSEvents). Configurable. Can be disabled. |

### Rollback Plan

| Component | Rollback Strategy |
|---|---|
| 5.1 Worktree refactor | Feature flag `use_agent_id_worktrees`. When False, old `agent_name` keying is used. The `--no-ff` merge and conflict detection are purely additive and can be reverted to the current `git merge --no-edit` with a one-line change. |
| 5.2 Background execution | Background mode is opt-in per task. Disabling it routes all tasks through the existing interactive tmux workflow. The bg_executor.py module can be disabled by removing it from app.py initialization. |
| 5.3 Hooks | New events are additive. Removing a hook event is a no-op if no hooks are registered for it. Shell/HTTP hook executors can be disabled by reverting to callback-only mode in HookManager. |
| 5.4 AGENTS.md | The watcher is a separate component started in app.py. Removing the `start()` call disables it entirely. The rules overlay is a single layer in the precedence stack; removing it falls through to the next layer. |
| 5.5 Arena | Purely additive feature. Removing arena endpoints and the dispatcher has no effect on normal operation. |
| 5.6 Spec-driven dev | Purely additive. Removing spec storage and the `spec_progress` tool has no effect on task execution. |
| 5.7 Collaboration | Supervisor mode is an extension of `AutonomousManager`. Removing `SupervisorSession` reverts to the existing single-agent autonomous mode. |

---

# Phase 6: Memory and Intelligence

## Audit Constraint: Existing Memory Systems Already Exist

Live code already initializes `MemoryGraph` and `RAGPipeline` in `backend/app.py` / `backend/deps.py`. Phase 6 must either integrate with those systems or explicitly replace them. It should not quietly design a parallel memory architecture that ignores them.

## 6.1 Full Memory Stratification

### Current Implementation (backend/agent_memory.py)

The existing `AgentMemory` class provides:
- **Storage:** Per-agent directory under `data/<agent_name>/memory/` with individual JSON files per key.
- **Entry format:** `{"key", "content", "agent", "created_at", "updated_at"}`.
- **Search:** Keyword search with basic scoring: key exact match (+10), key word match (+5 per word), content word match (+1 per occurrence). Results sorted by score descending.
- **Cross-agent search:** `search_all_memories()` searches across all agents' memory directories. Results sorted by `updated_at`.
- **Identity/Soul:** `get_soul()` / `set_soul()` read/write a `soul.txt` file per agent. Default soul template includes agent name and basic instructions.
- **Context template:** `GHOSTLINK_CONTEXT_TEMPLATE` provides comprehensive agent context (who you are, what is GhostLink, available tools, rules).
- **Caching:** `get_agent_memory()` caches instances with a 5-minute TTL.
- **Thread safety:** All operations use `threading.RLock`.
- **Key sanitization:** Filesystem-safe key names with hash suffix for collision avoidance.

### Four-Layer Architecture

The current flat memory model (all entries are peers with no hierarchy) is replaced by a four-layer stratified model:

#### Layer 1: Identity Memory (NEVER evicted)

- **Contents:** Agent role, personality (soul), core instructions, capability declarations, Phase 1B identity profile.
- **Source:** Set at agent spawn via `set_soul()`, `GHOSTLINK_CONTEXT_TEMPLATE`, and Phase 1B identity injection.
- **Lifecycle:** Created once, persists indefinitely. Never subject to eviction or decay.
- **Storage path:** `data/<agent_id>/memory/identity/` (separate directory from other layers).
- **Token budget:** Fixed allocation, typically 500-1500 tokens depending on soul complexity. Not subject to compression.
- **Access pattern:** Read at every context construction. Written only by explicit operator action or Phase 1B identity system.

```json
{
  "key": "core_identity",
  "content": "You are Jeff, an architect agent...",
  "layer": "identity",
  "agent_id": "a1b2c3d4",
  "created_at": 1712400000.0,
  "updated_at": 1712400000.0,
  "importance": 1.0,
  "access_count": 847,
  "last_accessed": 1712486400.0,
  "tags": ["identity", "core"],
  "source_agent_id": null,
  "evictable": false
}
```

#### Layer 2: Workspace Memory (slow decay)

- **Contents:** Project-level knowledge -- architecture patterns, key file locations, dependency relationships, build instructions, coding conventions, AGENTS.md hints (from Phase 5.4).
- **Source:** Agent observations during work sessions, operator-defined workspace context, promoted session summaries (Layer 4), AGENTS.md overlay.
- **Lifecycle:** Persists across sessions. Decays slowly -- items not accessed for 30 days have their importance score reduced by 10% per day. Items reaching importance < 0.05 are evicted.
- **Storage path:** `data/<agent_id>/memory/workspace/`.
- **Token budget:** Configurable (default 8000 tokens). When exceeded, lowest-scored items are evicted first.
- **Access pattern:** Read during context construction for relevant items. Written during and after work sessions.

#### Layer 3: Session Memory (fast decay)

- **Contents:** Current task context, recent tool call results, conversation state, intermediate reasoning, temporary notes.
- **Source:** Created during active sessions by the agent's work.
- **Lifecycle:** Evicted at session end. Items that meet promotion thresholds are summarized and promoted to workspace layer (Layer 4 mechanism).
- **Storage path:** `data/<agent_id>/memory/session/<session_id>/`.
- **Token budget:** Configurable (default 4000 tokens). Hard cap -- when exceeded, oldest items are evicted immediately.
- **Access pattern:** Read and written frequently during the active session.

#### Layer 4: Promoted Summaries ("Dreaming")

Promotion is the mechanism by which important session learnings survive session end. It is not a separate storage layer -- promoted items are stored in the workspace layer with a `promoted: true` flag.

**Promotion trigger:** Session end or context compaction (Phase 1B).

**Promotion process:**
1. At session end, the system reviews all session memory items.
2. Items with `importance >= 0.5` AND `access_count >= 3` are candidates for promotion.
3. Candidates are summarized: multiple related items are compressed into a single summary entry. The summary preserves key decisions, outcomes, and learnings but discards intermediate reasoning.
4. Summary is written to the workspace layer with `promoted: true`, `source_session_id`, and `promoted_at` metadata.
5. Session layer is then cleared.

**Summary generation:** The summarizer uses a simple extraction approach (not an LLM call -- that would add cost and latency):
- Group candidates by tag.
- For each group, concatenate content and truncate to the top N sentences (determined by importance-weighted sentence scoring).
- Prefix with the tag name and session date.

### Entry Metadata Schema (All Layers)

Every memory entry across all layers uses this schema:

```json
{
  "key": "string",
  "content": "string",
  "layer": "identity | workspace | session",
  "agent_id": "string",
  "created_at": 1712400000.0,
  "updated_at": 1712400000.0,
  "last_accessed": 1712400000.0,
  "access_count": 0,
  "importance": 0.5,
  "tags": ["string"],
  "source_agent_id": "string | null",
  "source_session_id": "string | null",
  "promoted": false,
  "promoted_at": null,
  "evictable": true,
  "size_tokens": 0
}
```

New fields vs current schema: `layer`, `last_accessed`, `access_count`, `importance`, `tags`, `source_agent_id`, `source_session_id`, `promoted`, `promoted_at`, `evictable`, `size_tokens`.

### Cross-Layer Search

The existing `search()` method is extended to search across layers with layer-weighted scoring:

```python
def memory_search(self, query: str, *, layers: list[str] | None = None,
                  tags: list[str] | None = None, limit: int = 10) -> list[dict]:
    """Search memories with cross-layer weighted scoring.

    Layer weights (applied as multipliers to base relevance score):
    - identity: 2.0x (identity items are always highly relevant)
    - workspace: 1.5x (project context is broadly relevant)
    - session: 1.0x (current context, no boost needed)
    """
```

### Eviction/Decay Policies

| Layer | Eviction Trigger | Decay Rate | Policy |
|---|---|---|---|
| Identity | NEVER | None | Items are permanent. Only explicit operator deletion removes them. |
| Workspace | Token budget exceeded OR importance < 0.05 | -10% importance per day when not accessed for 30 days | Lowest-scored items evicted first. Promoted summaries have a floor of importance 0.2 (they decay slower). |
| Session | Session end OR token budget exceeded | None (fast clear at session end) | All items evicted at session end. Items meeting promotion threshold are promoted first. Oldest items evicted first during budget pressure. |

### Migration from Current Schema

Existing memory entries (no `layer` field) are treated as workspace-layer items. The migration path:
1. On first access after upgrade, `AgentMemory` checks for entries without a `layer` field.
2. Missing fields are backfilled with defaults: `layer: "workspace"`, `importance: 0.5`, `access_count: 1`, `tags: []`, etc.
3. Existing `soul.txt` files are migrated to identity-layer entries.
4. No data is deleted during migration.

### File Changes

| File | Change |
|---|---|
| `backend/agent_memory.py` | Add layer support, metadata schema, eviction engine, cross-layer search, promotion mechanism, migration logic |
| `backend/mcp_bridge.py` | Update `memory_save/load/search` tools to accept layer parameter |
| `frontend/` (ned) | `MemoryInspector.tsx` with layer tabs, importance editor, tag filter |

---

## 6.2 Selective Identity Reinforcement

### Trigger Events for Reinjection

Identity reinforcement fires at these boundaries (extending Phase 1B):

| Trigger | Detection Mechanism | Priority |
|---|---|---|
| Context compaction | Provider-specific detection (see below) | Critical |
| Session resume | New session_id with same agent_id detected by the wrapper | Critical |
| Delegation handoff | `pre_delegation` hook fires | High |
| Task boundary transition | Task state changes from one task to another | High |
| Context budget threshold | Token count exceeds N% of model's context window (default 70%) | Medium |
| Long idle period | Agent has been idle for > 15 minutes then receives a message | Low |

### Provider-Specific Compaction Detection

Different providers compact context differently. Detection strategies:

| Provider | Detection Method |
|---|---|
| Claude | Monitor for `[system]` messages indicating context truncation. Track message count -- if the response references a message_id that should be in context but is not, compaction has occurred. |
| Codex | Codex manages context internally. Detect via response quality degradation (identity drift heuristic, see below). |
| Gemini | Gemini's context window is large (1M+). Compaction is rare but detectable via `usageMetadata.cachedContentTokenCount` dropping. |
| Generic | Track cumulative token count. When it exceeds 80% of model's declared context window, assume compaction is imminent and reinforce proactively. |

### Token Budget for Identity Block

The identity block has a fixed token budget to avoid overwhelming the context:

| Component | Budget |
|---|---|
| Core soul text | 200-500 tokens |
| GhostLink context template | ~400 tokens |
| Role and capability declarations | 100-200 tokens |
| Active rules overlay | 100-300 tokens |
| **Total identity block** | **800-1400 tokens** |

The identity block is constructed by `generate_agent_context()` (already exists in `agent_memory.py`). Phase 6 extends this function to include only the components whose importance scores indicate they are at risk of being pushed out of context.

### Selective Injection Algorithm

Not all identity components need reinjection at every boundary. The algorithm:

1. On trigger event, check which identity components were last injected.
2. Compare the current context's estimated token position for each component against the model's context window size.
3. Components in the bottom 20% of the context window (most likely to be evicted during compaction) are candidates for reinjection.
4. Reinject candidates by prepending them to the next system message.
5. Components that are still in the top 50% of context are skipped (no redundant injection).

### Identity Drift Detection

Track behavioral indicators that suggest the agent is drifting from its identity:

```python
def detect_drift(agent_id: str, recent_messages: list[dict]) -> float:
    """Return a drift score 0.0-1.0.
    0.0 = perfectly on-identity, 1.0 = completely drifted.
    """
```

Heuristic signals:
- Agent stops using its assigned name in `chat_send` sender field
- Agent's response style diverges from its soul description (measured by keyword overlap)
- Agent ignores its role boundaries (detected via tool usage patterns vs role expectations)
- Agent fails to use @mentions or GhostLink conventions

Drift score > 0.7 triggers an automatic identity reinjection. Drift score > 0.9 flags the agent for operator review.

### Reinforcement Without Disrupting Current Work

Identity reinjection must not interrupt the agent's current task or confuse its conversation state:

- Reinjected identity is prepended to the system prompt, not inserted mid-conversation.
- The reinjection message includes a brief anchor: "Reminder: you are [name], working on [current_task]. Continue your current work."
- The reinjection does NOT repeat the full conversation history -- it only reinforces identity and current task context.
- Reinjection is invisible to the agent's conversation flow -- it appears as a system-level instruction, not a user message.

### File Changes

| File | Change |
|---|---|
| `backend/agent_memory.py` | Identity layer management, `generate_agent_context()` extension for selective injection |
| `backend/wrapper.py` | Compaction detection, drift tracking, reinjection trigger logic |
| `backend/mcp_bridge.py` | System prompt prepend mechanism for reinjection |
| New `backend/identity.py` | Drift detection, reinforcement scheduling, provider-specific detection |
| `frontend/` (ned) | Drift indicator in agent status display |

---

## 6.3 Weighted Recall and Tagging

### Relevance Scoring Formula

The default scoring formula for memory recall:

```
score = W_recency * recency_score + W_frequency * frequency_score + W_importance * importance_score
```

Default weights: `W_recency = 0.4`, `W_frequency = 0.3`, `W_importance = 0.3`.

Weights are configurable per workspace via settings.

**Component calculations:**

```python
def recency_score(last_accessed: float, now: float) -> float:
    """Exponential decay: score = exp(-lambda * hours_since_access)
    lambda = 0.01 (slow decay over days)
    """
    hours = (now - last_accessed) / 3600
    return math.exp(-0.01 * hours)

def frequency_score(access_count: int, max_access_count: int) -> float:
    """Normalized frequency: score = log(1 + count) / log(1 + max_count)
    Log scale prevents high-access items from dominating.
    """
    if max_access_count == 0:
        return 0.0
    return math.log(1 + access_count) / math.log(1 + max_access_count)

def importance_score(importance: float) -> float:
    """Direct pass-through. importance is already 0.0-1.0."""
    return importance
```

### Tag Schema

Tags categorize memory items for filtered retrieval. Predefined categories:

| Tag | Description | Example Content |
|---|---|---|
| `architecture` | System design decisions | "The API uses a layered architecture with routes/services/models" |
| `dependency` | Dependency information | "Project uses FastAPI 0.104+ and Python 3.11+" |
| `pattern` | Code patterns and conventions | "All routes use async/await. Never use synchronous DB calls." |
| `decision` | Design or implementation decisions | "Chose PyJWT over python-jose for JWT handling" |
| `bug` | Known bugs and workarounds | "WSL detection requires -e flag (fixed in v5.0.11)" |
| `convention` | Naming/style conventions | "Use snake_case for Python, camelCase for TypeScript" |
| `tool_preference` | Tool usage preferences | "User prefers pytest over unittest" |
| `observational` | System-inferred observations | "Agent frequently uses git diff before commits" |
| `promoted` | Promoted session summaries | "Session 2024-04-05: implemented auth module, key decision: JWT over sessions" |
| `custom` | User-defined tags | Any operator-assigned tag |

Agents can assign multiple tags to a single memory item. Tags are stored as a list of strings in the entry metadata.

### Changes to memory_search in agent_memory.py

The current `search()` method uses a simple word-match scoring system. It is replaced with the weighted scoring system:

```python
def search(self, query: str, *, tags: list[str] | None = None,
           layers: list[str] | None = None, limit: int = 10,
           weights: dict[str, float] | None = None) -> list[dict]:
    """Search memories with weighted relevance scoring.

    Args:
        query: Search query string
        tags: Optional tag filter (items must have at least one matching tag)
        layers: Optional layer filter (default: all layers)
        limit: Max results to return
        weights: Override default scoring weights
            {"recency": 0.4, "frequency": 0.3, "importance": 0.3}
    """
```

The word-match component is preserved as a `relevance_boost` that is added to the weighted score:
- Key exact match: +0.5 to final score
- Key word match: +0.2 per word
- Content word match: +0.05 per occurrence (capped at +0.5)

This preserves backward compatibility: queries that matched well under the old system still score well.

### Storage Changes

Each memory entry gains new fields (already defined in the Section 6.1 schema): `last_accessed`, `access_count`, `importance`, `tags`. On every `load()` or `search()` hit, `last_accessed` and `access_count` are updated atomically.

### File Changes

| File | Change |
|---|---|
| `backend/agent_memory.py` | Replace `search()` with weighted scoring, add tag filtering, update access metadata on read |

---

## 6.4 Observational Memory

### What Patterns to Observe

The observation engine passively monitors agent and operator behavior to build workspace-level knowledge:

| Observation Type | What Is Tracked | Detection Method |
|---|---|---|
| Tool preferences | Which MCP tools the agent/operator uses most frequently | Count tool invocations per `post_tool_use` event |
| Code style | Indentation, naming conventions, import ordering, comment style | Analyze file writes via `post_tool_use` events for write tools |
| Review patterns | What kinds of changes the operator requests revisions on | Track approval/denial patterns in the approval system |
| Workflow patterns | Typical task sequences, preferred agent assignments | Track task creation and assignment patterns |
| File affinity | Which files an agent frequently reads or modifies | Count file access via tool arguments |
| Error patterns | Common errors encountered and how they were resolved | Track `failed` tool calls and subsequent corrective actions |

### Storage

Observations are stored as workspace-layer memory items with the `observational` tag and a structured content format:

```json
{
  "key": "obs_tool_preference_git_diff",
  "content": "Agent 'jeff' uses git_diff before every commit (observed 23 times in 5 sessions). Confidence: 0.92",
  "layer": "workspace",
  "tags": ["observational", "tool_preference"],
  "importance": 0.3,
  "observation_meta": {
    "type": "tool_preference",
    "subject": "git_diff",
    "count": 23,
    "sessions_observed": 5,
    "confidence": 0.92,
    "first_observed": 1712400000.0,
    "last_observed": 1712486400.0,
    "confirmed_by_operator": false
  }
}
```

### How Observations Influence Agent Behavior

Observations are included in the workspace memory layer and retrieved during context construction. They appear as soft hints, not hard rules:

- "Based on project history, tests are usually run with `pytest -v` (observed 15 times)."
- "This project uses 2-space indentation in TypeScript files (observed across 30 file writes)."

The observation influence is weighted by confidence. Observations with `confidence < 0.5` are not included in context. Observations with `confidence >= 0.8` are formatted as strong recommendations.

Confidence increases with repeated observation. Each new confirming observation adds:
```
confidence = min(1.0, confidence + 0.1 * (1 - confidence))
```

### Privacy Considerations

- Observations are per-workspace, not per-user. They capture workspace patterns, not personal habits.
- Operators can review all observational memories via the Memory Inspector UI.
- Operators can delete any observational memory, or disable the observation engine entirely via settings.
- Observational memories have lower default importance (0.3) than explicit memories (0.5). They are evicted first when the workspace layer hits its token budget.
- Observations are never shared outside the workspace (no cross-workspace observation leakage).
- The observation engine does NOT analyze message content for sentiment or personal information. It only tracks structural patterns (tool usage, file access, code style).

### Implementation

New module: `backend/observer.py`

```python
class ObservationEngine:
    """Passive observer that builds workspace knowledge from usage patterns."""

    def __init__(self, agent_memory: AgentMemory, event_bus: EventBus):
        self._memory = agent_memory
        self._event_bus = event_bus
        self._pending_observations: dict[str, dict] = {}
        # Accumulator: don't write every observation immediately.
        # Batch-write every 5 minutes or on session end.

    def start(self):
        """Register event handlers for observation."""
        self._event_bus.on("post_tool_use", self._on_tool_use)
        self._event_bus.on("on_session_end", self._flush)

    def _on_tool_use(self, data: dict):
        """Process a tool use event for pattern detection."""
        ...

    def _flush(self, data: dict | None = None):
        """Write accumulated observations to memory."""
        ...
```

### File Changes

| File | Change |
|---|---|
| New `backend/observer.py` | Observation engine, pattern detection, confidence scoring |
| `backend/agent_memory.py` | Support for `observation_meta` field in entries |
| `backend/app.py` | Initialize and start `ObservationEngine` |
| `frontend/` (ned) | Observation review section in Memory Inspector |

---

## 6.5 Cross-Agent Memory Coordination

### Shared Workspace Memory Namespace

All agents in a workspace share read access to a common workspace memory pool. The namespace structure:

```
data/workspace/<workspace_id>/
    shared/                    # shared namespace (promoted items, operator-set items)
        architecture.json
        conventions.json
    agent/<agent_id>/          # per-agent write namespace
        observations.json
        decisions.json
```

### Write Isolation

Each agent writes to its own namespace: `data/workspace/<workspace_id>/agent/<agent_id>/`. Agents cannot write to another agent's namespace or to the shared namespace directly.

Promotion to shared namespace requires operator approval (or supervisor agent approval if hierarchical authority is active):

```python
def propose_promotion(self, agent_id: str, key: str) -> dict:
    """Agent proposes a memory item for promotion to shared namespace.
    Returns a proposal that the operator can approve or reject.
    """

def approve_promotion(self, proposal_id: str) -> dict:
    """Operator approves a promotion. Item is copied to shared namespace."""

def reject_promotion(self, proposal_id: str) -> dict:
    """Operator rejects a promotion. Proposal is archived."""
```

### Conflict Resolution

When multiple agents observe the same thing differently:

1. **Detection:** On each new write to a per-agent namespace, the coordination system checks for existing entries in other agents' namespaces with overlapping tags or keys.
2. **Conflict identification:** Two entries conflict if they share a tag AND their content is semantically opposed (detected via keyword negation: "always" vs "never", "should" vs "should not", contradictory values).
3. **Resolution flow:**
   - Conflict is flagged with both entries visible in the Memory Inspector.
   - Operator reviews and picks the correct version (or writes a reconciled version).
   - The resolved version is promoted to the shared namespace.
   - Conflicting entries in per-agent namespaces are marked as `superseded`.

### Memory Event Notifications

The coordination system emits events for memory changes:

| Event | Data | Purpose |
|---|---|---|
| `memory_written` | `{agent_id, key, layer, tags}` | Notify other agents of new knowledge |
| `memory_promoted` | `{key, from_agent_id, to_namespace}` | Notify all agents of shared knowledge update |
| `memory_conflict` | `{key, agents, tags}` | Alert operator to conflicting observations |

These events fire on the EventBus and are available to hooks and plugins.

### Performance Considerations

Cross-agent memory coordination is read-heavy, write-light:
- Reads (agents checking shared namespace) happen on every context construction. Must be fast (<10ms).
- Writes (agents storing observations) happen periodically (every few minutes). Can tolerate 50-100ms.
- Conflict detection runs on writes only. Linear scan of other agents' entries for overlapping tags. Acceptable at current scale (< 20 agents, < 1000 entries per namespace).

Caching: The shared namespace is cached in memory with a 60-second TTL. Per-agent namespaces are cached per-agent with the existing 5-minute TTL from `_memory_cache`.

### File Changes

| File | Change |
|---|---|
| New `backend/memory_coordination.py` | Shared namespace, promotion protocol, conflict detection |
| `backend/agent_memory.py` | Namespace-aware storage paths, write isolation enforcement |
| `backend/mcp_bridge.py` | Memory tools gain workspace-read capability |
| `backend/plugin_sdk.py` | Add memory events to EVENTS dict |
| `frontend/` (ned) | Conflict resolution UI in Memory Inspector |

---

## 6.6 Prompt Cache Diagnostics

### Cache Hit/Miss Tracking

Per-provider, per-session tracking of prompt cache behavior:

```python
@dataclass
class CacheStats:
    provider: str
    session_id: str
    agent_id: str
    total_requests: int
    cache_hits: int
    cache_misses: int
    cache_hit_rate: float        # hits / total
    cached_tokens_read: int      # tokens served from cache
    uncached_tokens_read: int    # tokens processed without cache
    estimated_savings_usd: float # estimated cost savings from cache hits
    last_updated: float
```

### Data Collection

Cache data is collected from provider response metadata. Each provider reports cache usage differently:

| Provider | Cache Data Source |
|---|---|
| Claude | `usage.cache_creation_input_tokens` and `usage.cache_read_input_tokens` in response |
| Codex | Not directly exposed. Estimated from request/response token counts and latency patterns. |
| Gemini | `usageMetadata.cachedContentTokenCount` in response |
| Generic | If provider returns cache metadata in any form, extract it. Otherwise, estimate from latency (cache hits are faster). |

Collection point: The transport layer (Phase 4B) extracts cache metadata from each provider response and writes it to `CacheStats`. This happens in the `post_receive` hook or directly in the transport adapter.

### Storage

Cache stats are stored in `data/diagnostics/cache/<provider>/<session_id>.json`. Aggregated stats (daily/weekly) are stored in `data/diagnostics/cache/<provider>/aggregate.json`.

### UI Display

The cache diagnostics panel (in the operator dashboard) shows:
- Per-provider cache hit rate (line chart over time)
- Current session hit rate (gauge)
- Estimated cost savings (bar chart, per-provider)
- Cache miss reasons (pie chart: "prompt changed", "cache expired", "new session", "cache disabled")
- Correlation with Phase 4B prompt cache optimization (before/after comparison if optimization is enabled)

### Estimated Cost Savings Calculation

```python
def estimate_savings(cached_tokens: int, provider: str) -> float:
    """Estimate USD saved by cache hits.

    Cache reads are typically 90% cheaper than uncached input tokens.
    savings = cached_tokens * (uncached_price - cached_price) per 1000 tokens
    """
    pricing = PROVIDER_PRICING[provider]
    uncached_cost = cached_tokens * pricing["input_per_1k"] / 1000
    cached_cost = cached_tokens * pricing["cached_input_per_1k"] / 1000
    return uncached_cost - cached_cost
```

### Alert Configuration

Operators can set a minimum acceptable cache hit rate per provider (default: 50%). When the hit rate drops below the threshold for more than 5 consecutive requests, an alert fires:
- `BudgetWarning`-type event on the EventBus
- Notification in the operator dashboard
- Suggested actions: "Check if tool ordering changed", "Verify system prompt is stable", "Check if provider cache TTL expired"

### File Changes

| File | Change |
|---|---|
| New `backend/cache_diagnostics.py` | CacheStats collection, storage, aggregation, alert logic |
| `backend/mcp_bridge.py` | Extract cache metadata from provider responses |
| `backend/plugin_sdk.py` | Add cache alert event |
| `frontend/` (ned) | `CacheDiagnostics.tsx` dashboard component |

---

## 6.7 Acceptance Tests, Regression Risks, Rollback Plan

### Acceptance Tests

| ID | Test | Expected Result |
|---|---|---|
| T6.1.1 | Save an identity-layer memory item. Restart the server. Verify the item persists. | Item is present after restart with all metadata intact. |
| T6.1.2 | Save a session-layer memory item. End the session. Verify the item is evicted. | Item is no longer in session layer. If above promotion threshold, a summary appears in workspace layer. |
| T6.1.3 | Fill workspace layer to token budget. Verify lowest-scored items are evicted first. Identity items are never evicted. | Evicted items have the lowest scores. Identity layer is untouched. |
| T6.1.4 | Search across layers. Verify identity items score higher (2.0x multiplier). | Identity results appear first for equivalent keyword matches. |
| T6.1.5 | Migrate existing flat-schema memory entries. Verify they appear as workspace-layer items with backfilled metadata. | All existing entries are accessible, no data loss. |
| T6.1.6 | Session ends with 3 items above promotion threshold. Verify promoted summaries appear in workspace layer. | Workspace layer contains 1 promoted summary covering the 3 items. |
| T6.2.1 | Simulate context compaction. Verify identity reinjection fires. | Identity block is prepended to the next system message. |
| T6.2.2 | Agent drifts from identity (stops using assigned name). Drift score exceeds 0.7. Verify automatic reinjection. | Reinjection fires, drift score decreases on subsequent messages. |
| T6.2.3 | Session resumes after disconnect. Verify new session_id is created and identity is reinjected. | Identity is present in the resumed session's context. |
| T6.3.1 | Save 10 memories with varying recency, frequency, and importance. Search returns them in weighted-score order. | Results are ordered by the weighted formula, not by simple word match. |
| T6.3.2 | Search with tag filter `["architecture"]`. Only items tagged `architecture` are returned. | No untagged or differently-tagged items in results. |
| T6.3.3 | Access a memory item. Verify `last_accessed` and `access_count` are updated. | Metadata reflects the new access. |
| T6.4.1 | Agent uses `git diff` 10 times in a session. Observation engine records tool preference with confidence > 0.5. | Observational memory entry exists with correct count and confidence. |
| T6.4.2 | Operator deletes an observational memory. Verify it is removed and does not reappear. | Deleted observation stays deleted. New observations of the same pattern create a new entry starting from confidence 0.1. |
| T6.4.3 | Observation engine is disabled in settings. Verify no observations are created during a session. | No `observational` tagged entries created. |
| T6.5.1 | Agent A writes to its namespace. Agent B reads from shared namespace. Agent B cannot read Agent A's private namespace. | Read isolation is enforced. |
| T6.5.2 | Two agents write conflicting information (same tag, contradictory content). Conflict is detected and surfaced. | `memory_conflict` event fires, both entries visible in UI. |
| T6.5.3 | Agent proposes promotion. Operator approves. Item appears in shared namespace. | Promoted item is readable by all agents. |
| T6.6.1 | Cache diagnostics show accurate hit/miss rates for Claude provider. | Hit count + miss count = total requests. Hit rate matches manual calculation. |
| T6.6.2 | Cache hit rate drops below 50% for 5 consecutive requests. Alert fires. | `BudgetWarning` event emitted, notification appears in dashboard. |
| T6.6.3 | Cost savings calculation produces non-negative result consistent with provider pricing. | Savings >= 0, calculation matches manual verification. |

### Regression Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Memory schema migration corrupts existing entries | Critical | Migration is additive only (adds fields, never removes). Pre-migration backup of `data/` directory. Validation pass after migration checks every entry loads correctly. |
| Eviction engine removes important items | High | Identity layer has `evictable: false`. Workspace layer eviction is logged with the evicted item's key and score. Operator can restore evicted items from the backup log (evicted items are moved to `data/<agent_id>/memory/evicted/`, not deleted, for 7 days). |
| Weighted scoring degrades search quality vs current simple scoring | Medium | A/B testing during rollout: run both scoring systems in parallel, compare result rankings. If weighted scoring produces worse results for known-good queries, fall back to simple scoring. |
| Observation engine creates excessive memory entries | Medium | Rate limiting: max 50 new observations per session. Batch writes every 5 minutes. Observations below confidence 0.3 are not persisted. |
| Cross-agent coordination introduces race conditions | High | All namespace writes use file-level locking (existing `threading.RLock` in `AgentMemory`). Conflict detection is eventually consistent (runs on write, not on read). Performance regression test: 5 agents writing concurrently must complete within 2x single-agent time. |
| Identity reinjection interrupts agent flow | Medium | Reinjection uses system-prompt prepend, not mid-conversation injection. Integration test verifies the agent continues its current task after reinjection without repeating or losing work. |
| Cache diagnostics add latency to every request | Low | Cache metadata extraction is synchronous but trivial (<1ms). Stats write is async (fire-and-forget to a background writer). Zero impact on request latency. |

### Rollback Plan

| Component | Rollback Strategy |
|---|---|
| 6.1 Memory stratification | Feature flag `use_stratified_memory`. When False, `AgentMemory` uses the current flat schema. Migration is reversible -- the flat schema is a subset of the stratified schema, so reverting the code preserves all data. New fields are ignored by the old code. |
| 6.2 Identity reinforcement | Reinforcement is triggered by event handlers registered on the EventBus. Removing the event registrations disables reinforcement. Drift detection is a read-only diagnostic and can be disabled independently. |
| 6.3 Weighted recall | The `search()` method accepts a `weights` parameter. Setting all weights to 0 and boosting word-match only replicates the current behavior exactly. A config flag `use_weighted_recall` switches between old and new scoring. |
| 6.4 Observational memory | The `ObservationEngine` is started explicitly in `app.py`. Removing the `start()` call disables it. Existing observational entries remain as workspace-layer items but no new ones are created. |
| 6.5 Cross-agent coordination | The shared namespace is a separate directory tree from per-agent memory. Disabling coordination (removing the `memory_coordination.py` import) reverts to per-agent-only memory. Shared namespace data is preserved but inaccessible until coordination is re-enabled. |
| 6.6 Cache diagnostics | Purely additive instrumentation. Removing the cache metadata extraction from the transport layer disables collection. Existing stats files are inert. Dashboard component can be hidden via feature flag. |

---

## Appendix A: Complete File Ownership Matrix

| File | Owner | Phase |
|---|---|---|
| `backend/worktree.py` | tyson | 5.1 |
| `backend/bg_executor.py` (new) | tyson | 5.2 |
| `backend/hooks.py` (new) | tyson | 5.3 |
| `backend/agents_md.py` (new) | tyson | 5.4 |
| `backend/arena.py` (new) | tyson | 5.5 |
| `backend/specs.py` (new) | tyson | 5.6 |
| `backend/collaboration.py` (new, deferred) | tyson | 5.7 |
| `backend/autonomous.py` | tyson | 5.7 |
| `backend/registry.py` | tyson | 5.7 |
| `backend/plugin_sdk.py` | tyson | 5.3 |
| `backend/mcp_bridge.py` | tyson | 5.2, 5.3, 5.6, 6.1, 6.2, 6.5 |
| `backend/wrapper.py` | tyson | 5.2, 6.2 |
| `backend/routes/agents.py` | tyson | 5.1, 5.2, 5.5, 5.6 |
| `backend/repo_map.py` | tyson | 5.1 |
| `backend/agent_memory.py` | tyson | 6.1, 6.3, 6.4, 6.5 |
| `backend/identity.py` (new) | tyson | 6.2 |
| `backend/observer.py` (new) | tyson | 6.4 |
| `backend/memory_coordination.py` (new) | tyson | 6.5 |
| `backend/cache_diagnostics.py` (new) | tyson | 6.6 |
| `frontend/src/components/WorktreePanel.tsx` (new) | ned | 5.1 |
| `frontend/src/components/ArenaView.tsx` (new) | ned | 5.5 |
| `frontend/src/components/SpecEditor.tsx` (new) | ned | 5.6 |
| `frontend/src/components/HooksConfig.tsx` (new) | ned | 5.3 |
| `frontend/src/components/NotificationCenter.tsx` (new) | ned | 5.2 |
| `frontend/src/components/MemoryInspector.tsx` (new) | ned | 6.1, 6.4, 6.5 |
| `frontend/src/components/CacheDiagnostics.tsx` (new) | ned | 6.6 |

## Appendix B: Dependency Graph

```
Phase 1A (agent_id) ──> 5.1 (worktree refactor)
Phase 2 (rules) ──────> 5.4 (AGENTS.md overlay)
Phase 3 (tasks) ──────> 5.6 (spec-driven dev)
Phase 3.5 (durable) ──> 5.2 (background execution)
                    ──> 5.7 (artifact lineage)
Phase 4A (policy) ────> 5.3 (hook trust/signing)
                    ──> 5.5 (arena governance)
Phase 4B (cost) ──────> 5.5 (arena budget)
                    ──> 6.6 (cache diagnostics data)
Phase 4.5 (evals) ───> 5.5 (arena grading)

5.1 (worktrees) ──────> 5.2 (bg execution uses worktrees)
                    ──> 5.5 (arena uses worktrees)
                    ──> 5.7 (workers use worktrees)
5.2 (bg execution) ──> 5.5 (arena uses bg execution)
5.3 (hooks) ──────────> 5.2 (bg tasks use hooks for checkpoints)

Phase 1B (identity) ──> 6.1 (identity layer = Phase 1B memory)
                    ──> 6.2 (reinjection extends Phase 1B)
Phase 5 (multi-agent) -> 6.5 (cross-agent coordination)
6.1 (stratification) ─> 6.3 (weighted recall uses layer metadata)
                    ──> 6.4 (observations stored in workspace layer)
                    ──> 6.5 (cross-agent uses namespace structure)
```
