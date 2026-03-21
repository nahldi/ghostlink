/**
 * AI Chattr — Electron Main Process Entry Point
 *
 * Orchestrates the launcher window, backend server lifecycle,
 * system tray, auto-updater, and chat browser window.
 */

import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import log from 'electron-log';
import path from 'path';

import { serverManager } from './server';
import { createLauncherWindow, getLauncherWindow } from './launcher';
import { setupTray, updateTrayMenu } from './tray';
import { setupUpdater, checkForUpdates, downloadUpdate, installUpdate } from './updater';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info('AI Chattr starting — version', app.getVersion());

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
    title: 'AI Chattr',
    backgroundColor: '#09090f',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  chatWindow.loadURL(`http://127.0.0.1:${port}`);

  chatWindow.once('ready-to-show', () => {
    chatWindow?.show();
    chatWindow?.focus();
    log.info('Chat window opened on port', port);
  });

  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------
function setupIPC(): void {
  // Server lifecycle
  ipcMain.handle('server:start', async () => {
    try {
      const result = await serverManager.start();
      if (result.success) {
        const launcher = getLauncherWindow();
        if (launcher && !launcher.isDestroyed()) {
          launcher.webContents.send('server:started', { port: result.port });
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
      return { success: true };
    } catch (err: any) {
      log.error('server:stop failed:', err);
      return { success: false, error: err.message ?? String(err) };
    }
  });

  ipcMain.handle('server:status', () => {
    return serverManager.getStatus();
  });

  // Auth
  ipcMain.handle('auth:check', async () => {
    // Placeholder — auth module can be wired in later
    return { authenticated: false, providers: {} };
  });

  ipcMain.handle('auth:login', async (_event, provider: string) => {
    log.info('auth:login requested for provider:', provider);
    // Placeholder — delegate to authManager when implemented
    return { success: false, error: 'Auth not yet implemented' };
  });

  // Updates
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

  // App-level
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
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
let isQuitting = false;

app.whenReady().then(async () => {
  log.info('Electron app ready');

  // Create the launcher window
  const launcher = createLauncherWindow();

  // Wire up IPC
  setupIPC();

  // Setup system tray
  setupTray(launcher);

  // Setup auto-updater (sends events to the launcher)
  setupUpdater(launcher);

  // Check for updates in the background (non-blocking)
  checkForUpdates().catch((err) => {
    log.warn('Initial update check failed:', err.message ?? err);
  });
});

// Keep the app alive when all windows close (tray keeps running)
app.on('window-all-closed', () => {
  // Do nothing — tray keeps the app running
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
    app.quit();
  }
});
