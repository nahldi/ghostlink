import { useChatStore } from '../stores/chatStore';

interface CommandBarProps {
  onOpenSearch: () => void;
}

export function CommandBar({ onOpenSearch }: CommandBarProps) {
  const activeChannel = useChatStore((s) => s.activeChannel);
  const agents = useChatStore((s) => s.agents);
  const messages = useChatStore((s) => s.messages);

  const onlineAgents = agents.filter(a => a.state === 'active' || a.state === 'thinking' || a.state === 'idle');
  const channelMsgs = messages.filter(m => m.channel === activeChannel);

  return (
    <div className="command-bar flex items-center gap-3 px-4 lg:px-5 py-2.5 shrink-0">
      {/* Channel name */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-on-surface-variant/30 text-sm">#</span>
        <span className="text-sm font-bold text-on-surface truncate">{activeChannel}</span>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-2 ml-1">
        <span className="command-bar-badge flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-on-surface-variant/45">
          <span className="material-symbols-outlined text-[12px] text-green-400/60">group</span>
          {onlineAgents.length}/{agents.length}
        </span>
        <span className="command-bar-badge flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-on-surface-variant/45">
          <span className="material-symbols-outlined text-[12px] text-primary/50">chat</span>
          {channelMsgs.length}
        </span>
      </div>

      <div className="flex-1" />

      {/* Search only — no duplicate settings/export buttons */}
      <button onClick={onOpenSearch}
        className="command-bar-action flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-on-surface-variant/35 hover:text-on-surface-variant/60 transition-all text-[11px]">
        <span className="material-symbols-outlined text-[15px]">search</span>
        <kbd className="hidden lg:inline text-[9px] text-on-surface-variant/20 bg-surface-container/40 px-1 py-0.5 rounded ml-1">Ctrl+K</kbd>
      </button>
    </div>
  );
}
