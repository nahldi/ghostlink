# Phase 1A Risk Audit: Stable Agent Identity

**Auditor:** Independent audit agent
**Date:** 2026-04-06
**Scope:** Full codebase regression risk analysis for adding `agent_id` (UUID v7) and rekeying from agent name to stable ID
**Verdict:** HIGH cumulative risk. Over 40 distinct code locations use agent name as a primary key. No single change is catastrophic, but the blast radius is wide and there are zero integration tests covering the migration path.

---

## Table of Contents

1. [Backend Name-Keyed Data Structures](#1-backend-name-keyed-data-structures)
2. [Filesystem Paths Using Agent Names](#2-filesystem-paths-using-agent-names)
3. [API Routes Parameterized by Agent Name](#3-api-routes-parameterized-by-agent-name)
4. [Frontend Name Dependencies](#4-frontend-name-dependencies)
5. [MCP Bridge Name Coupling](#5-mcp-bridge-name-coupling)
6. [Queue File System](#6-queue-file-system)
7. [Wrapper and Process Management](#7-wrapper-and-process-management)
8. [External System Dependencies](#8-external-system-dependencies)
9. [Concurrent Access Risks](#9-concurrent-access-risks)
10. [Data Migration Risks](#10-data-migration-risks)
11. [Test Suite Impact](#11-test-suite-impact)
12. [Cross-Phase Conflicts](#12-cross-phase-conflicts)
13. [Risk Summary Matrix](#13-risk-summary-matrix)

---

## 1. Backend Name-Keyed Data Structures

### 1.1 AgentRegistry (`backend/registry.py`)

| Location | Line(s) | What It Does | Break Risk | Test Coverage |
|----------|---------|-------------|------------|---------------|
| `_instances: dict[str, AgentInstance]` | 66 | Primary agent store keyed by `name` | **CRITICAL** -- This is the root of all name-based keying. Every `get()`, `deregister()`, `set_state()` call uses name as the key. | Covered by `test_modules.py` lines 126-184 |
| `register()` | 81-105 | Generates name from base + slot (`claude`, `claude-2`), stores by name | **CRITICAL** -- Name generation logic must be preserved as display name even after introducing agent_id. The `name` field becomes the slug, not the primary key. | Covered |
| `deregister(name)` | 107-112 | Removes by name key | **HIGH** -- Must change to accept agent_id or name | Covered |
| `get(name)` | 114-115 | Lookup by name | **HIGH** -- Most-called method in the codebase. Every route, MCP tool, and helper calls this. | Covered |
| `resolve_token(token)` | 131-136 | Iterates all instances to find by token | LOW -- Already iterates; no name dependency. But callers use the returned `inst.name` everywhere after resolution. | Covered |

**Regression risk:** The `register()` method returns an `AgentInstance` whose `.name` field is used immediately by every caller. Changing the internal dict key to `agent_id` requires every caller to also carry the `agent_id` forward. This is the single highest-impact change.

### 1.2 deps.py -- In-Memory State Dicts (`backend/deps.py`)

Every one of these dicts is keyed by agent name:

| Dict | Line | Purpose | Break Risk |
|------|------|---------|------------|
| `_agent_processes: dict[str, Popen]` | 72 | Maps agent name to subprocess | HIGH |
| `_last_heartbeats: dict[str, float]` | 75 | Heartbeat timestamps by name | MEDIUM |
| `_agent_presence: dict[str, dict]` | 197 | Agent presence state by name | HIGH |
| `_agent_browser_state: dict[str, dict]` | 198 | Browser tool state by name | HIGH |
| `_terminal_streams: dict[str, dict]` | 199 | Terminal output by name | HIGH |
| `_mcp_invocation_logs: dict[str, deque]` | 200 | MCP tool call logs by name | MEDIUM |
| `_workspace_changes: deque[dict]` | 203 | Has `agent` field (name) in each entry | MEDIUM |
| `_agent_replay_log: deque[dict]` | 204 | Has `agent` field (name) in each entry | MEDIUM |
| `_file_diff_cache: dict[str, dict[str, dict]]` | 205 | Outer key is agent name | MEDIUM |
| `_thinking_buffers: dict[str, dict]` | 185 | Keyed by agent name | LOW |

**Critical function:** `cleanup_agent_state(agent_name)` at line 212 pops from 6 of these dicts by name. Must be updated to use agent_id.

**`get_or_create_mcp_log(agent_name)`** at line 227 creates new deque entries keyed by agent name. Has an eviction policy for oldest agent -- eviction key would change.

**`set_file_diff(agent_name, path, diff)`** at line 238 uses agent name as outer cache key.

### 1.3 MessageRouter (`backend/router.py`)

| Location | Line(s) | What It Does | Break Risk |
|----------|---------|-------------|------------|
| `_AGENT_KEYWORDS` | 15-22 | Maps base names (`claude`, `codex`, `gemini`) to keywords for smart routing | LOW -- Uses base names, not instance names |
| `classify_message()` | 25-43 | Matches agents by `n.startswith(agent_base)` | LOW -- This pattern would still work if names stay as display slugs |
| `get_targets()` | 55-91 | Returns list of agent names as routing targets | HIGH -- Return values flow into queue file creation (see Section 6) |

### 1.4 ExecPolicy (`backend/security.py`)

| Location | Line(s) | What It Does | Break Risk |
|----------|---------|-------------|------------|
| `_policies: dict[str, dict]` | 228 | Keyed by agent name | HIGH |
| `get_policy(agent_name)` | 242-248 | Lookup by agent name | HIGH |
| `set_policy(agent_name, policy)` | 250-257 | Stored by agent name, persisted to `exec_policies.json` | HIGH -- Persisted file uses name keys. Migration needed. |
| `check_command(agent_name, command)` | 259 | Delegates to `get_policy(agent_name)` | HIGH |

**On-disk data:** `exec_policies.json` is a JSON dict keyed by agent name. Existing policies would be orphaned if names change.

### 1.5 ScheduleStore (`backend/schedules.py`)

| Location | Line(s) | What It Does | Break Risk |
|----------|---------|-------------|------------|
| `agent TEXT` column | 15 | SQLite column stores agent name as free text | MEDIUM -- Existing scheduled tasks reference agents by name. Would need migration or lookup indirection. |

### 1.6 AutomationManager (`backend/automations.py`)

| Location | Line(s) | What It Does | Break Risk |
|----------|---------|-------------|------------|
| `AutomationRule.agent` | 37 | Target agent stored by name string | MEDIUM |
| Queue trigger at line 435 | 435 | Constructs `f"{agent}_queue.jsonl"` from the rule's agent name | HIGH |

### 1.7 AppHelpers (`backend/app_helpers.py`)

| Location | Line(s) | What It Does | Break Risk |
|----------|---------|-------------|------------|
| `get_full_agent_list()` | 30-72 | Merges live registry (by name) with offline config (by base name). Uses `live_names = {a["name"] for a in live}` to deduplicate. | HIGH -- Core data flow for `/api/status`. If `name` semantics change, deduplication breaks. |
| `route_mentions()` | 99-150 | Gets `inst.name` from registry, creates queue files by `f"{target}_queue.jsonl"` | HIGH |

---

## 2. Filesystem Paths Using Agent Names

### 2.1 Agent Data Directories

**Location:** `backend/agent_memory.py` lines 33, 300, 312, 324, 336

Agent memory, soul, and notes are stored at:
```
data/{agent_name}/memory/*.json
data/{agent_name}/soul.txt
data/{agent_name}/notes.txt
```

**Confirmed on-disk data:**
```
data/claude/soul.txt
data/codex/soul.txt
data/claude-2/  (directory exists)
data/codex-2/   (directory exists)
data/codex-3/   (directory exists)
data/gemini/    (directory exists)
data/gemini-2/  (directory exists)
data/copilot/   (directory exists)
```

**Break risk:** CRITICAL -- These directories contain persistent user data (memories, soul prompts, notes). If the identity system switches from names to UUIDs for directory paths, all existing data is orphaned. If names stay as directory paths but the internal key becomes agent_id, every function that constructs a path needs agent name resolution.

**`_sanitize_agent_name()`** at line 21 validates that names match `^[a-zA-Z0-9_-]{1,50}$`. UUID v7 strings would pass this regex, but the directory names would become opaque UUIDs instead of human-readable slugs.

**`search_all_memories()`** at line 188 iterates `data_dir` subdirectories and uses `agent_dir.name` as the agent identifier. This would break if directories are renamed to UUIDs.

### 2.2 Queue Files

**Location:** Multiple files (see Section 6)

Queue files are stored at:
```
data/{agent_name}_queue.jsonl
```

These are created and consumed by name. Six different code locations construct this path.

### 2.3 Provider Config Files

**Location:** `backend/wrapper.py` line 237, on-disk evidence

Provider-specific MCP config files are stored at:
```
data/provider-config/{agent_name}-mcp.json
data/provider-config/{agent_name}-settings.json
```

**Confirmed on-disk:**
```
data/provider-config/claude-mcp.json
data/provider-config/claude-2-mcp.json
data/provider-config/gemini-settings.json
data/provider-config/gemini-2-settings.json
```

**Break risk:** HIGH -- The wrapper constructs these paths from the assigned agent name. If the name changes or becomes a UUID, the wrapper must be updated to use the correct identifier for file paths.

### 2.4 Git Worktree Paths

**Location:** `backend/worktree.py` lines 44, 45, 69, 83, 85, 130

Worktree paths and branch names are derived from agent name:
```
.ghostlink-worktrees/{agent_name}/
ghostlink-{agent_name}          (git branch name)
```

**Break risk:** HIGH -- Branch names containing UUIDs would be ugly and hard to manage. Git branch names have restrictions that may conflict with UUID formats (though UUID v7 hex would be fine). More importantly, existing worktrees would be orphaned.

### 2.5 Spawn Log Files

**Location:** `backend/routes/agents.py` lines 843-846

```
data/logs/agent-spawn/{base}-stdout.log
data/logs/agent-spawn/{base}-stderr.log
```

**Break risk:** LOW -- These use `base` (e.g., "claude"), not instance name.

---

## 3. API Routes Parameterized by Agent Name

All these routes use `{name}` as a URL path parameter that maps to agent name:

| Route | File:Line | Used For |
|-------|-----------|----------|
| `POST /api/deregister/{name}` | agents.py:540 | Kill agent |
| `POST /api/agents/{name}/pause` | agents.py:1184 | Pause agent |
| `POST /api/agents/{name}/resume` | agents.py:1198 | Resume agent |
| `GET /api/agents/{name}/soul` | agents.py:1255 | Get agent soul |
| `POST /api/agents/{name}/soul` | agents.py:1263 | Set agent soul |
| `GET /api/agents/{name}/notes` | agents.py:1276 | Get agent notes |
| `POST /api/agents/{name}/notes` | agents.py:1284 | Set agent notes |
| `GET /api/agents/{name}/health` | agents.py:1294 | Health check |
| `GET /api/agents/{name}/config` | agents.py:1303 | Get config |
| `POST /api/agents/{name}/config` | agents.py:1325 | Set config |
| `GET /api/agents/{name}/memories` | agents.py:1353 | List memories |
| `GET /api/agents/{name}/memories/{key}` | agents.py:1362 | Get memory |
| `DELETE /api/agents/{name}/memories/{key}` | agents.py:1374 | Delete memory |
| `POST /api/agents/{name}/feedback` | agents.py:1384 | User feedback |
| `POST /api/agents/{name}/terminal/open` | agents.py:1434 | Open terminal |
| `GET /api/agents/{name}/terminal` | agents.py:1481 | Peek terminal |
| `GET /api/agents/{name}/terminal/live` | agents.py:1499 | Live terminal |
| `POST /api/agents/{name}/terminal/stream` | agents.py:1511 | Stream terminal |
| `POST /api/agents/{name}/mcp/log` | agents.py:1533 | Post MCP log |
| `GET /api/agents/{name}/mcp/log` | agents.py:1548 | Get MCP log |
| `GET /api/agents/{name}/presence` | agents.py:1559 | Get presence |
| `GET /api/agents/{name}/browser` | agents.py:1579 | Get browser state |
| `GET /api/agents/{name}/browser/artifact` | agents.py:1602 | Get browser artifact |
| `GET /api/agents/{name}/replay` | agents.py:1617 | Get replay events |
| `GET /api/agents/{name}/diff` | agents.py:1632 | Get file diff |
| `POST /api/agents/{name}/thinking` | agents.py:1057 | Post thinking |
| `GET /api/agents/{name}/thinking` | agents.py:1098 | Get thinking |
| `GET /api/agents/{name}/workspace` | agents.py:2067 | Get workspace |
| `GET /api/agents/{name}/workspace/file` | agents.py:2084 | Get file |
| `GET /api/agents/{name}/workspace/changes` | agents.py:2112 | Get changes |
| `GET /api/agents/{name}/files` | agents.py:2127 | List files |
| `GET /api/agents/{name}/file` | agents.py:2152 | Get file |
| `PUT /api/agents/{name}/file` | agents.py:2158 | Write file |
| `GET /api/agents/{name}/checkpoints` | agents.py:2198 | List checkpoints |
| `POST /api/agents/{name}/checkpoints` | agents.py:2206 | Create checkpoint |
| `POST /api/agents/{name}/checkpoints/{id}/restore` | agents.py:2237 | Restore checkpoint |
| `DELETE /api/agents/{name}/checkpoints/{id}` | agents.py:2288 | Delete checkpoint |
| `GET /api/agents/{name}/tasks` | agents.py:2312 | List tasks |
| `POST /api/agents/{name}/tasks` | agents.py:2320 | Create task |
| `DELETE /api/agents/{name}/tasks/{task_id}` | agents.py:2362 | Delete task |
| `GET /api/security/exec-policy/{agent_name}` | security.py:46 | Get exec policy |
| `POST /api/security/exec-policy/{agent_name}` | security.py:51 | Set exec policy |
| `POST /api/kill-agent/{name}` | agents.py (spawn section) | Kill by name |

**Total: 40+ routes parameterized by agent name.**

**Break risk:** CRITICAL -- Every one of these routes is called by the frontend using `agent.name`. Changing the URL parameter to `agent_id` requires coordinated frontend + backend changes. Keeping both name and ID routes simultaneously is the safest migration path but doubles the route count temporarily.

---

## 4. Frontend Name Dependencies

### 4.1 Agent Type Definition (`frontend/src/types/index.ts`)

The `Agent` interface at line 27-42 has `name: string` as a primary field. There is **no `id` field**. Every frontend component that interacts with agents uses `agent.name`.

### 4.2 API Client (`frontend/src/lib/api.ts`)

**33 API methods** construct URLs using agent name via `encodeURIComponent(name)` or `encodeURIComponent(agentName)`. Examples:
- `pauseAgent(name)` -> `/api/agents/${name}/pause`
- `getAgentPresence(name)` -> `/api/agents/${name}/presence`
- `killAgent(name)` -> `/api/kill-agent/${name}`
- `setAgentConfig(name, config)` -> `/api/agents/${name}/config`
- `getAgentSoul(name)` -> `/api/agents/${name}/soul`

### 4.3 Zustand Store (`frontend/src/stores/chatStore.ts`)

All per-agent state in the store is keyed by agent name string:
- `thinkingStreams: Record<string, {...}>` (line 97)
- `agentPresence: Record<string, AgentPresence>` (line 106)
- `browserStates: Record<string, AgentBrowserState>` (line 108)
- `terminalStreams: Record<string, {...}>` (line 110)
- `mcpLogs: Record<string, McpInvocationEntry[]>` (line 112)
- `workspaceChanges: Record<string, WorkspaceChange[]>` (line 114)
- `agentReplay: Record<string, AgentReplayEvent[]>` (line 117)
- `fileDiffs: Record<string, Record<string, FileDiffPayload>>` (line 120)
- `cockpitAgent: string | null` (line 102) -- stores agent name

### 4.4 React Component `key=` Props

**30+ components** use `key={agent.name}` for React list rendering:
- `AgentBar.tsx:178`
- `AgentMiniCard.tsx:49`
- `Sidebar.tsx:270`
- `StatsPanel.tsx:86`
- `MobileHeader.tsx:39`
- `MobileSidebar.tsx:129`
- `CustomizationPanel.tsx:142`
- `SearchModal.tsx:186`
- `SessionLauncher.tsx:102`
- `PersonaMarketplace.tsx:281`
- `WorkflowBuilder.tsx:191`

**Break risk:** If `agent.name` stops being unique or stable, React will produce duplicate key warnings and may unmount/remount components incorrectly. Switching `key=` to `agent.id` is safe only if the id is guaranteed unique and stable.

### 4.5 Agent Lookup by Name

**15+ components** use `agents.find(a => a.name === ...)`:
- `App.tsx:67`
- `AgentCockpit.tsx:1053`
- `ChatMessage.tsx:187`
- `useWebSocket.ts:222, 228`
- `AgentInfoPanel.tsx:280`
- `MessageInput.tsx:551`
- `TypingIndicator.tsx:32`
- `StatsPanel.tsx:114`
- `SearchModal.tsx:238`
- `SessionLauncher.tsx:106`

These lookups would break if the `name` field semantics change. If `name` becomes an opaque UUID, display labels would need to come from a separate field.

### 4.6 WebSocket Events

`useWebSocket.ts` lines 164-181: On status update, extracts agent names from the agents array, then calls 5 API endpoints per agent using `agentName`:
```typescript
.map((a) => a.name);
...
api.getAgentPresence(agentName)
api.getAgentBrowserState(agentName)
api.getAgentTerminalLive(agentName)
api.getAgentWorkspaceChanges(agentName)
api.getAgentReplay(agentName)
```

WSEvent types in `types/index.ts` lines 398-422 carry `agent: string` fields that are agent names.

---

## 5. MCP Bridge Name Coupling

### 5.1 Presence Tracking (`backend/mcp_bridge.py`)

| Dict | Line | Key Type |
|------|------|----------|
| `_presence: dict[str, float]` | 38 | agent name |
| `_activity: dict[str, bool]` | 39 | agent name |
| `_activity_ts: dict[str, float]` | 40 | agent name |
| `_cursors: dict[str, dict[str, int]]` | 44 | agent name |
| `_empty_read_count: dict[str, int]` | 48 | agent name |

### 5.2 `cleanup_agent(name)` (line 50-58)

Pops from all 5 dicts by name. Called by `deregister_agent()` in routes.

### 5.3 `_resolve_identity()` (lines 205-243)

This is the MCP authentication function. It resolves agent identity from bearer token or raw name. Returns `inst.name` as the canonical identity. Every MCP tool that takes a `sender` parameter flows through this function.

**Break risk:** HIGH -- This function is the gatekeeper for all MCP tool calls. If agent identity shifts to agent_id, this function must return agent_id, and every downstream consumer of the resolved identity must handle it.

### 5.4 `_trigger_mentions()` (lines 281-313)

Constructs queue files using agent name:
```python
queue_file = _data_dir / f"{target}_queue.jsonl"
```

### 5.5 MCP Instructions (lines 318-364)

The hardcoded instruction text at lines 323-337 tells agents to use base names like `"claude"`, `"codex"`, `"gemini"` as their sender identity. This instruction text is baked into the MCP server and consumed by all connected agents.

**Break risk:** MEDIUM -- If agents start sending UUIDs instead of names, the instruction text becomes misleading. However, the instruction text is for human-readable guidance, not enforcement.

### 5.6 Agent Context Template (agent_memory.py lines 246-287)

`GHOSTLINK_CONTEXT_TEMPLATE` includes:
```
Your agent name (for chat_send sender field): **{agent_name}**
```

This template is written to disk and injected into agent spawns. It tells the agent to use its assigned name as the sender.

---

## 6. Queue File System

Queue files are the trigger mechanism for @mention routing. **Six separate code locations** construct the path `{agent_name}_queue.jsonl`:

| File | Line | Context |
|------|------|---------|
| `mcp_bridge.py` | 301 | `_trigger_mentions()` |
| `app_helpers.py` | 142 | `route_mentions()` |
| `app.py` | 663 | Heartbeat/schedule trigger |
| `automations.py` | 435 | Automation rule trigger |
| `plugin_sdk.py` | 637 | Hook trigger action |
| `wrapper.py` | 747 | Wrapper reads this file for triggers |

The **consumer** is in `wrapper.py` at line 747: the wrapper process polls its queue file to detect when it should read new messages. The wrapper constructs the queue path from the assigned agent name:
```python
"queue": data_dir / f"{assigned_name}_queue.jsonl",
```

If `assigned_name` changes, the wrapper stores the new path at line 862:
```python
_identity["queue"] = data_dir / f"{new_name}_queue.jsonl"
```

**Break risk:** HIGH -- This is a filesystem-based IPC mechanism. Both producers (server) and consumer (wrapper) must agree on the exact file path. If one side switches to agent_id and the other doesn't, the trigger mechanism silently breaks.

---

## 7. Wrapper and Process Management

### 7.1 `wrapper.py`

The wrapper registers with the server at startup and receives an assigned name. It then:
- Constructs provider config file paths using the name (line 237)
- Constructs queue file paths using the name (line 747)
- Posts to API endpoints using the name: `/api/agents/{current_name}/terminal/stream`, `/api/agents/{current_name}/thinking`, `/api/agents/{current_name}/config` (lines 492, 768, 1118, 1132)
- Handles rename at line 862 by updating the queue path

### 7.2 `wrapper_mcp.py`

`MCPAgentProcess` stores `self.agent_name` (line 63) and uses it for:
- Process identification in logs (20+ locations)
- API calls to `/api/agents/{self.agent_name}/terminal/stream` (line 571)
- API calls to `/api/agents/{self.agent_name}/mcp/log` (line 599)
- Result metadata: `"agent": self.agent_name` (lines 266, 312, 372, 506, 564)

### 7.3 Process Tracking in `deps.py`

`_agent_processes: dict[str, Popen]` at line 72 maps agent name to subprocess. This is used by:
- `register_agent()` to move from `_pending_spawns` (keyed by PID) to `_agent_processes` (keyed by name)
- `reap_dead_agent_processes()` to clean up exited processes
- `kill_agent()` to terminate a specific agent's process

---

## 8. External System Dependencies

### 8.1 SDK (`sdk/python/ghostlink_sdk.py`)

`kill(name)` at line 128 constructs:
```python
f"/api/agents/{name}/kill"
```

**Break risk:** MEDIUM -- External SDK consumers hardcode agent names. The SDK would need to be updated and a new version published.

### 8.2 A2A Bridge (`backend/a2a_bridge.py`)

A2A agents register with names like `a2a-{name}` (line 125) and deregister by `f"a2a-{agent.name}"` (line 143). The A2A bridge already has its own `agent_id` field (line 25), but it registers into GhostLink's registry by constructed name.

**Break risk:** MEDIUM -- A2A already uses its own ID internally, but the GhostLink registration is by name.

### 8.3 Bridges (`backend/bridges.py`)

Channel bridges (Discord, Slack, Telegram, WhatsApp) route messages using sender names from the message store. The `send_outbound(sender, message, channel)` method uses the agent name as the display identity on the external platform.

**Break risk:** LOW for the bridge itself (it just passes strings), but HIGH for display consistency -- if internal names become UUIDs, external platforms would show UUIDs instead of human-readable names.

### 8.4 Webhook Payloads

`deps.py` broadcast events include `"agent": agent_name` in payloads delivered to webhooks. External consumers may parse these.

**Break risk:** MEDIUM -- External webhook consumers may break if the agent field changes from a human-readable name to a UUID.

### 8.5 Config File Agent References

`config.toml` has `[agents.claude]` sections keyed by base name. `settings.json` has `persistentAgents` array with `base` fields. `automations.json` has agent name references.

**Break risk:** LOW -- These use base names, not instance names. But if Phase 1A changes how base names map to instances, the config layer needs updating.

### 8.6 Scheduled Tasks (SQLite)

The `schedules` table has an `agent TEXT` column storing agent names. Existing scheduled tasks would reference stale names.

---

## 9. Concurrent Access Risks

### 9.1 Simultaneous Registration

**Scenario:** Two agents call `POST /api/register` at the exact same time.

**Current protection:** `AgentRegistry.register()` uses `self._lock` (threading.Lock). The route handler uses `deps._agent_lock` (asyncio.Lock). These are different locks.

**Risk:** LOW for the registry (protected by threading lock), but the route handler at `agents.py:518` acquires `deps._agent_lock` (async), calls `deps.registry.register()` (which acquires `self._lock`), then does post-registration. The registry lock prevents name collisions. Adding SQLite persistence adds a new failure mode: if the SQLite write fails after the in-memory registration succeeds, the state is inconsistent.

**Mitigation needed:** Wrap registry update + SQLite write in a single transaction with rollback.

### 9.2 Death During SQLite Write

**Scenario:** Agent crashes while the SQLite identity table is being written.

**Risk:** MEDIUM -- The existing `MessageStore` uses WAL mode with `PRAGMA busy_timeout=5000` and `PRAGMA synchronous=NORMAL`. If the same patterns are used for the identity store, SQLite's ACID guarantees protect against partial writes. However, the in-memory registry state could be ahead of the persisted state after a crash.

**Mitigation needed:** On startup, reconcile in-memory state from SQLite. Never trust the in-memory registry alone.

### 9.3 Frontend Polling During Migration

**Scenario:** Frontend polls `/api/status` while the backend is migrating from name-keyed to id-keyed data structures.

**Risk:** HIGH -- If the migration is done via a live code deploy (not an offline migration), there is a window where:
- The backend returns agents with both `name` and `agent_id`
- The frontend doesn't know about `agent_id` yet
- API calls using old URL patterns fail

**Mitigation needed:** Deploy backend changes with backward compatibility first (return both `name` and `id`), then deploy frontend changes.

### 9.4 MCP Tool Calls During Re-registration

**Scenario:** Agent's MCP tool call arrives while the agent is being re-registered (e.g., after a restart).

**Risk:** MEDIUM -- `_resolve_identity()` in mcp_bridge.py validates the bearer token against the registry. If the agent is deregistered and re-registered, the old token is invalidated. The MCP tool call would fail with "stale or unknown token." This is actually correct behavior, but it could cause a brief window of dropped tool calls.

**Mitigation needed:** Ensure restart flow preserves or rotates tokens atomically.

---

## 10. Data Migration Risks

### 10.1 On-Disk Data Using Agent Names

| Data | Path Pattern | Volume | Loss Risk |
|------|-------------|--------|-----------|
| Agent memories | `data/{name}/memory/*.json` | Multiple files per agent | HIGH -- Contains user-created persistent data |
| Agent soul | `data/{name}/soul.txt` | 1 file per agent | MEDIUM -- Customizable identity text |
| Agent notes | `data/{name}/notes.txt` | 1 file per agent | LOW -- Working scratchpad |
| Provider configs | `data/provider-config/{name}-*.json` | 1-2 files per agent instance | MEDIUM -- MCP connection config |
| Queue files | `data/{name}_queue.jsonl` | 1 file per agent | LOW -- Transient trigger data |
| Exec policies | `data/exec_policies.json` | Single file, dict keyed by name | MEDIUM -- Security policies |
| Worktree dirs | `.ghostlink-worktrees/{name}/` | 1 dir per agent | LOW -- Recreated on spawn |
| Git branches | `ghostlink-{name}` | 1 branch per agent | LOW -- Recreated on spawn |
| Spawn logs | `data/logs/agent-spawn/{base}-*.log` | By base, not instance | LOW |

### 10.2 Migration Failure Scenarios

**Half-completed directory rename:** If the migration renames `data/claude/` to `data/{uuid}/` and crashes partway through, some agents have old paths, some have new ones. The system cannot start because it doesn't know which agents are migrated.

**Mitigation:** Use a migration manifest file. Write the mapping `{old_name -> new_id}` to disk before moving any files. On startup, check the manifest and complete any incomplete migration.

**SQLite schema conflict:** If the new identity SQLite table is created but old code runs against it (e.g., rollback), the old code would crash on unknown columns.

**Mitigation:** Use SQLite migrations with version tracking. Never drop columns, only add.

### 10.3 Side-by-Side Operation

**Question:** Can old and new systems run side by side?

**Answer:** Not without an abstraction layer. The registry, mcp_bridge, and routes would need to support both name-based and id-based lookups simultaneously during the transition. This is achievable by:
1. Adding `agent_id` to `AgentInstance` without removing `name`
2. Adding a `get_by_id(agent_id)` method to the registry alongside `get(name)`
3. Keeping all existing API routes working with names
4. Adding new API routes (or query parameter alternatives) that accept agent_id
5. Updating internal keying gradually

---

## 11. Test Suite Impact

### 11.1 Tests That Hardcode Agent Names

| Test File | Lines | What It Hardcodes |
|-----------|-------|-------------------|
| `test_modules.py` | 126-184 | `"claude"`, `"codex"`, `"gemini"` as registration names. Asserts `a1.name == "claude"`, `a2.name` patterns. |
| `test_integration.py` | 46, 76-78, 110-111, 129, 148-149 | Registers `"claude"`, `"gemini"`, `"codex"` and asserts names |
| `test_heartbeat_auth.py` | 43, 57-58, 74, 90 | Registers `"codex"`, `"claude"` and uses `inst.name` |
| `test_bridges.py` | 54, 74, 113, 134-135, 171-172 | Uses `"codex"` as sender name |
| `test_checkpoint_routes.py` | 31 | Registers `"codex"`, uses `agent.name` |
| `test_task_routes.py` | 46, 75 | Registers `"codex"`, constructs queue file by name |
| `test_workflow_routes.py` | 54, 96 | Registers `"codex"`, constructs queue file by name |
| `test_phase5_7_routes.py` | 41, 44 | Calls soul routes with `"codex"` |
| `test_agent_arg_validation.py` | 5, 8, 14 | Uses `"claude"`, `"codex"`, `"gemini"` as base names |
| `test_message_routes.py` | 131, 136, 146, 158, 162 | Uses `"codex"` as sender and in metadata |
| `test_misc_routes.py` | 249 | Uses `"claude"` in agent field |

**Break risk:** MEDIUM -- These tests would need updating, but the assertions are about behavior, not specific name strings. The tests should continue to work if `AgentInstance` gains an `agent_id` field, as long as `name` still works as before.

### 11.2 Missing Test Coverage

| Area | Gap | Risk |
|------|-----|------|
| Migration path | No tests for migrating from name-keyed to id-keyed data | CRITICAL |
| Concurrent registration | No test for race conditions during simultaneous registration | HIGH |
| Queue file IPC | Tests create queue files by name but don't verify the file-based trigger works end-to-end | MEDIUM |
| MCP tool identity flow | No test for the full chain: token -> resolve_identity -> tool execution -> result attribution | HIGH |
| Provider config file paths | No test verifying provider config files are created and read correctly | MEDIUM |
| Frontend API compatibility | No contract tests verifying the API response shape matches frontend expectations | CRITICAL |
| Cross-agent memory search | `search_all_memories()` iterates directories by name; no test for this with renamed dirs | MEDIUM |
| Exec policy persistence | No test for exec_policies.json format stability across identity changes | MEDIUM |
| Webhook payload shape | No test verifying webhook payloads contain expected agent identifiers | LOW |

---

## 12. Cross-Phase Conflicts

### 12.1 Phase 1B (Runtime Identity Isolation)

Phase 1B depends on Phase 1A's `agent_id` being stable. If Phase 1A introduces the ID but doesn't fully rekey all subsystems, Phase 1B's runtime injection would need to carry both name and ID, doubling the identity surface area.

**Conflict risk:** LOW if Phase 1A fully rekeys before Phase 1B starts. HIGH if Phase 1A is only partially complete when Phase 1B begins.

### 12.2 Phase 2 (Profiles and Rules)

Phase 2 introduces `global -> profile -> agent override` inheritance. This requires joining profiles to agents by a stable key. If Phase 1A uses agent_id, Phase 2 naturally inherits it.

**Conflict risk:** LOW -- Phase 2 benefits from Phase 1A. No conflict.

However, Phase 2 adds `profile_id` to the identity record. If Phase 1A's identity record schema doesn't include `profile_id` as a nullable field, Phase 2 would need a schema migration.

**Recommendation:** Phase 1A should include all fields from the roadmap spec (agent_id, session_id, parent_agent_id, task_id, context_id, trace_id, artifact_namespace, auth_scope, provider, workspace_id, profile_id, capabilities, transport, rename_history) even if most are NULL initially.

### 12.3 Phase 3 (Operator Control Plane)

Phase 3 adds unified tracing. Every trace event needs `agent_id`. If Phase 1A doesn't add `agent_id` to the activity log, replay log, and workspace changes, Phase 3 would need to retrofit it.

**Conflict risk:** MEDIUM -- Phase 1A should ensure all event payloads carry `agent_id` alongside `agent` (name) from the start.

### 12.4 Phase 5+ (Multi-Agent Execution, A2A)

`roadmap-pt2.md` line 373 references:
```
git worktree add .ghostlink/worktrees/<agent-id> -b ghostlink/<agent-id>/<task-id>
```

This assumes Phase 1A established `agent-id` as the worktree key. Current code uses agent name. If Phase 1A keeps names for worktree paths (for human readability) but uses IDs internally, Phase 5 would need to change worktree paths anyway.

**Recommendation:** Phase 1A should decide now whether filesystem paths use names or IDs, and document the decision. Changing later is much more expensive.

---

## 13. Risk Summary Matrix

| Category | Items | Severity | Effort to Fix |
|----------|-------|----------|---------------|
| Registry internal keying | 1 dict + 6 methods | CRITICAL | 2-4 hours |
| deps.py state dicts | 10 dicts | HIGH | 3-5 hours |
| API routes (name in URL) | 40+ routes | CRITICAL | 8-12 hours |
| Frontend API client | 33 methods | HIGH | 4-6 hours |
| Frontend store keying | 8 Record types | HIGH | 2-3 hours |
| Frontend component keys | 30+ `key={agent.name}` | MEDIUM | 2-3 hours |
| Frontend agent lookups | 15+ `find(a => a.name ===)` | MEDIUM | 2-3 hours |
| Filesystem paths (memory/soul) | 6 functions in agent_memory.py | CRITICAL | 3-5 hours |
| Queue file IPC | 6 producers + 1 consumer | HIGH | 3-4 hours |
| Provider config files | wrapper.py + on-disk | MEDIUM | 1-2 hours |
| Worktree paths/branches | worktree.py | MEDIUM | 1-2 hours |
| MCP bridge state dicts | 5 dicts + identity resolver | HIGH | 3-4 hours |
| MCP instructions text | Hardcoded strings | LOW | 30 min |
| ExecPolicy persistence | JSON file keyed by name | MEDIUM | 1-2 hours |
| Schedules DB column | SQLite text field | MEDIUM | 30 min |
| Automations | Rule agent field | MEDIUM | 30 min |
| SDK | 1 method | LOW | 30 min |
| A2A bridge | Registration flow | LOW | 30 min |
| Webhook payloads | Event data | LOW | 30 min |
| Data migration | 7 data types on disk | CRITICAL | 4-8 hours |
| Test updates | 11 test files | MEDIUM | 3-5 hours |
| Missing test coverage | 9 gaps | CRITICAL | 8-12 hours |

**Estimated total effort:** 50-80 hours of focused implementation and testing

---

## Recommendations

### Must-Do Before Implementation

1. **Decide the name/ID contract.** Will `name` remain the human-readable slug and `agent_id` become the new internal key? Or will `name` be replaced entirely? The audit assumes both will coexist, with `agent_id` as the internal key and `name` as the display slug.

2. **Add `agent_id` to `AgentInstance` as a non-breaking addition first.** The registry should support lookup by both name and ID during the transition period.

3. **Keep all existing API routes working with names.** Add optional `?id=` query parameters or new routes that accept IDs. Do not break the frontend in a single deploy.

4. **Design the filesystem path strategy.** Options:
   - Keep `data/{name}/` paths (human-readable, but breaks if name changes)
   - Switch to `data/{agent_id}/` paths (opaque, but stable)
   - Use `data/{agent_id}/` with a symlink `data/{name} -> data/{agent_id}/` (best of both, but symlinks are fragile on Windows)

5. **Write the migration tool first.** Before any code changes, write and test a migration script that:
   - Creates the SQLite identity table
   - Reads existing agent data directories
   - Assigns UUID v7 IDs
   - Creates the name-to-ID mapping
   - Renames directories (or creates the mapping table)
   - Is idempotent (safe to run multiple times)

6. **Write contract tests.** Before changing any API responses, write tests that assert the current response shape. Then update the tests to accept both old and new shapes during migration.

### Implementation Order

1. Add `agent_id` field to `AgentInstance` dataclass (non-breaking)
2. Add SQLite identity table and persistence
3. Update `AgentRegistry` to support dual-key lookup
4. Update `deps.py` state dicts to use agent_id as internal keys, with name-based convenience accessors
5. Update MCP bridge state dicts
6. Update queue file paths (this requires coordinated wrapper + server changes)
7. Update API routes to accept both name and ID
8. Update frontend to carry `agent_id` and prefer it for API calls
9. Run migration on existing data directories
10. Remove name-only code paths (final cleanup)

### Critical Test Cases to Add Before Starting

- Two agents with same base register simultaneously
- Agent restarts: old data accessible under new session
- Agent rename: all state follows
- Migration script: partial failure recovery
- Frontend polls during backend identity format change
- MCP tool call with stale token after re-registration
- Queue file producer and consumer agree on path after restart
- `search_all_memories()` works with both old and new directory naming
