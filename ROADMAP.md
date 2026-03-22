# GhostLink — Complete Development Roadmap

> Every bug, fix, feature, and upgrade needed — phased, prioritized, with test plans.
> For any AI picking this up: follow the phases IN ORDER. Each phase has verification steps. Do NOT skip ahead.

**Last updated:** 2026-03-22
**Source:** Full codebase audit (identity isolation + bug sweep + feature gap analysis)

---

## HOW TO USE THIS ROADMAP

1. Read the phase description
2. For each item: read the problem, the fix, AND the test plan
3. Implement the fix
4. Run the FAIL TEST first (verify the bug exists)
5. Apply the fix
6. Run the FIX TEST (verify the fix works)
7. Run the SMOKE TEST (verify nothing else broke)
8. Run the STRESS TEST where applicable
9. Only move to the next item after all tests pass
10. At the end of each phase: full build + visual check + push to git

---

## PHASE 0: CRITICAL SECURITY & STABILITY (Do First — Nothing Else Until These Pass)

> These bugs can cause crashes, data corruption, or identity spoofing. Ship-blocking.

### 0.1 Fix MCP Identity Spoofing
**Bug:** MCP bridge falls back to accepting raw `sender` parameter when no auth token is present. Any HTTP request can impersonate any agent.
**File:** `backend/mcp_bridge.py` lines 166-173 (`_resolve_identity`)
**Fix:** Remove the fallback. If no valid token, return an error. Never accept unverified sender names.
**Fail test:** `curl -X POST http://127.0.0.1:8200/mcp` with `sender="claude"` but no Bearer token → currently succeeds (BUG)
**Fix test:** Same curl → returns error "sender requires bearer token authentication"
**Smoke test:** Start real agents, verify they still communicate normally via MCP proxy with valid tokens

### 0.2 Fix WebSocket Race Condition
**Bug:** `_ws_clients` set is modified during iteration in `broadcast()`. Concurrent connect/disconnect causes `RuntimeError: Set changed size during iteration`.
**File:** `backend/app.py` lines 192-201
**Fix:** Copy the set before iterating: `for ws in list(_ws_clients):` or add an asyncio.Lock
**Fail test:** Rapidly connect/disconnect 10 WebSocket clients while broadcasting → crashes intermittently
**Fix test:** Same stress test → no crashes, all messages delivered
**Smoke test:** Normal chat works, agents connect/disconnect cleanly

### 0.3 Fix Store Assertion Failures
**Bug:** `assert self._db is not None` crashes with cryptic `AttributeError` if Python runs with `-O` flag.
**File:** `backend/store.py` lines 78, 106, 115, 124, 135, 147
**Fix:** Replace every `assert self._db is not None` with `if self._db is None: raise RuntimeError("Database not initialized. Call init() first.")`
**Fail test:** Run `python -O app.py` → store methods crash with AttributeError
**Fix test:** Run `python -O app.py` → store methods raise RuntimeError with clear message
**Smoke test:** Normal operation unaffected

### 0.4 Fix Memory Leak — Unbounded Dictionaries
**Bug:** `_empty_read_count`, `_cursors`, `_activity_ts`, `_presence` dictionaries grow forever. Each disconnected agent leaves orphaned entries.
**File:** `backend/mcp_bridge.py` lines 34, 40-44
**Fix:** Clean up entries when agent deregisters. Add `_cleanup_agent(name)` called from deregister flow. Also add periodic cleanup (every 5 min) for entries older than 1 hour.
**Fail test:** Register/deregister 100 agents → dict sizes grow to 100 (no cleanup)
**Fix test:** Register/deregister 100 agents → dict sizes stay near 0 after deregister
**Stress test:** Run for 24 hours with agents cycling → memory usage stays flat

### 0.5 Fix Queue File Race Condition
**Bug:** Two agents writing to the same queue file simultaneously can corrupt JSONL lines or lose triggers.
**File:** `backend/mcp_bridge.py` lines 230-236 (`_trigger_mentions`)
**Fix:** Add per-file threading.Lock. Lock before write, unlock after.
**Fail test:** 2 threads rapidly writing `@claude` triggers → some lines corrupted in `claude_queue.jsonl`
**Fix test:** Same stress → all lines valid JSON, one per line
**Smoke test:** Normal @mention routing works

### 0.6 Fix Agent Process Dictionary Race
**Bug:** `_agent_processes` dict accessed without lock from concurrent spawn/kill endpoints.
**File:** `backend/app.py` lines 27, 683, 723
**Fix:** Add `_process_lock = threading.Lock()` and wrap all reads/writes.
**Fail test:** Rapidly spawn and kill agents simultaneously → dict corruption or KeyError
**Fix test:** Same stress → clean operation, no errors

---

## PHASE 1: AGENT IDENTITY ISOLATION (Agents Must Never Confuse Each Other)

> Multiple agents (claude, claude-1, bob, codex) sharing a workspace MUST have perfect isolation.

### 1.1 Validate Agent Name on All Endpoints
**Bug:** `/api/agents/{name}/soul`, `/notes`, `/memories` accept any name — even unregistered agents or path traversal.
**File:** `backend/app.py` lines 1070-1153
**Fix:** Add registry validation at the top of every agent-scoped endpoint: `if not registry.get(name): return 404`
**Fail test:** `GET /api/agents/../../etc/passwd/soul` → returns data or 500
**Fix test:** Same request → returns 404 "agent not found"
**Also test:** `GET /api/agents/offline-agent/memories` when agent is not registered → 404

### 1.2 Make MCP Proxy Sender Injection Mandatory
**Bug:** Proxy only overwrites sender if it differs from proxy's name. Should ALWAYS inject.
**File:** `backend/mcp_proxy.py` lines 196-225
**Fix:** Remove the conditional. Always set `args[sender_key] = proxy.agent_name`.
**Fail test:** Agent sends request with sender="other-agent" → proxy passes it through unchanged
**Fix test:** Same request → proxy replaces sender with its own identity
**Smoke test:** Normal agent communication unaffected

### 1.3 Add Memory File Locking
**Bug:** Concurrent memory_save from two agents writing to the same agent's memory can corrupt JSON files.
**File:** `backend/agent_memory.py` lines 111-119
**Fix:** Add `threading.RLock` per agent. Lock around all file read/write operations in `save()`, `load()`, `delete()`.
**Fail test:** 2 threads call `memory_save(key="x")` simultaneously → file corruption
**Fix test:** Same test → both writes succeed, file is valid JSON
**Smoke test:** Agent memory operations work normally

### 1.4 Implement Token Expiration
**Bug:** Agent tokens never expire. Leaked/stale tokens valid forever.
**File:** `backend/registry.py` lines 10-29
**Fix:** Add `token_issued_at` and `token_ttl` (default 1 hour). Check expiration in `resolve_token()`. Rotate token on each heartbeat.
**Fail test:** Use a token from a previous session → still works (BUG)
**Fix test:** Use expired token → rejected with "token expired"
**Smoke test:** Active agents auto-rotate tokens via heartbeat, no disruption

### 1.5 Fix Queue TOCTOU Race in Wrapper
**Bug:** Queue file can be written to between read and clear, losing triggers.
**File:** `backend/wrapper.py` lines 239-243
**Fix:** Atomic read-and-clear: rename file to `.processing`, read it, delete it. New writes go to the original filename.
**Fail test:** Rapidly write triggers while watcher is reading → some triggers lost
**Fix test:** Same stress → all triggers processed, none lost

### 1.6 Enhance System Prompt Identity
**Action:** Ensure every agent's system prompt includes:
- "You are {name} (instance of {base}). Your unique agent ID is {name}."
- "Your files are at: data/{name}/ — ONLY access YOUR files, never another agent's."
- "Other agents in this workspace: {list with names}. Do NOT access their memory/notes/soul."
- "When you call memory_save/load, the system automatically scopes to YOUR storage. You cannot access other agents' memories."
**File:** `backend/wrapper.py` (`_build_system_prompt`) and `backend/mcp_bridge.py` (`_INSTRUCTIONS`)
**Test:** Start claude and claude-1, ask each "what is your name?" → each correctly identifies itself
**Test:** Ask claude to "read claude-1's memories" → should refuse or get empty result (not claude-1's actual data)

---

## PHASE 2: CODE QUALITY & RELIABILITY

> Fix silent failures, add logging, make errors visible.

### 2.1 Replace Bare Except Clauses with Logging
**Bug:** 20+ locations silently swallow exceptions. Impossible to debug production issues.
**Files:** `mcp_bridge.py` (6 locations), `store.py` (2), `app.py` (10+), `wrapper.py` (5+)
**Fix:** Replace every `except Exception: pass` with `except Exception as e: log.warning(f"...: {e}")`. Keep the graceful behavior but ADD logging.
**Test:** Trigger known error conditions → verify log messages appear

### 2.2 Add Database Indexes
**Bug:** No index on `sender` or `reply_to` columns. Slow queries on large datasets.
**File:** `backend/store.py` DB_SCHEMA
**Fix:** Add: `CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);` and `CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to);`
**Test:** Insert 10,000 messages, query by sender → response time <100ms

### 2.3 Make Ports Configurable
**Bug:** MCP ports 8200/8201 hardcoded. Can't run multiple GhostLink instances.
**File:** `backend/mcp_bridge.py` lines 685-686
**Fix:** Read from config.toml `[mcp] http_port` and `sse_port`. Fall back to 8200/8201 if not set.
**Test:** Set `http_port = 9200` in config.toml → MCP starts on 9200

### 2.4 Add Input Validation
**Bug:** No length/character validation on sender names, channel names, message text.
**File:** `backend/app.py` send_message endpoint
**Fix:** Validate: sender max 100 chars alphanumeric, text max 100KB, channel max 30 chars lowercase.
**Test:** Send message with 1MB text → returns 400 "message too long"

### 2.5 Add Config Schema Validation
**Bug:** Missing/malformed config.toml causes cryptic crashes.
**File:** `backend/app.py` lines 40-48
**Fix:** Validate required keys exist on load. Print helpful error if missing.
**Test:** Remove `[server]` section from config.toml → clear error message, not crash

---

## PHASE 3: DESKTOP APP FIXES

> Make the Electron app reliable on all Windows setups.

### 3.1 Async All IPC Handlers
**Bug:** `execSync` calls block Electron main thread for 5-60 seconds, freezing UI.
**Files:** `desktop/main/index.ts`, `desktop/main/auth/index.ts`
**Fix:** Replace ALL remaining `execSync` with `util.promisify(exec)` or `child_process.spawn`. Every IPC handler must be async.
**Test:** Launch app → window appears in <2 seconds, never shows "Not Responding"

### 3.2 Fix Wizard First-Run Detection
**Bug:** `~/.ghostlink/settings.json` persists across uninstall. Wizard skipped on reinstall.
**File:** `desktop/main/index.ts` (app ready handler)
**Fix:** Check settings version. If version < current app version, show wizard anyway. Also add cleanup to NSIS uninstaller.
**Test:** Uninstall → reinstall → wizard shows

### 3.3 Fix Menu Bar on Chat Window
**Bug:** File/Edit/View menu shows on framed chat window.
**File:** `desktop/main/index.ts` (chat window creation)
**Fix:** Set `autoHideMenuBar: true` on BrowserWindow options.
**Test:** Chat window opens → no menu bar visible

### 3.4 Fix Launcher Staying Open
**Bug:** Launcher doesn't always hide when chat window opens.
**File:** `desktop/main/index.ts` (createChatWindow)
**Fix:** Explicitly call `launcher.hide()` after chat window `ready-to-show` in ALL code paths.
**Test:** Start server → chat opens → launcher is hidden

### 3.5 Handle Non-OneDrive Installs
**Bug:** Server.ts OneDrive detection is path-string-based. May false-positive or false-negative.
**File:** `desktop/main/server.ts` line 168
**Fix:** Actually test WSL path accessibility (`wsl test -r /path/to/app.py`) instead of checking for "OneDrive" in string.
**Test:** Install to `C:\GhostLink` → server starts directly, no /tmp copy needed

### 3.6 Add Temp File Cleanup
**Bug:** `/tmp/ghostlink-backend/` never cleaned up. Stale files from previous runs.
**File:** `desktop/main/server.ts`
**Fix:** Clean up on app quit. Also clean up before copying on start.
**Test:** Start → stop → start → no stale file conflicts

---

## PHASE 4: NEW FEATURES — AGENT INTELLIGENCE

> Make agents smarter, more capable, more autonomous.

### 4.1 Auto-Route Toggle
**What:** Settings toggle: agents receive ALL messages vs only @mentioned.
**Effort:** Tiny
**How:** Add toggle in SettingsPanel → syncs to `router.default_routing` ("all" vs "none")
**Test:** Toggle ON → send message without @mention → agent responds

### 4.2 Agent Response Modes
**What:** Per-agent setting: "Always respond", "Only when mentioned", "Listen & decide", "Silent observer"
**Effort:** Small
**How:** Store per-agent in settings, pass to router filtering

### 4.3 Smart Context Compression
**What:** Compress old messages into summaries for token efficiency.
**Effort:** Medium
**How:** Every 50 messages, summarize. Replace old context with summary in MCP reads.
**Test:** 500 messages in channel → agent reads compressed context (<2000 tokens) not full history

### 4.4 Agent Presets
**What:** One-click agent configurations: "Code Reviewer", "PM", "DevOps", "Creative Writer"
**Effort:** Medium
**How:** Preset library with SOUL template + skill set + model. Apply with one click.

### 4.5 Conversation Starters
**What:** Empty channel shows suggested prompts: "Ask Claude to review your code", "Brainstorm with @all"
**Effort:** Small
**How:** Clickable suggestion chips in empty channel state

---

## PHASE 5: NEW FEATURES — SKILLS & TOOLS

> Give agents real capabilities. Each skill = new MCP tool.

### 5.1 Firecrawl Web Scraping
**What:** Agents crawl websites, extract content as markdown.
**Install:** `npx -y firecrawl-mcp`
**Tools:** `firecrawl_scrape(url)`, `firecrawl_crawl(url)`, `firecrawl_search(query)`
**Test:** Agent scrapes a URL → gets clean markdown content

### 5.2 Browser Use CLI
**What:** Agents control a browser — click, type, screenshot, navigate.
**Install:** `pip install browser-use`
**Tools:** `browser_open(url)`, `browser_click(selector)`, `browser_type(text)`, `browser_screenshot()`
**Test:** Agent fills out a form on a website autonomously

### 5.3 GitHub MCP Server
**What:** Full GitHub API — PRs, issues, code search, actions.
**Install:** Official GitHub MCP server (22K stars)
**Tools:** `gh_create_pr()`, `gh_list_issues()`, `gh_review_pr()`, `gh_search_code()`
**Test:** Agent creates a GitHub issue via MCP tool

### 5.4 Apprise Notifications
**What:** Send alerts to 90+ channels — Slack, Discord, Telegram, Email.
**Install:** `pip install apprise`
**Tools:** `notify_send(message, channels)`
**Test:** Agent sends a Slack notification when a task completes

### 5.5 Knowledge Graph Memory
**What:** Agents build persistent knowledge graphs — entities, relationships, observations.
**Install:** Anthropic's official KG Memory MCP server
**Tools:** `kg_add_entity()`, `kg_add_relation()`, `kg_search()`
**Test:** Agent remembers "Project X uses React and depends on Service Y" across sessions

### 5.6 Database Access (PostgreSQL/Supabase)
**What:** Agents query and write to databases.
**Install:** DBHub universal MCP or Supabase MCP
**Tools:** `db_query(sql)`, `db_schema()`, `db_insert()`
**Test:** Agent queries a Postgres table and summarizes results

### 5.7 Docker Management
**What:** List, start, stop, inspect containers.
**Tools:** `docker_list()`, `docker_logs(container)`, `docker_exec(container, cmd)`
**Test:** Agent checks container status and restarts a crashed service

### 5.8 AI-Powered Search (Tavily)
**What:** Better than DuckDuckGo — AI-synthesized answers with citations.
**Install:** Tavily MCP server (free tier)
**Tools:** `ai_search(query)`
**Test:** Agent researches "best Python testing frameworks 2026" → synthesized answer

---

## PHASE 6: NEW FEATURES — UX & POLISH

> Make the app feel premium and delightful.

### 6.1 Generative UI Cards
**What:** Agents render interactive cards — charts, forms, tables, progress bars — not just text.
**Effort:** Medium
**How:** Agent sends structured metadata, frontend renders appropriate component dynamically.

### 6.2 Command History (Up Arrow)
**What:** Press Up in input to recall previous messages.
**Effort:** Tiny
**How:** Store last 100 messages in localStorage, Up/Down arrows to navigate.

### 6.3 Rich URL Previews
**What:** URLs auto-expand with title, description, image cards.
**Effort:** Medium
**How:** Backend fetches OpenGraph metadata, frontend renders preview card.

### 6.4 Drag & Drop Files
**What:** Drag files into chat to share with agents.
**Effort:** Small
**How:** Frontend drag handler → upload API → agent gets file path.

### 6.5 Onboarding Tour
**What:** Interactive guided tour for first-time users.
**Effort:** Medium
**How:** Shepherd.js or custom React tooltips highlighting key features.

### 6.6 Voice Chat
**What:** Push-to-talk voice input, TTS output.
**Effort:** Medium
**How:** Web Speech API for STT, browser TTS or ElevenLabs for output.

### 6.7 Multi-Project Support
**What:** Switch between project workspaces without restart.
**Effort:** Medium
**How:** Project selector in sidebar, workspace switching in settings.

### 6.8 Session Snapshots
**What:** Save/restore entire session state as JSON.
**Effort:** Small
**How:** Export/import agents, channels, settings, messages.

---

## PHASE 7: GROWTH & DISTRIBUTION

> Make people want to share and use GhostLink.

### 7.1 Share Conversations
**What:** Generate shareable link to a conversation.
**How:** Export as styled HTML page. Optional: host on ghostlink.dev.

### 7.2 Agent Personalities Library
**What:** Fun personality presets — "Pirate Claude", "Shakespearean Codex".
**How:** SOUL template marketplace. Community-contributed.

### 7.3 IDE Extensions
**What:** VSCode/Cursor/JetBrains panels that connect to GhostLink.
**How:** Extension with WebSocket connection to the same server.

### 7.4 GhostLink Cloud (SaaS)
**What:** Hosted version — sign up, connect API keys, go.
**How:** Docker deployment, multi-tenant, Stripe billing.

### 7.5 Mobile App
**What:** iOS/Android for monitoring and quick commands.
**How:** React Native or PWA via Cloudflare tunnel.

### 7.6 Plugin Marketplace
**What:** Community-driven plugins. Browse, install, rate.
**How:** Plugin registry, npm-style package manager.

---

## PHASE CHECKLIST

After each phase, verify:
- [ ] `npx tsc -b --noEmit` — zero TypeScript errors
- [ ] `npx vite build` — successful frontend build
- [ ] `python -c "import app"` — backend imports clean
- [ ] No personal data in `ghostlink/` (grep for owner usernames, hardcoded paths)
- [ ] All tests pass (fail → fix → smoke → stress)
- [ ] Visual check: desktop + mobile + light mode
- [ ] Commit and push to GitHub

---

## TOTAL ISSUE COUNT

| Category | Count | Phase |
|----------|-------|-------|
| Critical security/stability bugs | 6 | Phase 0 |
| Agent identity isolation issues | 6 | Phase 1 |
| Code quality & reliability | 5 | Phase 2 |
| Desktop app fixes | 6 | Phase 3 |
| Agent intelligence features | 5 | Phase 4 |
| Skills & tools | 8 | Phase 5 |
| UX & polish features | 8 | Phase 6 |
| Growth & distribution | 6 | Phase 7 |
| **TOTAL** | **50** | |

---

## REFERENCES

- [Awesome MCP Servers](https://github.com/punkpeye/awesome-mcp-servers) — 5,000+ community MCP servers
- [Firecrawl](https://www.firecrawl.dev/) — Web scraping API for AI
- [Browser Use](https://browser-use.com/) — Browser automation for agents
- [GitHub MCP Server](https://github.com/github/github-mcp-server) — Official GitHub integration
- [Apprise](https://github.com/caronc/apprise) — 90+ notification channels
- [Langfuse](https://langfuse.com/) — Open source LLM analytics
- [Tavily](https://tavily.com/) — AI-powered search
- [Knowledge Graph Memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) — Anthropic's KG MCP
- [DBHub](https://github.com/bytebase/dbhub) — Universal database MCP
- [Agentic UX Patterns 2026](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/)
- [AI Observability 2026](https://www.braintrust.dev/articles/best-ai-observability-tools-2026)
