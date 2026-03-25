import { useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import type { Settings } from '../types';

const THEMES = [
  { id: 'dark', label: 'Dark', color: '#a78bfa' },
  { id: 'light', label: 'Light', color: '#7c3aed' },
  { id: 'cyberpunk', label: 'Cyberpunk', color: '#ff2d95' },
  { id: 'terminal', label: 'Terminal', color: '#22c55e' },
  { id: 'ocean', label: 'Ocean', color: '#38bdf8' },
  { id: 'sunset', label: 'Sunset', color: '#fb923c' },
  { id: 'midnight', label: 'Midnight', color: '#6366f1' },
  { id: 'rosegold', label: 'Rose Gold', color: '#fb7185' },
  { id: 'arctic', label: 'Arctic', color: '#67e8f9' },
] as const;

export function FirstRunWizard() {
  const settings = useChatStore((s) => s.settings);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState('');
  const [theme, setTheme] = useState<Settings['theme']>('dark');
  const [visible, setVisible] = useState(true);

  // Check both store and localStorage for persistence across reloads
  if (!visible || settings.setupComplete || localStorage.getItem('ghostlink_setup_complete')) return null;

  const finish = async () => {
    const updates: Partial<Settings> = {
      username: username.trim() || 'You',
      theme,
      setupComplete: true,
    };
    updateSettings(updates);
    localStorage.setItem('ghostlink_setup_complete', 'true');
    try { await api.saveSettings({ ...settings, ...updates }); } catch {}
    document.documentElement.setAttribute('data-theme', theme);
    setVisible(false);
  };

  const steps = [
    // Step 0: Welcome + username
    <div key="welcome">
      <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mb-5 mx-auto">
        <span className="material-symbols-outlined text-3xl text-primary">waving_hand</span>
      </div>
      <h2 className="text-xl font-bold text-on-surface text-center mb-2">Welcome to GhostLink</h2>
      <p className="text-sm text-on-surface-variant/60 text-center mb-6">
        Your multi-agent AI chat hub. Let's get you set up.
      </p>
      <label className="block text-xs text-on-surface-variant/50 mb-1.5 font-medium">What should we call you?</label>
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Your name (or leave blank for 'You')"
        className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/15 text-on-surface text-sm focus:outline-none focus:border-primary/50 transition-colors"
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && setStep(1)}
      />
    </div>,

    // Step 1: Theme picker
    <div key="theme">
      <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mb-5 mx-auto">
        <span className="material-symbols-outlined text-3xl text-primary">palette</span>
      </div>
      <h2 className="text-xl font-bold text-on-surface text-center mb-2">Pick Your Theme</h2>
      <p className="text-sm text-on-surface-variant/60 text-center mb-6">
        You can always change this later in Settings.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
              theme === t.id
                ? 'bg-primary/20 border-primary/40 text-on-surface ring-1 ring-primary/30'
                : 'bg-surface-container border-outline-variant/10 text-on-surface-variant/60 hover:bg-surface-container-high'
            } border`}
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.color }} />
            {t.label}
          </button>
        ))}
      </div>
    </div>,

    // Step 2: Ready
    <div key="ready">
      <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mb-5 mx-auto">
        <span className="material-symbols-outlined text-3xl text-primary">rocket_launch</span>
      </div>
      <h2 className="text-xl font-bold text-on-surface text-center mb-2">You're All Set!</h2>
      <p className="text-sm text-on-surface-variant/60 text-center mb-4">
        Here's what you can do:
      </p>
      <div className="space-y-2.5 mb-2">
        {[
          { icon: 'add_circle', text: 'Click + in the agent bar to spawn AI agents' },
          { icon: 'alternate_email', text: 'Type @claude or @all to talk to agents' },
          { icon: 'terminal', text: 'Type / for slash commands like /help' },
          { icon: 'keyboard', text: 'Press Ctrl+K to search anything' },
        ].map((item) => (
          <div key={item.icon} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-container/50">
            <span className="material-symbols-outlined text-base text-primary/70">{item.icon}</span>
            <span className="text-xs text-on-surface-variant/70">{item.text}</span>
          </div>
        ))}
      </div>
    </div>,
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={finish}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[400px] max-w-[90vw] rounded-2xl p-7 border border-primary/20"
        style={{
          background: 'linear-gradient(145deg, #1a1a2e 0%, #0f0f1a 100%)',
          boxShadow: '0 0 80px rgba(167, 139, 250, 0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress dots */}
        <div className="flex gap-1.5 mb-5">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full flex-1 transition-all duration-300 ${
                i <= step ? 'bg-primary' : 'bg-surface-container-highest'
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        {steps[step]}

        {/* Actions */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={finish}
            className="text-xs text-on-surface-variant/40 hover:text-on-surface-variant/60 transition-colors"
          >
            {step === steps.length - 1 ? '' : 'Skip'}
          </button>
          <button
            onClick={() => step < steps.length - 1 ? setStep(step + 1) : finish()}
            className="px-6 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-semibold hover:brightness-110 transition-all active:scale-95"
          >
            {step === steps.length - 1 ? 'Start Chatting' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
