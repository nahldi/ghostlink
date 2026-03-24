# GhostLink — Unified Development Roadmap

> Single source of truth combining GAB (Backend Audit), GAF (Frontend Animation), V2.5 Bugfix, and Main Roadmap.
> **For any AI picking this up: follow the tiers IN ORDER. Each item has test criteria. Do NOT skip ahead.**

**Last updated:** 2026-03-24
**Current version:** v3.3.0
**Sources:** GAB_ROADMAP.md, GAF_ROADMAP.md, V2.5_BUGFIX_ROADMAP.md, ROADMAP.md, BUGS.md, STATUS.md
**Owner:** Finn (nahldi)

---

## Version History & What's Done

- **v1.0–v1.8:** Foundation, security, desktop app, agent intelligence, skills, UX, growth (80+ features)
- **v2.0–v2.3:** Plugin system, security hardening, Fernet encryption, bridges, SSRF/XSS fixes
- **v2.4.0:** WAL mode, 5 new providers, model failover, Framer Motion, skeletons, toasts, usage tracking
- **v2.5.0:** Agent identity injection, thinking output cleanup, channel fixes, virtualization
- **v2.5.1:** Electron security hardening, usage log cap, React render fixes
- **v2.6.0:** Backend fixes — deduplicate usage, thinking cleanup, bridge fixes
- **v2.9.0/v2.9.1:** Backend hardening — agent process lock, settings lock, SIGKILL escalation, atomic approval writes; CSS shimmer + stagger animations (Tiers 5-6)
- **v3.0.0:** Route split — 3401-line app.py → 13 route modules + deps.py (Tier 7)
- **v3.1.0:** Micro-interactions — motion.button spring, ReactionPicker AnimatePresence, AgentStatusPill color morph (Tier 8)
- **v3.1.1:** Integration tests — 17 tests covering message pipeline, agent/job lifecycle, secrets, concurrent rules (Tier 9)
- **v3.2.0/v3.3.0:** Premium effects — StreamingText word reveal, ThinkingParticles SVG orbit, Toast stacking + swipe-dismiss, useLongPress, MobileSidebar drag gesture, mobile CSS fixes (Tiers 10-11)

**56+ bugs fixed. ~8 open bugs. 90+ features live. 90+ API endpoints.**

---

## How to Use This Roadmap

Each item follows the cycle:
1. **Diagnose** — read all relevant code, understand root cause
2. **Plan** — draft fix approach, consider edge cases
3. **Fail test** — write a test that currently fails (proves bug exists)
4. **Fix** — implement the change
5. **Smoke test** — verify fix works in happy path
6. **Stress test** — edge cases, rapid inputs, concurrency
7. **Verify** — confirm no regressions, check related code
8. **Commit** — atomic commit with proper semver bump, update CHANGELOG.md

---

## TIER 0: Quick Wins (No Dependencies, Any Order)
**Version bump:** v2.5.2 (patch)
**Effort:** 1–2 hours total

These are standalone fixes from GAB that require zero infrastructure:

| ID | Fix | File(s) | Time |
|----|-----|---------|------|
| QW-1 | Read and log agent wrapper stdout/stderr | wrapper.py | 5 min |
| QW-2 | Remove dead `_empty_read_count` code | wrapper.py | 2 min |
| QW-3 | Add TTL to `_memory_cache` dict | agent_memory.py | 10 min |
| QW-4 | Cap reactions at 50 per message | app.py | 10 min |
| QW-5 | Log FTS5 errors before fallback | store.py | 5 min |
| QW-6 | Mask bridge tokens in logs | bridges.py | 5 min |
| QW-7 | Fix clipboard API check in CodeBlock | CodeBlock.tsx | 5 min |
| QW-8 | Fix O(n) pop(0) in log handler | app.py | 5 min |

**Commit:** `v2.5.2: Quick wins — token masking, memory cache TTL, reaction cap, log fixes`

---

## TIER 1: Critical Security (Backend)
**Version bump:** v2.6.0 (minor — security-impacting changes)
**Effort:** 2–3 days
**Source:** GAB Phase 1, V2.5 Bugfix
**Depends on:** Tier 0 (test infra)

### 1.0 — Test Infrastructure (GAB Phase 0)
**What:** Set up pytest with fixtures for FastAPI test client, temp SQLite DB, mock registry.
**Files:** NEW `tests/conftest.py`, `requirements-dev.txt`
**Why:** Every subsequent fix needs a test.
**Verify:** `pytest tests/ -v` runs and passes with at least a health check test.

### 1.1 — Fix encryption key derivation (GAB BUG-C2)
**What:** Replace predictable `data_dir:username` key material with random master key file.
**Files:** `backend/security.py` lines 51-54
**Fail test:** Two SecretsManagers with same data_dir + username should have DIFFERENT keys.
**Fix:** Generate random 32-byte master key file at `{data_dir}/.master_key` with `os.urandom(32)`. `chmod 0o600`.
**Migration:** Re-encrypt existing secrets on first access with new key.
**Smoke test:** Store/retrieve secret roundtrip works.

### 1.2 — Remove XOR fallback (GAB BUG-C1)
**What:** Make `cryptography` a hard requirement. Raise ImportError if not installed.
**Files:** `backend/security.py` lines 30-31, 61-66
**Fix:** `if not HAS_FERNET: raise ImportError("cryptography package is required")`
**Verify:** `requirements.txt` already lists `cryptography==43.0.3`.

### 1.3 — Fix hardcoded Fernet salt (GAB BUG-C3)
**What:** Generate random per-installation salt stored at `{data_dir}/.salt`.
**Files:** `backend/security.py` line 58
**Fail test:** Two installations produce different salts.
**Migration:** Detect old-salt secrets and re-encrypt.

### 1.4 — Fix duplicate /api/usage endpoint (GAB BUG-C4)
**What:** Remove duplicate at ~line 1943, keep the newer one at ~line 3210.
**Files:** `backend/app.py`
**Fail test:** POST usage data → GET usage data → roundtrip works.
**Verify:** No other code references the old `_usage` dict.

### 1.5 — Fix agent process tracking race (GAB BUG-C5)
**What:** Store processes by registered name, not `{base}_{pid}`.
**Files:** `backend/app.py` lines 1288-1304, 1341-1344
**Fail test:** Kill claude-1 should not affect claude-2.
**Smoke test:** Spawn/kill cycles don't leave orphans.

### 1.6 — Fix image upload Content-Type trust (V2.5 H04)
**What:** Validate actual file content, not just client-provided Content-Type.
**Files:** `backend/app.py`
**Fix:** Use `python-magic` or file header sniffing for image validation.

### 1.7 — Fix XOR encryption still available as fallback (V2.5 H07)
**What:** Hard-block XOR path (overlaps with 1.2).
**Verify:** Combined with 1.2 above.

**Commit:** `v2.6.0: Critical security — random key derivation, unique salts, no XOR fallback, process tracking fix`

---

## TIER 2: Agent Lifecycle & Spawn Fixes (Backend)
**Version bump:** v2.6.1
**Effort:** 2–3 days
**Source:** GAB Phase 2, V2.5 Section 4
**Depends on:** Tier 1

### 2.1 — Fix Gemini PATH detection (GAB)
**What:** Change `bash -lc` to `bash -ic` for WSL agent detection.
**Files:** `backend/app.py` lines 1110-1127
**Smoke test:** `GET /api/agent-templates` returns `gemini` with `available: true`.

### 2.2 — Cache agent detection results globally (GAB)
**What:** Module-level `_AGENT_AVAILABLE_CACHE` with 60-second TTL.
**Files:** `backend/app.py` lines 1083-1100
**Fail test:** Second call to `/api/agent-templates` is 5x+ faster.

### 2.3 — Skip approval watcher when auto-approve is on (GAB)
**What:** Don't start `_approval_watcher` thread when `--dangerously-skip-permissions` is in args.
**Files:** `backend/wrapper.py` lines 910-920

### 2.4 — Add SIGKILL escalation (GAB BUG-H4)
**What:** After SIGTERM, wait 5s, then SIGKILL if process still alive.
**Files:** `backend/app.py` kill_agent and shutdown endpoints
**Smoke test:** Hung agents cleaned up within 8 seconds.

### 2.5 — Fix Gemini spawn end-to-end (V2.5 BUG-C02)
**What:** Verify MCP settings format, fix transport type, add permission presets to UI.
**Files:** `backend/wrapper.py` lines 105-109, `frontend/src/components/AddAgentModal.tsx`
**Smoke test:** Install Gemini CLI → spawn from UI → agent registers → sends/receives messages.

### 2.6 — Agent readiness signal
**What:** Agent reports "ready" after MCP connect; UI shows loading until then.
**Files:** `backend/wrapper.py`, `frontend/src/components/AddAgentModal.tsx`
**Smoke test:** Spawn agent → UI shows "Starting..." → shows "Online" only when ready.

**Commit:** `v2.6.1: Agent lifecycle — Gemini fix, detection cache, SIGKILL escalation, readiness signal`

---

## TIER 3: Data Integrity & State Management (Backend)
**Version bump:** v2.6.2
**Effort:** 2–3 days
**Source:** GAB Phase 3
**Depends on:** Tier 1

### 3.1 — Fix settings concurrent mutation (GAB BUG-H2)
**What:** Add `asyncio.Lock()` around all `_settings` dict mutations.
**Files:** `backend/app.py`
**Fail test:** 10 concurrent settings writes → all 10 keys present.

### 3.2 — Persist session state across restart (GAB BUG-M6)
**What:** Save session state to SQLite on each state change.
**Files:** `backend/sessions.py`
**Fail test:** Session at phase 2 survives restart.

### 3.3 — Persist rule epoch counter (GAB BUG-M7)
**What:** Store epoch in DB alongside rules.
**Files:** `backend/rules.py`

### 3.4 — Fix thinking buffer memory leak (GAB BUG-H1)
**What:** Clean up buffers on deregister. Add 5-minute TTL expiry.
**Files:** `backend/app.py`

### 3.5 — Fix approval response file race (GAB BUG-H5)
**What:** Use atomic file writes (write to temp, then `os.replace`).
**Files:** `backend/app.py`, `backend/wrapper.py`

### 3.6 — Persist webhooks/usage/activity across restart (V2.5 H05)
**What:** Write in-memory-only data to SQLite periodically.
**Files:** `backend/app.py`

### 3.7 — Fix rate limiter per-client isolation (V2.5 H06)
**What:** Rate limiter shared across all proxied clients — scope per IP.
**Files:** `backend/app.py`

**Commit:** `v2.6.2: Data integrity — settings lock, session persistence, epoch persistence, leak fixes`

---

## TIER 4: Frontend Critical Fixes (GAF Phase 0)
**Version bump:** v2.7.0 (minor — visible UI changes)
**Effort:** 1–2 days
**Source:** GAF Phase 0
**Depends on:** None (can run in parallel with Tiers 1-3)

### 4.1 — Add syntax highlighting to CodeBlock (GAF P0-1)
**What:** Wire up `rehype-highlight` (already installed) to `ReactMarkdown` in `ChatMessage.tsx`.
**Files:** `frontend/src/components/ChatMessage.tsx`, `frontend/src/components/CodeBlock.tsx`
**Steps:**
1. Add `rehypeHighlight` to `ReactMarkdown` rehypePlugins array
2. Pass `className` (hljs classes) through `MdCode` to `CodeBlock`
3. Import a highlight.js dark theme CSS (e.g., `atom-one-dark`)
**Smoke test:** Code blocks in JS, Python, TS, HTML, CSS, bash, JSON all render with colored syntax.
**Verify:** Copy button still copies raw text. Line numbers still work. Works across all 9 themes.

### 4.2 — Wire up unused CSS animations (GAF P0-2)
**What:** Apply existing `stagger-in`, `float-in`, `bubble-glow` CSS animations to components.
**Files:** `SearchModal.tsx`, `JobsPanel.tsx`, `RulesPanel.tsx`, `ActivityTimeline.tsx`, `App.tsx`, `ChatMessage.tsx`
**Steps:**
- `stagger-in` → search results, job cards, rule cards, timeline events
- `float-in` → ConversationStarters buttons, EmptyState
- `bubble-glow` → agent message bubbles on hover
**Verify:** `prefers-reduced-motion` already covers these via global CSS rule.

### 4.3 — Document @tanstack/react-virtual (GAF P0-3)
**What:** The dep is installed but unused. Current `.slice(-200)` approach works but loses old messages. Document as tech debt for Phase 2 proper virtualization.
**Action:** Add TODO comment in `App.tsx` near `VIRTUALIZE_THRESHOLD`.

**Commit:** `v2.7.0: Frontend critical — syntax highlighting, CSS animations wired up`

---

## TIER 5: MCP & Bridge Hardening (Backend)
**Version bump:** v2.7.1
**Effort:** 3–4 days
**Source:** GAB Phase 4, V2.5 Bugfix
**Depends on:** Tier 2

### 5.1 — Fix Codex proxy_flag template splitting (GAB BUG-MCP-2)
**What:** Use `shlex.split()` instead of `str.split()` for template expansion.
**Files:** `backend/wrapper.py` line 229

### 5.2 — Fix Gemini settings JSON dual-key (GAB BUG-MCP-3)
**What:** Determine which key Gemini CLI reads (`httpUrl` vs `url`) and remove the other.
**Files:** `backend/wrapper.py` lines 108-112

### 5.3 — Add backpressure to MCP bridge callbacks (GAB)
**What:** Use `asyncio.wait_for(callback(), timeout=5)` with fire-and-forget fallback.
**Files:** `backend/mcp_bridge.py`

### 5.4 — Fix MCP proxy sender injection trust (GAB)
**What:** Validate agent name in requests matches the proxy's assigned agent.
**Files:** `backend/mcp_proxy.py` line 219

### 5.5 — Fix bridges hardcoded port 8300 (V2.5 H01)
**What:** Read port from config instead of hardcoding.
**Files:** `backend/bridges.py`

### 5.6 — Fix Slack bridge auto-start (V2.5 H02)
**Files:** `backend/bridges.py`

### 5.7 — Fix Discord connected before token verified (V2.5 H03)
**Files:** `backend/bridges.py`

### 5.8 — Fix Telegram bridge blocks shutdown 35s (V2.5 L03)
**Files:** `backend/bridges.py`

**Commit:** `v2.7.1: MCP & bridge hardening — proxy trust, shlex fix, backpressure, bridge port/auth fixes`

---

## TIER 6: Frontend Animation Layer (GAF Phase 1)
**Version bump:** v2.8.0
**Effort:** 3–4 days
**Source:** GAF Phase 1
**Depends on:** Tier 4

### 6.1 — AnimatePresence on all panels and modals (GAF P1-1)
**What:** Wrap conditional renders in `AnimatePresence` with spring exit animations.
**Files:** `App.tsx`, `Sidebar.tsx`
**Components:** RightPanel, MobilePanel, MobileSidebar, SearchModal, KeyboardShortcutsModal, HelpPanel, SessionLauncher, AddAgentModal, AgentInfoPanel, ChannelSummary, TerminalPeek, ReplayViewer, SplitView
**Also:** Add `<MotionConfig reducedMotion="user">` at app root (P1-1b).

### 6.2 — Staggered list animations (GAF P1-2)
**What:** Use Framer Motion `staggerChildren` on message lists, search results, job/rule cards.
**Constraint:** Only stagger on initial channel load, NOT individual new messages. Use `key={activeChannel}`.

### 6.3 — Shimmer skeleton loaders (GAF P1-3)
**What:** Replace opacity pulse with CSS gradient shimmer. Fix broken `--bg-tertiary` variable.
**Files:** `Skeleton.tsx`, `index.css`

### 6.4 — Button & toggle micro-interactions (GAF P1-4)
**What:** Spring physics on toggles via `motion.div layout`. `whileHover`/`whileTap` on buttons.
**Files:** `SettingsPanel.tsx` (Toggle), all button components

**Commit:** `v2.8.0: Animation layer — AnimatePresence, stagger, shimmer, spring buttons`

---

## TIER 7: Backend Architecture (GAB Phase 5)
**Version bump:** v3.0.0 (major — structural refactor)
**Effort:** 5–7 days
**Source:** GAB Phase 5
**Depends on:** Tiers 1-3, 5

### 7.1 — Split app.py into route modules
**What:** Extract 95+ endpoints into ~13 separate route files using FastAPI `APIRouter`.
**Target files:**
- `routes/messages.py` (10 endpoints)
- `routes/agents.py` (18 endpoints)
- `routes/channels.py` (5 endpoints)
- `routes/jobs.py` (4 endpoints)
- `routes/rules.py` (4 endpoints)
- `routes/schedules.py` (4 endpoints)
- `routes/sessions.py` (8 endpoints)
- `routes/security.py` (12 endpoints)
- `routes/plugins.py` (9 endpoints)
- `routes/providers.py` (5 endpoints)
- `routes/bridges.py` (5 endpoints)
- `routes/export.py` (4 endpoints)
- `routes/misc.py` (remaining)
**Fail test:** `wc -l app.py` > 3000 lines.
**Verify:** All endpoints respond correctly. No circular imports.

### 7.2 — Replace file-based IPC with SQLite queue
**What:** Replace `{agent}_queue.jsonl` polling with `trigger_queue` SQLite table.
**Fail test:** Under high trigger frequency, file operations lose triggers.
**Smoke test:** 100 rapid @mentions all delivered.

### 7.3 — Add agent workspace path validation (GAB BUG-H6)
**What:** Resolve and validate workspace paths. Block traversal (`../../etc`).
**Fail test:** `POST /api/agents/claude-1/config` with `workspace: "../../../../etc"` → 400.

### 7.4 — Fix deprecated asyncio.get_event_loop() (V2.5 M02)
**Files:** `backend/app.py`

### 7.5 — Fix plugin reimport on every API call (V2.5 M06)
**Files:** `backend/plugin_loader.py`

### 7.6 — Fix cron local time vs UTC (V2.5 L04)
**Files:** `backend/schedules.py`

**Commit:** `v3.0.0: Architecture — route split, SQLite queue IPC, path validation`

---

## TIER 8: Frontend Micro-Interactions (GAF Phase 2)
**Version bump:** v3.1.0
**Effort:** 3–4 days
**Source:** GAF Phase 2
**Depends on:** Tier 6

### 8.1 — Chat message polish (GAF P2-1)
- Action bar: staggered icon entrance (slide-up + fade)
- Message deletion: `AnimatePresence` with `exit={{ opacity: 0, height: 0, scale: 0.95 }}`
- Collapse/expand: smooth height animation
- Reaction picker: spring-in from button position

### 8.2 — Input & command palette polish (GAF P2-2)
- Input focus: animated border-glow expansion
- Slash commands: slide-up with staggered items
- @mention autocomplete: same pattern
- Send button: `whileTap` + brief color flash

### 8.3 — Agent state transitions (GAF P2-3)
- Status dot: color morph via `animate={{ backgroundColor }}`
- Status text: `AnimatePresence mode="wait"` crossfade
- Spin border: opacity fade in/out
- Online/offline: chip opacity transition

### 8.4 — StatsPanel number animations (GAF P2-4)
- `useSpring` from Framer Motion for all numeric displays
- Apply to: message count, agent count, token estimate, cost, session time

### 8.5 — ConnectionBanner animation (GAF P2-5)
- Slide-down on appear, slide-up on disappear
- Pulsing "Reconnecting..." with rotating sync icon

**Commit:** `v3.1.0: Micro-interactions — message polish, input glow, state transitions, animated numbers`

---

## TIER 9: Testing & CI (GAB Phase 6)
**Version bump:** v3.1.1
**Effort:** 5–7 days
**Source:** GAB Phase 6
**Depends on:** Tier 7

### 9.1 — Unit tests for all backend modules
**Target:** 80%+ line coverage on non-app.py modules.
**At least one test per public function** in each of the 15 backend modules.

### 9.2 — Integration tests for critical flows
- Agent spawn → register → heartbeat → kill lifecycle
- Message send → route → deliver → MCP read
- Approval prompt → UI response → tmux injection
- Secret store → encrypt → retrieve → decrypt

### 9.3 — CI pipeline (GitHub Actions)
- `pytest --cov` on every PR
- Linting with `ruff`
- Type checking with `pyright` or `mypy`
- Security scan with `bandit`

### 9.4 — Load testing
- Benchmark with `locust`: 50 WS clients, 100 msg/sec, 10 simultaneous spawns

**Commit:** `v3.1.1: Testing & CI — unit tests, integration tests, GitHub Actions pipeline`

---

## TIER 10: Premium Effects (GAF Phase 3)
**Version bump:** v3.2.0
**Effort:** 3–4 days
**Source:** GAF Phase 3
**Depends on:** Tier 8

### 10.1 — Streaming text animation (GAF P3-1)
**What:** Client-side word-by-word reveal for new agent messages (15ms/word).
**Constraint:** Only for NEW messages, not historical. Code blocks appear as units.

### 10.2 — Thinking particles (GAF P3-2)
**What:** SVG orbiting particles around agent chip during thinking state.
**4-6 circles with randomized orbit speeds, agent-colored.**

### 10.3 — Toast improvements (GAF P3-3)
**What:** Stacking with offset, swipe-to-dismiss, max 5 visible.

### 10.4 — Theme transition animation (GAF P3-4)
**What:** CSS `transition` on `html` for smooth cross-fade between themes.

**Commit:** `v3.2.0: Premium effects — streaming text, thinking particles, toast stacking, theme transitions`

---

## TIER 11: Mobile & Responsive (GAF Phase 4)
**Version bump:** v3.3.0
**Effort:** 2–3 days
**Source:** GAF Phase 4
**Depends on:** Tiers 6, 8

### 11.1 — Mobile message actions via long-press (GAF P4-1)
**What:** 500ms long-press on message shows action menu (react, reply, copy, pin, bookmark, delete).
**Fix the CSS rule at `index.css:410-413`** that blanket-hides hover actions on mobile.

### 11.2 — Mobile sidebar gesture support (GAF P4-2)
**What:** Swipe-from-left-edge to open sidebar, swipe-right to close.
**Use Framer Motion `drag` on sidebar.**

**Commit:** `v3.3.0: Mobile — long-press actions, sidebar gestures`

---

## TIER 12+: Main Roadmap Features (Future)

These are from ROADMAP.md Phases 11-20. Only begin after Tiers 0-11 are complete and stable.

### Phase 11: Model Providers & AI (HIGH priority)
- 11.1 Additional providers (Mistral, OpenRouter, Azure, Bedrock, DeepSeek) — **PARTIALLY DONE in v2.4.0**
- 11.2 Model routing & failover — **DONE in v2.4.0**
- 11.3 Streaming token-by-token responses
- 11.4 RAG (document upload, chunking, vector store, MCP tool)
- 11.5 Advanced context management (compaction, caching, overflow recovery)

### Phase 12: Mobile App (HIGH priority)
- 12.1 PWA with service worker, push notifications
- 12.2 React Native iOS + Android

### Phase 13: Observability & Analytics (MEDIUM)
- 13.1 Agent performance dashboard (token/cost/latency/error tracking)
- 13.2 Langfuse/OpenTelemetry integration
- 13.3 Health monitor enhancements (auto-restart, alerts, resource monitoring)

### Phase 14: Advanced UX & Polish (MEDIUM)
- 14.1 Canvas/artifact view (expand agent outputs full-screen)
- 14.2 Agent workspace viewer (file tree, git status, diff viewer)
- 14.3 Drag & drop agent orchestration (visual workflow builder)
- 14.4 Multi-language UI (i18n)
- 14.5 WCAG 2.1 AA accessibility audit

### Phase 15: Enterprise & Cloud (MEDIUM)
- 15.1 Multi-user support (accounts, roles, shared/private channels)
- 15.2 Docker Compose deployment
- 15.3 GhostLink Cloud (hosted SaaS)

### Phase 16: Computer Control & Vision (HIGH — differentiator)
- 16.1 Hybrid computer control (accessibility APIs + vision)
- 16.2 Screen streaming to chat

### Phase 17: Agent Intelligence v2 (HIGH)
- 17.1 Autonomous agent mode (goal → breakdown → execute → report)
- 17.2 Agent memory graph (cross-session knowledge graph)
- 17.3 Agent specialization training (feedback → system prompt evolution)
- 17.4 A2A (Agent-to-Agent) protocol support

### Phase 18: Voice & Multimodal (MEDIUM)
- 18.1 Voice rooms (WebRTC + STT + TTS)
- 18.2 Image generation pipeline
- 18.3 Document understanding (OCR, chunking, citation)

### Phase 19: UX Polish & Delight (MEDIUM)
- 19.1 Theme creator (visual editor, export/import, community gallery)
- 19.2 Notification center
- 19.3 Command palette v2 (search everything)
- 19.4 Onboarding v2 (interactive first-run)
- 19.5 Keyboard shortcuts overhaul (rebindable, vim mode)

### Phase 20: Growth & Monetization (FUTURE)
- 20.1 Agent marketplace (rent trained agents)
- 20.2 GhostLink Teams (multi-user workspaces)
- 20.3 Analytics dashboard (pro)

---

## Open Bugs (Not Yet in a Tier)

| Bug | Severity | Status |
|-----|----------|--------|
| BUG-007: OneDrive paths not accessible from WSL | High | Partially fixed |
| BUG-011: Frontend dist path mismatch in packaged app | Medium | Partially fixed |
| BUG-014: Ghost logo broken image in packaged app | Low | Open |
| BUG-028: Many config tasks require terminal | High | Open |
| BUG-043: AddAgentModal setTimeout cleanup | Low | Fixed in v2.5.1 |
| BUG-045: Clipboard API not checked | Low | Open (Tier 0) |
| BUG-046: No OAuth sign-in for providers | High | Open (future) |
| ARCH-003: Desktop app requires WSL on Windows | High | Open (future) |

---

## Parallelization Strategy

```
PARALLEL TRACK A (Backend):          PARALLEL TRACK B (Frontend):
  Tier 0: Quick Wins                   Tier 4: Critical Fixes (P0)
  Tier 1: Critical Security            Tier 6: Animation Layer (P1)
  Tier 2: Agent Lifecycle              Tier 8: Micro-Interactions (P2)
  Tier 3: Data Integrity               Tier 10: Premium Effects (P3)
  Tier 5: MCP & Bridges                Tier 11: Mobile (P4)
  Tier 7: Architecture
  Tier 9: Testing & CI

Sequential dependencies:
  Backend: 0 → 1 → 2,3 (parallel) → 5 → 7 → 9
  Frontend: 4 → 6 → 8 → 10, 11 (parallel after 6+8)
```

Frontend and backend tracks can run in parallel as they touch different files.

---

## Effort Summary

| Tier | Category | Effort | Bugs Fixed |
|------|----------|--------|------------|
| **0** | Quick Wins | 1-2 hrs | 8 |
| **1** | Critical Security | 2-3 days | 7 |
| **2** | Agent Lifecycle | 2-3 days | 6 |
| **3** | Data Integrity | 2-3 days | 7 |
| **4** | Frontend Critical | 1-2 days | 3 |
| **5** | MCP & Bridges | 3-4 days | 8 |
| **6** | Animation Layer | 3-4 days | 4 |
| **7** | Architecture | 5-7 days | 6 |
| **8** | Micro-Interactions | 3-4 days | 5 |
| **9** | Testing & CI | 5-7 days | 0 (infra) |
| **10** | Premium Effects | 3-4 days | 4 |
| **11** | Mobile | 2-3 days | 2 |
| **TOTAL (Tiers 0-11)** | | **~33-46 days** | **60 items** |
| **Tiers 12+** | Future features | Ongoing | 35+ items |

---

## Phase Checklist (Run After Every Tier)

- [ ] `npx tsc -b --noEmit` — zero TypeScript errors
- [ ] `npx vite build` — successful frontend build
- [ ] `python -c "import app"` — backend imports clean
- [ ] `pytest tests/ -v` — all tests pass (once Tier 1 sets up test infra)
- [ ] No personal data committed (grep for usernames, hardcoded paths)
- [ ] Visual check: desktop + mobile + light mode
- [ ] Security review: no new XSS, SSRF, injection vectors
- [ ] Performance check: page load <2s, API response <200ms
- [ ] CHANGELOG.md updated with detailed entry
- [ ] BUGS.md updated — mark fixed bugs
- [ ] Commit with proper semver tag
- [ ] Push to GitHub

---

## Conflict Avoidance

- **GAB** touches ONLY `backend/` files
- **GAF** touches ONLY `frontend/src/components/*.tsx`, `frontend/src/index.css`, `frontend/src/App.tsx`
- Neither touches `desktop/` (except Tier 0 Electron fix already done in v2.5.1)
- They can be developed in parallel without merge conflicts

---

*End of Unified Roadmap — March 24, 2026*
