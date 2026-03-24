# GhostLink Changelog

## v2.7.0 — 2026-03-24

### Frontend
- **Syntax highlighting** (`ChatMessage.tsx`, `CodeBlock.tsx`): Wired up `rehype-highlight` (already installed) to `ReactMarkdown`. Code blocks now render with colored syntax tokens via highlight.js `atom-one-dark` theme. Supports JS, Python, TS, HTML, CSS, bash, JSON, and 180+ other languages.
- **Skeleton fix** (`Skeleton.tsx`): Replaced undefined `--bg-tertiary` CSS variable with themed `bg-outline-variant/15` for proper visibility across all themes.
- **AnimatePresence on all panels** (`App.tsx`): Settings, Jobs, Rules panels now slide in/out with spring physics. Search, Shortcuts, Help, Session modals fade+scale. Mobile panel slides up/down. All exit animations work correctly.
- **MotionConfig reducedMotion** (`App.tsx`): Added `<MotionConfig reducedMotion="user">` at app root. Framer Motion now respects OS `prefers-reduced-motion` setting.

### Desktop
- **Version bump**: `2.6.0` → `2.7.0`

---

## v2.6.0 — 2026-03-24

### Bug Fixes
- **Deduplicated /api/usage** (`backend/app.py`): Removed legacy `/api/usage` GET+POST endpoints (lines ~2015-2030) that wrote to an orphaned `_usage` dict. The v2.4.0 version using `_usage_log` is now the sole endpoint.
- **Thinking buffer cleanup** (`backend/app.py`): `_thinking_buffers` now cleaned on agent deregister, preventing memory leak from accumulated thinking state of disconnected agents.
- **Discord token verification** (`backend/bridges.py`): Discord bridge no longer marks `connected=True` before verifying the bot token. Token is validated via `/users/@me` on first poll.
- **Slack bridge auto-start** (`backend/bridges.py`): `start_all_enabled()` now checks for `url` (webhook) in addition to `token`, so Slack bridges auto-start correctly.
- **Bridge port configuration** (`backend/bridges.py`): `BridgeManager` now accepts `server_port` parameter, injected into bridge configs. Removes hardcoded 8300 fallback.
- **Plugin loader optimization** (`backend/plugin_loader.py`): `list_plugins()` now checks `sys.modules` before calling `importlib.import_module`, avoiding unnecessary reimport overhead.
- **Deprecated asyncio fix** (`backend/app.py`): Replaced `asyncio.get_event_loop()` with `asyncio.get_running_loop()` for Python 3.12+ compatibility.
- **Dynamic version** (`backend/app.py`): Added `__version__ = "2.6.0"` at module level for programmatic version access.

### Desktop
- **Version bump**: `2.5.7` → `2.6.0`

---

## v2.5.2 — 2026-03-24

### Security
- **Random key derivation** (`backend/security.py`): Replaced predictable SHA256(data_dir+username) key material with a random 32-byte master key persisted at `.master_key`. Each installation now has a unique encryption key. Old secrets are auto-migrated on first load.
- **Random per-install Fernet salt** (`backend/security.py`): Replaced hardcoded `"ghostlink-v1"` salt with a random 16-byte salt persisted at `.salt`. Prevents cross-installation decryption.
- **XOR fallback removed** (`backend/security.py`): `cryptography` is now a hard dependency. XOR encryption path removed for new secrets. Legacy XOR data is still readable for migration only.
- **Image upload magic byte validation** (`backend/app.py`): Upload endpoint now validates file magic bytes (PNG, JPEG, GIF, WebP, SVG) instead of trusting client Content-Type header. Blocks spoofed uploads.
- **Workspace path traversal guard** (`backend/app.py`): Agent spawn endpoint now validates and resolves workspace paths. Blocks traversal to system directories (`/etc`, `/usr`, `C:\Windows`, etc.).
- **Localhost rate limit exemption** (`backend/app.py`): Local clients (127.0.0.1, ::1) are now exempt from IP-based rate limiting. Prevents MCP proxy agents from exhausting the shared rate limit.

### Stability
- **Dead code removal** (`backend/mcp_bridge.py`): Removed unused `_empty_read_count` dict that was declared but never incremented.
- **Reaction cap** (`backend/store.py`): Reactions now capped at 50 unique emoji per message and 100 users per emoji to prevent abuse.

---

## v2.5.1 — 2026-03-23

### Security
- **Electron launcher hardened** (`desktop/main/launcher.ts`): Disabled `nodeIntegration`, enabled `contextIsolation`, and wired up the existing preload script. The launcher renderer now uses `window.api` (exposed via contextBridge with channel allowlisting) instead of direct `require('electron')`. Closes the XSS-to-RCE vector in the launcher window.

### Stability
- **Usage log memory cap** (`backend/app.py`): `_usage_log` is now capped at 10,000 entries. When full, the oldest 20% is trimmed. Prevents unbounded memory growth over long sessions.
- **React render mutation fix** (`frontend/src/components/ChatMessage.tsx`): Agent color map building moved from direct module-level mutation during render to `useMemo`. Eliminates a potential React concurrent mode race condition.
- **Timer cleanup on unmount** (`frontend/src/components/AddAgentModal.tsx`): The spawn status fetch timer is now stored in a ref and cleared on component unmount. Prevents "setState on unmounted component" warnings.

### Desktop
- **Version bump**: `2.5.0` → `2.5.1`

---

## v2.5.0 — 2026-03-23

### Agent Identity (Critical Fix)
- **Agent context injection on spawn** (`backend/wrapper.py`, `backend/agent_memory.py`): Agents now receive a comprehensive `.ghostlink-context.md` file in their workspace when spawning. This tells them they're in GhostLink (not Discord), how to use MCP tools, their identity, and how to respond in chat. Provider-specific injection: Claude gets `.claude/instructions.md`, Codex gets `.codex/instructions.md`, Gemini gets `systemInstruction` in its settings JSON.
- **Enhanced default SOUL** (`backend/agent_memory.py`): The `GHOSTLINK_CONTEXT_TEMPLATE` provides detailed platform context, available MCP tools, communication rules, and behavioral guidelines.
- **`generate_agent_context()` function** — programmatic context generation with agent name and soul personality injection.

### Thinking Output (Critical Fix)
- **ANSI escape code stripping** (`backend/wrapper.py`): Thinking output now strips all terminal escape codes (colors, cursor movement, etc.) before displaying in the UI.
- **Command line filtering** — Startup commands, flags (`--dangerously-skip-permissions`, `--mcp-config`, etc.), config paths, and env var assignments are filtered out of the thinking stream. Users no longer see raw CLI chrome.
- **Blank line cleanup** — Empty lines and tmux padding are stripped. Only meaningful content is shown.
- **`_sanitize_thinking()` function** — centralized sanitization with configurable filter patterns.

### Gemini Spawn Fix
- **MCP settings format** (`backend/wrapper.py`): Gemini settings JSON now includes both `httpUrl` and `url` fields for maximum compatibility across Gemini CLI versions.
- **System instruction injection** — Gemini agents receive their SOUL/context via the `systemInstruction` field in the settings JSON.

### Channel & Routing Fixes
- **Approval prompts target correct channel** (`backend/wrapper.py`): Approval request messages now post to the channel where the agent was last active, instead of always #general. A shared `_last_channel` tracker is updated by the queue watcher and read by the approval watcher.
- **Per-channel typing indicators** (`frontend/src/stores/chatStore.ts`, `frontend/src/components/TypingIndicator.tsx`): Typing state is now scoped per-channel. When an agent types in #backend, the indicator only shows when viewing #backend — not in every channel.

### Performance
- **Message list virtualization** (`frontend/src/App.tsx`): When a channel has 200+ messages, only the most recent 200 are rendered in the DOM. Prevents browser slowdown with large message histories while keeping recent messages fully interactive.
- **@tanstack/react-virtual** added as dependency for future full virtualization support.

### Desktop
- **Version bump** (`desktop/package.json`): `2.4.0` → `2.5.0`

---

## v2.4.0 — 2026-03-23

### Performance
- **SQLite WAL mode** (`backend/store.py`): Enabled WAL journal mode, NORMAL sync, and 64MB page cache for dramatically better concurrent read performance.
- **Model catalog caching** (`backend/providers.py`): 5-minute TTL cache via `get_cached_models()` avoids re-scanning provider registry on every request.
- **HTTP connection pooling** (`backend/app.py`): Shared `aiohttp.ClientSession` with 100-connection pool and DNS caching, created in lifespan and reused for all outbound HTTP.

### New Model Providers
- **Mistral AI** — Mistral Large, Codestral, Pixtral Large (chat + code + vision)
- **OpenRouter** — Meta-provider routing to 200+ models with a single API key
- **DeepSeek** — DeepSeek Chat + DeepSeek Reasoner (reasoning)
- **Perplexity** — Sonar Pro + Sonar (search-augmented generation)
- **Cohere** — Command R+, Command R, Embed v3 (enterprise RAG)
- **Model failover** (`providers.py`): `resolve_with_failover()` method tries providers in priority order, skipping failed ones. Enables automatic recovery when a provider returns errors.

### UI Polish
- **Framer Motion animations** — Message slide-in animations on both user and agent messages via `motion.div` in `ChatMessage.tsx`.
- **Loading skeletons** (`Skeleton.tsx`): `Skeleton`, `MessageSkeleton`, `AgentSkeleton`, `ChannelSkeleton` components replace spinners with smooth pulsing placeholders.
- **Toast notifications** (`Toast.tsx`): Spring-animated toast system with success/error/warning/info types. Usage: `toast('Saved!', 'success')`.
- **Empty state component** (`EmptyState.tsx`): Animated empty state with icon, title, description, and optional CTA button.
- **Premium CSS micro-interactions**: `.hover-lift` (translateY + shadow), `.hover-glow` (accent glow), `.press-scale` (click feedback), custom scrollbars, focus ring animations, theme crossfade transitions, typing dot bounce animation, skeleton pulse keyframes.

### Usage Tracking
- **Token & cost tracking** (`backend/app.py`): `_track_usage()` records per-request token counts with cost estimation across 9 providers. `GET /api/usage` returns aggregated usage data.

### Desktop
- **Version bump** (`desktop/package.json`): `2.3.0` → `2.4.0`

---

## v2.3.0 — 2026-03-23

### Security

- **Fernet encryption for secrets** (`backend/security.py`): `SecretsManager` now uses AES-128-CBC via `cryptography.fernet` when the `cryptography` package is installed. Falls back to XOR for old data (prefix detection) and when the package is unavailable. Keys derived via PBKDF2-HMAC-SHA256, 100k iterations.
- **Localhost-only /api/send** (`backend/app.py`): The message send endpoint now rejects requests from non-localhost clients with HTTP 403. Prevents external actors from injecting messages when the server is reachable over a tunnel or LAN.
- **SSRF protection on webhooks** (`backend/app.py`): `_deliver_webhooks` now calls `_is_private_url()` before each outbound POST. Requests to private/loopback/link-local addresses are blocked and logged. Closes the SSRF vector where a configured webhook URL could hit internal services.
- **WebSocket token auth** (`backend/app.py`): Non-localhost WebSocket clients must pass `?token=<token>` query param. Token is generated at startup (`secrets.token_urlsafe(32)`) and retrievable via `GET /api/ws-token` (localhost only). Prevents unauthenticated external WS connections.
- **Tighter MCP auto-approve** (`backend/wrapper.py`): Replaced loose substring checks (`'ghostlink' in pane_text`) with a compiled regex `_GHOSTLINK_MCP_RE` that only matches the actual MCP tool call format (`ghostlink/tool_name` or `ghostlink.tool_name`). Prevents accidental auto-approval of unrelated prompts that mention "ghostlink".
- **Improved plugin safety scanner** (`backend/plugin_loader.py`): `install_plugin` now tries `SafetyScanner` from `plugin_sdk` first (AST-based). Falls back to extended string matching (8 patterns vs. old 3) if scanner is unavailable.

### Dependencies

- **Pinned all backend dependencies** (`backend/requirements.txt`): Switched from `>=` to `==` pins for all 8 packages. Added `cryptography==43.0.3`.

### Desktop

- **Version bump** (`desktop/package.json`): `2.2.0` → `2.3.0`

---

## v2.2.0 — 2026-03-23

- Fix folder picker in desktop app
- Fix channel summary display
- Fix MCP trigger text for agents

## v2.1.9 — 2026-03-23

- Fix MCP config — absolute paths so agents find their config from any working directory

## v2.1.8 — 2026-03-23

- Fix SyntaxError — move global declaration to function level
