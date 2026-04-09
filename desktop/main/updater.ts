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
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { WSL_EXE } from './auth/index';

let launcherRef: BrowserWindow | null = null;
type LauncherPayload = Record<string, unknown>;

function isGitHubToken(value: string): boolean {
  return value.startsWith('ghp_') || value.startsWith('github_pat_') || value.startsWith('gho_');
}

function tryReadWslOutput(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(WSL_EXE, ['-e', ...args], {
      encoding: 'utf-8',
      timeout: 3000,
    }, (err, stdout) => {
      if (err) { resolve(''); return; }
      resolve((stdout || '').trim().replace(/\r/g, ''));
    });
  });
}

/**
 * Read a GitHub token for private repo update checks.
 * Checks: GH_TOKEN env, GITHUB_TOKEN env, gh CLI config file, WSL gh CLI.
 * Runs asynchronously to avoid blocking the main process event loop.
 */
async function getGitHubToken(): Promise<string> {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  // Try gh CLI config files (Windows-side)
  const ghPaths = [
    path.join(os.homedir(), '.config', 'gh', 'hosts.yml'),
    path.join(process.env.APPDATA || '', 'GitHub CLI', 'hosts.yml'),
  ];
  for (const p of ghPaths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        const match = content.match(/oauth_token:\s*(.+)/);
        if (match && match[1].trim()) {
          log.info('Found GitHub token from gh CLI config');
          return match[1].trim();
        }
      }
    } catch {}
  }

  // Try reading from WSL (async — does not block the event loop).
  const wslCommands: Array<{ label: string; args: string[] }> = [
    { label: 'gh', args: ['gh', 'auth', 'token'] },
    { label: 'printenv GITHUB_TOKEN', args: ['printenv', 'GITHUB_TOKEN'] },
    { label: 'printenv GH_TOKEN', args: ['printenv', 'GH_TOKEN'] },
  ];
  for (const command of wslCommands) {
    const result = await tryReadWslOutput(command.args);
    if (result && isGitHubToken(result)) {
      log.info('Found GitHub token from WSL (%s)', command.label);
      return result;
    }
  }

  return '';
}

/**
 * Wire up electron-updater event listeners and point them at the
 * launcher window so the renderer can react to update states.
 */
export function setupUpdater(launcherWindow: BrowserWindow): void {
  launcherRef = launcherWindow;

  // Look up GitHub token asynchronously so WSL calls don't block the event loop.
  // The token is only needed for private repo update checks — the updater
  // event handlers work fine without it.
  getGitHubToken().then((ghToken) => {
    if (ghToken) {
      process.env.GH_TOKEN = ghToken;
      log.info('GitHub token configured for auto-updater');
    } else {
      log.warn('No GitHub token found — auto-update may not work for private repos');
    }
  }).catch((err) => {
    log.warn('GitHub token lookup failed:', err.message ?? err);
  });

  // Route updater logs through electron-log
  autoUpdater.logger = log;

  // Don't auto-download — show the user the update UI so they control it
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
    // Notify the backend so the chat UI can show an update banner
    try {
      const http = require('http');
      const data = JSON.stringify({ version: info.version, release_notes: info.releaseName || '' });
      const req = http.request({ hostname: '127.0.0.1', port: 8300, path: '/api/update-status', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } });
      req.on('error', () => {});
      req.write(data);
      req.end();
    } catch { /* best effort */ }
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
  // isSilent=true: run installer without UI
  // isForceRunAfter=true: relaunch app after install
  autoUpdater.quitAndInstall(true, true);
}

// ---------- helpers ----------

/**
 * Safely send an event to the launcher renderer.
 */
function sendToLauncher(channel: string, data: LauncherPayload): void {
  if (launcherRef && !launcherRef.isDestroyed()) {
    launcherRef.webContents.send(channel, data);
  }
}
