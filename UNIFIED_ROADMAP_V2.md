# UNIFIED ROADMAP V2 — GhostLink

**Created:** 2026-03-28
**Authors:** Claude (Sage) + Codex — joint audit & roadmap
**Baseline:** v4.7.3
**Total verified issues:** 103

---

## Phase 0: Issue Registry

All 103 verified issues from both audits, frozen. No new items added without mutual agreement.

| Source | Issues | Withdrawn |
|--------|--------|-----------|
| CLAUDE_AUDIT.md | 101 | 2 (BE-001, BE-002) |
| CODEX_AUDIT.md | 9 | 0 |
| Net unique (after dedup) | 103 | — |

**Overlap map (same issue, both audits):**
- C-002 = EL-003 (nodeIntegration without preload)
- C-003 = EL-001/EL-002 (shell injection in WSL)
- C-004 = INF-001 (pyproject.toml version mismatch)
- C-007 = BE-005 (channel_summary RuntimeError)
- C-008 = INF-004/INF-005 (roadmap version drift)

---

## Phase 1: Critical Security & Release Blockers

**Owner:** Codex (backend/Electron) + Claude (review)
**Target:** Must fix before any release

| # | ID | Severity | File(s) | Issue | Fix |
|---|-----|----------|---------|-------|-----|
| 1 | EL-001 / C-003 | CRITICAL | `desktop/main/server.ts:350-365` | Command injection via WSL path concatenation | Replace shell string interpolation with `execFileSync` + argument arrays |
| 2 | EL-002 / C-003 | CRITICAL | `desktop/main/server.ts:328-333` | Shell concatenation in server startup command | Use argument arrays, never interpolate paths into bash strings |
| 3 | C-001 | HIGH | `backend/routes/providers.py:29-40`, `backend/providers.py:231-235` | Provider API keys stored plaintext in `providers.json` | Route key storage through SecretsManager encrypted path |
| 4 | EL-003 / C-002 | HIGH | `desktop/main/index.ts:118-125`, `desktop/main/launcher.ts:40-47` | Wizard/launcher: nodeIntegration:true, contextIsolation:false, no preload | Enable preload+contextBridge, set nodeIntegration:false |
| 5 | EL-005 | HIGH | `desktop/main/index.ts:71-79` | Settings JSON parsed but never validated — code execution risk | Add schema validation (zod/joi) for settings.json |
| 6 | EL-006 | HIGH | `desktop/main/index.ts:407-444` | persistentAgents config not validated — arbitrary command execution | Whitelist allowed agent commands |
| 7 | EL-004 | HIGH | `desktop/main/server.ts:210-227` | Path traversal in WSL copyDir — symlinks not rejected | Validate paths stay within backend dir, reject symlinks |
| 8 | INF-001 / C-004 | CRITICAL | `backend/pyproject.toml:3` | Version 4.5.1 vs actual 4.7.3 | Update to 4.7.3 |
| 9 | C-005 | MEDIUM | `backend/security.py:429-431` | GDPR export manifest hardcodes version "2.5.2" | Read version from `__version__` dynamically |
| 10 | C-006 | LOW | `desktop/package-lock.json:3-10` | Lockfile metadata pinned to 2.5.6 | `npm install` to regenerate lockfile |

**Verification:** Re-audit all touched files. Run `npm run build` (desktop + frontend). Confirm no shell interpolation remains in server.ts. Verify providers.json no longer contains plaintext keys.

---

## Phase 2: Runtime Correctness & Resilience

**Owner:** Codex (backend/Electron) + Claude (review)

| # | ID | Severity | File(s) | Issue | Fix |
|---|-----|----------|---------|-------|-----|
| 1 | BE-005 / C-007 | HIGH | `backend/routes/channels.py:78-79` | channel_summary raises RuntimeError if DB unavailable | Return `JSONResponse({"error": ...}, 503)` |
| 2 | BE-003 | HIGH | `backend/routes/agents.py:306-327` | Unvalidated subprocess args in agent spawn | Validate extra_args against whitelist |
| 3 | BE-004 | HIGH | `backend/app.py:289-310` | Missing import validation at startup — silent feature loss | Log clearly or fail fast on critical import failures |
| 4 | BE-006 | MEDIUM | `backend/routes/bridges.py:66-71` | Empty HMAC secret bypasses signature check | Validate secret is non-empty before checking |
| 5 | BE-009 | MEDIUM | `backend/routes/agents.py:336` | Hardcoded 3s sleep in async spawn | Replace with health check loop + exponential backoff |
| 6 | BE-010 | MEDIUM | `backend/app.py:421` | Plugin loading not guarded — can crash startup | Wrap in try-except, log and continue |
| 7 | BE-012 | MEDIUM | `backend/app.py:356` | Schedule checker 55-second cooldown race | Make cooldown intelligent about cron intervals |
| 8 | BE-014 | MEDIUM | `backend/router.py:73-76` | Hop counter not properly reset | Reset based on timestamps or explicit channel resets |
| 9 | BE-019 | MEDIUM | `backend/deps.py:136-150` | WebSocket broadcast not thread-safe | Add asyncio.Lock for _ws_clients |
| 10 | BE-008 | MEDIUM | `backend/app.py:521-523` | Rate limit dict unbounded growth | Add stale entry cleanup by timestamp |
| 11 | C-009 | LOW | `desktop/renderer/wizard.js:9`, `launcher.js:16` | removeAllListeners detaches unrelated handlers | Remove specific handler only |
| 12 | EL-007 | MEDIUM | `desktop/main/server.ts:79-102` | Race condition in server startup port cleanup | Aggregate errors, log clearly |
| 13 | EL-008 | MEDIUM | `desktop/main/index.ts:457-463` | Unhandled promise in wizard completion | Wrap in try-catch, show error modal |
| 14 | EL-009 | MEDIUM | `desktop/main/server.ts:236-262` | Frontend copy failure not fatal — shows blank UI | Abort startup with clear error |
| 15 | EL-019 | MEDIUM | `desktop/main/server.ts:284-320` | Failed pip install leaves broken venv | Clean up venv on failure |
| 16 | BE-015 | MEDIUM | `backend/routes/agents.py:69-72` | Worktree null silently ignored | Log warning when cleanup skipped |
| 17 | BE-016 | MEDIUM | `backend/sessions.py:215-219` | Role index edge case when all roles empty | Return None early when no roles |

**Verification:** Run backend test suite. Test agent spawn/kill cycle. Test channel operations with DB unavailable. Test WebSocket under concurrent connections.

---

## Phase 3: Config, Versioning & Documentation

**Owner:** Both (Codex: backend/infra, Claude: docs/frontend)

| # | ID | Severity | File(s) | Issue | Fix |
|---|-----|----------|---------|-------|-----|
| 1 | INF-002 | HIGH | `README.md:15` | Installer version says 2.5.1 | Update to 4.7.3 |
| 2 | INF-003 | HIGH | `BUGS.md:4` | Version header says v4.5.2 | Update to v4.7.3 |
| 3 | INF-004 | MEDIUM | `STATUS.md:4,69` | Version v4.7.0, section header v4.0.0 | Update to v4.7.3 throughout |
| 4 | INF-005 | MEDIUM | `STATUS.md:71` | Missing v4.1-v4.7 changes | Add recent phase summaries |
| 5 | INF-006 | MEDIUM | `FEATURES.md:120-133` | 8 features marked planned but completed | Move to completed section |
| 6 | INF-010 | MEDIUM | `README.md` | API endpoint count says "90+" — actual is 191 | Update to "190+" |
| 7 | INF-007 | MEDIUM | `backend/config.toml:16-17` | MCP ports not parameterizable | Support env var override |
| 8 | INF-009 | MEDIUM | `.gitignore` | Missing .env, *.key, *.pem patterns | Add defensive patterns |
| 9 | INF-008 | MEDIUM | `frontend/` | 5 extraneous npm packages | `npm prune && npm ci` |
| 10 | INF-014 | MEDIUM | `DESKTOP_APP_PLAN.md:44-63` | OAuth section describes unimplemented flow | Document actual CLI auth detection |
| 11 | INF-015 | LOW | `FEATURES.md` vs `README.md` | Slash command count: 21 vs 23 | Audit and align |
| 12 | INF-016 | LOW | `README.md` vs `STATUS.md` | Component count: 44 vs 51 | Verify actual count |
| 13 | INF-012 | LOW | `sdk/python/` | SDK not documented in README | Add SDK reference |
| 14 | INF-013 | LOW | `backend/.ghostlink-worktrees/` | 4 stale worktree branches | Clean up |
| 15 | C-008 | LOW | `UNIFIED_ROADMAP.md:7` | Roadmap says v4.7.0 | Update to v4.7.3 |

**Verification:** Grep all files for version strings. Confirm all docs reference v4.7.3. Run `npm ci` clean.

---

## Phase 4: Frontend Correctness

**Owner:** Claude (primary) + Codex (review)

| # | ID | Severity | File(s) | Issue | Fix |
|---|-----|----------|---------|-------|-----|
| 1 | FE-001 | HIGH | `App.tsx:169,174` | Stale closures in scroll useEffect | Fix dependency arrays or use useCallback |
| 2 | FE-006 | HIGH | `App.tsx:418` | Stale closure in keyboard handler | Include all used values in deps |
| 3 | FE-002 | HIGH | `UrlPreview.tsx:49` | Stale closure misses URL previews | Depend on urls array, add cleanup |
| 4 | FE-003 | HIGH | `MessageInput.tsx:147` | Voice callback churn restarts recording | Minimize dependency array |
| 5 | FE-004 | MEDIUM | `ChatMessage.tsx:107,144` | Module-level ref for agent colors | Use context or props instead |
| 6 | FE-016 | MEDIUM | `SearchModal.tsx:64-75` | Race condition — stale search results | Add AbortController |
| 7 | FE-017 | MEDIUM | `FirstRunWizard.tsx:27,36` | localStorage throws in private mode | Wrap in try-catch |
| 8 | FE-008 | MEDIUM | `chatStore.ts:206` | sessionStart never updated | Update on new session |
| 9 | FE-009 | MEDIUM | `AddAgentModal.tsx:126` | Agent templates don't refresh on change | Update deps array |
| 10 | FE-005 | MEDIUM | `App.tsx:306-324` | ErrorBoundary missing componentDidCatch | Add logging method |
| 11 | FE-007 | MEDIUM | `useWebSocket.ts:238` | WebSocket never reconnects on state change | Handle reconnection updates |

**Verification:** `npm run build` passes. Manual test: switch channels (scroll behavior), type fast in search (no stale results), open in private mode (no crash), spawn/kill agents (modal refreshes).

---

## Phase 5: Type Safety & API Hardening

**Owner:** Claude (primary) + Codex (review)

| # | ID | Severity | File(s) | Issue | Fix |
|---|-----|----------|---------|-------|-----|
| 1 | FE-010 | MEDIUM | `ChatMessage.tsx`, `MessageInput.tsx` | `any` types for SpeechRecognition, markdown | Define proper interfaces |
| 2 | FE-011 | MEDIUM | `SettingsPanel.tsx` (8 locations) | Untyped plugin/bridge/hook/policy state | Create Plugin, Hook, Bridge, Policy interfaces |
| 3 | FE-012 | MEDIUM | `api.ts:195` | Untyped skills API | Define Skill interface |
| 4 | FE-015 | MEDIUM | `api.ts:1` | Empty BASE URL — breaks subpath deploy | Make configurable |
| 5 | FE-014 | MEDIUM | `ChatMessage.tsx:107` | Unbounded _streamedIds Set | LRU or channel-scoped clearing |
| 6 | FE-021 | LOW | `UrlPreview.tsx:7-19` | URL preview cache no TTL | Add TTL-based expiry |
| 7 | BE-007 | MEDIUM | `routes/messages.py:110` | Emoji validation inverted logic | Fix condition to allow only valid emojis |
| 8 | BE-011 | MEDIUM | `routes/messages.py:34-35` | reply_to not validated | Validate message ID exists |
| 9 | BE-018 | MEDIUM | `routes/misc.py:335` | Export format never validated | Check against allowed values |
| 10 | BE-017 | MEDIUM | `plugin_sdk.py:96-112` | SafetyScanner allows indirect imports | Restrict to curated whitelist |

**Verification:** `tsc --noEmit` passes with zero errors. Grep for remaining `any` types in changed files. Test emoji reactions, message replies, exports.

---

## Phase 6: UI/UX & Accessibility Polish

**Owner:** Claude (primary) + Codex (review)

| # | ID | Severity | File(s) | Issue | Fix |
|---|-----|----------|---------|-------|-----|
| 1 | FE-013 | MEDIUM | `ConnectionBanner.tsx` | No aria-live for connection status | Add `role="status"` + `aria-live="polite"` |
| 2 | FE-018 | LOW | `ChatMessage.tsx:52-74` | ReactionPicker no keyboard nav | Add arrow key navigation |
| 3 | FE-019 | LOW | `Sidebar.tsx:100-117` | Context menu no keyboard/Escape | Add keyboard activation + Escape |
| 4 | FE-020 | LOW | `Toast.tsx` | No dismiss button, toasts stack | Add close button + max queue |
| 5 | FE-023 | LOW | `manifest.json:15` | Purpose "any maskable" | Change to "maskable" |
| 6 | FE-022 | LOW | `vite.config.ts` | No source maps in production | Add conditional sourcemap |
| 7 | EL-011 | MEDIUM | `launcher.ts:58-63` | Hide-on-close confusing without tray | Document behavior or show tray first |
| 8 | EL-012 | MEDIUM | `tray.ts:20-49` | Missing tray icon fallback | Fallback icon or skip tray gracefully |
| 9 | EL-014 | MEDIUM | `updater.ts:162-165` | Auto-update failures silent | Show user-facing notification |
| 10 | EL-016 | MEDIUM | `launcher.html:6`, `wizard.html:6` | CSP allows unsafe-eval | Remove unsafe-eval |
| 11 | EL-010 | MEDIUM | `auth/index.ts:266-293` | Silent auth status failures | Log actual errors |
| 12 | EL-017 | MEDIUM | `index.ts:489-530` | Inconsistent IPC error response format | Standardize success/error pattern |
| 13 | EL-013 | MEDIUM | `server.ts` (throughout) | Hardcoded timeouts | Move to config with documented defaults |

**Verification:** Screen reader pass on main chat flow. Keyboard-only navigation test. Visual regression check on all themes.

---

## Phase 7: Test Coverage

**Owner:** Both (Claude: frontend, Codex: backend)

| Area | Current | Target | Key Tests to Add |
|------|---------|--------|------------------|
| Frontend | 1 test file | >50% critical path | ChatMessage, MessageInput, ChatWidget, AgentBar, SearchModal |
| Backend | ~15 tests | >50% core modules | MessageStore CRUD, WebSocket, route handlers, agent registry |
| Desktop | 0 tests | Smoke tests | Window creation, IPC handlers, server lifecycle |

**Verification:** `npm test` (frontend), `pytest` (backend) both pass. Coverage reports generated.

---

## Phase 8: Verification & Release Readiness

**Owner:** Both — mutual re-audit

1. **Re-audit all touched files from source** — no assumptions from prior scans
2. **Run full build pipeline:** `npm run build` (frontend + desktop), backend startup test
3. **Run all tests:** pytest (backend), vitest (frontend)
4. **Version bump:** Update version in ALL locations to next release number
5. **Confirm auto-updater** detects the new version correctly
6. **Smoke test:** Launch app, create channel, send messages, spawn agent, test voice, verify WebSocket reconnection
7. **Cross-audit:** Each auditor verifies the other's fixes from source
8. **Tag and release**

---

## Remaining LOW Items (Backlog)

These are real but non-blocking. Fix opportunistically:

| ID | File | Issue |
|----|------|-------|
| BE-020 | `store.py:157-159` | UID 8-char collision risk |
| BE-021 | `deps.py:153-174` | Private URL check edge cases |
| BE-022 | `registry.py:83-87` | Agent rename race condition |
| BE-023 | `app_helpers.py:108-120` | File locking not portable (Windows) |
| BE-024 | `auth.py:8` | Misleading JWT comment |
| BE-025 | `app.py:462-468` | HAS_AIOHTTP never checked before use |
| BE-026 | `app_helpers.py:92` | responseMode attribute unused |
| BE-027 | `app.py:17-20` | tomli fallback for Python <3.11 |
| BE-013 | `providers.py:26-180` | Hardcoded model lists |
| EL-018 | `index.ts:250,418` | Platform string not validated |
| EL-020 | `server.ts` | Inconsistent execSync error handling |
| EL-015 | `server.ts:484-488` | Missing ASAR consideration |
| EL-025 | `launcher.js`, `wizard.js` | Renderer files bypass preload |
| EL-026 | `server.ts` | No WSL copy disable option |
| EL-027 | `index.ts:30-31` | Logging not documented |
| EL-021 | `index.ts:16` | Unused util import |
| EL-022 | `updater.ts` | No version check documentation |
| EL-023 | `tray.ts` | Null check in tray click |
| EL-024 | `wizard.js:50-56` | Complex wizard skip logic |

---

## Owner Legend

| Owner | Scope |
|-------|-------|
| **Codex** | Backend Python, Electron/desktop, infra, packaging, server lifecycle |
| **Claude** | Frontend React, UI/UX, accessibility, types, docs, client state |
| **Both** | Cross-tier issues, version sync, testing, final verification |

---

*This roadmap is agreed upon by both Claude and Codex. No edits to codebase begin until Finn approves.*
