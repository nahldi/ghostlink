# GhostLink — Project Status

**Last updated:** 2026-04-06
**Version:** v5.7.2
**License:** MIT

---

## What GhostLink Is

GhostLink is a local-first multi-agent AI chat platform. It provides a shared chat workspace where multiple AI coding agents can read, respond, hand off work, and use GhostLink tools in real time through a desktop app, web UI, and MCP bridge.

---

## Verified Baseline

This is the current verified baseline for `v5.7.2`:

- Latest release line is `v5.7.0`, `v5.7.1`, `v5.7.2`
- Latest verified automated test baseline: **220 tests** total
  - Backend: **171**
  - Frontend: **49**
- Frontend lint/build and desktop TypeScript build were re-verified during the `v5.7.2` release cycle
- No tracked runtime data, local settings, API keys, or local databases are included in git
- Release/install defaults remain neutral for new users

Runtime and local-only paths intentionally stay out of git:

- `backend/data/`
- `backend/uploads/`
- `.env`
- `.ghostlink/`
- `.claude/`
- `.codex/`
- build output, logs, venvs, and installer artifacts

---

## Current Product Surface

### Core counts

- **217 API/websocket endpoints** across `backend/app.py` and **14 route modules**
- **29 MCP tools**
- **13 API providers**
- **13 supported CLI agents**
- **5 channel bridges**
- **66 React component files**
- **28 built-in skills**
- **9 themes**

### Architecture

| Layer | Current stack |
|-------|---------------|
| Backend | Python 3.11+, FastAPI, aiosqlite, uvicorn |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand |
| Desktop | Electron 35, electron-builder 26, electron-updater |
| Database | SQLite with FTS5 |
| Agent runtime | Hybrid tmux + MCP-native runner paths |
| MCP transport | Streamable HTTP (`:8200`) and SSE (`:8201`) |
| Real-time UI | WebSocket + REST |
| CI/CD | GitHub Actions for Windows, Linux, macOS release builds |

### Current providers

Anthropic, OpenAI, Google, xAI, Groq, Together, Hugging Face, Ollama, Mistral, OpenRouter, DeepSeek, Perplexity, Cohere.

### Current agent CLIs

Claude, Codex, Gemini, Grok, Copilot, Aider, Goose, Pi, Cursor, Cody, Continue, OpenCode, Ollama.

---

## Recent Releases

- **v5.7.2** — launcher/wizard reliability fixes, backend memory safety, export/share pagination, process reaping, reconnect throttling, streaming perf, component decomposition cleanup
- **v5.7.1** — safe dependency refresh and version sync
- **v5.7.0** — health/diagnostics/backup/restore, updater reliability, visual reset, test expansion

See [CHANGELOG.md](/mnt/c/Users/skull/OneDrive/Desktop/projects/ghostlink/CHANGELOG.md) for release-by-release detail.

---

## What Works Now

### Desktop and onboarding

- Installer builds for Windows, Linux, and macOS
- First-run setup wizard
- Launcher with auth checks, server lifecycle control, update checks, and settings access
- Neutral first-run defaults for new installs
- WSL-aware startup with OneDrive mitigation and dependency setup

### Chat and orchestration

- Real-time chat, reactions, typing indicators, channel switching, bookmarks, search, export, share
- Agent spawn/kill/pause/resume flows from the UI
- `@mention`, `@all`, auto-routing, response modes, hierarchy, handoffs, debates, consensus flows
- Scheduled tasks, jobs, rules, approvals, and progress cards

### Tools and runtime

- 29 MCP tools spanning chat, memory, web, AI/media, agent control, and streaming
- MCP bridge exposed over streamable HTTP and SSE
- Terminal peek, cockpit/workspace visibility, file change feed, session replay, snapshots

### Ops and reliability

- `/api/health`, `/api/diagnostics`, `/api/backup`, `/api/restore`
- Bounded runtime caches and cleanup for long-lived state
- Paginated export/share endpoints
- Process reaping for dead agent wrappers
- Hardened launcher startup and wizard-to-launcher transition

### Security and trust

- Heartbeat token validation hardening
- Rate limiting
- SSRF protections
- Encrypted secrets storage
- AST-based plugin safety scanning
- Permission presets and approval interception

---

## Active Gaps

These are current, real gaps. They are tracked in [UNIFIED_ROADMAP.md](/mnt/c/Users/skull/OneDrive/Desktop/projects/ghostlink/UNIFIED_ROADMAP.md), not historical bug archaeology:

- Plugin trust model is still incomplete: no per-plugin tool allowlists, no signing/provenance, no fail-closed hook policy
- Workspace-facing agent identity is still too loose: per-agent memory exists, but shared instruction files can still be overwritten by another agent in the same workspace
- Thinking level picker exists in backend concepts but not in the main UI
- Context visibility controls are missing
- Tasking is split across jobs, agent task JSON, and separate UI surfaces
- Prompt caching and provider transport override controls are missing
- Video/music generation is not implemented
- Memory remains basic compared with the roadmap target
- Accessibility, loading states, empty states, and broader UI polish still need a systematic pass

---

## Documentation Rules

- `UNIFIED_ROADMAP.md` is the implementation source of truth
- `STATUS.md` describes the current verified baseline
- `FEATURES.md` lists current shipped capabilities only
- `BUGS.md` tracks active risks and open gaps only
- Historical audits, retired roadmaps, and screenshots belong under `docs/archive/` and `docs/screenshots/`
- Do not add personal settings, local paths, API keys, or user-specific customization to tracked files

---

## Doc Map

- [README.md](/mnt/c/Users/skull/OneDrive/Desktop/projects/ghostlink/README.md): public product overview
- [CHANGELOG.md](/mnt/c/Users/skull/OneDrive/Desktop/projects/ghostlink/CHANGELOG.md): release history
- [FEATURES.md](/mnt/c/Users/skull/OneDrive/Desktop/projects/ghostlink/FEATURES.md): current shipped capability reference
- [BUGS.md](/mnt/c/Users/skull/OneDrive/Desktop/projects/ghostlink/BUGS.md): active risks and known gaps
- [UNIFIED_ROADMAP.md](/mnt/c/Users/skull/OneDrive/Desktop/projects/ghostlink/UNIFIED_ROADMAP.md): phased execution plan
- `docs/archive/`: historical audits and retired planning docs
- `docs/screenshots/`: retained product screenshots and audit captures
