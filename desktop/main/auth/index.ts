/**
 * AuthManager — coordinates authentication checks across all AI providers.
 * Exports shared WSL / platform helpers used by every provider module.
 */

import { execFile, execFileSync, spawn } from 'child_process';


import fs from 'fs';
import os from 'os';
import path from 'path';

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


const WSL_PATH_PREFIX = 'export PATH="$PATH:$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin"';

export type TerminalLaunchSpec =
  | {
      kind: 'argv';
      command: string;
      args?: string[];
    }
  | {
      kind: 'shell';
      posix: string;
      windows?: string;
    };

export function execAsync(command: string, argsOrOptions: string[] | any = [], maybeOptions: any = {}): Promise<string> {
  const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
  const options = Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions;
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

export async function execWslCommand(command: string, args: string[] = [], options: any = {}): Promise<string> {
  return execWslBash(
    ['-lc', `${WSL_PATH_PREFIX}; "$@"`, 'bash', command, ...args],
    {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    }
  );
}

async function commandExists(commandName: string): Promise<boolean> {
  assertSafeCommandName(commandName);
  const log = require('electron-log');
  try {
    if (isWsl()) {
      log.info(`[auth] commandExists(${commandName}): checking via WSL`);
      await execWslBash([
        '-lc',
        `${WSL_PATH_PREFIX}; command -v "$1" >/dev/null 2>&1`,
        'bash',
        commandName,
      ], { stdio: 'pipe', timeout: 5_000 });
    } else {
      const checker = process.platform === 'win32' ? 'where' : 'which';
      log.info(`[auth] commandExists(${commandName}): checking via ${checker}`);
      await execFileAsync(checker, [commandName], {
        windowsHide: true,
        stdio: 'pipe',
        timeout: 5_000,
      });
    }
    log.info(`[auth] commandExists(${commandName}): FOUND`);
    return true;
  } catch (err: unknown) {
    log.info(`[auth] commandExists(${commandName}): NOT FOUND (${err instanceof Error ? err.message : String(err)})`);
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

let _wslDetected: boolean | null = null;
export function isWsl(): boolean {
  const settings = getSettings();
  if (settings?.platform === 'wsl') return true;
  if (settings?.platform === 'windows' || settings?.platform === 'macos' || settings?.platform === 'linux') return false;
  // Auto-detect WSL if platform not explicitly set (fresh install)
  if (_wslDetected === null) {
    try {
      const { execFileSync } = require('child_process');
      execFileSync('wsl', ['echo', 'ok'], { stdio: 'pipe', timeout: 3000, windowsHide: true });
      _wslDetected = true;
    } catch {
      _wslDetected = false;
    }
  }
  return _wslDetected;
}

export function winToWsl(windowsPath: string): string {
  let p = windowsPath.replace(/\\/g, '/');
  const driveMatch = p.match(/^([A-Za-z]):\//);
  if (driveMatch) {
    p = `/mnt/${driveMatch[1].toLowerCase()}/${p.slice(3)}`;
  }
  return p;
}

export async function execCmd(command: string, args: string[] = [], timeoutMs: number = 10_000): Promise<string> {
  const result = isWsl()
    ? await execWslCommand(command, args, { timeout: timeoutMs })
    : await execAsync(command, args, {
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
          `${WSL_PATH_PREFIX}; "$1" --version 2>/dev/null`,
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
        ['-lc', `${WSL_PATH_PREFIX}; npx "$1" --version 2>/dev/null`, 'bash', name],
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
  try {
    if (isWsl()) {
      try {
        const result = await execWslCommand('claude', ['--version'], { timeout: 15_000 });
        if (String(result).trim().length > 0) return true;
      } catch {}

      const result = await execWslCommand('npx', ['@anthropic-ai/claude-code', '--version'], { timeout: 15_000 });
      return String(result).trim().length > 0;
    } else {
      const result = await execAsync('npx', ['@anthropic-ai/claude-code', '--version'], {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000,
      });
      return String(result).trim().length > 0;
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

function writeTempLauncher(prefix: string, ext: string, content: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-${process.pid}-`));
  const filePath = path.join(tempDir, `launcher${ext}`);
  const fd = fs.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o700);
  fs.writeFileSync(fd, content, { encoding: 'utf-8' });
  fs.closeSync(fd);
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o700);
  }
  return filePath;
}

function buildPosixWrapper(spec: TerminalLaunchSpec, useWsl: boolean): string {
  const shellBootstrap = [
    '#!/usr/bin/env bash',
    'set +e',
    WSL_PATH_PREFIX,
  ];

  const body = spec.kind === 'argv'
    ? ['"$@"']
    : [spec.posix];

  const shellName = useWsl ? 'bash' : '${SHELL:-bash}';
  return [
    ...shellBootstrap,
    ...body,
    'status=$?',
    "printf '\\n'",
    `if [ "$status" -ne 0 ]; then printf 'Command failed with exit code %s\\n' "$status"; fi`,
    `exec ${shellName} ${useWsl ? '-i' : '-l'}`,
    '',
  ].join('\n');
}

function buildWindowsWrapper(spec: TerminalLaunchSpec): string {
  const body = spec.kind === 'argv'
    ? [
        'set "TARGET=%~1"',
        'shift',
        'call "%TARGET%" %*',
      ]
    : [spec.windows ?? 'echo This action is only supported in a POSIX shell.'];

  return [
    '@echo off',
    'setlocal',
    ...body,
    'set "STATUS=%ERRORLEVEL%"',
    'echo(',
    'if not "%STATUS%"=="0" echo Command failed with exit code %STATUS%',
    'pause',
    '',
  ].join('\r\n');
}

export function terminalCommand(command: string, args: string[] = []): TerminalLaunchSpec {
  assertSafeCommandName(command);
  return { kind: 'argv', command, args };
}

export function terminalShell(posix: string, windows?: string): TerminalLaunchSpec {
  return { kind: 'shell', posix, windows };
}

export function spawnInTerminal(spec: TerminalLaunchSpec): void {
  const useWsl = isWsl();
  const platform = process.platform;
  const detachedOptions = { detached: true, stdio: 'ignore' as const, shell: false };

  if (platform === 'win32') {
    if (useWsl) {
      const wrapperPath = writeTempLauncher('ghostlink-auth', '.sh', buildPosixWrapper(spec, true));
      const wslWrapperPath = winToWsl(wrapperPath);
      const args = spec.kind === 'argv' ? [spec.command, ...(spec.args ?? [])] : [];
      spawn('wsl.exe', ['bash', wslWrapperPath, ...args], detachedOptions).unref();
    } else {
      const wrapperPath = writeTempLauncher('ghostlink-auth', '.cmd', buildWindowsWrapper(spec));
      const args = spec.kind === 'argv' ? [spec.command, ...(spec.args ?? [])] : [];
      spawn('cmd.exe', ['/k', wrapperPath, ...args], detachedOptions).unref();
    }
  } else if (platform === 'darwin') {
    const wrapperPath = writeTempLauncher('ghostlink-auth', '.sh', buildPosixWrapper(spec, false));
    const args = spec.kind === 'argv' ? [spec.command, ...(spec.args ?? [])] : [];
    const script = [
      'on run argv',
      'set shellCommand to "/bin/bash"',
      'repeat with argValue in argv',
      'set shellCommand to shellCommand & " " & quoted form of (argValue as text)',
      'end repeat',
      'tell application "Terminal"',
      'activate',
      'do script shellCommand',
      'end tell',
      'end run',
    ].join('\n');
    spawn('osascript', ['-e', script, wrapperPath, ...args], detachedOptions).unref();
  } else {
    // Linux
    const terminals = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'];
    const wrapperPath = writeTempLauncher('ghostlink-auth', '.sh', buildPosixWrapper(spec, false));
    const args = spec.kind === 'argv' ? [spec.command, ...(spec.args ?? [])] : [];
    for (const term of terminals) {
      try {
        execFileSync('which', [term], { stdio: 'ignore' });
        if (term === 'gnome-terminal' || term === 'konsole') {
          spawn(term, ['--', 'bash', wrapperPath, ...args], detachedOptions).unref();
        } else {
          spawn(term, ['-e', 'bash', wrapperPath, ...args], detachedOptions).unref();
        }
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
    const log = require('electron-log');
    log.info('[auth] checkAll starting, isWsl=' + isWsl() + ', platform=' + (getSettings()?.platform || 'unset'));

    const mainResults = await Promise.allSettled(
      Object.values(_providers).map(p => p.check())
    );
    const main = mainResults.map((r, i) => {
      const key = Object.keys(_providers)[i];
      if (r.status === 'fulfilled') {
        log.info(`[auth] ${key}: installed=${r.value.installed}, authenticated=${r.value.authenticated}, error=${r.value.error || 'none'}`);
        return r.value;
      }
      log.warn(`[auth] ${key}: check REJECTED: ${(r as PromiseRejectedResult).reason}`);
      return {
        provider: key,
        name: key,
        authenticated: false,
        installed: false,
        icon: key,
        color: '#888',
        command: key,
        error: 'Check failed: ' + String((r as PromiseRejectedResult).reason),
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
