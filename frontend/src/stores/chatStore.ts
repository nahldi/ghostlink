import { create } from 'zustand';
import type { Message, Agent, Channel, Job, Rule, Settings, ActivityEvent } from '../types';

interface FailedMessage {
  text: string;
  channel: string;
  timestamp: number;
}

interface ChatState {
  // Messages
  messages: Message[];
  addMessage: (msg: Message) => void;
  setMessages: (msgs: Message[]) => void;
  pinMessage: (id: number, pinned: boolean) => void;
  bookmarkMessage: (id: number, bookmarked: boolean) => void;
  editMessage: (id: number, text: string) => void;
  appendToMessage: (id: number, token: string) => void;
  deleteMessages: (ids: number[]) => void;
  reactMessage: (id: number, reactions: Record<string, string[]>) => void;
  updateMessageMeta: (id: number, metaUpdate: Record<string, unknown>) => void;

  // Channels
  channels: Channel[];
  activeChannel: string;
  setChannels: (channels: Channel[]) => void;
  setActiveChannel: (name: string) => void;
  incrementUnread: (channel: string) => void;
  clearUnread: (channel: string) => void;

  // Agents
  agents: Agent[];
  setAgents: (agents: Agent[]) => void;
  typingAgents: Record<string, Record<string, number>>;  // v2.5.0: per-channel typing: { channel: { agent: timestamp } }
  setTyping: (sender: string, channel: string) => void;

  // Jobs
  jobs: Job[];
  setJobs: (jobs: Job[]) => void;
  updateJob: (job: Job) => void;

  // Rules
  rules: Rule[];
  setRules: (rules: Rule[]) => void;

  // Activities
  activities: ActivityEvent[];
  addActivity: (event: ActivityEvent) => void;
  setActivities: (events: ActivityEvent[]) => void;

  // WebSocket state
  wsState: 'connected' | 'connecting' | 'disconnected';
  setWsState: (state: 'connected' | 'connecting' | 'disconnected') => void;

  // Failed messages
  failedMessages: FailedMessage[];
  addFailedMessage: (msg: FailedMessage) => void;
  clearFailedMessages: () => void;

  // Session
  sessionStart: number;

  // Settings
  settings: Settings;
  updateSettings: (s: Partial<Settings>) => void;

  // UI state
  sidebarPanel: 'jobs' | 'rules' | 'settings' | null;
  setSidebarPanel: (p: 'jobs' | 'rules' | 'settings' | null) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  replyTo: Message | null;
  setReplyTo: (msg: Message | null) => void;
  pendingInput: string;
  setPendingInput: (text: string) => void;
  chatAtBottom: boolean;
  setChatAtBottom: (v: boolean) => void;
  newMsgCount: number;
  setNewMsgCount: (v: number | ((n: number) => number)) => void;

  // Agent thinking streams
  thinkingStreams: Record<string, { text: string; active: boolean }>;
  _thinkingTimestamps: Record<string, number>;
  setThinkingStream: (agent: string, text: string, active: boolean) => void;

  // Multi-select deletion
  selectMode: boolean;
  selectedIds: Set<number>;
  setSelectMode: (on: boolean) => void;
  toggleSelected: (id: number) => void;
  clearSelection: () => void;
}

const MAX_MESSAGES = 2000;
const TRIM_TO = 1500;

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  addMessage: (msg) =>
    set((s) => {
      // Prevent duplicate messages (from reconnect refetch)
      if (s.messages.some((m) => m.id === msg.id)) return s;
      const updated = [...s.messages, msg];
      // Cap messages to prevent memory leak in long sessions
      return { messages: updated.length > MAX_MESSAGES ? updated.slice(-TRIM_TO) : updated };
    }),
  setMessages: (messages) => set({ messages }),
  pinMessage: (id, pinned) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, pinned } : m
      ),
    })),
  bookmarkMessage: (id, bookmarked) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, bookmarked } : m
      ),
    })),
  editMessage: (id, text) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, text, edited: true } : m
      ),
    })),
  appendToMessage: (id, token) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, text: m.text + token } : m
      ),
    })),
  deleteMessages: (ids) =>
    set((s) => ({
      messages: s.messages.filter((m) => !ids.includes(m.id)),
    })),
  updateMessageMeta: (id, metaUpdate) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== id) return m;
        const existing = typeof m.metadata === 'string' ? (() => { try { return JSON.parse(m.metadata as string); } catch { return {} as Record<string, unknown>; } })() : (m.metadata || {});
        const merged: Record<string, unknown> = { ...existing, ...metaUpdate };
        return { ...m, metadata: merged };
      }),
    })),
  reactMessage: (id, reactions) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, reactions } : m
      ),
    })),

  channels: [{ name: 'general', unread: 0 }],
  activeChannel: 'general',
  setChannels: (channels) => set({ channels }),
  setActiveChannel: (name) => set({ activeChannel: name }),
  incrementUnread: (channel) =>
    set((s) => ({
      channels: s.channels.map((c) =>
        c.name === channel ? { ...c, unread: c.unread + 1 } : c
      ),
    })),
  clearUnread: (channel) =>
    set((s) => ({
      channels: s.channels.map((c) =>
        c.name === channel ? { ...c, unread: 0 } : c
      ),
    })),

  agents: [],
  setAgents: (agents) => set({ agents }),
  typingAgents: {},
  setTyping: (sender, channel) =>
    set((s) => {
      const now = Date.now();
      const channelTyping = { ...(s.typingAgents[channel] || {}), [sender]: now };
      // Expire stale typing entries (>5s old) to prevent unbounded growth
      const cleaned: Record<string, Record<string, number>> = {};
      for (const [ch, agents] of Object.entries({ ...s.typingAgents, [channel]: channelTyping })) {
        const live: Record<string, number> = {};
        for (const [name, ts] of Object.entries(agents)) {
          if (now - ts < 5000) live[name] = ts;
        }
        if (Object.keys(live).length > 0) cleaned[ch] = live;
      }
      return { typingAgents: cleaned };
    }),

  jobs: [],
  setJobs: (jobs) => set({ jobs }),
  updateJob: (job) =>
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === job.id ? job : j)),
    })),

  rules: [],
  setRules: (rules) => set({ rules }),

  // Activities
  activities: [],
  addActivity: (event) =>
    set((s) => ({
      activities: [...s.activities.slice(-99), event],
    })),
  setActivities: (activities) => set({ activities }),

  // WS state
  wsState: 'disconnected',
  setWsState: (wsState) => set({ wsState }),

  // Failed messages
  failedMessages: [],
  addFailedMessage: (msg) =>
    set((s) => ({ failedMessages: [...s.failedMessages, msg] })),
  clearFailedMessages: () => set({ failedMessages: [] }),

  // Session
  sessionStart: Date.now(),

  settings: {
    username: 'You',
    title: 'GhostLink',
    theme: 'dark' as const,
    fontSize: 14,
    loopGuard: 4,
    notificationSounds: true,
    desktopNotifications: false,
    quietHoursStart: 22,
    quietHoursEnd: 8,
    debugMode: false,
    showStatsPanel: true,
    statsSections: { session: true, tokens: true, agents: true, activity: true },
    timezone: (() => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Africa/Abidjan is UTC+0 fallback when OS timezone isn't detected properly
      // (common in Electron/WSL). Use UTC offset to guess a better default.
      if (tz === 'Africa/Abidjan' || !tz) {
        const offset = -new Date().getTimezoneOffset();
        const hours = Math.floor(offset / 60);
        // Map common offsets to well-known timezones
        const offsetMap: Record<number, string> = {
          [-5]: 'America/New_York', [-6]: 'America/Chicago',
          [-7]: 'America/Denver', [-8]: 'America/Los_Angeles',
          [-4]: 'America/Halifax', [-3]: 'America/Sao_Paulo',
          [0]: 'Europe/London', [1]: 'Europe/Paris', [2]: 'Europe/Helsinki',
          [3]: 'Europe/Moscow', [5]: 'Asia/Kolkata', [8]: 'Asia/Shanghai',
          [9]: 'Asia/Tokyo', [10]: 'Australia/Sydney',
        };
        return offsetMap[hours] || 'UTC';
      }
      return tz;
    })(),
    timeFormat: '12h' as const,
    voiceLanguage: 'en-US',
    showAgentBar: true,
    showChannelTabs: true,
    showTypingIndicator: true,
    showTimestamps: true,
    showSenderLabels: true,
  },
  updateSettings: (updates) =>
    set((s) => ({ settings: { ...s.settings, ...updates } })),

  sidebarPanel: null,
  setSidebarPanel: (p) => set({ sidebarPanel: p }),
  mobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
  replyTo: null,
  setReplyTo: (msg) => set({ replyTo: msg }),
  pendingInput: '',
  setPendingInput: (text) => set({ pendingInput: text }),
  chatAtBottom: true,
  setChatAtBottom: (v) => set({ chatAtBottom: v }),
  newMsgCount: 0,
  setNewMsgCount: (v) => set((s) => ({ newMsgCount: typeof v === 'function' ? v(s.newMsgCount) : v })),

  // Agent thinking streams
  thinkingStreams: {},
  _thinkingTimestamps: {} as Record<string, number>,
  setThinkingStream: (agent, text, active) =>
    set((s) => {
      const now = Date.now();
      const timestamps = { ...s._thinkingTimestamps, [agent]: now };
      const updated = { ...s.thinkingStreams, [agent]: { text, active } };
      if (!active) {
        delete updated[agent];
        delete timestamps[agent];
      }
      // Expire stale thinking entries (>60s without update) to handle crashed agents
      for (const [name, ts] of Object.entries(timestamps) as [string, number][]) {
        if (now - ts > 60000 && name !== agent) {
          delete updated[name];
          delete timestamps[name];
        }
      }
      return { thinkingStreams: updated, _thinkingTimestamps: timestamps };
    }),

  // Multi-select deletion
  selectMode: false,
  selectedIds: new Set<number>(),
  setSelectMode: (on) => set({ selectMode: on, selectedIds: new Set() }),
  toggleSelected: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { selectedIds: next };
    }),
  clearSelection: () => set({ selectMode: false, selectedIds: new Set() }),
}));
