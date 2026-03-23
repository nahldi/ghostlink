import { useState, useEffect, useRef } from 'react';

interface TerminalPeekProps {
  agentName: string;
  agentColor?: string;
  onClose: () => void;
}

export function TerminalPeek({ agentName, agentColor, onClose }: TerminalPeekProps) {
  const [output, setOutput] = useState('');
  const [active, setActive] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const preRef = useRef<HTMLPreElement>(null);
  const color = agentColor || '#a78bfa';

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/terminal?lines=40`, { signal: abort.signal });
          const data = await res.json();
          if (!cancelled) {
            setOutput(data.output || '');
            setActive(data.active ?? false);
          }
        } catch {
          if (cancelled) break;
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    };
    poll();
    return () => { cancelled = true; abort.abort(); };
  }, [agentName]);

  useEffect(() => {
    if (autoScroll && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [output, autoScroll]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[700px] max-w-[94vw] h-[500px] max-h-[80vh] rounded-2xl border overflow-hidden flex flex-col modal-enter"
        style={{
          background: '#0a0a12',
          borderColor: `${color}20`,
          boxShadow: `0 0 40px ${color}10`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-outline-variant/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs font-mono text-on-surface-variant/60">
              ghostlink-{agentName}
            </span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
              active ? 'bg-green-500/15 text-green-400' : 'bg-surface-container-highest text-on-surface-variant/30'
            }`}>
              {active ? 'LIVE' : 'INACTIVE'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
                autoScroll ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/30 hover:text-on-surface-variant/50'
              }`}
            >
              Auto-scroll
            </button>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-container-high text-on-surface-variant/30">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        </div>

        {/* Terminal output */}
        <pre
          ref={preRef}
          className="flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed text-green-300/80 whitespace-pre-wrap"
          style={{ background: '#0a0a12' }}
        >
          {output || (active ? 'Waiting for output...' : `No active tmux session for ${agentName}`)}
        </pre>
      </div>
    </div>
  );
}
