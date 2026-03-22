/**
 * GhostLink — Electron Main Process Entry Point
 *
 * Orchestrates the launcher window, backend server lifecycle,
 * system tray, auto-updater, and chat browser window.
 *
 * On first run (no settings file), shows the setup wizard before the launcher.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import log from 'electron-log';
import path from 'path';
import fs from 'fs';
import { execSync, exec } from 'child_process';

import util from 'util';
const execAsync = util.promisify(exec);

import os from 'os';

import { serverManager } from './server';
import { createLauncherWindow, getLauncherWindow } from './launcher';
import { setupTray, updateTrayMenu } from './tray';
import { setupUpdater, checkForUpdates, downloadUpdate, installUpdate } from './updater';
import { authManager, winToWsl } from './auth/index';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info('GhostLink starting — version', app.getVersion());

// ---------------------------------------------------------------------------
// Settings file path
// ---------------------------------------------------------------------------
function getSettingsPath(): string {
  const homeDir = os.homedir();
  const ghostlinkDir = path.join(homeDir, '.ghostlink');
  return path.join(ghostlinkDir, 'settings.json');
}

function settingsExist(): boolean {
  try {
    const settingsPath = getSettingsPath();
    if (!fs.existsSync(settingsPath)) return false;
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    if (data.setupComplete !== true) return false;
    // Re-run wizard if app version changed (major.minor bump)
    const savedVersion = (data.appVersion || '0.0.0').split('.').slice(0, 2).join('.');
    const currentVersion = app.getVersion().split('.').slice(0, 2).join('.');
    if (savedVersion !== currentVersion) return false;
    return true;
  } catch {
    return false;
  }
}

function saveSettings(settings: Record<string, any>): void {
  const settingsPath = getSettingsPath();
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  log.info('Settings saved to', settingsPath);
}

function loadSettings(): Record<string, any> | null {
  try {
    const settingsPath = getSettingsPath();
    if (!fs.existsSync(settingsPath)) return null;
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Single-instance lock — prevent multiple app instances
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.warn('Another instance is already running — quitting.');
  app.quit();
}

app.on('second-instance', () => {
  const launcher = getLauncherWindow();
  if (launcher) {
    if (launcher.isMinimized()) launcher.restore();
    launcher.show();
    launcher.focus();
  }
});

// ---------------------------------------------------------------------------
// Wizard window
// ---------------------------------------------------------------------------
let wizardWindow: BrowserWindow | null = null;

function createWizardWindow(): BrowserWindow {
  wizardWindow = new BrowserWindow({
    width: 520,
    height: 620,
    center: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#09090f',
    show: false,
    title: 'GhostLink Setup',
    autoHideMenuBar: true,
    frame: false,

    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  wizardWindow.loadFile(path.join(__dirname, '..', 'renderer', 'wizard.html'));

  wizardWindow.once('ready-to-show', () => {
    wizardWindow?.show();
    if (!app.isPackaged) {
      wizardWindow?.webContents.openDevTools({ mode: 'detach' });
    }
    log.info('Wizard window ready');
  });

  wizardWindow.on('closed', () => {
    wizardWindow = null;
  });

  return wizardWindow;
}

// ---------------------------------------------------------------------------
// Chat window
// ---------------------------------------------------------------------------
let chatWindow: BrowserWindow | null = null;

function createChatWindow(port: number): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show();
    chatWindow.focus();
    return;
  }

  chatWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'GhostLink',
    backgroundColor: '#09090f',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  chatWindow.loadURL(`http://127.0.0.1:${port}`);

  chatWindow.once('ready-to-show', () => {
    chatWindow?.show();
    chatWindow?.focus();
    // Hide the launcher when chat opens
    const launcher = getLauncherWindow();
    if (launcher && !launcher.isDestroyed()) {
      launcher.hide();
    }
    // Also hide wizard if somehow still showing
    if (wizardWindow && !wizardWindow.isDestroyed()) {
      wizardWindow.hide();
    }
    log.info('Chat window opened on port', port);
  });

  chatWindow.on('closed', () => {
    chatWindow = null;
    // Show launcher when chat window closes
    const launcher = getLauncherWindow();
    if (launcher && !launcher.isDestroyed()) {
      launcher.show();
      launcher.focus();
    }
  });

  // If the server stops while chat is open, close chat and show launcher
  chatWindow.webContents.on('did-fail-load', () => {
    log.info('Chat window failed to load — server may have stopped');
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.close();
    }
  });
}

// ---------------------------------------------------------------------------
// Wizard IPC Handlers
// ---------------------------------------------------------------------------
function setupWizardIPC(): void {
  // ── Platform detection ────────────────────────────────────────────────
  ipcMain.handle('wizard:detect-platform', async () => {
    const platform = process.platform;
    let detectedPlatform = 'linux';
    let platformLabel = 'Linux';
    let wslAvailable = false;

    if (platform === 'win32') {
      detectedPlatform = 'windows';
      platformLabel = 'Windows (Native)';

      // Check if WSL is available
      try {
        execSync('wsl --status', { timeout: 5000, stdio: 'pipe' });
        wslAvailable = true;
        detectedPlatform = 'wsl';
        platformLabel = 'Windows (WSL)';
      } catch {
        wslAvailable = false;
      }
    } else if (platform === 'darwin') {
      detectedPlatform = 'macos';
      platformLabel = 'macOS';
    }

    return { platform: detectedPlatform, platformLabel, wslAvailable };
  });

  // ── Python detection ──────────────────────────────────────────────────
  ipcMain.handle('wizard:detect-python', async (_event, wizardPlatform?: string) => {
    let pythonPath = '';
    let version = '';
    let found = false;
    let depsInstalled = false;

    // Determine if we should use WSL: check wizard-provided platform,
    // or fall back to saved settings
    const settings = loadSettings();
    const useWsl = wizardPlatform === 'wsl' || settings?.platform === 'wsl';

    if (useWsl) {
      // Check python3 inside WSL
      const candidates = ['python3', 'python'];
      for (const cmd of candidates) {
        try {
          const { stdout: output } = await execAsync(`wsl bash -lc "${cmd} --version"`, {
            timeout: 10000,
            encoding: 'utf-8',
          });
          const match = String(output).trim().match(/Python\s+([\d.]+)/);
          if (match) {
            const ver = match[1];
            const parts = ver.split('.').map(Number);
            if (parts[0] >= 3 && parts[1] >= 10) {
              pythonPath = cmd;
              version = ver;
              found = true;
              break;
            }
          }
        } catch {
          // Not found, try next
        }
      }

      if (found && pythonPath) {
        // Check if fastapi is installed in WSL
        try {
          await execAsync(`wsl bash -lc "${pythonPath} -c 'import fastapi'"`, {
            timeout: 10000,
          });
          depsInstalled = true;
        } catch {
          depsInstalled = false;
        }
      }
    } else {
      // Native: try python3 first, then python
      const candidates = ['python3', 'python'];
      for (const cmd of candidates) {
        try {
          const { stdout: output } = await execAsync(`${cmd} --version`, {
            timeout: 10000,
            encoding: 'utf-8',
          });
          const match = String(output).trim().match(/Python\s+([\d.]+)/);
          if (match) {
            const ver = match[1];
            const parts = ver.split('.').map(Number);
            if (parts[0] >= 3 && parts[1] >= 10) {
              pythonPath = cmd;
              version = ver;
              found = true;
              break;
            }
          }
        } catch {
          // Not found, try next
        }
      }

      if (found && pythonPath) {
        try {
          await execAsync(`${pythonPath} -c "import fastapi"`, {
            timeout: 10000,
          });
          depsInstalled = true;
        } catch {
          depsInstalled = false;
        }
      }
    }

    return { found, pythonPath, version, depsInstalled };
  });

  // ── Install dependencies ──────────────────────────────────────────────
  ipcMain.handle('wizard:install-deps', async (_event, wizardPlatform?: string) => {
    try {
      const settings = loadSettings();
      const useWsl = wizardPlatform === 'wsl' || settings?.platform === 'wsl';

      // Find requirements.txt relative to the app
      const appDir = app.isPackaged
        ? path.join(process.resourcesPath, 'app')
        : path.join(__dirname, '..', '..');

      const reqPath = path.join(appDir, 'requirements.txt');

      if (!fs.existsSync(reqPath)) {
        // Also try backend/requirements.txt
        const backendReq = path.join(appDir, 'backend', 'requirements.txt');
        if (!fs.existsSync(backendReq)) {
          log.warn('requirements.txt not found at', reqPath, 'or', backendReq);
          return { success: false, error: 'requirements.txt not found' };
        }
        // Use the backend one
        if (useWsl) {
          const wslReqPath = winToWsl(backendReq);
          await execAsync(`wsl bash -lc "pip install -r '${wslReqPath}'"`, {
            timeout: 120000,
          });
        } else {
          await execAsync(`pip install -r "${backendReq}"`, {
            timeout: 120000,
          });
        }
        return { success: true };
      }

      if (useWsl) {
        const wslReqPath = winToWsl(reqPath);
        await execAsync(`wsl bash -lc "pip install -r '${wslReqPath}'"`, {
          timeout: 120000,
        });
      } else {
        await execAsync(`pip install -r "${reqPath}"`, {
          timeout: 120000,
        });
      }

      return { success: true };
    } catch (err: any) {
      log.error('wizard:install-deps failed:', err);
      return { success: false, error: err.message ?? String(err) };
    }
  });

  // ── Folder picker ─────────────────────────────────────────────────────
  ipcMain.handle('wizard:pick-folder', async () => {
    const win = wizardWindow;
    if (!win || win.isDestroyed()) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Default Workspace',
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      win.webContents.send('wizard:folder-picked', folderPath);
      return folderPath;
    }
    return null;
  });

  // ── Complete wizard ───────────────────────────────────────────────────
  ipcMain.handle('wizard:complete', async (_event, settings: Record<string, any>) => {
    log.info('Wizard complete — saving settings');

    // Ensure setupComplete is set with current app version
    settings.setupComplete = true;
    settings.appVersion = app.getVersion();

    // Save settings to ~/.ghostlink/settings.json
    saveSettings(settings);

    // Close wizard window — set transitioning flag so app doesn't quit
    isTransitioning = true;
    if (wizardWindow && !wizardWindow.isDestroyed()) {
      wizardWindow.destroy();
      wizardWindow = null;
    }

    // Now open the launcher
    const launcher = createLauncherWindow();
    isTransitioning = false;
    setupTray(launcher);
    setupUpdater(launcher);
    checkForUpdates().catch((err) => {
      log.warn('Initial update check failed:', err.message ?? err);
    });

    return { success: true };
  });
}

// ---------------------------------------------------------------------------
// IPC Handlers (launcher + app)
// ---------------------------------------------------------------------------
function setupIPC(): void {
  // ── Server lifecycle ──────────────────────────────────────────────────
  // Notify launcher when server process exits unexpectedly
  serverManager.onServerExit = () => {
    updateTrayMenu(false);
    const launcher = getLauncherWindow();
    if (launcher && !launcher.isDestroyed()) {
      launcher.webContents.send('server:stopped');
      launcher.show();
      launcher.focus();
    }
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.close();
      chatWindow = null;
    }
  };

  ipcMain.handle('server:start', async () => {
    try {
      const result = await serverManager.start();
      if (result.success) {
        const launcher = getLauncherWindow();
        if (launcher && !launcher.isDestroyed()) {
          launcher.webContents.send('server:started', result.port);
        }
        updateTrayMenu(true);
      }
      return result;
    } catch (err: any) {
      log.error('server:start failed:', err);
      return { success: false, error: err.message ?? String(err) };
    }
  });

  ipcMain.handle('server:stop', async () => {
    try {
      await serverManager.stop();
      updateTrayMenu(false);
      // Close chat window and show launcher
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.close();
        chatWindow = null;
      }
      const launcher = getLauncherWindow();
      if (launcher && !launcher.isDestroyed()) {
        launcher.webContents.send('server:stopped');
        launcher.show();
        launcher.focus();
      }
      return { success: true };
    } catch (err: any) {
      log.error('server:stop failed:', err);
      return { success: false, error: err.message ?? String(err) };
    }
  });

  ipcMain.handle('server:status', () => {
    return serverManager.getStatus();
  });

  // ── Auth ──────────────────────────────────────────────────────────────
  ipcMain.handle('auth:check', async () => {
    try {
      const statuses = await authManager.checkAll();
      return statuses;
    } catch (err: any) {
      log.error('auth:check failed:', err);
      return [];
    }
  });

  ipcMain.handle('auth:check-all', async () => {
    try {
      const statuses = await authManager.checkAll();
      // Also push the result to the renderer for event-based listeners
      const launcher = getLauncherWindow();
      if (launcher && !launcher.isDestroyed()) {
        launcher.webContents.send('auth:status', statuses);
      }
      return statuses;
    } catch (err: any) {
      log.error('auth:check-all failed:', err);
      return [];
    }
  });

  ipcMain.handle('auth:login', async (_event, provider: string) => {
    log.info('auth:login requested for provider:', provider);
    try {
      await authManager.login(provider);
      return { success: true };
    } catch (err: any) {
      log.error('auth:login failed:', err);
      return { success: false, error: err.message ?? String(err) };
    }
  });

  ipcMain.handle('auth:install', async (_event, provider: string) => {
    log.info('auth:install requested for provider:', provider);
    try {
      await authManager.install(provider);
      return { success: true };
    } catch (err: any) {
      log.error('auth:install failed:', err);
      return { success: false, error: err.message ?? String(err) };
    }
  });

  // ── Updates ───────────────────────────────────────────────────────────
  ipcMain.handle('update:check', async () => {
    try {
      await checkForUpdates();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message ?? String(err) };
    }
  });

  ipcMain.handle('update:install', () => {
    installUpdate();
  });

  ipcMain.handle('update:download', async () => {
    try {
      await downloadUpdate();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message ?? String(err) };
    }
  });

  // ── App-level ─────────────────────────────────────────────────────────
  ipcMain.handle('app:open-chat', () => {
    const status = serverManager.getStatus();
    if (!status.running) {
      log.warn('app:open-chat — server is not running');
      return { success: false, error: 'Server is not running' };
    }
    createChatWindow(status.port);
    return { success: true };
  });

  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:pick-folder', async () => {
    const launcher = getLauncherWindow();
    if (!launcher || launcher.isDestroyed()) return null;

    const result = await dialog.showOpenDialog(launcher, {
      properties: ['openDirectory'],
      title: 'Select Default Workspace',
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      launcher.webContents.send('app:folder-picked', folderPath);
      return folderPath;
    }
    return null;
  });

  ipcMain.handle('app:save-settings', (_event, settings: Record<string, any>) => {
    log.info('Settings saved:', settings);
    saveSettings(settings);
    return { success: true };
  });

  // ── Window controls (titlebar) ────────────────────────────────────────
  ipcMain.handle('window:minimize', () => {
    // Minimize whichever window is focused (wizard or launcher)
    const win = wizardWindow ?? getLauncherWindow();
    if (win && !win.isDestroyed()) {
      win.minimize();
    }
  });

  ipcMain.handle('window:close', () => {
    const win = wizardWindow ?? getLauncherWindow();
    if (win && !win.isDestroyed()) {
      win.close();
    }
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
let isQuitting = false;
let isTransitioning = false;

app.whenReady().then(async () => {
  log.info('Electron app ready');

  // Remove default menu bar (File, Edit, View, etc.)
  Menu.setApplicationMenu(null);

  // Wire up IPC (always needed — both wizard and launcher use shared channels)
  setupWizardIPC();
  setupIPC();

  // Check if first run
  if (settingsExist()) {
    log.info('Settings found — skipping wizard, launching normally');
    const launcher = createLauncherWindow();
    setupTray(launcher);
    setupUpdater(launcher);
    checkForUpdates().catch((err) => {
      log.warn('Initial update check failed:', err.message ?? err);
    });
  } else {
    log.info('No settings found — showing setup wizard');
    createWizardWindow();
  }
});

// Quit the app when all windows close — unless we're transitioning from wizard to launcher
app.on('window-all-closed', () => {
  if (!isTransitioning) {
    app.quit();
  }
});

// Graceful shutdown: stop the backend before quitting
app.on('before-quit', async (event) => {
  if (!isQuitting) {
    isQuitting = true;
    event.preventDefault();
    log.info('Shutting down — stopping backend server...');
    try {
      await serverManager.stop();
    } catch (err) {
      log.error('Error stopping server during quit:', err);
    }
    // Platform-specific cleanup
    if (process.platform === 'win32') {
      // WSL cleanup: kill tmux sessions and python, remove temp files
      // These commands use only hardcoded safe strings — no user input
      try {
        const { execFileSync: efs } = require('child_process');
        efs('wsl', ['bash', '-c', "tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^ghostlink-' | xargs -I{} tmux kill-session -t {} 2>/dev/null || true"], { stdio: 'ignore', timeout: 5000 });
      } catch { /* best-effort */ }
      try {
        const { execFileSync: efs } = require('child_process');
        efs('wsl', ['bash', '-c', 'rm -rf /tmp/ghostlink-backend /tmp/ghostlink-frontend'], { stdio: 'ignore', timeout: 5000 });
      } catch { /* best-effort */ }
    } else {
      // macOS / Linux: kill tmux sessions directly
      try {
        const { execFileSync: efs } = require('child_process');
        efs('bash', ['-c', "tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^ghostlink-' | xargs -I{} tmux kill-session -t {} 2>/dev/null || true"], { stdio: 'ignore', timeout: 5000 });
      } catch { /* tmux not installed or no sessions */ }
    }
    log.info('Cleanup complete — exiting');
    app.exit(0);
  }
});
