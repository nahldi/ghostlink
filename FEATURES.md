# GhostLink — Feature Reference

> Multi-agent AI chat orchestrator. One hub to spawn, control, and observe every AI CLI agent you run.

---

## COMPLETED FEATURES

### Core Chat
- [x] **Real-time WebSocket** — messages, typing indicators, agent status, reactions, channel updates
- [x] **Message animations** — CSS slideIn keyframe for new messages
- [x] **Relative timestamps** — timeago.ts ("Just now", "2m ago", "1h ago")
- [x] **Notification sounds** — per-agent sound assignment, SoundManager with play/mute/volume
- [x] **Emoji reactions** — 6-emoji picker, toggle per user, stored in DB, broadcast via WebSocket
- [x] **@all agents** — mention @all to wake every connected agent
- [x] **21 slash commands** — /status, /clear, /export, /help, /focus, /theme, /mute, /unmute, /agents, /ping, /stats, /role, /spawn, /kill, /pinned, /bookmarks, /jobs, /rules, /settings, /debug, /notify
- [x] **Message editing** — double-click to edit, PATCH endpoint, broadcast updates
- [x] **Message bookmarking** — star icon, /bookmarks command
- [x] **Collapsible long messages** — auto-collapse at 600 chars with expand toggle
- [x] **Code blocks with line numbers** — CodeBlock.tsx with syntax highlighting
- [x] **Command history** — Up/Down arrows in input to recall previous messages (localStorage)
- [x] **Message search** — FTS5 full-text search index with LIKE fallback
- [x] **Connection status banners** — reconnecting/disconnected state with auto-retry

### Agent Intelligence
- [x] **Progress cards** — chat_progress MCP tool, live-updating step list with progress bar
- [x] **Agent handoff cards** — HandoffCard.tsx detects @agent in messages
- [x] **Context inheritance** — reply_to field on messages
- [x] **Agent hierarchy** — manager/worker/peer roles via API
- [x] **Approval gates** — chat_propose_job MCP tool, user approves/rejects
- [x] **Pause/Resume agents** — POST /api/agents/{name}/pause and resume
- [x] **Scheduled tasks** — ScheduleStore with cron expression parsing, background checker every 60s, CRUD API
- [x] **Approval prompt interception** — detects CLI permission prompts in tmux, shows Allow/Deny cards in chat, injects response back to terminal
- [x] **Smart context compression** — compresses old messages into summaries for token efficiency when agents read 30+ messages
- [x] **Agent response modes** — per-agent: Only @mentioned, Always respond, Listen & decide, Silent observer
- [x] **Agent presets** — 6 one-click presets: Code Reviewer, PM, DevOps, Creative Writer, Research Analyst, Test Engineer
- [x] **Auto-route toggle** — settings toggle: agents receive ALL messages vs only @mentioned
- [x] **Agent feedback** — thumbs up/down on agent messages, stored in agent memory
- [x] **Voice input** — push-to-talk via Web Speech API, transcribes to message input
- [x] **Share conversations** — export as self-contained styled HTML page
- [x] **API rate limiting** — 120 req/min per IP on all /api/ endpoints
- [x] **Token expiration** — agent tokens auto-rotate on heartbeat (1-hour TTL)
- [x] **Skill safety scanning** — content validation blocks dangerous patterns (eval, exec, shell injection)
- [x] **ARIA accessibility** — role/aria-label on main UI regions, reduced motion support
- [x] **Config schema validation** — helpful errors on missing/malformed config.toml sections

### Observability
- [x] **Activity timeline** — GET /api/activity, real-time feed via WebSocket
- [x] **Agent cost tracker** — token estimation, per-agent per-session tracking
- [x] **Dashboard analytics** — GET /api/dashboard with message stats, hourly counts, agent status, token usage, estimated cost, uptime

### Power User Features
- [x] **Command palette Ctrl+K** — SearchModal.tsx with /, @, # modes
- [x] **9 chat themes** — dark, light, cyberpunk, terminal, ocean, sunset, midnight, rosegold, arctic
- [x] **Export system** — markdown, JSON, HTML formats
- [x] **Keyboard shortcuts** — Ctrl+K, Ctrl+/, Ctrl+N, Ctrl+1-9, Alt+Up/Down, Escape, Ctrl+Shift+M
- [x] **Desktop notifications + quiet hours** — Browser Notification API with configurable quiet hours
- [x] **Conversation starters** — clickable suggestion chips in empty channels
- [x] **Drag & drop files** — drag images into chat to upload
- [x] **Rich URL previews** — OpenGraph cards with title, description, image, site name
- [x] **Generative UI cards** — agents render tables, lists, key-value pairs, metrics, buttons, code blocks via metadata
- [x] **Session snapshots** — export/import full session state as JSON
- [x] **Message templates** — save/reuse frequently used prompts
- [x] **Agent DM channels** — deterministic DM channels between agent pairs
- [x] **Onboarding tour** — 6-step interactive walkthrough for new users

### Desktop App
- [x] **Electron desktop app with launcher** — single .exe, launcher + chat window
- [x] **First-run setup wizard** — 6-screen guided setup
- [x] **CLI auth detection** — Claude, Codex, Gemini, GitHub auth status
- [x] **WSL-aware server management** — path translation, WSL shell commands
- [x] **OneDrive path detection** — copies to /tmp for WSL compatibility
- [x] **Auto-venv creation** — creates venv and installs deps on first run
- [x] **System tray** — context menu with show/start/stop/quit
- [x] **Auto-update** — electron-updater checks GitHub Releases, download + restart
- [x] **Windows .exe installer** — NSIS with desktop shortcut

### Agent Skills System
- [x] **Skills registry** — 16 built-in skills cataloged with metadata
- [x] **Per-agent skill enable/disable** — toggle in Agent Info Panel
- [x] **Skills browser UI** — searchable, categorized skill list
- [x] **Agent memory system** — persistent per-agent JSON storage
- [x] **Agent SOUL identity** — personality prompts per agent
- [x] **Agent notes scratch pad** — free-form notes per agent
- [x] **Agent config** — per-agent model, temperature, system prompt

### Additional
- [x] **Cloudflare tunnel** — one-click remote access
- [x] **Server shutdown endpoint** — graceful agent termination
- [x] **13 known AI CLI agents** — Claude, Codex, Gemini, Grok, Copilot, Aider, Goose, Pi, Cursor, Cody, Continue, OpenCode, Ollama
- [x] **Brand-accurate SVG icons** — per-provider icons and colors
- [x] **Agent thinking glow** — spinning border animation while agent works
- [x] **Webhook integration** — CRUD for webhook endpoints
- [x] **Mobile responsive** — dvh units, ErrorBoundary, inline loading

---

## PLANNED FEATURES

### Agent Intelligence (remaining)
- [x] **Consensus mode** — /consensus asks all agents the same question via @all
- [x] **Agent debates** — /debate agent1 agent2 topic, structured FOR/AGAINST prompts
- [x] **Smart auto-routing** — keyword-based message classification routes to best-fit agent (none/all/smart modes)

### Observability (remaining)
- [x] **Terminal peek** — live view of agent tmux pane output with auto-scroll
- [x] **File change feed** — real-time file change monitoring via plugin, tracks creates/modifies/deletes

### Power User (remaining)
- [x] **Split view** — two channels side by side with divider
- [x] **Session replay** — playback stored messages with original timing, speed controls
- [x] **Plugin system** — drop-in Python modules in plugins/ directory, auto-discovered and loaded on startup

### Desktop (remaining)
- [ ] **macOS .dmg installer**
- [ ] **Linux .AppImage installer**
- [ ] **Native Windows support** — without WSL

### Skills (remaining)
- [x] **Skills marketplace** — browse, install, create, export/import custom skills (plugin-based, no external hosting)
- [x] **Custom skill creator** — create custom skills via API with name, description, category, implementation type (prompt/script/MCP)

---

## ARCHITECTURE

### Ports
- 8300: HTTP/WebSocket (configurable in config.toml)
- 8200: MCP HTTP (configurable)
- 8201: MCP SSE (configurable)

### MCP Tools (10 shipped)
chat_send, chat_read, chat_join, chat_who, chat_channels, chat_rules, chat_progress, chat_propose_job, chat_react, chat_claim

### Components (33)
ActivityTimeline, AddAgentModal, AgentBar, AgentIcon, AgentInfoPanel, AgentMiniCard, AgentStatusPill, ApprovalCard, ChannelTabs, ChatMessage, CodeBlock, CommandBar, ConnectionBanner, ConsensusCard, DecisionCard, GenerativeCard, HandoffCard, JobProposal, JobsPanel, KeyboardShortcutsModal, MessageInput, MobileHeader, MobileSidebar, OnboardingTour, ProgressCard, RemoteSession, RulesPanel, SearchModal, SettingsPanel, Sidebar, StatsPanel, TypingIndicator, UrlPreview
