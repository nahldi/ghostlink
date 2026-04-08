# Competitive Upgrades Addendum (2026-04-07)

Purpose: capture source-backed patterns from current agent systems that GhostLink should steal, adapt, or explicitly reject.

This is not marketing research. It is an architecture/input doc for roadmap refinement.

Use this alongside:
- `docs/AI_AGENT_PLATFORM_SURVEY.md`
- `docs/specs/AUDIT_SUMMARY.md`
- `UNIFIED_ROADMAP.md`

## Scope

Primary-source review focused on:
- OpenAI Codex
- Anthropic Claude Code
- Google Gemini CLI
- LangGraph / LangChain
- CrewAI
- AutoGen
- OpenClaw

The goal is not feature parity. The goal is to identify what these systems do that materially improves:
- orchestration
- supervision
- durable execution
- memory
- approvals/policy
- operator usability
- reliability

## What GhostLink Should Steal

### 1. A stable harness/app-server contract, not just wrapper glue

Source signals:
- OpenAI says Codex App Server exposes the same harness across CLI, web, IDE, and app clients as a stable JSON-RPC event stream.
- OpenAI also positions App Server as the preferred integration path when clients need the full harness and approval/event stream.

Why it matters:
- GhostLink still leans heavily on wrapper-specific behavior and ad hoc route/event assumptions.
- That is fine for bootstrapping, but weak as a multi-surface orchestration core.

Upgrade for GhostLink:
- Formalize one canonical runtime protocol between backend and clients.
- Make approvals, tool calls, checkpoints, interrupts, trace events, and model/provider changes first-class typed events.
- Treat wrappers/providers as adapters behind that contract, not as the contract itself.

Roadmap pressure:
- Strengthens Phases 3, 3.5, 4A, and 4B.
- Lowers future frontend/Electron drift and provider-specific hacks.

### 2. Interrupts should be a real execution primitive, not a UI convenience

Source signals:
- LangGraph pauses execution with `interrupt()`, persists state, and resumes using a stable `thread_id`.
- LangGraph explicitly ties durable execution, human approval, and resume behavior together.
- LangChain HITL middleware supports `approve`, `edit`, and `reject`, not just yes/no.

Why it matters:
- GhostLink already wants stop/pause/resume/checkpoints, but the strongest current systems treat interruption as a core runtime primitive.
- The difference is huge: approvals become resumable workflow boundaries instead of brittle button handlers.

Upgrade for GhostLink:
- Upgrade the Phase 3.5 model from "checkpoint + replay" to "interrupt + checkpoint + resumable decision."
- Add tri-state human review for dangerous actions:
  - approve
  - edit-and-run
  - reject-with-feedback
- Make every interrupt carry a stable cursor ID so the UI, logs, and replay engine all reference the same waiting state.

Roadmap pressure:
- Tightens Phases 3, 3.5, and 4A.
- Makes background execution and policy actually composable.

### 3. Hook policy should snapshot at session start

Source signals:
- Anthropic documents that Claude Code snapshots hook configuration at startup and requires review before later hook changes apply.
- Claude Code `PreToolUse` supports `allow`, `deny`, and `ask`.

Why it matters:
- GhostLink already has hook/event ambitions, but mutable hook config mid-session is a supply-chain footgun.
- If hook policy can change underneath a running agent, you do not have a stable execution contract.

Upgrade for GhostLink:
- Snapshot hook config at agent start/resume.
- If hook config changes on disk, mark the session "policy drifted" and require explicit operator review before reload.
- Standardize hook decisions to:
  - allow
  - ask
  - deny
- Keep GhostLink-specific richer metadata if useful, but preserve this simple contract at the decision boundary.

Roadmap pressure:
- Tightens Phases 4A and 5.3.
- Makes policy behavior safer and easier to reason about.

### 4. Flow-first orchestration beats free-form multi-agent chat

Source signals:
- CrewAI recommends starting production systems with a Flow.
- CrewAI Flows expose explicit start/listen/router patterns, built-in state, unified memory, and tracing.
- AutoGen similarly formalizes teams, group chat modes, selector logic, handoffs, and termination conditions.

Why it matters:
- Most orchestration systems get worse when they rely on "agents talking until it somehow converges."
- The strong pattern is:
  - explicit topology
  - explicit transitions
  - explicit stop conditions

Upgrade for GhostLink:
- Add a first-class "task flow" layer on top of plain chat/delegation.
- Support a few opinionated orchestration templates:
  - planner -> workers -> reviewer
  - parallel arena -> judge -> merge
  - operator approval gate -> executor -> verifier
- Keep open-ended delegation, but stop treating it as the default for everything.

Roadmap pressure:
- Tightens Phases 3, 5, and 5.5.
- Gives the 5-agent model a real runtime shape instead of just role labels.

### 5. Team topology and termination conditions should be explicit

Source signals:
- AutoGen's `SelectorGroupChat` uses model-based next-speaker selection with configurable roles, descriptions, candidate filtering, and explicit termination conditions.
- AutoGen also distinguishes:
  - stop after the current turn
  - abort immediately
  - resume later without reset

Why it matters:
- GhostLink currently thinks mostly in terms of "agents exist" and "tasks exist."
- The better abstraction is "team run with topology + selection policy + termination policy."

Upgrade for GhostLink:
- Add explicit runtime team modes:
  - round-robin
  - selector-based
  - handoff/swarm
  - arena
- Add explicit termination conditions:
  - text signal
  - max turns/messages
  - timeout
  - token budget
  - handoff to operator
- Distinguish `stop` from `abort`.

Roadmap pressure:
- Tightens Phases 3, 5, and 8.
- Prevents hidden infinite loops and fuzzy completion semantics.

### 6. Unified memory should support both shared and private scopes

Source signals:
- CrewAI exposes unified memory across crews, agents, and flows, with scoped/private views when needed.
- CrewAI automatically extracts discrete memories from task output and recalls relevant context before future tasks.
- LangGraph/LangChain split short-term thread state from long-term namespace/key stores.

Why it matters:
- GhostLink already wants memory stratification, but the best systems separate:
  - thread/run memory
  - shared workspace memory
  - private agent memory
  - long-term cross-thread memory

Upgrade for GhostLink:
- Make memory scope first-class:
  - `/thread/<id>`
  - `/agent/<agent_id>`
  - `/workspace/<workspace_id>`
  - `/profile/<profile_id>`
- Add automatic discrete-memory extraction from completed tasks, not just raw transcript retention.
- Add scoped recall controls so agents do not leak private memory into shared work by default.

Roadmap pressure:
- Tightens Phases 2 and 6.
- Makes profile/agent/workspace behavior more coherent.

### 7. Operator ergonomics matter more than one more backend abstraction

Source signals:
- Gemini CLI exposes operator-facing commands like `/memory`, `/stats`, `/tools`, and `/mcp`.
- OpenClaw emphasizes guided onboarding, daemon install, model selection/auth rotation, and always-on channel presence.

Why it matters:
- Systems win when operators can see:
  - what memory exists
  - what tools are available
  - what the agent is costing
  - what MCPs are active
  - what state the runtime is in

Upgrade for GhostLink:
- Add first-class operator surfaces for:
  - memory inspection
  - token/cost/runtime stats
  - tool inventory
  - MCP inventory/health
  - model/provider auth health
- Treat guided onboarding and daemon health as product features, not setup chores.

Roadmap pressure:
- Tightens Phases 3, 4B, 6, and 9.
- Improves daily operator trust more than another invisible backend refactor.

## Highest-Value Upgrades To Add Or Strengthen

If GhostLink wants to be better than the current pack, the best next roadmap upgrades are:

1. Formal runtime event contract:
   - approvals
   - interrupts
   - checkpoints
   - traces
   - provider/model transitions

2. Interrupt semantics with durable resume:
   - approve / edit / reject
   - stable waiting-state IDs
   - replay-safe pause boundaries

3. Session-snapshotted hook policy:
   - no hot-swapping dangerous hook behavior mid-run
   - operator review for hook drift

4. Explicit team runtime modes:
   - selector
   - handoff/swarm
   - arena
   - external-stop vs abort semantics

5. Scoped memory namespaces with automatic extraction:
   - private vs shared by default
   - profile/workspace/agent scoping

6. Better operator introspection:
   - `/memory`
   - `/stats`
   - `/tools`
   - `/mcp`
   - auth/provider health

## What Not To Cargo-Cult

- Do not copy "more agents" as the answer. Strong systems win on execution model, not raw agent count.
- Do not copy marketplace/skills sprawl without stronger provenance, trust, and review controls.
- Do not copy free-form autonomous chatting as the default orchestration model.
- Do not copy research-framework complexity if the operator cannot inspect or stop it.

## Concrete GhostLink Recommendation

If GhostLink wants the highest upside per unit of complexity, the next architecture upgrades should be:

1. Strengthen Phase 3.5 into a true interrupt/resume runtime.
2. Strengthen Phase 4A hook/policy semantics around session snapshots and tri-state decisions.
3. Strengthen Phase 5 from "multi-agent execution" into an explicit team-runtime layer with topology and termination contracts.
4. Strengthen Phase 6 memory around scoped namespaces and automatic extraction.
5. Strengthen operator UX around runtime introspection before adding more exotic providers or channel surfaces.

That is the path to "best agent orchestra system possible."

## Sources

- OpenAI Codex App Server / harness: https://openai.com/index/unlocking-the-codex-harness/
- OpenAI Codex Cloud docs: https://platform.openai.com/docs/codex
- Anthropic Claude Code hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
- Anthropic Claude Code MCP: https://docs.anthropic.com/en/docs/claude-code/mcp
- Google Gemini CLI: https://developers.google.com/gemini-code-assist/docs/gemini-cli
- LangGraph interrupts / HITL / durable execution / memory:
  - https://docs.langchain.com/oss/python/langgraph/human-in-the-loop
  - https://docs.langchain.com/oss/javascript/langgraph/durable-execution
  - https://docs.langchain.com/oss/javascript/langgraph/memory
- CrewAI memory / flows / tracing:
  - https://docs.crewai.com/en/concepts/memory
  - https://docs.crewai.com/en/concepts/flows
  - https://docs.crewai.com/en/observability
- AutoGen teams / selector / termination / human-in-the-loop:
  - https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html
  - https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/selector-group-chat.html
  - https://microsoft.github.io/autogen/dev/user-guide/agentchat-user-guide/tutorial/termination.html
  - https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/human-in-the-loop.html
- OpenClaw README: https://github.com/openclaw/openclaw
