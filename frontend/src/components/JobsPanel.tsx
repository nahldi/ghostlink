import { useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import type { Job } from '../types';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: 'To Do', color: '#5de6ff' },
  done: { label: 'Active', color: '#d2bbff' },
  archived: { label: 'Closed', color: '#958da1' },
};

function JobCard({ job, onDragStart }: { job: Job; onDragStart: (e: React.DragEvent, job: Job) => void }) {
  const priorityColor =
    job.type === 'high' ? 'border-l-tertiary' :
    job.type === 'medium' ? 'border-l-secondary' :
    'border-l-primary';

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, job)}
      className={`glass-card rounded-xl p-4 border-l-2 ${priorityColor} cursor-grab hover:brightness-110 transition-all active:cursor-grabbing`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-sm font-bold text-on-surface leading-tight">
          {job.title}
        </div>
        <div className="text-[10px] text-outline uppercase font-bold whitespace-nowrap">
          #{job.id}
        </div>
      </div>
      {job.body && (
        <div className="text-xs text-on-surface-variant line-clamp-2 mb-2">
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

export function JobsPanel() {
  const jobs = useChatStore((s) => s.jobs);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const settings = useChatStore((s) => s.settings);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [dragError, setDragError] = useState('');

  const columns = ['open', 'done', 'archived'] as const;

  const handleCreate = async () => {
    if (!title.trim()) return;
    try {
      await api.createJob(title.trim(), activeChannel, settings.username);
      const res = await api.getJobs();
      useChatStore.getState().setJobs(res.jobs);
      setTitle('');
      setShowForm(false);
    } catch { /* ignored */ }
  };

  const handleDragStart = (e: React.DragEvent, job: Job) => {
    e.dataTransfer.setData('application/ghostlink-job', String(job.id));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStatus(status);
  };

  const handleDragLeave = () => {
    setDragOverStatus(null);
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    setDragOverStatus(null);
    const jobId = Number(e.dataTransfer.getData('application/ghostlink-job'));
    if (!jobId) return;
    const job = jobs.find(j => j.id === jobId);
    if (!job || job.status === targetStatus) return;
    setDragError('');
    try {
      await api.updateJob(jobId, { status: targetStatus as Job['status'] });
      useChatStore.getState().updateJob({ ...job, status: targetStatus as Job['status'] });
    } catch {
      setDragError('Failed to move job');
      setTimeout(() => setDragError(''), 3000);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
        <h2 className="text-sm font-bold text-on-surface uppercase tracking-widest">
          Jobs
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="p-1 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined text-lg">{showForm ? 'close' : 'add'}</span>
        </button>
      </div>

      {showForm && (
        <div className="px-4 py-3 border-b border-outline-variant/10 flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Job title..."
            className="flex-1 bg-surface-container rounded-lg px-3 py-1.5 text-xs text-on-surface outline-none border border-outline-variant/10 focus:border-primary/50"
            autoFocus
          />
          <button
            onClick={handleCreate}
            className="px-3 py-1.5 bg-primary-container text-on-primary-container rounded-lg text-xs font-medium hover:brightness-110 transition-all"
          >
            Create
          </button>
        </div>
      )}

      {dragError && (
        <div className="mx-4 mt-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] text-red-400/80">
          {dragError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {columns.map((status) => {
          const col = STATUS_LABELS[status];
          const items = jobs.filter((j) => j.status === status);
          const isOver = dragOverStatus === status;
          return (
            <div
              key={status}
              onDragOver={(e) => handleDragOver(e, status)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, status)}
              className={`rounded-xl transition-all ${isOver ? 'ring-2 ring-primary/30 bg-primary/5' : ''}`}
            >
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: col.color }}
                />
                <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  {col.label}
                </span>
                <span className="text-[10px] text-outline">{items.length}</span>
              </div>
              <div className="space-y-2 min-h-[40px]">
                {items.length === 0 ? (
                  <div className={`text-xs text-center py-4 rounded-lg border border-dashed transition-colors ${
                    isOver ? 'border-primary/30 text-primary/50' : 'border-outline-variant/10 text-outline-variant'
                  }`}>
                    {isOver ? 'Drop here' : 'No jobs'}
                  </div>
                ) : (
                  items.map((job) => <JobCard key={job.id} job={job} onDragStart={handleDragStart} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
