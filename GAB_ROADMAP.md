# GAB Roadmap — Backend Fix Plan
## Standalone Phased Roadmap from the Ghostlink Audit Backend Session

**Owner:** GAB (Ghostlink Audit Backend)
**Created:** 2026-03-24
**Companion:** GAB_BACKEND_AUDIT.md (full audit with test plans)
**Scope:** Backend-only fixes — does NOT overlap with FRONTEND_AUDIT, CODEBASE_AUDIT, or V2.5_BUGFIX_ROADMAP
**Rule:** ZERO code edits in this session. This roadmap is for a future implementation session.

---

## Dependency Graph

```
Phase 0 (Foundation)
  └── Phase 1 (Critical Security)
        ├── Phase 2 (Agent Lifecycle)
        │     └── Phase 4 (MCP & Bridge Hardening)
        └── Phase 3 (Data Integrity)
              └── Phase 5 (Architecture)
                    └── Phase 6 (Testing & CI)
```

---

## Phase 0: Foundation (No Dependencies)
**Goal:** Establish the testing infrastructure that all other phases depend on.
**Estimated effort:** 2-3 days
**Files touched:** NEW files only (tests/), requirements-dev.txt

### 0.1 — Create test infrastructure
**What:** Set up pytest, conftest.py with fixtures for FastAPI test client, temp SQLite DB, mock agent registry.
**Why:** Every subsequent fix needs a test. Can't verify anything without this.

**Fail test:** `pytest` command doesn't exist or finds zero tests.
**Fix:** Create `tests/conftest.py` with:
- `app_client` fixture (FastAPI TestClient with in-memory SQLite)
- `mock_registry` fixture (pre-populated AgentRegistry)
- `temp_data_dir` fixture (tmp_path with clean state)
- `mock_mcp_bridge` fixture (mock MCP server)
**Smoke test:** `pytest tests/ -v` runs and passes with at least a health check test.
**Verify:** CI can run tests headlessly. No tmux or real agents needed.

### 0.2 — Add requirements-dev.txt
**What:** `pytest`, `pytest-asyncio`, `httpx` (for async test client), `pytest-cov`
**Why:** Separate dev dependencies from production.

---

## Phase 1: Critical Security Fixes (Depends on Phase 0)
**Goal:** Fix all CRITICAL severity bugs from the audit.
**Estimated effort:** 2-3 days
**Files touched:** security.py, app.py

### 1.1 — Fix encryption key derivation (BUG-C2)
**What:** Replace predictable `data_dir:username` key material with random master key file.
**Files:** security.py lines 51-54

**Fail test:**
```python
def test_key_derivation_is_unpredictable():
    """Two SecretsManagers with same data_dir + username should have different keys."""
    sm1 = SecretsManager(tmp_path / "a")
    sm2 = SecretsManager(tmp_path / "b")
    # Currently PASSES (same key) — after fix should FAIL
    assert sm1._key != sm2._key  # Currently fails — keys are same if username matches
```

**Fix:**
```python
def _derive_key(self) -> bytes:
    key_file = self._data_dir / ".master_key"
    if not key_file.exists():
        key_file.write_bytes(os.urandom(32))
        try:
            os.chmod(key_file, 0o600)
        except OSError:
            pass  # Windows doesn't support chmod
    return key_file.read_bytes()
```

**Smoke test:**
```python
def test_secrets_roundtrip_with_new_key():
    sm = SecretsManager(tmp_path)
    sm.store("test_key", "my-secret-value")
    assert sm.get("test_key") == "my-secret-value"
```

**Verify:** Existing secrets from old key scheme — add migration logic that re-encrypts on first access.

### 1.2 — Remove XOR fallback (BUG-C1)
**What:** Make `cryptography` a hard requirement. Raise error if not installed.
**Files:** security.py lines 30-31, 61-66

**Fail test:**
```python
def test_xor_fallback_not_used():
    """Verify XOR encryption path is unreachable."""
    assert HAS_FERNET is True  # cryptography must be installed
    sm = SecretsManager(tmp_path)
    encrypted = sm._encrypt("test")
    assert encrypted.startswith("fernet:")  # Never plain XOR
```

**Fix:** At module level:
```python
if not HAS_FERNET:
    raise ImportError("cryptography package is required. Install: pip install cryptography")
```

**Smoke test:** Start server, store/retrieve a secret. Verify `secrets.enc` has `fernet:` prefix.
**Verify:** requirements.txt already lists `cryptography==43.0.3`.

### 1.3 — Fix hardcoded Fernet salt (BUG-C3)
**What:** Generate random per-installation salt, store alongside master key.
**Files:** security.py line 58

**Fail test:**
```python
def test_salt_is_unique_per_installation():
    sm1 = SecretsManager(tmp_path / "install1")
    sm2 = SecretsManager(tmp_path / "install2")
    salt1 = (tmp_path / "install1" / ".salt").read_bytes()
    salt2 = (tmp_path / "install2" / ".salt").read_bytes()
    assert salt1 != salt2
```

**Fix:**
```python
def _fernet(self):
    salt_file = self._data_dir / ".salt"
    if not salt_file.exists():
        salt_file.write_bytes(os.urandom(16))
    salt = salt_file.read_bytes()
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=100_000)
    return Fernet(base64.urlsafe_b64encode(kdf.derive(self._key)))
```

**Smoke test:** Secrets stored before and after migration both decrypt.
**Verify:** Need migration: detect old-salt secrets and re-encrypt.

### 1.4 — Fix duplicate /api/usage endpoint (BUG-C4)
**What:** Merge the two conflicting implementations.
**Files:** app.py lines 1943 and 3210

**Fail test:**
```python
def test_usage_roundtrip():
    """POST usage data should be retrievable via GET."""
    client.post("/api/usage", json={"agent": "claude-1", "tokens": 100})
    resp = client.get("/api/usage")
    data = resp.json()
    assert any(entry.get("agent") == "claude-1" for entry in data)
```

**Fix:** Remove the duplicate at line 1943 (old implementation). Keep the newer one at line 3210 that uses `_usage_log`.
**Smoke test:** Frontend token usage display still works.
**Verify:** No other code references the old `_usage` dict.

### 1.5 — Fix agent process tracking race (BUG-C5)
**What:** Store processes by registered name, not `{base}_{pid}`.
**Files:** app.py lines 1288-1304, 1341-1344

**Fail test:**
```python
def test_kill_agent_doesnt_kill_siblings():
    """Killing claude-1 should not affect claude-2."""
    # Spawn two agents, kill one, verify other survives
    client.post("/api/spawn-agent", json={"base": "claude"})
    client.post("/api/spawn-agent", json={"base": "claude"})
    status = client.get("/api/status").json()
    agents = [a for a in status["agents"] if a["base"] == "claude"]
    assert len(agents) == 2
    client.post(f"/api/kill-agent/{agents[0]['name']}")
    status2 = client.get("/api/status").json()
    remaining = [a for a in status2["agents"] if a["base"] == "claude"]
    assert len(remaining) == 1
    assert remaining[0]["name"] == agents[1]["name"]
```

**Fix:** After spawn, query registry for the assigned name and store as `_agent_processes[assigned_name] = proc`.
**Smoke test:** Spawn/kill cycles don't leave orphans.
**Verify:** Cleanup endpoint still finds and kills stale processes.

---

## Phase 2: Agent Lifecycle Fixes (Depends on Phase 1)
**Goal:** Fix agent spawn, detection, and lifecycle management.
**Estimated effort:** 2-3 days
**Files touched:** app.py (spawn logic), wrapper.py, wrapper_unix.py

### 2.1 — Fix Gemini PATH detection (Section 5 of audit)
**What:** Change `bash -lc` to `bash -ic` for WSL agent detection.
**Files:** app.py lines 1110-1127

**Fail test:**
```python
def test_gemini_detected_via_nvm():
    """Gemini CLI installed via NVM should be detected."""
    # Mock WSL call with -ic returning success
    result = _check_available("gemini", "gemini")
    assert result is True
```

**Fix:** Change line 1121 from `['wsl', 'bash', '-lc', check]` to `['wsl', 'bash', '-ic', check]`.
**Smoke test:** `GET /api/agent-templates` returns `gemini` with `available: true`.
**Verify:** No interactive prompts from `-i` flag. Test on system without NVM.

### 2.2 — Cache agent detection results globally
**What:** `_available_cache` is per-request local. Make it module-level with TTL.
**Files:** app.py lines 1083-1100

**Fail test:**
```python
def test_agent_templates_performance():
    """Second call should be 10x faster (cached)."""
    import time
    t1 = time.time(); client.get("/api/agent-templates"); d1 = time.time() - t1
    t2 = time.time(); client.get("/api/agent-templates"); d2 = time.time() - t2
    assert d2 < d1 / 5  # At least 5x faster
```

**Fix:** Module-level `_AGENT_AVAILABLE_CACHE: dict[str, tuple[bool, float]] = {}` with 60-second TTL.
**Smoke test:** Multiple template requests don't spawn 65 WSL subprocesses each.
**Verify:** Cache invalidated when new agents installed.

### 2.3 — Skip approval watcher when auto-approve is on
**What:** Don't start `_approval_watcher` thread when `--dangerously-skip-permissions` is in args.
**Files:** wrapper.py lines 910-920

**Fail test:**
```python
# Manual: Spawn Claude with --dangerously-skip-permissions
# Check thread count — approval watcher thread exists but never triggers
# CPU usage slightly higher than necessary
```

**Fix:** Before starting approval watcher, check if agent_args contains auto-approve flags:
```python
_AUTO_APPROVE_FLAGS = {"--dangerously-skip-permissions", "--full-auto", "-a never", "--yes", "-y"}
skip_approval = any(flag in " ".join(launch_args) for flag in _AUTO_APPROVE_FLAGS)
if not skip_approval:
    threading.Thread(target=_approval_watcher, ...).start()
```

**Smoke test:** Claude agent works normally, no approval prompts appear (they wouldn't anyway).
**Verify:** Non-auto-approve agents still get approval watcher.

### 2.4 — Add SIGKILL escalation (BUG-H4)
**What:** After SIGTERM, wait 5s, then SIGKILL if process still alive.
**Files:** app.py kill_agent and shutdown endpoints

**Fail test:**
```python
# Start a process that ignores SIGTERM
# Call kill-agent — process survives
```

**Fix:**
```python
proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
    proc.wait(timeout=3)
```

**Smoke test:** Hung agents cleaned up within 8 seconds.
**Verify:** Normal agents still exit cleanly on SIGTERM.

---

## Phase 3: Data Integrity Fixes (Depends on Phase 1)
**Goal:** Fix all data persistence and state management bugs.
**Estimated effort:** 2-3 days
**Files touched:** app.py, sessions.py, rules.py, store.py, agent_memory.py

### 3.1 — Fix settings concurrent mutation (BUG-H2)
**What:** Add asyncio.Lock around all `_settings` dict mutations.
**Files:** app.py

**Fail test:**
```python
async def test_concurrent_settings_writes():
    """Concurrent writes should not lose data."""
    import asyncio
    tasks = [client.post("/api/settings", json={f"key_{i}": f"val_{i}"}) for i in range(10)]
    await asyncio.gather(*tasks)
    settings = client.get("/api/settings").json()
    for i in range(10):
        assert f"key_{i}" in settings
```

**Fix:** `_settings_lock = asyncio.Lock()` guarding all mutations.
**Smoke test:** Settings survive rapid concurrent writes.
**Verify:** No deadlocks. Settings save to disk after each mutation.

### 3.2 — Persist session state (BUG-M6)
**What:** Save session state to SQLite on each state change.
**Files:** sessions.py

**Fail test:**
```python
def test_session_survives_restart():
    client.post("/api/sessions/general/start", json={"template": "code-review"})
    client.post("/api/sessions/general/advance")
    # Simulate restart by recreating SessionManager
    session = client.get("/api/sessions/general").json()
    assert session["phase"] == 1  # Currently 0 after restart
```

**Fix:** Add SQLite table `sessions` with columns: channel, template, phase, roles, state_json, started_at.
**Smoke test:** Session at phase 2 survives restart.
**Verify:** Performance not degraded (one DB write per advance).

### 3.3 — Persist rule epoch counter (BUG-M7)
**What:** Store epoch in DB alongside rules.
**Files:** rules.py

**Fail test:**
```python
def test_epoch_persists():
    rule_store.propose(...)  # epoch=1
    rule_store.propose(...)  # epoch=2
    # Recreate store
    rule_store2 = RuleStore(db)
    assert rule_store2.epoch == 2  # Currently 0
```

**Fix:** Add `metadata` table or store epoch in rules table.
**Smoke test:** Epoch consistent across restarts.
**Verify:** Rule versioning comparisons work.

### 3.4 — Fix thinking buffer memory leak (BUG-H1)
**What:** Clean up buffers on deregister. Add 5-minute TTL expiry.
**Files:** app.py

**Fail test:**
```python
def test_thinking_buffers_cleaned_on_deregister():
    # Register agent, post thinking, deregister
    _thinking_buffers["test-agent"] = {"text": "thinking...", "ts": time.time()}
    client.post("/api/deregister/test-agent")
    assert "test-agent" not in _thinking_buffers
```

**Fix:** In deregister handler, add `_thinking_buffers.pop(name, None)`. Add periodic cleanup in health monitor.
**Smoke test:** Buffer count stays bounded after agent churn.
**Verify:** Active agents' thinking still displays.

### 3.5 — Fix approval response file race (BUG-H5)
**What:** Use atomic file writes (write to temp, then rename).
**Files:** app.py approval endpoint, wrapper.py reader

**Fail test:**
```python
# Rapid approval responses — some silently fail
# Check wrapper logs for JSON decode errors
```

**Fix:** Writer: `tmp = target.with_suffix('.tmp'); tmp.write_text(json); os.replace(tmp, target)`
**Smoke test:** 100 rapid approval responses all processed.
**Verify:** File system atomic rename works (POSIX guaranteed).

---

## Phase 4: MCP & Bridge Hardening (Depends on Phase 2)
**Goal:** Fix all MCP config injection and bridge issues.
**Estimated effort:** 3-4 days
**Files touched:** wrapper.py, mcp_bridge.py, mcp_proxy.py, bridges.py

### 4.1 — Fix Codex proxy_flag template splitting (BUG-MCP-2)
**What:** Use `shlex.split()` instead of `str.split()` for template expansion.
**Files:** wrapper.py line 229

**Fail test:**
```python
def test_proxy_flag_with_special_url():
    template = '-c mcp_servers.{server}.url="{url}"'
    expanded = template.format(server="ghostlink", url="http://127.0.0.1:8200/mcp")
    # str.split() breaks the URL at the colon
    parts = expanded.split()
    assert len(parts) > 2  # Wrong — should be 2 args
```

**Fix:** `launch_args = shlex.split(expanded)` (already imported).
**Smoke test:** Codex receives correct MCP URL with port.
**Verify:** Other agents using proxy_flag still work.

### 4.2 — Fix Gemini settings JSON dual-key (BUG-MCP-3)
**What:** Determine which key Gemini CLI reads and remove the other.
**Files:** wrapper.py lines 108-112

**Fail test:**
```python
# Spawn Gemini, check MCP bridge logs — if no connection, wrong key format
```

**Fix:** Research Gemini CLI source. If `httpUrl` is correct, remove `url`. If `url` is correct, remove `httpUrl`.
**Smoke test:** Gemini connects to GhostLink MCP bridge.
**Verify:** Check Gemini CLI changelog for settings format changes.

### 4.3 — Mask bridge tokens in logs (BUG-H7)
**What:** Redact tokens before logging.
**Files:** bridges.py

**Fail test:**
```python
# Start Discord bridge with token="abc123xyz789"
# Grep stdout for full token — found
```

**Fix:** `log.info(f"Starting bridge with token {token[:4]}...{token[-4:]}")`
**Smoke test:** Token not in logs. Bridge still connects.
**Verify:** Debug logging also masked.

### 4.4 — Add backpressure to MCP bridge callbacks
**What:** Bridge message forwarding should be async with timeout, not blocking.
**Files:** mcp_bridge.py

**Fail test:**
```python
# Bridge callback to unreachable URL blocks MCP tool response
```

**Fix:** Use `asyncio.wait_for(callback(), timeout=5)` with fire-and-forget fallback.
**Smoke test:** MCP tools respond within SLA even when bridges are slow.
**Verify:** Bridge messages still delivered eventually.

### 4.5 — Fix MCP proxy sender injection trust (mcp_proxy.py)
**What:** Validate that the agent name in requests matches the proxy's assigned agent.
**Files:** mcp_proxy.py line 219

**Fail test:**
```python
# Agent "claude-1" sends request claiming to be "claude-2"
# Currently accepted without validation
```

**Fix:** Compare `args[sender_key]` against `proxy.agent_name`. Reject mismatches.
**Smoke test:** Agents can only send as themselves.
**Verify:** Normal agent requests still work.

---

## Phase 5: Architecture Improvements (Depends on Phase 3)
**Goal:** Decompose monolith, fix structural issues.
**Estimated effort:** 5-7 days
**Files touched:** app.py (split), NEW route files

### 5.1 — Split app.py into route modules
**What:** Extract endpoint groups into separate files:
- `routes/messages.py` (10 endpoints)
- `routes/agents.py` (18 endpoints)
- `routes/channels.py` (5 endpoints)
- `routes/jobs.py` (4 endpoints)
- `routes/rules.py` (4 endpoints)
- `routes/schedules.py` (4 endpoints)
- `routes/sessions.py` (8 endpoints)
- `routes/security.py` (12 endpoints)
- `routes/plugins.py` (9 endpoints)
- `routes/providers.py` (5 endpoints)
- `routes/bridges.py` (5 endpoints)
- `routes/export.py` (4 endpoints)
- `routes/misc.py` (remaining)

**Fail test:** `wc -l app.py` > 3000 lines.
**Fix:** Use FastAPI `APIRouter` for each module. Import and mount in app.py.
**Smoke test:** All 95+ endpoints still respond correctly.
**Verify:** No circular imports. All shared state accessible via dependency injection.

### 5.2 — Replace file-based IPC with SQLite queue
**What:** Replace `{agent}_queue.jsonl` file polling with a `trigger_queue` SQLite table.
**Files:** wrapper.py queue watcher, app.py trigger endpoints

**Fail test:** Under high trigger frequency, file operations lose triggers (rename race).
**Fix:** SQLite table with `id, agent_name, channel, payload, created_at, processed_at`.
**Smoke test:** 100 rapid @mentions all delivered.
**Verify:** Wrapper can read from SQLite without conflicting with main server writes (WAL mode).

### 5.3 — Add agent workspace path validation (BUG-H6)
**What:** Resolve and validate workspace paths. Block traversal.
**Files:** app.py agent config endpoint

**Fail test:**
```python
def test_workspace_path_traversal_blocked():
    resp = client.post("/api/agents/claude-1/config", json={"workspace": "../../../../etc"})
    assert resp.status_code == 400
```

**Fix:** `resolved = Path(workspace).resolve()` — check it exists and is a directory.
**Smoke test:** Valid paths work. `../` paths rejected.
**Verify:** Relative paths within project still allowed.

### 5.4 — Add connection pooling comments/plan
**What:** Document how to add connection pooling (aiosqlite limitations).
**Note:** aiosqlite doesn't support true connection pooling. Plan for migration to `databases` or `encode/databases` library.

---

## Phase 6: Testing & CI (Depends on Phase 5)
**Goal:** Comprehensive test coverage and CI pipeline.
**Estimated effort:** 5-7 days
**Files touched:** tests/ (all new)

### 6.1 — Unit tests for all modules
**What:** At least one test per public function in each of the 15 backend modules.
**Target:** 80%+ line coverage on non-app.py modules.

### 6.2 — Integration tests for critical flows
**What:** End-to-end tests for:
- Agent spawn → register → heartbeat → kill lifecycle
- Message send → route → deliver → MCP read
- Approval prompt → UI response → tmux injection
- Secret store → encrypt → retrieve → decrypt

### 6.3 — CI pipeline
**What:** GitHub Actions workflow:
- `pytest --cov` on every PR
- Linting with `ruff`
- Type checking with `pyright` or `mypy`
- Security scan with `bandit`

### 6.4 — Load testing
**What:** Benchmark with `locust` or similar:
- 50 concurrent WebSocket clients
- 100 messages/second throughput
- 10 simultaneous agent spawns

---

## Phase Summary

| Phase | Bugs Fixed | Effort | Dependencies |
|-------|-----------|--------|-------------|
| **0: Foundation** | 0 (test infra) | 2-3 days | None |
| **1: Critical Security** | C1, C2, C3, C4, C5 | 2-3 days | Phase 0 |
| **2: Agent Lifecycle** | Gemini PATH, detection cache, approval watcher, SIGKILL | 2-3 days | Phase 1 |
| **3: Data Integrity** | H1, H2, H5, M6, M7, settings lock | 2-3 days | Phase 1 |
| **4: MCP & Bridges** | MCP-2, MCP-3, H7, proxy trust, backpressure | 3-4 days | Phase 2 |
| **5: Architecture** | H6, monolith split, file IPC, connection pool | 5-7 days | Phase 3 |
| **6: Testing & CI** | Coverage, integration, CI, load test | 5-7 days | Phase 5 |
| **TOTAL** | **25+ bugs** | **~22-30 days** | Sequential |

---

## What This Roadmap Does NOT Cover (Handled by Other Audits)

- Frontend component splitting (SettingsPanel.tsx 1,868 lines) → FRONTEND_AUDIT
- CSS/UI bugs → FRONTEND_AUDIT
- Desktop app (Electron) issues → separate audit
- New feature development → FEATURES.md / ROADMAP.md
- v2.5 specific bugfixes already tracked → V2.5_BUGFIX_ROADMAP

---

## Quick Wins (Can Be Done in Any Order, No Dependencies)

These are standalone fixes that don't depend on the phased plan:

1. **BUG-L2:** Read and log agent wrapper stdout/stderr (5 min fix)
2. **BUG-L3:** Remove dead `_empty_read_count` code (2 min fix)
3. **BUG-L4:** Add TTL to `_memory_cache` dict (10 min fix)
4. **BUG-M2:** Cap reactions at 50 per message (10 min fix)
5. **BUG-M1:** Log FTS5 errors before fallback (5 min fix)
6. **BUG-H7:** Mask bridge tokens in logs (5 min fix)

---

*End of GAB Roadmap*
