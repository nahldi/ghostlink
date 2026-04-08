/* eslint-disable react-refresh/only-export-components -- This module intentionally co-locates
   small cockpit helpers, components, and the tab-state hook so the split stays cohesive. */
/* eslint-disable react-hooks/set-state-in-effect -- Resetting the active tab on cockpit-agent
   changes is an intentional UI state sync, not a derived-state bug. */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { AgentIcon } from './AgentIcon';
import type { Agent, AgentPresence } from '../types';

export const TABS = ['terminal', 'files', 'browser', 'replay', 'activity', 'tasks', 'checkpoints'] as const;
export type CockpitTab = typeof TABS[number];

const TAB_ICONS: Record<CockpitTab, string> = {
  terminal: 'terminal',
  files: 'folder_open',
  browser: 'language',
  replay: 'replay',
  activity: 'timeline',
  tasks: 'task_alt',
  checkpoints: 'save',
};

export function NoAgentSelectedState() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-outline-variant/10">
        <h2 className="text-sm font-semibold text-on-surface/80">Agent Cockpit</h2>
        <p className="text-[10px] text-on-surface-variant/30 mt-0.5">Live workspace viewer</p>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
          <span className="material-symbols-outlined text-2xl text-primary/30">monitor</span>
        </div>
        <div className="text-center space-y-1.5">
          <p className="text-xs font-medium text-on-surface-variant/50">No agent selected</p>
          <p className="text-[10px] text-on-surface-variant/30 leading-relaxed max-w-[200px]">
            Hover over an agent chip and click the monitor icon to open their live workspace
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-on-surface-variant/20">
          <kbd className="px-1.5 py-0.5 rounded bg-surface-container-highest/30 font-mono">Ctrl+K</kbd>
          <span>to search agents</span>
        </div>
      </div>
    </div>
  );
}

export function AgentCockpitHeader({
  agent,
  thinking,
  presence,
}: {
  agent: Agent;
  thinking: { text: string; active: boolean } | null;
  presence: AgentPresence | null;
}) {
  return (
    <div className="px-3 py-2.5 border-b shrink-0" style={{ borderColor: `${agent.color}15` }}>
      <div className="flex items-center gap-2.5">
        <AgentIcon base={agent.base} color={agent.color} size={20} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-on-surface/80 truncate">{agent.label || agent.name}</p>
          <p className="text-[9px] text-on-surface-variant/40 truncate">
            {thinking?.active
              ? 'Thinking...'
              : presence?.detail || (agent.state === 'active' ? 'Working' : agent.state === 'idle' ? 'Ready' : agent.state === 'paused' ? 'Paused' : agent.state)}
            {presence?.path && <span className="ml-1 text-on-surface-variant/25">at {presence.path}</span>}
            {!presence?.path && agent.workspace && <span className="ml-1 text-on-surface-variant/25">in {agent.workspace.split('/').pop()}</span>}
          </p>
        </div>
        <div
          className="w-2.5 h-2.5 rounded-full transition-all"
          style={{
            background: thinking?.active ? agent.color : agent.state === 'active' ? '#22c55e' : agent.state === 'idle' ? '#60a5fa' : agent.state === 'paused' ? '#fb923c' : '#6b7280',
            boxShadow: thinking?.active ? `0 0 8px ${agent.color}80` : agent.state === 'active' ? '0 0 6px rgba(34,197,94,0.5)' : 'none',
          }}
        />
      </div>
      {thinking?.active && thinking.text ? (
        <p className="mt-1.5 text-[9px] text-on-surface-variant/35 truncate font-mono italic pl-7">
          {thinking.text.slice(-80)}
        </p>
      ) : presence?.surface ? (
        <p className="mt-1.5 text-[9px] text-on-surface-variant/35 truncate font-mono pl-7">
          {presence.surface}{presence.status ? ` · ${presence.status}` : ''}{presence.command ? ` · ${presence.command}` : ''}{presence.url ? ` · ${presence.url}` : ''}
        </p>
      ) : null}
    </div>
  );
}

export function AgentCockpitTabs({
  agentColor,
  tab,
  onSelect,
}: {
  agentColor: string;
  tab: CockpitTab;
  onSelect: (tab: CockpitTab) => void;
}) {
  return (
    <div className="flex border-b border-outline-variant/10 shrink-0 overflow-x-auto scrollbar-none" role="tablist" aria-label="Agent cockpit tabs">
      {TABS.map((item) => (
        <button
          key={item}
          onClick={() => onSelect(item)}
          className={`flex items-center justify-center gap-1 py-2 px-2.5 text-[9px] font-medium transition-colors whitespace-nowrap shrink-0 ${
            tab === item
              ? 'border-b-2'
              : 'text-on-surface-variant/40 hover:text-on-surface-variant/60'
          }`}
          style={tab === item ? { color: agentColor, borderColor: agentColor } : undefined}
          title={item.charAt(0).toUpperCase() + item.slice(1)}
          role="tab"
          aria-selected={tab === item}
          aria-label={item.charAt(0).toUpperCase() + item.slice(1)}
        >
          <span className="material-symbols-outlined text-[13px]">{TAB_ICONS[item]}</span>
          <span className="hidden sm:inline">{item.charAt(0).toUpperCase() + item.slice(1)}</span>
        </button>
      ))}
    </div>
  );
}

export function AgentCockpitBody({
  agentName,
  tab,
  prefersReducedMotion,
  children,
}: {
  agentName: string;
  tab: CockpitTab;
  prefersReducedMotion: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden relative">
      <AnimatePresence mode="wait">
        <motion.div
          key={`${agentName}-${tab}`}
          initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 flex flex-col"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function useCockpitTabState(cockpitAgent: string | null) {
  const [tab, setTab] = useState<CockpitTab>('terminal');

  useEffect(() => {
    setTab('terminal');
  }, [cockpitAgent]);

  useEffect(() => {
    const handler = (event: Event) => {
      const nextTab = (event as CustomEvent).detail;
      if (nextTab && TABS.includes(nextTab)) setTab(nextTab);
    };
    window.addEventListener('cockpit-tab', handler);
    return () => window.removeEventListener('cockpit-tab', handler);
  }, []);

  return { tab, setTab };
}
