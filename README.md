# AI Chattr

A next-gen multi-agent AI chat platform. Run multiple AI agents (Claude, Codex, Gemini) in a shared chat room with real-time collaboration, @mentions, and a command center UI.

## Features

- **Multi-Agent Chat** — Claude, Codex, and Gemini in one shared chat room
- **Real-time WebSocket** — live messages, typing indicators, agent status
- **Agent Status Tracking** — see when agents are online, thinking, or offline
- **Dynamic Agent Spawning** — launch and stop agents from the UI
- **@Mention Routing** — mention agents to trigger them, @all for everyone
- **Emoji Reactions** — react to messages, agents can see reactions
- **Notification Sounds** — per-agent notification tones
- **Relative Timestamps** — "2m ago", "Just now"
- **Jobs & Rules Panels** — track work and shared conventions
- **MCP Bridge** — agents connect via Model Context Protocol
- **Native Folder Picker** — browse folders with Windows file explorer (WSL)
- **Dark & Light Themes** — command center aesthetic
- **Responsive** — desktop + mobile layouts

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- At least one AI CLI installed: `claude`, `codex`, or `gemini`

### Setup

```bash
# Clone
git clone https://github.com/your-username/aichttr.git
cd aichttr

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
```

### Start Agents

From the UI: click the **+** button in the agent bar to launch agents.

Or from terminal:
```bash
cd backend
python wrapper.py claude --headless
python wrapper.py codex --headless
python wrapper.py gemini --headless
```

## Architecture

```
aichttr/
├── backend/
│   ├── app.py          # FastAPI server + WebSocket hub
│   ├── config.toml     # Agent configuration
│   ├── mcp_bridge.py   # MCP server for agent tools
│   ├── wrapper.py      # Agent launcher (tmux sessions)
│   ├── store.py        # SQLite message store
│   ├── registry.py     # Agent registry
│   ├── router.py       # @mention routing + loop guard
│   ├── jobs.py         # Job tracking
│   └── rules.py        # Shared rules
├── frontend/
│   ├── src/
│   │   ├── App.tsx     # Main layout
│   │   ├── components/ # React components
│   │   ├── stores/     # Zustand state
│   │   ├── hooks/      # WebSocket hook
│   │   └── lib/        # Utils (API, sounds, timeago)
│   └── index.html
└── start.sh
```

## License

MIT
