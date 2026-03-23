import { useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { ChannelSummary } from './ChannelSummary';

export function ChannelTabs() {
  const channels = useChatStore((s) => s.channels);
  const active = useChatStore((s) => s.activeChannel);
  const setActive = useChatStore((s) => s.setActiveChannel);
  const clearUnread = useChatStore((s) => s.clearUnread);
  const [showSummary, setShowSummary] = useState(false);

  return (
    <div className="relative flex items-center gap-1.5 px-4 overflow-x-auto">
      {channels.map((ch) => (
        <button
          key={ch.name}
          onClick={() => {
            setActive(ch.name);
            clearUnread(ch.name);
          }}
          className={`relative px-4 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
            active === ch.name
              ? 'channel-active text-primary'
              : 'text-on-surface-variant/40 hover:text-on-surface-variant/60 hover:bg-surface-container-high/20 border border-transparent'
          }`}
        >
          <span className="opacity-50 mr-1">#</span>{ch.name}
          {ch.unread > 0 && active !== ch.name && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-secondary/30 text-secondary text-[9px] font-bold flex items-center justify-center">
              {ch.unread > 9 ? '9+' : ch.unread}
            </span>
          )}
        </button>
      ))}
      <button
        onClick={() => setShowSummary(!showSummary)}
        className={`p-1 rounded-md transition-colors shrink-0 ${
          showSummary ? 'text-primary bg-primary/10' : 'text-on-surface-variant/25 hover:text-on-surface-variant/50 hover:bg-surface-container-high/30'
        }`}
        title="Channel summary"
      >
        <span className="material-symbols-outlined text-[14px]">summarize</span>
      </button>
      {showSummary && <ChannelSummary channel={active} onClose={() => setShowSummary(false)} />}
    </div>
  );
}
