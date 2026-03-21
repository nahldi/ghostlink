import { useChatStore } from '../stores/chatStore';
import { AgentIcon } from './AgentIcon';

interface HandoffCardProps {
  from: string;
  to: string;
  task: string;
  status: 'pending' | 'accepted' | 'in_progress' | 'complete';
}

const STATUS_STYLES: Record<HandoffCardProps['status'], { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: 'PENDING' },
  accepted: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'ACCEPTED' },
  in_progress: { bg: 'bg-purple-500/10', text: 'text-purple-400', label: 'IN PROGRESS' },
  complete: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'COMPLETE' },
};

export function HandoffCard({ from, to, task, status }: HandoffCardProps) {
  const agents = useChatStore((s) => s.agents);
  const fromAgent = agents.find((a) => a.name === from);
  const toAgent = agents.find((a) => a.name === to);
  const style = STATUS_STYLES[status];

  return (
    <div
      className="my-2 p-4 rounded-xl border border-outline-variant/10"
      style={{ background: 'rgba(167, 139, 250, 0.04)' }}
    >
      <div className="text-[9px] font-bold text-primary/50 uppercase tracking-widest mb-3">
        Task Handoff
      </div>

      {/* Agent avatars with arrow */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex flex-col items-center gap-1">
          <AgentIcon
            base={fromAgent?.base || 'default'}
            color={fromAgent?.color || '#a78bfa'}
            size={36}
          />
          <span
            className="text-[10px] font-semibold truncate max-w-[80px]"
            style={{ color: fromAgent?.color || '#a78bfa' }}
          >
            {fromAgent?.label || from}
          </span>
        </div>

        <div className="flex items-center px-2">
          <div className="w-8 h-px bg-on-surface-variant/20" />
          <span className="material-symbols-outlined text-on-surface-variant/30 text-[16px]">
            arrow_forward
          </span>
          <div className="w-8 h-px bg-on-surface-variant/20" />
        </div>

        <div className="flex flex-col items-center gap-1">
          <AgentIcon
            base={toAgent?.base || 'default'}
            color={toAgent?.color || '#a78bfa'}
            size={36}
          />
          <span
            className="text-[10px] font-semibold truncate max-w-[80px]"
            style={{ color: toAgent?.color || '#a78bfa' }}
          >
            {toAgent?.label || to}
          </span>
        </div>
      </div>

      {/* Task text */}
      <div className="text-[12px] text-on-surface-variant/70 mb-3 leading-relaxed">
        {task}
      </div>

      {/* Status badge */}
      <div className="flex items-center">
        <span
          className={`text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${style.bg} ${style.text}`}
        >
          {style.label}
        </span>
      </div>
    </div>
  );
}
