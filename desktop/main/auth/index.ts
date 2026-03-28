/**
 * AuthManager — coordinates authentication checks across all AI providers.
 * Exports shared WSL / platform helpers used by every provider module.
 */

import { exec, execFile, execFileSync, spawn } from 'child_process';


import fs from 'fs';

import { checkAnthropic, loginAnthropic, installAnthropic } from './anthropic';
import { checkOpenAI, loginOpenAI, installOpenAI } from './openai';
import { checkGoogle, loginGoogle, installGoogle } from './google';
import { checkGitHub, loginGitHub, installGitHub } from './github';
import { getSettingsPath, loadSettingsFile } from '../settings';

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

function execFileAsync(command: string, args: string[], options: any = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error: any, stdout: any, stderr: any) => {
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

function assertSafeCommandName(name: string): void {
  if (!/^[A-Za-z0-9._+-]+$/.test(name)) {
    throw new Error(`Unsafe command name: ${name}`);
  }
}

async function execWslBash(args: string[], options: any = {}): Promise<string> {
  return execFileAsync('wsl', ['bash', ...args], {
    windowsHide: true,
    ...options,
  });
}

async function commandExists(commandName: string): Promise<boolean> {
  assertSafeCommandName(commandName);
  try {
    if (isWsl()) {
      await execWslBash([
        '-lc',
        'export PATH="$PATH:$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin"; command -v "$1" >/dev/null 2>&1',
        'bash',
        commandName,
      ], { stdio: 'pipe', timeout: 5_000 });
    } else {
      const checker = process.platform === 'win32' ? 'where' : 'which';
      await execFileAsync(checker, [commandName], {
        windowsHide: true,
        stdio: 'pipe',
        timeout: 5_000,
      });
    }
    return true;
  } catch {
    return false;
  }
}

// ── Shared platform helpers ─────────────────────────────────────────────────

export function getSettings(): Record<string, any> | null {
  try {
    const settingsPath = getSettingsPath();
    if (!fs.existsSync(settingsPath)) return null;
    return loadSettingsFile(settingsPath) as Record<string, any> | null;
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
  if (await commandExists(name)) {
    return true;
  }

  // Method 2: Check common npm global bin paths (npm-global, nvm, etc.)
  if (isWsl()) {
    assertSafeCommandName(name);
    try {
      // Check ~/.npm-global/bin, ~/.local/bin, nvm paths, /usr/local/bin
      const result = await execWslBash(
        [
          '-lc',
          'for candidate in "$HOME/.npm-global/bin/$1" "$HOME/.local/bin/$1" "/usr/local/bin/$1"; do test -f "$candidate" && echo found && exit 0; done; exit 1',
          'bash',
          name,
        ],
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5_000 }
      );
      if (String(result).includes('found')) return true;
    } catch {}

    // Also try running it with full PATH expansion
    try {
      const result = await execWslBash(
        [
          '-ic',
          'export PATH="$PATH:$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin"; "$1" --version 2>/dev/null',
          'bash',
          name,
        ],
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 }
      );
      if (String(result).length > 0) return true;
    } catch {}
  }

  // Method 3: Try npx (for tools installed via npm)
  try {
    if (isWsl()) {
      assertSafeCommandName(name);
      await execWslBash(
        ['-lc', 'export PATH="$PATH:$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin"; npx "$1" --version 2>/dev/null', 'bash', name],
        { stdio: 'pipe', timeout: 15_000 }
      );
    } else {
      await execFileAsync('npx', [name, '--version'], { windowsHide: true, stdio: 'pipe', timeout: 15_000 });
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
        execFileSync('which', [term], { stdio: 'ignore' });
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

// Additional CLI agents (no OAuth — just detect if installed)
const _extraAgents: { command: string; name: string; color: string; installCmd: string }[] = [
  { command: 'grok',     name: 'Grok',     color: '#ff6b35', installCmd: 'npm i -g grok' },
  { command: 'aider',    name: 'Aider',    color: '#14b8a6', installCmd: 'pip install aider-chat' },
  { command: 'goose',    name: 'Goose',    color: '#f59e0b', installCmd: 'brew install goose' },
  { command: 'opencode', name: 'OpenCode', color: '#22c55e', installCmd: 'curl -fsSL https://opencode.ai/install | bash' },
  { command: 'ollama',   name: 'Ollama',   color: '#ffffff', installCmd: 'curl -fsSL https://ollama.com/install.sh | sh' },
];

async function checkExtraAgent(agent: typeof _extraAgents[0]): Promise<AuthStatus> {
  const installed = await commandExists(agent.command);
  return {
    provider: agent.command,
    name: agent.name,
    authenticated: installed,
    installed,
    icon: agent.command,
    color: agent.color,
    command: agent.command,
    installCommand: agent.installCmd,
  };
}

class AuthManager {
  async checkAll(): Promise<AuthStatus[]> {
    const mainResults = await Promise.allSettled(
      Object.values(_providers).map(p => p.check())
    );
    const main = mainResults.map((r, i) => {
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

    // Check extra CLI agents in parallel
    const extraResults = await Promise.allSettled(
      _extraAgents.map(a => checkExtraAgent(a))
    );
    const extra = extraResults
      .filter((r): r is PromiseFulfilledResult<AuthStatus> => r.status === 'fulfilled')
      .map(r => r.value);

    return [...main, ...extra];
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
