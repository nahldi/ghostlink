/**
 * GitHub CLI / Copilot authentication provider.
 *
 * Install: Platform-specific (brew, winget, apt, etc.)
 * Auth:    `gh auth login --web` (browser OAuth)
 * Check:   `gh auth status`
 */

import type { AuthStatus } from './index';
import { execCmd, execAsync, hasCommand, isCommandNotFound, spawnInTerminal, isWsl } from './index';

const PROVIDER = 'github';
const NAME     = 'GitHub Copilot';
const COLOR    = '#6cc644';
const COMMAND  = 'gh';
const ICON     = 'github';

export async function checkGitHub(): Promise<AuthStatus> {
  const base: AuthStatus = {
    provider: PROVIDER, name: NAME, authenticated: false, installed: false,
    icon: ICON, color: COLOR, command: COMMAND,
    installCommand: isWsl() ? 'sudo apt install gh' : 'winget install GitHub.cli',
  };

  if (!await hasCommand('gh')) {
    return { ...base, error: 'Not installed' };
  }
  base.installed = true;

  try {
    const output = await execCmd('gh auth status');

    const match = output.match(/Logged in to github\.com\s+(?:as\s+)?(\S+)/i);
    if (match) return { ...base, authenticated: true, user: match[1] };

    const altMatch = output.match(/account\s+(\S+)/i);
    if (altMatch) return { ...base, authenticated: true, user: altMatch[1] };

    if (output.includes('github.com')) return { ...base, authenticated: true };

    return { ...base, error: 'Not connected' };
  } catch (err: any) {
    if (isCommandNotFound(err)) {
      return { ...base, installed: false, error: 'Not installed' };
    }
    const stderr = err.stderr?.toString() ?? '';
    if (stderr.includes('not logged') || stderr.includes('no active')) {
      return { ...base, error: 'Not connected' };
    }
    return { ...base, error: 'Not connected' };
  }
}

export async function loginGitHub(): Promise<void> {
  spawnInTerminal('gh auth login --web');
}

export async function installGitHub(): Promise<void> {
  const cmd = isWsl()
    ? 'sudo apt install gh -y && echo "Done! Now run: gh auth login --web"'
    : 'winget install GitHub.cli';
  spawnInTerminal(cmd);
}
