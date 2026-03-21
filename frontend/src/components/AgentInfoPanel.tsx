import { useState } from 'react';
import type { Agent } from '../types';
import { AgentIcon } from './AgentIcon';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';

interface AgentInfoPanelProps {
  agent: Agent;
  onClose: () => void;
}

function timeAgo(ts: number): string {
  const now = Date.now() / 1000;
  const diff = now - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function AgentInfoPanel({ agent, onClose }: AgentInfoPanelProps) {
  const isActive = agent.state === 'active' || agent.state === 'idle';
  const [killing, setKilling] = useState(false);
  const [launching, setLaunching] = useState(false);
  const setAgents = useChatStore((s) => s.setAgents);

  const handleLaunch = async () => {
    setLaunching(true);
    try {
      await api.spawnAgent(agent.base, agent.label, agent.workspace || '.', agent.args || []);
      setTimeout(async () => {
        try {
          const r = await api.getStatus();
          setAgents(r.agents);
        } catch {}
        onClose();
      }, 3000);
    } catch {
      setLaunching(false);
    }
  };

  const handleKill = async () => {
    setKilling(true);
    try {
      await api.killAgent(agent.name);
      const r = await api.getStatus();
      setAgents(r.agents);
      onClose();
    } catch {
      setKilling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[380px] max-w-[90vw] rounded-2xl border border-outline-variant/20 overflow-hidden"
        style={{
          background: 'linear-gradient(145deg, #1a1a28 0%, #0f0f17 100%)',
          boxShadow: `0 0 40px ${agent.color}15, 0 20px 60px rgba(0,0,0,0.5)`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with agent color accent */}
        <div
          className="h-1.5 w-full"
          style={{ background: `linear-gradient(90deg, ${agent.color}, ${agent.color}40)` }}
        />

        <div className="p-6">
          {/* Agent identity */}
          <div className="flex items-center gap-4 mb-6">
            <div className="relative">
              <AgentIcon base={agent.base} color={agent.color} size={56} />
              <div
                className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 ${
                  isActive
                    ? 'bg-green-400 border-surface shadow-[0_0_8px_rgba(74,222,128,0.6)]'
                    : 'bg-gray-600 border-surface'
                }`}
                style={{ borderColor: '#0f0f17' }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-bold text-on-surface">{agent.label}</div>
              <div className="text-xs text-on-surface-variant">@{agent.name}</div>
              {agent.role && (
                <div
                  className="text-[11px] font-medium mt-1 px-2 py-0.5 rounded-full inline-block"
                  style={{ backgroundColor: agent.color + '20', color: agent.color }}
                >
                  {agent.role}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          {/* Info grid */}
          <div className="space-y-3">
            <InfoRow
              icon="terminal"
              label="Command"
              value={`${agent.command || agent.base}${agent.args?.length ? ' ' + agent.args.join(' ') : ''}`}
              color={agent.color}
            />
            <InfoRow
              icon="folder"
              label="Workspace"
              value={agent.workspace || 'N/A'}
              color={agent.color}
              mono
            />
            <InfoRow
              icon="hub"
              label="Provider"
              value={providerName(agent.base)}
              color={agent.color}
            />
            <InfoRow
              icon="schedule"
              label="Connected"
              value={agent.registered_at ? timeAgo(agent.registered_at) : 'Unknown'}
              color={agent.color}
            />
            <InfoRow
              icon="tag"
              label="Status"
              value={isActive ? 'Online & Ready' : agent.state === 'pending' ? 'Connecting...' : 'Offline'}
              color={isActive ? '#4ade80' : '#6b7280'}
            />
            <InfoRow
              icon="numbers"
              label="Instance"
              value={`Slot ${agent.slot}`}
              color={agent.color}
            />
          </div>

          {/* Actions */}
          <div className="mt-5 pt-4 border-t border-outline-variant/8 flex gap-2">
            {isActive ? (
              <button
                onClick={handleKill}
                disabled={killing}
                className="flex-1 py-2 rounded-lg text-xs font-medium text-error/60 hover:text-error hover:bg-error/5 border border-error/10 transition-all disabled:opacity-30"
              >
                {killing ? 'Stopping...' : 'Stop Agent'}
              </button>
            ) : (
              <button
                onClick={handleLaunch}
                disabled={launching}
                className="flex-1 py-2 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 border border-primary/20 transition-all disabled:opacity-30"
              >
                {launching ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    Launching...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">rocket_launch</span>
                    Launch Agent
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value, color, mono }: {
  icon: string;
  label: string;
  value: string;
  color: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2 px-3 rounded-xl bg-surface-container/50 border border-outline-variant/5">
      <span
        className="material-symbols-outlined text-base mt-0.5 shrink-0"
        style={{ color }}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">
          {label}
        </div>
        <div
          className={`text-xs text-on-surface ${mono ? 'font-mono' : ''} break-all leading-relaxed`}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function providerName(base: string): string {
  const map: Record<string, string> = {
    claude: 'Anthropic',
    codex: 'OpenAI',
    gemini: 'Google DeepMind',
    grok: 'xAI',
    copilot: 'Microsoft',
  };
  return map[base] || base.charAt(0).toUpperCase() + base.slice(1);
}
