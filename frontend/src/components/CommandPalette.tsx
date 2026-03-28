/**
 * Command Palette — Ctrl+K quick actions.
 * Search agents, channels, commands, and settings from one unified bar.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import { toast } from './Toast';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: string;
  category: 'agent' | 'channel' | 'action' | 'navigation';
  action: () => void;
  color?: string;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const agents = useChatStore((s) => s.agents);
  const channels = useChatStore((s) => s.channels);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const clearUnread = useChatStore((s) => s.clearUnread);
  const setSidebarPanel = useChatStore((s) => s.setSidebarPanel);
  const setCockpitAgent = useChatStore((s) => s.setCockpitAgent);

  const items = useMemo<CommandItem[]>(() => {
    const results: CommandItem[] = [];

    // Agent actions
    for (const agent of agents) {
      const isOnline = agent.state === 'active' || agent.state === 'idle' || agent.state === 'thinking';
      results.push({
        id: `agent-focus-${agent.name}`,
        label: `@${agent.label || agent.name}`,
        description: isOnline ? `${agent.state} — open cockpit` : 'Offline',
        icon: 'smart_toy',
        category: 'agent',
        color: agent.color,
        action: () => {
          if (isOnline) setCockpitAgent(agent.name);
          onClose();
        },
      });
      if (isOnline) {
        results.push({
          id: `agent-stop-${agent.name}`,
          label: `Stop ${agent.label || agent.name}`,
          description: 'Kill agent process',
          icon: 'stop_circle',
          category: 'agent',
          color: '#ef4444',
          action: () => {
            api.killAgent(agent.name).then(() => toast(`${agent.label} stopped`, 'info')).catch(() => toast('Failed to stop', 'error'));
            onClose();
          },
        });
      } else {
        results.push({
          id: `agent-start-${agent.name}`,
          label: `Start ${agent.label || agent.name}`,
          description: 'Launch agent',
          icon: 'play_circle',
          category: 'agent',
          color: '#22c55e',
          action: () => {
            api.spawnAgent(agent.base, agent.label, agent.workspace || '.', agent.args || []).then(() => toast(`${agent.label} starting...`, 'success')).catch(() => toast('Failed to start', 'error'));
            onClose();
          },
        });
      }
    }

    // Channel navigation
    for (const ch of channels) {
      results.push({
        id: `channel-${ch.name}`,
        label: `#${ch.name}`,
        description: ch.unread > 0 ? `${ch.unread} unread` : 'Switch channel',
        icon: 'tag',
        category: 'channel',
        action: () => {
          setActiveChannel(ch.name);
          clearUnread(ch.name);
          onClose();
        },
      });
    }

    // Cockpit quick actions for active agents
    const onlineAgents = agents.filter(a => a.state === 'active' || a.state === 'idle' || a.state === 'thinking');
    if (onlineAgents.length > 0) {
      for (const a of onlineAgents) {
        results.push(
          {
            id: `cockpit-terminal-${a.name}`,
            label: `${a.label}: Terminal`,
            description: 'View live terminal output',
            icon: 'terminal',
            category: 'action',
            color: a.color,
            action: () => { setCockpitAgent(a.name); onClose(); },
          },
          {
            id: `cockpit-files-${a.name}`,
            label: `${a.label}: Files`,
            description: 'Browse workspace files',
            icon: 'folder_open',
            category: 'action',
            color: a.color,
            action: () => { setCockpitAgent(a.name); onClose(); },
          },
        );
      }
    }

    // Quick actions
    results.push(
      {
        id: 'action-settings',
        label: 'Settings',
        description: 'Open settings panel',
        icon: 'settings',
        category: 'navigation',
        action: () => { setSidebarPanel('settings'); onClose(); },
      },
      {
        id: 'action-jobs',
        label: 'Jobs',
        description: 'View job board',
        icon: 'task',
        category: 'navigation',
        action: () => { setSidebarPanel('jobs'); onClose(); },
      },
      {
        id: 'action-rules',
        label: 'Rules',
        description: 'View channel rules',
        icon: 'gavel',
        category: 'navigation',
        action: () => { setSidebarPanel('rules'); onClose(); },
      },
      {
        id: 'action-theme-dark',
        label: 'Theme: Dark',
        icon: 'dark_mode',
        category: 'action',
        action: () => {
          useChatStore.getState().updateSettings({ theme: 'dark' });
          document.documentElement.setAttribute('data-theme', 'dark');
          api.saveSettings({ theme: 'dark' }).catch(() => {});
          onClose();
        },
      },
      {
        id: 'action-theme-cyberpunk',
        label: 'Theme: Cyberpunk',
        icon: 'blur_on',
        category: 'action',
        action: () => {
          useChatStore.getState().updateSettings({ theme: 'cyberpunk' });
          document.documentElement.setAttribute('data-theme', 'cyberpunk');
          api.saveSettings({ theme: 'cyberpunk' }).catch(() => {});
          onClose();
        },
      },
      {
        id: 'action-theme-terminal',
        label: 'Theme: Terminal',
        icon: 'terminal',
        category: 'action',
        action: () => {
          useChatStore.getState().updateSettings({ theme: 'terminal' });
          document.documentElement.setAttribute('data-theme', 'terminal');
          api.saveSettings({ theme: 'terminal' }).catch(() => {});
          onClose();
        },
      },
      {
        id: 'action-export',
        label: 'Export Chat',
        description: 'Download current channel as markdown',
        icon: 'download',
        category: 'action',
        action: () => {
          const channel = useChatStore.getState().activeChannel;
          api.exportChannel(channel).then((data) => {
            const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data)], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${channel}-export.md`;
            a.click();
            URL.revokeObjectURL(url);
            toast('Chat exported', 'success');
          }).catch(() => toast('Export failed', 'error'));
          onClose();
        },
      },
    );

    return results;
  }, [agents, channels, onClose, setActiveChannel, clearUnread, setSidebarPanel, setCockpitAgent]);

  // Filter items
  const filtered = query.trim()
    ? items.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        (item.description || '').toLowerCase().includes(query.toLowerCase())
      )
    : items;

  // Keyboard navigation
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIdx]) {
      e.preventDefault();
      filtered[selectedIdx].action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const categoryLabel = (cat: string) => {
    switch (cat) {
      case 'agent': return 'Agents';
      case 'channel': return 'Channels';
      case 'action': return 'Actions';
      case 'navigation': return 'Navigation';
      default: return cat;
    }
  };

  // Group by category
  const grouped: { category: string; items: typeof filtered }[] = [];
  let lastCat = '';
  for (const item of filtered) {
    if (item.category !== lastCat) {
      grouped.push({ category: item.category, items: [] });
      lastCat = item.category;
    }
    grouped[grouped.length - 1].items.push(item);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: -10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: -10 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative w-[480px] max-w-[92vw] rounded-2xl border border-outline-variant/15 overflow-hidden"
        style={{ background: 'rgba(10, 10, 18, 0.98)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="px-4 py-3 border-b border-outline-variant/10 flex items-center gap-3">
          <span className="material-symbols-outlined text-on-surface-variant/30">search</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, agents, channels..."
            className="flex-1 bg-transparent text-sm text-on-surface/80 outline-none placeholder:text-on-surface-variant/25"
          />
          <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant/30 font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[400px] overflow-auto py-1">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-on-surface-variant/30 text-xs">
              No results for "{query}"
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.category}>
                <div className="px-4 py-1.5">
                  <span className="text-[9px] font-semibold text-on-surface-variant/25 uppercase tracking-wider">
                    {categoryLabel(group.category)}
                  </span>
                </div>
                {group.items.map((item) => {
                  const idx = filtered.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      onClick={item.action}
                      className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
                        idx === selectedIdx ? 'bg-primary/10' : 'hover:bg-surface-container-high/50'
                      }`}
                    >
                      <span
                        className="material-symbols-outlined text-[18px]"
                        style={{ color: item.color || 'var(--on-surface-variant)' }}
                      >
                        {item.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[12px] text-on-surface/80 font-medium">{item.label}</span>
                        {item.description && (
                          <span className="text-[10px] text-on-surface-variant/35 ml-2">{item.description}</span>
                        )}
                      </div>
                      {idx === selectedIdx && (
                        <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant/20 font-mono">↵</kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-outline-variant/5 flex items-center gap-4 text-[9px] text-on-surface-variant/20">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </motion.div>
    </div>
  );
}
