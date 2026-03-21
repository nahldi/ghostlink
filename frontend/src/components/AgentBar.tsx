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
    } catch {}
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
        {/* Thinking glow border */}
        {isThinking && <div className="agent-spin-border" style={{ borderRadius: '16px' }} />}

        <div className="relative shrink-0">
          <AgentIcon base={agent.base} color={isOffline ? '#8880a0' : agent.color} size={32} />
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface transition-all ${
              isThinking
                ? 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]'
                : isOnline
                  ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]'
                  : isPaused
                    ? 'bg-orange-400'
                    : 'bg-on-surface-variant/30'
            }`}
          />
        </div>

        <div className="min-w-0">
          <div className="text-[12px] font-bold leading-tight truncate" style={{
            color: isOffline ? undefined : agent.color,
          }}>
            <span className={isOffline ? 'text-on-surface-variant' : undefined}>
              {agent.label}
            </span>
          </div>
          <div className={`text-[10px] leading-tight truncate font-medium ${
            isThinking ? 'text-yellow-400' : isPaused ? 'text-orange-400' : isOnline ? 'text-green-400/70' : 'text-on-surface-variant/60'
          }`}>
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
