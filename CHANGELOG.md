# GhostLink Changelog

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
