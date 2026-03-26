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
  execution_mode?: string;
}

const MODE_STYLES: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  plan: { label: 'Plan', color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/20', icon: 'edit_note' },
  execute: { label: 'Execute', color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/20', icon: 'play_arrow' },
  review: { label: 'Review', color: 'text-blue-400', bg: 'bg-blue-400/10 border-blue-400/20', icon: 'visibility' },
};

export function SessionBar() {
  const activeChannel = useChatStore((s) => s.activeChannel);
  const [session, setSession] = useState<Session | null>(null);
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => {
    api.getSession(activeChannel)
      .then(r => setSession(r.session))
      .catch((e) => { console.warn('Session fetch:', e instanceof Error ? e.message : String(e)); setSession(null); });
  }, [activeChannel]);

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

  const phases = session.phases || [];
  if (phases.length === 0) return null;
  const phaseIdx = Math.min(session.current_phase, phases.length - 1);
  const phase = phaseIdx >= 0 ? phases[phaseIdx] : null;
  const progress = (Math.min(session.current_phase, phases.length) / phases.length) * 100;

  const handleAdvance = async () => {
    if (advancing) return;
    setAdvancing(true);
    try {
      const r = await api.advanceSession(activeChannel);
      setSession(r.session);
    } catch { /* ignored */ }
    setAdvancing(false);
  };

  const handleEnd = async () => {
    try {
      const r = await api.endSession(activeChannel);
      setSession(r.session);
    } catch { /* ignored */ }
  };

  const isPaused = session.status === 'paused';

  const handleTogglePause = async () => {
    try {
      const r = isPaused
        ? await api.resumeSession(activeChannel)
        : await api.pauseSession(activeChannel);
      setSession(r.session);
    } catch { /* ignored */ }
  };

  const currentMode = session.execution_mode || 'execute';
  const modeStyle = MODE_STYLES[currentMode] || MODE_STYLES.execute;

  const cycleMode = async () => {
    const modes = ['plan', 'execute', 'review'];
    const nextIdx = (modes.indexOf(currentMode) + 1) % modes.length;
    try {
      const r = await api.setSessionMode(activeChannel, modes[nextIdx]);
      setSession(r.session);
    } catch { /* ignored */ }
  };

  return (
    <div className="px-4 py-2 glass border-b border-primary/10 flex items-center gap-3">
      <div className="w-16 h-1.5 bg-surface-container-high rounded-full overflow-hidden shrink-0">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      {/* Execution mode badge */}
      <button
        onClick={cycleMode}
        className={`px-2 py-1 rounded-md border text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all hover:brightness-125 shrink-0 ${modeStyle.bg} ${modeStyle.color}`}
        title={`Mode: ${modeStyle.label}. Click to cycle.`}
      >
        <span className="material-symbols-outlined text-[12px]">{modeStyle.icon}</span>
        {modeStyle.label}
      </button>

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
            Phase {phaseIdx + 1}/{phases.length}: {phase.name}
            {isPaused && <span className="ml-1 text-yellow-400">(paused)</span>}
          </div>
        )}
      </div>

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
          disabled={isPaused || advancing}
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
