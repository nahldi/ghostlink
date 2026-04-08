# GhostLink Validation Matrix

**Purpose:** Repeatable test gates for every implementation phase. Run the relevant gate checklist BEFORE and AFTER each phase. Any AI picking up this project should use this matrix to verify health.

**Last updated:** 2026-04-07

---

## Gate 0: Baseline Health (Run Before ANY Phase)

These must all pass before starting implementation on any phase.

### Backend
- [ ] `cd backend && python -m pytest tests/ -q` - backend test suite passes
- [ ] No import errors: `python -c "import app; print(app.__version__)"` prints current version
- [ ] Settings lock is respected: `_load_settings()` acquires `_settings_lock`

### Frontend
- [ ] `cd frontend && npx vitest run` - frontend test suite passes
- [ ] `cd frontend && npx tsc --noEmit` - zero type errors
- [ ] `cd frontend && npm run build` - builds clean, no warnings
- [ ] `cd frontend && npm run lint` - passes clean

### Desktop
- [ ] `cd desktop && npx tsc --noEmit` - zero type errors
- [ ] `cd desktop && npm run build` - builds clean

### Version Consistency
- [ ] `backend/app.py` `__version__` matches current release
- [ ] `backend/pyproject.toml` `version` matches
- [ ] `desktop/package.json` `version` matches
- [ ] `frontend/package.json` `version` matches
- [ ] `desktop/package-lock.json` `version` matches
- [ ] `frontend/package-lock.json` `version` matches

### Docs Consistency
- [ ] STATUS.md version header matches current release
- [ ] FEATURES.md agent count says "8 integrated + 5 experimental"
- [ ] UNIFIED_ROADMAP.md comparison matrix reflects implemented features correctly
- [ ] No stale version references in any root .md file

### Working Tree
- [ ] `git status` shows clean working tree (no uncommitted changes except local runtime files)

---

## Gate 1A: Post-Identity Foundation (After Phase 1A)

Everything in Gate 0, plus:

Phase 1A scope is locked to 4 deliverables only. Do NOT test items from other phases here.

### Stable Agent ID
- [ ] `AgentInstance` has `agent_id` field (`uuid.uuid4().hex`)
- [ ] `agent_id` is assigned at first registration and never changes
- [ ] `agent_id` survives server restart
- [ ] Renaming an agent preserves the same `agent_id`

### Persistent Registry DB
- [ ] SQLite identity table exists with agent records
- [ ] WAL mode enabled with `busy_timeout=5000`
- [ ] On startup, registry loads from SQLite, not just in-memory
- [ ] Killing the server and restarting recovers all registered agents (in offline state)

### Dual Name/ID Lookup
- [ ] `AgentRegistry.get(name)` still works (backward compat)
- [ ] `AgentRegistry.get_by_id(agent_id)` works
- [ ] All existing API routes still accept agent name in URL
- [ ] `agent_id` is included in `/api/status` response

### Memory/Soul/Notes Path Unification
- [ ] Wrapper writes soul/notes to `data/agents/{agent_id}/` (not `data/{name}/`)
- [ ] API reads soul/notes from `data/agents/{agent_id}/`
- [ ] MCP bridge memory tools read/write to `data/agents/{agent_id}/memory/`
- [ ] `search_all_memories()` scans `data/agents/*/memory/`
- [ ] Existing agent data migrated from old paths to new paths
- [ ] Backup at `/api/backup` includes `data/agents/` directory AND `ghostlink_v2.db`

### Pre-existing Plugin Security (already shipped, verify not regressed)
- [ ] `pre_tool_use` hook error blocks the tool call (fail-closed)
- [ ] `post_tool_use` hook error does NOT block (fail-open)

---

## Gate 1B: Post-Identity Isolation (After Phase 1B)

Everything in Gates 0-1A, plus:

### Identity Isolation
- [ ] Two same-model agents in one workspace have isolated identity/instruction files
- [ ] Killing and restarting an agent restores the same identity
- [ ] Every spawn and reconnect re-injects full identity context
- [ ] `session_id` created on each new session, `agent_id` preserved

### Reinjection Lifecycle
- [ ] Provider-specific identity injection writes to correct paths per CLI
- [ ] Context template is under 500 tokens

---

## Gate 2: Post-Profiles Phase (After Phase 2)

Everything in Gates 0-1B, plus:

### Agent Profiles
- [ ] Stable profile_id separate from display label
- [ ] Skills inheritance: global default -> profile default -> per-agent override
- [ ] Effective-state view shows what's actually applied per agent
- [ ] Two Claudes with different profiles show different effective skills

### Skills Center
- [ ] Skills Center accessible from sidebar
- [ ] Each skill shows card with description + agent assignment
- [ ] Enable "for all agents" or pick specific agents
- [ ] Search/filter by category works

---

## Gate 3: Post-Operator Control Plane (After Phase 3)

Everything in Gates 0-2, plus:

### Unified Tasks
- [ ] Single `/api/tasks` endpoint returns all tasks regardless of source
- [ ] Dashboard shows SQLite jobs + agent tasks + scheduled tasks together
- [ ] Filter by agent, status, type works

### Structured Progress
- [ ] Agent progress shows as step-by-step checklist in UI
- [ ] Steps update in real-time
- [ ] Completion percentage visible

### Thinking Level
- [ ] Thinking level picker visible in chat header
- [ ] Changing level sends PATCH to `/api/agents/{name}/config`
- [ ] Setting persists across sessions

### Context Visibility
- [ ] Per-channel `contextVisibility` setting exists
- [ ] MCP `chat_read` respects the filter

### Stop Button
- [ ] Stop button visible during tool execution
- [ ] Click sends cancel signal to agent process

### Live Model Switching
- [ ] PATCH endpoint for model switch exists
- [ ] Switching model mid-conversation works without restart

---

## Gate 3.5: Post-Durable Execution (After Phase 3.5)

Everything in Gates 0-3, plus:

### Checkpoints
- [ ] Checkpoint store persists execution state at deterministic boundaries
- [ ] Resume after crash/restart restores effective state
- [ ] Replay from any checkpoint works (read-only, then optionally live)
- [ ] Pause/interrupt/resume as first-class primitives

### Execution Timeline
- [ ] Operator can inspect task timeline with checkpoints, transitions, tool calls

---

## Gate 4A: Post-Policy Engine (After Phase 4A)

Everything in Gates 0-3.5, plus:

### Policy Engine
- [ ] Per-tool approval policy works (allow/ask/deny per risk tier)
- [ ] Dangerous actions blocked server-side regardless of prompt content
- [ ] Policy decision logs explain allow/deny/escalate
- [ ] Network/egress controls enforced for MCP tool calls

---

## Gate 4B: Post-Provider Independence (After Phase 4B)

Everything in Gates 0-4A, plus:

### Providers
- [ ] All providers appear in Settings > AI
- [ ] API key configuration works for each
- [ ] Model lists are accurate per provider
- [ ] Failover routing works when primary provider fails
- [ ] Budget enforcement blocks requests when budget exceeded

### Prompt Caching
- [ ] MCP tool ordering is deterministic (stable across requests)
- [ ] Cache hit rate is measurable

---

## Gate 4.5: Post-Evals (After Phase 4.5)

Everything in Gates 0-4B, plus:

### Trace Grading
- [ ] Golden task corpus exists with representative tasks
- [ ] Trace grader scores correctness, safety, cost efficiency
- [ ] Regression gates prevent merging if golden scenarios regress
- [ ] Benchmark dashboard compares by provider/model/profile

---

## Gate 5: Post-Multi-Agent Execution (After Phase 5)

Everything in Gates 0-4.5, plus:

### Worktrees
- [ ] Worktrees are keyed by stable `agent_id`, not display name
- [ ] Worktree paths use `.ghostlink/worktrees/<agent_id>`
- [ ] Merge conflict detection runs before the real merge touches the main tree
- [ ] Accepted work merges with `--no-ff` and preserves agent/task attribution
- [ ] Disconnect handling does not auto-merge unsafe background or arena work

### Background Execution
- [ ] Background tasks run as isolated OS processes, not fake foreground wrappers
- [ ] Queue/running/completed/failed/cancelled/resuming states are truthful
- [ ] Resume restores checkpoint + worktree lineage after crash/interruption
- [ ] Concurrency limits are enforced
- [ ] Orphaned background processes are cleaned up on shutdown/recovery

### Hooks and AGENTS.md
- [ ] Blocking hook trust rules still fail closed
- [ ] New lifecycle hook events fire in deterministic order
- [ ] `AGENTS.md` is parsed and layered at the documented precedence
- [ ] GhostLink never writes back to `AGENTS.md`

### Arena / Spec / Collaboration
- [ ] Arena comparison shows diffs, cost, timing, and eval data truthfully
- [ ] Winner selection merges only the winner and cleans up losers
- [ ] Arena results link into Phase 4.5 benchmark history
- [ ] Spec-driven task progress reflects real acceptance-state, not UI-only counters
- [ ] Collaboration provenance links subtasks, artifacts, and final merges truthfully

---

## Gate 6: Post-Memory and Intelligence (After Phase 6)

Everything in Gates 0-5, plus:

### Memory Stratification
- [ ] Identity / workspace / session memory layers exist with the documented semantics
- [ ] Flat-schema memory migration is additive and lossless
- [ ] Identity memory is never evicted under workspace/session pressure
- [ ] Session-end promotion creates truthful workspace summaries

### Recall and Reinforcement
- [ ] Cross-layer memory search supports layer/tag filtering
- [ ] Weighted recall ordering matches configured recency/frequency/importance weights
- [ ] `last_accessed` and `access_count` update on reads/search hits
- [ ] Identity reinforcement fires on compaction/resume/drift boundaries
- [ ] Reinjection preserves current-task continuity instead of derailing the task

### Observations and Shared Memory
- [ ] Observation engine records structural workspace patterns only
- [ ] Low-confidence observations stay out of active context
- [ ] Operators can review and delete observational memory
- [ ] Cross-agent memory write isolation is enforced
- [ ] Promotion/conflict events are surfaced truthfully for shared memory updates

### Cache Diagnostics
- [ ] Cache hit/miss accounting matches provider/runtime metadata where available
- [ ] Estimated cache values are explicitly labeled when inferred
- [ ] Cache diagnostics alerts fire only after the configured sustained miss window
- [ ] Diagnostics collection does not materially degrade request latency

---

## Gate 7: Post-Media Generation (After Phase 7)

Everything in Gates 0-6, plus:

### Video and Music Async Delivery
- [ ] `generate_video` returns a task ID immediately and completes through truthful async task states
- [ ] `generate_music` returns a task ID immediately and completes through truthful async task states
- [ ] Provider timeout/cancel/failure paths leave media tasks in honest terminal states
- [ ] Missing or unconfigured media providers return clear operator-visible errors

### Rendering and Editing
- [ ] Completed video artifacts render inline with playback and download
- [ ] Completed audio artifacts render inline with playback and download
- [ ] Expanded image generation does not regress the existing image path
- [ ] Image editing preserves source/result lineage and renders edited output inline

### Cost and Task Surfaces
- [ ] Media generation costs appear in the normal Phase 4B usage/cost surfaces
- [ ] Unknown or derived media costs are labeled honestly
- [ ] Media task progress shown in chat matches the Phase 3 task dashboard state
- [ ] Media routing/failover metadata stays truthful in task and cost records

---

## Gate 8: Post-A2A Interoperability (After Phase 8)

Everything in Gates 0-7, plus:

### Agent Cards and Discovery
- [ ] GhostLink serves a valid `/.well-known/agent-card.json` surface for exposed local agents
- [ ] Agent cards publish truthful identity, capability, and auth metadata
- [ ] Remote A2A discovery handles malformed or unauthenticated cards with clear failure
- [ ] Disabling A2A exposure does not regress local-only GhostLink behavior

### Auth, Policy, and Mapping
- [ ] Inbound A2A requests are evaluated by the Phase 4A policy engine before execution
- [ ] Unsigned or invalidly signed cards/notifications are rejected when enforcement is enabled
- [ ] GhostLink `agent_id`, `task_id`, trace IDs, and artifact references round-trip cleanly through A2A mappings
- [ ] A2A auth failures and policy rejections are auditable

### Streaming and Cross-Platform Tasks
- [ ] Long-running A2A tasks stream truthful progress over SSE
- [ ] Disconnected long-running tasks use authenticated callback/push flow instead of silent drops
- [ ] Cross-platform task progress shown in UI matches backend truth
- [ ] Remote invocation results map back into GhostLink task/artifact state without provenance loss

---

## Stress Tests (Run Before Any Release)

These are manual verification flows, not automated tests.

### Wizard Flow
1. Delete `~/.ghostlink/settings.json` and `backend/data/settings.json`
2. Launch desktop app
3. Verify wizard appears
4. Complete wizard (select platform, install dependencies)
5. Verify launcher opens with server running
6. Verify chat loads and is functional
7. Verify settings persist across app restart

### Multi-Agent Stress
1. Spawn 2+ agents of the same model type (e.g., two Claudes)
2. Verify each has isolated identity (different `.ghostlink/agents/<id>/` paths)
3. Send messages to both, verify responses don't cross-contaminate
4. Kill one agent, verify the other is unaffected
5. Restart the killed agent, verify identity is restored

### Reconnect Resilience
1. Start app with agents running
2. Kill the backend server process
3. Restart backend
4. Verify WebSocket reconnects automatically
5. Verify reconnect fetch is throttled (not 50+ parallel calls)
6. Verify agent state is recovered correctly

### Export/Share Pagination
1. Create a channel with 1000+ messages (or use a populated one)
2. Hit `/api/export?channel=X` — verify pagination metadata in response
3. Verify `has_more` is true and response is bounded (not full channel dump)
4. Page through with offset — verify all messages are accessible

### Memory Leak Watch
1. Run backend for extended session (30+ minutes)
2. Check `_mcp_invocation_logs` size doesn't exceed caps
3. Check `_file_diff_cache` size doesn't exceed caps
4. Kill an agent and verify `cleanup_agent_state()` removes all per-agent state

---

## How To Use This Matrix

1. **Before starting any phase:** Run Gate 0 checklist. Fix any failures before proceeding.
2. **After completing a phase:** Run the corresponding gate checklist + Gate 0 again.
3. **Before any release:** Run Gate 0 + all applicable gates + Stress Tests.
4. **When picking up the project fresh:** Run Gate 0 to establish baseline, then read UNIFIED_ROADMAP.md for what's next.

Any checklist failure is a blocker. Fix it before moving to the next phase.

