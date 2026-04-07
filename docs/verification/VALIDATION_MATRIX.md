# GhostLink Validation Matrix

**Purpose:** Repeatable test gates for every implementation phase. Run the relevant gate checklist BEFORE and AFTER each phase. Any AI picking up this project should use this matrix to verify health.

**Last updated:** 2026-04-07

---

## Gate 0: Baseline Health (Run Before ANY Phase)

These must all pass before starting implementation on any phase.

### Backend
- [ ] `cd backend && python -m pytest tests/ -q` — all 171+ test cases pass
- [ ] No import errors: `python -c "import app; print(app.__version__)"` prints current version
- [ ] Settings lock is respected: `_load_settings()` acquires `_settings_lock`

### Frontend
- [ ] `cd frontend && npx vitest run` — all 49+ test cases pass
- [ ] `cd frontend && npx tsc --noEmit` — zero type errors
- [ ] `cd frontend && npm run build` — builds clean, no warnings
- [ ] `cd frontend && npm run lint` — passes clean

### Desktop
- [ ] `cd desktop && npx tsc --noEmit` — zero type errors
- [ ] `cd desktop && npm run build` — builds clean

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

## Gate 1: Post-Security Phase (After Phase 1)

Everything in Gate 0, plus:

### Plugin Security
- [ ] Plugin manifests support `allowed_tools` field
- [ ] `get_plugin_allowed_tools()` returns allowlist for non-builtin plugins
- [ ] `set_plugin_allowed_tools()` persists changes
- [ ] Non-builtin plugin calling an unlisted tool is rejected
- [ ] `pre_tool_use` hook error blocks the tool call (fail-closed)
- [ ] `post_tool_use` hook error does NOT block (fail-open, since tool already ran)
- [ ] Plugin install records provenance metadata (source URL, install date, checksum)
- [ ] Checksum mismatch on known plugin blocks install
- [ ] UI shows verified/unverified badge per plugin

### Exec Approval
- [ ] "Always allow" option on exec approval saves to persistent allowlist
- [ ] Previously allowed command auto-passes without re-prompting
- [ ] `/api/security/exec-approvals` CRUD endpoint works
- [ ] UI to manage exec approval allowlist works

### Agent Identity (Phase 1.5)
- [ ] Each agent has server-owned identity record with stable internal ID
- [ ] Identity record includes: provider, display label, workspace, role/profile, enabled skills
- [ ] Spawning agent writes identity files to `.ghostlink/agents/<instance-id>/` NOT shared workspace root
- [ ] Two same-model agents in one workspace have fully isolated identity files
- [ ] Killing and restarting an agent restores the same identity
- [ ] Renaming an agent doesn't break identity continuity
- [ ] Every spawn, reconnect, and resume re-injects full identity context

---

## Gate 2: Post-Control Phase (After Phase 2)

Everything in Gates 0-1, plus:

### Thinking Level
- [ ] Thinking level picker visible in chat header
- [ ] Changing level sends PATCH to `/api/agents/{name}/config`
- [ ] Setting persists across sessions

### Context Visibility
- [ ] Per-channel `contextVisibility` setting exists
- [ ] MCP `chat_read` respects the filter
- [ ] UI shows context mode per channel

### Stop Button
- [ ] Stop button visible during tool execution
- [ ] Click sends cancel signal to agent process
- [ ] Agent receives cancellation

### Live Model Switching
- [ ] PATCH endpoint for model switch exists
- [ ] Switching model mid-conversation works without restart

### Skills Center
- [ ] Skills Center accessible from sidebar
- [ ] Each skill shows card with description + agent assignment
- [ ] Enable "for all agents" or pick specific agents
- [ ] Search/filter by category works

---

## Gate 3: Post-Task Unification (After Phase 3)

Everything in Gates 0-2, plus:

### Unified Tasks
- [ ] Single `/api/tasks` endpoint returns all tasks regardless of source
- [ ] Dashboard shows SQLite jobs + agent tasks + scheduled tasks together
- [ ] Filter by agent, status, type works

### Structured Progress
- [ ] Agent progress shows as step-by-step checklist in UI
- [ ] Steps update in real-time
- [ ] Completion percentage visible

### Agent Profiles
- [ ] Stable agent/profile ID separate from display label
- [ ] Skills inheritance: global default → profile default → per-agent override
- [ ] Effective-state view shows what's actually applied per agent
- [ ] Two Claudes with different profiles show different effective skills

---

## Gate 4: Post-Provider Expansion (After Phase 4)

Everything in Gates 0-3, plus:

### Providers
- [ ] All new providers appear in Settings > AI
- [ ] API key configuration works for each
- [ ] Model lists are accurate per provider

### Prompt Caching
- [ ] MCP tool ordering is deterministic (stable across requests)
- [ ] `/api/diagnostics` shows cache stats
- [ ] Cache hit rate is measurable

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
