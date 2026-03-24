import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Agent } from '../types';
import { AgentIcon } from './AgentIcon';
import { AgentInfoPanel } from './AgentInfoPanel';

export function AgentStatusPill({ agent }: { agent: Agent }) {
  const [showInfo, setShowInfo] = useState(false);
  const isOnline = agent.state === 'active' || agent.state === 'idle' || agent.state === 'thinking';
  const isOffline = agent.state === 'offline';

  return (
    <>
      <button
        onClick={() => setShowInfo(true)}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all cursor-pointer text-left ${
          isOffline ? 'opacity-40' : ''
        } hover:bg-surface-container-high/30`}
      >
        <div className="relative">
          <AgentIcon base={agent.base} color={isOffline ? '#6b6580' : agent.color} size={32} />
          <motion.div
            animate={{
              backgroundColor: isOnline ? 'rgb(74, 222, 128)' : 'rgb(75, 70, 96)',
              boxShadow: isOnline ? '0 0 5px rgba(74,222,128,0.5)' : '0 0 0px transparent',
            }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-[1.5px]"
            style={{ borderColor: '#08080f' }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-semibold truncate ${isOffline ? 'text-on-surface-variant/50' : 'text-on-surface'}`}>
            {agent.label}
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={agent.state}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.18 }}
              className="text-[10px] truncate text-on-surface-variant/40"
            >
              {isOffline ? 'Offline' : agent.role || providerTag(agent.base)}
            </motion.div>
          </AnimatePresence>
        </div>
      </button>
      {showInfo && <AgentInfoPanel agent={agent} onClose={() => setShowInfo(false)} />}
    </>
  );
}

function providerTag(base: string): string {
  const map: Record<string, string> = { claude: 'Anthropic', codex: 'OpenAI', gemini: 'Google', grok: 'xAI' };
  return map[base] || base;
}
