# AI Chattr — Project Status & Handoff Document
**Last updated:** 2026-03-21 06:30 UTC
**Owner:** Finn (FinnTheDogg / nahlidify)

---

## HANDOFF PROMPT

You are picking up the AI Chattr project — a multi-agent AI chat platform. This is a **production-ready** product with a FastAPI backend, React/TypeScript frontend, and WebSocket real-time communication. The codebase is fully functional with a polished UI, 20+ MCP tools, agent memory/SOUL system, and ready for GitHub public release + desktop app packaging.

**Critical context:**
- Finn wants this to be a **distributable product** better than ChatGPT/Claude apps — a unified command center for ALL AI agents.
- The **distributable copy** lives at `aichttrr/` — this is what goes to GitHub. The parent `aichttr/` has Finn's personal config files.
- Private GitHub repo: `https://github.com/nahldi/aichttr` — push `aichttrr/` contents only.
- **Never push personal data** — SOUL.md, AGENTS.md, USER.md, memory/, config with personal paths are all gitignored.
- All code changes go in `aichttrr/` first, then build frontend, then deploy dist to parent for live testing.

---

## ARCHITECTURE

```
aichttrr/                          # Clean distributable (GitHub repo root)
├── backend/
│   ├── app.py                     # FastAPI server + WebSocket hub + 40+ API endpoints
│   ├── config.toml                # Agent configuration (generic, user fills in)
│   ├── mcp_bridge.py              # MCP server (HTTP:8200, SSE:8201) — 22+ tools for agents
│   ├── mcp_proxy.py               # Per-agent MCP identity proxy
│   ├── wrapper.py                 # Agent CLI launcher (tmux) with SOUL/memory injection
│   ├── wrapper_unix.py            # Unix-specific tmux injection
│   ├── store.py                   # SQLite message store with FTS5 full-text search
│   ├── registry.py                # Agent registry with hierarchy + health metrics
│   ├── router.py                  # @mention routing + loop guard
│   ├── jobs.py                    # Job tracking
│   ├── rules.py                   # Shared rules
│   ├── skills.py                  # Skills registry (23 built-in skills)
│   ├── schedules.py               # Cron-style scheduled tasks
│   └── agent_memory.py            # Per-agent persistent memory + SOUL + notes
├── frontend/
│   ├── src/
│   │   ├── App.tsx                # Main layout — sidebar + agent bar + chat + stats
│   │   ├── components/
│   │   │   ├── Sidebar.tsx        # 240px sidebar (agents, channels, activity) — collapses to 56px
│   │   │   ├── AgentBar.tsx       # Top bar agent chips with thinking glow + start/stop
│   │   │   ├── AgentIcon.tsx      # Brand-accurate SVG icons for 12 AI providers
│   │   │   ├── AgentInfoPanel.tsx # 4-tab agent detail (Overview, Stats, Skills, Terminal)
│   │   │   ├── ChatMessage.tsx    # Messages with edit, collapse, reply, pin, reactions
│   │   │   ├── MessageInput.tsx   # Input with 14 slash commands + @mention autocomplete
│   │   │   ├── CommandBar.tsx     # Header bar with channel name + badges + search
│   │   │   ├── SearchModal.tsx    # Full command palette (/, @, # prefixes)
│   │   │   ├── StatsPanel.tsx     # Right info panel (session, tokens, metrics, activity)
│   │   │   ├── SettingsPanel.tsx  # Settings with toggles for all features
│   │   │   ├── HandoffCard.tsx    # Agent-to-agent task handoff visualization
│   │   │   ├── ActivityTimeline.tsx # Real-time activity feed
│   │   │   ├── ConsensusCard.tsx  # Multi-agent response comparison
│   │   │   ├── ConnectionBanner.tsx # WebSocket disconnect/reconnect banners
│   │   │   ├── KeyboardShortcutsModal.tsx # Ctrl+/ shortcuts help
│   │   │   └── ... (20+ components)
│   │   ├── stores/chatStore.ts    # Zustand state (messages, agents, channels, settings, activities)
│   │   ├── hooks/useWebSocket.ts  # WS + desktop notifications + favicon badge
│   │   ├── lib/                   # API client, sounds, timeago, WebSocket class
│   │   └── types/index.ts         # All TypeScript interfaces
│   └── dist/                      # Built frontend (served by backend)
├── FEATURES.md                    # Feature roadmap (Phases 1-7)
├── DESKTOP_APP_PLAN.md            # Electron desktop app architecture plan
├── README.md                      # Public-facing documentation
├── LICENSE                        # MIT
└── start.sh                       # Server start script
```

## TECH STACK
- **Backend:** Python 3.11+, FastAPI, aiosqlite, uvicorn, MCP SDK
- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand
- **Communication:** MCP (Model Context Protocol) over HTTP/SSE
- **Agent Execution:** tmux sessions managed by wrapper.py
- **Real-time:** WebSocket for all live updates
- **Database:** SQLite with FTS5 full-text search
- **Build:** `cd frontend && npm run build` serves from `frontend/dist/`

---

## WHAT'S DONE (ALL WORKING)

### Backend — 40+ API Endpoints
- [x] FastAPI server on port 8300 with WebSocket hub
- [x] MCP bridge (HTTP:8200, SSE:8201) with 22+ tools
- [x] Agent wrapper — launches CLI agents in tmux with SOUL/memory injection
- [x] Agent registry with hierarchy (manager/worker/peer), health metrics, uptime tracking
- [x] Message store (SQLite) with FTS5 search, reactions, pinning, attachments
- [x] @mention routing with loop guard (configurable max hops)
- [x] Agent spawn/kill/pause/resume APIs — non-blocking spawn, agents don't disappear
- [x] Heartbeat with thinking state detection + 3s debounce
- [x] Channel CRUD with message migration on rename
- [x] Settings API with persistent JSON storage
- [x] Skills registry — 23 built-in skills, per-agent enable/disable
- [x] 12 known AI agent CLIs supported
- [x] Activity timeline API with WebSocket broadcasts
- [x] Token usage tracking per agent
- [x] Scheduled tasks (cron-style) with background checker
- [x] Webhooks — receive external events, trigger agents
- [x] Export API (markdown/JSON/HTML)
- [x] Agent hierarchy — manager/worker/peer roles, spawn from MCP
- [x] Agent memory system — persistent per-agent (save/load/search/delete)
- [x] Agent SOUL/identity — personality prompts injected on spawn
- [x] Agent notes — scratch pad per agent
- [x] Agent config — model, temperature, max tokens, custom prompts
- [x] Agent health endpoint — uptime, messages sent, last active

### MCP Tools (22+ tools available to agents)
- Chat: `chat_send`, `chat_read`, `chat_progress`, `chat_react`
- Web: `web_search` (DuckDuckGo), `web_fetch`, `browser_screenshot` (Playwright)
- Files: `file_read`, `file_write`, `file_list`
- Shell: `shell_exec` (with timeout), `git_status`, `git_diff`, `git_log`
- System: `system_info`
- Memory: `memory_save`, `memory_load`, `memory_list`, `memory_search`, `memory_delete`
- Notes: `notes_save`, `notes_load`
- Identity: `soul_read`
- Hierarchy: `agent_spawn`

### Frontend — Full UI
- [x] 240px sidebar (Agents + Channels + Activity) — collapses to 56px icon rail
- [x] Agent bar at top with thinking glow, status dots, start/stop on hover
- [x] Brand-accurate SVG icons for 12 AI providers (Anthropic A, OpenAI knot, Gemini sparkle, etc)
- [x] Command bar with channel name, agent/message badges, search shortcut
- [x] Stats/Info panel on right (toggleable from settings) — session, tokens, metrics, agent status, activity
- [x] Settings panel — username, font size, loop guard, theme, notifications, desktop notifications, quiet hours, debug mode, info panel toggle, persistent agents
- [x] Jobs panel — TO DO, ACTIVE, CLOSED with create
- [x] Rules panel — ACTIVE, DRAFTS, ARCHIVED with create
- [x] Agent info panel — 4 tabs: Overview, Stats, Skills, Terminal
- [x] 14 slash commands: /status /clear /export /help /focus /theme /mute /unmute /agents /ping /stats /role /spawn /kill
- [x] Full command palette (Ctrl+K) with /, @, # prefix modes
- [x] Channel management — right-click: rename, delete, duplicate, pin, category, description. Drag reorder. Double-click rename.
- [x] Message features — edit (double-click), collapse long messages, reply, pin, reactions, copy, delete
- [x] Keyboard shortcuts — Ctrl+/, Ctrl+K, Ctrl+N, Ctrl+1-9, Alt+Up/Down, Escape, Ctrl+Shift+M
- [x] Desktop notifications via Notification API + favicon unread badge + quiet hours
- [x] Connection status banners (disconnected/reconnecting/connected)
- [x] Dark + Light themes (comprehensive, both fully working)
- [x] Mobile responsive layout with hamburger menu + safe areas
- [x] Scroll-to-bottom arrow with new message count
- [x] Error boundary with reload button

### Distribution
- [x] Private GitHub repo: https://github.com/nahldi/aichttr
- [x] Clean distributable at `aichttrr/` — zero personal info (verified by grep scan)
- [x] README.md with full docs, setup, architecture, contributing guide
- [x] LICENSE (MIT)
- [x] DESKTOP_APP_PLAN.md — full Electron app architecture
- [x] .gitignore covers all personal data, .claude/, data/, uploads/

---

## WHAT NEEDS TO BE DONE NEXT

### Immediate — Desktop App
1. **Build the Electron desktop app** — see DESKTOP_APP_PLAN.md for full architecture
   - Launcher screen with Start Server button
   - OAuth login for Claude/OpenAI/Google/xAI
   - System tray integration
   - Auto-update via electron-updater
   - Cross-platform: Windows .exe, macOS .dmg, Linux .AppImage

### Polish
2. **More visual themes** — Cyberpunk, Terminal Green, Ocean Blue, Minimal
3. **Split view** — two channels side by side
4. **Session replay** — playback recorded conversations
5. **Plugin system** — drop-in capability extensions
6. **Skills marketplace** — community-driven skill sharing

### Agent Intelligence
7. **Consensus mode** — `/consensus` command, all agents answer independently
8. **Agent debates** — `/debate agent1 agent2 topic`
9. **Smart auto-routing** — describe task without @mention, auto-picks best agent

---

## KEY DECISIONS MADE
- Agents always show in the bar (online or offline) — never disappear during spawn
- Sidebar starts collapsed, user can expand — layout adjusts with smooth transition
- Stats/Info panel on right is toggleable from settings
- All 23 skills enabled by default
- No personal data in distributed code — verified via grep scan
- User messages right side, agent messages left side
- Thinking glow ONLY when agent is actively generating
- Each provider has tailored CLI flags
- Agents get SOUL identity, memory, notes, and config injected on spawn
- MCP tools use only stdlib (urllib, subprocess) — Playwright is optional
- Backend broadcasts always include ALL agents (live + offline from config)

## HOW TO BUILD & RUN
```bash
# Backend
cd backend && source ../.venv/bin/activate && python app.py

# Frontend (after changes)
cd frontend && npm install && npm run build

# Launch agents
cd backend && python wrapper.py claude --headless
cd backend && python wrapper.py codex --headless

# Server URL
http://127.0.0.1:8300
```

## HOW TO DEPLOY TO GITHUB
```bash
cd aichttrr
# Verify no personal data
grep -rn "skull\|nahlidify\|FinnTheDogg" --include="*.py" --include="*.ts" --include="*.tsx" --include="*.md"
# Should only show nahldi in README.md GitHub URL

git add -A && git commit -m "description" && git push
```

## BUILD STATUS
- **TypeScript:** 0 errors
- **Console:** 0 errors
- **Frontend:** 298 modules, 73KB CSS, 481KB JS
- **Personal data:** CLEAN (only nahldi in GitHub URL)
