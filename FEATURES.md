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
- [x] **23 slash commands** — /status, /clear, /export, /help, /focus, /theme, /mute, /unmute, /agents, /ping, /stats, /role, /consensus, /debate, /spawn, /kill, /pinned, /bookmarks, /jobs, /rules, /settings, /debug, /notify
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

### Channel Bridges (v1.9.0)
- [x] **Discord bridge** — bidirectional message sync via bot token, message polling, formatted output
- [x] **Telegram bridge** — Bot API long-polling, Markdown formatting, group/DM support
- [x] **Slack bridge** — incoming webhook with custom username and emoji
- [x] **WhatsApp bridge** — Cloud API (Meta Business) integration
- [x] **Generic webhook bridge** — inbound/outbound with HMAC-SHA256 signing
- [x] **Bridge management UI** — Settings > Bridges tab with token input, channel mapping, on/off toggles

### Streaming & Observability (v1.7.0–v1.9.0)
- [x] **Streaming thinking bubbles** — live agent reasoning visible in chat during processing
- [x] **Server log viewer** — real-time backend logs in Settings with level filtering
- [x] **Server config viewer** — ports, paths, routing mode, uptime at a glance
- [x] **Provider API key verification** — tests key against provider API before saving

### Settings & Configuration (v1.8.0)
- [x] **Persistent agent editor** — edit label, workspace, CLI args, and color for saved agents
- [x] **13 AI providers** — Anthropic, OpenAI, Google, xAI, Mistral, DeepSeek, Perplexity, Cohere, OpenRouter, Groq, Together, HuggingFace, Ollama
- [x] **Capability-based provider routing** — auto-selects best provider per capability
- [x] **Free tier detection** — highlights free providers (Groq, Together, HuggingFace, Ollama)

### Additional
- [x] **Cloudflare tunnel** — one-click remote access
- [x] **Server shutdown endpoint** — graceful agent termination
- [x] **13 known AI CLI agents** — Claude, Codex, Gemini, Grok, Copilot, Aider, Goose, Pi, Cursor, Cody, Continue, OpenCode, Ollama
- [x] **Brand-accurate SVG icons** — per-provider icons and colors
- [x] **Agent thinking glow** — spinning border animation while agent works
- [x] **Webhook integration** — CRUD for webhook endpoints
- [x] **Mobile responsive** — dvh units, ErrorBoundary, inline loading

### Agent Intelligence
- [x] **Consensus mode** — /consensus asks all agents the same question via @all
- [x] **Agent debates** — /debate agent1 agent2 topic, structured FOR/AGAINST prompts
- [x] **Smart auto-routing** — keyword-based message classification routes to best-fit agent (none/all/smart modes)

### Observability
- [x] **Terminal peek** — live view of agent tmux pane output with auto-scroll
- [x] **File change feed** — real-time file change monitoring via plugin, tracks creates/modifies/deletes

### Power User
- [x] **Split view** — two channels side by side with divider
- [x] **Session replay** — playback stored messages with original timing, speed controls
- [x] **Plugin system** — drop-in Python modules in plugins/ directory, auto-discovered and loaded on startup

### v3.x Additions
- [x] **StreamingText** — word-by-word reveal animation for new agent messages (15ms/word)
- [x] **ThinkingParticles** — SVG orbiting particles around agent chip during thinking
- [x] **Toast stacking** — spring-animated, swipe-to-dismiss, max 5 visible
- [x] **Mobile long-press** — 500ms hold for action menu on messages
- [x] **Mobile sidebar gestures** — swipe-from-edge to open/close
- [x] **Route split** — 3400→612 line app.py, 13 route modules
- [x] **Integration tests** — 56 tests across core, integration, modules
- [x] **DB recovery** — auto-restores from .bak on corrupt/empty SQLite files
- [x] **Deque log rotation** — O(1) log management with maxlen
- [x] **Memory cache TTL** — 5-minute TTL on agent memory cache

### Desktop
- [x] **Windows NSIS installer** — one-click with custom install directory
- [x] **macOS .dmg installer** — drag to Applications
- [x] **Linux AppImage + .deb** — universal and Debian packages
- [x] **Native Windows Python support** — no WSL required when Python is installed natively
- [x] **Auto-updates** — electron-updater with latest.yml from GitHub Releases
- [x] **System tray** — quick actions, server control

### Skills
- [x] **Skills marketplace** — browse, install, create, export/import custom skills
- [x] **Custom skill creator** — API with name, description, category, implementation type
- [x] **28 built-in skills** — code review, debugging, testing, documentation, etc.

---

## ARCHITECTURE

### Ports
- 8300: HTTP/WebSocket (configurable in config.toml)
- 8200: MCP HTTP (configurable)
- 8201: MCP SSE (configurable)

### MCP Tools (17 shipped)
chat_send, chat_read, chat_join, chat_who, chat_channels, chat_rules, chat_progress, chat_propose_job, chat_react, chat_claim, memory_save, memory_load, memory_list, memory_search, web_search, web_fetch, image_generate

### Components (53)
ActivityTimeline, AddAgentModal, AgentBar, AgentIcon, AgentInfoPanel, AgentMiniCard, AgentStatusPill, ApprovalCard, BulkDeleteBar, ChannelSummary, ChannelTabs, ChatMessage, CodeBlock, CommandBar, ConnectionBanner, ConsensusCard, DecisionCard, EmptyState, GenerativeCard, HandoffCard, HelpPanel, JobProposal, JobsPanel, KeyboardShortcutsModal, MessageInput, MobileHeader, MobileSidebar, MobilePanel, OnboardingTour, ProgressCard, RemoteSession, ReplayViewer, RulesPanel, ScrollArrow, SearchModal, SessionBar, SessionLauncher, SettingsPanel, Sidebar, Skeleton, SplitView, StatsPanel, StreamingText, TerminalPeek, ThinkingParticles, Toast, TypingIndicator, UrlPreview
