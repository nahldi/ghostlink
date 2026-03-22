# GhostLink -- Project Status & Handoff
**Last updated:** 2026-03-21
**Owner:** Finn (FinnTheDogg / nahlidify / skullmen7272@gmail.com)
**GitHub:** https://github.com/nahldi/aichttr (repo name is still `aichttr`, contents are GhostLink)
**License:** MIT

## RECENT FIXES (2026-03-22)

- **BUG-001 Resolved:** Fixed WebSocket connection drop issue by replacing the catch-all SPA route with an ASGI middleware (`spa_middleware`) that properly ignores `/ws` upgrades.
- **BUG-002 Resolved:** Fixed first-run Python dependency errors inside WSL by adding `tomli` and `websockets` to the automated `pip install --break-system-packages` script in `server.ts`.
- **BUG-003 Resolved:** Fixed memory sync issues in `backend/app.py` by transitioning from a global `AgentMemory` instantiation to per-agent `get_agent_memory` usage.
- **BUG-004, BUG-005, BUG-006 Resolved:** Eliminated UI freezing (60-second lockups and white screens) during desktop app launcher/wizard boot by rewriting synchronous `execSync` auth and python checks to asynchronous Promises (`util.promisify(exec)`) in `auth/index.ts` and `main/index.ts`. Ensured wizard properly forwards the user-selected platform to backend Python detectors.
- **BUG-007 Resolved:** Confirmed logic is present to copy backend files to `/tmp/ghostlink-backend/` when a OneDrive path is detected in WSL.

---

## HANDOFF PROMPT

You are picking up GhostLink (formerly AI Chattr / aichttr) -- a multi-agent AI chat platform. It is a unified command center for ALL AI agents: Claude, Codex, Gemini, Copilot, Grok, and more. Agents share a real-time chat room via MCP (Model Context Protocol), and the user orchestrates them from a single UI.

The backend is solid and working. The desktop Electron app has auth detection for 4 providers and full server lifecycle management. The frontend is functional with 29 components, 21 slash commands, 9 themes, and extensive keyboard shortcuts.

**Critical rules:**
- Never push personal data to GitHub. The distributable copy is at `aichttrr/` inside the workspace. The parent `aichttr/` has Finn's personal config (SOUL.md, config.toml with local paths, etc.).
- Private GitHub repo: `https://github.com/nahldi/aichttr` -- push `aichttrr/` contents only.
- Don't rewrite the backend -- it works. Focus on new features and polish.
- Finn is very particular about visual quality. No generic UIs. Reference: Linear, Raycast, Arc Browser, Warp terminal for aesthetic feel.
- Test everything: fail test -> fix test -> smoke test -> stress test before shipping.
- ACP workers (sessions_spawn) are unreliable -- code directly.

---

## PROJECT IDENTITY

| Field | Value |
|-------|-------|
| Name | GhostLink (formerly AI Chattr / aichttr) |
| Owner | Finn (FinnTheDogg / nahlidify / skullmen7272@gmail.com) |
| GitHub | https://github.com/nahldi/aichttr |
| Purpose | Multi-agent AI chat platform -- unified command center for ALL AI agents (Claude, Codex, Gemini, Copilot, Grok, etc.) |
| Version | v0.2.1+ |
| Port | 8300 (HTTP/WS), 8200 (MCP HTTP), 8201 (MCP SSE) |

---

## DIRECTORY STRUCTURE

```
C:\Users\skull\Openclaw\MainBot\projects\aichttr\          <-- Finn's personal workspace
|   STATUS.md               <-- This file
|   FEATURES.md             <-- Full feature roadmap (Phases 1-7)
|   SOUL.md                 <-- Personal agent soul file (NEVER push)
|
+-- backend/                <-- Workspace backend (has personal config.toml -- NEVER push)
+-- frontend/               <-- Workspace frontend
+-- aichttrr/               <-- CLEAN DISTRIBUTABLE (this is what goes to GitHub)
    +-- backend/            <-- Python FastAPI backend
    |   |   app.py          <-- FastAPI server, 55+ endpoints, WebSocket hub, SPA serving
    |   |   mcp_bridge.py   <-- MCP server, 10 chat tools (extensible to 29+)
    |   |   wrapper.py      <-- Agent CLI launcher (tmux sessions, WSL)
    |   |   wrapper_unix.py <-- Unix-specific agent wrapper
    |   |   store.py        <-- SQLite message store with FTS5 full-text search
    |   |   registry.py     <-- Agent instance registry (hierarchy, health, uptime)
    |   |   router.py       <-- @mention routing + loop guard
    |   |   skills.py       <-- 23 built-in skills, per-agent enable/disable
    |   |   jobs.py         <-- Job tracking CRUD
    |   |   rules.py        <-- Shared rules CRUD
    |   |   schedules.py    <-- Cron-style scheduled tasks
    |   |   agent_memory.py <-- Persistent per-agent JSON key/value storage
    |   |   mcp_proxy.py    <-- MCP proxy utilities
    |   |   config.toml     <-- Agent config (template -- personal paths stripped)
    |   |   requirements.txt
    |   +-- data/           <-- SQLite DB + settings.json (gitignored, created at runtime)
    |   +-- uploads/        <-- File upload storage
    |
    +-- frontend/           <-- React 19 + TypeScript + Vite 8 + Tailwind CSS 4
    |   +-- src/
    |   |   |   App.tsx             <-- Main layout: icon rail + agent bar + chat + stats
    |   |   |   main.tsx            <-- React entry point
    |   |   |   index.css           <-- Global styles, 9 theme definitions, animations
    |   |   +-- components/         <-- 29 React components (see full list below)
    |   |   +-- stores/
    |   |   |       chatStore.ts    <-- Zustand state (messages, agents, channels, settings, activities)
    |   |   +-- hooks/
    |   |   |       useWebSocket.ts     <-- WebSocket connection + event handling
    |   |   |       useMentionAutocomplete.ts  <-- @mention autocomplete logic
    |   |   +-- types/
    |   |   |       index.ts        <-- All TypeScript interfaces (Message, Agent, Settings, etc.)
    |   |   +-- lib/
    |   |           api.ts          <-- HTTP API client
    |   |           ws.ts           <-- WebSocket class with reconnection
    |   |           sounds.ts       <-- Notification sound manager
    |   |           timeago.ts      <-- Relative timestamp formatting
    |   +-- public/                 <-- Static assets (favicon, logo, sounds)
    |   +-- dist/                   <-- Built frontend (served by backend at /)
    |
    +-- desktop/            <-- Electron 33 desktop app
        |   package.json
        |   tsconfig.json
        |   electron-builder.yml
        +-- main/           <-- Main process (TypeScript source + compiled JS)
        |   |   index.ts    <-- Entry point, IPC handlers, window management
        |   |   server.ts   <-- Python backend lifecycle (WSL support, OneDrive handling, venv)
        |   |   launcher.ts <-- Launcher window creation
        |   |   tray.ts     <-- System tray icon + menu
        |   |   updater.ts  <-- Auto-update via electron-updater
        |   |   preload.ts  <-- IPC bridge (currently unused, using nodeIntegration)
        |   +-- auth/       <-- Provider auth detection modules
        |       |   index.ts    <-- Shared auth runner + WSL helpers
        |       |   anthropic.ts <-- Claude auth detection
        |       |   openai.ts   <-- Codex/OpenAI auth detection
        |       |   google.ts   <-- Gemini auth detection
        |       +-- github.ts   <-- GitHub Copilot auth detection
        +-- renderer/       <-- Renderer HTML/CSS/JS
        |   |   launcher.html / launcher.css / launcher.js  <-- Launcher UI
        |   +-- wizard.html / wizard.css / wizard.js        <-- First-run setup wizard
        +-- assets/         <-- App icons
        +-- dist/           <-- Compiled Electron output
        +-- scripts/        <-- Build scripts
```

---

## TECH STACK

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+, FastAPI, aiosqlite, uvicorn, MCP SDK (FastMCP) |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand |
| Desktop | Electron 33, electron-builder, electron-updater |
| Communication | MCP (Model Context Protocol) over HTTP + SSE, WebSocket for real-time UI |
| Database | SQLite with FTS5 full-text search |
| Agent Execution | tmux sessions managed by wrapper.py |
| Tunnel | Cloudflare (cloudflared) for remote access |

---

## BACKEND -- 55+ API ENDPOINTS

All endpoints are defined in `aichttrr/backend/app.py`. Backend runs on port 8300.

### Messages
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/messages` | Fetch messages (query: channel, limit, before) |
| POST | `/api/send` | Send a message (body: text, sender, channel, type, reply_to) |
| POST | `/api/messages/{id}/pin` | Toggle pin on a message |
| POST | `/api/messages/{id}/react` | Add/toggle emoji reaction on a message |
| DELETE | `/api/messages/{id}` | Delete a message |
| POST | `/api/upload` | Upload a file attachment |

### Status & Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Server status + full agent list (live + offline) |
| GET | `/api/settings` | Get all settings (username, theme, fontSize, loopGuard, etc.) |
| POST | `/api/settings` | Save settings (persisted to data/settings.json) |

### Channels
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/channels` | List all channels |
| POST | `/api/channels` | Create a new channel |
| DELETE | `/api/channels/{name}` | Delete a channel |
| PATCH | `/api/channels/{name}` | Rename a channel (migrates messages) |

### Agents
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/register` | Register an agent (called by MCP bridge on connect) |
| POST | `/api/deregister/{name}` | Deregister an agent |
| GET | `/api/agent-templates` | Detect installed AI CLIs, return available templates |
| POST | `/api/spawn-agent` | Spawn a new agent (creates tmux session via wrapper.py) |
| POST | `/api/kill-agent/{name}` | Kill an agent (destroys tmux session) |
| POST | `/api/agents/{name}/pause` | Pause an agent (stops @mention routing) |
| POST | `/api/agents/{name}/resume` | Resume a paused agent |
| POST | `/api/heartbeat/{name}` | Agent heartbeat (updates presence, triggers thinking glow) |

### Agent Data (per-agent storage)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents/{name}/soul` | Get agent's soul/personality text |
| POST | `/api/agents/{name}/soul` | Set agent's soul/personality text |
| GET | `/api/agents/{name}/notes` | Get agent's notes |
| POST | `/api/agents/{name}/notes` | Save agent's notes |
| GET | `/api/agents/{name}/health` | Get agent health metrics |
| GET | `/api/agents/{name}/config` | Get agent's runtime config |
| POST | `/api/agents/{name}/config` | Update agent's runtime config |
| GET | `/api/agents/{name}/memories` | List all memory keys for an agent |
| GET | `/api/agents/{name}/memories/{key}` | Get a specific memory value |
| DELETE | `/api/agents/{name}/memories/{key}` | Delete a specific memory key |

### Skills
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/skills` | List all 23 built-in skills with metadata |
| GET | `/api/skills/agent/{name}` | Get skill enable/disable state for an agent |
| POST | `/api/skills/agent/{name}/toggle` | Toggle a skill on/off for an agent |

### Jobs
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs` | List all jobs |
| POST | `/api/jobs` | Create a new job |
| PATCH | `/api/jobs/{id}` | Update job status/details |
| DELETE | `/api/jobs/{id}` | Delete a job |

### Rules
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/rules` | List all rules |
| GET | `/api/rules/active` | List only active rules |
| POST | `/api/rules` | Create a new rule |
| PATCH | `/api/rules/{id}` | Update a rule |

### Search
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search` | Full-text search across messages (FTS5 with LIKE fallback) |

### Activity & Usage
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/activity` | Get activity timeline events |
| GET | `/api/usage` | Get token usage stats (query: agent, period) |
| POST | `/api/usage` | Report token usage for an agent |

### Webhooks
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/webhooks` | List all webhooks |
| POST | `/api/webhooks` | Create a webhook |
| POST | `/api/webhook/{id}` | Receive a webhook payload (triggers configured agent) |
| DELETE | `/api/webhook/{id}` | Delete a webhook |

### Export
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export` | Export channel as markdown, JSON, or HTML |

### Hierarchy
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hierarchy` | Get agent hierarchy tree (manager/worker/peer roles) |

### Tunnel (Cloudflare)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tunnel/start` | Start a Cloudflare tunnel for remote access |
| POST | `/api/tunnel/stop` | Stop the tunnel |
| GET | `/api/tunnel/status` | Get tunnel status and URL |

### System
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/cleanup` | Kill stale tmux sessions + orphaned processes |
| POST | `/api/shutdown` | Graceful server shutdown |
| POST | `/api/pick-folder` | Native OS folder picker (PowerShell on WSL) |

### WebSocket
| Method | Path | Description |
|--------|------|-------------|
| WS | `/ws` | Real-time WebSocket -- messages, typing, status, reactions, channel updates, activity |

### SPA Catch-All
| Method | Path | Description |
|--------|------|-------------|
| GET | `/{path}` | Serves frontend SPA (index.html) for all non-API routes |

---

## MCP BRIDGE -- 10 TOOLS (CURRENTLY SHIPPED)

All tools are defined in `aichttrr/backend/mcp_bridge.py`. MCP runs on ports 8200 (HTTP) and 8201 (SSE).

### Chat Tools (10 -- all shipped)
| Tool | Description |
|------|-------------|
| `chat_send` | Send a message to a channel (text, sender, channel, type, metadata) |
| `chat_read` | Read messages from a channel (with cursor-based pagination) |
| `chat_join` | Join a channel (registers agent presence) |
| `chat_who` | List all online agents |
| `chat_channels` | List all available channels |
| `chat_rules` | Read or propose shared rules |
| `chat_progress` | Send/update a live progress card (multi-step task tracking) |
| `chat_propose_job` | Propose a new job for team review |
| `chat_react` | React to a message with an emoji |
| `chat_claim` | Claim an agent identity (confirm name/label/base) |

### Planned Tools (19 more -- documented in FEATURES.md, not yet in aichttrr/)
| Tool | Description |
|------|-------------|
| `web_search` | DuckDuckGo web search (no API key needed) |
| `web_fetch` | Fetch and extract content from a URL |
| `browser_screenshot` | Capture screenshot of a URL via Playwright (optional) |
| `file_read` | Read a file from the agent's workspace |
| `file_write` | Write content to a file |
| `file_list` | List files in a directory |
| `shell_exec` | Execute a shell command (with timeout) |
| `git_status` | Run git status on a directory |
| `git_diff` | Run git diff |
| `git_log` | Run git log |
| `system_info` | Get system information (OS, CPU, memory, disk) |
| `memory_save` | Save a key/value pair to persistent agent memory |
| `memory_load` | Load a value from agent memory |
| `memory_list` | List all memory keys |
| `memory_search` | Search memory values |
| `memory_delete` | Delete a memory key |
| `notes_save` | Save agent notes |
| `notes_load` | Load agent notes |
| `soul_read` | Read agent soul/personality text |
| `agent_spawn` | Spawn a new agent from within an agent |

---

## FRONTEND -- 29 COMPONENTS

All components are in `aichttrr/frontend/src/components/`.

| Component | File | Description |
|-----------|------|-------------|
| ActivityTimeline | ActivityTimeline.tsx | Sidebar feed of all agent actions with icons per action type |
| AddAgentModal | AddAgentModal.tsx | Modal for spawning new agents -- model picker, permission presets, workspace browser |
| AgentBar | AgentBar.tsx | Top bar showing agent chips with brand colors, status dots, start/stop on hover |
| AgentIcon | AgentIcon.tsx | Brand-colored agent avatar icon |
| AgentInfoPanel | AgentInfoPanel.tsx | Tabbed panel (Info + Skills) -- workspace, command, provider, connection time |
| AgentMiniCard | AgentMiniCard.tsx | Compact agent card for lists |
| AgentStatusPill | AgentStatusPill.tsx | Status pill with colored dot (green=online, grey=offline, brand=thinking) |
| ChannelTabs | ChannelTabs.tsx | Channel tab bar with create (+), rename (right-click), delete |
| ChatMessage | ChatMessage.tsx | Message bubble with actions, reactions, editing, collapsing, pinning, bookmarking |
| CodeBlock | CodeBlock.tsx | Syntax-highlighted code blocks with line numbers and copy button |
| CommandBar | CommandBar.tsx | Command palette overlay (Ctrl+K) with /, @, # prefix modes |
| ConnectionBanner | ConnectionBanner.tsx | Banner showing disconnected/reconnecting/connected status |
| ConsensusCard | ConsensusCard.tsx | Side-by-side display of all agents' independent answers |
| DecisionCard | DecisionCard.tsx | Decision tracking card |
| HandoffCard | HandoffCard.tsx | Visual card for task handoff between agents (from -> arrow -> to) |
| JobProposal | JobProposal.tsx | Job proposal card with approve/reject |
| JobsPanel | JobsPanel.tsx | Jobs management panel |
| KeyboardShortcutsModal | KeyboardShortcutsModal.tsx | Modal showing all keyboard shortcuts |
| MessageInput | MessageInput.tsx | Input box with slash commands, @mention autocomplete, reply-to |
| MobileHeader | MobileHeader.tsx | Compact mobile header with hamburger menu |
| MobileSidebar | MobileSidebar.tsx | Slide-out drawer for mobile navigation |
| ProgressCard | ProgressCard.tsx | Live-updating progress bar with step indicators |
| RemoteSession | RemoteSession.tsx | Cloudflare tunnel remote session button + status |
| RulesPanel | RulesPanel.tsx | Shared rules management panel |
| SearchModal | SearchModal.tsx | Full-text search modal (Ctrl+K) with filters |
| SettingsPanel | SettingsPanel.tsx | Settings: username, font size, loop guard, theme picker, notifications, cleanup |
| Sidebar | Sidebar.tsx | Main sidebar with channels, agents, stats sections |
| StatsPanel | StatsPanel.tsx | Statistics panel with customizable sections |
| TypingIndicator | TypingIndicator.tsx | Animated typing dots when an agent is composing |

### Supporting Files
| File | Description |
|------|-------------|
| App.tsx | Main layout -- icon rail + agent bar + chat area + stats panel |
| main.tsx | React 19 entry point |
| index.css | Global styles, all 9 theme CSS variable definitions, keyframe animations |
| chatStore.ts | Zustand store -- messages, agents, channels, settings, activities, wsState, failedMessages, editMessage, bookmarkMessage, sessionStart |
| useWebSocket.ts | WebSocket hook -- connects, handles message/typing/status/reaction/channel/activity events, reconnection logic, favicon unread badge |
| useMentionAutocomplete.ts | @mention autocomplete logic for the input box |
| api.ts | HTTP API client (fetch wrapper for all /api/* endpoints) |
| ws.ts | WebSocket class with auto-reconnection and event handling |
| sounds.ts | Notification sound manager (per-agent sounds: Claude=warm-bell, Codex=bright-ping, Gemini=soft-chime) |
| timeago.ts | Relative timestamp formatting ("Just now", "2m ago", "1h ago", "Mar 20") |
| types/index.ts | All TypeScript interfaces -- Message, Agent, Channel, Settings, ActivityEvent, Schedule, Webhook, etc. |

---

## FRONTEND FEATURES

### 21 Slash Commands
| Command | Description |
|---------|-------------|
| `/status` | Show all agent states as a system message |
| `/clear` | Clear current channel chat (local only) |
| `/export` | Download channel as markdown file |
| `/ping` | Ping the server, show latency |
| `/theme [name]` | Switch theme (dark, light, cyberpunk, terminal, ocean, sunset, midnight, rosegold, arctic) |
| `/focus [agent] [topic]` | Set an agent's focus dynamically |
| `/pinned` | Show pinned messages in current channel |
| `/bookmarks` | Show bookmarked messages |
| `/jobs` | Show active jobs |
| `/rules` | Show shared rules |
| `/settings` | Open settings panel |
| `/debug` | Toggle debug mode (shows message IDs, timestamps, raw data) |
| `/notify` | Toggle desktop notifications |
| `/mute` | Mute notification sounds |
| `/unmute` | Unmute notification sounds |
| `/agents` | List all agents with status |
| `/stats` | Show statistics panel |
| `/role [agent] [role]` | Set agent hierarchy role (manager/worker/peer) |
| `/spawn [base] [label]` | Spawn a new agent |
| `/kill [agent]` | Kill an agent |
| `/help` | Show all available commands |

### 9 Themes
| Theme | Accent Color |
|-------|-------------|
| Dark | #a78bfa (purple) |
| Light | #6d28d9 (deep purple) |
| Cyberpunk | #ff00ff (magenta) |
| Terminal | #00ff41 (green) |
| Ocean | #22d3ee (cyan) |
| Sunset | #f97316 (orange) |
| Midnight | #818cf8 (indigo) |
| Rose Gold | #f43f5e (pink) |
| Arctic | #60a5fa (blue) |

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| Ctrl+K | Open search / command palette |
| Ctrl+/ | Open keyboard shortcuts modal |
| Ctrl+N | Create new channel |
| Ctrl+1 through Ctrl+9 | Switch to channel by number |
| Alt+Up / Alt+Down | Navigate channels |
| Escape | Close modals, cancel edit/reply |
| Ctrl+Shift+M | Toggle mute |

### Other UI Features
- Desktop notifications with quiet hours support
- Debug mode (shows raw message data)
- Message editing (double-click a message)
- Collapsible long messages (expand/collapse)
- Message bookmarking
- Emoji reactions (thumbs up, heart, party, eyes, fire, check) with toggle
- Message pinning
- Agent hierarchy visualization (manager/worker/peer badges)
- Stats panel with customizable sections
- Connection status banners (disconnected/reconnecting/connected)
- Cloudflare tunnel remote session button
- Code blocks with line numbers and copy button
- Scroll-to-bottom arrow with new message count badge
- Favicon unread message badge
- Reply-to threading
- @mention autocomplete with agent brand colors
- Mobile layout with hamburger drawer, safe areas, 100dvh viewport
- User messages always right-aligned, agent messages left-aligned
- Agent-colored message bubbles with brand tinting
- Thinking state: spinning brand-colored glow border + brand dot (only during actual work, not startup)
- Relative timestamps ("2m ago") with hover for exact time
- Message slide-in animations
- Per-agent notification sounds
- Error boundary with reload button
- Loading spinner fallback

---

## DESKTOP APP (ELECTRON)

Located at `aichttrr/desktop/`. Built with Electron 33 + electron-builder.

### Main Process Files
| File | Description |
|------|-------------|
| `main/index.ts` | Entry point. Creates BrowserWindow, registers IPC handlers, manages window lifecycle. |
| `main/server.ts` | Python backend lifecycle management. Handles WSL detection, OneDrive path workaround, venv creation, dependency installation, process spawning, health polling. |
| `main/launcher.ts` | Creates the launcher window (smaller window shown before chat). |
| `main/tray.ts` | System tray icon with context menu (show/hide, quit). |
| `main/updater.ts` | Auto-update via electron-updater (checks GitHub releases). |
| `main/preload.ts` | IPC bridge for renderer (currently unused -- using nodeIntegration instead). |

### Auth Detection Modules (`main/auth/`)
| File | Description |
|------|-------------|
| `index.ts` | Shared auth runner. Exports `checkAllProviders()`. WSL command helpers. |
| `anthropic.ts` | Claude auth detection. |
| `openai.ts` | Codex/OpenAI auth detection. |
| `google.ts` | Gemini auth detection. |
| `github.ts` | GitHub Copilot auth detection (via `gh auth status`). |

### Renderer Files
| File | Description |
|------|-------------|
| `renderer/launcher.html` | Launcher UI HTML |
| `renderer/launcher.css` | Launcher UI styles |
| `renderer/launcher.js` | Launcher UI logic (start server, clear cache, show status) |
| `renderer/wizard.html` | First-run setup wizard HTML |
| `renderer/wizard.css` | Wizard styles |
| `renderer/wizard.js` | Wizard logic (platform detection, agent auth flow) |

### Auth Detection -- How Each Provider Is Checked

**Claude (Anthropic):**
1. `npx @anthropic-ai/claude-code --version` -- checks if CLI is installed
2. `claude auth status` -- checks if authenticated
3. Check for `~/.claude/` directory existence
4. Check for `ANTHROPIC_API_KEY` environment variable

**Codex (OpenAI):**
1. Check for `codex` binary on PATH
2. Check for `~/.codex/` or `~/.config/codex/` directories
3. Check for `OPENAI_API_KEY` environment variable

**Gemini (Google):**
1. Check for `~/.npm-global/bin/gemini` (npm global install location)
2. `gemini auth status` -- checks if authenticated
3. Check for token files in Gemini config directory
4. Check for `GOOGLE_API_KEY` or `GEMINI_API_KEY` environment variables
5. Check for `gcloud` CLI authentication

**GitHub Copilot:**
1. `gh auth status` -- checks if GitHub CLI is authenticated

### Desktop App -- Server Startup Flow

1. Read platform setting from stored preferences (wsl / windows / mac / linux)
2. If WSL: detect OneDrive path -> copy backend files to `/tmp/ghostlink-backend/` (OneDrive paths are inaccessible from WSL)
3. Check Python availability in WSL (`python3 --version`)
4. Check dependencies (fastapi, uvicorn, aiosqlite) -> if missing, create venv + pip install from requirements.txt
5. Activate venv, run `python3 app.py`
6. Poll `GET /api/status` until server responds (30-second timeout)
7. Open chat window pointing at `http://127.0.0.1:8300`

### Build the Desktop App
```bash
cd aichttrr/desktop
npm install
npx tsc                        # Compile TypeScript
npx electron-builder --win     # Build Windows .exe
```

**Note:** electron-builder bundles `frontend/dist/` contents directly into `resources/frontend/` (NOT `resources/frontend/dist/`). The backend expects the frontend at that path.

---

## BACKEND INTERNALS

### Skills Registry (skills.py)
23 built-in skills, all enabled by default for every agent:

| Skill | Category |
|-------|----------|
| web-search | Research |
| web-fetch | Research |
| file-read | Files |
| file-write | Files |
| file-list | Files |
| shell-exec | System |
| git-status | Development |
| git-diff | Development |
| git-log | Development |
| code-review | Development |
| test-runner | Development |
| dependency-scan | Development |
| performance-audit | Development |
| docker-manage | DevOps |
| system-monitor | System |
| system-info | System |
| memory-save | Memory |
| memory-load | Memory |
| memory-list | Memory |
| memory-search | Memory |
| memory-delete | Memory |
| notes-save | Notes |
| notes-load | Notes |

### Agent Templates (12 Known CLIs)
The backend detects these AI CLIs and offers them as spawn templates:
Claude, Codex, Gemini, Grok, Copilot, Aider, Goose, Pi, Cursor, Cody, Continue, OpenCode

Each provider has tailored CLI flags:
- Claude: `--dangerously-skip-permissions`
- Codex: `--sandbox danger-full-access -a never`
- Gemini: `-y`

### Store (store.py)
- SQLite database at `data/chat.db`
- FTS5 full-text search index (with LIKE query fallback)
- Messages table with: id, uid, sender, text, channel, type, timestamp, reply_to, metadata, pinned, reactions (JSON)
- Channels table
- Automatic migration on startup

### Registry (registry.py)
- In-memory agent instance tracking
- Fields: name, label, base, status, hierarchy_role, parent, health metrics, uptime, connected_at
- `_get_full_agent_list()` returns ALL agents (live + offline) -- agents never disappear from the UI

### Router (router.py)
- @mention detection and routing
- Loop guard (configurable 1-200, syncs from settings API)
- `_was_triggered` flag from @mentions, cleared on agent response
- @all routing to every registered agent

### Agent Memory (agent_memory.py)
- Per-agent persistent JSON key/value storage
- Stored in `data/memories/{agent_name}.json`
- CRUD operations via API endpoints

### Schedules (schedules.py)
- Cron-style scheduled tasks
- Background thread checks every minute
- Triggers configured agents on schedule

---

## KNOWN ISSUES / QUIRKS

1. **WebSocket `/ws` vs SPA catch-all conflict:** The `/{path}` catch-all route for SPA serving conflicts with the WebSocket `/ws` endpoint. Currently using exception-based SPA fallback that checks Accept headers. Browser WebSocket connections work (curl test confirmed connection accepted), but Python `websockets` library v15 returns HTTP 404 in automated tests.

2. **OneDrive paths inaccessible from WSL:** Windows OneDrive-synced paths (e.g., `C:\Users\skull\OneDrive\...`) cannot be accessed from WSL. The desktop app's `server.ts` works around this by copying backend files to `/tmp/ghostlink-backend/` before launching.

3. **WSL Python 3.12+ requires venv (PEP 668):** System pip is restricted on newer Python. The desktop app's `server.ts` automatically creates a venv and installs dependencies there.

4. **`~/.npm-global/bin/` not on WSL PATH:** Gemini CLI installed via npm global (`@google/gemini-cli`) is not findable via `which gemini`. Auth checks explicitly look in common npm global directories.

5. **Gemini CLI package name:** Installed via `npm install -g @google/gemini-cli` -- the binary is `gemini` but is not on the default PATH.

6. **electron-builder frontend path:** Bundles `frontend/dist/` contents directly into `resources/frontend/` (not `resources/frontend/dist/`). Backend serving logic must account for this.

7. **Thinking glow timing:** The glow only triggers after a 15-second startup window (ignores CLI boot output). It stays while the agent is working and stops 3 seconds after the agent goes idle. The heartbeat has a 3-second debounce to prevent flicker.

8. **Config.toml preservation:** The spawn-agent endpoint never overwrites config.toml. This was a previous bug that has been fixed. Config.toml agents auto-appear as persistent agents in the UI.

---

## HOW TO BUILD & RUN

### Web App (Development)
```bash
# Start the backend
cd aichttrr/backend
source ../.venv/bin/activate   # Or create venv: python3 -m venv ../.venv && source ../.venv/bin/activate && pip install -r requirements.txt
python app.py                  # Runs on http://127.0.0.1:8300

# Build the frontend (one-time or after changes)
cd aichttrr/frontend
npm install
npm run build                  # Output goes to dist/, served by backend

# Launch an agent manually
cd aichttrr/backend
python wrapper.py claude --headless
```

### Desktop App
```bash
cd aichttrr/desktop
npm install
npx tsc                        # Compile TypeScript -> JavaScript
npx electron-builder --win     # Build Windows installer (.exe)
```

### Deploy to GitHub
```bash
# Verify no personal data leaked
grep -rn "skull\|Finn\|nahlidify" aichttrr/backend/*.py

# Push
cd aichttrr
git add -A
git commit -m "description of changes"
git push
```

### Quick Verification Checklist
1. `http://127.0.0.1:8300` loads the UI
2. WebSocket connects (green connection status)
3. Can send a message, see it appear
4. Can create/rename/delete channels
5. Can spawn an agent from the UI
6. Agent responds to @mention
7. Thinking glow appears during agent work, disappears when done
8. Search (Ctrl+K) returns results
9. Settings persist across page reload
10. Mobile layout works (resize browser or use tunnel on phone)

---

## KEY DECISIONS (DESIGN PHILOSOPHY)

- **Agents always visible** -- Online or offline, agents never disappear from the UI. `_get_full_agent_list()` merges live and offline agents.
- **All skills enabled by default** -- Simple, don't make users configure. Power users can disable per-agent.
- **Thinking glow = actual work** -- Brand-colored spinning border appears only after 15s startup window, only during real activity, stops 3s after idle or on message send.
- **Provider-specific CLI flags** -- Each AI CLI gets tailored permission flags so agents can work without user intervention.
- **Model selector per provider** -- Correct model aliases for each provider (Claude: opus, sonnet, haiku; Codex: o4-mini, o3; etc.).
- **Native OS file picker** -- PowerShell-based folder picker (WSL), not an in-app file browser.
- **User messages always right-aligned** -- Non-negotiable UI rule.
- **No personal data in distributed code** -- Workspace (`aichttr/`) has personal config; distributable (`aichttrr/`) is clean.
- **Config.toml never overwritten** -- UI operations never clobber the agent config file.
- **MCP dual transport** -- HTTP (port 8200) for agents that support streamable-http, SSE (port 8201) for agents that need SSE.

---

## FINN'S PREFERENCES

These are non-negotiable standards for this project:

- **Hates generic UIs** -- Wants unique and premium. Reference aesthetic: Linear, Raycast, Arc Browser, Warp terminal.
- **Things must "just work"** -- No complicated setup, no manual configuration steps.
- **User messages on the right, always.**
- **Test protocol: fail test -> fix test -> smoke test -> stress test** before shipping anything.
- **Values speed** -- Acts, doesn't ask. Don't spend time deliberating when you could be coding.
- **Personal data never in distributed code** -- grep-verify before every push.
- **Small details matter** -- Every disabled state must be readable. Every transition must be smooth. No overlaps, no jank, no visual glitches.
- **All times EST in the app.**

---

## FEATURE ROADMAP (see FEATURES.md for full details)

### Completed (Phases 1-4 partial)
- Mobile layout fix (100dvh, error boundaries)
- Relative timestamps
- Message animations (slide-in)
- Notification sounds (per-agent)
- Emoji reactions (6 emoji, toggle)
- @all agents routing
- 21 slash commands
- Progress cards (live-updating)
- Handoff cards (agent-to-agent)
- Command palette (Ctrl+K with /, @, # modes)
- Activity timeline
- Token usage tracking
- Pause/resume agents
- Scheduled tasks (cron)
- Message search (FTS5)
- 9 visual themes
- Export (markdown, JSON, HTML)
- Webhooks (CRUD + receiver)
- Agent hierarchy (manager/worker/peer)
- Agent memory/soul/notes/health/config APIs
- Code blocks with line numbers
- Desktop notifications + quiet hours
- Connection status banners
- Keyboard shortcuts
- Message editing, bookmarking, collapsing
- Desktop Electron app (Phase 5) with launcher, auth detection, server management, tray, auto-update, first-run wizard

### Not Yet Implemented
- Context inheritance (reply-to context forwarding to agents)
- Consensus mode (all agents answer independently with summary)
- Agent debates (structured multi-round arguments)
- Smart auto-routing (auto-pick best agent without @mention)
- Live terminal peek (real-time tmux pane viewing)
- File change feed (inotify/watchfiles monitoring)
- Approval gates (propose -> approve -> apply code changes)
- Split view (two channels side by side)
- Agent spotlight (full-page agent dashboard)
- Message threads (collapsible reply threads)
- Session replay (playback recorded conversations)
- Plugin system (drop-in capability extensions)
- Skills marketplace (community-driven sharing)
- Custom skill creator
- Package manager installs (pip, npm, brew, winget, Docker)
- Cross-platform desktop installers (macOS .dmg, Linux .AppImage/.deb)
- Remaining 19 MCP tools (web, file, shell, git, system, memory, notes, soul, agent_spawn)

---

## ARCHITECTURE NOTES

### Rate Limits
- WebSocket: max 100 messages/minute per client
- API: max 60 requests/minute per IP
- MCP: max 30 tool calls/minute per agent
- File uploads: max 10MB per file, max 100MB total storage
- Channels: max 20
- Agents: max 10 simultaneous

### Performance Targets
- First Contentful Paint: < 1.5s
- WebSocket latency: < 50ms local, < 200ms via tunnel
- Message render: < 16ms (60fps)
- Search results: < 500ms
- Channel switch: < 100ms
- Memory: < 200MB with 1000 messages loaded

### Testing Protocol (Mandatory before any feature ships)
1. **Fail Test** -- Deliberately trigger edge cases and errors. Verify graceful handling.
2. **Fix Test** -- Apply the fix. Verify the specific bug is resolved.
3. **Smoke Test** -- Quick pass through all related features. Nothing else broke.
4. **Stress Test** -- High volume: 100+ messages, 5+ agents, rapid @mentions, concurrent users.
