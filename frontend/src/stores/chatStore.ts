import { create } from 'zustand';
import type { Message, Agent, Channel, Job, Rule, Settings } from '../types';

interface ChatState {
  // Messages
  messages: Message[];
  addMessage: (msg: Message) => void;
  setMessages: (msgs: Message[]) => void;
  pinMessage: (id: number, pinned: boolean) => void;
  deleteMessages: (ids: number[]) => void;
  reactMessage: (id: number, reactions: Record<string, string[]>) => void;

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
  typingAgents: Record<string, number>;
  setTyping: (sender: string, channel: string) => void;

  // Jobs
  jobs: Job[];
  setJobs: (jobs: Job[]) => void;
  updateJob: (job: Job) => void;

  // Rules
  rules: Rule[];
  setRules: (rules: Rule[]) => void;

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
  chatAtBottom: boolean;
  setChatAtBottom: (v: boolean) => void;
  newMsgCount: number;
  setNewMsgCount: (v: number | ((n: number) => number)) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),
  setMessages: (messages) => set({ messages }),
  pinMessage: (id, pinned) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, pinned } : m
      ),
    })),
  deleteMessages: (ids) =>
    set((s) => ({
      messages: s.messages.filter((m) => !ids.includes(m.id)),
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
  setTyping: (sender, _channel) =>
    set((s) => ({
      typingAgents: { ...s.typingAgents, [sender]: Date.now() },
    })),

  jobs: [],
  setJobs: (jobs) => set({ jobs }),
  updateJob: (job) =>
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === job.id ? job : j)),
    })),

  rules: [],
  setRules: (rules) => set({ rules }),

  settings: {
    username: 'You',
    title: 'AI Chattr',
    theme: 'dark' as const,
    fontSize: 14,
    loopGuard: 4,
    notificationSounds: true,
  },
  updateSettings: (updates) =>
    set((s) => ({ settings: { ...s.settings, ...updates } })),

  sidebarPanel: null,
  setSidebarPanel: (p) => set({ sidebarPanel: p }),
  mobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
  replyTo: null,
  setReplyTo: (msg) => set({ replyTo: msg }),
  chatAtBottom: true,
  setChatAtBottom: (v) => set({ chatAtBottom: v }),
  newMsgCount: 0,
  setNewMsgCount: (v) => set((s) => ({ newMsgCount: typeof v === 'function' ? v(s.newMsgCount) : v })),
}));
