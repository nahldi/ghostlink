import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import { timeAgo } from '../lib/timeago';
import type { Message } from '../types';

interface SearchModalProps {
  onClose: () => void;
}

export function SearchModal({ onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const agents = useChatStore((s) => s.agents);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.searchMessages(query);
        setResults(r.results);
      } catch {}
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (msg: Message) => {
    setActiveChannel(msg.channel);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[560px] max-w-[92vw] max-h-[60vh] rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: 'linear-gradient(160deg, #141420 0%, #08080f 100%)',
          border: '1px solid rgba(167, 139, 250, 0.15)',
          boxShadow: '0 0 60px rgba(124, 58, 237, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/8">
          <span className="material-symbols-outlined text-on-surface-variant/30 text-[20px]">search</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
            placeholder="Search messages..."
            className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/25 outline-none"
          />
          {searching && <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
          <kbd className="text-[9px] text-on-surface-variant/20 bg-surface-container/50 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {results.length === 0 && query.trim() && !searching && (
            <div className="text-center py-8 text-xs text-on-surface-variant/25">No results found</div>
          )}
          {results.map((msg) => {
            const agent = agents.find(a => a.name === msg.sender);
            return (
              <button
                key={msg.id}
                onClick={() => handleSelect(msg)}
                className="w-full text-left px-5 py-3 hover:bg-surface-container-high/30 transition-colors border-b border-outline-variant/4"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-semibold" style={{ color: agent?.color || '#a78bfa' }}>
                    {agent?.label || msg.sender}
                  </span>
                  <span className="text-[9px] text-on-surface-variant/25">#{msg.channel}</span>
                  <span className="text-[9px] text-on-surface-variant/20 ml-auto">{timeAgo(msg.timestamp)}</span>
                </div>
                <div className="text-[12px] text-on-surface-variant/60 line-clamp-2">
                  {highlightMatch(msg.text, query)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const truncated = text.length > 200 ? text.slice(0, 200) + '...' : text;
  const parts = truncated.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-primary/20 text-primary rounded px-0.5">{part}</mark>
      : part
  );
}
