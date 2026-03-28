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
});
