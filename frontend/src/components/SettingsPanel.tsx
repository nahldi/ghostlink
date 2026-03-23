import { useState, useCallback, useRef, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import { AgentIcon } from './AgentIcon';
import { SoundManager, SOUND_OPTIONS } from '../lib/sounds';
import type { Settings, PersistentAgent, StatsSections } from '../types';

const AGENT_PRESETS: { base: string; label: string; command: string; color: string; defaultArgs: string[] }[] = [
  { base: 'claude', label: 'Claude', command: 'claude', color: '#e8734a', defaultArgs: ['--dangerously-skip-permissions'] },
  { base: 'codex', label: 'Codex', command: 'codex', color: '#10a37f', defaultArgs: ['--sandbox', 'danger-full-access', '-a', 'never'] },
  { base: 'gemini', label: 'Gemini', command: 'gemini', color: '#4285f4', defaultArgs: ['-y'] },
  { base: 'grok', label: 'Grok', command: 'grok', color: '#ff6b35', defaultArgs: [] },
  { base: 'copilot', label: 'Copilot', command: 'github-copilot', color: '#6cc644', defaultArgs: [] },
  { base: 'aider', label: 'Aider', command: 'aider', color: '#14b8a6', defaultArgs: ['--yes'] },
  { base: 'goose', label: 'Goose', command: 'goose', color: '#f59e0b', defaultArgs: [] },
  { base: 'opencode', label: 'OpenCode', command: 'opencode', color: '#22c55e', defaultArgs: [] },
  { base: 'ollama', label: 'Ollama', command: 'ollama', color: '#ffffff', defaultArgs: [] },
];

type SettingsTab = 'general' | 'appearance' | 'agents' | 'providers' | 'advanced';

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'tune' },
  { id: 'appearance', label: 'Look', icon: 'palette' },
  { id: 'agents', label: 'Agents', icon: 'smart_toy' },
  { id: 'providers', label: 'AI', icon: 'model_training' },
  { id: 'advanced', label: 'Advanced', icon: 'settings' },
];

/* ── Reusable Toggle ─────────────────────────────────────────────── */

function Toggle({
  checked,
  onChange,
  label,
  description,
  activeColor = 'bg-green-500/80',
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description?: string;
  activeColor?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex-1 mr-3">
        <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">
          {label}
        </div>
        {description && (
          <p className="text-[9px] text-on-surface-variant/30 mt-0.5">{description}</p>
        )}
      </div>
      <button
        onClick={onChange}
        className={`relative w-10 h-5 rounded-full transition-all shrink-0 ${
          checked ? activeColor : 'bg-outline-variant/45'
        }`}
      >
        <div
          className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all shadow-sm ${
            checked ? 'right-0.5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────────── */

export function SettingsPanel() {
  const settings = useChatStore((s) => s.settings);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const [draft, setDraft] = useState<Partial<Settings>>({} as Partial<Settings>);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('general');
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
      {/* Header */}
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

      {/* Tab Bar */}
      <div className="flex border-b border-outline-variant/8">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-all border-b-2 ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant/40 hover:text-on-surface-variant/60'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {tab === 'general' && (
          <GeneralTab display={display} updateDraft={updateDraft} applyInstant={applyInstant} settings={settings} />
        )}
        {tab === 'appearance' && (
          <AppearanceTab display={display} updateDraft={updateDraft} applyInstant={applyInstant} settings={settings} />
        )}
        {tab === 'agents' && (
          <AgentsTab display={display} updateDraft={updateDraft} applyInstant={applyInstant} settings={settings} />
        )}
        {tab === 'providers' && (
          <ProvidersTab />
        )}
        {tab === 'advanced' && (
          <AdvancedTab display={display} applyInstant={applyInstant} settings={settings} />
        )}
      </div>
    </div>
  );
}

/* ── Tab: General ────────────────────────────────────────────────── */

function GeneralTab({
  display,
  updateDraft,
  applyInstant,
  settings,
}: {
  display: Settings;
  updateDraft: (u: Partial<Settings>) => void;
  applyInstant: (u: Partial<Settings>) => void;
  settings: Settings;
}) {
  return (
    <>
      {/* Username */}
      <SettingField label="Username">
        <input
          type="text"
          value={display.username}
          onChange={(e) => updateDraft({ username: e.target.value })}
          className="setting-input"
        />
      </SettingField>

      {/* Timezone */}
      <SettingField label="Timezone">
        <select
          value={display.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
          onChange={(e) => applyInstant({ timezone: e.target.value })}
          className="setting-input text-[12px] w-full"
        >
          {Intl.supportedValuesOf?.('timeZone')?.map((tz: string) => (
            <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
          )) ?? (
            <>
              <option value="America/New_York">America/New York</option>
              <option value="America/Chicago">America/Chicago</option>
              <option value="America/Denver">America/Denver</option>
              <option value="America/Los_Angeles">America/Los Angeles</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Paris">Europe/Paris</option>
              <option value="Europe/Berlin">Europe/Berlin</option>
              <option value="Asia/Tokyo">Asia/Tokyo</option>
              <option value="Asia/Shanghai">Asia/Shanghai</option>
              <option value="Asia/Kolkata">Asia/Kolkata</option>
              <option value="Australia/Sydney">Australia/Sydney</option>
              <option value="Pacific/Auckland">Pacific/Auckland</option>
              <option value="UTC">UTC</option>
            </>
          )}
        </select>
        <p className="text-[9px] text-on-surface-variant/30 mt-1">Controls all timestamps and time displays</p>
      </SettingField>

      {/* Time Format */}
      <SettingField label="Time Format">
        <div className="flex gap-2">
          {(['12h', '24h'] as const).map(fmt => (
            <button
              key={fmt}
              onClick={() => applyInstant({ timeFormat: fmt })}
              className={`flex-1 py-2 rounded-lg text-[11px] font-medium transition-all ${
                (display.timeFormat || '12h') === fmt
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                  : 'bg-surface-container/40 text-on-surface-variant/40'
              }`}
            >
              {fmt === '12h' ? '12-hour (AM/PM)' : '24-hour'}
            </button>
          ))}
        </div>
      </SettingField>

      {/* Voice Language */}
      <SettingField label="Voice Input Language">
        <select
          value={display.voiceLanguage || navigator.language || 'en-US'}
          onChange={(e) => applyInstant({ voiceLanguage: e.target.value })}
          className="setting-input text-[12px] w-full"
        >
          <option value="">Auto-detect (browser default)</option>
          <option value="en-US">English (US)</option>
          <option value="en-GB">English (UK)</option>
          <option value="en-AU">English (Australia)</option>
          <option value="es-ES">Spanish (Spain)</option>
          <option value="es-MX">Spanish (Mexico)</option>
          <option value="fr-FR">French</option>
          <option value="de-DE">German</option>
          <option value="it-IT">Italian</option>
          <option value="pt-BR">Portuguese (Brazil)</option>
          <option value="pt-PT">Portuguese (Portugal)</option>
          <option value="ja-JP">Japanese</option>
          <option value="ko-KR">Korean</option>
          <option value="zh-CN">Chinese (Simplified)</option>
          <option value="zh-TW">Chinese (Traditional)</option>
          <option value="ar-SA">Arabic</option>
          <option value="hi-IN">Hindi</option>
          <option value="ru-RU">Russian</option>
          <option value="nl-NL">Dutch</option>
          <option value="sv-SE">Swedish</option>
          <option value="pl-PL">Polish</option>
          <option value="tr-TR">Turkish</option>
          <option value="th-TH">Thai</option>
          <option value="vi-VN">Vietnamese</option>
          <option value="id-ID">Indonesian</option>
          <option value="uk-UA">Ukrainian</option>
        </select>
        <p className="text-[9px] text-on-surface-variant/30 mt-1">Language used for push-to-talk voice recognition</p>
      </SettingField>

      <div className="h-px bg-outline-variant/8" />

      {/* Notification Sounds */}
      <Toggle
        label="Notification Sounds"
        checked={!!display.notificationSounds}
        onChange={() => applyInstant({ notificationSounds: !settings.notificationSounds })}
      />

      {/* Per-Agent Sound Selection */}
      {display.notificationSounds && <AgentSoundPicker settings={settings} applyInstant={applyInstant} />}

      {/* Desktop Notifications */}
      <Toggle
        label="Desktop Notifications"
        description="Show browser notifications for new messages"
        checked={!!display.desktopNotifications}
        onChange={() => {
          if (!settings.desktopNotifications && 'Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission().then(p => {
              if (p === 'granted') applyInstant({ desktopNotifications: true });
            });
          } else {
            applyInstant({ desktopNotifications: !settings.desktopNotifications });
          }
        }}
      />

      {/* Quiet Hours */}
      <SettingField label={`Quiet Hours: ${display.quietHoursStart}:00 \u2013 ${display.quietHoursEnd}:00`}>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-[9px] text-on-surface-variant/40 block mb-1">Start</label>
            <input
              type="range"
              min={0}
              max={23}
              value={display.quietHoursStart}
              onChange={(e) => updateDraft({ quietHoursStart: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>
          <div className="flex-1">
            <label className="text-[9px] text-on-surface-variant/40 block mb-1">End</label>
            <input
              type="range"
              min={0}
              max={23}
              value={display.quietHoursEnd}
              onChange={(e) => updateDraft({ quietHoursEnd: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>
        </div>
        <p className="text-[9px] text-on-surface-variant/30 mt-1">Mute sounds and desktop notifications during these hours</p>
      </SettingField>
    </>
  );
}

/* ── Tab: Appearance ─────────────────────────────────────────────── */

function AppearanceTab({
  display,
  updateDraft,
  applyInstant,
}: {
  display: Settings;
  updateDraft: (u: Partial<Settings>) => void;
  applyInstant: (u: Partial<Settings>) => void;
  settings: Settings;
}) {
  return (
    <>
      {/* Theme */}
      <SettingField label="Theme">
        <div className="grid grid-cols-3 gap-1.5">
          {([
            { id: 'dark', label: 'Dark', color: '#a78bfa' },
            { id: 'light', label: 'Light', color: '#6d28d9' },
            { id: 'cyberpunk', label: 'Cyberpunk', color: '#ff00ff' },
            { id: 'terminal', label: 'Terminal', color: '#00ff41' },
            { id: 'ocean', label: 'Ocean', color: '#22d3ee' },
            { id: 'sunset', label: 'Sunset', color: '#f97316' },
            { id: 'midnight', label: 'Midnight', color: '#818cf8' },
            { id: 'rosegold', label: 'Rose Gold', color: '#f43f5e' },
            { id: 'arctic', label: 'Arctic', color: '#60a5fa' },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => applyInstant({ theme: t.id as Settings['theme'] })}
              className={`py-2 px-1 rounded-lg text-[10px] font-medium transition-all ${
                display.theme === t.id
                  ? 'ring-1 ring-primary/30'
                  : 'bg-surface-container/40 text-on-surface-variant/40 hover:text-on-surface-variant/60'
              }`}
              style={display.theme === t.id ? { background: `${t.color}15`, color: t.color } : undefined}
            >
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: t.color }} />
              {t.label}
            </button>
          ))}
        </div>
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
        <div className="flex justify-between text-[9px] text-on-surface-variant/45 mt-1">
          <span>10px</span><span>24px</span>
        </div>
      </SettingField>

      <div className="h-px bg-outline-variant/8" />

      {/* Stats Panel Toggle */}
      <Toggle
        label="Stats Panel"
        description="Show the right-side info panel on wide screens"
        checked={display.showStatsPanel !== false}
        onChange={() => applyInstant({ showStatsPanel: !display.showStatsPanel })}
      />

      {/* Info Panel Sections */}
      {display.showStatsPanel !== false && (
        <InfoPanelSectionsToggle
          sections={display.statsSections || { session: true, tokens: true, agents: true, activity: true }}
          onChange={(sections: StatsSections) => applyInstant({ statsSections: sections })}
        />
      )}
    </>
  );
}

/* ── Tab: Agents ─────────────────────────────────────────────────── */

function AgentsTab({
  display,
  updateDraft,
  applyInstant,
}: {
  display: Settings;
  updateDraft: (u: Partial<Settings>) => void;
  applyInstant: (u: Partial<Settings>) => void;
  settings: Settings;
}) {
  return (
    <>
      {/* Auto-Route Toggle */}
      <Toggle
        label="Auto-Route Messages to Agents"
        description="When ON, agents receive ALL messages (not just @mentions). When OFF, agents only respond when @mentioned."
        checked={!!(display.autoRoute)}
        onChange={() => applyInstant({ autoRoute: !(display.autoRoute ?? false) })}
      />

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
        <div className="flex justify-between text-[9px] text-on-surface-variant/45 mt-1">
          <span>1</span><span>200</span>
        </div>
        <p className="text-[10px] text-on-surface-variant/45 mt-1">
          Max agent-to-agent hops before pausing the conversation
        </p>
      </SettingField>

      <div className="h-px bg-outline-variant/8" />

      {/* Persistent Agents */}
      <PersistentAgentsSection />

      <div className="h-px bg-outline-variant/8" />

      {/* Supported Agents */}
      <SupportedAgentsSection />
    </>
  );
}

/* ── Tab: Advanced ───────────────────────────────────────────────── */

function AdvancedTab({
  display,
  applyInstant,
  settings,
}: {
  display: Settings;
  applyInstant: (u: Partial<Settings>) => void;
  settings: Settings;
}) {
  return (
    <>
      {/* Debug Mode */}
      <Toggle
        label="Debug Mode"
        description="Show raw message data and WebSocket events"
        checked={!!display.debugMode}
        onChange={() => applyInstant({ debugMode: !settings.debugMode })}
        activeColor="bg-yellow-500/80"
      />

      <div className="h-px bg-outline-variant/8" />

      {/* Maintenance / Cleanup */}
      <CleanupSection />
    </>
  );
}

/* ── Tab: Providers ──────────────────────────────────────────────── */

function ProvidersTab() {
  const [status, setStatus] = useState<any>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    api.getProviders().then(setStatus).catch(() => {});
  }, []);

  const handleSaveKey = async (provider: string) => {
    if (!apiKey.trim()) return;
    try {
      await api.configureProvider(provider, apiKey.trim());
      setApiKey('');
      setConfiguring(null);
      setSaved(provider);
      setTimeout(() => setSaved(''), 2000);
      api.getProviders().then(setStatus).catch(() => {});
    } catch {}
  };

  if (!status) return <div className="text-xs text-on-surface-variant/40 text-center py-8">Loading providers...</div>;

  const capLabels: Record<string, string> = {
    chat: 'Chat/LLM', code: 'Code', image: 'Image Gen', video: 'Video Gen',
    tts: 'Text-to-Speech', stt: 'Speech-to-Text', code_exec: 'Code Execution', embedding: 'Embeddings',
  };

  return (
    <>
      {/* Capabilities overview */}
      <div>
        <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2">AI Capabilities</div>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(status.capabilities).map(([cap, info]: [string, any]) => (
            <div key={cap} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] ${
              info.available ? 'bg-green-500/8 text-green-400/80' : 'bg-surface-container/30 text-on-surface-variant/30'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${info.available ? 'bg-green-400' : 'bg-outline-variant/30'}`} />
              <span className="font-medium">{capLabels[cap] || cap}</span>
              {info.provider_name && <span className="ml-auto text-[8px] text-on-surface-variant/30">{info.provider_name}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="h-px bg-outline-variant/8" />

      {/* Provider list */}
      <div>
        <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2">Providers</div>
        <div className="space-y-2">
          {status.providers.map((p: any) => (
            <div key={p.id} className={`rounded-xl p-3 border transition-all ${
              p.configured ? 'bg-green-500/5 border-green-500/15' : p.free_tier ? 'bg-primary/5 border-primary/10' : 'bg-surface-container/20 border-outline-variant/8'
            }`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${p.configured ? 'bg-green-400' : p.local ? 'bg-blue-400' : 'bg-outline-variant/30'}`} />
                  <span className="text-[11px] font-semibold text-on-surface">{p.name}</span>
                  {p.free_tier && <span className="text-[8px] px-1.5 py-0.5 rounded bg-primary/15 text-primary/80 font-medium">FREE</span>}
                  {p.local && <span className="text-[8px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400/80 font-medium">LOCAL</span>}
                </div>
                {p.configured ? (
                  <span className="text-[9px] text-green-400/70 font-medium">{saved === p.id ? 'Saved!' : 'Connected'}</span>
                ) : (
                  <button
                    onClick={() => { setConfiguring(configuring === p.id ? null : p.id); setApiKey(''); }}
                    className="text-[9px] font-medium text-primary hover:text-primary/80"
                  >
                    {configuring === p.id ? 'Cancel' : 'Configure'}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1 mb-1">
                {p.capabilities.map((c: string) => (
                  <span key={c} className="text-[8px] px-1 py-0.5 rounded bg-surface-container/40 text-on-surface-variant/40">{capLabels[c] || c}</span>
                ))}
              </div>
              {configuring === p.id && (
                <div className="mt-2 space-y-2">
                  {p.setup_instructions && (
                    <div className="text-[9px] text-on-surface-variant/50 leading-relaxed whitespace-pre-line bg-surface-container/20 rounded-lg px-2.5 py-2">
                      {p.setup_instructions}
                    </div>
                  )}
                  {p.setup_url && (
                    <a
                      href={p.setup_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                      {p.local ? 'Download' : 'Get API Key'}
                    </a>
                  )}
                  {!p.local && (
                    <div className="flex gap-1.5">
                      <input
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSaveKey(p.id)}
                        type="password"
                        placeholder="Paste API key..."
                        className="flex-1 bg-surface-container/40 border border-outline-variant/10 rounded-md px-2 py-1.5 text-[10px] text-on-surface outline-none focus:border-primary/30 font-mono"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSaveKey(p.id)}
                        className="px-2.5 py-1.5 bg-primary-container text-white rounded-md text-[10px] font-medium hover:brightness-110"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {status.free_options.length > 0 && (
        <>
          <div className="h-px bg-outline-variant/8" />
          <div className="text-[10px] text-on-surface-variant/40 leading-relaxed">
            Free providers available: {status.free_options.map((p: any) => p.name).join(', ')}. Configure them above to unlock more AI capabilities at no cost.
          </div>
        </>
      )}
    </>
  );
}

/* ── CleanupSection (includes Stop Server) ───────────────────────── */

function CleanupSection() {
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [serverStopped, setServerStopped] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const handleCleanup = async () => {
    setCleaning(true);
    setResult(null);
    try {
      const r = await api.cleanup();
      setResult(r.count > 0 ? `Cleaned ${r.count} stale session${r.count > 1 ? 's' : ''}` : 'Nothing to clean');
    } catch {
      setResult('Cleanup failed');
    }
    setCleaning(false);
    setTimeout(() => setResult(null), 3000);
  };

  const handleStopServer = async () => {
    if (!confirmStop) {
      setConfirmStop(true);
      setTimeout(() => setConfirmStop(false), 5000);
      return;
    }
    setStopping(true);
    setConfirmStop(false);
    try {
      await api.stopServer();
      setServerStopped(true);
    } catch {
      // Server likely already killed itself before response arrived — that's expected
      setServerStopped(true);
    }
    setStopping(false);
  };

  return (
    <div>
      <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2">
        Maintenance
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleCleanup}
          disabled={cleaning}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container/40 border border-outline-variant/8 text-xs font-medium text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container/60 transition-all disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">{cleaning ? 'hourglass_empty' : 'cleaning_services'}</span>
          {cleaning ? 'Cleaning...' : 'Clean Stale Sessions'}
        </button>
        {result && (
          <span className="text-[11px] text-green-400/70">{result}</span>
        )}
      </div>
      <p className="text-[9px] text-on-surface-variant/30 mt-1.5">
        Kills orphaned tmux sessions and dead processes to free up resources
      </p>

      {/* Stop Server */}
      <div className="mt-3">
        {serverStopped ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-medium text-red-400">
            <span className="material-symbols-outlined text-[16px]">power_settings_new</span>
            Server stopped. Reload or restart to reconnect.
          </div>
        ) : (
          <button
            onClick={handleStopServer}
            disabled={stopping}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all disabled:opacity-50 ${
              confirmStop
                ? 'bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/25'
                : 'bg-surface-container/40 border-outline-variant/8 text-on-surface-variant/60 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {stopping ? 'hourglass_empty' : 'power_settings_new'}
            </span>
            {stopping ? 'Stopping...' : confirmStop ? 'Click again to confirm' : 'Stop Server'}
          </button>
        )}
        <p className="text-[9px] text-on-surface-variant/30 mt-1.5">
          Kills all agents and shuts down the backend server
        </p>
      </div>
    </div>
  );
}

/* ── PersistentAgentsSection ─────────────────────────────────────── */

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
      api.getStatus().then(r => setAgents(r.agents)).catch(() => {
        // Fallback: resync from server
        api.getStatus().then(r => setAgents(r.agents)).catch(() => {});
      });
    }).catch(() => {
      // Save failed — still refresh agent list to stay in sync
      api.getStatus().then(r => setAgents(r.agents)).catch(() => {});
    });
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
          <div className="text-[11px] text-on-surface-variant/45 text-center py-3">
            No persistent agents. Add one to always see it in the agent bar.
          </div>
        )}
        {persistent.map((pa, i) => (
          <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-surface-container/30 border border-outline-variant/5">
            <AgentIcon base={pa.base} color={pa.color} size={28} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold" style={{ color: pa.color }}>{pa.label}</div>
              <div className="text-[9px] text-on-surface-variant/45 font-mono truncate">{pa.cwd}</div>
            </div>
            <button
              onClick={() => removeAgent(i)}
              className="p-1 rounded text-on-surface-variant/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
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
                className="px-2.5 rounded-lg bg-surface-container/60 border border-outline-variant/8 text-on-surface-variant/40 hover:text-primary text-[12px] shrink-0 disabled:opacity-50"
              >
                {pickingFolder ? '...' : '\uD83D\uDCC1'}
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

/* ── SupportedAgentsSection ──────────────────────────────────────── */

function SupportedAgentsSection() {
  const [templates, setTemplates] = useState<import('../types').AgentTemplate[]>([]);
  const [open, setOpen] = useState(false);
  const agents = useChatStore((s) => s.agents);
  const storeSettings = useChatStore((s) => s.settings);

  useEffect(() => {
    if (open && templates.length === 0) {
      const bases = [...new Set([
        ...agents.map(a => a.base),
        ...(storeSettings.persistentAgents || []).map(a => a.base),
      ])];
      api.getAgentTemplates(bases).then(r => setTemplates(r.templates)).catch(() => {});
    }
  }, [open, templates.length, agents, storeSettings.persistentAgents]);

  const installed = templates.filter(t => t.available);
  const notInstalled = templates.filter(t => !t.available);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-1"
      >
        <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">
          Supported Agents
        </span>
        <span className="material-symbols-outlined text-on-surface-variant/45 text-[16px]">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {installed.length > 0 && (
            <div>
              <div className="text-[9px] text-green-400/50 font-semibold uppercase tracking-wider mb-1.5">Installed</div>
              <div className="space-y-1">
                {installed.map(t => (
                  <div key={t.base} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg bg-surface-container/20">
                    <AgentIcon base={t.base} color={t.color} size={22} />
                    <div className="flex-1">
                      <span className="text-[11px] font-semibold" style={{ color: t.color }}>{t.label}</span>
                      <span className="text-[9px] text-on-surface-variant/45 ml-1.5">{t.provider}</span>
                    </div>
                    <span className="text-[9px] text-green-400/60 font-medium">Ready</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {notInstalled.length > 0 && (
            <div>
              <div className="text-[9px] text-on-surface-variant/45 font-semibold uppercase tracking-wider mb-1.5">Not Installed</div>
              <div className="space-y-1">
                {notInstalled.map(t => (
                  <div key={t.base} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg opacity-55">
                    <AgentIcon base={t.base} color={t.color} size={22} />
                    <div className="flex-1">
                      <span className="text-[11px] font-medium text-on-surface-variant/50">{t.label}</span>
                      <span className="text-[9px] text-on-surface-variant/40 ml-1.5">{t.provider}</span>
                    </div>
                    <span className="text-[9px] text-on-surface-variant/40 font-mono">{t.command}</span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-on-surface-variant/40 mt-2">Install the CLI to use these agents</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── InfoPanelSectionsToggle ─────────────────────────────────────── */

function InfoPanelSectionsToggle({ sections, onChange }: { sections: StatsSections; onChange: (s: StatsSections) => void }) {
  const items: { key: keyof StatsSections; label: string }[] = [
    { key: 'session', label: 'Session Stats' },
    { key: 'tokens', label: 'Token Usage' },
    { key: 'agents', label: 'Agent Status' },
    { key: 'activity', label: 'Channel Activity' },
  ];
  return (
    <div className="pl-1">
      <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-2">
        Info Panel Sections
      </div>
      <div className="space-y-1.5">
        {items.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2.5 cursor-pointer group">
            <div
              onClick={() => onChange({ ...sections, [key]: !sections[key] })}
              className={`w-4 h-4 rounded flex items-center justify-center transition-all border ${
                sections[key]
                  ? 'bg-primary/20 border-primary/40 text-primary'
                  : 'bg-surface-container/40 border-outline-variant/15 text-transparent'
              }`}
            >
              <span className="material-symbols-outlined text-[12px]">check</span>
            </div>
            <span className="text-[11px] text-on-surface-variant/50 group-hover:text-on-surface-variant/70 transition-colors">{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ── AgentSoundPicker ─────────────────────────────────────────────── */

function AgentSoundPicker({ settings, applyInstant }: { settings: Settings; applyInstant: (u: Partial<Settings>) => void }) {
  const agents = useChatStore((s) => s.agents);
  const agentSounds = settings.agentSounds || {};

  // Get unique agent bases from connected agents + presets
  const bases = Array.from(new Set([
    ...agents.map(a => a.base),
    ...AGENT_PRESETS.map(p => p.base),
  ])).slice(0, 9);

  const handleChange = (base: string, soundId: string) => {
    const updated = { ...agentSounds, [base]: soundId };
    SoundManager.setCustomSounds(updated);
    applyInstant({ agentSounds: updated });
    if (soundId !== 'none') SoundManager.preview(soundId);
  };

  return (
    <div className="pl-1">
      <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-2">
        Agent Notification Sounds
      </div>
      <div className="space-y-1.5">
        {bases.map(base => {
          const preset = AGENT_PRESETS.find(p => p.base === base);
          const color = preset?.color || '#a78bfa';
          const currentSound = SoundManager.getSoundForAgent(base);
          return (
            <div key={base} className="flex items-center gap-2">
              <AgentIcon base={base} color={color} size={20} />
              <span className="text-[10px] font-medium w-14 truncate" style={{ color }}>{preset?.label || base}</span>
              <select
                value={agentSounds[base] || currentSound}
                onChange={(e) => handleChange(base, e.target.value)}
                className="flex-1 bg-surface-container/40 border border-outline-variant/10 rounded-md px-2 py-1 text-[10px] text-on-surface outline-none focus:border-primary/30"
              >
                {SOUND_OPTIONS.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <p className="text-[9px] text-on-surface-variant/30 mt-1.5">Choose a unique sound for each agent</p>
    </div>
  );
}

/* ── SettingField ─────────────────────────────────────────────────── */

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
