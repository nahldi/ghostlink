# GhostLink — Feature Reference

> Multi-agent AI chat orchestrator. One hub to spawn, control, and observe every AI CLI agent you run.

---

## COMPLETED FEATURES

### Phase 1: Core Polish

- [x] **Mobile fix** — dvh viewport units, ErrorBoundary wrapper, inline loading spinner in `#root`. Cloudflare tunnel tested on iOS/Android.
- [x] **Relative timestamps** — `timeago.ts` utility ("Just now", "2m ago", "1h ago", "Mar 20"). Updates every 30s via setInterval.
- [x] **Message animations** — CSS `slideIn` keyframe (opacity + translateY), applied to messages added in last 500ms.
- [x] **Notification sounds** — Per-agent sound assignment. SoundManager class with play/mute/volume. Fires when tab is blurred.
- [x] **Emoji reactions** — 6-emoji picker (thumbs up, heart, party, eyes, fire, check). Toggle on/off per user. Stored as JSON in messages table, broadcast via WebSocket.
- [x] **@all agents** — Mention `@all` to wake every connected agent. Sequential triggering with loop guard.
- [x] **21 slash commands** — `/status`, `/clear`, `/export`, `/help`, `/focus`, `/theme`, `/mute`, `/unmute`, `/agents`, `/ping`, `/stats`, `/role`, `/spawn`, `/kill`, `/pinned`, `/bookmarks`, `/jobs`, `/rules`, `/settings`, `/debug`, `/notify`. Command picker overlay in MessageInput.tsx.

### Phase 2: Agent Intelligence

- [x] **Progress cards** — `chat_progress` MCP tool. Live-updating step list with animated progress bar. WebSocket `progress_update` event for in-place updates.
- [x] **Agent handoff cards** — `HandoffCard.tsx` detects `@agent` in agent messages. Shows from/to avatars, task description, status badge (pending/accepted/in_progress/complete).
- [x] **Context inheritance** — `reply_to` field on messages. `chat_read` returns `reply_context` with parent thread. Agents receive full conversation context when mentioned in replies.
- [x] **Agent hierarchy** — Manager/worker/peer roles. `agent_spawn` MCP tool lets agents spawn sub-agents with role assignment.

### Phase 3: Observability & Control

- [x] **Activity timeline** — `GET /api/activity` endpoint. `ActivityTimeline.tsx` sidebar component. WebSocket `activity` event broadcasts for real-time feed. Logs messages, connects, disconnects, job changes.
- [x] **Agent cost tracker** — `GET /api/usage` and `POST /api/usage` endpoints. Token estimation in StatsPanel. Per-agent, per-session tracking with model-specific pricing.
- [x] **Approval gates** — `chat_propose_job` MCP tool. Agents propose work items, user approves/rejects before execution.
- [x] **Pause/Resume agents** — `POST /api/agents/{name}/pause` and `POST /api/agents/{name}/resume`. Paused agents stop receiving @mention routing. Visual indicator on agent pill.
- [x] **Scheduled tasks** — `schedules.py` with cron expression parsing. Background checker thread runs every minute. CRUD API for schedule management.

### Phase 4: Power User Features

- [x] **Command palette Ctrl+K** — `SearchModal.tsx` with three modes: `/` commands, `@` agents, `#` channels. Fuzzy search, keyboard navigation.
- [x] **Message threads** — `reply_to` field groups messages into threads. Reply indicators show parent context. Inline thread expansion.
- [x] **Message search** — SQLite FTS5 full-text index. `GET /api/search` with filters for agent, channel, date range. Highlighted results with context.
- [x] **9 chat themes** — dark, light, cyberpunk, terminal, ocean, sunset, midnight, rosegold, arctic. CSS custom property overrides. Live preview in settings.
- [x] **Export system** — `GET /api/export` supporting markdown, JSON, and HTML formats. Channel header export button with format picker.
- [x] **Webhook integration** — Full CRUD for webhook endpoints plus receiver. External payloads create system messages and trigger configured agents. Use cases: GitHub push, CI failure, monitoring alerts.
- [x] **Message editing** — Double-click message to edit. Inline textarea with save/cancel.
- [x] **Collapsible long messages** — Messages over 600 characters auto-collapse with expand toggle.
- [x] **Message bookmarking** — Star icon on messages. `/bookmarks` command to list saved messages.
- [x] **Code blocks with line numbers** — `CodeBlock.tsx` renders fenced code with syntax highlighting and line numbering.
- [x] **Keyboard shortcuts** — 7 shortcuts including Ctrl+K (palette), Ctrl+/ (help), Escape (close modals). `KeyboardShortcutsModal.tsx` for reference.
- [x] **Desktop notifications + quiet hours** — Browser Notification API integration. Configurable quiet hours window. `/notify` command for settings.
- [x] **Connection status banners** — `ConnectionBanner.tsx` shows reconnecting/disconnected state with auto-retry countdown.

### Phase 5: Desktop App

- [x] **Electron desktop app with launcher** — Single .exe opens launcher before chat. Start Server button, status indicator, version info.
- [x] **First-run setup wizard** — 6-screen guided setup: platform detection, project folder, agent discovery, auth status, preferences, launch.
- [x] **OAuth/CLI auth detection** — Detects existing auth for Claude (`claude auth status`), Codex, Gemini, GitHub (`gh auth status`). Shows Install/Connect/Connected states.
- [x] **Install/Connect/Connected 3-state UI** — Per-provider cards showing current auth state with action buttons.
- [x] **WSL-aware server management** — Detects WSL, translates paths (C:\ to /mnt/c/), launches backend in WSL shell.
- [x] **OneDrive path detection and /tmp copy** — Detects OneDrive-synced project paths, copies to /tmp to avoid sync conflicts.
- [x] **Auto-venv creation and dep installation** — Creates Python virtual environment and installs requirements.txt on first run.
- [x] **System tray with context menu** — Minimize to tray. Context menu: Show, Start/Stop Server, Quit.
- [x] **Auto-update framework** — electron-updater checks for new versions. Download and install on next launch.
- [x] **Windows .exe installer** — NSIS installer with desktop shortcut, Start Menu entry, uninstaller.

### Phase 6: Cross-Platform

- [x] **WSL detection and support** — Auto-detects WSL environment. Path translation, shell command routing.
- [x] **Platform-specific auth** — WSL bash commands for CLI auth checks. Browser-based OAuth opens via wslview or powershell.exe.
- [x] **Shell-aware agent launching** — Platform-specific wrapper selection. WSL uses tmux (wrapper_unix.py), Windows native uses wrapper.py.

### Phase 7: Agent Skills System

- [x] **Skills registry** — 23 built-in skills cataloged with metadata, categories, and descriptions.
- [x] **Per-agent skill enable/disable** — Settings stored per-agent in agentSkills config. Toggle in Agent Info Panel.
- [x] **Skills browser UI** — Searchable, categorized skill list with filter chips and install/enable toggles.
- [x] **11 skill implementations as MCP tools** — `web_search`, `web_fetch`, `file_read`, `file_write`, `file_list`, `shell_exec`, `git_status`, `git_diff`, `git_log`, `system_info`. Each registered as an MCP tool callable by agents.
- [x] **Agent memory system** — Persistent per-agent JSON storage (`agent_memory.py`). Agents read/write their own memory across sessions.
- [x] **Agent SOUL identity** — Personality prompts injected on spawn. Each agent gets a character definition that shapes its responses.
- [x] **Agent notes scratch pad** — Free-form notes field per agent. Persists across restarts.
- [x] **Agent config** — Per-agent model selection, temperature, and custom system prompt. Applied on spawn.

### Additional Features (Beyond Original Roadmap)

- [x] **Cloudflare tunnel button** — One-click tunnel creation for remote access to the chat server.
- [x] **Server shutdown endpoint** — Clean shutdown via API call. Graceful agent termination.
- [x] **Agent health metrics** — Uptime tracking, messages sent count, last active timestamp per agent.
- [x] **Stats panel with customizable sections** — Toggle visibility of individual stat sections in settings.
- [x] **Debug mode** — `/debug` toggle shows message IDs, timestamps, metadata, and WebSocket events inline.
- [x] **Persistent agents** — Agent state survives server restarts. Auto-reconnect on startup.
- [x] **12 known AI CLI agents supported** — Claude, Codex, Gemini, Grok, Copilot, Aider, Continue, Cursor, Cline, Devin, Tabnine, Amazon Q.
- [x] **Brand-accurate SVG icons** — Custom SVG icons for every supported provider. Correct brand colors and shapes.
- [x] **Agent thinking glow** — Spinning border animation on agent avatar while agent is actively working. Driven by heartbeat, clears 3s after idle.

---

## PLANNED FEATURES

### Phase 2: Agent Intelligence (remaining)

- [ ] **Consensus mode** — `/consensus` sends question to all agents independently. Summary card ranks answers side-by-side with synthesis. ConsensusCard.tsx.
- [ ] **Agent debates** — `/debate [agent1] [agent2] [topic]` creates structured FOR/AGAINST rounds. DebateCard.tsx with split view and judge button.
- [ ] **Smart auto-routing** — Messages without @mentions get classified and routed to the best-fit agent. Keyword matching with LLM fallback.

### Phase 3: Observability & Control (remaining)

- [ ] **Terminal peek** — Live view of agent tmux pane output. Backend captures via `tmux capture-pane`. TerminalPeek.tsx with monospace mini-terminal. Wrapper.py has capture logic, needs frontend component.
- [ ] **File change feed** — Real-time list of files agents modify. Uses watchfiles/inotifywait. FileChangeFeed.tsx with diff viewer on click.

### Phase 4: Power User Features (remaining)

- [ ] **Split view** — Two channels side by side with draggable divider. SplitView.tsx.
- [ ] **Agent spotlight** — Full-page agent dashboard: recent messages, files changed, active jobs, token usage, terminal peek, role/skills, uptime. Partial implementation exists in AgentInfoPanel.
- [ ] **Session replay** — Playback controls (play/pause/speed) over stored messages with original timing. ReplayViewer.tsx.
- [ ] **Plugin system** — Drop-in Python modules in `plugins/` directory. Register MCP tools, API endpoints, WebSocket events. Planned built-ins: github.py, docker.py, testing.py.

### Phase 5: Desktop App (remaining)

- [ ] **macOS .dmg installer** — Electron + electron-builder for macOS. Native menu bar, dock icon.
- [ ] **Linux .AppImage installer** — Electron + electron-builder for Linux. .deb package alternative.

### Phase 6: Cross-Platform (remaining)

- [ ] **Native Windows support** — Full support without WSL. wrapper_win.py using PowerShell/CMD process spawning. Partial implementation exists.
- [ ] **macOS support** — tmux/screen-based agent launching. Native folder picker via osascript.
- [ ] **Linux native support** — tmux/screen-based agent launching. zenity/kdialog folder picker.
- [ ] **Package manager installs** — pip, npm, brew, winget, Docker image, one-liner curl install.

### Phase 7: Agent Skills System (remaining)

- [ ] **Skills marketplace** — Community-driven skill sharing. Browse, rate, review, one-click install. Verified publisher badges.
- [ ] **Custom skill creator UI** — Wizard: name/description/category, implementation type, parameter definition, code editor, sandbox test, save.

---

## TESTING PROTOCOL

Every feature follows a 4-step test protocol before shipping:

1. **Fail test** — Deliberately trigger edge cases: bad input, network failure, missing data, killed backend. Verify graceful degradation (error messages, fallback UI, no crashes).
2. **Fix test** — Apply the implementation or fix. Verify the specific behavior works correctly with valid input.
3. **Smoke test** — End-to-end pass: start server, open browser, use feature, verify result. Check that nothing else broke (regression check).
4. **Stress test** — High volume: 100+ messages/min, 5+ agents simultaneous, rapid @mentions, concurrent channel switching, WebSocket reconnect storms.

### Sandbox Testing

- New features built and tested in sandbox first (port 8400)
- Frontend dev server on port 5173 for hot-reload development
- Production deployment (port 8300) only after full test pass

### Integration Tests

- **WebSocket**: connect, send, receive, disconnect, reconnect, verify message ordering
- **MCP**: register agent, send via MCP tool, read via MCP tool, verify message appears in chat
- **Wrapper**: start agent, @mention, verify prompt injection into agent session, verify response arrives

---

## ARCHITECTURE NOTES

### Token Usage Tracking

- Claude Opus 4: ~$15/MTok input, ~$75/MTok output
- Claude Sonnet 4: ~$3/MTok input, ~$15/MTok output
- GPT-5.4: varies by plan
- Codex: varies by plan
- Tracked per-agent, per-session, per-channel, per-day
- Running total in sidebar, detailed breakdown via `/stats` and StatsPanel

### Rate Limits

- WebSocket: max 100 messages/minute per client
- API: max 60 requests/minute per IP
- MCP: max 30 tool calls/minute per agent
- File uploads: max 10MB per file, max 100MB total storage
- Channels: max 20
- Agents: max 10 simultaneous

### Performance Targets

- First Contentful Paint: < 1.5s
- Message send-to-display: < 200ms
- WebSocket latency: < 50ms local, < 200ms via tunnel
- Message render: < 16ms (60fps)
- Search results: < 500ms
- Channel switch: < 100ms
- Agent spawn: < 5 seconds
- WebSocket reconnect: < 3 seconds
- Memory: < 200MB with 1000 messages loaded (server + 3 agents)

### Security

- No personal data in distributed code (verified via grep scan)
- Settings stored locally only
- No telemetry or tracking
- API keys never logged or transmitted
- OAuth tokens stored securely per OS keychain

### Accessibility

- Keyboard navigation for all actions
- Screen reader support (ARIA labels)
- High contrast mode
- Reduced motion option
