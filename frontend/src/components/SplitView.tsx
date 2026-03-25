import { useEffect, useMemo } from 'react';
import { useChatStore } from '../stores/chatStore';
import { ChatMessage } from './ChatMessage';
import { api } from '../lib/api';

interface SplitViewProps {
  channel1: string;
  channel2: string;
  onClose: () => void;
}

export function SplitView({ channel1, channel2, onClose }: SplitViewProps) {
  const messages = useChatStore((s) => s.messages);
  const setMessages = useChatStore((s) => s.setMessages);
  const ch1Msgs = useMemo(() => messages.filter(m => m.channel === channel1).slice(-50), [messages, channel1]);
  const ch2Msgs = useMemo(() => messages.filter(m => m.channel === channel2).slice(-50), [messages, channel2]);

  // Fetch from API on mount to ensure data is in store
  useEffect(() => {
    api.getMessages(channel1, 0, 50).then(r => {
      if (r.messages.length > 0) setMessages(r.messages);
    }).catch((e) => console.warn('SplitView ch1 fetch:', e.message || e));
    api.getMessages(channel2, 0, 50).then(r => {
      if (r.messages.length > 0) setMessages(r.messages);
    }).catch((e) => console.warn('SplitView ch2 fetch:', e.message || e));
  }, [channel1, channel2, setMessages]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative flex-1 m-4 rounded-2xl border border-outline-variant/15 overflow-hidden flex flex-col modal-enter"
        style={{ background: '#0a0a12' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-outline-variant/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-lg">splitscreen</span>
            <span className="text-xs font-semibold text-on-surface">Split View</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant/30">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        {/* Split panels */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left channel */}
          <div className="flex-1 flex flex-col border-r border-outline-variant/10">
            <div className="px-4 py-2 border-b border-outline-variant/8 text-xs font-semibold text-primary">
              #{channel1}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {ch1Msgs.length === 0 ? (
                <div className="text-center text-xs text-on-surface-variant/30 py-8">No messages</div>
              ) : (
                ch1Msgs.map(m => <ChatMessage key={m.id} message={m} />)
              )}
            </div>
          </div>

          {/* Divider handle */}
          <div className="w-1 bg-outline-variant/10 hover:bg-primary/20 cursor-col-resize transition-colors" />

          {/* Right channel */}
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-2 border-b border-outline-variant/8 text-xs font-semibold text-secondary">
              #{channel2}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {ch2Msgs.length === 0 ? (
                <div className="text-center text-xs text-on-surface-variant/30 py-8">No messages</div>
              ) : (
                ch2Msgs.map(m => <ChatMessage key={m.id} message={m} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
