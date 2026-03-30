/**
 * Task Queue — autonomous agent task management.
 * Shows queued, running, and completed tasks per agent.
 * Accessible from cockpit or as standalone panel.
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from './Toast';
import type { Agent } from '../types';

interface AgentTask {
  id: string;
  agent: string;
  title: string;
  description?: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed';
  progress?: number; // 0-100
  created_at: number;
  started_at?: number;
  completed_at?: number;
  error?: string;
}

function statusIcon(status: string): string {
  switch (status) {
    case 'queued': return 'schedule';
    case 'running': return 'play_circle';
    case 'paused': return 'pause_circle';
    case 'completed': return 'check_circle';
    case 'failed': return 'error';
    default: return 'radio_button_unchecked';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'queued': return '#8b8b8b';
    case 'running': return '#22c55e';
    case 'paused': return '#fb923c';
    case 'completed': return '#60a5fa';
    case 'failed': return '#ef4444';
    default: return '#8b8b8b';
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function TaskQueue({ agent }: { agent: Agent }) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/tasks`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch { /* ignored */ }
    setLoading(false);
  }, [agent.name]);

  useEffect(() => {
    // Intentional initialization sync: reset the visible queue before the first refresh and poll loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setTasks([]);
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const createTask = async () => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), description: newDesc.trim() }),
      });
      if (res.ok) {
        toast('Task queued', 'success');
        setNewTitle('');
        setNewDesc('');
        setShowCreate(false);
        fetchTasks();
      }
    } catch {
      toast('Failed to create task', 'error');
    }
  };

  const cancelTask = async (id: string) => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/tasks/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTasks(prev => prev.filter(t => t.id !== id));
        toast('Task cancelled', 'info');
      }
    } catch { /* ignored */ }
  };

  const running = tasks.filter(t => t.status === 'running');
  const queued = tasks.filter(t => t.status === 'queued');
  const completed = tasks.filter(t => t.status === 'completed' || t.status === 'failed');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-outline-variant/10 shrink-0">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm" style={{ color: agent.color }}>task_alt</span>
          <span className="text-[11px] font-medium text-on-surface/70">Tasks</span>
          {running.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">
              {running.length} running
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          New
        </button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-outline-variant/5 space-y-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createTask()}
                placeholder="Task title..."
                className="w-full bg-surface-container rounded-lg px-2.5 py-1.5 text-[10px] text-on-surface outline-none border border-outline-variant/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
                autoFocus
              />
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description (optional)..."
                rows={2}
                className="w-full bg-surface-container rounded-lg px-2.5 py-1.5 text-[10px] text-on-surface outline-none border border-outline-variant/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all resize-none"
              />
              <button
                onClick={createTask}
                className="w-full px-3 py-1.5 rounded-lg text-[10px] font-medium bg-primary text-on-primary hover:brightness-110 transition-all"
              >
                Queue Task
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Task list */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-2 space-y-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2.5">
                <div className="w-6 h-6 rounded-full skeleton-shimmer" />
                <div className="flex-1 space-y-1">
                  <div className="w-2/3 h-2.5 rounded skeleton-shimmer" />
                  <div className="w-1/3 h-2 rounded skeleton-shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 py-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-primary/30">task_alt</span>
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs font-medium text-on-surface-variant/50">No tasks</p>
              <p className="text-[10px] text-on-surface-variant/30 leading-relaxed max-w-[180px]">
                Queue tasks for {agent.label || agent.name} to work on autonomously
              </p>
            </div>
          </div>
        ) : (
          <div className="py-1">
            {/* Running tasks */}
            {running.map((task) => (
              <div key={task.id} className="px-3 py-2.5 border-b border-outline-variant/5">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] animate-pulse" style={{ color: statusColor(task.status) }}>
                    {statusIcon(task.status)}
                  </span>
                  <span className="text-[11px] text-on-surface/80 font-medium flex-1 truncate">{task.title}</span>
                  <button onClick={() => cancelTask(task.id)} className="p-0.5 rounded hover:bg-red-500/10 text-on-surface-variant/30 hover:text-red-400">
                    <span className="material-symbols-outlined text-[12px]">close</span>
                  </button>
                </div>
                {task.progress !== undefined && (
                  <div className="mt-1.5 h-1 rounded-full bg-surface-container-highest overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: agent.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${task.progress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                )}
                {task.description && <p className="text-[9px] text-on-surface-variant/35 mt-1 truncate">{task.description}</p>}
              </div>
            ))}

            {/* Queued tasks */}
            {queued.map((task) => (
              <div key={task.id} className="px-3 py-2 flex items-center gap-2 hover:bg-surface-container-high/30 transition-colors group">
                <span className="material-symbols-outlined text-[14px]" style={{ color: statusColor(task.status) }}>
                  {statusIcon(task.status)}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] text-on-surface/60 truncate block">{task.title}</span>
                  <span className="text-[9px] text-on-surface-variant/25">{timeAgo(task.created_at)}</span>
                </div>
                <button onClick={() => cancelTask(task.id)} className="p-0.5 rounded hover:bg-red-500/10 text-on-surface-variant/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              </div>
            ))}

            {/* Completed tasks */}
            {completed.length > 0 && (
              <>
                <div className="px-3 py-1.5 mt-1">
                  <span className="text-[9px] font-semibold text-on-surface-variant/25 uppercase tracking-wider">Completed</span>
                </div>
                {completed.slice(0, 10).map((task) => (
                  <div key={task.id} className="px-3 py-1.5 flex items-center gap-2 opacity-60">
                    <span className="material-symbols-outlined text-[14px]" style={{ color: statusColor(task.status) }}>
                      {statusIcon(task.status)}
                    </span>
                    <span className="text-[10px] text-on-surface/40 truncate flex-1">{task.title}</span>
                    <span className="text-[9px] text-on-surface-variant/20">{timeAgo(task.completed_at || task.created_at)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
