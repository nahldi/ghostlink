# GhostLink Changelog

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
