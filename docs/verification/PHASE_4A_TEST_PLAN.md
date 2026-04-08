# GhostLink Phase 4A Test Plan

**Owner:** kurt  
**Date:** 2026-04-08  
**Status:** Ready before implementation  
**Spec:** `docs/specs/PHASE_4_SPEC.md`  
**Roadmap:** `roadmap-pt2.md`

---

## Scope

Phase 4A is the policy engine and sandboxing tranche.

Primary outcomes:

1. Unified policy engine for tool calls, shell execution, and other governed actions
2. Per-tool and per-scope allow/ask/deny/escalate behavior
3. Real egress controls and SSRF protection beyond webhook-only checks
4. Sandbox tier enforcement, especially `worktree_only`
5. Secret scoping and redaction in logs, traces, and audit export
6. Circuit breakers for destructive behavior
7. Hook trust/signing enforcement for block-type hooks

This phase is about enforceable controls. Advisory warnings do not count.

---

## Hard Constraints

Validation must enforce these:

- dangerous actions must be blockable even if the model keeps asking for them
- policy evaluation must happen at the real choke points, not in optional helper paths
- egress controls must apply to agent-initiated outbound requests, not just webhooks
- `worktree_only` must enforce path boundaries after path resolution, including symlinks
- secret redaction must cover logs, traces, audit exports, and operator surfaces
- circuit breakers must halt execution, not just log warnings
- unsigned or untrusted block-type hooks must not run

If the implementation mostly labels actions by risk without actually enforcing the decisions, Phase 4A fails.

---

## Validation Commands

After Phase 4A lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -c "import app; print(app.__version__)"`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`

If any previously green command fails, Phase 4A fails validation.

---

## Acceptance Buckets

## P4A-1. Unified Policy Evaluation

### Must Be True

- there is one policy engine used by both MCP tool execution and shell execution
- policy rules are stored in the runtime DB, not split across unrelated JSON files and hardcoded tables
- rule evaluation follows the documented specificity and priority rules
- locked overrides cannot be bypassed by narrower scopes

### Suggested Tests

- `test_tool_invocation_flows_through_policy_engine`
- `test_shell_exec_flows_through_policy_engine`
- `test_most_specific_rule_wins`
- `test_override_locked_rule_cannot_be_overridden`
- `test_tier_default_applies_when_no_rule_matches`

### Failure Conditions

- tool calls still bypass the policy engine
- `ExecPolicy` keeps making separate decisions from the new engine
- scope precedence is inconsistent between code paths

---

## P4A-2. Dangerous Action Blocking

### Must Be True

- blocked actions are actually denied at runtime
- ask-mode actions queue for approval and do not proceed before approval
- escalate-mode actions halt the action and generate a high-priority operator-visible event
- policy denial remains effective even if the agent retries or reframes the request

### Suggested Tests

- `test_denied_tool_cannot_execute_even_after_retry`
- `test_ask_mode_blocks_until_operator_decision`
- `test_escalate_mode_creates_operator_alert_and_halts`
- `test_dangerous_git_mutation_hits_policy_engine`

### Failure Conditions

- blocked actions still execute
- ask-mode is only a UI prompt while the backend already ran the action

---

## P4A-3. Egress Controls and SSRF

### Must Be True

- outbound requests are checked against explicit egress rules
- deny rules win over allow rules
- internal/private network targets are blocked for webhook/notification and agent egress flows
- blocked requests are logged in a structured way

### Suggested Tests

- `test_denied_domain_egress_is_blocked`
- `test_allowed_domain_egress_is_permitted`
- `test_private_ip_webhook_is_blocked`
- `test_private_ip_agent_egress_is_blocked`
- `test_egress_decision_is_logged`

### Failure Conditions

- only webhook routes are protected
- agent-side HTTP calls bypass the egress layer
- SSRF checks can be bypassed by alternate host formatting or redirects without evaluation

---

## P4A-4. Sandbox Tiers

### Must Be True

- task sandbox tier is assigned and visible
- `worktree_only` prevents resolved paths from escaping the worktree
- shell execution in `worktree_only` uses the correct sandbox root or working directory
- unsupported tiers degrade explicitly instead of silently pretending isolation exists

### Suggested Tests

- `test_task_uses_assigned_sandbox_tier`
- `test_worktree_only_blocks_path_outside_worktree`
- `test_worktree_only_blocks_symlink_escape`
- `test_shell_exec_uses_worktree_root_under_worktree_only`
- `test_unsupported_container_or_namespace_tier_reports_truthfully`

### Failure Conditions

- sandbox tier is just metadata with no enforcement
- path checks ignore symlink resolution
- unsupported platforms claim isolation they do not have

---

## P4A-5. Secrets Access and Redaction

### Must Be True

- secrets are scoped to the requesting agent/task/profile rules
- out-of-scope secret access is denied
- secrets do not appear in logs, traces, audit exports, or replay surfaces
- redaction preserves enough context to debug without leaking raw secrets

### Suggested Tests

- `test_scoped_secret_access_allowed`
- `test_out_of_scope_secret_access_denied`
- `test_secret_redacted_from_logs`
- `test_secret_redacted_from_trace_events`
- `test_secret_redacted_from_audit_export`

### Failure Conditions

- secret values appear anywhere user-visible or exportable
- secret access rules are advisory only

---

## P4A-6. Circuit Breakers

### Must Be True

- repeated destructive actions in the configured window trigger the breaker
- breaker halts live execution or blocks subsequent destructive actions
- operator gets a visible notification with the reason and threshold hit
- cooldown/reset behavior is deterministic

### Suggested Tests

- `test_circuit_breaker_triggers_after_threshold`
- `test_circuit_breaker_blocks_further_destructive_actions`
- `test_circuit_breaker_notifies_operator`
- `test_circuit_breaker_resets_after_cooldown`

### Failure Conditions

- breaker only logs and does not stop anything
- breaker is global when the spec says it should be scoped

---

## P4A-7. Hook Trust / Signing

### Must Be True

- block-type hooks require a trusted signature or approved source
- unsigned block-type hooks are rejected
- non-block hooks follow the documented trust policy without accidentally escalating privileges
- trust decisions are auditable

### Suggested Tests

- `test_unsigned_block_hook_is_rejected`
- `test_trusted_signed_block_hook_runs`
- `test_non_block_hook_does_not_gain_block_privileges`
- `test_hook_trust_decision_is_logged`

### Failure Conditions

- any unsigned block hook runs
- hook trust status is invisible in auditability surfaces

---

## Frontend Policy Surfaces

These checks matter because operators need to see and configure the rules they are relying on:

- `test_policy_rule_editor_round_trips_real_backend_rules`
- `test_sandbox_tier_indicator_matches_backend_task_state`
- `test_circuit_breaker_surface_shows_active_halt_state`
- `test_egress_rule_editor_reflects_backend_allow_and_deny_rules`
- `test_secret_visibility_surface_does_not_leak_secret_values`

Failure if the UI presents a policy configuration that does not match backend enforcement.

---

## Regression Checks

Keep these green:

- Phase 3 unified task, cancel, context, and audit surfaces
- Phase 3.5 checkpoint/replay/fork/pause behavior
- existing webhook SSRF protections
- existing fail-closed `pre_tool_use` and fail-open `post_tool_use` behavior where still intended

Phase 4A hardens execution. It must not break the operator plane or durable execution to do it.

---

## Manual Stress Checks

Run these before calling Phase 4A done:

1. Configure one tool as `deny`, one as `ask`, and one as `allow`, then trigger all three from a live agent.
2. Attempt a destructive action repeatedly until the circuit breaker trips.
3. Attempt a file read/write outside a `worktree_only` sandbox, including through a symlink.
4. Trigger an outbound request to an internal/private target and confirm it is blocked and logged.
5. Run a flow that uses a secret and confirm the secret never appears in logs, audit export, or replay surfaces.
6. Attempt to run an unsigned block-type hook and confirm it is rejected.

---

## Exit Rule

Phase 4A passes only if:

- policy decisions are enforced at runtime
- dangerous actions can be blocked regardless of agent prompting
- egress and SSRF protections are real
- sandbox boundaries are enforced
- secrets stay redacted
- circuit breakers halt destructive behavior
- hook trust enforcement works

If the implementation is mostly policy metadata, dashboards, or prompts without hard enforcement, reject it.
