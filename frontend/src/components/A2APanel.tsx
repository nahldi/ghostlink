import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { toast } from './Toast';
import { useChatStore } from '../stores/chatStore';
import type { A2AAgentCard } from '../types';
import type { TaskProgressStep } from '../types';

function splitCsv(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinCsv(values?: string[]) {
  return Array.isArray(values) ? values.join(', ') : '';
}

function cardSubtitle(card: A2AAgentCard) {
  const bits = [
    card.provider,
    card.auth_mode ? `auth:${card.auth_mode}` : null,
    card.version,
    ...(card.default_input_modes || []).slice(0, 2),
  ].filter(Boolean);
  return bits.join(' · ');
}

function taskSteps(progressData: unknown): TaskProgressStep[] {
  if (Array.isArray(progressData)) return progressData as TaskProgressStep[];
  if (progressData && typeof progressData === 'object' && Array.isArray((progressData as { steps?: unknown[] }).steps)) {
    return (progressData as { steps: TaskProgressStep[] }).steps;
  }
  return [];
}

export function A2APanel() {
  const activeChannel = useChatStore((s) => s.activeChannel);
  const agents = useChatStore((s) => s.agents);
  const tasks = useChatStore((s) => s.tasks);
  const upsertTask = useChatStore((s) => s.upsertTask);
  const liveAgents = useMemo(
    () => agents.filter((agent) => agent.state !== 'offline'),
    [agents],
  );
  const a2aTasks = useMemo(
    () => tasks
      .filter((task) => task.channel === activeChannel && task.source_type === 'a2a')
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .slice(0, 6),
    [activeChannel, tasks],
  );

  const [loadingCard, setLoadingCard] = useState(true);
  const [savingCard, setSavingCard] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [delegating, setDelegating] = useState(false);
  const [refreshingTaskId, setRefreshingTaskId] = useState('');

  const [cardName, setCardName] = useState('');
  const [cardDescription, setCardDescription] = useState('');
  const [cardUrl, setCardUrl] = useState('');
  const [cardVersion, setCardVersion] = useState('');
  const [cardAuthMode, setCardAuthMode] = useState('');
  const [cardSkills, setCardSkills] = useState('');
  const [cardCapabilities, setCardCapabilities] = useState('');
  const [cardInputModes, setCardInputModes] = useState('');
  const [cardOutputModes, setCardOutputModes] = useState('');

  const [discoveryUrl, setDiscoveryUrl] = useState('');
  const [discovered, setDiscovered] = useState<A2AAgentCard[]>([]);
  const [selectedRemote, setSelectedRemote] = useState<A2AAgentCard | null>(null);
  const [discoveryMeta, setDiscoveryMeta] = useState<{ source_url: string; fetched_at?: number } | null>(null);

  const [delegateAgent, setDelegateAgent] = useState('');
  const [delegateTitle, setDelegateTitle] = useState('');
  const [delegatePrompt, setDelegatePrompt] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getA2AAgentCard()
      .then((card) => {
        if (!card || cancelled) return;
        setCardName(card.name || '');
        setCardDescription(card.description || '');
        setCardUrl(card.url || '');
        setCardVersion(card.version || '');
        setCardAuthMode(card.auth_mode || '');
        setCardSkills(joinCsv(card.skills));
        setCardCapabilities(joinCsv(card.capabilities));
        setCardInputModes(joinCsv(card.default_input_modes));
        setCardOutputModes(joinCsv(card.default_output_modes));
      })
      .catch(() => {
        if (!cancelled) {
          setCardVersion('1.0');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCard(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!delegateAgent && liveAgents[0]) {
      setDelegateAgent(liveAgents[0].name);
    }
  }, [delegateAgent, liveAgents]);

  const saveCard = async () => {
    if (!cardName.trim()) {
      toast('Agent card needs a name', 'warning');
      return;
    }
    setSavingCard(true);
    try {
      await api.updateA2AAgentCard({
        name: cardName.trim(),
        description: cardDescription.trim(),
        url: cardUrl.trim(),
        version: cardVersion.trim() || '1.0',
        skills: splitCsv(cardSkills),
        capabilities: splitCsv(cardCapabilities),
        default_input_modes: splitCsv(cardInputModes),
        default_output_modes: splitCsv(cardOutputModes),
      });
      toast('A2A agent card saved', 'success');
    } catch {
      toast('Failed to save A2A agent card', 'error');
    } finally {
      setSavingCard(false);
    }
  };

  const runDiscovery = async () => {
    if (!discoveryUrl.trim()) return;
    setDiscovering(true);
    try {
      const result = await api.discoverA2A(discoveryUrl.trim());
      setDiscoveryMeta({ source_url: result.source_url, fetched_at: result.fetched_at });
      setDiscovered(result.agents);
      setSelectedRemote(result.agents[0] || null);
      if (result.agents.length === 0) {
        toast('No remote A2A agents found', 'warning');
      }
    } catch {
      toast('A2A discovery failed', 'error');
    } finally {
      setDiscovering(false);
    }
  };

  const localCardUrl = `${window.location.origin}/.well-known/agent-card.json`;

  const delegate = async () => {
    if (!selectedRemote?.url || !delegateTitle.trim() || !delegatePrompt.trim()) {
      toast('Pick a remote agent and fill the task', 'warning');
      return;
    }
    setDelegating(true);
    try {
      const result = await api.delegateA2ATask({
        target_url: selectedRemote.url,
        remote_agent_id: selectedRemote.agent_id,
        local_agent_name: delegateAgent || undefined,
        title: delegateTitle.trim(),
        prompt: delegatePrompt.trim(),
        channel: activeChannel,
      });
      if (result.task) {
        upsertTask(result.task);
      }
      toast(result.task?.task_id ? 'A2A delegation queued' : 'A2A delegation sent', 'success');
      setDelegateTitle('');
      setDelegatePrompt('');
    } catch {
      toast('A2A delegation failed', 'error');
    } finally {
      setDelegating(false);
    }
  };

  const refreshTask = async (taskId: string) => {
    setRefreshingTaskId(taskId);
    try {
      const next = await api.refreshA2ATask(taskId);
      upsertTask(next);
      toast(`A2A task ${next.status}`, 'info');
    } catch {
      toast('A2A task refresh failed', 'error');
    } finally {
      setRefreshingTaskId('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">A2A Interoperability</div>

      <div className="rounded-xl border border-outline-variant/8 bg-surface-container/20 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold text-on-surface">Agent Card</div>
            <div className="text-[9px] text-on-surface-variant/40">Edit the local card served over A2A.</div>
          </div>
          <button
            onClick={saveCard}
            disabled={savingCard || loadingCard}
            className="rounded-lg bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            {savingCard ? 'Saving...' : 'Save card'}
          </button>
        </div>

        <div className="mb-3 flex items-center justify-between rounded-lg bg-surface-container/25 px-2.5 py-2">
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Published at</div>
            <div className="truncate text-[10px] text-on-surface-variant/60">{localCardUrl}</div>
            {cardAuthMode ? <div className="mt-1 text-[9px] text-on-surface-variant/45">auth:{cardAuthMode}</div> : null}
          </div>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(localCardUrl).catch(() => {});
              toast('A2A card URL copied', 'info');
            }}
            className="rounded-lg bg-surface-container-high px-2 py-1 text-[9px] font-medium text-on-surface-variant/60 hover:text-on-surface"
          >
            Copy URL
          </button>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <input value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="Agent card name" className="setting-input" />
          <input value={cardUrl} onChange={(e) => setCardUrl(e.target.value)} placeholder="Public base URL" className="setting-input" />
          <input value={cardVersion} onChange={(e) => setCardVersion(e.target.value)} placeholder="Version" className="setting-input" />
          <input value={cardSkills} onChange={(e) => setCardSkills(e.target.value)} placeholder="Skills, comma separated" className="setting-input" />
          <input value={cardCapabilities} onChange={(e) => setCardCapabilities(e.target.value)} placeholder="Capabilities, comma separated" className="setting-input" />
          <input value={cardInputModes} onChange={(e) => setCardInputModes(e.target.value)} placeholder="Input modes, comma separated" className="setting-input" />
          <input value={cardOutputModes} onChange={(e) => setCardOutputModes(e.target.value)} placeholder="Output modes, comma separated" className="setting-input md:col-span-2" />
          <textarea
            value={cardDescription}
            onChange={(e) => setCardDescription(e.target.value)}
            placeholder="Describe what this GhostLink node exposes over A2A."
            rows={3}
            className="setting-input md:col-span-2 resize-none"
          />
        </div>
      </div>

      <div className="rounded-xl border border-outline-variant/8 bg-surface-container/20 p-3">
        <div className="mb-2">
          <div className="text-[11px] font-semibold text-on-surface">Remote Agent Browser</div>
          <div className="text-[9px] text-on-surface-variant/40">Probe a remote A2A endpoint and browse its published cards.</div>
        </div>

        <div className="mb-3 flex gap-2">
          <input
            value={discoveryUrl}
            onChange={(e) => setDiscoveryUrl(e.target.value)}
            placeholder="https://remote.example.com/.well-known/agent-card.json"
            className="setting-input flex-1"
          />
          <button
            onClick={runDiscovery}
            disabled={discovering || !discoveryUrl.trim()}
            className="rounded-lg bg-primary/10 px-3 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            {discovering ? 'Scanning...' : 'Discover'}
          </button>
        </div>

        <div className="space-y-2">
          {discovered.map((card) => {
            const selected = selectedRemote?.agent_id === card.agent_id && selectedRemote?.name === card.name;
            return (
              <button
                key={`${card.agent_id || card.name}-${card.url || 'remote'}`}
                onClick={() => setSelectedRemote(card)}
                className={`w-full rounded-xl border p-3 text-left transition-all ${
                  selected
                    ? 'border-primary/30 bg-primary/10'
                    : 'border-outline-variant/8 bg-surface-container/20 hover:border-primary/20'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold text-on-surface">{card.name}</div>
                    <div className="text-[9px] text-on-surface-variant/40">{cardSubtitle(card) || 'remote agent card'}</div>
                  </div>
                  <div className="text-[9px] text-on-surface-variant/35">{card.url || 'no url'}</div>
                </div>
                {card.description ? <div className="mt-2 text-[10px] text-on-surface-variant/55">{card.description}</div> : null}
                {(card.skills?.length || card.capabilities?.length) ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(card.skills || []).map((skill) => (
                      <span key={skill} className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary/80">{skill}</span>
                    ))}
                    {(card.capabilities || []).map((capability) => (
                      <span key={capability} className="rounded bg-surface-container-high px-1.5 py-0.5 text-[9px] text-on-surface-variant/55">{capability}</span>
                    ))}
                  </div>
                ) : null}
              </button>
            );
          })}
          {discovered.length === 0 ? <div className="py-2 text-[10px] text-on-surface-variant/30">No remote agents loaded yet.</div> : null}
        </div>

        {discoveryMeta ? (
          <div className="mt-3 rounded-lg bg-surface-container/25 px-2.5 py-2 text-[9px] text-on-surface-variant/45">
            Probed {discoveryMeta.source_url}
            {discoveryMeta.fetched_at ? ` · ${new Date(discoveryMeta.fetched_at * 1000).toLocaleString()}` : ''}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-outline-variant/8 bg-surface-container/20 p-3">
        <div className="mb-2">
          <div className="text-[11px] font-semibold text-on-surface">Cross-Platform Delegation</div>
          <div className="text-[9px] text-on-surface-variant/40">Queue a local task that delegates work through A2A.</div>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <select value={delegateAgent} onChange={(e) => setDelegateAgent(e.target.value)} className="setting-input">
            <option value="">Auto-pick local agent</option>
            {liveAgents.map((agent) => (
              <option key={agent.name} value={agent.name}>{agent.label || agent.name}</option>
            ))}
          </select>
          <input
            value={selectedRemote?.name || ''}
            readOnly
            placeholder="Pick a discovered remote agent"
            className="setting-input"
          />
          <input
            value={delegateTitle}
            onChange={(e) => setDelegateTitle(e.target.value)}
            placeholder="Delegated task title"
            className="setting-input md:col-span-2"
          />
          <textarea
            value={delegatePrompt}
            onChange={(e) => setDelegatePrompt(e.target.value)}
            placeholder="What should the remote agent do?"
            rows={3}
            className="setting-input md:col-span-2 resize-none"
          />
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-[9px] text-on-surface-variant/35">Task will be tracked in #{activeChannel} with source_type='a2a'.</div>
          <button
            onClick={delegate}
            disabled={delegating || !selectedRemote?.url}
            className="rounded-lg bg-primary/10 px-3 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            {delegating ? 'Delegating...' : 'Delegate task'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-outline-variant/8 bg-surface-container/20 p-3">
        <div className="mb-2">
          <div className="text-[11px] font-semibold text-on-surface">A2A Task Status</div>
          <div className="text-[9px] text-on-surface-variant/40">Local truth for outbound A2A tasks in this channel.</div>
        </div>

        <div className="space-y-2">
          {a2aTasks.map((task) => (
            <div key={task.task_id} className="rounded-lg border border-outline-variant/8 bg-surface-container/20 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-[11px] font-semibold text-on-surface">{task.title}</div>
                <div className="text-[9px] uppercase tracking-wider text-primary/70">{task.status}</div>
              </div>
              <div className="mt-1 text-[9px] text-on-surface-variant/35">
                {task.agent_name || 'auto'} · {task.progress_step || 'queued'}
                {task.source_ref ? ` · remote ${task.source_ref}` : ''}
              </div>
              {taskSteps(task.progress_data).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {taskSteps(task.progress_data).map((step, index) => (
                    <span
                      key={`${task.task_id}-${index}-${step.label}`}
                      className={`rounded px-1.5 py-0.5 text-[9px] ${
                        step.status === 'done'
                          ? 'bg-green-500/15 text-green-300/80'
                          : step.status === 'active'
                            ? 'bg-primary/15 text-primary/90'
                            : 'bg-surface-container-high text-on-surface-variant/45'
                      }`}
                    >
                      {step.label}
                    </span>
                  ))}
                </div>
              ) : null}
              {task.error ? (
                <div className="mt-1 text-[9px] text-red-300/80">{task.error}</div>
              ) : null}
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => refreshTask(task.task_id)}
                  disabled={refreshingTaskId === task.task_id}
                  className="rounded-lg bg-surface-container-high px-2 py-1 text-[9px] font-medium text-on-surface-variant/60 hover:text-on-surface disabled:opacity-40"
                >
                  {refreshingTaskId === task.task_id ? 'Refreshing...' : 'Refresh remote'}
                </button>
              </div>
            </div>
          ))}
          {a2aTasks.length === 0 ? (
            <div className="py-1 text-[10px] text-on-surface-variant/30">No A2A tasks in #{activeChannel} yet.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
