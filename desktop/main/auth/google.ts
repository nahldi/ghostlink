/**
 * Google / Gemini CLI authentication provider.
 *
 * Install: `pip install google-genai` or use Google AI Studio API key
 * Auth:    Google AI Studio API key, existing Gemini OAuth creds, or `gcloud auth login`
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AuthStatus } from './index';
import { WSL_EXE, execCmd, hasCommand, isWsl, spawnInTerminal, execAsync, terminalCommand, terminalShell } from './index';

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
        WSL_EXE,
        ['-e', 'bash', '-lc', 'test -n "$GOOGLE_API_KEY" -o -n "$GEMINI_API_KEY" && echo set'],
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

  // The installed Gemini CLI on this machine does not expose `gemini auth ...`,
  // so the OAuth credential file is the best available CLI-backed signal.
  if (isWsl()) {
    try {
      const authFile = await execAsync(WSL_EXE, ['-e', 'bash', '-lc', '(test -f ~/.gemini/oauth_creds.json || test -f ~/.config/gemini/oauth_creds.json) && echo found'], {
        encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (String(authFile).includes('found')) {
        return { ...base, authenticated: true, user: 'token-file' };
      }
    } catch {}
  } else {
    const tokenPaths = [
      path.join(os.homedir(), '.config', 'gemini', 'oauth_creds.json'),
      path.join(os.homedir(), '.gemini', 'oauth_creds.json'),
    ];
    for (const file of tokenPaths) {
      if (fs.existsSync(file)) {
        return { ...base, authenticated: true, user: 'token-file' };
      }
    }
  }

  // Check gcloud
  if (gcloudInstalled) {
    try {
      const output = await execCmd('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)']);
      if (output.length > 0) {
        return { ...base, authenticated: true, user: output.split('\n')[0] };
      }
    } catch {}
  }

  return { ...base, error: 'Not connected' };
}

export async function loginGoogle(): Promise<void> {
  // Only surface reconnect flows GhostLink can truthfully support here.
  const hasGcloud = await hasCommand('gcloud');

  if (hasGcloud) {
    spawnInTerminal(terminalCommand('gcloud', ['auth', 'login']));
  } else {
    // Guide the user toward the flows we know actually exist today.
    spawnInTerminal(terminalShell(
      isWsl()
        ? 'echo "=== Gemini Setup ===" && echo "" && echo "Option 1: Set API key (recommended)" && echo "  Get a free key at: https://aistudio.google.com/app/apikey" && echo "  Then set it: export GEMINI_API_KEY=your_key_here" && echo "  Add to ~/.bashrc to persist" && echo "" && echo "Option 2: Install and connect Google Cloud" && echo "  pip install google-genai" && echo "  gcloud auth login"'
        : 'echo === Gemini Setup === && echo. && echo Option 1: Set API key (recommended) && echo   Get a free key at: https://aistudio.google.com/app/apikey && echo   Set it in GhostLink Settings ^> AI tab && echo. && echo Option 2: Install and connect Google Cloud && echo   pip install google-genai && echo   gcloud auth login'
    ));
  }
}

export async function installGoogle(): Promise<void> {
  if (isWsl()) {
    spawnInTerminal(terminalShell(
      'pip install google-genai && echo "" && echo "Done! Next: set GEMINI_API_KEY or run gcloud auth login"'
    ));
  } else {
    spawnInTerminal(terminalShell(
      'pip install google-genai && echo "Done! Next: set GEMINI_API_KEY or run gcloud auth login"',
      'pip install google-genai && echo Done! Next: set GEMINI_API_KEY in GhostLink Settings or run gcloud auth login'
    ));
  }
}
