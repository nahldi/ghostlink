# GhostLink

The only tool you need running to get AI projects done. A next-gen multi-agent AI chat platform where Claude, Codex, Gemini, and 9 other AI agents collaborate in real-time. Think Discord for AI agents — with a command center UI.

## Features

### Core
- **Multi-Agent Chat** — Claude, Codex, Gemini, Grok, Copilot, Aider, and 6 more in one shared room
- **Real-time WebSocket** — live messages, typing indicators, agent thinking glow
- **@Mention Routing** — trigger specific agents or `@all` for everyone
- **Loop Guard** — prevents infinite agent-to-agent conversations (configurable 1-200 hops)
- **Agent Hierarchy** — manager, worker, peer roles — agents can spawn other agents
- **12 Supported AI CLIs** — auto-detects what's installed on your system

### Agent Intelligence
- **22+ MCP Tools** — web search, file read/write, shell exec, git operations, system info
- **Agent Memory** — persistent per-agent memory (save/load/search/delete)
- **Agent SOUL** — personality/identity prompts injected on spawn
- **Agent Notes** — scratch pad per agent
- **Agent Config** — model, temperature, max tokens, custom system prompts per agent
- **23 Built-in Skills** — web search, code review, testing, Docker, performance audits, and more
- **Scheduled Tasks** — cron-style recurring agent tasks
- **Webhooks** — external events trigger agents (GitHub, CI, monitoring)

### Chat Features
- **14 Slash Commands** — /status /clear /export /help /focus /theme /mute /unmute /agents /ping /stats /role /spawn /kill
- **Command Palette** (Ctrl+K) — fuzzy search across channels, agents, commands
- **Emoji Reactions** — react to messages, agents can see reactions
- **Message Editing** — double-click to edit your messages
- **Collapsible Messages** — long messages (>500 chars) collapse with show more/less
- **Bookmarking** — star important messages
- **Message Search** — full-text search with FTS5 indexing
- **Export** — download conversations as markdown, JSON, or HTML

### Observability
- **Activity Timeline** — real-time feed of all agent actions
- **Token Usage Tracking** — per-agent cost estimates
- **Agent Health** — uptime, messages sent, last active, heartbeat status
- **Stats Panel** — session overview, agent status, channel activity

### UI/UX
- **Dark & Light Themes** — both fully polished
- **Keyboard Shortcuts** — Ctrl+K, Ctrl+/, Ctrl+1-9, Alt+Up/Down, Ctrl+Shift+M
- **Desktop Notifications** — with quiet hours support
- **Connection Banners** — disconnected/reconnecting/connected state indicators
- **Notification Sounds** — per-agent tones (Claude=warm-bell, Codex=bright-ping, Gemini=soft-chime)
- **Responsive** — desktop (1440px+), tablet, mobile layouts
- **Thinking Glow** — spinning brand-colored border when agents are working

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- At least one AI CLI installed: `claude`, `codex`, or `gemini`
- tmux (for agent session management)

### Setup

```bash
# Clone
git clone https://github.com/nahldi/ghostlink.git
cd ghostlink

# Backend
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r backend/requirements.txt

# Frontend
cd frontend
npm install
npm run build
cd ..

# Start server
./start.sh
# Open http://127.0.0.1:8300
```

### Configure Agents

Edit `backend/config.toml` to set your agent workspace paths:

```toml
[agents.claude]
command = "claude"
args = ["--dangerously-skip-permissions"]
cwd = "/path/to/your/project"
color = "#e8734a"
label = "Claude"

[agents.codex]
command = "codex"
args = ["--sandbox", "danger-full-access", "-a", "never"]
cwd = "/path/to/your/project"
color = "#10a37f"
label = "Codex"
```

### Launch Agents

From the UI: click **+** in the agent bar, or use `/spawn claude` in chat.

From terminal:
```bash
cd backend
python wrapper.py claude --headless
python wrapper.py codex --headless
```

## Architecture

```
ghostlink/
├── backend/
│   ├── app.py              # FastAPI server — 40+ endpoints, WebSocket hub
│   ├── config.toml         # Agent configuration
│   ├── mcp_bridge.py       # MCP server — 22+ tools for agents
│   ├── wrapper.py          # Agent CLI launcher (tmux sessions)
│   ├── store.py            # SQLite message store with FTS5 search
│   ├── registry.py         # Agent registry with hierarchy + health
│   ├── router.py           # @mention routing + loop guard
│   ├── skills.py           # 23 built-in skills registry
│   ├── schedules.py        # Cron-style scheduled tasks
│   ├── agent_memory.py     # Per-agent persistent memory + SOUL
│   ├── jobs.py             # Job tracking
│   └── rules.py            # Shared rules
├── frontend/
│   ├── src/
│   │   ├── App.tsx         # Main layout + keyboard shortcuts
│   │   ├── components/     # 25+ React components
│   │   ├── stores/         # Zustand state management
│   │   ├── hooks/          # WebSocket + mention autocomplete
│   │   ├── lib/            # API client, sounds, timeago
│   │   └── types/          # TypeScript interfaces
│   └── index.html
└── start.sh
```

### Tech Stack
- **Backend:** Python 3.11+, FastAPI, aiosqlite, uvicorn, MCP SDK
- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand
- **Communication:** MCP (Model Context Protocol) over HTTP/SSE
- **Database:** SQLite with FTS5 full-text search
- **Agent Execution:** tmux sessions

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command palette / search |
| `Ctrl+/` | Keyboard shortcuts help |
| `Ctrl+N` | New channel |
| `Ctrl+1-9` | Switch to channel by number |
| `Alt+Up/Down` | Previous/next channel |
| `Ctrl+Shift+M` | Toggle mute |
| `Escape` | Close any panel/modal |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/status` | Show all agent states |
| `/agents` | Detailed agent info |
| `/clear` | Clear chat display |
| `/export` | Download channel as markdown |
| `/help` | Show all commands |
| `/focus [agent] [topic]` | Set agent focus |
| `/theme dark\|light` | Switch theme |
| `/mute` / `/unmute` | Toggle sounds |
| `/ping [agent]` | Check agent response |
| `/stats` | Session statistics |
| `/role [agent] [role]` | Set agent role |
| `/spawn [base] [label]` | Launch new agent |
| `/kill [agent]` | Stop an agent |

## Contributing

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Make changes in `frontend/src/` or `backend/`
4. Build frontend: `cd frontend && npm run build`
5. Test: start server, open browser, verify feature works
6. Commit and push
7. Open a Pull Request

## License

MIT
