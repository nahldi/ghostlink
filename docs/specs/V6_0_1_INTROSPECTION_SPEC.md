# GhostLink v6.0.1 — Operator Introspection Commands

**Owner:** jeff
**Status:** Spec complete, ready for implementation
**Last updated:** 2026-04-08
**Test plan:** docs/verification/V6_0_1_INTROSPECTION_TEST_PLAN.md (kurt)

---

## Goal

Give operators lightweight, chat-accessible visibility into memory state, tool inventory, and system stats without leaving the chat interface. Summary-first, never raw-dump. No secrets exposed.

---

## Scope

### In scope
- 3 new backend routes under `/api/introspect/`
- 3 new frontend slash commands
- Backend tests for redaction and empty-state handling
- Frontend tests for command wiring and error handling

### Out of scope
- Sandbox default changes (deferred to Phase 10)
- New execution permissions
- Raw memory/tool content export
- Any changes to existing routes or behavior

---

## Backend Routes (tyson owns)

### Files to modify
- `backend/routes/misc.py` — add introspection routes (or new `backend/routes/introspect.py` if tyson prefers separation)
- `backend/app.py` — register route module if new file created
- `backend/tests/` — new test file `test_introspect.py`

### `GET /api/introspect/memory`

Returns summary of memory state across all agents. Summary-first — no raw bodies.

**Response shape:**
```json
{
  "agents": [
    {
      "agent_id": "string",
      "agent_name": "string",
      "layers": {
        "identity": { "entry_count": 0, "total_tokens": 0 },
        "workspace": { "entry_count": 0, "total_tokens": 0 },
        "session": { "entry_count": 0, "total_tokens": 0 }
      },
      "total_entries": 0,
      "total_tokens": 0,
      "last_accessed": "ISO8601 | null",
      "has_conflicts": false
    }
  ],
  "totals": {
    "agents": 0,
    "entries": 0,
    "tokens": 0
  }
}
```

**Security rules (from kurt's test plan):**
- No full memory content in response
- No prompts, notes, or freeform bodies
- No API keys, bearer tokens, passwords, cookies, session ids, auth headers
- No absolute local paths outside operator-safe metadata
- If preview text is added later: hard cap to 80 chars, redact known secret patterns before serialization

### `GET /api/introspect/tools`

Returns tool inventory with policy posture and usage aggregates.

**Response shape:**
```json
{
  "tools": [
    {
      "name": "string",
      "category": "string",
      "enabled": true,
      "policy_mode": "allow | ask | deny",
      "risk_tier": "low | medium | high",
      "invocation_count": 0,
      "success_count": 0,
      "failure_count": 0,
      "last_used": "ISO8601 | null"
    }
  ],
  "totals": {
    "tools": 0,
    "enabled": 0,
    "disabled": 0,
    "total_invocations": 0
  }
}
```

**Security rules:**
- No raw tool arguments or results
- No fetched page contents, shell output, or file contents
- No auth tokens, cookies, headers, connection strings, signed URLs

### `GET /api/introspect/stats`

Returns system-level aggregate stats.

**Response shape:**
```json
{
  "uptime_seconds": 0,
  "agents": { "total": 0, "active": 0 },
  "tasks": { "total": 0, "running": 0, "completed": 0, "failed": 0 },
  "messages": { "total": 0 },
  "routes": { "modules": 19, "endpoints": 323 },
  "tools": { "total": 32, "mcp_tools": 32 },
  "providers": { "total": 21, "configured": 0 },
  "skills": { "total": 28 },
  "personas": { "total": 14 },
  "errors": { "rate_1h": 0.0 },
  "version": "read from app.__version__ at runtime"
}
```

**Security rules:**
- No per-user secrets
- No raw request payloads
- No stack traces in normal responses
- No filesystem dumps or env vars

### Implementation notes for tyson
- Use existing data sources: `agent_memory.py` for memory stats, `mcp_bridge._ALL_TOOLS` for tool list, `deps.py` for runtime state
- **Version field:** read from `app.__version__` at runtime (`from app import __version__`). Do NOT hardcode "6.0.1" — the version bumps separately.
- **Memory layers:** backend has 3 layers: `identity`, `workspace`, `session` (defined in `agent_memory._MEMORY_LAYERS`). No `thread` layer exists.
- **Conflict detection:** `agent_memory._detect_conflicts()` emits events but doesn't store counts. Use a boolean `has_conflicts` field — call `_detect_conflicts` and return `true` if any conflicts found for the agent's entries, or `false`. If too expensive, default to `false` and note it as best-effort.
- Tool invocation/success/failure counts: if not currently tracked, initialize counters at 0 and wire into `_wrap_tool_with_hooks`
- Policy mode per tool: read from policy engine if available, default to "allow"
- All routes should return 200 with empty/zero-state data when no agents/tools exist — never 500
- Invalid query params → 400 with clean error message

---

## Frontend Slash Commands (unassigned — jeff coordinates)

### Files to modify
- `frontend/src/components/MessageInput.tsx` — add new slash commands

### Command naming (avoids collision with existing local `/stats`)

| Command | Hits | Display |
|---------|------|---------|
| `/inspect memory` | `GET /api/introspect/memory` | Formatted memory summary per agent |
| `/inspect tools` | `GET /api/introspect/tools` | Tool inventory table with policy/usage |
| `/inspect stats` | `GET /api/introspect/stats` | System stats card |

**Why `/inspect` not `/stats`:** Existing `/stats` is a local frontend command. Using `/inspect` avoids ambiguity and collision. No changes to existing `/stats` behavior.

### Error handling
- 404/500/timeout → clean user-facing message, no raw error bodies
- Empty state → truthful message ("No memory entries found", "No tools registered")

### Frontend tests
- Command registration and routing
- API call wiring
- Error state rendering
- Empty state rendering

---

## Acceptance Criteria

1. All 3 routes return stable JSON matching the shapes above
2. Zero secrets in any response (verified by kurt's seed-and-check test)
3. Empty-state responses are truthful and non-error
4. Invalid params → 400, not 500
5. Existing `/stats` behavior unchanged
6. Existing memory inspector, skills, audit, security routes unchanged
7. All existing tests still pass (277 backend, 112 frontend)

---

## Rollback Plan

All changes are additive routes and frontend commands. Rollback = revert the commit. No data model changes, no migrations, no existing behavior modifications.

---

## Execution Order

1. tyson implements backend routes + tests
2. jeff coordinates frontend slash command wiring
3. kurt validates against test plan
4. jeff approves
5. Commit as v6.0.1

---

## File Ownership

| File | Owner |
|------|-------|
| `backend/routes/introspect.py` (new) | tyson |
| `backend/app.py` (register route) | tyson |
| `backend/tests/test_introspect.py` (new) | tyson |
| `frontend/src/components/MessageInput.tsx` | unassigned (jeff coordinates) |
