/**
 * Workflow Builder — visual automation trigger editor.
 * Create event-driven workflows: "When X happens, have agent Y do Z"
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { toast } from './Toast';

interface Workflow {
  id: string;
  name: string;
  trigger: {
    type: string;
    config: Record<string, string>;
  };
  action: {
    type: string;
    agent: string;
    config: Record<string, string>;
  };
  enabled: boolean;
  last_run?: number;
  run_count: number;
}

const TRIGGER_TYPES = [
  { value: 'schedule', label: 'On Schedule', icon: 'schedule', description: 'Run at specific times' },
  { value: 'event', label: 'On Event', icon: 'bolt', description: 'When something happens' },
  { value: 'file_change', label: 'On File Change', icon: 'edit_document', description: 'When files change' },
  { value: 'agent_status', label: 'On Agent Status', icon: 'smart_toy', description: 'Agent online/offline' },
  { value: 'webhook', label: 'On Webhook', icon: 'webhook', description: 'External service calls' },
];

const ACTION_TYPES = [
  { value: 'message', label: 'Send Message', icon: 'chat' },
  { value: 'task', label: 'Queue Task', icon: 'task_alt' },
  { value: 'command', label: 'Run Command', icon: 'terminal' },
  { value: 'checkpoint', label: 'Save Checkpoint', icon: 'save' },
];

const EVENT_OPTIONS = [
  'agent_join', 'agent_leave', 'message_received', 'job_created',
  'job_completed', 'error', 'test_failed', 'build_completed',
];

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function WorkflowBuilder() {
  const agents = useChatStore((s) => s.agents);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState('schedule');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, string>>({});
  const [actionType, setActionType] = useState('message');
  const [actionAgent, setActionAgent] = useState('');
  const [actionConfig, setActionConfig] = useState<Record<string, string>>({});

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows');
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows || []);
      }
    } catch { /* ignored */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  const createWorkflow = async () => {
    if (!name.trim()) { toast('Name required', 'warning'); return; }
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          trigger: { type: triggerType, config: triggerConfig },
          action: { type: actionType, agent: actionAgent, config: actionConfig },
        }),
      });
      if (res.ok) {
        toast('Workflow created', 'success');
        setName(''); setTriggerConfig({}); setActionConfig({});
        setCreating(false);
        fetchWorkflows();
      } else { toast('Failed to create', 'error'); }
    } catch { toast('Failed to create', 'error'); }
  };

  const toggleWorkflow = async (id: string, enabled: boolean) => {
    try {
      await fetch(`/api/workflows/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      setWorkflows(prev => prev.map(w => w.id === id ? { ...w, enabled } : w));
    } catch { /* ignored */ }
  };

  const deleteWorkflow = async (id: string) => {
    try {
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setWorkflows(prev => prev.filter(w => w.id !== id));
        toast('Workflow deleted', 'info');
      }
    } catch { /* ignored */ }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-outline-variant/10 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-on-surface/80">Automations</h2>
          <p className="text-[10px] text-on-surface-variant/30 mt-0.5">Event-driven workflows</p>
        </div>
        <button onClick={() => setCreating(!creating)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
          <span className="material-symbols-outlined text-[16px]">{creating ? 'close' : 'add'}</span>
          {creating ? 'Cancel' : 'New'}
        </button>
      </div>

      <AnimatePresence>
        {creating && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden border-b border-outline-variant/10">
            <div className="px-4 py-3 space-y-3">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Workflow name..." autoFocus
                className="w-full bg-surface-container rounded-lg px-3 py-2 text-xs text-on-surface outline-none border border-outline-variant/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all" />
              <div>
                <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1.5">When</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {TRIGGER_TYPES.map((t) => (
                    <button key={t.value} onClick={() => { setTriggerType(t.value); setTriggerConfig({}); }}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                        triggerType === t.value ? 'bg-primary/15 border border-primary/30' : 'bg-surface-container-high/30 border border-transparent hover:bg-surface-container-high/50'}`}>
                      <span className="material-symbols-outlined text-[14px]" style={{ color: triggerType === t.value ? 'var(--primary)' : undefined }}>{t.icon}</span>
                      <span className="text-[10px] font-medium text-on-surface/60">{t.label}</span>
                    </button>
                  ))}
                </div>
                {triggerType === 'schedule' && (
                  <input type="text" value={triggerConfig.cron || ''} onChange={(e) => setTriggerConfig({ cron: e.target.value })}
                    placeholder="Cron (e.g. */5 * * * *)"
                    className="mt-2 w-full bg-surface-container rounded-lg px-3 py-1.5 text-[10px] font-mono text-on-surface outline-none border border-outline-variant/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all" />
                )}
                {triggerType === 'event' && (
                  <select value={triggerConfig.event || ''} onChange={(e) => setTriggerConfig({ event: e.target.value })}
                    className="mt-2 w-full bg-surface-container rounded-lg px-3 py-1.5 text-[10px] text-on-surface outline-none border border-outline-variant/10">
                    <option value="">Select event...</option>
                    {EVENT_OPTIONS.map(e => <option key={e} value={e}>{e.replace(/_/g, ' ')}</option>)}
                  </select>
                )}
                {triggerType === 'file_change' && (
                  <input type="text" value={triggerConfig.pattern || ''} onChange={(e) => setTriggerConfig({ pattern: e.target.value })}
                    placeholder="Pattern (e.g. src/**/*.ts)"
                    className="mt-2 w-full bg-surface-container rounded-lg px-3 py-1.5 text-[10px] font-mono text-on-surface outline-none border border-outline-variant/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all" />
                )}
              </div>
              <div>
                <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1.5">Then</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {ACTION_TYPES.map((a) => (
                    <button key={a.value} onClick={() => { setActionType(a.value); setActionConfig({}); }}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                        actionType === a.value ? 'bg-primary/15 border border-primary/30' : 'bg-surface-container-high/30 border border-transparent hover:bg-surface-container-high/50'}`}>
                      <span className="material-symbols-outlined text-[14px]" style={{ color: actionType === a.value ? 'var(--primary)' : undefined }}>{a.icon}</span>
                      <span className="text-[10px] font-medium text-on-surface/60">{a.label}</span>
                    </button>
                  ))}
                </div>
                <select value={actionAgent} onChange={(e) => setActionAgent(e.target.value)}
                  className="mt-2 w-full bg-surface-container rounded-lg px-3 py-1.5 text-[10px] text-on-surface outline-none border border-outline-variant/10">
                  <option value="">Select agent...</option>
                  {agents.map(a => <option key={a.name} value={a.name}>{a.label || a.name}</option>)}
                </select>
                {(actionType === 'message' || actionType === 'task') && (
                  <textarea value={actionConfig.content || ''} onChange={(e) => setActionConfig({ content: e.target.value })}
                    placeholder={actionType === 'message' ? 'Message...' : 'Task description...'} rows={2}
                    className="mt-2 w-full bg-surface-container rounded-lg px-3 py-1.5 text-[10px] text-on-surface outline-none border border-outline-variant/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all resize-none" />
                )}
                {actionType === 'command' && (
                  <input type="text" value={actionConfig.command || ''} onChange={(e) => setActionConfig({ command: e.target.value })}
                    placeholder="Command to run..."
                    className="mt-2 w-full bg-surface-container rounded-lg px-3 py-1.5 text-[10px] font-mono text-on-surface outline-none border border-outline-variant/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all" />
                )}
              </div>
              <button onClick={createWorkflow}
                className="w-full px-3 py-2 rounded-lg text-[11px] font-medium bg-primary text-on-primary hover:brightness-110 transition-all">
                Create Workflow
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-2 space-y-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-lg skeleton-shimmer" />
                <div className="flex-1 space-y-1">
                  <div className="w-1/2 h-3 rounded skeleton-shimmer" />
                  <div className="w-1/3 h-2 rounded skeleton-shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : workflows.length === 0 && !creating ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl text-primary/30">bolt</span>
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-xs font-medium text-on-surface-variant/50">No automations</p>
              <p className="text-[10px] text-on-surface-variant/30 leading-relaxed max-w-[200px]">
                Create workflows that trigger agent actions on events, schedules, or file changes
              </p>
            </div>
          </div>
        ) : (
          <div className="py-1">
            {workflows.map((w) => (
              <div key={w.id} className="px-4 py-3 flex items-start gap-3 hover:bg-surface-container-high/30 transition-colors group border-b border-outline-variant/5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${w.enabled ? 'bg-primary/10' : 'bg-surface-container-highest/30'}`}>
                  <span className="material-symbols-outlined text-[16px]" style={{ color: w.enabled ? 'var(--primary)' : '#8b8b8b' }}>
                    {TRIGGER_TYPES.find(t => t.value === w.trigger.type)?.icon || 'bolt'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-on-surface/70 font-medium truncate">{w.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[9px] text-on-surface-variant/30">{TRIGGER_TYPES.find(t => t.value === w.trigger.type)?.label}</span>
                    <span className="text-[9px] text-on-surface-variant/15">→</span>
                    <span className="text-[9px] text-on-surface-variant/30">{ACTION_TYPES.find(a => a.value === w.action.type)?.label}</span>
                    {w.last_run && <span className="text-[9px] text-on-surface-variant/20">Last: {timeAgo(w.last_run)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[9px] text-on-surface-variant/20">{w.run_count}x</span>
                  <button onClick={() => toggleWorkflow(w.id, !w.enabled)}
                    className={`w-8 h-4 rounded-full transition-colors relative ${w.enabled ? 'bg-primary' : 'bg-surface-container-highest'}`}>
                    <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all ${w.enabled ? 'left-4' : 'left-0.5'}`} />
                  </button>
                  <button onClick={() => deleteWorkflow(w.id)}
                    className="p-0.5 rounded hover:bg-red-500/10 text-on-surface-variant/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
