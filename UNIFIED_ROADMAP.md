# GhostLink — Development Roadmap

> Single source of truth for all development.
> **For any AI picking this up: follow the phases IN ORDER. Each item has scope, files to change, acceptance criteria, and complexity estimate.**

**Last updated:** 2026-04-06
**Current version:** v5.7.2
**Comparison target:** OpenClaw v2026.4.5 (released 2026-04-06)

---

## Current State (v5.7.2)

### What GhostLink Has Today
- **217 API/websocket endpoints** across 14 route modules
- **29 MCP tools** (chat, memory, web, AI, agent, streaming)
- **13 AI providers** (Anthropic, OpenAI, Google, xAI, Groq, Together, HuggingFace, Ollama, Mistral, OpenRouter, DeepSeek, Perplexity, Cohere)
- **13 supported agent CLIs** (Claude, Codex, Gemini, Grok, Copilot, Aider, Goose, Pi, Cursor, Cody, Continue, OpenCode, Ollama)
- **66 React component files** with 9 visual themes
- **220 automated tests** (171 backend + 49 frontend)
- **Desktop app** (Electron) with auto-update, system tray, setup wizard
- **Full ops toolkit**: health, diagnostics, backup/restore, server logs
- **Security**: heartbeat auth, API rate limiting, SSRF protection, encrypted secrets vault, plugin AST safety scanning, exec policy
- **Real-time**: WebSocket events, typing indicators, streaming tokens, agent presence

### Recent Releases
- **v5.7.2** (2026-04-06): Launcher/wizard fixes, backend memory safety, export pagination, streaming perf, reconnect throttling, component architecture splits
- **v5.7.1** (2026-04-06): Safe dependency refresh (vite, fastapi, uvicorn, mcp, cryptography)
- **v5.7.0** (2026-04-01): Ops toolkit, heartbeat auth, visual reset, error visibility, 46 new tests

---

## OpenClaw v2026.4.5 Feature Comparison

### Legend: ✓ We have it | ⚡ Partial/weaker | ✗ Missing

### Security & Trust
| Feature | OpenClaw | GhostLink | Status |
|---------|----------|-----------|--------|
| Plugin tool allowlist (per-plugin) | ✓ | ✗ | **Missing** — plugins have AST scanning but no per-plugin tool allowlist |
| Failed hooks fail closed | ✓ | ✗ | **Missing** — hook failures silently pass through |
| Plugin signing/provenance | ✓ | ✗ | **Missing** — raw code installed to disk |
| Owner-only allowlist management | ✓ | ✗ | **Missing** |
| Per-agent identity pack / markdown context | ✓ | ⚡ | **Partial** — per-agent soul/memory exists, but workspace-level instruction files are shared and can be overwritten by another agent in the same repo |
| Exec approval durable allowlist | ✓ | ⚡ | **Partial** — approval interception exists but no persistent allowlist |
| SSRF browser redirect blocking | ✓ | ⚡ | **Partial** — SSRF protection exists but not browser-redirect-aware |
| Encrypted secrets vault | ✓ | ✓ | **Have it** |
| API rate limiting | ✓ | ✓ | **Have it** |
| MCP tool call audit trail | ✓ | ✓ | **Have it** |
| Permission presets | ✓ | ✓ | **Have it** |
| Agent token rotation | ✓ | ✓ | **Have it** |

### Agent Intelligence & Control
| Feature | OpenClaw | GhostLink | Status |
|---------|----------|-----------|--------|
| Thinking level picker | ✓ | ⚡ | **Backend exists** — `thinkingLevel` in registry, no UI picker |
| Context visibility per-channel | ✓ | ✗ | **Missing** — all agents see all context in channel |
| Unified task system + dashboard | ✓ | ⚡ | **Split** — SQLite jobs + separate agent task JSON + UI panel exists but not unified |
| Progress/plan structured updates | ✓ | ⚡ | **Partial** — `chat_progress` MCP tool exists, no structured plan events |
| Subagent delegation | ✓ | ✓ | **Have it** — `delegate` MCP tool |
| Live model switching | ✓ | ⚡ | **Partial** — model configurable per agent but no live switch without restart |
| Agent response modes | ✓ | ✓ | **Have it** — 4 modes per agent |
| Agent pause/resume | ✓ | ✓ | **Have it** |
| Scheduled tasks (cron) | ✓ | ✓ | **Have it** |

### Providers & Models
| Feature | OpenClaw | GhostLink | Status |
|---------|----------|-----------|--------|
| 30+ providers | ✓ | ⚡ | **13 providers** — missing Amazon Bedrock, GitHub Copilot provider, Z.AI, BytePlus/Volcengine, Kimi, Microsoft Foundry |
| Prompt caching optimization | ✓ | ✗ | **Missing** — no cache fingerprinting, no deterministic tool ordering for cache hits |
| Provider request overrides | ✓ | ✗ | **Missing** — no shared transport controls for headers/auth/proxy/TLS |
| Model failover | ✓ | ✓ | **Have it** |
| Free tier providers | ✓ | ✓ | **Have it** — Groq, Together, HuggingFace, Ollama |

### Media Generation
| Feature | OpenClaw | GhostLink | Status |
|---------|----------|-----------|--------|
| Video generation (xAI, Runway, ComfyUI) | ✓ | ✗ | **Missing** |
| Music generation (Lyria, MiniMax) | ✓ | ✗ | **Missing** |
| Image generation | ✓ | ✓ | **Have it** — DALL-E, Imagen, FLUX |
| TTS / STT | ✓ | ✓ | **Have it** |

### Memory & Caching
| Feature | OpenClaw | GhostLink | Status |
|---------|----------|-----------|--------|
| Advanced memory (Dreaming) | ✓ | ✗ | **Missing** — we have basic key-value JSON memory |
| Weighted recall promotion | ✓ | ✗ | **Missing** |
| Cross-agent memory search | ✓ | ✓ | **Have it** — `memory_search_all` |
| Prompt cache diagnostics | ✓ | ✗ | **Missing** |

### Channels & Integrations
| Feature | OpenClaw | GhostLink | Status |
|---------|----------|-----------|--------|
| Discord bridge | ✓ | ✓ | **Have it** |
| Telegram bridge | ✓ | ✓ | **Have it** |
| Slack bridge | ✓ | ✓ | **Have it** |
| WhatsApp bridge | ✓ | ✓ | **Have it** |
| Matrix bridge | ✓ | ✗ | **Missing** |
| MS Teams bridge | ✓ | ✗ | **Missing** |
| Synology Chat bridge | ✓ | ✗ | **Missing** |
| Context visibility per-channel | ✓ | ✗ | **Missing** |
| Per-channel allowlists | ✓ | ✗ | **Missing** |

### UI & UX
| Feature | OpenClaw | GhostLink | Status |
|---------|----------|-----------|--------|
| Multilingual UI (16 languages) | ✓ | ✗ | **Missing** |
| ClawHub plugin marketplace search | ✓ | ⚡ | **Partial** — marketplace UI exists, no remote search |
| Thinking level picker in chat header | ✓ | ✗ | **Missing** (backend ready) |
| Loading/skeleton states | ✓ | ⚡ | **Partial** — some components have them, many don't |
| Stop button during tool execution | ✓ | ✗ | **Missing** |
| Accessibility (WCAG) | ✓ | ⚡ | **Partial** — some aria-labels, not systematic |

### Platform & Gateway
| Feature | OpenClaw | GhostLink | Status |
|---------|----------|-----------|--------|
| iOS APNs notifications | ✓ | ✗ | **Missing** |
| macOS LaunchAgent | ✓ | ✗ | **Missing** |
| Windows Task Scheduler integration | ✓ | ✗ | **Missing** |
| Device pairing security | ✓ | ✗ | **Missing** |
| Claude CLI MCP bridge (loopback) | ✓ | ✗ | **Missing** |
| PID recycling detection | ✓ | ✗ | **Missing** |
| Remote tunnel (Cloudflare) | ✓ | ✓ | **Have it** |
| Desktop app with auto-update | ✓ | ✓ | **Have it** |

### Developer Experience
| Feature | OpenClaw | GhostLink | Status |
|---------|----------|-----------|--------|
| Config schema export | ✓ | ✗ | **Missing** |
| Doctor/health check CLI | ✓ | ⚡ | **Partial** — /api/diagnostics exists, no CLI `doctor` command |
| Plugin config TUI prompts | ✓ | ✗ | **Missing** |
| SDK (Python + TypeScript) | ✓ | ✓ | **Have it** — Python SDK |

---

## Implementation Phases

### Phase 0: Verified Baseline (Before Any New Work)
**Priority:** GATE — No implementation starts until this passes
**Goal:** Ensure every claim in this roadmap is factually verified against the live codebase

**Baseline checklist:**
- [ ] All tests pass: `backend 171+`, `frontend 49+`
- [ ] `npm run build` clean, `npx tsc --noEmit` clean
- [ ] Desktop TypeScript builds clean
- [ ] Version consistent across all files (app.py, pyproject.toml, misc.py, desktop/package.json, frontend/package.json, sdk, package-lock.json files)
- [ ] Working tree clean on master
- [ ] All .md files (STATUS, BUGS, CHANGELOG, FEATURES, ROADMAP) reflect current v5.7.2 state
- [ ] No stale version references in any doc

**Doc sync rules for future work:**
- Every commit that changes version MUST update all 7+ version locations
- Every new feature MUST be added to FEATURES.md
- Every release MUST update CHANGELOG.md and STATUS.md
- ROADMAP comparison matrix MUST be re-verified quarterly against competitor releases

---

### Phase 1: Security & Trust Hardening
**Priority:** CRITICAL — Biggest maturity gap vs OpenClaw
**Effort:** 1 week
**Goal:** Match OpenClaw's security posture

#### 1.1 — Plugin Tool Allowlist
**What:** Per-plugin tool allowlist. Each plugin declares which MCP tools it needs. Any undeclared tool call is blocked.
**Files:** `backend/plugin_sdk.py`, `backend/plugin_loader.py`, `backend/routes/plugins.py`
**Acceptance:** Plugin manifest includes `allowed_tools: [...]`. Unlisted tool calls rejected with clear error. UI shows allowed tools per plugin.

#### 1.2 — Failed Hooks Fail Closed
**What:** If a `before_tool_call` hook throws an exception, the tool call is blocked (not allowed through).
**Files:** `backend/plugin_sdk.py` (HookManager), `backend/mcp_bridge.py`
**Acceptance:** Hook error → tool call blocked → error logged → agent gets rejection message.

#### 1.3 — Plugin Install Provenance
**What:** Plugin install validates source (GitHub URL or local path), records provenance metadata (source, install date, checksum), warns on unsigned/unverified plugins.
**Files:** `backend/plugin_loader.py`, `backend/routes/plugins.py`
**Acceptance:** Install records provenance. UI shows verified/unverified badge. Checksum mismatch blocks install.

#### 1.4 — Exec Approval Persistent Allowlist
**What:** When user approves a command, offer "Always allow this command" option. Saved to `exec_approvals.json`. Future identical commands auto-approved.
**Files:** `backend/mcp_bridge.py`, `backend/security.py`
**Acceptance:** Approve with "always" → same command auto-passes next time. `/api/security/exec-approvals` CRUD endpoint. UI to manage allowlist.

#### 1.5 — Agent Identity Pack & Workspace Isolation
**What:** Replace the shared workspace-facing instruction files with a real per-agent identity pack. Each spawned agent gets its own metadata directory and markdown files such as `IDENTITY.md`, `SOUL.md`, `NOTES.md`, plus shared workspace files like `AGENTS.md` and `USER.md` kept separate from agent-specific state.
**Files:** `backend/wrapper.py`, `backend/agent_memory.py`, `backend/routes/agents.py`, `backend/mcp_proxy.py`, `frontend/src/components/AgentInfoPanel.tsx`
**Acceptance:** Spawning a second Claude/Codex/Gemini instance in the same workspace no longer overwrites another agent's instructions. Each agent can be pointed to its own identity pack path. Shared workspace guidance and per-agent identity stay separate and auditable.

---

### Phase 2: Quick Control Wins
**Priority:** HIGH — Fast visible product improvements
**Effort:** 3-5 days

#### 2.1 — Thinking Level Picker (UI)
**What:** Per-agent thinking level selector in chat header and agent cockpit. Options: off, minimal, low, medium, high.
**Files:** `frontend/src/App.tsx` (header), `frontend/src/components/AgentCockpit.tsx`, `frontend/src/types/index.ts`
**Acceptance:** Picker visible in chat header. Changes apply immediately via PATCH /api/agents/{name}/config. Persists across sessions.
**Note:** Backend already supports `thinkingLevel` on registry instances. This is UI-only work.

#### 2.2 — Context Visibility Per-Channel
**What:** Per-channel setting controlling what context agents receive: `all` (everything), `allowlist` (only from allowed senders), `allowlist_quote` (allowed senders + quoted context).
**Files:** `backend/routes/channels.py`, `backend/mcp_bridge.py` (message filtering), `frontend/src/components/Sidebar.tsx` (channel settings)
**Acceptance:** Channel settings include contextVisibility. MCP `chat_read` respects the filter. UI shows context mode per channel.

#### 2.3 — Stop Button During Tool Execution
**What:** UI button to cancel an in-progress agent tool call. Sends cancel signal to agent process.
**Files:** `frontend/src/components/ChatMessage.tsx` (stop button), `backend/routes/agents.py` (cancel endpoint)
**Acceptance:** Stop button visible during tool execution. Click cancels the operation. Agent receives cancellation signal.

#### 2.4 — Live Model Switching
**What:** Switch an agent's model without restarting it. PATCH endpoint + UI control.
**Files:** `backend/routes/agents.py`, `backend/registry.py`, `frontend/src/components/AgentCockpit.tsx`
**Acceptance:** Switch model mid-conversation. Agent uses new model for next response. No restart needed.

---

### Phase 3: Task System Unification & Operator Visibility
**Priority:** HIGH — Structural coherence, foundation for future features
**Effort:** 1-2 weeks

#### 3.1 — Unified Task Model
**What:** Merge SQLite jobs, per-agent task queues, and scheduled tasks into one task model with unified dashboard.
**Files:** `backend/jobs.py` (extend), `backend/routes/agents.py` (task endpoints), `frontend/src/components/JobsPanel.tsx` (unify)
**Acceptance:** Single `/api/tasks` endpoint. Dashboard shows all tasks regardless of source. Filter by agent, status, type.

#### 3.2 — Structured Progress Events
**What:** Agents emit structured plan/progress updates (steps, substeps, completion %) that render as step-by-step UI.
**Files:** `backend/mcp_bridge.py` (progress tool enhancement), `frontend/src/components/ProgressCard.tsx`
**Acceptance:** Agent progress shows as checklist in UI. Steps update in real-time. Completion percentage visible.

#### 3.3 — Operator Dashboard Enhancement
**What:** Unified view: active tasks, agent health, cache stats, recent errors. Single "control room" screen.
**Files:** `frontend/src/components/StatsPanel.tsx` (extend), new dashboard components
**Acceptance:** One screen shows system health at a glance. No clicking through multiple panels needed.

---

### Phase 4: Provider Expansion & Caching
**Priority:** HIGH — Competitive parity on model access
**Effort:** 1 week

#### 3.1 — Provider Registry Expansion
**What:** Add remaining providers: Amazon Bedrock, Kimi (Moonshot), Z.AI (GLM), BytePlus/Volcengine.
**Files:** `backend/providers.py`
**Acceptance:** All providers appear in Settings > AI. API key configuration works. Model lists accurate.
**Note:** Qwen, Fireworks, StepFun, MiniMax already added (stashed, ready to commit).

#### 3.2 — Prompt Cache Optimization
**What:** Deterministic MCP tool ordering in system prompts. Normalized system-prompt fingerprints. Cache-aware message history management.
**Files:** `backend/mcp_bridge.py`, `backend/wrapper.py`
**Acceptance:** Anthropic/OpenAI cache hit rate measurable. Tool inventory ordering is stable across requests. `/api/diagnostics` shows cache stats.

#### 3.3 — Provider Request Overrides
**What:** Shared transport controls: custom headers, auth, proxy, TLS settings per provider.
**Files:** `backend/providers.py`, `backend/routes/misc.py` (config endpoint)
**Acceptance:** Provider config supports `overrides: { headers, proxy, tls }`. Applied to all requests for that provider.

---

### Phase 5: Media Generation
**Priority:** MEDIUM — Differentiator but not core
**Effort:** 1-2 weeks

#### 4.1 — Video Generation Tool
**What:** `video_generate` MCP tool. Route to provider APIs (Google Veo, xAI). Async task tracking.
**Files:** `backend/mcp_bridge.py` (new tool), `frontend/src/components/ChatMessage.tsx` (video rendering)
**Acceptance:** Agent can generate videos via MCP. Videos render inline in chat. Progress tracking during generation.

#### 4.2 — Music Generation Tool
**What:** `music_generate` MCP tool. Route to MiniMax or other providers. Async delivery.
**Files:** `backend/mcp_bridge.py`, `frontend/src/components/ChatMessage.tsx` (audio player)
**Acceptance:** Agent can generate music. Audio player renders inline. Async status tracking.

---

### Phase 6: Memory & Intelligence Upgrade
**Priority:** MEDIUM — Long-term differentiator
**Effort:** 2-3 weeks

#### 5.1 — Weighted Memory Recall
**What:** Memory entries gain relevance scores based on recency, access frequency, and explicit importance. Search results weighted by these scores.
**Files:** `backend/agent_memory.py`
**Acceptance:** Recently accessed memories rank higher. Frequently referenced memories persist longer. Configurable decay rate.

#### 5.2 — Memory Tagging & Categories
**What:** Memory entries support tags and categories for organized retrieval.
**Files:** `backend/agent_memory.py`, `backend/mcp_bridge.py` (memory tools)
**Acceptance:** `memory_save` accepts tags. `memory_search` can filter by tag. UI shows tags on memory entries.

#### 5.3 — Prompt Cache Diagnostics
**What:** `/api/diagnostics` includes cache hit/miss rates. UI shows cache efficiency per provider.
**Files:** `backend/routes/misc.py`, `frontend/src/components/settings/AdvancedTab.tsx`
**Acceptance:** Cache stats visible in diagnostics. Shows hit rate, estimated savings.

---

### Phase 7: UI & Accessibility
**Priority:** MEDIUM — Quality of life
**Effort:** 2-3 weeks

#### 6.1 — Systematic Accessibility Pass
**What:** aria-labels on ALL interactive elements. Focus traps in all modals. Keyboard navigation everywhere. Screen reader testing.
**Files:** All 61 components
**Acceptance:** axe-core scan: 0 critical/serious violations. Full keyboard navigation works.

#### 6.2 — Loading/Error/Empty States
**What:** Skeleton loaders for all async data. Error states with retry buttons. Empty states with helpful messages.
**Files:** All major panel components
**Acceptance:** No blank screens during data load. Every error shows user-actionable feedback. Every empty list shows a message.

#### 6.3 — AgentCockpit Decomposition
**What:** Split 1187-line AgentCockpit into focused sub-components.
**Files:** `frontend/src/components/AgentCockpit.tsx` → extracted tab components
**Acceptance:** AgentCockpit under 500 LOC. Each tab in its own file.

#### 6.4 — Light Theme Completion
**What:** All components properly styled for light mode. Currently only ~20% have light variants.
**Files:** `frontend/src/index.css`, all components with hardcoded dark colors
**Acceptance:** All 9 themes render correctly across every component. No hardcoded dark-mode colors.

---

### Phase 8: Platform & Integrations (Defer)
**Priority:** LOW — Large effort, specialized value
**Effort:** 4+ weeks

- Matrix bridge
- MS Teams bridge
- iOS push notifications
- macOS LaunchAgent / Windows Task Scheduler
- Claude CLI MCP bridge (loopback)
- Device pairing security
- Multilingual UI (i18n)
- ComfyUI integration

---

## Competitive Position (Updated 2026-04-06)

### GhostLink Unique Advantages
- **Multi-agent chat room** — 13+ heterogeneous agents in shared channels. No competitor does this.
- **Channel bridges** — Discord/Telegram/Slack/WhatsApp bidirectional sync
- **Desktop app** — Electron with auto-update, 9 themes, system tray, setup wizard
- **Full local-first** — zero telemetry, zero cloud dependency
- **Plugin system** with AST safety scanner
- **Ops toolkit** — diagnostics, backup/restore, server logs in UI
- **13 AI providers** with failover and cost tracking
- **Agent hierarchy** — manager/worker/peer roles with delegation

### After Phase 1-4, GhostLink Will Match OpenClaw On:
- Plugin security posture (allowlists, provenance, fail-closed hooks)
- Agent control depth (thinking level, context visibility, model switching)
- Provider coverage (20+ providers)
- Prompt caching optimization
- Task system unification

### Remaining Gaps (Phase 5-8, Lower Priority):
- Media generation (video/music)
- Advanced memory (dreaming/weighted recall)
- Additional channel bridges (Matrix, MS Teams)
- Mobile push notifications
- Multilingual UI
- Claude CLI loopback bridge

---

## Known Issues

| ID | Severity | Status | Description |
|----|----------|--------|-------------|
| All BUG-001 through BUG-097 | Various | **FIXED** | See BUGS.md — all resolved |
| ESLint `no-explicit-any` | LOW | Open | ~51 warnings (cosmetic, no runtime impact) |
| OneDrive path EPERM | LOW | Mitigated | Auto-copy to /tmp for WSL, safePublicCopy for Vite |

---

*End of Roadmap — v5.7.2 → v6.0.0*
