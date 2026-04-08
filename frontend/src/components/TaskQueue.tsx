/* eslint-disable react-hooks/set-state-in-effect -- This panel intentionally resets
   loading/error state when the target agent changes before async task data arrives. */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import { ProgressCard } from './ProgressCard';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import { toast } from './Toast';
import type { Agent, Task, TaskProgressStep } from '../types';

function timeAgo(ts?: number | null): string {
  if (!ts) return 'Pending';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

function taskSteps(task: Task): TaskProgressStep[] {
  if (Array.isArray(task.progress_data)) return task.progress_data as TaskProgressStep[];
  if (task.progress_data && Array.isArray((task.progress_data as { steps?: unknown[] }).steps)) {
    return (task.progress_data as { steps: TaskProgressStep[] }).steps;
  }
  if (task.progress_total > 0 && task.progress_step) {
    return Array.from({ length: task.progress_total }).map((_, index) => ({
      label: index === Math.max(0, Math.round((task.progress_pct / 100) * task.progress_total) - 1) ? task.progress_step : `Step ${index + 1}`,
      status:
        index < Math.floor((task.progress_pct / 100) * task.progress_total)
          ? 'done'
          : index === Math.floor((task.progress_pct / 100) * task.progress_total)
            ? 'active'
            : 'pending',
    }));
  }
  return [];
}

function taskExecutorMeta(task: Task) {
  const metadata = (task.metadata || {}) as Record<string, unknown>;
  return {
    backgroundState: typeof metadata.background_state === 'string' ? metadata.background_state : '',
    pid: typeof metadata.pid === 'number' ? metadata.pid : null,
    outputLog: typeof metadata.output_log === 'string' ? metadata.output_log : '',
    cancelRequested: metadata.cancel_requested === true,
    worktreePath: typeof metadata.worktree_path === 'string' ? metadata.worktree_path : '',
  };
}

export function TaskQueue({ agent }: { agent: Agent }) {
  const tasks = useChatStore((s) => s.tasks);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const setTasks = useChatStore((s) => s.setTasks);
  const upsertTask = useChatStore((s) => s.upsertTask);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getTasks({ agent: agent.name, limit: 100 })
      .then((data) => {
        if (!cancelled) setTasks(data.tasks);
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load tasks';
          setError(message);
          toast('Failed to load tasks', 'error');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent.name, setTasks]);

  const agentTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.agent_name === agent.name)
        .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)),
    [tasks, agent.name]
  );

  const running = agentTasks.filter((task) => ['running', 'awaiting_approval', 'awaiting_input'].includes(task.status));
  const queued = agentTasks.filter((task) => task.status === 'queued' || task.status === 'paused');
  const finished = agentTasks.filter((task) => ['completed', 'failed', 'cancelled'].includes(task.status)).slice(0, 12);

  const createTask = async () => {
    if (!newTitle.trim()) return;
    try {
      const created = await api.createTask({
        title: newTitle.trim(),
        description: newDesc.trim(),
        channel: activeChannel,
        agent_name: agent.name,
        created_by: useChatStore.getState().settings.username,
      });
      upsertTask(created);
      setNewTitle('');
      setNewDesc('');
      setShowCreate(false);
      toast('Task queued', 'success');
    } catch {
      toast('Failed to create task', 'error');
    }
  };

  const cancelTask = async (task: Task) => {
    try {
      const cancelled = await api.cancelTask(task.task_id);
      upsertTask(cancelled);
      toast('Cancel signal sent', 'info');
    } catch {
      toast('Failed to cancel task', 'error');
    }
  };

  const pauseResumeTask = async (task: Task) => {
    try {
      const next = task.status === 'paused' || task.status === 'interrupted'
        ? await api.resumeTask(task.task_id)
        : await api.pauseTask(task.task_id);
      upsertTask(next);
      toast(next.status === 'paused' ? 'Task paused' : 'Task resumed', 'success');
    } catch {
      toast('Failed to update task state', 'error');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 flex items-center justify-between border-b border-outline-variant/10 shrink-0">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm" style={{ color: agent.color }}>task_alt</span>
          <span className="text-[11px] font-medium text-on-surface/70">Tasks</span>
          {running.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">
              {running.length} live
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">{showCreate ? 'close' : 'add'}</span>
          New
        </button>
      </div>

      {showCreate && (
        <div className="px-3 py-2 border-b border-outline-variant/5 space-y-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createTask()}
            placeholder="Task title..."
            className="w-full bg-surface-container rounded-lg px-2.5 py-1.5 text-[10px] text-on-surface outline-none border border-outline-variant/10"
            aria-label="Task title"
            autoFocus
          />
          <textarea
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description..."
            rows={2}
            className="w-full bg-surface-container rounded-lg px-2.5 py-1.5 text-[10px] text-on-surface outline-none border border-outline-variant/10 resize-none"
            aria-label="Task description"
          />
          <button
            onClick={createTask}
            className="w-full px-3 py-1.5 rounded-lg text-[10px] font-medium bg-primary text-on-primary hover:brightness-110 transition-all"
          >
            Queue task
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="space-y-2 p-4" aria-live="polite" aria-busy="true">
            <div className="text-xs text-on-surface-variant/40">Loading tasks...</div>
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`task-skeleton-${index}`} className="rounded-2xl border border-outline-variant/10 bg-surface-container-high/20 p-3 space-y-2">
                <Skeleton height="0.75rem" width={`${55 + index * 10}%`} />
                <Skeleton height="0.65rem" width="80%" />
                <Skeleton height="0.65rem" width={`${70 + index * 5}%`} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-4">
            <div className="rounded-xl border border-red-400/20 bg-red-500/5 p-3" role="alert">
              <div className="text-[10px] font-semibold text-red-200/85">Could not load tasks</div>
              <div className="mt-1 text-[10px] text-red-300/80">{error}</div>
              <button
                onClick={() => {
                  setLoading(true);
                  setError('');
                  api.getTasks({ agent: agent.name, limit: 100 })
                    .then((data) => setTasks(data.tasks))
                    .catch((err) => {
                      const message = err instanceof Error ? err.message : 'Failed to load tasks';
                      setError(message);
                      toast('Failed to load tasks', 'error');
                    })
                    .finally(() => setLoading(false));
                }}
                className="mt-3 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[10px] font-medium text-red-200/85 hover:bg-red-500/15"
              >
                Retry loading tasks
              </button>
            </div>
          </div>
        ) : agentTasks.length === 0 ? (
          <div className="p-2">
            <EmptyState
              icon="task_alt"
              title={`No tasks for ${agent.label || agent.name}`}
              description="Queue a task to start execution, background progress, and checkpoint activity in this panel."
              action={{ label: 'Create task', onClick: () => setShowCreate(true) }}
            />
          </div>
        ) : (
          <div className="space-y-3 p-3">
            {running.map((task) => (
              <div key={task.task_id} className="rounded-2xl border border-outline-variant/10 bg-surface-container-high/20 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-on-surface">{task.title}</span>
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary/70">
                        {task.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-on-surface-variant/40">
                      {task.source_type} · {timeAgo(task.updated_at)}
                      {task.trace_id ? ` · trace ${task.trace_id.slice(0, 8)}` : ''}
                      {task.source_type === 'a2a' && task.source_ref ? ` · remote ${task.source_ref}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => pauseResumeTask(task)}
                      className="rounded-lg bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-300 hover:bg-amber-500/20"
                    >
                      {task.status === 'paused' || task.status === 'interrupted' ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      onClick={() => cancelTask(task)}
                      className="rounded-lg bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/20"
                    >
                      Stop
                    </button>
                  </div>
                </div>
                {task.description && (
                  <p className="mt-2 text-[10px] text-on-surface-variant/55">{task.description}</p>
                )}
                {(() => {
                  const meta = taskExecutorMeta(task);
                  if (!meta.backgroundState && !meta.pid && !meta.outputLog && !meta.cancelRequested && !meta.worktreePath) return null;
                  return (
                    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Executor metadata">
                      {meta.backgroundState ? (
                        <span className="rounded-full bg-sky-500/10 px-2 py-1 text-[9px] font-medium text-sky-300">
                          exec {meta.backgroundState}
                        </span>
                      ) : null}
                      {meta.pid ? (
                        <span className="rounded-full bg-surface-container-high px-2 py-1 text-[9px] text-on-surface-variant/55">
                          pid {meta.pid}
                        </span>
                      ) : null}
                      {meta.cancelRequested ? (
                        <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-medium text-amber-300">
                          cancel requested
                        </span>
                      ) : null}
                      {meta.worktreePath ? (
                        <span className="rounded-full bg-surface-container-high px-2 py-1 text-[9px] text-on-surface-variant/55">
                          worktree {meta.worktreePath.split(/[\\/]/).pop()}
                        </span>
                      ) : null}
                      {meta.outputLog ? (
                        <span className="rounded-full bg-surface-container-high px-2 py-1 text-[9px] text-on-surface-variant/55">
                          log ready
                        </span>
                      ) : null}
                    </div>
                  );
                })()}
                {task.progress_total > 0 && (
                  <div className="mt-3">
                    <ProgressCard
                      title={task.progress_step || 'Progress'}
                      steps={taskSteps(task)}
                      current={Math.min(task.progress_total, Math.max(0, Math.round((task.progress_pct / 100) * task.progress_total)))}
                      total={task.progress_total}
                    />
                  </div>
                )}
              </div>
            ))}

            {queued.length > 0 && (
              <div>
                <div className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/25">Queued</div>
                <div className="space-y-2">
                  {queued.map((task) => (
                    <div key={task.task_id} className="flex items-center gap-2 rounded-xl border border-outline-variant/10 px-3 py-2">
                      <span className="material-symbols-outlined text-[14px] text-on-surface-variant/40">
                        {task.status === 'paused' ? 'pause_circle' : 'schedule'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] text-on-surface/75">{task.title}</div>
                        <div className="text-[9px] text-on-surface-variant/35">
                          {timeAgo(task.created_at)}
                          {task.source_type === 'a2a' && task.source_ref ? ` · remote ${task.source_ref}` : ''}
                        </div>
                      </div>
                      {task.status === 'paused' && (
                        <button
                          onClick={() => pauseResumeTask(task)}
                          className="rounded-lg px-2 py-1 text-[10px] text-green-300 hover:bg-green-500/10"
                        >
                          Resume
                        </button>
                      )}
                      <button
                        onClick={() => cancelTask(task)}
                        className="rounded-lg px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/10"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {finished.length > 0 && (
              <div>
                <div className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/25">Recent</div>
                <div className="space-y-2">
                  {finished.map((task) => (
                    <div key={task.task_id} className="rounded-xl border border-outline-variant/5 px-3 py-2 opacity-75">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] text-on-surface/65">{task.title}</span>
                        <span className="text-[9px] uppercase tracking-wider text-on-surface-variant/30">{task.status}</span>
                      </div>
                      {(task.error || task.progress_step) && (
                        <div className="mt-1 text-[9px] text-on-surface-variant/35">{task.error || task.progress_step}</div>
                      )}
                      {task.source_type === 'a2a' && task.source_ref ? (
                        <div className="mt-1 text-[9px] text-on-surface-variant/35">remote {task.source_ref}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
