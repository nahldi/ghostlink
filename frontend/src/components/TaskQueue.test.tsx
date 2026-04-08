import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQueue } from './TaskQueue';
import { useChatStore } from '../stores/chatStore';

const {
  getTasks,
  cancelTask,
  pauseTask,
  resumeTask,
  createTask,
  toastSpy,
} = vi.hoisted(() => ({
  getTasks: vi.fn(),
  cancelTask: vi.fn(),
  pauseTask: vi.fn(),
  resumeTask: vi.fn(),
  createTask: vi.fn(),
  toastSpy: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    getTasks,
    cancelTask,
    pauseTask,
    resumeTask,
    createTask,
  },
}));

vi.mock('./Toast', () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
}));

async function renderQueue() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TaskQueue agent={{ name: 'ned', base: 'codex', label: 'Ned', color: '#10a37f', state: 'active', slot: 1 }} />);
    await Promise.resolve();
  });
  return { container, root };
}

beforeEach(() => {
  getTasks.mockReset();
  cancelTask.mockReset();
  pauseTask.mockReset();
  resumeTask.mockReset();
  createTask.mockReset();
  toastSpy.mockReset();
  getTasks.mockResolvedValue({
    tasks: [
      {
        id: 1,
        task_id: 'task-a2a-queue-1',
        source_type: 'a2a',
        source_ref: 'remote-task-12',
        title: 'Remote synthesis',
        description: 'Ask the remote agent to synthesize findings.',
        status: 'running',
        agent_name: 'ned',
        channel: 'general',
        priority: 1,
        progress_pct: 50,
        progress_step: 'awaiting remote result',
        progress_total: 4,
        progress_data: {},
        created_by: 'You',
        created_at: 1,
        updated_at: 2,
        metadata: {
          background_state: 'running',
          pid: 4321,
          output_log: 'C:/ghostlink/background/task-a2a-queue-1.log',
          cancel_requested: true,
          worktree_path: 'C:/ghostlink/worktrees/ned-task-a2a-queue-1',
        },
      },
    ],
  });
  useChatStore.setState({
    activeChannel: 'general',
    tasks: [],
    settings: { ...useChatStore.getState().settings, username: 'You' },
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TaskQueue', () => {
  it('shows remote task ids for a2a-backed tasks', async () => {
    const { container, root } = await renderQueue();

    expect(container.textContent).toContain('Remote synthesis');
    expect(container.textContent).toContain('remote remote-task-12');
    expect(container.textContent).toContain('awaiting remote result');
    expect(container.textContent).toContain('exec running');
    expect(container.textContent).toContain('pid 4321');
    expect(container.textContent).toContain('cancel requested');
    expect(container.textContent).toContain('worktree ned-task-a2a-queue-1');
    expect(container.textContent).toContain('log ready');

    await act(async () => root.unmount());
  });
});
