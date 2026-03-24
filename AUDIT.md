# GhostLink v2.5.1 — Full Project Audit

**Date:** 2026-03-24
**Audited by:** Claude (Opus 4.6)
**Scope:** Every file across backend, frontend, desktop, CI/CD, and GitHub releases

---

## Executive Summary

GhostLink is a local-first multi-agent AI chat platform (React + FastAPI + Electron) at version 2.5.1. The project is well-architected with strong separation of concerns, but this audit found **1 critical build-breaking bug**, **5 high-severity security issues**, **12 medium-severity issues**, and **20+ low-severity code quality issues** across 90+ source files.

The most urgent finding: **v2.5.1 has no release artifacts on GitHub** because the CI build failed due to a TypeScript error introduced in this version. The auto-updater cannot find v2.5.1, so users are stuck on v2.5.0.

---

## 1. CRITICAL: v2.5.1 Release Is Broken

### Root Cause
The `Build & Release` GitHub Actions workflow (run #23471775910) **failed on all 3 platforms** at the "Build frontend" step.

**The bug:** `ChatMessage.tsx` line 113 declares `const colorMap = useMemo(...)` but the variable is never read. With `noUnusedLocals: true` in `tsconfig.app.json`, TypeScript treats this as a compile error. The `tsc -b` step fails, Vite build never runs, no artifacts are produced, and the release job is skipped.

**Result:** The v2.5.1 GitHub Release exists but has **zero assets** — no `.exe`, no `.AppImage`, no `.dmg`, no `latest.yml`. The auto-updater sees v2.5.0 as latest.

### Fix Applied
Changed `const colorMap = useMemo(...)` to `useMemo(...)` (no assignment needed since the side-effect of setting `_agentColorMap` is the purpose). TypeScript now compiles cleanly.

### What's Needed Next
1. Commit the fix
2. Delete the broken v2.5.1 tag and release on GitHub
3. Re-tag as v2.5.1 (or bump to v2.5.2) and push
4. CI will build all 3 platforms and upload proper artifacts
5. Auto-updater will then see the new version

---

## 2. Security Issues

### HIGH Severity

| # | Issue | File(s) | Detail |
|---|-------|---------|--------|
| S1 | **XOR encryption fallback** | `backend/security.py` | If the `cryptography` library isn't installed, secrets fall back to XOR "encryption" which is trivially reversible. This should hard-fail instead. |
| S2 | **Wizard context isolation disabled** | `desktop/main/index.ts:118-121` | Wizard window runs with `nodeIntegration: true` + `contextIsolation: false`. Any XSS in the wizard gives full Node.js access (RCE). |
| S3 | **No code signing on updates** | `electron-builder.yml:30` | `signAndEditExecutable: false` means installers are unsigned. A MITM on the GitHub release download could swap the binary. |
| S4 | **Source maps shipped in dist** | `desktop/tsconfig.json` | `sourceMap: true` generates `.js.map` files that are included in the packaged app, exposing original TypeScript source. |
| S5 | **Token expiration not enforced** | `backend/registry.py` | `is_token_expired()` returns a bool but expired tokens are never rejected at the authentication layer — they remain usable. |

### MEDIUM Severity

| # | Issue | File(s) | Detail |
|---|-------|---------|--------|
| S6 | CSP too permissive | `desktop/renderer/launcher.html`, `wizard.html` | `'unsafe-inline'` and `'unsafe-eval'` in script-src allows injection |
| S7 | Secrets file permissions | `backend/security.py` | Encrypted secrets file not chmod 600 — world-readable on Unix |
| S8 | Command blocking insufficient | `backend/security.py` | Simple substring matching; `${IFS}rm${IFS}-rf${IFS}/` bypasses |
| S9 | Temp files world-readable (WSL) | `desktop/main/server.ts` | `/tmp/ghostlink-backend` has default umask — other users can read |
| S10 | Webhook signature not verified inbound | `backend/bridges.py` | Outbound webhooks are signed, but inbound webhooks aren't verified |
| S11 | GitHub token in process.env | `desktop/main/updater.ts` | Token read from gh CLI config could appear in error logs |
| S12 | Stale process killing overly broad | `desktop/main/server.ts:84-98` | `pkill -9 -f 'python.*app\\.py'` could kill unrelated Python processes |

---

## 3. Backend Audit (Python)

### app.py (Main FastAPI server)
- **Global state grows without cleanup:** `_agent_processes` dict never pruned
- **Settings not atomic:** Corrupted JSON on crash could brick settings (no backup/recovery)
- **Hardcoded cost estimates:** `_estimate_cost()` has outdated pricing — should be configurable
- **Rate limiting IP-only:** Fails with proxies; deque could grow with cycling IPs
- **WebSocket token is global:** Should be per-session, not shared across all connections
- **Missing endpoints:** No `/api/health` for monitoring, no graceful shutdown handler

### store.py (SQLite)
- **WAL sync mode too weak:** `synchronous=NORMAL` could lose writes on crash (should be FULL for durability)
- **No message size limits:** `text` column unlimited — could cause OOM
- **No soft delete:** Messages permanently gone with no recovery
- **FTS5 rebuild only on first run:** No way to manually rebuild if index drifts

### bridges.py (Discord/Telegram/Slack/WhatsApp)
- **No retry logic:** API calls fail silently with no exponential backoff
- **Server port hardcoded:** `127.0.0.1:8300` not configurable — breaks if port changes
- **Discord API version hardcoded:** `/api/v10` could break on deprecation
- **Message cache unbounded:** Could accumulate duplicates

### security.py
- **XOR fallback is broken encryption** (see S1 above)
- **Command blocking uses simple substrings:** False positives ("sudo" matches "asudo") and bypassable
- **Approval-required list matches partial strings**

### registry.py
- **Token TTL not enforced** (see S5 above)
- **No token revocation mechanism**
- **Slot counter not persisted:** Agent slots collide after restart

### router.py
- **@mention regex too strict:** `@(\w[\w-]*)` doesn't allow dots in agent names
- **Smart routing keyword matching is brittle:** "code" matches both "code-review" and "encode"
- **No @channel or @here syntax**

### mcp_bridge.py / mcp_proxy.py
- **`_empty_read_count` dict never cleaned up:** Could grow indefinitely
- **No authentication at MCP level:** Direct calls bypass proxy security
- **MCP proxy sends tokens in plaintext HTTP** — no HTTPS enforcement

### schedules.py
- **Cron implementation incomplete:** Missing `L`, `W`, `#`, `?` operators
- **Step values start from 0 incorrectly:** `*/5` gives 0,5,10... not 5,10,15...
- **No timezone support:** All times UTC with no conversion
- **No validation of cron expressions before saving**

### plugin_loader.py / plugin_sdk.py
- **No plugin isolation:** Bad plugin crashes entire server
- **Safety scanner incomplete:** Doesn't catch `importlib.import_module("os")` or `getattr(os, 'system')`
- **Event bus is synchronous:** One slow handler blocks all others
- **No plugin versioning or update mechanism**

### agent_memory.py
- **Race condition in save():** No lock between read and write — concurrent writes lose data
- **No size limits:** Memory files can grow unbounded
- **Bare exception handling:** `except Exception:` swallows all errors silently

### Other backend files
- **jobs.py:** No input validation on title/body length; no CASCADE delete for orphaned replies
- **rules.py:** Hard limit of 10 active rules (not configurable)
- **sessions.py:** Templates hardcoded with no way to delete built-ins
- **wrapper.py:** Multiple overlapping regex passes for thinking output sanitization
- **wrapper_unix.py:** No tmux error handling; restart loop has no graceful shutdown

---

## 4. Frontend Audit (React/TypeScript)

### Build-Breaking Bug (FIXED)
- `ChatMessage.tsx:113` — unused `colorMap` variable from `useMemo` violates `noUnusedLocals: true`

### State Management (chatStore.ts)
- **failedMessages array never cleaned up** — accumulates indefinitely on errors
- **typingAgents per-channel structure** could grow large with many channels
- Otherwise well-designed with Zustand v5 and proper memory management (MAX_MESSAGES=2000)

### WebSocket (ws.ts)
- **No heartbeat/ping mechanism** — relies solely on close events for disconnect detection
- **No message queue for offline** — messages sent during disconnect are lost
- **Silent error swallowing** — all catch blocks are empty, making debugging impossible
- **Listener Set unbounded** — could leak if components don't unsubscribe

### API Client (api.ts)
- **All 70+ API calls use `.catch(console.warn)`** — errors never shown to users
- **No retry mechanism** for transient failures
- **Error parsing unsafe** — assumes response body is always text

### Components (46 TSX files)
- **ChatMessage.tsx:** Module-level `_agentColorMap` mutation violates React purity (race condition risk in concurrent mode)
- **MessageInput.tsx:** `localStorage` access unprotected (fails silently if storage disabled)
- **SettingsPanel.tsx:** No validation on configuration inputs
- **StatsPanel.tsx:** `senderCounts` rebuilt every render without memoization
- **Sidebar.tsx:** No error feedback when create/delete/rename fails
- **All components:** Errors logged to console only, never shown to users via toast/snackbar

### Performance
- Virtual scrolling threshold at 200 messages (good)
- `requestAnimationFrame` for scrolling (good)
- Font size and theme applied via direct DOM manipulation causing full reflow

### Accessibility
- Material Design icons used throughout
- Color contrast generally good
- ErrorBoundary implemented
- No keyboard navigation issues detected

---

## 5. Desktop/Electron Audit

### index.ts (Main process)
- **Wizard security:** Context isolation disabled (see S2)
- **Settings stored plaintext:** `~/.ghostlink/settings.json` — no encryption
- **Silent version update:** Lines 51-54 update stored appVersion without user awareness

### updater.ts (Auto-update)
- **Depends on proper GitHub release format:** Expects `latest.yml` + platform installers
- **GitHub token exposure:** Read from gh CLI config, set in process.env (could leak in logs)
- **Good error handling:** Gracefully handles 404, 403, no-releases, network errors

### server.ts (Python backend lifecycle)
- **Python version not always validated:** System python/python3 detected without version check
- **WSL `--break-system-packages` fallback:** Circumvents PEP 668 protections
- **Port 8300 hardcoded with no fallback:** If port in use, server won't start
- **sed command for config modification:** Simplistic regex could match wrong lines

### preload.ts
- **Well-designed:** Proper channel whitelisting, context isolation, typed IPC bridge
- Only minor issue: blocked channels silently return empty unsubscribe function

### Auth modules (anthropic.ts, openai.ts, google.ts, github.ts)
- **Auth detection is best-effort:** Checks for files/env vars, can be spoofed
- **NPX fallback for Claude:** 15-second timeout could fail on slow connections
- **No validation of detected auth:** Just checks existence, not validity

### electron-builder.yml
- **No code signing** (see S3)
- **Source maps not excluded from package** (see S4)
- **Backend Python files shipped unencrypted** in resources

### Renderer files (launcher.html/js, wizard.html/js)
- **CSP too permissive** (see S6)
- HTML escaping present for user data (good)
- Update UI flow well-implemented (progress bar, status messages, restart button)

---

## 6. CI/CD & GitHub

### build.yml (GitHub Actions)
- **Well-structured:** Parallel builds for 3 platforms, artifact collection, release creation
- **Uses softprops/action-gh-release@v2** for release creation
- **Triggers on v* tag pushes** — correct for electron-updater
- **No build caching:** Each run does full `npm ci` — could be optimized with actions/cache

### Current Release Status
| Version | Assets | Status |
|---------|--------|--------|
| v2.5.1 | **0 assets** | **BROKEN** — CI build failed (TypeScript error) |
| v2.5.0 | 8 assets | Working (exe, dmg, AppImage, deb, 3x yml, blockmap) |
| v2.4.0 | 11 assets | Working |
| v2.3.0 | 10 assets | Working |

### What Users See
- Auto-updater checks GitHub releases
- Finds v2.5.0 as the latest release with valid `latest.yml`
- **v2.5.1 is invisible to the auto-updater** because it has no manifest files
- Users stay on v2.5.0 (or whatever they last successfully updated to)

---

## 7. Hardcoded Values Needing Configuration

| Value | Location | Current | Should Be |
|-------|----------|---------|-----------|
| Server port | config.toml | 8300 | Already configurable ✓ |
| Message size limit | app.py | 102KB | config.toml |
| Rate limit | app.py | 300 req/min | config.toml |
| Health check interval | app.py | 30s | config.toml |
| Heartbeat threshold | app.py | 45s | config.toml |
| Schedule check interval | app.py | 60s | config.toml |
| Agent token TTL | registry.py | 3600s | config.toml |
| MCP presence timeout | mcp_bridge.py | 15s | config.toml |
| Max active rules | rules.py | 10 | config.toml |
| Cost estimates | app.py | Hardcoded per model | config.toml or API |

---

## 8. Missing Features / Gaps

- No `/api/health` endpoint for monitoring
- No graceful shutdown signal handling
- No FTS5 index rebuild endpoint
- No plugin versioning or dependency management
- No HTTPS enforcement for MCP proxy
- No message queue for WebSocket offline scenarios
- No typing indicator timeout/cleanup
- No stale thinking stream cleanup delay
- No user-facing error notifications (all errors go to console.warn)

---

## 9. Priority Fix List

### P0 — Do Now (blocks users)
1. ✅ Fix `ChatMessage.tsx` unused variable (TypeScript compile error)
2. Delete broken v2.5.1 release on GitHub
3. Commit fix, re-tag, push → CI builds proper release artifacts
4. Verify auto-updater sees new release

### P1 — High (security)
5. Enable context isolation on wizard window
6. Remove XOR encryption fallback (hard-fail if cryptography missing)
7. Enforce token expiration at authentication layer
8. Enable code signing for Electron builds
9. Exclude source maps from packaged app

### P2 — Medium (stability)
10. Add atomic settings file writes with backup
11. Add `/api/health` endpoint
12. Add retry logic to bridge API calls
13. Add user-facing error notifications (toast system exists but isn't wired to API errors)
14. Fix cron step value calculation
15. Add message size validation
16. Validate Python version before launching server

### P3 — Low (code quality)
17. Make hardcoded limits configurable
18. Add heartbeat to WebSocket
19. Memoize StatsPanel calculations
20. Add plugin isolation/sandboxing
21. Clean up agent_memory.py race condition
22. Add CI build caching for faster releases

---

## 10. Project Statistics

| Metric | Count |
|--------|-------|
| Total source files audited | 90+ |
| Backend Python files | 24 |
| Frontend TSX/TS files | 53 |
| Desktop TS/JS/HTML files | 16 |
| API endpoints | 90+ |
| React components | 46 |
| MCP tools | 17 |
| Built-in skills | 28 |
| Supported agents | 13 |
| Supported providers | 13 |
| Channel bridges | 5 |
| Themes | 9 |
| Slash commands | 23 |
| Security issues found | 12 |
| Bugs found | 30+ |
| Build-breaking bugs | 1 (fixed) |

---

*End of audit. The codebase is well-structured overall with good architecture, but needs the above fixes before v2.5.1 can ship properly.*
