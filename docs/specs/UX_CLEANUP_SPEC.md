# GhostLink UX Cleanup Spec — v6.1.0

**Owner:** jeff
**Status:** Spec for team review
**Last updated:** 2026-04-08
**Goal:** Make every visible UI element honest, clear, and functional. Strip dev internals from user-facing surfaces. One pass, one release.

---

## Principle

If a control is visible, it must work. If it's green, it must be usable. If it says "Configure," it must configure something real. If a label needs a tooltip to explain itself, rename the label. Hide everything else behind Advanced mode.

---

## 1. Experience Mode Gates (tyson — backend, frontend — jeff coordinates)

The app already has Beginner/Standard/Advanced experience modes. Use them.

**Beginner mode shows:**
- General settings (profile, theme, notifications)
- Agent list with start/stop
- Simple AI provider cards (name, status, login/key action)

**Standard mode adds:**
- Agent routing, persistent agents, supported agents
- Full AI provider details (model picker, capabilities)
- Channel bridges
- Skill packs, hooks, marketplace

**Advanced mode adds:**
- Secret Scopes, Trusted Hooks, Permission Presets
- Tool Usage Log, Audit Log
- Debug mode, Server Config, Server Logs, Maintenance
- Data Retention, Data Management
- Transport/auth/fallback/policy metadata on providers
- MCP Mode toggle

**Rule:** if the current experience mode is Beginner or Standard, Advanced-only sections must not render at all — not collapsed, not grayed out, gone.

### Files to modify
- `frontend/src/components/settings/AdvancedTab.tsx` — gate sections by experience mode
- `frontend/src/components/SettingsPanel.tsx` — gate AI provider detail sections, gate "More" tab sections

---

## 2. AI Settings Redesign (frontend — jeff coordinates)

### Current problem
Provider cards show transport, auth method, fallback, preferred model, policy risk, and health status — raw system metadata that means nothing to users.

### New design

**Default provider card (Beginner + Standard):**
```
[icon] Provider Name    [Paid/Free badge]    [Status dot]
       Model: [dropdown picker]
       [Login] or [Set API Key] or [Connected ✓]
```

**Advanced provider card (appends):**
```
       Transport: api | Auth: api_key | Fallback: failover
       Policy Risk: rate_limited | Health: Healthy
```

### Green dot rules
- Green = API key present AND health check passes
- Yellow = installed but not authenticated, or health degraded
- Gray = not installed / not configured
- Never green for "healthy backend config exists but user can't actually use it"

### Model picker
Each provider card gets a model dropdown populated from `PROVIDERS[provider].models` in `backend/providers.py`. This already exists in the backend — just needs frontend exposure.

### Files to modify
- `frontend/src/components/SettingsPanel.tsx` — redesign AI tab provider cards
- `frontend/src/components/ProviderOpsPanel.tsx` — simplify for non-Advanced mode

---

## 3. Settings Layout (frontend — jeff coordinates)

### Current problem
Settings is a narrow sidebar panel trying to hold 20+ sections.

### Fix
- Settings opens as a **full-page overlay** (like the wizard), not a sidebar
- Two-column layout: nav on left, content on right
- Sections load into the content area when clicked
- Close button returns to chat

### Files to modify
- `frontend/src/components/SettingsPanel.tsx` — change from sidebar to full-page overlay
- `frontend/src/App.tsx` — update settings toggle to use overlay

---

## 4. Strip Dev Jargon (frontend — jeff coordinates)

### Renames

| Current | New |
|---------|-----|
| Debug Mode | Developer Mode |
| Server Config | Server Settings |
| MCP Mode | Direct API Mode |
| TRANSPORT / AUTH / FALLBACK / PREFERRED | (hidden in non-Advanced) |
| Loop Guard: 4 Hops | Message limit per exchange: 4 |
| `--dangerously-skip-permissions` | (hidden — show "Full Access" preset name instead) |
| `--sandbox danger-full-access -a never` | (hidden — show "Full Bypass" preset name instead) |
| `codex --sandbox danger-full-access -a never` | Show: `Codex (Full Access)` |
| circuit breaker | Rate protection |
| egress controls | Outbound access rules |
| Policy Risk: rate_limited | (hidden in non-Advanced) |
| content_filtered | (hidden in non-Advanced) |

### Persistent agents display
Instead of: `codex --sandbox danger-full-access -a never`
Show: `Codex` with a small "Full Access" badge. Raw args visible only in Advanced mode.

### Files to modify
- `frontend/src/components/SettingsPanel.tsx` — persistent agent display
- `frontend/src/components/settings/AdvancedTab.tsx` — rename labels
- `frontend/src/components/settings/SecurityTab.tsx` — rename labels, gate by mode

---

## 5. Agent Chip + Cockpit Fix (frontend — jeff coordinates)

### Current problem
Clicking agent chips in header does nothing visible or opens cockpit janky.

### Fix
- Click agent chip → open agent info popover (name, status, model, quick actions: start/stop/config)
- If cockpit panel opens, it should slide in visibly from the right, not silently appear
- Offline agents: show "Start" button in popover
- Online agents: show status, model, stop button

### Files to modify
- `frontend/src/components/AgentBar.tsx` or equivalent header component
- `frontend/src/components/AgentCockpit.tsx` — ensure visible panel transition

---

## 6. Voice Section (frontend — jeff coordinates)

### Current problem
Voice section exists in General settings but only controls input language, not actual voice selection.

### Fix
- Rename "Voice" to "Speech Input" in Beginner/Standard mode
- Add actual TTS voice picker if TTS provider is configured (Google TTS voices are available)
- If no TTS provider configured, hide voice section entirely in Beginner mode

### Files to modify
- `frontend/src/components/SettingsPanel.tsx` — voice section

---

## 7. Channel Bridges Visual Fix (frontend — jeff coordinates)

### Current problem
Bridge entries use emoji characters instead of proper icons.

### Fix
- Replace emoji with Material Icons or SVG icons for Discord, Telegram, Slack, WhatsApp, Webhook

### Files to modify
- `frontend/src/components/SettingsPanel.tsx` — bridge section

---

## 8. Dead Controls Removal

### Remove or disable until functional:
- Voice call speaker button (permanently disabled, never works)
- Any "Configure" that doesn't open real config
- ContextModeSelector component (already removed from header, can keep file for future use)

---

## Execution Order

1. jeff writes this spec (done)
2. Team reviews and flags conflicts
3. tyson handles any backend changes (model list API if needed)
4. Frontend changes coordinated by jeff, executed in this order:
   a. Experience mode gates (biggest impact, gates everything else)
   b. AI settings redesign (provider cards + model picker)
   c. Settings full-page layout
   d. Jargon renames
   e. Agent chip/cockpit fix
   f. Voice section fix
   g. Bridge icons
   h. Dead control removal
5. kurt validates against live app via Playwright
6. Ship as v6.1.0 (minor version — visible UX changes)

---

## Acceptance Criteria

1. Beginner mode: zero dev jargon visible anywhere
2. Standard mode: no transport/auth/policy metadata visible
3. Every green dot = provider is actually usable
4. Every "Configure" button opens a real, useful action
5. Settings renders as full-page overlay, not sidebar
6. Agent chip click produces a visible, useful response
7. No raw CLI flags visible in Beginner or Standard mode
8. All existing tests still pass

---

## Version

This ships as **v6.1.0** — it's a user-visible UX overhaul, not a patch.
