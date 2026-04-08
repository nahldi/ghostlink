import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductizationPanel } from './ProductizationPanel';

const {
  getProductizationAssets,
  promoteProductizationAssetVersion,
  rollbackProductizationAssetVersion,
  toastSpy,
} = vi.hoisted(() => ({
  getProductizationAssets: vi.fn(),
  promoteProductizationAssetVersion: vi.fn(),
  rollbackProductizationAssetVersion: vi.fn(),
  toastSpy: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    getProductizationAssets,
    promoteProductizationAssetVersion,
    rollbackProductizationAssetVersion,
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
    root.render(<ProductizationPanel />);
    await Promise.resolve();
  });
  return { container, root };
}

describe('ProductizationPanel', () => {
  beforeEach(() => {
    getProductizationAssets.mockReset();
    promoteProductizationAssetVersion.mockReset();
    rollbackProductizationAssetVersion.mockReset();
    toastSpy.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders rollout channels, template state, health, and deprecation truth', async () => {
    getProductizationAssets.mockResolvedValue({
      assets: [
        {
          asset_id: 'profile-reviewer',
          kind: 'profile',
          name: 'Reviewer',
          description: 'Strict review profile',
          is_template: true,
          versions: [
            {
              version: '2.1.0',
              channel: 'beta',
              is_current: true,
              changelog: 'Adds stricter security review.',
              policy_status: 'awaiting_approval',
              compatibility: {
                min_platform_version: '5.7.2',
                required_capabilities: ['policy_approval'],
              },
              health: {
                error_rate: 0.03,
                avg_cost_usd: 0.18,
                eval_score: 0.92,
                active_installs: 4,
              },
            },
            {
              version: '2.0.0',
              channel: 'stable',
              deprecated: true,
              deprecation_note: 'Security issue in old rule pack.',
              migration_target: '2.1.0',
            },
          ],
        },
      ],
    });

    const { container, root } = await renderPanel();

    expect(container.textContent).toContain('Versioned Assets');
    expect(container.textContent).toContain('Hot Versions');
    expect(container.textContent).toContain('Assets');
    expect(container.textContent).toContain('Reviewer');
    expect(container.textContent).toContain('template');
    expect(container.textContent).toContain('beta');
    expect(container.textContent).toContain('Promotion to stable is policy-gated.');
    expect(container.textContent).toContain('Current state: awaiting_approval.');
    expect(container.textContent).toContain('Security issue in old rule pack.');
    expect(container.textContent).toContain('min platform 5.7.2');
    expect(container.textContent).toContain('errors 3%');
    expect(container.textContent).toContain('cost $0.18');

    await act(async () => root.unmount());
  });

  it('promotes and rolls back a version through the frontend contract', async () => {
    getProductizationAssets.mockResolvedValue({
      assets: [
        {
          asset_id: 'profile-1',
          kind: 'profile',
          name: 'Reviewer',
          versions: [
            { version: '1.4.0', channel: 'beta', is_current: true, health: {} },
            { version: '1.3.0', channel: 'stable', health: {} },
          ],
        },
      ],
    });
    promoteProductizationAssetVersion.mockResolvedValue({ ok: true });
    rollbackProductizationAssetVersion.mockResolvedValue({ ok: true });

    const { container, root } = await renderPanel();
    const buttons = Array.from(container.querySelectorAll('button'));
    const promoteButton = buttons.find((button) => button.textContent?.includes('Promote to stable'));
    const rollbackButton = buttons.find((button) => button.textContent?.includes('Roll back'));

    expect(promoteButton).toBeTruthy();
    expect(rollbackButton).toBeTruthy();

    await act(async () => {
      promoteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(promoteProductizationAssetVersion).toHaveBeenCalledWith('profile', 'profile-1', '1.4.0', 'stable');
    expect(toastSpy).toHaveBeenCalledWith('Reviewer 1.4.0 promoted to stable', 'success');

    await act(async () => {
      rollbackButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(rollbackProductizationAssetVersion).toHaveBeenCalledWith('profile', 'profile-1', '1.3.0');
    expect(toastSpy).toHaveBeenCalledWith('Rolled back Reviewer to 1.3.0', 'info');

    await act(async () => root.unmount());
  });

  it('offers skill rollback once the backend path is live', async () => {
    getProductizationAssets.mockResolvedValue({
      assets: [
        {
          asset_id: 'skill-rollback-gap',
          kind: 'skill',
          name: 'Task Router',
          versions: [
            { version: '1.2.0', channel: 'beta', is_current: true, health: {} },
            { version: '1.1.0', channel: 'stable', health: {} },
          ],
        },
      ],
    });
    rollbackProductizationAssetVersion.mockResolvedValue({ ok: true });

    const { container, root } = await renderPanel();

    const rollbackButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Roll back'));
    expect(rollbackButton).toBeTruthy();

    await act(async () => {
      rollbackButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(rollbackProductizationAssetVersion).toHaveBeenCalledWith('skill', 'skill-rollback-gap', '1.1.0');
    expect(toastSpy).toHaveBeenCalledWith('Rolled back Task Router to 1.1.0', 'info');

    await act(async () => root.unmount());
  });
});
