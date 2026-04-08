# GhostLink — Active Risks & Known Gaps

**Last updated:** 2026-04-07  
**Version:** v5.7.2

> This file tracks current open issues, structural risks, and release-relevant gaps. Historical audits and fixed bug archaeology have been moved out of the active surface.

---

## Critical

None currently open that block normal install, startup, or core chat use in the latest verified release cycle.

---

## High Priority

### Plugin trust model is incomplete

- Plugins are safety-scanned, but GhostLink still lacks:
  - install provenance/signing
  - owner-managed trust controls
  - durable exec approval allowlists
- Per-plugin tool allowlists and fail-closed pre-tool-use hooks are already implemented.
- This remains a top platform maturity gap and is tracked in the early roadmap phases in `UNIFIED_ROADMAP.md`.

### Agent identity isolation is incomplete

- GhostLink already isolates agent memory, tokens, notes, and soul in backend data directories.
- The remaining weakness is workspace-facing identity injection:
  - `.ghostlink-context.md` is shared at the workspace root
  - provider-specific instructions like `.claude/instructions.md` and `.codex/instructions.md` are also shared per workspace
- Result: if two same-provider agents share a repo, the most recent spawn can overwrite the context files the other instance was relying on.
- Planned fix: a per-agent identity pack with separate markdown files and provider injection paths.

### Task model is fragmented

- Jobs, agent task queues, and scheduled work are not unified into one task system or operator dashboard.
- This creates visibility and lifecycle drift even though each subsystem exists.

### Context control is too coarse

- Per-channel context visibility controls are not implemented yet.
- Agents can still see more shared channel context than the roadmap target allows.

### UI quality is still uneven

- Accessibility coverage is partial, not systematic.
- Loading, empty, and error states are inconsistent across major panels.
- `AgentCockpit` remains a large unsplit surface.

---

## Medium Priority

### Provider breadth is still behind the roadmap target

- Current code ships with 13 API providers.
- Roadmap expansion targets such as Bedrock, Kimi, Z.AI, and broader request override controls are still pending.

### Prompt caching and advanced memory are not implemented

- No prompt-cache fingerprinting/diagnostics yet
- No weighted recall/tagging/dreaming-style memory system yet

### OneDrive + WSL remains a platform constraint

- GhostLink mitigates this by copying to `/tmp` for WSL flows.
- It is functional, but still slower and less clean than a non-OneDrive install.

### OAuth and broader provider-native auth flows are incomplete

- Core provider use works through API keys and existing CLI auth flows.
- Broader browser-native/provider-native auth coverage is still incomplete.

---

## Low Priority / Deferred

- Mobile push notifications
- Multilingual UI
- Matrix / Teams / other bridge expansion
- Claude CLI bridge parity work

These are tracked as future platform work, not current release blockers.

---

## Recently Resolved In v5.7.x

- Launcher/setup wizard settings path mismatch
- `setupComplete` lifecycle drift between desktop and backend
- Wizard-to-launcher transition freeze risk
- Weak startup health verification
- Incomplete dependency install validation
- Unbounded export/share reads
- Runtime cache/memory growth issues
- Batch delete inefficiency
- Dead process cleanup gaps
- Reconnect API fanout spike
- Token streaming state-update hot path inefficiency

See [CHANGELOG.md](./CHANGELOG.md) for release detail and [UNIFIED_ROADMAP.md](./UNIFIED_ROADMAP.md) for the forward plan.
