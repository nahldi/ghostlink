import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import type { BudgetConfig, EvalGateCheck, EvalRunSummary, EvalResult, Provider, UsageEntry } from '../types';
import { toast } from './Toast';
import { CacheDiagnostics } from './CacheDiagnostics';
import { Section } from './settings/SettingsUI';

type ProviderStatus = Awaited<ReturnType<typeof api.getProviders>>;
type ProviderDraft = { apiKey: string; baseUrl: string; proxy: string; timeout: string; retries: string };

const EMPTY_DRAFT: ProviderDraft = { apiKey: '', baseUrl: '', proxy: '', timeout: '', retries: '' };

const CAP_LABELS: Record<string, string> = {
  chat: 'Chat',
  code: 'Code',
  image: 'Image',
  video: 'Video',
  tts: 'TTS',
  stt: 'STT',
  code_exec: 'Code Exec',
  embedding: 'Embeddings',
};

export function ProviderOpsPanel() {
  const settings = useChatStore((s) => s.settings);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const agents = useChatStore((s) => s.agents);

  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.getUsage>> | null>(null);
  const [cacheDiagnostics, setCacheDiagnostics] = useState<Awaited<ReturnType<typeof api.getCacheDiagnostics>> | null>(null);
  const [evalSummary, setEvalSummary] = useState<{
    manifestTaskCount: number;
    mandatoryCount: number;
    taskCount: number;
    runs: EvalRunSummary[];
    gates: Record<string, EvalGateCheck>;
    results: EvalResult[];
  }>({ manifestTaskCount: 0, mandatoryCount: 0, taskCount: 0, runs: [], gates: {}, results: [] });
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({});
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, BudgetConfig>>({});
  const [savingProvider, setSavingProvider] = useState('');
  const [savingBudgets, setSavingBudgets] = useState(false);
  const [providerNotice, setProviderNotice] = useState<{ provider: string; ok: boolean; text: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [providers, usageSnapshot, cache, manifest, tasks, mandatory, resultsResp] = await Promise.all([
        api.getProviders(),
        api.getUsage(),
        api.getCacheDiagnostics(),
        api.getEvalManifest(),
        api.getEvalTasks(),
        api.getMandatoryEvalScenarios(),
        api.getEvalResults({ limit: 500 }),
      ]);
      const runIds = Array.from(new Set(resultsResp.results.map((result) => result.run_id))).slice(0, 6);
      const runPairs = await Promise.all(
        runIds.map(async (runId) => {
          const summary = await api.getEvalRunSummary(runId);
          const gate = await api.checkEvalGates(runId).catch(
            () => ({ run_id: runId, baseline_run_id: '', ok: true, average_composite: summary.average_composite, blocking: [] }),
          );
          return [runId, summary, gate] as const;
        }),
      );
      setProviderStatus(providers);
      setUsage(usageSnapshot);
      setCacheDiagnostics(cache);
      setEvalSummary({
        manifestTaskCount: Number(manifest.task_count || 0),
        mandatoryCount: Number(mandatory.count || 0),
        taskCount: tasks.tasks.length,
        runs: runPairs.map(([, summary]) => summary).sort((a, b) => lastRunTimestamp(b) - lastRunTimestamp(a)),
        gates: Object.fromEntries(runPairs.map(([runId, , gate]) => [runId, gate])),
        results: resultsResp.results,
      });
      setBudgetDrafts(settings.budgets || {});
    } catch (error) {
      console.warn('Provider ops load failed:', error);
      toast('Failed to load provider ops data', 'error');
    } finally {
      setLoading(false);
    }
  }, [settings.budgets]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const usageEntries = useMemo(() => usage?.entries || [], [usage?.entries]);
  const costByAgent = useMemo(() => aggregateCost(usageEntries, (entry) => entry.agent || 'unknown'), [usageEntries]);
  const costByProvider = useMemo(() => aggregateCost(usageEntries, (entry) => entry.provider || 'unknown'), [usageEntries]);
  const dimensionRows = useMemo(() => aggregateDimensions(evalSummary.results), [evalSummary.results]);
  const providerBench = useMemo(() => aggregateComposite(evalSummary.results, (result) => result.provider), [evalSummary.results]);
  const modelBench = useMemo(() => aggregateComposite(evalSummary.results, (result) => `${result.provider} / ${result.model}`), [evalSummary.results]);
  const budgetTargets = useMemo(() => {
    const names = new Set<string>([
      ...agents.map((agent) => agent.name),
      ...usageEntries.map((entry) => entry.agent).filter(Boolean),
      ...Object.keys(settings.budgets || {}),
    ]);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [agents, settings.budgets, usageEntries]);

  const openProviderConfig = (provider: Provider) => {
    const currentOverrides = providerStatus?.overrides?.[provider.id] || {};
    setConfiguring((current) => (current === provider.id ? null : provider.id));
    setProviderDrafts((drafts) => ({
      ...drafts,
      [provider.id]: {
        apiKey: '',
        baseUrl: String(currentOverrides.base_url || ''),
        proxy: String(currentOverrides.proxy || ''),
        timeout: currentOverrides.timeout != null ? String(currentOverrides.timeout) : '',
        retries: currentOverrides.max_retries != null ? String(currentOverrides.max_retries) : '',
      },
    }));
  };

  const updateProviderDraft = (providerId: string, patch: Partial<ProviderDraft>) => {
    setProviderDrafts((drafts) => ({
      ...drafts,
      [providerId]: { ...(drafts[providerId] || EMPTY_DRAFT), ...patch },
    }));
  };

  const saveProvider = async (providerId: string) => {
    const draft = providerDrafts[providerId] || EMPTY_DRAFT;
    const body: Record<string, unknown> = {};
    if (draft.apiKey.trim()) body.api_key = draft.apiKey.trim();
    if (draft.baseUrl.trim()) body.base_url = draft.baseUrl.trim();
    if (draft.proxy.trim()) body.proxy = draft.proxy.trim();
    if (draft.timeout.trim()) body.timeout = Number(draft.timeout);
    if (draft.retries.trim()) body.max_retries = Number(draft.retries);
    if (Object.keys(body).length === 0) return;

    setSavingProvider(providerId);
    try {
      await api.updateProviderOverrides(providerId, body);
      let text = 'Saved';
      let ok = true;
      if (body.api_key) {
        const response = await fetch(`/api/providers/${providerId}/test`, { method: 'POST' });
        const payload = await response.json();
        text = payload.message || payload.error || 'Saved';
        ok = response.ok;
      }
      setProviderNotice({ provider: providerId, ok, text });
      setConfiguring(null);
      await loadAll();
    } catch (error) {
      console.warn('Provider save failed:', error);
      setProviderNotice({ provider: providerId, ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSavingProvider('');
    }
  };

  const updateBudgetDraft = (agentName: string, patch: Partial<BudgetConfig>) => {
    setBudgetDrafts((drafts) => ({
      ...drafts,
      [agentName]: { ...(drafts[agentName] || {}), ...patch },
    }));
  };

  const saveBudgets = async () => {
    setSavingBudgets(true);
    try {
      updateSettings({ budgets: budgetDrafts });
      await api.saveSettings({ budgets: budgetDrafts });
      toast('Budgets updated', 'success');
    } catch (error) {
      console.warn('Budget save failed:', error);
      toast('Budget save failed', 'error');
    } finally {
      setSavingBudgets(false);
    }
  };

  if (loading) return <div className="py-8 text-center text-xs text-on-surface-variant/40">Loading provider ops...</div>;

  const latestRun = evalSummary.runs[0] || null;
  const latestGate = latestRun ? evalSummary.gates[latestRun.run_id] : null;

  return (
    <>
      <Section title="Capabilities" icon="auto_awesome" defaultOpen>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(providerStatus?.capabilities || {}).map(([capability, info]) => (
            <div
              key={capability}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] ${
                info.available ? 'bg-green-500/8 text-green-400/80' : 'bg-surface-container/30 text-on-surface-variant/30'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${info.available ? 'bg-green-400' : 'bg-outline-variant/30'}`} />
              <span className="font-medium">{CAP_LABELS[capability] || capability}</span>
              {info.provider_name && <span className="ml-auto text-[8px] text-on-surface-variant/30">{info.provider_name}</span>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Provider Health" icon="cloud" defaultOpen>
        <div className="space-y-3">
          {(providerStatus?.providers || []).map((provider) => {
            const preferredFor = Object.entries(providerStatus?.user_preferences || {})
              .filter(([, value]) => value === provider.id)
              .map(([key]) => key.replace(/^preferred_/, ''));
            const draft = providerDrafts[provider.id] || EMPTY_DRAFT;
            return (
              <div key={provider.id} className="rounded-2xl border border-outline-variant/10 bg-surface-container/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${provider.health?.healthy !== false ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span className="text-[11px] font-semibold text-on-surface">{provider.name}</span>
                      {provider.free_tier && <StatusChip tone="primary" text="FREE" />}
                      {provider.local && <StatusChip tone="info" text="LOCAL" />}
                      {provider.health?.active && <StatusChip tone="success" text="ACTIVE" />}
                      {!provider.health?.healthy && <StatusChip tone="danger" text="DEGRADED" />}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(provider.capabilities || []).map((capability) => (
                        <span key={capability} className="rounded-full bg-surface-container/50 px-2 py-0.5 text-[8px] text-on-surface-variant/45">
                          {CAP_LABELS[capability] || capability}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => openProviderConfig(provider)} className="text-[9px] font-medium text-primary hover:text-primary/80">
                    {configuring === provider.id ? 'Close' : 'Configure'}
                  </button>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <MetricCard label="Transport" value={provider.transport_mode || 'api'} />
                  <MetricCard label="Auth" value={provider.auth_method || 'api_key'} />
                  <MetricCard label="Fallback" value={provider.degraded_mode_behavior || 'failover'} />
                  <MetricCard label="Preferred" value={preferredFor.length ? preferredFor.join(', ') : 'Auto'} />
                </div>

                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div className="rounded-xl bg-surface-container/25 p-2.5">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Policy Risk</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(provider.usage_policy_flags || []).length > 0 ? (
                        provider.usage_policy_flags?.map((flag) => <StatusChip key={flag} tone="warning" text={flag.replace(/_/g, ' ')} />)
                      ) : (
                        <span className="text-[10px] text-on-surface-variant/40">No declared risk flags</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl bg-surface-container/25 p-2.5">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Health</div>
                    <div className="mt-1 text-[10px] text-on-surface-variant/45">
                      {provider.health?.healthy !== false ? 'Healthy' : provider.health?.last_error || 'Transport error'}
                    </div>
                  </div>
                </div>

                {configuring === provider.id && (
                  <div className="mt-3 rounded-xl border border-outline-variant/10 bg-surface-container/15 p-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      {!provider.local && (
                        <input
                          value={draft.apiKey}
                          onChange={(event) => updateProviderDraft(provider.id, { apiKey: event.target.value })}
                          type="password"
                          placeholder="Paste API key"
                          className="setting-input"
                        />
                      )}
                      <input
                        value={draft.baseUrl}
                        onChange={(event) => updateProviderDraft(provider.id, { baseUrl: event.target.value })}
                        placeholder="Base URL override"
                        className="setting-input font-mono"
                      />
                      <input
                        value={draft.proxy}
                        onChange={(event) => updateProviderDraft(provider.id, { proxy: event.target.value })}
                        placeholder="Proxy URL"
                        className="setting-input font-mono"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={draft.timeout}
                          onChange={(event) => updateProviderDraft(provider.id, { timeout: event.target.value })}
                          placeholder="Timeout"
                          className="setting-input"
                        />
                        <input
                          value={draft.retries}
                          onChange={(event) => updateProviderDraft(provider.id, { retries: event.target.value })}
                          placeholder="Retries"
                          className="setting-input"
                        />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className={`text-[10px] ${providerNotice?.provider === provider.id ? (providerNotice.ok ? 'text-green-400/80' : 'text-red-400/80') : 'text-on-surface-variant/35'}`}>
                        {providerNotice?.provider === provider.id ? providerNotice.text : 'Save auth and transport overrides.'}
                      </span>
                      <button
                        onClick={() => void saveProvider(provider.id)}
                        disabled={savingProvider === provider.id}
                        className="rounded-lg bg-primary/15 px-3 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
                      >
                        {savingProvider === provider.id ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Cost & Budgets" icon="payments" defaultOpen>
        <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-3">
              <MetricCard label="Total Cost" value={`$${Number(usage?.total_cost || 0).toFixed(4)}`} />
              <MetricCard label="Input Tokens" value={compact(usage?.total_input_tokens || 0)} />
              <MetricCard label="Output Tokens" value={compact(usage?.total_output_tokens || 0)} />
            </div>
            <SimpleBreakdown title="Agent Spend" rows={costByAgent} formatter={(value) => `$${value.toFixed(4)}`} />
            <SimpleBreakdown title="Provider Spend" rows={costByProvider} formatter={(value) => `$${value.toFixed(4)}`} />
            <RecentUsage entries={usageEntries.slice(-10).reverse()} />
          </div>
          <div className="rounded-2xl border border-outline-variant/10 bg-surface-container/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Budget Config</div>
                <div className="text-[10px] text-on-surface-variant/40">Session budget warnings and hard stops.</div>
              </div>
              <button
                onClick={() => void saveBudgets()}
                disabled={savingBudgets}
                className="rounded-lg bg-primary/15 px-3 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
              >
                {savingBudgets ? 'Saving...' : 'Save'}
              </button>
            </div>
            <div className="space-y-3">
              {budgetTargets.map((agentName) => {
                const draft = budgetDrafts[agentName] || {};
                const spent = costByAgent.find(([name]) => name === agentName)?.[1] || 0;
                const cap = Number(draft.max_cost_usd_per_session || 0);
                const pct = cap > 0 ? Math.min((spent / cap) * 100, 100) : 0;
                return (
                  <div key={agentName} className="rounded-xl bg-surface-container/25 p-2.5">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-on-surface">{agentName}</span>
                      <span className="text-[10px] text-on-surface-variant/45">${spent.toFixed(4)}</span>
                    </div>
                    {cap > 0 && (
                      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-container-highest/35">
                        <div
                          className={`h-full rounded-full ${pct >= 100 ? 'bg-red-400' : pct >= Number(draft.warning_threshold_pct || 80) ? 'bg-amber-400' : 'bg-green-400'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        value={draft.max_cost_usd_per_session ?? ''}
                        onChange={(event) => updateBudgetDraft(agentName, { max_cost_usd_per_session: numeric(event.target.value) })}
                        placeholder="Max $ / session"
                        className="setting-input"
                      />
                      <input
                        value={draft.max_tokens_per_session ?? ''}
                        onChange={(event) => updateBudgetDraft(agentName, { max_tokens_per_session: numeric(event.target.value) })}
                        placeholder="Max tokens / session"
                        className="setting-input"
                      />
                      <input
                        value={draft.warning_threshold_pct ?? 80}
                        onChange={(event) => updateBudgetDraft(agentName, { warning_threshold_pct: numeric(event.target.value) })}
                        placeholder="Warn %"
                        className="setting-input"
                      />
                      <input
                        value={draft.hard_stop_threshold_pct ?? 100}
                        onChange={(event) => updateBudgetDraft(agentName, { hard_stop_threshold_pct: numeric(event.target.value) })}
                        placeholder="Stop %"
                        className="setting-input"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Prompt Cache Diagnostics" icon="data_object" defaultOpen>
        <CacheDiagnostics diagnostics={cacheDiagnostics} />
      </Section>

      <Section title="Benchmark Dashboard" icon="monitoring" defaultOpen>
        <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-4">
              <MetricCard label="Golden Tasks" value={String(evalSummary.manifestTaskCount || evalSummary.taskCount)} />
              <MetricCard label="Mandatory" value={String(evalSummary.mandatoryCount)} />
              <MetricCard label="Latest Avg" value={latestRun ? latestRun.average_composite.toFixed(2) : '0.00'} />
              <MetricCard label="Runs" value={String(evalSummary.runs.length)} />
            </div>
            <RunList runs={evalSummary.runs} gates={evalSummary.gates} />
            <SimpleBreakdown title="Provider Composite" rows={providerBench} formatter={(value) => value.toFixed(2)} />
            <SimpleBreakdown title="Model Composite" rows={modelBench.slice(0, 8)} formatter={(value) => value.toFixed(2)} />
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-outline-variant/10 bg-surface-container/20 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Latest Gate</div>
                  <div className="text-[10px] text-on-surface-variant/40">{latestRun?.run_id || 'No stored runs'}</div>
                </div>
                {latestGate ? <StatusChip tone={latestGate.ok ? 'success' : 'danger'} text={latestGate.ok ? 'PASS' : 'BLOCKED'} /> : null}
              </div>
              {latestGate?.blocking?.length ? (
                <div className="space-y-1">
                  {latestGate.blocking.slice(0, 6).map((item, index) => (
                    <div key={`${item.task_id}-${index}`} className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[10px] text-red-300/80">
                      {item.task_id}: {item.reason}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-green-500/10 px-2.5 py-1.5 text-[10px] text-green-300/80">
                  {latestRun ? 'No blocking regressions in the latest run.' : 'Benchmark storage will populate after the first stored eval run.'}
                </div>
              )}
            </div>
            <SimpleBreakdown title="Dimension Averages" rows={dimensionRows} formatter={(value) => value.toFixed(2)} />
            <RecentBenchmarks results={evalSummary.results.slice(0, 8)} />
          </div>
        </div>
      </Section>
    </>
  );
}

function lastRunTimestamp(run: EvalRunSummary) {
  return Math.max(...(run.results || []).map((result) => Number(result.timestamp || 0)), 0);
}

function aggregateCost(entries: UsageEntry[], keyFn: (entry: UsageEntry) => string) {
  const bucket = new Map<string, number>();
  for (const entry of entries) bucket.set(keyFn(entry), (bucket.get(keyFn(entry)) || 0) + Number(entry.cost || 0));
  return Array.from(bucket.entries()).sort((a, b) => b[1] - a[1]);
}

function aggregateComposite(results: EvalResult[], keyFn: (result: EvalResult) => string) {
  const bucket = new Map<string, { total: number; count: number }>();
  for (const result of results) {
    const key = keyFn(result);
    const current = bucket.get(key) || { total: 0, count: 0 };
    current.total += Number(result.composite || 0);
    current.count += 1;
    bucket.set(key, current);
  }
  return Array.from(bucket.entries())
    .map(([key, value]) => [key, value.total / Math.max(value.count, 1)] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

function aggregateDimensions(results: EvalResult[]) {
  const bucket = new Map<string, { total: number; count: number }>();
  for (const result of results) {
    for (const [key, value] of Object.entries(result.scores || {})) {
      const current = bucket.get(key) || { total: 0, count: 0 };
      current.total += Number(value || 0);
      current.count += 1;
      bucket.set(key, current);
    }
  }
  return Array.from(bucket.entries())
    .map(([key, value]) => [key, value.total / Math.max(value.count, 1)] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-container/25 p-3">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/35">{label}</div>
      <div className="mt-1 text-[14px] font-semibold text-on-surface">{value}</div>
    </div>
  );
}

function StatusChip({ tone, text }: { tone: 'primary' | 'info' | 'success' | 'warning' | 'danger'; text: string }) {
  const classes: Record<string, string> = {
    primary: 'bg-primary/15 text-primary/80',
    info: 'bg-blue-500/15 text-blue-300/80',
    success: 'bg-green-500/15 text-green-300/80',
    warning: 'bg-amber-500/15 text-amber-300/80',
    danger: 'bg-red-500/15 text-red-300/80',
  };
  return <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-medium ${classes[tone]}`}>{text}</span>;
}

function SimpleBreakdown({
  title,
  rows,
  formatter,
}: {
  title: string;
  rows: Array<[string, number]>;
  formatter: (value: number) => string;
}) {
  const max = rows[0]?.[1] || 1;
  return (
    <div className="rounded-2xl border border-outline-variant/10 bg-surface-container/20 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">{title}</div>
      <div className="space-y-2">
        {rows.length > 0 ? rows.map(([label, value]) => (
          <div key={label}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-[10px] text-on-surface-variant/50">{label}</span>
              <span className="text-[10px] font-medium text-on-surface">{formatter(value)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-highest/35">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max((value / max) * 100, 4)}%` }} />
            </div>
          </div>
        )) : <div className="text-[10px] text-on-surface-variant/40">No data yet.</div>}
      </div>
    </div>
  );
}

function RecentUsage({ entries }: { entries: UsageEntry[] }) {
  return (
    <div className="rounded-2xl border border-outline-variant/10 bg-surface-container/20 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Recent Requests</div>
      <div className="space-y-2">
        {entries.length > 0 ? entries.map((entry, index) => (
          <div key={`${entry.task_id}-${index}`} className="rounded-xl bg-surface-container/25 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium text-on-surface">{entry.agent || 'system'} {'->'} {entry.provider}</span>
              <span className="text-[10px] text-on-surface-variant/45">${Number(entry.cost || 0).toFixed(4)}</span>
            </div>
            <div className="mt-1 text-[9px] text-on-surface-variant/40">
              {entry.model} • {entry.transport} • {compact(entry.input_tokens + entry.output_tokens)} tokens • {entry.latency_ms}ms
            </div>
          </div>
        )) : <div className="text-[10px] text-on-surface-variant/40">No transport usage stored yet.</div>}
      </div>
    </div>
  );
}

function RunList({ runs, gates }: { runs: EvalRunSummary[]; gates: Record<string, EvalGateCheck> }) {
  return (
    <div className="rounded-2xl border border-outline-variant/10 bg-surface-container/20 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Recent Runs</div>
      <div className="space-y-2">
        {runs.length > 0 ? runs.slice(0, 5).map((run) => {
          const gate = gates[run.run_id];
          return (
            <div key={run.run_id} className="rounded-xl bg-surface-container/25 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-medium text-on-surface">{run.run_id}</div>
                  <div className="text-[9px] text-on-surface-variant/40">{run.pass_count} pass • {run.warn_count} warn • {run.fail_count} fail</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-on-surface">{run.average_composite.toFixed(2)}</span>
                  <StatusChip tone={gate?.ok === false ? 'danger' : 'success'} text={gate?.ok === false ? 'BLOCK' : 'PASS'} />
                </div>
              </div>
            </div>
          );
        }) : <div className="text-[10px] text-on-surface-variant/40">No benchmark runs stored yet.</div>}
      </div>
    </div>
  );
}

function RecentBenchmarks({ results }: { results: EvalResult[] }) {
  return (
    <div className="rounded-2xl border border-outline-variant/10 bg-surface-container/20 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Recent Benchmark Rows</div>
      <div className="space-y-2">
        {results.length > 0 ? results.map((result) => (
          <div key={`${result.id}-${result.task_id}`} className="rounded-xl bg-surface-container/25 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10px] font-medium text-on-surface">{result.task_name}</span>
              <StatusChip tone={result.passed ? 'success' : result.needs_review ? 'warning' : 'danger'} text={result.passed ? 'PASS' : result.needs_review ? 'REVIEW' : 'FAIL'} />
            </div>
            <div className="mt-1 text-[9px] text-on-surface-variant/40">
              {result.provider} / {result.model} • {result.composite.toFixed(2)}
            </div>
          </div>
        )) : <div className="text-[10px] text-on-surface-variant/40">No benchmark data yet.</div>}
      </div>
    </div>
  );
}

function compact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}

function numeric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
