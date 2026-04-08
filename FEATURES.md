# GhostLink — Feature Reference

**Last updated:** 2026-04-08  
**Version:** v6.0.1

> This file lists features that are actually shipped in the current codebase. Planned work belongs in `UNIFIED_ROADMAP.md`, not here.

---

## Current Verified Counts

`v6.0.1` is an additive patch release. Platform counts below remain the `v6.0.0` truth-synced baseline unless noted.

- **323 API/websocket endpoints** across **19 route modules**
- **32 MCP tools**
- **21 API providers**
- **8 integrated CLI agents** + 5 experimental (launcher-listed but not MCP-connected)
- **5 channel bridges**
- **90 React component files**
- **28 built-in skills**
- **393 automated test cases** (281 backend across 36 test files + 112 frontend across 15 test files)

---

## Core Product

- Real-time chat with WebSocket updates, typing indicators, reactions, bookmarks, and search
- Multi-channel workspace with channel summaries, DMs, split view, and replay support
- Message editing, export, share, snapshots, templates, and URL previews
- Command palette, keyboard shortcuts, onboarding tour, and help panel

---

## Agent Orchestration

- Spawn, stop, pause, resume, and configure agents from the UI
- 8 integrated CLI agents: Claude, Codex, Gemini, Grok, Copilot, Aider, Goose, Ollama
- 5 experimental (launcher-listed, no MCP integration yet): Pi, Cursor, Cody, Continue, OpenCode
- Agent hierarchy and response modes
- `@mention`, `@all`, smart auto-routing, handoffs, consensus, and debates
- Jobs, schedules, rules, progress cards, approval cards, and decision cards
- Persistent agent settings including label, color, workspace, args, and model
- Agent memory, SOUL identity, notes, and skills enable/disable

---

## MCP and Runtime

- 32 built-in MCP tools across chat, memory, web, AI/media, agent control, and streaming
- Operator introspection endpoints: `/api/introspect/memory`, `/api/introspect/tools`, `/api/introspect/stats`
- MCP exposed over:
  - streamable HTTP on `:8200`
  - SSE on `:8201`
- Hybrid runtime model with tmux-backed wrappers and MCP-native runner support
- Approval interception and permission preset support
- Terminal peek and workspace/cockpit visibility

Current shipped MCP tools:

- Chat: `chat_send`, `chat_read`, `chat_join`, `chat_who`, `chat_channels`, `chat_rules`, `chat_progress`, `chat_propose_job`, `chat_react`, `chat_claim`
- Memory: `memory_save`, `memory_get`, `memory_list`, `memory_search`, `memory_search_all`
- Web: `web_fetch`, `web_search`, `browser_snapshot`, `image_generate`, `image_edit`
- AI/media: `gemini_image`, `gemini_video`, `generate_video`, `generate_music`, `text_to_speech`, `speech_to_text`, `code_execute`
- Agent/runtime: `set_thinking`, `sessions_list`, `sessions_send`, `delegate`
- Streaming: `chat_stream_token`

---

## Providers and Models

Current API providers (21):

- Anthropic
- OpenAI
- Google
- xAI
- Groq
- Together
- Hugging Face
- Ollama
- Mistral
- OpenRouter
- DeepSeek
- Perplexity
- Cohere
- Bedrock
- Moonshot
- Z.AI
- BytePlus
- Qwen
- Fireworks
- StepFun
- Minimax

Provider/runtime features:

- Capability-based provider resolution
- Free-tier-aware provider labeling
- Provider API key verification on save
- Model failover behavior
- Local provider support through Ollama

---

## Desktop and Install Experience

- Electron desktop app with launcher and setup wizard
- Windows `.exe`, Linux `.AppImage` and `.deb`, macOS `.dmg`
- Auth detection and reconnect flows for major agent CLIs
- WSL-aware startup, OneDrive mitigation, dependency installation, and health polling
- System tray controls and auto-update support
- Neutral first-run setup flow for fresh installs

---

## Ops and Reliability

Shipped through the current `v6.0.1` release:

- `/api/health`
- `/api/diagnostics`
- `/api/backup`
- `/api/restore`
- `/api/introspect/memory`
- `/api/introspect/tools`
- `/api/introspect/stats`
- Heartbeat auth hardening
- Error visibility improvements
- Bounded in-memory runtime caches
- Batch message deletion
- Paged export/share responses
- Dead process reaping
- Launcher startup hardening
- Settings sync between desktop and backend
- Reconnect throttling
- Token streaming hot-path optimization

---

## UI and UX

- 9 visual themes
- Conversation starters and empty states
- Toast system, streaming text, thinking particles, generative cards
- Settings panel, jobs panel, rules panel, stats panel, search modal, command palette
- Persona marketplace with 14 built-in personas plus custom persona CRUD
- Component decomposition work already landed in `v5.7.2`:
  - `SettingsPanel` reduced from 2023 to 1300 LOC
  - `ChatMessage` reduced from 625 to 333 LOC
  - `MessageInput` reduced from 1103 to 825 LOC

---

## Security and Trust

- Encrypted secrets storage
- SSRF protection
- Rate limiting
- Webhook signature verification
- Approval interception and permission presets
- Per-plugin tool allowlists
- Fail-closed pre-tool-use hooks
- AST-based plugin safety scanning
- Agent token rotation and heartbeat validation
- Audit/logging surfaces in Settings > Security and Settings > Advanced

---

## Integrations and Extensibility

- Channel bridges: Discord, Telegram, Slack, WhatsApp, generic webhook
- Plugin loading from `backend/plugins/`
- Hook/event bus for plugin integration
- Skills browser and custom skill creation/import/export
- Python SDK in `sdk/python`

---

## Identity and Orchestration (v6.0.0)

- Stable `agent_id` with SQLite persistence and dual name/ID lookup
- Runtime identity isolation and drift detection
- 4-layer profile inheritance (`global -> profile -> agent override`)
- Unified task model with structured progress tracking
- Durable execution with auto-checkpoints, tool-call journal replay, fork from checkpoint, pause/resume
- Artifact lineage graph tied to tasks and checkpoints
- Policy engine at MCP/shell choke points with approval tiers
- Egress/SSRF protection, secret redaction, circuit breakers, hook signing
- Transport abstraction layer with cost tracking, budget enforcement, failover routing
- Golden task corpus with 8-dimension trace grading and CI regression gates
- Per-agent worktree isolation with background executor and process isolation
- Arena mode and collaboration patterns (handoffs, debates, consensus)
- 4-layer memory stratification with weighted recall and conflict detection
- A2A interoperability: agent card publication, remote discovery, cross-platform task delegation
- Versioned profiles/skills with rollout channels and policy-gated promotion

## What This File Does Not Claim

This file intentionally does **not** claim the following as shipped today:

- Full plugin provenance verification and signing
- Mobile push notifications
- Broad multilingual translation coverage
- Matrix / Teams bridge expansion

Those belong to [UNIFIED_ROADMAP.md](./UNIFIED_ROADMAP.md) Phase 10 backlog.
