import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A2APanel } from './A2APanel';
import { useChatStore } from '../stores/chatStore';

const {
  getA2AAgentCard,
  updateA2AAgentCard,
  discoverA2A,
  delegateA2ATask,
  refreshA2ATask,
  toastSpy,
} = vi.hoisted(() => ({
  getA2AAgentCard: vi.fn(),
  updateA2AAgentCard: vi.fn(),
  discoverA2A: vi.fn(),
  delegateA2ATask: vi.fn(),
  refreshA2ATask: vi.fn(),
  toastSpy: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    getA2AAgentCard,
    updateA2AAgentCard,
    discoverA2A,
    delegateA2ATask,
    refreshA2ATask,
  },
}));

vi.mock('./Toast', () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
}));

async function renderPanel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<A2APanel />);
    await Promise.resolve();
  });
  return { container, root };
}

function changeField(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  getA2AAgentCard.mockReset();
  updateA2AAgentCard.mockReset();
  discoverA2A.mockReset();
  delegateA2ATask.mockReset();
  refreshA2ATask.mockReset();
  toastSpy.mockReset();
  getA2AAgentCard.mockResolvedValue({
    name: 'GhostLink Local',
    description: 'Local node',
    url: 'https://ghostlink.local',
    version: '1.0',
    auth_mode: 'api_key',
    skills: ['analysis'],
    capabilities: ['delegate'],
    default_input_modes: ['text'],
    default_output_modes: ['text'],
  });
  useChatStore.setState({
    activeChannel: 'general',
    agents: [
      { name: 'ned', base: 'codex', label: 'Ned', color: '#10a37f', state: 'active', slot: 1 },
    ],
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('A2APanel', () => {
  it('renders discovered remote agents and delegates to the selected card', async () => {
    discoverA2A.mockResolvedValue({
      source_url: 'https://remote.example.com/.well-known/agent-card.json',
      agents: [
        {
          agent_id: 'remote-1',
          name: 'Remote Planner',
          description: 'Cross-platform planner',
          url: 'https://remote.example.com/a2a',
          auth_mode: 'api_key',
          skills: ['planning'],
          capabilities: ['delegate'],
        },
      ],
    });
    delegateA2ATask.mockResolvedValue({ ok: true, task: { task_id: 'task-a2a-1' } });

    const { container, root } = await renderPanel();
    const inputs = Array.from(container.querySelectorAll('input'));
    const discoveryInput = inputs.find((input) => input.getAttribute('placeholder')?.includes('.well-known/agent-card.json'));
    const taskTitleInput = inputs.find((input) => input.getAttribute('placeholder') === 'Delegated task title');
    const textareas = Array.from(container.querySelectorAll('textarea'));
    const taskPrompt = textareas.find((textarea) => textarea.getAttribute('placeholder') === 'What should the remote agent do?');
    const buttons = Array.from(container.querySelectorAll('button'));
    const discoverButton = buttons.find((button) => button.textContent?.includes('Discover'));
    const delegateButton = buttons.find((button) => button.textContent?.includes('Delegate task'));

    expect(discoveryInput).toBeTruthy();
    expect(taskTitleInput).toBeTruthy();
    expect(taskPrompt).toBeTruthy();
    expect(discoverButton).toBeTruthy();
    expect(delegateButton).toBeTruthy();

    await act(async () => {
      changeField(discoveryInput as HTMLInputElement, 'https://remote.example.com/.well-known/agent-card.json');
    });

    await act(async () => {
      discoverButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Remote Planner');
    expect(container.textContent).toContain('auth:api_key');
    expect(container.textContent).toContain('Probed https://remote.example.com/.well-known/agent-card.json');

    await act(async () => {
      changeField(taskTitleInput as HTMLInputElement, 'Cross-platform review');
      changeField(taskPrompt as HTMLTextAreaElement, 'Review the open PR and summarize risks.');
    });

    await act(async () => {
      delegateButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(delegateA2ATask).toHaveBeenCalledWith(expect.objectContaining({
      target_url: 'https://remote.example.com/a2a',
      remote_agent_id: 'remote-1',
      channel: 'general',
      title: 'Cross-platform review',
    }));
    expect(toastSpy).toHaveBeenCalledWith('A2A delegation queued', 'success');

    await act(async () => root.unmount());
  });

  it('saves the edited local agent card', async () => {
    updateA2AAgentCard.mockResolvedValue({ name: 'GhostLink Local' });

    const { container, root } = await renderPanel();
    const inputs = Array.from(container.querySelectorAll('input'));
    const nameInput = inputs.find((input) => input.getAttribute('placeholder') === 'Agent card name');
    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Save card'));

    expect(nameInput).toBeTruthy();
    expect(saveButton).toBeTruthy();

    await act(async () => {
      changeField(nameInput as HTMLInputElement, 'GhostLink Edge');
    });

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(updateA2AAgentCard).toHaveBeenCalledWith(expect.objectContaining({
      name: 'GhostLink Edge',
    }));

    await act(async () => root.unmount());
  });

  it('shows the local published agent-card url', async () => {
    const { container, root } = await renderPanel();

    expect(container.textContent).toContain('Published at');
    expect(container.textContent).toContain('/.well-known/agent-card.json');
    expect(container.textContent).toContain('auth:api_key');

    await act(async () => root.unmount());
  });

  it('shows local A2A task status from the unified task store', async () => {
    refreshA2ATask.mockResolvedValue({
      id: 1,
      task_id: 'task-a2a-2',
      source_type: 'a2a',
      source_ref: 'remote-task-77',
      title: 'Remote design critique',
      description: '',
      status: 'completed',
      agent_name: 'ned',
      channel: 'general',
      priority: 1,
      progress_pct: 100,
      progress_step: 'completed',
      progress_total: 4,
      progress_data: {
        steps: [
          { label: 'discover', status: 'done' },
          { label: 'delegate', status: 'done' },
          { label: 'stream', status: 'done' },
        ],
      },
      created_by: 'You',
      created_at: 1,
      updated_at: 3,
      metadata: {},
    });

    useChatStore.setState({
      activeChannel: 'general',
      tasks: [
        {
          id: 1,
          task_id: 'task-a2a-2',
          source_type: 'a2a',
          source_ref: 'remote-task-77',
          title: 'Remote design critique',
          description: '',
          status: 'running',
          agent_name: 'ned',
          channel: 'general',
          priority: 1,
          progress_pct: 50,
          progress_step: 'waiting for remote summary',
          progress_total: 4,
          progress_data: {
            steps: [
              { label: 'discover', status: 'done' },
              { label: 'delegate', status: 'active' },
              { label: 'stream', status: 'pending' },
            ],
          },
          created_by: 'You',
          created_at: 1,
          updated_at: 2,
          metadata: {},
        },
      ],
    });

    const { container, root } = await renderPanel();

    expect(container.textContent).toContain('A2A Task Status');
    expect(container.textContent).toContain('Remote design critique');
    expect(container.textContent).toContain('remote remote-task-77');
    expect(container.textContent).toContain('waiting for remote summary');
    expect(container.textContent).toContain('discover');
    expect(container.textContent).toContain('delegate');
    expect(container.textContent).toContain('stream');

    const refreshButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Refresh remote'));
    expect(refreshButton).toBeTruthy();

    await act(async () => {
      refreshButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(refreshA2ATask).toHaveBeenCalledWith('task-a2a-2');
    expect(toastSpy).toHaveBeenCalledWith('A2A task completed', 'info');

    await act(async () => root.unmount());
  });
});
