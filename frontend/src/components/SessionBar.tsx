import { useState, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';

interface Session {
  id: string;
  template_name: string;
  topic: string;
  phases: { name: string }[];
  current_phase: number;
  current_turn: number;
  status: string;
  cast: Record<string, string>;
}

export function SessionBar() {
  const activeChannel = useChatStore((s) => s.activeChannel);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    api.getSession(activeChannel)
      .then(r => setSession(r.session))
      .catch(() => setSession(null));
  }, [activeChannel]);

  // Listen for session updates via custom event
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail?.channel === activeChannel) {
        setSession(e.detail.session);
      }
    };
    window.addEventListener('ghostlink:session-update', handler as EventListener);
    return () => window.removeEventListener('ghostlink:session-update', handler as EventListener);
  }, [activeChannel]);

  if (!session || session.status === 'completed') return null;

  const phase = session.phases[session.current_phase];
  const progress = session.phases.length > 0
    ? ((session.current_phase / session.phases.length) * 100)
    : 0;

  const handleAdvance = async () => {
    try {
      const r = await api.advanceSession(activeChannel);
      setSession(r.session);
    } catch {}
  };

  const handleEnd = async () => {
    try {
      const r = await api.endSession(activeChannel);
      setSession(r.session);
    } catch {}
  };

  const isPaused = session.status === 'paused';

  const handleTogglePause = async () => {
    try {
      const r = isPaused
        ? await api.resumeSession(activeChannel)
        : await api.pauseSession(activeChannel);
      setSession(r.session);
    } catch {}
  };

  return (
    <div className="px-4 py-2 glass border-b border-primary/10 flex items-center gap-3">
      {/* Progress bar */}
      <div className="w-16 h-1.5 bg-surface-container-high rounded-full overflow-hidden shrink-0">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Session info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
            {session.template_name}
          </span>
          {session.topic && (
            <span className="text-[10px] text-on-surface-variant/40 truncate">{session.topic}</span>
          )}
        </div>
        {phase && (
          <div className="text-[9px] text-on-surface-variant/50">
            Phase {session.current_phase + 1}/{session.phases.length}: {phase.name}
            {isPaused && <span className="ml-1 text-yellow-400">(paused)</span>}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleTogglePause}
          className="p-1 rounded-md text-on-surface-variant/40 hover:text-on-surface-variant/70 hover:bg-surface-container-high transition-colors"
          title={isPaused ? 'Resume' : 'Pause'}
        >
          <span className="material-symbols-outlined text-[14px]">{isPaused ? 'play_arrow' : 'pause'}</span>
        </button>
        <button
          onClick={handleAdvance}
          disabled={isPaused}
          className="p-1 rounded-md text-primary/60 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30"
          title="Next turn"
        >
          <span className="material-symbols-outlined text-[14px]">skip_next</span>
        </button>
        <button
          onClick={handleEnd}
          className="p-1 rounded-md text-on-surface-variant/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          title="End session"
        >
          <span className="material-symbols-outlined text-[14px]">stop</span>
        </button>
      </div>
    </div>
  );
}
