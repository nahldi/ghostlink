/**
 * AuthManager — coordinates authentication checks across all AI providers.
 * Exports shared WSL / platform helpers used by every provider module.
 */

import { exec, spawn } from 'child_process';


import fs from 'fs';
import path from 'path';
import os from 'os';

import { checkAnthropic, loginAnthropic, installAnthropic } from './anthropic';
import { checkOpenAI, loginOpenAI, installOpenAI } from './openai';
import { checkGoogle, loginGoogle, installGoogle } from './google';
import { checkGitHub, loginGitHub, installGitHub } from './github';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuthStatus {
  provider: string;        // Internal key (anthropic, openai, google, github)
  name: string;            // Display name shown in UI
  authenticated: boolean;
  installed: boolean;      // Whether the CLI binary exists
  user?: string;           // Username / email if authenticated
  error?: string;          // Human-readable error when auth fails
  icon: string;            // Provider icon identifier for the renderer
  color: string;           // Brand color hex
  command: string;         // CLI command name
  installCommand?: string; // Command to install if not installed
}


export function execAsync(command: string, options: any = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    exec(command, options, (error: any, stdout: any, stderr: any) => {
      if (error) {
        const err: any = new Error(error.message);
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = error.code;
        reject(err);
      } else {
        resolve(String(stdout).trim());
      }
    });
  });
}

// ── Shared platform helpers ─────────────────────────────────────────────────

export function getSettings(): Record<string, any> | null {
  try {
    const settingsPath = path.join(os.homedir(), '.ghostlink', 'settings.json');
    if (!fs.existsSync(settingsPath)) return null;
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function isWsl(): boolean {
  const settings = getSettings();
  return settings?.platform === 'wsl';
}

export function cmd(command: string): string {
  if (!isWsl()) return command;
  // Include common npm global bin paths in WSL PATH
  const escapedCmd = command.replace(/"/g, '\\"');
  return `wsl bash -lc "export PATH=\\$PATH:\\$HOME/.npm-global/bin:\\$HOME/.local/bin:/usr/local/bin; ${escapedCmd}"`;
}

export function winToWsl(windowsPath: string): string {
  let p = windowsPath.replace(/\\/g, '/');
  const driveMatch = p.match(/^([A-Za-z]):\//);
  if (driveMatch) {
    p = `/mnt/${driveMatch[1].toLowerCase()}/${p.slice(3)}`;
  }
  return p;
}

export async function execCmd(command: string, timeoutMs: number = 10_000): Promise<string> {
  const result = await execAsync(cmd(command), {
    encoding: 'utf-8',
    timeout: timeoutMs,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return String(result).trim();
}

/**
 * Check if a CLI tool is available by trying multiple methods:
 * 1. `which <name>` (or `where` on Windows)
 * 2. `npx <name> --version` (for npx-installed tools)
 * 3. Check common install locations
 */
export async function hasCommand(name: string): Promise<boolean> {
  // Method 1: Direct binary via which/where
  try {
    if (isWsl()) {
      await execAsync(`wsl bash -lc "which ${name} 2>/dev/null || command -v ${name} 2>/dev/null"`, { stdio: 'pipe', timeout: 5_000 });
      return true;
    } else {
      const check = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
      await execAsync(check, { stdio: 'pipe', timeout: 5_000 });
      return true;
    }
  } catch {
    // Not found via which/where — try other methods
  }

  // Method 2: Check common npm global bin paths (npm-global, nvm, etc.)
  if (isWsl()) {
    try {
      // Check ~/.npm-global/bin, ~/.local/bin, nvm paths, /usr/local/bin
      const result = await execAsync(
        `wsl bash -c "test -f ~/.npm-global/bin/${name} || test -f ~/.local/bin/${name} || test -f /usr/local/bin/${name} && echo found"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5_000 }
      );
      if (String(result).includes('found')) return true;
    } catch {}

    // Also try running it with full PATH expansion
    try {
      const result = await execAsync(
        `wsl bash -ic "${name} --version 2>/dev/null || PATH=$PATH:$HOME/.npm-global/bin:$HOME/.local/bin ${name} --version 2>/dev/null"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 }
      );
      if (String(result).length > 0) return true;
    } catch {}
  }

  // Method 3: Try npx (for tools installed via npm)
  try {
    if (isWsl()) {
      await execAsync(`wsl bash -lc "npx ${name} --version 2>/dev/null"`, { stdio: 'pipe', timeout: 15_000 });
    } else {
      await execAsync(`npx ${name} --version`, { stdio: 'pipe', timeout: 15_000 });
    }
    return true;
  } catch {
    // Not available via npx either
  }

  return false;
}

/**
 * More thorough check specifically for Claude Code which installs via npx
 */
export async function hasClaudeCli(): Promise<boolean> {
  // Check direct binary first
  try {
    if (isWsl()) {
      const result = await execAsync('wsl bash -lc "claude --version 2>/dev/null || npx @anthropic-ai/claude-code --version 2>/dev/null"', {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000,
      });
      return String(result).includes('Claude Code') || String(result).length > 0;
    } else {
      const result = await execAsync('npx @anthropic-ai/claude-code --version', {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000,
      });
      return String(result).includes('Claude Code') || String(result).length > 0;
    }
  } catch {
    return false;
  }
}

export function isCommandNotFound(err: any): boolean {
  const msg = (err.message ?? '') + (err.stderr?.toString() ?? '');
  return (
    msg.includes('not found') ||
    msg.includes('not recognized') ||
    msg.includes('ENOENT') ||
    err.code === 'ENOENT'
  );
}

export function spawnInTerminal(command: string): void {
  const useWsl = isWsl();
  const platform = process.platform;

  if (platform === 'win32') {
    if (useWsl) {
      const parts = command.split(/\s+/);
      try {
        spawn('wt.exe', ['wsl', ...parts], {
          shell: true, detached: true, stdio: 'ignore',
        }).unref();
      } catch {
        spawn('cmd.exe', ['/c', 'start', 'wsl', ...parts], {
          shell: true, detached: true, stdio: 'ignore',
        }).unref();
      }
    } else {
      spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', command], {
        shell: true, detached: true, stdio: 'ignore',
      }).unref();
    }
  } else if (platform === 'darwin') {
    spawn('osascript', [
      '-e', `tell application "Terminal" to do script "${command}"`,
    ], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // Linux
    const terminals = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'];
    for (const term of terminals) {
      try {
        require('child_process').execSync(`which ${term}`, { stdio: 'ignore' });
        spawn(term, ['-e', command], { detached: true, stdio: 'ignore' }).unref();
        return;
      } catch { /* next */ }
    }
  }
}

// ── AuthManager ──────────────────────────────────────────────────────────────

interface ProviderEntry {
  check: () => Promise<AuthStatus>;
  login: () => Promise<void>;
  install: () => Promise<void>;
}

const _providers: Record<string, ProviderEntry> = {
  anthropic: { check: checkAnthropic, login: loginAnthropic, install: installAnthropic },
  openai:    { check: checkOpenAI,    login: loginOpenAI,    install: installOpenAI },
  google:    { check: checkGoogle,    login: loginGoogle,    install: installGoogle },
  github:    { check: checkGitHub,    login: loginGitHub,    install: installGitHub },
};

class AuthManager {
  async checkAll(): Promise<AuthStatus[]> {
    const results = await Promise.allSettled(
      Object.values(_providers).map(p => p.check())
    );
    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      const key = Object.keys(_providers)[i];
      return {
        provider: key,
        name: key,
        authenticated: false,
        installed: false,
        icon: key,
        color: '#888',
        command: key,
        error: 'Check failed',
      };
    });
  }

  async check(provider: string): Promise<AuthStatus | null> {
    const entry = _providers[provider];
    if (!entry) return null;
    try {
      return await entry.check();
    } catch {
      return null;
    }
  }

  async login(provider: string): Promise<void> {
    const entry = _providers[provider];
    if (entry) await entry.login();
  }

  async install(provider: string): Promise<void> {
    const entry = _providers[provider];
    if (entry) await entry.install();
  }
}

export const authManager = new AuthManager();
