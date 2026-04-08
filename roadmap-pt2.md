# GhostLink Roadmap Part 2

> Continuation of [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md) covering Phases 4A-10.
> Strategic context lives in [UNIFIED_ROADMAP.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/UNIFIED_ROADMAP.md).
> Competitive research lives in [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md).

**Scope:** Phases 4A-10
**Team model:** 5 agents (same as Part 1)
**Version target:** v6.x into v7.x
**Planning horizon:** roughly 16-22 weeks of focused execution after Part 1 gates pass
**Prerequisite:** All Part 1 exit gates must pass before Phase 4A begins. Phase 3.5's durable execution is the foundation everything here builds on.

---

## Team

### Control layer
- `jeff` (`claude`): architect and spec owner
- `coop` (`claude`): product and research owner
- `kurt` (`codex`): QA, safety, and gate owner

### Execution layer
- `tyson` (`codex`): backend and platform owner
- `ned` (`codex`): frontend plus integration/reliability owner

### Pairings
- `jeff` + `tyson`: provider abstraction, transport, cost engine, memory architecture, worktree isolation, policy engine, evals, A2A
- `coop` + `ned`: operator UX for cost, arena, media, accessibility, platform integrations, productization
- `kurt` + `ned`: smoke/stress/fail testing on all new surfaces and failure modes

### File ownership
- `tyson`
  - `backend/`
  - backend tests
  - backend-side provider/transport/memory/worktree/policy/eval contracts
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

Same as Part 1. Repeated here so a fresh agent does not need to context-switch.

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
7. Every GhostLink-managed spawn should bias toward concise, token-efficient, code-verified work instead of repetitive context dumping.

---

## Startup Checklist For A Fresh Agent

1. Read [AGENTS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/AGENTS.md).
2. Read [AGENT_PLAYBOOK.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/AGENT_PLAYBOOK.md).
3. Read [STATUS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/STATUS.md).
4. Read [roadmap-pt1.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt1.md).
5. Read [UNIFIED_ROADMAP.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/UNIFIED_ROADMAP.md).
6. Read [roadmap-pt2.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/roadmap-pt2.md) (this file).
7. Read [docs/verification/VALIDATION_MATRIX.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VALIDATION_MATRIX.md).
8. Read [docs/verification/VERIFICATION_LEDGER.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/verification/VERIFICATION_LEDGER.md).
9. Read [BUGS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/BUGS.md).
10. Read [docs/specs/AUDIT_SUMMARY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/AUDIT_SUMMARY.md) when an audit/remediation pass is active.
11. Read [docs/specs/AGENT_EFFICIENCY_SPEC.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/AGENT_EFFICIENCY_SPEC.md) when spawn behavior, SOUL injection, or token-efficiency is relevant.
12. Read [docs/specs/COMPETITIVE_UPGRADES_2026-04-07.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/COMPETITIVE_UPGRADES_2026-04-07.md) when roadmap refinement or product differentiation is active.
13. Read [docs/specs/PRODUCTIZATION_GUARDRAILS.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/PRODUCTIZATION_GUARDRAILS.md), [docs/specs/RAILWAY_OPTIONAL_STRATEGY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/RAILWAY_OPTIONAL_STRATEGY.md), and [docs/specs/THREAT_MODEL.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/specs/THREAT_MODEL.md) when productization, hosting, or security design is relevant.
13. Check current blockers with `git status`, backend tests, frontend tests, and build commands.

---

## Phase 4A - Policy Engine And Sandboxing

**Type:** hardening
**Goal:** Make autonomous execution governable before scaling out background and multi-agent work.
**Rough effort:** 1-2 weeks

### Why this comes now
- Phase 3.5 gave us durable execution and replay. Before agents run autonomously in background or multi-agent configurations, the system needs enforceable policy and sandbox boundaries.
- Without a policy engine, dangerous actions rely on model self-restraint. Without sandboxing, a runaway agent can affect the host system. These controls must exist before Phase 4B cost scaling and Phase 5 parallel execution.

### Deliverables
- per-tool approval policy: operator defines which tools require approval, which are auto-approved, and which are blocked
- risk tiers by action type: `safe` (read-only), `moderate` (file writes within worktree), `high` (external API calls, deployments), `critical` (destructive operations, production-scoped actions)
- network/egress allowlists: agents can only reach approved endpoints. All other egress is blocked by default.
- secret scoping and redaction policy: secrets are scoped to the agent/task that needs them. Secrets are redacted from logs, traces, and audit exports.
- sandbox tiers: `host` (current behavior), `worktree-only` (file access restricted to agent worktree), `container` (full isolation), stronger isolation available later
- circuit breakers for destructive or production-scoped actions: automatic halt if an agent attempts too many destructive actions in a time window
- hook trust/signing policy for mandatory checks: hooks must be signed or from a trusted source before they can run as `block`-type hooks
- webhook/notification SSRF protections: outbound webhooks and notifications are validated against allowlists to prevent server-side request forgery

### Agent assignments

#### `jeff`
- Write the policy schema spec: approval rules, risk tier definitions, egress allowlist format, secret scoping rules.
- Write the sandbox tier architecture: isolation boundaries per tier, escalation rules, enforcement mechanism.
- Write the circuit breaker spec: trigger thresholds, cooldown periods, operator notification.
- Write the hook trust/signing spec: signing format, trust store, verification flow.
- Define rollback path: if the policy engine blocks legitimate work, the operator must be able to override per-action without disabling the engine entirely.

#### `coop`
- Compare against Claude Code hooks (fail-closed pre-tool-use), Codex Landlock/seccomp sandboxing, and Devin sandboxing.
- Make adopt/adapt/reject decisions on each pattern.
- Evaluate whether GhostLink's sandbox tiers map cleanly to these models or need a different abstraction.

#### `kurt`
- Write policy bypass tests: verify that a blocked tool cannot be invoked regardless of model prompting.
- Write SSRF tests: verify that webhook/notification endpoints are validated against allowlists and that internal network addresses are rejected.
- Write circuit breaker tests: verify that exceeding the destructive action threshold triggers a halt and operator notification.
- Write sandbox isolation tests: verify that a worktree-only agent cannot access files outside its worktree.
- Write secret redaction tests: verify that secrets do not appear in logs, traces, or audit exports.

#### `tyson`
- Implement the policy engine: rule storage, evaluation at tool-call time, approval queue integration.
- Implement sandbox integration: worktree-only file access enforcement, container tier scaffolding.
- Implement egress controls: allowlist storage, network request interception, blocked request logging.
- Implement secret scoping and redaction in the logging/tracing pipeline.
- Implement circuit breaker logic in the task executor.
- Implement hook trust/signing verification.
- Implement webhook/notification SSRF validation.

#### `ned`
- Implement policy configuration UI: tool approval rules editor, risk tier assignment, egress allowlist editor.
- Implement sandbox status display: per-task sandbox tier indicator, escalation controls.
- Implement circuit breaker status and notification surfaces.
- Implement secret scoping visibility: which secrets are available to which agents/tasks.

### Primary file ownership
- `tyson`
  - `backend/security.py` (egress controls, SSRF validation, secret redaction, circuit breakers)
  - new `backend/policy.py` (policy engine, approval rules, risk tiers, sandbox tier enforcement)
  - `backend/mcp_bridge.py` (policy evaluation hooks at tool-call time)
  - backend tests for all of the above
- `ned`
  - new frontend policy configuration, sandbox status, and circuit breaker surfaces

### Exit gate
- dangerous actions can be blocked by policy even if the model attempts them
- sandbox tier is visible per task
- secrets and egress policy are enforced, not advisory
- circuit breaker halts execution after exceeding the destructive action threshold
- SSRF validation blocks internal network addresses in webhook/notification targets
- hook signing verification prevents unsigned hooks from running as block-type

---

## Phase 4B - Provider Independence And Cost Control

**Type:** new capability + hardening
**Goal:** Make GhostLink resilient to provider policy, auth, and transport changes. Give operators real-time visibility into cost and the ability to cap it.
**Rough effort:** 2 weeks

### Why this comes now
- Phase 3 gives us the operator control plane. Cost and provider surfaces plug directly into it.
- Multi-agent execution (Phase 5) will multiply token spend. Cost controls must exist before parallel agents ship.
- Provider fragility is a live risk: any single provider can change auth, rate limits, or policies at any time. Transport abstraction turns that from a crisis into a switchover.

### Dependencies
- Budget enforcement must integrate with the policy engine from Phase 4A. Budget exhaustion triggers the same policy response as a blocked action.
- Failover/routing events must emit trace/audit events compatible with Phase 3 and Phase 3.5. Every provider switch, failover, and routing decision must be traceable and replayable.

### Deliverables

#### 4B.1: Transport abstraction layer
- Define a `Transport` interface with four modes: `api`, `cli`, `local_model`, `mcp`.
- Each provider registers one or more transports in priority order.
- Each transport declares capability flags: `streaming`, `function_calling`, `vision`, `caching`, `tool_use`.
- Failover: if the active transport fails, the system tries the next registered transport for that provider. If all transports for a provider fail, the system tries the next provider in the routing table (see 4B.6).
- Failover events are logged and surfaced in the operator control plane.

#### 4B.2: Provider request overrides
- Per-provider configuration for: custom HTTP headers, auth tokens, proxy URL, TLS certificate path, base URL override.
- Stored in provider config, not hardcoded. Operator can edit via settings UI.
- Use case: enterprise proxies, self-hosted model endpoints, provider-specific auth quirks.

#### 4B.3: Prompt cache optimization
- Deterministic tool ordering: sort tool definitions by name before injection so the same tool set always produces the same prompt prefix.
- Normalized system-prompt fingerprints: hash the effective system prompt. If the hash matches the previous call, skip re-serialization.
- Cache-aware message history: when building the message array, preserve the prefix that was cached on the previous call. Only append new messages.
- Track cache hit/miss per provider per call. Expose in diagnostics (feeds into Phase 6 prompt cache diagnostics UI).

#### 4B.4: Provider registry expansion
- Add providers: Amazon Bedrock, Kimi/Moonshot, Z.AI/GLM, BytePlus/Volcengine.
- Stash (available but not actively tested): Qwen, Fireworks, StepFun, MiniMax.
- Each new provider must implement the `Transport` interface and declare capability flags.
- Each new provider must have at least one passing integration test before merge.

#### 4B.5: Per-agent cost tracking and budgets
- Track per agent per session: input tokens, output tokens, cache read tokens, cache write tokens, estimated cost (using provider pricing tables).
- Persist cost data across sessions. Aggregate by agent, by provider, by day.
- Budget limits: operator sets a per-agent budget (tokens or dollars). System emits warning at 80% and hard-stops at 100%.
- Budget enforcement happens in the transport layer before the request is sent. No post-hoc enforcement.
- Budget enforcement integrates with the Phase 4A policy engine: budget exhaustion triggers the same policy response pathway as a blocked action.
- Cost data feeds into the Phase 3 operator dashboard.

#### 4B.6: Model routing
- Routing rules: operator defines rules that map task complexity to model tier.
  - Example: `simple_edit -> gpt-4.1-mini`, `architecture -> claude-opus-4-5`, `code_review -> gemini-2.5-pro`.
- Complexity estimation: use heuristic signals (message length, number of files referenced, tool count, explicit user flag).
- Routing is a suggestion layer, not a hard constraint. Operator can override per task.
- Default routing table ships with sensible defaults. Operator can customize.
- Routing decisions emit trace/audit events compatible with Phase 3 and Phase 3.5 tracing.

#### 4B.7: Policy-risk flags per provider
- Each provider record includes: `auth_method` (api_key, cli_auth, oauth, local), `usage_policy_flags` (rate_limited, content_filtered, data_retention, geographic_restriction), `degraded_mode_behavior` (what happens when this provider is down).
- Flag providers that require API keys versus CLI auth versus local execution.
- Flag providers with usage policies that could affect automation (content filtering, rate limits that could throttle multi-agent workloads).
- Surface policy-risk flags in the operator provider management UI.

### Agent assignments

#### `jeff`
- Write the `Transport` interface spec with exact method signatures, capability flag enum, and failover state machine.
- Write the routing rules schema and complexity estimation heuristic.
- Define the cost tracking data model and budget enforcement contract.
- Define how budget enforcement integrates with the Phase 4A policy engine.
- Define how failover/routing events emit trace/audit events for Phase 3/3.5 compatibility.
- Define rollback path: if the transport abstraction breaks an existing provider, the system must be able to fall back to the current direct-call path.

#### `coop`
- Own the provider capability matrix: for each provider, document which transports exist, which capability flags are true, and what policy risks apply.
- Evaluate provider pricing tables for cost tracking accuracy.
- Make adopt/adapt/reject decisions on model routing patterns from PearAI Router, Cursor multi-model routing, and Mastra's 94-provider model (reference [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Themes 5 and 13).

#### `kurt`
- Write provider failure scenario tests: single transport failure, all transports for a provider fail, provider timeout, auth expiry mid-session, rate limit hit, budget exceeded mid-request.
- Write cost tracking accuracy tests: verify token counts match provider response headers, verify budget enforcement fires before the request, verify cost aggregation across sessions.
- Write cache optimization tests: verify deterministic tool ordering produces identical prompt prefixes, verify cache hit rate improves with the optimization.
- Write trace/audit emission tests: verify failover and routing events produce correct trace/audit records.

#### `tyson`
- Implement the `Transport` interface and refactor existing providers to use it.
- Implement provider request overrides in provider config.
- Implement prompt cache optimization (deterministic ordering, fingerprinting, cache-aware history).
- Implement provider registry expansion (Bedrock, Kimi, GLM, BytePlus + stashed providers).
- Implement per-agent cost tracking, budget enforcement, and cost persistence.
- Implement budget-to-policy-engine integration.
- Implement model routing engine and default routing table.
- Implement policy-risk flag storage and provider record schema.
- Implement trace/audit event emission for failover and routing decisions.

#### `ned`
- Implement cost dashboard in operator control plane: per-agent cost breakdown, session cost, daily/weekly aggregates, budget usage bars.
- Implement provider management UI: transport status, capability flags, policy-risk flags, failover log.
- Implement model routing configuration UI: rule editor, complexity tier mapping, override controls.
- Implement budget configuration UI: per-agent budget setting, alert thresholds.

### Primary file ownership
- `tyson`
  - `backend/providers.py` (transport abstraction, provider registry)
  - `backend/mcp_bridge.py` (MCP transport mode)
  - `backend/wrapper.py` (cost tracking injection, routing integration)
  - `backend/routes/misc.py` (cost and provider API endpoints)
  - new `backend/cost.py` (cost tracking engine, budget enforcement, policy integration)
  - new `backend/routing.py` (model routing engine)
  - backend tests for all of the above
- `ned`
  - new `frontend/src/components/CostDashboard.tsx`
  - new `frontend/src/components/ProviderManager.tsx`
  - new `frontend/src/components/RoutingConfig.tsx`
  - integration into existing operator dashboard surfaces

### Rollback considerations
- The transport abstraction is the highest-risk item. If it breaks existing provider calls, `tyson` must be able to revert to direct-call paths per provider without losing the new providers.
- Cost tracking is additive and low-risk. Budget enforcement is higher-risk: a bug could block all requests. Budget enforcement must have a bypass flag for emergencies.
- Model routing is a suggestion layer and can be disabled without breaking anything.

### Exit gate
- All existing providers pass their integration tests through the new transport abstraction.
- At least two new providers from 4B.4 pass integration tests.
- Cost tracking produces accurate token counts for at least three providers (verified against provider response headers).
- Budget enforcement blocks a request when the budget is exceeded.
- Budget enforcement triggers the policy engine pathway correctly.
- Prompt cache hit rate is measurable and displayed in diagnostics.
- Failover from one transport to another completes without operator intervention.
- Failover and routing events produce correct trace/audit records compatible with Phase 3/3.5.
- Model routing routes a simple task to a cheap model and a complex task to an expensive model using default rules.

---

## Phase 4.5 - Evals And Trace Grading

**Type:** hardening
**Goal:** Turn traces into measurable quality gates. Ensure that provider, skill, profile, and agent changes can be scored against a baseline before release.
**Rough effort:** 1-2 weeks

### Why this comes now
- Phase 3/3.5 gave us tracing and durable execution. Phase 4A gave us policy enforcement. Phase 4B gave us provider abstraction and cost tracking.
- Without evals, there is no way to know whether a new provider, skill, or profile change makes things better or worse. Changes land and regressions are discovered by operators, not by the system.
- Evals must exist before Phase 5 scales out multi-agent execution, where the blast radius of a silent regression multiplies.

### Deliverables
- golden task corpus: a curated set of tasks with known-correct outputs that serve as the regression baseline
- regression suite across providers, models, profiles, and agent types
- trace graders for: correctness (did the agent produce the right output), safety (did the agent respect policy and sandbox boundaries), cost (was token spend reasonable), latency (was execution time acceptable), unnecessary tool use (did the agent call tools it did not need)
- benchmark dashboards: per-provider, per-model, per-profile scores over time
- release gates for providers, skills, hooks, and agent profiles: a change cannot merge if it regresses scores below threshold
- "no silent regression" merge criteria for core orchestration paths

### Agent assignments

#### `jeff`
- Write the eval framework spec: task corpus schema, grading criteria definitions, scoring formula, threshold configuration.
- Define what constitutes a golden task: input, expected output, grading rubric, acceptable variance.
- Define the release gate contract: which scores must pass, what threshold triggers a block, how overrides work.

#### `coop`
- Compare against OpenAI trace grading, LangSmith evaluation framework, and Braintrust patterns.
- Make adopt/adapt/reject decisions on grading criteria and benchmark visualization.
- Evaluate whether GhostLink needs custom graders beyond the standard set or if the standard set is sufficient for launch.

#### `kurt`
- Build and maintain the golden task corpus: initial set of 20+ tasks across file editing, code generation, tool use, delegation, and multi-step workflows.
- Write grading tests: verify that a known-good trace scores above threshold, verify that a known-bad trace scores below threshold.
- Write regression detection tests: introduce a deliberate regression and verify the system catches it before merge.
- Own the regression suite as a living artifact that grows with each phase.

#### `tyson`
- Implement the eval runner: accept a task corpus, execute each task, collect traces.
- Implement the trace grading engine: apply graders to traces, produce scores per dimension.
- Implement benchmark storage: persist scores over time with metadata (provider, model, profile, commit hash).
- Implement release gate checks: integrate with CI or pre-merge flow to block regressions.

#### `ned`
- Implement the benchmark dashboard UI: per-provider and per-model score charts over time, regression alerts, drill-down into individual task results.
- Implement the release gate status display: which gates are passing, which are failing, what changed.

### Primary file ownership
- `tyson`
  - new `backend/evals.py` (eval runner, trace grading engine, benchmark storage)
  - new `backend/routes/evals.py` (eval API endpoints, release gate status)
  - backend tests for eval runner and grading engine
- `ned`
  - new frontend benchmark dashboard and release gate status surfaces
- `kurt`
  - `test/golden/` corpus files (golden tasks, expected outputs, grading rubrics)

### Exit gate
- new provider/skill/profile changes can be scored against the golden task baseline
- regressions are visible before release
- trace grading can flag high-cost low-value runs
- at least 20 golden tasks exist and pass against the current baseline
- a deliberate regression is caught by the release gate before merge

---

## Phase 5 - Multi-Agent Execution

**Type:** new capability
**Goal:** Enable parallel agent work with isolation, background execution, structured lifecycle hooks, and competitive/collaborative workflows.
**Rough effort:** 2-3 weeks

### Why this comes now
- This phase only makes sense after stable identity, profiles, the control plane, durable execution, policy, provider controls, and evals are all actually landed.
- Audit note: as of 2026-04-07 those prerequisites are **not** fully implemented yet. Treat Phase 5 as a later-phase design target, not a claim that the foundation is already present.
- Without worktree isolation, parallel agents overwrite each other's files. Without cost controls, parallel agents burn budget unchecked. Without the control plane, there is no way to monitor parallel work. Without durable execution, background tasks cannot recover from crashes. Without policy, autonomous agents cannot be governed. Without evals, regressions from multi-agent execution go undetected.

### Prerequisites
- No background agent execution without Phase 3.5 (durable execution): background tasks must be resumable after crashes.
- No broad async/arena execution without Phase 4A (policy) and Phase 4.5 (evals): autonomous execution requires governance and measurable quality.
- Worktree isolation stays in this phase.
- Collaboration patterns should use artifact lineage from Phase 3.5, not ad hoc task notes.

### Deliverables

#### 5.1: Per-agent Git worktree isolation
- When an agent is assigned a task that involves file modifications, the system creates a Git worktree for that agent: `git worktree add .ghostlink/worktrees/<agent-id> -b ghostlink/<agent-id>/<task-id>`.
- Each agent reads and writes only within its own worktree. The main working tree is never modified by background agents.
- When the agent completes its task, the operator reviews the diff and merges the branch back to the main working tree (or discards it).
- Worktree lifecycle: create on task start, persist during task, cleanup on merge/discard. Stale worktrees (no activity for configurable timeout) are flagged for operator attention.
- Worktree status is visible in the operator control plane: which agents have active worktrees, what branches exist, merge readiness.

#### 5.2: Background/async agent execution
- Agents can execute tasks in the background while the operator interacts with other agents or does other work.
- Background task lifecycle: `queued -> running -> completed | failed | cancelled`.
- Background tasks integrate with Phase 3.5 durable execution: checkpoints are created during background execution, and crashed background tasks resume from the last checkpoint.
- Progress updates: background agents emit structured progress events (percentage, current step description, files modified so far). These appear in the Phase 3 task dashboard.
- Notification: when a background task completes or fails, the operator gets a notification (in-app notification center, system tray notification on desktop).
- The operator can inspect a background agent's work at any time without interrupting it.
- The operator can cancel a background task. Cancellation is graceful: the agent finishes its current tool call, then stops.

#### 5.3: Lifecycle hooks
- Mandatory checks that run regardless of model behavior. The model cannot skip or override hooks.
- Hook points: `pre_tool_use`, `post_tool_use`, `pre_send`, `post_receive`, `session_start`, `session_end`, `pre_delegation`, `post_delegation`.
- Hook configuration: operator defines hooks as shell commands, Python scripts, or inline rules. Each hook has: trigger point, command, timeout, failure behavior (block, warn, log).
- Failure behavior: if a `block`-type hook fails, the action is prevented and the operator is notified. If a `warn`-type hook fails, the action proceeds but the operator sees a warning. If a `log`-type hook fails, the event is logged silently.
- Built-in hooks ship with the system: file-size limit check on `pre_tool_use` for write operations, cost check on `pre_send`, secrets scan on `post_tool_use` for file writes.
- Hook execution is synchronous and blocking for `block`-type hooks. Async for `log`-type hooks.
- Hook trust and signing integrates with Phase 4A policy: only signed or trusted hooks can run as `block`-type.
- Based on Claude Code's 14+ hook system. Reference [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Theme 1 and Theme 16.

#### 5.4: AGENTS.md deep support
- Import `AGENTS.md` from the workspace root and any subdirectories (nearest file wins in monorepos, matching the cross-tool standard).
- `AGENTS.md` content is ingested as an overlay layer in the Phase 2 rules architecture: `system policy > workspace policy > AGENTS.md overlay > user memory > task memory`.
- `AGENTS.md` is never the source of truth for identity or runtime behavior. It is guidance that gets layered.
- Parse standard `AGENTS.md` sections: role descriptions, coding conventions, testing requirements, file structure guidelines.
- Show effective `AGENTS.md` contribution in the operator's effective-state view.
- Compatible with 60K+ repos that already have `AGENTS.md` files.

#### 5.5: Arena/competition mode
- Operator triggers arena mode: same task is dispatched to N agents (2-8), each in its own isolated worktree.
- Each agent works independently. No inter-agent communication during arena execution.
- Arena execution requires Phase 4A policy approval and Phase 4.5 eval scoring: arena results are graded against the eval framework.
- When all agents finish (or timeout), the operator sees a comparison view: side-by-side diffs, token cost per agent, time taken, test results if applicable, eval scores.
- Operator picks the best output. The winning branch is merged, losers are discarded.
- Arena mode respects per-agent budgets from Phase 4B. If an agent hits its budget, it stops and its partial output is included in comparison.
- Based on Grok Build Arena and Cursor `/best-of-n`. Reference [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Theme 1 and Theme 3.

#### 5.6: Spec-driven development workflow
- Operator writes a structured spec: title, description, acceptance criteria (checkboxes), file scope, constraints.
- Spec is stored as a first-class object in the backend. Linked to a task and optionally to a worktree.
- Agent receives the spec as part of its task context. Agent reports progress against spec items (which acceptance criteria are met, which are pending).
- Progress against spec items is visible in the operator dashboard.
- Spec format is Markdown-based so operators can write specs in any editor.
- Based on GitHub Spec Kit and Augment Intent. Reference [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Theme 7.

#### 5.7: Agent collaboration patterns
- Supervisor pattern: one agent coordinates N worker agents. Supervisor decides task decomposition, assigns subtasks, aggregates results. Workers report to supervisor only.
- Pub-sub message pool: agents publish structured messages to a shared pool. Other agents subscribe to message types they care about. Messages are namespaced by task/workspace. Based on MetaGPT's shared message pool.
- Hierarchical authority: agents have authority levels. A higher-authority agent can override a lower-authority agent's output. Authority is configured in agent profiles (Phase 2).
- Collaboration patterns use artifact lineage from Phase 3.5 for provenance tracking, not ad hoc task notes.
- `coop` decides which patterns to adopt, adapt, or reject based on GhostLink's architecture and the patterns documented in the platform survey (CrewAI, MetaGPT, Mastra).
- Initial implementation: supervisor pattern only. Pub-sub and hierarchical authority are designed but deferred to a later iteration unless `coop` recommends otherwise.

### Agent assignments

#### `jeff`
- Write the worktree lifecycle spec: creation, isolation enforcement, merge flow, cleanup, stale detection.
- Write the background execution spec: task state machine, progress event schema, cancellation protocol, notification contract, checkpoint integration with Phase 3.5.
- Write the hooks spec: hook point definitions, configuration schema, execution model, failure behavior matrix, built-in hooks list, trust/signing integration with Phase 4A.
- Write the arena spec: dispatch flow, comparison data model, merge/discard protocol, budget integration, eval scoring integration.
- Write the spec-driven development spec: spec schema, progress tracking model, agent-spec binding.
- Write the collaboration patterns spec: supervisor dispatch model, message pool schema, authority levels, artifact lineage integration with Phase 3.5.
- Define rollback paths for each sub-deliverable.

#### `coop`
- Evaluate collaboration patterns from CrewAI, MetaGPT, Mastra, and AutoGen. Make adopt/adapt/reject decisions for each. Reference [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Theme 3.
- Evaluate arena mode UX against Grok Build and Cursor `/best-of-n`. Decide comparison view layout and merge UX.
- Evaluate spec-driven development against GitHub Spec Kit and Augment Intent. Decide spec format and progress UX.
- Evaluate hook system against Claude Code's 14+ hooks. Decide which hook points GhostLink needs and which are overkill.

#### `kurt`
- Write stress tests for parallel agents: 5 agents in parallel worktrees, concurrent file operations, worktree creation/cleanup under load.
- Write isolation tests: verify an agent in worktree A cannot read or write files in worktree B or the main working tree.
- Write background execution tests: task lifecycle state transitions, cancellation mid-operation, notification delivery, checkpoint-based crash recovery.
- Write hook tests: block-type hook prevents action, warn-type hook allows action with warning, hook timeout behavior, hook failure cascading, trust/signing enforcement.
- Write arena tests: all agents finish, some agents timeout, budget-limited agent produces partial output, merge conflict in winning branch, eval scores appear in comparison.

#### `tyson`
- Implement worktree manager: creation, branch naming, cleanup, stale detection.
- Implement background task executor: state machine, progress event emission, graceful cancellation, checkpoint integration.
- Implement hooks engine: hook registration, execution, timeout, failure handling, built-in hooks, trust/signing verification via Phase 4A.
- Implement `AGENTS.md` parser and rules-layer integration.
- Implement arena dispatcher: multi-agent task dispatch, result collection, comparison data assembly, eval scoring integration.
- Implement spec storage and progress tracking backend.
- Implement supervisor collaboration pattern with artifact lineage integration.

#### `ned`
- Implement worktree status panel in operator dashboard: active worktrees, branches, merge/discard controls.
- Implement background task UI: progress bars, step descriptions, notification center, cancel button.
- Implement hooks configuration UI: hook list, trigger point selection, command editor, failure behavior selector.
- Implement arena comparison view: side-by-side diffs, cost comparison, time comparison, eval scores, merge/discard buttons.
- Implement spec editor and progress tracker UI.
- Implement `AGENTS.md` effective-state contribution display.

### Primary file ownership
- `tyson`
  - new `backend/worktree.py` (worktree lifecycle manager)
  - new `backend/hooks.py` (hooks engine)
  - new `backend/arena.py` (arena dispatcher)
  - new `backend/specs.py` (spec storage and progress)
  - `backend/wrapper.py` (background execution, hook integration)
  - `backend/registry.py` (collaboration patterns, authority levels)
  - `backend/mcp_bridge.py` (hook injection into tool calls)
  - `backend/routes/agents.py` (arena, spec, worktree endpoints)
  - backend tests for all of the above
- `ned`
  - new `frontend/src/components/WorktreePanel.tsx`
  - new `frontend/src/components/ArenaView.tsx`
  - new `frontend/src/components/SpecEditor.tsx`
  - new `frontend/src/components/HooksConfig.tsx`
  - new `frontend/src/components/NotificationCenter.tsx`
  - integration into existing operator dashboard and task surfaces

### Rollback considerations
- Worktree isolation is the highest-risk item. If worktree creation fails (disk space, git version incompatibility, permission issues), the system must fall back to single-worktree mode with a clear operator warning. Single-worktree mode means only one agent modifies files at a time.
- Hooks engine must never crash the main process. Hook execution failures must be caught and reported, never propagated as unhandled exceptions.
- Arena mode is purely additive. Disabling it has no effect on normal operation.
- Background execution failure must not leave orphaned processes or zombie worktrees. The background executor must have a cleanup path for every failure state.

### Exit gate
- Two agents working in parallel worktrees produce independent diffs that can be merged without conflict (given non-overlapping file scopes).
- A background task completes and the operator receives a notification.
- A background task is cancelled and the agent stops gracefully within 10 seconds.
- A crashed background task resumes from the last checkpoint without losing identity or state.
- A `block`-type hook prevents a file write that exceeds the size limit.
- Arena mode with 3 agents produces a comparison view with diffs, costs, eval scores, and merge controls.
- A spec with 5 acceptance criteria shows accurate progress tracking as an agent completes each item.
- `AGENTS.md` from a test repo is correctly parsed and layered into effective state without overriding system policy.

---

## Phase 6 - Memory And Intelligence

**Type:** new capability
**Goal:** Give agents persistent, stratified memory that survives long sessions, compaction, delegation, and fresh spawns. Give operators visibility into memory health and cache efficiency.
**Rough effort:** 2-3 weeks

### Why this comes now
- Phase 1B established identity memory and reinjection. Phase 2 established the layering model. Phase 5 established multi-agent execution.
- Full memory stratification builds on all of these. Without stable identity, memory has no owner. Without layering, memory has no precedence rules. Without multi-agent execution, cross-agent memory coordination has nothing to coordinate.

### Deliverables

#### 6.1: Full memory stratification
- Four memory layers, extending Phase 1B's identity memory:
  1. **Identity layer** (never evict): agent role, personality, core instructions, capability declarations. Set at spawn, reinjected at every boundary. This is Phase 1B's identity memory, unchanged.
  2. **Workspace layer** (slow decay): project-level knowledge -- architecture patterns, key file locations, dependency relationships, build instructions. Persists across sessions. Evicted only when explicitly invalidated or when workspace context changes.
  3. **Session layer** (fast decay): current task context, recent tool call results, conversation state. Evicted at session end or compaction.
  4. **Promoted summaries** (dreaming): at session end or compaction, the system generates a summary of the session's key decisions and outcomes. Summaries are promoted from session layer to workspace layer if they meet relevance thresholds. This is the "dreaming" mechanism -- learning happens between sessions.
- Each memory item has metadata: layer, created_at, last_accessed, access_count, importance_score, tags, source_agent_id.
- Memory budget: each layer has a token budget. When a layer exceeds its budget, the lowest-scored items are evicted first.

#### 6.2: Selective identity reinforcement
- Identity is reinjected at key boundaries (extending Phase 1B's reinjection):
  - Compaction events
  - Session resume
  - Delegation (when an agent hands off to another)
  - Task boundary transitions
  - Context budget threshold (when total context exceeds N% of model's context window, re-anchor identity)
- Reinforcement is selective: only inject the identity components that are at risk of being pushed out of context. Use the identity layer's importance scores to decide what to reinforce.
- Track identity drift: compare the agent's recent behavior against its identity profile. Flag divergence for operator review.

#### 6.3: Weighted recall and tagging
- Relevance scoring for memory recall: combine recency (time since last access), frequency (access count), and explicit importance (operator or agent-assigned weight).
- Scoring formula is configurable. Default: `score = 0.4 * recency + 0.3 * frequency + 0.3 * importance`.
- Tags: memory items can be tagged with categories (architecture, dependency, pattern, decision, bug, convention). Tags are used for filtered retrieval.
- Recall API: agents request memory by query string and optional tag filter. The system returns the top-N items by relevance score.

#### 6.4: Observational memory
- The system observes developer and agent usage patterns without explicit instruction:
  - Tool preferences: which tools does the operator/agent use most? Which tools are never used?
  - Code style: indentation, naming conventions, import ordering, comment style.
  - Review patterns: what kinds of changes does the operator frequently request revisions on?
  - Workflow patterns: typical task sequences, preferred agent assignments.
- Observations are stored as workspace-layer memory items with a special `observational` tag.
- Observations have lower importance scores by default (they are inferred, not explicit). Their scores increase with repeated confirmation.
- Operator can review, confirm, or delete observational memories.
- Based on Mastra's observational memory system. Reference [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Theme 2.

#### 6.5: Cross-agent memory coordination
- Shared workspace memory pool: all agents in a workspace can read from the workspace memory layer.
- Write isolation: each agent writes to its own namespace within the workspace layer. Namespace format: `workspace/<workspace-id>/agent/<agent-id>/`.
- Promotion: an agent can propose a memory item for promotion to the shared workspace namespace. The operator (or a supervisor agent) approves or rejects.
- Conflict detection: if two agents write conflicting information to similar tags, the system flags the conflict for operator resolution.
- Memory coordination is read-heavy, write-light. The coordination protocol must not block agent execution.

#### 6.6: Prompt cache diagnostics
- Cache hit/miss tracking per provider per session. Metrics: hit rate, miss rate, estimated cost savings from cache hits.
- Cache efficiency dashboard in the operator UI: per-provider cache hit rate over time, cost savings chart, cache miss reasons (prompt changed, cache expired, new session).
- Correlation with Phase 4B's prompt cache optimization: show whether deterministic tool ordering and fingerprinting are improving hit rates.
- Alert when cache hit rate drops below a configurable threshold.

### Agent assignments

#### `jeff`
- Write the full memory stratification spec: layer definitions, metadata schema, eviction algorithm, promotion rules, token budget model.
- Write the identity reinforcement spec: boundary detection, selective injection algorithm, drift detection heuristic.
- Write the recall API spec: query interface, scoring formula, tag taxonomy, result format.
- Write the observational memory spec: observation types, scoring model, confirmation workflow.
- Write the cross-agent coordination spec: namespace schema, promotion protocol, conflict detection rules.

#### `coop`
- Evaluate GhostLink's memory model against LangGraph checkpointing, CrewAI shared message pool, Mastra observational memory, and Windsurf proactive memory. Make adopt/adapt/reject decisions. Reference [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Theme 2.
- Evaluate the "dreaming" promotion mechanism: is session-end summarization the right trigger? Are there better approaches from the research?
- Decide the default scoring formula weights and tag taxonomy.

#### `kurt`
- Write memory persistence tests: restart the server, verify all layers survive with correct metadata.
- Write eviction tests: fill a layer to budget, verify lowest-scored items are evicted first, verify identity layer is never evicted.
- Write corruption tests: inject malformed memory items, verify the system rejects them gracefully.
- Write cross-agent coordination tests: two agents write to the same tag, verify conflict detection fires. Agent reads from another agent's namespace, verify access is read-only.
- Write identity drift tests: simulate an agent that diverges from its identity profile, verify drift is flagged.
- Write cache diagnostics accuracy tests: verify hit/miss counts match actual provider cache behavior.

#### `tyson`
- Implement the four-layer memory store with metadata and eviction.
- Implement selective identity reinforcement with boundary detection.
- Implement the recall API with weighted scoring and tag-based filtering.
- Implement observational memory capture and storage.
- Implement cross-agent memory coordination: namespaced writes, shared reads, promotion, conflict detection.
- Implement prompt cache diagnostics collection and aggregation.

#### `ned`
- Implement memory inspector UI: browse memory items by layer, view metadata, edit importance scores, delete items, review observational memories.
- Implement identity drift indicator in agent status display.
- Implement prompt cache diagnostics dashboard: hit rate charts, cost savings, per-provider breakdown, alert configuration.
- Implement cross-agent memory conflict resolution UI.

### Primary file ownership
- `tyson`
  - `backend/agent_memory.py` (memory stratification, eviction, recall, observational capture)
  - `backend/mcp_bridge.py` (identity reinforcement injection)
  - `backend/wrapper.py` (boundary detection, drift tracking)
  - `backend/routes/agents.py` (memory and diagnostics API endpoints)
  - new `backend/memory_coordination.py` (cross-agent namespace, promotion, conflict detection)
  - backend tests for all of the above
- `ned`
  - new `frontend/src/components/MemoryInspector.tsx`
  - new `frontend/src/components/CacheDiagnostics.tsx`
  - integration into existing agent info and operator dashboard surfaces

### Rollback considerations
- Memory stratification extends the existing `agent_memory.py`. If the new layer model causes data issues, `tyson` must be able to revert to the Phase 1B memory model without losing existing identity memory.
- Observational memory is purely additive. Disabling it has no effect on explicit memory.
- Cross-agent coordination is the highest-risk item for race conditions. If coordination causes performance issues, it can be disabled per workspace without breaking single-agent memory.
- Cache diagnostics is read-only instrumentation. Zero risk to core functionality.

### Exit gate
- Memory items in the identity layer survive server restart and session compaction.
- Workspace layer items persist across sessions and are accessible to all agents in the workspace (read-only from other agents' namespaces).
- Session layer items are evicted at session end.
- Promoted summaries appear in the workspace layer after session end with correct metadata.
- Eviction removes the lowest-scored items first and never touches identity layer items.
- Observational memory captures at least one tool preference and one code style observation during a test session.
- Two agents write conflicting information and the conflict is detected and surfaced to the operator.
- Cache diagnostics dashboard shows accurate hit/miss rates for at least two providers.

---

## Phase 7 - Media Generation

**Type:** new capability
**Goal:** Add video, music, and enhanced image generation as MCP tools with inline rendering in chat.
**Rough effort:** 1-2 weeks

### Why this comes now
- The MCP bridge, transport abstraction, and cost tracking are all in place. Media generation tools plug into the existing MCP tool infrastructure.
- This is a lower-risk phase that adds visible product value. Good pacing after the heavier Phases 5 and 6.

### Deliverables

#### 7.1: Video generation MCP tool
- MCP tool `generate_video`: accepts a text prompt and optional parameters (duration, aspect ratio, style).
- Routes to available video providers: Google Veo, xAI. Provider selection follows the Phase 4B routing and failover model.
- Async task tracking: video generation is long-running (30s-5min). The tool returns a task ID immediately. The agent polls for completion or receives a webhook callback.
- Task status and progress appear in the Phase 3 task dashboard.
- Inline rendering: when the video is ready, it appears inline in the chat as a playable video element with download link.
- Cost tracking: video generation cost is tracked per agent per session (Phase 4B cost engine).

#### 7.2: Music generation MCP tool
- MCP tool `generate_music`: accepts a text prompt and optional parameters (duration, genre, mood, tempo).
- Routes to available music providers: MiniMax or other providers as they become available.
- Same async task tracking pattern as video generation.
- Inline rendering: audio player element inline in chat with playback controls and download link.
- Cost tracking per agent per session.

#### 7.3: Enhanced image generation
- Expand existing image generation tool with additional providers: Stability AI, Midjourney API (when available).
- Add image editing capabilities: inpainting (modify a region of an existing image), outpainting (extend an image), style transfer.
- Image editing accepts a source image (uploaded or from a previous generation) plus a text prompt describing the edit.
- Inline rendering: generated and edited images appear inline in chat with full-size view and download link.

### Agent assignments

#### `jeff`
- Write the MCP tool spec for `generate_video` and `generate_music`: parameter schemas, response format, async lifecycle, error states.
- Write the image editing spec: inpainting/outpainting parameter schema, source image handling, provider routing.

#### `coop`
- Evaluate video generation providers: quality, cost, latency, API maturity. Recommend priority order.
- Evaluate music generation providers: same criteria. Recommend primary provider.
- Evaluate image editing providers: Stability AI vs others for inpainting/outpainting quality.

#### `kurt`
- Write async delivery tests: tool returns task ID, poll returns progress, completion returns media URL, timeout produces error.
- Write inline rendering tests: video player loads and plays, audio player loads and plays, image renders at correct resolution.
- Write cost tracking tests for media generation: verify token/cost tracking includes media generation costs.

#### `tyson`
- Implement `generate_video` MCP tool with provider routing and async tracking.
- Implement `generate_music` MCP tool with provider routing and async tracking.
- Expand image generation tool with new providers and editing capabilities.
- Integrate media generation costs into the Phase 4B cost engine.

#### `ned`
- Implement inline video player component for chat rendering.
- Implement inline audio player component for chat rendering.
- Implement image editing UI: source image selection, edit prompt input, result preview.
- Implement media task progress indicators in chat and task dashboard.

### Primary file ownership
- `tyson`
  - `backend/mcp_bridge.py` (new MCP tools, provider routing for media)
  - `backend/providers.py` (media provider registration)
  - backend tests for media generation tools
- `ned`
  - new `frontend/src/components/VideoPlayer.tsx`
  - new `frontend/src/components/AudioPlayer.tsx`
  - `frontend/src/components/ChatMessage.tsx` or equivalent (inline media rendering)
  - media-related chat rendering integration

### Rollback considerations
- Media generation tools are purely additive MCP tools. Removing them has no effect on existing functionality.
- If a media provider's API is unstable, the tool should return a clear error rather than crashing. Graceful degradation: if no video/music provider is configured, the tool responds with "no provider available" instead of failing silently.

### Exit gate
- `generate_video` returns a playable video inline in chat for at least one provider.
- `generate_music` returns playable audio inline in chat for at least one provider.
- Image editing (inpainting) modifies a region of an existing image and renders the result inline.
- Media generation costs appear in the per-agent cost dashboard.
- Async task tracking shows progress for a media generation task in the task dashboard.

---

## Phase 8 - A2A Interoperability

**Type:** new capability
**Goal:** Make GhostLink both an A2A client and server, enabling cross-platform agent-to-agent communication.
**Rough effort:** 2-3 weeks

### Why this comes now
- Phase 1A established identity records. Phase 3/3.5 established tracing and durable execution. Phase 4A established policy. Phase 5 established multi-agent execution patterns.
- A2A interoperability extends GhostLink's multi-agent model beyond its own boundary. Without stable identity, there is no way to map GhostLink agents to A2A agent cards. Without tracing, cross-platform agent interactions are opaque. Without policy, inbound A2A requests cannot be governed.

### Deliverables
- A2A client support: discover and call remote A2A agents from within GhostLink
- A2A server surface: expose local GhostLink agents over A2A so external platforms can discover and call them
- `/.well-known/agent-card.json` publication: GhostLink generates and serves agent cards for each exposed agent
- discovery and registry strategy: how GhostLink finds remote A2A agents (static config, well-known URL probing, registry lookup)
- SSE task streaming between agents: long-running A2A tasks stream progress updates over SSE
- push notifications for disconnected/long-running tasks: A2A tasks that outlive the connection use push notification callbacks
- auth and signature model for agent cards and notifications: agent cards are signed, notification endpoints are authenticated, inbound A2A requests are validated against policy
- conformance/TCK plan: verify GhostLink's A2A implementation against the A2A specification test compatibility kit
- mapping between GhostLink identity/task/artifact model and A2A `contextId`/`taskId`: GhostLink's internal identity records, task IDs, and artifact namespaces map cleanly to A2A protocol fields

### Agent assignments

#### `jeff`
- Write the A2A integration architecture: client flow, server flow, agent card schema, task lifecycle mapping.
- Write the identity mapping spec: how GhostLink `agent_id`, `task_id`, `trace_id`, and `artifact_namespace` map to A2A `contextId`, `taskId`, and agent card fields.
- Write the auth/signature spec: agent card signing format, notification endpoint authentication, inbound request validation.
- Define rollback path: if A2A integration causes stability issues, A2A surfaces can be disabled without affecting local agent functionality.

#### `coop`
- Evaluate A2A ecosystem adoption: which platforms support A2A, what is the maturity level, what are the interoperability gaps.
- Evaluate discovery strategy: static config vs well-known probing vs registry. Recommend the approach that balances simplicity with discoverability.
- Evaluate how A2A fits into GhostLink's competitive position: is this a differentiator or table stakes?

#### `kurt`
- Write conformance tests: verify GhostLink's A2A client and server implementations pass the A2A TCK.
- Write auth/security tests: verify that unsigned agent cards are rejected, that notification endpoints validate authentication, that inbound A2A requests are checked against policy.
- Write identity mapping tests: verify that GhostLink identity records map correctly to A2A fields and back.
- Write streaming tests: verify SSE task streaming works for long-running cross-platform tasks.

#### `tyson`
- Implement A2A client: agent card discovery, remote agent invocation, response handling.
- Implement A2A server: agent card generation and serving, inbound task handling, response formatting.
- Implement SSE streaming for A2A task progress.
- Implement push notification callbacks for disconnected tasks.
- Implement identity/task/artifact mapping between GhostLink and A2A models.
- Implement auth and signature verification for agent cards and notifications.

#### `ned`
- Implement A2A discovery UI: browse discovered remote agents, view agent cards, invoke remote agents.
- Implement A2A status display: which local agents are exposed over A2A, connection status, active cross-platform tasks.
- Implement A2A task progress display: streamed progress for inbound and outbound A2A tasks.

### Primary file ownership
- `tyson`
  - `backend/a2a_bridge.py` (A2A client/server, agent card generation, SSE streaming, push notifications)
  - new `backend/routes/a2a.py` (A2A API endpoints, agent card serving, well-known endpoint)
  - backend tests for A2A client, server, streaming, auth, and identity mapping
- `ned`
  - new frontend A2A discovery, status, and task progress surfaces

### Rollback considerations
- A2A client and server are additive capabilities. Disabling them has no effect on local agent functionality.
- If A2A specification changes significantly, the mapping layer isolates GhostLink internals from protocol changes.
- Auth/signature verification is the highest-risk item for blocking legitimate cross-platform communication. Must have clear error messages when verification fails.

### Exit gate
- GhostLink can discover and call a remote A2A agent
- GhostLink can expose a local agent over A2A with a valid agent card at `/.well-known/agent-card.json`
- streamed and long-running tasks work with correct auth and audit linkage
- identity mapping correctly round-trips between GhostLink and A2A models
- push notifications work for disconnected long-running tasks
- A2A conformance tests pass

---

## Phase 8.5 - Agent And Skill Productization

**Type:** platform
**Goal:** Make agents, profiles, and skills versioned deployable assets with controlled rollout, rollback, and deprecation.
**Rough effort:** 2-3 weeks

### Why this comes now
- Phase 2 established profiles and skills. Phase 4.5 established evals. Phase 5 established multi-agent execution. Phase 8 established cross-platform interoperability.
- Without versioning, any profile or skill change is a one-way door. Without rollout channels, changes go to everyone immediately. Without rollback, a bad change requires manual cleanup. Productization makes the agent/skill ecosystem sustainable as it grows.

### Deliverables
- versioned agent profiles: each profile has a version number, changelog, and compatibility metadata
- versioned skills: each skill has a version number, dependency declarations, and compatibility metadata
- compatibility metadata: minimum platform version, required capabilities, provider requirements
- rollout channels: `private` (creator only), `beta` (opt-in testers), `stable` (all users in workspace/org)
- workspace/org distribution: profiles and skills can be shared within a workspace or across an organization
- rollback and deprecation flows: operator can roll back to a previous version, deprecate a version with a migration path
- policy approval before broad rollout: promotion from `beta` to `stable` requires policy approval (integrates with Phase 4A policy engine)
- usage telemetry and health per released asset version: track how each version is performing (error rates, cost, eval scores from Phase 4.5)

### Agent assignments

#### `jeff`
- Write the versioning schema: version format, changelog format, compatibility metadata schema.
- Write the distribution architecture: how versions are stored, served, and resolved across workspaces/orgs.
- Write the rollback spec: rollback triggers, state cleanup, mixed-version safety.
- Write the deprecation spec: deprecation notice format, migration path requirements, forced deprecation timeline.
- Define rollback path: if versioning introduces data model issues, the system must be able to fall back to unversioned profiles/skills.

#### `coop`
- Compare against GitHub custom agents, npm-style versioning, and marketplace patterns.
- Make adopt/adapt/reject decisions on version resolution strategy (semver, pinning, ranges).
- Evaluate whether GhostLink needs a marketplace/gallery model or if workspace/org distribution is sufficient for launch.

#### `kurt`
- Write rollback tests: deploy version N+1, roll back to version N, verify the workspace is in a clean state.
- Write compatibility tests: deploy a skill that requires capabilities not present in the current platform version, verify it is rejected.
- Write mixed-version tests: two agents in the same workspace running different versions of the same profile, verify they coexist without conflicts.
- Write deprecation tests: deprecate a version, verify users receive migration notices, verify forced deprecation removes the version after the timeline.

#### `tyson`
- Implement versioning backend: version storage, resolution, changelog management.
- Implement distribution system: workspace and org-level sharing, version serving.
- Implement rollback engine: version rollback with state cleanup.
- Implement deprecation workflow: notice generation, migration path enforcement, forced removal.
- Implement rollout channel logic: private/beta/stable promotion with policy approval integration.
- Implement usage telemetry collection per version: error rates, cost aggregation, eval score linkage.

#### `ned`
- Implement version management UI: version list, changelog viewer, compatibility display.
- Implement rollout channel controls: promote between channels, view channel membership, approval workflow.
- Implement rollback UI: version history, one-click rollback, rollback confirmation.
- Implement deprecation notice display and migration guidance.
- Implement version health dashboard: per-version error rates, cost, eval scores.

### Primary file ownership
- `tyson`
  - `backend/skills.py` (skill versioning, compatibility metadata, rollout channels)
  - `backend/registry.py` (profile versioning, distribution, rollback)
  - new `backend/versioning.py` (version resolution, deprecation, rollout channel logic)
  - backend tests for versioning, rollback, distribution, and deprecation
- `ned`
  - new frontend version management, rollout channel, rollback, and health dashboard surfaces

### Rollback considerations
- Versioning is a data model change. If versioning causes issues, `tyson` must be able to revert to unversioned profiles/skills without losing existing data.
- Rollout channels are additive metadata. Removing them falls back to "all versions are stable."
- Mixed-version coexistence is the highest-risk item. If mixed versions cause conflicts, the system must be able to force all agents to the same version.

### Exit gate
- operator can pin or roll back a skill/profile version
- workspace can run mixed versions safely during rollout
- bad rollout can be reverted without manual cleanup
- deprecation notices are delivered and forced deprecation removes the version
- usage telemetry shows per-version health metrics
- promotion from beta to stable requires policy approval

---

## Phase 9 - UI, Accessibility, And Platform Integrations

**Type:** hardening + new capability
**Goal:** Make every surface in the app accessible, expand platform reach, and add compliance, voice, and i18n.
**Rough effort:** 4+ weeks

### Why this comes now
- Phases 4-8.5 added significant new UI surfaces and capabilities. Before the final expansion push, the existing UI needs a quality pass.
- Accessibility is a compliance requirement (EU accessibility directive, WCAG 2.2). Doing it now prevents accumulating more debt.
- AgentCockpit decomposition reduces the cost of every future UI change.
- EU AI Act enforcement is August 2026. Compliance work must be complete before that deadline.

### Deliverables

#### 9.1: Systematic accessibility pass
- Add `aria-labels` to all interactive elements: buttons, inputs, links, toggles, tabs, dropdowns, sliders.
- Add `role` attributes where semantic HTML is insufficient.
- Implement focus traps in all modals and dialogs: Tab cycles within the modal, Escape closes it.
- Implement keyboard navigation for all interactive flows: tab order follows visual order, all actions reachable without a mouse.
- Color contrast: all text meets WCAG 2.2 AA contrast ratio (4.5:1 for normal text, 3:1 for large text).
- Screen reader testing: verify all surfaces are navigable with NVDA (Windows).
- Target: axe-core automated scan produces 0 critical and 0 serious violations.

#### 9.2: Loading, error, and empty states
- Skeleton loaders for all async data: agent list, task list, chat messages, cost dashboard, memory inspector, provider list.
- Error states with retry buttons: when a fetch fails, show what went wrong and a "Retry" button. No blank screens, no silent failures.
- Empty states with helpful messages: when a list is empty, show a contextual message explaining what goes here and how to populate it. Example: empty task list shows "No active tasks. Assign a task to an agent to see it here."
- No blank screens anywhere in the app under any state combination.

#### 9.3: AgentCockpit decomposition
- Split the current 1187-line `AgentCockpit.tsx` into focused sub-components.
- Target: no single component file exceeds 500 LOC.
- Suggested decomposition (exact split decided by `ned` during implementation):
  - `AgentCockpitHeader.tsx` (agent name, status, controls)
  - `AgentCockpitChat.tsx` (message list, input)
  - `AgentCockpitTools.tsx` (tool call display, tool results)
  - `AgentCockpitSidebar.tsx` (agent info, memory, settings)
- All sub-components share state via existing state management. No new state management library.
- All existing tests must pass after decomposition with no behavior changes.

#### 9.4: Light theme completion
- Audit every component for hardcoded dark-mode colors (hex values, rgb values, CSS variables that only have dark-mode definitions).
- Define light-mode values for all CSS variables and design tokens.
- Test every surface in light mode: no invisible text, no invisible borders, no unreadable contrast.
- Light/dark toggle works without page reload.

#### 9.5: Plan mode UI
- Before an agent executes an expensive task, the operator can request a plan.
- Plan view shows: what the agent intends to do (steps), which files it will modify, estimated token cost, estimated time.
- Operator reviews the plan and approves or rejects. Approval triggers execution. Rejection returns to chat.
- Plan mode is opt-in per task. The operator can set a cost threshold above which plan mode is automatically triggered.
- Based on Lovable Plan Mode and Devin's planning. Reference [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Theme 6.

#### 9.6: Conversation export
- Export a conversation as a Markdown file.
- Export includes: messages (with sender and timestamp), tool calls and results (summarized), code blocks (preserved), images (as links).
- Export format is clean, readable Markdown suitable for documentation or review.
- Export is triggered from the conversation header menu: "Export as Markdown".
- Based on Amazon Q conversation export. Reference [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Theme 6.

#### 9.7: Visual element targeting
- In the desktop app's web preview (if applicable), the operator can click on a UI element to select it.
- Selection generates a message to the agent describing the element: its type, text content, CSS selector, and surrounding context.
- The agent uses this context to make targeted changes to that element.
- This feature requires the desktop app to have a web preview pane or the ability to overlay on an external browser window. If the architectural cost is too high for this phase, `jeff` may defer to Phase 10.
- Based on Cursor Design Mode and Lovable Visual Edits. Reference [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Theme 6.

#### 9.8: Matrix bridge
- Bridge GhostLink to Matrix rooms using the Matrix Client-Server API.
- Support: send/receive messages, inline media, agent identity display, message threading.
- Follow the same bridge architecture as existing Discord/Telegram/Slack/WhatsApp bridges.
- Configuration: operator provides Matrix homeserver URL, access token, room ID.

#### 9.9: MS Teams bridge
- Bridge GhostLink to Microsoft Teams channels using the Bot Framework SDK.
- Support: send/receive messages, inline media, adaptive cards for structured responses, agent identity display.
- Configuration: operator provides Teams bot credentials (app ID, app secret, tenant ID).
- Adaptive cards: use Teams' card format for structured outputs (task status, approval requests, plan previews).

#### 9.10: iOS push notifications (APNs)
- Send push notifications to a paired iOS device when: background task completes, background task fails, budget alert triggers, approval is requested.
- Integration: APNs via HTTP/2 provider API. Requires an Apple Developer account and push certificate.
- Device pairing: operator pairs their iOS device via QR code scanned in a companion app or web page. Pairing stores the device token securely.
- Notification payload: title, body, category (for actionable notifications), badge count.

#### 9.11: macOS LaunchAgent / Windows Task Scheduler integration
- GhostLink can register itself to start on login and run scheduled tasks.
- macOS: generate and install a LaunchAgent plist that starts the GhostLink backend on login.
- Windows: register a Task Scheduler task that starts the GhostLink backend on login.
- Scheduled tasks: operator can schedule recurring agent tasks (daily code review, weekly dependency audit) that run automatically. Tasks appear in the task dashboard when they execute.
- Configuration UI: enable/disable auto-start, manage scheduled tasks, view next run time.

#### 9.12: Claude CLI MCP bridge (loopback)
- GhostLink exposes itself as an MCP server that Claude Code (or any MCP client) can connect to.
- Exposed tools: `ghostlink_dispatch_task`, `ghostlink_query_memory`, `ghostlink_list_agents`, `ghostlink_get_task_status`.
- Use case: a developer using Claude Code can dispatch tasks to GhostLink agents without leaving the CLI. Claude Code becomes a control surface for GhostLink.
- Transport: streamable HTTP on localhost. Authentication: local bearer token generated on first connection.

#### 9.13: Device pairing security
- Secure pairing protocol for mobile push notifications and remote control surfaces.
- Pairing flow: GhostLink generates a time-limited (5 minute) pairing code. The device scans the code (QR or manual entry). GhostLink and the device exchange public keys. All subsequent communication is encrypted.
- Device list: operator can view paired devices, revoke pairing, rename devices.
- Rate limiting: max 5 pairing attempts per 15 minutes. Failed attempts are logged.

#### 9.14: EU AI Act compliance
- Enforcement begins August 2026. GhostLink must support compliance requirements for general-purpose AI systems used in development workflows.
- Audit trails: every agent action (tool call, file write, delegation, approval) is logged with timestamp, agent ID, action type, input summary, output summary. Logs are immutable (append-only) and tamper-evident (hash chain).
- Accountability-in-the-loop: every destructive action (file delete, deployment, external API call) requires operator approval. Approval is logged with operator identity and timestamp.
- Approval workflows: configurable approval gates per action type. Integrates with Phase 4A policy engine and Phase 5 lifecycle hooks.
- Data retention controls: operator can configure how long audit logs are retained. Default: 90 days. Minimum: 30 days (per EU AI Act requirements for high-risk systems).
- Export: audit logs can be exported as structured JSON for regulatory review.

#### 9.15: Local-first with cloud fallback architecture
- Default mode: all data (memory, config, audit logs, conversation history) is stored locally. No data leaves the machine unless the operator explicitly configures cloud sync.
- Cloud fallback: if a local model is unavailable, fall back to cloud providers (using Phase 4B transport abstraction and routing). Operator is notified of the fallback.
- Sync (opt-in): operator can enable sync of specific data types (memory, config) to a cloud storage backend (operator-provided S3, or GhostLink-hosted if a service tier exists in the future).
- Offline mode: GhostLink works fully offline with local models (Ollama). Providers that require internet are marked as unavailable. All local features (memory, config, UI) remain functional.

#### 9.16: Voice input support
- Operator can speak to an agent instead of typing.
- Speech-to-text: use the system's native speech recognition (Web Speech API in Electron's renderer, or whisper.cpp for local transcription).
- Transcribed text is inserted into the chat input. Operator reviews and sends (not auto-send).
- Push-to-talk: hold a configurable hotkey to record, release to transcribe.
- Based on Aider `/voice`, Lovable Voice Mode, and Trae 2.0. Reference [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Theme 11.

#### 9.17: Multilingual UI (i18n)
- Internationalize all user-facing strings in the frontend.
- Use a standard i18n library (react-i18next or equivalent). All strings extracted to locale files.
- Initial languages: English (default), Spanish, French, German, Japanese.
- Language selector in settings. Language change takes effect without app restart.
- Backend error messages and notification text are also internationalized.

### Agent assignments

#### `jeff`
- Write the plan mode spec: plan data model, approval flow, cost threshold configuration, backend API for plan generation and approval.
- Write the conversation export spec: export format, content inclusion rules, file naming.
- Evaluate visual element targeting feasibility and write spec or deferral recommendation.
- Write bridge specs for Matrix (9.8) and Teams (9.9): message format mapping, threading model, auth flow, error handling.
- Write the MCP loopback spec (9.12): tool definitions, transport config, auth model.
- Write the EU AI Act compliance spec (9.14): audit log schema, hash chain implementation, approval gate integration with hooks, retention and export requirements.
- Write the local-first architecture spec (9.15): data locality rules, fallback triggers, sync protocol.
- Write the device pairing spec (9.13): pairing protocol, key exchange, revocation flow.

#### `coop`
- Review all new and existing surfaces for UX consistency against Cursor, Windsurf, Replit, and Devin. Reference [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Theme 6.
- Review conversation export format against Amazon Q's export for completeness.
- Review plan mode UX against Lovable's Plan Mode for usability.
- Evaluate Matrix and Teams bridge UX against existing Discord/Telegram/Slack bridges. Ensure consistency.
- Evaluate voice input UX: push-to-talk vs always-on vs manual trigger. Recommend the interaction model.
- Evaluate i18n scope: confirm top 5 languages based on user base data or market analysis. Identify strings that should not be translated (code identifiers, technical terms).
- Evaluate EU AI Act requirements against current GhostLink capabilities. Identify gaps beyond what is specified here.

#### `kurt`
- Validate accessibility: run axe-core scan on all pages, verify 0 critical/serious violations.
- Validate keyboard navigation: every interactive element reachable by tab, every modal has focus trap, every action completable without mouse.
- Validate screen reader: navigate all primary flows with NVDA, verify all elements are announced correctly.
- Validate loading/error/empty states: disconnect network and verify error states appear, empty all lists and verify empty states appear, slow network and verify skeleton loaders appear.
- Validate light theme: screenshot every surface in light mode, verify no readability issues.
- Write bridge integration tests for Matrix and Teams: message send/receive, media rendering, reconnection after network failure.
- Write APNs delivery tests: notification sent on task completion, notification received on paired device (simulated), pairing revocation prevents further notifications.
- Write EU AI Act compliance tests: audit log captures all required actions, hash chain is tamper-evident (modifying a log entry invalidates the chain), approval gates block destructive actions, log export produces valid JSON.
- Write offline mode tests: disconnect network, verify local features work, reconnect and verify cloud fallback resumes.
- Write voice input tests: audio capture, transcription accuracy validation, push-to-talk hotkey behavior.

#### `tyson`
- Implement plan generation backend: receive task, generate plan (steps, files, cost estimate), store plan, accept approval/rejection.
- Implement conversation export backend: serialize conversation to Markdown format.
- Implement Matrix bridge backend (9.8).
- Implement Teams bridge backend (9.9).
- Implement APNs integration (9.10).
- Implement system service registration for macOS and Windows (9.11).
- Implement MCP loopback server (9.12).
- Implement device pairing protocol (9.13).
- Implement EU AI Act audit logging, hash chain, approval gates, retention, and export (9.14).
- Implement local-first data storage and cloud fallback logic (9.15).

#### `ned`
- Implement all accessibility fixes (9.1): aria-labels, roles, focus traps, keyboard navigation, contrast fixes.
- Implement all loading/error/empty states (9.2).
- Decompose AgentCockpit (9.3).
- Complete light theme (9.4).
- Implement plan mode UI (9.5): plan view, approval controls, cost threshold setting.
- Implement conversation export UI (9.6): export button, format preview.
- Implement visual element targeting if feasible (9.7).
- Implement Matrix and Teams bridge configuration UI.
- Implement push notification pairing UI: QR code display, device list, revocation controls.
- Implement scheduled task configuration UI (9.11).
- Implement MCP loopback connection status display (9.12).
- Implement audit log viewer and export UI (9.14).
- Implement voice input UI: push-to-talk button, recording indicator, transcription preview (9.16).
- Implement i18n infrastructure and initial translations (9.17).
- Implement language selector in settings.

### Primary file ownership
- `tyson`
  - `backend/routes/agents.py` (plan and export endpoints)
  - new `backend/plans.py` (plan generation and storage)
  - new `backend/bridges/matrix.py`
  - new `backend/bridges/teams.py`
  - new `backend/notifications/apns.py`
  - new `backend/service_registration.py` (LaunchAgent / Task Scheduler)
  - new `backend/mcp_loopback.py`
  - new `backend/pairing.py`
  - `backend/audit.py` (EU AI Act compliance extensions)
  - `backend/providers.py` (local-first fallback logic)
  - backend tests for all of the above
- `ned`
  - `frontend/src/components/AgentCockpit.tsx` (decomposition)
  - new `frontend/src/components/AgentCockpitHeader.tsx`
  - new `frontend/src/components/AgentCockpitChat.tsx`
  - new `frontend/src/components/AgentCockpitTools.tsx`
  - new `frontend/src/components/AgentCockpitSidebar.tsx`
  - new `frontend/src/components/PlanView.tsx`
  - new `frontend/src/components/ConversationExport.tsx`
  - new `frontend/src/components/BridgeConfig.tsx` (Matrix, Teams)
  - new `frontend/src/components/DevicePairing.tsx`
  - new `frontend/src/components/ScheduledTasks.tsx`
  - new `frontend/src/components/AuditViewer.tsx`
  - new `frontend/src/components/VoiceInput.tsx`
  - new `frontend/src/i18n/` (locale files and i18n configuration)
  - all existing frontend components (accessibility, loading states, light theme, string extraction for i18n)

### Rollback considerations
- Accessibility changes are additive (adding attributes) and have near-zero risk.
- AgentCockpit decomposition is a refactor. If it introduces regressions, `ned` can revert to the monolithic component. All changes must pass existing tests before merge.
- Light theme changes should not affect dark theme. Use CSS variables so both themes are defined independently.
- Plan mode is opt-in and additive. Disabling it has no effect on normal execution.
- Visual element targeting (9.7) is the highest-risk item. `jeff` should evaluate feasibility before committing to implementation.
- Each bridge (Matrix, Teams) is independent. Removing one does not affect the other or existing bridges.
- APNs and device pairing are coupled. If pairing is broken, APNs is useless. Both must ship together or neither ships.
- EU AI Act compliance (9.14) is the highest-priority item in this phase due to the August 2026 enforcement deadline. If the phase runs long, 9.14 must be completed first. Bridges and voice can slip.
- MCP loopback (9.12) is additive and low-risk. It exposes existing functionality through a new interface.
- i18n (9.17) is a large surface-area change (touching every component for string extraction). It should be done as a single pass to avoid merge conflicts with other UI work. Schedule it after other UI changes in this phase are complete.

### Exit gate
- axe-core scan: 0 critical, 0 serious violations across all pages.
- All primary flows completable via keyboard only.
- NVDA can navigate agent list, open a chat, send a message, and view task status.
- Every async data surface has a visible skeleton loader.
- Every error state has a visible retry button.
- Every empty list has a contextual help message.
- No single component file exceeds 500 LOC.
- Light theme has no text with contrast ratio below 4.5:1.
- Plan mode generates a plan, operator approves, agent executes.
- Conversation export produces valid Markdown with messages, code blocks, and timestamps.
- Matrix bridge sends and receives messages in a test Matrix room.
- Teams bridge sends and receives messages in a test Teams channel.
- Push notification arrives on a paired device when a background task completes.
- GhostLink starts on login via LaunchAgent (macOS) or Task Scheduler (Windows).
- A scheduled task runs at its configured time and appears in the task dashboard.
- Claude Code connects to GhostLink's MCP loopback and dispatches a task via `ghostlink_dispatch_task`.
- Device pairing completes via QR code. Revocation prevents further notifications.
- Audit log captures a tool call with timestamp, agent ID, and action type. Hash chain validation passes.
- Approval gate blocks a file delete until operator approves.
- Audit log export produces valid JSON with all required fields.
- GhostLink works offline with a local model (Ollama). Cloud fallback activates when network returns.
- Voice input transcribes spoken text into the chat input field.
- UI displays correctly in at least two non-English languages.

---

## Phase 10 - Future Expansion

**Type:** new capability
**Goal:** Backlog of features with no fixed timeline. Evaluate as the market evolves and user demand signals emerge.

### Why this has no timeline
- These are features that either depend on external ecosystem maturity (Figma API, computer-use QA), have unclear ROI without user data, or are speculative capabilities that may become obsolete before implementation.
- Each item should be evaluated quarterly against user demand, competitive pressure, and architectural readiness.

### Items

#### 10.1: Figma import
- Convert Figma designs to code via the Figma API.
- Parse Figma frames into component trees. Generate React/HTML/CSS output.
- Requires Figma API access (user provides API key).
- Competitive reference: Replit, v0. See [docs/AI_AGENT_PLATFORM_SURVEY.md](/C:/Users/skull/OneDrive/Desktop/projects/ghostlink/docs/AI_AGENT_PLATFORM_SURVEY.md) Theme 6.

#### 10.2: Auto-database provisioning
- Agent can provision a database (SQLite, Postgres) as part of project scaffolding.
- Includes schema generation from natural language, visual table editor, migration generation.
- Competitive reference: Bolt.new, Replit, Lovable Cloud. See survey Theme 9.

#### 10.3: Agent testing via computer use
- Agent launches the built application, visually interacts with it (clicks, scrolls, types), and validates behavior against acceptance criteria.
- Requires computer-use capability from the model provider (currently Claude and Devin support this).
- Produces a visual test report with annotated screenshots.
- Competitive reference: Devin's computer-use QA. See survey Theme 8.

#### 10.4: Community mode gallery
- Pre-built agent configurations (role, rules, tools, model) that users can browse and install.
- Gallery is hosted (or distributed as a JSON index). Configurations are versioned.
- Users can publish their own configurations.
- Competitive reference: Roo Code Mode Gallery. See survey Theme 10.

#### 10.5: Code review agent
- Automated PR review with persistent rules.
- Agent reviews diffs against project rules, past review feedback, and code quality heuristics.
- Persistent rules: if the operator corrects the agent's review, it learns and stops making the same suggestion.
- Competitive reference: Qodo, Tabnine Code Review Agent. See survey Theme 8.

#### 10.6: One-click deployment
- Deploy the current project to a hosting provider (Netlify, Vercel, Cloudflare, Railway) from within GhostLink.
- Agent handles build, environment variable configuration, and deployment.
- Competitive reference: Bolt.new, Replit, Lovable. See survey Theme 9.

#### 10.7: Living specs
- Multiple agents share an evolving plan document. As agents complete work, the spec updates to reflect reality.
- Spec diffs are tracked and visible to the operator.
- Builds on Phase 5's spec-driven development. Extends it from single-agent to multi-agent.
- Competitive reference: Augment Intent. See survey Theme 2.

#### 10.8: Plugin update lifecycle
- Plugin discovery: scan for available plugin updates from a registry.
- Verification: validate plugin updates against security policy before applying.
- Application: apply plugin updates with rollback capability.
- Notification: notify operator of available updates with changelog summary.

#### 10.9: Config schema export
- Export the full GhostLink configuration schema as JSON Schema.
- Use case: external tools can validate GhostLink config files, IDE extensions can provide autocomplete for config editing.

#### 10.10: Doctor/health check CLI
- `ghostlink doctor` command that checks: backend is running, frontend build is valid, all providers are reachable, database is healthy, all bridges are connected, disk space is sufficient.
- Outputs a structured health report with pass/fail per check and remediation suggestions for failures.

#### 10.11: PID recycling detection
- Detect when a process ID is recycled by the OS and a different process occupies a PID that GhostLink was tracking.
- Prevents ghost references to dead agents or orphaned processes.
- Implementation: store PID + process start time. Validate both before assuming a process is still the same agent.

### Agent assignments for evaluation
- `coop`: quarterly review of each item against user demand and competitive pressure. Recommend promotion to a numbered phase or removal from backlog.
- `jeff`: when `coop` promotes an item, write the full spec before implementation begins.
- `kurt`: when `jeff` writes a spec, write the test plan.
- `tyson` and `ned`: implement only after spec and test plan exist.

### No exit gate
- Phase 10 items have no collective exit gate. Each item that gets promoted to implementation gets its own exit gate as part of its spec.

---

## Cross-Phase Dependencies

| Phase | Hard dependencies | Soft dependencies |
|-------|------------------|-------------------|
| **4A** | Phase 3.5 exit gate | none |
| **4B** | Phase 4A exit gate (policy before cost scaling) | none |
| **4.5** | Phase 4A (policy), Phase 4B (providers, cost) | Phase 3.5 (tracing for grading) |
| **5** | Phase 3.5 (durable execution), Phase 4A (policy), Phase 4B (cost controls), Phase 4.5 (evals) | Phase 2 (profiles for collaboration patterns) |
| **6** | Phase 1B (identity memory), Phase 5 (multi-agent for cross-agent coordination) | Phase 4B (cache diagnostics) |
| **7** | Phase 4B (transport abstraction, cost tracking) | Phase 3 (task dashboard for async tracking) |
| **8** | Phase 1A (identity records), Phase 3/3.5 (tracing, durable execution), Phase 4A (policy) | Phase 5 (multi-agent patterns) |
| **8.5** | Phase 2 (profiles, skills), Phase 4.5 (evals) | Phase 8 (A2A for cross-platform distribution) |
| **9** | Phase 5 (hooks for EU AI Act approval gates), Phase 4B (local-first fallback) | Phase 8.5 (versioning for i18n of versioned assets) |
| **10** | varies per item | varies per item |

### Parallelization opportunities
- Phase 7 and Phase 8 can run in parallel after their prerequisites are met. Phase 7 is backend-heavy (`tyson`), Phase 8 involves both backend and frontend. Coordinate file ownership if running in parallel.
- Phase 8.5 can begin design work while Phase 8 implementation is in progress.
- Within Phase 9, bridges (9.8, 9.9) can run in parallel with compliance (9.14) and voice (9.16). Different files, different skills.

---

## What Comes After Part 2

The items in Phase 10 are the current backlog. As the market evolves and user demand signals emerge, `coop` promotes items from Phase 10 into numbered phases with full specs, test plans, and exit gates.

New capabilities not yet imagined will be added to Phase 10's backlog as they are identified through competitive research, user feedback, and ecosystem changes.

---

*End of Roadmap Part 2*
