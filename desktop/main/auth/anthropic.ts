/**
 * Anthropic / Claude CLI authentication provider.
 *
 * Check  → `claude auth status`
 * Login  → `claude auth login` in a visible terminal
 */

import { execSync, spawn } from 'child_process';
import type { AuthStatus } from './index';

const PROVIDER = 'anthropic';
const NAME     = 'Claude';
const COLOR    = '#e8734a';
const COMMAND  = 'claude';
const ICON     = 'anthropic';

// ── Check ────────────────────────────────────────────────────────────────────

export async function checkAnthropic(): Promise<AuthStatus> {
  const base: AuthStatus = {
    provider: PROVIDER,
    name: NAME,
    authenticated: false,
    icon: ICON,
    color: COLOR,
    command: COMMAND,
  };

  try {
    const output = execSync('claude auth status', {
      encoding: 'utf-8',
      timeout: 10_000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Claude CLI prints "Logged in as <user>" on success
    const match = output.match(/Logged in as\s+(.+)/i);
    if (match) {
      return { ...base, authenticated: true, user: match[1].trim() };
    }

    // Exit code 0 but no recognizable line — treat as authenticated
    if (output.length > 0) {
      return { ...base, authenticated: true, user: output.split('\n')[0] };
    }

    return { ...base, error: 'Not logged in' };
  } catch (err: any) {
    // "command not found" or similar
    if (isCommandNotFound(err)) {
      return { ...base, error: 'CLI not installed' };
    }
    // Non-zero exit likely means not authenticated
    return { ...base, error: err.stderr?.toString().trim() || 'Not logged in' };
  }
}

// ── Login ────────────────────────────────────────────────────────────────────

export async function loginAnthropic(): Promise<void> {
  spawnInTerminal('claude auth login');
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
    // Open a visible cmd.exe window
    spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', cmd], {
      shell: true,
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else if (platform === 'darwin') {
    // macOS: open Terminal.app with the command
    spawn('osascript', [
      '-e', `tell application "Terminal" to do script "${cmd}"`,
      '-e', `tell application "Terminal" to activate`,
    ], { stdio: 'ignore' }).unref();
  } else {
    // Linux: try common terminal emulators
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
