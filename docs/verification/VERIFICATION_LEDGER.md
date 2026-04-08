# GhostLink Verification Ledger

**Last updated:** 2026-04-07
**Purpose:** Local fact ledger for product research, code-grounded verification, provider/runtime capability checks, and release-gate evidence.

---

## Rules

- Do not trust memory when the code or official docs can be checked.
- Record the source of every non-trivial claim.
- Separate `verified`, `inferred`, and `open question` states.
- Re-run validation after each implementation phase.
- If a claim cannot be verified yet, mark it as unverified instead of restating it as fact.

---

## Current Verified Product Baseline

These items are verified against the current repository state as of 2026-04-07.

- Version: `v5.7.2`
- API/websocket endpoints: `217`
  - Source: route decorator count across `backend/app.py` and `backend/routes/*.py`
- Route modules: `14`
  - Source: files under `backend/routes/` excluding `__init__.py`
- MCP tools: `29`
  - Source: `_ALL_TOOLS` in `backend/mcp_bridge.py`
- API providers: `13`
  - Source: `PROVIDERS` in `backend/providers.py`
- Supported CLI agents: `13` (8 integrated with MCP injection + 5 experimental/launcher-only)
  - Integrated: Claude, Codex, Gemini, Grok, Aider, Goose, Copilot, Ollama
  - Experimental (no MCP integration): Pi, Cursor, Cody, Continue, OpenCode
  - Source: `_BUILTIN_DEFAULTS` and `_KNOWN_COMMANDS` in `backend/wrapper.py`
- Built-in skills: `28`
  - Source: `BUILTIN_SKILLS` in `backend/skills.py`
- Built-in personas: `14`
  - Source: `BUILTIN_PERSONAS` in `frontend/src/components/PersonaMarketplace.tsx`
- React component files: `66`
  - Source: `frontend/src/components/**/*.tsx`
- Latest verified release-cycle tests: `220`
  - Backend: `171`
  - Frontend: `49`
  - Source: release verification notes and local test inventory

---

## Current Verified Architectural Facts

### Identity and agent isolation

- GhostLink already has token-enforced MCP identity.
  - Source: `backend/mcp_bridge.py`, `_resolve_identity()`
- Per-agent memory, soul, and notes are stored in isolated backend paths.
  - Source: `backend/agent_memory.py`
- Workspace-facing identity injection is still shared and can be overwritten by another agent in the same repo.
  - Shared files currently include:
    - `.ghostlink-context.md`
    - `.claude/instructions.md`
    - `.codex/instructions.md`
  - Source: `backend/wrapper.py`

### Skills

- Skills are currently assigned by agent name, not by a stable profile/instance id.
  - Source: `backend/skills.py`
- Default first-time behavior enables all built-in skills for an agent.
  - Source: `backend/skills.py`
- Main current management surface is per-agent, not a centralized Skills Center.
  - Source: `frontend/src/components/AgentInfoPanel.tsx`

### Runtime transports

- GhostLink ships streamable HTTP MCP on `:8200` and SSE on `:8201`.
  - Source: `backend/mcp_bridge.py`
- GhostLink still has a hybrid tmux + MCP-native runtime story.
  - Source: `backend/wrapper.py`, `backend/wrapper_mcp.py`

---

## Documentation Corrections Already Identified

- Active docs previously overstated API provider count as `17`; source code currently ships `13`.
- Historical bug archaeology had drifted into active docs and needed to be separated from current risks.
- Agent identity work had to be reframed from "extra markdown files" to "runtime identity architecture."

---

## Open Verification Tracks

These still need a deeper pass before implementation resumes.

### Agent CLI behavior

- Claude Code actual persistent instruction loading behavior
- Codex CLI instruction loading and resume behavior
- Gemini CLI system-instruction and MCP transport behavior
- Other supported agent CLIs and what is actually configurable/reliable

### Provider capability truth table

- Verify each provider's real shipped capabilities against `backend/providers.py`
- Verify where docs/roadmap are aspirational vs implemented
- Verify which provider claims are current as of 2026-04-07

### MCP tool truth table

- Verify all 29 tool names, scope, auth behavior, and real side effects
- Mark any tools that are implemented but not surfaced well in the UI

### Release-grade validation

- Full backend tests
- Full frontend tests
- Frontend lint
- Frontend build
- Desktop TypeScript build
- Smoke flow: wizard -> launcher -> server start -> chat open
- Stress flow: reconnect, multi-agent approvals, export/share pagination, bridge message handling

---

## Method Notes

- Code-grounded facts should cite exact files/modules.
- External ecosystem comparisons should cite official docs/releases where possible.
- When a claim is based on inference from code rather than direct runtime proof, mark it as inferred.
