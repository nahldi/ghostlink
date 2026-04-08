import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentMessageView } from './ChatMessageViews';
import type { Attachment, Message, Settings } from '../../types';

vi.mock('../ChatWidget', () => ({ ChatWidget: () => null }));
vi.mock('../CodeBlock', () => ({ CodeBlock: () => null }));
vi.mock('../DecisionCard', () => ({ DecisionCard: () => null }));
vi.mock('../JobProposal', () => ({ JobProposal: () => null }));
vi.mock('../ProgressCard', () => ({ ProgressCard: () => null }));
vi.mock('../HandoffCard', () => ({ HandoffCard: () => null }));
vi.mock('../ApprovalCard', () => ({ ApprovalCard: () => null }));
vi.mock('../UrlPreview', () => ({ UrlPreviews: () => null }));
vi.mock('../GenerativeCard', () => ({ GenerativeCard: () => null }));
vi.mock('../ImageEditCard', () => ({ ImageEditCard: ({ edit }: { edit: { mode?: string; status?: string; prompt?: string } }) => <div>{`image-edit:${edit.mode}:${edit.status}:${edit.prompt}`}</div> }));
vi.mock('../AgentIcon', () => ({ AgentIcon: () => <div data-testid="agent-icon" /> }));
vi.mock('../StreamingText', () => ({ StreamingText: ({ text }: { text: string }) => <span>{text}</span> }));

const settings: Settings = {
  username: 'You',
  title: 'GhostLink',
  theme: 'dark',
  fontSize: 14,
  loopGuard: 4,
  notificationSounds: false,
  desktopNotifications: false,
  quietHoursStart: 22,
  quietHoursEnd: 8,
  debugMode: false,
  showStatsPanel: true,
  statsSections: { session: true, tokens: true, agents: true, activity: true },
};

const message: Message = {
  id: 1,
  uid: 'msg-1',
  sender: 'ned',
  text: 'media payload',
  type: 'chat',
  timestamp: 1,
  time: '1:00 PM',
  channel: 'general',
};

async function renderMessage({
  attachments = [],
  metadata = {},
}: {
  attachments?: Attachment[];
  metadata?: Record<string, unknown>;
}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AgentMessageView
        message={{ ...message, attachments, metadata }}
        settings={settings}
        timestampLabel="just now"
        metadata={metadata}
        attachments={attachments}
        displayText="media payload"
        collapsed={false}
        streaming={false}
        showMobileActions={false}
        isSelected={false}
        selectMode={false}
        agent={{ name: 'ned', base: 'codex', label: 'Ned', color: '#10a37f', state: 'active', slot: 1 }}
        agentColor="#10a37f"
        agents={[]}
        longPressHandlers={{}}
        reactionPicker={null}
        replyPreview={null}
        onStreamingComplete={() => {}}
        onToggleSelected={() => {}}
        onTogglePicker={() => {}}
        onReply={() => {}}
        onCopy={() => {}}
        onTogglePin={() => {}}
        onToggleBookmark={() => {}}
        onSelectForDelete={() => {}}
        onToggleCollapsed={() => {}}
        onToggleTTS={() => {}}
        setShowMobileActions={() => {}}
        ttsPlaying={false}
        renderReactionBar={() => null}
      />
    );
    await Promise.resolve();
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AgentMessageView media rendering', () => {
  it('renders inline video and audio players from attachments', async () => {
    const { container, root } = await renderMessage({
      attachments: [
        { name: 'clip.mp4', url: 'https://example.com/clip.mp4', type: 'video/mp4' },
        { name: 'track.mp3', url: 'https://example.com/track.mp3', type: 'audio/mpeg' },
      ],
    });

    expect(container.querySelector('video')).toBeTruthy();
    expect(container.querySelector('audio')).toBeTruthy();
    expect(container.textContent).toContain('clip.mp4');
    expect(container.textContent).toContain('track.mp3');

    await act(async () => root.unmount());
  });

  it('renders media task status inline in agent chat', async () => {
    const metadata = {
      media_task: {
        kind: 'video',
        status: 'rendering',
        progress_pct: 42,
        provider: 'runway',
        model: 'gen-4',
        cost_usd: 0.84,
        eta_seconds: 28,
      },
    };
    const { container, root } = await renderMessage({ metadata });

    expect(container.textContent).toContain('video task');
    expect(container.textContent).toContain('rendering');
    expect(container.textContent).toContain('42%');
    expect(container.textContent).toContain('runway');
    expect(container.textContent).toContain('gen-4');

    await act(async () => root.unmount());
  });

  it('renders completed media task output inline from metadata', async () => {
    const metadata = {
      media_task: {
        kind: 'video',
        status: 'completed',
        progress_pct: 100,
        artifact_path: 'https://example.com/final.mp4',
        thumbnail_url: 'https://example.com/final.jpg',
      },
    };
    const { container, root } = await renderMessage({ metadata });

    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.getAttribute('src')).toBe('https://example.com/final.mp4');

    await act(async () => root.unmount());
  });

  it('renders image edit state inline in agent chat', async () => {
    const metadata = {
      image_edit: {
        mode: 'inpainting',
        status: 'queued',
        prompt: 'Replace the sky with a storm front',
      },
    };
    const { container, root } = await renderMessage({ metadata });

    expect(container.textContent).toContain('image-edit:inpainting:queued:Replace the sky with a storm front');

    await act(async () => root.unmount());
  });

  it('renders media task failures inline for graceful degradation', async () => {
    const metadata = {
      media_task: {
        kind: 'music',
        status: 'failed',
        progress_pct: 0,
        error: 'No media provider configured for music generation',
      },
    };
    const { container, root } = await renderMessage({ metadata });

    expect(container.textContent).toContain('failed');
    expect(container.textContent).toContain('No media provider configured for music generation');

    await act(async () => root.unmount());
  });

  it('renders nested media metadata using mime-based kind inference', async () => {
    const metadata = {
      media: {
        status: 'completed',
        progress_pct: 100,
        mime_type: 'audio/mpeg',
        artifact_path: 'https://example.com/final.mp3',
      },
    };
    const { container, root } = await renderMessage({ metadata });

    const audio = container.querySelector('audio');
    expect(audio).toBeTruthy();
    expect(audio?.getAttribute('src')).toBe('https://example.com/final.mp3');

    await act(async () => root.unmount());
  });
});
