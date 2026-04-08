# Cross-Spec Audit Summary

**Date:** 2026-04-07
**Auditors:** claudecmd (independent), codexcmd (independent), cross-verified
**Scope:** All spec files, AGENT_PLAYBOOK.md, APPROACH_AUDIT.md, PHASE_1A_RISK_AUDIT.md
**Commit at audit time:** `2679e61`
**Method:** Every claim was verified against live code. Findings marked `[CODE-VERIFIED]` were confirmed by reading the actual source. Findings marked `[SPEC-ONLY]` are structural/logical issues within the spec itself.

---

## Active Production Bug

**This is a live bug, not a roadmap issue.**

`[CODE-VERIFIED]` Wrapper writes soul to `data/{name}/soul.txt` (`wrapper.py:932` via `set_soul(data_dir, assigned_name, soul)`). The API reads soul from `data/agents/{name}/soul.txt` (`routes/agents.py:1259` via `deps.DATA_DIR / "agents"`). **These are different paths.** The soul/notes API endpoints have never returned wrapper-written data. Same issue affects notes.

- **wrapper.py:716** sets `data_dir = ROOT / config.get("server", {}).get("data_dir", "./data")` -> `backend/data`
- **routes/agents.py:1259** uses `agent_dir = deps.DATA_DIR / "agents"` -> `backend/data/agents`
- Result: `set_soul` writes to `data/claude/soul.txt`, `api_get_soul` reads from `data/agents/claude/soul.txt`

**Fix required regardless of Phase 1A.**

---

## Blocker Summary (12 total)

### Phase 1A (4 blockers — 3 previously known + 1 new)

| # | Blocker | Source | Verification |
|---|---------|--------|--------------|
| 1A-1 | DB naming collision: spec says `data/ghostlink.db` for registry, but `misc.py:245` backup already targets `ghostlink.db` (old deprecated store) while live data is in `ghostlink_v2.db` (`app.py:337`). Backup would capture registry but miss all messages/jobs/rules. | `[CODE-VERIFIED]` | claudecmd + codexcmd |
| 1A-2 | Re-registration protocol: `wrapper.py:276` sends `{base, label, pid, runner}` -- no `slot` or `agent_id`. Spec's "match by base + slot" is unimplementable. Wrapper re-registers only on HTTP 409 (`wrapper.py:1032`) but heartbeat never returns 409 (`agents.py:1000-1054` returns 401/404 only). | `[CODE-VERIFIED]` | claudecmd + codexcmd |
| 1A-3 | Provider adapter paths: spec claims `.ghostlink/identity.md`, `AGENTS.override.md`, `GEMINI.md`, etc. Actual code: Claude -> `.claude/instructions.md` (L944), Codex -> `.codex/instructions.md` (L954), Gemini -> `systemInstruction` in settings JSON (L962-971), Grok -> `.grok/instructions.md` (L981-988), Aider -> `.aider.conventions.md` (L973-979), Goose/Copilot/Ollama -> generic `INSTRUCTIONS.md` (L990-995). Every path is wrong. | `[CODE-VERIFIED]` | claudecmd + codexcmd |
| 1A-4 | **[NEW]** All 6/8 concrete adapter file paths wrong (independent of 1A-3 which is about the abstract interface). Even after fixing the interface, every implementation writes to the wrong location. | `[CODE-VERIFIED]` | claudecmd |

**Resolution:** Phase 1A scope locked to 4 safe items only. Provider adapters explicitly deferred. Codexcmd has already patched the spec.

### Phase 1B/2 (1 blocker)

| # | Blocker | Source | Verification |
|---|---------|--------|--------------|
| 1B-1 | Soul/notes path split is a live production bug (see above). Wrapper writes to `data/{name}/`, API reads from `data/agents/{name}/`. The spec identifies it but understates severity — this is not "drift," it's broken right now. | `[CODE-VERIFIED]` | claudecmd + codexcmd |

### Phase 3/3.5 (2 blockers)

| # | Blocker | Source | Verification |
|---|---------|--------|--------------|
| 3-1 | MCP tool name wrong: spec says `thinking_set`, actual tool is `set_thinking` (`mcp_bridge.py:1236`, registered as `set_thinking` in `_ALL_TOOLS` at L1684). The `TOOL_REPLAY_CLASSIFICATION` dict (spec line 999) will fail at runtime. | `[CODE-VERIFIED]` | claudecmd + codexcmd |
| 3-2 | Skills API endpoint paths wrong: spec says `/api/agents/{name}/skills` and `/api/agents/{name}/skills/{skill_id}/config`. Actual routes are `/api/skills/agent/{agent_name}` and `/api/skills/agent/{agent_name}/toggle` (`routes/agents.py:1214-1247`). Frontend built to spec will call wrong endpoints. | `[CODE-VERIFIED]` | claudecmd |

### Phase 4 (3 blockers)

| # | Blocker | Source | Verification |
|---|---------|--------|--------------|
| 4-1 | No tracing infrastructure exists. Grep for "trace" across all backend Python returns nothing relevant. Phase 4.5 (evals/trace grading) is 100% unimplementable without Phase 3.5 tracing. `TraceGrader` grades traces that don't exist. | `[CODE-VERIFIED]` | claudecmd |
| 4-2 | No `Transport` interface/abstraction exists. `ProviderRegistry` is a registry/resolver, not a transport layer. Cost tracking, budget enforcement, and failover all assume a single transport chokepoint. CLI agents make their own HTTP calls -- GhostLink can't intercept. | `[CODE-VERIFIED]` | claudecmd |
| 4-3 | Spec references `ghostlink.db` but runtime uses `ghostlink_v2.db`. No schema migration framework exists -- each store does inline `CREATE TABLE IF NOT EXISTS`. Five new tables proposed with no migration runner. | `[CODE-VERIFIED]` | claudecmd |

### Phase 5/6 (2 blockers)

| # | Blocker | Source | Verification |
|---|---------|--------|--------------|
| 5-1 | Phase 1A `agent_id` doesn't exist. `AgentInstance` (`registry.py:14-32`) has no `agent_id` field. The entire spec (worktrees, background exec, arena, collaboration, memory stratification) is keyed on it. | `[CODE-VERIFIED]` | claudecmd |
| 5-2 | No auto-checkpointing in hook system. `_wrap_tool_with_hooks` (`mcp_bridge.py:1697`) fires events but does not call any checkpoint logic. Checkpoints are manual/API-driven (`routes/agents.py:2198-2288`), not automatic. Background execution depends on crash recovery via checkpoints that don't exist. | `[CODE-VERIFIED]` | claudecmd |

---

## Corrected Claim: `pre_tool_use` IS Wired

Initial audit incorrectly listed `pre_tool_use` as unwired. **This is wrong.** Verified:
- `mcp_bridge.py:1710`: `event_bus.emit("pre_tool_use", {...}, fail_closed=True)` inside `_wrap_tool_with_hooks`
- `mcp_bridge.py:1712-1713`: hook exception blocks the tool, returns error
- `app.py:632`: handler registered via `event_bus.on("pre_tool_use", _on_pre_tool_use)`

`pre_tool_use` is fully wired and fail-closed. **Not a blocker.** Correction confirmed by codexcmd.

---

## Risk Audit Number Corrections

The PHASE_1A_RISK_AUDIT.md frontend numbers were significantly overstated. Corrected after code-verified recount:

| Metric | Original Claim | Verified Count | Delta |
|--------|---------------|----------------|-------|
| Backend API routes (name in URL) | 40+ | **48** | Understated |
| Frontend API methods (URL path) | 33 | **23** | Overstated (body params miscounted) |
| Frontend component `key=` | 30+ | **12** agent-specific | Overstated (non-agent keys counted) |
| Frontend agent lookups | 15+ | **11** files | Overstated |
| Frontend store Records | 8 | **9** + 1 string | Slightly understated |
| MCP bridge dicts | 5 | **5** | Accurate |
| Test files with hardcoded names | 11 | **12** (`test_core.py` missed) | Slightly understated |
| Queue path locations | 6 | **7** (6 producers + 1 rename) | Accurate |

**Net effect:** Frontend migration effort is ~40% less than estimated. Backend effort accurate or slightly understated. Total revised estimate: **45-70 hours** (was 50-80).

---

## Warning-Level Issues by Spec (selected highlights)

### Phase 1A Warnings (6)
- Python dataclass defaults `state="pending"` but SQL defaults `state='offline'`
- Backup function looks at `data/memory/` which doesn't exist — agent memories never backed up
- `search_all_memories` in `mcp_bridge.py` not listed in spec's path migration table
- Backup `data_dir` from `deps._settings` is never set in production — falls back to CWD-relative
- Health check targets `ghostlink.db` (old deprecated store)
- `qwen` has color but no adapter; 5 known providers completely absent from spec

### Phase 1B/2 Warnings (7)
- `CLAUDE_CODE_CONFIG_DIR` / `CODEX_CONFIG_DIR` env vars don't exist in either CLI
- Claude `--resume` deliberately avoided at `wrapper_mcp.py:770` due to cache misses -- spec ignores this
- `compute_effective_state` declared sync but uses `await` -- SyntaxError
- Config update handler does NOT trigger subprocess restart on model change (spec says it does)
- `PRESENCE_TIMEOUT` is at line 41, not 38
- Codex does not support `--config-dir`
- `delegate` MCP tool has no `parent_agent_id` -- spec conflates current and target state

### Phase 3/3.5 Warnings (4)
- `TOOL_REPLAY_CLASSIFICATION` only lists 10 of ~30 tools -- unlisted tools default to blocked
- Wrapper has zero cancel/pause signal file polling -- spec marks as `[EXISTS]`
- Checkpoint `state_snapshot` content (read cursors, plan state) is private to modules with no serialization path
- `DataManager.save_retention` allowlists only 4 keys -- new audit fields silently dropped

### Phase 4 Warnings (7)
- `ExecPolicy` only gates shell commands, not MCP tool calls
- Hook system lacks trust/signing fields -- no backward-compat migration path
- `SecretsManager.get()` has no context param -- `PolicyContext` doesn't exist
- Budget enforcement assumes transport-layer interception that doesn't exist
- Cost tracking impossible for CLI-wrapped agents (no token count access)
- Eval system has zero buildable components until 4A + 4B both complete
- Circuit breaker "20 files in 5 minutes" has no file-write counting mechanism

### Phase 5/6 Warnings (7)
- HookManager `action` field semantics differ from proposed `type` field -- spec mixes current/proposed
- `AutonomousPlan` uses `agent_name`, not `agent_id` -- depends on Phase 1A
- `generate_agent_context()` is a simple template -- gap to selective injection is large
- Wrapper is deeply tmux-coupled -- non-tmux background mode is major refactor, not one-line change
- `MemoryGraph` exists (`deps.py:22`) but Phase 6 memory design never mentions it
- `RAGPipeline` exists (`deps.py:68`) but Phase 6 design never mentions it
- ~~Phase 5 named "Agent Execution Expansion" in playbook but "Multi-Agent Execution" in roadmap-pt2~~ **RESOLVED** - phase naming aligned on "Multi-Agent Execution"

### AGENT_PLAYBOOK Warnings (5 original, 2 resolved)
- ~~16 backend Python files not in ownership table~~ **RESOLVED** — codexcmd expanded the ownership table
- ~~`frontend/tests/` directory doesn't exist~~ **RESOLVED** - playbook now points at colocated tests under `frontend/src/`
- Discord communication protocol may not work for Codex agents (tyson, ned) -- sandboxed environments
- ~~Three different startup read orders~~ **RESOLVED** - startup order aligned around AGENT_PLAYBOOK -> STATUS -> roadmap-pt1 -> UNIFIED_ROADMAP
- ~~Playbook startup omits VALIDATION_MATRIX.md and VERIFICATION_LEDGER.md~~ **RESOLVED** — added to Section 6

---

## Approach Audit Status

All 7 original blocking issues from APPROACH_AUDIT.md confirmed still open as of 2026-04-07:

1. No DB migration tooling for name-to-ID transition -- STILL OPEN
2. Memory directory renaming orphans data -- STILL OPEN
3. Skills config keyed by display name -- STILL OPEN
4. CLI instruction isolation impossible without worktrees -- STILL OPEN (scope clarification)
5. Side-effect idempotency for replay unspecified -- STILL OPEN (design gap)
6. Egress controls scoped to MCP tools only, not network -- STILL OPEN (scope clarification)
7. OneDrive worktree sync conflict -- STILL OPEN (`worktree.py:44` hardcoded under workspace)

---

## Systemic Issues

1. **House of cards dependency:** Every spec from 1B onward assumes Phase 1A is complete. Phase 1A itself has 4 blockers. Nothing past Phase 1A can be built until the foundation is solid.

2. **Spec/code divergence pattern:** Multiple specs cite line numbers that are off by 1-10 lines, reference features as `[EXISTS]` that don't exist, or conflate "what the code does now" with "what Phase N should add." Implementors must verify every `[EXISTS]` claim before building on it.

3. **Two existing modules ignored:** `MemoryGraph` and `RAGPipeline` both exist in deps.py but are never mentioned in any spec. Phase 6 memory stratification may conflict with or duplicate their functionality.

4. **No migration infrastructure:** The codebase has zero migration tooling. Every store does inline `CREATE TABLE IF NOT EXISTS`. Multiple phases propose new SQLite tables with no migration runner.

---

## Recommended Next Steps

1. **Fix the soul/notes path bug NOW** -- it's a live production issue, not a roadmap item
2. **Correct the 3/3.5 tool name and endpoint paths** -- `set_thinking` not `thinking_set`, actual skills routes
3. **Build Phase 1A (locked scope):** stable agent_id, persistent registry DB, dual name/id lookup, memory/soul/notes path unification
4. **Add a lightweight SQLite migration runner** to `store.py` before Phase 1A ships
5. **Verify every `[EXISTS]` tag** in the remaining specs before implementation begins
6. **Address MemoryGraph/RAGPipeline** in the Phase 6 spec before an agent builds conflicting infrastructure
