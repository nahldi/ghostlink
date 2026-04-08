import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMessage } from './ChatMessage';
import { useChatStore } from '../stores/chatStore';
import type { Attachment, Message } from '../types';

const agentViewSpy = vi.fn();
const userViewSpy = vi.fn();

vi.mock('./Toast', () => ({ toast: vi.fn() }));
vi.mock('./chat-message/mentionColorMap', () => ({
  setMentionColorMap: vi.fn(),
}));
vi.mock('../hooks/useLongPress', () => ({
  useLongPress: () => ({}),
}));
vi.mock('../lib/api', () => ({
  api: {
    reactToMessage: vi.fn(),
    pinMessage: vi.fn(),
    bookmarkMessage: vi.fn(),
    editMessage: vi.fn(),
    textToSpeech: vi.fn(),
  },
}));
vi.mock('./chat-message/ChatMessageViews', () => ({
  AgentMessageView: (props: { attachments: Attachment[] }) => {
    agentViewSpy(props);
    return <div>agent-view</div>;
  },
  UserMessageView: (props: { attachments: Attachment[] }) => {
    userViewSpy(props);
    return <div>user-view</div>;
  },
}));

async function renderMessage(message: Message) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ChatMessage message={message} />);
    await Promise.resolve();
  });
  return { root, container };
}

afterEach(() => {
  document.body.innerHTML = '';
  agentViewSpy.mockReset();
  userViewSpy.mockReset();
});

describe('ChatMessage artifact attachment synthesis', () => {
  it('renders approval_request messages as a dedicated approval card', async () => {
    useChatStore.setState({
      agents: [{ name: 'ned', base: 'codex', label: 'Ned', color: '#10a37f', state: 'active', slot: 1 }],
      settings: { ...useChatStore.getState().settings, username: 'You' },
    });

    const message: Message = {
      id: 99,
      uid: 'msg-approval',
      sender: 'system',
      text: 'Plan requested for ned: approval needed before execution.',
      type: 'approval_request',
      timestamp: 1,
      time: '1:05 PM',
      channel: 'general',
      metadata: {
        plan_id: 'abcdef123456',
        estimated_cost_usd: 0.12,
        estimated_tokens: 600,
        estimated_seconds: 90,
      },
    };

    const { root, container } = await renderMessage(message);

    expect(container.textContent).toContain('Approval request');
    expect(container.textContent).toContain('approval needed before execution');
    expect(container.textContent).toContain('plan abcdef12');
    expect(container.textContent).toContain('$0.12');
    expect(agentViewSpy).not.toHaveBeenCalled();
    expect(userViewSpy).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('derives an attachment from top-level artifact metadata for agent messages', async () => {
    useChatStore.setState({
      agents: [{ name: 'ned', base: 'codex', label: 'Ned', color: '#10a37f', state: 'active', slot: 1 }],
      settings: { ...useChatStore.getState().settings, username: 'You' },
    });

    const message: Message = {
      id: 1,
      uid: 'msg-1',
      sender: 'ned',
      text: 'done',
      type: 'chat',
      timestamp: 1,
      time: '1:00 PM',
      channel: 'general',
      metadata: {
        artifact_path: 'https://example.com/final.mp4',
        artifact_type: 'video',
        mime_type: 'video/mp4',
      },
    };

    const { root } = await renderMessage(message);

    expect(agentViewSpy).toHaveBeenCalled();
    expect(agentViewSpy.mock.calls[0][0].attachments).toEqual([
      { name: 'final.mp4', url: 'https://example.com/final.mp4', type: 'video/mp4' },
    ]);

    await act(async () => root.unmount());
  });

  it('does not synthesize a duplicate top-level attachment when nested media metadata exists', async () => {
    useChatStore.setState({
      agents: [{ name: 'ned', base: 'codex', label: 'Ned', color: '#10a37f', state: 'active', slot: 1 }],
      settings: { ...useChatStore.getState().settings, username: 'You' },
    });

    const message: Message = {
      id: 2,
      uid: 'msg-2',
      sender: 'ned',
      text: 'done',
      type: 'chat',
      timestamp: 1,
      time: '1:01 PM',
      channel: 'general',
      metadata: {
        artifact_path: 'https://example.com/final.mp4',
        artifact_type: 'video',
        mime_type: 'video/mp4',
        media_task: {
          artifact_path: 'https://example.com/final.mp4',
          mime_type: 'video/mp4',
        },
      },
    };

    const { root } = await renderMessage(message);

    expect(agentViewSpy).toHaveBeenCalled();
    expect(agentViewSpy.mock.calls[0][0].attachments).toEqual([]);

    await act(async () => root.unmount());
  });
});
