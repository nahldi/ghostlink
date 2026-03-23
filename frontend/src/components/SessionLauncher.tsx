import { useState, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import { AgentIcon } from './AgentIcon';

interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  phases: { name: string; prompt: string; turns: number }[];
  roles: string[];
}

export function SessionLauncher({ onClose }: { onClose: () => void }) {
  const agents = useChatStore((s) => s.agents);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [selected, setSelected] = useState<SessionTemplate | null>(null);
  const [cast, setCast] = useState<Record<string, string>>({});
  const [topic, setTopic] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api.getSessionTemplates().then(r => setTemplates(r.templates)).catch(() => {});
  }, []);

  const handleSelect = (template: SessionTemplate) => {
    setSelected(template);
    // Auto-cast: assign available agents to roles
    const autoCast: Record<string, string> = {};
    const available = agents.filter(a => a.state !== 'offline');
    template.roles.forEach((role, i) => {
      if (available[i]) autoCast[role] = available[i].name;
    });
    setCast(autoCast);
  };

  const handleStart = async () => {
    if (!selected) return;
    setStarting(true);
    try {
      await api.startSession(activeChannel, selected.id, cast, topic);
      onClose();
    } catch {}
    setStarting(false);
  };

  if (selected) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <div className="w-full max-w-md glass-card rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-on-surface">{selected.name}</h3>
              <p className="text-[10px] text-on-surface-variant/50 mt-0.5">{selected.description}</p>
            </div>
            <button onClick={() => setSelected(null)} className="p-1 rounded-md hover:bg-surface-container-high text-on-surface-variant/40">
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            </button>
          </div>

          {/* Topic */}
          <div className="mb-4">
            <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1">Topic (optional)</label>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="What should this session be about?"
              className="w-full bg-surface-container/40 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs text-on-surface outline-none focus:border-primary/30"
            />
          </div>

          {/* Phases preview */}
          <div className="mb-4">
            <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-2">Phases</div>
            <div className="space-y-1">
              {selected.phases.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[9px]">{i + 1}</div>
                  <span className="text-on-surface/70 font-medium">{p.name}</span>
                  <span className="text-on-surface-variant/30 ml-auto">{p.turns} turn{p.turns > 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Cast */}
          <div className="mb-5">
            <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-2">Cast</div>
            <div className="space-y-2">
              {selected.roles.map(role => (
                <div key={role} className="flex items-center gap-2">
                  <span className="text-[10px] font-medium text-on-surface-variant/60 w-20">{role}</span>
                  <select
                    value={cast[role] || ''}
                    onChange={e => setCast(prev => ({ ...prev, [role]: e.target.value }))}
                    className="flex-1 bg-surface-container/40 border border-outline-variant/10 rounded-md px-2 py-1.5 text-[10px] text-on-surface outline-none focus:border-primary/30"
                  >
                    <option value="">Unassigned</option>
                    {agents.map(a => (
                      <option key={a.name} value={a.name}>{a.label || a.name}</option>
                    ))}
                  </select>
                  {cast[role] && (() => {
                    const ag = agents.find(a => a.name === cast[role]);
                    return ag ? <AgentIcon base={ag.base} color={ag.color} size={20} /> : null;
                  })()}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-xs font-medium text-on-surface-variant/60 hover:bg-surface-container-high transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleStart}
              disabled={starting || Object.values(cast).filter(Boolean).length === 0}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-primary-container text-white hover:brightness-110 transition-all disabled:opacity-40"
            >
              {starting ? 'Starting...' : 'Start Session'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md glass-card rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-on-surface">Start a Session</h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-surface-container-high text-on-surface-variant/40">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
        <p className="text-[10px] text-on-surface-variant/40 mb-4">
          Sessions are structured multi-agent workflows with sequential phases and turn-taking.
        </p>
        <div className="space-y-2">
          {templates.map(t => (
            <button
              key={t.id}
              onClick={() => handleSelect(t)}
              className="w-full text-left p-3 rounded-xl bg-surface-container/30 border border-outline-variant/8 hover:bg-surface-container/50 hover:border-primary/15 transition-all group"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-on-surface group-hover:text-primary transition-colors">{t.name}</span>
                <span className="text-[9px] text-on-surface-variant/30">{t.phases.length} phases</span>
              </div>
              <p className="text-[10px] text-on-surface-variant/50 leading-relaxed">{t.description}</p>
              <div className="flex gap-1 mt-2">
                {t.roles.map(r => (
                  <span key={r} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/8 text-primary/60">{r}</span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
