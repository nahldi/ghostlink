import { useState, useCallback, useRef, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import { AgentIcon } from './AgentIcon';
import type { Settings, PersistentAgent } from '../types';

const AGENT_PRESETS: { base: string; label: string; command: string; color: string; defaultArgs: string[] }[] = [
  { base: 'claude', label: 'Claude', command: 'claude', color: '#e8734a', defaultArgs: ['--dangerously-skip-permissions'] },
  { base: 'codex', label: 'Codex', command: 'codex', color: '#10a37f', defaultArgs: ['--sandbox', 'danger-full-access', '-a', 'never'] },
  { base: 'gemini', label: 'Gemini', command: 'gemini', color: '#4285f4', defaultArgs: ['-y'] },
];

export function SettingsPanel() {
  const settings = useChatStore((s) => s.settings);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const [draft, setDraft] = useState<Partial<Settings>>({} as Partial<Settings>);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Merge draft with store settings for display
  const display = { ...settings, ...draft };
  const hasPendingChanges = Object.keys(draft).length > 0;

  const updateDraft = (updates: Partial<Settings>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
    setSaved(false);
  };

  // Instant-apply settings (toggles, theme)
  const applyInstant = useCallback((updates: Partial<Settings>) => {
    updateSettings(updates);
    api.saveSettings(updates).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [updateSettings]);

  // Save all pending draft changes
  const applyAll = useCallback(() => {
    if (!hasPendingChanges) return;
    setSaving(true);
    updateSettings(draft);
    api.saveSettings(draft).then(() => {
      setDraft({});
      setSaved(true);
      setSaving(false);
      setTimeout(() => setSaved(false), 2000);
    }).catch(() => setSaving(false));
  }, [draft, hasPendingChanges, updateSettings]);

  // Auto-save after 2s of no changes
  useEffect(() => {
    if (!hasPendingChanges) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      applyAll();
    }, 2000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [draft, hasPendingChanges, applyAll]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-outline-variant/8 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-on-surface uppercase tracking-wider">
          Settings
        </h2>
        {saved && (
          <span className="text-[10px] font-medium text-green-400 flex items-center gap-1">
            <span className="material-symbols-outlined text-xs">check_circle</span>
            Saved
          </span>
        )}
        {hasPendingChanges && !saved && (
          <button
            onClick={applyAll}
            disabled={saving}
            className="text-[10px] font-semibold text-primary bg-primary/10 px-3 py-1 rounded-lg hover:bg-primary/15 transition-all disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Apply'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Username */}
        <SettingField label="Username">
          <input
            type="text"
            value={display.username}
            onChange={(e) => updateDraft({ username: e.target.value })}
            className="setting-input"
          />
        </SettingField>

        {/* App Title */}
        <SettingField label="App Title">
          <input
            type="text"
            value={display.title}
            onChange={(e) => updateDraft({ title: e.target.value })}
            className="setting-input"
          />
        </SettingField>

        {/* Font size */}
        <SettingField label={`Font Size: ${display.fontSize}px`}>
          <input
            type="range"
            min={10}
            max={24}
            value={display.fontSize}
            onChange={(e) => updateDraft({ fontSize: Number(e.target.value) })}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[9px] text-on-surface-variant/30 mt-1">
            <span>10px</span><span>24px</span>
          </div>
        </SettingField>

        {/* Loop guard */}
        <SettingField label={`Loop Guard: ${display.loopGuard} hops`}>
          <input
            type="range"
            min={1}
            max={200}
            value={display.loopGuard}
            onChange={(e) => updateDraft({ loopGuard: Number(e.target.value) })}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[9px] text-on-surface-variant/30 mt-1">
            <span>1</span><span>200</span>
          </div>
          <p className="text-[10px] text-on-surface-variant/30 mt-1">
            Max agent-to-agent hops before pausing the conversation
          </p>
        </SettingField>

        {/* Divider */}
        <div className="h-px bg-outline-variant/8" />

        {/* Theme */}
        <SettingField label="Theme">
          <div className="flex items-center gap-2">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                onClick={() => applyInstant({ theme: t })}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                  display.theme === t
                    ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                    : 'bg-surface-container/40 text-on-surface-variant/40 hover:text-on-surface-variant/60'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </SettingField>

        {/* Notification sounds */}
        <div className="flex items-center justify-between py-1">
          <div>
            <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">
              Notification Sounds
            </div>
          </div>
          <button
            onClick={() => applyInstant({ notificationSounds: !settings.notificationSounds })}
            className={`w-10 h-5 rounded-full relative transition-all ${
              display.notificationSounds
                ? 'bg-green-500/80'
                : 'bg-outline-variant/30'
            }`}
          >
            <div
              className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all shadow-sm ${
                display.notificationSounds ? 'right-0.5' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {/* Divider */}
        <div className="h-px bg-outline-variant/8" />

        {/* Persistent Agents */}
        <PersistentAgentsSection />
      </div>
    </div>
  );
}

function PersistentAgentsSection() {
  const settings = useChatStore((s) => s.settings);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const setAgents = useChatStore((s) => s.setAgents);
  const [adding, setAdding] = useState(false);
  const [newBase, setNewBase] = useState('claude');
  const [newCwd, setNewCwd] = useState('');
  const [pickingFolder, setPickingFolder] = useState(false);

  const persistent: PersistentAgent[] = settings.persistentAgents || [];

  const addAgent = () => {
    const preset = AGENT_PRESETS.find(p => p.base === newBase);
    if (!preset) return;
    const agent: PersistentAgent = {
      base: preset.base,
      label: preset.label,
      command: preset.command,
      args: [...preset.defaultArgs],
      cwd: newCwd || '.',
      color: preset.color,
    };
    const updated = [...persistent, agent];
    updateSettings({ persistentAgents: updated });
    api.saveSettings({ persistentAgents: updated }).then(() => {
      api.getStatus().then(r => setAgents(r.agents)).catch(() => {});
    }).catch(() => {});
    setAdding(false);
    setNewCwd('');
  };

  const removeAgent = (index: number) => {
    const updated = persistent.filter((_, i) => i !== index);
    updateSettings({ persistentAgents: updated });
    api.saveSettings({ persistentAgents: updated }).then(() => {
      api.getStatus().then(r => setAgents(r.agents)).catch(() => {});
    }).catch(() => {});
  };

  const handlePickFolder = async () => {
    setPickingFolder(true);
    try {
      const r = await api.pickFolder();
      setNewCwd(r.path);
    } catch {}
    setPickingFolder(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">
          Persistent Agents
        </span>
        <button
          onClick={() => setAdding(!adding)}
          className="text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
        >
          {adding ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {/* Existing persistent agents */}
      <div className="space-y-2 mb-3">
        {persistent.length === 0 && !adding && (
          <div className="text-[11px] text-on-surface-variant/30 text-center py-3">
            No persistent agents. Add one to always see it in the agent bar.
          </div>
        )}
        {persistent.map((pa, i) => (
          <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-surface-container/30 border border-outline-variant/5">
            <AgentIcon base={pa.base} color={pa.color} size={28} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold" style={{ color: pa.color }}>{pa.label}</div>
              <div className="text-[9px] text-on-surface-variant/30 font-mono truncate">{pa.cwd}</div>
            </div>
            <button
              onClick={() => removeAgent(i)}
              className="p-1 rounded text-on-surface-variant/20 hover:text-red-400 hover:bg-red-400/10 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        ))}
      </div>

      {/* Add new agent form */}
      {adding && (
        <div className="p-3 rounded-xl bg-surface-container/30 border border-outline-variant/8 space-y-3">
          <div>
            <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1.5">Agent Type</label>
            <div className="flex gap-1.5">
              {AGENT_PRESETS.map(p => (
                <button
                  key={p.base}
                  onClick={() => setNewBase(p.base)}
                  className={`flex-1 py-2 rounded-lg text-[11px] font-medium transition-all ${
                    newBase === p.base
                      ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                      : 'bg-surface-container/40 text-on-surface-variant/40'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1.5">Workspace Path</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newCwd}
                onChange={e => setNewCwd(e.target.value)}
                placeholder="/path/to/project"
                className="setting-input flex-1 text-[12px] font-mono py-2"
              />
              <button
                onClick={handlePickFolder}
                disabled={pickingFolder}
                className="px-2.5 rounded-lg bg-surface-container/60 border border-outline-variant/8 text-on-surface-variant/40 hover:text-primary text-[12px] shrink-0 disabled:opacity-30"
              >
                {pickingFolder ? '...' : '📁'}
              </button>
            </div>
          </div>
          <button
            onClick={addAgent}
            className="w-full py-2 rounded-lg text-[11px] font-semibold bg-primary-container text-white hover:brightness-110 transition-all"
          >
            Add Persistent Agent
          </button>
        </div>
      )}
    </div>
  );
}

function SettingField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2 block">
        {label}
      </label>
      {children}
    </div>
  );
}
