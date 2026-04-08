# GhostLink Phase 4B Test Plan

**Owner:** kurt  
**Date:** 2026-04-08  
**Status:** Ready before implementation  
**Spec:** `docs/specs/PHASE_4_SPEC.md`  
**Roadmap:** `roadmap-pt2.md`

---

## Scope

Phase 4B is provider independence and cost control.

Primary outcomes:

1. Transport abstraction layer
2. Provider request overrides
3. Prompt cache optimization with measurable hit/miss tracking
4. Provider registry expansion
5. Per-agent/session/task cost tracking
6. Budget enforcement integrated with the policy engine
7. Failover routing and promotion back to preferred transports
8. Provider health and degraded-mode visibility

This phase is about real resilience and real accounting. Fake counters, silent fallbacks, and “best effort” budgets do not pass.

---

## Hard Constraints

Validation must enforce these:

- existing providers must still work through the new transport path
- failover must be automatic, logged, and traceable
- promotion back to the preferred transport must also be logged
- request overrides must change the real transport config, not only UI state
- cost tracking must be tied to actual request usage data where available
- budget enforcement must block before the request is sent
- budget exhaustion must route through the Phase 4A policy path
- prompt-cache optimization must be measurable, not just a code comment about sorting
- CLI-backed providers must be treated honestly when usage data is partial

If the implementation ships a transport abstraction that breaks working providers or a cost system that only estimates after the fact, Phase 4B fails.

---

## Validation Commands

After Phase 4B lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -c "import app; print(app.__version__)"`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`

If any previously green command fails, Phase 4B fails validation.

---

## Acceptance Buckets

## P4B-1. Transport Abstraction

### Must Be True

- at least one existing provider uses the new `Transport` interface end-to-end
- transport capability flags are real and match runtime behavior
- provider health is tracked per transport
- direct-call fallback remains available where the spec requires it

### Suggested Tests

- `test_existing_provider_uses_transport_interface`
- `test_transport_capabilities_match_runtime_behavior`
- `test_transport_health_marks_unhealthy_after_failure`
- `test_direct_call_fallback_transport_still_works`

### Failure Conditions

- transport abstraction exists on paper but real requests still bypass it
- capabilities are declared but not enforced

---

## P4B-2. Automatic Failover and Promotion

### Must Be True

- when the active transport fails, the next transport or provider is tried automatically
- failover emits audit and trace events
- frontend/operator surfaces receive failover status updates
- when the preferred transport recovers, promotion back happens and is logged

### Suggested Tests

- `test_transport_failure_triggers_failover`
- `test_failover_emits_audit_and_trace_events`
- `test_failover_status_broadcast_reaches_frontend_surface`
- `test_primary_transport_recovery_triggers_promotion`

### Failure Conditions

- failover requires manual intervention
- failover happens silently with no audit/trace record
- promotion never happens or happens without operator visibility

---

## P4B-3. Provider Request Overrides

### Must Be True

- `base_url`, headers, proxy, and TLS cert overrides affect the real request path
- override data is stored in the real provider config, not transient UI state
- invalid override config fails clearly instead of producing a silent half-working transport

### Suggested Tests

- `test_custom_base_url_is_used`
- `test_custom_headers_are_attached_to_request`
- `test_proxy_override_is_applied`
- `test_tls_cert_override_is_applied_or_errors_clearly`
- `test_invalid_override_config_is_operator_visible`

### Failure Conditions

- overrides render in the UI but do not affect network behavior
- invalid overrides fail silently

---

## P4B-4. Prompt Cache Optimization

### Must Be True

- tool ordering is deterministic
- repeated equivalent requests for the same agent hit the prompt cache
- cache hit/miss counters are exposed in diagnostics
- cache state changes when the effective prompt identity changes

### Suggested Tests

- `test_deterministic_tool_ordering_produces_identical_prompt_prefix`
- `test_identical_request_produces_cache_hit`
- `test_prompt_change_produces_cache_miss`
- `test_cache_diagnostics_report_hits_and_misses`

### Failure Conditions

- “cache optimization” is only inferred from sorted code paths with no measurable output
- counters are missing or clearly inconsistent

---

## P4B-5. Cost Tracking

### Must Be True

- a `cost_records` row is written for provider requests
- cost tracking is attributed by agent, session, task, provider, and model
- token counts use real provider usage data where available
- partial/derived accounting for CLI-backed providers is labeled honestly

### Suggested Tests

- `test_cost_record_created_for_provider_request`
- `test_cost_record_includes_agent_session_task_provider_model`
- `test_token_counts_match_provider_usage_headers`
- `test_cli_transport_cost_record_is_marked_derived_when_needed`
- `test_cost_aggregation_by_agent_and_day`

### Failure Conditions

- cost data is only aggregate and cannot be tied back to a task/session
- fake precision is presented for providers that do not expose usage data

---

## P4B-6. Budget Enforcement

### Must Be True

- warning events fire before hard-stop at the configured threshold
- hard-stop blocks the request before it is sent
- budget exhaustion flows through the Phase 4A policy decision path
- bypass flags or emergency overrides work only where explicitly configured

### Suggested Tests

- `test_budget_warning_emits_before_limit`
- `test_budget_hard_stop_blocks_request_pre_send`
- `test_budget_exhaustion_triggers_policy_engine_decision`
- `test_budget_bypass_flag_is_honored_only_when_enabled`

### Failure Conditions

- budgets are enforced after money is already spent
- budget block does not create the expected policy/audit trail

---

## P4B-7. Routing and Provider Health

### Must Be True

- routing selects different model/provider tiers for meaningfully different task complexity
- explicit task/provider overrides bypass routing as specified
- degraded-mode behavior is truthful: failover, queue, or fail
- provider health and degraded mode are visible in operator surfaces

### Suggested Tests

- `test_low_complexity_request_routes_to_fast_tier`
- `test_high_complexity_request_routes_to_premium_tier`
- `test_explicit_task_override_bypasses_routing`
- `test_degraded_mode_behavior_matches_provider_config`
- `test_provider_health_surface_matches_backend_status`

### Failure Conditions

- routing is random, sticky in the wrong places, or invisible
- degraded mode says “healthy” while the system is actually failing over

---

## P4B-8. Provider Expansion

### Must Be True

- at least two of the new providers work in a basic completion/integration test
- provider metadata includes transport mode and auth method correctly
- policy-risk flags surface correctly in the operator UI

### Suggested Tests

- `test_bedrock_basic_request_path`
- `test_kimi_or_glm_basic_request_path`
- `test_new_provider_metadata_includes_transport_and_auth`
- `test_policy_risk_flags_render_in_provider_management_ui`

### Failure Conditions

- providers are listed but not actually usable
- auth/transport metadata is wrong or missing

---

## Frontend Cost and Provider Surfaces

These checks matter because operators need to understand routing, spend, and degraded state:

- `test_cost_dashboard_matches_backend_aggregates`
- `test_budget_config_round_trips_real_backend_values`
- `test_failover_status_surface_updates_on_provider_failover`
- `test_cache_hit_miss_diagnostics_surface_matches_backend_metrics`
- `test_provider_health_indicators_match_backend_transport_health`

Failure if the UI shows nice charts that do not match backend data.

---

## Regression Checks

Keep these green:

- Phase 4A policy engine and budget-to-policy integration path
- Phase 3 audit and control plane surfaces
- Phase 3.5 tracing and replay compatibility for failover/routing events
- existing provider functionality for already-supported providers

Phase 4B adds resilience and accounting. It must not break the current provider path just to add abstractions.

---

## Manual Stress Checks

Run these before calling Phase 4B done:

1. Force the primary transport for a working provider to fail and verify automatic failover.
2. Restore the primary and verify promotion back is logged and visible.
3. Apply a custom provider `base_url` override and confirm requests hit it.
4. Send two equivalent requests and verify a cache hit on the second one.
5. Exhaust a tiny budget and confirm the next request is blocked before send.
6. Compare cost records against provider usage data for at least one provider that exposes headers.
7. Verify the operator dashboard shows the same failover, budget, and cache state the backend reports.

---

## Exit Rule

Phase 4B passes only if:

- transport abstraction is real and does not regress existing providers
- failover and promotion work automatically and are visible
- request overrides affect real transport behavior
- cost tracking is accurate enough to trust
- budgets block before spend and integrate with policy
- cache optimization is measurable
- new providers are actually usable, not just declared

If the phase mostly adds config knobs and dashboard widgets without robust failover and trustworthy accounting, reject it.
