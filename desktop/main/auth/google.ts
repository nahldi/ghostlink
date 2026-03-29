/**
 * Google / Gemini CLI authentication provider.
 *
 * Install: `pip install google-genai` or use Google AI Studio API key
 * Auth:    `gemini auth login`, `gcloud auth login`, or GOOGLE_API_KEY / GEMINI_API_KEY env var
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AuthStatus } from './index';
import { WSL_EXE, execCmd, hasCommand, isCommandNotFound, isWsl, spawnInTerminal, execAsync, terminalCommand, terminalShell } from './index';

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

  // Check gemini auth
  if (geminiInstalled) {
    try {
      const output = await execCmd('gemini', ['auth', 'status']);
      if ((/\b(logged in|authenticated|active)\b/i.test(output) && !/not (logged in|authenticated|active)/i.test(output)) || output.length > 0) {
        const userMatch = output.match(/(?:as|user|email|account)\s+(\S+)/i);
        return { ...base, authenticated: true, user: userMatch ? userMatch[1] : undefined };
      }
    } catch (err: any) {
      if (!isCommandNotFound(err)) {
        // fall through
      }
    }
  }

  // Check the actual Gemini OAuth credential file, not just a non-empty config dir.
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
  // Try gemini CLI first, then gcloud, then show API key instructions
  const hasGemini = await hasCommand('gemini');
  const hasGcloud = await hasCommand('gcloud');

  if (hasGemini) {
    spawnInTerminal(terminalCommand('gemini', ['auth', 'login']));
  } else if (hasGcloud) {
    spawnInTerminal(terminalCommand('gcloud', ['auth', 'login']));
  } else {
    // Neither CLI available — guide user to set API key
    spawnInTerminal(terminalShell(
      isWsl()
        ? 'echo "=== Gemini Setup ===" && echo "" && echo "Option 1: Set API key (recommended)" && echo "  Get a free key at: https://aistudio.google.com/app/apikey" && echo "  Then set it: export GEMINI_API_KEY=your_key_here" && echo "  Add to ~/.bashrc to persist" && echo "" && echo "Option 2: Install Gemini CLI" && echo "  pip install google-genai" && echo "  gemini auth login"'
        : 'echo === Gemini Setup === && echo. && echo Option 1: Set API key (recommended) && echo   Get a free key at: https://aistudio.google.com/app/apikey && echo   Set it in GhostLink Settings ^> AI tab && echo. && echo Option 2: Install Gemini CLI && echo   pip install google-genai && echo   gemini auth login'
    ));
  }
}

export async function installGoogle(): Promise<void> {
  if (isWsl()) {
    spawnInTerminal(terminalShell(
      'pip install google-genai && echo "" && echo "Done! Now run: gemini auth login" && echo "Or set GEMINI_API_KEY in Settings > AI tab"'
    ));
  } else {
    spawnInTerminal(terminalShell(
      'pip install google-genai && echo "Done! Now run: gemini auth login" && echo "Or set GEMINI_API_KEY in Settings > AI tab"',
      'pip install google-genai && echo Done! Now run: gemini auth login && echo Or set GEMINI_API_KEY in GhostLink Settings AI tab'
    ));
  }
}
