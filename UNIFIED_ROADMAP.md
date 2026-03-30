# GhostLink — Development Roadmap

> Single source of truth for all development. Supersedes GAB_ROADMAP, GAF_ROADMAP, V2.5_BUGFIX_ROADMAP, ROADMAP.md.
> **For any AI picking this up: follow the phases IN ORDER within each track. Each item has acceptance criteria, files to change, smoke tests, and fail tests.**

**Last updated:** 2026-03-30
**Current version:** v5.5.2
**Owner:** nahldi

---

## Completed Work (v1.0 → v3.9.7)

### Foundation (v1.0–v1.8)
Core chat, WebSocket, agent spawning, MCP bridge, desktop app, setup wizard, system tray, auto-updates, 13 agent CLIs, security hardening, approval interception, thinking streams, skills system, session templates, channel bridges.

### Platform (v2.0–v2.9)
Plugin system, Fernet encryption, 13 providers, model failover, Framer Motion animations, skeletons, toasts, usage tracking, WAL mode, agent identity injection, rate limiting, SSRF/XSS fixes, process tracking lock, settings lock, SIGKILL escalation, atomic approval writes.

### Architecture & Polish (v3.0–v3.3.2)
Route split (3400→612 line app.py), 13 route modules, micro-interactions, integration tests (56 total), StreamingText word reveal, ThinkingParticles, mobile sidebar gestures, dependency conflict fix, DB recovery, version sync, deque log rotation, memory cache TTL, save_settings deduplication, FTS fallback logging.

### UX & Agent Identity (v3.9.2–v3.9.4)
Thinking bubbles redesign (compact dots, no SVG clutter). Message shake/glitch fix (removed triple animation conflict: CSS + Framer Motion + component motion.div). Agent identity: `chat_who` returns label/role/base, trigger prompts inject teammate info, preset labels/roles written to agent soul on spawn. Settings panel redesign with collapsible Section cards (7 tabs restructured). MCP defaults added for grok/aider/goose/copilot. Identity injection for aider/grok + generic fallback. Enhanced WSL agent detection. Thread safety fix (`_empty_read_count` lock). Frontend audit fixes (AgentBar error handling, TypingIndicator perf, MessageInput stale closure).

### Bug Fixes & Hardening (v3.9.5–v3.9.7)
Agent identity: role now flows through registration to server registry (Code Reviewer knows it's a Code Reviewer). Thinking bubbles: subtle pulse glow, glass styling. StreamingText: batch token rendering prevents layout thrashing. Real scannable QR code for mobile (qrcode library, client-side only). WebSocket keepalive ping/pong every 25s (fixes cloudflared tunnel drops). Server stop on Windows uses os._exit (SIGTERM unreliable). Plan mode enforcement: `_check_execution_mode()` now wired into tool wrapper (was dead code). cleanup_agent() race condition fixed (single lock acquisition). Bare except:pass blocks replaced with debug logging across mcp_bridge and app.py. TTS play button on agent messages (OpenAI TTS via /api/tts). Electron wizard/launcher: webSecurity + allowRunningInsecureContent flags added. Rate limiter: 60s cleanup cycle, 10K IP hard cap.

**Stats:** 80+ bugs fixed | 132+ API endpoints | 17 MCP tools | 13 agents | 13 providers | 51 React components | 57 tests | 9 themes

---

## Phase 0: Stability & Zero-Bug Baseline (v3.9.8)
**Priority:** CRITICAL — Must ship before any new features. Anyone cloning from GitHub should get a clean, working app.
**Effort:** 1–3 days

### 0.1 — Fix Version Sync Across All Packages
**What:** Backend `__version__` is `"3.9.4"` while frontend/desktop are `"3.9.7"`. Test file expects `"3.9.0"`. All three must match and the test must pass.
**Files:** `backend/app.py` (line 5), `backend/tests/test_core.py` (line 18)
**Smoke test:** `python -m pytest tests/test_core.py::test_version -v` passes.
**Fail test:** Run `grep -r '__version__\|"version"' backend/app.py frontend/package.json desktop/package.json` — all three show same value.
**Acceptance:** `pytest tests/` → 57/57 pass (0 failures). All three packages show identical version.

### 0.2 — Fix System Message Markdown Rendering
**What:** System messages (session started, phase changes, execution mode) render literal `**bold**` asterisks instead of bold text. They appear as ALL CAPS with raw markdown syntax visible.
**Files:** `frontend/src/components/ChatMessage.tsx` — system message rendering path
**Root cause:** System messages bypass the ReactMarkdown renderer and are rendered as plain text with `text-transform: uppercase` CSS.
**Smoke test:** Send a system message containing `**bold text**` → it renders as **bold text** (bold, not asterisks).
**Fail test:** View #general channel → system messages like "Session started: **Code Review**" show bold "Code Review" not asterisks.
**Acceptance:** All system messages render inline markdown (bold, italic, code) properly.

### 0.3 — Fix Broken Emoji in Reaction Badges
**What:** Some emoji reactions display as "??" in the reaction badge. The 👍 emoji renders correctly, but other emoji (possibly stored as surrogate pairs or multi-codepoint sequences) show as question marks.
**Files:** `frontend/src/components/ChatMessage.tsx` — reaction rendering section
**Root cause:** Likely the emoji is stored as a Unicode sequence the font can't render, or there's a text encoding issue in the reaction display span.
**Smoke test:** React to a message with every emoji in the picker → all render correctly in the badge.
**Fail test:** No "??" text visible in any reaction badge across all channels.
**Acceptance:** All 6 emoji in the picker render correctly in reaction badges on all platforms.

### 0.4 — Fix Timezone Default to Africa/Abidjan
**What:** Settings > General > Date & Time defaults to "Africa/Abidjan" (first alphabetically) instead of the user's local timezone.
**Files:** `frontend/src/stores/chatStore.ts` (settings defaults), `frontend/src/components/SettingsPanel.tsx`
**Smoke test:** Fresh install (clear settings.json) → open Date & Time → timezone matches browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`.
**Fail test:** Never show "Africa/Abidjan" unless the user is actually in that timezone.
**Acceptance:** Default timezone auto-detected from browser. Persists after save.

### 0.5 — ESLint Critical Fixes (React Hooks Purity + Effects)
**What:** Fix the 10 most dangerous ESLint errors: 5 `react-hooks/purity` (Date.now during render — causes non-deterministic renders) and 5 `react-hooks/set-state-in-effect` (setState called synchronously in effects — can cause infinite loops).
**Files:** `AgentInfoPanel.tsx`, `ChatMessage.tsx`, `StatsPanel.tsx` (purity); `ChannelSummary.tsx`, `ChatWidget.tsx`, `MessageInput.tsx`, `RemoteSession.tsx`, `SplitView.tsx` (effects)
**Smoke test:** `npx eslint . --quiet 2>&1 | grep -c "react-hooks/purity\|react-hooks/set-state-in-effect"` → 0.
**Fail test:** Run app, rapidly switch channels and settings tabs → no freezing, no infinite loops, no console warnings.
**Acceptance:** ESLint count drops from 96 to 86 or fewer. Zero react-hooks/purity and set-state-in-effect errors.

### 0.6 — Frontend Bundle Splitting
**What:** Frontend JS bundle is 874KB (single chunk). Split into route-based chunks using dynamic imports: Settings, Jobs, Rules, SearchModal, AddAgentModal load on demand.
**Files:** `frontend/src/App.tsx`, heavy components get `React.lazy()` wrappers
**Smoke test:** `npm run build` → no single chunk above 500KB. Total size roughly the same but split across 4-6 files.
**Fail test:** Navigate to Settings → panel loads (may show brief skeleton). No blank screen.
**Acceptance:** Vite build produces multiple chunks. Initial load under 500KB. All features still work.

### 0.7 — Frontend Test Foundation
**What:** Add Vitest + React Testing Library. Write tests for the 5 most critical components: `ChatMessage`, `MessageInput`, `chatStore`, `useWebSocket`, `api.ts`.
**Files:** `frontend/vitest.config.ts`, `frontend/src/**/*.test.tsx` (new files)
**Deps:** `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`
**Smoke test:** `npm test` → all tests pass. Coverage for 5 critical modules > 60%.
**Fail test:** Break a message render → test catches it.
**Acceptance:** CI can run `npm test` and get a pass/fail signal on the frontend.

### 0.8 — Python Type Annotations + Ruff Linting
**What:** Add `ruff` to backend CI. Add type annotations to all public functions in `app.py`, `store.py`, `registry.py`, `router.py`, `mcp_bridge.py`. Add `pyproject.toml` with ruff config.
**Files:** `backend/pyproject.toml` (new), all 5 core modules
**Smoke test:** `ruff check backend/` → 0 errors. `pyright backend/app.py` → 0 errors on annotated functions.
**Fail test:** Add a type error → ruff/pyright catches it before runtime.
**Acceptance:** `ruff check` and `pyright` pass in CI. Core modules fully typed.

**Release:** `v3.9.8: Zero-bug baseline — version sync, markdown fix, emoji fix, timezone fix, ESLint critical fixes, bundle splitting, test foundation, Python typing`

---

## Phase 1: First-Run Experience & Personalization (v3.10.0)
**Priority:** HIGH — First impression determines adoption. Anyone cloning from GitHub must have a smooth, personalized experience.
**Effort:** 1 week

### 1.1 — First-Run Setup Flow (Web)
**What:** On first visit (no settings.json), show a welcome modal: username, preferred theme, timezone (auto-detected), enable notifications? Pick 1-3 favorite agents. Skip option for power users. Save to settings.json on completion.
**Files:** New `frontend/src/components/FirstRunWizard.tsx`, `chatStore.ts` (detect first run)
**Why:** Current onboarding tour explains UI but doesn't configure anything. Users start with defaults that may not match their setup.
**Smoke test:** Delete `data/settings.json` → refresh → wizard appears → complete it → settings saved → wizard never appears again.
**Fail test:** Wizard doesn't appear if settings.json already exists. Clicking "Skip" still saves defaults.
**Acceptance:** New users get a personalized setup in under 60 seconds.

### 1.2 — Custom Agent Avatars & Nicknames
**What:** Allow users to set custom avatars (upload or select from gallery) and nicknames for any agent. Stored in settings.json. Displayed in agent bar, messages, and sidebar.
**Files:** `SettingsPanel.tsx` (Agents tab), `AgentIcon.tsx`, `ChatMessage.tsx`, `AgentBar.tsx`
**Why:** Personalization makes the app feel like yours. Every chat app has this.
**Smoke test:** Upload avatar for Claude → appears in agent bar and messages. Set nickname "Opus" → displayed everywhere.
**Fail test:** Default avatars still work if no custom one set. Invalid image files rejected.
**Acceptance:** Custom avatar and nickname persist across sessions and appear in all UI locations.

### 1.3 — Per-Agent Default System Prompts
**What:** In Settings > Agents, each persistent agent gets an editable "Default System Prompt" field. This gets injected as the SOUL on every spawn. Overrides the generic template.
**Files:** `SettingsPanel.tsx`, `routes/agents.py` (spawn), `wrapper.py`
**Why:** Power users want fine-tuned agent behavior without editing soul.txt manually.
**Smoke test:** Set Claude's default prompt to "Always respond in bullet points" → spawn Claude → it responds in bullet points.
**Fail test:** Removing the custom prompt falls back to the standard template. Empty prompt doesn't crash.
**Acceptance:** Per-agent system prompts persist, inject correctly, and override the generic template.

### 1.4 — Customizable UI Layout
**What:** Let users toggle visibility of: agent bar, stats panel, channel tabs, typing indicator, message timestamps, sender labels. Stored in settings.json.
**Files:** `SettingsPanel.tsx` (Look tab), `App.tsx`, `chatStore.ts`
**Why:** Different users want different densities. Some want minimal, some want full dashboard.
**Smoke test:** Hide agent bar → it disappears. Re-enable → it returns. Persists across refresh.
**Fail test:** Hiding all panels doesn't break the app. At minimum, chat area and input always visible.
**Acceptance:** 6+ UI elements toggleable. Settings persist. No layout breakage at any combination.

### 1.5 — Custom Keyboard Shortcuts
**What:** Settings > General > Keyboard Shortcuts panel. Users can rebind all existing shortcuts (Ctrl+K, Ctrl+N, etc.) and add new ones for common actions (spawn agent, toggle sidebar, etc.).
**Files:** New `frontend/src/lib/shortcuts.ts`, `SettingsPanel.tsx`, `App.tsx`
**Why:** Power users expect rebindable shortcuts. VS Code, Cursor, Arc all have this.
**Smoke test:** Rebind Ctrl+K to Ctrl+P → Ctrl+P opens search. Original binding no longer works.
**Fail test:** Conflicting bindings show warning. Reset to defaults button works.
**Acceptance:** All shortcuts rebindable. Persisted in settings. Import/export as JSON.

**Release:** `v3.10.0: First-run experience — setup wizard, custom avatars, system prompts, layout customization, keyboard shortcuts`

---

## Phase 2: Agent Intelligence v2 (v4.0.0)
**Priority:** HIGH — Table-stakes vs Claude Code, Codex, Aider
**Effort:** 2–3 weeks

### 2.1 — Enforced Plan/Read-Only Mode
**What:** Add `execution_mode` to sessions: `plan` (blocks file_write, shell_exec, git tools), `execute` (full access), `review` (read-only). MCP bridge enforces mode before tool calls. UI shows current mode badge in header.
**Files:** `mcp_bridge.py`, `sessions.py`, `routes/sessions.py`, `App.tsx` or `ChannelTabs.tsx` (mode badge)
**Why:** Gemini CLI and Codex both have this. Prevents agents from making changes during analysis.
**Smoke test:** Start session in plan mode → agent tries file_write via MCP → gets rejection message → switch to execute → write succeeds.
**Fail test:** Plan mode blocks ALL write tools (file_write, shell_exec, git_push). Only read tools allowed.
**Acceptance:** Mode badge visible. Toggle works in real-time. No writes leak through in plan mode.

### 2.2 — Lifecycle Hooks (Pre/Post Tool Use)
**What:** Add hook points in MCP bridge: `pre_tool_use(agent, tool, args)` and `post_tool_use(agent, tool, args, result)`. Wire through existing EventBus in plugin_sdk.py. Hooks can modify args (pre) or result (post), or reject the call entirely.
**Files:** `mcp_bridge.py`, `plugin_sdk.py`
**Why:** Foundation for auto-lint (#2.4), auto-commit (#2.5), and policy enforcement. Claude Code has this.
**Smoke test:** Register a hook that logs all tool calls → agent uses chat_send → hook fires with correct args. Register a blocking hook → tool call rejected with reason.
**Fail test:** Hook errors don't crash the tool call (graceful degradation). Hooks fire in registration order.
**Acceptance:** Pre/post hooks fire for every MCP tool call. Hooks can block, modify, or passthrough.

### 2.3 — Cross-Session Memory Search
**What:** Extend agent_memory.py to index content in FTS5. Add `memory_search(query)` MCP tool that searches across all memory entries by content, not just key. UI shows memory browser in AgentInfoPanel.
**Files:** `agent_memory.py`, `mcp_bridge.py`, `AgentInfoPanel.tsx`
**Why:** Goose and Claude Code have persistent cross-session recall.
**Smoke test:** Save 3 memories with different content → search by keyword in value → returns matching entries with relevance ranking.
**Fail test:** Search returns empty for non-matching queries. Special characters don't crash FTS5.
**Acceptance:** Memory search works via MCP tool and via UI. Results sorted by relevance.

### 2.4 — Auto-Lint/Test Feedback Loop
**What:** After any file-writing MCP tool call, detect project linter (eslint, ruff, pyright) and test runner (pytest, vitest). Run automatically. Feed errors back to agent with `[LINT_ERROR]` or `[TEST_FAIL]` prefix. Configurable per agent (on/off/lint-only/test-only).
**Files:** `mcp_bridge.py` (PostEditHook), new `backend/lint_runner.py`
**Why:** Aider does this — runs linter+tests after every edit and auto-fixes. Cursor has Bugbot.
**Smoke test:** Agent writes buggy Python → ruff auto-runs → error fed back → agent self-corrects in next message.
**Fail test:** Lint runner timeout (30s) prevents hanging on large test suites. Missing linter doesn't crash (graceful skip).
**Acceptance:** Agent receives lint/test feedback automatically. Self-correction rate measurable.

### 2.5 — Auto-Commit with Smart Messages
**What:** Optional `auto_commit` flag per agent/session. After file edits pass lint/tests, stage changes and create commit with message generated from diff summary. Uses `git diff --cached --stat` (not `git diff --stat` — BUG-084 lesson).
**Files:** `backend/plugins/auto_commit.py` (fix existing), `mcp_bridge.py`
**Why:** Aider auto-commits with sensible messages after every change.
**Smoke test:** Agent edits 3 files → lint passes → auto-commit created with descriptive message → `git log --oneline -1` shows it.
**Fail test:** Lint failure blocks commit. Empty diff creates no commit. Commit message is meaningful (not "auto commit").
**Acceptance:** Auto-commit works end-to-end. Messages include file names and change summary.

### 2.6 — Watch Mode (File-Comment Triggers)
**What:** Enhance file_watcher plugin to detect `// @ghostlink:` or `# @ghostlink:` comments in watched files. Auto-route as messages to the appropriate agent. Fix `_processed_comments` memory growth (NOTE-002).
**Files:** `plugins/file_watcher.py`, `mcp_bridge.py`
**Why:** Aider watches for `AI:` comments. Lets users request changes inline in code.
**Smoke test:** Add `// @ghostlink: refactor this function` to a file → agent receives the request automatically within 5 seconds.
**Fail test:** Duplicate comments don't trigger twice. Removing the comment doesn't re-trigger. Memory doesn't grow unbounded (LRU cache with max 10K entries).
**Acceptance:** File comments route to correct agent. Memory bounded. Configurable watch paths.

### 2.7 — Repository Map (Tree-Sitter)
**What:** `RepoMap` module using tree-sitter to parse project and produce condensed architecture map (file → classes → methods with signatures). Expose as `codebase_map` MCP tool. Auto-inject condensed version into agent system prompts.
**Files:** New `backend/repo_map.py`, `mcp_bridge.py`, `wrapper.py`
**Deps:** `tree-sitter`, `tree-sitter-languages` (add to requirements.txt)
**Why:** Aider, Claude Code, and Cursor all index the codebase for context. Agents navigate faster with a map.
**Smoke test:** Point at this GhostLink repo → get map of all Python classes/functions and TypeScript components with signatures → agent uses it to navigate without manual file exploration.
**Fail test:** Large repos (10K+ files) complete in under 30 seconds. Binary files ignored. Missing language grammar doesn't crash.
**Acceptance:** `codebase_map` MCP tool returns structured JSON. Map auto-refreshes on file changes. Condensed version fits in 4K tokens.

### 2.8 — Subagent Delegation Primitive
**What:** New `delegate` MCP tool: `delegate(agent="codex", task="implement endpoint", await_result=True, timeout=300)`. Creates scoped sub-conversation, routes to target, collects response, returns to caller. Track via JobStore with delegation chain.
**Files:** `mcp_bridge.py`, `routes/agents.py`, `jobs.py`
**Why:** Claude Code has subagent dispatch. Gemini has A2A delegation. Multi-agent coordination needs this.
**Smoke test:** Claude delegates a task to Codex → Codex completes it → result returns to Claude automatically → Claude acknowledges completion.
**Fail test:** Timeout fires if delegate doesn't respond in 5 minutes. Circular delegation (A→B→A) detected and blocked. Offline agent returns error immediately.
**Acceptance:** End-to-end delegation works. JobStore tracks the chain. UI shows delegation cards.

### 2.9 — Architect/Editor Dual-Model Pattern
**What:** `architect_model` field in agent config. When set, prompt goes to architect model first (reasoning), then architect's response piped to editor model (implementation). Both outputs visible in chat.
**Files:** `wrapper.py`, `routes/agents.py` (config), `AddAgentModal.tsx` (UI for architect selection)
**Why:** Aider's best feature — gets SOTA benchmark results with this pattern.
**Smoke test:** Configure Claude Opus as architect + Claude Sonnet as editor → send coding task → Opus reasons → Sonnet implements → both outputs visible in chat with role labels.
**Fail test:** Architect failure gracefully falls back to direct-to-editor. Editor receives full architect context.
**Acceptance:** Dual-model pattern works. Both outputs visible. Configurable per agent from UI.

**Release:** `v4.0.0: Agent intelligence v2 — plan mode, hooks, memory search, auto-lint, auto-commit, watch mode, repo map, delegation, dual-model`

---

## Phase 3: Headless & Automation (v4.1.0)
**Priority:** HIGH — Opens CI/CD and developer tool market
**Effort:** 2–3 weeks

### 3.1 — Headless CLI Mode
**What:** `ghostlink-cli` entry point: `ghostlink run -p "review this PR" --agent claude --output json`. Starts server headlessly, routes prompt, streams newline-delimited JSON events to stdout, exits on completion. Support `--full-auto` (no approval prompts), `--timeout`, `--channel`.
**Files:** `backend/cli.py` (enhance existing), `app.py`
**Why:** Claude Code has `-p` flag + Agent SDK. Codex has `--full-auto`. Essential for CI/CD integration.
**Smoke test:** `ghostlink run -p "what is 2+2" --agent claude --output json | jq .` → structured JSON output with agent response.
**Fail test:** Missing agent returns error JSON (not crash). Timeout flag works. `--help` shows usage.
**Acceptance:** Headless mode works in CI environment. Output parseable by jq. Exit code 0 on success, 1 on failure.

### 3.2 — Webhook-Driven Automations
**What:** `/api/automations` endpoint. Rules that trigger on external webhook events (GitHub PR opened, CI failed, Slack message). Map to agent actions (send message, spawn agent, delegate task). HMAC-SHA256 verification. Template variable expansion from webhook payload.
**Files:** `backend/automations.py` (enhance existing), `routes/misc.py`
**Why:** Cursor has automations triggered by Slack, Linear, GitHub, PagerDuty.
**Smoke test:** Configure GitHub webhook → open PR → automation spawns Claude to review → posts summary to #general.
**Fail test:** Invalid HMAC signature returns 403. Missing template vars rendered as empty (not crash). Disabled rules don't fire.
**Acceptance:** GitHub, Slack, and generic webhook events trigger agent actions. UI shows automation history.

### 3.3 — SDK Package (Python + TypeScript)
**What:** Publish `ghostlink` Python package and `@ghostlink/sdk` npm package. Wraps the REST API for programmatic access. Typed interfaces. Async support.
**Files:** New `sdk/python/`, `sdk/typescript/` directories
**Why:** Claude Code has Agent SDK. Enables developers to build on GhostLink.
**Smoke test:** `pip install ghostlink-sdk && python -c "from ghostlink import Client; c = Client(); print(c.channels())"` works.
**Fail test:** SDK handles server offline gracefully. All API endpoints covered. TypeScript types match backend response shapes.
**Acceptance:** Both packages published to PyPI and npm. README with quickstart. Examples directory.

### 3.4 — Structured Output / Tool Results
**What:** Agent responses can include structured JSON blocks (not just text). Frontend renders them as cards, tables, charts, or widgets. Backend validates schema. New message types: `table`, `chart`, `form`, `diff`.
**Files:** `mcp_bridge.py`, `ChatMessage.tsx`, new `StructuredCard.tsx`
**Why:** Claude Code returns structured tool results. Codex has structured output mode.
**Smoke test:** Agent returns `{"type": "table", "headers": ["File", "Changes"], "rows": [["app.py", "+5/-3"]]}` → frontend renders an actual table.
**Fail test:** Invalid schema renders as raw JSON (not crash). Unknown types fall back to code block.
**Acceptance:** Tables, charts (via lightweight charting lib), diffs, and forms render inline. Agents can return structured data via MCP.

### 3.5 — Scheduled Remote Agents (Triggers)
**What:** Cron-based agent triggers that run headlessly on a schedule. Configure via UI or API: "Run Claude to check for dependency updates every Monday at 9am." Results posted to specified channel.
**Files:** `backend/schedules.py` (enhance), `routes/schedules.py`, `SettingsPanel.tsx`
**Why:** Claude Code has remote triggers. Cursor has background agents. Proactive agents are the future.
**Smoke test:** Create schedule "every 5 minutes, ping #general with date" → message appears every 5 minutes.
**Fail test:** Schedule with invalid cron expression rejected on save. Agent failure doesn't crash scheduler. Overlapping runs detected and queued.
**Acceptance:** Scheduled agents work reliably. History viewable. Enable/disable per schedule.

**Release:** `v4.1.0: Headless & automation — CLI mode, webhook triggers, SDK, structured output, scheduled agents`

---

## Phase 4: Security & Sandboxing (v4.2.0)
**Priority:** HIGH — Trust differentiator for enterprise and open-source credibility
**Effort:** 1–2 weeks

### 4.1 — Container Sandbox for Agent Commands
**What:** Wrap shell_exec tool calls in Docker or bubblewrap with limited mounts. `sandbox_mode` config per agent: `none`, `namespace` (bwrap — Linux only), `container` (docker). Mount only the agent's workspace directory. No network by default.
**Files:** `mcp_bridge.py`, `backend/sandbox.py` (enhance existing)
**Why:** Codex has workspace-write sandbox. Gemini has gVisor. Users need to trust agent commands.
**Smoke test:** Agent in container sandbox runs `rm -rf /` → contained, no host damage. Agent can read/write workspace files.
**Fail test:** Docker not installed → graceful fallback to namespace or none with warning. Sandbox timeout (60s) kills hung processes.
**Acceptance:** Three sandbox modes work. Agent commands isolated. UI shows sandbox status per agent.

### 4.2 — Network Isolation Modes
**What:** Per-agent network policy: `full`, `local_only` (only localhost/LAN), `none` (completely offline). Enforced at sandbox level or via iptables/nftables rules.
**Files:** `sandbox.py`, `routes/agents.py` (config), `AddAgentModal.tsx`
**Why:** Codex has network-restricted modes. Prevents data exfiltration.
**Smoke test:** Agent with `network: none` tries `curl https://example.com` → blocked with clear error.
**Fail test:** `local_only` allows `curl localhost:8300` but blocks external. MCP bridge always accessible regardless of network mode.
**Acceptance:** Three modes work. Config persists. UI shows network mode badge on agent chip.

### 4.3 — Full MCP Tool Call Audit Trail
**What:** Log every MCP tool call with: agent name, tool name, args (redacted secrets), result hash, timestamp, execution mode, duration_ms. Queryable via `/api/security/tool-log` with filters. Viewable in Security tab.
**Files:** `mcp_bridge.py`, `security.py`, `SettingsPanel.tsx` (Security tab)
**Why:** Enterprise requirement. Full accountability for agent actions.
**Smoke test:** Agent uses 5 tools → all 5 logged with timestamps → queryable via API → viewable in UI.
**Fail test:** Audit log doesn't slow down tool calls (async write). Log rotation at 100MB. Secrets redacted.
**Acceptance:** Complete tool call history. Filterable by agent, tool, time range. Export as CSV.

### 4.4 — Permission Presets
**What:** Named permission profiles: `read-only`, `code-review` (read + run tests), `developer` (read + write + run), `full-access`, `custom`. Assignable per agent via UI. Enforced in MCP bridge.
**Files:** `security.py`, `SettingsPanel.tsx`, `AddAgentModal.tsx`
**Why:** Cleaner UX than per-command allowlist/blocklist.
**Smoke test:** Assign "code-review" preset → agent can read files + run tests but cannot write files or execute arbitrary commands.
**Fail test:** Custom preset saves/loads correctly. Changing preset takes effect immediately (no restart needed).
**Acceptance:** 4 built-in presets + custom. Per-agent assignment. Enforced at MCP level.

**Release:** `v4.2.0: Security & sandboxing — container isolation, network modes, audit trail, permission presets`

---

## Phase 5: Advanced UX & Frontend (v4.3.0)
**Priority:** MEDIUM — Polish and power-user features
**Effort:** 2 weeks

### 5.1 — Interactive MCP Widgets
**What:** New `widget` message type. Agents can return HTML/JS that renders inline in a sandboxed iframe (CSP restricted, no external network). `ChatWidget.tsx` component with height auto-sizing.
**Files:** New `ChatWidget.tsx`, `ChatMessage.tsx`
**Why:** Cursor has MCP Apps (charts, diagrams). Goose has Apps extension.
**Smoke test:** Agent returns chart HTML → renders interactive chart inline in chat. JS executes in sandbox.
**Fail test:** Widget with `fetch()` blocked by CSP. Widget errors don't crash parent page. Height auto-adjusts.
**Acceptance:** Widgets render inline. Sandbox prevents escapes. Agents can create interactive UIs.

### 5.2 — Canvas/Artifact View
**What:** Expand agent outputs full-screen. Code diffs, long documents, generated files shown in dedicated panel with syntax highlighting, line numbers, and copy button.
**Files:** New `CanvasView.tsx`, `App.tsx`, `ChatMessage.tsx` (expand button)
**Why:** Claude.ai has Artifacts. ChatGPT has Canvas.
**Smoke test:** Click "expand" on code block → full-screen editor view with syntax highlighting. Edit inline. Copy/download.
**Fail test:** Large files (10K+ lines) don't freeze the UI (virtual scrolling). Close returns to chat.
**Acceptance:** Code, markdown, and JSON expandable. Inline editing. Download button.

### 5.3 — Agent Workspace Viewer
**What:** File tree, git status, diff viewer for each agent's workspace (especially useful with worktree isolation). Shows what files the agent has touched. Real-time updates via file watcher.
**Files:** New `WorkspaceViewer.tsx`, new `/api/agents/{name}/workspace` endpoint
**Why:** IDE-like experience. Shows agent's working state without switching to terminal.
**Smoke test:** Click agent → see file tree → click file → see diff of changes → changes update in real-time.
**Fail test:** Large workspaces (10K+ files) load with pagination. Binary files show "(binary)" not crash. Agent offline → last known state shown.
**Acceptance:** File tree with git status indicators (M/A/D). Inline diff viewer. Real-time updates.

### 5.4 — Theme Creator & Gallery
**What:** Visual theme editor. Pick colors, preview live, export/import themes as JSON. Community gallery with pre-built themes. Custom CSS injection for advanced users.
**Files:** New `ThemeCreator.tsx`, `SettingsPanel.tsx`, `index.css`
**Why:** Full customization differentiator. Users want their tools to look exactly how they want.
**Smoke test:** Create theme → pick colors → see live preview → save → export as JSON → import on another install → looks identical.
**Fail test:** Invalid colors rejected. Custom CSS doesn't break core layout. Reset to default always works.
**Acceptance:** Theme creator with live preview. 15+ color tokens customizable. Import/export. Gallery with 5+ community themes.

### 5.5 — Accessibility (WCAG 2.1 AA)
**What:** Audit and fix: aria-labels on ALL interactive elements, full keyboard navigation (Tab/Enter/Escape), screen reader support, focus management, color contrast ratios meet 4.5:1.
**Files:** All 51 components
**Why:** Required for enterprise adoption. The right thing to do.
**Smoke test:** `axe-core` scan returns 0 critical/serious violations. Navigate entire app with keyboard only.
**Fail test:** Every button has aria-label. Every input has label. Focus visible on all interactive elements.
**Acceptance:** Zero axe-core critical/serious violations. Keyboard-only navigation works end-to-end.

### 5.6 — Streaming Token-by-Token Responses
**What:** Real-time token streaming from AI providers via SSE, not post-hoc word reveal. Agent responses appear character-by-character as they're generated. Requires MCP bridge to forward streaming responses.
**Files:** `mcp_bridge.py`, `wrapper.py`, `ChatMessage.tsx`, `useWebSocket.ts`
**Why:** Every competitor has this. Current word-reveal animation is a simulation, not real streaming.
**Smoke test:** Agent responds → tokens appear one at a time in real-time → no batch delay → smooth scrolling.
**Fail test:** Network interruption mid-stream shows partial message (not lost). Reconnect resumes stream.
**Acceptance:** True token streaming visible in chat. Latency from first token to display < 100ms.

**Release:** `v4.3.0: Advanced UX — widgets, canvas, workspace viewer, theme creator, a11y, token streaming`

---

## Phase 6: Cloud & Scale (v4.4.0)
**Priority:** MEDIUM — Growth enabler
**Effort:** 3–4 weeks

### 6.1 — Remote Agent Execution
**What:** `RemoteRunner` spawns agents on SSH hosts or Docker containers. Connects back to MCP bridge via HTTP transport. Config: `"runner": "docker"` or `"runner": "ssh://host"`. Supports up to 8 parallel remote agents.
**Files:** New `backend/remote_runner.py`, `wrapper.py`, `routes/agents.py`
**Why:** Cursor runs up to 8 parallel cloud agents. Heavy tasks need more compute.
**Smoke test:** Configure SSH host → spawn agent remotely → agent appears in UI → responds to messages → deregister cleans up remote process.
**Fail test:** SSH connection failure shows clear error. Remote agent crash detected within 30s. Reconnect attempts on network drop.
**Acceptance:** Docker and SSH runners work. Up to 8 parallel agents. UI shows remote status.

### 6.2 — Multi-User Support
**What:** User accounts with password or OAuth login. Roles: admin (full access), member (chat + spawn), viewer (read-only). Private and shared channels. Per-user settings, preferences, and agent permissions.
**Files:** New `backend/auth.py`, all routes need user context, new login UI
**Why:** Team collaboration. Enterprise requirement.
**Smoke test:** Create 2 users → user A sends message → user B sees it → user B creates private channel → user A can't see it.
**Fail test:** Unauthenticated requests rejected (except login). Admin can manage all users. Password hashed with bcrypt.
**Acceptance:** Login/logout. 3 roles. Private channels. Per-user settings. Session tokens with expiry.

### 6.3 — Docker Compose Deployment
**What:** `docker-compose.yml` with: backend (FastAPI + uvicorn), frontend (nginx static), optional PostgreSQL (for multi-user). Single `docker compose up` to run everything. Health checks. Volume mounts for data persistence.
**Files:** `docker-compose.yml`, `Dockerfile` (backend), `Dockerfile.frontend`, `.dockerignore`
**Why:** Standard deployment for teams. Reproducible environment.
**Smoke test:** `docker compose up -d` → all services healthy → browser opens → full app works.
**Fail test:** `docker compose down` → clean shutdown. Data persists in volumes. Rebuild works.
**Acceptance:** One-command deployment. All features work in containers. Data persists.

### 6.4 — A2A Protocol Support
**What:** Expose Agent-to-Agent protocol endpoint alongside MCP bridge. External agents (from other A2A-compatible systems) can register as remote participants and collaborate in GhostLink channels.
**Files:** New `backend/a2a_bridge.py`, `routes/agents.py`
**Why:** Google's A2A protocol for agent interoperability. Future standard.
**Smoke test:** External A2A agent connects → appears in agent bar → sends/receives messages → disconnects cleanly.
**Fail test:** Invalid A2A messages rejected. Auth required. Rate limited.
**Acceptance:** A2A agents can join, chat, and leave. Protocol compliance verified.

### 6.5 — PWA / Mobile App
**What:** Service worker for offline support, push notifications, add-to-homescreen. Responsive design already exists — this adds native-feeling mobile features. Consider React Native wrapper for app store distribution.
**Files:** `frontend/public/sw.js`, `frontend/public/manifest.json`, `frontend/src/main.tsx`
**Why:** Mobile access without Cloudflare tunnel. Native push notifications.
**Smoke test:** Open on phone → "Add to Home Screen" prompt → app icon appears → push notifications work → offline shows cached messages.
**Fail test:** SW doesn't cache API responses (only static assets). Push notification permission denied handled gracefully.
**Acceptance:** PWA installable on iOS/Android. Push notifications. Offline static assets.

**Release:** `v4.4.0: Cloud & scale — remote execution, multi-user, Docker, A2A, PWA`

---

## Phase 7: Intelligence v3 (v4.5.0+)
**Priority:** LOW — Future differentiator
**Effort:** Ongoing

### 7.1 — Autonomous Agent Mode
**What:** Goal → breakdown → execute → report. Agent plans its own subtasks, delegates to specialists, monitors progress, and reports completion. Uses JobStore for tracking. Human can intervene at any checkpoint.
**Files:** `mcp_bridge.py` (new autonomous tools), `wrapper.py`
**Acceptance:** Give agent a goal → it creates subtasks → delegates → completes → reports summary.

### 7.2 — Agent Memory Graph
**What:** Cross-session knowledge graph with vector embeddings. Semantic search across all agent interactions. Uses SQLite with vector extension or ChromaDB.
**Files:** New `backend/memory_graph.py`, `agent_memory.py`
**Acceptance:** Save memories → query semantically ("what did we discuss about auth?") → relevant memories returned.

### 7.3 — Agent Specialization Training
**What:** Feedback loop → system prompt evolution. Agents learn from thumbs up/down and explicit corrections. System prompt evolves over time based on feedback patterns.
**Files:** `agent_memory.py`, `wrapper.py`
**Acceptance:** Give 10 thumbs-down on verbose responses → agent becomes more concise over time.

### 7.4 — RAG Pipeline
**What:** Document upload → chunking → vector store → retrieval → MCP tool for context injection. Supports PDF, DOCX, MD, code files. Per-channel document context.
**Files:** New `backend/rag.py`, `mcp_bridge.py`, `MessageInput.tsx`
**Acceptance:** Upload PDF → ask agent about it → agent retrieves relevant chunks → answers accurately.

### 7.5 — Visual Workflow Builder
**What:** Drag-and-drop workflow editor. Connect agents, tools, conditions, and data flows visually. Export as automation rules. Import community workflows.
**Files:** New `frontend/src/components/WorkflowBuilder.tsx`
**Acceptance:** Create workflow visually → test run → save → execute on schedule or trigger.

### 7.6 — Multi-Language UI (i18n)
**What:** Internationalization support. Extract all strings to locale files. Support English, Spanish, French, German, Japanese, Chinese, Korean, Portuguese initially.
**Files:** New `frontend/src/locales/`, all components
**Acceptance:** Switch language → entire UI updates. Community can contribute translations.

**Release:** `v4.5.0+: Intelligence v3 — autonomous agents, memory graph, specialization, RAG, workflows, i18n`

---

## Remaining Known Issues

| ID | Severity | Status | Description |
|----|----------|--------|-------------|
| BUG-046 | Future | OPEN | OAuth sign-in not implemented (all providers use API keys) |
| BUG-078 | N/A | OS limitation | Frontend build EPERM on FUSE mounts (Windows OneDrive/WSL) |
| BUG-081 | LOW | Acknowledged | _pending_spawns sub-ms race window (theoretical, never observed) |
| BUG-089 | LOW | OPEN | 51 ESLint `no-explicit-any` warnings (cosmetic, no runtime impact) |

All other bugs (BUG-077, 084, 085, 086, 088, 090, 093-097) are **FIXED** as of v4.5.2.

---

## Code Upgrade Backlog

| Item | Priority | Phase | Status |
|------|----------|-------|--------|
| Frontend tests | HIGH | 0 | DONE — Vitest + 11 tests (api + chatStore) |
| Bundle splitting | HIGH | 0 | DONE — React.lazy() for Settings, Jobs, Rules, Search |
| Python type annotations | MEDIUM | 0 | DONE — pyproject.toml with ruff config |
| ESLint critical fixes | HIGH | 0 | DONE — 0 errors (was 94), 51 warnings remain |
| Version sync automation | MEDIUM | 0 | DONE — test_core.py uses semver regex |
| Empty catch blocks | LOW | Any | DONE — all annotated with /* ignored */ |
| `no-explicit-any` cleanup | LOW | Any | IN PROGRESS — 51 warnings (downgraded from error) |
| React 19 concurrent features | LOW | 5 | Future — useTransition, useDeferredValue |
| SQLite → PostgreSQL option | LOW | 6 | Future — for multi-user/cloud deployment |
| OpenTelemetry | LOW | 6 | Future — distributed tracing for agent tool calls |

---

## Competitive Position (Updated 2026-03-25)

### Competitive Intelligence Sources (researched 2026-03-25)
- **Claude Code v2.1.83** (Mar 25, 2026): Auto Mode (classifier-based permissions), Computer Use (desktop control), Agent Teams (TeammateTool with 13 operations, shared task lists), 1M context, 9000+ plugins, MCP elicitation, /batch parallel worktree changes, Remote Control mobile bridge, 21 hook events, --bare mode, managed settings, Chrome integration
- **Codex CLI** (Mar 2026): GPT-5.4, 3 agent types + custom TOML agents, 6 concurrent threads, CSV batch processing, Smart Approvals (guardian subagent), OS-native sandbox (Seatbelt/Bubblewrap/Landlock), Codex Cloud, realtime voice/WebSocket, feature flags, resume/fork sessions
- **Gemini CLI v0.34+** (Mar 2026): Gemini 3/3.1 Pro, Plan Mode enabled by default with research subagents, A2A native gRPC, ACP implementation, gVisor/LXC/Docker/Seatbelt sandboxing, model routing (Pro→planning, Flash→implementation), Agent Skills, Rewind, checkpointing
- **Cursor v2.5+** (Mar 2026): Composer 2, Background Cloud Agents on Ubuntu VMs (up to 8 parallel with video recording), Bugbot (35%+ autofix merge rate), event-driven automations (Slack/Linear/GitHub/PagerDuty), MCP Apps (interactive UI), Marketplace (30+ plugins from Atlassian/Datadog/GitLab), JetBrains support
- **Aider**: Architect/editor dual-model, tree-sitter repo map with PageRank, auto-lint/auto-test/auto-commit loop, voice coding, watch mode, browser GUI, 40+ language support, 39K+ GitHub stars
- **Goose v1.25** (Feb 2026): MCP-native (extensions ARE MCP servers), unified Summon (load+delegate), Recipes & Skills, custom distributions, Seatbelt sandboxing, SLSA Build Provenance
- **Windsurf/Cognition** (acquired $250M): Cascade engine, auto-generated memories, Fast Context (SWE-grep, 20x faster, 2800 tok/s), dedicated terminal, Workflows, Live Previews, App Deploys
- **GitHub Copilot** (Mar 2026): Coding Agent (assign issues, Actions-powered), Memory (repo-level, on by default), Spaces, Spark (NL to full-stack app), MCP in VS Code Agent Mode

### GhostLink Unique Advantages (no competitor matches all of these):
- **Multi-agent chat room** (13 heterogeneous agents conversing in one interface) — no competitor does this
- **Channel bridges** (Discord/Telegram/Slack/WhatsApp bidirectional sync) — unique
- **Plugin marketplace with AST safety scanner** — unique safety approach
- **Agent hierarchy** (manager/worker/peer roles with delegation) — richer than competitors
- **Session templates with structured phases** and execution modes — unique
- **13 AI providers** with per-message cost tracking and failover — most provider coverage
- **Desktop app** (Electron) with auto-update + 9 themes + system tray — unique packaging
- **Approval prompt interception** (catches any CLI permission prompt, shows in chat) — unique cross-agent
- **Full local-first architecture** (zero telemetry, zero cloud dependency) — strongest privacy story

### After Phase 0–3 completion, GhostLink will match or exceed:
| Competitor | Features GhostLink Will Match |
|-----------|-------------------------------|
| **Claude Code** | Hooks (pre/post tool use), headless CLI, SDK, subagents, worktree isolation, memory search, scheduled triggers, structured output |
| **Aider** | Auto-lint/test loop, auto-commit, dual-model (architect/editor), voice (already have), repo map (tree-sitter), watch mode |
| **Gemini CLI** | Plan mode with enforcement, A2A protocol (Phase 6), free tier agents (already have Ollama/Groq), MCP native |
| **Cursor** | Event-driven automations (webhook triggers), MCP widgets (Phase 5), background/scheduled agents, workspace viewer (Phase 5) |
| **Codex CLI** | Container sandbox, network isolation, structured output, full-auto mode, headless CLI |
| **Goose** | MCP native delegation, extensions/plugins (already have), file watch mode, custom distributions |
| **Windsurf** | Memories/personalization (Phase 1), cascade workflows, multi-file coordination |
| **Copilot Agent** | GitHub integration (webhook automations), PR automation, issue-driven workflows |

### Key Gaps to Close (from competitive research):
| Gap | Competitors Who Have It | GhostLink Phase |
|-----|------------------------|----------------|
| Auto-permission classifier (safe actions proceed, risky blocked) | Claude Code (Auto Mode) | Phase 4 |
| Cloud/remote agent VMs with video recording | Cursor, Codex Cloud | Phase 6 |
| LSP integration for real-time diagnostics | OpenCode (40+ languages) | Phase 2 (enhancement) |
| Agent teams with shared task lists | Claude Code (TeammateTool) | Phase 2 (delegation + jobs) |
| Browser automation tool | Claude Code (Chrome), Cursor, Gemini | Phase 5 (enhancement) |
| Computer Use / desktop control | Claude Code | Future |
| Model routing (reasoning→implementation) | Gemini CLI, Aider | Phase 2 (dual-model) |
| Session resume/fork/rewind | Claude Code, Codex | Phase 3 (enhancement) |

### After Phase 4–6 completion, GhostLink will additionally offer:
- Remote agent execution (SSH/Docker, up to 8 parallel)
- Multi-user support with roles
- Docker Compose one-command deployment
- Full WCAG 2.1 AA accessibility
- Token-by-token streaming
- PWA mobile app
- Theme creator with community gallery
- A2A protocol interoperability

---

*End of Roadmap — v3.9.7 → v4.5.0+*
