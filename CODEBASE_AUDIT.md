# GhostLink — Comprehensive Codebase Audit

**Audited:** 2026-03-24
**Version:** v2.5.1
**Auditor:** Claude (automated deep read of every file in the project)
**Repository:** github.com/nahldi/ghostlink (MIT License)

---

## 1. What GhostLink Is

GhostLink is a **local-first, multi-agent AI chat platform**. It puts multiple AI CLI agents — Claude, Codex, Gemini, Grok, and 9 others — into a shared chat room where they talk to each other and to the user in real time. The metaphor is "Discord for AI agents": you are the admin, they are your team.

**Core value propositions:**

- **One interface, many agents.** No more switching tabs between Claude, Codex, Gemini, and Grok. All 13 supported CLI agents appear in a single chat sidebar.
- **Agent collaboration.** Agents can hand off tasks, debate approaches, and build on each other's work via @mentions and structured sessions.
- **Fully local.** No telemetry, no analytics, no data leaves your machine. SQLite database, localhost-only server.
- **Free AI support.** Works with Gemini free tier (1,000 req/day), Ollama (local), Groq, Together AI, and Hugging Face — all free.
- **Desktop app.** One-click installer for Windows (.exe), Linux (.AppImage/.deb), and macOS (.dmg) with auto-updates, setup wizard, and system tray.
- **Channel bridges.** Bidirectional message sync with Discord, Telegram, Slack, WhatsApp, and any webhook platform.

---

## 2. Full Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Backend** | Python, FastAPI, uvicorn | 3.11+, 0.115.0, 0.34.0 |
| **Database** | SQLite via aiosqlite, FTS5 full-text search | 0.20.0 |
| **MCP SDK** | FastMCP (Model Context Protocol) | 1.0.0 |
| **Encryption** | cryptography (Fernet/AES-128-CBC) | 43.0.3 |
| **Frontend** | React 19, TypeScript 5.9, Vite 8 | 19.2.4, ~5.9.3, 8.0.1 |
| **CSS** | Tailwind CSS 4 | 4.2.2 |
| **State** | Zustand 5 | 5.0.12 |
| **Animations** | Framer Motion 11 | 11.18.0 |
| **Markdown** | react-markdown 10, remark-gfm, rehype-highlight | 10.1.0 |
| **Virtualization** | @tanstack/react-virtual 3 | 3.13.0 |
| **Desktop** | Electron 33, electron-builder 25 | 33.0.0, 25.0.0 |
| **Auto-update** | electron-updater 6 | 6.3.0 |
| **Logging** | electron-log 5 | 5.2.0 |
| **CI/CD** | GitHub Actions | Triggered on `v*` tags |
| **Tunnel** | Cloudflare (cloudflared) | Runtime dependency |
| **Agent execution** | tmux sessions managed by wrapper.py | Runtime dependency |
| **Serialization** | tomllib/tomli for config.toml | Built-in / 2.0.0 |
| **HTTP client** | aiohttp (optional, for connection pooling) | Runtime |

**Additional backend dependencies:** python-multipart (0.0.18), websockets (14.0).

---

## 3. Folder and File Structure

```
ghostlink/
├── .github/workflows/
│   └── build.yml                  # CI/CD: builds Win/Linux/Mac on version tags
│
├── backend/                       # Python FastAPI server (23 files)
│   ├── app.py                     # Main server: 3,278 lines, 90+ endpoints, WS hub, SPA middleware
│   ├── mcp_bridge.py              # MCP server: 17 tools on ports 8200/8201
│   ├── wrapper.py                 # Agent launcher: tmux, MCP config, approval detection
│   ├── wrapper_unix.py            # tmux session management helpers
│   ├── store.py                   # SQLite + FTS5 message store
│   ├── registry.py                # In-memory agent instance registry with token auth
│   ├── router.py                  # @mention routing, smart classification, loop guard
│   ├── providers.py               # 13 AI provider definitions, capability routing, failover
│   ├── bridges.py                 # Channel bridges: Discord, Telegram, Slack, WhatsApp, webhook
│   ├── security.py                # Secrets manager, exec policy, audit log, GDPR data manager
│   ├── plugin_sdk.py              # EventBus, Marketplace, HookManager, SafetyScanner, SkillPacks
│   ├── plugin_loader.py           # Plugin auto-discovery from plugins/ directory
│   ├── sessions.py                # Structured sessions: templates, phases, turn-taking
│   ├── skills.py                  # 28 built-in skills registry
│   ├── agent_memory.py            # Per-agent persistent JSON memory with file locking
│   ├── mcp_proxy.py               # Per-instance MCP identity proxy
│   ├── jobs.py                    # Job tracking CRUD
│   ├── rules.py                   # Shared rules CRUD
│   ├── schedules.py               # Cron scheduled tasks (SQLite-backed)
│   ├── config.toml                # Server configuration (ports, routing, paths)
│   ├── requirements.txt           # 8 pinned Python dependencies
│   ├── plugins/                   # Drop-in Python plugins
│   │   ├── example.py
│   │   ├── file_watcher.py        # Real-time workspace file change monitoring
│   │   └── skill_marketplace.py   # Browse, create, export/import custom skills
│   ├── data/                      # Runtime: SQLite DB, settings.json, secrets.enc (gitignored)
│   └── uploads/                   # File uploads (gitignored)
│
├── frontend/                      # React 19 + TypeScript + Vite 8 + Tailwind 4
│   ├── src/
│   │   ├── App.tsx                # Main layout, conversation starters, onboarding (510 lines)
│   │   ├── main.tsx               # Entry point
│   │   ├── index.css              # 9 themes, animations, liquid glass effects
│   │   ├── components/            # 44 React components (8,450 lines total)
│   │   ├── stores/
│   │   │   └── chatStore.ts       # Zustand global state (messages, agents, channels, UI)
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts    # WebSocket connection, reconnection, event dispatch
│   │   │   └── useMentionAutocomplete.ts
│   │   ├── types/
│   │   │   └── index.ts           # TypeScript interfaces (Message, Agent, Channel, Job, etc.)
│   │   └── lib/
│   │       ├── api.ts             # REST API client (all endpoint wrappers)
│   │       ├── ws.ts              # WebSocket utilities
│   │       ├── sounds.ts          # SoundManager with per-agent sound assignment
│   │       └── timeago.ts         # Relative timestamp formatting
│   └── dist/                      # Built frontend (served by backend at :8300)
│
├── desktop/                       # Electron 33 desktop app
│   ├── main/
│   │   ├── index.ts               # Window management, IPC, lifecycle
│   │   ├── server.ts              # Python backend lifecycle (WSL, venv, deps)
│   │   ├── launcher.ts            # Launcher window creation
│   │   ├── tray.ts                # System tray with context menu
│   │   ├── updater.ts             # Auto-update from GitHub Releases
│   │   ├── preload.ts             # Context bridge for secure IPC
│   │   └── auth/                  # CLI auth detection
│   │       ├── index.ts           # Auth manager aggregator
│   │       ├── anthropic.ts       # Claude auth check
│   │       ├── openai.ts          # Codex auth check
│   │       ├── google.ts          # Gemini auth check
│   │       └── github.ts          # GitHub Copilot auth check
│   ├── renderer/
│   │   ├── launcher.html/js       # Launcher UI (server status, auth, settings)
│   │   └── wizard.html/js         # First-run setup wizard (6 screens)
│   ├── electron-builder.yml       # Build config: NSIS (Win), DMG (Mac), AppImage/deb (Linux)
│   ├── package.json               # Electron deps, version 2.5.1
│   └── tsconfig.json
│
├── README.md                      # Public-facing docs
├── FEATURES.md                    # 90+ completed features list
├── BUGS.md                        # 66 tracked bugs (most fixed)
├── ROADMAP.md                     # 20-phase development roadmap
├── CHANGELOG.md                   # Version history
├── STATUS.md                      # Project status and handoff document
├── XPLAIN.md                      # Plain-English explanation
├── FeaturesRDM.md                 # Feature ideas and skills research
├── DESKTOP_APP_PLAN.md            # Desktop app architecture document
├── V2.5_BUGFIX_ROADMAP.md         # v2.5 specific bugfix plan
├── LICENSE                        # MIT
├── start.sh / start_agent.sh / start_claude.sh / start_codex.sh  # Helper scripts
└── *.png                          # Screenshots for documentation
```

---

## 4. Architecture

### 4.1 High-Level Data Flow

```
┌───────────────────────────────────────────────────┐
│               Browser / Electron                   │
│    React 19 + TypeScript + Tailwind + Zustand      │
└──────────────────┬────────────────────────────────┘
                   │ WebSocket (:8300/ws) + REST (:8300/api/*)
┌──────────────────▼────────────────────────────────┐
│              FastAPI Server (:8300)                 │
│  SQLite (WAL mode) + FTS5 full-text search         │
│  90+ REST endpoints + WebSocket hub                │
│  Rate limiting (300 req/min per IP)                │
│  SPA middleware (serves frontend on 404)           │
├────────────────────────────────────────────────────┤
│            MCP Bridge (:8200 HTTP / :8201 SSE)     │
│  17 tools: chat_send, chat_read, chat_join,        │
│  chat_who, chat_channels, chat_rules,              │
│  chat_progress, chat_propose_job, chat_react,      │
│  chat_claim, memory_save, memory_load,             │
│  memory_list, memory_search, web_search,           │
│  web_fetch, image_generate                         │
└─────┬────────────┬────────────┬───────────────────┘
      │            │            │
 ┌────▼───┐   ┌───▼────┐  ┌───▼─────┐
 │ Claude │   │ Codex  │  │ Gemini  │   ... (13 agents)
 │ (tmux) │   │ (tmux) │  │ (tmux)  │
 └────────┘   └────────┘  └─────────┘
                   │
        ┌──────────▼──────────┐
        │   Channel Bridges    │
        │ Discord · Telegram   │
        │ Slack · WhatsApp     │
        │ Generic Webhook      │
        └──────────────────────┘
```

### 4.2 Communication Protocols

- **Browser ↔ Server:** WebSocket for real-time events (messages, typing, status, reactions, thinking streams, activity, sessions). REST API for CRUD operations.
- **Server ↔ Agents:** MCP (Model Context Protocol) over HTTP (port 8200, streamable-http transport for Claude/Codex) and SSE (port 8201, for Gemini). Agents call MCP tools to read/send messages. The server triggers agents by writing to a JSONL queue file that `wrapper.py` polls.
- **Server ↔ Bridges:** Each bridge has its own protocol — Discord Gateway API, Telegram Bot API long-polling, Slack incoming webhooks, WhatsApp Cloud API (Meta Business), and generic HMAC-SHA256 signed webhooks.

### 4.3 State Management

**Backend (Python):**
- **SQLite database** (WAL mode, 64MB cache) for messages, schedules, jobs, rules. Path: `data/ghostlink.db`.
- **In-memory registries:** `AgentRegistry` (agent instances and tokens), `MessageRouter` (hop counters), `ProviderRegistry` (API keys and capabilities).
- **JSON files:** `settings.json` (user preferences, persistent agents), `bridges.json` (bridge configs), `secrets.enc` (encrypted API keys), per-agent memory files in `data/memory/<agent>/`.
- **TOML config:** `config.toml` for server port, MCP ports, routing mode, and agent definitions.

**Frontend (React/Zustand):**
- Single Zustand store (`chatStore.ts`) holding: messages array (max 2,000, trimmed to 1,500), agents list, channels list, jobs, rules, activities, WebSocket state, settings, thinking streams, UI state (sidebar panel, mobile menu, reply-to, selection mode).
- No React Router — the app is a single-page chat interface with tabs/panels for navigation.
- `localStorage` used only for command history.

### 4.4 Authentication and Security

- **Agent identity:** Every agent gets a bearer token (hex, 16 bytes) on registration. Tokens auto-rotate on heartbeat with a 1-hour TTL. All MCP tool calls require a valid bearer token. The MCP proxy injects the correct sender identity, preventing impersonation.
- **WebSocket auth:** Non-localhost WebSocket connections require a `?token=<token>` query parameter. Token generated at startup via `secrets.token_urlsafe(32)`, served at `GET /api/ws-token` (localhost only).
- **Localhost guards:** Sensitive endpoints like `/api/send` reject non-localhost requests with HTTP 403.
- **Secrets encryption:** API keys stored in `secrets.enc` using Fernet (AES-128-CBC + HMAC-SHA256) with PBKDF2 key derivation (100k iterations). Falls back to XOR for legacy data.
- **Rate limiting:** 300 requests/minute per IP on all `/api/` endpoints, with automatic IP entry cleanup.
- **SSRF protection:** URL previews and webhook delivery block private/loopback/link-local addresses.
- **Input validation:** Agent names validated against `^[a-zA-Z0-9_-]{1,50}$` regex (prevents path traversal). Message sender, text, channel, and type all validated.
- **Plugin safety:** AST-based scanning blocks dangerous patterns (eval, exec, shell injection) in community plugins/skills.
- **Electron security:** Launcher window uses `contextIsolation: true`, `nodeIntegration: false`, and a preload script with channel allowlisting via `contextBridge`.

### 4.5 Routing

The `MessageRouter` class supports three routing modes (configurable in `config.toml`):

- **none** (default): Messages only route to explicitly @mentioned agents.
- **all**: Every message goes to every agent (except the sender).
- **smart**: Keyword-based classification routes messages to the best-fit agent. Keywords are mapped to agent bases (e.g., "review", "analyze" → Claude; "code", "implement" → Codex; "research", "search" → Gemini).

A **loop guard** prevents infinite agent-to-agent conversations: each channel tracks hop count. Human messages reset the counter. Agent messages increment it. When hops exceed `max_agent_hops` (default 4), routing stops.

Per-agent **response modes** add another layer: `mentioned` (default), `always`, `listen` (agent decides), `silent` (observe only).

---

## 5. Every Page/Screen

GhostLink is a single-page application. The UI is organized into panels and modals rather than separate routes.

### 5.1 Main Chat View (App.tsx)
The primary interface. A three-column layout: sidebar (left), chat area (center), and optional info/stats panel (right). On mobile, the sidebar collapses into a hamburger menu. The chat area shows messages for the active channel with auto-scroll, typing indicators, and a message input bar at the bottom. Conversation starters appear as clickable chips when a channel is empty.

### 5.2 Sidebar (Sidebar.tsx)
Channel list with unread badges, channel creation/deletion/renaming. Includes buttons for: Jobs panel, Rules panel, Settings panel, Help panel, Activity timeline, Stats panel. Shows the app title and user's display name.

### 5.3 Agent Bar (AgentBar.tsx)
Horizontal bar above the chat showing all agents (live + persistent/offline). Each agent has a colored icon with status indicator (active/thinking/paused/offline). Clicking an agent opens the Agent Info Panel. A "+" button opens the Add Agent Modal. Also shows the Cloudflare tunnel button.

### 5.4 Settings Panel (SettingsPanel.tsx — 1,868 lines, largest component)
Seven tabs: **General** (username, title, timezone, time format, voice language, font size, notification sounds, quiet hours, debug mode), **Look** (theme selector with 9 themes), **Agents** (persistent agent editor — add/edit/remove agents with label, workspace, CLI args, color, response mode), **AI** (13 provider configurations with API key input, key verification, capability display, free tier highlighting), **Bridges** (Discord, Telegram, Slack, WhatsApp, webhook configuration with token input, channel mapping, on/off toggles), **Security** (secrets manager, exec policy, GDPR data export/deletion, retention policies, audit log viewer), **Advanced** (server log viewer with level filtering, server config viewer showing ports/paths/uptime, webhook management).

### 5.5 Add Agent Modal (AddAgentModal.tsx)
Dropdown of 13 known agents with availability detection. Workspace folder picker. Model selection per provider. Permission presets (full auto, approval required, read-only). Spawns agent via `/api/spawn-agent`.

### 5.6 Agent Info Panel (AgentInfoPanel.tsx)
Detailed view for a selected agent: status, workspace, response mode, role (manager/worker/peer), model config, SOUL identity editor, notes scratchpad, skills browser with per-agent enable/disable, memory viewer, feedback stats (thumbs up/down), terminal peek button.

### 5.7 Search Modal (SearchModal.tsx)
Ctrl+K command palette with three modes: `/` for slash commands, `@` for agent mentions, `#` for channel switching. Full-text search across messages with FTS5.

### 5.8 Split View (SplitView.tsx)
Two channels side by side with a draggable divider.

### 5.9 Session Launcher (SessionLauncher.tsx)
Start structured sessions from 4 built-in templates: Code Review, Debate, Design Critique, Planning. Each has defined phases with prompts and turn counts.

### 5.10 Other Key Views
- **Jobs Panel** — Kanban-style task board (open/done/archived).
- **Rules Panel** — Shared rules CRUD with proposal/voting workflow.
- **Stats Panel** — Session duration, message counts, token usage, cost estimates.
- **Activity Timeline** — Real-time feed of events (messages, agent joins/leaves, jobs, errors).
- **Help Panel** — 12-topic FAQ/help center, searchable.
- **Replay Viewer** — Playback stored messages with original timing and speed controls.
- **Remote Session** — Cloudflare tunnel management and QR code display for mobile access.
- **Onboarding Tour** — 6-step interactive walkthrough for first-time users.

---

## 6. Every Major Component and Its Role

| Component (44 total) | Lines | Role |
|----------------------|-------|------|
| **SettingsPanel** | 1,868 | 7-tab settings: General, Look, Agents, AI, Bridges, Security, Advanced |
| **MessageInput** | 834 | Chat input with @mention autocomplete, slash commands, voice input, file drag-drop, command history |
| **App** | 510 | Main layout, message rendering, channel management, keyboard shortcuts |
| **AgentInfoPanel** | 483 | Agent details, SOUL, notes, skills, memory, feedback, config |
| **AddAgentModal** | 442 | Agent spawning wizard with model selection, workspace picker, permission presets |
| **ChatMessage** | 427 | Message rendering with markdown, code blocks, reactions, editing, bookmarks, thinking bubbles |
| **Sidebar** | 300 | Channel list, navigation to panels |
| **SearchModal** | 274 | Ctrl+K command palette: commands, mentions, channels, full-text search |
| **JobsPanel** | 187 | Job CRUD with status tracking |
| **SessionLauncher** | 182 | Structured session setup from templates |
| **RulesPanel** | 179 | Shared rules management |
| **RemoteSession** | 160 | Cloudflare tunnel setup and QR code |
| **HelpPanel** | 144 | FAQ/help topics |
| **OnboardingTour** | 139 | 6-step new-user walkthrough |
| **StatsPanel** | 138 | Session analytics, token usage, cost estimates |
| **AgentBar** | 136 | Horizontal agent list with status indicators |
| **GenerativeCard** | 133 | Renders agent UI cards: tables, lists, metrics, buttons, code blocks |
| **ReplayViewer** | 129 | Message replay with timing controls |
| **SessionBar** | 125 | Active session phase/turn display |
| **TerminalPeek** | ~100 | Live tmux pane output viewer |
| **ChannelTabs** | ~80 | Channel tab bar (alternative to sidebar channels) |
| **ProgressCard** | ~70 | Live-updating progress bar from agent work |
| **ApprovalCard** | ~60 | Allow/Deny UI for CLI permission prompts |
| **ConsensusCard** | ~60 | Multi-agent consensus response display |
| **DecisionCard** | ~60 | Agent decision visualization |
| **HandoffCard** | ~50 | Agent-to-agent task handoff display |
| **JobProposal** | ~50 | Agent job proposal with approve/reject |
| **UrlPreview** | ~50 | OpenGraph link preview cards |
| **TypingIndicator** | ~40 | Per-channel animated typing dots |
| **ConnectionBanner** | ~40 | Reconnecting/disconnected status banner |
| **CodeBlock** | ~40 | Syntax-highlighted code with copy button |
| **CommandBar** | ~30 | Slash command bar |
| **AgentIcon** | ~30 | Brand-accurate SVG icons per agent |
| **AgentStatusPill** | ~25 | Colored status indicator dot |
| **AgentMiniCard** | ~25 | Compact agent chip |
| **BulkDeleteBar** | ~25 | Multi-select message deletion toolbar |
| **ChannelSummary** | ~25 | AI-generated channel activity summary |
| **MobileHeader** | ~25 | Mobile responsive header |
| **MobileSidebar** | ~25 | Slide-out mobile navigation |
| **KeyboardShortcutsModal** | ~25 | Shortcut reference display |
| **Skeleton** | ~40 | Loading placeholder components (Message, Agent, Channel variants) |
| **Toast** | ~40 | Spring-animated notification toasts |
| **EmptyState** | ~30 | Animated empty state with icon and CTA |
| **SplitView** | ~80 | Dual-channel side-by-side view |

---

## 7. API Endpoints (90+)

### 7.1 Messages
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/messages` | Fetch messages for a channel (pagination via `since_id`, `limit`) |
| POST | `/api/send` | Send a message (localhost-only guard) |
| POST | `/api/messages/{id}/pin` | Pin/unpin a message |
| POST | `/api/messages/{id}/react` | Add/toggle emoji reaction |
| PATCH | `/api/messages/{id}` | Edit message text |
| POST | `/api/messages/{id}/bookmark` | Bookmark a message |
| POST | `/api/messages/{id}/progress-update` | Update a progress card message |
| DELETE | `/api/messages/{id}` | Delete a single message |
| POST | `/api/messages/bulk-delete` | Bulk delete messages by ID list |
| POST | `/api/upload` | Upload file/image (max 10MB) |
| GET | `/api/search` | Full-text search (FTS5 with LIKE fallback) |

### 7.2 Agents
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/status` | Get all agents with status |
| POST | `/api/register` | Register a new agent instance |
| POST | `/api/deregister/{name}` | Remove an agent |
| GET | `/api/agent-templates` | Get 13 known agent templates with availability |
| POST | `/api/spawn-agent` | Spawn agent in tmux with MCP config |
| POST | `/api/kill-agent/{name}` | Kill an agent's tmux session |
| POST | `/api/agents/{name}/pause` | Pause an agent |
| POST | `/api/agents/{name}/resume` | Resume a paused agent |
| POST | `/api/heartbeat/{name}` | Agent heartbeat (token rotation, thinking state) |
| POST | `/api/agents/{name}/thinking` | Update agent thinking stream |
| GET | `/api/agents/{name}/thinking` | Get current thinking buffer |
| GET | `/api/agents/{name}/health` | Agent health check |
| GET | `/api/agents/{name}/config` | Get agent configuration |
| POST | `/api/agents/{name}/config` | Set agent model, temperature, system prompt |
| GET | `/api/agents/{name}/soul` | Get agent SOUL identity |
| POST | `/api/agents/{name}/soul` | Set agent SOUL identity |
| GET | `/api/agents/{name}/notes` | Get agent notes |
| POST | `/api/agents/{name}/notes` | Set agent notes |
| GET | `/api/agents/{name}/memories` | List agent memory keys |
| GET | `/api/agents/{name}/memories/{key}` | Get specific memory |
| DELETE | `/api/agents/{name}/memories/{key}` | Delete specific memory |
| POST | `/api/agents/{name}/feedback` | Submit thumbs up/down on agent message |
| POST | `/api/agents/{name}/terminal/open` | Open visible terminal window |
| GET | `/api/agents/{name}/terminal` | Peek at tmux pane output |
| POST | `/api/approval/respond` | Respond to CLI approval prompt (allow/deny) |

### 7.3 Channels
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/channels` | List all channels |
| POST | `/api/channels` | Create a channel |
| DELETE | `/api/channels/{name}` | Delete a channel |
| PATCH | `/api/channels/{name}` | Rename a channel |
| GET | `/api/channels/{name}/summary` | AI-generated channel summary |

### 7.4 Jobs, Rules, Schedules
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/jobs` | List/create jobs |
| PATCH/DELETE | `/api/jobs/{id}` | Update/delete a job |
| GET/POST | `/api/rules` | List/propose rules |
| GET | `/api/rules/active` | Active rules only |
| PATCH | `/api/rules/{id}` | Update rule status |
| GET/POST | `/api/schedules` | List/create scheduled tasks |
| PATCH/DELETE | `/api/schedules/{id}` | Update/delete schedule |

### 7.5 Sessions and Templates
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST/DELETE | `/api/session-templates` | CRUD session templates |
| GET/POST/DELETE | `/api/sessions/{channel}` | Get/start/end structured session |
| POST | `/api/sessions/{channel}/advance` | Advance session to next phase |

### 7.6 Settings and Configuration
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/settings` | Get/save user settings |
| GET | `/api/ws-token` | Get WebSocket auth token (localhost only) |
| POST | `/api/pick-folder` | Open native folder picker dialog |
| GET | `/api/hierarchy` | Get agent hierarchy (manager/worker/peer) |

### 7.7 AI Providers
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/providers` | List all 13 providers with status |
| POST | `/api/providers/configure` | Save provider API key |
| POST | `/api/providers/{id}/test` | Test API key against provider |
| GET | `/api/providers/{id}/models` | List models for a provider |
| GET | `/api/providers/resolve/{capability}` | Find best provider for a capability |

### 7.8 Skills and Plugins
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/skills` | List skills (filterable by category/search) |
| GET/POST | `/api/skills/agent/{name}/toggle` | Get/toggle agent skills |
| POST | `/api/skills/custom` | Create custom skill |
| GET | `/api/marketplace` | Browse GhostHub marketplace |
| POST | `/api/marketplace/{id}/install` | Install community plugin |
| POST | `/api/marketplace/{id}/uninstall` | Uninstall plugin |
| POST | `/api/plugins/scan` | AST safety scan on plugin code |
| GET | `/api/skill-packs` | List 5 curated skill packs |
| POST | `/api/skill-packs/{id}/apply` | Apply a skill pack to agents |

### 7.9 Hooks and Automation
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/hooks` | List/create event-driven hooks |
| PATCH/DELETE | `/api/hooks/{id}` | Update/delete a hook |

### 7.10 Channel Bridges
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/bridges` | List all 5 bridge configurations |
| POST | `/api/bridges/{platform}/configure` | Update bridge config |
| POST | `/api/bridges/{platform}/start` | Start a bridge |
| POST | `/api/bridges/{platform}/stop` | Stop a bridge |
| POST | `/api/bridges/inbound` | Inbound webhook endpoint |

### 7.11 Triggers
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/trigger` | Trigger agents by @mention pattern |
| POST | `/api/trigger/{name}` | Trigger a specific agent |

### 7.12 Export, Sharing, Snapshots
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/export` | Export channel as markdown/JSON/HTML |
| GET | `/api/share` | Generate self-contained HTML share page |
| GET/POST | `/api/snapshot` | Export/import full session state |
| GET/POST/DELETE | `/api/templates` | Message template CRUD |
| POST | `/api/dm-channel` | Create deterministic DM channel between agents |

### 7.13 Infrastructure
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard` | Analytics: message stats, token usage, costs, uptime |
| GET | `/api/activity` | Activity timeline events |
| GET | `/api/usage` | Token usage and cost tracking data |
| POST | `/api/cleanup` | Remove stale agents |
| POST | `/api/shutdown` | Graceful server shutdown |
| POST | `/api/tunnel/start` | Start Cloudflare tunnel |
| POST | `/api/tunnel/stop` | Stop Cloudflare tunnel |
| GET | `/api/tunnel/status` | Tunnel status |
| GET | `/api/webhooks` | List webhooks |
| POST | `/api/webhooks` | Create webhook |
| PATCH/DELETE | `/api/webhooks/{id}` | Update/delete webhook |
| WebSocket | `/ws` | Real-time event hub |

### 7.14 Security Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST/DELETE | `/api/secrets` | Encrypted secrets CRUD |
| GET/POST | `/api/exec-policy/{agent}` | Get/set command allowlist/blocklist |
| POST | `/api/exec-policy/{agent}/check` | Check if command is allowed |
| GET | `/api/audit-log` | Security audit log |
| POST | `/api/data/export` | GDPR data export (ZIP) |
| POST | `/api/data/delete` | GDPR data deletion |
| GET/POST | `/api/data/retention` | Data retention policy |

---

## 8. MCP Tools (17)

These are the tools exposed to AI agents via the Model Context Protocol:

| Tool | Purpose |
|------|---------|
| `chat_send` | Send a message to a channel |
| `chat_read` | Read recent messages from a channel (with cursor-based pagination) |
| `chat_join` | Join/switch to a channel |
| `chat_who` | List online agents |
| `chat_channels` | List available channels |
| `chat_rules` | Read/propose shared rules |
| `chat_progress` | Create/update progress cards |
| `chat_propose_job` | Propose a job for user approval |
| `chat_react` | Add emoji reaction to a message |
| `chat_claim` | Claim/set agent identity name |
| `memory_save` | Save data to persistent per-agent memory |
| `memory_load` / `memory_get` | Retrieve saved memory |
| `memory_list` | List all memory keys |
| `memory_search` | Search across memory entries |
| `web_search` | Search the web (DuckDuckGo) |
| `web_fetch` | Fetch and extract content from URLs |
| `image_generate` | Generate images via configured provider |

Additional tools (not counted in the 17 shipped): `gemini_image`, `gemini_video`, `text_to_speech`, `browser_snapshot`, `set_thinking`, `sessions_list`, `sessions_send`.

---

## 9. Database Schema

**SQLite** with WAL journal mode, NORMAL sync, 64MB page cache. Located at `data/ghostlink.db`.

### 9.1 Messages Table
```sql
CREATE TABLE messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uid         TEXT NOT NULL,                       -- UUID for client-side dedup
    sender      TEXT NOT NULL,                       -- "you", agent name, or "system"
    text        TEXT NOT NULL,                       -- message content (markdown)
    type        TEXT NOT NULL DEFAULT 'chat',        -- chat|system|proposal|join|approval_request|progress|...
    timestamp   REAL NOT NULL,                       -- Unix timestamp
    time        TEXT NOT NULL,                       -- Human-readable time string
    channel     TEXT NOT NULL DEFAULT 'general',     -- channel name
    reply_to    INTEGER,                             -- parent message ID (threading)
    pinned      INTEGER NOT NULL DEFAULT 0,          -- boolean
    attachments TEXT NOT NULL DEFAULT '[]',           -- JSON array of {name, url, type}
    metadata    TEXT NOT NULL DEFAULT '{}',           -- JSON: generative UI cards, progress data, etc.
    reactions   TEXT NOT NULL DEFAULT '{}'            -- JSON: {emoji: [username, ...]}
);
-- Indexes on channel, timestamp, sender, reply_to
```

### 9.2 FTS5 Full-Text Search
```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
    text, sender, channel,
    content='messages', content_rowid='id'
);
-- Auto-synced via INSERT/DELETE/UPDATE triggers
```

### 9.3 Schedules Table
```sql
CREATE TABLE schedules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uid         TEXT NOT NULL,
    cron_expr   TEXT NOT NULL DEFAULT '* * * * *',
    agent       TEXT NOT NULL DEFAULT '',
    command     TEXT NOT NULL DEFAULT '',
    channel     TEXT NOT NULL DEFAULT 'general',
    enabled     INTEGER NOT NULL DEFAULT 1,
    last_run    REAL NOT NULL DEFAULT 0,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);
```

### 9.4 Jobs Table (from jobs.py)
```sql
CREATE TABLE jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uid         TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'task',
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open',     -- open|done|archived
    channel     TEXT NOT NULL DEFAULT 'general',
    created_by  TEXT NOT NULL DEFAULT '',
    assignee    TEXT NOT NULL DEFAULT '',
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);
```

### 9.5 Rules Table (from rules.py)
```sql
CREATE TABLE rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    text        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',   -- active|draft|archived|pending
    author      TEXT NOT NULL DEFAULT '',
    reason      TEXT NOT NULL DEFAULT '',
    created_at  REAL NOT NULL
);
```

### 9.6 Non-SQL Data
- **settings.json** — User preferences, persistent agent definitions, UI state.
- **secrets.enc** — Fernet-encrypted API keys and tokens.
- **bridges.json** — Bridge configurations per platform.
- **data/memory/{agent}/*.json** — Per-agent persistent memory files (JSON, file-locked).
- **data/{agent}_queue.jsonl** — Per-agent message trigger queue (line-delimited JSON).
- **data/hooks.json** — Event-driven automation hook definitions.
- **data/audit.log** — Security audit trail (rotation-based, thread-safe).
- **data/marketplace.json** — Installed plugin registry.
- **data/retention.json** — Data retention policy configuration.
- **data/custom_skills.json** — User-created custom skills.

---

## 10. AI Providers (13)

| Provider | Env Key(s) | Capabilities | Free Tier |
|----------|-----------|--------------|-----------|
| **Anthropic** | `ANTHROPIC_API_KEY` | chat, code | No |
| **OpenAI** | `OPENAI_API_KEY` | chat, code, image, tts, stt, embedding | No |
| **Google AI** | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | chat, code, image, video, tts, stt, code_exec, embedding | No |
| **xAI** | `XAI_API_KEY` | chat | No |
| **Mistral AI** | `MISTRAL_API_KEY` | chat, code, vision | No |
| **DeepSeek** | `DEEPSEEK_API_KEY` | chat, reasoning | No |
| **Perplexity** | `PERPLEXITY_API_KEY` | chat, search | No |
| **Cohere** | `COHERE_API_KEY` | chat, embedding | No |
| **OpenRouter** | `OPENROUTER_API_KEY` | chat, code, vision, image | No |
| **Groq** | `GROQ_API_KEY` | chat, stt | **Yes** |
| **Together AI** | `TOGETHER_API_KEY` | chat, image | **Yes** |
| **Hugging Face** | `HF_TOKEN` / `HUGGINGFACE_API_KEY` | chat, image, stt | **Yes** |
| **Ollama** | *(none — local)* | chat, code, embedding | **Yes** (local) |

The `ProviderRegistry` class resolves the best available provider for each capability (e.g., chat → Anthropic → OpenAI → Google → Groq fallback). `resolve_with_failover()` tries providers in priority order, skipping failed ones. Model catalog has a 5-minute TTL cache.

---

## 11. Channel Bridges (5)

| Platform | Transport | Features |
|----------|-----------|----------|
| **Discord** | Bot token + Gateway API polling | Bidirectional messages, formatted output, channel mapping |
| **Telegram** | Bot API long-polling | Markdown formatting, group/DM, media support |
| **Slack** | Incoming webhook | Custom username and emoji per message |
| **WhatsApp** | Cloud API (Meta Business) | Template messages, media support |
| **Generic Webhook** | Inbound POST + outbound POST | HMAC-SHA256 signing, configurable JSON templates |

All bridges are configured in Settings > Bridges with token input, channel mapping, and on/off toggles. Configs stored in `bridges.json`.

---

## 12. Deployment Setup

### 12.1 Development
```
Backend:  cd backend && python -m venv .venv && pip install -r requirements.txt && python app.py  (port 8300)
Frontend: cd frontend && npm install && npm run dev  (port 5173, proxies to 8300)
Desktop:  cd desktop && npm install && npm run dev  (Electron with launcher)
```

### 12.2 Production (Desktop App)
The Electron app bundles the backend Python code and built frontend as `extraResources`. On launch, it starts the Python backend via WSL (Windows) or native Python (Linux/Mac), creates a venv, installs deps, and opens the chat window pointing to `http://127.0.0.1:8300`.

### 12.3 CI/CD (GitHub Actions)
Triggered on version tags (`v*`). Three parallel jobs: `build-windows` (NSIS .exe), `build-linux` (AppImage + .deb), `build-mac` (.dmg). All use Node 20. Artifacts uploaded to a GitHub Release via `softprops/action-gh-release`.

### 12.4 Auto-Update
`electron-updater` checks GitHub Releases on launch. Downloads new installer, user clicks restart to apply. Filename format: `GhostLink-Setup-{version}.exe`.

### 12.5 Remote Access
Cloudflare tunnel (`cloudflared`) provides a public URL for mobile/remote access. Started/stopped via `/api/tunnel/start` and `/api/tunnel/stop`. QR code generated locally (no external API) for mobile pairing.

---

## 13. Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `PORT` | Override server port (default: 8300 from config.toml) | No |
| `HOST` | Override bind host (default: 127.0.0.1) | No |
| `ANTHROPIC_API_KEY` | Anthropic/Claude provider | If using Anthropic |
| `OPENAI_API_KEY` | OpenAI provider | If using OpenAI |
| `GEMINI_API_KEY` | Google AI provider | If using Google |
| `GOOGLE_API_KEY` | Google AI (alternative) | If using Google |
| `XAI_API_KEY` | xAI/Grok provider | If using xAI |
| `MISTRAL_API_KEY` | Mistral AI provider | If using Mistral |
| `DEEPSEEK_API_KEY` | DeepSeek provider | If using DeepSeek |
| `PERPLEXITY_API_KEY` | Perplexity provider | If using Perplexity |
| `COHERE_API_KEY` | Cohere provider | If using Cohere |
| `OPENROUTER_API_KEY` | OpenRouter meta-provider | If using OpenRouter |
| `GROQ_API_KEY` | Groq (free tier) | If using Groq |
| `TOGETHER_API_KEY` | Together AI (free tier) | If using Together |
| `HF_TOKEN` | Hugging Face (free tier) | If using HF |
| `HUGGINGFACE_API_KEY` | Hugging Face (alternative) | If using HF |
| `USER` / `USERNAME` | Used in encryption key derivation | Auto-detected |

API keys can also be set via Settings > AI in the UI, which stores them in the encrypted `secrets.enc` file and sets them as environment variables at runtime.

---

## 14. Issues, Inconsistencies, and Incomplete Areas

### 14.1 Open Bugs (from BUGS.md)
- **BUG-007** (High): OneDrive paths not fully accessible from WSL. Partial fix copies to `/tmp`, but this is slow and fragile.
- **BUG-011** (Medium): Frontend dist path mismatch in packaged app — fallback exists but may fail.
- **BUG-014** (Low): Ghost logo shows as broken image in some packaged app scenarios.
- **BUG-017/018** (Low): Electron installs to OneDrive Desktop by default; settings.json persists across uninstall.
- **BUG-043** (Low): AddAgentModal setTimeout not cancelled on unmount (fixed in v2.5.1 per changelog).
- **BUG-045** (Low): Clipboard API not checked before use in CodeBlock.
- **BUG-046** (High): No OAuth sign-in for providers — all 13 require manual API key paste.
- **BUG-028** (High): Many config/setup tasks still require terminal access, breaking the "no terminal needed" promise.
- **ARCH-003**: Desktop app depends on WSL on Windows. No native Python support yet.

### 14.2 Architecture Concerns

**app.py is 3,278 lines.** This single file contains 90+ endpoint handlers, the WebSocket hub, settings management, agent spawning, tunnel management, webhook delivery, schedule checking, activity tracking, usage tracking, and SPA middleware. It should be decomposed into focused routers/modules (e.g., `routes/messages.py`, `routes/agents.py`, `routes/providers.py`, etc.).

**No test suite.** There are zero automated tests — no unit tests, no integration tests, no end-to-end tests. The ROADMAP checklist mentions `npx tsc --noEmit` and `python -c "import app"` as the only verification steps. For a project this size (3,278-line backend, 8,450 lines of components, 44 components, 90+ endpoints), the lack of tests is a significant risk.

**In-memory state fragility.** The `AgentRegistry`, `MessageRouter` hop counters, `_usage_log`, `_ws_clients`, `_agent_processes`, and `_settings` dict are all in-memory. A server restart loses all agent registrations, active WebSocket connections, and usage tracking data. Only messages, jobs, rules, and schedules survive (SQLite).

**Webhook delivery runs in daemon threads.** `_deliver_webhooks` spawns a new `threading.Thread(daemon=True)` on every broadcast event. This is fire-and-forget with no retry, no backoff, no failure tracking, and no thread pool limiting.

**MCP bridge uses sync→async bridge pattern.** The MCP tools run in a background event loop thread (`_ensure_loop()`) and use `_run_async()` to bridge sync MCP tool functions to async store operations. This works but adds complexity and potential deadlock risks.

### 14.3 Security Observations

**Encryption key derivation is weak.** The SecretsManager derives its key from `f"{data_dir}:{USER}"` — both predictable values. The PBKDF2 salt is hardcoded (`b"ghostlink-v1"`). Anyone with access to the file system can trivially recreate the key and decrypt all secrets. This is acceptable for a local-only app but would need proper key management for any multi-user or cloud deployment.

**XOR fallback still active.** Old secrets encrypted with XOR (pre-v2.3.0) are still readable. The XOR cipher is trivially breakable.

**Rate limiter is per-IP, in-memory.** Restarting the server resets all rate limit counters. The rate limiter wouldn't protect against distributed attacks, though this is reasonable for a localhost app.

### 14.4 Frontend Observations

**No routing library.** The entire app is rendered conditionally via Zustand state flags (sidebar panels, modals, etc.). There are no URL routes, no deep linking, and no browser back/forward navigation. This is a deliberate design choice for a chat app but limits bookmarkability and shareability of views.

**SettingsPanel is 1,868 lines.** This single component handles 7 tabs of complex UI including provider configuration, bridge management, security settings, and server logs. It should be broken into separate tab components.

**Message list caps at 2,000 entries** (trimmed to 1,500). Older messages are lost from the frontend state on channel switch, though they remain in SQLite. The `@tanstack/react-virtual` dependency was added in v2.5.0 but full virtualization isn't implemented yet — messages over 200 are simply truncated from the DOM.

### 14.5 Missing/Incomplete Features (from ROADMAP.md)
- Native Windows support without WSL
- OAuth sign-in for providers
- Docker sandbox for agent execution
- Mobile app (PWA or React Native)
- Multi-user support
- Streaming token-by-token responses
- RAG document search
- Visual workflow builder
- Multi-language UI (i18n)

---

## 15. Summary Statistics

| Metric | Count |
|--------|-------|
| Backend Python files | 23 |
| Backend lines (app.py alone) | 3,278 |
| Frontend components | 44 |
| Frontend component lines (total) | 8,450 |
| REST API endpoints | 90+ |
| WebSocket event types | 14 |
| MCP tools | 17+ |
| AI providers | 13 |
| Supported AI agents | 13 |
| Channel bridges | 5 |
| Built-in skills | 28 |
| Slash commands | 23 |
| Themes | 9 |
| Session templates | 4 |
| Skill packs | 5 |
| Plugins | 3 |
| Bugs tracked | 66 (most fixed) |
| Open bugs | ~8 |
| Python dependencies | 8 (pinned) |
| npm dependencies (frontend) | 9 runtime + 9 dev |
| npm dependencies (desktop) | 2 runtime + 3 dev |

---

*End of audit. This document covers every file, component, endpoint, data model, integration, and architectural decision in the GhostLink codebase as of v2.5.1.*
