# GhostLink Phase 8 Test Plan

**Owner:** kurt  
**Date:** 2026-04-08  
**Status:** Ready before implementation  
**Spec:** `roadmap-pt2.md` Phase 8  
**Roadmap:** `UNIFIED_ROADMAP.md`, `roadmap-pt2.md`

---

## Scope

Phase 8 is A2A interoperability.

Primary outcomes:

1. GhostLink can expose local agents over A2A with valid agent-card publication
2. GhostLink can discover and call remote A2A agents as a client
3. Long-running A2A tasks stream progress over SSE and survive disconnects with push callbacks
4. Inbound and outbound A2A requests respect GhostLink policy, identity, and trace boundaries
5. GhostLink identity/task/artifact state round-trips cleanly through A2A protocol fields

This phase is protocol surface, not UI cosplay. If cards, auth, streaming, or mapping are half-true, reject it.

---

## Hard Constraints

Validation must enforce these:

- A2A exposure must be additive; local-only GhostLink behavior cannot regress when A2A is disabled
- agent cards must be truthful about capabilities, identity, endpoints, and auth expectations
- unsigned or invalidly signed cards/notifications must be rejected when signature enforcement is enabled
- inbound A2A task requests must run through the existing Phase 4A policy engine before any real work executes
- GhostLink `agent_id`, `task_id`, trace identifiers, and artifact references must map predictably to and from A2A fields
- streamed A2A task progress must stay aligned with GhostLink’s internal task state instead of becoming a parallel status lie
- disconnected long-running tasks must use authenticated callback flow or another explicit durable delivery path, not silent drops
- discovery must fail clearly when remote cards are missing, malformed, or unauthenticated
- A2A transport/auth failures must be auditable

If Phase 8 ships a pretty discovery UI over unverifiable cards, policy bypasses, or broken identity mapping, reject it.

---

## Validation Commands

After Phase 8 lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -m py_compile a2a.py routes\\a2a.py app.py deps.py`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`

If any Phase 4A, Phase 5, or Phase 6 gate regresses while A2A is added, Phase 8 fails.

---

## Acceptance Buckets

## P8-1. Agent Card Publication

### Must Be True

- GhostLink serves a valid agent card at the documented well-known route
- local exposed agents publish truthful identity and capability data
- card publication can be disabled without breaking local agent operation
- card signing metadata is present and verifiable when enabled

### Suggested Tests

- `test_agent_card_serves_at_well_known_endpoint`
- `test_agent_card_contains_truthful_identity_and_capabilities`
- `test_agent_card_signing_metadata_is_present_when_enabled`
- `test_disabling_a2a_exposure_removes_card_without_local_regression`

### Failure Conditions

- card omits or lies about identity/capabilities
- card path works only for one hardcoded agent
- signature metadata is decorative and unverifiable

---

## P8-2. A2A Client Discovery and Invocation

### Must Be True

- GhostLink can discover remote A2A agents from supported discovery sources
- malformed or unauthenticated remote cards fail clearly
- outbound invocation maps GhostLink task/trace state into the A2A request
- remote invocation results map back into GhostLink task/artifact state cleanly

### Suggested Tests

- `test_remote_agent_card_discovery_from_configured_endpoint`
- `test_malformed_remote_card_is_rejected_with_clear_error`
- `test_outbound_a2a_invocation_creates_mapped_ghostlink_task`
- `test_remote_artifacts_round_trip_back_into_ghostlink_state`

### Failure Conditions

- discovery silently ignores invalid cards
- outbound calls lose GhostLink task/trace identity
- remote results cannot be tied back to the initiating local task

---

## P8-3. Inbound Policy and Auth Enforcement

### Must Be True

- inbound A2A requests are evaluated by the Phase 4A policy engine before execution
- unsigned or invalidly signed inbound requests/cards are rejected when enforcement is enabled
- notification endpoints require authentication
- auth failures and rejected inbound requests are auditable

### Suggested Tests

- `test_inbound_a2a_request_is_checked_by_policy_before_execution`
- `test_unsigned_agent_card_is_rejected_when_signature_required`
- `test_invalid_notification_auth_is_rejected`
- `test_rejected_inbound_a2a_request_writes_audit_record`

### Failure Conditions

- inbound requests can bypass policy
- notification callbacks accept unauthenticated traffic
- auth rejection is invisible in audit trails

---

## P8-4. Streaming and Long-Running Tasks

### Must Be True

- long-running A2A tasks stream progress over SSE with truthful state transitions
- stream termination/failure does not corrupt the underlying GhostLink task state
- disconnected tasks can resume delivery through authenticated push/callback flow
- GhostLink operators can still inspect the task timeline locally

### Suggested Tests

- `test_a2a_long_running_task_streams_progress_over_sse`
- `test_sse_progress_matches_internal_task_state`
- `test_stream_failure_does_not_fake_task_completion`
- `test_disconnected_long_running_task_uses_authenticated_callback_delivery`

### Failure Conditions

- SSE stream says complete while the local task is not complete
- disconnect drops task completion on the floor
- callback flow is unauthenticated or untracked

---

## P8-5. Identity, Task, and Artifact Mapping

### Must Be True

- GhostLink `agent_id` maps cleanly to exposed A2A identity and back
- GhostLink `task_id` / trace identifiers map cleanly to A2A task/context fields
- artifact references survive the mapping without losing provenance
- mapping remains stable across retries/resume flow

### Suggested Tests

- `test_agent_id_round_trips_between_ghostlink_and_a2a_identity_fields`
- `test_task_id_and_trace_id_round_trip_without_collision`
- `test_artifact_namespace_mapping_preserves_provenance`
- `test_retry_or_resume_does_not_generate_conflicting_a2a_identity_mapping`

### Failure Conditions

- mapping changes between requests for the same underlying entity
- artifact provenance disappears at the protocol boundary
- retries create duplicate or conflicting task identities

---

## P8-6. UI Truthfulness

### Must Be True

- discovery UI reflects real discovered agents and real card metadata
- status/task surfaces show cross-platform task state truthfully
- remote invocation failures are visible and actionable
- no UI surface invents connection or capability state that the backend did not return

### Suggested Tests

- `test_discovery_ui_renders_real_remote_agent_cards`
- `test_cross_platform_task_progress_ui_matches_backend_stream`
- `test_remote_invocation_failure_renders_actionable_error_state`
- `test_a2a_capability_labels_match_backend_card_data`

### Failure Conditions

- UI assumes a healthy remote connection without backend confirmation
- remote agents appear callable when auth or discovery failed
- cross-platform task views drift from backend truth

---

## Exit Criteria

Phase 8 passes only if all of these are true:

- GhostLink can discover and call at least one remote A2A agent
- GhostLink exposes at least one local agent through a valid agent card at `/.well-known/agent-card.json`
- inbound A2A requests and callbacks respect policy/auth rules
- streamed and long-running A2A tasks stay truthful and auditable
- identity, task, and artifact mappings round-trip cleanly
- Phase 4A, 5, 6, and 7 gates remain green
