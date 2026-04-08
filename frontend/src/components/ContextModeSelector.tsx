import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import { toast } from './Toast';
import type { ChannelContextSettings } from '../types';

const DEFAULT_CONTEXT: ChannelContextSettings = {
  mode: 'full',
  visible_agents: [],
  hidden_agents: [],
  max_history: 0,
  include_system_messages: true,
  include_progress_messages: true,
};

export function ContextModeSelector() {
  const activeChannel = useChatStore((s) => s.activeChannel);
  const context = useChatStore((s) => s.channelContexts[activeChannel]);
  const setChannelContext = useChatStore((s) => s.setChannelContext);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getChannelContext(activeChannel)
      .then((data) => {
        if (!cancelled) setChannelContext(activeChannel, data.context);
      })
      .catch(() => {
        if (!cancelled) setChannelContext(activeChannel, DEFAULT_CONTEXT);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChannel, setChannelContext]);

  const current = context || DEFAULT_CONTEXT;

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-surface-container-high/30 border border-outline-variant/10">
        <span className="material-symbols-outlined text-[14px] text-secondary/70">visibility</span>
        <span className="text-[10px] uppercase tracking-wider text-on-surface-variant/45 font-semibold" title="Controls how much chat history agents can see">Chat Memory</span>
        <select
          value={current.mode}
          disabled={loading}
          title="Choose what agents see in this channel"
          onChange={async (e) => {
            const mode = e.target.value as ChannelContextSettings['mode'];
            const next: ChannelContextSettings = {
              ...current,
              mode,
              max_history: mode === 'recent' ? (current.max_history || 25) : current.max_history,
            };
            setLoading(true);
            try {
              const data = await api.setChannelContext(activeChannel, next);
              setChannelContext(activeChannel, data.context);
            } catch {
              toast('Failed to update channel context', 'error');
            } finally {
              setLoading(false);
            }
          }}
          className="bg-transparent text-[11px] text-on-surface outline-none cursor-pointer"
        >
          <option value="full" className="bg-surface text-on-surface">All Messages</option>
          <option value="mentions_only" className="bg-surface text-on-surface">Mentions Only</option>
          <option value="recent" className="bg-surface text-on-surface">Recent Only</option>
          <option value="filtered" className="bg-surface text-on-surface">Filtered</option>
        </select>
      </label>

      {current.mode === 'recent' && (
        <label className="flex items-center gap-1 text-[10px] text-on-surface-variant/50">
          <span>History</span>
          <input
            type="number"
            min={1}
            max={500}
            value={current.max_history || 25}
            onChange={async (e) => {
              const max_history = Math.max(1, Number(e.target.value) || 25);
              const next = { ...current, max_history };
              setChannelContext(activeChannel, next);
              try {
                const data = await api.setChannelContext(activeChannel, next);
                setChannelContext(activeChannel, data.context);
              } catch {
                toast('Failed to update recent history limit', 'error');
              }
            }}
            className="w-16 rounded-lg bg-surface-container-high/40 border border-outline-variant/10 px-2 py-1 text-[11px] text-on-surface outline-none"
          />
        </label>
      )}
    </div>
  );
}
