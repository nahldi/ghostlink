# GhostLink — Desktop App Architecture Plan

> This document outlines the desktop app architecture. The Windows .exe is built via electron-builder. macOS and Linux builds are planned.

---

## Overview
Standalone .exe / .dmg / .AppImage that wraps the GhostLink web app in Electron with a launcher screen, OAuth login, and system tray integration.

## Architecture

```
desktop/
├── main/                    # Electron main process
│   ├── index.ts            # App entry, window management
│   ├── launcher.ts         # Launcher window (start server, auth)
│   ├── server.ts           # Embedded Python backend lifecycle
│   ├── tray.ts             # System tray icon + menu
│   ├── auth/
│   │   ├── anthropic.ts    # Claude OAuth (claude auth login)
│   │   ├── openai.ts       # OpenAI OAuth
│   │   ├── google.ts       # Google OAuth (Gemini)
│   │   └── github.ts       # GitHub OAuth (Copilot)
│   └── updater.ts          # Auto-update via electron-updater
├── renderer/               # Launcher UI (separate from main app)
│   ├── launcher.html       # Launcher screen
│   └── launcher.css
├── package.json
├── electron-builder.yml    # Build config
└── forge.config.ts
```

## Launcher Screen
On app start, show a launcher window (not the chat):

1. **Server Status** — Running / Stopped / Port indicator
2. **Start Server** button — Starts embedded Python backend
3. **Auth Status** — Green checkmarks for each connected provider
4. **Connect buttons** — Per-provider OAuth login
5. **Clear Cache** button — Removes stale sessions (NOT chat history)
6. **Settings** — Port, theme, default workspace
7. **Version** — App version, update check

## Auth Detection (Current Implementation)

Authentication is handled via CLI auth status detection — not full OAuth flows.

### Anthropic (Claude)
- Detect auth status via `claude auth status`
- Launch `claude auth login` in user's terminal if needed

### OpenAI (Codex)
- Detect auth status via `codex auth status`
- API key entry as fallback via Settings panel

### Google (Gemini)
- API key entry via Settings panel (encrypted via SecretsManager)

### GitHub (Copilot)
- Detect status via `gh auth status`

> **Note:** Full OAuth browser flows (keytar, refresh tokens) are not yet implemented. Current approach uses CLI-based auth detection + API key entry through the encrypted secrets path.

## Packaging

### Windows (.exe)
- electron-builder with NSIS installer
- Desktop shortcut, Start menu entry
- Bundles Python 3.11 embedded + pip-installed backend
- Size target: < 150MB installed

### macOS (.dmg)
- electron-builder DMG
- Code signing via Apple Developer cert
- Notarization for Gatekeeper

### Linux (.AppImage + .deb)
- AppImage for universal Linux
- .deb for Debian/Ubuntu
- .rpm for Fedora/RHEL

## Auto-Update (In Launcher Window)
The launcher screen has a prominent **"Check for Updates"** button. Flow:

1. On app launch, auto-check GitHub Releases for new version (background, non-blocking)
2. If update available → show **"Update Available (v1.x.x)"** button with green badge in launcher
3. User clicks → progress bar shows download (delta update, not full re-download)
4. Download completes → **"Restart to Apply"** button appears
5. Click → app quits, installs update, relaunches to launcher
6. User clicks Start Server as normal

**Implementation:**
- `electron-updater` with `autoUpdater` API
- Update source: GitHub Releases (each release = a tagged commit with built artifacts)
- Differential updates via `electron-updater`'s built-in blockmap (only downloads changed bytes)
- Windows: NSIS web installer with delta support
- macOS: DMG with Sparkle-style differential
- Linux: AppImage auto-update protocol
- Update channel: `latest` (stable), `beta` (pre-release) — configurable in settings
- **No forced updates** — user always chooses when to update
- Version shown in launcher footer: "v1.0.2 — Up to date" or "v1.0.2 — Update available"
- Release notes shown in expandable panel before updating

**For us (publishing updates):**
```bash
# Bump version in package.json
# Build all platforms
npm run build:all
# Create GitHub Release with tag + upload artifacts
gh release create v1.0.3 dist/*.exe dist/*.dmg dist/*.AppImage --notes "changelog"
# electron-updater auto-detects the new release via GitHub API
```

## System Tray
- Tray icon shows server status (green/red dot)
- Right-click menu:
  - Open GhostLink
  - Start/Stop Server
  - Connected Agents submenu
  - Settings
  - Quit

## First-Run Wizard
1. Welcome screen with branding
2. Platform detection (Windows/WSL/macOS/Linux)
3. Dependency check (Python, Node, tmux)
4. Default workspace selection (folder picker)
5. Provider login (skip-able)
6. Launch server + open chat

## Cross-Platform Considerations

| Feature | Windows | macOS | Linux |
|---------|---------|-------|-------|
| Agent launch | cmd.exe / PowerShell | tmux | tmux |
| Folder picker | PowerShell dialog | osascript | zenity/kdialog |
| Keychain | credential-manager | Keychain | libsecret |
| Browser OAuth | Default browser | Default browser | xdg-open |
| Path format | C:\\ | / | / |
| WSL support | Yes (detect + path translate) | N/A | N/A |

## Tech Stack
- Electron 33+
- TypeScript for main process
- electron-builder for packaging
- keytar for secure credential storage
- electron-updater for auto-updates
- electron-log for logging

## Build Commands
```bash
# Development
npm run dev          # Start Electron in dev mode

# Production builds
npm run build:win    # Windows .exe
npm run build:mac    # macOS .dmg
npm run build:linux  # Linux .AppImage + .deb

# All platforms
npm run build:all
```

## Distribution
- GitHub Releases for downloads
- `winget install ghostlink` (Windows)
- `brew install ghostlink` (macOS)
- .deb repo for Linux
- Docker image: `docker run -p 8300:8300 ghostlink`
