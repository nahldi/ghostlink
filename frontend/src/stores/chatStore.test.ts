import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chatStore';

describe('chatStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useChatStore.setState({
      messages: [],
      agents: [],
      channels: [{ name: 'general', unread: 0 }],
      activeChannel: 'general',
    });
  });

  it('adds a message', () => {
    const msg = {
      id: 1, uid: 'test-1', sender: 'user', text: 'hello',
      type: 'chat' as const, timestamp: Date.now() / 1000,
      time: '12:00', channel: 'general',
    };
    useChatStore.getState().addMessage(msg);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].text).toBe('hello');
  });

  it('prevents duplicate messages', () => {
    const msg = {
      id: 1, uid: 'test-1', sender: 'user', text: 'hello',
      type: 'chat' as const, timestamp: Date.now() / 1000,
      time: '12:00', channel: 'general',
    };
    useChatStore.getState().addMessage(msg);
    useChatStore.getState().addMessage(msg); // duplicate
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  it('edits a message', () => {
    const msg = {
      id: 1, uid: 'test-1', sender: 'user', text: 'hello',
      type: 'chat' as const, timestamp: Date.now() / 1000,
      time: '12:00', channel: 'general',
    };
    useChatStore.getState().addMessage(msg);
    useChatStore.getState().editMessage(1, 'updated');
    expect(useChatStore.getState().messages[0].text).toBe('updated');
    expect(useChatStore.getState().messages[0].edited).toBe(true);
  });

  it('appends to a message (token streaming)', () => {
    const msg = {
      id: 1, uid: 'test-1', sender: 'claude', text: 'Hello',
      type: 'chat' as const, timestamp: Date.now() / 1000,
      time: '12:00', channel: 'general',
    };
    useChatStore.getState().addMessage(msg);
    useChatStore.getState().appendToMessage(1, ' world');
    expect(useChatStore.getState().messages[0].text).toBe('Hello world');
  });

  it('deletes messages', () => {
    const msg1 = { id: 1, uid: 'test-1', sender: 'user', text: 'a', type: 'chat' as const, timestamp: 1, time: '1', channel: 'general' };
    const msg2 = { id: 2, uid: 'test-2', sender: 'user', text: 'b', type: 'chat' as const, timestamp: 2, time: '2', channel: 'general' };
    useChatStore.getState().addMessage(msg1);
    useChatStore.getState().addMessage(msg2);
    useChatStore.getState().deleteMessages([1]);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].id).toBe(2);
  });

  it('pins and unpins messages', () => {
    const msg = { id: 1, uid: 'test-1', sender: 'user', text: 'a', type: 'chat' as const, timestamp: 1, time: '1', channel: 'general' };
    useChatStore.getState().addMessage(msg);
    useChatStore.getState().pinMessage(1, true);
    expect(useChatStore.getState().messages[0].pinned).toBe(true);
    useChatStore.getState().pinMessage(1, false);
    expect(useChatStore.getState().messages[0].pinned).toBe(false);
  });

  it('tracks unread counts', () => {
    useChatStore.getState().incrementUnread('general');
    const ch = useChatStore.getState().channels.find(c => c.name === 'general');
    expect(ch?.unread).toBe(1);
  });

  it('preserves bulk selection when switching channels', () => {
    useChatStore.setState({
      selectMode: true,
      selectedIds: new Set([1, 2]),
      channels: [{ name: 'general', unread: 0 }, { name: 'dev', unread: 0 }],
      activeChannel: 'general',
    });
    useChatStore.getState().setActiveChannel('dev');
    expect(useChatStore.getState().activeChannel).toBe('dev');
    expect(useChatStore.getState().selectMode).toBe(true);
    expect(Array.from(useChatStore.getState().selectedIds)).toEqual([1, 2]);
  });

  // Cockpit state management
  it('setCockpitAgent opens cockpit panel', () => {
    useChatStore.getState().setCockpitAgent('claude');
    expect(useChatStore.getState().cockpitAgent).toBe('claude');
    expect(useChatStore.getState().sidebarPanel).toBe('cockpit');
  });

  it('setCockpitAgent(null) closes cockpit', () => {
    useChatStore.getState().setCockpitAgent('claude');
    useChatStore.getState().setCockpitAgent(null);
    expect(useChatStore.getState().cockpitAgent).toBeNull();
    expect(useChatStore.getState().sidebarPanel).toBeNull();
  });

  it('cleans up cockpit state when agent goes offline', () => {
    const onlineAgents = [
      { name: 'claude', base: 'claude', label: 'Claude', color: '#e8734a', state: 'active' as const, slot: 1 },
      { name: 'codex', base: 'codex', label: 'Codex', color: '#10a37f', state: 'active' as const, slot: 2 },
    ];
    useChatStore.getState().setAgents(onlineAgents);
    useChatStore.getState().setTerminalStream({ agent: 'claude', output: 'test', active: true, updated_at: Date.now() });
    useChatStore.getState().setCockpitAgent('claude');

    // Claude goes offline
    const updatedAgents = [
      { name: 'claude', base: 'claude', label: 'Claude', color: '#e8734a', state: 'offline' as const, slot: 1 },
      { name: 'codex', base: 'codex', label: 'Codex', color: '#10a37f', state: 'active' as const, slot: 2 },
    ];
    useChatStore.getState().setAgents(updatedAgents);

    // Cockpit should auto-close and state should be cleaned
    expect(useChatStore.getState().cockpitAgent).toBeNull();
    expect(useChatStore.getState().terminalStreams['claude']).toBeUndefined();
  });

  it('typing agents expire after 5 seconds', () => {
    const now = Date.now();
    useChatStore.setState({
      typingAgents: {
        'general': { 'old-agent': now - 10000 },  // 10s old — should expire
      },
    });
    useChatStore.getState().setTyping('new-agent', 'general');
    const typing = useChatStore.getState().typingAgents['general'];
    expect(typing?.['old-agent']).toBeUndefined();  // expired
    expect(typing?.['new-agent']).toBeDefined();     // fresh
  });

  it('fileDiffs are capped at 50 per agent', () => {
    for (let i = 0; i < 60; i++) {
      useChatStore.getState().setFileDiff({
        agent: 'claude',
        path: `file${i}.ts`,
        action: 'modified',
        before: '',
        after: '',
        diff: `+line ${i}`,
        timestamp: Date.now(),
      });
    }
    const diffs = useChatStore.getState().fileDiffs['claude'];
    expect(Object.keys(diffs).length).toBeLessThanOrEqual(50);
  });

  it('normalizes diff paths on write', () => {
    useChatStore.getState().setFileDiff({
      agent: 'claude',
      path: './src/../src/./App.tsx',
      action: 'modified',
      before: '',
      after: '',
      diff: '+test',
      timestamp: Date.now(),
    });
    const diffs = useChatStore.getState().fileDiffs['claude'];
    // Should be normalized — no leading ./ or /./
    const keys = Object.keys(diffs);
    expect(keys.every(k => !k.startsWith('./') && !k.includes('/./'))).toBe(true);
  });

  // Channel management
  it('sets channels list', () => {
    useChatStore.getState().setChannels([
      { name: 'general', unread: 0 },
      { name: 'dev', unread: 3 },
    ]);
    expect(useChatStore.getState().channels).toHaveLength(2);
    expect(useChatStore.getState().channels[1].name).toBe('dev');
  });

  it('clears unread count for a channel', () => {
    useChatStore.getState().setChannels([{ name: 'general', unread: 5 }]);
    useChatStore.getState().clearUnread('general');
    const ch = useChatStore.getState().channels.find(c => c.name === 'general');
    expect(ch?.unread).toBe(0);
  });

  // Settings management
  it('updates settings partially', () => {
    useChatStore.getState().updateSettings({ theme: 'cyberpunk' });
    expect(useChatStore.getState().settings.theme).toBe('cyberpunk');
    // Other settings should remain unchanged
    expect(useChatStore.getState().settings.username).toBeDefined();
  });

  // Bookmark toggle
  it('bookmarks and unbookmarks a message', () => {
    const msg = { id: 1, uid: 't', sender: 'user', text: 'test', type: 'chat' as const, timestamp: 1, time: '1', channel: 'general' };
    useChatStore.getState().addMessage(msg);
    useChatStore.getState().bookmarkMessage(1, true);
    expect(useChatStore.getState().messages[0].bookmarked).toBe(true);
    useChatStore.getState().bookmarkMessage(1, false);
    expect(useChatStore.getState().messages[0].bookmarked).toBe(false);
  });

  // Sidebar panel management
  it('sets and clears sidebar panel', () => {
    useChatStore.getState().setSidebarPanel('settings');
    expect(useChatStore.getState().sidebarPanel).toBe('settings');
    useChatStore.getState().setSidebarPanel(null);
    expect(useChatStore.getState().sidebarPanel).toBeNull();
  });

  // Reply management
  it('sets and clears reply target', () => {
    const msg = { id: 1, uid: 't', sender: 'user', text: 'test', type: 'chat' as const, timestamp: 1, time: '1', channel: 'general' };
    useChatStore.getState().setReplyTo(msg);
    expect(useChatStore.getState().replyTo?.id).toBe(1);
    useChatStore.getState().setReplyTo(null);
    expect(useChatStore.getState().replyTo).toBeNull();
  });

  // Chat scroll state
  it('tracks chat at bottom state', () => {
    useChatStore.getState().setChatAtBottom(false);
    expect(useChatStore.getState().chatAtBottom).toBe(false);
    useChatStore.getState().setChatAtBottom(true);
    expect(useChatStore.getState().chatAtBottom).toBe(true);
  });

  // New message count
  it('tracks new message count', () => {
    useChatStore.getState().setNewMsgCount(5);
    expect(useChatStore.getState().newMsgCount).toBe(5);
    useChatStore.getState().setNewMsgCount(0);
    expect(useChatStore.getState().newMsgCount).toBe(0);
  });
});
