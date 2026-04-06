# GhostLink — Feature Reference

**Last updated:** 2026-04-06  
**Version:** v5.7.2

> This file lists features that are actually shipped in the current codebase. Planned work belongs in `UNIFIED_ROADMAP.md`, not here.

---

## Current Verified Counts

- **217 API/websocket endpoints**
- **29 MCP tools**
- **13 API providers**
- **13 supported CLI agents**
- **5 channel bridges**
- **66 React component files**
- **28 built-in skills**
- **220 automated tests** in the latest verified release cycle

---

## Core Product

- Real-time chat with WebSocket updates, typing indicators, reactions, bookmarks, and search
- Multi-channel workspace with channel summaries, DMs, split view, and replay support
- Message editing, export, share, snapshots, templates, and URL previews
- Command palette, keyboard shortcuts, onboarding tour, and help panel

---

## Agent Orchestration

- Spawn, stop, pause, resume, and configure agents from the UI
- 13 supported CLI agents: Claude, Codex, Gemini, Grok, Copilot, Aider, Goose, Pi, Cursor, Cody, Continue, OpenCode, Ollama
- Agent hierarchy and response modes
- `@mention`, `@all`, smart auto-routing, handoffs, consensus, and debates
- Jobs, schedules, rules, progress cards, approval cards, and decision cards
- Persistent agent settings including label, color, workspace, args, and model
- Agent memory, SOUL identity, notes, and skills enable/disable

---

## MCP and Runtime

- 29 built-in MCP tools across chat, memory, web, AI/media, agent control, and streaming
- MCP exposed over:
  - streamable HTTP on `:8200`
  - SSE on `:8201`
- Hybrid runtime model with tmux-backed wrappers and MCP-native runner support
- Approval interception and permission preset support
- Terminal peek and workspace/cockpit visibility

Current shipped MCP tools:

- Chat: `chat_send`, `chat_read`, `chat_join`, `chat_who`, `chat_channels`, `chat_rules`, `chat_progress`, `chat_propose_job`, `chat_react`, `chat_claim`
- Memory: `memory_save`, `memory_get`, `memory_list`, `memory_search`, `memory_search_all`
- Web: `web_fetch`, `web_search`, `browser_snapshot`, `image_generate`
- AI/media: `gemini_image`, `gemini_video`, `text_to_speech`, `speech_to_text`, `code_execute`
- Agent/runtime: `set_thinking`, `sessions_list`, `sessions_send`, `delegate`
- Streaming: `chat_stream_token`

---

## Providers and Models

Current API providers:

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

Shipped in the current `v5.7.x` line:

- `/api/health`
- `/api/diagnostics`
- `/api/backup`
- `/api/restore`
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

## What This File Does Not Claim

This file intentionally does **not** claim the following as shipped today:

- Per-plugin tool allowlists
- Plugin signing/provenance verification
- Fail-closed hook policy
- Thinking level picker in the main UI
- Context visibility controls
- Unified task dashboard
- Prompt cache optimization
- Video/music generation beyond the current shipped media tools
- Advanced dreaming-style memory
- Full accessibility/systematic loading-state pass

Those belong to [UNIFIED_ROADMAP.md](/mnt/c/Users/skull/OneDrive/Desktop/projects/ghostlink/UNIFIED_ROADMAP.md).
