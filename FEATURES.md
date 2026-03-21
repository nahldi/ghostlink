# AI Chattr — Ultimate Feature Blueprint

> The only tool you need running to get projects going.
> Every feature below includes exactly HOW to implement it.

---

## PHASE 1: Core Polish (Make it feel alive)
*Goal: Fix what's broken, make the base experience smooth and polished.*

### 1.1 Mobile Fix
**What:** Blank screen on mobile via Cloudflare tunnel.
**How:**
- `frontend/index.html`: Add inline loading indicator inside `#root`
- `frontend/src/lib/ws.ts`: Wrap all WebSocket ops in try/catch — never crash
- `frontend/src/hooks/useWebSocket.ts`: Catch all errors in useEffect
- `frontend/src/index.css`: Add `html,body,#root { min-height:100dvh; background:#12121d; color:#e4e1f0 }`
- Add ErrorBoundary component wrapping entire App
**Test:** Start server, cloudflare tunnel, open on phone → should show loading then UI
**Fail test:** Kill backend while page is open → should show reconnecting, not crash

### 1.2 Relative Timestamps
**What:** "2m ago", "1h ago", "Just now" instead of raw timestamps.
**How:**
- Create `frontend/src/lib/timeago.ts` — function `timeAgo(timestamp: number): string`
- Logic: <60s="Just now", <60m="Xm ago", <24h="Xh ago", else "Mar 20"
- Update every 30s via `setInterval` in a custom hook `useTimeAgo(ts)`
- Apply in `ChatMessage.tsx` — replace raw `.time` display
**Test:** Send message → shows "Just now" → wait 1 min → shows "1m ago"

### 1.3 Message Animations
**What:** Messages slide in smoothly, not just pop.
**How:**
- `frontend/src/index.css`: Add keyframe `@keyframes slideIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }`
- Apply to new messages via CSS class `.message-enter { animation: slideIn 0.2s ease-out }`
- In `ChatMessage.tsx`: Add className conditionally for messages added in last 500ms
**Test:** Send message → slides in from below with fade

### 1.4 Notification Sounds
**What:** Different sounds per agent when they respond.
**How:**
- `frontend/public/sounds/` — 7 short .mp3 files (notification tones, can reuse from reference-agentchattr/static/sounds/)
- `frontend/src/lib/sounds.ts` — SoundManager class with `play(agentName)`, `setVolume()`, `mute()`
- In `useWebSocket.ts` `case 'message'`: If message is from an agent and tab is not focused, play sound
- Settings panel: per-agent sound selector dropdown, master mute toggle
- Store sound prefs in settings via API
**Test:** Have agent send message while tab is blurred → hear notification. Mute → no sound.

### 1.5 Emoji Reactions
**What:** React to messages with emoji. Agents can see reactions.
**How:**
- Backend: Add `reactions` column to messages table (JSON: `{"👍": ["claude","user"], "🔥": ["codex"]}`)
- Backend: `POST /api/messages/{id}/react` — body: `{"emoji": "👍", "sender": "user"}`
- Backend: Broadcast `reaction` event via WebSocket
- Frontend: Hover message → show reaction picker (👍 ❤️ 🎉 👀 🔥 ✅)
- Frontend: Show reaction counts below message
- MCP bridge: Add `chat_react(message_id, emoji, sender)` tool
**Test:** React to message → count shows → another react → count increments
**Fail test:** React twice with same emoji = toggle (remove reaction)

### 1.6 @all Agents
**What:** Type `@all` to wake every connected agent.
**How:**
- Backend `router.py`: Detect `@all` in message text → return all registered agent names as targets
- Backend: Trigger each agent sequentially (with loop guard still active)
- Frontend: Add "@all" to mention autocomplete list
- Frontend: Render @all pill same as individual mentions
**Test:** Send "@all what's your status?" → each agent reads and responds

### 1.7 Quick Slash Commands
**What:** Type `/` for quick actions.
**How:**
- Frontend: In `MessageInput.tsx`, detect `/` at start of input → show command picker overlay
- Commands:
  - `/status` — shows all agent states as a system message
  - `/clear` — clears current channel chat (local only, not server)
  - `/export` — downloads channel as markdown file
  - `/help` — shows available commands
  - `/focus [agent] [topic]` — sets agent role dynamically
  - `/cost` — shows token usage if tracked
- Backend: `POST /api/command` endpoint handles server-side commands
- Frontend: Client-side commands execute locally
**Test:** Type `/` → see command list → select `/status` → see agent status card

---

## PHASE 2: Agent Intelligence (Make agents smarter together)

### 2.1 Progress Cards
**What:** Live-updating progress when agents do multi-step work.
**How:**
- Backend: New message type `"progress"` with metadata: `{ steps: [{label, status}], current: 2, total: 5 }`
- MCP bridge: `chat_progress(sender, channel, steps, current, total)` tool
- Frontend: `ProgressCard.tsx` component — animated progress bar, step list with ✅/⏳/⬜ indicators
- WebSocket: `progress_update` event to update existing progress card in-place (by message ID)
**Test:** Agent sends progress card → updates step 1→2→3 → all animate smoothly
**Stress test:** 3 agents sending progress cards simultaneously → no UI jank

### 2.2 Agent Handoff Cards
**What:** Visual card showing a task being passed between agents.
**How:**
- Backend: Detect `@agent` in another agent's message → create `handoff` message type
- Metadata: `{ from: "claude", to: "codex", task: "implement auth module", status: "pending" }`
- Frontend: `HandoffCard.tsx` — shows sender avatar → arrow → receiver avatar, task description, status badge
- Status updates: pending → accepted → in_progress → complete
**Test:** Claude says "@codex implement this" → handoff card appears → Codex picks it up → status updates

### 2.3 Context Inheritance
**What:** When you @mention an agent replying to another's message, they get full context.
**How:**
- Backend: When routing an @mention, include the full thread of messages the mention was replying to
- MCP bridge: `chat_read` returns `reply_context` field with parent messages when reading a reply
- Frontend: Reply indicator on messages shows what they're replying to
**Test:** Claude posts analysis → you reply "@codex implement what Claude said" → Codex gets Claude's full message as context

### 2.4 Consensus Mode
**What:** Ask all agents, they answer independently, then a summary shows ranked results.
**How:**
- Backend: `/consensus` command → sends question to all agents with instruction "answer independently, don't read other agents' responses"
- Backend: After all agents respond (timeout 60s), generate a summary card ranking answers
- Frontend: `ConsensusCard.tsx` — shows each agent's answer side by side with a synthesis
**Test:** `/consensus Should we use Redis or Memcached for caching?` → all agents respond → summary card appears

### 2.5 Agent Debates
**What:** Two agents argue opposing sides, you judge.
**How:**
- Backend: `/debate [agent1] [agent2] [topic]` command
- Creates a structured session: agent1 argues FOR, agent2 argues AGAINST, 3 rounds each
- Frontend: `DebateCard.tsx` — split view showing both sides, round indicators, judge button
**Test:** `/debate claude codex "monorepo vs polyrepo"` → structured back-and-forth → you pick a winner

### 2.6 Smart Auto-Route
**What:** Describe task without @mentioning → AI Chattr picks the best agent.
**How:**
- Backend: If no @mention detected, run a lightweight classifier on the message text
- Classifier: keyword matching first (code→codex, design→claude, research→gemini), LLM fallback for ambiguous
- Show "Routing to [agent]..." indicator before triggering
- Store agent skill profiles in config.toml
**Test:** "Write unit tests for the auth module" → auto-routes to Codex

---

## PHASE 3: Observability & Control (See everything, control everything)

### 3.1 Activity Timeline
**What:** Sidebar feed of all agent actions.
**How:**
- Backend: New `activity_log` table — `(id, timestamp, agent, action_type, description, metadata)`
- Log: message sends, file changes, tool calls, job status changes, agent connect/disconnect
- Backend: `GET /api/activity?limit=50&agent=claude` endpoint
- Frontend: `ActivityTimeline.tsx` component in sidebar — scrollable feed with icons per action type
- WebSocket: `activity` event for real-time updates
**Test:** Agent sends message → activity log shows "claude sent message in #general"

### 3.2 Agent Cost Tracker
**What:** Token usage per agent per session.
**How:**
- Backend: `token_usage` table — `(agent, session_id, input_tokens, output_tokens, cost_usd, timestamp)`
- MCP bridge: Agents report usage via `chat_report_usage(sender, input_tokens, output_tokens)` tool
- Backend: `GET /api/usage?agent=claude&period=today` endpoint
- Frontend: Cost badge on each agent pill (e.g. "$0.42")
- Frontend: `/cost` command shows breakdown table
- Estimate costs using known model pricing
**Test:** Agent sends messages → cost counter increments → `/cost` shows breakdown

### 3.3 Live Terminal Peek
**What:** See what each agent's terminal is doing without tmux attach.
**How:**
- Backend: `wrapper.py` captures tmux pane content every 2s via `tmux capture-pane -t session -p`
- Backend: `GET /api/terminal/{agent}` returns latest pane content (text)
- Backend: WebSocket `terminal_update` event with truncated output (last 20 lines)
- Frontend: `TerminalPeek.tsx` — monospace mini-terminal view, click to expand full-screen
- Use green-on-black or the Stitch theme colors for terminal styling
**Test:** Agent is running → click peek → see live terminal output scrolling

### 3.4 File Change Feed
**What:** Real-time list of files agents are modifying.
**How:**
- Backend: `wrapper.py` runs `inotifywait` or `watchfiles` on the project directory
- Backend: `file_change` WebSocket event: `{agent, action: "modified"|"created"|"deleted", path, timestamp}`
- Frontend: `FileChangeFeed.tsx` — compact list with icons (📝 modified, ✨ created, 🗑️ deleted)
- Click a file → show diff (if git tracked)
**Test:** Agent modifies a file → change appears in feed within 2s

### 3.5 Approval Gates
**What:** Agents propose code changes, you approve before they're applied.
**How:**
- MCP bridge: `chat_propose_change(sender, file_path, diff, description)` tool
- Backend: Store proposed changes in `proposals` table
- Frontend: `ApprovalCard.tsx` — shows file path, diff view (red/green), Approve/Reject buttons
- On approve: Apply the change (write file)
- On reject: Notify agent with reason
**Test:** Agent proposes a file change → diff card shows → approve → file is written

### 3.6 Pause/Resume Agents
**What:** One-click to pause agent without killing it.
**How:**
- Backend: `POST /api/agents/{name}/pause` — sets agent state to "paused", stops routing @mentions to it
- Backend: `POST /api/agents/{name}/resume` — sets back to "active"
- Frontend: Pause/Resume button on agent status pill and in agent spotlight view
- Visual: Paused agents show ⏸️ icon and dimmed pill
**Test:** Pause Claude → send @claude → no trigger → resume → next @claude triggers

### 3.7 Scheduled Tasks
**What:** Cron-style recurring agent tasks.
**How:**
- Backend: `schedules` table — `(id, cron_expr, agent, command, channel, enabled, last_run)`
- Backend: Background thread checks schedules every minute, triggers matching agents
- Backend: `POST /api/schedules` CRUD endpoints
- Frontend: Schedule manager in Settings panel — add/edit/delete schedules with cron builder
- Examples: "0 9 * * *" → "Every day at 9am, @claude review overnight PRs"
**Test:** Create schedule for every minute → agent gets triggered → disable → stops

---

## PHASE 4: Power User Features (Pro mode)

### 4.1 Command Palette (Cmd+K)
**What:** Quick access to everything via fuzzy search.
**How:**
- Frontend: `CommandPalette.tsx` — modal overlay, text input with fuzzy matching
- Index: channels, agents, recent messages, commands, jobs, settings
- Keyboard: `Ctrl+K` or `Cmd+K` opens, `Esc` closes, arrow keys navigate, Enter selects
- Use a simple fuzzy match library (fuse.js or custom)
**Test:** Cmd+K → type "gen" → shows #general channel → Enter → switches to it

### 4.2 Split View
**What:** Two channels side by side.
**How:**
- Frontend: `SplitView.tsx` — flex container with two chat feeds, draggable divider
- State: `splitChannel` in store — when set, main area shows two columns
- Toggle: Right-click channel tab → "Open in split view"
**Test:** Open split → left shows #general, right shows #debug → messages stream independently

### 4.3 Agent Spotlight
**What:** Click agent pill → see everything about them.
**How:**
- Frontend: `AgentSpotlight.tsx` — full-page overlay showing:
  - Recent messages (last 20)
  - Files changed (from file change feed)
  - Active jobs
  - Token usage (from cost tracker)
  - Terminal peek (embedded)
  - Role and skills
  - Uptime
**Test:** Click Claude's pill → see full agent dashboard

### 4.4 Message Threads
**What:** Replies collapse into expandable threads.
**How:**
- Backend: Messages already have `reply_to` field — group by parent
- Frontend: When a message has replies, show "3 replies" link → click to expand inline thread
- Frontend: Thread view shows parent + all replies in a bordered container
- Thread notifications: Badge on parent message when new reply arrives
**Test:** Reply to a message → reply appears under parent → collapse/expand works

### 4.5 Message Search
**What:** Full-text search across all channels.
**How:**
- Backend: `GET /api/search?q=auth&channel=general&agent=claude&from=2026-03-01&to=2026-03-20`
- Backend: SQLite FTS5 extension for full-text indexing
- Frontend: Search bar in header → results panel with highlighted matches and context
- Filter chips: by agent, channel, date range, message type
**Test:** Search "auth" → shows all messages mentioning auth → click result → jumps to message

### 4.6 Chat Themes
**What:** Customizable visual themes.
**How:**
- Frontend: Theme system using CSS custom properties (already using Tailwind @theme)
- Built-in themes: Cyberpunk (current), Minimal Light, Retro Terminal, Ocean Dark
- Each theme = a set of CSS variable overrides
- Settings: Theme picker with live preview
- Custom CSS textarea for power users
**Test:** Switch to "Retro Terminal" → green-on-black, monospace everything → switch back

### 4.7 Session Replay
**What:** Record and replay agent conversations.
**How:**
- Backend: Already stores all messages in SQLite — just need a replay viewer
- Backend: `GET /api/replay?channel=general&from=<ts>&to=<ts>` — returns messages in order
- Frontend: `ReplayViewer.tsx` — playback controls (play/pause/speed), messages appear sequentially with original timing
- Use case: Review overnight agent work, demo to team
**Test:** Record a 10-message conversation → replay at 2x → messages appear with proper timing

### 4.8 Webhook Integration
**What:** External events trigger agents.
**How:**
- Backend: `POST /api/webhooks` CRUD — create webhook endpoints with filters
- Backend: `POST /api/webhook/{id}` — receives external payload, creates system message, triggers configured agent
- Use cases:
  - GitHub push → "@claude review these changes"
  - CI failure → "@codex debug this test failure"
  - Monitoring alert → "@all incident: API latency spike"
**Test:** Create webhook → POST to it with curl → agent gets triggered with payload context

### 4.9 Export System
**What:** Export conversations in multiple formats.
**How:**
- Backend: `GET /api/export?channel=general&format=markdown|json|html`
- Markdown: Clean conversation format with headers, code blocks preserved
- JSON: Raw message data for programmatic use
- HTML: Styled standalone page matching the chat UI
- Frontend: Export button in channel header, format picker dialog
**Test:** Export #general as markdown → open file → clean formatted conversation

### 4.10 Plugin System
**What:** Drop-in capability extensions for agents.
**How:**
- Backend: `plugins/` directory — each plugin is a Python module with `register(app, bridge)` function
- Plugin interface: Add MCP tools, add API endpoints, add WebSocket events
- Built-in plugins:
  - `plugins/github.py` — PR status, issue tracking, commit log
  - `plugins/docker.py` — container status, logs, restart
  - `plugins/testing.py` — run test suites, coverage reports
- Config: `[plugins]` section in config.toml to enable/disable
**Test:** Enable github plugin → agents get `github_pr_list`, `github_create_issue` tools

---

## Testing Strategy (For ALL phases)

### Per-Feature Test Protocol
1. **Fail test** — Verify the feature handles errors gracefully (bad input, network failure, missing data)
2. **Fix test** — Verify the feature works correctly with valid input
3. **Smoke test** — End-to-end: start server → open browser → use feature → verify result
4. **Stress test** — High load: 100 messages/min, 5 agents simultaneous, rapid channel switching

### Sandbox Testing
- All new features built and tested in a sandbox first (port 8400)
- Frontend dev server (port 5173) for hot-reload development
- Only deployed to production (port 8300) after full test pass

### Integration Tests
- WebSocket: connect → send → receive → disconnect → reconnect
- MCP: register → send via MCP → read via MCP → verify in chat
- Wrapper: start agent → @mention → verify prompt injection → verify response

---

## Architecture Notes

### Token Usage Tracking
- Claude Opus 4: ~$15/MTok input, ~$75/MTok output
- Claude Sonnet 4: ~$3/MTok input, ~$15/MTok output
- GPT-5.4: varies by plan
- Codex: varies by plan
- Track per-agent, per-session, per-channel, per-day
- Show running total in sidebar, detailed breakdown in /cost

### Rate Limits
- WebSocket: max 100 messages/minute per client
- API: max 60 requests/minute per IP
- MCP: max 30 tool calls/minute per agent
- File uploads: max 10MB per file, max 100MB total storage
- Channels: max 20 channels
- Agents: max 10 simultaneous

### Performance Targets
- First Contentful Paint: < 1.5s
- WebSocket latency: < 50ms local, < 200ms via tunnel
- Message render: < 16ms (60fps)
- Search results: < 500ms
- Channel switch: < 100ms
- Memory: < 200MB with 1000 messages loaded

---

## Build Order

| # | Feature | Phase | Depends On | Est. Complexity |
|---|---------|-------|------------|-----------------|
| 1 | Mobile Fix | 1 | — | Low |
| 2 | Relative Timestamps | 1 | — | Low |
| 3 | Message Animations | 1 | — | Low |
| 4 | Notification Sounds | 1 | — | Medium |
| 5 | Emoji Reactions | 1 | — | Medium |
| 6 | @all Agents | 1 | — | Low |
| 7 | Slash Commands | 1 | — | Medium |
| 8 | Progress Cards | 2 | — | Medium |
| 9 | Handoff Cards | 2 | — | Medium |
| 10 | Context Inheritance | 2 | — | Medium |
| 11 | Consensus Mode | 2 | @all | High |
| 12 | Agent Debates | 2 | Sessions | High |
| 13 | Smart Auto-Route | 2 | Agent Skills | High |
| 14 | Activity Timeline | 3 | — | Medium |
| 15 | Cost Tracker | 3 | — | Medium |
| 16 | Terminal Peek | 3 | Wrapper | Medium |
| 17 | File Change Feed | 3 | Wrapper | Medium |
| 18 | Approval Gates | 3 | — | High |
| 19 | Pause/Resume | 3 | — | Low |
| 20 | Scheduled Tasks | 3 | — | High |
| 21 | Command Palette | 4 | — | Medium |
| 22 | Split View | 4 | — | Medium |
| 23 | Agent Spotlight | 4 | Timeline, Cost | Medium |
| 24 | Message Threads | 4 | — | Medium |
| 25 | Message Search | 4 | FTS5 | Medium |
| 26 | Chat Themes | 4 | — | Low |
| 27 | Session Replay | 4 | — | Medium |
| 28 | Webhooks | 4 | — | Medium |
| 29 | Export | 4 | — | Low |
| 30 | Plugin System | 4 | — | High |

---

## PHASE 5: Desktop App (.exe Launcher)
*Goal: Standalone Windows app with launcher, auth, and server management.*

### 5.1 Electron Desktop App
**What:** Single .exe that opens a launcher screen before the chat.
**Launcher Screen:**
- Start Server button → starts backend, opens chat UI
- Clear Server Cache → removes stale sessions, unused data (NOT chat history)
- Server status indicator (running/stopped/port)
- Version info

### 5.2 OAuth Login
**What:** Login with subscriptions instead of API keys.
**Providers:**
- Login with Google (Gemini) — OAuth2 flow
- Login with OpenAI (ChatGPT Plus/Pro) — OAuth2 flow
- Login with Anthropic (Claude Max) — OAuth2 flow
- API Key entry fallback for each provider
- Shows green checkmark when already authenticated
- Opens browser for OAuth, catches callback on localhost

### 5.3 Packaging
**What:** Build as installable Windows .exe.
- electron-builder for Windows packaging
- NSIS installer with desktop shortcut
- Auto-update support
- Bundles Python backend + Node frontend

---

## PHASE 6: Cross-Platform Support & First-Run Experience
*Goal: Run anywhere — Windows, Mac, Linux. Auto-detect and configure.*

### 6.1 Platform Detection & First-Run Wizard
**What:** On first launch, detect the OS/shell and guide setup.
**First-run screen:**
- Auto-detect: Windows (PowerShell/CMD), WSL, macOS, Linux
- Show detected platform with confirmation
- If WSL detected: explain path translation (C:\ → /mnt/c/)
- If macOS: use native folder picker (osascript)
- If Linux: use zenity/kdialog folder picker
- Store platform preference in settings.json

### 6.2 Shell-Aware Agent Launching
**What:** Launch agents correctly per platform.
**How:**
- Windows native: Use `cmd /c` or PowerShell to spawn agents
- WSL: Use tmux (current approach)
- macOS: Use tmux or screen
- Linux: Use tmux or screen
- Auto-install tmux if missing (prompt user)
- Platform-specific wrapper_win.py, wrapper_mac.py alongside wrapper_unix.py

### 6.3 OAuth Integration (Per Platform)
**What:** Connect agent subscriptions instead of API keys.
**Providers:**
- Anthropic (Claude Max/Pro) — `claude auth login`
- OpenAI (ChatGPT Plus/Pro) — `codex auth login` or API key
- Google (Gemini) — `gemini auth login` or Google OAuth
- xAI (Grok) — API key
- GitHub (Copilot) — `gh auth login`
**Per-platform considerations:**
- Browser-based OAuth: detect default browser per OS
- WSL: use `wslview` or `powershell.exe Start-Process` to open URLs
- Headless/SSH: show URL + code for manual auth
- Store auth status in settings, show green checkmarks

### 6.4 Package Managers & Install Scripts
**What:** One-command install per platform.
**Targets:**
- `pip install aichttr` (PyPI)
- `npm install -g aichttr` (npm)
- `brew install aichttr` (Homebrew for macOS)
- `winget install aichttr` (Windows)
- Docker image: `docker run -p 8300:8300 aichttr`
- One-liner: `curl -fsSL https://aichttr.dev/install.sh | sh`

### 6.5 Desktop App Installers
**What:** Native installers per platform.
- Windows: .exe installer (Electron + electron-builder NSIS)
- macOS: .dmg (Electron + electron-builder)
- Linux: .AppImage + .deb (Electron + electron-builder)
- Auto-update via electron-updater
- System tray icon with quick actions

---

## QUALITY STANDARDS (ALL PHASES)

### Testing Protocol (Mandatory before any feature ships)
1. **Fail Test** — Deliberately trigger edge cases and errors. Verify graceful handling.
2. **Fix Test** — Apply the fix. Verify the specific bug is resolved.
3. **Smoke Test** — Quick pass through all related features. Nothing else broke.
4. **Stress Test** — High volume: 100+ messages, 5+ agents, rapid @mentions, concurrent users.

### Performance Targets
- Page load: < 2 seconds
- Message send-to-display: < 200ms
- Agent spawn: < 5 seconds
- WebSocket reconnect: < 3 seconds
- Memory usage: < 200MB for server + 3 agents

### Accessibility
- Keyboard navigation for all actions
- Screen reader support (ARIA labels)
- High contrast mode
- Reduced motion option

### Security
- No personal data in distributed code (verified via grep scan)
- Settings stored locally only
- No telemetry or tracking
- API keys never logged or transmitted
- OAuth tokens stored securely per OS keychain

---

## PHASE 7: Agent Skills System
*Goal: Install, manage, and configure skills per agent — like plugins for AI.*

### 7.1 Skills Registry & Discovery
**What:** Browse, search, and install skills from a catalog.
**Built-in universal skills (ship with app):**
- **Web Search** — Search the web via Brave/DuckDuckGo API
- **Web Fetch** — Fetch and extract content from URLs
- **File Browser** — Navigate and read project files
- **Git Operations** — git status, diff, commit, branch, PR via `gh`
- **Shell Execute** — Run shell commands (with approval gates)
- **Code Analysis** — AST parsing, dependency scanning, lint
- **Screenshot** — Capture screenshots of URLs or localhost
- **Image Analysis** — Analyze images with vision models
- **PDF Reader** — Extract text/data from PDFs
- **Weather** — Current weather and forecasts
- **Calculator** — Math expressions and unit conversions
- **Timer/Reminder** — Set timers and reminders
- **Note Taking** — Create and manage persistent notes
- **Clipboard** — Read/write system clipboard

**Bridged from OpenClaw (adapted for standalone):**
- **GitHub Issues** — Fetch issues, create PRs, review code
- **Healthcheck** — System security audit and hardening
- **Session Logs** — Search and analyze conversation history
- **Stitch Design** — Generate UI designs via Stitch MCP
- **Figma** — Analyze Figma designs and export assets
- **Web Perf** — Lighthouse audits and Core Web Vitals
- **Accessibility Auditor** — WCAG 2.1 compliance checking
- **Crypto Trading** — Portfolio and trade management (if configured)

**How skills work:**
- Each skill = a folder with `skill.json` (metadata) + implementation files
- Skills are MCP tools that get injected into the agent's MCP config
- Skills can be Python scripts, Node scripts, or MCP server endpoints
- Skills directory: `~/.aichttr/skills/` (global) + `./skills/` (per-project)

### 7.2 Per-Agent Skill Configuration
**What:** Each agent has its own set of enabled/disabled skills.
**How:**
- Settings stored in `settings.json` under `agentSkills: { "claude": ["web-search", "git-ops"], "codex": ["shell-exec", "file-browser"] }`
- Agent Info Panel → Skills tab → toggle list
- When spawning agent, inject enabled skills into MCP config
- Skills can have per-agent configuration (e.g., API keys, default paths)

### 7.3 Skills Management UI
**What:** Full skills browser in the app.
**UI Components:**
- **Skills Panel** (sidebar) — categorized list of all available skills
- **Categories:** Development, Research, Communication, System, Creative, Data
- **Search bar** with fuzzy matching
- **Filter chips:** Installed / Available / Enabled / Category
- **Sort:** Name / Category / Recently Used / Most Popular
- **Skill Card:** icon, name, description, category, install/enable toggle
- **Skill Detail Modal:** full description, configuration options, per-agent toggles, usage stats

### 7.4 Skill Installation & Updates
**What:** Install new skills from the community or create custom ones.
**Sources:**
- Built-in skills (bundled with app)
- ClawHub marketplace (if available): `aichttr skill install web-search`
- Git repos: `aichttr skill install https://github.com/user/skill-name`
- Local folders: `aichttr skill install ./my-custom-skill`
**Updates:**
- `aichttr skill update` — update all installed skills
- Auto-check for updates on app start (optional)
- Version pinning support

### 7.5 Custom Skill Creator
**What:** Create your own skills from the UI.
**Wizard:**
1. Name, description, category, icon
2. Choose implementation type: Python / Node / Shell / MCP endpoint
3. Define inputs (parameters) and outputs
4. Write/paste the implementation code
5. Test in sandbox before enabling
6. Save to `~/.aichttr/skills/my-skill/`

### 7.6 Skill Marketplace (Future)
**What:** Community-driven skill sharing.
- Browse community skills with ratings and reviews
- One-click install
- Verified/trusted publisher badges
- Dependency resolution
