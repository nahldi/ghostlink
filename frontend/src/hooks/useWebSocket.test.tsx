import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../stores/chatStore';
import { useWebSocket } from './useWebSocket';

const { toastMock, sendMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  sendMock: vi.fn(),
}));

type StateListener = (state: 'connected' | 'connecting' | 'disconnected') => void;
type MessageListener = (event: { data: string }) => void;

let latestMessageListener: MessageListener | null = null;
let latestStateListener: StateListener | null = null;

vi.mock('../components/Toast', () => ({
  toast: toastMock,
}));

vi.mock('../lib/remoteAccess', () => ({
  getRemoteAccessToken: vi.fn(() => null),
}));

vi.mock('../lib/sounds', () => ({
  SoundManager: { play: vi.fn() },
}));

vi.mock('../lib/api', () => ({
  api: {
    getStatus: vi.fn(async () => ({ agents: [] })),
    getMessages: vi.fn(async () => ({ messages: [] })),
    getAgentPresence: vi.fn(async () => null),
    getAgentBrowserState: vi.fn(async () => null),
    getAgentTerminalLive: vi.fn(async () => null),
    getAgentWorkspaceChanges: vi.fn(async () => ({ changes: [] })),
    getAgentReplay: vi.fn(async () => ({ events: [] })),
  },
}));

vi.mock('../lib/ws', () => ({
  WebSocketClient: class MockWebSocketClient {
    state: 'connected' | 'connecting' | 'disconnected' = 'disconnected';

    constructor(_url: string) {
      void _url;
    }

    subscribe(cb: MessageListener) {
      latestMessageListener = cb;
      return () => {
        if (latestMessageListener === cb) latestMessageListener = null;
      };
    }

    onStateChange(cb: StateListener) {
      latestStateListener = cb;
      return () => {
        if (latestStateListener === cb) latestStateListener = null;
      };
    }

    onReconnect() {
      return () => {};
    }

    connect() {
      this.state = 'connected';
      latestStateListener?.('connected');
    }

    disconnect() {
      this.state = 'disconnected';
      latestStateListener?.('disconnected');
    }

    send(payload: unknown) {
      sendMock(payload);
    }
  },
}));

function TestHarness() {
  useWebSocket();
  return null;
}

async function renderHook() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TestHarness />);
    await Promise.resolve();
  });
  return {
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function emit(event: unknown) {
  if (!latestMessageListener) throw new Error('WebSocket listener not ready');
  await act(async () => {
    latestMessageListener?.({ data: JSON.stringify(event) });
    await Promise.resolve();
  });
}

describe('useWebSocket', () => {
  beforeEach(() => {
    toastMock.mockReset();
    sendMock.mockReset();
    latestMessageListener = null;
    latestStateListener = null;
    useChatStore.setState({
      messages: [],
      agents: [{ name: 'ned', base: 'codex', label: 'Ned', color: '#10a37f', state: 'active', slot: 1, drift_detected: false }],
      channels: [{ name: 'general', unread: 0 }],
      activeChannel: 'general',
      settings: {
        ...useChatStore.getState().settings,
        username: 'You',
        notificationSounds: false,
        desktopNotifications: false,
      },
    });
  });

  it('surfaces memory_conflict events as warning toasts', async () => {
    const view = await renderHook();

    await emit({ type: 'memory_conflict', data: { key: 'repo-layout', agents: ['ned', 'tyson'] } });

    expect(toastMock).toHaveBeenCalledWith('Memory conflict: repo-layout (ned, tyson)', 'warning');

    await view.cleanup();
  });

  it('surfaces cache_alert events with hit rate and miss streak detail', async () => {
    const view = await renderHook();

    await emit({
      type: 'cache_alert',
      data: { provider: 'openai', cache_hit_rate: 0.42, consecutive_misses: 6 },
    });

    expect(toastMock).toHaveBeenCalledWith('Cache alert: openai | 42% hit rate | 6 miss streak', 'warning');

    await view.cleanup();
  });

  it('marks agents as drifted and raises a drift warning toast', async () => {
    const view = await renderHook();

    await emit({
      type: 'identity_drift',
      data: { agent: 'ned', reason: 'missed identity boundary' },
    });

    expect(useChatStore.getState().agents[0].drift_detected).toBe(true);
    expect(toastMock).toHaveBeenCalledWith('ned drift detected: missed identity boundary', 'warning');

    await view.cleanup();
  });

  it('sends workspace presence immediately after connect', async () => {
    const view = await renderHook();

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'workspace_presence',
      viewing: 'Channel: general',
      status: 'active',
      username: 'You',
    }));

    await view.cleanup();
  });

  it('updates workspace presence when document visibility changes', async () => {
    const view = await renderHook();
    sendMock.mockClear();

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'workspace_presence',
      status: 'away',
      viewing: 'Channel: general',
    }));

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });

    await view.cleanup();
  });
});

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
    expect(useChatStore.getState().channels.find((c) => c.name === 'dev')?.unread).toBe(1);
    expect(useChatStore.getState().channels.find((c) => c.name === 'general')?.unread).toBe(0);
  });
});
