# GhostLink — Known Bugs & Issues

**Last updated:** 2026-03-22 03:30 UTC
**Source:** Testing during development session, Finn's screenshots, log analysis

---

## CRITICAL — App won't fully function

### BUG-001: WebSocket "Connection lost" banner always shows
**Severity:** Critical — chat is non-functional without WebSocket
**Where:** Chat window (Electron and browser)
**Symptom:** Red banner "Connection lost. Trying to reconnect..." permanently displayed
**Root cause:** The SPA catch-all route in `backend/app.py` intercepts the WebSocket upgrade handshake. The browser sends `GET /ws` with `Upgrade: websocket` header, but the `@app.get("/{full_path:path}")` or `app.mount("/", StaticFiles(...))` matches first and returns HTML/404 instead of letting `@app.websocket("/ws")` handle it.
**Evidence:**
- `curl` with WebSocket headers to `/ws` returns HTTP 200 (HTML) or HTTP 404 depending on which SPA approach is used
- Python `websockets` library v15 confirms: "server rejected WebSocket connection: HTTP 404"
- `curl -v` with proper Upgrade headers shows the connection hangs (which actually means the WebSocket route IS matching for raw TCP, but the HTTP-level routing conflicts)
**Attempted fixes (all failed):**
1. `@app.get("/{full_path:path}")` with `if full_path == "ws": return 404` — still intercepts before websocket handler
2. `app.mount("/", StaticFiles(html=True))` — catches ALL paths including /ws
3. `BaseHTTPMiddleware` — doesn't handle WebSocket scope type
4. Custom `SPAApp` ASGI app mounted at "/" — Starlette routes mount before websocket
5. Exception handler for 404 — WebSocket gets 404 before handler fires
**File:** `aichttrr/backend/app.py` lines ~1241-1270
**Impact:** The entire real-time chat is broken. Messages may still send via REST API but won't appear in real-time.
**Possible fix:**
- Don't serve frontend from the same FastAPI app. Use a reverse proxy (nginx/caddy) to serve static files and proxy /ws and /api to FastAPI
- OR serve frontend from Electron directly (load from file:// not http://) and only use the backend for API+WS
- OR use Starlette `Route` and `WebSocketRoute` explicitly in the route list instead of decorators

### BUG-002: Server startup fails on first run (missing Python deps)
**Severity:** Critical on first install
**Where:** Desktop app → Start Server
**Symptom:** "Backend process exited before becoming ready" or "Failed to install Python deps"
**Root cause (multi-part):**
- a) WSL Ubuntu 24.04 uses Python 3.12 with PEP 668 which blocks `pip install` system-wide
- b) Server creates a venv at `/tmp/ghostlink-backend/.venv` and installs deps, but the venv creation or pip install can fail silently
- c) The `import fastapi` check passes but `import aiosqlite` doesn't (was only checking fastapi before, now checks all three)
- d) Even after venv+deps install succeeds, the server may crash on other import errors
**File:** `aichttrr/desktop/main/server.ts` lines ~155-240
**Status:** Partially fixed — now creates venv and installs deps. But may still fail if venv creation itself fails (python3-venv package not installed in WSL).
**Possible fix:** Check for `python3-venv` package, install it via `sudo apt install python3-venv` if missing (requires user sudo password).

### BUG-003: `AgentMemory.__init__()` missing argument (FIXED but may regress)
**Severity:** Critical — server won't start
**Where:** `backend/app.py` line ~1067
**Symptom:** `TypeError: AgentMemory.__init__() missing 1 required positional argument: 'agent_name'`
**Root cause:** Original code created a global `_agent_memory = AgentMemory(DATA_DIR / "agent_memories")` but AgentMemory requires `(data_dir, agent_name)`.
**Status:** Fixed — now uses `get_agent_memory(data_dir, agent_name)` per-agent on demand.
**Risk:** If any agent copies the old app.py from a stale cache, it will crash again. The `/tmp/ghostlink-backend/app.py` in WSL may have a stale copy.

---

## HIGH — Major UX problems

### BUG-004: Setup wizard doesn't show on fresh install
**Severity:** High — first-run experience broken
**Where:** Desktop app first launch
**Symptom:** White screen for ~60 seconds, then launcher appears (no wizard)
**Root cause (multi-part):**
- a) `~/.ghostlink/settings.json` persists across installs. If it exists with `setupComplete: true`, wizard is skipped. Uninstalling the app does NOT delete this file.
- b) Even when settings.json is deleted and wizard should show, the wizard window goes white/unresponsive for a long time before appearing.
- c) The white screen is caused by synchronous `execSync` calls during auth detection that block Electron's main thread. `hasCommand()` runs `wsl bash -lc "which ..."` which can take 5-15 seconds PER check, and there are 4+ providers checked sequentially on launcher init.
**File:** `aichttrr/desktop/main/index.ts` lines ~576-596 (app ready), `aichttrr/desktop/main/auth/index.ts` (hasCommand)
**Possible fix:**
- Delete `~/.ghostlink/settings.json` during uninstall (add to NSIS uninstaller script)
- Move ALL `execSync` auth checks to async `exec` or run them in a worker thread
- Show the wizard/launcher window IMMEDIATELY with a loading state, then populate auth status asynchronously

### BUG-005: Wizard "Next" button doesn't work (FIXED but may regress)
**Severity:** High — can't complete setup
**Where:** Desktop app wizard, all buttons
**Symptom:** Clicking Next, Back, minimize, close — nothing happens
**Root cause:** The wizard.js uses `require('electron')` to get ipcRenderer. With `contextIsolation: false` and `nodeIntegration: true`, this SHOULD work. But previous attempts used `contextIsolation: true` with a preload script, and the preload path resolution inside an asar archive was unreliable.
**Status:** Currently set to `nodeIntegration: true, contextIsolation: false` which should make `require('electron')` work. But the CSP meta tag in wizard.html may block `require` if it doesn't include `'unsafe-eval'`.
**File:** `aichttrr/desktop/renderer/wizard.js` lines 1-10, `aichttrr/desktop/main/index.ts` (wizard window creation)
**Possible fix:** Verify CSP includes `'unsafe-eval'`, test that `require('electron')` actually returns ipcRenderer in packaged app.

### BUG-006: Launcher/wizard window goes white and freezes for ~60 seconds
**Severity:** High — appears broken/crashed
**Where:** Desktop app on launch
**Symptom:** Window appears but content is white. Windows may show "Not Responding" dialog. Eventually loads after 30-90 seconds.
**Root cause:** Auth status checks use `execSync` which blocks the main Electron thread. Each `wsl bash -lc "which ..."` call takes 3-15 seconds. With 4 providers, that's 12-60 seconds of blocking.
**File:** `aichttrr/desktop/main/auth/index.ts` (`hasCommand`, `execCmd`), `aichttrr/desktop/renderer/launcher.js` (calls auth:check-all on DOMContentLoaded)
**Possible fix:** Use `child_process.exec` (async) instead of `execSync`. Or run auth checks AFTER the window is visible, with a loading spinner for each provider card.

### BUG-007: OneDrive paths not accessible from WSL
**Severity:** High — server can't start if app installed to OneDrive-synced Desktop
**Where:** Desktop app → Start Server
**Symptom:** Python can't import modules from the OneDrive path
**Root cause:** OneDrive uses a virtual filesystem that WSL can't fully access. Files at `C:\Users\skull\OneDrive\Desktop\GhostLink\resources\backend\` are visible to Windows but not to WSL's `/mnt/c/Users/skull/OneDrive/...`.
**Status:** Partially fixed — server.ts detects "OneDrive" in path and copies backend files to `/tmp/ghostlink-backend/`. But the copy mechanism uses `fs.readFileSync` (Windows) piped to `wsl bash -c "cat > ..."` which is slow and may fail for binary files.
**File:** `aichttrr/desktop/main/server.ts` lines ~165-230
**Possible fix:** Install to a non-OneDrive location (e.g., C:\GhostLink), or use `wsl` mount to make the path accessible.

---

## MEDIUM — Functional issues

### BUG-008: No agents appear in the agent bar (desktop app)
**Severity:** Medium — misleading empty state
**Where:** Chat window agent bar and stats panel
**Symptom:** "Agents Online: 0/0", empty agent bar, no agent chips
**Root cause:** The generic `config.toml` bundled with the app has all agent entries commented out. Agents only appear if configured in config.toml OR added via Settings > Persistent Agents. On a fresh desktop app install, neither exists.
**File:** `aichttrr/backend/config.toml`
**Possible fix:** The first-run wizard should detect installed CLIs and automatically add them to settings.json as persistent agents. OR the backend should auto-detect installed agents on startup.

### BUG-009: Launcher doesn't hide when chat window opens
**Severity:** Medium — confusing to have two windows
**Where:** Desktop app
**Symptom:** Both launcher and chat window visible simultaneously
**Root cause:** `createChatWindow()` in index.ts has `launcher.hide()` in the `ready-to-show` handler, but the launcher may not be the `getLauncherWindow()` at that point if the wizard was shown first.
**Status:** Code to hide launcher exists at line ~162 but may not execute in all code paths.
**File:** `aichttrr/desktop/main/index.ts` lines ~159-163

### BUG-010: "Update check failed" error on every launch
**Severity:** Medium — alarming red error text
**Where:** Desktop app launcher, Updates section
**Symptom:** "Update check failed" or "Backend process exited before becoming ready" shown in red
**Root cause:** The GitHub repo is `nahldi/aichttr` but electron-builder.yml points to `nahldi/ghostlink` which doesn't exist. The auto-updater tries to fetch releases from a non-existent repo.
**File:** `aichttrr/desktop/electron-builder.yml` (publish.repo field)
**Possible fix:** Either create the `nahldi/ghostlink` repo, rename the existing repo, or change electron-builder.yml to point to `nahldi/aichttr`. Also handle 404 gracefully (show "Up to date" instead of error).

### BUG-011: Frontend dist path mismatch in packaged app
**Severity:** Medium — frontend won't load if not handled
**Where:** Desktop app
**Symptom:** Chat window shows `{"detail": "Not Found"}` or empty page
**Root cause:** electron-builder copies `frontend/dist/*` contents to `resources/frontend/` (not `resources/frontend/dist/`). But `config.toml` says `static_dir = "../frontend/dist"`. The server.ts OneDrive copy code handles this by checking both paths.
**Status:** Partially fixed in server.ts — it checks both `frontend/dist/` and `frontend/` for `index.html`. But if the copy to /tmp fails, the frontend won't be available.
**File:** `aichttrr/desktop/main/server.ts` lines ~195-230

### BUG-012: Menu bar (File, Edit, View) shows on some windows
**Severity:** Medium — looks unprofessional
**Where:** Desktop app windows
**Symptom:** Standard Electron menu bar visible on wizard/launcher/chat windows
**Root cause:** `Menu.setApplicationMenu(null)` is called in `app.whenReady()` but the chat BrowserWindow is created later and may get a default menu. Also, frameless windows shouldn't have menus but framed ones do.
**Status:** Menu is set to null on app ready. But the chat window (which loads http://127.0.0.1:8300) is a regular framed window and may show the default Electron menu.
**File:** `aichttrr/desktop/main/index.ts` line ~580
**Possible fix:** Set `autoHideMenuBar: true` on the chat BrowserWindow, or call `Menu.setApplicationMenu(null)` again when creating the chat window.

---

## LOW — Polish issues

### BUG-013: Cloudflare tunnel button not visible in desktop app
**Severity:** Low — feature exists but not shown
**Where:** Chat window header
**Symptom:** RemoteSession component may not render because it's only shown in the desktop `lg:flex` agent bar row
**File:** `aichttrr/frontend/src/App.tsx`

### BUG-014: Ghost logo shows as broken image
**Severity:** Low — cosmetic
**Where:** Chat window empty state, sidebar
**Symptom:** Broken image icon instead of ghost logo
**Root cause:** `ghostlink.png` may not be in the correct path. The frontend references `/ghostlink.png` which works when served from `frontend/dist/` but may not work in the desktop app if the static file serving is broken (see BUG-001).
**File:** `aichttrr/frontend/src/App.tsx` line ~79, `aichttrr/frontend/src/components/Sidebar.tsx`

### BUG-015: Stats panel text partially cut off on right edge
**Severity:** Low — cosmetic
**Where:** Chat window right sidebar
**Symptom:** Numbers and labels get clipped on the right edge, especially on smaller screens
**File:** `aichttrr/frontend/src/components/StatsPanel.tsx`

### BUG-016: Light mode agent chips barely visible
**Severity:** Low — cosmetic in light mode
**Where:** Agent bar in light theme
**Symptom:** Agent chip backgrounds blend into the light background, text hard to read
**Root cause:** Agent chip styles use `color-mix` with the agent's brand color at low opacity, which becomes invisible on light backgrounds.
**File:** `aichttrr/frontend/src/components/AgentBar.tsx`, `aichttrr/frontend/src/index.css`

### BUG-017: Electron app installed to OneDrive Desktop by default
**Severity:** Low — causes BUG-007
**Where:** NSIS installer
**Symptom:** Default install path is the user's Desktop which may be OneDrive-synced
**Root cause:** NSIS installer defaults to user's Desktop or Program Files. If Desktop is OneDrive-synced, the app files are in a problematic location.
**File:** `aichttrr/desktop/electron-builder.yml`
**Possible fix:** Set default install directory to `C:\GhostLink` or `%LOCALAPPDATA%\GhostLink` instead of Desktop.

### BUG-018: Settings.json persists across uninstall/reinstall
**Severity:** Low — causes wizard skip (BUG-004)
**Where:** `~/.ghostlink/settings.json`
**Symptom:** Wizard doesn't show on reinstall because old settings exist
**Root cause:** NSIS uninstaller doesn't clean up `~/.ghostlink/` directory
**File:** `aichttrr/desktop/electron-builder.yml` (NSIS config)
**Possible fix:** Add cleanup script to NSIS uninstaller, or check settings version and reset if outdated.

---

## ARCHITECTURE ISSUES

### ARCH-001: Serving frontend and WebSocket from same FastAPI app
**Root cause of BUG-001.** FastAPI/Starlette's routing doesn't cleanly support both a WebSocket endpoint at `/ws` and a catch-all SPA route at `/{path}` on the same app. Every approach to serve static files (mount, catch-all GET, middleware) interferes with the WebSocket handshake.
**Proper solution:** Separate concerns:
- Option A: Use nginx/caddy as reverse proxy — serve static files directly, proxy /api and /ws to FastAPI
- Option B: In Electron, load frontend from `file://` protocol instead of `http://`, making the SPA catch-all unnecessary
- Option C: Serve frontend on a different port (e.g., 8301) from the API/WS server (8300)

### ARCH-002: Synchronous IPC in Electron main process
**Root cause of BUG-006.** All auth checks and WSL command execution use `execSync` which blocks Electron's main thread, freezing the UI. This is a fundamental architecture issue — the main process should NEVER block.
**Proper solution:** Replace all `execSync` with `exec` (async) or `child_process.spawn`. Use `ipcMain.handle` with async handlers that return promises.

### ARCH-003: Desktop app depends on WSL
**The entire server startup flow assumes WSL is available.** On a pure Windows machine without WSL, or on macOS/Linux, the server won't start. The server.ts has WSL-specific code (path translation, wsl command prefix) hardcoded.
**Proper solution:** Detect platform and use appropriate Python launcher:
- Windows native: use Windows Python directly
- WSL: current approach (wsl bash -lc)
- macOS/Linux: use system Python directly
