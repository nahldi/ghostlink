import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentInfoPanel } from './AgentInfoPanel';

const apiMock = vi.hoisted(() => ({
  getAgentSkills: vi.fn(),
  getAgentEffectiveState: vi.fn(),
  getProfiles: vi.fn(),
  spawnAgent: vi.fn(),
  killAgent: vi.fn(),
  getStatus: vi.fn(),
  pauseAgent: vi.fn(),
  resumeAgent: vi.fn(),
  openTerminal: vi.fn(),
}));

const storeState = vi.hoisted(() => ({
  setAgents: vi.fn(),
  setProfileManagerOpen: vi.fn(),
  messages: [],
}));

vi.mock('../lib/api', () => ({
  api: apiMock,
}));

vi.mock('../stores/chatStore', () => ({
  useChatStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock('./AgentIcon', () => ({
  AgentIcon: ({ base }: { base: string }) => <span>{base}</span>,
}));

vi.mock('./Toast', () => ({
  toast: vi.fn(),
}));

vi.mock('./EffectiveStateViewer', () => ({
  EffectiveStateViewer: () => <div>effective-state-viewer</div>,
}));

const agent = {
  name: 'ned',
  label: 'Ned',
  base: 'codex',
  color: '#10a37f',
  state: 'active',
  slot: 1,
  drift_detected: true,
} as const;

async function renderPanel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AgentInfoPanel agent={agent} onClose={() => undefined} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function clickByText(container: HTMLElement, text: string) {
  const target = Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.includes(text));
  if (!target) throw new Error(`Button not found: ${text}`);
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AgentInfoPanel', () => {
  beforeEach(() => {
    apiMock.getAgentSkills.mockReset();
    apiMock.getAgentEffectiveState.mockReset();
    apiMock.getProfiles.mockReset();
    apiMock.spawnAgent.mockReset();
    apiMock.killAgent.mockReset();
    apiMock.getStatus.mockReset();
    apiMock.pauseAgent.mockReset();
    apiMock.resumeAgent.mockReset();
    apiMock.openTerminal.mockReset();
    storeState.setAgents.mockReset();
    storeState.setProfileManagerOpen.mockReset();
    apiMock.getAgentEffectiveState.mockResolvedValue({
      agent_id: 'agent-1',
      profile_id: 'profile-1',
      profile_name: 'Frontend',
      drift_detected: true,
      drift_score: 0.83,
      drift_reason: 'identity reinforcement overdue',
      reinforcement_pending: true,
      reinforcement_count: 4,
      last_reinforcement_at: 1712500000,
    });
  });

  it('shows richer drift and reinforcement metadata on the identity tab', async () => {
    const view = await renderPanel();

    await clickByText(view.container, 'Identity');
    const text = view.container.textContent || '';

    expect(text).toContain('83%');
    expect(text).toContain('Pending');
    expect(text).toContain('4');
    expect(text).toContain('identity reinforcement overdue');

    await view.cleanup();
  });
});
