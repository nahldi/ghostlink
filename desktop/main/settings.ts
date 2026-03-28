import fs from 'fs';
import os from 'os';
import path from 'path';

export interface PersistentAgentSettings {
  base: string;
  label: string;
  command: string;
  args: string[];
  cwd: string;
  color: string;
  nickname?: string;
  defaultPrompt?: string;
}

const ALLOWED_AGENT_COMMANDS: Record<string, readonly string[]> = {
  claude: ['claude'],
  codex: ['codex'],
  gemini: ['gemini'],
  grok: ['grok'],
  copilot: ['github-copilot', 'gh'],
  aider: ['aider'],
  goose: ['goose'],
  opencode: ['opencode'],
  ollama: ['ollama'],
};

const DEFAULT_AGENT_COLORS: Record<string, string> = {
  claude: '#e8734a',
  codex: '#10a37f',
  gemini: '#4285f4',
  grok: '#ff6b35',
  copilot: '#6cc644',
  aider: '#14b8a6',
  goose: '#f59e0b',
  opencode: '#22c55e',
  ollama: '#ffffff',
};

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const THEMES = ['dark', 'light', 'cyberpunk', 'terminal', 'ocean', 'sunset', 'midnight', 'rosegold', 'arctic'] as const;
const TIME_FORMATS = ['12h', '24h'] as const;
const PLATFORMS = ['windows', 'wsl', 'macos', 'linux'] as const;
const SHELLS = ['powershell', 'ubuntu', 'cmd', 'terminal'] as const;
const AUTO_ROUTE_OPTIONS = ['none', 'all', 'smart'] as const;

function getObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getString(value: unknown, fallback = '', maxLength = 256): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function getBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function getEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback;
}

function getInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

function getStringArray(value: unknown, maxItems: number, maxLength = 128): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.slice(0, maxLength))
    .slice(0, maxItems);
}

function getStringMap(value: unknown, maxItems = 64, maxLength = 1024): Record<string, string> {
  const input = getObject(value);
  const result: Record<string, string> = {};

  for (const [key, raw] of Object.entries(input)) {
    if (Object.keys(result).length >= maxItems) break;
    const safeKey = getString(key, '', 64);
    const safeValue = getString(raw, '', maxLength);
    if (!safeKey || !safeValue) continue;
    result[safeKey] = safeValue;
  }

  return result;
}

function sanitizeStatsSections(value: unknown): Record<string, boolean> {
  const input = getObject(value);
  return {
    session: getBoolean(input.session, true),
    tokens: getBoolean(input.tokens, true),
    agents: getBoolean(input.agents, true),
    activity: getBoolean(input.activity, true),
  };
}

function sanitizePersistentAgents(value: unknown): PersistentAgentSettings[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const agents: PersistentAgentSettings[] = [];

  for (const raw of value) {
    const item = getObject(raw);
    const base = getString(item.base, '', 32).toLowerCase();
    if (!base || seen.has(base) || !(base in ALLOWED_AGENT_COMMANDS)) continue;

    const allowedCommands = ALLOWED_AGENT_COMMANDS[base];
    const command = allowedCommands.includes(String(item.command ?? ''))
      ? String(item.command)
      : allowedCommands[0];

    agents.push({
      base,
      label: getString(item.label, base.charAt(0).toUpperCase() + base.slice(1), 64),
      command,
      args: getStringArray(item.args, 16, 256),
      cwd: getString(item.cwd, '.', 4096),
      color: COLOR_RE.test(String(item.color ?? '')) ? String(item.color) : (DEFAULT_AGENT_COLORS[base] ?? '#a78bfa'),
      nickname: getString(item.nickname, '', 64) || undefined,
      defaultPrompt: getString(item.defaultPrompt, '', 4000) || undefined,
    });
    seen.add(base);
  }

  return agents;
}

export function getSettingsPath(): string {
  return path.join(os.homedir(), '.ghostlink', 'settings.json');
}

export function sanitizeSettings(raw: unknown): Record<string, unknown> {
  const input = getObject(raw);
  const defaultPlatform = process.platform === 'darwin'
    ? 'macos'
    : process.platform === 'win32'
      ? 'windows'
      : 'linux';

  return {
    username: getString(input.username, 'You', 80),
    title: getString(input.title, 'GhostLink', 120),
    theme: getEnum(input.theme, THEMES, 'dark'),
    fontSize: getInteger(input.fontSize, 14, 10, 24),
    loopGuard: getInteger(input.loopGuard, 4, 1, 10),
    notificationSounds: getBoolean(input.notificationSounds, true),
    desktopNotifications: getBoolean(input.desktopNotifications, false),
    debugMode: getBoolean(input.debugMode, false),
    showStatsPanel: getBoolean(input.showStatsPanel, true),
    statsSections: sanitizeStatsSections(input.statsSections),
    channels: getStringArray(input.channels, 64, 64),
    persistentAgents: sanitizePersistentAgents(input.persistentAgents),
    connectedAgents: getStringArray(input.connectedAgents, 64, 64),
    autoRoute: typeof input.autoRoute === 'boolean'
      ? input.autoRoute
      : getEnum(input.autoRoute, AUTO_ROUTE_OPTIONS, 'none'),
    quietHoursStart: getInteger(input.quietHoursStart, 22, 0, 23),
    quietHoursEnd: getInteger(input.quietHoursEnd, 8, 0, 23),
    soundEnabled: getBoolean(input.soundEnabled, true),
    soundVolume: getInteger(input.soundVolume, 100, 0, 100),
    soundPerAgent: getStringMap(input.soundPerAgent),
    agentSounds: getStringMap(input.agentSounds),
    timezone: getString(input.timezone, 'UTC', 64),
    timeFormat: getEnum(input.timeFormat, TIME_FORMATS, '12h'),
    voiceLanguage: getString(input.voiceLanguage, 'en-US', 32),
    showAgentBar: getBoolean(input.showAgentBar, true),
    showChannelTabs: getBoolean(input.showChannelTabs, true),
    showTypingIndicator: getBoolean(input.showTypingIndicator, true),
    showTimestamps: getBoolean(input.showTimestamps, true),
    showSenderLabels: getBoolean(input.showSenderLabels, true),
    workspace: getString(input.workspace, '', 4096),
    port: getInteger(input.port, 8300, 1, 65535),
    platform: getEnum(input.platform, PLATFORMS, defaultPlatform),
    shell: getEnum(input.shell, SHELLS, process.platform === 'win32' ? 'powershell' : 'terminal'),
    autoStart: getBoolean(input.autoStart, false),
    setupComplete: getBoolean(input.setupComplete, false),
    appVersion: getString(input.appVersion, '', 32),
  };
}

export function loadSettingsFile(settingsPath: string = getSettingsPath()): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(settingsPath)) return null;
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return sanitizeSettings(raw);
  } catch {
    return null;
  }
}

export function saveSettingsFile(
  settings: unknown,
  settingsPath: string = getSettingsPath(),
): Record<string, unknown> {
  const sanitized = sanitizeSettings(settings);
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(sanitized, null, 2), 'utf-8');
  return sanitized;
}
