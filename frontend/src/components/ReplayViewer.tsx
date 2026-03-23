import { useState, useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { useChatStore } from '../stores/chatStore';

interface ReplayViewerProps {
  channel: string;
  onClose: () => void;
}

export function ReplayViewer({ channel, onClose }: ReplayViewerProps) {
  const allMessages = useChatStore((s) => s.messages);
  const channelMsgs = allMessages.filter(m => m.channel === channel).sort((a, b) => a.timestamp - b.timestamp);
  const [visibleCount, setVisibleCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const feedRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visible = channelMsgs.slice(0, visibleCount);
  const progress = channelMsgs.length > 0 ? (visibleCount / channelMsgs.length) * 100 : 0;

  useEffect(() => {
    if (!playing || visibleCount >= channelMsgs.length) {
      if (visibleCount >= channelMsgs.length) setPlaying(false);
      return;
    }
    const current = channelMsgs[visibleCount];
    const prev = channelMsgs[visibleCount - 1];
    // Calculate delay based on original timing between messages
    let delay = 500; // default
    if (prev && current) {
      const gap = (current.timestamp - prev.timestamp) * 1000;
      delay = Math.min(Math.max(gap / speed, 100), 3000); // 100ms-3s range
    }
    timerRef.current = setTimeout(() => {
      setVisibleCount(v => v + 1);
    }, delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, visibleCount, speed, channelMsgs]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [visibleCount]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-[700px] max-w-[94vw] h-[600px] max-h-[85vh] rounded-2xl border border-outline-variant/15 overflow-hidden flex flex-col modal-enter"
        style={{ background: '#0a0a12' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-outline-variant/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">replay</span>
            <span className="text-xs font-semibold text-on-surface">Session Replay — #{channel}</span>
            <span className="text-[10px] text-on-surface-variant/40">{visibleCount}/{channelMsgs.length} messages</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant/30">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        {/* Message feed */}
        <div ref={feedRef} className="flex-1 overflow-y-auto p-4">
          {visible.length === 0 ? (
            <div className="text-center text-xs text-on-surface-variant/30 py-12">
              Press Play to start the replay
            </div>
          ) : (
            visible.map(m => <ChatMessage key={m.id} message={m} />)
          )}
        </div>

        {/* Controls */}
        <div className="px-5 py-3 border-t border-outline-variant/10 flex items-center gap-4 shrink-0">
          {/* Play/Pause */}
          <button
            onClick={() => {
              if (visibleCount >= channelMsgs.length) setVisibleCount(0);
              setPlaying(!playing);
            }}
            className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center hover:bg-primary/25 transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-lg">{playing ? 'pause' : 'play_arrow'}</span>
          </button>

          {/* Progress bar */}
          <div className="flex-1 h-1.5 bg-surface-container-highest rounded-full overflow-hidden cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              setVisibleCount(Math.round(pct * channelMsgs.length));
            }}
          >
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>

          {/* Speed controls */}
          <div className="flex items-center gap-1.5">
            {[0.5, 1, 2, 5].map(s => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                  speed === s ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/30 hover:text-on-surface-variant/50'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Reset */}
          <button
            onClick={() => { setVisibleCount(0); setPlaying(false); }}
            className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant/30"
            title="Reset"
          >
            <span className="material-symbols-outlined text-sm">restart_alt</span>
          </button>
        </div>
      </div>
    </div>
  );
}
