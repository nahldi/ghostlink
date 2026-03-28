# GhostLink — Project Status & Handoff

**Last updated:** 2026-03-25
**Version:** v4.7.3
**Owner:** Finn (FinnTheDogg / nahldi / nahlidify)
**GitHub:** https://github.com/nahldi/ghostlink (public)
**License:** MIT

---

## WHAT IS GHOSTLINK

GhostLink is a local-first multi-agent AI chat platform. It puts all your AI agents (Claude, Codex, Gemini, Grok, and more) in one shared chat room where they talk to each other and to you in real time. Think Discord for AI agents — you're the admin, they're your team.

**Key value props:**
- Multiple AI providers in one interface (no more switching tabs)
- Agents can collaborate, hand off tasks, debate approaches
- Everything runs locally — your data never leaves your machine
- Works with free AI (Gemini free tier, Ollama local models)
- Desktop app with one-click install, auto-updates

---

## HOW IT WORKS

```
┌─────────────────────────────────────────┐
│            Your Browser (UI)            │
│  React 19 + TypeScript + Tailwind       │
└──────────────┬──────────────────────────┘
               │ WebSocket + REST
┌──────────────▼──────────────────────────┐
│         FastAPI Server (:8300)           │
│  Messages, Channels, Jobs, Settings     │
├─────────────────────────────────────────┤
│         MCP Bridge (:8200/:8201)        │
│  Tools: chat_send, chat_read, etc.      │
└──────┬──────────┬──────────┬────────────┘
       │          │          │
  ┌────▼───┐ ┌───▼────┐ ┌───▼─────┐
  │ Claude │ │ Codex  │ │ Gemini  │
  │ (tmux) │ │ (tmux) │ │ (tmux)  │
  └────────┘ └────────┘ └─────────┘
```

1. User opens the desktop app (Electron) or web UI at localhost:8300
2. Backend manages messages, agents, channels, settings in SQLite
3. MCP bridge gives agents tools to read/send messages
4. Agent wrappers launch each AI CLI in a tmux session
5. Everything talks via WebSocket — updates are instant

---

## TECH STACK

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+, FastAPI, aiosqlite, uvicorn, MCP SDK (FastMCP) |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand |
| Desktop | Electron 33, electron-builder, electron-updater |
| Database | SQLite with FTS5 full-text search |
| Agent Execution | tmux sessions managed by wrapper.py |
| Communication | MCP over HTTP + SSE, WebSocket for real-time UI |
| CI/CD | GitHub Actions (builds Windows, Linux, macOS on version tags) |
| Tunnel | Cloudflare (cloudflared) for remote access |

---

## CURRENT STATE (v4.7.3)

### Recent Changes (v3.9.8 → v4.7.3)
- **v4.7.1–v4.7.3**: Tunnel remote access fixes, service worker cache-first fix, CSS specificity fix.
- **v4.7.0**: UI polish — sidebar animation, settings consolidation, spacing fixes.
- **v4.6.0**: Voice notes + voice call mode.
- **v4.5.0–v4.5.2**: Phase 7 completeness — snapshot import/export, GDPR tools, data retention, audit log viewer.
- **v4.4.0**: Phase 6 remote & auth — tunnel support, remote access, CLI auth detection.
- **v4.3.0**: Phase 5 advanced — autonomous mode, memory graph, RAG pipeline, agent specialization.
- **v4.2.0–v4.2.3**: Phase 4 security — encrypted secrets, exec policies, sandbox, approval interception.
- **v4.1.0**: Phase 3 headless & automation — CLI `--full-auto`, diff/chart cards, Python SDK.
- **v4.0.0**: Phase 2 agent intelligence — plan mode UI, memory search, auto-lint/test, delegation.
- **v3.10.0**: Phase 1 personalization — first-run wizard, agent nicknames, layout toggles.
- **v3.9.8**: Phase 0 stability — version sync, system messages, emoji, timezone, ESLint, bundle splitting.

### Numbers
- **90+ completed features** (see FEATURES.md for full list)
- **51 React components** (StreamingText, ThinkingParticles, Toast, Section, etc.)
- **132+ API endpoints** (split into 13 route modules)
- **17 MCP tools** (chat_send, chat_read, chat_join, chat_who, chat_channels, chat_rules, chat_progress, chat_propose_job, chat_react, chat_claim, memory_save, memory_load, memory_list, memory_search, web_search, web_fetch, image_generate)
- **13 known AI agents** (Claude, Codex, Gemini, Grok, Copilot, Aider, Goose, Pi, Cursor, Cody, Continue, OpenCode, Ollama)
- **13 AI providers** (Anthropic, OpenAI, Google, xAI, Mistral, DeepSeek, Perplexity, Cohere, OpenRouter, Groq, Together, HuggingFace, Ollama)
- **5 channel bridges** (Discord, Telegram, Slack, WhatsApp, Generic Webhook)
- **9 themes** (dark, light, cyberpunk, terminal, ocean, sunset, midnight, rosegold, arctic)
- **28 built-in skills**
- **23 slash commands**
- **5 plugins** (auto_commit, auto_lint, example, file_watcher, skill_marketplace)
- **3 platform installers** (Windows .exe, Linux .AppImage/.deb, macOS .dmg)

### What's Working
- Full chat with real-time WebSocket messages, typing indicators, reactions
- Agent spawning from UI with model selection, workspace picker, permission presets
- @mention routing, @all broadcast, smart auto-routing (keyword classification)
- Agent hierarchy (manager/worker/peer), pause/resume, response modes
- Approval prompt interception (catches CLI permission prompts, shows Allow/Deny in chat)
- Progress cards, handoff cards, decision cards, generative UI cards
- Message editing, bookmarking, pinning, search (FTS5), export (markdown/JSON/HTML)
- Session snapshots (export/import), message templates, agent DM channels
- Scheduled tasks with cron expressions and background checker
- Agent memory (persistent per-agent JSON), SOUL identity, notes, skills
- Terminal peek (live tmux view) + visible terminal (opens real terminal window)
- Drag & drop file upload, rich URL previews (OpenGraph)
- Command palette (Ctrl+K), keyboard shortcuts, command history (Up/Down arrows)
- Onboarding tour (6-step walkthrough for new users)
- In-app Help/FAQ panel (12 topics, searchable)
- Plugin system with auto-discovery (plugins/ directory)
- Skills marketplace (browse, create, export/import custom skills)
- File change feed (monitors agent workspaces)
- Desktop notifications with quiet hours
- Cloudflare tunnel for remote/mobile access
- Auto-update from GitHub releases
- Dashboard analytics API (message stats, token usage, costs)
- Agent feedback (thumbs up/down stored in memory)
- Voice input (Web Speech API push-to-talk)
- Share conversations as self-contained HTML
- Skill safety scanning (content validation for custom skills)
- API rate limiting (300 req/min per IP)
- Token expiration with auto-rotation on heartbeat
- Channel bridges — Discord, Telegram, Slack, WhatsApp, Generic Webhook
- Streaming thinking bubbles — live agent reasoning in chat
- Provider API key verification on save
- Server log viewer in Settings > Advanced
- Server config viewer in Settings > Advanced
- Persistent agent editor — edit label, args, color, workspace from UI
- Webhook signature verification (HMAC-SHA256)
- GhostHub plugin marketplace — browse, install, uninstall community plugins
- AST-based plugin safety scanner (replaces string matching)
- EventBus with 13 standard events for plugin hooks
- 5 skill packs (Developer, Research, Creative, DevOps, Communication)
- Hook system — event-driven automation (on_message, on_agent_join, etc.)
- Encrypted secrets manager for API keys and tokens
- Per-agent exec approval hardening (command allowlist/blocklist)
- GDPR data export (ZIP), deletion (with confirmation), retention policies
- Security audit log with rotation and thread-safe writes
- Settings has 7 tabs: General, Look, Agents, AI, Bridges, Security, Advanced

### What's Not Done Yet
- Native Windows support without WSL (wrapper rewrite needed)
- OAuth sign-in for providers (currently API key only)
- Plugin marketplace with installable packages
- Docker sandbox for agent execution
- Mobile app (PWA or React Native)
- Multi-user support
- Streaming token-by-token responses

---

## DIRECTORY STRUCTURE

```
ghostlink/
├── .github/workflows/     # CI/CD — builds all 3 platforms on version tags
│   └── build.yml
├── backend/               # Python FastAPI backend
│   ├── app.py             # Main server: 77+ endpoints, WebSocket, SPA middleware
│   ├── mcp_bridge.py      # MCP server: 10 tools on ports 8200/8201
│   ├── wrapper.py          # Agent launcher: tmux, MCP config, approval detection
│   ├── wrapper_unix.py    # tmux session management
│   ├── store.py           # SQLite + FTS5 message store
│   ├── registry.py        # Agent instance registry
│   ├── router.py          # @mention routing + smart classification + loop guard
│   ├── jobs.py            # Job tracking CRUD
│   ├── rules.py           # Shared rules CRUD
│   ├── schedules.py       # Cron scheduled tasks
│   ├── skills.py          # 16 built-in skills registry
│   ├── agent_memory.py    # Per-agent persistent JSON memory with file locking
│   ├── mcp_proxy.py       # Per-instance MCP identity proxy
│   ├── plugin_loader.py   # Plugin auto-discovery and loading
│   ├── config.toml        # Server config (ports, routing, paths)
│   ├── requirements.txt   # Python dependencies
│   ├── plugins/           # Drop-in Python plugins
│   │   ├── example.py
│   │   ├── file_watcher.py
│   │   └── skill_marketplace.py
│   ├── data/              # Runtime data (SQLite DB, settings — gitignored)
│   └── uploads/           # File uploads (gitignored)
├── frontend/              # React 19 + TypeScript + Vite 8 + Tailwind 4
│   ├── src/
│   │   ├── App.tsx        # Main layout + conversation starters + onboarding
│   │   ├── main.tsx       # Entry point
│   │   ├── index.css      # 9 themes, premium animations, liquid glass effects
│   │   ├── components/    # 37 React components
│   │   ├── stores/        # Zustand state management
│   │   ├── hooks/         # WebSocket + mention autocomplete
│   │   ├── types/         # TypeScript interfaces
│   │   └── lib/           # API client, WebSocket, sounds, timeago
│   └── dist/              # Built frontend (served by backend)
├── desktop/               # Electron 33 desktop app
│   ├── main/              # Main process (TypeScript → compiled JS)
│   │   ├── index.ts       # Window management, IPC, lifecycle
│   │   ├── server.ts      # Python backend lifecycle (WSL, venv, deps)
│   │   ├── launcher.ts    # Launcher window
│   │   ├── tray.ts        # System tray
│   │   ├── updater.ts     # Auto-update (GitHub releases, token reading)
│   │   └── auth/          # CLI auth detection (Claude, Codex, Gemini, GitHub)
│   ├── renderer/          # Launcher + wizard HTML/CSS/JS
│   ├── electron-builder.yml  # Build config (Windows, Linux, macOS)
│   └── dist/              # Built installers
├── FEATURES.md            # 76 completed features (verified against code)
├── BUGS.md                # Known bugs with status
├── ROADMAP.md             # Full development roadmap with phases
├── FeaturesRDM.md         # Feature ideas + skills research
├── README.md              # Public-facing documentation
├── DESKTOP_APP_PLAN.md    # Desktop app architecture
└── XPLAIN.md              # What is GhostLink (plain English explanation)
```

---

## PORTS

| Port | Service | Configurable |
|------|---------|-------------|
| 8300 | HTTP + WebSocket (main server) | Yes — config.toml `[server] port` |
| 8200 | MCP HTTP (streamable-http) | Yes — config.toml `[mcp] http_port` |
| 8201 | MCP SSE (Server-Sent Events) | Yes — config.toml `[mcp] sse_port` |

---

## FREE AI OPTIONS (no subscription needed)

| Agent | Cost | Install | Notes |
|-------|------|---------|-------|
| Gemini CLI | Free (1,000 req/day) | `npm i -g @google/gemini-cli` | Best free option. Just sign in with Google. |
| Ollama + Aider | Free (local) | `ollama pull qwen2.5-coder` + `pip install aider-chat` | Runs entirely on your machine. Need 8GB+ RAM. |
| Ollama + OpenCode | Free (local) | `curl -fsSL https://opencode.ai/install \| bash` | 95K GitHub stars. MCP native. |
| Goose | Free (local) | `brew install goose` | Works with Ollama. MCP native. |

Paid agents (Claude, Codex, Grok) require their respective subscriptions but all connect the same way.

---

## SECURITY

- **Fully local** — no data leaves your machine, no telemetry, no analytics
- **Agent identity** — bearer token authentication for all agent MCP calls
- **MCP proxy** — always injects correct sender identity, prevents impersonation
- **Path traversal protection** — `is_relative_to()` check on all static file serving
- **SSRF protection** — URL preview blocks private IPs, disables redirects
- **Input validation** — message length, sender name, channel name limits
- **Agent isolation** — per-agent memory directories, file locking (threading.RLock)
- **Config validation** — helpful errors on missing/malformed config.toml
- **No "system" impersonation** — removed from allowed human names
- **Token expiration** — agent tokens auto-rotate on heartbeat (1-hour TTL)
- **Rate limiting** — 120 requests/min per IP on all API endpoints
- **Skill safety scanning** — content validation blocks dangerous patterns in custom skills
- **ARIA labels** — accessibility attributes on main UI regions
- **Reduced motion** — CSS `prefers-reduced-motion` media query support

### Not yet implemented:
- OS keychain for OAuth tokens

---

## DESKTOP APP FLOW

1. **Install** — run `GhostLink-Setup-1.9.0.exe` (NSIS installer)
2. **First run** — setup wizard: platform detection → Python check → deps install → workspace selection → done
3. **Launcher** — shows server status, auth connections (Claude/Codex/Gemini/GitHub), settings, update check
4. **Start Server** — launches Python backend via WSL (handles OneDrive path detection, venv creation, dep installation)
5. **Chat window** — opens automatically, loads the full React UI from `http://127.0.0.1:8300`
6. **Stop server** — chat window closes, returns to launcher
7. **X button** — fully quits the app (no hidden tray process)
8. **Auto-update** — checks GitHub releases on launch, shows Download button, restart to apply

---

## CI/CD

GitHub Actions workflow (`.github/workflows/build.yml`) triggers on version tags (`v*`):

```bash
# To release a new version:
# 1. Bump version in desktop/package.json + desktop/renderer/launcher.html
# 2. Commit and push
# 3. Tag and push:
git tag v1.0.4
git push origin v1.0.4
# 4. CI builds Windows .exe, Linux .AppImage/.deb, macOS .dmg
# 5. All artifacts uploaded to GitHub Release automatically
```

---

## HOW TO DEVELOP

```bash
# Backend (in WSL or Linux)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py  # runs on :8300

# Frontend (hot reload)
cd frontend
npm install
npm run dev  # runs on :5173, proxies API to :8300

# Desktop (Electron dev mode)
cd desktop
npm install
npm run dev  # opens Electron with launcher

# Build installer
cd frontend && npm run build && cd ../desktop
npm run build:win   # Windows .exe
# Or push a version tag for CI to build all 3 platforms
```

---

## HANDOFF RULES

- **Never push personal data to GitHub** — SOUL.md, personal config.toml, local databases
- **Test everything** — fail test → fix test → smoke test before shipping
- **Finn is particular about visual quality** — reference Linear, Raycast, Arc Browser, Warp terminal
- **Audit before shipping** — compilation check all 3 codebases, verify every feature claim
- **Incremental versions** — bump patch version after each test cycle (1.0.3 → 1.0.4 etc.)
- **Don't add features during bug-fix phases** — fix everything first, then add features
- **Auto-update filename must match latest.yml** — use hyphens (GhostLink-Setup-1.0.3.exe) not spaces

---

## KNOWN ISSUES

See BUGS.md for full list. 72+ bugs fixed as of v3.9.4. All critical/high code bugs resolved. Remaining items:
- BUG-007: OneDrive paths need /tmp copy (handled but slow — OS limitation)
- BUG-011: Frontend dist path mismatch in packaged app (fallback exists)
- BUG-089: ESLint 92 errors (cosmetic — `no-explicit-any`, empty catch blocks, no runtime impact)
- BUG-088: WorktreeManager code exists but not wired into agent spawn/deregister lifecycle
- BUG-046: OAuth sign-in not implemented (all providers work via API keys)
- ARCH-003: Desktop app requires WSL on Windows (no native Python support yet)

---

## WHAT'S NEXT

See [ROADMAP.md](ROADMAP.md) for the full development plan (Phases 8-15).

### High Priority (Phase 9-10)
- Plugin marketplace with installable packages (GhostHub)
- Plugin SDK for community development
- Docker sandbox for agent execution
- Encrypted secrets manager
- More model providers (Mistral, OpenRouter, Azure, Bedrock, Deepseek)

### Medium Priority (Phase 11-13)
- Model failover and cost-aware routing
- Streaming token-by-token responses
- RAG document search
- PWA mobile app
- Agent performance dashboards
- OpenTelemetry integration

### Future (Phase 14-15)
- Multi-user support with roles
- Docker Compose deployment
- GhostLink Cloud (hosted SaaS)
- Visual workflow builder
- Multi-language UI (i18n)
