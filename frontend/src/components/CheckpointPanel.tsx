import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import { toast } from './Toast';
import type { Agent, Checkpoint, Task } from '../types';

function timeAgo(ts?: number | null): string {
  if (!ts) return 'Pending';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

function checkpointStatus(cp: Checkpoint): string {
  const task = cp.state_snapshot?.task as Record<string, unknown> | undefined;
  return String(task?.status || cp.trigger || 'checkpoint');
}

function checkpointStep(cp: Checkpoint): string {
  const task = cp.state_snapshot?.task as Record<string, unknown> | undefined;
  return String(task?.progress_step || '');
}

function artifactCount(cp: Checkpoint): number {
  if (Array.isArray(cp.artifact_refs)) return cp.artifact_refs.length;
  return 0;
}

export function CheckpointPanel({ agent }: { agent: Agent }) {
  const tasks = useChatStore((s) => s.tasks);
  const upsertTask = useChatStore((s) => s.upsertTask);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<Checkpoint | null>(null);
  const [label, setLabel] = useState('');

  const agentTasks = useMemo(
    () => tasks.filter((task) => task.agent_name === agent.name).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)),
    [tasks, agent.name]
  );

  const selectedTask: Task | undefined = agentTasks.find((task) => task.task_id === selectedTaskId) || agentTasks[0];

  useEffect(() => {
    if (!selectedTaskId && agentTasks[0]) {
      setSelectedTaskId(agentTasks[0].task_id);
    }
  }, [agentTasks, selectedTaskId]);

  useEffect(() => {
    if (!selectedTask?.task_id) {
      setCheckpoints([]);
      setSelectedCheckpoint(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.getTaskCheckpoints(selectedTask.task_id)
      .then((data) => {
        if (cancelled) return;
        setCheckpoints(data.checkpoints);
        setSelectedCheckpoint((current) =>
          current && data.checkpoints.some((cp) => cp.checkpoint_id === current.checkpoint_id)
            ? current
            : data.checkpoints[data.checkpoints.length - 1] || null
        );
      })
      .catch(() => {
        if (!cancelled) toast('Failed to load checkpoints', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTask?.task_id]);

  const createCheckpoint = async () => {
    if (!selectedTask?.task_id || creating) return;
    setCreating(true);
    try {
      const result = await api.createTaskCheckpoint(selectedTask.task_id, label.trim() || undefined);
      if (result.checkpoint) {
        setCheckpoints((prev) => [...prev, result.checkpoint as Checkpoint]);
        setSelectedCheckpoint(result.checkpoint);
      }
      setLabel('');
      toast('Checkpoint saved', 'success');
    } catch {
      toast('Failed to create checkpoint', 'error');
    } finally {
      setCreating(false);
    }
  };

  const pauseResume = async () => {
    if (!selectedTask) return;
    try {
      const next = selectedTask.status === 'paused' || selectedTask.status === 'interrupted'
        ? await api.resumeTask(selectedTask.task_id)
        : await api.pauseTask(selectedTask.task_id);
      upsertTask(next);
      toast(next.status === 'paused' ? 'Task paused' : 'Task resumed', 'success');
    } catch {
      toast('Failed to change task state', 'error');
    }
  };

  const compact = async () => {
    if (!selectedTask) return;
    try {
      const result = await api.compactTaskCheckpoints(selectedTask.task_id, 3);
      toast(`Compacted ${result.deleted} checkpoints`, 'info');
      const refreshed = await api.getTaskCheckpoints(selectedTask.task_id);
      setCheckpoints(refreshed.checkpoints);
      setSelectedCheckpoint(refreshed.checkpoints[refreshed.checkpoints.length - 1] || null);
    } catch {
      toast('Failed to compact checkpoints', 'error');
    }
  };

  const deleteSelected = async () => {
    if (!selectedCheckpoint) return;
    try {
      await api.deleteCheckpoint(selectedCheckpoint.checkpoint_id);
      const refreshed = checkpoints.filter((cp) => cp.checkpoint_id !== selectedCheckpoint.checkpoint_id);
      setCheckpoints(refreshed);
      setSelectedCheckpoint(refreshed[refreshed.length - 1] || null);
      toast('Checkpoint deleted', 'info');
    } catch {
      toast('Failed to delete checkpoint', 'error');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-outline-variant/10 px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm" style={{ color: agent.color }}>save</span>
          <span className="text-[11px] font-medium text-on-surface/70">Checkpoints</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <select
            value={selectedTask?.task_id || ''}
            onChange={(e) => setSelectedTaskId(e.target.value)}
            className="flex-1 rounded-lg border border-outline-variant/10 bg-surface-container-high/30 px-2 py-1.5 text-[10px] text-on-surface outline-none"
          >
            {agentTasks.map((task) => (
              <option key={task.task_id} value={task.task_id}>
                {task.title}
              </option>
            ))}
          </select>
          <button
            onClick={pauseResume}
            disabled={!selectedTask}
            className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-[10px] font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            {selectedTask?.status === 'paused' || selectedTask?.status === 'interrupted' ? 'Resume' : 'Pause'}
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createCheckpoint()}
            placeholder="Manual checkpoint label..."
            className="flex-1 rounded-lg border border-outline-variant/10 bg-surface-container px-2.5 py-1.5 text-[10px] text-on-surface outline-none"
          />
          <button
            onClick={createCheckpoint}
            disabled={!selectedTask || creating}
            className="rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-medium text-on-primary disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={compact}
            disabled={!selectedTask}
            className="rounded-lg bg-surface-container-high/40 px-2.5 py-1.5 text-[10px] text-on-surface-variant/60 hover:text-on-surface"
          >
            Compact
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[48%] overflow-auto border-r border-outline-variant/10">
          {loading ? (
            <div className="p-4 text-xs text-on-surface-variant/40">Loading checkpoints...</div>
          ) : checkpoints.length === 0 ? (
            <div className="p-4 text-xs text-on-surface-variant/35">No task-level checkpoints yet.</div>
          ) : (
            <div className="py-1">
              {checkpoints.map((cp) => (
                <button
                  key={cp.checkpoint_id}
                  onClick={() => setSelectedCheckpoint(cp)}
                  className={`w-full border-b border-outline-variant/5 px-3 py-2.5 text-left transition-colors hover:bg-surface-container-high/20 ${
                    selectedCheckpoint?.checkpoint_id === cp.checkpoint_id ? 'bg-primary/8' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary/75">
                      {cp.trigger}
                    </span>
                    <span className="text-[9px] text-on-surface-variant/35">#{cp.sequence_num}</span>
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-on-surface">{checkpointStep(cp) || checkpointStatus(cp)}</div>
                  <div className="mt-1 text-[9px] text-on-surface-variant/35">
                    {timeAgo(cp.created_at)} · {artifactCount(cp)} artifacts
                    {cp.pending_actions.length > 0 ? ` · ${cp.pending_actions.length} pending` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-3">
          {!selectedCheckpoint ? (
            <div className="text-xs text-on-surface-variant/35">Select a checkpoint to inspect its execution state.</div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold text-on-surface">Checkpoint #{selectedCheckpoint.sequence_num}</div>
                  <div className="text-[9px] text-on-surface-variant/35">{selectedCheckpoint.checkpoint_id.slice(0, 12)} · {timeAgo(selectedCheckpoint.created_at)}</div>
                </div>
                <button
                  onClick={deleteSelected}
                  className="rounded-lg bg-red-500/10 px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/20"
                >
                  Delete
                </button>
              </div>

              <div className="rounded-xl border border-outline-variant/10 p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">State</div>
                <div className="space-y-1 text-[10px] text-on-surface-variant/55">
                  <div>Status: {checkpointStatus(selectedCheckpoint)}</div>
                  {checkpointStep(selectedCheckpoint) && <div>Step: {checkpointStep(selectedCheckpoint)}</div>}
                  <div>Trigger: {selectedCheckpoint.trigger}</div>
                  {selectedCheckpoint.trace_id && <div>Trace: {selectedCheckpoint.trace_id.slice(0, 12)}</div>}
                  {selectedCheckpoint.worktree_ref && <div>Worktree: {selectedCheckpoint.worktree_ref}</div>}
                </div>
              </div>

              {selectedCheckpoint.pending_actions.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">Pending Actions</div>
                  <div className="space-y-1 text-[10px] text-amber-100/70">
                    {selectedCheckpoint.pending_actions.map((item, index) => (
                      <div key={index}>{JSON.stringify(item)}</div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-outline-variant/10 p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Artifact Lineage</div>
                {selectedCheckpoint.artifact_refs.length === 0 ? (
                  <div className="text-[10px] text-on-surface-variant/35">No artifacts attached to this checkpoint.</div>
                ) : (
                  <div className="space-y-2">
                    {selectedCheckpoint.artifact_refs.map((artifact, index) => (
                      <div key={index} className="rounded-lg bg-surface-container-high/20 px-2.5 py-2 text-[10px] text-on-surface-variant/55">
                        {typeof artifact === 'string' ? artifact : JSON.stringify(artifact)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-outline-variant/10 p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Tool Journal</div>
                <div className="space-y-2">
                  {Array.isArray(selectedCheckpoint.state_snapshot?.tool_journal) && selectedCheckpoint.state_snapshot.tool_journal.length > 0 ? (
                    selectedCheckpoint.state_snapshot.tool_journal.slice(-8).map((entry, index) => (
                      <div key={index} className="rounded-lg bg-surface-container-high/20 px-2.5 py-2 text-[10px] text-on-surface-variant/55">
                        {JSON.stringify(entry)}
                      </div>
                    ))
                  ) : (
                    <div className="text-[10px] text-on-surface-variant/35">No journal entries captured here.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
