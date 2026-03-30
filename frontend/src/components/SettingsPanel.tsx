import { useState, useCallback, useRef, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import { AgentIcon } from './AgentIcon';
import { SoundManager, SOUND_OPTIONS } from '../lib/sounds';
import type { Plugin, SkillPack, Hook, Bridge, RetentionPolicy, AuditLogEntry } from '../types';
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

type SettingsTab = 'general' | 'appearance' | 'agents' | 'providers' | 'integrations' | 'security' | 'advanced';
type ProviderStatus = Awaited<ReturnType<typeof api.getProviders>>;
type ProviderCapability = ProviderStatus['capabilities'][string];

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'tune' },
  { id: 'agents', label: 'Agents', icon: 'smart_toy' },
  { id: 'providers', label: 'AI', icon: 'model_training' },
  { id: 'advanced', label: 'More', icon: 'settings' },
];

/* ── Collapsible Section ─────────────────────────────────────────── */

function Section({ title, icon, defaultOpen = false, children }: {
  title: string;
  icon?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="setting-section">
      <button className="setting-section-header w-full" onClick={() => setOpen(!open)}>
        {icon && <span className="material-symbols-outlined text-[16px] text-on-surface-variant/50">{icon}</span>}
        <span className="text-[11px] font-semibold text-on-surface/80 flex-1 text-left">{title}</span>
        <span className={`material-symbols-outlined text-[16px] text-on-surface-variant/30 transition-transform ${open ? 'rotate-180' : ''}`}>expand_more</span>
      </button>
      <div className={`setting-section-content ${open ? '' : 'collapsed'}`}>
        <div className="inner space-y-3">
          {children}
        </div>
      </div>
    </div>
  );
}

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
    api.saveSettings(updates).catch((e) => console.warn('Settings save:', e.message || e));
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
    }).catch((e) => { console.warn('Settings save:', e instanceof Error ? e.message : String(e)); setSaving(false); });
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

      {/* Tab Bar — Advanced tab hidden in beginner mode */}
      <div className="flex border-b border-outline-variant/8">
        {TABS.filter(t => settings.experienceMode === 'beginner' ? t.id !== 'advanced' : true).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-all border-b-2 ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant/40 hover:text-on-surface-variant/60'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {tab === 'general' && (<>
          <GeneralTab display={display} updateDraft={updateDraft} applyInstant={applyInstant} settings={settings} />
          <AppearanceTab display={display} updateDraft={updateDraft} applyInstant={applyInstant} settings={settings} />
        </>)}
        {tab === 'agents' && (
          <AgentsTab display={display} updateDraft={updateDraft} applyInstant={applyInstant} settings={settings} />
        )}
        {tab === 'providers' && (<>
          <ProvidersTab />
          <IntegrationsTab />
        </>)}
        {tab === 'advanced' && (<>
          <SecurityTab />
          <AdvancedTab display={display} applyInstant={applyInstant} settings={settings} />
        </>)}
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
  const MODE_OPTIONS = [
    { value: 'beginner', label: 'Beginner', desc: 'Simplified interface, guided experience' },
    { value: 'standard', label: 'Standard', desc: 'Balanced — all features, normal density' },
    { value: 'advanced', label: 'Advanced', desc: 'Full controls, debug tools, technical detail' },
  ] as const;

  return (
    <>
      <Section title="Experience Mode" icon="tune" defaultOpen>
        <div className="grid grid-cols-3 gap-2">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m.value}
              onClick={() => applyInstant({ experienceMode: m.value })}
              className={`p-2.5 rounded-xl text-left transition-all border ${
                (display.experienceMode || 'standard') === m.value
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-outline-variant/10 hover:border-outline-variant/20'
              }`}
            >
              <div className="text-[11px] font-semibold text-on-surface/80">{m.label}</div>
              <div className="text-[9px] text-on-surface-variant/40 mt-0.5">{m.desc}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Profile" icon="person" defaultOpen>
        <SettingField label="Username">
          <input type="text" value={display.username} onChange={(e) => updateDraft({ username: e.target.value })} className="setting-input" />
        </SettingField>
      </Section>

      <Section title="Date & Time" icon="schedule">
        <SettingField label="Timezone">
          <select value={display.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} onChange={(e) => applyInstant({ timezone: e.target.value })} className="setting-input text-[12px] w-full">
            {Intl.supportedValuesOf?.('timeZone')?.map((tz: string) => (
              <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
            )) ?? (
              <>
                <option value="America/New_York">America/New York</option>
                <option value="America/Chicago">America/Chicago</option>
                <option value="America/Denver">America/Denver</option>
                <option value="America/Los_Angeles">America/Los Angeles</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Berlin">Europe/Berlin</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
                <option value="UTC">UTC</option>
              </>
            )}
          </select>
        </SettingField>
        <SettingField label="Time Format">
          <div className="flex gap-2">
            {(['12h', '24h'] as const).map(fmt => (
              <button key={fmt} onClick={() => applyInstant({ timeFormat: fmt })}
                className={`flex-1 py-2 rounded-lg text-[11px] font-medium transition-all ${
                  (display.timeFormat || '12h') === fmt
                    ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                    : 'bg-surface-container/40 text-on-surface-variant/40'
                }`}>{fmt === '12h' ? '12-hour (AM/PM)' : '24-hour'}</button>
            ))}
          </div>
        </SettingField>
      </Section>

      <Section title="Voice" icon="mic">
        <SettingField label="Input Language">
          <select value={display.voiceLanguage || navigator.language || 'en-US'} onChange={(e) => applyInstant({ voiceLanguage: e.target.value })} className="setting-input text-[12px] w-full">
            <option value="">Auto-detect</option>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="es-ES">Spanish</option>
            <option value="fr-FR">French</option>
            <option value="de-DE">German</option>
            <option value="it-IT">Italian</option>
            <option value="pt-BR">Portuguese</option>
            <option value="ja-JP">Japanese</option>
            <option value="ko-KR">Korean</option>
            <option value="zh-CN">Chinese</option>
            <option value="ar-SA">Arabic</option>
            <option value="hi-IN">Hindi</option>
            <option value="ru-RU">Russian</option>
          </select>
        </SettingField>
      </Section>

      <Section title="Notifications" icon="notifications">
        <Toggle label="Notification Sounds" checked={!!display.notificationSounds} onChange={() => applyInstant({ notificationSounds: !settings.notificationSounds })} />
        {display.notificationSounds && <AgentSoundPicker settings={settings} applyInstant={applyInstant} />}
        <Toggle label="Desktop Notifications" description="Browser notifications for new messages"
          checked={!!display.desktopNotifications}
          onChange={() => {
            if (!settings.desktopNotifications && 'Notification' in window && Notification.permission !== 'granted') {
              Notification.requestPermission().then(p => { if (p === 'granted') applyInstant({ desktopNotifications: true }); });
            } else {
              applyInstant({ desktopNotifications: !settings.desktopNotifications });
            }
          }}
        />
        <SettingField label={`Quiet Hours: ${display.quietHoursStart}:00 \u2013 ${display.quietHoursEnd}:00`}>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[9px] text-on-surface-variant/40 block mb-1">Start</label>
              <input type="range" min={0} max={23} value={display.quietHoursStart} onChange={(e) => updateDraft({ quietHoursStart: Number(e.target.value) })} className="w-full accent-primary" />
            </div>
            <div className="flex-1">
              <label className="text-[9px] text-on-surface-variant/40 block mb-1">End</label>
              <input type="range" min={0} max={23} value={display.quietHoursEnd} onChange={(e) => updateDraft({ quietHoursEnd: Number(e.target.value) })} className="w-full accent-primary" />
            </div>
          </div>
        </SettingField>
      </Section>
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
      <Section title="Theme" icon="palette" defaultOpen>
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
            <button key={t.id} onClick={() => applyInstant({ theme: t.id as Settings['theme'] })}
              className={`py-2 px-1 rounded-lg text-[10px] font-medium transition-all ${
                display.theme === t.id ? 'ring-1 ring-primary/30' : 'bg-surface-container/40 text-on-surface-variant/40 hover:text-on-surface-variant/60'
              }`}
              style={display.theme === t.id ? { background: `${t.color}15`, color: t.color } : undefined}>
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: t.color }} />
              {t.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Typography" icon="text_fields">
        <SettingField label={`Font Size: ${display.fontSize}px`}>
          <input type="range" min={10} max={24} value={display.fontSize} onChange={(e) => updateDraft({ fontSize: Number(e.target.value) })} className="w-full accent-primary" />
          <div className="flex justify-between text-[9px] text-on-surface-variant/45 mt-1"><span>10px</span><span>24px</span></div>
        </SettingField>
      </Section>

      <Section title="Layout" icon="dashboard">
        <Toggle label="Agent Bar" description="Show agent status chips at the top"
          checked={display.showAgentBar !== false} onChange={() => applyInstant({ showAgentBar: !(display.showAgentBar !== false) })} />
        <Toggle label="Channel Tabs" description="Show channel tab bar below agent bar"
          checked={display.showChannelTabs !== false} onChange={() => applyInstant({ showChannelTabs: !(display.showChannelTabs !== false) })} />
        <Toggle label="Typing Indicator" description="Show when agents are typing"
          checked={display.showTypingIndicator !== false} onChange={() => applyInstant({ showTypingIndicator: !(display.showTypingIndicator !== false) })} />
        <Toggle label="Timestamps" description="Show time on each message"
          checked={display.showTimestamps !== false} onChange={() => applyInstant({ showTimestamps: !(display.showTimestamps !== false) })} />
        <Toggle label="Sender Labels" description="Show sender name on messages"
          checked={display.showSenderLabels !== false} onChange={() => applyInstant({ showSenderLabels: !(display.showSenderLabels !== false) })} />
      </Section>

      <Section title="Info Panel" icon="info">
        <Toggle label="Stats Panel" description="Right-side info panel on wide screens"
          checked={display.showStatsPanel !== false} onChange={() => applyInstant({ showStatsPanel: !display.showStatsPanel })} />
        {display.showStatsPanel !== false && (
          <InfoPanelSectionsToggle
            sections={display.statsSections || { session: true, tokens: true, agents: true, activity: true }}
            onChange={(sections: StatsSections) => applyInstant({ statsSections: sections })}
          />
        )}
      </Section>
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
      <Section title="Routing" icon="route" defaultOpen>
        <Toggle label="Auto-Route Messages" description="Agents receive ALL messages, not just @mentions"
          checked={!!(display.autoRoute)} onChange={() => applyInstant({ autoRoute: !(display.autoRoute ?? false) })} />
        <Toggle label="Auto-Start Agents" description="Persistent agents launch automatically when the server starts"
          checked={!!(display.autoStart)} onChange={() => applyInstant({ autoStart: !(display.autoStart ?? false) })} />
        <SettingField label={`Loop Guard: ${display.loopGuard} hops`}>
          <input type="range" min={1} max={200} value={display.loopGuard} onChange={(e) => updateDraft({ loopGuard: Number(e.target.value) })} className="w-full accent-primary" />
          <div className="flex justify-between text-[9px] text-on-surface-variant/45 mt-1"><span>1</span><span>200</span></div>
        </SettingField>
      </Section>

      <Section title="Persistent Agents" icon="smart_toy" defaultOpen>
        <PersistentAgentsSection />
      </Section>

      <Section title="Supported Agents" icon="devices">
        <SupportedAgentsSection />
      </Section>

      <Section title="Marketplace" icon="store">
        <MarketplaceSection />
      </Section>

      <Section title="Skill Packs" icon="extension">
        <SkillPacksSection />
      </Section>

      <Section title="Hooks" icon="webhook">
        <HooksSection />
      </Section>
    </>
  );
}

/* ── MarketplaceSection ────────────────────────────────────────────── */

function MarketplaceSection() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [search, setSearch] = useState('');
  const [installing, setInstalling] = useState('');
  const [uninstalling, setUninstalling] = useState('');

  useEffect(() => {
    api.browseMarketplace('', search).then(r => setPlugins(r.plugins || [])).catch((e) => console.warn('Marketplace browse:', e instanceof Error ? e.message : String(e)));
  }, [search]);

  const handleInstall = async (id: string) => {
    setInstalling(id);
    try {
      await api.installMarketplacePlugin(id);
      api.browseMarketplace('', search).then(r => setPlugins(r.plugins || [])).catch((e) => console.warn('Marketplace refresh:', e instanceof Error ? e.message : String(e)));
    } catch (e) { console.warn('Install plugin:', e instanceof Error ? e.message : String(e)); }
    setInstalling('');
  };

  const handleUninstall = async (id: string) => {
    setUninstalling(id);
    try {
      await api.uninstallMarketplacePlugin(id);
      api.browseMarketplace('', search).then(r => setPlugins(r.plugins || [])).catch((e) => console.warn('Marketplace refresh:', e instanceof Error ? e.message : String(e)));
    } catch (e) { console.warn('Uninstall plugin:', e instanceof Error ? e.message : String(e)); }
    setUninstalling('');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">GhostHub Marketplace</span>
      </div>
      <input
        value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search plugins..."
        className="w-full bg-surface-container-highest rounded-md px-2.5 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 focus:border-primary/40 outline-none mb-2"
      />
      <div className="space-y-1.5">
        {plugins.map(p => (
          <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-container/30 border border-outline-variant/5">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-on-surface">{p.name}</div>
              <div className="text-[9px] text-on-surface-variant/45">{p.description}</div>
              <div className="text-[8px] text-on-surface-variant/30 mt-0.5">{p.author} &middot; v{p.version} &middot; {p.category}</div>
            </div>
            {p.installed ? (
              <button onClick={() => handleUninstall(p.id)} disabled={uninstalling === p.id} className="px-2 py-1 rounded text-[9px] font-medium text-red-400/70 hover:bg-red-400/10 transition-colors disabled:opacity-40">{uninstalling === p.id ? 'Removing...' : 'Remove'}</button>
            ) : (
              <button onClick={() => handleInstall(p.id)} disabled={installing === p.id}
                className="px-2 py-1 rounded text-[9px] font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-40">
                {installing === p.id ? 'Installing...' : 'Install'}
              </button>
            )}
          </div>
        ))}
        {plugins.length === 0 && <div className="text-[10px] text-on-surface-variant/30 text-center py-3">No plugins found</div>}
      </div>
    </div>
  );
}

/* ── SkillPacksSection ─────────────────────────────────────────────── */

function SkillPacksSection() {
  const [packs, setPacks] = useState<SkillPack[]>([]);
  const [applying, setApplying] = useState('');
  const agents = useChatStore((s) => s.agents);

  useEffect(() => {
    api.getSkillPacks().then(r => setPacks(r.packs || [])).catch((e) => console.warn('Skill packs:', e instanceof Error ? e.message : String(e)));
  }, []);

  const handleApply = async (packId: string) => {
    const activeAgents = agents.filter(a => a.state !== 'offline');
    if (activeAgents.length === 0) return;
    setApplying(packId);
    try {
      // Apply to first active agent
      await api.applySkillPack(packId, activeAgents[0].name);
    } catch (e) { console.warn('Apply skill pack:', e instanceof Error ? e.message : String(e)); }
    setApplying('');
  };

  return (
    <div>
      <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2">Skill Packs</div>
      <div className="grid grid-cols-2 gap-1.5">
        {packs.map(p => (
          <button key={p.id} onClick={() => handleApply(p.id)} disabled={applying === p.id}
            className="text-left p-2.5 rounded-lg bg-surface-container/20 border border-outline-variant/8 hover:border-primary/20 transition-all disabled:opacity-40">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="material-symbols-outlined text-[14px]" style={{ color: p.color }}>{p.icon}</span>
              <span className="text-[10px] font-semibold text-on-surface">{p.name}</span>
            </div>
            <div className="text-[8px] text-on-surface-variant/40 leading-relaxed">{p.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── HooksSection ──────────────────────────────────────────────────── */

function HooksSection() {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [events, setEvents] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [event, setEvent] = useState('');
  const [action, setAction] = useState('message');

  const load = () => {
    api.getHooks().then(r => { setHooks(r.hooks || []); setEvents(r.events || {}); }).catch((e) => console.warn('Hooks fetch:', e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!name.trim() || !event || creating) return;
    setCreating(true);
    try {
      await api.createHook(name.trim(), event, action);
      setName(''); setEvent(''); setAdding(false);
      load();
    } catch (e) { console.warn('Create hook:', e instanceof Error ? e.message : String(e)); }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    try { await api.deleteHook(id); load(); } catch (e) { console.warn('Delete hook:', e instanceof Error ? e.message : String(e)); }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try { await api.updateHook(id, { enabled }); load(); } catch (e) { console.warn('Update hook:', e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">Automation Hooks</span>
        <button onClick={() => setAdding(!adding)} className="text-[10px] font-medium text-primary hover:text-primary/80">{adding ? 'Cancel' : '+ Add'}</button>
      </div>

      {adding && (
        <div className="p-3 rounded-xl bg-surface-container/30 border border-outline-variant/8 space-y-2 mb-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Hook name" className="w-full bg-surface-container-highest rounded-md px-2 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 outline-none" />
          <select value={event} onChange={e => setEvent(e.target.value)} className="w-full bg-surface-container-highest rounded-md px-2 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 outline-none">
            <option value="">Select event...</option>
            {Object.entries(events).map(([k, desc]) => <option key={k} value={k}>{k} — {desc}</option>)}
          </select>
          <select value={action} onChange={e => setAction(e.target.value)} className="w-full bg-surface-container-highest rounded-md px-2 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 outline-none">
            <option value="message">Send message</option>
            <option value="notify">Log notification</option>
            <option value="trigger">Trigger agent</option>
          </select>
          <button onClick={handleCreate} disabled={!name.trim() || !event || creating} className="w-full py-1.5 rounded-lg bg-primary/15 text-primary text-[11px] font-semibold hover:bg-primary/25 transition-colors disabled:opacity-40">{creating ? 'Creating...' : 'Create Hook'}</button>
        </div>
      )}

      <div className="space-y-1.5">
        {hooks.map(h => (
          <div key={h.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-container/30 border border-outline-variant/5">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-on-surface">{h.name}</div>
              <div className="text-[8px] text-on-surface-variant/40">{h.event} &rarr; {h.action} &middot; {h.trigger_count || 0} triggers</div>
            </div>
            <button onClick={() => handleToggle(h.id, !h.enabled)}
              className={`w-8 h-4 rounded-full transition-all relative ${h.enabled ? 'bg-green-500/80' : 'bg-surface-container-highest'}`}>
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${h.enabled ? 'left-4' : 'left-0.5'}`} />
            </button>
            <button onClick={() => handleDelete(h.id)} className="p-1 rounded text-on-surface-variant/40 hover:text-red-400 hover:bg-red-400/10 transition-colors">
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        ))}
        {hooks.length === 0 && !adding && <div className="text-[10px] text-on-surface-variant/30 text-center py-3">No hooks configured. Hooks run automatically when events fire.</div>}
      </div>
    </div>
  );
}

/* ── Tab: Integrations (Channel Bridges) ────────────────────────── */

const BRIDGE_INFO: Record<string, { name: string; icon: string; color: string; description: string; tokenLabel: string; placeholder: string }> = {
  discord: { name: 'Discord', icon: '🎮', color: '#5865F2', description: 'Bidirectional sync with Discord channels. Messages from Discord appear in GhostLink and vice versa.', tokenLabel: 'Bot Token', placeholder: 'Enter Discord bot token...' },
  telegram: { name: 'Telegram', icon: '✈️', color: '#0088cc', description: 'Connect a Telegram bot. Messages from Telegram chats appear in GhostLink.', tokenLabel: 'Bot Token', placeholder: 'Enter Telegram bot token from @BotFather...' },
  slack: { name: 'Slack', icon: '💬', color: '#4A154B', description: 'Send GhostLink messages to Slack via incoming webhook.', tokenLabel: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...' },
  whatsapp: { name: 'WhatsApp', icon: '📱', color: '#25D366', description: 'Connect via WhatsApp Cloud API (Meta Business).', tokenLabel: 'Access Token', placeholder: 'Enter WhatsApp Cloud API token...' },
  webhook: { name: 'Webhook', icon: '🔗', color: '#6366f1', description: 'Generic webhook bridge — works with any platform. Sends JSON payloads with HMAC signing.', tokenLabel: 'Outbound URL', placeholder: 'https://your-service.com/webhook' },
};

function IntegrationsTab() {
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [channelMap, setChannelMap] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});

  const loadBridges = () => {
    api.getBridges().then(r => setBridges(r.bridges || [])).catch((e) => console.warn('Bridges fetch:', e.message || e));
  };

  useEffect(() => { loadBridges(); }, []);

  const handleSave = async (platform: string) => {
    const tokenKey = platform === 'slack' || platform === 'webhook' ? 'url' : 'token';
    await api.configureBridge(platform, {
      [tokenKey]: tokenInput,
      enabled: true,
      channel_map: channelMap,
    });
    setStatus(s => ({ ...s, [platform]: 'saved' }));
    setTokenInput('');
    setConfiguring(null);
    setTimeout(() => setStatus(s => ({ ...s, [platform]: '' })), 2000);
    loadBridges();
  };

  const handleToggle = async (platform: string, enabled: boolean) => {
    await api.configureBridge(platform, { enabled });
    if (enabled) {
      try { await api.startBridge(platform); } catch (e) { console.warn('Start bridge:', e instanceof Error ? e.message : String(e)); }
    } else {
      try { await api.stopBridge(platform); } catch (e) { console.warn('Stop bridge:', e instanceof Error ? e.message : String(e)); }
    }
    loadBridges();
  };

  return (
    <>
      <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2">Channel Bridges</div>
      <div className="text-[10px] text-on-surface-variant/40 mb-4">
        Connect GhostLink to external platforms. Messages sync bidirectionally — your agents respond everywhere.
      </div>
      <div className="space-y-2">
        {Object.entries(BRIDGE_INFO).map(([platform, info]) => {
          const bridge = bridges.find(b => b.platform === platform);
          const isConfigured = bridge?.has_token || bridge?.configured;
          const isConnected = bridge?.connected;

          return (
            <div key={platform} className={`rounded-xl p-3 border transition-all ${
              isConnected ? 'bg-green-500/5 border-green-500/15' :
              isConfigured ? 'bg-primary/5 border-primary/10' :
              'bg-surface-container/20 border-outline-variant/8'
            }`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{info.icon}</span>
                  <span className="text-[11px] font-semibold text-on-surface">{info.name}</span>
                  {isConnected && <span className="text-[8px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-medium">CONNECTED</span>}
                  {status[platform] === 'saved' && <span className="text-[8px] text-green-400">Saved!</span>}
                </div>
                <div className="flex items-center gap-2">
                  {isConfigured && (
                    <button
                      onClick={() => handleToggle(platform, !bridge?.enabled)}
                      className={`w-8 h-4 rounded-full transition-all relative ${bridge?.enabled ? 'bg-green-500/80' : 'bg-surface-container-highest'}`}
                    >
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${bridge?.enabled ? 'left-4' : 'left-0.5'}`} />
                    </button>
                  )}
                  <button
                    onClick={() => { setConfiguring(configuring === platform ? null : platform); setTokenInput(''); setChannelMap(bridge?.channel_map || {}); }}
                    className="text-[9px] font-medium text-primary hover:text-primary/80"
                  >
                    {configuring === platform ? 'Cancel' : 'Configure'}
                  </button>
                </div>
              </div>
              <div className="text-[9px] text-on-surface-variant/40 mb-1">{info.description}</div>

              {configuring === platform && (
                <div className="mt-2 space-y-2 pt-2 border-t border-outline-variant/8">
                  <div>
                    <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1">{info.tokenLabel}</label>
                    <input
                      value={tokenInput}
                      onChange={e => setTokenInput(e.target.value)}
                      type="password"
                      placeholder={info.placeholder}
                      className="w-full bg-surface-container/40 border border-outline-variant/10 rounded-md px-2 py-1.5 text-[10px] text-on-surface outline-none focus:border-primary/30 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1">Channel Mapping</label>
                    <div className="text-[9px] text-on-surface-variant/30 mb-1">Map GhostLink channels to {info.name} channel IDs</div>
                    <div className="space-y-1">
                      {['general'].map(ch => (
                        <div key={ch} className="flex items-center gap-2">
                          <span className="text-[10px] text-on-surface-variant/50 w-16">#{ch}</span>
                          <span className="text-on-surface-variant/30">→</span>
                          <input
                            value={channelMap[ch] || ''}
                            onChange={e => setChannelMap(m => ({ ...m, [ch]: e.target.value }))}
                            placeholder={`${info.name} channel ID`}
                            className="flex-1 bg-surface-container/40 border border-outline-variant/10 rounded-md px-2 py-1 text-[10px] text-on-surface outline-none focus:border-primary/30 font-mono"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => handleSave(platform)}
                    disabled={!tokenInput.trim()}
                    className="w-full py-1.5 rounded-lg bg-primary/15 text-primary text-[11px] font-semibold hover:bg-primary/25 transition-colors disabled:opacity-40"
                  >
                    Save & Enable
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="h-px bg-outline-variant/8" />

      <div className="text-[10px] text-on-surface-variant/30 leading-relaxed">
        <strong>Inbound webhook:</strong> External platforms can POST to <code className="font-mono bg-surface-container/30 px-1 rounded">/api/bridges/inbound</code> to send messages into GhostLink.
      </div>
    </>
  );
}

/* ── Tab: Security ──────────────────────────────────────────────── */

function SecurityTab() {
  return (
    <>
      <Section title="Secrets" icon="key" defaultOpen>
        <SecretsSection />
      </Section>
      <Section title="Permission Presets" icon="shield">
        <PermissionPresetsSection />
      </Section>
      <Section title="Tool Usage Log" icon="build">
        <ToolLogSection />
      </Section>
      <Section title="Data Retention" icon="schedule">
        <RetentionSection />
      </Section>
      <Section title="Data Management" icon="database">
        <DataManagementSection />
      </Section>
      <Section title="Audit Log" icon="history">
        <AuditLogSection />
      </Section>
    </>
  );
}

function PermissionPresetsSection() {
  const [presets, setPresets] = useState<{ id: string; name: string; description: string }[]>([]);
  useEffect(() => {
    fetch('/api/security/permission-presets').then(r => r.json()).then(d => setPresets(d.presets || [])).catch(() => {});
  }, []);
  return (
    <div>
      <div className="text-[10px] text-on-surface-variant/50 mb-2">Available presets for agent permissions. Assign via agent config.</div>
      <div className="space-y-1.5">
        {presets.map(p => (
          <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-container/30">
            <span className="material-symbols-outlined text-[14px] text-primary/60">verified_user</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-on-surface">{p.name}</div>
              <div className="text-[9px] text-on-surface-variant/40">{p.description}</div>
            </div>
          </div>
        ))}
        {presets.length === 0 && <div className="text-[10px] text-on-surface-variant/40 text-center py-2">Loading presets...</div>}
      </div>
    </div>
  );
}

function ToolLogSection() {
  const [entries, setEntries] = useState<{ tool: string; actor: string; timestamp: string; details: Record<string, unknown> }[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    fetch('/api/security/tool-log?limit=50').then(r => r.json()).then(d => setEntries(d.entries || [])).catch(() => {});
  }, [open]);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">MCP Tool Calls</span>
        <button onClick={() => setOpen(!open)} className="text-[10px] font-medium text-primary hover:text-primary/80">{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/8 max-h-[200px] overflow-auto">
          {entries.length === 0 ? (
            <div className="text-[10px] text-on-surface-variant/30 text-center py-4">No tool calls recorded</div>
          ) : (
            <div className="divide-y divide-outline-variant/5">
              {entries.map((e, i) => (
                <div key={i} className="px-3 py-1.5 flex items-center gap-2">
                  <span className="text-[9px] text-on-surface-variant/30 w-16 shrink-0 font-mono">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  <span className="text-[10px] font-medium text-primary/70 w-20 shrink-0 truncate">{e.actor}</span>
                  <span className="text-[10px] text-on-surface/70 font-mono">{e.tool || (e.details as Record<string, string>)?.tool || '?'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SecretsSection() {
  const [secrets, setSecrets] = useState<{ key: string; preview: string; length: number }[]>([]);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secretError, setSecretError] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const load = () => { api.getSecrets().then(r => setSecrets(r.secrets || [])).catch((e) => console.warn('Secrets fetch:', e instanceof Error ? e.message : String(e))); };
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim() || saving) return;
    setSaving(true);
    setSecretError('');
    try {
      await api.setSecret(newKey.trim(), newValue.trim());
      setNewKey(''); setNewValue(''); setAdding(false);
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSecretError(msg);
      console.warn('Set secret:', msg);
    }
    setSaving(false);
  };

  const handleDelete = async (key: string) => {
    try { await api.deleteSecret(key); load(); } catch (e) { console.warn('Delete secret:', e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">Secrets Vault</span>
        <button onClick={() => setAdding(!adding)} className="text-[10px] font-medium text-primary hover:text-primary/80">{adding ? 'Cancel' : '+ Add'}</button>
      </div>
      <div className="text-[9px] text-on-surface-variant/35 mb-2">Encrypted storage for API keys and tokens. Values are never logged or exposed.</div>
      {adding && (
        <div className="p-3 rounded-xl bg-surface-container/30 border border-outline-variant/8 space-y-2 mb-2">
          <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Key name (e.g. ANTHROPIC_API_KEY)" className="w-full bg-surface-container-highest rounded-md px-2 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 outline-none" />
          <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Secret value" type="password" className="w-full bg-surface-container-highest rounded-md px-2 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 outline-none font-mono" />
          {secretError && <div className="text-red-400 text-[9px]">{secretError}</div>}
          <button onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim() || saving} className="w-full py-1.5 rounded-lg bg-primary/15 text-primary text-[11px] font-semibold hover:bg-primary/25 transition-colors disabled:opacity-40">{saving ? 'Saving...' : 'Save Secret'}</button>
        </div>
      )}
      <div className="space-y-1">
        {secrets.map(s => (
          <div key={s.key} className="flex items-center gap-2 p-2 rounded-lg bg-surface-container/30 border border-outline-variant/5">
            <span className="material-symbols-outlined text-[14px] text-primary/50">key</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-on-surface font-mono">{s.key}</div>
              <div className="text-[9px] text-on-surface-variant/40">{s.preview} ({s.length} chars)</div>
            </div>
            <button onClick={() => handleDelete(s.key)} className="p-1 rounded text-on-surface-variant/40 hover:text-red-400 hover:bg-red-400/10 transition-colors">
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        ))}
        {secrets.length === 0 && !adding && <div className="text-[10px] text-on-surface-variant/30 text-center py-3">No secrets stored</div>}
      </div>
    </div>
  );
}

function RetentionSection() {
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);

  useEffect(() => { api.getRetention().then(r => setPolicy(r.policy)).catch((e) => console.warn('Retention fetch:', e instanceof Error ? e.message : String(e))); }, []);

  const handleSave = async (updates: Partial<RetentionPolicy>) => {
    if (!policy) return;
    const updated: RetentionPolicy = { ...policy, ...updates };
    setPolicy(updated);
    try { await api.setRetention(updated); } catch (e) { console.warn('Retention save:', e instanceof Error ? e.message : String(e)); }
  };

  if (!policy) return null;

  return (
    <div>
      <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2">Data Retention</div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] text-on-surface">Auto-delete old messages</div>
            <div className="text-[9px] text-on-surface-variant/40">Automatically delete messages older than the retention period</div>
          </div>
          <button onClick={() => handleSave({ enabled: !policy.enabled })}
            className={`w-8 h-4 rounded-full transition-all relative ${policy.enabled ? 'bg-green-500/80' : 'bg-surface-container-highest'}`}>
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${policy.enabled ? 'left-4' : 'left-0.5'}`} />
          </button>
        </div>
        {policy.enabled && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-on-surface-variant/50">Keep messages for</span>
            <input type="number" value={policy.max_age_days} onChange={e => handleSave({ max_age_days: parseInt(e.target.value, 10) || 90 })} min={1} max={365}
              className="w-16 bg-surface-container-highest rounded-md px-2 py-1 text-[11px] text-on-surface border border-outline-variant/10 outline-none text-center" />
            <span className="text-[10px] text-on-surface-variant/50">days</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DataManagementSection() {
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'ghostlink-export.zip';
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { console.warn('Export:', e instanceof Error ? e.message : String(e)); }
    setExporting(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      await api.deleteAllData();
      window.location.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      console.warn('Delete all:', msg);
    }
    setDeleting(false);
  };

  return (
    <div>
      <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2">Data Management</div>
      <div className="space-y-2">
        <button onClick={handleExport} disabled={exporting}
          className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-surface-container/20 border border-outline-variant/8 hover:border-primary/20 transition-all disabled:opacity-40 text-left">
          <span className="material-symbols-outlined text-[16px] text-primary">download</span>
          <div>
            <div className="text-[11px] font-semibold text-on-surface">{exporting ? 'Exporting...' : 'Export All Data'}</div>
            <div className="text-[8px] text-on-surface-variant/40">Download messages, settings, memories as ZIP</div>
          </div>
        </button>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)}
            className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-red-500/5 border border-red-500/10 hover:border-red-500/20 transition-all text-left">
            <span className="material-symbols-outlined text-[16px] text-red-400">delete_forever</span>
            <div>
              <div className="text-[11px] font-semibold text-red-400">Delete All Data</div>
              <div className="text-[8px] text-on-surface-variant/40">Permanently erase all messages, settings, and agent data</div>
            </div>
          </button>
        ) : (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 space-y-2">
            <div className="text-[11px] font-semibold text-red-400">Are you absolutely sure?</div>
            <div className="text-[9px] text-on-surface-variant/50">This will permanently delete all messages, settings, agent memories, and uploaded files. This cannot be undone.</div>
            <div className="flex gap-2">
              <button onClick={handleDelete} disabled={deleting} className="flex-1 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-[11px] font-semibold hover:bg-red-500/30 disabled:opacity-40">{deleting ? 'Deleting...' : 'Yes, Delete Everything'}</button>
              <button onClick={() => setConfirmDelete(false)} className="flex-1 py-1.5 rounded-lg bg-surface-container text-on-surface-variant/60 text-[11px] font-semibold hover:bg-surface-container-high">Cancel</button>
            </div>
            {error && <div className="text-red-400 text-[9px] mt-2">Error: {error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function AuditLogSection() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.getAuditLog(50).then(r => setEntries(r.entries || [])).catch((e) => console.warn('Audit log:', e instanceof Error ? e.message : String(e)));
  }, [open]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">Audit Log</span>
        <button onClick={() => setOpen(!open)} className="text-[10px] font-medium text-primary hover:text-primary/80">{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/8 max-h-[200px] overflow-auto">
          {entries.length === 0 ? (
            <div className="text-[10px] text-on-surface-variant/30 text-center py-4">No audit events</div>
          ) : entries.map((e, i) => (
            <div key={i} className={`px-3 py-1.5 text-[10px] ${i % 2 === 0 ? '' : 'bg-surface-container/10'}`}>
              <span className="text-on-surface-variant/25">{new Date(e.timestamp * 1000).toLocaleString()}</span>{' '}
              <span className="font-semibold text-primary/70">{e.type}</span>{' '}
              <span className="text-on-surface-variant/50">by {e.actor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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
      <Section title="Debug" icon="bug_report" defaultOpen>
        <Toggle label="Debug Mode" description="Show raw message data and WebSocket events"
          checked={!!display.debugMode} onChange={() => applyInstant({ debugMode: !settings.debugMode })} activeColor="bg-yellow-500/80" />
      </Section>

      <Section title="Server Config" icon="dns">
        <ServerConfigSection />
      </Section>

      <Section title="Server Logs" icon="terminal">
        <ServerLogsSection />
      </Section>

      <Section title="Maintenance" icon="build">
        <CleanupSection />
      </Section>
    </>
  );
}

/* ── ServerConfigSection ───────────────────────────────────────────── */

function ServerConfigSection() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- server config shape varies
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    fetch('/api/server-config').then(r => r.json()).then(setConfig).catch((e) => console.warn('Server config fetch:', e.message || e));
  }, []);

  if (!config) return null;

  const rows = [
    ['Server Port', config.server?.port],
    ['Host', config.server?.host],
    ['Data Directory', config.server?.data_dir],
    ['Upload Directory', config.server?.upload_dir],
    ['Max Upload Size', `${config.server?.max_upload_mb} MB`],
    ['MCP HTTP Port', config.mcp?.http_port],
    ['MCP SSE Port', config.mcp?.sse_port],
    ['Routing Mode', config.routing?.default],
    ['Max Agent Hops', config.routing?.max_hops],
    ['Agents Online', config.agents_online],
    ['Uptime', `${Math.floor(config.uptime / 60)}m ${Math.floor(config.uptime % 60)}s`],
  ];

  return (
    <div>
      <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2">Server Configuration</div>
      <div className="rounded-xl bg-surface-container/20 border border-outline-variant/8 overflow-hidden">
        {rows.map(([label, value], i) => (
          <div key={i} className={`flex justify-between px-3 py-1.5 text-[10px] ${i % 2 === 0 ? '' : 'bg-surface-container/10'}`}>
            <span className="text-on-surface-variant/50">{label}</span>
            <span className="text-on-surface font-mono">{value}</span>
          </div>
        ))}
      </div>
      <div className="text-[9px] text-on-surface-variant/30 mt-1.5">
        Edit backend/config.toml to change server ports and paths. Restart required.
      </div>
    </div>
  );
}

/* ── ServerLogsSection ─────────────────────────────────────────────── */

function ServerLogsSection() {
  const [logs, setLogs] = useState<{ timestamp: number; level: string; module: string; message: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const r = await fetch(`/api/logs?limit=100${filter ? `&level=${filter}` : ''}`);
          const d = await r.json();
          if (!cancelled) setLogs(d.logs || []);
        } catch (e) { console.warn('Logs poll:', e instanceof Error ? e.message : String(e)); }
        await new Promise(r => setTimeout(r, 3000));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [open, filter]);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [logs]);

  const levelColor = (l: string) => {
    switch (l) {
      case 'ERROR': return 'text-red-400';
      case 'WARNING': return 'text-yellow-400';
      case 'INFO': return 'text-blue-400';
      default: return 'text-on-surface-variant/40';
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">Server Logs</span>
        <button onClick={() => setOpen(!open)} className="text-[10px] font-medium text-primary hover:text-primary/80">
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/8 overflow-hidden">
          <div className="flex gap-1 px-2 py-1.5 border-b border-outline-variant/5">
            {['', 'ERROR', 'WARNING', 'INFO', 'DEBUG'].map(l => (
              <button key={l} onClick={() => setFilter(l)}
                className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${filter === l ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/40 hover:text-on-surface-variant/60'}`}>
                {l || 'All'}
              </button>
            ))}
          </div>
          <pre ref={preRef} className="max-h-[200px] overflow-auto p-2 text-[10px] font-mono leading-relaxed">
            {logs.length === 0 ? (
              <span className="text-on-surface-variant/30">No logs yet</span>
            ) : logs.map((l, i) => (
              <div key={i}>
                <span className="text-on-surface-variant/25">{new Date(l.timestamp * 1000).toLocaleTimeString()}</span>{' '}
                <span className={`font-bold ${levelColor(l.level)}`}>{l.level.padEnd(7)}</span>{' '}
                <span className="text-on-surface-variant/60">{l.message}</span>
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Tab: Providers ──────────────────────────────────────────────── */

function ProvidersTab() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState('');
  const [testing, setTesting] = useState('');
  const [testResult, setTestResult] = useState<{ provider: string; ok: boolean; message: string } | null>(null);

  useEffect(() => {
    api.getProviders().then(setStatus).catch((e) => console.warn('Providers fetch:', e.message || e));
  }, []);

  const handleSaveKey = async (provider: string) => {
    if (!apiKey.trim()) return;
    try {
      await api.configureProvider(provider, apiKey.trim());
      // Test the key
      setTesting(provider);
      try {
        const testR = await fetch(`/api/providers/${provider}/test`, { method: 'POST' });
        const testD = await testR.json();
        setTestResult({ provider, ok: testR.ok, message: testD.message || testD.error || 'Unknown' });
      } catch {
        setTestResult({ provider, ok: true, message: 'Key saved (test unavailable)' });
      }
      setTesting('');
      setApiKey('');
      setConfiguring(null);
      setSaved(provider);
      setTimeout(() => { setSaved(''); setTestResult(null); }, 3000);
      api.getProviders().then(setStatus).catch((e) => console.warn('Providers fetch:', e.message || e));
    } catch (e) { console.warn('Save provider key:', e instanceof Error ? e.message : String(e)); }
  };

  if (!status) return <div className="text-xs text-on-surface-variant/40 text-center py-8">Loading providers...</div>;

  const capLabels: Record<string, string> = {
    chat: 'Chat/LLM', code: 'Code', image: 'Image Gen', video: 'Video Gen',
    tts: 'Text-to-Speech', stt: 'Speech-to-Text', code_exec: 'Code Execution', embedding: 'Embeddings',
  };

  return (
    <>
      <Section title="Capabilities" icon="auto_awesome" defaultOpen>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(status.capabilities).map(([cap, info]) => {
            const capability = info as ProviderCapability;
            return (
            <div key={cap} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] ${
              capability.available ? 'bg-green-500/8 text-green-400/80' : 'bg-surface-container/30 text-on-surface-variant/30'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${capability.available ? 'bg-green-400' : 'bg-outline-variant/30'}`} />
              <span className="font-medium">{capLabels[cap] || cap}</span>
              {capability.provider_name && <span className="ml-auto text-[8px] text-on-surface-variant/30">{capability.provider_name}</span>}
            </div>
            );
          })}
        </div>
      </Section>

      <Section title="Providers" icon="cloud" defaultOpen>
        <div className="space-y-2">
          {status.providers.map((p) => (
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
                  <span className="text-[9px] text-green-400/70 font-medium">
                    {testing === p.id ? 'Testing...' : saved === p.id ? (testResult?.ok ? 'Verified!' : 'Saved') : 'Connected'}
                  </span>
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
                {(p.capabilities || []).map((c: string) => (
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
      {status.free_options.length > 0 && (
        <div className="text-[10px] text-on-surface-variant/40 leading-relaxed mt-2">
          Free: {status.free_options.map((p) => p.name).join(', ')}
        </div>
      )}
      </Section>
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

      {/* Re-run Wizard */}
      <div className="mt-3">
        <button
          onClick={() => {
            localStorage.removeItem('ghostlink_setup_complete');
            useChatStore.getState().updateSettings({ setupComplete: false });
            api.saveSettings({ setupComplete: false }).catch(() => {});
            window.location.reload();
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container/40 border border-outline-variant/8 text-xs font-medium text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container/60 transition-all"
        >
          <span className="material-symbols-outlined text-[16px]">restart_alt</span>
          Re-run Setup Wizard
        </button>
        <p className="text-[9px] text-on-surface-variant/30 mt-1.5">
          Re-opens the first-run wizard to update platform, shell, and workspace settings
        </p>
      </div>

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

/* ── PersistentAgentCard — expandable agent editor ──────────────── */

function PersistentAgentCard({ agent, onUpdate, onRemove }: {
  agent: PersistentAgent;
  onUpdate: (updated: PersistentAgent) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editArgs, setEditArgs] = useState(agent.args?.join(' ') || '');
  const [editColor, setEditColor] = useState(agent.color || '#a78bfa');
  const [editCwd, setEditCwd] = useState(agent.cwd || '.');
  const [editLabel, setEditLabel] = useState(agent.label || '');
  const [editNickname, setEditNickname] = useState(agent.nickname || '');
  const [editPrompt, setEditPrompt] = useState(agent.defaultPrompt || '');

  const handleSave = () => {
    onUpdate({
      ...agent,
      label: editLabel || agent.label,
      args: editArgs.split(/\s+/).filter(Boolean),
      color: editColor,
      cwd: editCwd,
      nickname: editNickname || undefined,
      defaultPrompt: editPrompt || undefined,
    });
    setExpanded(false);
  };

  return (
    <div className="rounded-lg bg-surface-container/30 border border-outline-variant/5 overflow-hidden">
      <div className="flex items-center gap-2 p-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <AgentIcon base={agent.base} color={agent.color} size={28} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold" style={{ color: agent.color }}>{agent.nickname || agent.label}</div>
          <div className="text-[9px] text-on-surface-variant/45 font-mono truncate">{agent.command} {(agent.args || []).join(' ')}</div>
        </div>
        <span className="material-symbols-outlined text-[14px] text-on-surface-variant/30">{expanded ? 'expand_less' : 'expand_more'}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1 rounded text-on-surface-variant/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-outline-variant/5 pt-2">
          <div>
            <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1">Label</label>
            <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
              className="w-full bg-surface-container-highest rounded-md px-2 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 focus:border-primary/40 outline-none" />
          </div>
          <div>
            <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1">Workspace</label>
            <input value={editCwd} onChange={e => setEditCwd(e.target.value)}
              className="w-full bg-surface-container-highest rounded-md px-2 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 focus:border-primary/40 outline-none font-mono" />
          </div>
          <div>
            <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1">CLI Arguments</label>
            <input value={editArgs} onChange={e => setEditArgs(e.target.value)}
              className="w-full bg-surface-container-highest rounded-md px-2 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 focus:border-primary/40 outline-none font-mono"
              placeholder="--dangerously-skip-permissions --model opus" />
          </div>
          <div>
            <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1">Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
                className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent" />
              <span className="text-[10px] text-on-surface-variant/50 font-mono">{editColor}</span>
            </div>
          </div>
          <div>
            <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1">Nickname</label>
            <input value={editNickname} onChange={e => setEditNickname(e.target.value)}
              className="w-full bg-surface-container-highest rounded-md px-2 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 focus:border-primary/40 outline-none"
              placeholder="Custom display name (optional)" />
          </div>
          <div>
            <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1">Default System Prompt</label>
            <textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value)}
              className="w-full bg-surface-container-highest rounded-md px-2 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 focus:border-primary/40 outline-none resize-y min-h-[60px]"
              rows={3}
              placeholder="Custom instructions injected as agent identity on spawn (optional)" />
          </div>
          <div className="text-[9px] text-on-surface-variant/30 font-mono bg-surface-container-lowest rounded px-2 py-1.5">
            {agent.command} {editArgs}
          </div>
          <button onClick={handleSave}
            className="w-full py-1.5 rounded-lg bg-primary/15 text-primary text-[11px] font-semibold hover:bg-primary/25 transition-colors">
            Save Changes
          </button>
        </div>
      )}
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
      api.getStatus().then(r => setAgents(r.agents)).catch((e) => console.warn('Status fetch:', e.message || e));
    }).catch((e) => console.warn('Settings save:', e.message || e));
    setAdding(false);
    setNewCwd('');
  };

  const removeAgent = (index: number) => {
    const updated = persistent.filter((_, i) => i !== index);
    updateSettings({ persistentAgents: updated });
    api.saveSettings({ persistentAgents: updated }).then(() => {
      api.getStatus().then(r => setAgents(r.agents)).catch((e) => {
        console.warn('Status fetch:', e.message || e);
        // Fallback: resync from server
        api.getStatus().then(r => setAgents(r.agents)).catch((e2) => console.warn('Status fetch retry:', e2.message || e2));
      });
    }).catch((e) => {
      console.warn('Settings save:', e.message || e);
      // Save failed — still refresh agent list to stay in sync
      api.getStatus().then(r => setAgents(r.agents)).catch((e2) => console.warn('Status fetch:', e2.message || e2));
    });
  };

  const handlePickFolder = async () => {
    setPickingFolder(true);
    try {
      const r = await api.pickFolder();
      setNewCwd(r.path);
    } catch (e) { console.warn('Pick folder:', e instanceof Error ? e.message : String(e)); }
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
          <PersistentAgentCard
            key={i}
            agent={pa}
            onUpdate={(updated) => {
              const list = [...persistent];
              list[i] = updated;
              updateSettings({ persistentAgents: list });
              api.saveSettings({ persistentAgents: list }).then(() => {
                api.getStatus().then(r => setAgents(r.agents)).catch((e) => console.warn('Status fetch:', e.message || e));
              }).catch((e) => console.warn('Settings save:', e.message || e));
            }}
            onRemove={() => removeAgent(i)}
          />
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
      api.getAgentTemplates(bases).then(r => setTemplates(r.templates)).catch((e) => console.warn('Agent templates fetch:', e.message || e));
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
      <label className="text-[11px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2 block">
        {label}
      </label>
      {children}
    </div>
  );
}
