import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChatStore } from '../stores/chatStore';

// Test WebSocket event handling logic extracted from the hook
// We test the store actions that WebSocket events trigger, not the connection itself

describe('WebSocket event handling via store', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      agents: [],
      channels: [{ name: 'general', unread: 0 }],
      activeChannel: 'general',
    });
  });

  it('addMessage handles a valid message event', () => {
    const msg = {
      id: 1, uid: 'ws-1', sender: 'claude', text: 'response',
      type: 'chat' as const, timestamp: Date.now() / 1000,
      time: '12:00', channel: 'general',
    };
    useChatStore.getState().addMessage(msg);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].sender).toBe('claude');
  });

  it('appendToMessage handles token_stream events', () => {
    const msg = {
      id: 1, uid: 'ws-1', sender: 'claude', text: 'Hello',
      type: 'chat' as const, timestamp: Date.now() / 1000,
      time: '12:00', channel: 'general',
    };
    useChatStore.getState().addMessage(msg);
    useChatStore.getState().appendToMessage(1, ' world');
    useChatStore.getState().appendToMessage(1, '!');
    expect(useChatStore.getState().messages[0].text).toBe('Hello world!');
  });

  it('setAgents handles status events', () => {
    const agents = [
      { name: 'claude', base: 'claude', label: 'Claude', color: '#e8734a', state: 'active' as const, slot: 1 },
      { name: 'codex', base: 'codex', label: 'Codex', color: '#10a37f', state: 'idle' as const, slot: 2 },
    ];
    useChatStore.getState().setAgents(agents);
    expect(useChatStore.getState().agents).toHaveLength(2);
    expect(useChatStore.getState().agents[0].state).toBe('active');
  });

  it('handles pin events correctly', () => {
    const msg = {
      id: 1, uid: 'ws-1', sender: 'user', text: 'pin me',
      type: 'chat' as const, timestamp: 1, time: '1', channel: 'general',
    };
    useChatStore.getState().addMessage(msg);
    useChatStore.getState().pinMessage(1, true);
    expect(useChatStore.getState().messages[0].pinned).toBe(true);
  });

  it('handles delete events correctly', () => {
    const msg1 = { id: 1, uid: 'ws-1', sender: 'user', text: 'a', type: 'chat' as const, timestamp: 1, time: '1', channel: 'general' };
    const msg2 = { id: 2, uid: 'ws-2', sender: 'user', text: 'b', type: 'chat' as const, timestamp: 2, time: '2', channel: 'general' };
    useChatStore.getState().addMessage(msg1);
    useChatStore.getState().addMessage(msg2);
    useChatStore.getState().deleteMessages([1]);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].id).toBe(2);
  });

  it('handles reaction events correctly', () => {
    const msg = {
      id: 1, uid: 'ws-1', sender: 'user', text: 'react',
      type: 'chat' as const, timestamp: 1, time: '1', channel: 'general',
    };
    useChatStore.getState().addMessage(msg);
    useChatStore.getState().reactMessage(1, { '👍': ['user', 'claude'] });
    expect(useChatStore.getState().messages[0].reactions?.['👍']).toHaveLength(2);
  });

  it('channel updates preserve active channel', () => {
    const channels = [
      { name: 'general', unread: 0 },
      { name: 'dev', unread: 3 },
    ];
    useChatStore.getState().setChannels(channels);
    expect(useChatStore.getState().channels).toHaveLength(2);
    expect(useChatStore.getState().activeChannel).toBe('general');
  });

  it('incrementUnread only affects target channel', () => {
    useChatStore.getState().setChannels([
      { name: 'general', unread: 0 },
      { name: 'dev', unread: 0 },
    ]);
    useChatStore.getState().incrementUnread('dev');
    expect(useChatStore.getState().channels.find(c => c.name === 'dev')?.unread).toBe(1);
    expect(useChatStore.getState().channels.find(c => c.name === 'general')?.unread).toBe(0);
  });
});
