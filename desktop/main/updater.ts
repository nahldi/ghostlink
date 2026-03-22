/**
 * Auto-Updater — Handles checking, downloading, and installing updates
 * via electron-updater (GitHub Releases).
 *
 * All update lifecycle events are forwarded to the launcher renderer
 * so the UI can display progress and prompt the user.
 */

import { app, BrowserWindow } from 'electron';
import { autoUpdater, UpdateInfo } from 'electron-updater';
import log from 'electron-log';

let launcherRef: BrowserWindow | null = null;

/**
 * Wire up electron-updater event listeners and point them at the
 * launcher window so the renderer can react to update states.
 */
export function setupUpdater(launcherWindow: BrowserWindow): void {
  launcherRef = launcherWindow;

  // Route updater logs through electron-log
  autoUpdater.logger = log;

  // Don't auto-download — let the user decide
  autoUpdater.autoDownload = false;

  // Install silently when the user quits
  autoUpdater.autoInstallOnAppQuit = true;

  // ---- Event handlers ----

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log.info('Update available:', info.version);
    sendToLauncher('update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseName: info.releaseName,
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    log.info('No update available — current version is up to date.');
    sendToLauncher('update:not-available', {
      version: info.version,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    log.info('Download progress: %d%%', Math.round(progress.percent));
    sendToLauncher('update:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log.info('Update downloaded:', info.version);
    sendToLauncher('update:downloaded', {
      version: info.version,
    });
  });

  autoUpdater.on('error', (err: Error) => {
    log.error('Auto-updater error:', err.message);

    // When there are no GitHub releases yet, treat it as "up to date"
    // rather than showing a scary error to the user.
    const msg = err.message ?? '';
    if (
      msg.includes('no published releases') ||
      msg.includes('HttpError: 404') ||
      msg.includes('Cannot find latest.yml') ||
      msg.includes('net::ERR_') ||
      msg.includes('ENOTFOUND')
    ) {
      log.info('No releases found — treating as up to date');
      sendToLauncher('update:not-available', {
        version: app.getVersion(),
      });
      return;
    }

    sendToLauncher('update:error', {
      message: err.message,
    });
  });

  log.info('Auto-updater initialized');
}

/**
 * Check for available updates on GitHub Releases.
 */
export async function checkForUpdates(): Promise<void> {
  log.info('Checking for updates...');
  await autoUpdater.checkForUpdates();
}

/**
 * Begin downloading the available update.
 */
export async function downloadUpdate(): Promise<void> {
  log.info('Downloading update...');
  await autoUpdater.downloadUpdate();
}

/**
 * Quit the app and install the downloaded update.
 */
export function installUpdate(): void {
  log.info('Installing update — quitting and restarting...');
  autoUpdater.quitAndInstall();
}

// ---------- helpers ----------

/**
 * Safely send an event to the launcher renderer.
 */
function sendToLauncher(channel: string, data: Record<string, any>): void {
  if (launcherRef && !launcherRef.isDestroyed()) {
    launcherRef.webContents.send(channel, data);
  }
}
