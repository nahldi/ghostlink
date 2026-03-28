import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import { AgentIcon } from './AgentIcon';
import type { AgentTemplate } from '../types';

interface AddAgentModalProps {
  onClose: () => void;
}

const MODEL_OPTIONS: Record<string, { label: string; value: string; desc: string }[]> = {
  claude: [
    { label: 'Opus 4.6', value: 'opus', desc: 'Most capable — complex coding, architecture, deep reasoning' },
    { label: 'Sonnet 4.6', value: 'sonnet', desc: 'Fast + capable — best balance of speed and quality' },
    { label: 'Haiku 3.5', value: 'haiku', desc: 'Fastest — quick tasks, simple edits, low cost' },
  ],
  codex: [
    { label: 'GPT-5.4', value: 'gpt-5.4', desc: 'Latest — strongest coding and reasoning' },
    { label: 'GPT-5.4 Pro', value: 'gpt-5.4-pro', desc: 'Extended thinking — hardest problems' },
    { label: 'GPT-5.3 Codex', value: 'gpt-5.3-codex', desc: 'Code-optimized — fast code generation' },
    { label: 'o3', value: 'o3', desc: 'Reasoning model — step-by-step problem solving' },
    { label: 'o4-mini', value: 'o4-mini', desc: 'Fast reasoning — quick analysis, lower cost' },
  ],
  gemini: [
    { label: 'Gemini 3.1 Pro', value: 'gemini-3.1-pro-preview', desc: 'Latest — most capable, 1M context' },
    { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro', desc: 'Strong all-around — great for research' },
    { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash-preview-05-20', desc: 'Fast — efficient, lower cost' },
    { label: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash', desc: 'Previous gen — stable, proven' },
  ],
  grok: [
    { label: 'Grok 3', value: 'grok-3', desc: 'Latest — strong reasoning and real-time data' },
    { label: 'Grok 3 Mini', value: 'grok-3-mini', desc: 'Faster — good for quick tasks' },
  ],
  aider: [
    { label: 'Default', value: '', desc: 'Uses configured model' },
  ],
};

const MODEL_FLAGS: Record<string, string> = {
  claude: '--model',
  codex: '-m',
  gemini: '-m',
  grok: '--model',
  aider: '--model',
};

const PERMISSION_PRESETS: Record<string, { label: string; args: string[]; desc: string }[]> = {
  claude: [
    { label: 'Full Bypass', args: ['--dangerously-skip-permissions'], desc: 'Skip all permission checks — full autonomous mode' },
    { label: 'Accept Edits', args: ['--permission-mode', 'acceptEdits'], desc: 'Auto-approve file edits, ask for commands' },
    { label: 'Default', args: [], desc: 'Ask before all risky actions' },
    { label: 'Plan Mode', args: ['--permission-mode', 'plan'], desc: 'Read-only — analyze and plan without making changes' },
  ],
  codex: [
    { label: 'Full Bypass', args: ['--sandbox', 'danger-full-access', '-a', 'never'], desc: 'Full disk access, never ask — maximum autonomy' },
    { label: 'Full Auto', args: ['--full-auto'], desc: 'Sandboxed workspace write, auto-approve safe actions' },
    { label: 'Default', args: [], desc: 'Ask before executing commands' },
  ],
  gemini: [
    { label: 'YOLO', args: ['-y'], desc: 'Auto-approve all tool actions — full autonomous mode' },
    { label: 'Auto Edit', args: ['--approval-mode', 'auto_edit'], desc: 'Auto-approve edits, ask for other actions' },
    { label: 'Default', args: [], desc: 'Prompt for approval on each action' },
    { label: 'Plan Mode', args: ['--approval-mode', 'plan'], desc: 'Read-only — analyze without making changes' },
  ],
  grok: [
    { label: 'Default', args: [], desc: 'Standard mode' },
  ],
  aider: [
    { label: 'Auto Yes', args: ['--yes'], desc: 'Auto-accept all suggestions' },
    { label: 'Default', args: [], desc: 'Ask before applying changes' },
  ],
  goose: [
    { label: 'Default', args: [], desc: 'Standard mode with Ollama or API' },
  ],
  opencode: [
    { label: 'Default', args: [], desc: 'Standard mode' },
  ],
  ollama: [
    { label: 'Default', args: ['run', 'qwen2.5-coder'], desc: 'Run default coding model' },
  ],
  copilot: [
    { label: 'Default', args: [], desc: 'GitHub Copilot mode' },
  ],
};

export function AddAgentModal({ onClose }: AddAgentModalProps) {
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [selected, setSelected] = useState('');
  const [label, setLabel] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [cwd, setCwd] = useState('');
  const [selectedModel, setSelectedModel] = useState(0);
  const [permPreset, setPermPreset] = useState(0);
  const [spawning, setSpawning] = useState(false);
  const spawnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // v2.5.1: Cleanup spawn timer on unmount to prevent state update on unmounted component
  useEffect(() => {
    return () => {
      if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current);
    };
  }, []);
  const [error, setError] = useState('');
  const [pickingFolder, setPickingFolder] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [bridgePlatform, setBridgePlatform] = useState('');
  const [bridgeToken, setBridgeToken] = useState('');
  const agents = useChatStore((s) => s.agents);
  const setAgents = useChatStore((s) => s.setAgents);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const settings = useChatStore((s) => s.settings);

  useEffect(() => {
    // Pass all known agent base names: running + persistent + stored connected
    const connectedBases = [...new Set([
      ...agents.map(a => a.base),
      ...(settings.persistentAgents || []).map(a => a.base),
    ])];
    api.getAgentTemplates(connectedBases).then((r) => {
      setTemplates(r.templates);
      const available = r.templates.filter(t => t.available);
      if (available.length > 0) {
        setSelected(available[0].base);
      }
    }).catch((e) => console.warn('Agent templates fetch:', e.message || e));
  }, [agents, settings.persistentAgents]);

  const template = templates.find(t => t.base === selected);
  const presets = PERMISSION_PRESETS[selected] || [{ label: 'Default', args: [], desc: 'Standard mode' }];
  // templates already contains available flag per agent

  const handlePickFolder = async () => {
    setPickingFolder(true);
    try {
      const r = await api.pickFolder();
      setCwd(r.path);
    } catch (e) { console.warn('Pick folder:', e instanceof Error ? e.message : String(e)); }
    setPickingFolder(false);
  };

  const handleSpawn = async () => {
    if (!selected || !template) return;
    setSpawning(true);
    setError('');

    const models = MODEL_OPTIONS[selected] || [];
    const modelVal = models[selectedModel]?.value || '';
    const modelFlag = MODEL_FLAGS[selected] || '--model';
    const finalArgs = [
      ...(presets[permPreset]?.args || []),
      ...(modelVal ? [modelFlag, modelVal] : []),
    ];
    const finalLabel = label || template.label;
    const finalCwd = cwd || '.';

    try {
      // Save as persistent agent if checked
      if (persistent) {
        const existing = settings.persistentAgents || [];
        // Don't duplicate
        if (!existing.find(a => a.base === selected)) {
          const updated = [...existing, {
            base: selected,
            label: finalLabel,
            command: template.command,
            args: finalArgs,
            cwd: finalCwd,
            color: template.color,
          }];
          updateSettings({ persistentAgents: updated });
          await api.saveSettings({ persistentAgents: updated });
        }
      }

      await api.spawnAgent(selected, finalLabel, finalCwd, finalArgs, roleDescription);

      // v3.7.0: Configure bridge if selected
      if (bridgePlatform && bridgeToken) {
        try {
          await api.configureBridge(bridgePlatform, { token: bridgeToken });
          await api.startBridge(bridgePlatform);
        } catch (e) {
          console.warn('Bridge config after spawn:', e instanceof Error ? e.message : String(e));
        }
      }

      // v2.5.1: Use ref for cleanup on unmount
      spawnTimerRef.current = setTimeout(async () => {
        try {
          const r = await api.getStatus();
          setAgents(r.agents);
        } catch (e) { console.warn('Status fetch after spawn:', e instanceof Error ? e.message : String(e)); }
        onClose();
      }, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to spawn');
      setSpawning(false);
      // Remove the persistent agent entry if spawn failed
      if (persistent && selected) {
        const existing = settings.persistentAgents || [];
        const rolled = existing.filter(a => a.base !== selected);
        if (rolled.length < existing.length) {
          updateSettings({ persistentAgents: rolled });
          api.saveSettings({ persistentAgents: rolled }).catch((e) => console.warn('Settings save:', e.message || e));
        }
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-[480px] max-w-[94vw] max-h-[85vh] overflow-y-auto rounded-2xl"
        style={{
          background: 'linear-gradient(160deg, #141420 0%, #08080f 100%)',
          border: '1px solid rgba(167, 139, 250, 0.12)',
          boxShadow: '0 0 60px rgba(124, 58, 237, 0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex items-center justify-between sticky top-0 z-10" style={{ background: 'inherit' }}>
          <div>
            <h2 className="text-base font-semibold text-on-surface">New Agent</h2>
            <p className="text-[11px] text-on-surface-variant/40 mt-0.5">Configure and launch an AI agent</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant/40 hover:text-on-surface-variant">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* Agent Selection — PRIMARY required step */}
          <Section label="Agent">
            <div className="grid grid-cols-3 gap-2">
              {templates.filter(t => t.available).map((t) => (
                <button
                  key={t.base}
                  onClick={() => { setSelected(t.base); setLabel(''); setPermPreset(0); setSelectedModel(0); }}
                  className={`flex flex-col items-center gap-2 py-3 px-2 rounded-xl transition-all ${
                    selected === t.base
                      ? 'ring-1 ring-primary/30 bg-primary/8'
                      : 'bg-surface-container/30 hover:bg-surface-container/50'
                  }`}
                >
                  <AgentIcon base={t.base} color={t.color} size={32} />
                  <div className="text-center">
                    <div className="text-[10px] font-semibold text-on-surface">{t.label}</div>
                    <div className="text-[8px] text-on-surface-variant/30">{t.provider || 'Ready'}</div>
                  </div>
                </button>
              ))}
            </div>
            {templates.filter(t => t.available).length === 0 && (
              <div className="text-center py-6">
                <span className="material-symbols-outlined text-[32px] text-on-surface-variant/20 mb-2 block">smart_toy</span>
                <div className="text-[11px] text-on-surface-variant/40 mb-1">No agents installed</div>
                <div className="text-[10px] text-on-surface-variant/30">Install a CLI agent from the launcher to get started.</div>
              </div>
            )}
          </Section>

          {/* Only show config form when agents are available */}
          {!selected ? null : <>

          {/* Display Name */}
          <Section label="Name" hint="Give your agent a custom name">
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder={template?.label || 'Agent'} className="setting-input text-[13px]" />
          </Section>

          {/* Workspace */}
          <Section label="Workspace">
            <div className="flex gap-2">
              <input
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="Current directory (.)"
                className="setting-input flex-1 text-[12px] font-mono"
              />
              <button
                onClick={handlePickFolder}
                disabled={pickingFolder}
                className="px-3 rounded-xl bg-surface-container/50 border border-outline-variant/8 text-on-surface-variant/40 hover:text-primary hover:border-primary/15 transition-all shrink-0 disabled:opacity-30 flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                <span className="text-[11px] font-medium">{pickingFolder ? '...' : 'Browse'}</span>
              </button>
            </div>
          </Section>

          {/* Role Presets — optional, collapsed */}
          <details className="group">
            <summary className="text-[10px] font-semibold text-on-surface-variant/40 uppercase tracking-wider cursor-pointer hover:text-on-surface-variant/60 select-none flex items-center gap-1 py-1">
              <span className="material-symbols-outlined text-[14px] transition-transform group-open:rotate-90">chevron_right</span>
              Role Presets
              <span className="text-[8px] text-on-surface-variant/25 ml-1 font-normal normal-case tracking-normal">optional — pre-configured agent roles</span>
            </summary>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {([
                { label: 'Code Reviewer', icon: 'rate_review', base: 'claude', desc: 'Reviews PRs and suggests improvements', perm: 0 },
                { label: 'Project Manager', icon: 'assignment', base: 'claude', desc: 'Tracks tasks, plans work, coordinates', perm: 0 },
                { label: 'DevOps Engineer', icon: 'cloud', base: 'codex', desc: 'CI/CD, Docker, deployment', perm: 0 },
                { label: 'Creative Writer', icon: 'edit_note', base: 'gemini', desc: 'Documentation, copy, content', perm: 0 },
                { label: 'Research Analyst', icon: 'science', base: 'gemini', desc: 'Deep research, analysis', perm: 0 },
                { label: 'Test Engineer', icon: 'bug_report', base: 'codex', desc: 'Tests, bugs, quality', perm: 0 },
              ]).map(preset => {
                const isAvailable = templates.some(t => t.base === preset.base && t.available);
                const isActive = label === preset.label && selected === preset.base;
                return (
                  <button
                    key={preset.label}
                    disabled={!isAvailable}
                    onClick={() => {
                      setSelected(preset.base);
                      setLabel(preset.label);
                      setRoleDescription(preset.desc);
                      setPermPreset(preset.perm);
                      setSelectedModel(0);
                    }}
                    className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all text-left ${
                      isActive
                        ? 'bg-primary/8 border-primary/20'
                        : isAvailable
                          ? 'bg-surface-container/30 hover:bg-surface-container/50 border-outline-variant/8 hover:border-primary/15'
                          : 'bg-surface-container/20 border-outline-variant/5 opacity-40 cursor-not-allowed'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px] text-primary/60 mt-0.5">{preset.icon}</span>
                    <div>
                      <div className="text-[10px] font-semibold text-on-surface">{preset.label}</div>
                      <div className="text-[8px] text-on-surface-variant/40 mt-0.5">{preset.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </details>

          {/* Advanced Options — collapsed by default */}
          <details className="group">
            <summary className="text-[10px] font-semibold text-on-surface-variant/40 uppercase tracking-wider cursor-pointer hover:text-on-surface-variant/60 select-none flex items-center gap-1 py-1">
              <span className="material-symbols-outlined text-[14px] transition-transform group-open:rotate-90">chevron_right</span>
              Advanced Options
            </summary>
            <div className="space-y-4 mt-3">

              {/* Permission Mode */}
              {presets.length > 1 && (
                <Section label="Permission Mode">
                  <div className="space-y-1">
                    {presets.map((p, i) => (
                      <button key={presets[i]?.label || i} onClick={() => setPermPreset(i)}
                        className={`w-full text-left py-2 px-3 rounded-xl transition-all ${
                          permPreset === i ? 'bg-primary/8 ring-1 ring-primary/20' : 'bg-surface-container/30 hover:bg-surface-container/50'
                        }`}>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-on-surface">{p.label}</span>
                          {permPreset === i && <span className="material-symbols-outlined text-primary text-[14px]">check_circle</span>}
                        </div>
                        <div className="text-[9px] text-on-surface-variant/40 mt-0.5">{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {/* Model Selection */}
              {(MODEL_OPTIONS[selected] || []).length > 0 && (
                <Section label="Model">
                  <div className="space-y-1">
                    {(MODEL_OPTIONS[selected] || []).map((m, i) => (
                      <button key={m.value || 'default'} onClick={() => setSelectedModel(i)}
                        className={`w-full text-left py-2 px-3 rounded-xl transition-all ${
                          selectedModel === i ? 'bg-primary/8 ring-1 ring-primary/20' : 'bg-surface-container/30 hover:bg-surface-container/50'
                        }`}>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-on-surface">{m.label}</span>
                          {selectedModel === i && <span className="material-symbols-outlined text-primary text-[14px]">check_circle</span>}
                        </div>
                        <div className="text-[9px] text-on-surface-variant/40 mt-0.5">{m.desc}</div>
                      </button>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          </details>

          {/* Bridge Connection — connect agent to external chat platform */}
          <details className="group">
            <summary className="text-[10px] font-semibold text-on-surface-variant/40 uppercase tracking-wider cursor-pointer hover:text-on-surface-variant/60 select-none flex items-center gap-1 py-1">
              <span className="material-symbols-outlined text-[14px] transition-transform group-open:rotate-90">chevron_right</span>
              Bridge Connection
              <span className="text-[8px] text-on-surface-variant/25 ml-1 font-normal normal-case tracking-normal">optional — connect to Discord, Telegram, etc.</span>
            </summary>
            <div className="space-y-3 mt-3">
              <div className="text-[10px] text-on-surface-variant/40 mb-2">
                Connect this agent to an external chat platform. Messages will sync bidirectionally.
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {([
                  { id: '', icon: 'block', label: 'None' },
                  { id: 'discord', icon: '🎮', label: 'Discord' },
                  { id: 'telegram', icon: '✈️', label: 'Telegram' },
                  { id: 'slack', icon: '💬', label: 'Slack' },
                  { id: 'whatsapp', icon: '📱', label: 'WhatsApp' },
                ] as const).map(b => (
                  <button
                    key={b.id}
                    onClick={() => { setBridgePlatform(b.id); if (!b.id) setBridgeToken(''); }}
                    className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl transition-all text-center ${
                      bridgePlatform === b.id
                        ? 'ring-1 ring-primary/30 bg-primary/8'
                        : 'bg-surface-container/30 hover:bg-surface-container/50'
                    }`}
                  >
                    {b.id ? (
                      <span className="text-base">{b.icon}</span>
                    ) : (
                      <span className="material-symbols-outlined text-base text-on-surface-variant/30">{b.icon}</span>
                    )}
                    <span className="text-[8px] font-medium text-on-surface-variant/60">{b.label}</span>
                  </button>
                ))}
              </div>
              {bridgePlatform && (
                <div className="space-y-2">
                  <Section label={`${bridgePlatform.charAt(0).toUpperCase() + bridgePlatform.slice(1)} Bot Token`}>
                    <input
                      type="password"
                      value={bridgeToken}
                      onChange={(e) => setBridgeToken(e.target.value)}
                      placeholder={bridgePlatform === 'discord' ? 'Bot token from Discord Developer Portal' :
                                   bridgePlatform === 'telegram' ? 'Bot token from @BotFather' :
                                   bridgePlatform === 'slack' ? 'Incoming webhook URL' :
                                   'API token'}
                      className="setting-input text-[12px] font-mono"
                    />
                  </Section>
                  <div className="text-[9px] text-on-surface-variant/30 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">info</span>
                    {bridgePlatform === 'discord' ? 'Get a bot token at discord.com/developers → Bot → Token' :
                     bridgePlatform === 'telegram' ? 'Message @BotFather on Telegram → /newbot → copy token' :
                     bridgePlatform === 'slack' ? 'Create an incoming webhook at api.slack.com/apps' :
                     'Get your API credentials from the platform dashboard'}
                  </div>
                </div>
              )}
            </div>
          </details>

          {/* Persistent toggle */}
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-[11px] font-semibold text-on-surface">Save as Persistent Agent</div>
              <div className="text-[10px] text-on-surface-variant/30">Always shows in the agent bar, even when offline</div>
            </div>
            <button
              onClick={() => setPersistent(!persistent)}
              className={`w-10 h-5 rounded-full relative transition-all ${
                persistent ? 'bg-green-500/80' : 'bg-outline-variant/30'
              }`}
            >
              <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all shadow-sm ${
                persistent ? 'right-0.5' : 'left-0.5'
              }`} />
            </button>
          </div>

          {error && (
            <div className="text-xs bg-error/5 border border-error/10 rounded-xl px-3 py-2.5 space-y-1">
              <div className="flex items-center gap-1.5 text-error font-medium">
                <span className="material-symbols-outlined text-[14px]">error</span>
                {error.includes('not found') ? `${selected} CLI not installed` : 'Launch failed'}
              </div>
              <div className="text-on-surface-variant/50 text-[10px] leading-relaxed">{error}</div>
            </div>
          )}

          {/* Launch */}
          <button
            onClick={handleSpawn}
            disabled={!selected || spawning}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-all ${
              spawning
                ? 'bg-primary/20 text-primary/60 cursor-wait'
                : 'bg-primary-container text-white hover:brightness-110 active:scale-[0.98]'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            style={{ boxShadow: spawning ? 'none' : '0 0 20px rgba(124, 58, 237, 0.15)' }}
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

          </>}
        </div>
      </div>
    </div>
  );
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">{label}</label>
        {hint && <span className="text-[9px] text-on-surface-variant/25">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
