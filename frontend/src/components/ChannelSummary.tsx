import { useState, useEffect } from 'react';
import { api } from '../lib/api';

interface SummaryData {
  channel: string;
  summary: string;
  message_count: number;
  participants: { name: string; count: number }[];
  topics: string[];
}

export function ChannelSummary({ channel, onClose }: { channel: string; onClose: () => void }) {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      setData(null);
      try {
        const r = await api.getChannelSummary(channel);
        if (!cancelled) { setData(r); setLoading(false); }
      } catch {
        if (!cancelled) { setError('Failed to load summary'); setLoading(false); }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [channel]);

  return (
    <div className="absolute top-full left-0 right-0 z-40 mx-4 mt-1 glass-card rounded-xl p-4 shadow-2xl border border-outline-variant/15 max-w-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-primary">summarize</span>
          <span className="text-xs font-bold text-on-surface uppercase tracking-wider">#{channel} Summary</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-md hover:bg-surface-container-high text-on-surface-variant/40 hover:text-on-surface-variant/70">
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-4 justify-center text-xs text-on-surface-variant/40">
          <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
          Generating summary...
        </div>
      )}

      {error && <div className="text-xs text-red-400 py-2">{error}</div>}

      {data && (
        <div className="space-y-3">
          <p className="text-xs text-on-surface/80 leading-relaxed">{data.summary}</p>

          {data.participants && data.participants.length > 0 && (
            <div>
              <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-1.5">Participants</div>
              <div className="flex flex-wrap gap-1.5">
                {data.participants.map(p => (
                  <span key={p.name} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary/80 font-medium">
                    {p.name} ({p.count})
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.topics && data.topics.length > 0 && (
            <div>
              <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-1.5">Key Topics</div>
              <div className="flex flex-wrap gap-1.5">
                {data.topics.map(t => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/10 text-secondary/80">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="text-[9px] text-on-surface-variant/30 text-right">
            {data.message_count} messages analyzed
          </div>
        </div>
      )}
    </div>
  );
}
