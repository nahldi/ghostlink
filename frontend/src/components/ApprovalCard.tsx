import { useState } from 'react';
import { AgentIcon } from './AgentIcon';
import { api } from '../lib/api';
import { toast } from './Toast';

interface ApprovalCardProps {
  messageId: number;
  agent: string;
  agentColor?: string;
  agentBase?: string;
  prompt: string;
  responded?: string;
}

const RESPONSE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  allow_once: { label: 'Allowed Once', icon: 'check_circle', color: '#22c55e' },
  allow_session: { label: 'Allowed for Session', icon: 'verified', color: '#3b82f6' },
  deny: { label: 'Denied', icon: 'cancel', color: '#ef4444' },
};

export function ApprovalCard({ messageId, agent, agentColor, agentBase, prompt, responded }: ApprovalCardProps) {
  const [sending, setSending] = useState(false);
  const [localResponse, setLocalResponse] = useState<string | undefined>(responded);

  const handleRespond = async (response: string) => {
    if (sending || localResponse) return;
    setSending(true);
    try {
      await api.respondApproval(agent, response, messageId);
      setLocalResponse(response);
    } catch (err) {
      toast('Approval response failed', 'error');
    } finally {
      setSending(false);
    }
  };

  const effectiveResponse = localResponse || responded;
  const responseInfo = effectiveResponse ? RESPONSE_LABELS[effectiveResponse] : null;

  return (
    <div className="bg-surface p-4 rounded-xl border border-amber-500/20 my-3" style={{ background: 'rgba(245, 158, 11, 0.04)' }}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-amber-400 text-[18px]">shield</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-1.5">
            Permission Required
          </div>
          <div className="flex items-center gap-2 mb-2">
            <AgentIcon base={agentBase || agent} color={agentColor || '#a78bfa'} size={18} />
            <span className="text-xs font-semibold" style={{ color: agentColor || '#a78bfa' }}>
              {agent}
            </span>
            <span className="text-[10px] text-on-surface-variant/50">needs approval</span>
          </div>
          <pre className="text-xs text-on-surface/80 bg-surface-container/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed border border-outline-variant/10 max-h-[200px] overflow-y-auto">
            {prompt}
          </pre>
        </div>
      </div>

      {effectiveResponse ? (
        <div className="mt-3 flex items-center gap-2 text-xs ml-12">
          <span className="material-symbols-outlined text-sm" style={{ color: responseInfo?.color }}>
            {responseInfo?.icon}
          </span>
          <span style={{ color: responseInfo?.color }}>{responseInfo?.label}</span>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 ml-12">
          <button
            onClick={() => handleRespond('allow_once')}
            disabled={sending}
            className="px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500/25 transition-all active:scale-95 border border-emerald-500/20 disabled:opacity-50"
          >
            Allow
          </button>
          <button
            onClick={() => handleRespond('allow_session')}
            disabled={sending}
            className="px-4 py-2 rounded-lg bg-blue-500/15 text-blue-400 text-[10px] font-bold uppercase tracking-widest hover:bg-blue-500/25 transition-all active:scale-95 border border-blue-500/20 disabled:opacity-50"
          >
            Allow All Session
          </button>
          <button
            onClick={() => handleRespond('deny')}
            disabled={sending}
            className="px-4 py-2 rounded-lg bg-red-500/10 text-red-400 text-[10px] font-bold uppercase tracking-widest hover:bg-red-500/20 transition-all active:scale-95 border border-red-500/15 disabled:opacity-50"
          >
            Deny
          </button>
        </div>
      )}
    </div>
  );
}
