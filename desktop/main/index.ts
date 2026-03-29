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
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

import { serverManager } from './server';
import { createLauncherWindow, getLauncherWindow } from './launcher';
import { getSettingsPath, loadSettingsFile, saveSettingsFile, sanitizeSettings } from './settings';
import { setupTray, updateTrayMenu } from './tray';
import { setupUpdater, checkForUpdates, downloadUpdate, installUpdate } from './updater';
import { authManager, winToWsl, WSL_EXE } from './auth/index';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info('GhostLink starting — version', app.getVersion());

async function runCommand(command: string, args: string[], timeout = 10_000): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(command, args, {
    timeout,
    encoding: 'utf-8',
    windowsHide: true,
  });
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

function getCommandOutput(result: { stdout: string; stderr: string }): string {
  return (result.stdout || result.stderr).trim();
}

async function findPythonVersion(command: string, useWsl: boolean): Promise<string | null> {
  try {
    const result = useWsl
      ? await runCommand(WSL_EXE, [command, '--version'])
      : await runCommand(command, ['--version']);
    const match = getCommandOutput(result).match(/Python\s+([\d.]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function findSupportedPython(useWsl: boolean): Promise<{ command: string; version: string } | null> {
  for (const candidate of ['python3', 'python']) {
    const version = await findPythonVersion(candidate, useWsl);
    if (!version) continue;

    const parts = version.split('.').map(Number);
    if (parts[0] >= 3 && parts[1] >= 10) {
      return { command: candidate, version };
    }
  }

  return null;
}

async function isPythonModuleAvailable(command: string, moduleName: string, useWsl: boolean): Promise<boolean> {
  const probeArgs = [
    '-c',
    'import importlib.util, sys; sys.exit(0 if importlib.util.find_spec(sys.argv[1]) else 1)',
    moduleName,
  ];
  try {
    if (useWsl) {
      await runCommand(WSL_EXE, [command, ...probeArgs]);
    } else {
      await runCommand(command, probeArgs);
    }
    return true;
  } catch {
    return false;
  }
}

async function findExecutable(command: string, useWsl: boolean): Promise<boolean> {
  try {
    if (useWsl) {
      await runCommand(WSL_EXE, ['which', command], 5_000);
    } else if (process.platform === 'win32') {
      await runCommand('where', [command], 5_000);
    } else {
      await runCommand('which', [command], 5_000);
    }
    return true;
  } catch {
    return false;
  }
}

type WizardPlatform = 'windows' | 'wsl' | 'macos' | 'linux';

function detectHostPlatform(): { platform: WizardPlatform; platformLabel: string; wslAvailable: boolean } {
  switch (process.platform) {
    case 'win32':
      try {
        execFileSync(WSL_EXE, ['--status'], { timeout: 5000, stdio: 'pipe', windowsHide: true });
        return { platform: 'wsl', platformLabel: 'Windows (WSL)', wslAvailable: true };
      } catch {
        return { platform: 'windows', platformLabel: 'Windows (Native)', wslAvailable: false };
      }
    case 'darwin':
      return { platform: 'macos', platformLabel: 'macOS', wslAvailable: false };
    case 'linux':
      return { platform: 'linux', platformLabel: 'Linux', wslAvailable: false };
    default:
      log.warn('Unknown process.platform value: %s; falling back to Linux defaults', process.platform);
      return { platform: 'linux', platformLabel: 'Linux', wslAvailable: false };
  }
}

function parseWizardPlatform(raw: unknown): WizardPlatform | null {
  return raw === 'windows' || raw === 'wsl' || raw === 'macos' || raw === 'linux'
    ? raw
    : null;
}

function getResourceRootCandidates(): string[] {
  if (!app.isPackaged) {
    return [path.join(__dirname, '..', '..')];
  }

  return [
    process.resourcesPath,
    path.join(process.resourcesPath, 'app.asar.unpacked'),
    path.join(process.resourcesPath, 'app'),
  ];
}

function resolveRequirementsPath(): string | null {
  const candidates: string[] = [];

  for (const root of getResourceRootCandidates()) {
    candidates.push(path.join(root, 'requirements.txt'));
    candidates.push(path.join(root, 'backend', 'requirements.txt'));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function settingsExist(): boolean {
  const settingsPath = getSettingsPath();
  const data = loadSettingsFile(settingsPath);
  if (!data || data.setupComplete !== true) return false;

  if (data.appVersion !== app.getVersion()) {
    saveSettings({ ...data, appVersion: app.getVersion() });
  }

  return true;
}

function saveSettings(settings: Record<string, any>): void {
  const settingsPath = getSettingsPath();
  saveSettingsFile(settings, settingsPath);
  log.info('Settings saved to', settingsPath);
}

function loadSettings(): Record<string, any> | null {
  return loadSettingsFile(getSettingsPath()) as Record<string, any> | null;
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
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
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
    return detectHostPlatform();
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
    const requestedPlatform = parseWizardPlatform(wizardPlatform);
    const useWsl = requestedPlatform === 'wsl' || settings?.platform === 'wsl';

    if (useWsl) {
      const supportedPython = await findSupportedPython(true);
      if (supportedPython) {
        pythonPath = supportedPython.command;
        version = supportedPython.version;
        found = true;
      }

      if (found && pythonPath) {
        depsInstalled = await isPythonModuleAvailable(pythonPath, 'fastapi', true);
      }
    } else {
      const supportedPython = await findSupportedPython(false);
      if (supportedPython) {
        pythonPath = supportedPython.command;
        version = supportedPython.version;
        found = true;
      }

      if (found && pythonPath) {
        depsInstalled = await isPythonModuleAvailable(pythonPath, 'fastapi', false);
      }
    }

    return { found, pythonPath, version, depsInstalled };
  });

  // ── Install dependencies ──────────────────────────────────────────────
  ipcMain.handle('wizard:install-deps', async (_event, wizardPlatform?: string) => {
    try {
      const settings = loadSettings();
      const requestedPlatform = parseWizardPlatform(wizardPlatform);
      const useWsl = requestedPlatform === 'wsl' || settings?.platform === 'wsl';
      const supportedPython = await findSupportedPython(useWsl);
      if (!supportedPython) {
        return { success: false, error: 'Python 3.10+ not found' };
      }

      const reqPath = resolveRequirementsPath();
      if (!reqPath) {
        log.warn('requirements.txt not found in known resource locations');
        return { success: false, error: 'requirements.txt not found' };
      }

      if (useWsl) {
        const wslReqPath = winToWsl(reqPath);
        await runCommand(WSL_EXE, [supportedPython.command, '-m', 'pip', 'install', '-r', wslReqPath], 120_000);
      } else {
        await runCommand(supportedPython.command, ['-m', 'pip', 'install', '-r', reqPath], 120_000);
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
    try {
      const sanitizedSettings = sanitizeSettings(settings) as Record<string, any>;

      // Ensure setupComplete is set with current app version
      sanitizedSettings.setupComplete = true;
      sanitizedSettings.appVersion = app.getVersion();

      // Pre-populate default persistent agents so the agent bar isn't empty
      if (!sanitizedSettings.persistentAgents || sanitizedSettings.persistentAgents.length === 0) {
        const defaultAgents = [];
        const workspace = sanitizedSettings.workspace || '.';

        // Check which CLIs are available and add them as defaults
        const agentDefs = [
          { base: 'claude', label: 'Claude', command: 'claude', color: '#e8734a', args: ['--dangerously-skip-permissions'] },
          { base: 'codex', label: 'Codex', command: 'codex', color: '#10a37f', args: ['--sandbox', 'danger-full-access', '-a', 'never'] },
          { base: 'gemini', label: 'Gemini', command: 'gemini', color: '#4285f4', args: ['-y'] },
        ];

        const useWsl = sanitizedSettings.platform === 'wsl';
        for (const def of agentDefs) {
          if (await findExecutable(def.command, useWsl)) {
            defaultAgents.push({
              base: def.base,
              label: def.label,
              command: def.command,
              args: def.args,
              cwd: workspace,
              color: def.color,
            });
          }
        }

        if (defaultAgents.length > 0) {
          sanitizedSettings.persistentAgents = defaultAgents;
          log.info(`Pre-populated ${defaultAgents.length} default agent(s):`, defaultAgents.map(a => a.base).join(', '));
        }
      }

      // Save settings to ~/.ghostlink/settings.json
      saveSettings(sanitizedSettings);

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
    } catch (err: any) {
      isTransitioning = false;
      const detail = err?.message ?? String(err);
      log.error('wizard:complete failed:', err);
      const dialogOptions = {
        type: 'error',
        title: 'Setup Failed',
        message: 'GhostLink could not finish setup.',
        detail,
      } as const;
      if (wizardWindow && !wizardWindow.isDestroyed()) {
        await dialog.showMessageBox(wizardWindow, dialogOptions);
      } else {
        await dialog.showMessageBox(dialogOptions);
      }
      return { success: false, error: detail };
    }
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

  ipcMain.handle('app:get-settings', () => {
    return loadSettings() ?? {};
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
    const sanitizedSettings = sanitizeSettings(settings) as Record<string, any>;
    log.info('Settings saved:', sanitizedSettings);
    saveSettings(sanitizedSettings);
    return { success: true, settings: sanitizedSettings };
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
        efs(WSL_EXE, ['-e', 'bash', '-c', "tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^ghostlink-' | xargs -I{} tmux kill-session -t {} 2>/dev/null || true"], { stdio: 'ignore', timeout: 5000 });
      } catch { /* best-effort */ }
      try {
        const { execFileSync: efs } = require('child_process');
        efs(WSL_EXE, ['-e', 'bash', '-c', 'rm -rf /tmp/ghostlink-backend /tmp/ghostlink-frontend'], { stdio: 'ignore', timeout: 5000 });
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
