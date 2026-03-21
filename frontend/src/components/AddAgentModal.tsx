import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import { AgentIcon } from './AgentIcon';

import type { AgentTemplate } from '../types';

interface AddAgentModalProps {
  onClose: () => void;
}

const PERMISSION_PRESETS: Record<string, { label: string; args: string[]; desc: string }[]> = {
  claude: [
    { label: 'Full Bypass', args: ['--dangerously-skip-permissions'], desc: 'No permission prompts' },
    { label: 'Normal', args: [], desc: 'Asks before risky actions' },
  ],
  codex: [
    { label: 'Full Bypass', args: ['--sandbox', 'danger-full-access', '-a', 'never'], desc: 'Full access, no approval' },
    { label: 'Full Auto', args: ['--full-auto'], desc: 'Sandboxed, auto workspace' },
    { label: 'Normal', args: [], desc: 'Asks before actions' },
  ],
  gemini: [
    { label: 'YOLO', args: ['-y'], desc: 'Auto-approve all actions' },
    { label: 'Normal', args: [], desc: 'Asks before actions' },
  ],
};

export function AddAgentModal({ onClose }: AddAgentModalProps) {
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [label, setLabel] = useState('');
  const [cwd, setCwd] = useState('');
  const [permPreset, setPermPreset] = useState(0);
  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState('');
  const [pickingFolder, setPickingFolder] = useState(false);
  const setAgents = useChatStore((s) => s.setAgents);

  useEffect(() => {
    api.getAgentTemplates().then((r) => {
      setTemplates(r.templates.filter(t => t.available));
      if (r.templates.length > 0) {
        const first = r.templates.find(t => t.available);
        if (first) {
          setSelected(first.base);
          setCwd(first.defaultCwd === '.' ? '' : first.defaultCwd);
        }
      }
    }).catch(() => {});
  }, []);

  const template = templates.find(t => t.base === selected);
  const presets = PERMISSION_PRESETS[selected] || [{ label: 'Default', args: [], desc: 'Standard mode' }];

  const handleSpawn = async () => {
    if (!selected) return;
    setSpawning(true);
    setError('');
    try {
      const args = presets[permPreset]?.args || [];
      const finalLabel = label || template?.label || selected;
      const finalCwd = cwd || template?.defaultCwd || '.';
      await api.spawnAgent(selected, finalLabel, finalCwd, args);

      // Refresh agents list after a short delay
      setTimeout(async () => {
        try {
          const r = await api.getStatus();
          setAgents(r.agents);
        } catch {}
        onClose();
      }, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to spawn agent');
      setSpawning(false);
    }
  };

  const handlePickFolder = async () => {
    setPickingFolder(true);
    try {
      const r = await api.pickFolder();
      setCwd(r.path);
    } catch {}
    setPickingFolder(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-[440px] max-w-[92vw] rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(160deg, #141420 0%, #08080f 100%)',
          border: '1px solid rgba(167, 139, 250, 0.12)',
          boxShadow: '0 0 60px rgba(124, 58, 237, 0.1), 0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-on-surface">Launch Agent</h2>
            <p className="text-[11px] text-on-surface-variant/40 mt-0.5">Spawn a new AI agent into the chat</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant/40 hover:text-on-surface-variant">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* Agent Selection */}
          <div>
            <label className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider block mb-2">
              Agent Type
            </label>
            <div className="flex gap-2">
              {templates.map((t) => (
                <button
                  key={t.base}
                  onClick={() => {
                    setSelected(t.base);
                    setCwd(t.defaultCwd === '.' ? '' : t.defaultCwd);
                    setPermPreset(0);
                  }}
                  className={`flex-1 flex flex-col items-center gap-2 py-3 px-2 rounded-xl transition-all ${
                    selected === t.base
                      ? 'ring-1 ring-primary/30 bg-primary/5'
                      : 'bg-surface-container/40 hover:bg-surface-container/60 border border-transparent'
                  }`}
                >
                  <AgentIcon base={t.base} color={t.color} size={36} />
                  <span className="text-xs font-medium text-on-surface">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Label */}
          <div>
            <label className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider block mb-2">
              Display Name <span className="text-on-surface-variant/30">(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={template?.label || 'Agent'}
              className="w-full bg-surface-container/40 rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/25 outline-none border border-outline-variant/8 focus:border-primary/20 transition-all"
            />
          </div>

          {/* Workspace Path */}
          <div>
            <label className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider block mb-2">
              Workspace Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                className="flex-1 bg-surface-container/40 rounded-lg px-3 py-2.5 text-sm text-on-surface font-mono placeholder:text-on-surface-variant/25 outline-none border border-outline-variant/8 focus:border-primary/20 transition-all"
              />
              <button
                onClick={handlePickFolder}
                disabled={pickingFolder}
                className="px-3 py-2.5 rounded-lg bg-surface-container/60 border border-outline-variant/8 text-on-surface-variant/50 hover:text-primary hover:border-primary/20 transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-30"
                title="Open folder picker"
              >
                {pickingFolder ? (
                  <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                ) : (
                  <span className="material-symbols-outlined text-[16px]">folder_open</span>
                )}
                <span className="text-[11px] font-medium">{pickingFolder ? 'Picking...' : 'Browse'}</span>
              </button>
            </div>
            <p className="text-[10px] text-on-surface-variant/30 mt-1">
              Paste a Windows or Linux path — auto-converts to WSL
            </p>
          </div>

          {/* Permission Mode */}
          {presets.length > 1 && (
            <div>
              <label className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider block mb-2">
                Permission Mode
              </label>
              <div className="flex gap-2">
                {presets.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setPermPreset(i)}
                    className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-medium transition-all ${
                      permPreset === i
                        ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                        : 'bg-surface-container/40 text-on-surface-variant/50 hover:text-on-surface-variant/70'
                    }`}
                  >
                    <div className="font-semibold">{p.label}</div>
                    <div className="text-[10px] opacity-60 mt-0.5">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-error bg-error/5 border border-error/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Spawn Button */}
          <button
            onClick={handleSpawn}
            disabled={!selected || spawning}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-all ${
              spawning
                ? 'bg-primary/20 text-primary/60 cursor-wait'
                : 'bg-primary-container text-white hover:brightness-110 active:scale-[0.98]'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            style={{ boxShadow: spawning ? 'none' : '0 0 20px rgba(124, 58, 237, 0.2)' }}
          >
            {spawning ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                Launching...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-lg">rocket_launch</span>
                Launch {template?.label || 'Agent'}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
