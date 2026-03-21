import { useState } from 'react';
import type { Agent } from '../types';
import { AgentIcon } from './AgentIcon';
import { AgentInfoPanel } from './AgentInfoPanel';
import { useChatStore } from '../stores/chatStore';
import { AddAgentModal } from './AddAgentModal';

export function AgentMiniCard({ agent }: { agent: Agent }) {
  const [showInfo, setShowInfo] = useState(false);

  const isOnline = agent.state === 'active' || agent.state === 'thinking' || agent.state === 'idle';
  const isThinking = agent.state === 'thinking';
  const isPaused = agent.state === 'paused';

  return (
    <>
      <button
        onClick={() => setShowInfo(true)}
        className={`agent-mini-card relative shrink-0 transition-all ${
          isThinking ? 'agent-mini-thinking' : ''
        }`}
        title={`${agent.label} - ${isThinking ? 'Thinking' : isPaused ? 'Paused' : isOnline ? 'Online' : 'Offline'}`}
      >
        <AgentIcon base={agent.base} color={isOnline ? agent.color : '#4a4560'} size={28} />
        <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-[1.5px] transition-all ${
          isThinking
            ? 'bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.5)]'
            : isOnline
              ? 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.4)]'
              : isPaused
                ? 'bg-orange-400'
                : 'bg-on-surface-variant/20'
        }`} style={{ borderColor: 'var(--agent-mini-border, rgba(14, 14, 22, 0.92))' }} />
      </button>
      {showInfo && <AgentInfoPanel agent={agent} onClose={() => setShowInfo(false)} />}
    </>
  );
}

export function AgentMiniBarConnected() {
  const agents = useChatStore((s) => s.agents);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <>
      {showAdd && <AddAgentModal onClose={() => setShowAdd(false)} />}
      <div className="flex items-center gap-1.5">
        {agents.map(agent => (
          <AgentMiniCard key={agent.name} agent={agent} />
        ))}
        <button
          onClick={() => setShowAdd(true)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant/20 hover:text-primary hover:bg-primary/8 transition-all shrink-0"
          title="Add agent"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
        </button>
      </div>
    </>
  );
}
