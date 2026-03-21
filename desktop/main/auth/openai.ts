/**
 * OpenAI / Codex CLI authentication provider.
 *
 * Check  → `codex auth status`
 * Login  → `codex auth login` in a visible terminal
 */

import { execSync, spawn } from 'child_process';
import type { AuthStatus } from './index';

const PROVIDER = 'openai';
const NAME     = 'Codex';
const COLOR    = '#10a37f';
const COMMAND  = 'codex';
const ICON     = 'openai';

// ── Check ────────────────────────────────────────────────────────────────────

export async function checkOpenAI(): Promise<AuthStatus> {
  const base: AuthStatus = {
    provider: PROVIDER,
    name: NAME,
    authenticated: false,
    icon: ICON,
    color: COLOR,
    command: COMMAND,
  };

  try {
    const output = execSync('codex auth status', {
      encoding: 'utf-8',
      timeout: 10_000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Codex CLI prints authentication info on success
    const match = output.match(/Logged in|authenticated|active/i);
    if (match || output.length > 0) {
      // Try to extract a username or email
      const userMatch = output.match(/(?:as|user|email)\s+(\S+)/i);
      return {
        ...base,
        authenticated: true,
        user: userMatch ? userMatch[1] : undefined,
      };
    }

    return { ...base, error: 'Not logged in' };
  } catch (err: any) {
    if (isCommandNotFound(err)) {
      return { ...base, error: 'CLI not installed' };
    }
    return { ...base, error: err.stderr?.toString().trim() || 'Not logged in' };
  }
}

// ── Login ────────────────────────────────────────────────────────────────────

export async function loginOpenAI(): Promise<void> {
  spawnInTerminal('codex auth login');
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
