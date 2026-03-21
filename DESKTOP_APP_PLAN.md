# AI Chattr — Desktop App Architecture Plan

> This document outlines the desktop app implementation. Do NOT build yet — this is the plan for when the web app is fully polished.

---

## Overview
Standalone .exe / .dmg / .AppImage that wraps the AI Chattr web app in Electron with a launcher screen, OAuth login, and system tray integration.

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

## OAuth Integration

### Anthropic (Claude)
- Run `claude auth login` in subprocess
- Detect auth status via `claude auth status`
- Store token in OS keychain (keytar)

### OpenAI (ChatGPT/Codex)
- API key entry (no OAuth available for CLI)
- Store in OS keychain
- Validate with test API call

### Google (Gemini)
- Google OAuth2 flow via browser
- Catch callback on localhost:PORT/auth/google/callback
- Store refresh token in OS keychain

### GitHub (Copilot)
- Run `gh auth login` device flow
- Detect status via `gh auth status`

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

## Auto-Update
- electron-updater with GitHub Releases as update source
- Check on startup, show notification badge
- User clicks "Update" → downloads + restarts

## System Tray
- Tray icon shows server status (green/red dot)
- Right-click menu:
  - Open AI Chattr
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
- `winget install aichttr` (Windows)
- `brew install aichttr` (macOS)
- .deb repo for Linux
- Docker image: `docker run -p 8300:8300 aichttr`
