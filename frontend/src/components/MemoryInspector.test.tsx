import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryInspector } from './MemoryInspector';

const apiMock = vi.hoisted(() => ({
  getAgentSoul: vi.fn(),
  getAgentNotes: vi.fn(),
  getAgentMemories: vi.fn(),
  setAgentSoul: vi.fn(),
  setAgentNotes: vi.fn(),
  promoteAgentMemory: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: apiMock,
}));

vi.mock('./Toast', () => ({
  toast: vi.fn(),
}));

const agent = {
  name: 'ned',
  label: 'Ned',
  base: 'codex',
  color: '#10a37f',
  state: 'active',
  drift_detected: false,
} as const;

async function renderInspector() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MemoryInspector agent={agent} />);
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
  });
}

describe('MemoryInspector', () => {
  beforeEach(() => {
    apiMock.getAgentSoul.mockReset();
    apiMock.getAgentNotes.mockReset();
    apiMock.getAgentMemories.mockReset();
    apiMock.setAgentSoul.mockReset();
    apiMock.setAgentNotes.mockReset();
    apiMock.promoteAgentMemory.mockReset();
  });

  it('renders legacy memory payloads as workspace entries', async () => {
    apiMock.getAgentSoul.mockResolvedValue({ soul: 'Core identity' });
    apiMock.getAgentNotes.mockResolvedValue({ notes: 'Workspace notes' });
    apiMock.getAgentMemories.mockResolvedValue({
      memories: [{ key: 'build-instructions', layer: 'workspace', size: 120 }],
      observations: [],
      conflicts: [],
      available_tags: [],
    });

    const view = await renderInspector();

    expect(view.container.textContent).toContain('build-instructions');
    expect(view.container.textContent).toContain('Legacy memory entry');
    expect(view.container.textContent).toContain('Workspace');

    await view.cleanup();
  });

  it('shows drift and conflict state from the stratified payload', async () => {
    apiMock.getAgentSoul.mockResolvedValue({ soul: 'Core identity' });
    apiMock.getAgentNotes.mockResolvedValue({ notes: 'Workspace notes' });
    apiMock.getAgentMemories.mockResolvedValue({
      memories: [{ key: 'core_identity', layer: 'identity', content: 'You are Ned', importance: 1, tags: ['identity'] }],
      observations: [{ key: 'repeat-diff', layer: 'observation', content: 'git diff before merge' }],
      conflicts: [{ key: 'ownership', summary: 'conflicting memory', agents: ['ned', 'tyson'] }],
      drift: { detected: true, score: 0.72, reason: 'missed identity boundary' },
      available_tags: ['identity'],
      shared_count: 2,
    });

    const view = await renderInspector();

    expect(view.container.textContent).toContain('Identity drift flagged');
    expect(view.container.textContent).toContain('missed identity boundary');
    expect(view.container.textContent).toContain('conflicting memory');
    expect(view.container.textContent).toContain('2 shared items');

    await view.cleanup();
  });

  it('filters entries by layer and tag', async () => {
    apiMock.getAgentSoul.mockResolvedValue({ soul: 'Core identity' });
    apiMock.getAgentNotes.mockResolvedValue({ notes: 'Workspace notes' });
    apiMock.getAgentMemories.mockResolvedValue({
      memories: [
        { key: 'core_identity', layer: 'identity', content: 'You are Ned', tags: ['identity'] },
        { key: 'repo-layout', layer: 'workspace', content: 'frontend owns ui', tags: ['repo'] },
      ],
      observations: [{ key: 'repeat-diff', layer: 'observation', content: 'git diff before merge', tags: ['repo'] }],
      conflicts: [],
      available_tags: ['identity', 'repo'],
    });

    const view = await renderInspector();

    await clickByText(view.container, 'Identity');
    expect(view.container.textContent).toContain('core_identity');
    expect(view.container.textContent).not.toContain('repo-layout');

    await clickByText(view.container, 'All layers');
    await clickByText(view.container, '#repo');
    expect(view.container.textContent).not.toContain('core_identity');
    expect(view.container.textContent).toContain('repo-layout');
    expect(view.container.textContent).toContain('repeat-diff');

    await view.cleanup();
  });

  it('surfaces weighted-recall metadata and orders stronger memories first', async () => {
    apiMock.getAgentSoul.mockResolvedValue({ soul: 'Core identity' });
    apiMock.getAgentNotes.mockResolvedValue({ notes: 'Workspace notes' });
    apiMock.getAgentMemories.mockResolvedValue({
      memories: [
        { key: 'low-signal', layer: 'workspace', content: 'older note', importance: 0.2, access_count: 1, last_accessed: 10 },
        { key: 'high-signal', layer: 'workspace', content: 'important note', importance: 0.9, access_count: 7, last_accessed: 20 },
      ],
      observations: [],
      conflicts: [],
      available_tags: [],
    });

    const view = await renderInspector();
    const text = view.container.textContent || '';

    expect(text.indexOf('high-signal')).toBeLessThan(text.indexOf('low-signal'));
    expect(text).toContain('7 recalls');

    await view.cleanup();
  });

  it('shows truthful recall source labels when backend provides them', async () => {
    apiMock.getAgentSoul.mockResolvedValue({ soul: 'Core identity' });
    apiMock.getAgentNotes.mockResolvedValue({ notes: 'Workspace notes' });
    apiMock.getAgentMemories.mockResolvedValue({
      memories: [
        { key: 'repo-layout', layer: 'workspace', content: 'frontend owns ui', source: 'rag' },
        { key: 'identity-rule', layer: 'identity', content: 'You are Ned', source: 'memory' },
      ],
      observations: [],
      conflicts: [],
      available_tags: [],
    });

    const view = await renderInspector();

    expect(view.container.textContent).toContain('RAG recall');
    expect(view.container.textContent).toContain('memory recall');

    await view.cleanup();
  });

  it('promotes session memory into workspace through the new endpoint', async () => {
    apiMock.getAgentSoul.mockResolvedValue({ soul: 'Core identity' });
    apiMock.getAgentNotes.mockResolvedValue({ notes: 'Workspace notes' });
    apiMock.getAgentMemories
      .mockResolvedValueOnce({
        memories: [{ key: 'session-note', layer: 'session', content: 'temporary note' }],
        observations: [],
        conflicts: [],
        available_tags: [],
      })
      .mockResolvedValueOnce({
        memories: [{ key: 'session-note', layer: 'workspace', content: 'temporary note', promoted: true }],
        observations: [],
        conflicts: [],
        available_tags: ['promoted'],
      });
    apiMock.promoteAgentMemory.mockResolvedValue({ ok: true });

    const view = await renderInspector();
    await clickByText(view.container, 'Promote to workspace');

    expect(apiMock.promoteAgentMemory).toHaveBeenCalledWith('ned', 'session-note', 'workspace');
    expect(view.container.textContent).toContain('promoted');

    await view.cleanup();
  });

  it('marks observational memory as derived runtime behavior', async () => {
    apiMock.getAgentSoul.mockResolvedValue({ soul: 'Core identity' });
    apiMock.getAgentNotes.mockResolvedValue({ notes: 'Workspace notes' });
    apiMock.getAgentMemories.mockResolvedValue({
      memories: [],
      observations: [{ key: 'tool-pattern', layer: 'observation', content: 'prefers git diff', tags: ['observational', 'tool_preference'] }],
      conflicts: [],
      available_tags: ['observational', 'tool_preference'],
    });

    const view = await renderInspector();

    expect(view.container.textContent).toContain('observed pattern');
    expect(view.container.textContent).toContain('Derived from repeated runtime behavior');
    expect(view.container.textContent).toContain('#observational');

    await view.cleanup();
  });

  it('refreshes memory state on demand', async () => {
    apiMock.getAgentSoul.mockResolvedValue({ soul: 'Core identity' });
    apiMock.getAgentNotes.mockResolvedValue({ notes: 'Workspace notes' });
    apiMock.getAgentMemories
      .mockResolvedValueOnce({
        memories: [{ key: 'stale-memory', layer: 'workspace', content: 'old state' }],
        observations: [],
        conflicts: [],
        available_tags: [],
      })
      .mockResolvedValueOnce({
        memories: [{ key: 'fresh-memory', layer: 'workspace', content: 'new state' }],
        observations: [],
        conflicts: [],
        available_tags: [],
      });

    const view = await renderInspector();
    expect(view.container.textContent).toContain('stale-memory');

    await clickByText(view.container, 'Refresh');

    expect(view.container.textContent).toContain('fresh-memory');
    expect(view.container.textContent).not.toContain('stale-memory');

    await view.cleanup();
  });
});
