import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanModePanel } from './PlanModePanel';
import { useChatStore } from '../stores/chatStore';

const {
  getPlans,
  createPlan,
  approvePlan,
  rejectPlan,
  exportChannel,
  getPlanSettings,
  savePlanSettings,
  evaluatePlan,
  toastSpy,
} = vi.hoisted(() => ({
  getPlans: vi.fn(),
  createPlan: vi.fn(),
  approvePlan: vi.fn(),
  rejectPlan: vi.fn(),
  exportChannel: vi.fn(),
  getPlanSettings: vi.fn(),
  savePlanSettings: vi.fn(),
  evaluatePlan: vi.fn(),
  toastSpy: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    getPlans,
    createPlan,
    approvePlan,
    rejectPlan,
    exportChannel,
    getPlanSettings,
    savePlanSettings,
    evaluatePlan,
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
    root.render(<PlanModePanel onClose={() => {}} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

function changeField(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('PlanModePanel', () => {
  beforeEach(() => {
    getPlans.mockReset();
    createPlan.mockReset();
    approvePlan.mockReset();
    rejectPlan.mockReset();
    exportChannel.mockReset();
    getPlanSettings.mockReset();
    savePlanSettings.mockReset();
    evaluatePlan.mockReset();
    toastSpy.mockReset();

    getPlans.mockResolvedValue({
      plans: [
        {
          plan_id: 'plan-1',
          agent_name: 'ned',
          channel: 'general',
          prompt: 'Refactor the plan panel.',
          status: 'pending_approval',
          steps: ['Review request', 'Implement change'],
          files: ['frontend/src/components/PlanModePanel.tsx'],
          estimated_tokens: 600,
          estimated_cost_usd: 0.12,
          estimated_seconds: 90,
          decision_note: '',
          created_at: 1,
          updated_at: 1,
        },
      ],
    });
    getPlanSettings.mockResolvedValue({ plan_mode_enabled: true, auto_threshold_usd: 0.25 });

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

  it('renders plan history and allows approval', async () => {
    approvePlan.mockResolvedValue({
      plan_id: 'plan-1',
      agent_name: 'ned',
      channel: 'general',
      prompt: 'Refactor the plan panel.',
      status: 'approved',
      steps: ['Review request', 'Implement change'],
      files: ['frontend/src/components/PlanModePanel.tsx'],
      estimated_tokens: 600,
      estimated_cost_usd: 0.12,
      estimated_seconds: 90,
      decision_note: '',
      created_at: 1,
      updated_at: 2,
    });

    const { container, root } = await renderPanel();

    expect(container.textContent).toContain('Plan history');
    expect(container.textContent).toContain('Refactor the plan panel.');
    expect(container.textContent).toContain('pending approval');

    const approveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Approve'));
    expect(approveButton).toBeTruthy();

    await act(async () => {
      approveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(approvePlan).toHaveBeenCalledWith('plan-1');
    expect(toastSpy).toHaveBeenCalledWith('Plan approved in chat', 'info');

    await act(async () => root.unmount());
  });

  it('creates a plan and evaluates the auto-plan threshold', async () => {
    createPlan.mockResolvedValue({
      plan_id: 'plan-2',
      agent_name: 'ned',
      channel: 'general',
      prompt: 'Add markdown export UI',
      status: 'pending_approval',
      steps: ['Review request'],
      files: ['frontend/src/lib/api.ts'],
      estimated_tokens: 500,
      estimated_cost_usd: 0.1,
      estimated_seconds: 70,
      created_at: 1,
      updated_at: 1,
    });
    evaluatePlan.mockResolvedValue({
      requires_plan: true,
      reason: 'estimated cost exceeds threshold',
      settings: { plan_mode_enabled: true, auto_threshold_usd: 0.25 },
      auto_threshold_usd: 0.25,
      estimated_cost_usd: 0.4,
      estimated_tokens: 1200,
      estimated_seconds: 180,
      steps: ['Review request'],
      files: ['frontend/src/lib/api.ts'],
    });
    savePlanSettings.mockResolvedValue({ plan_mode_enabled: true, auto_threshold_usd: 0.5 });

    const { container, root } = await renderPanel();
    const textareas = Array.from(container.querySelectorAll('textarea'));
    const promptArea = textareas.find((node) => node.getAttribute('placeholder')?.includes('Describe the change'));
    const filesArea = textareas.find((node) => node.getAttribute('placeholder')?.includes('frontend/src/components/PlanModePanel.tsx'));
    const thresholdInput = container.querySelector('input[aria-label="Auto plan threshold"]') as HTMLInputElement | null;
    const buttons = Array.from(container.querySelectorAll('button'));
    const createButton = buttons.find((button) => button.textContent?.includes('Create approval request'));
    const evaluateButton = buttons.find((button) => button.textContent?.includes('Evaluate'));
    const saveThresholdButton = buttons.find((button) => button.textContent?.includes('Save threshold'));

    expect(promptArea).toBeTruthy();
    expect(filesArea).toBeTruthy();
    expect(thresholdInput).toBeTruthy();
    expect(createButton).toBeTruthy();
    expect(evaluateButton).toBeTruthy();
    expect(saveThresholdButton).toBeTruthy();

    await act(async () => {
      changeField(promptArea as HTMLTextAreaElement, 'Add markdown export UI');
      changeField(filesArea as HTMLTextAreaElement, 'frontend/src/lib/api.ts');
      changeField(thresholdInput as HTMLInputElement, '0.5');
    });

    await act(async () => {
      evaluateButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(evaluatePlan).toHaveBeenCalledWith({
      prompt: 'Add markdown export UI',
      files: ['frontend/src/lib/api.ts'],
    });
    expect(container.textContent).toContain('requires plan');

    await act(async () => {
      saveThresholdButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(savePlanSettings).toHaveBeenCalledWith({ plan_mode_enabled: true, auto_threshold_usd: 0.5 });

    await act(async () => {
      createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(createPlan).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'general',
      prompt: 'Add markdown export UI',
      files: ['frontend/src/lib/api.ts'],
      cost_threshold_usd: undefined,
    }));

    await act(async () => root.unmount());
  });

  it('supports escape-to-close and retries failed plan loads', async () => {
    const onClose = vi.fn();
    getPlans.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce({ plans: [] });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<PlanModePanel onClose={onClose} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const dialog = container.querySelector('[role="dialog"]') as HTMLDivElement | null;
    expect(dialog).toBeTruthy();
    expect(container.textContent).toContain('Could not load plan history');

    await act(async () => {
      dialog!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    const retryButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Retry loading plans'));
    expect(retryButton).toBeTruthy();

    await act(async () => {
      retryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getPlans).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('No plans match this view');

    await act(async () => root.unmount());
  });
});
