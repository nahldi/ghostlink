/**
 * Google / Gemini CLI authentication provider.
 *
 * Check  → `gemini auth status`, fallback to token file detection
 * Login  → `gemini auth login`, fallback to `gcloud auth login`
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AuthStatus } from './index';

const PROVIDER = 'google';
const NAME     = 'Gemini';
const COLOR    = '#4285f4';
const COMMAND  = 'gemini';
const ICON     = 'google';

// Possible token file locations
const TOKEN_PATHS = [
  join(homedir(), '.config', 'gemini'),
  join(homedir(), '.gemini'),
];

// ── Check ────────────────────────────────────────────────────────────────────

export async function checkGoogle(): Promise<AuthStatus> {
  const base: AuthStatus = {
    provider: PROVIDER,
    name: NAME,
    authenticated: false,
    icon: ICON,
    color: COLOR,
    command: COMMAND,
  };

  // Strategy 1: Try the Gemini CLI directly
  try {
    const output = execSync('gemini auth status', {
      encoding: 'utf-8',
      timeout: 10_000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const match = output.match(/Logged in|authenticated|active/i);
    if (match || output.length > 0) {
      const userMatch = output.match(/(?:as|user|email|account)\s+(\S+)/i);
      return {
        ...base,
        authenticated: true,
        user: userMatch ? userMatch[1] : undefined,
      };
    }
  } catch (err: any) {
    // If CLI not found, fall through to token file check
    if (!isCommandNotFound(err)) {
      // CLI exists but returned an error → not authenticated
      return { ...base, error: err.stderr?.toString().trim() || 'Not logged in' };
    }
  }

  // Strategy 2: Check for token files on disk
  for (const dir of TOKEN_PATHS) {
    if (existsSync(dir)) {
      return { ...base, authenticated: true, user: 'token-file' };
    }
  }

  // Strategy 3: Check gcloud as last resort
  try {
    const output = execSync('gcloud auth list --filter=status:ACTIVE --format=value(account)', {
      encoding: 'utf-8',
      timeout: 10_000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (output.length > 0) {
      return { ...base, authenticated: true, user: output.split('\n')[0] };
    }
  } catch {
    // gcloud not installed or failed — that's fine
  }

  return { ...base, error: 'CLI not installed' };
}

// ── Login ────────────────────────────────────────────────────────────────────

export async function loginGoogle(): Promise<void> {
  // Prefer gemini CLI, fall back to gcloud
  const cmd = hasCommand('gemini') ? 'gemini auth login' : 'gcloud auth login';
  spawnInTerminal(cmd);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hasCommand(name: string): boolean {
  try {
    const check = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
    execSync(check, { stdio: 'pipe', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function isCommandNotFound(err: any): boolean {
  const msg = (err.message ?? '') + (err.stderr?.toString() ?? '');
  return (
    msg.includes('not found') ||
    msg.includes('not recognized') ||
    msg.includes('ENOENT') ||
    err.code === 'ENOENT'
  );
}

function spawnInTerminal(cmd: string): void {
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', cmd], {
      shell: true,
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else if (platform === 'darwin') {
    spawn('osascript', [
      '-e', `tell application "Terminal" to do script "${cmd}"`,
      '-e', `tell application "Terminal" to activate`,
    ], { stdio: 'ignore' }).unref();
  } else {
    const terminals = ['x-terminal-emulator', 'gnome-terminal', 'xterm'];
    for (const term of terminals) {
      try {
        spawn(term, ['-e', cmd], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        return;
      } catch { /* try next */ }
    }
  }
}
