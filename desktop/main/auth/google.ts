/**
 * Google / Gemini CLI authentication provider.
 *
 * Install: `npm install -g @anthropic-ai/claude-code` style install
 *          Gemini CLI: `npm install -g @anthropic-ai/claude-code` (placeholder)
 *          Or use Google AI Studio API key: GOOGLE_API_KEY / GEMINI_API_KEY
 * Auth:    `gemini auth login` or API key env var
 */

import { exec } from 'child_process';


import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AuthStatus } from './index';
import { cmd, execCmd, hasCommand, isCommandNotFound, isWsl, spawnInTerminal, execAsync } from './index';

const PROVIDER = 'google';
const NAME     = 'Gemini';
const COLOR    = '#4285f4';
const COMMAND  = 'gemini';
const ICON     = 'google';

export async function checkGoogle(): Promise<AuthStatus> {
  const base: AuthStatus = {
    provider: PROVIDER, name: NAME, authenticated: false, installed: false,
    icon: ICON, color: COLOR, command: COMMAND,
    installCommand: 'pip install google-genai',
  };

  // Check if CLI is installed
  const geminiInstalled = await hasCommand('gemini');
  const gcloudInstalled = await hasCommand('gcloud');

  // Check API keys (doesn't need CLI installed)
  let hasApiKey = false;
  try {
    if (isWsl()) {
      const envCheck = await execAsync(
        'wsl bash -lc "test -n \\"$GOOGLE_API_KEY\\" -o -n \\"$GEMINI_API_KEY\\" && echo set"',
        { encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      hasApiKey = String(envCheck).includes('set');
    } else {
      hasApiKey = !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
    }
  } catch {}

  if (hasApiKey) {
    return { ...base, installed: true, authenticated: true, user: 'API key' };
  }

  if (!geminiInstalled && !gcloudInstalled) {
    return { ...base, error: 'Not installed' };
  }
  base.installed = true;

  // Check gemini auth
  if (geminiInstalled) {
    try {
      const output = await execCmd('gemini auth status');
      if (/logged in|authenticated|active/i.test(output) || output.length > 0) {
        const userMatch = output.match(/(?:as|user|email|account)\s+(\S+)/i);
        return { ...base, authenticated: true, user: userMatch ? userMatch[1] : undefined };
      }
    } catch (err: any) {
      if (!isCommandNotFound(err)) {
        // fall through
      }
    }
  }

  // Check token files
  if (isWsl()) {
    try {
      const wslHome = await execAsync('wsl bash -c "echo $HOME"', {
        encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const checkDirs = await execAsync(
        `wsl bash -c "test -d '${wslHome}/.config/gemini' || test -d '${wslHome}/.gemini' && echo found"`,
        { encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      if (String(checkDirs).includes('found')) {
        return { ...base, authenticated: true, user: 'token-file' };
      }
    } catch {}
  } else {
    const tokenPaths = [
      path.join(os.homedir(), '.config', 'gemini'),
      path.join(os.homedir(), '.gemini'),
    ];
    for (const dir of tokenPaths) {
      if (fs.existsSync(dir)) {
        return { ...base, authenticated: true, user: 'token-file' };
      }
    }
  }

  // Check gcloud
  if (gcloudInstalled) {
    try {
      const output = await execCmd('gcloud auth list --filter=status:ACTIVE --format=value(account)');
      if (output.length > 0) {
        return { ...base, authenticated: true, user: output.split('\n')[0] };
      }
    } catch {}
  }

  return { ...base, error: 'Not connected' };
}

export async function loginGoogle(): Promise<void> {
  const command = await hasCommand('gemini') ? 'gemini auth login' : 'gcloud auth login';
  spawnInTerminal(command);
}

export async function installGoogle(): Promise<void> {
  spawnInTerminal('pip install google-genai && echo "Done! Set GEMINI_API_KEY or run: gemini auth login"');
}
