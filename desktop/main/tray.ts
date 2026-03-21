/**
 * System Tray — Keeps the app alive in the background and provides
 * quick access to common actions (open chat, start/stop server, etc.).
 */

import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import path from 'path';
import log from 'electron-log';

import { serverManager } from './server';
import { getLauncherWindow } from './launcher';

let tray: Tray | null = null;
let cachedLauncher: BrowserWindow | null = null;

/**
 * Resolve the tray icon path.
 * Uses a 16x16 or 32x32 PNG from the assets directory.
 */
function getTrayIconPath(): string {
  const assetsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '..', 'assets');

  // Prefer a dedicated tray icon; fall back to the main icon
  const candidates = ['tray-icon.png', 'icon.png'];
  for (const name of candidates) {
    const full = path.join(assetsDir, name);
    try {
      require('fs').accessSync(full);
      return full;
    } catch { /* try next */ }
  }

  // Absolute fallback: create an empty 16x16 image
  return '';
}

/**
 * Build the context menu, adjusting labels based on server state.
 */
function buildMenu(serverRunning: boolean): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Open AI Chattr',
      click: () => {
        const status = serverManager.getStatus();
        if (status.running) {
          // Open the chat window via IPC-like direct call
          const { BrowserWindow: BW } = require('electron');
          // Find existing chat window or show launcher
          const allWindows = BW.getAllWindows();
          const chat = allWindows.find((w: BrowserWindow) =>
            w.getTitle() === 'AI Chattr' && w !== getLauncherWindow()
          );
          if (chat) {
            chat.show();
            chat.focus();
          } else {
            // Trigger opening via the launcher
            const launcher = getLauncherWindow();
            if (launcher && !launcher.isDestroyed()) {
              launcher.webContents.send('action:open-chat');
              launcher.show();
            }
          }
        } else {
          const launcher = getLauncherWindow();
          if (launcher && !launcher.isDestroyed()) {
            launcher.show();
            launcher.focus();
          }
        }
      },
    },
    { type: 'separator' },
    {
      label: serverRunning ? 'Stop Server' : 'Start Server',
      click: async () => {
        if (serverRunning) {
          await serverManager.stop();
          updateTrayMenu(false);
          const launcher = getLauncherWindow();
          if (launcher && !launcher.isDestroyed()) {
            launcher.webContents.send('server:stopped');
          }
        } else {
          const result = await serverManager.start();
          if (result.success) {
            updateTrayMenu(true);
            const launcher = getLauncherWindow();
            if (launcher && !launcher.isDestroyed()) {
              launcher.webContents.send('server:started', result.port);
            }
          }
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => {
        const launcher = getLauncherWindow();
        if (launcher && !launcher.isDestroyed()) {
          launcher.webContents.send('action:check-updates');
          launcher.show();
        }
      },
    },
    {
      label: 'Show Launcher',
      click: () => {
        const launcher = getLauncherWindow();
        if (launcher && !launcher.isDestroyed()) {
          launcher.show();
          launcher.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);
}

/**
 * Create the system tray and attach the context menu.
 */
export function setupTray(launcherWindow: BrowserWindow): void {
  cachedLauncher = launcherWindow;

  const iconPath = getTrayIconPath();
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('AI Chattr');

  // Set initial menu (server not running)
  tray.setContextMenu(buildMenu(false));

  // On Windows/Linux: left-click toggles the launcher window
  if (process.platform !== 'darwin') {
    tray.on('click', () => {
      const launcher = getLauncherWindow();
      if (launcher && !launcher.isDestroyed()) {
        if (launcher.isVisible()) {
          launcher.hide();
        } else {
          launcher.show();
          launcher.focus();
        }
      }
    });
  }

  log.info('System tray created');
}

/**
 * Rebuild the tray context menu to reflect the current server state.
 */
export function updateTrayMenu(serverRunning: boolean): void {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildMenu(serverRunning));
}
