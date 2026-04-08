# Roadmap Approach Audit

**Auditor:** Independent technical audit agent
**Date:** 2026-04-07
**Scope:** UNIFIED_ROADMAP.md, roadmap-pt1.md, roadmap-pt2.md, all listed backend/frontend source files
**Verdict:** Roadmap is architecturally sound but has 7 blocking issues, 9 significant risks, and several effort underestimates.

---

## Phase 0 - Truthful Baseline

**Feasibility:** PASS. This is cleanup work. The codebase is real, the tooling exists, the exit gates are runnable.

**Issues:** None blocking.

**Effort estimate (1-3 days):** Realistic. Phase 0 is declared complete; no further action needed.

---

## Phase 1A - Stable Identity Records

**Feasibility:** PASS with significant refactoring required.

### What the code actually looks like today

`registry.py` (136 lines) uses `AgentInstance.name` as the primary key everywhere:
- `_instances: dict[str, AgentInstance]` is keyed by `.name`
- `register()` derives `name` from `base` and slot number (e.g., `claude`, `claude-2`)
- `get()`, `deregister()`, `set_state()` all take `name: str`
- `resolve_token()` returns the instance but the caller uses `inst.name`

There is **no `agent_id` field** on `AgentInstance`. No `session_id`, no `parent_agent_id`, no `trace_id`, no `artifact_namespace`. The identity record the roadmap demands does not exist in any form yet.

### Name-coupling is deep

Every subsystem keys off the display name:
- `mcp_bridge.py` (1838 lines): `_resolve_identity()` returns `inst.name` and that name flows into every tool call, presence tracker, and cursor map.
- `agent_memory.py`: `AgentMemory.__init__` takes `agent_name` and creates filesystem paths like `data/{agent_name}/memory/`.
- `skills.py`: `_agent_skills: dict[str, list[str]]` maps `agent_name` to skill lists. Skill config keys are `{agent_name}:{skill_id}`.
- `store.py`: The `sender` column in the messages table stores the display name string. There is no foreign key or ID column linking back to a registry record.
- `jobs.py`: `created_by` and `assignee` are free-text strings (display names).
- `routes/agents.py` (2384 lines): Uses `inst.name` pervasively for activity logging, presence, replay events, process tracking.

### Blocking issues

1. **Database migration required.** The messages, jobs, and rules SQLite tables store display names as free text. Adding `agent_id` references means either (a) adding columns and backfilling, or (b) a migration that rewrites existing rows. Neither is mentioned in the roadmap. This is a data migration problem, not just a code change.

2. **Memory directory renaming.** `agent_memory.py` uses `data/{agent_name}/memory/` on the filesystem. Renaming an agent requires either moving directories or adding an indirection layer. The roadmap acknowledges rename safety but does not call out this specific filesystem migration.

3. **Skills config migration.** `skills.py` stores assignments keyed by display name in `skills_config.json`. This file must be migrated or the key scheme changed.

### Effort estimate (3-5 days): UNDERESTIMATED

The `AgentInstance` dataclass needs 12+ new fields. But the real work is the name-coupling removal across 7000+ lines of backend code plus the frontend `Agent` type (which also uses `name` as the key). Realistic estimate: **6-10 days** for backend alone, plus 2-3 days for frontend type changes.

### Risks

- **UUID v7 is no longer the plan.** The locked 2026-04-07 Phase 1A scope settled on `uuid.uuid4().hex` for `agent_id`. No extra UUID dependency is needed for 1A. If time-sortable IDs become important later, that can be revisited in a later phase without blocking the current foundation work.

### Simpler alternative

Instead of adding 12+ fields to `AgentInstance` all at once, consider a phased approach:
1. Add `agent_id` (UUID) as the stable internal key. Keep `name` as a display label.
2. Add a lookup index: `_instances_by_id: dict[str, AgentInstance]`.
3. Migrate subsystems one at a time to use `agent_id` instead of `name`.
4. Add the remaining fields (`session_id`, `parent_agent_id`, `trace_id`, etc.) as they become relevant in later phases rather than adding them all in 1A as dead fields.

This reduces Phase 1A scope and avoids big-bang refactoring.

---

## Phase 1B - Runtime Identity Isolation And Reinjection

**Feasibility:** PASS, conditional on Phase 1A completion.

### What the code actually looks like today

`wrapper.py` (1235 lines) writes per-agent MCP config files into `data/provider-config/{instance_name}-mcp.json`. This is already per-instance. The identity "injection" problem is about the CLI agents' system prompt / instruction files, not GhostLink's config.

The current `_BUILTIN_DEFAULTS` dict shows three MCP injection modes:
- `flag`: writes a JSON config and passes it via `--mcp-config` (Claude, Grok)
- `env`: writes a settings file and sets an env var (Gemini, Goose)
- `proxy_flag`: passes a URL directly as a CLI flag (Codex)

### Blocking issue

4. **Provider adapter abstraction is harder than described.** The roadmap says "provider adapters can cleanly abstract injection differences." Looking at the actual code:
   - Claude Code accepts `--mcp-config` and reads from `.claude/` directories
   - Codex uses `-c mcp_servers.{server}.url="{url}"` as inline config
   - Gemini uses an environment variable pointing to a settings JSON file
   - Aider and Copilot have no native MCP support and use a proxy

   These are not just "config format differences." Some CLIs read shared instruction files from well-known paths (`.claude/instructions.md`, `.codex/instructions.md`). GhostLink cannot prevent a CLI from reading its own instruction file from the workspace root. The roadmap claims GhostLink will "remove dependence on shared workspace instruction files" but the CLI tools themselves decide where they read instructions from. GhostLink can only inject additional context via MCP tools, not prevent the CLI from reading its own files.

   **This means identity isolation is only partial.** GhostLink can ensure its own system prompt injection is per-agent, but if two Claude instances share a workspace, they both read the same `.claude/instructions.md`. The workaround (per-agent worktrees from Phase 5) is listed as a much later phase.

### Effort estimate (4-7 days): Reasonable if scoped to "GhostLink-side isolation only." If the intent is full isolation including workspace instruction files, it requires worktrees (Phase 5) and the estimate is wrong.

### Risk

- **Compaction reinjection is provider-dependent.** When a Claude Code session compacts its context, GhostLink cannot control what gets dropped. The MCP bridge can re-serve identity via tool calls, but the agent has to call the tool. If the agent forgets to call `chat_who` after compaction, identity may drift. This is a fundamental limitation of the MCP tool model vs. system prompt injection.

---

## Phase 2 - Profiles, Rules, And Knowledge Layering

**Feasibility:** PASS.

### What the code actually looks like today

`skills.py` is a flat registry with no concept of profiles, inheritance, or layering. The `SkillsRegistry` maps agent names to skill ID lists. There is no `Profile` data model.

`agent_memory.py` stores per-agent key-value pairs in JSON files. There is no layer concept, no `global -> profile -> agent` resolution.

### Issues

5. **No circular dependency with Phase 1A, but sequencing matters.** Phase 2 adds profiles keyed by `profile_id`. Under the locked 2026-04-07 Phase 1A scope, `profile_id` is explicitly deferred and should land via a Phase 2 migration instead of being added early as a dead field. This is no longer a blocker for 1A, but it does mean the profile migration belongs to Phase 2 on purpose.

### Effort estimate (1-2 weeks): Reasonable. The profile model is new code, not a deep refactor.

### Simpler alternative

The `global -> profile -> agent override` inheritance can be implemented as a simple dict-merge chain rather than a complex resolver. Three JSON blobs merged in order is simpler than a rules engine. Only build the rules engine if the merge chain proves insufficient.

---

## Phase 3 - Operator Control Plane

**Feasibility:** PASS.

### What the code actually looks like today

`jobs.py` (122 lines) is a basic SQLite-backed job store with CRUD operations. It has `uid`, `title`, `body`, `status`, `created_by`, `assignee`. There is no tracing, no provenance chain, no audit trail.

The frontend has `JobsPanel.tsx` and `TaskQueue.tsx` which are minimal list views.

### Issues

6. **Enterprise auditability is a large scope addition.** The roadmap lists "searchable history, filters, cost per session/task, provenance chain, exportable audit trail, retention controls" as Phase 3 deliverables. This is essentially building a mini-analytics backend. The `backend/security.py` AuditLog exists but is a simple append-only JSON log, not a queryable store. This needs either:
   - A new SQLite table with proper indices for search/filter
   - Or integration with the existing FTS setup in `store.py`

   This is significant new backend work on top of the task/control surface.

### Effort estimate (1-2 weeks): UNDERESTIMATED if enterprise auditability is included. The control plane UI alone is 1-2 weeks. Audit search/filter/export adds another week. Realistic: **2-3 weeks total.**

---

## Phase 3.5 - Durable Execution And Replay

**Feasibility:** PASS with caveats.

### Technical verification: SQLite WAL mode + FastAPI async

**Claim:** "SQLite WAL mode handles concurrent access."

**Verdict: PARTIALLY TRUE, with an important nuance.**

The codebase already enables WAL mode (`PRAGMA journal_mode=WAL`) and sets `busy_timeout=5000`. This correctly enables concurrent reads. However:

- SQLite WAL mode allows **one writer at a time**. Multiple concurrent writes serialize on the database lock.
- `aiosqlite` runs SQLite operations in a background thread. Multiple async tasks calling `await db.execute(...)` will compete for the single writer lock.
- The `busy_timeout=5000` means a blocked write waits up to 5 seconds before failing with `SQLITE_BUSY`.
- For a checkpoint store that Phase 3.5 introduces, this means: if multiple agents are checkpointing simultaneously, they serialize. This is fine for 5-10 agents. It would become a bottleneck at 20+ concurrent checkpointing agents.

**The current approach works for GhostLink's scale.** The 20-agent `MAX_AGENTS` limit in `registry.py` bounds the concurrency. But the roadmap should acknowledge the single-writer constraint and plan for it if agent counts grow.

Additionally, there are **two separate `aiosqlite.connect()` calls to the same database** in `app.py`:
- `store.init()` opens one connection (line 97 in store.py)
- `app.py` opens a second connection (line 341) for jobs, rules, and schedules

Two connections to the same WAL-mode database is fine for reads but writes from both connections compete for the same lock. This is already a latent issue today, not just a Phase 3.5 concern.

### Checkpoint design risks

7. **Side-effect idempotency is extremely hard.** The roadmap says "idempotent side-effect boundaries." In practice, this means: if an agent calls an external API, commits a git change, or sends a message, replaying from a checkpoint must not redo those actions. This requires wrapping every side-effectful operation in an idempotency layer -- a significant architectural commitment. LangGraph and Temporal solve this with explicit "activity" wrappers. The roadmap does not describe the mechanism. This is a design gap that could expand scope dramatically.

### Effort estimate (1-2 weeks): UNDERESTIMATED. Checkpoint storage is 3-5 days. Resume is another 3-5 days. Replay with idempotency is the hard part and could take a full week alone. Fork is 2-3 days. Realistic: **3-4 weeks** if idempotency is taken seriously.

### Simpler alternative

Phase 3.5 could be split:
- 3.5a: Checkpoint store + resume (1-2 weeks) -- immediately useful for crash recovery
- 3.5b: Replay + fork + idempotency (2+ weeks) -- deferred until there is a concrete need

Resume alone delivers 80% of the value. Replay and fork are "nice to have" that carry disproportionate complexity.

---

## Phase 4A - Policy Engine And Sandboxing

**Feasibility:** PASS with Windows caveats.

### What the code actually looks like today

`security.py` (497 lines) has `ExecPolicy` (command allowlist/blocklist), `SecretsManager` (Fernet encryption), and `AuditLog`. There are already per-agent command allowlists. The existing `plugin_sdk.py` has `HookManager` with `pre_tool_use` hooks that are fail-closed.

### Issues

8. **Sandbox tiers: "container" tier on Windows is effectively unavailable.** The roadmap lists sandbox tiers as `host`, `worktree-only`, and `container`. On Windows (the primary development platform based on the repo location), there is no Landlock, no seccomp, and Docker Desktop is optional. The `container` tier would require Docker or WSL2 containers. The roadmap does not flag this Windows limitation.

9. **Egress allowlists require network interception.** The roadmap says "agents can only reach approved endpoints." GhostLink does not run agents inside a network namespace. Agent CLIs (claude, codex, gemini) make their own HTTP requests directly. GhostLink can only control network access for tool calls that go through the MCP bridge, not for direct CLI-to-provider API calls. True egress control requires either:
   - Running agents inside containers (the "container" tier that does not work on Windows)
   - OS-level firewall rules (which require admin privileges)
   - Proxy-based interception (complex setup)

   The roadmap conflates "MCP tool call policy" with "network egress control." These are different things.

### Effort estimate (1-2 weeks): Reasonable for the policy engine and MCP-level enforcement. The sandbox and egress claims add risk that could expand the timeline.

---

## Phase 4B - Provider Independence And Cost Control

**Feasibility:** PASS.

### What the code actually looks like today

`providers.py` is already a multi-provider registry with 13 providers, each declaring capabilities and models. The `Transport` interface the roadmap describes does not exist yet, but the provider registry structure is a good foundation.

### Issues

- **Prompt cache optimization (4B.3) assumes provider-side caching.** Anthropic supports prompt caching. OpenAI does not expose an equivalent API-level cache. The optimization (deterministic tool ordering, fingerprinting) only benefits providers that support caching. This is fine but the roadmap should not claim universal cache improvements.

- **Provider expansion (4B.4) lists providers that may not have stable APIs.** Kimi/Moonshot, Z.AI/GLM, and BytePlus/Volcengine may have limited English documentation and unstable API contracts. Integration risk is higher than for established providers.

### Effort estimate (2 weeks): Reasonable. The transport abstraction is the largest piece but it can be done incrementally.

---

## Phase 4.5 - Evals And Trace Grading

**Feasibility:** PASS.

### Issues

- **Golden task corpus requires human curation.** The roadmap assigns `kurt` to build 20+ golden tasks. These tasks need known-correct outputs, which means a human must write or verify them. This is labor-intensive and cannot be fully automated.

- **"No silent regression" merge criteria needs CI integration.** The roadmap does not describe how release gates integrate with the git workflow. Is this a pre-commit hook? A GitHub Action? A manual check? This integration detail matters for adoption.

### Effort estimate (1-2 weeks): Reasonable if the golden corpus is small (20 tasks). The eval runner itself is straightforward.

---

## Phase 5 - Multi-Agent Execution

**Feasibility:** PASS with a critical Windows caveat.

### Technical verification: Worktree isolation on Windows

**Claim:** "Worktree isolation works on Windows."

**Verdict: TRUE but with OneDrive complications.**

Git 2.53.0 (installed) fully supports `git worktree`. The existing `worktree.py` already creates and manages worktrees. The `git worktree list` output confirms worktrees have been created successfully on this machine.

However, the project lives on **OneDrive** (`C:\Users\skull\OneDrive\Desktop\projects\ghostlink`). OneDrive syncs file changes to the cloud. Creating worktrees inside the repo (`.ghostlink-worktrees/`) means OneDrive syncs every worktree's files. This causes:
- Excessive sync traffic during multi-agent parallel work
- Potential file locking conflicts between OneDrive sync and git operations
- Wasted cloud storage for temporary worktree files

The existing code (`routes/agents.py` line 93) already warns about OneDrive + WSL but does not warn about OneDrive + worktrees.

**Mitigation:** Create worktrees outside the OneDrive-synced directory tree (e.g., `C:\ghostlink-worktrees\`). The `worktree.py` code currently hardcodes `.ghostlink-worktrees` under the base workspace. This path should be configurable.

### Other issues

- **Arena mode (5.5) effort is large.** Dispatching N agents, waiting for all, collecting results, comparing diffs, grading with evals, and presenting a comparison UI is a full feature. This alone is 1-2 weeks of work but it is listed as one sub-deliverable of a 2-3 week phase.

### Effort estimate (2-3 weeks): UNDERESTIMATED. Phase 5 has 7 sub-deliverables (worktrees, background execution, lifecycle hooks, AGENTS.md, arena, spec-driven dev, collaboration patterns). Each is substantial. Realistic: **4-6 weeks** if all sub-deliverables ship. The "initial implementation: supervisor pattern only" note for 5.7 is the right kind of scope cut, but more scope cuts may be needed.

### Simpler alternative

Split Phase 5 into:
- 5A: Worktrees + background execution (2 weeks) -- the core value
- 5B: Hooks + AGENTS.md (1-2 weeks) -- needed for governance
- 5C: Arena + spec-driven + collaboration (2-3 weeks) -- can defer

---

## Phases 6-10 (Later Phases)

These phases are far enough out that detailed code-level auditing is less useful. High-level observations:

### Phase 6 - Memory
- The four-layer memory model is architecturally sound.
- "Dreaming" (session-end summarization + promotion) is an interesting idea but needs careful cost management -- running a summarization pass after every session adds token cost.
- Cross-agent memory coordination has race condition risks with the JSON-file-based memory store. Consider migrating memory to SQLite before Phase 6.

### Phase 7 - Media Generation
- Low risk. Purely additive MCP tools. The async task pattern (return task ID, poll for completion) is already used elsewhere in the codebase.

### Phase 8 - A2A
- The existing `a2a_bridge.py` is a basic scaffold (agent card + JSON-RPC). The roadmap's A2A scope is much larger (SSE streaming, push notifications, conformance tests). The A2A spec itself is still maturing; building a full conformance suite may hit a moving target.
- Identity mapping between GhostLink and A2A models depends on Phase 1A's identity record being complete and stable.

### Phase 8.5 - Productization
- Versioning skills and profiles is conceptually clean. The main risk is data model complexity -- adding version metadata to every profile/skill record and managing upgrade paths.

### Phase 9 - UI, Accessibility
- `AgentCockpit.tsx` is confirmed at 1187 lines. The decomposition target (no file > 500 LOC) is reasonable.
- EU AI Act compliance (August 2026 deadline mentioned in roadmap) adds a hard deadline. This should be flagged as a time constraint, not just a phase.

### Phase 10 - Future
- Backlog. No issues.

---

## Cross-Cutting Issues

### Circular dependency check

No circular dependencies found between phases. The dependency chain is linear:
```
0 -> 1A -> 1B -> 2 -> 3 -> 3.5 -> 4A -> 4B -> 4.5 -> 5 -> ...
```

However, there is a **practical coupling** between Phase 1B (identity isolation) and Phase 5 (worktrees). Phase 1B claims to "remove dependence on shared workspace instruction files" but full isolation requires worktrees from Phase 5. This should be acknowledged: Phase 1B delivers GhostLink-side isolation; full workspace isolation requires Phase 5.

### Missing prerequisites

| Phase | Missing prerequisite |
|-------|---------------------|
| 1A | No UUID package prerequisite remains. Locked Phase 1A uses Python's built-in `uuid.uuid4().hex`; time-sorted IDs are explicitly deferred. |
| 1A | Database migration tooling for SQLite schema changes (no Alembic or equivalent present) |
| 3.5 | No existing checkpoint data model or storage mechanism |
| 4A | Container sandbox tier requires Docker on Windows (not a default install) |
| 5 | Worktree path configuration for OneDrive environments |

### Windows-specific blockers

| Issue | Impact | Mitigation |
|-------|--------|------------|
| No Landlock/seccomp | Container sandbox tier unavailable | Use Docker Desktop or defer container tier |
| OneDrive file sync | Worktree files sync unnecessarily | Make worktree path configurable, place outside OneDrive |
| `os.chmod` is a no-op | Security file permissions not enforced | Noted in `security.py` with `except OSError: pass` -- already handled |
| No `fcntl` module | File locking differences | Already handled: `mcp_bridge.py` line 9 checks for `fcntl` |

### "Sounds good but won't work" patterns

1. **"Egress allowlists: agents can only reach approved endpoints."** GhostLink does not control the network stack. Agent CLIs make direct HTTP calls. GhostLink can only gate MCP tool calls, not raw network access. The roadmap should scope this to "MCP tool call policy" not "network egress control."

2. **"Side-effect idempotency for replay."** This is an extremely hard distributed systems problem. LangGraph and Temporal invest massive engineering effort in this. Bolting it onto GhostLink's current architecture (which has no side-effect tracking) is a multi-week effort at minimum, not a sub-deliverable.

3. **"Hooks must be signed or from a trusted source."** Hook signing requires a key management system, a trust store, and a verification flow. This is a significant security engineering effort that is buried as one bullet in Phase 4A.

4. **"Identity survives compaction."** GhostLink does not control context compaction -- the CLI tool (Claude Code, Codex) does. GhostLink can only re-inject identity when the agent makes an MCP tool call after compaction. If the agent does not call an MCP tool, identity drift is undetectable.

5. **"Worktree-only sandbox: file access restricted to agent worktree."** On the current architecture, the CLI agent runs as a system process with the user's full permissions. GhostLink cannot restrict file access without OS-level sandboxing. "Worktree-only" is a convention (the agent is told to work in its worktree), not enforcement.

---

## Summary of Blocking Issues

| # | Phase | Issue | Severity |
|---|-------|-------|----------|
| 1 | 1A | Database migration needed for name-to-ID transition | Blocking |
| 2 | 1A | Memory filesystem paths keyed by display name need migration | Blocking |
| 3 | 1A | Skills config keyed by display name needs migration | Blocking |
| 4 | 1B | CLI instruction file isolation impossible without worktrees | Scope clarification needed |
| 5 | 3.5 | Side-effect idempotency mechanism unspecified | Design gap |
| 6 | 4A | Egress control scoped incorrectly (MCP vs network) | Scope clarification needed |
| 7 | 5 | OneDrive worktree sync conflict unaddressed | Environment blocker |

## Summary of Effort Adjustments

| Phase | Roadmap estimate | Audited estimate | Delta |
|-------|-----------------|------------------|-------|
| 1A | 3-5 days | 8-13 days | +5-8 days |
| 3 | 1-2 weeks | 2-3 weeks | +1 week |
| 3.5 | 1-2 weeks | 3-4 weeks | +2 weeks |
| 5 | 2-3 weeks | 4-6 weeks | +2-3 weeks |
| Total Pt1+Pt2 | ~20-29 weeks | ~28-40 weeks | +8-11 weeks |

## Recommended Immediate Actions

1. **Phase 1A scope decision:** Add `agent_id` as a UUID field first, then migrate subsystems incrementally. Do not try to add all 12+ identity fields at once.
2. **UUID decision is now resolved:** locked Phase 1A uses built-in `uuid.uuid4().hex`. Do not add `uuid_utils` or another UUID dependency in this phase.
3. **Database migration tooling:** Add a lightweight migration approach for SQLite schema changes before Phase 1A starts.
4. **Scope clarification for Phase 1B:** Document that full workspace isolation requires Phase 5 worktrees. Phase 1B delivers GhostLink-managed-state isolation only.
5. **Phase 3.5 split:** Separate checkpoint+resume from replay+fork+idempotency. Ship the first half early.
6. **Worktree path configuration:** Make the worktree base path configurable before Phase 5 implementation, so it can be placed outside OneDrive.
7. **Phase 5 scope cut:** Ship worktrees + background execution first. Defer arena, spec-driven, and collaboration to a later sub-phase.

---

## 2026-04-07 Follow-Up Audit Lock

The project discussion after this audit correctly narrowed **Phase 1A** to the four safe items below:

1. stable `agent_id`
2. persistent registry DB
3. dual name/ID lookup compatibility
4. memory/soul/notes path unification

The earlier broad Phase 1A draft should be treated as superseded where it included:
- provider adapters
- frontend state rekeying
- worktree key migration
- reconnect/session protocol redesign

Those were the three real blockers hiding inside the old draft:
- DB/API naming changes that would force frontend churn too early
- re-registration semantics that the current `/api/register` contract cannot safely support
- provider adapter work that belongs with Phase 1B runtime isolation, not storage identity

---

*End of Approach Audit*
