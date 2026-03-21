import { useChatStore } from '../stores/chatStore';
import type { Job } from '../types';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: 'To Do', color: '#5de6ff' },
  done: { label: 'Active', color: '#d2bbff' },
  archived: { label: 'Closed', color: '#958da1' },
};

function JobCard({ job }: { job: Job }) {
  const priorityColor =
    job.type === 'high' ? 'border-l-tertiary' :
    job.type === 'medium' ? 'border-l-secondary' :
    'border-l-primary';

  return (
    <div
      className={`glass-card rounded-xl p-4 border-l-2 ${priorityColor} cursor-pointer hover:brightness-110 transition-all`}
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

  const columns = ['open', 'done', 'archived'] as const;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
        <h2 className="text-sm font-bold text-on-surface uppercase tracking-widest">
          Jobs
        </h2>
        <button className="p-1 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors">
          <span className="material-symbols-outlined text-lg">add</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {columns.map((status) => {
          const col = STATUS_LABELS[status];
          const items = jobs.filter((j) => j.status === status);
          return (
            <div key={status}>
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
              <div className="space-y-2">
                {items.length === 0 ? (
                  <div className="text-xs text-outline-variant text-center py-4">
                    No jobs
                  </div>
                ) : (
                  items.map((job) => <JobCard key={job.id} job={job} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
