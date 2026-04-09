# GhostLink v6.1.0 UX Cleanup Test Plan

**Owner:** kurt  
**Version target:** v6.1.0  
**Last updated:** 2026-04-08

---

## Purpose

This plan turns the live usability failures from Finn's desktop testing into explicit ship gates.

The release does **not** pass if the app merely builds. It must survive real click-through use without exposing fake readiness, dead controls, or dev-only language on user-facing surfaces.

---

## Critical Live-Failures To Prevent

These all happened in live use and must be treated as regression blockers:

1. Launcher rendered but buttons did nothing
2. Auto-update release existed but updater metadata was missing
3. Connected-provider `Switch` action opened the wrong flow and failed through terminal/WSL
4. Header controls (`Context`, unlabeled icon) were unclear or dead
5. Agent chip click produced broken-looking state instead of a clear popover/panel
6. AI settings showed green/healthy/configured states without real usability
7. Settings sidebar was too dense to explain or operate safely
8. Jargon-heavy labels exposed implementation details instead of user actions

---

## Gate 1: Experience Mode Truthfulness

- [ ] Beginner mode shows no dev/internal jargon anywhere in visible settings UI
- [ ] Standard mode hides transport/auth/fallback/policy metadata
- [ ] Advanced-only sections are fully absent in Beginner and Standard mode
- [ ] Hidden sections are not merely collapsed, disabled, or visually muted
- [ ] No raw CLI flags are visible in Beginner or Standard mode

### Must verify live

- [ ] Switch between Beginner / Standard / Advanced and confirm the visible surfaces change correctly
- [ ] Screenshots of each mode prove the gating is real

---

## Gate 2: Provider Card Honesty

- [ ] Green provider dot means the provider is actually usable now
- [ ] Yellow provider state is used for incomplete auth / degraded health / partial readiness
- [ ] Gray provider state is used for not installed / not configured
- [ ] No provider card shows `Healthy` or green if the user cannot actually use/configure it
- [ ] Beginner/Standard cards show plain actions only: Login, Set API Key, Connected, Switch Account

### Must verify live

- [ ] At least one configured provider shows usable status and successful action path
- [ ] At least one incomplete provider shows non-green state
- [ ] AI settings panel no longer reads like debug output in Beginner mode

---

## Gate 3: Account/Auth Switching

- [ ] Connected providers expose a clear account-change action
- [ ] Action label is explicit (`Switch Account`, `Reconnect`, or equivalent)
- [ ] Gemini flow offers a real auth-method choice before any terminal/CLI path
- [ ] Gemini switch does not silently dump the user into a broken terminal flow
- [ ] Missing CLI dependencies (for example `gcloud`) are surfaced in-app with a useful action, not a dead shell
- [ ] API key path and browser/account login path are both reachable where supported

### Must verify live

- [ ] Gemini connected-state flow can switch away from one account/tier to another
- [ ] User can choose account login vs API key where the provider supports both
- [ ] No auth action ends in a dead terminal-only experience without explanation

---

## Gate 4: Settings Usability

- [ ] Main settings open in a full-page overlay, not a cramped sidebar
- [ ] Left navigation / right content layout is readable at desktop widths
- [ ] Each settings section has one obvious purpose
- [ ] `Configure` is shown only where a real config flow exists
- [ ] Dead controls are removed or disabled with honest explanation
- [ ] Dense provider/system metadata is gated to Advanced mode only

### Must verify live

- [ ] Open Settings from the app and navigate all major tabs without layout breakage
- [ ] No section requires guesswork to understand its purpose
- [ ] No placeholder-looking control survives in Beginner/Standard mode

---

## Gate 5: Header / Agent Interaction

- [ ] No confusing `Context`-style mystery control remains in the main header
- [ ] Any remaining icon-only action has a clear tooltip and real behavior
- [ ] Clicking an agent chip opens a visible, useful response
- [ ] Agent chip interaction does not mutate the trigger into a worse-looking broken state
- [ ] Offline agent popover/panel offers useful action
- [ ] Online agent popover/panel shows real status and quick actions

### Must verify live

- [ ] Click each agent chip and record the visible result
- [ ] No top-bar control appears interactive while doing nothing

---

## Gate 6: Voice / Speech Honesty

- [ ] `Voice` is renamed if it only configures speech input
- [ ] If no actual TTS voice choice exists, no fake voice-picker UI is shown
- [ ] If TTS is available, voice selection is real and user-facing
- [ ] Voice call speaker button is removed or clearly disabled until functional

---

## Gate 7: Launcher / Update Truth

- [ ] Launcher buttons work after install: close, minimize, start server
- [ ] Launcher status hydrates correctly: version, updates, connections
- [ ] Release asset publishing includes updater metadata (`latest.yml`, platform variants) before release is called ready
- [ ] In-app update visibility exists or is explicitly tracked as a known UX gap if not yet implemented

### Must verify live

- [ ] Fresh desktop install boots to a working launcher
- [ ] Auto-updater can detect a valid release without 404 metadata failure

---

## Manual Smoke Script

Run this against the actual desktop app, not just component tests:

1. Launch app from installed desktop build
2. Confirm launcher controls work
3. Start server
4. Open app UI
5. Open Settings
6. Validate Beginner / Standard / Advanced mode behavior
7. Open AI settings and inspect provider cards
8. Try connected-provider switch flow, especially Gemini
9. Click header controls and agent chips
10. Confirm no mystery/dead controls remain on the tested surfaces

---

## Required Automated Coverage

- [ ] Frontend tests cover mode gating for Beginner / Standard / Advanced
- [ ] Frontend tests cover provider-card status mapping
- [ ] Frontend tests cover no-render behavior for Advanced-only sections
- [ ] Desktop smoke or Playwright-style automation covers launcher boot and core click paths
- [ ] Auth flow regression test covers Gemini switch path selection

---

## Ship Decision

`v6.1.0` is blocked if any of the following remain true:

- beginner surface still contains dev jargon
- green still means "looks configured" instead of "usable now"
- a `Configure` or `Switch` action does not do something real
- a main-header control is visible but unclear or dead
- settings still behave like a packed debug sidebar
- agent-chip click still produces broken-looking interaction
- release/update truth cannot be verified from the actual installed app
