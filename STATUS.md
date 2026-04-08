# GhostLink — Project Status

**Last updated:** 2026-04-08
**Version:** v6.0.2
**License:** MIT

---

## What GhostLink Is

GhostLink is a local-first multi-agent AI chat platform. It provides a shared chat workspace where multiple AI coding agents can read, respond, hand off work, and use GhostLink tools in real time through a desktop app, web UI, and MCP bridge.

---

## Verified Baseline

This is the current release-ready baseline for `v6.0.1`:

- Latest release: `v6.0.1` (2026-04-08) — operator introspection patch on top of the shipped `v6.0.0` platform baseline
- Latest verified automated test baseline: **393 test cases** total
  - Backend: **281 cases** across 36 test files
  - Frontend: **112 cases** across 15 test files
- Frontend lint/build and desktop TypeScript build were re-verified during the `v6.0.1` validation pass
- No tracked runtime data, local settings, API keys, or local databases are included in git
- Release/install defaults remain neutral for new users

For current local execution order and active readiness work, start with [AGENTS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/AGENTS.md), then [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md).

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

These remain the last full truth-synced platform counts; `v6.0.1` is an additive patch release.

- **323 API/websocket endpoints** across `backend/app.py` and **19 route modules**
- **32 MCP tools**
- **21 API providers**
- **8 integrated CLI agents** + 5 experimental
- **5 channel bridges**
- **90 React component files**
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

Anthropic, OpenAI, Google, xAI, Groq, Together, Hugging Face, Ollama, Mistral, OpenRouter, DeepSeek, Perplexity, Cohere, Bedrock, Moonshot, Z.AI, BytePlus, Qwen, Fireworks, StepFun, Minimax.

### Current agent CLIs

**Integrated:** Claude, Codex, Gemini, Grok, Copilot, Aider, Goose, Ollama.
**Experimental (launcher-listed, no MCP):** Pi, Cursor, Cody, Continue, OpenCode.

---

## Recent Releases

- **v6.0.1** — operator introspection patch: safe memory/tool/system summary endpoints, `/inspect ...` chat wiring, and truthfulness fixes for runtime version/count reporting. 393 tests (281 backend + 112 frontend).
- **v6.0.0** — complete multi-agent orchestration platform: identity/profiles, operator control plane, durable execution, policy engine, provider independence (21 providers), evals/trace grading, multi-agent execution, memory stratification, media generation, A2A interoperability, productization. 389 tests (277 backend + 112 frontend).
- **v5.7.2** — launcher/wizard reliability fixes, backend memory safety, export/share pagination, process reaping, reconnect throttling, streaming perf, component decomposition cleanup
- **v5.7.1** — safe dependency refresh and version sync
- **v5.7.0** — health/diagnostics/backup/restore, updater reliability, visual reset, test expansion

See [CHANGELOG.md](./CHANGELOG.md) for release-by-release detail.

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

- 32 MCP tools spanning chat, memory, web, AI/media, agent control, and streaming
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

These are current, real gaps after v6.0.0. Many former gaps were resolved in this release:

- Plugin trust model has improved (hook signing, policy snapshots) but still lacks full provenance verification and owner-managed trust controls
- Prompt caching diagnostics exist but advanced prompt-cache fingerprinting is not yet production-hardened
- Mobile push notifications are not implemented
- Multilingual UI has i18n framework but limited translation coverage
- Matrix / Teams bridge expansion is deferred

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

### Core
- [README.md](./README.md): public product overview
- [CHANGELOG.md](./CHANGELOG.md): release history
- [FEATURES.md](./FEATURES.md): current shipped capability reference
- [BUGS.md](./BUGS.md): active risks and known gaps

### Roadmap & Operations
- [AGENT_PLAYBOOK.md](./AGENT_PLAYBOOK.md): agent operating manual (start here for fresh agents)
- [UNIFIED_ROADMAP.md](./UNIFIED_ROADMAP.md): strategic phased execution plan
- [roadmap-pt1.md](./roadmap-pt1.md): operational roadmap, Phases 0-3.5
- [roadmap-pt2.md](./roadmap-pt2.md): operational roadmap, Phases 4A-10

### Specs (docs/specs/)
- `PHASE_1A_SPEC.md`: identity foundation (locked scope)
- `PHASE_1A_IMPL_PLAN.md`: step-by-step build sequence for Phase 1A
- `PHASE_1A_RISK_AUDIT.md`: regression risk analysis
- `PHASE_1B_2_SPEC.md`: identity isolation + profiles
- `PHASE_3_3_5_SPEC.md`: operator control plane + durable execution
- `PHASE_4_SPEC.md`: policy engine (4A), provider independence (4B), evals (4.5)
- `PHASE_5_6_SPEC.md`: multi-agent execution + memory stratification
- `AGENT_EFFICIENCY_SPEC.md`: token efficiency + SOUL behavioral contract
- `AUDIT_SUMMARY.md`: consolidated cross-spec audit (12 blockers, ~30 warnings)
- `APPROACH_AUDIT.md`: 7 architectural blocking issues
- `COMPETITIVE_UPGRADES_2026-04-07.md`: source-backed competitive patterns
- `THREAT_MODEL.md`: OWASP agentic risks + abuse paths
- `PRODUCTIZATION_GUARDRAILS.md`: local-first product rules
- `RAILWAY_OPTIONAL_STRATEGY.md`: optional hosted infra boundaries

### Verification (docs/verification/)
- `VALIDATION_MATRIX.md`: repeatable test gates per phase
- `VERIFICATION_LEDGER.md`: verified claims ledger

### Research
- `docs/AI_AGENT_PLATFORM_SURVEY.md`: 40+ platform competitive survey
- `docs/research/`: CLI, MCP, provider verification docs

### Archive
- `docs/archive/`: historical audits and retired planning docs
- `docs/screenshots/`: retained product screenshots and audit captures
