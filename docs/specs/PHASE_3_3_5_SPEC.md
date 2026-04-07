# Phase 3 / 3.5 Implementation Specification

> Operator Control Plane + Durable Execution and Replay
>
> Spec owner: jeff | Version: 1.0 | Date: 2026-04-06
>
> Prerequisite: Phases 1A, 1B, and 2 exit gates green.

---

## Notation

- **[EXISTS]** = code verified present in the codebase today
- **[NEW]** = must be created
- **[EXTEND]** = existing code must be modified
- DB = `ghostlink.db` (SQLite via aiosqlite, WAL mode) [EXISTS in `backend/store.py`]

---

# Phase 3 -- Operator Control Plane

## 3.1 Unified Task Model

### Current State (verified)

The codebase has two independent task-like systems that do not share a schema:

1. **JobStore** [EXISTS `backend/jobs.py`]: SQLite-backed jobs table with columns `id, uid, type, title, body, status, channel, created_by, assignee, created_at, updated_at, sort_order`. Statuses: `open`, `done`, `archived`. Exposed via `GET/POST /api/jobs`, `PATCH /api/jobs/{id}`, `DELETE /api/jobs/{id}` [EXISTS `backend/routes/jobs.py`]. Frontend: `JobsPanel.tsx` renders a Kanban board with drag-and-drop between status columns.

2. **AgentTask** (per-agent task queue) [EXISTS `frontend/src/components/TaskQueue.tsx`]: Frontend interface `AgentTask { id, agent, title, description, status, progress, created_at, started_at, completed_at, error }` with statuses `queued | running | paused | completed | failed`. Fetches from `GET /api/agents/{name}/tasks`, creates via `POST`, deletes via `DELETE /api/agents/{name}/tasks/{id}`.

3. **AutonomousPlan** [EXISTS `backend/autonomous.py`]: In-memory `AutonomousPlan` dataclass with `plan_id, goal, agent, channel, status, subtasks, created_at, completed_at, summary, require_approval`. Subtasks have their own `id, label, description, status, assignee, result, started_at, completed_at, error`. Statuses for plan: `planning | executing | paused | completed | failed`.

These three systems are **unaware of each other**. A job in JobsPanel has no link to a running AgentTask; an AutonomousPlan subtask has no link to a Job row.

### Unified Task Schema

New SQLite table `tasks` in `ghostlink.db` [NEW]:

```sql
CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         TEXT    NOT NULL UNIQUE,          -- uuid hex, primary external key
    parent_task_id  TEXT    DEFAULT NULL,              -- for subtasks / delegated work
    source_type     TEXT    NOT NULL DEFAULT 'manual', -- 'manual' | 'job' | 'autonomous' | 'delegation' | 'fork'
    source_ref      TEXT    DEFAULT NULL,              -- FK to jobs.uid, plan_id, or parent checkpoint_id
    title           TEXT    NOT NULL,
    description     TEXT    NOT NULL DEFAULT '',
    status          TEXT    NOT NULL DEFAULT 'queued', -- see lifecycle below
    agent_id        TEXT    DEFAULT NULL,              -- Phase 1A identity record FK
    agent_name      TEXT    DEFAULT NULL,              -- denormalized for display (registry name)
    channel         TEXT    NOT NULL DEFAULT 'general',
    profile_id      TEXT    DEFAULT NULL,              -- Phase 2 profile FK
    trace_id        TEXT    DEFAULT NULL,              -- Phase 1A trace_id, propagated
    priority        INTEGER NOT NULL DEFAULT 0,        -- 0=normal, 1=high, -1=low
    progress_pct    INTEGER NOT NULL DEFAULT 0,        -- 0-100
    progress_step   TEXT    NOT NULL DEFAULT '',        -- current step label
    progress_total  INTEGER NOT NULL DEFAULT 0,        -- total steps
    progress_data   TEXT    NOT NULL DEFAULT '{}',      -- JSON: steps array with labels/statuses
    created_by      TEXT    NOT NULL DEFAULT '',        -- who created (operator username or agent name)
    created_at      REAL    NOT NULL,
    started_at      REAL    DEFAULT NULL,
    completed_at    REAL    DEFAULT NULL,
    updated_at      REAL    NOT NULL,
    error           TEXT    DEFAULT NULL,
    metadata        TEXT    NOT NULL DEFAULT '{}'       -- extensible JSON blob
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_name);
CREATE INDEX IF NOT EXISTS idx_tasks_channel ON tasks(channel);
CREATE INDEX IF NOT EXISTS idx_tasks_trace ON tasks(trace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
```

**Task status lifecycle:**

```
queued -> running -> completed
                  -> failed
                  -> cancelled
queued -> cancelled
running -> paused -> running (resume)
                  -> cancelled
running -> awaiting_approval -> running (approved)
                              -> cancelled (rejected)
```

Valid statuses: `queued`, `running`, `paused`, `completed`, `failed`, `cancelled`, `awaiting_approval`, `awaiting_input`.

### Backend: TaskStore [NEW `backend/task_store.py`]

```python
class TaskStore:
    def __init__(self, db: aiosqlite.Connection): ...
    async def init(self): ...  # CREATE TABLE IF NOT EXISTS
    async def create(self, title, channel, agent_name=None, ...) -> dict: ...
    async def get(self, task_id: str) -> dict | None: ...
    async def list_tasks(self, channel=None, agent_name=None, status=None,
                         parent_task_id=None, trace_id=None,
                         limit=100, offset=0) -> list[dict]: ...
    async def update_status(self, task_id: str, status: str, error=None) -> dict | None: ...
    async def update_progress(self, task_id: str, pct: int, step: str,
                              total: int, steps_data: list[dict]) -> dict | None: ...
    async def cancel(self, task_id: str) -> dict | None: ...
    async def delete(self, task_id: str) -> bool: ...
```

### Migration: JobStore compatibility [EXTEND `backend/jobs.py`]

JobStore continues to exist. When a Job is created, a corresponding Task row is also created with `source_type='job'` and `source_ref=job.uid`. The `JobsPanel` Kanban UI continues to work unchanged. The new unified task dashboard reads from the `tasks` table.

When `AutonomousManager.create_plan()` is called [EXTEND `backend/autonomous.py`], each subtask creates a Task row with `source_type='autonomous'` and `source_ref=plan_id`.

### API: `/api/tasks` [NEW `backend/routes/tasks.py`]

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks` | List tasks. Query params: `channel`, `agent`, `status`, `trace_id`, `parent_task_id`, `limit`, `offset` |
| `POST` | `/api/tasks` | Create task. Body: `{ title, description?, channel?, agent_name?, priority?, trace_id? }` |
| `GET` | `/api/tasks/{task_id}` | Get single task |
| `PATCH` | `/api/tasks/{task_id}` | Update task fields (status, assignee, priority, description) |
| `POST` | `/api/tasks/{task_id}/progress` | Update progress. Body: `{ pct, step, total, steps }` |
| `POST` | `/api/tasks/{task_id}/cancel` | Cancel a task |
| `DELETE` | `/api/tasks/{task_id}` | Delete a task |

All mutations broadcast `task_update` via WebSocket [EXTEND `deps.broadcast`].

### File Ownership

- `tyson`: `backend/task_store.py` (new), `backend/routes/tasks.py` (new), `backend/jobs.py` (extend), `backend/autonomous.py` (extend)
- `ned`: Task dashboard UI (new), `JobsPanel.tsx` (keep, wire to unified model)

---

## 3.2 Structured Progress Events

### Current State (verified)

- MCP tool `chat_progress` [EXISTS `backend/mcp_bridge.py:669`] already emits progress. It creates a message with `msg_type="progress"` and stores step data in message `metadata.progress`. Supports both create (new message) and update (by `message_id`). Progress broadcast uses an internal HTTP POST to `/api/messages/{id}/progress-update`.
- Frontend `ProgressCard.tsx` [EXISTS] renders steps with done/active/pending icons and a percentage bar. Props: `{ steps: ProgressStep[], current, total, title }`.

This works but is message-centric. Progress is stored as message metadata, not linked to the unified task model.

### Spec

1. **Progress events now target tasks, not just messages.** The `chat_progress` MCP tool gains an optional `task_id` parameter. When provided, progress is written to the `tasks.progress_*` columns AND the message metadata (for backwards compatibility).

2. **WebSocket event type:** `task_progress`

```json
{
  "type": "task_progress",
  "data": {
    "task_id": "abc123",
    "agent_name": "claude",
    "progress_pct": 66,
    "progress_step": "Running tests",
    "progress_total": 3,
    "steps": [
      { "label": "Planning", "status": "done" },
      { "label": "Coding", "status": "done" },
      { "label": "Running tests", "status": "active" }
    ],
    "updated_at": 1712400000.0
  }
}
```

3. **MCP tool extension** [EXTEND `backend/mcp_bridge.py` `chat_progress`]:
   - Add `task_id: str = ""` parameter.
   - When `task_id` is provided: call `TaskStore.update_progress()` and broadcast `task_progress`.
   - Continue creating/updating message metadata as before for chat-embedded display.

4. **Frontend `ProgressCard.tsx`** [EXTEND]: No changes needed to the component itself. It already accepts the right props. The chat message rendering pipeline already parses `metadata.progress` and passes to `ProgressCard`.

5. **New: Task-level progress in dashboard** [NEW frontend component]: The unified task dashboard (Section 3.1) shows inline progress bars for each running task, sourced from `tasks.progress_pct` and `tasks.progress_data`.

### File Ownership

- `tyson`: `backend/mcp_bridge.py` (extend `chat_progress`), `backend/task_store.py` (progress columns)
- `ned`: Task dashboard progress display (new)

---

## 3.3 Thinking Level UI

### Current State (verified)

- `AgentInstance.thinkingLevel` [EXISTS `backend/registry.py:28`]: field on the in-memory dataclass. Valid values: `""`, `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`.
- `POST /api/agents/{name}/config` [EXISTS `backend/routes/agents.py:1325`]: accepts `thinkingLevel` in body, validates it, sets on instance, broadcasts status update.
- MCP tool `thinking_set` [EXISTS `backend/mcp_bridge.py:1240`]: agents can set their own thinking level.
- Frontend: **No dedicated picker UI exists.** The `thinkingLevel` field is set only via the agent config API or the MCP tool. The `SettingsPanel` does not expose it.

### Spec

1. **ThinkingLevelPicker component** [NEW `frontend/src/components/ThinkingLevelPicker.tsx`]:
   - Dropdown/segmented control placed in the **chat header area**, next to the agent selector or channel tabs.
   - Displays current thinking level for the active/focused agent.
   - Options: Off, Minimal, Low, Medium, High (with visual indicator -- e.g. brain icon with fill level).
   - On selection: `POST /api/agents/{name}/config` with `{ thinkingLevel: value }`.
   - Receives real-time updates via existing `status` WebSocket event (already broadcast on config change).

2. **No backend changes required.** The `PATCH` semantics already exist via `POST /api/agents/{name}/config`. The validation (`backend/routes/agents.py:1337`) already covers the valid values.

3. **Placement:** Rendered inside the chat header bar when an agent is selected/focused. If multiple agents are active, the picker applies to the agent whose cockpit is open or who was last messaged.

### File Ownership

- `ned`: `ThinkingLevelPicker.tsx` (new), chat header integration
- `tyson`: No backend changes needed

---

## 3.4 Context Visibility Controls

### Current State (verified)

- `chat_read` MCP tool [EXISTS `backend/mcp_bridge.py:446`] reads messages from a channel. It respects cursors (per-agent read position) and returns all messages since the agent's last read cursor. It does not filter by context mode.
- Channels [EXISTS `backend/routes/channels.py`] are simple string names. There is no per-channel settings object.
- No context filtering or visibility controls exist anywhere in the codebase.

### Spec

1. **Per-channel context settings** [NEW]: A JSON object stored in `settings.json` under a new `channel_context` key:

```json
{
  "channel_context": {
    "general": {
      "mode": "full",
      "visible_agents": [],
      "hidden_agents": [],
      "max_history": 0,
      "include_system_messages": true,
      "include_progress_messages": true
    }
  }
}
```

**Modes:**
- `full` -- agent sees all messages (default, current behavior)
- `mentions_only` -- agent only sees messages that @mention it
- `recent` -- agent sees only the last N messages (configured by `max_history`)
- `filtered` -- agent sees messages from `visible_agents` only, or all except `hidden_agents`

2. **MCP `chat_read` respects context filter** [EXTEND `backend/mcp_bridge.py`]:
   - Before returning messages, apply the channel's context mode for the requesting agent.
   - `mentions_only`: filter to messages containing `@agent_name`.
   - `recent`: truncate to last `max_history` messages.
   - `filtered`: include/exclude by sender based on `visible_agents`/`hidden_agents` lists.
   - System and progress messages respect `include_system_messages` and `include_progress_messages` flags.

3. **API** [NEW endpoints in `backend/routes/channels.py`]:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/channels/{name}/context` | Get context settings for channel |
| `PUT` | `/api/channels/{name}/context` | Set context settings for channel |

4. **Frontend: ContextModeSelector** [NEW component]:
   - Dropdown or panel accessible from channel settings.
   - Shows current mode, lets operator switch between Full / Mentions Only / Recent / Filtered.
   - For "filtered" mode: shows multi-select of agents to include/exclude.
   - For "recent" mode: shows numeric input for max messages.

### File Ownership

- `tyson`: `backend/mcp_bridge.py` (extend `chat_read`), `backend/routes/channels.py` (extend with context endpoints)
- `ned`: `ContextModeSelector.tsx` (new), channel settings integration

---

## 3.5 Skills Center UI

### Current State (verified)

- `SkillsRegistry` [EXISTS `backend/skills.py`]: manages built-in skills (28 defined in `BUILTIN_SKILLS`) and custom installed skills. Skills have `id, name, description, category, icon`. Six categories: Development, Research, Creative, System, Data, Communication.
- Per-agent skill assignment: `SkillsRegistry.get_agent_skills(agent_name)` returns enabled skill IDs. Default: all built-in skills enabled. `set_agent_skills`, `enable_skill`, `disable_skill` exist.
- Per-agent skill config: `get_skill_config(agent_name, skill_id)` and `set_skill_config(agent_name, skill_id, config)` exist.
- Skills are keyed by **agent name** (string), not by agent_id or profile_id. This is the Phase 2 gap -- Phase 2 will introduce profile-based assignment. The Skills Center UI must be built to work with the current name-based system but be ready to switch to profile_id after Phase 2 lands.

### Spec

1. **SkillsCenter component** [NEW `frontend/src/components/SkillsCenter.tsx`]:

Structure:
```
SkillsCenter
  +-- CategoryTabs (horizontal tabs for categories)
  +-- SearchBar (filter by name/description)
  +-- SkillGrid
       +-- SkillCard (per skill)
            +-- icon, name, description
            +-- toggle switch (enabled/disabled)
            +-- config button (if skill.configurable)
            +-- scope indicator: "All agents" | "agent-name" | "profile-name"
  +-- ScopeSelector: Global | Per-agent | Per-profile (Phase 2)
```

2. **Enable/disable flow:**
   - **Global toggle**: When in global scope, toggling a skill calls `POST /api/skills/{skill_id}/enable` or `/disable` for all agents. Backend iterates all registered agents and updates.
   - **Per-agent toggle**: When scoped to a specific agent, calls existing `POST /api/agents/{name}/skills` endpoint.
   - **Per-profile toggle**: (Phase 2) Calls `POST /api/profiles/{profile_id}/skills`.

3. **API** [EXTEND existing, verify these endpoints exist or add]:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/skills` | List all available skills with categories |
| `GET` | `/api/skills/categories` | List categories |
| `GET` | `/api/agents/{name}/skills` | Get enabled skills for agent |
| `POST` | `/api/agents/{name}/skills` | Set enabled skills for agent |
| `POST` | `/api/agents/{name}/skills/{skill_id}/config` | Set skill config |

4. **Phase 2 integration point:** After Phase 2 lands `profile_id` on agent identity records, the `ScopeSelector` component activates the "Per-profile" option. The backend resolves skills by `profile_id -> agent_name` chain. Until then, the per-profile toggle is disabled in the UI with a tooltip: "Available after profile system is enabled."

### File Ownership

- `ned`: `SkillsCenter.tsx` (new), `SkillCard.tsx` (new)
- `tyson`: Verify/create missing skill API endpoints in `backend/routes/agents.py`

---

## 3.6 Stop/Cancel Button

### Current State (verified)

- Agent processes are tracked in `deps._agent_processes: dict[str, subprocess.Popen]` [EXISTS `backend/deps.py:72`].
- `TaskQueue.tsx` [EXISTS] has a per-task cancel button that calls `DELETE /api/agents/{name}/tasks/{id}`.
- Agent deregistration kills the process [EXISTS `backend/routes/agents.py` -- kill route sends SIGTERM/SIGKILL to the Popen].
- There is **no "stop current work" button** that interrupts an agent's current activity without killing the entire process.

### Spec

1. **Frontend: StopButton** [NEW -- placed in AgentCockpit and task dashboard]:
   - Red stop icon button.
   - Two modes:
     - **Stop agent work**: Sends cancel signal for the agent's current running task(s).
     - **Kill agent**: Terminates the agent process entirely (existing deregister/kill behavior).
   - The button shows a dropdown on long-press: "Cancel current task" vs "Kill agent process".
   - Default click = cancel current task.

2. **Backend: Cancel endpoint** [NEW in `backend/routes/tasks.py`]:

```
POST /api/tasks/{task_id}/cancel
```

Logic:
1. Set `tasks.status = 'cancelled'` in the database.
2. Write a cancellation signal file: `{DATA_DIR}/agents/{agent_name}/.cancel_{task_id}`.
3. Broadcast `task_update` with status `cancelled`.

3. **How cancellation reaches the agent process:**

For **MCP-based agents** (runner='mcp'): The next time the agent calls any MCP tool (`chat_read`, `chat_progress`, etc.), the bridge checks for a pending cancellation signal for that agent. If found, the tool returns an error message: `"Task {task_id} has been cancelled by the operator. Stop current work and acknowledge."` The signal file is deleted after delivery.

For **tmux-based agents** (runner='tmux'): The wrapper's polling loop [EXISTS `backend/wrapper.py`] checks for `.cancel_*` files in the agent's data directory. When found, it sends a Ctrl+C via `tmux send-keys` to interrupt the agent, then injects a message: `"[SYSTEM] Task {task_id} cancelled by operator."` The signal file is deleted after delivery.

4. **Cancellation is cooperative, not preemptive.** The agent must read the signal. If the agent is stuck (not making MCP calls), the operator can escalate to "Kill agent process." This is clearly communicated in the UI.

### File Ownership

- `tyson`: `backend/routes/tasks.py` (cancel endpoint), `backend/mcp_bridge.py` (cancellation check in tool handlers), `backend/wrapper.py` (cancel signal polling)
- `ned`: StopButton component (new), AgentCockpit integration

---

## 3.7 Enterprise Auditability

### Current State (verified)

- `AuditLog` [EXISTS `backend/security.py:305`]: JSONL-file-based audit log. Each entry: `{ timestamp, type, actor, details }`. Has `log()`, `get_recent(limit, event_type)`, `clear()`. File rotation at 50MB. No search, no structured query, no export, no filtering beyond `event_type`.
- `DataManager` [EXISTS `backend/security.py:366`]: GDPR export/delete. Exports as ZIP. Has basic retention policy (`enabled, max_age_days, delete_attachments, delete_memories`). Retention applies only to messages, not audit events.

The current audit log is a flat file with no indexing, no multi-field search, and no structured export.

### Spec

#### Audit Event Schema

New SQLite table `audit_events` in `ghostlink.db` [NEW]:

```sql
CREATE TABLE IF NOT EXISTS audit_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     TEXT    NOT NULL UNIQUE,        -- uuid hex
    timestamp    REAL    NOT NULL,
    event_type   TEXT    NOT NULL,               -- e.g. 'task.created', 'agent.spawn', 'tool.invoke'
    actor        TEXT    NOT NULL DEFAULT '',     -- who: username, agent_name, or 'system'
    actor_type   TEXT    NOT NULL DEFAULT 'system', -- 'human' | 'agent' | 'system'
    agent_id     TEXT    DEFAULT NULL,            -- Phase 1A identity record FK
    agent_name   TEXT    DEFAULT NULL,
    task_id      TEXT    DEFAULT NULL,            -- FK to tasks.task_id
    trace_id     TEXT    DEFAULT NULL,            -- trace propagation
    channel      TEXT    DEFAULT NULL,
    provider     TEXT    DEFAULT NULL,            -- e.g. 'anthropic', 'openai'
    profile_id   TEXT    DEFAULT NULL,            -- Phase 2 profile FK
    action       TEXT    NOT NULL DEFAULT '',     -- human-readable: "created task", "approved tool call"
    outcome      TEXT    NOT NULL DEFAULT 'ok',   -- 'ok' | 'error' | 'denied' | 'timeout'
    detail       TEXT    NOT NULL DEFAULT '{}',   -- JSON: tool name, input summary, error message, etc.
    cost_usd     REAL    DEFAULT NULL,            -- token cost if applicable
    duration_ms  INTEGER DEFAULT NULL,
    created_at   REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_events(agent_name);
CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_events(task_id);
CREATE INDEX IF NOT EXISTS idx_audit_trace ON audit_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_channel ON audit_events(channel);
```

#### Event Types

| Category | Event Type | Trigger |
|----------|-----------|---------|
| Agent | `agent.register` | Agent registers with server |
| Agent | `agent.deregister` | Agent removed |
| Agent | `agent.spawn` | Agent process started |
| Agent | `agent.kill` | Agent process terminated |
| Agent | `agent.config_change` | thinkingLevel, model, role, etc. changed |
| Agent | `agent.reconnect` | Agent reconnects after disconnect |
| Agent | `agent.failover` | Agent switched to failover model |
| Task | `task.created` | Task created |
| Task | `task.started` | Task status -> running |
| Task | `task.completed` | Task completed |
| Task | `task.failed` | Task failed with error |
| Task | `task.cancelled` | Task cancelled by operator |
| Task | `task.paused` | Task paused |
| Task | `task.resumed` | Task resumed |
| Tool | `tool.invoke` | MCP tool called by agent |
| Tool | `tool.approve` | Tool call approved by operator |
| Tool | `tool.deny` | Tool call denied by operator |
| Tool | `tool.error` | Tool call failed |
| Delegation | `delegation.request` | Agent delegated work to another agent |
| Delegation | `delegation.complete` | Delegated work returned |
| Security | `auth.token_rotate` | Agent token rotated |
| Security | `auth.token_expired` | Token rejected as expired |
| Security | `exec.blocked` | Command blocked by exec policy |
| Security | `exec.approved` | Command approved |
| Data | `data.export` | GDPR data export |
| Data | `data.delete` | GDPR data deletion |
| Operator | `operator.login` | Operator opened the UI |
| Operator | `operator.setting_change` | Global setting changed |

#### AuditStore [NEW `backend/audit_store.py`]

```python
class AuditStore:
    def __init__(self, db: aiosqlite.Connection): ...
    async def init(self): ...

    async def record(self, event_type: str, actor: str, action: str,
                     outcome: str = 'ok', agent_name: str = None,
                     task_id: str = None, trace_id: str = None,
                     channel: str = None, provider: str = None,
                     detail: dict = None, cost_usd: float = None,
                     duration_ms: int = None) -> dict: ...

    async def search(self, *,
                     event_type: str = None,
                     actor: str = None,
                     agent_name: str = None,
                     task_id: str = None,
                     trace_id: str = None,
                     channel: str = None,
                     provider: str = None,
                     outcome: str = None,
                     since: float = None,
                     until: float = None,
                     limit: int = 100,
                     offset: int = 0) -> list[dict]: ...

    async def count(self, **filters) -> int: ...
    async def export_json(self, **filters) -> list[dict]: ...
    async def export_csv(self, **filters) -> str: ...
    async def apply_retention(self, max_age_days: int) -> int: ...  # returns deleted count
```

#### Migration from AuditLog [EXTEND `backend/security.py`]

The existing JSONL-based `AuditLog` class [EXISTS] is kept as a fallback writer during migration. On first startup with the new schema, existing JSONL entries are batch-imported into the SQLite table. After migration, new events write to both (JSONL for compatibility, SQLite for search). In a future release, the JSONL writer is removed.

#### Search/Filter API [NEW in `backend/routes/audit.py`]

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/audit/events` | Search/filter. Query params: `event_type`, `actor`, `agent`, `task_id`, `trace_id`, `channel`, `provider`, `outcome`, `since`, `until`, `limit`, `offset` |
| `GET` | `/api/audit/events/{event_id}` | Get single event |
| `GET` | `/api/audit/export` | Export as JSON or CSV. Query param: `format=json|csv`, plus all filter params |
| `GET` | `/api/audit/stats` | Aggregate counts by event_type, agent, outcome for dashboard |

#### Export Formats

- **JSON**: Array of event objects. Timestamps as ISO 8601 strings (in addition to UNIX float). Detail field preserved as-is.
- **CSV**: Flattened columns: `event_id, timestamp_iso, event_type, actor, actor_type, agent_name, task_id, trace_id, channel, provider, action, outcome, cost_usd, duration_ms, detail_json`. The `detail` field is serialized as a JSON string in the CSV cell.

#### Retention Policy [EXTEND `backend/security.py` DataManager]

The existing `DataManager.get_retention()` / `save_retention()` is extended with audit-specific fields:

```json
{
  "enabled": true,
  "max_age_days": 90,
  "delete_attachments": true,
  "delete_memories": false,
  "audit_max_age_days": 365,
  "audit_enabled": true
}
```

A background task (running on the existing periodic cleanup loop in `app.py`) calls `AuditStore.apply_retention(audit_max_age_days)` daily.

### File Ownership

- `tyson`: `backend/audit_store.py` (new), `backend/routes/audit.py` (new), `backend/security.py` (extend DataManager)
- `ned`: Audit search/filter UI (new), export controls, retention config in SettingsPanel

---

## 3.8 Tracing

### Current State (verified)

- Phase 1A identity records define `trace_id` as a required field on every identity record [from roadmap].
- `deps._mcp_invocation_logs` [EXISTS `backend/deps.py:200`]: per-agent MCP invocation logs, capped at 200 entries per agent. Each entry: `{ timestamp, duration_ms, prompt, session_id, agent, status, result_type, result_text, cost_usd, num_turns, usage, error }`.
- `AgentReplayEvent` [EXISTS `frontend/src/types/index.ts:218`]: `{ id, agent, type, title, detail, surface, path, url, query, command, tool, metadata, timestamp }`.
- `deps._agent_replay_log` [EXISTS `backend/deps.py:204`]: in-memory deque of 2000 replay events.
- There is no persistent trace store, no trace ID propagation, and no trace-to-task linkage.

### Spec

#### Trace Event Types

```
trace.task_start          -- task execution begins
trace.task_complete       -- task execution ends
trace.tool_call           -- agent invokes an MCP tool
trace.tool_result         -- tool returns result
trace.delegation_send     -- agent delegates to another agent
trace.delegation_return   -- delegated work returns
trace.approval_request    -- agent requests human approval
trace.approval_response   -- human approves/denies
trace.reconnect           -- agent reconnects after disconnect
trace.failover            -- agent fails over to backup model
trace.checkpoint_created  -- checkpoint saved (Phase 3.5)
trace.error               -- error during execution
```

#### Trace Event Table [NEW in `ghostlink.db`]

```sql
CREATE TABLE IF NOT EXISTS trace_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     TEXT    NOT NULL UNIQUE,
    trace_id     TEXT    NOT NULL,                -- groups all events in one execution chain
    span_id      TEXT    NOT NULL,                -- unique per event, for parent-child linking
    parent_span  TEXT    DEFAULT NULL,             -- parent span_id (for nested calls)
    task_id      TEXT    DEFAULT NULL,             -- FK to tasks.task_id
    checkpoint_id TEXT   DEFAULT NULL,             -- FK to checkpoints.checkpoint_id (Phase 3.5)
    agent_name   TEXT    NOT NULL,
    event_type   TEXT    NOT NULL,
    timestamp    REAL    NOT NULL,
    duration_ms  INTEGER DEFAULT NULL,
    detail       TEXT    NOT NULL DEFAULT '{}',    -- JSON: tool name, args summary, result summary
    status       TEXT    NOT NULL DEFAULT 'ok',    -- 'ok' | 'error' | 'timeout'
    metadata     TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_trace_trace_id ON trace_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_trace_task_id ON trace_events(task_id);
CREATE INDEX IF NOT EXISTS idx_trace_agent ON trace_events(agent_name);
CREATE INDEX IF NOT EXISTS idx_trace_type ON trace_events(event_type);
CREATE INDEX IF NOT EXISTS idx_trace_ts ON trace_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_trace_parent ON trace_events(parent_span);
```

#### Trace ID Propagation

- When a task is created, a `trace_id` is generated (or inherited from a parent task).
- Every MCP tool call within that task's context carries the `trace_id`.
- When delegation occurs (agent A delegates to agent B), the `trace_id` is propagated. The delegation creates a new `span_id` with `parent_span` pointing to agent A's current span.
- The MCP bridge [EXTEND `backend/mcp_bridge.py`] records a trace event for every tool invocation, using the requesting agent's current `trace_id` and `task_id`.

#### API [NEW in `backend/routes/traces.py`]

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/traces` | List traces. Query params: `task_id`, `agent`, `event_type`, `since`, `until`, `limit` |
| `GET` | `/api/traces/{trace_id}` | Get all events for a trace, ordered by timestamp |
| `GET` | `/api/traces/{trace_id}/tree` | Get trace events as a tree (parent-child spans) |

#### Trace Visualization [NEW frontend]

- **Trace Timeline**: Horizontal timeline showing events as colored dots/bars. Tool calls, delegations, approvals, and errors are visually distinct.
- **Trace Tree**: Expandable tree view showing parent-child span relationships. Each node shows: agent, event type, duration, status.
- **Integration**: Accessible from the task detail view. Click a task in the dashboard, see its trace timeline.

### File Ownership

- `tyson`: `backend/trace_store.py` (new), `backend/routes/traces.py` (new), `backend/mcp_bridge.py` (extend for trace recording)
- `ned`: Trace timeline and tree components (new)

---

## 3.9 Phase 3 Acceptance Tests, Regression Risks, and Rollback Plan

### Acceptance Tests

| # | Test | Pass Criteria |
|---|------|---------------|
| T3-01 | Create task via API | Task appears in `tasks` table with correct fields |
| T3-02 | Create job via existing JobsPanel | Corresponding task row created with `source_type='job'` |
| T3-03 | Agent emits progress via MCP `chat_progress` with `task_id` | Task progress columns updated, `task_progress` WS event broadcast |
| T3-04 | Change thinking level via picker | `POST /api/agents/{name}/config` succeeds, status WS broadcast includes new level |
| T3-05 | Set channel context to `mentions_only` | Agent's `chat_read` returns only messages containing `@agent_name` |
| T3-06 | Toggle skill off for agent in Skills Center | `GET /api/agents/{name}/skills` no longer includes that skill ID |
| T3-07 | Cancel a running task | Task status changes to `cancelled`, agent receives cancellation signal on next MCP call |
| T3-08 | Kill agent process via Stop button escalation | Agent process terminated, deregistered from registry |
| T3-09 | Record audit event on task creation | `audit_events` table contains `task.created` event with correct actor and task_id |
| T3-10 | Search audit by agent + time range | `GET /api/audit/events?agent=claude&since=...&until=...` returns correct filtered set |
| T3-11 | Export audit as CSV | Downloaded CSV contains all matching events with correct column structure |
| T3-12 | Record trace event on tool call | `trace_events` table contains `trace.tool_call` with correct trace_id and task_id |
| T3-13 | Delegation propagates trace_id | Agent B's trace events share the same trace_id as Agent A's delegation event |
| T3-14 | Trace tree endpoint returns correct parent-child structure | Nested tool calls within a delegation show correct span hierarchy |
| T3-15 | Retention policy deletes old audit events | After applying retention, events older than `audit_max_age_days` are deleted |

### Regression Risks

| Risk | Mitigation |
|------|------------|
| JobsPanel breaks from dual-write to jobs + tasks | Keep JobStore unchanged; task creation is additive. JobsPanel reads from jobs table only. |
| `chat_progress` backwards incompatibility | `task_id` parameter is optional, defaults to `""`. All existing calls continue to work. |
| Audit event volume causes DB bloat | Retention policy runs daily. Default 365-day retention. Index on timestamp for efficient deletion. |
| Trace event volume from high-frequency tool calls | Trace events use batch insert. Configurable sampling rate for high-volume agents. Default: record all. |
| Context filtering breaks agent functionality | Default mode is `full` (current behavior). Operator must explicitly change to a restrictive mode. |
| Cancel signal not delivered if agent is not making MCP calls | UI clearly states cancellation is cooperative. Escalation to kill is one click away. |

### Rollback Plan

1. **Schema**: All new tables (`tasks`, `audit_events`, `trace_events`) are additive. Dropping them does not affect existing `jobs` or `messages` tables. Rollback: `DROP TABLE IF EXISTS tasks; DROP TABLE IF EXISTS audit_events; DROP TABLE IF EXISTS trace_events;`
2. **Code**: All changes to existing files are additive (new optional parameters, new code paths guarded by feature flags or `None` checks). Reverting the commits restores prior behavior.
3. **Settings**: New `channel_context` key in settings is ignored by older code. Removing it has no effect.
4. **Feature flag**: Add `ENABLE_UNIFIED_TASKS=1` environment variable. When `0`, TaskStore is not initialized, and all new endpoints return `501 Not Implemented`. This allows shipping the code without activating it.

---

# Phase 3.5 -- Durable Execution and Replay

## 3.5.1 Checkpoint Store

### Current State (verified)

- `CheckpointPanel.tsx` [EXISTS `frontend/src/components/CheckpointPanel.tsx`]: UI for saving/restoring **workspace snapshots**. Interface: `{ id, agent, label, timestamp, file_count, size_bytes, workspace }`. Calls `GET/POST /api/agents/{name}/checkpoints`, `POST .../restore`, `DELETE`. This is a **file-level workspace snapshot**, not a task execution checkpoint.
- There is **no task-level checkpoint system** anywhere in the codebase. No execution state is persisted between agent restarts.
- The existing `CheckpointPanel` is about git/file snapshots. The Phase 3.5 checkpoint is about **task execution state**.

### Checkpoint Schema

New SQLite table `checkpoints` in `ghostlink.db` [NEW]:

```sql
CREATE TABLE IF NOT EXISTS checkpoints (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    checkpoint_id   TEXT    NOT NULL UNIQUE,        -- uuid hex
    task_id         TEXT    NOT NULL,               -- FK to tasks.task_id
    agent_id        TEXT    DEFAULT NULL,            -- Phase 1A identity record FK
    agent_name      TEXT    NOT NULL,
    session_id      TEXT    DEFAULT NULL,            -- Phase 1A session_id
    trace_id        TEXT    DEFAULT NULL,
    sequence_num    INTEGER NOT NULL DEFAULT 0,      -- monotonic within a task
    trigger         TEXT    NOT NULL,                -- what caused this checkpoint (see below)
    state_snapshot  TEXT    NOT NULL DEFAULT '{}',   -- JSON: serialized execution state
    pending_actions TEXT    NOT NULL DEFAULT '[]',   -- JSON: actions that were in-flight
    worktree_ref    TEXT    DEFAULT NULL,            -- git ref or worktree path snapshot
    artifact_refs   TEXT    NOT NULL DEFAULT '[]',   -- JSON: array of artifact_ids produced so far
    context_window  TEXT    NOT NULL DEFAULT '{}',   -- JSON: summary of agent's context at checkpoint time
    metadata        TEXT    NOT NULL DEFAULT '{}',
    size_bytes      INTEGER NOT NULL DEFAULT 0,      -- approximate size of state_snapshot
    created_at      REAL    NOT NULL,
    expires_at      REAL    DEFAULT NULL             -- for retention/compaction
);
CREATE INDEX IF NOT EXISTS idx_cp_task ON checkpoints(task_id);
CREATE INDEX IF NOT EXISTS idx_cp_agent ON checkpoints(agent_name);
CREATE INDEX IF NOT EXISTS idx_cp_trace ON checkpoints(trace_id);
CREATE INDEX IF NOT EXISTS idx_cp_seq ON checkpoints(task_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_cp_created ON checkpoints(created_at);
```

### Checkpoint Triggers

| Trigger | When | Priority |
|---------|------|----------|
| `task_start` | Task transitions to `running` | Always |
| `pre_tool` | Before an MCP tool that modifies state (in `_WRITE_TOOLS`) | Configurable |
| `post_tool` | After a write-tool completes successfully | Always |
| `pre_delegation` | Before delegating to another agent | Always |
| `post_delegation` | After delegated work returns | Always |
| `approval_wait` | When task enters `awaiting_approval` | Always |
| `periodic` | Every N tool calls (configurable, default 10) | Configurable |
| `completion` | Task completes or fails | Always |
| `manual` | Operator triggers via UI | On demand |

`pre_tool` checkpoints are configurable because they can be expensive for high-frequency tool calls. Default: enabled for write tools only.

### State Snapshot Content

The `state_snapshot` JSON captures:

```json
{
  "task": {
    "task_id": "...",
    "status": "running",
    "progress_pct": 45,
    "progress_step": "Testing",
    "progress_data": { ... }
  },
  "agent_identity": {
    "agent_id": "...",
    "agent_name": "claude",
    "session_id": "...",
    "profile_id": "...",
    "capabilities": [ ... ]
  },
  "execution_context": {
    "channel": "general",
    "last_message_id": 1234,
    "read_cursor": { "general": 1234 },
    "active_tools": [],
    "pending_approvals": []
  },
  "plan_state": {
    "plan_id": "...",
    "current_subtask_index": 2,
    "completed_subtasks": ["abc", "def"],
    "subtask_results": { ... }
  },
  "artifact_log": [
    { "artifact_id": "...", "path": "src/auth.py", "action": "write" }
  ]
}
```

### Checkpoint Retention/Compaction Strategy

1. **Compaction**: After a task completes, only retain the `task_start`, `completion`, and every Nth intermediate checkpoint (configurable, default N=5). Delete the rest. This runs as a background task after task completion.
2. **Retention**: Checkpoints older than `checkpoint_max_age_days` (default 30) are deleted. Configurable in retention policy.
3. **Size guard**: If a single checkpoint's `state_snapshot` exceeds 1MB, log a warning and truncate the `context_window` (which is the largest field, containing conversation summary). The core execution state must always fit.

### Backend: CheckpointStore [NEW `backend/checkpoints.py`]

```python
class CheckpointStore:
    def __init__(self, db: aiosqlite.Connection): ...
    async def init(self): ...

    async def create(self, task_id: str, agent_name: str, trigger: str,
                     state_snapshot: dict, pending_actions: list = None,
                     worktree_ref: str = None, artifact_refs: list = None,
                     session_id: str = None, trace_id: str = None,
                     metadata: dict = None) -> dict: ...

    async def get(self, checkpoint_id: str) -> dict | None: ...
    async def get_latest(self, task_id: str) -> dict | None: ...
    async def list_for_task(self, task_id: str) -> list[dict]: ...
    async def list_for_agent(self, agent_name: str, limit: int = 50) -> list[dict]: ...
    async def delete(self, checkpoint_id: str) -> bool: ...
    async def compact(self, task_id: str, keep_every_n: int = 5) -> int: ...  # returns deleted count
    async def apply_retention(self, max_age_days: int) -> int: ...
```

### API [NEW in `backend/routes/checkpoints.py`]

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks/{task_id}/checkpoints` | List checkpoints for a task |
| `GET` | `/api/checkpoints/{checkpoint_id}` | Get single checkpoint |
| `POST` | `/api/tasks/{task_id}/checkpoints` | Manually create a checkpoint |
| `DELETE` | `/api/checkpoints/{checkpoint_id}` | Delete a checkpoint |
| `POST` | `/api/tasks/{task_id}/checkpoints/compact` | Trigger compaction |

### File Ownership

- `tyson`: `backend/checkpoints.py` (new), `backend/routes/checkpoints.py` (new)
- `ned`: Checkpoint timeline UI (new -- see Section 3.5.4)

---

## 3.5.2 Resume After Interruption

### Crash Detection

The server already tracks agent heartbeats [EXISTS `backend/app.py:695`]. The periodic loop marks agents as offline when `elapsed > HEARTBEAT_STALE_THRESHOLD (45s)`.

**Extended crash detection for tasks** [NEW]:

1. When an agent is marked offline (heartbeat gap), check for any tasks in `running` or `paused` status assigned to that agent.
2. For each such task:
   - If the task has been running for less than 60 seconds, allow a grace period (agent may be restarting).
   - If the task has been running for more than 60 seconds with no checkpoint in the last 60 seconds: mark as `interrupted` (new status, or set a metadata flag).
3. Emit audit event: `task.interrupted`.

### Resume Flow

When an agent reconnects (heartbeat resumes or re-registration):

1. **Discover interrupted tasks**: Query `tasks` for `agent_name = reconnected_agent AND status IN ('running', 'interrupted')`.
2. **Load latest checkpoint**: For each interrupted task, load the most recent checkpoint from `checkpoints` table.
3. **Restore identity**: The Phase 1B reinjection system handles identity restoration on reconnect. The checkpoint's `agent_identity` snapshot provides the expected state for verification.
4. **Restore task state**: The checkpoint's `state_snapshot.execution_context` contains the read cursor, channel, and active state. The `plan_state` contains the autonomous plan position.
5. **Resume**: Set task status back to `running`. Inject a system message into the agent's channel: `"[SYSTEM] Resuming task '{title}' from checkpoint {sequence_num}. Last completed step: {progress_step}."` The agent reads this via `chat_read` and continues.

### Pending Tool Calls During Crash

The checkpoint's `pending_actions` field captures tool calls that were initiated but not completed before the crash.

- **Read-only tools** (chat_read, chat_who, chat_channels): Safe to re-execute. No special handling.
- **Write tools** (code_execute, file writes): These are in the `_WRITE_TOOLS` set [EXISTS `backend/mcp_bridge.py:127`]. Pending write tool calls are flagged for confirmation on resume. The resume message includes: `"Pending actions from before interruption: [{tool_name}]. Confirm before re-executing write operations."`
- **External side-effects** (API calls, git pushes): Listed in pending_actions with their parameters. The agent must decide whether to retry based on context.

### File Ownership

- `tyson`: Resume logic in `backend/app.py` (extend heartbeat loop), `backend/checkpoints.py` (resume helper methods)
- `ned`: Resume notification in chat UI (system message display)

---

## 3.5.3 Replay

### Replay Mode

Replay re-executes a task's recorded trace from a specific checkpoint, allowing the operator to see what happened and verify outcomes.

1. **Read-only simulation** (default):
   - Loads the checkpoint's state_snapshot.
   - Walks through `trace_events` for the task from the checkpoint's timestamp forward.
   - Displays each event in the trace timeline UI without executing anything.
   - All events in the replay are marked with `{ replay: true, replay_source_task_id, replay_source_checkpoint_id }`.

2. **Live replay** (operator opt-in):
   - Creates a new task with `source_type='fork'` (functionally a fork of the original).
   - Restores the checkpoint state.
   - Executes the task from the checkpoint forward, allowing divergent outcomes.
   - All trace events carry `{ replay: true, replay_mode: 'live' }`.

### Provenance Preservation

Every replayed event links back to:
- `source_task_id`: The original task being replayed.
- `source_checkpoint_id`: The checkpoint from which replay started.
- `replay_timestamp`: The original event's timestamp.

This is stored in the trace event's `metadata` field.

### API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tasks/{task_id}/replay` | Start replay. Body: `{ checkpoint_id, mode: 'readonly' | 'live' }` |
| `GET` | `/api/tasks/{task_id}/replay/status` | Get replay state |
| `POST` | `/api/tasks/{task_id}/replay/stop` | Stop an active live replay |

### File Ownership

- `tyson`: Replay engine in `backend/checkpoints.py` (extend), `backend/routes/checkpoints.py` (replay endpoints)
- `ned`: Replay controls and display (new)

---

## 3.5.4 Fork

### Fork Model

Fork creates a new task that starts from an existing checkpoint, with its own independent execution path.

```
Original Task: ──[CP1]──[CP2]──[CP3]──[CP4]──> completed
                              |
                              +── Fork ──[CP3']──[CP4']──> (new task)
```

1. **New task creation**: `POST /api/tasks/{task_id}/fork` with `{ checkpoint_id }`.
   - Creates a new task row: `source_type='fork'`, `parent_task_id=original_task_id`, `source_ref=checkpoint_id`.
   - Generates a new `task_id` and `trace_id`.
   - Copies `state_snapshot` from the source checkpoint into a new `task_start` checkpoint for the forked task.

2. **Inherited context (selective)**:
   - Inherited: task title (prefixed with "Fork: "), description, channel, agent assignment, plan_state (subtask list and completed steps).
   - Inherited: artifact_refs from the source checkpoint (read-only reference, not copies).
   - **NOT inherited**: trace events, audit events, messages sent after the checkpoint, pending_actions.
   - The forked task starts clean from the checkpoint state. It does not replay the original execution.

3. **Independence**: The forked task is fully independent. Changes to the forked task do not affect the original. The original task is unaffected by the fork.

### API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tasks/{task_id}/fork` | Fork from checkpoint. Body: `{ checkpoint_id }` |

### Frontend: Fork UI

- In the checkpoint timeline view, each checkpoint has a "Fork" button.
- Clicking it opens a confirmation dialog showing: source task, checkpoint sequence number, state summary.
- After confirmation, the new forked task appears in the task dashboard.

### File Ownership

- `tyson`: Fork logic in `backend/checkpoints.py`, `backend/routes/checkpoints.py`
- `ned`: Fork button and confirmation dialog

---

## 3.5.5 Pause/Resume Primitive

### Current State (verified)

- `SessionManager` [EXISTS `backend/sessions.py`] has `pause_session()` / `resume_session()` for structured sessions. These set `session.status` to `"paused"` / `"active"`. This is session-level, not task-level.
- `AutonomousPlan` [EXISTS `backend/autonomous.py`] has a `"paused"` status. But pause is just a status field -- there is no mechanism to signal the agent to stop.
- The `TaskQueue.tsx` [EXISTS] shows paused tasks but has no pause button.

### Pause States

| State | Meaning | How Entered |
|-------|---------|-------------|
| `paused` | Operator manually paused | Operator clicks pause button |
| `awaiting_input` | Agent needs human input to continue | Agent calls `chat_propose_job` or similar |
| `awaiting_approval` | Agent needs human approval for a tool call | Approval gate in exec policy |
| `awaiting_external` | Waiting for an external event (timer, webhook, CI) | Agent registers a wait condition |

### Pause Mechanism

1. **Operator-initiated pause**: `POST /api/tasks/{task_id}/pause`
   - Sets `tasks.status = 'paused'`.
   - Writes pause signal file: `{DATA_DIR}/agents/{agent_name}/.pause_{task_id}`.
   - Creates a checkpoint with trigger `manual` before pausing.
   - Broadcasts `task_update` with status `paused`.

2. **Agent reads pause signal**: Same mechanism as cancel signal (Section 3.6). On next MCP tool call, the bridge checks for `.pause_*` files. If found, returns: `"Task {task_id} has been paused by the operator. Wait for resume signal. Do not continue work on this task."` For tmux agents, the wrapper injects a pause message.

3. **Resume triggers**:

| Trigger | How It Works |
|---------|--------------|
| Human input | Operator sends a message in the channel with `/resume` or clicks Resume button. Backend: `POST /api/tasks/{task_id}/resume`. |
| Approval | Operator approves pending approval. Backend detects the `awaiting_approval` task and transitions to `running`. |
| Timer | Agent registered a wait with `wait_until` timestamp. Background loop checks and resumes when time is reached. |
| External event | Webhook or bridge event matches a registered wait condition. Backend transitions task to `running`. |

4. **Resume endpoint**: `POST /api/tasks/{task_id}/resume`
   - Validates task is in a paused state (`paused`, `awaiting_input`, `awaiting_approval`, `awaiting_external`).
   - Sets status to `running`.
   - Removes pause signal file.
   - Injects system message: `"[SYSTEM] Task '{title}' resumed."`.
   - Broadcasts `task_update`.

### File Ownership

- `tyson`: `backend/routes/tasks.py` (pause/resume endpoints), signal file logic, background resume timer
- `ned`: Pause/Resume buttons in task dashboard and AgentCockpit

---

## 3.5.6 Side-Effect Boundary Model

### Classification

Every MCP tool is classified into one of three categories for replay safety:

| Category | Meaning | Examples |
|----------|---------|---------|
| `replay_safe` | Deterministic, no external side effects. Safe to re-execute during replay. | `chat_read`, `chat_who`, `chat_channels`, `chat_rules` |
| `replay_blocked` | Has external side effects that MUST NOT be duplicated. Skipped during replay. | `code_execute` (shell commands), `git push`, API calls to external services |
| `replay_requires_confirmation` | Has side effects but may be safe to re-execute if the operator confirms. | `chat_send` (message posting), `chat_progress` (progress update), file writes to workspace |

### Tool Adapter Idempotency Declaration

Each MCP tool registration [in `backend/mcp_bridge.py`] gains a metadata annotation:

```python
@mcp.tool()
def chat_read(...):
    """..."""
    ...

# New: tool metadata registry
TOOL_REPLAY_CLASSIFICATION = {
    "chat_read":         "replay_safe",
    "chat_send":         "replay_requires_confirmation",
    "chat_progress":     "replay_safe",          # progress updates are idempotent
    "chat_propose_job":  "replay_requires_confirmation",
    "chat_react":        "replay_safe",           # reactions are idempotent (toggle)
    "code_execute":      "replay_blocked",
    "gemini_image":      "replay_blocked",
    "thinking_set":      "replay_safe",
    "chat_join":         "replay_safe",
    "chat_who":          "replay_safe",
    "chat_channels":     "replay_safe",
    "chat_rules":        "replay_safe",
    "chat_claim":        "replay_safe",
    # ... all other tools classified
}
```

Tools not in the registry default to `replay_blocked` (fail-closed).

### Enforcement During Replay

When replay mode is active:

1. **`replay_safe` tools**: Executed normally. Results recorded in the replay trace.
2. **`replay_blocked` tools**: NOT executed. The trace event from the original execution is displayed instead. The replay trace records: `{ "replay_action": "skipped", "original_result": "..." }`.
3. **`replay_requires_confirmation` tools**: In read-only replay, treated as `replay_blocked`. In live replay, the operator is prompted: "This tool has side effects. Execute? [Yes / Skip / Cancel replay]".

### File Ownership

- `tyson`: Tool classification registry in `backend/mcp_bridge.py`, replay enforcement in checkpoint engine
- `jeff`: Classification decisions for each tool

---

## 3.5.7 Artifact Lineage Graph

### Current State (verified)

- `deps._workspace_changes` [EXISTS `backend/deps.py:203`]: in-memory deque of 500 workspace change events: `{ agent, action, path, timestamp }`.
- `deps._file_diff_cache` [EXISTS `backend/deps.py:205`]: per-agent file diff cache, up to 100 diffs per agent.
- `FileDiffPayload` [EXISTS `frontend/src/types/index.ts:234`]: `{ agent, path, action, before, after, diff, timestamp }`.
- There is no persistent artifact tracking, no lineage graph, and no task-to-artifact linkage.

### Artifact Record Schema

New SQLite table `artifacts` in `ghostlink.db` [NEW]:

```sql
CREATE TABLE IF NOT EXISTS artifacts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id         TEXT    NOT NULL UNIQUE,       -- uuid hex
    task_id             TEXT    DEFAULT NULL,           -- FK to tasks.task_id
    checkpoint_id       TEXT    DEFAULT NULL,           -- FK to checkpoints.checkpoint_id
    trace_id            TEXT    DEFAULT NULL,
    agent_name          TEXT    NOT NULL,
    tool_id             TEXT    DEFAULT NULL,           -- which MCP tool produced this
    type                TEXT    NOT NULL,               -- 'file_write' | 'file_delete' | 'git_commit' | 'api_response' | 'message' | 'image' | 'other'
    path                TEXT    DEFAULT NULL,           -- file path (for file artifacts)
    description         TEXT    NOT NULL DEFAULT '',
    content_hash        TEXT    DEFAULT NULL,           -- SHA-256 of content (for dedup)
    size_bytes          INTEGER DEFAULT NULL,
    parent_artifact_id  TEXT    DEFAULT NULL,           -- previous version of this artifact
    superseded_by       TEXT    DEFAULT NULL,           -- artifact_id that replaced this one
    metadata            TEXT    NOT NULL DEFAULT '{}',  -- JSON: git sha, API response summary, etc.
    created_at          REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifact_task ON artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_artifact_agent ON artifacts(agent_name);
CREATE INDEX IF NOT EXISTS idx_artifact_path ON artifacts(path);
CREATE INDEX IF NOT EXISTS idx_artifact_parent ON artifacts(parent_artifact_id);
CREATE INDEX IF NOT EXISTS idx_artifact_checkpoint ON artifacts(checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_artifact_type ON artifacts(type);
```

### How Artifacts Are Tracked

1. **File writes**: When the workspace change system [EXISTS] detects a file write by an agent, create an artifact record. The `content_hash` is computed from the file content. If a previous artifact exists for the same `(agent_name, path)`, set `parent_artifact_id` and update the parent's `superseded_by`.

2. **Git commits**: When a `git commit` is detected (via the shell execution tool or wrapper git monitoring), create an artifact with `type='git_commit'`, the commit SHA in `metadata.sha`, and the list of changed files as nested artifact references.

3. **API call results**: When a tool that makes external API calls completes, the response summary is stored as an artifact with `type='api_response'`.

4. **Images/media**: Generated images (via `gemini_image` or similar tools) are tracked with `type='image'` and the output path.

### Supersession Tracking

When an artifact is created for a path that already has an artifact:
1. Find the most recent artifact with the same `(agent_name, path)` that is not superseded.
2. Set `new_artifact.parent_artifact_id = found.artifact_id`.
3. Set `found.superseded_by = new_artifact.artifact_id`.

This creates a linked list of versions for each file, enabling "show me the history of this file across this task."

### API [NEW in `backend/routes/artifacts.py`]

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks/{task_id}/artifacts` | List artifacts for a task |
| `GET` | `/api/artifacts/{artifact_id}` | Get single artifact |
| `GET` | `/api/artifacts/{artifact_id}/history` | Get version chain (follow parent_artifact_id) |
| `GET` | `/api/artifacts/by-path` | Query params: `path`, `agent`, `task_id` |

### Frontend: Artifact Lineage Visualization

- **Artifact list in task detail**: Shows all artifacts produced by a task, grouped by type.
- **Lineage graph**: For file artifacts, show a vertical chain of versions with diffs between consecutive versions.
- **Checkpoint linkage**: Each artifact shows which checkpoint it was produced at, clickable to jump to the checkpoint timeline.

### File Ownership

- `tyson`: `backend/artifact_store.py` (new), `backend/routes/artifacts.py` (new), integration with workspace change tracking
- `ned`: Artifact list and lineage visualization components (new)

---

## 3.5.8 Phase 3.5 Acceptance Tests, Regression Risks, and Rollback Plan

### Acceptance Tests

| # | Test | Pass Criteria |
|---|------|---------------|
| T35-01 | Task creates checkpoints at defined triggers | `task_start` and `completion` checkpoints always present. `pre_tool` checkpoint present for write tools. |
| T35-02 | Checkpoint state_snapshot contains required fields | JSON contains `task`, `agent_identity`, `execution_context` sections. |
| T35-03 | Resume after simulated crash | Kill agent process. On reconnect, task resumes from last checkpoint. System message injected. |
| T35-04 | Pending write tool flagged on resume | Resume message includes pending action names. Agent acknowledges before retrying. |
| T35-05 | Read-only replay displays trace events | Replay shows original events without executing tools. |
| T35-06 | Live replay executes from checkpoint | New task created, execution diverges from original. All events marked `replay: true`. |
| T35-07 | Fork creates independent task | Forked task has new task_id, shares no state mutations with original. |
| T35-08 | Fork inherits correct state from checkpoint | Forked task's initial state matches the source checkpoint's state_snapshot. |
| T35-09 | Pause stops agent work | Agent receives pause signal on next MCP call. Task status = paused. |
| T35-10 | Resume after pause restores execution | Task status -> running. Agent receives resume message. No state loss. |
| T35-11 | Replay-blocked tools are not executed in replay | `code_execute` tool is skipped during read-only replay. Original result displayed. |
| T35-12 | Replay-safe tools execute normally in replay | `chat_read` executes during replay and returns current data. |
| T35-13 | Artifact created on file write | File write by agent creates artifact record with correct path and content_hash. |
| T35-14 | Artifact supersession chain | Second write to same file creates new artifact with parent_artifact_id pointing to first. |
| T35-15 | Checkpoint compaction retains correct checkpoints | After compaction with N=5, only every 5th intermediate checkpoint remains plus start/completion. |
| T35-16 | Checkpoint retention deletes old data | Checkpoints older than max_age_days are deleted. |

### Regression Risks

| Risk | Mitigation |
|------|------------|
| Checkpoint creation adds latency to tool calls | Checkpoint creation is async fire-and-forget for `pre_tool` triggers. `post_tool` can be deferred. Checkpoint writes use the same WAL-mode SQLite with busy_timeout. |
| State snapshot size grows unbounded | Size guard at 1MB per checkpoint. Context window truncated first. Warning logged. |
| Resume logic conflicts with existing heartbeat/reconnect flow | Resume is additive -- only activates if there are interrupted tasks. Does not change existing heartbeat/offline detection. |
| Fork creates confusing duplicate tasks | Forked tasks are clearly labeled "Fork: {original title}" and linked to the source via parent_task_id. UI shows fork provenance. |
| Replay-blocked classification is too aggressive | Default is fail-closed (blocked). Operators can override per-tool in a future config surface. Initial release uses hardcoded classification. |
| Artifact tracking adds overhead to every file write | Artifact creation is async. Content hashing uses streaming SHA-256. Only files in the workspace are tracked (exclude node_modules, .venv, etc. via ignore patterns). |
| Existing `CheckpointPanel.tsx` name collision | The existing component is for workspace/file snapshots and is NOT renamed. The new task-level checkpoint UI is a separate component: `TaskCheckpointTimeline.tsx`. |

### Rollback Plan

1. **Schema**: All new tables (`checkpoints`, `artifacts`, `trace_events`) are additive. `DROP TABLE IF EXISTS checkpoints; DROP TABLE IF EXISTS artifacts;` has no effect on existing functionality.
2. **Code**: All checkpoint creation calls are guarded by `if checkpoint_store:` checks. Setting `checkpoint_store = None` in deps disables the entire system.
3. **Feature flag**: `ENABLE_DURABLE_EXECUTION=1` environment variable. When `0`, CheckpointStore and ArtifactStore are not initialized. Resume/replay/fork endpoints return `501`.
4. **Performance escape hatch**: `CHECKPOINT_FREQUENCY=0` disables automatic checkpoint creation (only manual checkpoints via API). This eliminates any tool-call latency overhead.

---

## New Files Summary

### Backend (tyson)

| File | Type | Description |
|------|------|-------------|
| `backend/task_store.py` | NEW | Unified TaskStore class |
| `backend/routes/tasks.py` | NEW | Task CRUD, progress, cancel, pause/resume, replay, fork endpoints |
| `backend/audit_store.py` | NEW | SQLite-backed audit event store with search/export |
| `backend/routes/audit.py` | NEW | Audit search, filter, export, stats endpoints |
| `backend/trace_store.py` | NEW | Trace event store |
| `backend/routes/traces.py` | NEW | Trace query endpoints |
| `backend/checkpoints.py` | NEW | CheckpointStore with create/resume/replay/fork/compact |
| `backend/routes/checkpoints.py` | NEW | Checkpoint CRUD and management endpoints |
| `backend/artifact_store.py` | NEW | Artifact record store with lineage tracking |
| `backend/routes/artifacts.py` | NEW | Artifact query endpoints |

### Backend (tyson) -- Modified

| File | Change |
|------|--------|
| `backend/jobs.py` | Add task creation on job create |
| `backend/autonomous.py` | Add task creation on plan/subtask create |
| `backend/mcp_bridge.py` | Extend `chat_progress` with task_id, add trace recording, add cancel/pause signal checks, add tool replay classification |
| `backend/security.py` | Extend DataManager retention with audit fields |
| `backend/deps.py` | Add task_store, audit_store, trace_store, checkpoint_store, artifact_store globals |
| `backend/app.py` | Initialize new stores in lifespan, extend heartbeat loop with crash detection and resume |
| `backend/routes/channels.py` | Add context settings endpoints |
| `backend/wrapper.py` | Add cancel/pause signal file polling |

### Frontend (ned)

| File | Type | Description |
|------|------|-------------|
| `frontend/src/components/ThinkingLevelPicker.tsx` | NEW | Thinking level dropdown |
| `frontend/src/components/ContextModeSelector.tsx` | NEW | Channel context visibility controls |
| `frontend/src/components/SkillsCenter.tsx` | NEW | Skills browsing, search, enable/disable |
| `frontend/src/components/SkillCard.tsx` | NEW | Individual skill card component |
| `frontend/src/components/StopButton.tsx` | NEW | Stop/cancel agent work button |
| `frontend/src/components/AuditPanel.tsx` | NEW | Audit search, filter, export UI |
| `frontend/src/components/TraceTimeline.tsx` | NEW | Trace event timeline visualization |
| `frontend/src/components/TraceTree.tsx` | NEW | Trace span tree visualization |
| `frontend/src/components/TaskDashboard.tsx` | NEW | Unified task list with progress |
| `frontend/src/components/TaskCheckpointTimeline.tsx` | NEW | Task-level checkpoint timeline |
| `frontend/src/components/ArtifactLineage.tsx` | NEW | Artifact version chain visualization |
| `frontend/src/components/ReplayControls.tsx` | NEW | Replay mode controls |
| `frontend/src/components/ForkDialog.tsx` | NEW | Fork confirmation dialog |

### Frontend (ned) -- Modified

| File | Change |
|------|--------|
| `frontend/src/types/index.ts` | Add Task, Checkpoint, TraceEvent, Artifact, AuditEvent interfaces |
| `frontend/src/components/AgentCockpit.tsx` | Integrate ThinkingLevelPicker, StopButton, checkpoint timeline |
| `frontend/src/components/JobsPanel.tsx` | Wire to unified task model (optional, existing behavior preserved) |

---

## Dependency Chain

```
Phase 1A (identity records)
    |
    v
Phase 1B (runtime isolation)
    |
    v
Phase 2 (profiles, rules, knowledge layering)
    |
    v
Phase 3 (operator control plane) -- this spec
    |   3.1 Unified Task Model
    |   3.2 Structured Progress Events (depends on 3.1)
    |   3.3 Thinking Level UI (independent)
    |   3.4 Context Visibility Controls (independent)
    |   3.5 Skills Center UI (depends on Phase 2 profiles)
    |   3.6 Stop/Cancel Button (depends on 3.1)
    |   3.7 Enterprise Auditability (depends on 3.1 for task_id FK)
    |   3.8 Tracing (depends on 3.1 for task_id, Phase 1A for trace_id)
    |
    v
Phase 3.5 (durable execution) -- this spec
    |   3.5.1 Checkpoint Store (depends on 3.1 tasks, 3.8 traces)
    |   3.5.2 Resume (depends on 3.5.1)
    |   3.5.3 Replay (depends on 3.5.1, 3.5.6 side-effect boundaries)
    |   3.5.4 Fork (depends on 3.5.1)
    |   3.5.5 Pause/Resume (depends on 3.1 task statuses, 3.6 signal mechanism)
    |   3.5.6 Side-Effect Boundaries (depends on 3.5.3)
    |   3.5.7 Artifact Lineage (depends on 3.5.1 checkpoints)
```

---

*End of Phase 3 / 3.5 Implementation Specification*
