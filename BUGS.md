# GhostLink — Known Bugs & Issues

**Last updated:** 2026-03-24
**Version:** v3.3.0
**Source:** Full codebase audit + live API testing + deep code path audit + user-reported bugs + 3 fix rounds

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

### ~~BUG-004: Setup wizard doesn't show on fresh install (when settings.json persists)~~ FIXED
**Status:** FIXED (v1.2.0)
**Fix:** NSIS uninstaller now deletes `~/.ghostlink/settings.json` on uninstall, so the wizard runs on reinstall. Other user data preserved.

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

### ~~BUG-008: No agents appear in the agent bar (fresh desktop install)~~ FIXED
**Status:** FIXED (v1.2.0)
**Fix:** Setup wizard now auto-detects installed CLIs (claude, codex, gemini) and pre-populates persistent agents on completion.

### ~~BUG-009: Launcher doesn't hide when chat window opens~~ FIXED
**Status:** FIXED (v1.0.0)
**Fix:** `createChatWindow()` now hides both launcher AND wizard windows in the `ready-to-show` handler.

### ~~BUG-010: "Update check failed" error on every launch~~ FIXED
**Status:** FIXED (v1.0.0)
**Fix:** electron-builder.yml pointed to correct repo `nahldi/ghostlink`. Updater error handler now gracefully suppresses network errors, 404s, missing releases, and DNS failures — shows "Up to date" instead of scary error text.

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

## v1.6.x BUGS

### BUG-019: All 7 new MCP tools crashed with TypeError — FIXED (v1.6.2)
### BUG-020: Webhook delivery blocked WebSocket broadcasts — FIXED (v1.6.2)
### BUG-021: Gemini video gen created empty files — FIXED (v1.6.2)
### BUG-022: Auth detection too strict for Claude/Gemini — FIXED (v1.6.3)
### BUG-023: Gemini Connect opens wrong terminal command — FIXED (v1.6.3)

### BUG-024: Gemini and Copilot fail to spawn — FIXED (v1.7.0)
**Fix:** Copilot command corrected from `github-copilot` to `gh` with `copilot` subcommand. Spawn endpoint now also checks WSL when command not on host PATH.

### BUG-025: Failed agent spawns leave ghost agents in bar — FIXED (v1.7.0)
**Fix:** Persistent agent entry is rolled back on spawn failure.

### BUG-026: Claude can't use GhostLink MCP tools — FIXED (v1.7.1)
**Fix:** The trigger text injected via tmux was `mcp read #general` which confused Claude into looking for an external MCP command. Replaced with natural language: `"You were @mentioned in #general on GhostLink. Use the chat_read tool with channel="general" to read recent messages, then use chat_send to respond."` This tells Claude to use its available MCP tools instead of interpreting "mcp read" as a literal command.
**Future feature:** Settings > Integrations panel for external chat bridges (Discord, Slack, Telegram) — bot token input, channel mapping, on/off toggle. Off by default.

### BUG-028: Many config/setup tasks require terminal access — should all be in UI
**Severity:** High — breaks the "no terminal needed" promise of the desktop app
**Where:** Various — agent config, integrations, troubleshooting
**Examples of things that currently require terminal:**
- Editing `config.toml` for agent commands, ports, or custom args
- Installing agent CLIs (npm/pip commands)
- Removing ghost "Offline" agents from persistent list (editing settings.json)
- Viewing agent tmux output for debugging (Terminal Peek exists but limited)
- Setting environment variables for API keys
- Running `wrapper.py` manually for advanced agent configs
**User expectation:** If the desktop UI is installed, the user should never need to open a terminal. All customization, personalization, agent management, API key entry, integration setup, and troubleshooting should be doable entirely from the UI.
**Status:** Open

### BUG-027: Thinking glow not showing — FIXED (v1.7.0)
**Fix:** Reduced startup delay from 15s to 5s. Heartbeat now checks `_was_triggered` flag from @mentions to activate thinking immediately. Thinking state now activates both from activity detection and from @mention triggers.

---

## v1.6.3 DEEP AUDIT BUGS (2026-03-23)

### BUG-029: Killing one agent can kill another agent's process — FIXED (v1.7.0)
### BUG-030: Schedule checker silently fails — unawaited coroutines — FIXED (v1.7.0)
### BUG-031: Settings save race condition — FIXED (v1.7.0)
### BUG-032: Rate limiter too aggressive + IP cleanup — FIXED (v1.7.0)
### BUG-033: Progress card updates don't broadcast — FIXED (v1.7.0)
### BUG-034: WebSocket reconnect doesn't fetch missed messages — FIXED (v1.7.0)
### BUG-035: Messages array grows unbounded — FIXED (v1.7.0)
### BUG-036: useWebSocket stale closures — VERIFIED NOT A BUG (Zustand stable refs)
### BUG-037: Select mode persists across channel switches — FIXED (v1.7.0)
### BUG-038: Approval auto-approve presses wrong keys — FIXED (v1.7.0)
### BUG-039: Silent API errors — FIXED (v1.7.0)
### BUG-040: Rate limiter IP entries never cleaned — FIXED (v1.7.0)
### BUG-041: Z-index conflicts between modals — FIXED (v1.7.0)
### BUG-042: Direct store._db access — FIXED (v1.7.0)

### BUG-043: Agent spawn setTimeout not cancelled on modal close
**Severity:** Low
**Where:** `frontend/src/components/AddAgentModal.tsx:165-171`
**Root cause:** After spawning, a 3-second setTimeout fetches status. If modal is closed before timeout fires, it updates unmounted component state.
**Status:** Open

### BUG-044: QR code leaked tunnel URL to external API — FIXED (v1.7.0)
**Fix:** Replaced external QR API with local canvas-based generation. Tunnel URL never leaves the client.

### BUG-045: Clipboard API not checked before use
**Severity:** Low
**Where:** `frontend/src/components/CodeBlock.tsx:11-14`
**Root cause:** `navigator.clipboard.writeText()` called without checking availability. Fails in older browsers or insecure (http://) contexts.
**Status:** Open

### BUG-046: OAuth sign-in not available — all providers require manual API key entry
**Severity:** High — UX friction
**Where:** Settings > AI > Providers panel
**Root cause:** All 13 providers (Anthropic, OpenAI, Google, xAI, Mistral, DeepSeek, Perplexity, Cohere, OpenRouter, Groq, Together, HuggingFace, Ollama) require manually pasting API keys. There's no OAuth flow for providers that support it (Google, GitHub). Users with subscriptions (Claude Pro, ChatGPT Plus, Gemini Advanced) can't sign in with their accounts — they must separately obtain API keys. Should offer one-click OAuth where the provider supports it.
**Status:** Open

---

## v1.6.3 DEEP AUDIT ROUND 2 (2026-03-23)

### BUG-047: XSS in HTML export — FIXED (v1.7.0)
### BUG-048: Arbitrary settings injection — FIXED (v1.7.0)
### BUG-049: Webhook update field injection — FIXED (v1.7.0)
### BUG-050: Provider config key injection — FIXED (v1.7.0)
### BUG-051: Agent config unvalidated values — FIXED (v1.7.0)
### BUG-052: SSRF bypass in mcp_bridge web_fetch — FIXED (v1.7.0)
### BUG-053: Wizard allows proceeding without Python — FIXED (v1.7.0)
### BUG-054: Launcher hardcodes port 8300 — FIXED (v1.7.0)
### BUG-055: Start scripts fail without venv — FIXED (v1.7.0)
### BUG-056: ReplayViewer variable naming — FIXED (v1.7.0)
### BUG-057: Sidebar channel response type mismatch — FIXED (v1.7.0)
### BUG-058: MessageInput attachments not sent — FIXED (v1.7.1)
### BUG-059: Voice language recognizer — VERIFIED NOT A BUG (recreated each press)
### BUG-060: TerminalPeek polling after unmount — FIXED (v1.7.0)
### BUG-061: Auth detection false positives — FIXED (v1.7.0)
### BUG-062: CSS @property Firefox/Safari — FIXED (v1.7.1)
### BUG-063: CSS scrollbar Firefox fallback — FIXED (v1.7.0)
### BUG-064: file_watcher thread cleanup — FIXED (v1.7.0)
### BUG-065: Video duration validation — FIXED (v1.7.0)
### BUG-066: Snapshot import value validation — FIXED (v1.7.0)

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

---

## SECURITY FIXES (v2.3.0)

### ~~SEC-005: XOR encryption too weak for secrets~~ FIXED
**Status:** FIXED (v2.3.0)
**Fix:** `SecretsManager` now uses Fernet (AES-128-CBC + HMAC-SHA256) via `cryptography` package. Key derived with PBKDF2-HMAC-SHA256 (100k iterations). Old XOR data still readable via fallback. Prefix detection (`fernet:`) distinguishes new vs. old ciphertext.

### ~~SEC-006: /api/send accessible from external hosts~~ FIXED
**Status:** FIXED (v2.3.0)
**Fix:** Added localhost guard at top of `send_message`. Requests from non-127.0.0.1/::1 clients get HTTP 403. Prevents external message injection via tunnel/LAN.

### ~~SEC-007: Webhook delivery vulnerable to SSRF~~ FIXED
**Status:** FIXED (v2.3.0)
**Fix:** `_deliver_webhooks` now calls `_is_private_url()` before each outbound POST. Private/loopback/link-local URLs are blocked and logged.

### ~~SEC-008: WebSocket has no auth for external connections~~ FIXED
**Status:** FIXED (v2.3.0)
**Fix:** Non-localhost WebSocket clients must supply `?token=<token>`. Token generated at startup via `secrets.token_urlsafe(32)`, served at `GET /api/ws-token` (localhost only).

### ~~SEC-009: MCP auto-approve too broad — fires on any "ghostlink" mention~~ FIXED
**Status:** FIXED (v2.3.0)
**Fix:** Replaced loose substring check with `_GHOSTLINK_MCP_RE` regex that matches `ghostlink/tool_name` format only.

### ~~SEC-010: Plugin safety scanner only checked 3 patterns~~ FIXED
**Status:** FIXED (v2.3.0)
**Fix:** `install_plugin` now uses `SafetyScanner` (AST-based) from `plugin_sdk` first. Falls back to 8-pattern string check if unavailable.

---

## BACKEND FIXES (v2.9.0)

### ~~BUG-C5: Agent process tracking race condition~~ FIXED (v2.9.0)
**Where:** `backend/app.py` — agent spawn/kill handlers
**Root cause:** `_agent_processes` dict accessed from both the spawn endpoint and the kill endpoint without an asyncio lock. Concurrent spawns for the same agent name could overwrite each other's process handle, making one process un-killable (leaked process).
**Fix:** All reads and writes to `_agent_processes` now happen inside `async with deps._agent_lock`. Moved to `deps.py` so all route modules share the same lock instance.

### ~~BUG-H2: Settings concurrent mutation~~ FIXED (v2.9.0)
**Where:** `backend/app.py` — `save_settings` / `get_settings`
**Root cause:** Settings JSON file written and read from multiple async tasks without a lock. Concurrent requests could read a partially-written file or produce a torn write.
**Fix:** `_settings_lock = asyncio.Lock()` in `deps.py`. All settings load/save operations acquire the lock.

### ~~BUG-H4: SIGKILL not escalated when SIGTERM is ignored~~ FIXED (v2.9.0)
**Where:** `backend/app.py` — agent kill endpoint
**Root cause:** Kill endpoint sent `SIGTERM` but never followed up with `SIGKILL` if process remained alive. Agents that ignored SIGTERM would stay running.
**Fix:** After SIGTERM, a 3-second grace period check is added. If process is still alive, `SIGKILL` is sent.

### ~~BUG-H5: Approval file write race (non-atomic)~~ FIXED (v2.9.0)
**Where:** `backend/app.py` — approval file creation
**Root cause:** Approval result written by opening the file and writing directly. Concurrent readers could see a partial file.
**Fix:** Write to a temp file then `os.replace()` (atomic on POSIX). Readers always see either the old file or the complete new file.

---

## ARCHITECTURE FIXES (v3.0.0)

### ~~ARCH-004: 3400-line monolithic app.py~~ RESOLVED (v3.0.0)
**Root cause:** All 90+ API endpoints lived in a single `app.py` file, making it impossible to navigate, test in isolation, or extend without merge conflicts.
**Fix:** Split into `backend/deps.py` (shared state) + 13 `backend/routes/` modules: `agents.py`, `bridges.py`, `channels.py`, `jobs.py`, `messages.py`, `misc.py`, `plugins.py`, `providers.py`, `rules.py`, `schedules.py`, `search.py`, `security.py`, `sessions.py`. `app.py` reduced from 3401 → 612 lines.

---

## HOURLY HEALTH AUDIT — 2026-03-24T11:XX UTC

**Audit type:** Automated scheduled audit (no code edits — issues logged only)
**Test suite:** 56/56 tests passed
**TypeScript:** Compiles clean (0 errors from `tsc -b`)
**Frontend:** 0 vulnerabilities in npm audit; 306 packages OK
**Git:** On `master`, up to date with `origin/master`. 50 files with uncommitted changes (all from recent v3.3.0 work). 1 stash present.

### BUG-067: Backend dependency conflict — fastapi vs mcp version pins
**Severity:** HIGH — fresh `pip install -r requirements.txt` fails
**Where:** `backend/requirements.txt`
**Root cause:** `fastapi==0.115.0` requires `starlette<0.39.0`, but `mcp==1.0.0` requires `starlette>=0.39`. These two pins are mutually incompatible. A fresh install produces `ResolutionImpossible`.
**Workaround:** `pip install "fastapi>=0.115.0" "mcp>=1.0.0"` (lets pip resolve to compatible versions — installs mcp 1.26.0 with starlette 0.46+, upgrading fastapi accordingly).
**Fix needed:** Update `requirements.txt` to use compatible version ranges, e.g. `fastapi>=0.115.0` and `mcp>=1.0.0` (remove exact pins), or pin to tested-compatible combo like `fastapi==0.115.12` + `mcp==1.26.0`.
**Status:** Open

### BUG-068: Audit log hardcodes version "2.5.1" instead of app.__version__
**Severity:** LOW — misleading log data
**Where:** `backend/app.py` line 269
**Root cause:** `audit_log.log("server_start", {"version": "2.5.1", ...})` — the version string was never updated when the app moved to v3.0.0. Should reference `__version__` variable.
**Status:** Open

### BUG-069: MessageRouter constructor mismatch in tests — latent hop-guard crash
**Severity:** MEDIUM — will crash in production multi-agent conversations
**Where:** `backend/tests/test_modules.py` lines 138, 151, 163; `backend/tests/test_integration.py` line 35
**Root cause:** Tests call `MessageRouter(reg)` passing an `AgentRegistry` object as the first arg. The constructor signature is `__init__(self, max_hops: int = 4, default_routing: str = "none")`. Python silently accepts this (no runtime type enforcement). The tests pass because they never trigger the hop guard (`sender` is always `"You"`, not an agent). But in production, when an agent routes to another agent and `count > self.max_hops` is evaluated (router.py line 71), it compares `int > AgentRegistry`, which throws `TypeError`.
**Fix needed:** Either update the tests to `MessageRouter()` (use defaults) or `MessageRouter(max_hops=4)`, OR update the constructor to optionally accept a registry.
**Status:** Open

### BUG-070: SQLite databases are empty (0 bytes) — data loss
**Severity:** HIGH — server cannot start; all message history lost
**Where:** `backend/data/ghostlink.db` (0 bytes), `backend/data/ghostlink_v2.db` (0 bytes)
**Root cause:** Both primary database files are empty. `ghostlink.db-journal` (4616 bytes) and `ghostlink.db.bak` (57344 bytes with 4 messages) exist, suggesting a crash or unclean shutdown corrupted the WAL/journal. The server fails to start with `sqlite3.OperationalError: disk I/O error` when attempting `PRAGMA journal_mode=WAL` on the empty file.
**Fix needed:** Restore from `.bak` if available (`cp ghostlink.db.bak ghostlink.db`), or add startup recovery logic that detects an empty/corrupt DB and rebuilds from backup.
**Status:** Open

### BUG-071: Version numbers out of sync across packages
**Severity:** LOW — cosmetic / release hygiene
**Where:** Multiple files
**Details:**
- `backend/app.py` → `__version__ = "3.0.0"`
- `desktop/package.json` → `"version": "2.8.0"`
- `frontend/package.json` → `"version": "0.0.0"`
- `BUGS.md` header → `v3.3.0`
- Audit log → `"2.5.1"`
All should be synced to the same release version.
**Status:** Open

### BUG-072: 50 modified files uncommitted on master
**Severity:** LOW — risk of accidental loss
**Where:** Git working tree
**Root cause:** Extensive v3.3.0 changes across backend, frontend, and desktop are modified but not staged or committed. Includes all route modules, core backend files, frontend components, and package.json files. A `git checkout .` or disk failure would lose all this work.
**Recommendation:** Commit or stash the current working tree to preserve progress.
**Status:** Open
