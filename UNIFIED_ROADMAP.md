# GhostLink - Unified Roadmap

> Strategic source of truth for GhostLink development.
> Fresh agents should read [AGENTS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/AGENTS.md) first, then [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md) for active execution work.

**Last updated:** 2026-04-08
**Current version:** v6.0.0
**Comparison target:** OpenClaw v2026.4.5
**Operating model:** 4-agent team

---

## Current Reality

### Verified product baseline
- 323 API/websocket endpoints across 19 route modules
- 32 MCP tools
- 21 API providers
- 8 integrated CLI agents plus 5 experimental launcher-listed agents
- 90 React component files
- 389 automated test cases (277 backend + 112 frontend)
- Desktop app with launcher, setup wizard, auto-update, and system tray

### Verified strengths
- Multi-agent shared chat with real-time updates
- Channel bridges for Discord, Telegram, Slack, and WhatsApp
- MCP bridge over streamable HTTP and SSE
- Per-agent memory, soul, notes, and token-scoped identity enforcement
- Plugin safety scanning, heartbeat auth hardening, rate limiting, SSRF protections
- Ops toolkit: health, diagnostics, backup, restore, logs

### Current local status
- All phases 0-9 shipped and validated in v6.0.0
- Working tree is clean and synced with origin/master
- Identity isolation, durable execution, policy engine, evals, A2A, and productization are all shipped
- Remaining work is Phase 10 backlog items

---

## Team Model

GhostLink operates with a 4-agent team.

### Control layer
- `jeff` (`claude`): architect, spec owner, and frontend/desktop oversight (temporary)
- `coop` (`claude`): product and research owner
- `kurt` (`codex`): QA, safety, and gate owner

### Execution layer
- `tyson` (`codex`): backend and platform owner

Frontend/desktop execution is temporarily unassigned. jeff coordinates any frontend/desktop changes needed in the interim.

### Pairings
- `jeff` + `tyson`: identity, runtime, provider architecture
- `coop` + `jeff`: operator UX, skills, workflows, product surfaces
- `kurt` + `tyson`: smoke, stress, fail, and integration validation

### Ownership rules
- `tyson` owns backend platform files and backend tests
- `jeff`, `coop`, and `kurt` own specs, research, validation plans, and review
- Frontend/desktop files are team-coordinated through jeff until a permanent owner is assigned
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
   - `platform`
8. Every GhostLink-managed agent spawn must default to concise, token-efficient, code-verified execution behavior rather than verbose filler.

---

## Fresh-Agent Read Order

For a fresh agent spawn, use this order:

1. [AGENTS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/AGENTS.md)
2. [AGENT_PLAYBOOK.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/AGENT_PLAYBOOK.md)
3. [STATUS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/STATUS.md)
4. [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md)
5. [UNIFIED_ROADMAP.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/UNIFIED_ROADMAP.md)
6. [docs/verification/VALIDATION_MATRIX.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VALIDATION_MATRIX.md)
7. [docs/verification/VERIFICATION_LEDGER.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VERIFICATION_LEDGER.md)
8. [BUGS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/BUGS.md)
9. [docs/specs/AUDIT_SUMMARY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/AUDIT_SUMMARY.md) when an audit/remediation pass is active
10. [docs/specs/AGENT_EFFICIENCY_SPEC.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/AGENT_EFFICIENCY_SPEC.md) when spawn behavior, SOUL injection, or token-efficiency is relevant
11. Optional strategic context: [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md)
12. Later-phase execution detail: [roadmap-pt2.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt2.md)

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
- Durable execution with checkpoint, resume, replay, and fork capabilities
- Policy engine with enforceable sandbox tiers and circuit breakers
- Eval framework with trace grading and regression gates
- A2A interoperability for cross-platform agent communication
- Agent and skill productization with versioning, rollout channels, and rollback

### Must-have roadmap additions from research
- `AGENTS.md` support as an ingest/overlay layer, not as the source of truth
- Background and async agents
- Per-agent git worktree isolation
- Per-agent cost tracking and budgets
- Model routing and failover policy
- Observability and tracing for multi-agent chains
- Trust-boundary enforcement for delegation
- Lifecycle hooks for mandatory checks
- Checkpoint store and crash recovery for long-running tasks
- Per-tool approval policy and risk tiers
- Network/egress allowlists and secret scoping
- Golden task corpus and regression suite
- Trace graders for correctness, safety, cost, and latency

### Should-have roadmap additions from research
- Spec-driven development workflow
- Arena and best-of-N competition mode
- Plan mode before expensive execution
- Graph-based workflow state and checkpointing
- A2A client and server implementation
- Review-agent surfaces and provenance UI
- Full memory stratification beyond identity memory
- Versioned agent profiles and skills with rollout channels
- Agent card publication and discovery

---

## Phase Order

The roadmap is intentionally reordered around the dependencies that actually exist in GhostLink.

`0 -> 1A -> 1B -> 2 -> 3 -> 3.5 -> 4A -> 4B -> 4.5 -> 5 -> 6 -> 7 -> 8 -> 8.5 -> 9 -> 10`

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
- frontend/Electron/build cleanup (unassigned — jeff coordinates)

### Phase 1A - Stable Identity Records
**Type:** hardening
**Goal:** Land the minimum safe identity foundation first: stable backend IDs, persisted registry rows, dual lookup compatibility, and ID-keyed persistent agent storage.
**Rough effort:** 3-5 days

Key outcomes:
- stable internal `agent_id` separate from display label
- persisted registry rows in SQLite
- dual backend lookup by name or `agent_id`
- memory, soul, and notes stored under `data/agents/{agent_id}/`
- backend compatibility preserved for current frontend and wrapper contracts

Deferred out of Phase 1A:
- provider-native adapter/injection work
- frontend state-map rekeying
- worktree rekeying
- reconnect/session protocol redesign
- full task/profile/trace/artifact identity graph

Primary owners:
- `jeff`: architecture and API spec
- `tyson`: backend implementation
- `kurt`: collision, rename, restart, delegation, and attribution tests
- `coop`: external-pattern cross-check

### Phase 1B - Runtime Identity Isolation And Reinjection
**Type:** hardening
**Goal:** Remove dependence on shared workspace instruction files for identity correctness.
**Rough effort:** 4-7 days

Key outcomes:
- isolated per-agent identity storage
- reinjection on spawn, reconnect, resume, compaction, delegation, and model switch
- same-model agents can coexist in one repo without identity drift
- provider/runtime identity behavior moved here on purpose instead of being crammed into Phase 1A

Primary owners:
- `jeff`: reinjection and rollback spec
- `tyson`: runtime injection and namespaced storage
- operator-facing effective-state visibility (frontend — unassigned)
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
- effective-state and rules UI (frontend — unassigned)
- `kurt`: inheritance and permission-boundary validation

### Phase 3 - Operator Control Plane
**Type:** unification
**Goal:** Unify tasks, progress, context controls, traceability, and enterprise auditability into a single operator surface.
**Rough effort:** 1-2 weeks

Key outcomes:
- unified task model and dashboard
- thinking level UI
- context visibility controls
- stop/cancel surfaces
- explicit Skills Center UI built on profile-aware assignment
- progress and provenance UI
- tracing for delegation, tool chains, approvals, reconnects, and failover
- enterprise auditability: searchable history, filters, cost per session/task, provenance chain, exportable audit trail, retention controls

Primary owners:
- `jeff`: task/progress/control-plane/auditability spec
- `coop`: UX refinement from competitive research
- `tyson`: backend task/control/audit APIs and enforcement
- UI, operator surfaces, audit search/filter/export (frontend — unassigned)
- `kurt`: stress, failure, and audit validation

### Phase 3.5 - Durable Execution And Replay
**Type:** hardening + new capability
**Goal:** Make long-running agent execution resumable, replayable, forkable, and inspectable.
**Rough effort:** 1-2 weeks

Key outcomes:
- checkpoint store for task state
- resume from checkpoint after crash/restart
- replay from prior checkpoint
- fork alternate execution branches from prior state
- pause/resume as a first-class primitive
- idempotent side-effect boundaries
- artifact lineage graph tied to tasks/checkpoints

Primary owners:
- `jeff`: execution model spec, checkpoint schema, side-effect boundary definitions
- `coop`: compare against LangGraph, Temporal, Restate patterns
- `tyson`: checkpoint store, resume/replay engine, side-effect isolation
- checkpoint/replay/fork UI surfaces (frontend — unassigned)
- `kurt`: replay correctness, idempotency, fork/branch, crash-resume tests

### Phase 4A - Policy Engine And Sandboxing
**Type:** hardening
**Goal:** Make autonomous execution governable before scaling out background and multi-agent work.
**Rough effort:** 1-2 weeks

Key outcomes:
- per-tool approval policy with risk tiers
- network/egress allowlists and secret scoping
- sandbox tiers: host, worktree-only, container
- circuit breakers for destructive actions
- hook trust/signing policy
- webhook/notification SSRF protections

Primary owners:
- `jeff`: policy schema spec, risk tier definitions, sandbox tier architecture
- `coop`: compare against Claude Code hooks, Codex sandboxing, Devin sandboxing
- `tyson`: policy engine, sandbox integration, egress controls
- policy/sandbox visibility UI (frontend — unassigned)
- `kurt`: policy bypass, SSRF, circuit breaker, sandbox isolation tests

### Phase 4B - Provider Independence And Cost Control
**Type:** new capability + hardening
**Goal:** Make GhostLink resilient to provider policy, auth, and transport changes.
**Rough effort:** 2 weeks

Key outcomes:
- multiple transport modes per provider
- explicit provider capability and risk matrix
- model routing
- failover policy
- per-agent cost tracking and budgets (integrated with 4A policy engine)
- failover/routing events emit trace/audit events compatible with Phase 3/3.5
- degraded-mode behavior that stays operator-visible

Primary owners:
- `jeff`: backend abstraction and fallback order
- `coop`: provider matrix and product policy
- `tyson`: provider implementation
- cost/failover/operator UI (frontend — unassigned)
- `kurt`: provider-failure, policy-shift, and trace emission tests

### Phase 4.5 - Evals And Trace Grading
**Type:** hardening
**Goal:** Turn traces into measurable quality gates.
**Rough effort:** 1-2 weeks

Key outcomes:
- golden task corpus for regression baseline
- regression suite across providers, models, profiles, and agent types
- trace graders for correctness, safety, cost, latency, unnecessary tool use
- benchmark dashboards
- release gates for providers, skills, hooks, and agent profiles
- "no silent regression" merge criteria

Primary owners:
- `jeff`: eval framework spec, grading criteria definitions
- `coop`: compare against OpenAI trace grading, LangSmith, Braintrust patterns
- `kurt`: golden corpus, grading tests, regression suite ownership
- `tyson`: eval runner, trace grading engine, benchmark storage
- benchmark dashboard UI (frontend — unassigned)

### Phase 5 - Multi-Agent Execution
**Type:** new capability
**Goal:** Add the execution features that become safe only after the foundations above exist.
**Rough effort:** 2-3 weeks

Prerequisites:
- no background execution without Phase 3.5 (durable execution)
- no broad async/arena without Phase 4A (policy) and Phase 4.5 (evals)

Key outcomes:
- background and async agents
- per-agent git worktree isolation
- four-layer memory stratification:
  - identity memory
  - workspace memory
  - session/task memory
  - promoted long-term summaries
- lifecycle hooks (integrated with 4A policy)
- review-agent surfaces
- arena and best-of-N workflows (with eval scoring from 4.5)
- spec-driven development loops
- collaboration patterns using artifact lineage from 3.5

### Phase 6 - Memory And Intelligence
**Type:** new capability
**Goal:** Give agents persistent, stratified memory with cross-agent coordination.

### Phase 7 - Media Generation
**Type:** new capability
**Goal:** Add video, music, and enhanced image generation as MCP tools.

### Phase 8 - A2A Interoperability
**Type:** new capability
**Goal:** Make GhostLink both an A2A client and server for cross-platform agent communication.
**Rough effort:** 2-3 weeks

Key outcomes:
- A2A client support (discover and call remote A2A agents)
- A2A server surface (expose local agents over A2A)
- agent card publication at `/.well-known/agent-card.json`
- SSE task streaming and push notifications for long-running tasks
- auth/signature model for agent cards
- identity/task/artifact mapping between GhostLink and A2A models
- conformance/TCK plan

### Phase 8.5 - Agent And Skill Productization
**Type:** platform
**Goal:** Make agents, profiles, and skills versioned deployable assets.
**Rough effort:** 2-3 weeks

Key outcomes:
- versioned agent profiles and skills with compatibility metadata
- rollout channels: private, beta, stable
- workspace/org distribution
- rollback and deprecation flows
- policy approval before broad rollout
- usage telemetry and health per version

### Phase 9 - UI, Accessibility, And Platform Integrations
**Type:** hardening + new capability
**Goal:** Ship accessibility, platform bridges, compliance, voice, and i18n.

### Phase 10 - Future Expansion
**Type:** new capability
**Goal:** Backlog of features with no fixed timeline.

For execution-level detail for all later phases, use [roadmap-pt2.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt2.md).

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
- checkpoint and replay for long-running tasks
- policy engine and sandbox enforcement
- eval framework and trace grading
- A2A client and server
- versioned agent/skill assets

### UX gaps
- thinking level picker
- context visibility controls
- operator control room
- provenance and trace views
- skill center built on stable profiles instead of agent names
- checkpoint/replay/fork surfaces
- policy and sandbox visibility
- benchmark dashboards
- A2A discovery and status
- version management and rollout channels

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
- competitive on A2A interoperability as the protocol matures
- ahead on agent/skill productization with versioning and controlled rollout

---

## Execution Docs

- [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md): active execution plan for Phases 0-3.5
- [roadmap-pt2.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt2.md): execution plan for Phases 4A-10 with full agent assignments, file ownership, and exit gates
- [docs/specs/PHASE_1A_SPEC.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/PHASE_1A_SPEC.md): locked Phase 1A identity foundation
- [docs/specs/PHASE_1B_2_SPEC.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/PHASE_1B_2_SPEC.md): Phase 1B-2 identity isolation and profiles
- [docs/specs/PHASE_3_3_5_SPEC.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/PHASE_3_3_5_SPEC.md): Phase 3-3.5 control plane and durable execution
- [docs/specs/PHASE_4_SPEC.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/PHASE_4_SPEC.md): Phase 4A-4B-4.5 policy, provider, and evals
- [docs/specs/PHASE_5_6_SPEC.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/PHASE_5_6_SPEC.md): Phase 5-6 multi-agent execution and memory
- [docs/verification/VALIDATION_MATRIX.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VALIDATION_MATRIX.md): validation gates
- [docs/verification/VERIFICATION_LEDGER.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VERIFICATION_LEDGER.md): what is verified versus inferred
- [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md): platform survey for `coop` adopt/adapt/reject decisions
- [docs/specs/COMPETITIVE_UPGRADES_2026-04-07.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/COMPETITIVE_UPGRADES_2026-04-07.md): source-backed upgrade backlog for orchestration, supervision, memory, policy, and operator UX
- [docs/specs/RAILWAY_OPTIONAL_STRATEGY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/RAILWAY_OPTIONAL_STRATEGY.md): optional hosted-control-plane strategy without founder coupling
- [docs/specs/PRODUCTIZATION_GUARDRAILS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/PRODUCTIZATION_GUARDRAILS.md): product rules for local-first, self-hostable, founder-decoupled GhostLink
- [docs/specs/THREAT_MODEL.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/THREAT_MODEL.md): abuse paths, required controls, and defense-in-depth targets
- [docs/specs/PHASE_1A_IMPL_PLAN.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/PHASE_1A_IMPL_PLAN.md): step-by-step execution plan for tyson when implementation begins

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

*End of Unified Roadmap - v6.0.0*
