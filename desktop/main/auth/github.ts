/**
 * GitHub / Copilot CLI authentication provider.
 *
 * Check  → `gh auth status`
 * Login  → `gh auth login --web` in a visible terminal
 */

import { execSync, spawn } from 'child_process';
import type { AuthStatus } from './index';

const PROVIDER = 'github';
const NAME     = 'GitHub Copilot';
const COLOR    = '#6cc644';
const COMMAND  = 'gh';
const ICON     = 'github';

// ── Check ────────────────────────────────────────────────────────────────────

export async function checkGitHub(): Promise<AuthStatus> {
  const base: AuthStatus = {
    provider: PROVIDER,
    name: NAME,
    authenticated: false,
    icon: ICON,
    color: COLOR,
    command: COMMAND,
  };

  try {
    const output = execSync('gh auth status', {
      encoding: 'utf-8',
      timeout: 10_000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // gh auth status prints "Logged in to github.com as <user>"
    const match = output.match(/Logged in to github\.com\s+(?:as\s+)?(\S+)/i);
    if (match) {
      return { ...base, authenticated: true, user: match[1] };
    }

    // Alternative format: "account <user>"
    const altMatch = output.match(/account\s+(\S+)/i);
    if (altMatch) {
      return { ...base, authenticated: true, user: altMatch[1] };
    }

    // If the command succeeded (exit 0) it probably means logged in
    if (output.includes('github.com')) {
      return { ...base, authenticated: true };
    }

    return { ...base, error: 'Not logged in' };
  } catch (err: any) {
    if (isCommandNotFound(err)) {
      return { ...base, error: 'CLI not installed' };
    }

    // gh auth status returns exit 1 when not authenticated but still
    // writes useful info to stderr
    const stderr = err.stderr?.toString().trim() ?? '';
    if (stderr.includes('not logged') || stderr.includes('no active')) {
      return { ...base, error: 'Not logged in' };
    }

    return { ...base, error: stderr || 'Not logged in' };
  }
}

// ── Login ────────────────────────────────────────────────────────────────────

export async function loginGitHub(): Promise<void> {
  spawnInTerminal('gh auth login --web');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
