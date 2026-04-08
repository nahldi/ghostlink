# GhostLink — Active Risks & Known Gaps

**Last updated:** 2026-04-08  
**Version:** v6.0.0

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

### Prompt caching diagnostics need hardening

- Cache diagnostics now exist in the product surface, but advanced prompt-cache fingerprinting and provider-level validation are not yet production-hardened.
- This is a maturity gap, not a missing concept.

### Plugin trust model is improved but not complete

- Hook signing, policy snapshots, and fail-closed blocking hooks shipped in `v6.0.0`.
- Remaining gaps:
  - install provenance verification
  - owner-managed trust controls
  - durable exec approval allowlists

---

## Medium Priority

### Provider breadth is still behind the roadmap target

- Current code ships with 21 API providers.
- Broader request override controls and deeper provider-specific transport maturity are still pending.

### Repo hygiene has one tracked build artifact exception

- `desktop/main/server.js` is a tracked compiled file while similar generated desktop output is ignored.
- This does not block the release, but it should be an explicit keep-or-remove policy decision rather than accidental drift.

### OneDrive + WSL remains a platform constraint

- GhostLink mitigates this by copying to `/tmp` for WSL flows.
- It is functional, but still slower and less clean than a non-OneDrive install.

### Translation coverage is incomplete

- The i18n framework exists, but multilingual UI coverage is still partial.
- This is a shipped-platform gap, not a roadmap fiction gap.

---

## Low Priority / Deferred

- Mobile push notifications
- Multilingual UI
- Matrix / Teams / other bridge expansion
- Claude CLI bridge parity work

These are tracked as future platform work, not current release blockers.

---

## Recently Resolved In v6.0.0

- Stable `agent_id`, SQLite persistence, and dual name/ID lookup
- Unified operator task model with structured progress
- Durable execution: checkpoints, replay, fork, pause/resume
- Policy engine, approval tiers, egress controls, circuit breakers, hook signing
- Provider expansion to 21 providers with cost tracking and failover support
- A2A interoperability surfaces and productization flows
- Media generation async task surfaces
- Accessibility and UI decomposition pass

See [CHANGELOG.md](./CHANGELOG.md) for release detail and [UNIFIED_ROADMAP.md](./UNIFIED_ROADMAP.md) for the forward plan.
