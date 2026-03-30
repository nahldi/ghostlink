/**
 * Launcher Window — The initial window shown when the app starts.
 *
 * Frameless, compact, dark-themed window that lets the user start the
 * backend server, check for updates, and open the chat.
 */

import { BrowserWindow } from 'electron';
import path from 'path';
import log from 'electron-log';

let launcherWindow: BrowserWindow | null = null;

/**
 * Create and show the launcher window.
 * Returns the BrowserWindow instance.
 */
export function createLauncherWindow(): BrowserWindow {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.show();
    launcherWindow.focus();
    return launcherWindow;
  }

  launcherWindow = new BrowserWindow({
    width: 580,
    height: 720,
    center: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#09090f',
    show: false,

    // Frameless: hidden title-bar on macOS, no frame on other platforms
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const }
      : { frame: false }),

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  launcherWindow.loadFile(path.join(__dirname, '..', 'renderer', 'launcher.html'));

  launcherWindow.once('ready-to-show', () => {
    launcherWindow?.show();
    log.info('Launcher window ready');
  });

  // Hide instead of close so the tray can re-show it
  launcherWindow.on('close', (event) => {
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      event.preventDefault();
      launcherWindow.hide();
    }
  });

  launcherWindow.on('closed', () => {
    launcherWindow = null;
  });

  return launcherWindow;
}

/**
 * Get the current launcher window instance (may be null).
 */
export function getLauncherWindow(): BrowserWindow | null {
  return launcherWindow;
}
