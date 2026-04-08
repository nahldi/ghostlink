import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import { toast } from './Toast';
import { AgentIcon } from './AgentIcon';
import { SoundManager, SOUND_OPTIONS } from '../lib/sounds';
import { Section, Toggle, SettingField } from './settings/SettingsUI';
import { SecurityTab } from './settings/SecurityTab';
import { AdvancedTab } from './settings/AdvancedTab';
import { ProviderOpsPanel } from './ProviderOpsPanel';
import { A2APanel } from './A2APanel';
import { ProductizationPanel } from './ProductizationPanel';
import { ReviewRulesEditor } from './ReviewRulesEditor';
import type { Plugin, SkillPack, Hook, Bridge } from '../types';
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
const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'tune' },
  { id: 'agents', label: 'Agents', icon: 'smart_toy' },
  { id: 'providers', label: 'AI', icon: 'model_training' },
  { id: 'advanced', label: 'More', icon: 'settings' },
];

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
    api.saveSettings(updates).catch((e) => { toast('Settings failed to save', 'error'); console.warn('Settings save:', e.message || e); });
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
    }).catch((e) => { toast('Settings failed to save', 'error'); console.warn('Settings save:', e instanceof Error ? e.message : String(e)); setSaving(false); });
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
        <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-5"
        >
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
          <ReviewRulesEditor />
          <SecurityTab />
          <AdvancedTab display={display} applyInstant={applyInstant} settings={settings} />
        </>)}
        </motion.div>
        </AnimatePresence>
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
      <ProductizationPanel />

      <div className="h-px bg-outline-variant/8" />

      <A2APanel />

      <div className="h-px bg-outline-variant/8" />

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

/* SecurityTab imported from ./settings/SecurityTab */

/* ── Tab: Providers ──────────────────────────────────────────────── */

function ProvidersTab() {
  return <ProviderOpsPanel />;
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
      api.getStatus().then(r => setAgents(r.agents)).catch((e) => console.error('Failed to refresh agent status:', e));
    }).catch((e) => console.error('Failed to save persistent agents:', e));
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

/* SettingField, Section, Toggle imported from ./settings/SettingsUI */
