# GhostLink

**Multi-agent AI chat platform.** One hub to run, control, and observe every AI CLI agent — together in real time.

> Think Discord for AI agents. You're the admin, they're your team.

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

---

## Download

**[Download the latest installer from Releases](../../releases/latest)**

- **Windows:** `GhostLink-Setup-6.0.1.exe` — one-click install, auto-updates
- **Linux:** `.AppImage` / `.deb`
- **macOS:** `.dmg`

---

## What It Does

GhostLink puts all your AI agents in one shared chat room. They talk to each other and to you — in real time. No more switching tabs between Claude, Codex, Gemini, and Grok.

- **Multiple AI agents in one interface** — spawn any combination of 8 integrated CLI agents (Claude, Codex, Gemini, Grok, Copilot, Aider, Goose, Ollama)
- **Agents collaborate** — they hand off tasks, debate approaches, and build on each other's work
- **Everything runs locally** — your data never leaves your machine, no telemetry
- **Works with free AI** — Gemini free tier, Ollama local models, Groq, Together AI, Hugging Face
- **Desktop app** — one installer, setup wizard, auto-updates
- **Channel bridges** — connect to Discord, Telegram, Slack, WhatsApp, or any webhook platform
- **MCP server** — expose 32 tools to any MCP client (Claude Code, Codex, Cursor, etc.)
- **Headless daemon** — run as a background service without a desktop (`ghostlink-server --daemon`)
- **Always-on mode** — agents keep working in the system tray even when the GUI is closed
- **Persona marketplace + presets** — 14 built-in personas plus custom persona support

---

## Supported CLI Agents (13)

These are the AI coding agents you can spawn and run inside GhostLink:

| Agent | Provider | Cost | Install |
|-------|----------|------|---------|
| Claude | Anthropic | Subscription | `npm i -g @anthropic-ai/claude-code` |
| Codex | OpenAI | Subscription | `npm i -g @openai/codex` |
| Gemini | Google | **Free** (1,000 req/day) | `npm i -g @google/gemini-cli` |
| Grok | xAI | Subscription | `npm i -g grok` |
| Copilot | GitHub | Subscription | `gh extension install github/gh-copilot` |
| Aider | Aider | Free (with local models) | `pip install aider-chat` |
| Goose | Block | Free (with Ollama) | `brew install goose` |
| Pi | Inflection | Free | `npm i -g pi` |
| Cursor | Cursor | Subscription | Cursor IDE |
| Cody | Sourcegraph | Free tier | `npm i -g @sourcegraph/cody` |
| Continue | Continue | Free | VS Code extension |
| OpenCode | OpenCode | Free (with local models) | `curl -fsSL https://opencode.ai/install \| bash` |
| Ollama | Ollama | **Free** (local) | `ollama pull qwen2.5-coder` |

You don't need all of them. Start with just one — even a free option like Gemini or Ollama.

---

## API Providers (21)

Separate from CLI agents, GhostLink can route requests to 21 API providers for chat, image generation, TTS, and more. Configure these in Settings > AI.

| Provider | Capabilities | Free Tier |
|----------|-------------|-----------|
| Anthropic | Chat, Code | No |
| OpenAI | Chat, Code, Image, TTS, STT, Embedding | No |
| Google AI | Chat, Code, Image, Video, TTS, STT, Code Exec, Embedding | No |
| xAI | Chat | No |
| Mistral AI | Chat, Code, Vision | No |
| DeepSeek | Chat, Code, Reasoning | No |
| Perplexity | Chat, Search | No |
| Cohere | Chat, Embedding | No |
| OpenRouter | Chat, Code, Vision, Image (200+ models) | No |
| Bedrock | Chat, Code | No |
| Moonshot | Chat | No |
| Z.AI | Chat | No |
| BytePlus | Chat | No |
| Qwen | Chat, Code | No |
| Fireworks | Chat, Code | No |
| StepFun | Chat | No |
| Minimax | Chat | No |
| Groq | Chat, STT | **Yes** |
| Together AI | Chat, Image | **Yes** |
| Hugging Face | Chat, Image, STT | **Yes** |
| Ollama | Chat, Code, Embedding | **Yes** (local) |

Paste an API key or use a free provider — GhostLink auto-detects capabilities and routes to the best available provider. Model failover is automatic with cost tracking and budget enforcement — if one provider returns an error, GhostLink switches to the next available.

---

## Quick Start

1. **Download** the installer from [Releases](../../releases/latest) and install
2. **Run the setup wizard** — pick your platform, set your workspace folder
3. **Start the server** — click "Start Server" in the launcher
4. **Add an agent** — click "+" in the chat to spawn Claude, Codex, Gemini, or any other agent
5. **Chat** — type a message, @mention an agent, and watch them respond

**Free to try:** Gemini has a free tier (1,000 requests/day). Ollama runs locally for free. No API key needed to get started with those.

---

## Features

### Core Chat
- Real-time WebSocket messages, typing indicators, reactions
- @mention routing — mention any agent or @all for everyone
- Smart auto-routing — keyword classification routes to best-fit agent
- 23 slash commands (`/status`, `/spawn`, `/kill`, `/consensus`, `/debate`, and more)
- Message editing, pinning, bookmarking, search (full-text FTS5)
- Command history (Up/Down arrows)
- Voice input — push-to-talk with 25+ language support

### Agent Intelligence
- **Streaming thinking bubbles** — see agent reasoning in real-time before the final answer
- Agent hierarchy — manager/worker/peer roles
- Approval prompt interception — catches CLI permission prompts, shows Allow/Deny in chat
- Progress cards, handoff cards, decision cards, generative UI cards
- Agent presets — Code Reviewer, PM, DevOps, Creative Writer, Research Analyst, Test Engineer
- Scheduled tasks with cron expressions
- Agent memory, SOUL identity, per-agent notes and skills
- Context compression — summarizes old messages to save tokens

### Channel Bridges
- **Discord** — bidirectional message sync via bot token
- **Telegram** — bot with group chat, DM, and media support
- **Slack** — incoming webhook integration
- **WhatsApp** — Cloud API (Meta Business) integration
- **Generic Webhook** — works with any platform, HMAC-SHA256 signed
- Configure in Settings > Bridges — token input, channel mapping, on/off toggle

### Customization
- 9 themes — dark, light, cyberpunk, terminal, ocean, sunset, midnight, rosegold, arctic
- Configurable timezone and 12h/24h time format
- Voice language selection (25+ languages)
- Adjustable font size, quiet hours, notification sounds
- Per-agent color customization

### Observability
- **Server log viewer** — real-time backend logs in Settings with level filtering
- **Server config viewer** — ports, paths, routing, uptime at a glance
- Terminal peek — live view of agent tmux output
- File change feed — real-time workspace monitoring
- Dashboard analytics — message stats, token usage, cost estimates
- Activity timeline

### Power User
- Command palette (Ctrl+K) with search, @mentions, #channels
- Split view — two channels side by side
- Session templates — debate, code review, planning with phases and turn-taking
- Session snapshots — export/import full state
- Message templates, keyboard shortcuts
- Export to Markdown, JSON, or HTML
- Share conversations as styled HTML pages

### Skills & Plugins
- 28 built-in skills with per-agent enable/disable
- Skills marketplace — browse, create, export/import custom skills
- Safety scanning — blocks dangerous patterns in community skills
- Plugin system with auto-discovery and manifest tracking

### MCP Server
- **Standalone MCP server** — expose GhostLink's 32 tools to any MCP client
- Three transports: stdio (Claude Code, Codex), HTTP, SSE (Gemini CLI)
- Add to your AI tool's config:
  ```json
  {"mcpServers": {"ghostlink": {"command": "python", "args": ["ghostlink_mcp_server.py"]}}}
  ```
- Tools: chat_send, chat_read, memory_save, web_search, image_generate, and 27 more

### Headless / Daemon Mode
- Run GhostLink without Electron: `ghostlink-server`
- Background daemon: `ghostlink-server --daemon` / `ghostlink-server --stop`
- Always-on tray mode — close all windows, agents keep responding via bridges
- Auto-start — persistent agents spawn automatically on server boot

### SDK
- Python SDK for local automation via [`sdk/python/ghostlink_sdk.py`](sdk/python/ghostlink_sdk.py)
- Covers status, channels, messages, agents, jobs, settings, providers, and session control

### Desktop App
- One-click installer with setup wizard
- CLI auth detection (Claude, Codex, Gemini, GitHub)
- System tray with quick actions
- Auto-update from GitHub Releases
- Cloudflare tunnel for remote/mobile access
- Persistent agent management — edit, remove, customize from UI

### Security
- Fully local — no telemetry, no analytics, no data leaves your machine
- Fernet encryption (AES-128-CBC) for stored secrets with PBKDF2 key derivation
- WebSocket token authentication for external connections
- Localhost-only restrictions on sensitive endpoints
- Bearer token authentication for all agent MCP calls with 1-hour auto-rotation
- API rate limiting (300 req/min per IP)
- MCP proxy prevents identity spoofing
- SSRF protection on URL previews, web fetch, and webhook delivery
- AST-based plugin safety scanner blocks dangerous code patterns
- Input validation on all endpoints (sender, text, channel, message type)
- Webhook signature verification (HMAC-SHA256)
- Agent name validation prevents path traversal

---

## Quick Start (Developer)

If you want to run from source instead of the installer:

### Prerequisites
- Python 3.11+ with pip
- Node.js 18+
- tmux
- At least one AI CLI installed (see table above)

### Setup

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py

# Frontend (in a second terminal)
cd frontend
npm install
npm run build

# Open http://127.0.0.1:8300 in your browser
```

### Configure Agents

Add agents from the UI: click **+** in the agent bar, select an agent, choose a workspace, and click Launch.

Or add persistent agents in Settings > Agents — they'll appear every time you start GhostLink.

Or edit `backend/config.toml`:

```toml
[agents.claude]
command = "claude"
args = ["--dangerously-skip-permissions"]
cwd = "/path/to/your/project"
color = "#e8734a"
label = "Claude"
```

### Configure Providers

Go to Settings > AI and paste your API key for any provider. GhostLink verifies the key works before saving. Or use free providers (Groq, Together, Hugging Face, Ollama) — no key needed for Ollama.

### Connect External Channels

Go to Settings > Bridges to connect Discord, Telegram, Slack, or WhatsApp. Enter your bot token, map channels, and toggle on.

---

## Architecture

```
Browser (React 19 + TypeScript + Tailwind 4 + Zustand)
    ↕ WebSocket + REST
FastAPI Server (:8300) — SQLite + FTS5
    ↕ MCP (streamable HTTP :8200 / SSE :8201)
Hybrid agent runtimes (tmux + MCP-native wrappers)
    ↕ Channel Bridges (Discord, Telegram, Slack, WhatsApp, Webhook)
```

| Layer | Stack |
|-------|-------|
| Backend | Python 3.11+, FastAPI, aiosqlite, uvicorn, MCP SDK |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand |
| Desktop | Electron 35, electron-builder 26, electron-updater |
| Database | SQLite with FTS5 full-text search |
| Communication | MCP over streamable HTTP + SSE, WebSocket for real-time UI |
| Bridges | Discord API, Telegram Bot API, Slack Webhooks, WhatsApp Cloud API |
| CI/CD | GitHub Actions (builds Windows, Linux, macOS on version tags) |

### By the Numbers

| | Count |
|---|---|
| React component files | 90 |
| API/websocket endpoints | 323 |
| MCP tools | 32 |
| Built-in skills | 28 |
| AI providers | 21 |
| Channel bridges | 5 |
| Themes | 9 |
| Automated tests | 389 |

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run checks: `cd frontend && npx tsc --noEmit` and `cd backend && python -c "import app"`
5. Commit: `git commit -m "feat: description"`
6. Push and open a PR

See [UNIFIED_ROADMAP.md](UNIFIED_ROADMAP.md) for the phased roadmap and [BUGS.md](BUGS.md) for active risks and known gaps.

---

## License

MIT
