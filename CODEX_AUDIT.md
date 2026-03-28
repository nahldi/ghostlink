# CODEX AUDIT — GhostLink v4.7.3

**Auditor:** Codex
**Date:** 2026-03-28
**Scope:** Backend, Electron/desktop shell, infra/versioning, release risk
**Mode:** Read-only audit; no product code edited

## Executive Summary

I verified 9 backend/Electron issues worth carrying into the shared roadmap.

- 3 HIGH
- 4 MEDIUM
- 2 LOW

The most important problems are:

1. Provider API keys are still written to plaintext `providers.json` even though the codebase has an encrypted `SecretsManager`.
2. The Electron launcher and setup wizard run with `nodeIntegration: true` and `contextIsolation: false` even though a preload bridge already exists.
3. Desktop startup/install code builds shell strings from filesystem paths and commands; paths containing quotes or shell metacharacters can break startup and create injection risk in WSL/native flows.

## Verified Findings

### HIGH

#### C-001: Provider API keys are stored unencrypted on disk
- Files:
  - `backend/routes/providers.py:29-40`
  - `backend/providers.py:231-235`
- Why it is real:
  - The configure route accepts `api_key` and passes it straight into `ProviderRegistry.save_config()`.
  - `ProviderRegistry.save_config()` persists the merged config directly to `providers.json`.
  - The app already has `SecretsManager`, but provider configuration bypasses it.
- Impact:
  - API keys are kept in plaintext at rest in the app data directory.
  - Export redaction only protects exported ZIPs; it does not protect the live local file.

#### C-002: Launcher and wizard disable Electron’s renderer isolation
- Files:
  - `desktop/main/index.ts:118-125`
  - `desktop/main/launcher.ts:40-47`
  - `desktop/renderer/wizard.js:5-10`
  - `desktop/renderer/launcher.js:12-17`
  - `desktop/main/preload.ts:54-79`
- Why it is real:
  - Both windows are created with `nodeIntegration: true` and `contextIsolation: false`.
  - Both renderers call `require('electron')` directly instead of using the preload bridge.
  - A scoped preload bridge already exists but is not used by those windows.
- Impact:
  - Any renderer compromise becomes main-process/Node compromise.
  - This is avoidable because the safer bridge is already present.

#### C-003: Desktop startup uses shell-built commands with unescaped paths
- Files:
  - `desktop/main/server.ts:186-219`
  - `desktop/main/server.ts:301-307`
  - `desktop/main/server.ts:328-341`
  - `desktop/main/server.ts:536-538`
  - `desktop/main/index.ts:351-368`
- Why it is real:
  - Multiple `execSync`/`execAsync` calls interpolate filesystem paths into shell command strings.
  - WSL path handling relies on single-quoted strings like `cd '${wslBackend}'` and `cat > '${wslDest}/${entry.name}'`.
  - Native dependency checks also shell out with interpolated interpreter paths instead of argument arrays.
- Impact:
  - Install/startup can fail for legitimate paths containing `'` or other shell-significant characters.
  - In WSL flows this is also a shell-injection surface if a path component is attacker-controlled.

### MEDIUM

#### C-004: Backend package version is out of sync with the shipped app version
- Files:
  - `backend/pyproject.toml:1-4`
  - `backend/app.py:5`
  - `desktop/package.json:3`
  - `frontend/package.json:4`
- Why it is real:
  - Backend package metadata still says `4.5.1`.
  - Runtime backend version and desktop/frontend package versions are `4.7.3`.
- Impact:
  - Release metadata, packaging, and tooling disagree about what version is running.

#### C-005: GDPR export manifest reports a stale version
- File:
  - `backend/security.py:429-431`
- Why it is real:
  - Exported manifest hardcodes `"version": "2.5.2"`.
- Impact:
  - Export bundles misreport the product version and weaken auditability/supportability.

#### C-006: Desktop lockfile metadata is still pinned to an old app version
- File:
  - `desktop/package-lock.json:3-10`
- Why it is real:
  - The lockfile root metadata still reports `2.5.6` while `desktop/package.json` is `4.7.3`.
- Impact:
  - Release/version bookkeeping is inconsistent.
  - It is easy to miss the real shipped version when auditing packaged artifacts.

#### C-007: Channel summary throws a server error when the DB is unavailable
- File:
  - `backend/routes/channels.py:72-80`
- Why it is real:
  - The route raises `RuntimeError("database not initialized")` instead of returning an API error response.
- Impact:
  - A recoverable service-state problem becomes a 500 with traceback-level behavior instead of a controlled 503-style response.

### LOW

#### C-008: Roadmap document is materially stale on current versioning status
- File:
  - `UNIFIED_ROADMAP.md:7`
  - `UNIFIED_ROADMAP.md:38-42`
- Why it is real:
  - The file says current version is `v4.7.0` and still contains resolved `3.9.x` version-sync items.
- Impact:
  - Planning and release discussions can anchor on outdated state.

#### C-009: Renderer unsubscribe helper removes every listener on the channel
- Files:
  - `desktop/renderer/wizard.js:9`
  - `desktop/renderer/launcher.js:16`
- Why it is real:
  - The returned cleanup uses `ipcRenderer.removeAllListeners(ch)` instead of removing the specific handler.
- Impact:
  - One teardown can silently detach unrelated listeners on the same channel.

## Disputed From Claude Audit

These claims did not hold up when checked against source:

- `backend/security.py` is not truncated.
  - `APPROVAL_REQUIRED` is correctly closed at `backend/security.py:198-202`.
- `backend/routes/misc.py:214` is not a behavior bug.
  - `if not url or not url.startswith("https://") and not url.startswith("http://"):` is logically equivalent to the intended validation because `and` binds tighter than `or`.
  - Parentheses would improve readability, but I am not counting it as a functional defect.
- Backend runtime version is not still on `4.5.1`.
  - `backend/app.py:5` is already `4.7.3`.
  - The real mismatch is `backend/pyproject.toml`.

## Verification Notes

- `frontend`: `npm run build` passed.
- `desktop`: `npm run build` passed.
- `backend`: `pytest -q` could not run in this environment because `pytest_asyncio` is not installed.
  - The repo does declare it in `backend/requirements-dev.txt:1-4`, so this is an environment verification gap, not source proof of a code defect by itself.
