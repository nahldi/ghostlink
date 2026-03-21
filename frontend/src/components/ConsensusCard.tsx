import { useChatStore } from '../stores/chatStore';
import { AgentIcon } from './AgentIcon';
import { timeAgo } from '../lib/timeago';

interface ConsensusResponse {
  agent: string;
  text: string;
  timestamp: number;
}

interface ConsensusCardProps {
  question: string;
  responses: ConsensusResponse[];
}

export function ConsensusCard({ question, responses }: ConsensusCardProps) {
  const agents = useChatStore((s) => s.agents);

  return (
    <div
      className="my-2 p-4 rounded-xl border border-outline-variant/10"
      style={{ background: 'rgba(167, 139, 250, 0.04)' }}
    >
      <div className="text-[9px] font-bold text-primary/50 uppercase tracking-widest mb-2">
        Consensus
      </div>
      <div className="text-[12px] font-semibold text-on-surface mb-3">
        {question}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {responses.map((r) => {
          const agent = agents.find((a) => a.name === r.agent);
          const color = agent?.color || '#a78bfa';
          return (
            <div
              key={r.agent}
              className="p-3 rounded-lg border border-outline-variant/8"
              style={{ background: color + '08' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <AgentIcon
                  base={agent?.base || 'default'}
                  color={color}
                  size={24}
                />
                <span className="text-[10px] font-semibold" style={{ color }}>
                  {agent?.label || r.agent}
                </span>
                <span className="text-[9px] text-on-surface-variant/20 ml-auto">
                  {timeAgo(r.timestamp)}
                </span>
              </div>
              <div className="text-[11px] text-on-surface-variant/60 leading-relaxed whitespace-pre-wrap">
                {r.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
