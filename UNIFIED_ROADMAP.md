# GhostLink — Development Roadmap

> Single source of truth for all development. Supersedes GAB_ROADMAP, GAF_ROADMAP, V2.5_BUGFIX_ROADMAP, ROADMAP.md.
> **For any AI picking this up: follow the phases IN ORDER within each track. Each item has acceptance criteria.**

**Last updated:** 2026-03-24
**Current version:** v3.9.4
**Owner:** Finn (nahldi)

---

## Completed Work (v1.0 → v3.9.4)

### Foundation (v1.0–v1.8)
Core chat, WebSocket, agent spawning, MCP bridge, desktop app, setup wizard, system tray, auto-updates, 13 agent CLIs, security hardening, approval interception, thinking streams, skills system, session templates, channel bridges.

### Platform (v2.0–v2.9)
Plugin system, Fernet encryption, 13 providers, model failover, Framer Motion animations, skeletons, toasts, usage tracking, WAL mode, agent identity injection, rate limiting, SSRF/XSS fixes, process tracking lock, settings lock, SIGKILL escalation, atomic approval writes.

### Architecture & Polish (v3.0–v3.3.2)
Route split (3400→612 line app.py), 13 route modules, micro-interactions, integration tests (56 total), StreamingText word reveal, ThinkingParticles, mobile sidebar gestures, dependency conflict fix, DB recovery, version sync, deque log rotation, memory cache TTL, save_settings deduplication, FTS fallback logging.

### UX & Agent Identity (v3.9.2–v3.9.4)
Thinking bubbles redesign (compact dots, no SVG clutter). Message shake/glitch fix (removed triple animation conflict: CSS + Framer Motion + component motion.div). Agent identity: `chat_who` returns label/role/base, trigger prompts inject teammate info, preset labels/roles written to agent soul on spawn. Settings panel redesign with collapsible Section cards (7 tabs restructured). MCP defaults added for grok/aider/goose/copilot. Identity injection for aider/grok + generic fallback. Enhanced WSL agent detection. Thread safety fix (`_empty_read_count` lock). Frontend audit fixes (AgentBar error handling, TypingIndicator perf, MessageInput stale closure).

**Stats:** 72+ bugs fixed | 132+ API endpoints | 17 MCP tools | 13 agents | 13 providers | 51 React components | 56 tests | 9 themes

---

## Phase 1: Agent Intelligence (v3.4.0)
**Priority:** HIGH — Table-stakes vs Claude Code, Codex, Aider
**Effort:** 1–2 weeks

### 1.1 — Enforced Plan/Read-Only Mode
**What:** Add `execution_mode` to sessions: `plan` (blocks file_write, shell_exec, git tools), `execute` (full access), `review` (read-only). MCP bridge enforces mode before tool calls.
**Files:** `mcp_bridge.py`, `sessions.py`, `routes/sessions.py`
**Why:** Gemini CLI and Codex both have this. Prevents agents from making changes during analysis.
**Acceptance:** Start session in plan mode → agent tries file_write → gets rejection message → switch to execute → write succeeds.

### 1.2 — Lifecycle Hooks (Pre/Post Tool Use)
**What:** Add hook points in MCP bridge: `pre_tool_use(agent, tool, args)` and `post_tool_use(agent, tool, args, result)`. Wire through existing EventBus in plugin_sdk.py.
**Files:** `mcp_bridge.py`, `plugin_sdk.py`
**Why:** Foundation for auto-lint (#1.4), auto-commit (#1.6), and policy enforcement. Claude Code has this.
**Acceptance:** Register a hook that logs all tool calls → agent uses chat_send → hook fires with correct args.

### 1.3 — Cross-Session Memory Search
**What:** Extend agent_memory.py to index content in FTS5. Add `memory_search(query)` MCP tool that searches across all memory entries by content, not just key.
**Files:** `agent_memory.py`, `mcp_bridge.py`
**Why:** Goose and Claude Code have persistent cross-session recall.
**Acceptance:** Save 3 memories → search by keyword in value → returns matching entries.

### 1.4 — Auto-Lint/Test Feedback Loop
**What:** After any `file_write` MCP tool call, detect project linter (eslint, ruff, pyright) and test runner (pytest, vitest). Run automatically. Feed errors back to agent with `[LINT_ERROR]` or `[TEST_FAIL]` prefix.
**Files:** `mcp_bridge.py` (PostEditHook), new `lint_runner.py`
**Why:** Aider does this — runs linter+tests after every edit and auto-fixes. Cursor has Bugbot.
**Acceptance:** Agent writes buggy Python → ruff auto-runs → error fed back → agent self-corrects.

### 1.5 — Watch Mode (File-Comment Triggers)
**What:** Enhance file_watcher plugin to detect `// @ghostlink:` or `# @ghostlink:` comments in watched files. Auto-route as messages to the appropriate agent.
**Files:** `plugins/file_watcher.py`, `mcp_bridge.py`
**Why:** Aider watches for `AI:` comments. Lets users request changes inline in code.
**Acceptance:** Add `// @ghostlink: refactor this function` to a file → agent receives the request automatically.

### 1.6 — Auto-Commit with Smart Messages
**What:** Optional `auto_commit` flag per agent/session. After file edits pass lint/tests, stage changes and create commit with message generated from diff summary.
**Files:** `mcp_bridge.py` (uses PostEditHook from 1.2), git operations
**Why:** Aider auto-commits with sensible messages after every change.
**Acceptance:** Agent edits 3 files → lint passes → auto-commit created with descriptive message → git log shows it.

**Release:** `v3.4.0: Agent intelligence — plan mode, hooks, memory search, auto-lint, watch mode, auto-commit`

---

## Phase 2: Multi-Agent Reliability (v3.5.0)
**Priority:** HIGH — Critical for multi-agent workflows
**Effort:** 1–2 weeks

### 2.1 — Git Worktree Isolation Per Agent
**What:** `WorktreeManager` creates `git worktree add` per agent on spawn. Agent's wrapper runs in that worktree. Cleanup on deregister. Prevents agents from clobbering each other's file edits.
**Files:** new `worktree.py`, `wrapper.py`, `routes/agents.py`
**Why:** Claude Code, Cursor, Codex all isolate agent workspaces.
**Acceptance:** Spawn 2 agents → each gets own worktree → both edit same file → no conflicts → merge back on deregister.

### 2.2 — Subagent Delegation Primitive
**What:** New `delegate` MCP tool: `delegate(agent="codex", task="implement endpoint", await_result=True)`. Creates scoped sub-conversation, routes to target, collects response, returns to caller. Track via JobStore.
**Files:** `mcp_bridge.py`, `routes/agents.py`
**Why:** Claude Code has subagent dispatch. Gemini has A2A delegation.
**Acceptance:** Claude delegates a task to Codex → Codex completes it → result returns to Claude automatically.

### 2.3 — Architect/Editor Dual-Model Pattern
**What:** `architect_model` field in agent config. When set, prompt goes to architect model first (reasoning), then architect's response piped to editor model (implementation).
**Files:** `wrapper.py`, `routes/agents.py` (config)
**Why:** Aider's best feature — gets SOTA benchmark results with this pattern.
**Acceptance:** Configure claude as architect + codex as editor → send task → claude reasons → codex implements → both outputs visible.

### 2.4 — Repository Map (Tree-Sitter)
**What:** `RepoMap` module using tree-sitter to parse project and produce condensed architecture map (file → classes → methods with signatures). Expose as `codebase_map` MCP tool. Auto-inject into agent system prompts.
**Files:** new `repo_map.py`, `mcp_bridge.py`, `wrapper.py`
**Deps:** `tree-sitter`, `tree-sitter-languages`
**Why:** Aider, Claude Code, and Cursor all index the codebase for context.
**Acceptance:** Point at a Python project → get map of all classes/functions → agent uses it to navigate without manual exploration.

**Release:** `v3.5.0: Multi-agent reliability — worktree isolation, delegation, dual-model, repo map`

---

## Phase 3: Headless & Automation (v3.6.0)
**Priority:** HIGH — Opens CI/CD market
**Effort:** 2–3 weeks

### 3.1 — Headless CLI Mode
**What:** `ghostlink-cli` entry point: `ghostlink run -p "review this PR" --agent claude --output json`. Starts server headlessly, routes prompt, streams newline-delimited JSON events to stdout, exits on completion.
**Files:** new `cli.py`, `app.py`
**Why:** Claude Code has `-p` flag + Agent SDK. Codex has `--full-auto`. Essential for CI/CD integration.
**Acceptance:** `ghostlink run -p "analyze this code" --agent claude | jq .` → structured JSON output.

### 3.2 — Webhook-Driven Automations
**What:** `/api/automations` endpoint. Rules that trigger on external webhook events (GitHub PR opened, CI failed, Slack message). Map to agent actions. Extends existing RuleStore with `trigger_type: "webhook"`.
**Files:** `routes/misc.py`, `rules.py`
**Why:** Cursor has automations triggered by Slack, Linear, GitHub, PagerDuty.
**Acceptance:** GitHub webhook fires on PR open → automation spawns Claude to review → posts comment back.

### 3.3 — SDK Package (Python + TypeScript)
**What:** Publish `ghostlink` Python package and `@ghostlink/sdk` npm package. Wraps the REST API for programmatic access. Typed interfaces.
**Files:** new `sdk/` directory
**Why:** Claude Code has Agent SDK. Enables developers to build on GhostLink.
**Acceptance:** `pip install ghostlink && python -c "from ghostlink import Client; c = Client(); c.send('hello')"` works.

### 3.4 — Structured Output / Tool Results
**What:** Agent responses can include structured JSON blocks (not just text). Frontend renders them as cards, tables, or widgets. Backend validates schema.
**Files:** `mcp_bridge.py`, `ChatMessage.tsx`
**Why:** Claude Code returns structured tool results. Codex has structured output mode.
**Acceptance:** Agent returns `{"type": "table", "headers": [...], "rows": [...]}` → frontend renders an actual table.

**Release:** `v3.6.0: Headless & automation — CLI mode, webhook triggers, SDK, structured output`

---

## Phase 4: Security & Sandboxing (v3.7.0)
**Priority:** MEDIUM — Differentiator for trust
**Effort:** 1–2 weeks

### 4.1 — Container Sandbox for Agent Commands
**What:** Wrap shell_exec tool calls in Docker or bubblewrap with limited mounts. `sandbox_mode` config: `none`, `namespace` (bwrap), `container` (docker).
**Files:** `mcp_bridge.py`, new `sandbox.py`
**Why:** Codex has workspace-write sandbox. Gemini has gVisor.
**Acceptance:** Agent runs `rm -rf /` in sandbox → contained, no host damage.

### 4.2 — Network Isolation Modes
**What:** Per-agent network policy: `full`, `local_only`, `none`. Enforced at sandbox level.
**Files:** `sandbox.py`, `routes/agents.py` (config)
**Why:** Codex has network-restricted modes.
**Acceptance:** Agent with `network: none` tries `curl` → blocked.

### 4.3 — Audit Trail Enhancement
**What:** Log every MCP tool call with agent, tool, args, result hash, timestamp. Queryable via `/api/security/tool-log`.
**Files:** `mcp_bridge.py`, `security.py`
**Why:** Enterprise requirement. Full accountability for agent actions.
**Acceptance:** Agent uses 5 tools → all 5 logged with timestamps → queryable via API.

### 4.4 — Permission Presets
**What:** Named permission profiles: `read-only`, `code-review`, `full-access`, `custom`. Assignable per agent via UI.
**Files:** `security.py`, `SettingsPanel.tsx`
**Why:** Cleaner UX than per-command allowlist/blocklist.
**Acceptance:** Assign "code-review" preset → agent can read files + run tests but not write files.

**Release:** `v3.7.0: Security & sandboxing — container isolation, network modes, audit trail, permission presets`

---

## Phase 5: UX & Frontend (v3.8.0)
**Priority:** MEDIUM — Polish and accessibility
**Effort:** 1–2 weeks

### 5.1 — Interactive MCP Widgets
**What:** New `widget` message type. Agents can return HTML/JS that renders inline in sandboxed iframe. `ChatWidget.tsx` component.
**Files:** new `ChatWidget.tsx`, `ChatMessage.tsx`
**Why:** Cursor has MCP Apps (charts, diagrams). Goose has Apps extension.
**Acceptance:** Agent returns chart HTML → renders interactive chart inline in chat.

### 5.2 — Canvas/Artifact View
**What:** Expand agent outputs full-screen. Code diffs, long documents, generated files shown in dedicated panel.
**Files:** new `CanvasView.tsx`, `App.tsx`
**Why:** Claude.ai has Artifacts. ChatGPT has Canvas.
**Acceptance:** Click "expand" on code block → full-screen editor view with syntax highlighting.

### 5.3 — Agent Workspace Viewer
**What:** File tree, git status, diff viewer for each agent's workspace. Shows what files the agent has touched.
**Files:** new `WorkspaceViewer.tsx`, API endpoint for file tree
**Why:** IDE-like experience. Shows agent's working state.
**Acceptance:** Click agent → see file tree → click file → see diff of changes.

### 5.4 — Accessibility (WCAG 2.1 AA)
**What:** Audit and fix: aria-labels on all interactive elements, keyboard navigation, screen reader support, focus management, color contrast.
**Files:** All components
**Why:** Required for enterprise adoption.
**Acceptance:** axe-core scan returns 0 critical/serious violations.

### 5.5 — Theme Creator
**What:** Visual theme editor. Pick colors, preview live, export/import themes. Community gallery.
**Files:** new `ThemeCreator.tsx`, `SettingsPanel.tsx`
**Why:** Customization differentiator.
**Acceptance:** Create theme → preview → export as JSON → import on another install.

**Release:** `v3.8.0: UX & frontend — widgets, canvas, workspace viewer, a11y, theme creator`

---

## Phase 6: Voice & Multimodal (v3.9.0)
**Priority:** MEDIUM
**Effort:** 2–3 weeks

### 6.1 — Voice Input (STT)
**What:** Microphone button in MessageInput. Records audio, sends to STT provider (Groq Whisper free, OpenAI Whisper, Gemini). Transcribes to text.
**Files:** `MessageInput.tsx`, new `/api/transcribe` endpoint
**Why:** Aider has voice-to-text (3.75x faster than typing).
**Acceptance:** Click mic → speak → text appears in input.

### 6.2 — Text-to-Speech (TTS) for Agent Responses
**What:** Play button on agent messages. Routes to TTS provider. Audio plays inline.
**Files:** `ChatMessage.tsx`, new `/api/tts` endpoint
**Why:** Natural interaction mode for non-coding tasks.

### 6.3 — Image Understanding
**What:** Drag image into chat → agent analyzes it via vision API.
**Files:** `MessageInput.tsx`, `mcp_bridge.py`
**Why:** Claude, Gemini, GPT-4 all have vision. Images already upload but aren't analyzed.

### 6.4 — Document Understanding
**What:** Upload PDF/DOCX → extract text → chunk → feed to agent as context.
**Files:** new `document_parser.py`, `mcp_bridge.py`
**Why:** RAG foundation. Enterprise use case.

**Release:** `v3.9.0: Voice & multimodal — STT, TTS, image understanding, document parsing`

---

## Phase 7: Cloud & Scale (v4.0.0)
**Priority:** MEDIUM — Growth enabler
**Effort:** 3–4 weeks

### 7.1 — Remote Agent Execution
**What:** `RemoteRunner` spawns agents on SSH hosts or Docker containers. Connects back to MCP bridge via HTTP transport. Config: `"runner": "docker"` or `"runner": "ssh://host"`.
**Files:** new `remote_runner.py`, `wrapper.py`
**Why:** Cursor runs up to 8 parallel cloud agents.

### 7.2 — Multi-User Support
**What:** User accounts, authentication, roles (admin/member/viewer). Private and shared channels. Per-user settings.
**Files:** New auth module, all routes need user context
**Why:** Team collaboration. Enterprise requirement.

### 7.3 — Docker Compose Deployment
**What:** `docker-compose.yml` with backend, frontend (nginx), and optional PostgreSQL.
**Files:** new `docker-compose.yml`, `Dockerfile`
**Why:** Standard deployment for teams.

### 7.4 — A2A Protocol Support
**What:** Expose A2A-compatible endpoint alongside MCP bridge. External agents can register as remote participants.
**Files:** new `a2a_bridge.py`
**Why:** Google's A2A protocol for agent interoperability.

### 7.5 — PWA / Mobile App
**What:** Service worker, push notifications, offline support. React Native wrapper for iOS/Android.
**Files:** `frontend/public/sw.js`, new `mobile/` directory
**Why:** Mobile access without Cloudflare tunnel.

**Release:** `v4.0.0: Cloud & scale — remote execution, multi-user, Docker, A2A, mobile`

---

## Phase 8: Intelligence v2 (v4.1.0+)
**Priority:** LOW — Future differentiator
**Effort:** Ongoing

### 8.1 — Autonomous Agent Mode
Goal → breakdown → execute → report. Agent plans its own subtasks, delegates, and reports completion.

### 8.2 — Agent Memory Graph
Cross-session knowledge graph. Vector embeddings for semantic search across all agent interactions.

### 8.3 — Agent Specialization Training
Feedback loop → system prompt evolution. Agents learn from thumbs up/down.

### 8.4 — Streaming Token-by-Token
Real-time token streaming from providers via SSE, not post-hoc word reveal.

### 8.5 — RAG Pipeline
Document upload → chunking → vector store → retrieval → MCP tool for context injection.

---

## Remaining Known Issues

| ID | Status | Description |
|----|--------|-------------|
| BUG-046 | Future | OAuth sign-in (requires provider app registration) |
| BUG-077 | Acknowledged | 23+ bare `except: pass` blocks (per-site review needed) |
| BUG-078 | OS limitation | Frontend build EPERM on FUSE mounts |
| BUG-081 | Acknowledged | _pending_spawns sub-ms race window (theoretical) |

---

## Code Upgrade Backlog

| Item | Priority | Description |
|------|----------|-------------|
| Frontend tests | HIGH | 0 test coverage on 46 components. Add Vitest + React Testing Library. |
| Python type checking | MEDIUM | Add pyright/mypy to CI. Many functions lack type annotations. |
| Ruff linting | MEDIUM | Add ruff to CI for consistent Python style. |
| React 19 concurrent features | LOW | Leverage `useTransition`, `useDeferredValue` for heavy renders. |
| SQLite → PostgreSQL option | LOW | For multi-user/cloud deployment (Phase 7). |
| OpenTelemetry | LOW | Distributed tracing for agent tool calls. |
| Bundle splitting | LOW | Frontend is single chunk (868KB). Split by route/modal. |

---

## Competitive Position

**GhostLink unique advantages (no competitor matches):**
- Multi-agent chat room (13 heterogeneous agents conversing)
- Channel bridges (Discord/Telegram/Slack/WhatsApp)
- Plugin marketplace with AST safety scanner
- Agent hierarchy (manager/worker/peer roles)
- Session templates with structured phases
- 13 providers with per-message cost tracking
- Desktop app with auto-update + 9 themes

**After Phase 1–3 completion, GhostLink will match or exceed:**
- Claude Code (hooks, headless, SDK, memory)
- Aider (auto-lint, auto-commit, dual-model, voice)
- Gemini CLI (plan mode, A2A)
- Cursor (automations, widgets)
- Codex (sandbox, structured output)
- Goose (delegation, watch mode)

---

*End of Roadmap — v3.3.2 → v4.1.0+*
