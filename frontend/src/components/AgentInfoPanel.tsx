import { useState, useEffect, useCallback } from 'react';
import type { Agent, AgentEffectiveStateResponse, AgentMemorySnapshot } from '../types';
import { AgentIcon } from './AgentIcon';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import { timeAgo } from '../lib/timeago';
import { toast } from './Toast';
import { EffectiveStateViewer } from './EffectiveStateViewer';
import { MemoryInspector } from './MemoryInspector';

interface AgentInfoPanelProps {
  agent: Agent;
  onClose: () => void;
}

interface SkillItem {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  enabled: boolean;
}

export function AgentInfoPanel({ agent, onClose }: AgentInfoPanelProps) {
  const isActive = agent.state === 'active' || agent.state === 'idle' || agent.state === 'thinking';
  const isPaused = agent.state === 'paused';
  const [killing, setKilling] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [tab, setTab] = useState<'info' | 'identity' | 'context' | 'skills' | 'profile'>('info');
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [skillSearch, setSkillSearch] = useState('');
  const [skillFilter, setSkillFilter] = useState('');
  const [effectiveState, setEffectiveState] = useState<AgentEffectiveStateResponse | null>(null);
  const [effectiveStateError, setEffectiveStateError] = useState('');
  const [availableProfiles, setAvailableProfiles] = useState<Array<{ profile_id: string; name: string }>>([]);
  const setAgents = useChatStore((s) => s.setAgents);
  const setProfileManagerOpen = useChatStore((s) => s.setProfileManagerOpen);

  useEffect(() => {
    if (tab === 'skills') {
      api.getAgentSkills(agent.name)
        .then(d => setSkills(d.skills || []))
        .catch((e) => console.warn('Skills fetch:', e.message || e));
    }
  }, [tab, agent.name]);

  useEffect(() => {
    if (tab !== 'identity' && tab !== 'profile') return;
    let cancelled = false;
    api.getAgentEffectiveState(agent.name)
      .then((data) => {
        if (!cancelled) {
          setEffectiveState(data);
          setEffectiveStateError('');
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setEffectiveState(null);
          setEffectiveStateError(e instanceof Error ? e.message : 'Identity status unavailable');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, agent.name]);

  useEffect(() => {
    if (tab !== 'profile') return;
    let cancelled = false;
    api.getProfiles()
      .then((result) => {
        if (!cancelled) {
          setAvailableProfiles(result.profiles.map((profile) => ({
            profile_id: profile.profile_id,
            name: profile.name,
          })));
        }
      })
      .catch(() => {
        if (!cancelled) setAvailableProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const toggleSkill = async (skillId: string, enabled: boolean) => {
    try {
      await api.toggleAgentSkill(agent.name, skillId, enabled);
      setSkills(prev => prev.map(s => s.id === skillId ? { ...s, enabled } : s));
    } catch { toast('Failed to toggle skill', 'error'); }
  };

  const handleLaunch = async () => {
    setLaunching(true);
    try {
      await api.spawnAgent(agent.base, agent.label, agent.workspace || '.', agent.args || []);
      setTimeout(async () => {
        try { const r = await api.getStatus(); setAgents(r.agents); } catch (e) { console.warn('Status fetch after launch:', e instanceof Error ? e.message : String(e)); }
        onClose();
      }, 3000);
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to launch agent', 'error'); setLaunching(false); }
  };

  const handleKill = async () => {
    setKilling(true);
    try {
      await api.killAgent(agent.name);
      const r = await api.getStatus();
      setAgents(r.agents);
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to stop agent', 'error'); setKilling(false); }
  };

  const filteredSkills = skills.filter(s => {
    if (skillSearch && !s.name.toLowerCase().includes(skillSearch.toLowerCase()) && !s.description.toLowerCase().includes(skillSearch.toLowerCase())) return false;
    if (skillFilter && s.category !== skillFilter) return false;
    return true;
  });

  const categories = [...new Set(skills.map(s => s.category))];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[420px] max-w-[92vw] max-h-[80vh] rounded-2xl border border-outline-variant/20 overflow-hidden flex flex-col"
        style={{
          background: 'linear-gradient(145deg, #1a1a28 0%, #0f0f17 100%)',
          boxShadow: `0 0 40px ${agent.color}15, 0 20px 60px rgba(0,0,0,0.5)`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Color bar */}
        <div className="h-1.5 w-full shrink-0" style={{ background: `linear-gradient(90deg, ${agent.color}, ${agent.color}40)` }} />

        {/* Header */}
        <div className="p-5 pb-3 shrink-0">
          <div className="flex items-center gap-4">
            <div className="relative">
              <AgentIcon base={agent.base} color={agent.color} size={48} />
              <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 ${
                isActive ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]'
                : isPaused ? 'bg-orange-400'
                : 'bg-gray-600'
              }`} style={{ borderColor: '#0f0f17' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-bold text-on-surface">{agent.label}</div>
              <div className="text-xs text-on-surface-variant/40">@{agent.name}</div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {agent.profile_name && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-primary/15 text-primary uppercase">
                    {agent.profile_name}
                  </span>
                )}
                {agent.drift_detected && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-red-500/20 text-red-300 uppercase">
                    Identity drift
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant/30">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4">
            {(['info', 'identity', 'profile', 'context', 'skills'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                  tab === t ? 'bg-primary/10 text-primary' : 'text-on-surface-variant/40 hover:text-on-surface-variant/60'
                }`}
              >
                {t === 'info'
                  ? 'Info'
                  : t === 'identity'
                    ? 'Identity'
                    : t === 'profile'
                      ? 'Profile'
                    : t === 'context'
                      ? 'Context'
                      : `Skills ${skills.length > 0 ? `(${skills.filter(s => s.enabled).length})` : ''}`}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {tab === 'info' ? (
            <div className="space-y-2.5">
              <InfoRow icon="terminal" label="Command" value={`${agent.command || agent.base}${agent.args?.length ? ' ' + agent.args.join(' ') : ''}`} color={agent.color} />
              <InfoRow icon="folder" label="Workspace" value={agent.workspace || 'N/A'} color={agent.color} mono />
              <InfoRow icon="hub" label="Provider" value={providerName(agent.base)} color={agent.color} />
              <InfoRow icon="schedule" label="Connected" value={agent.registered_at ? timeAgo(agent.registered_at) : 'N/A'} color={agent.color} />
              <InfoRow icon="tag" label="Status" value={isActive ? 'Online & Ready' : isPaused ? 'Paused' : agent.state === 'pending' ? 'Connecting...' : 'Offline'} color={isActive ? '#4ade80' : isPaused ? '#fb923c' : '#6b7280'} />
              {agent.role && (
                <InfoRow icon="account_tree" label="Role" value={agent.role.charAt(0).toUpperCase() + agent.role.slice(1)} color={agent.role === 'manager' ? '#facc15' : agent.role === 'worker' ? '#38bdf8' : '#a78bfa'} />
              )}
              <HierarchySection agent={agent} />

              {/* Response Mode */}
              <ResponseModeSelector agent={agent} />
            </div>
          ) : tab === 'identity' ? (
            <IdentityPanel agent={agent} effectiveState={effectiveState} error={effectiveStateError} />
          ) : tab === 'profile' ? (
            <ProfileTab
              agent={agent}
              effectiveState={effectiveState}
              error={effectiveStateError}
              availableProfiles={availableProfiles}
              onOpenProfileManager={() => setProfileManagerOpen(true)}
            />
          ) : tab === 'context' ? (
            <ContextPanel agent={agent} />
          ) : (
            <div>
              {/* Search + filter */}
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={skillSearch}
                  onChange={e => setSkillSearch(e.target.value)}
                  placeholder="Search skills..."
                  className="setting-input flex-1 text-[12px] py-2"
                />
              </div>
              <div className="flex gap-1 mb-3 flex-wrap">
                <button onClick={() => setSkillFilter('')} className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${!skillFilter ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/30 hover:text-on-surface-variant/50'}`}>All</button>
                {categories.map(c => (
                  <button key={c} onClick={() => setSkillFilter(c)} className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${skillFilter === c ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/30 hover:text-on-surface-variant/50'}`}>{c}</button>
                ))}
              </div>

              {/* Skills list */}
              <div className="space-y-1">
                {filteredSkills.map(s => (
                  <div key={s.id} className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg hover:bg-surface-container/30 transition-colors">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant/40">{s.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-semibold text-on-surface">{s.name}</div>
                      <div className="text-[9px] text-on-surface-variant/30 truncate">{s.description}</div>
                    </div>
                    <button
                      onClick={() => toggleSkill(s.id, !s.enabled)}
                      className={`w-8 h-4 rounded-full relative transition-all shrink-0 ${s.enabled ? 'bg-green-500/70' : 'bg-outline-variant/20'}`}
                    >
                      <div className={`w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all shadow-sm ${s.enabled ? 'right-0.5' : 'left-0.5'}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Terminal Actions */}
        {isActive && (
          <div className="px-4 pb-2 flex gap-2 shrink-0">
            <button
              onClick={() => {
                api.openTerminal(agent.name).catch((e) => console.warn('Open terminal:', e.message || e));
              }}
              className="flex-1 py-2 rounded-lg text-xs font-medium text-on-surface-variant/50 hover:text-on-surface-variant hover:bg-surface-container-high border border-outline-variant/10 transition-all flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[14px]">terminal</span>
              Open Terminal
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="p-4 pt-3 border-t border-outline-variant/8 flex gap-2 shrink-0">
          {isActive && (
            <button
              onClick={async () => { await api.pauseAgent(agent.name); const r = await api.getStatus(); setAgents(r.agents); onClose(); }}
              className="flex-1 py-2 rounded-lg text-xs font-medium text-orange-400/60 hover:text-orange-400 hover:bg-orange-400/5 border border-orange-400/10 transition-all"
            >⏸ Pause</button>
          )}
          {isActive ? (
            <button onClick={handleKill} disabled={killing} className="flex-1 py-2 rounded-lg text-xs font-medium text-error/60 hover:text-error hover:bg-error/5 border border-error/10 transition-all disabled:opacity-30">
              {killing ? 'Stopping...' : 'Stop Agent'}
            </button>
          ) : isPaused ? (
            <button onClick={async () => { await api.resumeAgent(agent.name); const r = await api.getStatus(); setAgents(r.agents); onClose(); }} className="flex-1 py-2 rounded-lg text-xs font-medium text-green-400 hover:bg-green-400/10 border border-green-400/20 transition-all">
              ▶ Resume
            </button>
          ) : (
            <button onClick={handleLaunch} disabled={launching} className="flex-1 py-2 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 border border-primary/20 transition-all disabled:opacity-30">
              {launching ? 'Launching...' : '🚀 Launch Agent'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function IdentityPanel({
  agent,
  effectiveState,
  error,
}: {
  agent: Agent;
  effectiveState: AgentEffectiveStateResponse | null;
  error: string;
}) {
  const identityAgentId = effectiveState?.agent_id || agent.agent_id || 'Pending backend support';
  const profileName = effectiveState?.profile_name || agent.profile_name || 'Unassigned';
  const profileId = effectiveState?.profile_id || agent.profile_id || 'Pending backend support';
  const driftDetected = Boolean(effectiveState?.drift_detected || agent.drift_detected);
  const driftScore = typeof effectiveState?.drift_score === 'number' ? `${Math.round(effectiveState.drift_score * 100)}%` : 'Pending backend support';
  const reinforcementState = effectiveState?.reinforcement_pending ? 'Pending' : driftDetected ? 'Triggered' : 'Clear';
  const reinforcementCount = typeof effectiveState?.reinforcement_count === 'number' ? String(effectiveState.reinforcement_count) : '0';
  const lastReinforcement = effectiveState?.last_reinforcement_at ? timeAgo(effectiveState.last_reinforcement_at) : 'Not recorded';
  return (
    <div className="space-y-3">
      <InfoRow icon="fingerprint" label="Agent ID" value={String(identityAgentId)} color={agent.color} mono />
      <InfoRow icon="badge" label="Profile" value={profileName} color={agent.color} />
      <InfoRow icon="deployed_code" label="Profile ID" value={String(profileId)} color={agent.color} mono />
      <InfoRow
        icon={driftDetected ? 'warning' : 'verified_user'}
        label="Identity State"
        value={driftDetected ? 'Drift detected' : 'Stable'}
        color={driftDetected ? '#f87171' : '#4ade80'}
      />
      <InfoRow icon="speed" label="Drift Score" value={driftScore} color={driftDetected ? '#f59e0b' : agent.color} />
      <InfoRow icon="bolt" label="Reinforcement" value={reinforcementState} color={effectiveState?.reinforcement_pending ? '#f59e0b' : '#4ade80'} />
      <InfoRow icon="history" label="Reinforcement Count" value={reinforcementCount} color={agent.color} />
      <InfoRow icon="schedule" label="Last Reinforcement" value={lastReinforcement} color={agent.color} />
      {effectiveState?.drift_reason && (
        <div className="rounded-xl border border-amber-400/15 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-100/80">
          {effectiveState.drift_reason}
        </div>
      )}
      <div className="py-3 px-3 rounded-xl bg-surface-container/30 border border-outline-variant/4">
        <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-2">Effective State</div>
        {error ? (
          <p className="text-[11px] text-on-surface-variant/40 leading-relaxed">
            {error}. Backend may still be wiring the Phase 1B identity endpoints.
          </p>
        ) : effectiveState ? (
          <EffectiveStateViewer state={effectiveState} compact />
        ) : (
          <p className="text-[11px] text-on-surface-variant/40 leading-relaxed">
            Effective identity state will appear here once the backend exposes the Phase 1B payload.
          </p>
        )}
      </div>
    </div>
  );
}

function ProfileTab({
  agent,
  effectiveState,
  error,
  availableProfiles,
  onOpenProfileManager,
}: {
  agent: Agent;
  effectiveState: AgentEffectiveStateResponse | null;
  error: string;
  availableProfiles: Array<{ profile_id: string; name: string }>;
  onOpenProfileManager: () => void;
}) {
  const profileId = effectiveState?.profile_id || agent.profile_id || '';
  const [selectedProfileId, setSelectedProfileId] = useState(profileId);

  useEffect(() => {
    setSelectedProfileId(profileId);
  }, [profileId]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-outline-variant/6 bg-surface-container/30 px-3 py-3">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Profile Assignment</div>
            <div className="mt-1 text-[11px] text-on-surface-variant/35">
              Profiles own the durable behavior layer. Agent overrides stay visible below.
            </div>
          </div>
          <button
            onClick={onOpenProfileManager}
            className="rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-1.5 text-[10px] font-semibold text-primary"
          >
            Manage Profiles
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr,auto]">
          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Current Profile</span>
            <select
              value={selectedProfileId}
              onChange={async (event) => {
                const nextProfileId = event.target.value;
                setSelectedProfileId(nextProfileId);
                try {
                  await api.setAgentConfig(agent.name, { profile_id: nextProfileId });
                  toast('Profile assignment saved', 'success');
                } catch (fetchError) {
                  toast(fetchError instanceof Error ? fetchError.message : 'Failed to assign profile', 'error');
                }
              }}
              className="setting-input w-full"
            >
              <option value="">Unassigned</option>
              {availableProfiles.map((profile) => (
                <option key={profile.profile_id} value={profile.profile_id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-2 md:min-w-[160px]">
            <InfoRow icon="badge" label="Profile Name" value={effectiveState?.profile_name || agent.profile_name || 'Unassigned'} color={agent.color} />
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/12 bg-red-500/8 px-3 py-3 text-[11px] text-red-200/80">
          {error}
        </div>
      ) : (
        <EffectiveStateViewer state={effectiveState} emptyMessage="Phase 2 effective-state details will appear here once Tyson’s profile endpoints are live." />
      )}
    </div>
  );
}

function ResponseModeSelector({ agent }: { agent: Agent }) {
  const [mode, setMode] = useState(agent.responseMode || 'mentioned');
  const modes = [
    { id: 'mentioned', label: 'Only @mentioned', icon: 'alternate_email' },
    { id: 'always', label: 'Always respond', icon: 'forum' },
    { id: 'listen', label: 'Listen & decide', icon: 'hearing' },
    { id: 'silent', label: 'Silent observer', icon: 'visibility' },
  ] as const;
  return (
    <div className="mt-3 pt-3 border-t border-outline-variant/10">
      <div className="text-[10px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-2">Response Mode</div>
      <div className="grid grid-cols-2 gap-1.5">
        {modes.map(m => (
          <button
            key={m.id}
            onClick={() => {
              setMode(m.id);
              api.setAgentConfig(agent.name, { responseMode: m.id }).catch((e) => console.warn('Agent config update:', e.message || e));
            }}
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-medium transition-all ${
              mode === m.id
                ? 'bg-primary/15 text-primary border border-primary/20'
                : 'bg-surface-container/40 text-on-surface-variant/40 hover:text-on-surface-variant/60 border border-transparent'
            }`}
          >
            <span className="material-symbols-outlined text-[13px]">{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value, color, mono }: { icon: string; label: string; value: string; color: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2 px-3 rounded-xl bg-surface-container/30 border border-outline-variant/4">
      <span className="material-symbols-outlined text-base mt-0.5 shrink-0" style={{ color }}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider">{label}</div>
        <div className={`text-xs text-on-surface ${mono ? 'font-mono' : ''} break-all leading-relaxed`}>{value}</div>
      </div>
    </div>
  );
}

function HierarchySection({ agent }: { agent: Agent }) {
  const agents = useChatStore((s) => s.agents);

  if (agent.role === 'worker' && agent.parent) {
    const parent = agents.find(a => a.name === agent.parent);
    return (
      <div className="py-2 px-3 rounded-xl bg-surface-container/30 border border-outline-variant/4">
        <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-1.5">Reports To</div>
        <div className="flex items-center gap-2">
          <AgentIcon base={parent?.base || 'unknown'} color={parent?.color || '#888'} size={20} />
          <span className="text-xs font-semibold" style={{ color: parent?.color || '#888' }}>{parent?.label || agent.parent}</span>
          <span className="text-[8px] font-bold px-1 py-px rounded bg-yellow-500/20 text-yellow-400 leading-none uppercase">MGR</span>
        </div>
      </div>
    );
  }

  if (agent.role === 'manager') {
    const workers = agents.filter(a => a.parent === agent.name);
    if (workers.length === 0) return null;
    return (
      <div className="py-2 px-3 rounded-xl bg-surface-container/30 border border-outline-variant/4">
        <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-1.5">
          Workers ({workers.length})
        </div>
        <div className="space-y-1.5">
          {workers.map(w => (
            <div key={w.name} className="flex items-center gap-2">
              <AgentIcon base={w.base} color={w.color} size={20} />
              <span className="text-xs font-medium" style={{ color: w.color }}>{w.label}</span>
              <span className={`text-[9px] ml-auto ${
                w.state === 'active' || w.state === 'thinking' ? 'text-green-400/60' : 'text-on-surface-variant/30'
              }`}>
                {w.state === 'thinking' ? 'Active' : w.state === 'active' || w.state === 'idle' ? 'Ready' : 'Off'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

// Model context window sizes and pricing (approximate)
const MODEL_CONTEXT: Record<string, { tokens: number; label: string; costPerMTok: number }> = {
  claude: { tokens: 1000000, label: '1M tokens', costPerMTok: 15 },
  codex: { tokens: 200000, label: '200K tokens', costPerMTok: 2.5 },
  gemini: { tokens: 1000000, label: '1M tokens', costPerMTok: 0 },
  grok: { tokens: 131072, label: '131K tokens', costPerMTok: 5 },
  copilot: { tokens: 128000, label: '128K tokens', costPerMTok: 0 },
  aider: { tokens: 128000, label: '128K tokens', costPerMTok: 0 },
  goose: { tokens: 128000, label: '128K tokens', costPerMTok: 0 },
  opencode: { tokens: 128000, label: '128K tokens', costPerMTok: 0 },
  ollama: { tokens: 32768, label: '32K tokens', costPerMTok: 0 },
};

function ContextPanel({ agent }: { agent: Agent }) {
  const messages = useChatStore(s => s.messages);
  const setAgents = useChatStore(s => s.setAgents);
  const [memoryCount, setMemoryCount] = useState(0);
  const handleMemorySnapshot = useCallback((snapshot: AgentMemorySnapshot) => {
    setMemoryCount(snapshot.memories.length + snapshot.observations.length);
  }, []);

  const agentMsgs = messages.filter(m => m.sender === agent.name);
  const totalChars = agentMsgs.reduce((s, m) => s + m.text.length, 0);
  const estimatedTokens = Math.round(totalChars / 4);
  const contextInfo = MODEL_CONTEXT[agent.base] || { tokens: 128000, label: '128K tokens' };
  const usagePct = Math.min(100, (estimatedTokens / contextInfo.tokens) * 100);
  const [nowTs] = useState(() => Date.now());
  const sessionMinutes = agent.registered_at
    ? Math.floor((nowTs / 1000 - agent.registered_at) / 60)
    : 0;
  const sessionDisplay = sessionMinutes < 60 ? `${sessionMinutes}m` : `${Math.floor(sessionMinutes / 60)}h ${sessionMinutes % 60}m`;
  const estimatedCost = (estimatedTokens / 1_000_000) * contextInfo.costPerMTok;

  const handleNewSession = async () => {
    // Kill and re-spawn
    await api.killAgent(agent.name).catch((e) => console.warn('Kill agent for new session:', e.message || e));
    setTimeout(async () => {
      await api.spawnAgent(agent.base, agent.label, agent.workspace || '.', agent.args || []).catch((e) => console.warn('Respawn agent:', e.message || e));
      setTimeout(async () => {
        const r = await api.getStatus();
        setAgents(r.agents);
      }, 3000);
    }, 1000);
  };

  return (
    <div className="space-y-3">
      {/* Context Usage */}
      <div className="py-3 px-3 rounded-xl bg-surface-container/30 border border-outline-variant/4">
        <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-2">Context Window</div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-on-surface-variant/50">~{estimatedTokens > 1000 ? `${(estimatedTokens / 1000).toFixed(1)}K` : estimatedTokens} tokens used</span>
          <span className="text-[11px] text-on-surface-variant/40">{contextInfo.label} max</span>
        </div>
        <div className="h-2 rounded-full bg-surface-container-highest/30 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${usagePct}%`,
              backgroundColor: usagePct > 80 ? '#ef4444' : usagePct > 50 ? '#f59e0b' : agent.color,
            }}
          />
        </div>
        <div className="flex items-center justify-between mt-2 text-[10px] text-on-surface-variant/35">
          <span>{usagePct.toFixed(1)}% used</span>
          <span>~{((contextInfo.tokens - estimatedTokens) / 1000).toFixed(0)}K remaining</span>
        </div>
      </div>

      {/* Session Stats */}
      <div className="py-3 px-3 rounded-xl bg-surface-container/30 border border-outline-variant/4">
        <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-2">Session</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center py-2 px-2 rounded-lg bg-surface-container/40">
            <div className="text-lg font-bold" style={{ color: agent.color }}>{agentMsgs.length}</div>
            <div className="text-[9px] text-on-surface-variant/40">Messages</div>
          </div>
          <div className="text-center py-2 px-2 rounded-lg bg-surface-container/40">
            <div className="text-lg font-bold" style={{ color: agent.color }}>{sessionDisplay}</div>
            <div className="text-[9px] text-on-surface-variant/40">Uptime</div>
          </div>
          <div className="text-center py-2 px-2 rounded-lg bg-surface-container/40">
            <div className="text-lg font-bold" style={{ color: agent.color }}>${estimatedCost.toFixed(4)}</div>
            <div className="text-[9px] text-on-surface-variant/40">Est. Cost</div>
          </div>
          <div className="text-center py-2 px-2 rounded-lg bg-surface-container/40">
            <div className="text-lg font-bold" style={{ color: agent.color }}>{memoryCount}</div>
            <div className="text-[9px] text-on-surface-variant/40">Memories</div>
          </div>
        </div>
      </div>

      <MemoryInspector
        agent={agent}
        onSnapshot={handleMemorySnapshot}
      />

      {/* Session Actions */}
      {(agent.state === 'active' || agent.state === 'thinking') && (
        <div className="flex gap-2">
          <button
            onClick={handleNewSession}
            className="flex-1 py-2 rounded-lg text-xs font-medium text-on-surface-variant/50 hover:text-on-surface hover:bg-surface-container-high border border-outline-variant/10 transition-all flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[14px]">refresh</span>
            New Session
          </button>
        </div>
      )}
    </div>
  );
}

function providerName(base: string): string {
  const map: Record<string, string> = { claude: 'Anthropic', codex: 'OpenAI', gemini: 'Google', grok: 'xAI', copilot: 'GitHub', aider: 'Aider', goose: 'Block', ollama: 'Ollama (Local)', opencode: 'OpenCode', cody: 'Sourcegraph', cursor: 'Cursor', continue: 'Continue', pi: 'Inflection' };
  return map[base] || base.charAt(0).toUpperCase() + base.slice(1);
}
