# GhostLink Roadmap Part 2

> Execution roadmap for the later strategic phases.
> Read [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md) first. This file assumes Phases 0-3 are understood and that the same 5-agent operating model is in force.

**Scope:** Phases 4-6 plus coverage checklist
**Team model:** 5 agents
**Planning horizon:** roughly 4-8 additional weeks after Phase 3, depending on how much of the expansion surface ships in one pass

---

## Team Reminder

- `jeff` (`claude`): architect/spec owner
- `coop` (`claude`): product/research owner
- `kurt` (`claude`): QA/safety/gates owner
- `tyson` (`codex`): backend/platform owner
- `ned` (`codex`): frontend plus integration/reliability owner

Keep the same non-negotiables from [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md):
- no implementation without spec
- no implementation without test plan
- no overlapping write ownership without an explicit split
- no milestone is done until the gate passes
- every milestone has a rollback path

---

## Startup Checklist For Later-Phase Work

1. Read [STATUS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/STATUS.md).
2. Re-read [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md) so the Phase 1-3 assumptions stay intact.
3. Read [roadmap-pt2.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt2.md).
4. Read [UNIFIED_ROADMAP.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/UNIFIED_ROADMAP.md).
5. Read [docs/verification/VALIDATION_MATRIX.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VALIDATION_MATRIX.md).
6. Read [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) before changing roadmap scope.

---

## Phase 4 - Provider Independence And Cost Control

**Type:** new capability + hardening
**Goal:** Make GhostLink resilient to provider policy, auth, transport, and pricing changes.
**Rough effort:** 1-2 weeks

### Why this phase matters

- Provider crackdown risk is real.
- CLI-first helps, but GhostLink still needs API, CLI, MCP, and local-model fallback rather than betting on one access path.
- Cost control and routing are no longer optional once multiple agents operate in parallel.

### Deliverables

- provider capability registry with explicit transport support:
  - API
  - CLI
  - MCP
  - local model
- provider policy/risk flags and degraded-mode behavior
- routing policy for:
  - architecture/reasoning tasks
  - implementation tasks
  - cheap/background tasks
  - offline/local fallback
- per-agent and per-task cost ledger
- soft and hard budgets
- operator-visible failover state
- provider override controls without making the core runtime provider-coupled

### Agent assignments

#### `jeff`
- Write the provider abstraction spec.
- Define transport precedence, fallback order, and degraded-mode rules.
- Define how policy-risk flags affect routing.

#### `coop`
- Maintain the provider capability matrix.
- Own adopt/adapt/reject decisions for API-first versus CLI-first defaults.
- Keep platform-survey comparisons honest so GhostLink does not chase low-value parity work.

#### `kurt`
- Define failure and abuse tests for:
  - transport outages
  - revoked auth
  - provider cooldowns
  - budget exhaustion
  - incorrect fallback
  - hidden cost blowups

#### `tyson`
- Implement the backend provider capability registry.
- Implement transport abstraction, failover, routing, and budget enforcement.
- Keep provider-specific logic isolated behind stable contracts.

#### `ned`
- Implement provider mode, budget, and failover visibility in operator UI.
- Expose degraded-mode warnings, routing explanations, and cost summaries without overwhelming the user.

### Primary file ownership

- `tyson`
  - `backend/providers.py`
  - `backend/routes/providers.py`
  - `backend/wrapper.py`
  - `backend/wrapper_mcp.py`
  - `backend/mcp_proxy.py`
  - `backend/remote_runner.py`
  - backend provider/cost tests
- `ned`
  - `frontend/src/components/SettingsPanel.tsx`
  - `frontend/src/components/settings/AdvancedTab.tsx`
  - `frontend/src/components/settings/SecurityTab.tsx`
  - `frontend/src/components/AgentInfoPanel.tsx`
  - provider/cost/failover operator surfaces

### Exit gate

- provider selection no longer assumes one transport path
- failover works without hiding state from the operator
- budgets enforce correctly and surface clearly
- critical workflows stay functional when one provider path is unavailable

### Rollback path

- Keep the old provider selection path behind a feature flag until the new registry and routing logic are stable.
- If failover or budget enforcement regresses task completion, drop back to the previous explicit-provider path while preserving telemetry.

---

## Phase 5 - Agent Execution Expansion

**Type:** new capability
**Goal:** Add the multi-agent execution features that are only safe once identity, profiles, and control-plane foundations exist.
**Rough effort:** 2-4 weeks

### Deliverables

- background and async agent runs
- per-agent git worktree isolation
- four-layer memory stratification:
  - identity memory
  - workspace memory
  - session/task memory
  - promoted long-term summaries
- lifecycle hooks for mandatory checks
- checkpointing and rollback surfaces
- review-agent flow for implementation review and regression checks
- spec-driven execution loop:
  - write spec
  - validate scope
  - execute
  - review
  - checkpoint
- plan mode before expensive/autonomous execution
- arena and best-of-N experimentation mode guarded behind explicit operator choice

### Agent assignments

#### `jeff`
- Write the worktree/background execution and checkpointing specs.
- Decide which features are core path versus optional experimental path.
- Define trust-boundary rules for delegated/background agents.

#### `coop`
- Own adopt/adapt/reject calls for:
  - best-of-N
  - arena mode
  - plan mode
  - review-agent UX
  - community-facing skill or mode sharing

#### `kurt`
- Define validation for:
  - file isolation
  - branch/worktree cleanup
  - checkpoint restore
  - background-task recovery
  - review-agent false positives
  - lifecycle-hook bypass attempts

#### `tyson`
- Implement worktree, memory, hook, checkpoint, and background-run backend behavior.
- Keep the execution engine auditable instead of becoming an opaque automation blob.

#### `ned`
- Implement plan mode, checkpoint/review surfaces, background-run visibility, and worktree/operator status UI.
- Make review and rollback understandable from the main control plane.

### Primary file ownership

- `tyson`
  - `backend/worktree.py`
  - `backend/remote_runner.py`
  - `backend/autonomous.py`
  - `backend/agent_memory.py`
  - `backend/memory_graph.py`
  - `backend/jobs.py`
  - `backend/a2a_bridge.py`
  - `backend/routes/jobs.py`
  - `backend/routes/sessions.py`
  - `backend/tests/test_checkpoint_routes.py`
  - `backend/tests/test_task_routes.py`
  - new worktree/background/memory tests
- `ned`
  - `frontend/src/components/JobsPanel.tsx`
  - `frontend/src/components/TaskQueue.tsx`
  - `frontend/src/components/CheckpointPanel.tsx`
  - `frontend/src/components/WorkflowBuilder.tsx`
  - `frontend/src/components/WorkspaceViewer.tsx`
  - `frontend/src/components/ActivityTimeline.tsx`
  - `frontend/src/components/SessionLauncher.tsx`
  - new plan/review/background-run surfaces

### Exit gate

- parallel agents can work without shared-tree collisions
- background execution survives refresh/reconnect and reports truthful progress
- checkpoints restore cleanly
- lifecycle hooks reliably fire on guarded actions
- plan mode and review flows reduce bad autonomous runs instead of just adding UI noise

### Rollback path

- Ship background execution, arena mode, and best-of-N behind explicit feature flags.
- If worktree isolation or checkpoint restore proves unstable, keep single-tree execution as the fallback and disable the unstable lane rather than weakening baseline behavior.

---

## Phase 6 - Workflow State, Compliance, And Differentiation

**Type:** new capability + hardening
**Goal:** Make GhostLink not just feature-complete, but operationally better than simpler agent shells.
**Rough effort:** 2-4 weeks depending on scope cut

### Deliverables

- graph-aware workflow state or equivalent checkpointable state machine
- end-to-end tracing for:
  - delegation chains
  - tool calls
  - approvals
  - provider failover
  - compaction/reinjection
  - hook execution
- tiered approval policy:
  - read
  - write
  - execute
  - destructive
  - deploy/publish
- audit export and compliance-ready event history
- stronger delegation trust model so restricted agents cannot escape via more privileged delegates
- review-agent and code-review policy surfaces
- self-hosted/local-model path maturity:
  - local model routing
  - offline-friendly degraded mode
  - enterprise/self-hosted deployment expectations
- targeted differentiation surfaces chosen from the survey:
  - visual targeting / preview-to-agent loop
  - browser/computer-use testing loop
  - conversation/export artifacts
  - deploy handoff hooks

### Agent assignments

#### `jeff`
- Write the tracing, approval, and trust-boundary specs.
- Define which compliance and audit guarantees GhostLink is willing to claim.
- Decide which differentiation surfaces are first-class versus plugin/extension targets.

#### `coop`
- Own the "better than other orchestrators" discipline:
  - keep only features that improve the operator control layer
  - reject gimmicks that increase complexity without leverage
- Use the platform survey to score each candidate feature as:
  - adopt
  - adapt
  - reject
  - defer

#### `kurt`
- Define validation for:
  - audit completeness
  - approval bypass attempts
  - delegation privilege escalation
  - trace gaps
  - offline/local degradation
  - replay and export integrity

#### `tyson`
- Implement state persistence, trace plumbing, approval enforcement, trust-boundary checks, and audit export backend.

#### `ned`
- Implement trace viewers, approval UX, audit/export UI, and any chosen preview/testing surfaces in a way that stays comprehensible under load.

### Primary file ownership

- `tyson`
  - `backend/routes/security.py`
  - `backend/routes/sessions.py`
  - `backend/routes/phase4_7.py`
  - `backend/security.py`
  - `backend/sessions.py`
  - `backend/store.py`
  - `backend/mcp_bridge.py`
  - `backend/a2a_bridge.py`
  - trace/approval/trust tests
- `ned`
  - `frontend/src/components/ApprovalCard.tsx`
  - `frontend/src/components/ActivityTimeline.tsx`
  - `frontend/src/components/DecisionCard.tsx`
  - `frontend/src/components/WorkspaceViewer.tsx`
  - `frontend/src/components/RemoteSession.tsx`
  - `frontend/src/components/SettingsPanel.tsx`
  - approval/trace/audit surfaces
- `ned` may also need targeted ownership in:
  - `desktop/main/index.ts`
  - `desktop/main/server.ts`
  - `desktop/main/settings.ts`
  when later-phase operator or local-runtime UX requires desktop glue

### Exit gate

- every meaningful agent action can be traced end to end
- approval policies are enforceable and understandable
- delegated agents cannot bypass stronger parent restrictions
- exported audit history is usable for debugging and compliance
- the chosen differentiation surfaces materially improve operator leverage

### Rollback path

- Keep new approval tiers and trace viewers additive until the data model stabilizes.
- If advanced workflow state becomes too invasive, preserve the event log and checkpoint substrate first, and defer the richer graph UI rather than destabilizing core runtime behavior.

---

## Capability Coverage Checklist

Use this checklist before declaring the roadmap "complete." Every item below must be mapped to one of: `implemented`, `covered in roadmap`, `deliberately deferred`, or `rejected with reason`.

### Core architecture and orchestration

- MCP-first extensibility
- `AGENTS.md` ingest/overlay
- A2A evaluation and adoption decision
- stable agent IDs
- runtime-owned identity reinjection
- profile/rules/knowledge layering
- unified task and control plane
- delegation trust boundaries
- graph-aware or checkpointable workflow state
- supervisor/spec-driven workflow model

### Execution and autonomy

- background/async agents
- per-agent worktree isolation
- best-of-N / arena experimentation
- plan mode
- lifecycle hooks
- checkpoint/rollback
- review-agent flow
- browser/computer-use testing loop

### Provider and cost strategy

- multi-transport provider runtime
- local model support
- policy-risk flags
- failover and degraded mode
- routing by task type
- per-agent cost tracking
- budgets and alerts

### UX and operator visibility

- thinking level picker
- context visibility controls
- effective-state visibility
- provenance and tracing views
- skills center
- review surfaces
- approval UX
- audit/export UX
- preview-to-agent loop

### Enterprise, safety, and deployment

- tiered approval policies
- audit trails
- exportable event history
- self-hosted posture
- local-first degraded mode
- compliance-ready logging
- deploy/publish hooks

### Nice-to-have only if they strengthen the core product

- voice input
- Figma import
- community mode gallery
- conversation export packages
- one-click deployment
- richer media generation

---

## Product Decision Matrix

This is the guardrail against roadmap bloat. GhostLink should not try to clone every platform feature at equal priority.

### Adopt directly

These strengthen GhostLink's core control-plane advantage and should land as first-class roadmap work:

- MCP-first extensibility
- runtime-owned identity instead of shared file identity
- provider abstraction across API, CLI, MCP, and local modes
- per-agent worktree isolation
- background/async execution
- cost tracking and budgets
- lifecycle hooks
- audit trails and traceability
- plan mode before expensive runs
- review-agent surfaces
- Skills Center built on stable profiles

### Adapt to GhostLink's architecture

These are worth taking, but only in GhostLink's own shape rather than by copying another product literally:

- `AGENTS.md` as import/overlay, not source of truth
- A2A as an evaluated bridge, not mandatory core complexity on day one
- arena / best-of-N as explicit operator-controlled experiments
- graph-based workflow state if it improves checkpointing and debugging without swallowing the product
- visual targeting and preview-to-agent loops for UI work
- browser/computer-use testing loops for app validation
- deploy/publish hooks with circuit breakers
- conversation export and artifact packaging
- local/self-hosted enterprise posture

### Defer unless they unlock real leverage

These can be valuable, but only after the control plane, tracing, and execution foundations are strong:

- voice input
- Figma import
- community gallery and shared modes marketplace
- one-click deployment
- richer media generation
- large connector expansion beyond the highest-value integrations

### Reject as core direction

These should not become the center of GhostLink:

- provider-coupled identity files as runtime truth
- cloud-only architecture that weakens local-first control
- feature parity for its own sake with every app-builder trend
- hidden autonomy that removes operator visibility
- gimmick UX that increases token spend without improving leverage

---

## Stop Conditions

Do not keep expanding the roadmap forever. Stop adding new phases when:

- every must-have and should-have item from the survey is either mapped or explicitly rejected
- every later phase has owners, file surfaces, exit gates, and rollback plans
- GhostLink's advantage is clear instead of drifting toward feature-copying

At that point, execution beats more planning.

---

*End of Roadmap Part 2*
