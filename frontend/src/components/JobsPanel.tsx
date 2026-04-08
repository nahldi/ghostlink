import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import { ProgressCard } from './ProgressCard';
import { toast } from './Toast';
import type { AuditEvent, Checkpoint, CircuitEvent, Job, ReplayState, Task, TaskStatus } from '../types';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: 'To Do', color: '#5de6ff' },
  done: { label: 'Active', color: '#d2bbff' },
  archived: { label: 'Closed', color: '#958da1' },
};

const TASK_STATUS_OPTIONS: TaskStatus[] = ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled', 'awaiting_approval', 'awaiting_input'];

function timeAgo(ts?: number | null): string {
  if (!ts) return 'Pending';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

function taskSteps(task: Task) {
  if (Array.isArray(task.progress_data)) return task.progress_data;
  if (Array.isArray((task.progress_data as { steps?: unknown[] })?.steps)) {
    return (task.progress_data as { steps: { label: string; status: 'done' | 'active' | 'pending' }[] }).steps;
  }
  return [];
}

function replayStateOf(task: Task): ReplayState | null {
  const state = (task.metadata?.replay_state || null) as ReplayState | null;
  return state && typeof state === 'object' ? state : null;
}

function lineageOf(task: Task) {
  return {
    forked_from_task_id: typeof task.metadata?.forked_from_task_id === 'string' ? task.metadata.forked_from_task_id : '',
    forked_from_checkpoint_id: typeof task.metadata?.forked_from_checkpoint_id === 'string' ? task.metadata.forked_from_checkpoint_id : '',
    forked_from_trace_id: typeof task.metadata?.forked_from_trace_id === 'string' ? task.metadata.forked_from_trace_id : '',
    artifact_refs: Array.isArray(task.metadata?.artifact_refs) ? task.metadata?.artifact_refs as Array<Record<string, unknown> | string> : [],
  };
}

function JobCard({ job, onDragStart }: { job: Job; onDragStart: (e: React.DragEvent, job: Job) => void }) {
  const priorityColor =
    job.type === 'high' ? 'border-l-tertiary' :
    job.type === 'medium' ? 'border-l-secondary' :
    'border-l-primary';

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, job)}
      className={`glass-card rounded-xl p-4 border-l-2 ${priorityColor} cursor-grab hover:brightness-110 hover:scale-[1.01] transition-all active:cursor-grabbing active:scale-[0.98] active:brightness-95`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="text-sm font-bold text-on-surface leading-tight">
          {job.title}
        </div>
        <div className="text-[10px] text-outline uppercase font-bold whitespace-nowrap">
          #{job.id}
        </div>
      </div>
      {job.body && (
        <div className="mb-2 text-xs text-on-surface-variant line-clamp-2">
          {job.body}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <div className="w-5 h-5 rounded-full bg-surface-container-highest flex items-center justify-center">
            <span className="text-[9px] font-bold text-on-surface-variant">
              {(job.assignee || '?').charAt(0).toUpperCase()}
            </span>
          </div>
          <span className="text-[10px] text-outline">{job.assignee || 'Unassigned'}</span>
        </div>
        <span className="text-[10px] text-outline">
          {new Date(job.created_at * 1000).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return <div className="rounded-xl border border-dashed border-outline-variant/10 px-4 py-6 text-center text-xs text-on-surface-variant/35">No audit events match these filters.</div>;
  }
  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div key={event.event_id} className="relative rounded-2xl border border-outline-variant/10 bg-surface-container-high/15 p-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary/75">
              {event.event_type}
            </span>
            <span className="text-[10px] text-on-surface-variant/40">{timeAgo(event.timestamp)}</span>
            {event.outcome && (
              <span className="text-[9px] uppercase tracking-wider text-on-surface-variant/30">{event.outcome}</span>
            )}
          </div>
          <div className="text-[11px] font-medium text-on-surface">{event.action || event.event_type}</div>
          <div className="mt-1 text-[10px] text-on-surface-variant/50">
            {event.actor || 'system'}
            {event.agent_name ? ` · ${event.agent_name}` : ''}
            {event.channel ? ` · #${event.channel}` : ''}
            {event.task_id ? ` · task ${event.task_id.slice(0, 8)}` : ''}
            {event.trace_id ? ` · trace ${event.trace_id.slice(0, 8)}` : ''}
          </div>
          {(event.profile_id || event.provider || Object.keys(event.detail || {}).length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {event.profile_id && <span className="rounded-full bg-secondary/10 px-1.5 py-0.5 text-[9px] text-secondary/75">profile {event.profile_id}</span>}
              {event.provider && <span className="rounded-full bg-tertiary/10 px-1.5 py-0.5 text-[9px] text-tertiary/75">{event.provider}</span>}
              {Object.entries(event.detail || {}).slice(0, 3).map(([key, value]) => (
                <span key={key} className="rounded-full bg-surface-container-highest/40 px-1.5 py-0.5 text-[9px] text-on-surface-variant/55">
                  {key}: {typeof value === 'string' ? value : JSON.stringify(value)}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function JobsPanel() {
  const jobs = useChatStore((s) => s.jobs);
  const tasks = useChatStore((s) => s.tasks);
  const messages = useChatStore((s) => s.messages);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const settings = useChatStore((s) => s.settings);
  const setJobs = useChatStore((s) => s.setJobs);
  const setTasks = useChatStore((s) => s.setTasks);
  const updateJob = useChatStore((s) => s.updateJob);
  const upsertTask = useChatStore((s) => s.upsertTask);

  const [mode, setMode] = useState<'tasks' | 'jobs' | 'audit'>('tasks');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showJobForm, setShowJobForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedAgent, setAssignedAgent] = useState('');
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [dragError, setDragError] = useState('');
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>('all');
  const [taskAgentFilter, setTaskAgentFilter] = useState<string>('all');
  const [taskSourceFilter, setTaskSourceFilter] = useState<string>('all');
  const [auditAgentFilter, setAuditAgentFilter] = useState('');
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [circuitEvents, setCircuitEvents] = useState<CircuitEvent[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskCheckpoints, setTaskCheckpoints] = useState<Record<string, Checkpoint[]>>({});
  const [loadingCheckpoints, setLoadingCheckpoints] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    api.getJobs(activeChannel).then((res) => {
      if (!cancelled) setJobs(res.jobs);
    }).catch(() => undefined);
    api.getTasks({ channel: activeChannel, limit: 100 }).then((res) => {
      if (!cancelled) setTasks(res.tasks);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeChannel, setJobs, setTasks]);

  useEffect(() => {
    if (mode !== 'audit') return;
    let cancelled = false;
    setLoadingAudit(true);
    Promise.all([
      api.getAuditEvents({ channel: activeChannel, agent: auditAgentFilter || undefined, limit: 100 }),
      api.getCircuitEvents(50),
    ])
      .then(([audit, circuits]) => {
        if (!cancelled) {
          setAuditEvents(audit.events);
          setCircuitEvents(circuits.events);
        }
      })
      .catch(() => {
        if (!cancelled) toast('Failed to load audit events', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoadingAudit(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, activeChannel, auditAgentFilter]);

  const channelTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.channel === activeChannel)
        .filter((task) => taskStatusFilter === 'all' ? true : task.status === taskStatusFilter)
        .filter((task) => taskAgentFilter === 'all' ? true : (task.agent_name || 'unassigned') === taskAgentFilter)
        .filter((task) => taskSourceFilter === 'all' ? true : task.source_type === taskSourceFilter)
        .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)),
    [tasks, activeChannel, taskStatusFilter, taskAgentFilter, taskSourceFilter]
  );

  const taskAgents = useMemo(
    () => Array.from(new Set(tasks.filter((task) => task.channel === activeChannel).map((task) => task.agent_name || 'unassigned'))).sort(),
    [tasks, activeChannel]
  );

  const taskSources = useMemo(
    () => Array.from(new Set(tasks.filter((task) => task.channel === activeChannel).map((task) => task.source_type))).sort(),
    [tasks, activeChannel]
  );

  const approvalRequests = useMemo(
    () =>
      messages
        .filter((message) => message.channel === activeChannel && message.type === 'approval_request')
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 8),
    [messages, activeChannel]
  );

  const handleCreateTask = async () => {
    if (!title.trim()) return;
    try {
      const task = await api.createTask({
        title: title.trim(),
        description: description.trim(),
        channel: activeChannel,
        agent_name: assignedAgent || undefined,
        created_by: settings.username,
      });
      upsertTask(task);
      setTitle('');
      setDescription('');
      setAssignedAgent('');
      setShowTaskForm(false);
    } catch {
      toast('Failed to create task', 'error');
    }
  };

  const handleCreateJob = async () => {
    if (!title.trim()) return;
    try {
      await api.createJob(title.trim(), activeChannel, settings.username, assignedAgent || undefined, description.trim() || undefined);
      const res = await api.getJobs(activeChannel);
      setJobs(res.jobs);
      setTitle('');
      setDescription('');
      setAssignedAgent('');
      setShowJobForm(false);
    } catch {
      toast('Failed to create job', 'error');
    }
  };

  const handleDragStart = (e: React.DragEvent, job: Job) => {
    e.dataTransfer.setData('application/ghostlink-job', String(job.id));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    setDragOverStatus(null);
    const jobId = Number(e.dataTransfer.getData('application/ghostlink-job'));
    if (!jobId) return;
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.status === targetStatus) return;
    setDragError('');
    try {
      await api.updateJob(jobId, { status: targetStatus as Job['status'] });
      updateJob({ ...job, status: targetStatus as Job['status'] });
    } catch {
      setDragError('Failed to move job');
      setTimeout(() => setDragError(''), 3000);
    }
  };

  const loadCheckpoints = async (taskId: string) => {
    setLoadingCheckpoints((current) => ({ ...current, [taskId]: true }));
    try {
      const result = await api.getTaskCheckpoints(taskId);
      setTaskCheckpoints((current) => ({ ...current, [taskId]: result.checkpoints }));
      return result.checkpoints;
    } catch {
      toast('Failed to load checkpoints', 'error');
      return [];
    } finally {
      setLoadingCheckpoints((current) => ({ ...current, [taskId]: false }));
    }
  };

  const ensureCheckpoints = async (taskId: string) => {
    if (taskCheckpoints[taskId]) return taskCheckpoints[taskId];
    return loadCheckpoints(taskId);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-outline-variant/10 px-6 py-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-on-surface">Operator</h2>
          <p className="mt-1 text-[10px] text-on-surface-variant/35">Tasks, jobs, and audit truth for #{activeChannel}</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-surface-container-high/20 p-1">
          {(['tasks', 'jobs', 'audit'] as const).map((entry) => (
            <button
              key={entry}
              onClick={() => setMode(entry)}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                mode === entry ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/45 hover:text-on-surface'
              }`}
            >
              {entry}
            </button>
          ))}
        </div>
      </div>

      {mode === 'tasks' && (
        <>
          <div className="flex items-center gap-2 border-b border-outline-variant/10 px-4 py-3">
            <button
              onClick={() => setShowTaskForm((v) => !v)}
              className="rounded-lg bg-primary/10 px-3 py-1.5 text-[10px] font-medium text-primary hover:bg-primary/20"
            >
              {showTaskForm ? 'Close' : 'New task'}
            </button>
            <select
              value={taskStatusFilter}
              onChange={(e) => setTaskStatusFilter(e.target.value)}
              className="rounded-lg border border-outline-variant/10 bg-surface-container-high/30 px-2 py-1.5 text-[10px] text-on-surface outline-none"
            >
              <option value="all">All statuses</option>
              {TASK_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <select
              value={taskAgentFilter}
              onChange={(e) => setTaskAgentFilter(e.target.value)}
              className="rounded-lg border border-outline-variant/10 bg-surface-container-high/30 px-2 py-1.5 text-[10px] text-on-surface outline-none"
            >
              <option value="all">All agents</option>
              {taskAgents.map((agent) => (
                <option key={agent} value={agent}>{agent}</option>
              ))}
            </select>
            <select
              value={taskSourceFilter}
              onChange={(e) => setTaskSourceFilter(e.target.value)}
              className="rounded-lg border border-outline-variant/10 bg-surface-container-high/30 px-2 py-1.5 text-[10px] text-on-surface outline-none"
            >
              <option value="all">All sources</option>
              {taskSources.map((source) => (
                <option key={source} value={source}>{source}</option>
              ))}
            </select>
          </div>

          {showTaskForm && (
            <div className="space-y-2 border-b border-outline-variant/10 px-4 py-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title..."
                className="w-full rounded-lg border border-outline-variant/10 bg-surface-container px-3 py-2 text-xs text-on-surface outline-none"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description..."
                rows={2}
                className="w-full resize-none rounded-lg border border-outline-variant/10 bg-surface-container px-3 py-2 text-xs text-on-surface outline-none"
              />
              <input
                value={assignedAgent}
                onChange={(e) => setAssignedAgent(e.target.value)}
                placeholder="Assign to agent name (optional)..."
                className="w-full rounded-lg border border-outline-variant/10 bg-surface-container px-3 py-2 text-xs text-on-surface outline-none"
              />
              <button
                onClick={handleCreateTask}
                className="rounded-lg bg-primary px-3 py-1.5 text-[10px] font-semibold text-on-primary"
              >
                Create task
              </button>
            </div>
          )}

          <div className="flex-1 overflow-auto p-4">
            {approvalRequests.length > 0 && (
              <div className="mb-4 rounded-2xl border border-amber-500/15 bg-amber-500/5 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">Approval Queue</div>
                    <div className="text-[10px] text-on-surface-variant/40">Real pending prompts from agents in #{activeChannel}. Edit-and-run is not exposed by the backend yet, so this queue stays on the real approve/deny path.</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {approvalRequests.map((message) => {
                    const metadata = typeof message.metadata === 'string'
                      ? (() => { try { return JSON.parse(message.metadata) as Record<string, unknown>; } catch { return {}; } })()
                      : ((message.metadata as Record<string, unknown> | undefined) || {});
                    const responded = typeof metadata.responded === 'string' ? metadata.responded : '';
                    const agentName = String(metadata.agent || message.sender || '');
                    return (
                      <div key={message.id} className="rounded-xl border border-outline-variant/10 bg-surface-container-high/15 p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-300/80">approval</span>
                          <span className="text-[10px] text-on-surface-variant/40">{agentName}</span>
                          {responded && <span className="text-[10px] text-on-surface-variant/35">responded: {responded}</span>}
                        </div>
                        <div className="text-[10px] text-on-surface-variant/55 whitespace-pre-wrap">{String(metadata.context || message.text || '')}</div>
                        {!responded && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={async () => {
                                try {
                                  await api.respondApproval(agentName, 'allow_once', message.id);
                                  toast('Allowed once', 'success');
                                } catch {
                                  toast('Approval response failed', 'error');
                                }
                              }}
                              className="rounded-lg bg-green-500/10 px-2 py-1 text-[10px] font-medium text-green-300 hover:bg-green-500/20"
                            >
                              Approve
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  await api.respondApproval(agentName, 'allow_session', message.id);
                                  toast('Allowed for session', 'success');
                                } catch {
                                  toast('Approval response failed', 'error');
                                }
                              }}
                              className="rounded-lg bg-blue-500/10 px-2 py-1 text-[10px] font-medium text-blue-300 hover:bg-blue-500/20"
                            >
                              Approve session
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  await api.respondApproval(agentName, 'deny', message.id);
                                  toast('Denied', 'info');
                                } catch {
                                  toast('Approval response failed', 'error');
                                }
                              }}
                              className="rounded-lg bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-300 hover:bg-red-500/20"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="space-y-3">
              {channelTasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-outline-variant/10 px-4 py-6 text-center text-xs text-on-surface-variant/35">
                  No tasks for this channel yet.
                </div>
              ) : (
                channelTasks.map((task) => (
                  <div key={task.task_id} className="rounded-2xl border border-outline-variant/10 bg-surface-container-high/15 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[11px] font-semibold text-on-surface">{task.title}</span>
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary/75">
                            {task.status.replace('_', ' ')}
                          </span>
                          <span className="rounded-full bg-surface-container-highest/40 px-1.5 py-0.5 text-[9px] text-on-surface-variant/45">
                            {task.source_type}
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] text-on-surface-variant/45">
                          {task.agent_name || 'unassigned'} · {timeAgo(task.updated_at)}
                          {task.trace_id ? ` · ${task.trace_id.slice(0, 8)}` : ''}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {typeof task.metadata?.sandbox_tier === 'string' && (
                            <span className="rounded-full bg-surface-container-highest/40 px-1.5 py-0.5 text-[9px] text-on-surface-variant/55">
                              sandbox {String(task.metadata.sandbox_tier)}
                            </span>
                          )}
                          {Boolean(task.metadata?.policy_snapshot) && (
                            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary/80">
                              policy snapshot
                            </span>
                          )}
                          {Array.isArray(task.metadata?.pending_approvals) && task.metadata.pending_approvals.length > 0 && (
                            <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-300/80">
                              {task.metadata.pending_approvals.length} pending approvals
                            </span>
                          )}
                          {Array.isArray(task.metadata?.secret_scopes) && task.metadata.secret_scopes.length > 0 && (
                            <span className="rounded-full bg-secondary/10 px-1.5 py-0.5 text-[9px] text-secondary/75">
                              {task.metadata.secret_scopes.length} secret scopes
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {['running', 'awaiting_approval', 'awaiting_input', 'interrupted'].includes(task.status) && (
                          <button
                            onClick={async () => {
                              try {
                                upsertTask(await api.pauseTask(task.task_id));
                              } catch {
                                toast('Failed to pause task', 'error');
                              }
                            }}
                            className="rounded-lg bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-400 hover:bg-amber-500/20"
                          >
                            Pause
                          </button>
                        )}
                        {(task.status === 'paused' || task.status === 'interrupted') && (
                          <button
                            onClick={async () => {
                              try {
                                upsertTask(await api.resumeTask(task.task_id));
                              } catch {
                                toast('Failed to resume task', 'error');
                              }
                            }}
                            className="rounded-lg bg-green-500/10 px-2 py-1 text-[10px] font-medium text-green-400 hover:bg-green-500/20"
                          >
                            Resume
                          </button>
                        )}
                        {['running', 'queued', 'paused', 'awaiting_approval', 'awaiting_input', 'interrupted'].includes(task.status) && (
                          <button
                            onClick={async () => {
                              try {
                                upsertTask(await api.cancelTask(task.task_id));
                              } catch {
                                toast('Failed to cancel task', 'error');
                              }
                            }}
                            className="rounded-lg bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/20"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                    {task.description && <p className="mt-2 text-[10px] text-on-surface-variant/55">{task.description}</p>}
                    {replayStateOf(task)?.active && (
                      <div className="mt-2 rounded-xl border border-blue-500/20 bg-blue-500/5 p-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-blue-300/80">
                            replay {replayStateOf(task)?.mode}
                          </span>
                          <span className="text-[9px] text-on-surface-variant/35">
                            {replayStateOf(task)?.journal_entries || 0} journal entries
                          </span>
                        </div>
                        {Array.isArray(replayStateOf(task)?.replay_blocked_tools) && replayStateOf(task)!.replay_blocked_tools!.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <div className="text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Skipped / Replay-blocked</div>
                            <div className="flex flex-wrap gap-1.5">
                              {replayStateOf(task)!.replay_blocked_tools!.map((tool) => (
                                <span key={tool} className="rounded-full bg-surface-container-highest/40 px-1.5 py-0.5 text-[9px] text-on-surface-variant/60">
                                  {tool}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
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
                    {task.error && <div className="mt-2 text-[10px] text-red-400/75">{task.error}</div>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={async () => {
                          try {
                            await api.createTaskCheckpoint(task.task_id, `Operator checkpoint ${new Date().toLocaleTimeString()}`);
                            await loadCheckpoints(task.task_id);
                            toast('Checkpoint saved', 'success');
                          } catch {
                            toast('Failed to create checkpoint', 'error');
                          }
                        }}
                        className="rounded-lg bg-primary/10 px-2 py-1 text-[10px] text-primary hover:bg-primary/20"
                      >
                        Save checkpoint
                      </button>
                      <button
                        onClick={async () => {
                          const cps = await ensureCheckpoints(task.task_id);
                          try {
                            const result = await api.forkTask(task.task_id, cps[cps.length - 1]?.checkpoint_id);
                            upsertTask(result.task);
                            toast('Forked from latest checkpoint', 'success');
                          } catch {
                            toast('Failed to fork task', 'error');
                          }
                        }}
                        className="rounded-lg bg-secondary/10 px-2 py-1 text-[10px] text-secondary hover:bg-secondary/20"
                      >
                        Fork
                      </button>
                      <button
                        onClick={async () => {
                          const cps = await ensureCheckpoints(task.task_id);
                          try {
                            const result = await api.replayTask(task.task_id, {
                              checkpoint_id: cps[cps.length - 1]?.checkpoint_id,
                              mode: 'readonly',
                            });
                            upsertTask(result.task);
                            toast('Read-only replay started', 'success');
                          } catch {
                            toast('Failed to start read-only replay', 'error');
                          }
                        }}
                        className="rounded-lg bg-blue-500/10 px-2 py-1 text-[10px] text-blue-300 hover:bg-blue-500/20"
                      >
                        Read-only replay
                      </button>
                      <button
                        onClick={async () => {
                          const cps = await ensureCheckpoints(task.task_id);
                          try {
                            const result = await api.replayTask(task.task_id, {
                              checkpoint_id: cps[cps.length - 1]?.checkpoint_id,
                              mode: 'live',
                            });
                            upsertTask(result.task);
                            toast('Live replay fork started', 'success');
                          } catch {
                            toast('Failed to start live replay', 'error');
                          }
                        }}
                        className="rounded-lg bg-green-500/10 px-2 py-1 text-[10px] text-green-300 hover:bg-green-500/20"
                      >
                        Live replay
                      </button>
                      {replayStateOf(task)?.active && (
                        <button
                          onClick={async () => {
                            try {
                              await api.stopReplay(task.task_id);
                              const refreshed = await api.getTasks({ channel: activeChannel, limit: 100 });
                              setTasks(refreshed.tasks);
                              toast('Replay stopped', 'info');
                            } catch {
                              toast('Failed to stop replay', 'error');
                            }
                          }}
                          className="rounded-lg bg-red-500/10 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/20"
                        >
                          Stop replay
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          setExpandedTaskId((current) => current === task.task_id ? null : task.task_id);
                          if (!taskCheckpoints[task.task_id]) await loadCheckpoints(task.task_id);
                        }}
                        className="rounded-lg bg-surface-container-highest/40 px-2 py-1 text-[10px] text-on-surface-variant/60 hover:text-on-surface"
                      >
                        {expandedTaskId === task.task_id ? 'Hide lineage' : 'Show lineage'}
                      </button>
                    </div>
                    {expandedTaskId === task.task_id && (
                      <div className="mt-3 space-y-3 rounded-xl border border-outline-variant/10 bg-surface-container-high/10 p-3">
                        <div>
                          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Lineage</div>
                          <div className="space-y-1 text-[10px] text-on-surface-variant/55">
                            {lineageOf(task).forked_from_task_id && <div>Parent task: {lineageOf(task).forked_from_task_id.slice(0, 12)}</div>}
                            {lineageOf(task).forked_from_checkpoint_id && <div>Parent checkpoint: {lineageOf(task).forked_from_checkpoint_id.slice(0, 12)}</div>}
                            {lineageOf(task).forked_from_trace_id && <div>Parent trace: {lineageOf(task).forked_from_trace_id.slice(0, 12)}</div>}
                            {lineageOf(task).artifact_refs.length > 0 && <div>Artifacts: {lineageOf(task).artifact_refs.length}</div>}
                            {!lineageOf(task).forked_from_task_id && lineageOf(task).artifact_refs.length === 0 && <div>No branch lineage attached yet.</div>}
                          </div>
                        </div>
                        <div>
                          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Checkpoint Timeline</div>
                          {loadingCheckpoints[task.task_id] ? (
                            <div className="text-[10px] text-on-surface-variant/35">Loading checkpoints...</div>
                          ) : (taskCheckpoints[task.task_id] || []).length === 0 ? (
                            <div className="text-[10px] text-on-surface-variant/35">No checkpoints yet.</div>
                          ) : (
                            <div className="space-y-2">
                              {(taskCheckpoints[task.task_id] || []).map((cp) => (
                                <div key={cp.checkpoint_id} className="rounded-lg bg-surface-container-highest/35 px-2.5 py-2">
                                  <div className="flex items-center gap-2">
                                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary/75">{cp.trigger}</span>
                                    <span className="text-[9px] text-on-surface-variant/35">#{cp.sequence_num}</span>
                                    <span className="text-[9px] text-on-surface-variant/35">{timeAgo(cp.created_at)}</span>
                                  </div>
                                  <div className="mt-1 text-[10px] text-on-surface-variant/55">
                                    {String((cp.state_snapshot?.task as Record<string, unknown> | undefined)?.progress_step || (cp.state_snapshot?.task as Record<string, unknown> | undefined)?.status || cp.trigger)}
                                  </div>
                                  {cp.pending_actions.length > 0 && (
                                    <div className="mt-1 text-[9px] text-amber-300/75">{cp.pending_actions.length} pending actions</div>
                                  )}
                                  {cp.artifact_refs.length > 0 && (
                                    <div className="mt-1 text-[9px] text-on-surface-variant/35">{cp.artifact_refs.length} artifact refs</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {mode === 'jobs' && (
        <>
          <div className="flex items-center gap-2 border-b border-outline-variant/10 px-4 py-3">
            <button
              onClick={() => setShowJobForm((v) => !v)}
              className="rounded-lg bg-primary/10 px-3 py-1.5 text-[10px] font-medium text-primary hover:bg-primary/20"
            >
              {showJobForm ? 'Close' : 'New job'}
            </button>
          </div>
          {showJobForm && (
            <div className="space-y-2 border-b border-outline-variant/10 px-4 py-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Job title..."
                className="w-full rounded-lg border border-outline-variant/10 bg-surface-container px-3 py-2 text-xs text-on-surface outline-none"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Job body..."
                rows={2}
                className="w-full resize-none rounded-lg border border-outline-variant/10 bg-surface-container px-3 py-2 text-xs text-on-surface outline-none"
              />
              <input
                value={assignedAgent}
                onChange={(e) => setAssignedAgent(e.target.value)}
                placeholder="Assignee..."
                className="w-full rounded-lg border border-outline-variant/10 bg-surface-container px-3 py-2 text-xs text-on-surface outline-none"
              />
              <button
                onClick={handleCreateJob}
                className="rounded-lg bg-primary px-3 py-1.5 text-[10px] font-semibold text-on-primary"
              >
                Create job
              </button>
            </div>
          )}

          {dragError && (
            <div className="mx-4 mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[10px] text-red-400/80">
              {dragError}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {(['open', 'done', 'archived'] as const).map((status) => {
              const col = STATUS_LABELS[status];
              const items = jobs.filter((j) => j.status === status);
              const isOver = dragOverStatus === status;
              return (
                <div
                  key={status}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverStatus(status);
                  }}
                  onDragLeave={() => setDragOverStatus(null)}
                  onDrop={(e) => void handleDrop(e, status)}
                  className={`rounded-xl transition-all ${isOver ? 'ring-2 ring-primary/30 bg-primary/5' : ''}`}
                >
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: col.color }} />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{col.label}</span>
                    <span className="text-[10px] text-outline">{items.length}</span>
                  </div>
                  <div className="min-h-[40px] space-y-2">
                    {items.length === 0 ? (
                      <div className={`rounded-xl border border-dashed py-6 text-center text-xs transition-colors ${
                        isOver ? 'border-primary/30 text-primary/50 bg-primary/5' : 'border-outline-variant/10 text-outline-variant'
                      }`}>
                        {isOver ? 'Drop here' : 'No jobs yet'}
                      </div>
                    ) : (
                      items.map((job) => <JobCard key={job.id} job={job} onDragStart={handleDragStart} />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {mode === 'audit' && (
        <>
          <div className="flex items-center gap-2 border-b border-outline-variant/10 px-4 py-3">
            <input
              value={auditAgentFilter}
              onChange={(e) => setAuditAgentFilter(e.target.value)}
              placeholder="Filter by agent..."
              className="flex-1 rounded-lg border border-outline-variant/10 bg-surface-container-high/30 px-3 py-1.5 text-[10px] text-on-surface outline-none"
            />
            <button
              onClick={async () => {
                try {
                  const exported = await api.exportAudit({ format: 'csv', channel: activeChannel, agent: auditAgentFilter || undefined, limit: 1000 });
                  if (typeof exported !== 'string') throw new Error('csv export did not return text');
                  const csv = exported;
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${activeChannel}-audit.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  toast('Failed to export audit log', 'error');
                }
              }}
              className="rounded-lg bg-primary/10 px-3 py-1.5 text-[10px] font-medium text-primary hover:bg-primary/20"
            >
              Export CSV
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {loadingAudit ? (
              <div className="text-xs text-on-surface-variant/40">Loading audit timeline...</div>
            ) : (
              <div className="space-y-4">
                {circuitEvents.length > 0 && (
                  <div className="rounded-2xl border border-red-500/15 bg-red-500/5 p-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-red-300/80">Circuit Breakers</div>
                    <div className="space-y-2">
                      {circuitEvents.slice(0, 8).map((event, index) => (
                        <div key={`${event.id || index}-${event.created_at || 0}`} className="rounded-xl border border-outline-variant/10 bg-surface-container-high/15 p-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-red-300/80">
                              {String(event.trigger_type || event.event_key || 'breaker')}
                            </span>
                            {event.agent_name && <span className="text-[10px] text-on-surface-variant/45">{event.agent_name}</span>}
                            {event.cooldown_until && <span className="text-[10px] text-on-surface-variant/35">until {new Date(event.cooldown_until * 1000).toLocaleTimeString()}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <AuditTimeline events={auditEvents} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
