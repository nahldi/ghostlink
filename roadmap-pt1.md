# GhostLink Roadmap Part 1

> Active execution roadmap for the first phases.
> Fresh agents should start here after reading [STATUS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/STATUS.md).

**Scope:** Phases 0-3.5
**Team model:** 5 agents
**Version target:** v5.7.2 baseline into v6.x foundations
**Planning horizon:** first phases, roughly 4-7 weeks of focused execution after baseline cleanup

Phase 0 is complete locally. It stays in this document so fresh agents understand the baseline gate that must remain green while later phases land.

---

## Team

### Control layer
- `jeff` (`claude`): architect and spec owner
- `coop` (`claude`): product and research owner
- `kurt` (`claude`): QA, safety, and gate owner

### Execution layer
- `tyson` (`codex`): backend and platform owner
- `ned` (`codex`): frontend plus integration/reliability owner

### Pairings
- `jeff` + `tyson`: identity, runtime, providers
- `coop` + `ned`: operator UX, workflows, skills, product surfaces
- `kurt` + `ned`: smoke/stress/fail testing on integration and operator surfaces

### File ownership
- `tyson`
  - `backend/`
  - backend tests
  - backend-side wrapper/runtime/provider contracts
- `ned`
  - `frontend/src/`
  - Electron-adjacent operator UX
  - frontend build and integration surfaces
- `jeff`, `coop`, `kurt`
  - specs
  - research
  - validation plans
  - review

If a milestone crosses these boundaries, `jeff` must split the file ownership before implementation starts.

---

## Rules

1. No implementation without a concrete spec from `jeff`.
2. The spec must include:
   - file ownership
   - acceptance tests
   - failure cases
   - rollback path
3. No implementation without a test plan from `kurt`.
4. No overlapping write ownership unless explicitly split first.
5. No milestone is done until the gate passes.
6. No phase starts until prerequisite architecture is resolved.

---

## Startup Checklist For A Fresh Agent

1. Read [STATUS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/STATUS.md).
2. Read [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md).
3. Read [UNIFIED_ROADMAP.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/UNIFIED_ROADMAP.md).
4. Read [docs/verification/VALIDATION_MATRIX.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VALIDATION_MATRIX.md).
5. Read [docs/verification/VERIFICATION_LEDGER.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VERIFICATION_LEDGER.md).
6. Check current blockers with `git status`, backend tests, frontend tests, and build commands.

---

## Phase 0 - Truthful Baseline

**Type:** hardening
**Goal:** Make the local workspace honestly ready for feature work.
**Rough effort:** 1-3 days

### Current blockers
- working tree is not clean
- roadmap/status/bugs wording is not fully aligned
- local readiness truth and historical release truth are mixed together in docs

### Deliverables
- Gate 0 becomes runnable, not just aspirational
- local build/test/readiness truth becomes explicit
- doc contradictions are removed
- working tree is brought to a deliberate state

### Agent assignments

#### `jeff`
- Write the exact Phase 0 spec and blocker list.
- Decide which issues are blockers versus drift risks.

#### `coop`
- Audit roadmap claims against:
  - verification ledger
  - validation matrix
  - platform survey
  - code-grounded reality
- Remove hype or unverified claims from active docs.

#### `kurt`
- Convert Gate 0 into runnable commands and a pass/fail checklist.
- Define minimum smoke, stress, and fail checks required before Phase 1 starts.

#### `tyson`
- Handle backend-side doc and readiness cleanup.
- Fix version-sync drift risks and backend readiness issues.

#### `ned`
- Fix frontend/Electron/build blockers.
- Own frontend/Electron/build readiness follow-through after the Windows build fix.

### File ownership
- `jeff`: roadmap/spec docs only
- `coop`: research/supporting docs only
- `kurt`: validation docs and scripts
- `tyson`: backend readiness files
- `ned`: frontend/Electron/build files

### Exit gate
- backend tests pass
- frontend tests pass
- frontend TypeScript passes
- frontend lint passes
- desktop TypeScript/build pass
- Windows frontend build passes
- active docs agree
- working tree is intentionally clean or intentionally staged for the next milestone

---

## Phase 1A - Stable Identity Records

**Type:** hardening
**Goal:** Stop keying the system off display names. Establish a comprehensive identity record that every subsystem can join against.
**Rough effort:** 3-5 days

### Why this comes first
- Everything else depends on stable identity.
- Skills, profiles, runtime injection, tracing, and trust policies all break if the system only knows names like `claude` and `claude-2`.
- A full identity record is the foundation for auditability, artifact attribution, delegation lineage, and multi-agent tracing.

### Deliverables
- persisted agent instance ID
- server-owned identity record
- identity record includes all required fields:
  - `agent_id`, `session_id`, `parent_agent_id`, `task_id`, `context_id`, `trace_id`
  - `artifact_namespace`, `auth_scope`, `provider`, `workspace_id`, `profile_id`
  - `capabilities`, `transport`, immutable `rename_history`
- name changes no longer break ownership or config continuity
- every tool call, task, session, artifact, and audit event can be joined back to one identity record
- rename preserves lineage via immutable rename_history
- restart preserves agent_id but creates a new session_id
- delegation records parent_agent_id
- artifact writes are namespaced and attributable

### Agent assignments

#### `jeff`
- Write the identity record spec with all required fields.
- Define exact storage model and API contract.
- Define rename, restore, and rollback behavior.
- Define the join contract: how tool calls, tasks, sessions, artifacts, and audit events reference the identity record.

#### `coop`
- Compare against Codex, Claude Code, Gemini, and OpenClaw patterns.
- Call out what should be adopted versus rejected.

#### `kurt`
- Write tests for:
  - same-model multi-agent coexistence
  - rename continuity and lineage preservation
  - restart continuity (agent_id stable, session_id changes)
  - delegation with parent_agent_id
  - artifact namespace attribution
  - state corruption and recovery

#### `tyson`
- Implement the ID and identity record backend with all required fields.
- Replace name-only coupling in backend platform surfaces.

#### `ned`
- Add only the minimum UI/operator exposure needed to show stable identity and effective state.

### Primary file ownership
- `tyson`
  - `backend/registry.py`
  - `backend/routes/agents.py`
  - `backend/mcp_bridge.py`
  - backend identity tests
- `ned`
  - agent/operator info surfaces that expose identity state

### Exit gate
- two same-model agents can exist without name-based collisions in backend state
- rename does not break skills/settings/identity continuity
- rename_history is immutable and preserves full lineage
- restore after restart keeps agent_id stable and creates a new session_id
- delegation records parent_agent_id correctly
- artifact writes are namespaced by agent and attributable via identity record
- every tool call, task, session, artifact, and audit event can be joined back to one identity record

---

## Phase 1B - Runtime Identity Isolation And Reinjection

**Type:** hardening
**Goal:** Remove dependence on shared workspace instruction files for identity correctness.
**Rough effort:** 4-7 days

### Why this is separate
- Stable IDs solve identity persistence.
- Runtime isolation/reinjection solves identity drift in long sessions, resume flows, and same-provider workspaces.

### Deliverables
- isolated per-agent identity storage
- reinjection on:
  - spawn
  - reconnect
  - resume
  - compaction
  - delegation
  - model switch
- no shared workspace file is the source of truth for identity

### Agent assignments

#### `jeff`
- Specify reinjection lifecycle and provider adapter behavior.
- Specify rollback path if a provider integration cannot support the desired mechanism cleanly.

#### `coop`
- Validate the `AGENTS.md` and instruction-file decision:
  - import/overlay layer, not source of truth

#### `kurt`
- Write failure tests for:
  - compaction
  - stale identity after resume
  - shared workspace collision
  - delegation boundary leakage

#### `tyson`
- Implement runtime injection, storage isolation, and backend enforcement.

#### `ned`
- Expose operator visibility for identity/effective-state/trust status if needed.

### Primary file ownership
- `tyson`
  - `backend/wrapper.py`
  - `backend/wrapper_mcp.py`
  - `backend/agent_memory.py`
  - `backend/mcp_bridge.py`
  - `backend/routes/agents.py`
- `ned`
  - operator surfaces that show reinjection/effective-state status

### Exit gate
- same-model agents in one repo do not depend on shared `.claude/instructions.md` or `.codex/instructions.md` for correctness
- identity survives reconnect, resume, and compaction

---

## Phase 2 - Profiles, Rules, And Knowledge Layering

**Type:** unification
**Goal:** Make skills, rules, and imported repo guidance coherent.
**Rough effort:** 1-2 weeks

### Deliverables
- `global -> profile -> agent override` inheritance
- explicit layering for:
  - system policy
  - workspace policy
  - imported repo guidance like `AGENTS.md`
  - user/workspace memory
  - task/session memory
- rename-safe skills and settings
- explicit `AGENTS.md` import/overlay behavior
- Skills Center backend support so the UI is built on stable assignments instead of agent names

### Agent assignments

#### `jeff`
- Write the inheritance and layering spec.
- Define profile IDs versus agent instance IDs.

#### `coop`
- Own adopt/adapt/reject decisions for:
  - `AGENTS.md`
  - A2A evaluation
  - rules UX and knowledge management
- Use [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) as the standing reference for these calls.

#### `kurt`
- Write tests for:
  - inheritance correctness
  - override visibility
  - permission boundaries
  - trust-boundary delegation

#### `tyson`
- Implement backend profile model and effective-state resolution.

#### `ned`
- Implement effective-state UI and profile-aware surfaces.

### Primary file ownership
- `tyson`
  - `backend/registry.py`
  - `backend/skills.py`
  - `backend/routes/agents.py`
  - backend tests for inheritance
- `ned`
  - `frontend/src/components/AgentCockpit.tsx`
  - `frontend/src/components/AgentInfoPanel.tsx`
  - new profile/rules UI surfaces

### Exit gate
- agent rename does not break profiles, skills, or settings
- effective state is visible and accurate
- imported repo guidance is layered correctly instead of blindly replacing platform policy

---

## Phase 3 - Operator Control Plane

**Type:** unification
**Goal:** Give the operator one coherent way to see and control the multi-agent system, including enterprise auditability.
**Rough effort:** 1-2 weeks

### Deliverables
- unified task model and dashboard
- structured progress and provenance
- thinking level UI
- context visibility controls
- Skills Center UI built on the Phase 2 profile model
- stop/cancel surfaces
- traceability for:
  - delegation
  - tool call chains
  - approvals
  - reconnects
  - failover
- enterprise auditability:
  - searchable session/task/event history
  - filters by agent, provider, profile, repo, time, status
  - token/cost usage per session and task
  - provenance chain: prompt -> tool call -> artifact -> review -> merge
  - exportable audit trail
  - retention policy controls

### Agent assignments

#### `jeff`
- Write control-plane and operator-surface spec.
- Decide what is truly Phase 3 versus later expansion.
- Write auditability spec: search schema, filter dimensions, provenance chain model, export format, retention policy schema.

#### `coop`
- Pressure-test UX against Cursor, Windsurf, Replit, Devin, Claude Code, and Codex patterns.

#### `kurt`
- Define smoke, stress, and fail paths for:
  - task lifecycle
  - cancel behavior
  - reconnect
  - audit visibility
  - approval trace
  - audit search and filter accuracy
  - provenance chain completeness
  - export correctness

#### `tyson`
- Implement backend task/control APIs and enforcement.
- Implement audit search, filter, and export backend.
- Implement retention policy engine.

#### `ned`
- Implement operator dashboard, context controls, thinking picker, stop/cancel, provenance/tracing surfaces.
- Implement audit search/filter UI, provenance chain viewer, export controls, retention policy configuration.

### Primary file ownership
- `tyson`
  - `backend/jobs.py`
  - `backend/routes/agents.py`
  - `backend/mcp_bridge.py`
  - tracing/task backend tests
  - new `backend/audit.py` (search, filter, export, retention)
- `ned`
  - `frontend/src/components/JobsPanel.tsx`
  - `frontend/src/components/TaskQueue.tsx`
  - new operator/progress/provenance surfaces
  - new audit search/filter/export UI surfaces
  - header/sidebar control surfaces

### Exit gate
- operator can see who is doing what, why, with what state
- operator can stop, reroute, and audit work reliably
- task/progress/provenance behavior holds up under stress
- operator can reconstruct a task timeline from one screen
- every mutation and approval is attributable
- audit export works without replaying raw logs manually

---

## Phase 3.5 - Durable Execution And Replay

**Type:** hardening + new capability
**Goal:** Make long-running agent execution resumable, replayable, forkable, and inspectable.
**Rough effort:** 1-2 weeks

### Why this comes now
- Phase 3 gave us the operator control plane and enterprise auditability. Durable execution extends that foundation with crash recovery, replay, and branching.
- Without durable execution, any crash or restart during a long-running task loses all progress. Background and multi-agent execution (Phase 5) cannot be reliable without this.
- Replay and fork capabilities give the operator power to inspect past decisions and explore alternate execution paths.

### Deliverables
- checkpoint store for task state
- resume from checkpoint after crash/restart
- replay from prior checkpoint
- fork alternate execution branches from prior state
- pause/resume as a first-class primitive
- idempotent side-effect boundaries
- artifact lineage graph tied to tasks/checkpoints

### Agent assignments

#### `jeff`
- Write the execution model spec, checkpoint schema, and side-effect boundary definitions.
- Define checkpoint granularity: what state is captured, how often, and what triggers a checkpoint.
- Define the fork model: how a forked task inherits state, identity, and artifact lineage from the source checkpoint.
- Define rollback path if checkpoint storage becomes a performance bottleneck.

#### `coop`
- Compare against LangGraph checkpoints, Temporal workflows, and Restate patterns.
- Make adopt/adapt/reject decisions on checkpoint granularity, replay semantics, and fork UX.
- Evaluate whether the checkpoint model should support cross-agent checkpoint dependencies.

#### `kurt`
- Write replay correctness tests: replay from checkpoint N produces the same result as the original execution for deterministic paths.
- Write idempotency tests: replayed side-effectful operations do not duplicate external mutations.
- Write fork/branch tests: forked task has independent state, original task is unaffected by fork.
- Write crash-resume tests: simulate crash mid-task, verify resume from last checkpoint preserves identity and state.
- Write pause/resume tests: paused task resumes without state loss.

#### `tyson`
- Implement checkpoint store with configurable storage backend.
- Implement resume/replay engine that restores task state from checkpoints.
- Implement side-effect isolation: mark side-effectful operations and prevent duplication on replay.
- Implement fork logic: create new task from an existing checkpoint with inherited state.
- Implement pause/resume primitives in the task executor.
- Implement artifact lineage graph linkage to checkpoints and tasks.

#### `ned`
- Implement checkpoint timeline UI: visual timeline of checkpoints for a task with state previews.
- Implement replay controls: select a checkpoint, trigger replay, view replayed execution alongside original.
- Implement fork UI: select a checkpoint, fork into a new task, view forked execution.
- Implement pause/resume controls in the operator dashboard.
- Implement artifact lineage graph visualization tied to task/checkpoint context.

### Primary file ownership
- `tyson`
  - new `backend/checkpoints.py` (checkpoint store, resume/replay engine, fork logic)
  - `backend/jobs.py` (pause/resume primitives, checkpoint integration, side-effect boundaries)
  - `backend/routes/tasks.py` (checkpoint, replay, fork, pause/resume API endpoints)
  - backend tests for all of the above
- `ned`
  - new frontend checkpoint timeline, replay, fork, and artifact lineage surfaces

### Exit gate
- interrupted task resumes without losing identity or state
- operator can replay a task from checkpoint N
- operator can fork a task from checkpoint N into a new task
- side-effectful operations are not duplicated on replay
- pause/resume works without state loss
- artifact lineage graph correctly links artifacts to the checkpoints and tasks that produced them

---

## What Comes Next

After Part 1, continue with [roadmap-pt2.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt2.md) for the execution plan covering:
- policy engine and sandboxing (Phase 4A)
- provider independence and cost control (Phase 4B)
- evals and trace grading (Phase 4.5)
- multi-agent execution with background agents and worktree isolation (Phase 5)
- memory and intelligence (Phase 6)
- media generation (Phase 7)
- A2A interoperability (Phase 8)
- agent and skill productization (Phase 8.5)
- platform and integrations (Phase 9)
- future expansion backlog (Phase 10)

---

*End of Roadmap Part 1*
