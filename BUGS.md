# GhostLink — Known Bugs & Issues

**Last updated:** 2026-03-22
**Version:** v1.0.4
**Source:** Full codebase audit + bug fix pass

---

## CRITICAL — App won't fully function

### ~~BUG-001: WebSocket "Connection lost" banner always shows~~ FIXED
**Status:** FIXED
**Fix:** Replaced catch-all `@app.get("/{full_path:path}")` with `@app.middleware("http")` `spa_middleware` that only fires on 404 responses and explicitly skips `/ws`, `/api/`, and `/uploads/` paths.

### ~~BUG-002: Server startup fails on first run (missing Python deps)~~ FIXED
**Status:** FIXED (v1.0.4)
**Fix:** Server now auto-detects missing python3-venv and attempts `sudo apt-get install -y python3-venv` automatically. Falls back to `--break-system-packages` as last resort. Clear error message if all methods fail.

### ~~BUG-003: `AgentMemory.__init__()` missing argument~~ FIXED
**Status:** FIXED
**Fix:** Per-agent `get_agent_memory(data_dir, agent_name)` calls in all endpoints.

---

## HIGH — Major UX problems

### BUG-004: Setup wizard doesn't show on fresh install (when settings.json persists)
**Severity:** High — first-run experience broken if reinstalling
**Where:** Desktop app first launch after reinstall
**Symptom:** Wizard skipped, goes straight to launcher
**Root cause:** `~/.ghostlink/settings.json` persists across uninstall. If it exists with `setupComplete: true` and matching version, wizard is skipped.
**Status:** Partially mitigated — wizard re-shows on major.minor version bumps. Full fix requires NSIS uninstaller cleanup.
**Workaround:** Delete `~/.ghostlink/settings.json` before reinstalling.

### ~~BUG-005: Wizard "Next" button doesn't work~~ FIXED
**Status:** FIXED
**Fix:** wizard.js passes platform parameter correctly to IPC handler.

### ~~BUG-006: Launcher/wizard window freezes for ~60 seconds~~ FIXED
**Status:** FIXED
**Fix:** All `execSync` calls replaced with async `execAsync`. Auth checks run via `Promise.allSettled()`.

### BUG-007: OneDrive paths not accessible from WSL
**Severity:** High — server can't start if app installed to OneDrive-synced Desktop
**Where:** Desktop app → Start Server
**Status:** Partially fixed — server.ts detects "OneDrive" in path and copies to `/tmp/ghostlink-backend/`.
**Workaround:** Install to a non-OneDrive location (e.g., C:\GhostLink).

---

## MEDIUM — Functional issues

### BUG-008: No agents appear in the agent bar (fresh desktop install)
**Severity:** Medium — misleading empty state
**Where:** Chat window agent bar
**Root cause:** config.toml bundled with app has all agent entries commented out. Agents only appear if configured or added via Settings.
**Workaround:** Click "+" in agent bar to add agents, or add them in Settings > Persistent Agents.

### ~~BUG-009: Launcher doesn't hide when chat window opens~~ FIXED
**Status:** FIXED (v1.0.0)
**Fix:** `createChatWindow()` now hides both launcher AND wizard windows in the `ready-to-show` handler.

### ~~BUG-010: "Update check failed" error on every launch~~ FIXED
**Status:** FIXED (v1.0.0)
**Fix:** electron-builder.yml already pointed to correct repo `nahldi/aichttr`. Updater error handler now gracefully suppresses network errors, 404s, missing releases, and DNS failures — shows "Up to date" instead of scary error text.

### BUG-011: Frontend dist path mismatch in packaged app
**Severity:** Medium — frontend won't load if /tmp copy fails
**Where:** Desktop app
**Status:** Partially fixed in server.ts — checks both `frontend/dist/` and `frontend/` paths.

### ~~BUG-012: Menu bar (File, Edit, View) shows on some windows~~ FIXED
**Status:** FIXED
**Fix:** `Menu.setApplicationMenu(null)` called on app ready + `autoHideMenuBar: true` set on chat BrowserWindow.

---

## LOW — Polish issues

### ~~BUG-013: Cloudflare tunnel button not visible in desktop app~~ FIXED
**Status:** FIXED (v1.0.4)
**Fix:** Agent bar now uses `flex-1 min-w-0 overflow-hidden` container, tunnel button stays visible with `ml-3 shrink-0`.

### BUG-014: Ghost logo shows as broken image
**Severity:** Low — cosmetic
**Root cause:** `/ghostlink.png` path works in dev but may not in packaged app if static serving path differs.

### ~~BUG-015: Stats panel text partially cut off on right edge~~ FIXED
**Status:** FIXED (v1.0.4)
**Fix:** Added `overflow-x-hidden` to panel container and `overflow-hidden text-right` to stat rows.

### ~~BUG-016: Light mode agent chips barely visible~~ FIXED
**Status:** FIXED (v1.0.4)
**Fix:** Light mode chip styles now use stronger color mixing (18% bg, 35% border), added `box-shadow`, and explicit text colors for contrast.

### BUG-017: Electron app installed to OneDrive Desktop by default
**Severity:** Low — causes BUG-007
**Workaround:** Choose a non-OneDrive install directory during installation.

### BUG-018: Settings.json persists across uninstall/reinstall
**Severity:** Low — causes BUG-004
**Workaround:** Delete `~/.ghostlink/settings.json` before reinstalling.

---

## ARCHITECTURE ISSUES

### ~~ARCH-001: Serving frontend and WebSocket from same FastAPI app~~ RESOLVED
**Fix:** HTTP middleware only intercepts 404s, explicitly skips `/ws`, `/api/`, `/uploads/`.

### ~~ARCH-002: Synchronous IPC in Electron main process~~ RESOLVED
**Fix:** All `execSync` replaced with `execAsync`.

### ARCH-003: Desktop app depends on WSL
**The server startup flow assumes WSL is available on Windows.** On pure Windows without WSL, or macOS/Linux, the server won't start via the desktop app.
**Future fix:** Detect platform and use appropriate Python launcher (native Python on Windows/macOS/Linux, WSL only when detected).

---

## SECURITY FIXES (v1.0.0)

### ~~SEC-001: MCP identity spoofing via raw sender parameter~~ FIXED
**Status:** FIXED (v1.0.0)
**Fix:** `_resolve_identity()` in `mcp_bridge.py` now requires bearer token authentication for all agent names. Only human names ("you", "user", "human", "admin", "system") are accepted without a token. Agents MUST authenticate via their registered token.

### ~~SEC-002: Assert statements fail with Python -O flag~~ FIXED
**Status:** FIXED (v1.0.0)
**Fix:** Replaced `assert store._db is not None` in `app.py` search and export endpoints with `if store._db is None: raise RuntimeError(...)`.

### ~~SEC-003: Auth regex matches "not authenticated"~~ FIXED
**Status:** FIXED (v1.0.0)
**Fix:** Auth detection regex in `anthropic.ts` and `google.ts` now uses word boundaries and explicitly rejects negated patterns like "not authenticated".

### ~~SEC-004: Bash OR logic bug in OpenAI/Google auth checks~~ FIXED
**Status:** FIXED (v1.0.0)
**Fix:** Added proper parentheses around `test -d ... || test -d ...` in `openai.ts` and `google.ts` WSL directory checks.
