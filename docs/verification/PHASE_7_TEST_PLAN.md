# GhostLink Phase 7 Test Plan

**Owner:** kurt  
**Date:** 2026-04-08  
**Status:** Ready before implementation  
**Spec:** `roadmap-pt2.md` Phase 7  
**Roadmap:** `UNIFIED_ROADMAP.md`, `roadmap-pt2.md`

---

## Scope

Phase 7 is media generation.

Primary outcomes:

1. Video generation MCP tool with async delivery and inline playback
2. Music generation MCP tool with async delivery and inline playback
3. Enhanced image generation with additional providers plus editing flows
4. Media task progress visibility in chat and task dashboard
5. Media generation cost tracking folded into the existing Phase 4B accounting path

This phase is visible product value, but it still fails if the async lifecycle lies, the rendering path is fake, or costs disappear into a side channel.

---

## Hard Constraints

Validation must enforce these:

- media tools must use the existing MCP bridge, transport, routing, and cost machinery instead of inventing a sidecar execution path
- long-running media work must be truthful async work: task ID first, progress while pending, media URL only when complete
- unsupported or unconfigured providers must fail clearly with a real error, not a silent no-op
- inline rendering must reflect actual completed media artifacts, not placeholder UI pretending success
- image editing must preserve source/result lineage so operators can tell what was edited from what
- media generation costs must show up in the same per-agent/session accounting model used by Phase 4B
- task dashboard state for media jobs must stay aligned with the Phase 3/5 task model instead of introducing fake custom states
- timeout, cancellation, and provider-failure paths must leave the task system and chat UI in a truthful final state

If Phase 7 ships pretty players over fake async completion, broken task state, or missing cost attribution, reject it.

---

## Validation Commands

After Phase 7 lands:

- `cd backend && python -m pytest tests/ -q`
- `cd backend && python -m py_compile mcp_bridge.py providers.py transport.py app.py`
- `cd frontend && cmd /c npx vitest run`
- `cd frontend && cmd /c npx tsc --noEmit`
- `cd frontend && cmd /c npm run build`
- `cd frontend && cmd /c npm run lint`
- `cd desktop && cmd /c npx tsc --noEmit`
- `cd desktop && cmd /c npm run build`

If any previously green Phase 5 or 6 gate regresses while media capability is added, Phase 7 fails.

---

## Acceptance Buckets

## P7-1. Video Generation Async Lifecycle

### Must Be True

- `generate_video` returns a task identifier immediately for long-running generation
- task polling or callback delivery advances through truthful progress states
- completion payload includes a durable media URL plus provider/model metadata
- cancellation and timeout leave the task in an honest terminal state
- provider fallback follows the existing routing/failover model

### Suggested Tests

- `test_generate_video_returns_task_id_before_completion`
- `test_video_generation_progress_transitions_are_truthful`
- `test_video_generation_completion_returns_playable_artifact_url`
- `test_video_generation_timeout_returns_error_state_without_fake_success`
- `test_video_generation_provider_failover_records_real_fallback`

### Failure Conditions

- tool blocks until media is ready instead of using async lifecycle
- task is marked complete before artifact delivery exists
- fallback happens without being reflected in task/cost metadata

---

## P7-2. Music Generation Async Lifecycle

### Must Be True

- `generate_music` follows the same async contract as video generation
- audio completion payload includes playable artifact metadata
- progress, cancel, and failure states are visible in the normal task system
- missing-provider cases fail loudly and clearly

### Suggested Tests

- `test_generate_music_returns_task_id_before_completion`
- `test_music_generation_progress_is_visible_in_task_store`
- `test_music_generation_completion_returns_audio_artifact_url`
- `test_music_generation_cancel_marks_task_cancelled`
- `test_music_generation_without_provider_returns_clear_error`

### Failure Conditions

- music generation uses a one-off task flow different from video
- UI gets an audio player without a completed artifact
- no-provider cases silently disappear

---

## P7-3. Image Provider Expansion and Editing

### Must Be True

- expanded image generation preserves the current generation flow for existing providers
- editing endpoints accept a source image plus edit parameters and preserve source/result linkage
- inpainting and outpainting produce distinct, truthful result metadata
- unsupported editing capabilities are reported clearly per provider

### Suggested Tests

- `test_existing_image_generation_path_still_works_after_provider_expansion`
- `test_image_editing_preserves_source_artifact_reference`
- `test_inpainting_and_outpainting_return_truthful_edit_metadata`
- `test_provider_capability_mismatch_returns_clear_editing_error`
- `test_style_transfer_result_is_distinguished_from_new_generation`

### Failure Conditions

- existing image generation regresses while editing support is added
- edited results lose the source artifact reference
- provider capability lies are papered over in the UI

---

## P7-4. Inline Rendering and Operator Surfaces

### Must Be True

- completed video artifacts render inline as playable video
- completed music artifacts render inline as playable audio
- generated and edited images render inline with full-size access and download path
- task progress for media jobs appears in chat and the task dashboard without contradictory state
- rendering surfaces degrade cleanly when a browser/runtime cannot play the artifact inline

### Suggested Tests

- `test_chat_renders_completed_video_with_playback_and_download`
- `test_chat_renders_completed_audio_with_controls_and_download`
- `test_chat_renders_generated_and_edited_images_inline`
- `test_media_task_progress_in_chat_matches_dashboard_state`
- `test_unplayable_media_falls_back_to_download_without_broken_ui`

### Failure Conditions

- media messages render as generic attachments with no inline handling
- task dashboard state disagrees with chat progress cards
- players appear before the artifact is actually ready

---

## P7-5. Cost Tracking and Regression Boundaries

### Must Be True

- media generation costs are attributed per agent and per session in the Phase 4B accounting model
- provider/model routing metadata survives into cost records
- zero-cost or unknown-cost responses are labeled honestly
- media jobs do not break existing text/image cost accounting

### Suggested Tests

- `test_video_generation_costs_flow_into_usage_snapshot`
- `test_music_generation_costs_flow_into_usage_snapshot`
- `test_unknown_media_costs_are_labeled_unpriced_or_partial`
- `test_media_cost_records_preserve_provider_and_model_metadata`
- `test_existing_text_and_image_cost_accounting_does_not_regress`

### Failure Conditions

- media costs are missing from usage snapshots
- costs show up only in a media-specific dashboard and not the normal accounting path
- accounting mode lies about measured versus derived media pricing

---

## Exit Criteria

Phase 7 passes only if all of these are true:

- at least one video provider completes an end-to-end async generation flow with inline playback
- at least one music provider completes an end-to-end async generation flow with inline playback
- image editing works end to end for at least one supported editing provider
- media task progress is truthful in both chat and task dashboard
- media costs appear in the normal per-agent cost surfaces
- Phase 5 and 6 regression gates remain green
