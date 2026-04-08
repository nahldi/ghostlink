import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import type { ExecutionPlan, PlanEvaluation, PlanModeSettings } from '../types';
import { toast } from './Toast';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatSeconds(value: number) {
  if (value >= 60) return `${Math.round(value / 60)}m`;
  return `${value}s`;
}

function formatWhen(value?: number | null) {
  if (!value) return '';
  return new Date(value * 1000).toLocaleString();
}

export function PlanModePanel({ onClose }: { onClose: () => void }) {
  const activeChannel = useChatStore((s) => s.activeChannel);
  const agents = useChatStore((s) => s.agents);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [plans, setPlans] = useState<ExecutionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [filterAgentName, setFilterAgentName] = useState('');
  const [selectedAgentName, setSelectedAgentName] = useState('');
  const [settings, setSettings] = useState<PlanModeSettings>({ plan_mode_enabled: false, auto_threshold_usd: 0 });
  const [thresholdDraft, setThresholdDraft] = useState('0');
  const [evaluation, setEvaluation] = useState<PlanEvaluation | null>(null);
  const [prompt, setPrompt] = useState('');
  const [filesText, setFilesText] = useState('');
  const [costThreshold, setCostThreshold] = useState('0');

  const onlineAgents = useMemo(
    () => agents.filter((agent) => ['active', 'idle', 'thinking', 'paused'].includes(agent.state)),
    [agents],
  );

  const refreshPlans = async (nextStatus = statusFilter, nextAgent = filterAgentName) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.getPlans({
        channel: activeChannel,
        agent_name: nextAgent || undefined,
        status: nextStatus || undefined,
      });
      setPlans(result.plans);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plans');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel]);

  useEffect(() => {
    let cancelled = false;
    api.getPlanSettings()
      .then((result) => {
        if (cancelled) return;
        setSettings(result);
        setThresholdDraft(String(result.auto_threshold_usd ?? 0));
      })
      .catch(() => {
        if (!cancelled) toast('Plan settings failed to load', 'error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const parsedFiles = filesText.split('\n').map((line) => line.trim()).filter(Boolean);

  const handleSaveSettings = async () => {
    try {
      const next = await api.savePlanSettings({
        plan_mode_enabled: settings.plan_mode_enabled,
        auto_threshold_usd: Number(thresholdDraft) || 0,
      });
      setSettings(next);
      setThresholdDraft(String(next.auto_threshold_usd ?? 0));
      toast('Auto-plan settings saved', 'success');
    } catch {
      toast('Auto-plan settings failed to save', 'error');
    }
  };

  const handleEvaluate = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      toast('Plan prompt is required', 'error');
      return;
    }
    try {
      const result = await api.evaluatePlan({
        prompt: trimmedPrompt,
        files: parsedFiles,
      });
      setEvaluation(result);
      toast(result.requires_plan ? 'Plan review required' : 'Plan review not required', 'info');
    } catch {
      toast('Auto-plan evaluation failed', 'error');
    }
  };

  const handleCreatePlan = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      toast('Plan prompt is required', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const plan = await api.createPlan({
        agent_name: selectedAgentName || undefined,
        channel: activeChannel,
        prompt: trimmedPrompt,
        files: parsedFiles,
        cost_threshold_usd: Number(costThreshold) || undefined,
      });
      setPlans((current) => [plan, ...current.filter((item) => item.plan_id !== plan.plan_id)]);
      setPrompt('');
      setFilesText('');
      setEvaluation(null);
      toast('Plan request created in chat', 'success');
    } catch {
      toast('Plan creation failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecision = async (planId: string, action: 'approve' | 'reject') => {
    setBusyPlanId(`${planId}:${action}`);
    try {
      const plan = action === 'approve' ? await api.approvePlan(planId) : await api.rejectPlan(planId);
      setPlans((current) => current.map((item) => item.plan_id === plan.plan_id ? plan : item));
      toast(action === 'approve' ? 'Plan approved in chat' : 'Plan rejected in chat', 'info');
    } catch {
      toast(action === 'approve' ? 'Plan approval failed' : 'Plan rejection failed', 'error');
    } finally {
      setBusyPlanId('');
    }
  };

  const handleExport = async () => {
    try {
      const result = await api.exportChannel(activeChannel);
      const blob = new Blob([result.markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename || `${activeChannel}-export.md`;
      link.click();
      URL.revokeObjectURL(url);
      toast('Markdown export ready', 'success');
    } catch {
      toast('Markdown export failed', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        className="relative w-[760px] max-w-[94vw] max-h-[84vh] overflow-hidden rounded-2xl glass-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-mode-title"
        aria-describedby="plan-mode-description"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="flex items-center justify-between border-b border-outline-variant/10 px-5 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant/45">Plan Mode</div>
            <h2
              id="plan-mode-title"
              ref={headingRef}
              tabIndex={-1}
              className="mt-1 text-sm font-semibold text-on-surface outline-none"
            >
              #{activeChannel}
            </h2>
            <p id="plan-mode-description" className="sr-only">
              Review plan settings, create approval requests, and approve or reject plans for this channel.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleExport()}
              className="rounded-lg bg-surface-container-high px-3 py-1.5 text-[11px] font-medium text-on-surface-variant/65 hover:text-on-surface"
            >
              Export markdown
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-on-surface-variant/45 hover:bg-surface-container-high hover:text-on-surface"
              aria-label="Close plan mode"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        <div className="grid max-h-[calc(84vh-69px)] gap-0 overflow-hidden lg:grid-cols-[0.95fr,1.05fr]">
          <div className="border-r border-outline-variant/10 p-4 overflow-y-auto space-y-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/40">Create plan</div>
              <div className="mt-1 text-[10px] text-on-surface-variant/35">This writes a real approval request into chat, not a hidden draft.</div>
            </div>

            <div className="rounded-xl border border-outline-variant/10 bg-surface-container/15 p-3 space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/40">Auto-plan threshold</div>
              <label className="flex items-center justify-between gap-2 text-[10px] text-on-surface-variant/50">
                <span>Plan mode enabled</span>
                <input
                  type="checkbox"
                  checked={settings.plan_mode_enabled}
                  onChange={(event) => setSettings((current) => ({ ...current, plan_mode_enabled: event.target.checked }))}
                />
              </label>
              <input
                value={thresholdDraft}
                onChange={(event) => setThresholdDraft(event.target.value)}
                inputMode="decimal"
                className="w-full rounded-xl border border-outline-variant/10 bg-surface-container/25 px-3 py-2 text-[11px] text-on-surface outline-none"
                aria-label="Auto plan threshold"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => void handleSaveSettings()}
                  className="flex-1 rounded-lg bg-surface-container-high px-2.5 py-1.5 text-[10px] font-medium text-on-surface-variant/65 hover:text-on-surface"
                >
                  Save threshold
                </button>
                <button
                  onClick={() => void handleEvaluate()}
                  className="flex-1 rounded-lg bg-primary/15 px-2.5 py-1.5 text-[10px] font-medium text-primary hover:bg-primary/20"
                >
                  Evaluate
                </button>
              </div>
              {evaluation ? (
                <div className="rounded-lg border border-outline-variant/10 bg-surface-container/25 px-2.5 py-2 text-[9px] text-on-surface-variant/55">
                  <div>{evaluation.requires_plan ? 'requires plan' : 'no plan required'} · {evaluation.reason}</div>
                  <div className="mt-1">
                    {formatUsd(evaluation.estimated_cost_usd)} · {evaluation.estimated_tokens} tokens · {formatSeconds(evaluation.estimated_seconds)}
                  </div>
                </div>
              ) : null}
            </div>

            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-on-surface-variant/50">Agent</span>
              <select
                value={selectedAgentName}
                onChange={(event) => setSelectedAgentName(event.target.value)}
                className="w-full rounded-xl border border-outline-variant/10 bg-surface-container/25 px-3 py-2 text-[11px] text-on-surface outline-none"
                aria-label="Assign plan to agent"
              >
                <option value="">Unassigned</option>
                {onlineAgents.map((agent) => (
                  <option key={agent.name} value={agent.name}>{agent.label || agent.name}</option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-on-surface-variant/50">Prompt</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe the change before execution starts."
                rows={5}
                className="w-full rounded-xl border border-outline-variant/10 bg-surface-container/25 px-3 py-2 text-[11px] text-on-surface outline-none resize-none"
                aria-label="Plan prompt"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-on-surface-variant/50">Affected files</span>
              <textarea
                value={filesText}
                onChange={(event) => setFilesText(event.target.value)}
                placeholder={'frontend/src/components/PlanModePanel.tsx\nfrontend/src/lib/api.ts'}
                rows={4}
                className="w-full rounded-xl border border-outline-variant/10 bg-surface-container/25 px-3 py-2 text-[11px] text-on-surface outline-none resize-none"
                aria-label="Affected files"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-on-surface-variant/50">Cost threshold USD</span>
              <input
                value={costThreshold}
                onChange={(event) => setCostThreshold(event.target.value)}
                inputMode="decimal"
                className="w-full rounded-xl border border-outline-variant/10 bg-surface-container/25 px-3 py-2 text-[11px] text-on-surface outline-none"
                aria-label="Cost threshold USD"
              />
            </label>

            <button
              onClick={() => void handleCreatePlan()}
              disabled={submitting}
              className="w-full rounded-xl bg-primary/15 px-3 py-2 text-[11px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-45"
            >
              {submitting ? 'Creating plan...' : 'Create approval request'}
            </button>
          </div>

          <div className="p-4 overflow-y-auto space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/40">Plan history</div>
                <div className="mt-1 text-[10px] text-on-surface-variant/35">Backed by `GET /api/plans`, with approval outcomes also echoed into chat.</div>
              </div>
              <button
                onClick={() => void refreshPlans()}
                className="rounded-lg bg-surface-container-high px-2.5 py-1.5 text-[10px] font-medium text-on-surface-variant/60 hover:text-on-surface"
              >
                Refresh
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <select
                value={statusFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  setStatusFilter(value);
                  void refreshPlans(value, filterAgentName);
                }}
                className="rounded-xl border border-outline-variant/10 bg-surface-container/25 px-3 py-2 text-[11px] text-on-surface outline-none"
              >
                <option value="">All statuses</option>
                <option value="pending_approval">Pending approval</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <select
                value={filterAgentName}
                onChange={(event) => {
                  const value = event.target.value;
                  setFilterAgentName(value);
                  void refreshPlans(statusFilter, value);
                }}
                className="rounded-xl border border-outline-variant/10 bg-surface-container/25 px-3 py-2 text-[11px] text-on-surface outline-none"
              >
                <option value="">All agents</option>
                {onlineAgents.map((agent) => (
                  <option key={`filter-${agent.name}`} value={agent.name}>{agent.label || agent.name}</option>
                ))}
              </select>
            </div>

            {loading ? (
              <div className="space-y-2" aria-live="polite" aria-busy="true">
                <div className="text-[10px] text-on-surface-variant/35">Loading plans...</div>
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={`plan-skeleton-${index}`} className="rounded-xl border border-outline-variant/10 bg-surface-container/15 p-3 space-y-2">
                    <Skeleton height="0.75rem" width={`${55 + (index * 10)}%`} />
                    <Skeleton height="0.65rem" width={`${75 + (index * 5)}%`} />
                    <Skeleton height="0.65rem" width="90%" />
                    <Skeleton height="0.65rem" width="65%" />
                  </div>
                ))}
              </div>
            ) : null}
            {!loading && error ? (
              <div className="rounded-xl border border-red-400/20 bg-red-500/5 p-3" role="alert">
                <div className="text-[10px] font-semibold text-red-200/85">Could not load plan history</div>
                <div className="mt-1 text-[10px] text-red-300/80">{error}</div>
                <button
                  onClick={() => void refreshPlans()}
                  className="mt-3 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[10px] font-medium text-red-200/85 hover:bg-red-500/15"
                >
                  Retry loading plans
                </button>
              </div>
            ) : null}
            {!loading && !error && plans.length === 0 ? (
              <div className="rounded-xl border border-outline-variant/10 bg-surface-container/15 p-1">
                <EmptyState
                  icon="description"
                  title="No plans match this view"
                  description="Create an approval request or clear the filters to repopulate plan history."
                  action={
                    statusFilter || filterAgentName
                      ? {
                          label: 'Clear filters',
                          onClick: () => {
                            setStatusFilter('');
                            setFilterAgentName('');
                            void refreshPlans('', '');
                          },
                        }
                      : {
                          label: 'Refresh history',
                          onClick: () => void refreshPlans(),
                        }
                  }
                />
              </div>
            ) : null}

            {plans.map((plan) => (
              <div key={plan.plan_id} className="rounded-xl border border-outline-variant/10 bg-surface-container/15 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold text-on-surface">{plan.agent_name || 'Unassigned plan'}</div>
                    <div className="mt-1 text-[10px] text-on-surface-variant/40">
                      {plan.status.replace('_', ' ')}
                      {' · '}
                      {formatUsd(plan.estimated_cost_usd)}
                      {' · '}
                      {plan.estimated_tokens} tokens
                      {' · '}
                      {formatSeconds(plan.estimated_seconds)}
                    </div>
                  </div>
                  {plan.status === 'pending_approval' ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => void handleDecision(plan.plan_id, 'approve')}
                        disabled={busyPlanId === `${plan.plan_id}:approve`}
                        className="rounded-lg bg-primary/15 px-2 py-1 text-[9px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-40"
                        aria-label={`Approve plan ${plan.plan_id}`}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => void handleDecision(plan.plan_id, 'reject')}
                        disabled={busyPlanId === `${plan.plan_id}:reject`}
                        className="rounded-lg bg-red-500/10 px-2 py-1 text-[9px] font-semibold text-red-300 hover:bg-red-500/15 disabled:opacity-40"
                        aria-label={`Reject plan ${plan.plan_id}`}
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-2 text-[10px] text-on-surface-variant/58">{plan.prompt}</div>

                {plan.files.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {plan.files.map((file) => (
                      <span key={file} className="rounded bg-surface-container-high px-1.5 py-0.5 text-[9px] text-on-surface-variant/55">
                        {file}
                      </span>
                    ))}
                  </div>
                ) : null}

                <ol className="mt-2 space-y-1 text-[10px] text-on-surface-variant/45">
                  {plan.steps.map((step, index) => (
                    <li key={`${plan.plan_id}-${index}`}>{index + 1}. {step}</li>
                  ))}
                </ol>

                <div className="mt-2 text-[9px] text-on-surface-variant/35">
                  Requested {formatWhen(plan.created_at)}
                  {plan.decision_note ? ` · note: ${plan.decision_note}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
