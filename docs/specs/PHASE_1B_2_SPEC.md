# Phase 1B + Phase 2 Implementation Specification

> Authored by jeff (architect spec owner).
> Verified against codebase at v5.7.2.
> All file paths, function names, and line numbers verified against live code.

---

## Table of Contents

- [Phase 1B: Runtime Identity Isolation and Reinjection](#phase-1b-runtime-identity-isolation-and-reinjection)
  - [1. Per-Agent Identity Storage](#1-per-agent-identity-storage)
  - [2. Provider-Specific Injection Refactor](#2-provider-specific-injection-refactor)
  - [3. Reinjection Lifecycle](#3-reinjection-lifecycle)
  - [4. Shared Workspace Collision Prevention](#4-shared-workspace-collision-prevention)
  - [5. Identity Drift Detection](#5-identity-drift-detection)
  - [6. Acceptance Tests for Phase 1B](#6-acceptance-tests-for-phase-1b)
  - [7. Regression Risks for Phase 1B](#7-regression-risks-for-phase-1b)
  - [8. Rollback Plan for Phase 1B](#8-rollback-plan-for-phase-1b)
- [Phase 2: Profiles, Rules, and Knowledge Layering](#phase-2-profiles-rules-and-knowledge-layering)
  - [1. Profile Model](#1-profile-model)
  - [2. Inheritance Model](#2-inheritance-model)
  - [3. AGENTS.md Integration](#3-agentsmd-integration)
  - [4. Skills Center Data Model](#4-skills-center-data-model)
  - [5. API Changes for Profiles](#5-api-changes-for-profiles)
  - [6. Frontend Changes for Profiles](#6-frontend-changes-for-profiles)
  - [7. Acceptance Tests for Phase 2](#7-acceptance-tests-for-phase-2)
  - [8. Regression Risks for Phase 2](#8-regression-risks-for-phase-2)
  - [9. Rollback Plan for Phase 2](#9-rollback-plan-for-phase-2)

---

# Phase 1B: Runtime Identity Isolation and Reinjection

**Type:** hardening
**Goal:** Remove dependence on shared workspace instruction files for identity correctness.
**Prerequisite:** Phase 1A (stable identity records with agent_id in SQLite) must be complete.

## 1. Per-Agent Identity Storage

### Current State

Today, per-agent data lives under `backend/data/{agent_name}/` with minimal structure.
Verified contents for a real agent (`backend/data/claude/`): only `soul.txt` exists.
Memory lives at `backend/data/{agent_name}/memory/*.json` (created on demand by
`AgentMemory.__init__` at `backend/agent_memory.py:33`).

The soul/notes API routes at `backend/routes/agents.py:1255-1291` use
`deps.DATA_DIR / "agents"` as the base, but the wrapper at `backend/wrapper.py:932`
uses a `data_dir` parameter that resolves to the same location. There is a naming
inconsistency: some call sites use `data_dir` (the raw data directory), others use
`data_dir / "agents"`. Phase 1B must normalize this.

### Target Directory Structure

```
backend/data/agents/{agent_id}/
    IDENTITY.md          # Human-readable identity summary (generated, not source of truth)
    SOUL.md              # Agent soul/personality prompt (migrated from soul.txt)
    NOTES.md             # Agent working notes (migrated from notes.txt)
    state.json           # Runtime state snapshot (serialized identity record)
    memory/              # Per-agent memory entries (existing *.json files)
    injection/           # Provider-specific injection artifacts
        context.md       # The assembled context document (what gets injected)
        soul_hash.sha256 # Hash of the last injected soul content
        last_inject.json # Timestamp, trigger, provider, and result of last injection
```

The `{agent_id}` directory name is the stable UUID from the Phase 1A SQLite identity
record, not the display name. A symlink or lookup index maps display names to agent_ids
for backward compatibility during migration.

### File Content Formats

**IDENTITY.md** (generated, read-only to agents):
```markdown
# Agent Identity

- **agent_id:** a1b2c3d4-e5f6-7890-abcd-ef1234567890
- **display_name:** claude
- **label:** Jeff
- **base:** claude
- **provider:** anthropic
- **profile_id:** default
- **workspace_id:** /path/to/project
- **session_id:** sess_abc123
- **parent_agent_id:** (none or parent UUID)
- **created_at:** 2026-04-06T10:30:00Z
- **last_injected_at:** 2026-04-06T10:30:05Z
```

**SOUL.md** (operator-editable):
```markdown
You are **Jeff** (agent name: @claude).
Your role: Architect and spec owner.
You collaborate with other agents and humans via @mentions in GhostLink.
Be helpful, thorough, and proactive. Stay in character for your role.
```

**NOTES.md** (agent-writable, operator-readable):
Free-form markdown. No enforced schema. The agent writes here via the
`set_notes` API. Content is preserved across restarts and reinjections.

**state.json** (server-managed):
```json
{
  "agent_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "display_name": "claude",
  "session_id": "sess_abc123",
  "base": "claude",
  "provider": "anthropic",
  "profile_id": "default",
  "workspace_id": "/path/to/project",
  "soul_hash": "sha256:abcdef1234567890...",
  "last_inject_trigger": "spawn",
  "last_inject_at": 1712400605.0,
  "last_heartbeat_at": 1712400610.0,
  "injection_count": 1,
  "drift_detected": false
}
```

### Relationship to SQLite Identity Record

The SQLite record (from Phase 1A) is the authoritative source of truth for identity.
The filesystem files under `agents/{agent_id}/` are projections of that record:

- `state.json` is a cache of the SQLite row plus runtime-only fields (last_inject_at,
  soul_hash, drift_detected). The server writes it on every injection and heartbeat.
- `IDENTITY.md` is regenerated from the SQLite record on every injection.
- `SOUL.md` and `NOTES.md` are the existing soul.txt and notes.txt, renamed and
  relocated. Their content is read by the injection system, not by SQLite.

If `state.json` is missing or corrupt, the server reconstructs it from the SQLite
record. If the SQLite record is missing, the agent cannot be injected (fail-closed).

### Migration from Current Layout

The current layout `backend/data/{display_name}/soul.txt` must be migrated:

1. On first Phase 1B startup, scan `backend/data/` for existing agent directories.
2. For each directory that has a `soul.txt`:
   a. Look up the agent_id from the Phase 1A SQLite identity table by display_name.
   b. Create `backend/data/agents/{agent_id}/`.
   c. Move `soul.txt` to `SOUL.md`, `notes.txt` to `NOTES.md`.
   d. Move `memory/` directory as-is.
   e. Generate initial `state.json` and `IDENTITY.md`.
   f. Create a backward-compat symlink: `backend/data/{display_name}` -> `agents/{agent_id}/`.
3. The migration is idempotent. Running it twice has no effect.

### File Ownership

- `tyson`: All backend changes (migration script, storage helpers, path resolution).
- `ned`: No frontend changes for this subsection.

---

## 2. Provider-Specific Injection Refactor

### Current Injection Code

The injection code lives at `backend/wrapper.py:916-998`. It runs during `run_agent()`
after MCP config injection. Here is the exact current flow:

1. **Lines 918-919:** Imports `generate_agent_context` and `set_soul` from `agent_memory`.
2. **Lines 921-932:** Builds a soul string from label + role, calls `set_soul(data_dir, assigned_name, soul)` which writes `data_dir/{assigned_name}/soul.txt`.
3. **Line 935:** Calls `generate_agent_context(assigned_name, soul)` which formats the `GHOSTLINK_CONTEXT_TEMPLATE` (defined at `agent_memory.py:246-287`).
4. **Lines 938-939:** Writes `.ghostlink-context.md` to `project_dir` (the agent's workspace root).
5. **Lines 943-998:** Provider-specific injection branches:

| Provider | Injection target | Lines | Path written |
|----------|-----------------|-------|--------------|
| `claude` | `.claude/instructions.md` in project_dir | 943-951 | `{project_dir}/.claude/instructions.md` |
| `codex` | `.codex/instructions.md` in project_dir | 953-959 | `{project_dir}/.codex/instructions.md` |
| `gemini` | `systemInstruction` field in MCP settings JSON | 962-971 | Per-instance settings file in `data/provider-config/` |
| `aider` | `.aider.conventions.md` in project_dir | 973-979 | `{project_dir}/.aider.conventions.md` |
| `grok` | `.grok/instructions.md` in project_dir | 981-988 | `{project_dir}/.grok/instructions.md` |
| fallback | `INSTRUCTIONS.md` in project_dir | 991-995 | `{project_dir}/INSTRUCTIONS.md` |

### The Problem

For `claude`, `codex`, `aider`, `grok`, and the generic fallback, the injection target
is a file **in the shared project directory**. If two agents of the same provider share
a workspace (e.g., two Claude agents on the same repo), they overwrite each other's
identity file. The guard at line 949 (`if not instructions_file.exists() or
instructions_file.read_text("utf-8").startswith("# GhostLink Agent Context")`) means
the second agent silently skips injection if the file already exists from agent 1 --
and agent 2 runs with agent 1's identity.

`gemini` is already isolated: its settings file is written to
`data/provider-config/{instance_name}-settings.json` (line 966, via `_apply_mcp_inject`
at line 245), which is per-instance. The `systemInstruction` field is written into that
per-instance file.

### Target: Per-Agent Injection Paths

Replace shared workspace paths with per-agent namespaced paths. Two strategies, chosen
per provider based on what the CLI actually reads:

**Strategy A: Per-agent config directory (preferred)**

For providers that accept a config path via flag or env var, write the identity file
to `backend/data/agents/{agent_id}/injection/` and point the CLI to it.

| Provider | Strategy | Mechanism |
|----------|----------|-----------|
| `claude` | A | Write instructions.md to `data/agents/{agent_id}/injection/.claude/instructions.md`. Pass `--directory {agent_injection_dir}` or use `CLAUDE_CODE_CONFIG_DIR` env var if available. **Fallback:** If the CLI does not support redirecting the config dir, use Strategy B. |
| `codex` | A | Write instructions.md to `data/agents/{agent_id}/injection/.codex/instructions.md`. Codex respects `--config-dir` or `CODEX_CONFIG_DIR`. **Fallback:** Strategy B. |
| `gemini` | Already isolated | MCP settings at `data/provider-config/{instance_name}-settings.json` with `systemInstruction` field. No change needed. |
| `aider` | B | Aider reads `.aider.conventions.md` from cwd. No config-dir flag exists. Must use Strategy B. |
| `grok` | A | Write to `data/agents/{agent_id}/injection/.grok/instructions.md`. Pass flag if supported. **Fallback:** Strategy B. |
| `ollama` | N/A | Ollama uses system prompts via API, not filesystem files. Injection goes through the MCP bridge `systemInstruction`. |
| fallback | B | Generic INSTRUCTIONS.md fallback. |

**Strategy B: Worktree-namespaced file**

For providers that only read from cwd, write the identity file to the agent's worktree
(from `WorktreeManager` at `backend/worktree.py:44`):
`{project_dir}/.ghostlink-worktrees/{agent_name}/.claude/instructions.md`

If worktree isolation is not available (not a git repo), fall back to writing a
uniquely named file: `{project_dir}/.ghostlink-{agent_id}-instructions.md` and
injecting its path via the provider's env var or flag, if any. If the provider has
no such mechanism, log a warning and write to the shared path with a comment header
containing the agent_id.

### Mid-Session Reinjection Capability by Provider

Based on verified provider behavior:

| Provider | Mid-session reinject? | Mechanism |
|----------|----------------------|-----------|
| `claude` (pipe mode) | No | Claude Code in `--input-format stream-json` mode (`wrapper_mcp.py:130-147`) keeps context across turns. No way to inject new system instructions mid-session without restarting the subprocess. Identity must be correct at spawn. |
| `claude` (tmux mode) | No | Terminal scraping. No mid-session injection API. |
| `codex` | Yes (per-exec) | Codex uses exec-per-trigger mode (`wrapper_mcp.py:100-101, 104-115`). Each `codex exec` invocation is a fresh context. Reinjection happens naturally on every trigger. |
| `gemini` | Yes (per-exec) | Gemini uses exec-per-trigger mode (`wrapper_mcp.py:100-101, 117-128`). Same as Codex. |
| `aider` | No | Persistent terminal session. No mid-session injection. |
| `grok` | No | Persistent terminal session assumption. |
| `ollama` | Yes | Each API call can include a new system prompt. |

### Changes to wrapper.py

Replace the injection block at lines 916-998 with a call to a new module:

```python
# backend/identity_inject.py (new file)

from pathlib import Path
from agent_memory import generate_agent_context

def inject_identity(
    agent_id: str,
    agent_name: str,
    agent_base: str,
    label: str,
    role: str,
    data_dir: Path,
    project_dir: Path,
    mcp_settings_path: Path | None,
    trigger: str,  # "spawn", "reconnect", "resume", "delegation", "model_switch", "compaction"
) -> dict:
    """Write identity files and provider-specific injection artifacts.

    Returns {"injected": True/False, "path": str, "trigger": trigger, "soul_hash": str}.
    """
    ...
```

The wrapper.py block at lines 916-998 becomes:

```python
from identity_inject import inject_identity
try:
    inject_result = inject_identity(
        agent_id=agent_id,           # from Phase 1A identity record
        agent_name=assigned_name,
        agent_base=agent,
        label=agent_label,
        role=agent_role_desc or "",
        data_dir=data_dir,
        project_dir=project_dir,
        mcp_settings_path=mcp_settings_path,
        trigger="spawn",
    )
    print(f"  Identity injected ({inject_result.get('trigger')}): {inject_result.get('path')}")
except Exception as e:
    print(f"  Warning: identity injection failed: {e}")
```

### File Ownership

- `tyson`:
  - New file: `backend/identity_inject.py`
  - Modified: `backend/wrapper.py` (lines 916-998 replaced)
  - Modified: `backend/wrapper_mcp.py` (add reinject call for exec-per-trigger agents)
  - Modified: `backend/agent_memory.py` (update path helpers for new directory layout)

---

## 3. Reinjection Lifecycle

### Events That Trigger Reinjection

| Event | Trigger name | When it fires | What happens |
|-------|-------------|---------------|--------------|
| **Spawn** | `spawn` | `wrapper.py:run_agent()` just before process launch | Full injection: write IDENTITY.md, SOUL.md context, provider-specific file. Update state.json and soul_hash. |
| **Reconnect** | `reconnect` | Heartbeat handler at `routes/agents.py:1000-1040` detects a gap > PRESENCE_TIMEOUT (15s, defined at `mcp_bridge.py:38`) followed by a heartbeat resuming. Also: HTTP 409 re-registration at `wrapper.py:1031-1038`. | For exec-per-trigger providers (Codex, Gemini): next trigger automatically gets fresh identity. For persistent providers (Claude, Aider, Grok): log the gap, update state.json, but do NOT restart the subprocess. The identity was set at spawn and remains valid. |
| **Resume** | `resume` | `routes/agents.py:1197-1209` when operator resumes a paused agent. Also: `wrapper_mcp.py:137-138` when `--resume {session_id}` is used for Claude. | For Claude pipe mode: the `--resume` flag reloads the previous session context, which includes the original system instruction. No reinjection needed unless the soul changed while paused. Check soul_hash; if different, log a warning (cannot reinject mid-session). For exec-per-trigger: automatic. |
| **Delegation** | `delegation` | When a parent agent delegates to a child. Currently handled via the `delegate` MCP tool in `mcp_bridge.py`. | The child agent receives a delegation context that includes the parent's agent_id, task_id, and a summary of the delegated work. The child's IDENTITY.md includes `parent_agent_id`. The child's soul is NOT overwritten -- it keeps its own identity. The delegation context is appended to the injection content as a `## Delegation Context` section. |
| **Model switch** | `model_switch` | `routes/agents.py:1325-1350` when operator changes the `model` field via config update. | For exec-per-trigger providers: next trigger uses new model automatically. For persistent providers: the model switch requires a subprocess restart. On restart, reinjection happens via the `spawn` trigger. The config update route should trigger a restart for persistent providers when model changes. |
| **Compaction** | `compaction` | Detected heuristically. For Claude pipe mode: when the conversation is compacted (context window overflow), Claude Code may lose the injected system context. Detection: monitor stdout for compaction events in `wrapper_mcp.py:_read_stdout_loop()`. | For Claude pipe mode: if a compaction event is detected in the stream output, flag `drift_detected: true` in state.json and emit a WebSocket `identity_drift` event. The operator can then choose to restart the agent (which triggers full reinjection). Automatic reinjection is not possible without restarting. For exec-per-trigger: not applicable (each exec is fresh). |

### Trigger Mechanism Implementation

Each trigger calls `identity_inject.inject_identity()` with the appropriate trigger name.
The function:

1. Reads the current soul from `agents/{agent_id}/SOUL.md`.
2. Reads the current identity record from the Phase 1A SQLite table.
3. Assembles the context document using `generate_agent_context()`.
4. If the trigger is `delegation`, appends delegation context.
5. Writes the provider-specific injection artifact.
6. Computes `sha256(context_document)` and stores it as `soul_hash` in `state.json`.
7. Updates `last_inject_trigger`, `last_inject_at`, `injection_count` in `state.json`.
8. Returns the result dict.

For triggers where reinjection is not possible (persistent providers mid-session),
the function returns `{"injected": False, "reason": "persistent_session", ...}` and
logs the event for operator visibility.

### Heartbeat-Based Reconnect Detection

In `routes/agents.py:1000`, the heartbeat handler currently tracks
`deps._last_heartbeats[agent_name]`. To detect reconnect:

```python
# In heartbeat handler, after line 1015
previous_heartbeat = deps._last_heartbeats.get(agent_name, 0)
gap = time.time() - previous_heartbeat if previous_heartbeat else 0
if gap > RECONNECT_GAP_THRESHOLD:  # e.g., 30 seconds
    # Agent reconnected after a gap
    asyncio.create_task(_handle_reconnect_reinject(agent_name))
```

The `RECONNECT_GAP_THRESHOLD` should be configurable, defaulting to 30 seconds
(2x the heartbeat interval of 5 seconds at `wrapper.py:1046` plus margin).

### File Ownership

- `tyson`:
  - New file: `backend/identity_inject.py`
  - Modified: `backend/routes/agents.py` (heartbeat handler, resume handler)
  - Modified: `backend/wrapper_mcp.py` (compaction detection in stdout reader)
  - Modified: `backend/wrapper.py` (spawn trigger call)

---

## 4. Shared Workspace Collision Prevention

### Current Problem

Two Claude agents spawned in the same project directory both try to write
`{project_dir}/.claude/instructions.md`. The guard at `wrapper.py:949`:

```python
if not instructions_file.exists() or instructions_file.read_text("utf-8").startswith("# GhostLink Agent Context"):
    instructions_file.write_text(context_content, "utf-8")
```

This means:
- First agent writes the file successfully.
- Second agent overwrites the first agent's identity.
- If the first agent's subprocess is still running, it does not re-read the file.
- But if the first agent restarts or resumes, it reads the second agent's identity.

The same problem exists for `.codex/instructions.md`, `.aider.conventions.md`,
`.grok/instructions.md`, and `INSTRUCTIONS.md`.

### Solution: Per-Agent Path Strategy

The solution combines three mechanisms, applied in priority order:

**Priority 1: Worktree isolation (preferred)**

If `WorktreeManager` (at `backend/worktree.py:18`) is available and the workspace
is a git repo, each agent gets its own worktree at
`{project_dir}/.ghostlink-worktrees/{agent_name}/`.

The worktree is a full working copy. The agent's CLI process runs with `cwd` set to
the worktree path instead of the shared project directory. Each worktree has its own
`.claude/instructions.md` (or equivalent), so there is no collision.

This is already partially implemented: `worktree.py:37-77` creates worktrees and
`routes/agents.py:543-547, 880-884` call merge/remove on deregister/kill. But the
spawn flow at `routes/agents.py:813-850` does not redirect the agent's cwd to the
worktree. That must change.

**Priority 2: Per-agent config directory via env var**

If worktree isolation is not available (not a git repo, or worktree creation failed),
use a per-agent config directory:

- Claude: Set `CLAUDE_CONFIG_DIR` env var to `data/agents/{agent_id}/injection/`.
  Write `.claude/instructions.md` inside that directory.
- Codex: Set `CODEX_CONFIG_DIR` if supported, otherwise fall back.
- Others: Similar pattern where the CLI supports it.

This is injected via the `inject_env` dict returned by `_apply_mcp_inject()` at
`wrapper.py:216-267` and merged into the subprocess environment.

**Priority 3: Uniquely named file with agent_id**

If neither worktree nor config directory redirection works, write a uniquely named
file: `{project_dir}/.ghostlink-{agent_id}-context.md`.

For providers that only read from a fixed filename, this is a last resort that requires
the provider to have some mechanism (env var, CLI flag) to read an alternate file.
If no such mechanism exists, log a warning and write to the shared path with a header
comment:

```markdown
<!-- ghostlink:agent_id=a1b2c3d4 -->
# GhostLink Agent Context
...
```

The injection code reads this header before overwriting. If the file contains a
different agent_id, it is NOT overwritten. Instead, the injection logs a collision
warning and writes to the per-agent storage directory only (not the workspace).

### Implementation in wrapper.py

The spawn flow must be updated:

1. After registration (line 900 area), check if worktree manager is available.
2. If yes, create worktree and redirect `project_dir` to the worktree path.
3. Pass the (possibly redirected) `project_dir` to `inject_identity()`.
4. The `inject_identity()` function handles per-agent config directory and unique
   file naming internally.

In `routes/agents.py:spawn_agent()`, the `cwd` passed to the wrapper must be
updated to the worktree path if worktree isolation is active:

```python
# After line 850, before building spawn_args:
if deps.worktree_manager:
    worktree_path = deps.worktree_manager.create_worktree(base)
    if worktree_path:
        cwd = str(worktree_path)
        spawn_env["GHOSTLINK_AGENT_CWD"] = cwd
```

### File Ownership

- `tyson`:
  - Modified: `backend/wrapper.py` (spawn flow, cwd redirect)
  - Modified: `backend/routes/agents.py` (worktree cwd redirect in spawn)
  - Modified: `backend/worktree.py` (ensure worktree creation returns usable path)
  - New file: `backend/identity_inject.py` (collision detection logic)

---

## 5. Identity Drift Detection

### What Is Drift

Identity drift occurs when an agent's runtime identity no longer matches the
server's record. Causes:

- Context window compaction strips the system instruction.
- An external tool or user manually edits `.claude/instructions.md`.
- The operator changes the soul via the API while the agent is running.
- A second agent overwrites the shared instruction file.
- The agent hallucinates a different identity after a very long session.

### Soul Hash Computation and Storage

On every injection, compute:

```python
import hashlib

def compute_soul_hash(context_content: str) -> str:
    """SHA-256 hash of the assembled injection content."""
    return "sha256:" + hashlib.sha256(context_content.encode("utf-8")).hexdigest()
```

Stored in:
- `agents/{agent_id}/state.json` field `soul_hash`
- `agents/{agent_id}/injection/soul_hash.sha256` (plain text file for quick comparison)

### When to Check for Drift

| Check point | Mechanism | Frequency |
|------------|-----------|-----------|
| **Heartbeat** | On every heartbeat (every 5 seconds, `wrapper.py:1046`), the wrapper reads the current instruction file from disk and computes its hash. If it differs from the stored soul_hash, it reports `drift_detected: true` in the heartbeat payload. | Every 5s (cheap: one file read + SHA-256) |
| **MCP tool call** | Before executing any MCP tool call in `mcp_bridge.py`, check if the agent's `state.json` has `drift_detected: true`. If so, include a `[DRIFT WARNING]` prefix in the tool response. | Per tool call |
| **Operator poll** | The `/api/agents/{name}/health` endpoint at `routes/agents.py:1294-1300` includes `drift_detected` in the response. | On demand |
| **Compaction event** | For Claude pipe mode in `wrapper_mcp.py`, monitor stdout for compaction markers. Set `drift_detected: true` immediately. | Event-driven |

### Drift Detection in the Heartbeat (wrapper.py)

Add to the heartbeat function at `wrapper.py:1012`:

```python
def _heartbeat():
    while True:
        current_name, _ = get_identity()
        current_token = get_token()

        # Drift check: compare current instruction file hash to stored hash
        drift = False
        try:
            state_path = data_dir / "agents" / agent_id / "state.json"
            if state_path.exists():
                state = json.loads(state_path.read_text("utf-8"))
                stored_hash = state.get("soul_hash", "")
                # Read the current instruction file for this provider
                current_content = _read_current_injection(agent, project_dir, agent_id, data_dir)
                if current_content is not None:
                    current_hash = compute_soul_hash(current_content)
                    drift = stored_hash != "" and current_hash != stored_hash
        except Exception:
            pass

        url = f"http://127.0.0.1:{server_port}/api/heartbeat/{current_name}"
        body = json.dumps({"drift_detected": drift}).encode()
        ...
```

### What to Do When Drift Is Detected

1. **Set flag:** `state.json` field `drift_detected: true`.
2. **Emit event:** WebSocket broadcast `identity_drift` with agent_name and agent_id.
3. **Frontend indicator:** The AgentBar (`frontend/src/components/AgentBar.tsx`) and
   AgentInfoPanel (`frontend/src/components/AgentInfoPanel.tsx`) show a warning badge.
4. **Operator action options:**
   a. **Reinject (exec-per-trigger providers):** Next trigger automatically uses fresh identity. The drift clears on the next successful injection.
   b. **Restart (persistent providers):** The operator clicks "Restart" in the UI. This kills the subprocess, re-registers, and triggers a `spawn` injection. The kill/restart flow already exists at `routes/agents.py:876-884`.
   c. **Ignore:** The operator acknowledges the drift and chooses to continue. This sets `drift_acknowledged: true` in state.json and suppresses the warning.
5. **No automatic restart.** Restarting a persistent agent mid-work is disruptive.
   The operator must explicitly choose to restart. The system only surfaces the warning.

### How to Reinject Without Disrupting Current Work

For exec-per-trigger agents (Codex, Gemini), reinjection is free: the next invocation
gets fresh identity. No disruption.

For persistent agents (Claude, Aider, Grok), mid-session reinjection is not possible
without restarting the subprocess. The spec explicitly does NOT attempt to hot-patch
a running session. Instead:

- If the soul changed via the API while the agent is running, the change takes effect
  on the next restart.
- If drift is detected due to compaction, the operator is warned but the agent continues.
  The next user message can include a re-grounding prompt via the MCP tool response
  (e.g., "Reminder: you are @claude, your role is ...").

This "soft reinjection via tool response" is a lightweight alternative:

```python
# In mcp_bridge.py, when drift_detected is True for the calling agent:
# Prepend to the tool response:
reminder = f"[Identity reminder: You are {agent_label} (@{agent_name}). {soul_summary}]\n\n"
```

### File Ownership

- `tyson`:
  - Modified: `backend/wrapper.py` (drift check in heartbeat)
  - Modified: `backend/mcp_bridge.py` (soft reinjection via tool response prefix)
  - Modified: `backend/routes/agents.py` (drift flag in health endpoint, WebSocket event)
  - New file: `backend/identity_inject.py` (soul_hash computation)
- `ned`:
  - Modified: `frontend/src/components/AgentBar.tsx` (drift warning badge)
  - Modified: `frontend/src/components/AgentInfoPanel.tsx` (drift status in info tab)

---

## 6. Acceptance Tests for Phase 1B

All tests owned by `kurt`. Test files go in `backend/tests/`.

### T-1B-01: Per-agent directory creation
- Spawn agent via `/api/spawn-agent`.
- Verify `backend/data/agents/{agent_id}/` exists.
- Verify `IDENTITY.md`, `SOUL.md`, `state.json` exist with correct content.
- Verify `injection/context.md` exists with the assembled context.

### T-1B-02: Two same-provider agents, no collision
- Spawn two Claude agents targeting the same workspace.
- Verify each has a distinct `agents/{agent_id}/` directory.
- Verify each has its own injection file (not the same path).
- Read both injection files and confirm they contain different agent_ids.

### T-1B-03: Soul hash computation
- Spawn agent. Read `state.json`. Verify `soul_hash` is a valid sha256 string.
- Compute the hash manually from `injection/context.md`. Confirm it matches.

### T-1B-04: Drift detection on file modification
- Spawn agent. Wait for heartbeat.
- Manually overwrite the provider-specific instruction file with different content.
- Wait for next heartbeat cycle (5 seconds).
- Verify `state.json` has `drift_detected: true`.
- Verify WebSocket received `identity_drift` event.

### T-1B-05: Reconnect reinjection for exec-per-trigger agents
- Spawn a Codex agent.
- Change the soul via `/api/agents/{name}/soul`.
- Send a trigger message.
- Verify the next `codex exec` invocation includes the updated soul.

### T-1B-06: Spawn injection for persistent agents
- Spawn a Claude agent.
- Verify injection happened exactly once (injection_count == 1 in state.json).
- Kill and re-spawn. Verify injection_count == 1 in the new state.json (new session).

### T-1B-07: Delegation injection
- Spawn parent and child agents.
- Trigger delegation from parent to child.
- Verify child's injection content includes `## Delegation Context` section.
- Verify child's `state.json` has correct `parent_agent_id`.

### T-1B-08: Migration from legacy layout
- Create a legacy `backend/data/testbot/soul.txt` with known content.
- Run the migration function.
- Verify `backend/data/agents/{agent_id}/SOUL.md` has the same content.
- Verify the backward-compat symlink works.

### T-1B-09: Compaction detection (Claude pipe mode)
- Spawn Claude in MCP pipe mode.
- Simulate a compaction event in the stdout stream.
- Verify `drift_detected: true` in state.json.
- Verify WebSocket event emitted.

### T-1B-10: Worktree isolation with injection
- Spawn two Claude agents in a git repo workspace.
- Verify each agent's cwd is a distinct worktree path.
- Verify each worktree has its own `.claude/instructions.md`.

---

## 7. Regression Risks for Phase 1B

| Risk | Impact | Mitigation |
|------|--------|------------|
| Path change breaks existing soul/notes API | Soul and notes API at `routes/agents.py:1255-1291` uses `deps.DATA_DIR / "agents"` as base. If the directory structure changes, these endpoints return empty data. | Migration creates backward-compat symlinks. API helpers updated to resolve agent_id from display_name via SQLite. |
| Worktree cwd redirect breaks agent CLI | Some agent CLIs expect specific files in cwd (e.g., `.mcp.json`, `package.json`). A worktree may not have these. | `WorktreeManager.create_worktree()` already creates a full working copy from HEAD. Verify that worktrees include all tracked files. |
| Heartbeat drift check adds latency | Reading a file and computing SHA-256 on every heartbeat (5s interval). | The file is small (<10KB). SHA-256 of 10KB takes <1ms. Negligible. |
| Shared instruction file guard removal breaks single-agent setups | Removing the "only write if starts with GhostLink header" guard means we always write. If a user has a manually authored `.claude/instructions.md`, we overwrite it. | The injection code should still check for the header. If the file exists and does NOT start with `# GhostLink Agent Context`, skip injection for that provider path and log a warning. Write to the per-agent directory only. |
| MCP settings file path change breaks Gemini | Gemini injection currently writes to `data/provider-config/{instance_name}-settings.json`. This is already per-instance and should not change. | Verify Gemini path is untouched by the refactor. |

---

## 8. Rollback Plan for Phase 1B

### If injection refactor fails

1. Revert `backend/identity_inject.py` (delete new file).
2. Restore `backend/wrapper.py` lines 916-998 to the original inline injection block.
3. The original code is self-contained and has no dependencies on Phase 1B data structures.

### If per-agent storage migration corrupts data

1. The migration is non-destructive: it copies files, not moves them (during transition).
2. The backward-compat symlinks mean the old code paths still work.
3. If corruption occurs, delete `backend/data/agents/` and re-run migration from the
   still-intact `backend/data/{display_name}/` directories.

### If drift detection causes false positives

1. Set `GHOSTLINK_DISABLE_DRIFT_CHECK=1` env var to skip drift checks in the heartbeat.
2. Remove the drift check code from the heartbeat function.
3. The drift check is purely advisory -- it does not prevent any operation.

### Feature flags

Add to `config.toml` under `[identity]`:

```toml
[identity]
per_agent_storage = true      # Use new per-agent directory layout
drift_detection = true         # Enable soul hash drift checks
worktree_injection = true      # Redirect injection to worktree if available
soft_reinject_on_drift = true  # Prepend identity reminder to MCP tool responses
```

Each flag can be disabled independently to isolate regressions.

---

# Phase 2: Profiles, Rules, and Knowledge Layering

**Type:** unification
**Goal:** Create the data model that makes skills, policies, and imported repo guidance coherent.
**Prerequisite:** Phase 1A (stable identity records) and Phase 1B (per-agent storage) must be complete.

## 1. Profile Model

### Current State

There is no profile concept today. The `AgentInstance` dataclass at
`backend/registry.py:14-31` holds per-agent config fields (role, responseMode,
thinkingLevel, model, failoverModel, autoApprove) but these are runtime-only and
disappear when the agent deregisters. The `SkillsRegistry` at `backend/skills.py:240`
stores skills keyed by `agent_name` string. There is no shared profile that multiple
agents can inherit from.

### Profile Schema

Stored in the Phase 1A SQLite database (`backend/data/ghostlink_v2.db`).

```sql
CREATE TABLE IF NOT EXISTS profiles (
    profile_id    TEXT PRIMARY KEY,          -- UUID
    name          TEXT NOT NULL UNIQUE,      -- human-readable, e.g. "Backend Developer"
    description   TEXT NOT NULL DEFAULT '',
    base_provider TEXT NOT NULL DEFAULT '',  -- default provider for agents using this profile
    created_at    REAL NOT NULL,
    updated_at    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_settings (
    profile_id    TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    key           TEXT NOT NULL,             -- e.g. "responseMode", "thinkingLevel", "model"
    value         TEXT NOT NULL,             -- JSON-encoded value
    PRIMARY KEY (profile_id, key)
);

CREATE TABLE IF NOT EXISTS profile_skills (
    profile_id    TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    skill_id      TEXT NOT NULL,
    enabled       INTEGER NOT NULL DEFAULT 1,
    config        TEXT NOT NULL DEFAULT '{}', -- JSON
    PRIMARY KEY (profile_id, skill_id)
);

CREATE TABLE IF NOT EXISTS profile_rules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id    TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
    rule_type     TEXT NOT NULL,             -- "system", "workspace", "custom"
    content       TEXT NOT NULL,
    priority      INTEGER NOT NULL DEFAULT 0,
    created_at    REAL NOT NULL
);
```

### Built-in Profiles

The system ships with a `default` profile that every agent uses unless assigned
a different one. The `default` profile has:
- All builtin skills enabled (matching current behavior at `skills.py:288-292`).
- No provider restriction.
- Default settings: `responseMode: "mentioned"`, `thinkingLevel: ""`, `autoApprove: false`.

Additional built-in profiles can be created by the operator:
- "Code Reviewer" -- restricted skills, read-only workspace preference.
- "Architect" -- full skills, high thinking level.
- "Runner" -- auto-approve, silent response mode.

### Profile-to-Agent Relationship

Many agents can share one profile. The relationship is stored in the Phase 1A
identity record's `profile_id` field. When an agent is spawned:

1. If the spawn request includes a `profile_id`, use it.
2. Otherwise, use the `default` profile.
3. The profile_id is written to the agent's identity record in SQLite.
4. The profile_id is written to `agents/{agent_id}/state.json`.

An agent can be reassigned to a different profile at runtime via the config API.
When reassigned, the effective state is recomputed and broadcast to the frontend.

### File Ownership

- `tyson`:
  - Modified: `backend/store.py` or new `backend/profiles.py` (profile CRUD)
  - Modified: `backend/app.py` (profile table creation in lifespan)
  - Modified: `backend/registry.py` (add profile_id to AgentInstance)
- `ned`:
  - New profile management UI surfaces

---

## 2. Inheritance Model

### Resolution Order

The effective configuration for an agent is computed by merging four layers in order
(lowest priority first):

```
Layer 0: System policy (hardcoded defaults, non-overridable security rules)
Layer 1: Workspace policy (from AGENTS.md, .ghostlink/config, workspace rules)
Layer 2: Profile policy (from the profile assigned to the agent)
Layer 3: Agent override (per-agent settings set via API or UI)
```

Higher layers override lower layers. Each layer can:
- **Set** a value (override the layer below).
- **Extend** a list value (add to the layer below, e.g., add skills).
- **Restrict** a value (narrow the layer below, e.g., remove skills, lower permissions).

### Layer Details

**Layer 0: System Policy**

Hardcoded in the backend. Not configurable by operator. Contains:
- Maximum agent count (currently `AgentRegistry.MAX_AGENTS = 20` at `registry.py:79`).
- Required security headers for MCP auth.
- Forbidden tool categories (if any).
- Rate limits.

These values are fail-closed: if a higher layer tries to override them, the system
policy wins.

**Layer 1: Workspace Policy**

Sourced from:
- `AGENTS.md` in the workspace root (parsed as described in section 3 below).
- `.ghostlink/workspace.json` (operator-managed workspace config, if present).
- Workspace-level rules from the `rules` table (existing `backend/rules.py`).

Workspace policy can set default provider, model, and response mode for all agents
in the workspace. It can restrict which skills are available.

**Layer 2: Profile Policy**

From the `profiles`, `profile_settings`, `profile_skills`, and `profile_rules` tables.
Applied to every agent that references this profile_id. Profile policy overrides
workspace policy for all fields except system policy restrictions.

**Layer 3: Agent Override**

From the agent's own config (currently stored in-memory on `AgentInstance` at
`registry.py:14-31` and set via `routes/agents.py:1325-1350`). With Phase 2, agent
overrides are persisted in the SQLite identity record so they survive restarts.

Agent overrides can:
- Change model, thinkingLevel, responseMode, autoApprove.
- Enable/disable specific skills (on top of profile skills).
- Add custom rules.
- They CANNOT override system policy (Layer 0).

### Conflict Resolution Rules

1. **Scalar values (model, thinkingLevel, responseMode):** Highest layer with a
   non-empty value wins. If Layer 3 sets `model: "gpt-4o"`, that overrides
   Layer 2's `model: "claude-sonnet-4-20250514"`.

2. **List values (skills):** Merge with override semantics.
   - Start with Layer 0 forbidden list (skills that are NEVER available).
   - Layer 1 can restrict: `workspace_skills_allowed: [list]` means only these are available.
   - Layer 2 sets the profile's enabled skills.
   - Layer 3 can add or remove individual skills on top of Layer 2.
   - Final enabled list = (Layer 2 enabled + Layer 3 additions - Layer 3 removals) intersected with Layer 1 allowed, minus Layer 0 forbidden.

3. **Boolean values (autoApprove):** Highest layer with an explicit value wins.
   Exception: if system policy forbids autoApprove, it is always false.

4. **Rules (text policies):** All layers' rules are concatenated in order.
   System rules first, then workspace rules, then profile rules, then agent rules.
   They are presented to the agent as a single ordered list. No deduplication.

### Effective State Computation

```python
# backend/profiles.py (new file)

def compute_effective_state(
    agent_id: str,
    profile_id: str,
    workspace_id: str,
    db: aiosqlite.Connection,
) -> dict:
    """Compute the merged effective state for an agent.

    Returns a dict with all resolved settings, skills, and rules.
    """
    system = _get_system_policy()
    workspace = await _get_workspace_policy(workspace_id, db)
    profile = await _get_profile_policy(profile_id, db)
    agent = await _get_agent_overrides(agent_id, db)

    effective = {}

    # Scalar merge
    for key in ("model", "thinkingLevel", "responseMode", "failoverModel"):
        effective[key] = (
            agent.get(key)
            or profile.get(key)
            or workspace.get(key)
            or system.get(key, "")
        )

    # Boolean merge
    for key in ("autoApprove",):
        if system.get(f"force_{key}") is not None:
            effective[key] = system[f"force_{key}"]
        elif key in agent:
            effective[key] = agent[key]
        elif key in profile:
            effective[key] = profile[key]
        else:
            effective[key] = system.get(key, False)

    # Skills merge
    system_forbidden = set(system.get("forbidden_skills", []))
    workspace_allowed = set(workspace.get("allowed_skills", [])) or None  # None = all
    profile_enabled = set(profile.get("enabled_skills", []))
    agent_additions = set(agent.get("skill_additions", []))
    agent_removals = set(agent.get("skill_removals", []))

    enabled = (profile_enabled | agent_additions) - agent_removals
    if workspace_allowed is not None:
        enabled &= workspace_allowed
    enabled -= system_forbidden
    effective["enabled_skills"] = sorted(enabled)

    # Rules merge
    effective["rules"] = (
        system.get("rules", [])
        + workspace.get("rules", [])
        + profile.get("rules", [])
        + agent.get("rules", [])
    )

    return effective
```

### File Ownership

- `tyson`:
  - New file: `backend/profiles.py` (effective state computation, profile CRUD)
  - Modified: `backend/skills.py` (delegate to profile-based resolution)
  - Modified: `backend/routes/agents.py` (use effective state in config endpoints)

---

## 3. AGENTS.md Integration

### What Is AGENTS.md

`AGENTS.md` is a convention (used by Claude Code, Codex, and others) where a repo
contains a markdown file describing the agents, their roles, and their rules. It is
schema-free markdown: no enforced structure, just human-readable descriptions.

GhostLink must support reading it, but NOT treating it as the source of truth.

### Parsing Strategy

`AGENTS.md` is parsed into structured data using a best-effort markdown parser:

```python
# backend/agents_md.py (new file)

import re
from pathlib import Path

def parse_agents_md(workspace_path: Path) -> dict:
    """Parse AGENTS.md from a workspace into structured data.

    Returns {
        "agents": [{"name": str, "role": str, "rules": [str]}],
        "workspace_rules": [str],
        "raw": str,
    }
    """
    agents_md = workspace_path / "AGENTS.md"
    if not agents_md.exists():
        return {"agents": [], "workspace_rules": [], "raw": ""}

    content = agents_md.read_text("utf-8")
    agents = []
    workspace_rules = []

    # Parse H2 sections as agent definitions
    sections = re.split(r'^## ', content, flags=re.MULTILINE)
    for section in sections:
        if not section.strip():
            continue
        lines = section.strip().split('\n')
        heading = lines[0].strip()
        body = '\n'.join(lines[1:]).strip()

        # Heuristic: if heading looks like an agent name, treat as agent def
        if re.match(r'^[A-Za-z][A-Za-z0-9_-]*$', heading.split('(')[0].strip()):
            agent = {"name": heading, "role": "", "rules": []}
            # Extract role from first paragraph
            for line in body.split('\n'):
                if line.strip().lower().startswith('role:'):
                    agent["role"] = line.split(':', 1)[1].strip()
                elif line.strip().startswith('- '):
                    agent["rules"].append(line.strip()[2:])
            agents.append(agent)
        else:
            # Non-agent section: treat as workspace rules
            for line in body.split('\n'):
                if line.strip().startswith('- '):
                    workspace_rules.append(line.strip()[2:])

    return {"agents": agents, "workspace_rules": workspace_rules, "raw": content}
```

### Where AGENTS.md Sits in the Layering Order

`AGENTS.md` contributes to **Layer 1 (Workspace Policy)**. Specifically:

- Agent definitions in AGENTS.md populate the workspace layer's role suggestions.
  They do NOT override the profile or agent override layers.
- Workspace rules from AGENTS.md are appended to Layer 1 rules, after any
  `.ghostlink/workspace.json` rules and before profile rules.
- If AGENTS.md defines a role for an agent name that matches a GhostLink agent,
  that role is used as a **suggestion** shown in the UI, not as an override.

### Import Without Becoming Source of Truth

1. AGENTS.md is read at spawn time and when the file changes on disk.
2. The parsed data is stored in memory (not in SQLite) as workspace context.
3. If the operator explicitly imports AGENTS.md via the UI, the rules are copied
   into the workspace policy table in SQLite. After import, the SQLite copy is the
   source of truth. Changes to AGENTS.md on disk are shown as "pending diff" in the
   UI but do not automatically apply.
4. The operator can re-import, ignore, or reject changes.

### What Happens When AGENTS.md Changes on Disk

1. A filesystem watcher (or polling check at heartbeat time) detects the change.
2. The new content is parsed.
3. A diff is computed against the last imported version.
4. A WebSocket event `agents_md_changed` is broadcast with the diff summary.
5. The frontend shows a notification: "AGENTS.md changed in workspace. Review changes?"
6. The operator can:
   a. **Import:** Apply new rules to workspace policy.
   b. **Ignore:** Dismiss the notification. The change is not applied.
   c. **View diff:** See what changed before deciding.
7. No automatic application. The operator is always in control.

### File Ownership

- `tyson`:
  - New file: `backend/agents_md.py` (parser)
  - Modified: `backend/routes/agents.py` (import endpoint, change detection)
- `ned`:
  - New UI surface for AGENTS.md import/diff/review
- `coop`:
  - Owns the adopt/adapt/reject decision on AGENTS.md behavior

---

## 4. Skills Center Data Model

### Current State

Skills are stored in `backend/data/skills_config.json` with this structure
(from `backend/skills.py:250-268`):

```json
{
  "agent_skills": {
    "claude": ["web-search", "file-browser", ...],
    "codex": ["web-search", "file-browser", ...]
  },
  "skill_config": {
    "claude:web-search": {"api_key": "..."},
    "codex:web-search": {"api_key": "..."}
  }
}
```

Everything is keyed by `agent_name` string. If the agent is renamed, all skill
assignments break.

### Target: Profile-Based Skills

With Phase 2, the primary key for skill assignments moves from agent_name to
profile_id. The `profile_skills` table (defined in section 1) replaces the
`agent_skills` dict. Agent-level skill overrides (additions/removals) are stored
in a new table:

```sql
CREATE TABLE IF NOT EXISTS agent_skill_overrides (
    agent_id    TEXT NOT NULL,  -- from Phase 1A identity record
    skill_id    TEXT NOT NULL,
    action      TEXT NOT NULL,  -- "add" or "remove"
    config      TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (agent_id, skill_id)
);
```

### Migration from skills_config.json

1. On first Phase 2 startup, read `backend/data/skills_config.json`.
2. For each agent in `agent_skills`:
   a. Look up the agent_id from the Phase 1A identity table by display name.
   b. Look up the agent's profile_id.
   c. If the profile does not have skill assignments yet, seed the profile_skills
      table from this agent's list (first agent for each profile sets the baseline).
   d. For subsequent agents on the same profile, compute the diff between the
      profile's skill list and this agent's list. Store diffs as agent_skill_overrides.
3. For each entry in `skill_config`:
   a. Parse the `agent:skill` key.
   b. Store the config in `profile_skills.config` or `agent_skill_overrides.config`
      depending on whether it is profile-level or agent-level.
4. Rename `skills_config.json` to `skills_config.json.v1-backup`.

### Inheritance for Skills

```
Global skills (BUILTIN_SKILLS in skills.py:8-235)
    |
    v
Profile skills (profile_skills table — which of the global skills are enabled)
    |
    v
Agent overrides (agent_skill_overrides table — add or remove on top of profile)
    |
    v
Effective skills (computed by compute_effective_state())
```

The `SkillsRegistry` class at `backend/skills.py:240` is refactored:

```python
class SkillsRegistry:
    def __init__(self, data_dir: Path, db: aiosqlite.Connection):
        self.data_dir = data_dir
        self.db = db
        # Keep legacy JSON loading for backward compat during migration
        self._legacy_config = self._load_legacy()

    async def get_effective_skills(self, agent_id: str, profile_id: str) -> list[str]:
        """Get the resolved skill list for an agent, applying profile + overrides."""
        profile_skills = await self._get_profile_skills(profile_id)
        overrides = await self._get_agent_overrides(agent_id)
        enabled = set(profile_skills)
        for override in overrides:
            if override["action"] == "add":
                enabled.add(override["skill_id"])
            elif override["action"] == "remove":
                enabled.discard(override["skill_id"])
        return sorted(enabled)

    # Legacy compatibility: get_agent_skills(agent_name) still works
    # by resolving agent_name -> agent_id -> profile_id -> effective skills
    def get_agent_skills(self, agent_name: str) -> list[str]:
        """Legacy sync interface. Falls back to profile-based resolution."""
        ...
```

### File Ownership

- `tyson`:
  - Modified: `backend/skills.py` (profile-based resolution, migration)
  - Modified: `backend/routes/agents.py` (skills endpoints use agent_id/profile_id)
  - Modified: `backend/app.py` (pass db connection to SkillsRegistry)

---

## 5. API Changes for Profiles

### New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/profiles` | List all profiles with summary. |
| POST | `/api/profiles` | Create a new profile. Body: `{name, description, base_provider}`. |
| GET | `/api/profiles/{profile_id}` | Get profile with all settings, skills, and rules. |
| PUT | `/api/profiles/{profile_id}` | Update profile fields. |
| DELETE | `/api/profiles/{profile_id}` | Delete profile (fails if agents are assigned). |
| GET | `/api/profiles/{profile_id}/settings` | Get all profile settings. |
| PUT | `/api/profiles/{profile_id}/settings` | Set profile settings. Body: `{key: value, ...}`. |
| GET | `/api/profiles/{profile_id}/skills` | Get profile skill assignments. |
| PUT | `/api/profiles/{profile_id}/skills` | Set profile skill list. Body: `{skill_ids: [...]}`. |
| POST | `/api/profiles/{profile_id}/skills/{skill_id}/toggle` | Enable/disable a skill for the profile. |
| GET | `/api/profiles/{profile_id}/rules` | Get profile rules. |
| POST | `/api/profiles/{profile_id}/rules` | Add a rule. |
| DELETE | `/api/profiles/{profile_id}/rules/{rule_id}` | Remove a rule. |

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/agents/{name}/config` | Add `profile_id` and `effective_state` to response. |
| POST | `/api/agents/{name}/config` | Accept `profile_id` to reassign agent to a profile. |
| GET | `/api/skills/agent/{agent_name}` | Resolve skills via profile + overrides instead of flat agent_skills dict. |
| POST | `/api/skills/agent/{agent_name}/toggle` | Store as agent_skill_override, not direct assignment. |
| POST | `/api/spawn-agent` | Accept optional `profileId` in body. |
| POST | `/api/register` | Accept optional `profile_id` in body. |
| GET | `/api/agents/{name}/effective-state` | **New.** Returns the fully computed effective state for the agent. |

### New Endpoint: Effective State

```
GET /api/agents/{name}/effective-state

Response:
{
  "agent_id": "...",
  "profile_id": "...",
  "profile_name": "...",
  "effective": {
    "model": "claude-sonnet-4-20250514",
    "thinkingLevel": "medium",
    "responseMode": "mentioned",
    "autoApprove": false,
    "failoverModel": "",
    "enabled_skills": ["web-search", "file-browser", ...],
    "rules": [
      {"source": "system", "content": "..."},
      {"source": "workspace", "content": "..."},
      {"source": "profile", "content": "..."},
      {"source": "agent", "content": "..."}
    ]
  },
  "overrides": {
    "model": {"layer": "agent", "value": "claude-sonnet-4-20250514"},
    "thinkingLevel": {"layer": "profile", "value": "medium"}
  }
}
```

The `overrides` field shows which layer each value came from, so the operator can
see what is inherited and what is explicitly set.

### New Endpoint: AGENTS.md Import

```
POST /api/workspace/agents-md/import
Body: {"workspace_path": "/path/to/project"}

Response:
{
  "parsed": {
    "agents": [...],
    "workspace_rules": [...]
  },
  "imported_rules_count": 5,
  "suggested_role_mappings": [
    {"agents_md_name": "backend-dev", "ghostlink_agent": "codex", "suggested_role": "Backend developer"}
  ]
}
```

```
GET /api/workspace/agents-md/diff
Query: ?workspace_path=/path/to/project

Response:
{
  "has_changes": true,
  "diff": {
    "added_rules": [...],
    "removed_rules": [...],
    "changed_agents": [...]
  }
}
```

### Route File Ownership

- `tyson`:
  - New file: `backend/routes/profiles.py` (all profile CRUD endpoints)
  - Modified: `backend/routes/agents.py` (effective state, profile assignment)
  - Modified: `backend/app.py` (register new router)

---

## 6. Frontend Changes for Profiles

### AgentInfoPanel Changes

File: `frontend/src/components/AgentInfoPanel.tsx`

Current tabs: `info | context | skills` (line 28).

Add a new tab: `info | context | skills | profile`.

The profile tab shows:
- Current profile assignment (name, description).
- "Change Profile" dropdown.
- Effective state summary (from `/api/agents/{name}/effective-state`).
- Per-field override indicators showing which layer each value comes from.
- "Override" buttons next to each field to set an agent-level override.

### Agent Type Changes

File: `frontend/src/types/index.ts:27-42`

Add to the `Agent` interface:

```typescript
export interface Agent {
  // ... existing fields ...
  agent_id?: string;       // Phase 1A stable ID
  profile_id?: string;     // Phase 2 profile assignment
  profile_name?: string;   // Human-readable profile name
  drift_detected?: boolean; // Phase 1B drift flag
}
```

### New ProfileManager Component

New file: `frontend/src/components/ProfileManager.tsx`

Full-page or modal component for CRUD on profiles:
- List all profiles with agent count.
- Create/edit profile form (name, description, base_provider).
- Skills assignment grid (same UX as current AgentInfoPanel skills tab, but for profile).
- Settings editor (model, thinkingLevel, responseMode, etc.).
- Rules editor (add/remove/reorder rules).
- "Agents using this profile" list.

### New EffectiveStateViewer Component

New file: `frontend/src/components/EffectiveStateViewer.tsx`

Shows the merged effective state with layer indicators:
- Each field shows its value and a badge indicating the source layer
  (System / Workspace / Profile / Agent).
- Overridden fields are highlighted.
- Click on a field to see the value at each layer.

### AGENTS.md Review Component

New file: `frontend/src/components/AgentsMdReview.tsx`

Shown when the `agents_md_changed` WebSocket event fires:
- Side-by-side diff of old vs new AGENTS.md content.
- "Import" / "Ignore" / "View Details" buttons.
- Mapping suggestions: which AGENTS.md agents map to which GhostLink agents.

### File Ownership

- `ned`:
  - Modified: `frontend/src/components/AgentInfoPanel.tsx`
  - Modified: `frontend/src/types/index.ts`
  - New: `frontend/src/components/ProfileManager.tsx`
  - New: `frontend/src/components/EffectiveStateViewer.tsx`
  - New: `frontend/src/components/AgentsMdReview.tsx`

---

## 7. Acceptance Tests for Phase 2

All tests owned by `kurt`. Test files go in `backend/tests/`.

### T-2-01: Profile CRUD
- Create a profile via `POST /api/profiles`.
- Verify it appears in `GET /api/profiles`.
- Update it via `PUT /api/profiles/{id}`.
- Delete it via `DELETE /api/profiles/{id}`.
- Verify delete fails if an agent is assigned to it.

### T-2-02: Profile skill assignment
- Create profile. Set skills via `PUT /api/profiles/{id}/skills`.
- Verify `GET /api/profiles/{id}/skills` returns correct list.
- Assign agent to profile.
- Verify `GET /api/skills/agent/{name}` returns the profile's skills.

### T-2-03: Agent skill override
- Assign agent to profile with skills [A, B, C].
- Toggle skill D on for the agent via `POST /api/skills/agent/{name}/toggle`.
- Verify effective skills = [A, B, C, D].
- Toggle skill B off for the agent.
- Verify effective skills = [A, C, D].

### T-2-04: Inheritance resolution order
- Set workspace policy with `model: "ws-model"`.
- Set profile with `model: "prof-model"`.
- Set agent override with `model: ""` (empty, meaning inherit).
- Verify effective model = "prof-model" (Layer 2 overrides Layer 1).
- Set agent override with `model: "agent-model"`.
- Verify effective model = "agent-model" (Layer 3 overrides Layer 2).

### T-2-05: System policy cannot be overridden
- Set system policy `force_autoApprove: false`.
- Set profile `autoApprove: true`.
- Set agent override `autoApprove: true`.
- Verify effective autoApprove = false (system policy wins).

### T-2-06: AGENTS.md parsing
- Create a workspace with an AGENTS.md containing agent definitions and rules.
- Call `POST /api/workspace/agents-md/import`.
- Verify parsed agents and rules are returned.
- Verify workspace rules are stored in the rules table.

### T-2-07: AGENTS.md change detection
- Import AGENTS.md.
- Modify AGENTS.md on disk.
- Verify `GET /api/workspace/agents-md/diff` shows changes.
- Re-import. Verify diff clears.

### T-2-08: Skills migration from legacy JSON
- Create a `skills_config.json` with legacy format.
- Run migration.
- Verify profile_skills and agent_skill_overrides tables are populated correctly.
- Verify `skills_config.json.v1-backup` exists.

### T-2-09: Rename does not break profile or skills
- Create agent with profile and skills.
- Rename agent (change display name via label update).
- Verify profile assignment persists (keyed by agent_id, not name).
- Verify effective skills are unchanged.

### T-2-10: Effective state endpoint accuracy
- Set up all four layers with different values.
- Call `GET /api/agents/{name}/effective-state`.
- Verify every field matches the expected merge result.
- Verify the `overrides` field correctly identifies the source layer for each value.

### T-2-11: Profile-shared behavior
- Create a profile with specific skills and settings.
- Assign three agents to the same profile.
- Verify all three agents have the same effective skills and settings.
- Change the profile's model.
- Verify all three agents now have the new model in their effective state.

### T-2-12: Rules layering
- Add system rule "Always use English."
- Add workspace rule "Follow PEP 8."
- Add profile rule "Write tests for all changes."
- Add agent rule "Focus on backend only."
- Verify `effective_state.rules` contains all four in order.

---

## 8. Regression Risks for Phase 2

| Risk | Impact | Mitigation |
|------|--------|------------|
| Skills migration loses custom skill configs | API keys and custom configs for skills disappear. | Migration copies configs to the new tables. Backup file preserved. Test T-2-08 validates. |
| Legacy `get_agent_skills(agent_name)` callers break | Any code calling the old sync interface fails. | The refactored `SkillsRegistry` keeps the legacy method signature. It resolves name to agent_id to profile_id internally. |
| Profile delete with assigned agents | Deleting a profile leaves agents without a profile. | API rejects delete if agents are assigned. Return HTTP 409 with list of affected agents. |
| AGENTS.md parser breaks on unusual markdown | Repos with non-standard AGENTS.md formatting produce garbage. | Parser is best-effort with fallback: if parsing fails, return `raw` content and empty structured data. Log warning. |
| Effective state computation is slow | Computing effective state on every API call adds latency. | Cache the effective state per agent_id. Invalidate cache on profile change, agent config change, or workspace policy change. Cache TTL: 30 seconds. |
| Frontend skill toggle behavior changes | Current toggle writes directly to agent_skills. New behavior writes to agent_skill_overrides, which may be confusing if the profile also has the skill. | UI clearly shows "Profile skill (inherited)" vs "Agent override (custom)". Toggle on an inherited skill creates a no-op override, not a duplicate. |

---

## 9. Rollback Plan for Phase 2

### If profile model is broken

1. Drop the `profiles`, `profile_settings`, `profile_skills`, `profile_rules`,
   and `agent_skill_overrides` tables from SQLite.
2. Restore `backend/skills.py` to pre-Phase-2 version (JSON file based).
3. Restore `skills_config.json` from `skills_config.json.v1-backup`.
4. Remove `backend/profiles.py` and `backend/agents_md.py`.
5. Remove `backend/routes/profiles.py`.
6. Revert `backend/routes/agents.py` changes (effective state, profile assignment).

### If AGENTS.md integration causes issues

1. Remove `backend/agents_md.py`.
2. Remove the import/diff endpoints from `routes/agents.py` or `routes/profiles.py`.
3. AGENTS.md support is entirely additive -- removing it does not affect core functionality.

### If inheritance causes incorrect effective state

1. Disable profile resolution: set all agents' `profile_id` to `default`.
2. The `default` profile has all skills enabled and no restrictive settings,
   which matches pre-Phase-2 behavior.
3. Agent overrides still work as before.

### Feature flags

Add to `config.toml` under `[profiles]`:

```toml
[profiles]
enabled = true                 # Enable profile model
inheritance = true             # Enable layered inheritance
agents_md_import = true        # Enable AGENTS.md import/watch
legacy_skills_compat = true    # Keep legacy skills_config.json sync
```

### Database migration safety

All Phase 2 schema changes use `CREATE TABLE IF NOT EXISTS`. Rolling back does not
require dropping tables -- the tables can exist unused. The application checks
`config.profiles.enabled` before using the profile tables. If disabled, it falls
back to the legacy flat skills model.

---

## Cross-Phase Dependencies

| Phase 1B Deliverable | Phase 2 Consumer |
|---------------------|-----------------|
| Per-agent directory `agents/{agent_id}/` | Profile and effective state files stored here |
| `state.json` with `profile_id` | Profile resolution reads this field |
| SQLite identity record with `profile_id` column | Profile assignment persisted here |
| `identity_inject.py` module | Profile rules and effective soul injected via this module |
| Drift detection | Profile changes trigger reinjection for exec-per-trigger agents |

---

## File Ownership Summary

### Phase 1B

| Owner | Files |
|-------|-------|
| `tyson` | `backend/identity_inject.py` (new), `backend/wrapper.py`, `backend/wrapper_mcp.py`, `backend/agent_memory.py`, `backend/mcp_bridge.py`, `backend/routes/agents.py`, `backend/worktree.py` |
| `ned` | `frontend/src/components/AgentBar.tsx`, `frontend/src/components/AgentInfoPanel.tsx`, `frontend/src/types/index.ts` |
| `kurt` | `backend/tests/test_phase1b_*.py` (new) |

### Phase 2

| Owner | Files |
|-------|-------|
| `tyson` | `backend/profiles.py` (new), `backend/agents_md.py` (new), `backend/routes/profiles.py` (new), `backend/skills.py`, `backend/routes/agents.py`, `backend/app.py`, `backend/store.py` |
| `ned` | `frontend/src/components/ProfileManager.tsx` (new), `frontend/src/components/EffectiveStateViewer.tsx` (new), `frontend/src/components/AgentsMdReview.tsx` (new), `frontend/src/components/AgentInfoPanel.tsx`, `frontend/src/types/index.ts` |
| `kurt` | `backend/tests/test_phase2_*.py` (new) |

---

*End of Phase 1B + Phase 2 Specification*
