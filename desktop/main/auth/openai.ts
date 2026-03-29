/**
 * OpenAI / Codex CLI authentication provider.
 *
 * Install: `npm install -g @openai/codex`
 * Auth:    `codex auth login` or OPENAI_API_KEY env var
 * Check:   Config dirs (~/.codex/ or ~/.config/codex/) or env var
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AuthStatus } from './index';
import { WSL_EXE, hasCommand, isWsl, spawnInTerminal, execAsync, terminalCommand, terminalShell } from './index';

const PROVIDER = 'openai';
const NAME     = 'Codex';
const COLOR    = '#10a37f';
const COMMAND  = 'codex';
const ICON     = 'openai';

export async function checkOpenAI(): Promise<AuthStatus> {
  const base: AuthStatus = {
    provider: PROVIDER, name: NAME, authenticated: false, installed: false,
    icon: ICON, color: COLOR, command: COMMAND,
    installCommand: 'npm install -g @openai/codex',
  };

  // Check if CLI installed
  if (!await hasCommand('codex')) {
    // Also check API key without CLI
    let hasApiKey = false;
    try {
      if (isWsl()) {
        const envCheck = await execAsync(WSL_EXE, ['bash', '-lc', 'test -n "$OPENAI_API_KEY" && echo set'], {
          encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'],
        });
        hasApiKey = String(envCheck).includes('set');
      } else {
        hasApiKey = !!process.env.OPENAI_API_KEY;
      }
    } catch {}
    if (hasApiKey) {
      return { ...base, installed: true, authenticated: true, user: 'API key' };
    }
    return { ...base, error: 'Not installed' };
  }
  base.installed = true;

  // Check auth — look for config dirs and API key
  try {
    if (isWsl()) {
      const checkDirs = await execAsync(WSL_EXE, ['bash', '-lc', '(test -d ~/.codex || test -d ~/.config/codex) && echo found'], {
        encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (String(checkDirs).includes('found')) {
        return { ...base, authenticated: true };
      }

      const envCheck = await execAsync(WSL_EXE, ['bash', '-lc', 'test -n "$OPENAI_API_KEY" && echo set'], {
        encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (String(envCheck).includes('set')) {
        return { ...base, authenticated: true, user: 'API key' };
      }
    } else {
      const home = os.homedir();
      const configDirs = [
        path.join(home, '.codex'),
        path.join(home, '.config', 'codex'),
      ];
      for (const dir of configDirs) {
        if (fs.existsSync(dir)) {
          try {
            const files = fs.readdirSync(dir);
            if (files.length > 0) return { ...base, authenticated: true };
          } catch {}
        }
      }
      if (process.env.OPENAI_API_KEY) {
        return { ...base, authenticated: true, user: 'API key' };
      }
    }
  } catch {}

  return { ...base, error: 'Not connected' };
}

export async function loginOpenAI(): Promise<void> {
  spawnInTerminal(terminalCommand('codex', ['auth', 'login']));
}

export async function installOpenAI(): Promise<void> {
  spawnInTerminal(terminalShell(
    'npm install -g @openai/codex && echo "Done! Now run: codex auth login"',
    'npm install -g @openai/codex && echo Done! Now run: codex auth login'
  ));
}
