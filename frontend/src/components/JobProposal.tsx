interface JobProposalProps {
  title: string;
  assignee: string;
  description: string;
  onAccept: () => void;
  onDismiss: () => void;
  accepted?: boolean;
}

export function JobProposal({
  title,
  assignee,
  description,
  onAccept,
  onDismiss,
  accepted,
}: JobProposalProps) {
  return (
    <div className="bg-surface p-5 rounded-xl border border-outline-variant/10 my-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-secondary shrink-0">
          <span className="material-symbols-outlined">work</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-secondary uppercase tracking-widest mb-1">
            Job Proposal
          </div>
          <div className="text-sm font-bold text-on-surface mb-1">{title}</div>
          <div className="text-xs text-on-surface-variant mb-1">
            {description}
          </div>
          <div className="text-[10px] text-outline uppercase font-bold">
            Assigned to {assignee}
          </div>
        </div>
      </div>

      {accepted !== undefined ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-secondary">
          <span className="material-symbols-outlined text-sm">
            {accepted ? 'check_circle' : 'cancel'}
          </span>
          {accepted ? 'Accepted' : 'Dismissed'}
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={onAccept}
            className="px-6 py-2 rounded-lg bg-secondary-container text-on-secondary-container text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all active:scale-95"
          >
            Accept
          </button>
          <button
            onClick={onDismiss}
            className="px-6 py-2 rounded-lg bg-surface-container-highest text-on-surface-variant text-[10px] font-bold uppercase tracking-widest hover:bg-surface-bright transition-all active:scale-95"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
