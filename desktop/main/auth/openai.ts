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
import { hasCommand, isWsl, spawnInTerminal, execAsync } from './index';

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
        const envCheck = await execAsync('wsl bash -lc "test -n \\"$OPENAI_API_KEY\\" && echo set"', {
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
      const wslHome = await execAsync('wsl bash -c "echo $HOME"', {
        encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'],
      });

      const checkDirs = await execAsync(
        `wsl bash -c "(test -d '${wslHome}/.codex' || test -d '${wslHome}/.config/codex') && echo found"`,
        { encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      if (String(checkDirs).includes('found')) {
        return { ...base, authenticated: true };
      }

      const envCheck = await execAsync('wsl bash -lc "test -n \\"$OPENAI_API_KEY\\" && echo set"', {
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
  spawnInTerminal('codex auth login');
}

export async function installOpenAI(): Promise<void> {
  spawnInTerminal('npm install -g @openai/codex && echo "Done! Now run: codex auth login"');
}
