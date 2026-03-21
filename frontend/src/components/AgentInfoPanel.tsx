import { useState, useEffect } from 'react';
import type { Agent } from '../types';
import { AgentIcon } from './AgentIcon';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';

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

function timeAgo(ts: number): string {
  const now = Date.now() / 1000;
  const diff = now - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function AgentInfoPanel({ agent, onClose }: AgentInfoPanelProps) {
  const isActive = agent.state === 'active' || agent.state === 'idle' || agent.state === 'thinking';
  const isPaused = agent.state === 'paused';
  const [killing, setKilling] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [tab, setTab] = useState<'info' | 'skills'>('info');
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [skillSearch, setSkillSearch] = useState('');
  const [skillFilter, setSkillFilter] = useState('');
  const setAgents = useChatStore((s) => s.setAgents);

  useEffect(() => {
    if (tab === 'skills') {
      fetch(`/api/skills/agent/${agent.name}`)
        .then(r => r.json())
        .then(d => setSkills(d.skills || []))
        .catch(() => {});
    }
  }, [tab, agent.name]);

  const toggleSkill = async (skillId: string, enabled: boolean) => {
    try {
      await fetch(`/api/skills/agent/${agent.name}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId, enabled }),
      });
      setSkills(prev => prev.map(s => s.id === skillId ? { ...s, enabled } : s));
    } catch {}
  };

  const handleLaunch = async () => {
    setLaunching(true);
    try {
      await api.spawnAgent(agent.base, agent.label, agent.workspace || '.', agent.args || []);
      setTimeout(async () => {
        try { const r = await api.getStatus(); setAgents(r.agents); } catch {}
        onClose();
      }, 3000);
    } catch { setLaunching(false); }
  };

  const handleKill = async () => {
    setKilling(true);
    try {
      await api.killAgent(agent.name);
      const r = await api.getStatus();
      setAgents(r.agents);
      onClose();
    } catch { setKilling(false); }
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
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant/30">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4">
            {(['info', 'skills'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                  tab === t ? 'bg-primary/10 text-primary' : 'text-on-surface-variant/40 hover:text-on-surface-variant/60'
                }`}
              >
                {t === 'info' ? '📋 Info' : `🧩 Skills ${skills.length > 0 ? `(${skills.filter(s => s.enabled).length})` : ''}`}
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
            </div>
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

function providerName(base: string): string {
  const map: Record<string, string> = { claude: 'Anthropic', codex: 'OpenAI', gemini: 'Google DeepMind', grok: 'xAI', copilot: 'GitHub' };
  return map[base] || base.charAt(0).toUpperCase() + base.slice(1);
}
