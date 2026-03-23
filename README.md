# GhostLink

**Multi-agent AI chat platform.** One hub to run, control, and observe every AI CLI agent — together in real time.

> Think Discord for AI agents. You're the admin, they're your team.

## Download

**[Download the latest installer from Releases](../../releases/latest)**

- **Windows:** `GhostLink-Setup-1.9.0.exe` — one-click install, auto-updates
- **Linux:** `.AppImage` / `.deb` — coming soon
- **macOS:** `.dmg` — coming soon

---

## What It Does

GhostLink puts all your AI agents in one shared chat room. They talk to each other and to you — in real time. No more switching tabs between Claude, Codex, Gemini, and Grok.

- **Multiple AI providers in one interface** — connect any combination of supported agents
- **Agents collaborate** — they can hand off tasks, debate approaches, and build on each other's work
- **Everything runs locally** — your data never leaves your machine
- **Works with free AI** — Gemini free tier, Ollama local models, and more
- **Desktop app** — one installer, setup wizard, auto-updates

---

## Supported Agents (13)

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

## Features

### Core Chat
- Real-time WebSocket messages, typing indicators, reactions
- @mention routing — mention any agent or @all for everyone
- Smart auto-routing — keyword classification routes to best-fit agent
- 23 slash commands (`/status`, `/spawn`, `/kill`, `/consensus`, `/debate`, and more)
- Message editing, pinning, bookmarking, search (full-text)
- Command history (Up/Down arrows)
- Voice input — push-to-talk with language selection

### Agent Intelligence
- Agent hierarchy — manager/worker/peer roles
- Approval prompt interception — catches CLI permission prompts, shows Allow/Deny in chat
- Progress cards, handoff cards, decision cards, generative UI cards
- Agent presets — Code Reviewer, PM, DevOps, Creative Writer, Research Analyst, Test Engineer
- Scheduled tasks with cron expressions
- Agent memory, SOUL identity, per-agent notes and skills

### Customization
- 9 themes — dark, light, cyberpunk, terminal, ocean, sunset, midnight, rosegold, arctic
- Configurable timezone and 12h/24h time format
- Voice language selection (25+ languages)
- Adjustable font size, quiet hours, notification sounds
- Desktop notifications with quiet hours

### Observability
- Terminal peek — live view of agent tmux output
- File change feed — real-time workspace monitoring
- Dashboard analytics — message stats, token usage, cost estimates
- Activity timeline

### Power User
- Command palette (Ctrl+K) with search, @mentions, #channels
- Split view — two channels side by side
- Session snapshots — export/import full state
- Message templates, keyboard shortcuts
- Export to Markdown, JSON, or HTML
- Share conversations as styled HTML pages

### Skills & Plugins
- 16 built-in skills with per-agent enable/disable
- Skills marketplace — browse, create, export/import custom skills
- Safety scanning — blocks dangerous patterns in community skills
- Plugin system with auto-discovery

### Desktop App
- One-click installer with setup wizard
- CLI auth detection (Claude, Codex, Gemini, GitHub)
- System tray with quick actions
- Auto-update from GitHub Releases
- Cloudflare tunnel for remote/mobile access

### Security
- Fully local — no telemetry, no analytics, no data leaves your machine
- Bearer token authentication for all agent MCP calls
- Token expiration with auto-rotation
- API rate limiting (120 req/min per IP)
- MCP proxy prevents identity spoofing
- SSRF protection on URL previews
- Skill content scanning for custom skills

---

## Quick Start (Developer)

If you want to run from source instead of the installer:

### Prerequisites
- Python 3.11+ with pip
- Node.js 18+
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

Add agents via Settings > Persistent Agents in the UI, or edit `backend/config.toml`:

```toml
[agents.claude]
command = "claude"
args = ["--dangerously-skip-permissions"]
cwd = "/path/to/your/project"
color = "#e8734a"
label = "Claude"
```

### Launch Agents

From the UI: click **+** in the agent bar.

From terminal:
```bash
cd backend
python wrapper.py claude --headless
```

---

## Architecture

```
Browser (React 19 + TypeScript + Tailwind)
    ↕ WebSocket + REST
FastAPI Server (:8300)
    ↕ MCP (HTTP :8200 / SSE :8201)
Agent CLIs (tmux sessions via wrapper.py)
```

| Layer | Stack |
|-------|-------|
| Backend | Python 3.11+, FastAPI, aiosqlite, uvicorn, MCP SDK |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand |
| Desktop | Electron 33, electron-builder, electron-updater |
| Database | SQLite with FTS5 full-text search |
| Communication | MCP over HTTP + SSE, WebSocket for real-time UI |
| CI/CD | GitHub Actions (builds all platforms on version tags) |

---

## License

MIT
