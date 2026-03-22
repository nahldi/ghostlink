/**
 * Anthropic / Claude Code CLI authentication provider.
 *
 * Install: `npm install -g @anthropic-ai/claude-code`
 * Auth:    `claude auth login` (browser OAuth) or ANTHROPIC_API_KEY env var
 * Check:   `claude auth status` or check ~/.claude/ directory
 */

import { exec } from 'child_process';


import type { AuthStatus } from './index';
import { execCmd, isWsl, isCommandNotFound, spawnInTerminal, hasClaudeCli, execAsync } from './index';

const PROVIDER = 'anthropic';
const NAME     = 'Claude';
const COLOR    = '#e8734a';
const COMMAND  = 'claude';
const ICON     = 'anthropic';

export async function checkAnthropic(): Promise<AuthStatus> {
  const base: AuthStatus = {
    provider: PROVIDER, name: NAME, authenticated: false, installed: false,
    icon: ICON, color: COLOR, command: COMMAND,
    installCommand: 'npm install -g @anthropic-ai/claude-code',
  };

  // Check installed — claude binary or via npx
  const installed = await hasClaudeCli();

  // Also check API key as alternative
  let hasApiKey = false;
  try {
    if (isWsl()) {
      const envCheck = await execAsync('wsl bash -lc "test -n \\"$ANTHROPIC_API_KEY\\" && echo set"', {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5_000,
      });
      hasApiKey = String(envCheck).includes('set');
    } else {
      hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    }
  } catch {}

  if (!installed && !hasApiKey) {
    return { ...base, error: 'Not installed' };
  }
  base.installed = true;

  if (hasApiKey) {
    return { ...base, authenticated: true, user: 'API key' };
  }

  // Check auth status via CLI
  try {
    const output = await execCmd('claude auth status');
    if (/logged in|authenticated|active/i.test(output)) {
      const userMatch = output.match(/(?:as|user|email|account)\s+(\S+)/i);
      return { ...base, authenticated: true, user: userMatch ? userMatch[1] : '(session)' };
    }
  } catch (err: any) {
    if (isCommandNotFound(err)) {
      // Shouldn't happen if hasClaudeCli passed, but handle gracefully
    }
  }

  // Check ~/.claude/ directory (indicates prior auth session)
  try {
    if (isWsl()) {
      const result = await execAsync('wsl bash -lc "test -d ~/.claude && ls ~/.claude/ 2>/dev/null | head -1"', {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5_000,
      });
      if (String(result).length > 0) {
        return { ...base, authenticated: true, user: '(session)' };
      }
    }
  } catch {}

  return { ...base, error: 'Not connected' };
}

export async function loginAnthropic(): Promise<void> {
  spawnInTerminal('claude auth login');
}

export async function installAnthropic(): Promise<void> {
  spawnInTerminal('npm install -g @anthropic-ai/claude-code && echo "Done! Now run: claude auth login"');
}
