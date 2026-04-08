# GhostLink Changelog

## v6.0.0 — 2026-04-08
### Complete Multi-Agent Orchestration Platform
Full roadmap execution — Phases 0 through 9 plus Phase 10 promoted items.

- **Identity & Profiles** — stable agent_id, SQLite persistence, dual name/ID lookup, runtime isolation, drift detection, 4-layer profile inheritance, AGENTS.md reviewed import, rename-safe skills
- **Operator Control Plane** — unified task model, structured progress, thinking level picker, context visibility controls, stop/cancel, timeline-first audit with export
- **Durable Execution** — auto-checkpoints, tool-call journal replay, fork from checkpoint, pause/resume, artifact lineage
- **Policy & Security** — policy engine at MCP/shell choke points, approval tiers, egress/SSRF protection, secret redaction, circuit breakers, hook signing, task-level policy snapshots
- **Provider Independence** — transport abstraction layer, cost tracking with honest accounting, budget enforcement, failover routing, provider expansion (Bedrock, Kimi, Z.AI, BytePlus), prompt cache diagnostics
- **Evals & Trace Grading** — golden task corpus, 8-dimension grading, CI regression gates
- **Multi-Agent Execution** — per-agent worktree isolation, background executor with process isolation, arena mode, collaboration patterns, lifecycle hooks
- **Memory & Intelligence** — 4-layer stratification, weighted recall, MemoryGraph/RAGPipeline reconciled, conflict detection, observational memory, promotion
- **Media Generation** — video/music/image-edit MCP tools with async tracking, inline chat rendering, cost integration
- **A2A Interoperability** — agent card publication, remote discovery, cross-platform task delegation, inbound policy gating, shared-key auth
- **Productization** — versioned profiles/skills, rollout channels, policy-gated promotion, real rollback
- **Platform & Quality** — accessibility pass (ARIA, keyboard nav, focus management), loading/empty/error standardization, AgentCockpit decomposition, plan mode, code review agent, PID recycling detection, doctor CLI
- **Test coverage** — 277 backend + 112 frontend tests (up from 171 + 49 in v5.7.2)

## v5.7.2 — 2026-04-06
### Reliability, Performance, Architecture
- **Launcher/setup wizard fixes** — unified desktop/backend settings path, fixed setupComplete lifecycle so wizard doesn't re-appear, hardened server start health verification, made wizard→launcher transition atomic
- **Backend memory safety** — capped MCP invocation logs (200/agent, 50 agents max), file diff cache (100/agent), added cleanup_agent_state() for deregistration, batch message deletion
- **Export/share pagination** — unbounded SELECT * replaced with 1000-row paged queries with pagination metadata
- **Dead process reaping** — zombie agent processes now cleaned up automatically via reap_dead_agent_processes()
- **Token streaming perf** — appendToMessage no longer remaps entire message array per token (reverse scan + single clone)
- **Reconnect throttling** — WebSocket reconnect now fetches active channel first, batches agent state 3 at a time, skips offline agents
- **Component architecture** — SettingsPanel split from 2023→1300 LOC (SecurityTab + AdvancedTab extracted), ChatMessage 625→333 LOC, MessageInput 1103→825 LOC
- **Test coverage** — 220 total tests (171 backend + 49 frontend)

## v5.7.1 — 2026-04-06
### Safe Dependency Refresh
- **Frontend toolchain patches** — upgraded `vite` from `8.0.1` to `8.0.3` and `typescript-eslint` from `8.57.x` to `8.58.0`
- **Backend dependency patches** — upgraded `fastapi` to `0.135.3`, `uvicorn` to `0.43.0`, `python-multipart` to `0.0.24`, `mcp` to `1.27.0`, and `cryptography` to `46.0.6`
- **Release consistency** — synced runtime/package/SDK version strings to `5.7.1` and corrected stale package-lock metadata
- **Verification** — backend tests, frontend tests, lint, frontend build, and desktop TypeScript build all re-run clean on the upgraded set

## v5.7.0 — 2026-04-01
### Ops & Recovery Toolkit, Updater Fixes, Visual Reset
- **Health endpoint** — `/api/health` added for readiness checks and launcher polling
- **Diagnostics endpoint** — `/api/diagnostics` reports runtime checks for Python, disk space, database presence, agents, and package availability
- **Backup export** — `/api/backup` packages database, settings, and metadata for one-click recovery
- **Restore workflow** — restore-from-backup endpoint and Settings UI flow added with ZIP validation, path safety checks, and pre-restore safety backup
- **Settings UI wiring** — diagnostics, backup, and restore controls surfaced in the Settings panel
- **Updater reliability** — async updater WSL token lookup fixed and desktop IPC/error logging tightened
- **OneDrive-safe frontend build** — build flow adjusted for safer operation in synced Windows workspaces
- **File watcher leak fix** — watcher cleanup corrected to avoid long-running memory growth
- **Visual reset** — glass/glow excess stripped back in favor of cleaner minimal surfaces
- **Ruff and test cleanup** — backend linting, frontend stability, and test reliability polish rolled into the release

## v5.6.1 — 2026-03-31
### Fluidity Pass, Bridge Reliability, Test Coverage
- **Fluidity pass** — spring animations on message entrance, panels, modals, scroll-to-bottom button, agent bar chips, settings tabs, cockpit tabs, empty state cascade
- **Bridge retry + rate limiting** — exponential backoff on transient 429/5xx/network failures, per-destination outbound throttling
- **Frontend tests expanded** — 26 → 48 tests (timeago, chatStore channels/settings/bookmarks, API methods)
- **Backend tests expanded** — 106 → 122 tests (bridge retry regression, provider route coverage)
- **SDK version synced** — 0.1.0 → 5.6.0
- **Python ruff linting** — 126 auto-fixes, F821 undefined names resolved, deps.py TYPE_CHECKING complete
- **Sidebar fluidity** — nav button glow, channel button inner glow, press feedback
- **Input polish** — focus ring glow expansion, send button hover glow
- **Mobile perf** — reduced backdrop-filter blur at 768px breakpoint

## v5.6.0 — 2026-03-31
### Security Hardening, Liquid Glass Redesign, Runtime Fixes
- **Electron security** — `contextIsolation: true` + `sandbox: true` on all windows (was disabled on wizard/launcher)
- **Frontend lint zero** — burned 27 ESLint issues to 0 (real fixes + justified suppressions)
- **React hooks violation fixed** — conditional `useState` in AgentCockpit moved above early returns
- **Auth detection hardened** — Claude CLI auth uses positive pattern matching (no more false positives)
- **Claude --resume removed** — fresh sessions on restart avoid $0.15 cache miss per resume
- **MCP tool auth bypass fixed** — memory tools now enforce bearer token identity verification
- **Registry thread safety** — concurrent agent spawns no longer race on slot assignment
- **Router thread safety** — hop count tracking locked during read-modify-write cycle
- **ExecPolicy hardened** — null bytes and hex escapes stripped before blocklist matching
- **SSRF DNS rebinding fix** — post-connect IP validation closes TOCTOU gap in `web_fetch`
- **Memory key collision fix** — `foo/bar` and `foo_bar` no longer map to same file (SHA suffix)
- **SDK URL encoding** — `search()` query parameter properly encoded
- **Webhook signature fix** — double body read bug in inbound webhook handler corrected
- **Shutdown cleanup safety** — tmux session names properly quoted in shell commands
- **Process lifecycle** — backend no longer spawns as detached process group
- **Launcher quit fix** — close handler no longer blocks app exit during shutdown
- **ARIA accessibility** — modal dialogs have `role="dialog"` + `aria-modal`
- **Settings error toast** — API save failures shown to user instead of silently logged
- **Scroll performance** — `setChatAtBottom` only fires when value changes
- **Docs synced** — MCP tools 17→29, components 44→61, tests 57→132
- **Manifest.json fix** — explicit routes for root-level static files
- **Dynamic conversation starters** — empty chat adapts to online agents
- **Reply previews** — parent message context with click-to-scroll
- **Gemini session resume** — `--resume` flag for exec mode context persistence
- **Stale docs archived** — v4.x docs moved to `docs/archive/`

## v5.2.0 — 2026-03-30
### MCP-Native Persistent Agent Architecture
- **Persistent MCP Claude runner** — long-lived subprocess with stdin/stdout JSON pipes, no tmux dependency
- **Stream-json protocol** — structured message delivery, approval events, turn completion with cost/usage data
- **Multi-turn continuity** — session context preserved across conversation turns
- **Crash recovery** — auto-restart with fresh session + chat_read context catchup
- **Permission handling** — preset-based (full bypass / selective allowlist), denial surfacing to chat UI
- **MCP mode toggle** — experimental toggle in Add Agent modal for Claude agents
- **Cockpit MCP view** — invocation log with status, duration, cost per turn (replaces terminal pane)
- **Runner badge** — blue "MCP" / grey "TMUX" indicator in cockpit header
- **Cross-channel approval buttons** — Telegram inline keyboard (fully interactive), Discord visual buttons
- **Agent descriptions** — one-line beginner-friendly description for every agent in launcher
- **Quick Start guide** — 5-step README section from download to first chat
- **Two-tier restart** — resume first, fresh session fallback, 5s cooldown, full process reaping

## v5.1.5 — 2026-03-29
### In-App Auth + Experience Modes
- **In-app API key auth** — paste API keys directly in the launcher, no terminal needed
- **Encrypted key storage** — API keys encrypted via OS-level safeStorage (DPAPI/Keychain/libsecret)
- **In-app browser OAuth** — Claude and Codex auth opens browser automatically from the launcher
- **Experience modes** — Beginner/Standard/Advanced adapts SettingsPanel, AddAgentModal, AgentBar, CommandPalette
- **Honest Gemini auth** — removed fake `gemini auth login` claims, uses API key / gcloud path
- **Settings sanitizer** — preserves `encryptedKeys` and `experienceMode` through save/load

## v5.1.2 — 2026-03-29
### Multi-Agent Runtime + UX Overhaul
- **WSL detection fixed** — `wsl.exe -e` flag resolves argument parsing, full path in all files
- **All 13 CLI agents** in launcher with real install/connect/reconnect status
- **Multi-agent runtime** — Claude, Codex, Gemini spawn, register, route, and respond end-to-end
- **Free/Paid pricing badges** — every agent labeled Paid, Free Tier, Free + Setup, or Local
- **Experience mode system** — Beginner/Standard/Advanced picker in wizard and settings
- **Auth detection honesty** — `codex login status`, credential file checks, no false re-auth
- **Codex CLI commands corrected** — `codex login` (not `codex auth login`), correct bypass flag
- **Reconnect button** — amber "Reconnect" for stale auth, distinct from Connect/Install
- **Spawn race fix** — registration check prioritized over process exit check
- **Stale tmux cleanup** — auto-kills old `ghostlink-*` sessions on server start
- **OneDrive workspace warning** — wizard and spawn both warn about WSL/OneDrive path issues
- **Shared auth safety** — warns before spawning Codex if another instance is using shared auth
- **Spawn warnings in UI** — backend warnings surface as toast notifications in Add Agent modal
- **Launcher CSS polish** — gradient buttons, logo glow, pricing badge styles, hover effects
- **Docs clarified** — "13 CLI agents" vs "13 API providers" clearly separated everywhere
- **Agent colors synced** — consistent across auth detection, launcher, and frontend
- **Gemini provider label** — "Google DeepMind" corrected to "Google"
- **PATH expansion** — backend spawn includes `~/.local/bin`, `~/.npm-global/bin`, `/usr/local/bin`
- **tmux env export** — critical env vars (PATH, HOME, etc.) exported inline for npm CLIs
- **Continue false positive** fixed — `type -P` replaces `command -v` to skip shell builtins
- **Agent arg validation** — regex allows leading hyphens for `--flags`

## v4.11.0 — 2026-03-28
### Premium Upgrade — Agent Cockpit & Command Palette
- **Agent Cockpit** — in-app workspace viewer with Terminal, Files, Browser, Activity tabs
- **In-app file editor** — edit + save files with Ctrl+S, line numbers, file type icons
- **Browser visibility** — see agent web activity (URLs, search queries, page previews)
- **Command Palette** — Ctrl+K quick actions for agents, channels, themes, settings
- **Live data** — WebSocket events for terminal streams, browser state, presence, workspace changes
- **Replay + diff APIs** — step-by-step agent action history with unified diffs
- **Agent presence** — real-time status tracking (reading, running, editing)
- **File search** — filter workspace files by name
- **Agent-colored theming** — cockpit tabs, status dots, file icons use agent brand colors
- **Thinking preview** — agent thinking stream shown in cockpit header

### Security (v4.9.0)
- **Tunnel auth** — capability-URL based access tokens for remote sessions
- **Admin bootstrap** — first-user localhost-only guard
- **SSH injection fix** — validated + shell-quoted remote values
- **Plugin traversal fix** — regex + resolve containment
- **Reaction race** — serialized message reaction writes
- **Cursor lifecycle** — all hot-path SQLite cursors properly closed

## v4.8.7 — 2026-03-28
### Maintenance & Polish
- **Desktop toolchain** — upgraded to Electron 35.7.5, electron-builder 26.8.1
- **Zero vulnerabilities** — npm audit clean in both frontend and desktop
- **Bundle optimization** — main chunk 790KB→174KB via manual chunk splitting (markdown, react, motion vendors)
- **Frontend tests stabilized** — switched to happy-dom, 19/19 passing reliably
- **CI/CD** — GitHub Actions upgraded to v6, release pipeline rerun-safe with `gh` CLI

## v4.8.2 — 2026-03-28
### Backend Hardening
- **SSRF protection** — private URL check rejects non-HTTP(S), handles IPv6, checks all DNS results
- **Emoji validation** — proper Unicode range checking replaces broken ASCII check
- **Reply validation** — rejects non-positive and nonexistent reply_to message IDs
- **Registry** — rename race fixed, UIDs upgraded to full UUID hex
- **File locking** — portable lockfile-based append for Windows support
- **Plugin sandbox** — exact import allowlist enforced for community plugins
- **Provider resolution** — local providers only available when runtime is reachable
- **Type safety** — 11 new interfaces, 30+ `any` types replaced across api.ts and SettingsPanel
- **Tests** — WebSocket event tests, SSRF tests, emoji/reply route tests added

## v4.8.1 — 2026-03-28
### Regression Fixes & Auth Hardening
- **Auth terminal launch** — spawnInTerminal() now uses typed TerminalLaunchSpec with wrapper scripts instead of string interpolation
- **Updater error handling** — real update failures no longer masked as "up to date"
- **CSP tightened** — removed unsafe-eval from launcher/wizard HTML
- **Frontend regressions fixed** — sessionStart no longer resets on channel switch, AddAgentModal stabilized to prevent excessive API calls, SearchModal spinner clears on abort
- **AbortController wired** — search requests now properly cancelled via fetch signal
- **WebSocket type guards** — malformed messages rejected before switch dispatch
- **Export validation** — format whitelist now matches actual implementation (markdown, json, html)
- **URL preview** — memoized extraction, removed stale eslint comment

## v4.8.0 — 2026-03-28
### Security Hardening & Full Audit
- **Electron security** — removed shell-string path handling, all exec calls use argument arrays, symlink rejection in WSL copy, path traversal prevention
- **Window isolation** — wizard/launcher now use `nodeIntegration: false`, `contextIsolation: true` with preload bridge
- **Provider key encryption** — API keys routed through SecretsManager, legacy plaintext auto-migrated from providers.json
- **Settings validation** — allowlist-based sanitizer for settings.json, persistent agents command-whitelisted
- **Runtime resilience** — DB failures return 503 instead of crashing, WebSocket broadcast thread-safe, plugin loading guarded, hop counter auto-resets
- **Frontend fixes** — stale closures fixed in scroll/URL preview/search, AbortController for search races, bounded streamed IDs set, ErrorBoundary logging, sessionStart resets
- **Accessibility** — aria-live on connection banner, Escape key on context menus
- **Validation** — export format, reply_to type, HMAC secret non-empty check
- **Docs sync** — all version references updated, FEATURES.md planned→completed, STATUS.md changelog backfilled, DESKTOP_APP_PLAN.md OAuth→CLI auth
- **Version consistency** — pyproject.toml, GDPR export, desktop lockfile all synced

## v4.7.0 — 2026-03-26
### UI Polish & Visual Refinement
- **Sidebar animation** — channel panel slides in/out with spring physics (Framer Motion)
- **Settings tabs consolidated** — 7 tabs → 4 (General+Look, Agents, AI+Bridges, More=Security+Advanced)
- **Message action buttons** — larger hit areas (p-1→p-1.5, gap-0.5→gap-1), 14px icons, aria-labels
- **Input buttons** — consistent p-2.5 rounded-xl spacing, 1.5 gap between mic/call/send
- **Agent bar badges** — text-[8px]→text-[9px], rounded-md with more padding for readability
- **Global transitions** — all buttons/inputs have 0.2s cubic-bezier ease, active:scale(0.97)
- **Custom scrollbar** — thin 6px with purple-tinted thumb, transparent track
- **Recording UI** — red pulse + timer for voice notes with smooth cancel/send buttons

## v4.6.0 — 2026-03-26
### Voice Notes + Voice Call Mode
- **Voice Notes** — tap mic to record audio, sends as playable voice message with auto-transcription via Whisper
  - Recording UI: red dot + elapsed timer + cancel/send buttons
  - Backend `/api/voice-note`: transcribes + stores audio as base64 in message metadata
  - Inline audio player in ChatMessage with play button and duration display
- **Voice Call Mode** — live conversation with agent, full duplex voice
  - Phone icon opens full-screen call overlay with agent avatar
  - Continuous 4s audio chunk recording → transcribe → send → agent responds
  - Auto-TTS on agent responses (plays audio immediately)
  - Mute toggle, call timer, waveform visualizer, end call button
  - WebSocket watches for new agent messages to auto-speak

## v4.5.2 — 2026-03-26
### Final Audit — Zero Open Bugs
- **BUGS.md fully updated** — all fixed bugs marked FIXED with version numbers
- **UNIFIED_ROADMAP.md cleaned** — remaining issues table reduced to 4 items (was 10), backlog items marked DONE
- **Live tested** — all 25 Phase 4-7 API endpoints verified responding correctly
- **Version synced** — all 5 locations at v4.5.2

## v4.5.1 — 2026-03-26
### Completeness Release — All Phases Finished
- **25 new API endpoints** for Phases 4-7 (autonomous plans, memory graph, RAG, specialization, remote agents, auth)
- **Keyboard shortcuts system** — rebindable shortcuts with conflict detection, 12 default bindings
- **Repository map** — regex-based symbol extraction (381 symbols from 60 files in 0.1s), fits in 4K tokens
- **Vitest test foundation** — vitest.config.ts, test setup with JSDOM mocks, 2 test suites (api + chatStore)
- **Python ruff config** — pyproject.toml with ruff linting rules for backend CI
- **All roadmap items complete** — Phases 0-7 fully implemented and wired

## v4.5.0 — 2026-03-26
### Phase 7: Intelligence v3
- **Autonomous Agent Mode** — goal-driven planning with subtask decomposition, delegation, pause/resume, auto-summary
- **Memory Graph** — cross-session knowledge with TF-IDF semantic search, auto-linking related memories, graph traversal
- **Agent Specialization** — feedback-driven prompt evolution from thumbs up/down and corrections, auto-analysis of patterns
- **RAG Pipeline** — document upload, chunking (500 char with overlap), TF-IDF retrieval, context injection for agent prompts
- **Visual Workflow Builder** — drag-and-drop editor with 4 node types (trigger, agent, condition, action), SVG edges, properties panel
- **Multi-Language UI (i18n)** — 8 languages: English, Spanish, French, German, Japanese, Chinese, Korean, Portuguese

## v4.4.0 — 2026-03-26
### Phase 6: Cloud & Scale
- **Remote Agent Execution** — `RemoteRunner` spawns agents in Docker containers or on SSH hosts, monitors lifecycle, supports up to 8 parallel remote agents
- **Multi-User Auth** — `UserManager` with PBKDF2-SHA256 password hashing, session tokens, 3 roles (admin/member/viewer), user CRUD
- **Docker Compose** — one-command deployment with `docker compose up`, health checks, volume persistence, API key passthrough
- **A2A Protocol** — JSON-RPC 2.0 agent-to-agent bridge, agent card discovery at `/.well-known/agent.json`, register/deregister/send operations
- **PWA** — service worker with cache-first for static assets, push notifications, `manifest.json`, add-to-homescreen on mobile

## v4.3.0 — 2026-03-26
### Phase 5: Advanced UX & Frontend
- **Widget message type** — agents can return interactive HTML/JS rendered in sandboxed iframes with CSP
- **CanvasView download** — download button + Escape keyboard shortcut for full-screen artifact viewer
- **WorkspaceViewer git status** — per-file M/A/D/U indicators from `git status --porcelain`
- **ThemeCreator gallery** — 6 preset themes (Midnight, Ocean, Terminal, Sunset, Nord, Dracula)
- **Token streaming** — `chat_stream_token` MCP tool + WebSocket `token_stream` event for real-time character-by-character responses
- **Accessibility** — aria-labels on all Phase 5 component buttons
- **Emoji font fallback** — reaction badges use platform-native emoji fonts

## v4.2.3 — 2026-03-26
### Zero-Bug Release
- **0 ESLint errors** (down from 94) — all empty catch blocks annotated, purity violations fixed, stale deps fixed
- **Backend version synced** to 4.2.3 across all components (app.py, frontend, desktop)
- **Test hardening** — version assertion uses semver regex instead of hardcoded string
- **Emoji font fallback** — reaction badges now use Segoe UI Emoji/Apple Color Emoji/Noto Color Emoji
- **StreamingText** — removed synchronous setState in effect (cascading render fix)
- **Auto-commit triggers expanded** — now covers image_generate, text_to_speech, gemini_image
- **All BUGS.md items closed** — BUG-077, 084, 085, 086, 088, 089, 090 marked FIXED

## v4.2.2 — 2026-03-26
### React Purity & Audit
- ChatMessage: module-level ref mutation moved from useMemo to useEffect (React purity fix)
- MessageInput: added missing `addMessage`/`agents` to useCallback deps (stale closure fix)
- BUGS.md audit: marked BUG-084, 085/088, NOTE-002#4 as FIXED

## v4.2.1 — 2026-03-25
### Version Sync & Polish
- Version sync across all components, system message markdown, timezone fix, ESLint, auto-lint

## v4.2.0 — 2026-03-25
### Phase 4: Security UI
- Permission presets viewer, tool usage audit log

## v4.1.0 — 2026-03-25
### Phase 3: Headless & Automation
- Python SDK, CLI mode, webhook delivery, cron job scheduler

## v4.0.0 — 2026-03-25
### Phase 2: Agent Intelligence v2 + Phase 0-1
- First-run wizard, personalization, agent context injection, MCP tool hooks

## v3.9.8 — 2026-03-25
### Phase 0: Stability Baseline
- Zero-bug baseline, 56 tests, comprehensive error handling

## v3.9.7 — 2026-03-25
### Plan Mode & TTS
- Plan mode enforcement wired into tool wrapper, cleanup_agent race fix, TTS play button

## v3.9.6 — 2026-03-25
### Connection Stability
- WebSocket keepalive ping/pong (25s), server stop on Windows fix, QR code

## v3.9.5 — 2026-03-24
### Agent Identity v2
- Agent registration passes role to server, thinking UI compact dots, streaming text batching

---

## v3.9.4 — 2026-03-24

### Agent Identity Fix
- **Preset labels/roles injected into agent context** — spawning a "Code Reviewer" now writes a soul like "You are Code Reviewer. Your role: Reviews PRs and suggests improvements."
- Frontend passes `roleDescription` from preset to spawn API
- Backend passes `GHOSTLINK_AGENT_LABEL` and `GHOSTLINK_AGENT_ROLE` env vars to wrapper
- Soul auto-persisted to `data/{agent}/soul.txt` so it survives restarts
- Context template now leads with soul identity, not generic "You are claude-2"
- `chat_join` message shows label (e.g. "Code Reviewer (@claude) is online")

---

## v3.9.3 — 2026-03-24

### Settings Panel Redesign
- **Collapsible `Section` component** — reusable card with icon + title + chevron toggle, smooth CSS transition
- **General tab**: Profile (open), Date & Time, Voice, Notifications sections
- **Agents tab**: Routing (open), Persistent Agents (open), Supported Agents, Marketplace, Skill Packs, Hooks
- **Appearance tab**: Theme (open), Typography, Info Panel
- **AI tab**: Capabilities (open), Providers (open)
- **Security tab**: Secrets (open), Data Retention, Data Management, Audit Log
- **Advanced tab**: Debug (open), Server Config, Server Logs, Maintenance
- Tab bar icons bumped 16px → 18px, labels 10px → 11px
- SettingField labels bumped 10px → 11px
- Net -59 lines: cleaner code, better visual hierarchy

---

## v3.9.2 — 2026-03-24

### Thinking UI Redesign
- Removed ugly `<pre>` monospace block with raw terminal output
- Removed oversized SVG ThinkingParticles orbiting circles
- New: compact bubbles with agent-colored tint, animated "thinking..." dots, max 4 truncated lines
- Added `thinking-dots` CSS keyframe animation

### Message Send Shake/Glitch Fix
- **Root cause**: Triple animation conflict — CSS `msg-enter`, Framer Motion `itemVariants`, and ChatMessage's own `motion.div` all fighting
- Removed `msg-enter` CSS class from ChatMessage
- Removed duplicate `motion.div` wrappers from ChatMessage (replaced with plain `<div>`)
- Removed stagger animation list in ChatFeed that re-triggered ALL animations on every new message

### Agent Identity (chat_who + context)
- `chat_who` now returns rich metadata: name, label, role, base type, human user
- Context template instructs agents to use `chat_join`/`chat_who` for teammate discovery
- Trigger prompts inject online teammate info when agents get @mentioned

### Multi-Agent Support
- Added MCP builtin defaults for grok, aider, goose, copilot
- Added identity injection for aider (`.aider.conventions.md`), grok (`.grok/instructions.md`), generic fallback (`INSTRUCTIONS.md`)
- Enhanced WSL detection: npx, nvm paths, npm global bins, pip
- Better error messages when agent CLI not found

### Backend Fixes
- Thread safety: `_empty_read_count` protected with `_presence_lock`
- AgentBar: no longer swallows errors silently
- TypingIndicator: only updates state when visible list changes (perf)
- MessageInput: fixed stale `pendingAttachments` closure

---

## v3.3.2 — 2026-03-24

### Bug Fixes (13 fixes)
- **BUG-073 CRITICAL**: Removed `db_file.unlink()` in DB recovery that crashed on FUSE/WSL filesystems. SQLite now initializes 0-byte files directly.
- **BUG-074**: Deduplicated `_save_settings()` — canonical version in `app_helpers.py`, route modules delegate.
- **BUG-075**: `_VALID_AGENT_NAME` regex — `agents.py` now imports from `deps.py` instead of redeclaring.
- **BUG-076**: `BridgeManager` now receives `server_port` from config instead of hardcoded 8300.
- **BUG-079**: Usage log truncation now logged when entries are trimmed.
- **BUG-080**: FTS5→LIKE search fallback now logged with exception details.
- **QW-2**: Initialized `_empty_read_count` dict in `mcp_bridge.py` (was undefined — would crash at runtime).
- **QW-3**: Added 5-minute TTL to `_memory_cache` in `agent_memory.py`.
- **QW-8**: Replaced O(n) `list.pop(0)` with `collections.deque(maxlen)` for server logs and activity log.
- **Desktop**: Added `cryptography` to WSL pip install commands.
- **Frontend**: `uploadImage()` now checks response status before parsing JSON.
- **Frontend**: WebSocket reconnection catch block now logs warnings instead of swallowing errors.
- All open bugs resolved, mitigated, or documented.
- Version synced to 3.3.2 across backend/frontend/desktop.

---

## v3.3.1 — 2026-03-24

### Bug Fixes (7 fixes)
- **BUG-067 HIGH**: Updated `requirements.txt` to compatible pins (fastapi 0.135.2, mcp 1.26.0, starlette 1.0.0). Fresh install now works.
- **BUG-068**: Audit log now references `__version__` instead of hardcoded "2.5.1".
- **BUG-069**: Fixed `MessageRouter(reg)` → `MessageRouter()` in all tests. Prevents latent TypeError in production hop-guard.
- **BUG-070**: Added DB recovery logic for empty/corrupt SQLite files — auto-restores from `.bak` or creates fresh.
- **BUG-071**: Synced version to 3.3.1 across backend/frontend/desktop.
- **BUG-045**: Fixed clipboard API in `RemoteSession.tsx` with textarea fallback.
- **BUG-043**: Confirmed already fixed (spawnTimerRef cleanup in AddAgentModal).

---

## v3.3.0 — 2026-03-24

### Full Codebase Polish
- All 13 backend route modules updated and hardened.
- Frontend: premium animations (StreamingText, ThinkingParticles, Toast spring), mobile sidebar swipe, AgentBar/ChatMessage/MessageInput polish.
- Desktop: launcher UI refresh, package updates.
- Tests: conftest/core/integration/modules updated for v3.3.0 compatibility.
- Docs: STATUS/BUGS/CHANGELOG/ROADMAP updated.
- Added: 7 audit documents, 6 UI screenshots, test config.
- Dependencies: requirements.txt and package.json updates across all layers.

---

## v3.2.0 — 2026-03-24

### Premium Effects (Tier 10)
- **StreamingText** (`StreamingText.tsx`): Client-side word-by-word reveal for new agent messages (15ms/word). Only for NEW messages, not historical. Code blocks appear as units.
- **ThinkingParticles** (`ThinkingParticles.tsx`): SVG orbiting particles around agent chip during thinking state. 4-6 circles with randomized orbit speeds, agent-colored.
- **Toast stacking** (`Toast.tsx`): Stacking with offset, swipe-to-dismiss via Framer Motion drag, max 5 visible.

### Mobile (Tier 11)
- **useLongPress** (`useLongPress.ts`): 500ms long-press on message shows action menu (react, reply, copy, pin, bookmark, delete). 10px movement cancellation.
- **MobileSidebar gesture** (`MobileSidebar.tsx`): Swipe-from-left-edge to open, swipe-right to close via Framer Motion drag.

---

## v3.1.1 — 2026-03-24

### Testing (Tier 9)
- 17 new integration tests covering message pipeline, agent lifecycle, job lifecycle, secrets round-trip, approval atomicity, concurrent rules, agent memory isolation.
- Total: 56 tests across 3 test files.

---

## v3.1.0 — 2026-03-24

### Micro-Interactions (Tier 8)
- `motion.button` with spring physics on all interactive elements.
- ReactionPicker AnimatePresence with spring-in from button position.
- AgentStatusPill color morphing via `animate={{ backgroundColor }}`.
- StatsPanel animated values with slide+fade on change.
- ConnectionBanner slide-down/slide-up with pulsing reconnect animation.

---

## v3.0.0 — 2026-03-24

### Architecture (Tier 7)
- **Route split**: `app.py` reduced from 3,401 → 612 lines.
- **13 route modules**: agents, bridges, channels, jobs, messages, misc, plugins, providers, rules, schedules, search, security, sessions.
- **`deps.py`**: Shared state module — all stores, registries, managers, locks, config.
- **`app_helpers.py`**: Shared helper functions to avoid circular imports.

---

## v2.9.0 — 2026-03-24

### Backend Hardening
- **Agent process lock** (`deps.py`): `_agent_lock` protects concurrent spawn/kill operations.
- **Settings lock** (`deps.py`): `_settings_lock` prevents concurrent JSON file corruption.
- **SIGKILL escalation**: Kill endpoint sends SIGTERM, waits 3s, then SIGKILL if process survives.
- **Atomic approval writes**: Write to temp file → `os.replace()` for crash-safe approvals.

### Frontend Animations (Tier 6)
- CSS shimmer skeleton loaders.
- Staggered list animations on channel load.

---

## v2.8.0 — 2026-03-24

### Animations & Polish
- Bubble glow hover effect on agent messages.
- ConnectionBanner spring slide animation.
- Search result stagger cascade.
- StatsPanel animated value transitions.

---

## v2.7.0 — 2026-03-24

### Frontend Critical (Tier 4)
- Syntax highlighting via rehype-highlight (180+ languages).
- AnimatePresence on all panels and modals.
- MotionConfig reducedMotion at app root.
- Skeleton shimmer fix.

---

## v2.6.0 — 2026-03-24

### Bug Fixes
- Deduplicated /api/usage endpoint.
- Thinking buffer cleanup on deregister.
- Discord token verification before connected state.
- Slack bridge auto-start fix.
- Bridge port configuration (no more hardcoded 8300).
- Plugin loader reimport optimization.
- asyncio.get_event_loop() → get_running_loop().

---

## v2.5.2 — 2026-03-24

### Security
- Random key derivation with per-install master key.
- Random per-install Fernet salt.
- XOR fallback removed for new secrets.
- Image upload magic byte validation.
- Workspace path traversal guard.
- Localhost rate limit exemption.

---

## v2.5.1 — 2026-03-23
- Electron launcher context isolation hardened.
- Usage log memory cap (10,000 entries).
- React render mutation fix in ChatMessage.
- Timer cleanup on AddAgentModal unmount.

## v2.5.0 — 2026-03-23
- Agent context injection on spawn (.ghostlink-context.md).
- Thinking output ANSI stripping and sanitization.
- Gemini MCP settings format fix.
- Per-channel typing indicators.
- Message list virtualization (200+ threshold).

## v2.4.0 — 2026-03-23
- SQLite WAL mode + 64MB cache.
- 5 new providers (Mistral, OpenRouter, DeepSeek, Perplexity, Cohere).
- Model failover with priority ordering.
- Framer Motion animations, skeletons, toasts, empty states.
- Token & cost tracking.

## v2.3.0 — 2026-03-23
- Fernet encryption for secrets (AES-128-CBC + HMAC-SHA256).
- Localhost-only /api/send.
- SSRF protection on webhooks.
- WebSocket token auth.
- MCP auto-approve tightened.
- Plugin safety scanner improved.

## v2.2.0 — 2026-03-23
- Folder picker fix, channel summary, MCP trigger text.

## v2.1.9 — 2026-03-23
- MCP config absolute paths.

## v2.1.8 — 2026-03-23
- SyntaxError fix — global declaration.
