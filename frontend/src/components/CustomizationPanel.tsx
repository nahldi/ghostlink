/**
 * Persistent Customization — project rules, user preferences, agent rules.
 * Three layers: Project > User > Agent, with inheritance.
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { toast } from './Toast';

interface CustomRule {
  id: string;
  scope: 'project' | 'user' | 'agent';
  agent?: string;
  category: 'behavior' | 'format' | 'safety' | 'workflow' | 'style';
  text: string;
  enabled: boolean;
  created_at: number;
}

const SCOPE_INFO = {
  project: { label: 'Project Rules', icon: 'folder', description: 'Apply to all agents in this project', color: '#3b82f6' },
  user: { label: 'Your Preferences', icon: 'person', description: 'Your personal agent preferences', color: '#a855f7' },
  agent: { label: 'Agent Rules', icon: 'smart_toy', description: 'Rules for a specific agent', color: '#22c55e' },
};

const CATEGORIES = [
  { value: 'behavior', label: 'Behavior', icon: 'psychology' },
  { value: 'format', label: 'Format', icon: 'format_size' },
  { value: 'safety', label: 'Safety', icon: 'security' },
  { value: 'workflow', label: 'Workflow', icon: 'account_tree' },
  { value: 'style', label: 'Style', icon: 'palette' },
];

const PRESET_RULES = [
  { text: 'Always explain your reasoning step by step', category: 'behavior' },
  { text: 'Use TypeScript strict mode in all code', category: 'format' },
  { text: 'Never modify files outside the project directory', category: 'safety' },
  { text: 'Run tests after every code change', category: 'workflow' },
  { text: 'Keep responses concise — no filler', category: 'style' },
  { text: 'Always include error handling in code examples', category: 'format' },
  { text: 'Ask for confirmation before destructive operations', category: 'safety' },
  { text: 'Prefer functional programming patterns', category: 'style' },
];

export function CustomizationPanel() {
  const agents = useChatStore((s) => s.agents);
  const [rules, setRules] = useState<CustomRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeScope, setActiveScope] = useState<'project' | 'user' | 'agent'>('project');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState('behavior');

  useEffect(() => {
    // Intentional initialization sync: show immediate loading state before the first backend response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch('/api/custom-rules')
      .then(r => r.ok ? r.json() : { rules: [] })
      .then(d => { setRules(d.rules || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const createRule = async () => {
    if (!newText.trim()) return;
    try {
      const res = await fetch('/api/custom-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: activeScope,
          agent: activeScope === 'agent' ? selectedAgent : undefined,
          category: newCategory,
          text: newText.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.rule) setRules(prev => [...prev, data.rule]);
        setNewText('');
        setShowCreate(false);
        toast('Rule added', 'success');
      }
    } catch { toast('Failed to add rule', 'error'); }
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    try {
      await fetch(`/api/custom-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      setRules(prev => prev.map(r => r.id === id ? { ...r, enabled } : r));
    } catch { /* ignored */ }
  };

  const deleteRule = async (id: string) => {
    try {
      await fetch(`/api/custom-rules/${id}`, { method: 'DELETE' });
      setRules(prev => prev.filter(r => r.id !== id));
      toast('Rule removed', 'info');
    } catch { /* ignored */ }
  };

  const filtered = rules.filter(r => {
    if (r.scope !== activeScope) return false;
    if (activeScope === 'agent' && selectedAgent && r.agent !== selectedAgent) return false;
    return true;
  });

  const scopeInfo = SCOPE_INFO[activeScope];

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-outline-variant/10 shrink-0">
        <h2 className="text-sm font-semibold text-on-surface/80">Customization</h2>
        <p className="text-[10px] text-on-surface-variant/30 mt-0.5">Persistent rules and preferences</p>
      </div>

      {/* Scope tabs */}
      <div className="flex border-b border-outline-variant/10 shrink-0">
        {(Object.entries(SCOPE_INFO) as [keyof typeof SCOPE_INFO, typeof SCOPE_INFO.project][]).map(([key, info]) => (
          <button key={key} onClick={() => setActiveScope(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-medium transition-colors ${
              activeScope === key ? 'border-b-2' : 'text-on-surface-variant/40 hover:text-on-surface-variant/60'
            }`}
            style={activeScope === key ? { color: info.color, borderColor: info.color } : undefined}>
            <span className="material-symbols-outlined text-[14px]">{info.icon}</span>
            {info.label.split(' ')[0]}
          </button>
        ))}
      </div>

      {/* Agent selector for agent scope */}
      {activeScope === 'agent' && (
        <div className="px-4 py-2 border-b border-outline-variant/5 shrink-0">
          <select value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}
            className="w-full bg-surface-container rounded-lg px-3 py-1.5 text-[10px] text-on-surface outline-none border border-outline-variant/10">
            <option value="">All agents</option>
            {agents.map(a => <option key={a.name} value={a.name}>{a.label || a.name}</option>)}
          </select>
        </div>
      )}

      {/* Scope description */}
      <div className="px-4 py-2 border-b border-outline-variant/5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[14px]" style={{ color: scopeInfo.color }}>{scopeInfo.icon}</span>
          <span className="text-[10px] text-on-surface-variant/40">{scopeInfo.description}</span>
        </div>
      </div>

      {/* Add rule */}
      <div className="px-4 py-2 border-b border-outline-variant/5 shrink-0">
        <AnimatePresence>
          {showCreate ? (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} className="space-y-2 overflow-hidden">
              <textarea value={newText} onChange={e => setNewText(e.target.value)}
                placeholder="Type a rule or instruction..."
                rows={2} autoFocus
                className="w-full bg-surface-container rounded-lg px-3 py-2 text-[10px] text-on-surface outline-none border border-outline-variant/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all resize-none" />
              <div className="flex gap-1 flex-wrap">
                {CATEGORIES.map(c => (
                  <button key={c.value} onClick={() => setNewCategory(c.value)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-medium transition-colors ${
                      newCategory === c.value ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/30 hover:bg-surface-container-high/30'
                    }`}>
                    <span className="material-symbols-outlined text-[10px]">{c.icon}</span>
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowCreate(false)} className="flex-1 px-2 py-1.5 rounded-lg text-[10px] text-on-surface-variant/50 hover:bg-surface-container-high">Cancel</button>
                <button onClick={createRule} disabled={!newText.trim()}
                  className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-primary text-on-primary hover:brightness-110 disabled:opacity-50">Add Rule</button>
              </div>
              {/* Quick presets */}
              <div>
                <p className="text-[8px] text-on-surface-variant/25 uppercase tracking-wider mb-1">Quick presets</p>
                <div className="space-y-1">
                  {PRESET_RULES.slice(0, 4).map((p, i) => (
                    <button key={i} onClick={() => { setNewText(p.text); setNewCategory(p.category); }}
                      className="w-full text-left px-2 py-1 rounded text-[9px] text-on-surface-variant/40 hover:bg-surface-container-high/30 transition-colors truncate">
                      {p.text}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : (
            <button onClick={() => setShowCreate(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
              <span className="material-symbols-outlined text-[14px]">add</span>
              Add Rule
            </button>
          )}
        </AnimatePresence>
      </div>

      {/* Rules list */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-2 space-y-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-4 py-2.5">
                <div className="w-4 h-4 rounded skeleton-shimmer" />
                <div className="flex-1 h-3 rounded skeleton-shimmer" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-primary/30">{scopeInfo.icon}</span>
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs font-medium text-on-surface-variant/50">No {scopeInfo.label.toLowerCase()}</p>
              <p className="text-[10px] text-on-surface-variant/30 max-w-[200px]">{scopeInfo.description}</p>
            </div>
          </div>
        ) : (
          <div className="py-1">
            {filtered.map(rule => (
              <div key={rule.id} className="px-4 py-2.5 flex items-start gap-2.5 hover:bg-surface-container-high/30 transition-colors group">
                <button onClick={() => toggleRule(rule.id, !rule.enabled)}
                  className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    rule.enabled ? 'bg-primary border-primary' : 'border-outline-variant/30'
                  }`}>
                  {rule.enabled && <span className="material-symbols-outlined text-[12px] text-on-primary">check</span>}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-[11px] leading-relaxed ${rule.enabled ? 'text-on-surface/70' : 'text-on-surface-variant/30 line-through'}`}>
                    {rule.text}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[8px] px-1 py-0.5 rounded bg-surface-container-highest/30 text-on-surface-variant/25">
                      {CATEGORIES.find(c => c.value === rule.category)?.label || rule.category}
                    </span>
                    {rule.agent && <span className="text-[8px] text-on-surface-variant/20">@{rule.agent}</span>}
                  </div>
                </div>
                <button onClick={() => deleteRule(rule.id)}
                  className="p-0.5 rounded hover:bg-red-500/10 text-on-surface-variant/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
