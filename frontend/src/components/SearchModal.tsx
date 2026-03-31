import { useState, useRef, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
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
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const agents = useChatStore((s) => s.agents);
  const channels = useChatStore((s) => s.channels);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const clearUnread = useChatStore((s) => s.clearUnread);
  const setSidebarPanel = useChatStore((s) => s.setSidebarPanel);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Determine mode based on prefix
  const mode = query.startsWith('/') ? 'command' : query.startsWith('@') ? 'agent' : query.startsWith('#') ? 'channel' : 'search';

  // Slash command quick-access items
  const commandItems = useMemo(() => {
    const cmds = [
      { name: '/status', desc: 'Show agent states' },
      { name: '/clear', desc: 'Clear chat' },
      { name: '/export', desc: 'Export channel' },
      { name: '/help', desc: 'Show commands' },
      { name: '/theme', desc: 'Toggle theme' },
      { name: '/mute', desc: 'Mute sounds' },
      { name: '/unmute', desc: 'Unmute sounds' },
      { name: '/agents', desc: 'List agents' },
      { name: '/stats', desc: 'Session stats' },
      { name: '/settings', desc: 'Open settings' },
      { name: '/jobs', desc: 'Open jobs' },
      { name: '/rules', desc: 'Open rules' },
    ];
    const q = query.toLowerCase();
    return cmds.filter(c => c.name.includes(q));
  }, [query]);

  // Agent quick-switch items
  const agentItems = useMemo(() => {
    const q = query.slice(1).toLowerCase();
    return agents.filter(a => a.name.toLowerCase().includes(q) || a.label.toLowerCase().includes(q));
  }, [query, agents]);

  // Channel quick-switch items
  const channelItems = useMemo(() => {
    const q = query.slice(1).toLowerCase();
    return channels.filter(c => c.name.toLowerCase().includes(q));
  }, [query, channels]);

  // Message search (with AbortController to prevent stale results)
  useEffect(() => {
    if (mode !== 'search' || !query.trim()) { queueMicrotask(() => setResults([])); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.searchMessages(query, undefined, undefined, controller.signal);
        if (!controller.signal.aborted) setResults(r.results);
      } catch { /* ignored */ }
      setSearching(false);
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, mode]);

  // Reset selection when query changes (deferred to avoid setState in render/effect)
  const prevQuery = useRef(query);
  useEffect(() => {
    if (prevQuery.current !== query) {
      prevQuery.current = query;
      queueMicrotask(() => setSelectedIdx(0));
    }
  }, [query]);

  const handleSelect = (msg: Message) => {
    setActiveChannel(msg.channel);
    onClose();
  };

  const handleCommandSelect = (name: string) => {
    useChatStore.getState().setPendingInput(name);
    onClose();
  };

  const handleAgentSelect = (name: string) => {
    useChatStore.getState().setPendingInput(`@${name} `);
    onClose();
  };

  const handleChannelSelect = (name: string) => {
    setActiveChannel(name);
    clearUnread(name);
    setSidebarPanel(null);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }

    let itemCount = 0;
    if (mode === 'command') itemCount = commandItems.length;
    else if (mode === 'agent') itemCount = agentItems.length;
    else if (mode === 'channel') itemCount = channelItems.length;
    else itemCount = results.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => (i + 1) % Math.max(itemCount, 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => (i - 1 + Math.max(itemCount, 1)) % Math.max(itemCount, 1));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'command' && commandItems[selectedIdx]) handleCommandSelect(commandItems[selectedIdx].name);
      else if (mode === 'agent' && agentItems[selectedIdx]) handleAgentSelect(agentItems[selectedIdx].name);
      else if (mode === 'channel' && channelItems[selectedIdx]) handleChannelSelect(channelItems[selectedIdx].name);
      else if (mode === 'search' && results[selectedIdx]) handleSelect(results[selectedIdx]);
    }
  };

  const placeholder = 'Search messages, / commands, @agents, #channels...';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[560px] max-w-[92vw] max-h-[60vh] rounded-2xl overflow-hidden flex flex-col glass-card"
        style={{
          boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 60px rgba(124, 58, 237, 0.08)',
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
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/25 outline-none"
          />
          {searching && <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
          {mode !== 'search' && (
            <span className="text-[9px] font-bold text-primary/50 bg-primary/10 px-1.5 py-0.5 rounded uppercase">
              {mode}
            </span>
          )}
          <kbd className="text-[9px] text-on-surface-variant/20 bg-surface-container/50 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {/* Command mode */}
          {mode === 'command' && commandItems.map((cmd, i) => (
            <button
              key={cmd.name}
              onClick={() => handleCommandSelect(cmd.name)}
              className={`w-full text-left px-5 py-3 transition-colors border-b border-outline-variant/4 ${
                i === selectedIdx ? 'bg-primary-container/15' : 'hover:bg-surface-container-high/30'
              }`}
            >
              <span className="text-[12px] font-bold text-primary/80 mr-2">{cmd.name}</span>
              <span className="text-[11px] text-on-surface-variant/40">{cmd.desc}</span>
            </button>
          ))}

          {/* Agent mode */}
          {mode === 'agent' && agentItems.map((agent, i) => {
            const isOn = agent.state === 'active' || agent.state === 'thinking';
            return (
              <button
                key={agent.name}
                onClick={() => handleAgentSelect(agent.name)}
                className={`w-full text-left px-5 py-3 flex items-center gap-3 transition-colors border-b border-outline-variant/4 ${
                  i === selectedIdx ? 'bg-primary-container/15' : 'hover:bg-surface-container-high/30'
                }`}
              >
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: isOn ? agent.color : '#3a3548' }} />
                <span className="text-[12px] font-semibold" style={{ color: agent.color }}>@{agent.name}</span>
                <span className="text-[11px] text-on-surface-variant/40">{agent.label}</span>
                <span className={`text-[10px] ml-auto ${isOn ? 'text-green-400/60' : 'text-on-surface-variant/25'}`}>
                  {agent.state}
                </span>
              </button>
            );
          })}

          {/* Channel mode */}
          {mode === 'channel' && channelItems.map((ch, i) => (
            <button
              key={ch.name}
              onClick={() => handleChannelSelect(ch.name)}
              className={`w-full text-left px-5 py-3 flex items-center gap-3 transition-colors border-b border-outline-variant/4 ${
                i === selectedIdx ? 'bg-primary-container/15' : 'hover:bg-surface-container-high/30'
              }`}
            >
              <span className="text-on-surface-variant/30">#</span>
              <span className="text-[12px] font-semibold text-on-surface">{ch.name}</span>
              {ch.unread > 0 && (
                <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full font-bold ml-auto">{ch.unread}</span>
              )}
            </button>
          ))}

          {/* Message search mode */}
          {mode === 'search' && (
            <>
              {results.length === 0 && query.trim() && !searching && (
                <div className="text-center py-8 text-xs text-on-surface-variant/25">No results found</div>
              )}
              {!query.trim() && (
                <div className="text-center py-8 text-xs text-on-surface-variant/20 space-y-1">
                  <div>Type to search messages</div>
                  <div className="text-[10px]">
                    <span className="text-primary/50">/</span> commands
                    <span className="mx-2 text-on-surface-variant/10">|</span>
                    <span className="text-primary/50">@</span> agents
                    <span className="mx-2 text-on-surface-variant/10">|</span>
                    <span className="text-primary/50">#</span> channels
                  </div>
                </div>
              )}
              {results.map((msg, i) => {
                const agent = agents.find(a => a.name === msg.sender);
                return (
                  <motion.button
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03, duration: 0.2 }}
                    onClick={() => handleSelect(msg)}
                    className={`w-full text-left px-5 py-3 transition-colors border-b border-outline-variant/4 ${
                      i === selectedIdx ? 'bg-primary-container/15' : 'hover:bg-surface-container-high/30'
                    }`}
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
                  </motion.button>
                );
              })}
            </>
          )}
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
