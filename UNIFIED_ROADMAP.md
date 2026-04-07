# GhostLink - Unified Roadmap

> Strategic source of truth for GhostLink development.
> Fresh agents should read [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md) first for active execution work.

**Last updated:** 2026-04-06
**Current version:** v5.7.2
**Comparison target:** OpenClaw v2026.4.5
**Operating model:** 5-agent team

---

## Current Reality

### Verified product baseline
- 217 API/websocket endpoints across 14 route modules
- 29 MCP tools
- 13 API providers
- 8 integrated CLI agents plus 5 experimental launcher-listed agents
- 66 React component files
- 220 automated test cases
- Desktop app with launcher, setup wizard, auto-update, and system tray

### Verified strengths
- Multi-agent shared chat with real-time updates
- Channel bridges for Discord, Telegram, Slack, and WhatsApp
- MCP bridge over streamable HTTP and SSE
- Per-agent memory, soul, notes, and token-scoped identity enforcement
- Plugin safety scanning, heartbeat auth hardening, rate limiting, SSRF protections
- Ops toolkit: health, diagnostics, backup, restore, logs

### Current local blockers before new implementation
- Windows frontend build is not clean because `frontend/package.json` uses `rm -rf dist`
- Working tree is not clean
- Active docs still need consistency cleanup around roadmap, bugs, and readiness wording
- Workspace-facing agent identity injection still depends on shared instruction files in the repo root

---

## Team Model

GhostLink is now planned around a 5-agent operating model.

### Control layer
- `jeff` (`claude`): architect and spec owner
- `coop` (`claude`): product and research owner
- `kurt` (`claude`): QA, safety, and gate owner

### Execution layer
- `tyson` (`codex`): backend and platform owner
- `ned` (`codex`): frontend plus integration/reliability owner

### Pairings
- `jeff` + `tyson`: identity, runtime, provider architecture
- `coop` + `ned`: operator UX, skills, workflows, product surfaces
- `kurt` + `ned`: smoke, stress, fail, and integration validation

### Ownership rules
- `tyson` owns backend platform files and backend tests
- `ned` owns frontend, Electron-adjacent operator surfaces, and build/integration UX
- `jeff`, `coop`, and `kurt` own specs, research, validation plans, and review
- Any cross-lane milestone must be split into explicit file ownership before implementation begins

---

## Non-Negotiable Rules

1. No implementation without a concrete spec from `jeff`.
2. Every spec must include:
   - file ownership per execution agent
   - acceptance tests
   - failure cases
   - rollback path
3. No implementation without a test plan from `kurt`.
4. No overlapping write ownership unless it is explicitly split first.
5. No milestone is done until the gate passes.
6. No phase starts until prerequisite architecture is resolved.
7. Every roadmap item must be labeled as one of:
   - `new capability`
   - `unification`
   - `hardening`
   - `UI exposure of existing backend`

---

## Fresh-Agent Read Order

For a fresh agent spawn, use this order:

1. [STATUS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/STATUS.md)
2. [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md)
3. [UNIFIED_ROADMAP.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/UNIFIED_ROADMAP.md)
4. [docs/verification/VALIDATION_MATRIX.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VALIDATION_MATRIX.md)
5. [docs/verification/VERIFICATION_LEDGER.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VERIFICATION_LEDGER.md)
6. [BUGS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/BUGS.md)
7. Optional strategic context: [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md)

---

## What The Roadmap Must Solve

This roadmap is not just "add more features." It has to produce a stronger multi-agent operating layer than any single-provider tool can offer.

### Core architectural goals
- Server-owned agent identity instead of workspace-file identity
- Provider independence across API, CLI, MCP, and local model paths
- Rules and knowledge layering that survive long sessions and fresh spawns
- Unified operator control plane for tasks, progress, provenance, and failure handling
- Traceability for delegation, tool calls, approvals, and failover
- Reliable multi-agent execution without shared-worktree collisions

### Must-have roadmap additions from research
- `AGENTS.md` support as an ingest/overlay layer, not as the source of truth
- Background and async agents
- Per-agent git worktree isolation
- Per-agent cost tracking and budgets
- Model routing and failover policy
- Observability and tracing for multi-agent chains
- Trust-boundary enforcement for delegation
- Lifecycle hooks for mandatory checks

### Should-have roadmap additions from research
- Spec-driven development workflow
- Arena and best-of-N competition mode
- Plan mode before expensive execution
- Graph-based workflow state and checkpointing
- A2A evaluation and adoption plan
- Review-agent surfaces and provenance UI
- Full memory stratification beyond identity memory

---

## Phase Order

The roadmap is intentionally reordered around the dependencies that actually exist in GhostLink.

### Phase 0 - Truthful Baseline
**Type:** hardening
**Goal:** Make the local workspace and docs honest before new feature work begins.
**Rough effort:** 1-3 days

Key outcomes:
- passing Gate 0 on this machine
- clean Windows frontend build
- clean working tree
- reconciled roadmap/status/bugs wording
- version and readiness truth aligned

Primary owners:
- `jeff`: freeze blocker list and readiness spec
- `coop`: verify doc claims against code and external research
- `kurt`: convert Gate 0 into runnable checks
- `tyson`: backend/runtime cleanup
- `ned`: frontend/Electron/build cleanup

### Phase 1A - Stable Agent IDs And Identity Records
**Type:** hardening
**Goal:** Introduce persisted agent instance IDs and server-owned identity records.
**Rough effort:** 3-5 days

Key outcomes:
- stable internal ID separate from display label
- persisted identity record with provider, workspace, role/profile, skills, and namespaces
- no core logic keyed only by agent display name

Primary owners:
- `jeff`: architecture and API spec
- `tyson`: backend implementation
- `kurt`: collision, rename, and restore tests
- `coop`: external-pattern cross-check

### Phase 1B - Runtime Identity Isolation And Reinjection
**Type:** hardening
**Goal:** Remove dependence on shared workspace instruction files for identity correctness.
**Rough effort:** 4-7 days

Key outcomes:
- isolated per-agent identity storage
- reinjection on spawn, reconnect, resume, compaction, delegation, and model switch
- same-model agents can coexist in one repo without identity drift

Primary owners:
- `jeff`: reinjection and rollback spec
- `tyson`: runtime injection and namespaced storage
- `ned`: operator-facing effective-state visibility
- `kurt`: multi-agent collision and compaction tests

### Phase 2 - Profiles, Rules, And Knowledge Layering
**Type:** unification
**Goal:** Create the data model that makes skills, policies, and imported repo guidance coherent.
**Rough effort:** 1-2 weeks

Key outcomes:
- `global -> profile -> agent override` inheritance
- explicit layering for:
  - system policy
  - workspace policy
  - imported repo guidance such as `AGENTS.md`
  - user/workspace memory
  - task/session memory
- rename-safe skills and settings
- explicit `AGENTS.md` ingest/overlay behavior
- Skills Center data model support

Primary owners:
- `jeff`: inheritance and layering spec
- `coop`: adopt/adapt/reject decisions for `AGENTS.md`, A2A, and rules UX
- `tyson`: backend profile and resolution model
- `ned`: effective-state and rules UI
- `kurt`: inheritance and permission-boundary validation

### Phase 3 - Operator Control Plane
**Type:** unification
**Goal:** Unify tasks, progress, context controls, and traceability into a single operator surface.
**Rough effort:** 1-2 weeks

Key outcomes:
- unified task model and dashboard
- thinking level UI
- context visibility controls
- stop/cancel surfaces
- explicit Skills Center UI built on profile-aware assignment
- progress and provenance UI
- tracing for delegation, tool chains, approvals, reconnects, and failover

Primary owners:
- `jeff`: task/progress/control-plane spec
- `coop`: UX refinement from competitive research
- `tyson`: backend task/control APIs and enforcement
- `ned`: UI and operator surfaces
- `kurt`: stress and failure validation

### Phase 4 - Provider Independence And Cost Control
**Type:** new capability + hardening
**Goal:** Make GhostLink resilient to provider policy, auth, and transport changes.
**Rough effort:** 1-2 weeks

Key outcomes:
- multiple transport modes per provider
- explicit provider capability and risk matrix
- model routing
- failover policy
- per-agent cost tracking and budgets
- degraded-mode behavior that stays operator-visible

Primary owners:
- `jeff`: backend abstraction and fallback order
- `coop`: provider matrix and product policy
- `tyson`: provider implementation
- `ned`: cost/failover/operator UI
- `kurt`: provider-failure and policy-shift tests

### Phase 5 - Agent Execution Expansion
**Type:** new capability
**Goal:** Add the execution features that become safe only after the foundations above exist.
**Rough effort:** 2-4 weeks

Key outcomes:
- background and async agents
- per-agent git worktree isolation
- four-layer memory stratification:
  - identity memory
  - workspace memory
  - session/task memory
  - promoted long-term summaries
- lifecycle hooks
- review-agent surfaces
- arena and best-of-N workflows
- spec-driven development loops
- checkpoint and rollback surfaces

### Phase 6 - Deferred Platform Expansion
**Type:** new capability
**Goal:** Ship lower-priority expansion after the control plane is mature.

Examples:
- Matrix and Teams bridges
- mobile notifications
- richer media generation
- multilingual UI
- platform-specific service integrations

---

## What We Already Have Versus What Needs Work

### Already present but underexposed
- backend thinking-level support
- per-agent task queues and task UI
- progress cards
- delegation
- per-agent soul and notes storage
- plugin tool allowlists and fail-closed pre-tool-use hooks

### Structural gaps
- stable agent IDs
- durable profile inheritance
- runtime identity reinjection
- provider abstraction across multiple transport modes
- delegation trust boundaries
- worktree isolation
- task/progress/tracing unification

### UX gaps
- thinking level picker
- context visibility controls
- operator control room
- provenance and trace views
- skill center built on stable profiles instead of agent names

---

## Competitive Position

GhostLink already has a defensible angle:
- local-first multi-agent shared chat
- channel bridges
- desktop app
- MCP bridge
- heterogeneous agent collaboration

The roadmap should strengthen that advantage instead of flattening GhostLink into a clone of one provider-specific product.

The target state is:
- stronger than OpenClaw on runtime-owned identity and provider independence
- closer to Cursor and Replit on execution ergonomics
- closer to Claude Code and Codex on rules, hooks, and agent workflow discipline
- closer to LangGraph and enterprise agent stacks on state, tracing, and recoverability

---

## Execution Docs

- [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md): active execution plan for Phases 0-3
- [docs/verification/VALIDATION_MATRIX.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VALIDATION_MATRIX.md): validation gates
- [docs/verification/VERIFICATION_LEDGER.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VERIFICATION_LEDGER.md): what is verified versus inferred
- [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md): platform survey for `coop` adopt/adapt/reject decisions

---

## OpenClaw Reference Appendix

Keep this as a strategic reference, not as a source of truth over the codebase.

### Worth adopting in GhostLink
- identity reinjection at session boundaries
- layered security and tool policy
- task-native operator surfaces
- provider-level transport controls
- context visibility controls

### Worth rejecting or redesigning
- file-based identity as the runtime source of truth
- provider-coupled architecture
- shared workspace instruction paths for same-model agents

### Current GhostLink delta
- stronger direction on server-owned identity
- weaker today on provider abstraction, tracing, worktree isolation, and background execution

---

*End of Unified Roadmap - v5.7.2 to v6.x*
