/**
 * Anthropic / Claude Code CLI authentication provider.
 *
 * Install: `npm install -g @anthropic-ai/claude-code`
 * Auth:    `claude auth login` (browser OAuth) or ANTHROPIC_API_KEY env var
 * Check:   `claude auth status` or check ~/.claude/ directory
 */

import type { AuthStatus } from './index';
import { WSL_EXE, execCmd, isWsl, isCommandNotFound, spawnInTerminal, hasClaudeCli, execAsync, terminalCommand, terminalShell } from './index';

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
      const envCheck = await execAsync(WSL_EXE, ['-e', 'bash', '-lc', 'test -n "$ANTHROPIC_API_KEY" && echo set'], {
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
    const output = await execCmd('claude', ['auth', 'status']);
    // Accept any non-empty output that doesn't explicitly say "not authenticated"
    if (output.length > 0 && !/not (logged in|authenticated|connected)/i.test(output)) {
      const userMatch = output.match(/(?:as|user|email|account|@)\s*(\S+)/i);
      return { ...base, authenticated: true, user: userMatch ? userMatch[1] : '(session)' };
    }
  } catch (err: any) {
    // If command ran but returned non-zero, check stderr for auth info
    const stderr = String(err?.stderr || '');
    const stdout = String(err?.stdout || '');
    const combined = stdout + stderr;
    if (combined.length > 0 && !/not (logged|authenticated|connected)/i.test(combined) && !isCommandNotFound(err)) {
      return { ...base, authenticated: true, user: '(session)' };
    }
  }

  // Credentials file exists — trust it as connected (CLI status check may have timed out)
  try {
    if (isWsl()) {
      const result = await execAsync(WSL_EXE, ['-e', 'bash', '-lc', 'test -f ~/.claude/.credentials.json && echo found'], {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5_000,
      });
      if (String(result).includes('found')) {
        return { ...base, authenticated: true, user: '(session)' };
      }
    } else {
      const { existsSync } = require('fs');
      const { join } = require('path');
      const { homedir } = require('os');
      if (existsSync(join(homedir(), '.claude', '.credentials.json'))) {
        return { ...base, authenticated: true, user: '(session)' };
      }
    }
  } catch {}

  return { ...base, error: 'Not connected' };
}

export async function loginAnthropic(): Promise<void> {
  spawnInTerminal(terminalCommand('claude', ['auth', 'login']));
}

export async function installAnthropic(): Promise<void> {
  spawnInTerminal(terminalShell(
    'npm install -g @anthropic-ai/claude-code && echo "Done! Now run: claude auth login"',
    'npm install -g @anthropic-ai/claude-code && echo Done! Now run: claude auth login'
  ));
}
