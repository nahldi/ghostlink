import { useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { AgentIcon } from './AgentIcon';
import { AgentInfoPanel } from './AgentInfoPanel';
import { AddAgentModal } from './AddAgentModal';
import { api } from '../lib/api';
import type { Agent } from '../types';

function AgentChip({ agent }: { agent: Agent }) {
  const [showInfo, setShowInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const setAgents = useChatStore((s) => s.setAgents);
  const mode = useChatStore((s) => s.settings.experienceMode) || 'standard';
  const isBeginner = mode === 'beginner';

  const isOnline = agent.state === 'active' || agent.state === 'thinking' || agent.state === 'idle';
  const isThinking = agent.state === 'thinking';
  const isOffline = agent.state === 'offline';
  const isPaused = agent.state === 'paused';

  const handleAction = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      if (isPaused) {
        await api.resumeAgent(agent.name);
      } else if (isOnline) {
        await api.killAgent(agent.name);
      } else {
        await api.spawnAgent(agent.base, agent.label, agent.workspace || '.', agent.args || []);
        await new Promise(r => setTimeout(r, 3000));
      }
      const r = await api.getStatus();
      setAgents(r.agents);
    } catch (err) {
      console.warn('Agent action failed:', err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  return (
    <>
      <div
        className={`agent-chip relative flex items-center gap-3 px-3.5 py-2.5 rounded-2xl transition-all cursor-pointer group ${
          isThinking ? 'agent-chip-thinking' : ''
        }`}
        style={{
          '--agent-color': agent.color,
        } as React.CSSProperties}
        onClick={() => setShowInfo(true)}
      >
        {/* Thinking glow border — uses agent's brand color */}
        {isThinking && <div className="agent-spin-border" style={{ borderRadius: '16px' }} />}

        <div className="relative shrink-0">
          <AgentIcon base={agent.base} color={isOffline ? '#8880a0' : agent.color} size={32} />
          <div
            className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface transition-all"
            style={
              isThinking
                ? { backgroundColor: agent.color, boxShadow: `0 0 8px ${agent.color}90` }
                : isOnline
                  ? { backgroundColor: '#4ade80', boxShadow: '0 0 6px rgba(74,222,128,0.5)' }
                  : isPaused
                    ? { backgroundColor: '#fb923c' }
                    : { backgroundColor: 'rgba(255,255,255,0.15)' }
            }
          />
        </div>

        <div className="min-w-0">
          <div className="text-[12px] font-bold leading-tight truncate flex items-center gap-1" style={{
            color: isOffline ? undefined : agent.color,
          }}>
            <span className={isOffline ? 'text-on-surface-variant' : undefined}>
              {agent.label}
            </span>
            {!isBeginner && agent.role === 'manager' && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-yellow-500/20 text-yellow-400 leading-none uppercase">MGR</span>
            )}
            {!isBeginner && agent.role === 'worker' && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-blue-500/20 text-blue-400 leading-none uppercase">WKR</span>
            )}
            {!isBeginner && agent.role === 'peer' && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-400 leading-none uppercase">PEER</span>
            )}
          </div>
          <div className={`text-[10px] leading-tight truncate font-medium ${
            isPaused ? 'text-orange-400' : isOnline && !isThinking ? 'text-green-400/70' : isOffline ? 'text-on-surface-variant/60' : ''
          }`} style={isThinking ? { color: agent.color, opacity: 0.85 } : undefined}>
            {isThinking ? 'Thinking...' : isPaused ? 'Paused' : isOffline ? 'Offline' : 'Online'}
          </div>
        </div>

        {/* Quick action button */}
        <button
          onClick={handleAction}
          disabled={busy}
          className={`w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shrink-0 ${
            isPaused
              ? 'hover:bg-green-500/15 text-green-400/60 hover:text-green-400'
              : isOnline
                ? 'hover:bg-red-500/15 text-red-400/60 hover:text-red-400'
                : 'hover:bg-green-500/15 text-green-400/60 hover:text-green-400'
          } disabled:opacity-30`}
          title={isPaused ? 'Resume' : isOnline ? 'Stop' : 'Launch'}
        >
          <span className="material-symbols-outlined text-[16px]">
            {busy ? 'hourglass_empty' : isPaused ? 'play_circle' : isOnline ? 'stop_circle' : 'play_circle'}
          </span>
        </button>
        {/* Cockpit button — opens agent workspace panel */}
        {isOnline && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const store = useChatStore.getState();
              if (store.cockpitAgent === agent.name && store.sidebarPanel === 'cockpit') {
                store.setCockpitAgent(null);
              } else {
                store.setCockpitAgent(agent.name);
              }
            }}
            className="w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shrink-0 hover:bg-primary/15 text-primary/50 hover:text-primary"
            title="Open Cockpit"
          >
            <span className="material-symbols-outlined text-[16px]">monitor</span>
          </button>
        )}
      </div>

      {showInfo && <AgentInfoPanel agent={agent} onClose={() => setShowInfo(false)} />}
    </>
  );
}

export function AgentBar() {
  const agents = useChatStore((s) => s.agents);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <>
      {showAdd && <AddAgentModal onClose={() => setShowAdd(false)} />}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        {agents.map((agent) => (
          <AgentChip key={agent.name} agent={agent} />
        ))}
        <button
          onClick={() => setShowAdd(true)}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-on-surface-variant/20 hover:text-primary hover:bg-primary/8 transition-all shrink-0"
          title="Launch new agent"
        >
          <span className="material-symbols-outlined text-lg">add</span>
        </button>
      </div>
    </>
  );
}
