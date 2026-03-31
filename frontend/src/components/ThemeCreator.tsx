import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ThemeColors {
  name: string;
  surface: string;
  primary: string;
  secondary: string;
  tertiary: string;
  onSurface: string;
  surfaceContainer: string;
}

const DEFAULT_THEME: ThemeColors = {
  name: 'Custom Theme',
  surface: '#08080f',
  primary: '#a78bfa',
  secondary: '#38bdf8',
  tertiary: '#fb923c',
  onSurface: '#e0dff0',
  surfaceContainer: '#141420',
};

const GALLERY: ThemeColors[] = [
  { name: 'Midnight', surface: '#08080f', primary: '#a78bfa', secondary: '#38bdf8', tertiary: '#fb923c', onSurface: '#e0dff0', surfaceContainer: '#141420' },
  { name: 'Ocean', surface: '#0a1628', primary: '#60a5fa', secondary: '#34d399', tertiary: '#fbbf24', onSurface: '#e2e8f0', surfaceContainer: '#0f2140' },
  { name: 'Terminal', surface: '#000000', primary: '#00ff41', secondary: '#00ff41', tertiary: '#ff6600', onSurface: '#00ff41', surfaceContainer: '#0a0a0a' },
  { name: 'Sunset', surface: '#1a0a1e', primary: '#f97316', secondary: '#ec4899', tertiary: '#eab308', onSurface: '#fde8d0', surfaceContainer: '#2a1030' },
  { name: 'Nord', surface: '#2e3440', primary: '#88c0d0', secondary: '#81a1c1', tertiary: '#ebcb8b', onSurface: '#eceff4', surfaceContainer: '#3b4252' },
  { name: 'Dracula', surface: '#282a36', primary: '#bd93f9', secondary: '#8be9fd', tertiary: '#ffb86c', onSurface: '#f8f8f2', surfaceContainer: '#44475a' },
];

interface ThemeCreatorProps {
  onClose: () => void;
  onApply: (theme: ThemeColors) => void;
}

/**
 * ThemeCreator — visual theme editor with live preview.
 * Pick colors, preview in real-time, export/import as JSON.
 */
export function ThemeCreator({ onClose, onApply }: ThemeCreatorProps) {
  const [theme, setTheme] = useState<ThemeColors>(DEFAULT_THEME);
  const [copied, setCopied] = useState(false);

  const updateColor = useCallback((key: keyof ThemeColors, value: string) => {
    setTheme(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleExport = useCallback(() => {
    const json = JSON.stringify(theme, null, 2);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(json).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [theme]);

  const handleImport = useCallback(() => {
    const input = prompt('Paste theme JSON:');
    if (!input) return;
    try {
      const parsed = JSON.parse(input);
      if (parsed.surface && parsed.primary) {
        setTheme({ ...DEFAULT_THEME, ...parsed });
      }
    } catch {
      alert('Invalid theme JSON');
    }
  }, []);

  const colorFields: { key: keyof ThemeColors; label: string; desc: string }[] = [
    { key: 'surface', label: 'Background', desc: 'Main background color' },
    { key: 'surfaceContainer', label: 'Container', desc: 'Cards and panels' },
    { key: 'primary', label: 'Primary', desc: 'Accent color (buttons, links)' },
    { key: 'secondary', label: 'Secondary', desc: 'Secondary accent' },
    { key: 'tertiary', label: 'Tertiary', desc: 'Tertiary accent' },
    { key: 'onSurface', label: 'Text', desc: 'Main text color' },
  ];

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          className="relative w-[520px] max-w-[95vw] max-h-[85vh] overflow-y-auto rounded-2xl p-6 glass-card"
          onClick={e => e.stopPropagation()}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-on-surface">Theme Creator</h2>
              <p className="text-[10px] text-on-surface-variant/40 mt-0.5">Design your own color scheme</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant/40">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Theme Name */}
          <div className="mb-4">
            <label className="text-[10px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-1 block">Name</label>
            <input
              type="text"
              value={theme.name}
              onChange={e => updateColor('name', e.target.value)}
              className="setting-input text-[13px]"
            />
          </div>

          {/* Gallery */}
          <div className="mb-5">
            <label className="text-[10px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-2 block">Gallery</label>
            <div className="grid grid-cols-3 gap-2">
              {GALLERY.map(t => (
                <button
                  key={t.name}
                  onClick={() => setTheme(t)}
                  className={`rounded-lg p-2 border transition-all text-left ${
                    theme.name === t.name ? 'border-primary/40 ring-1 ring-primary/20' : 'border-outline-variant/8 hover:border-outline-variant/20'
                  }`}
                  style={{ background: t.surface }}
                  aria-label={`Apply ${t.name} theme`}
                >
                  <div className="flex gap-1 mb-1.5">
                    {[t.primary, t.secondary, t.tertiary].map((c, i) => (
                      <div key={i} className="w-3 h-3 rounded-full" style={{ background: c }} />
                    ))}
                  </div>
                  <div className="text-[9px] font-semibold" style={{ color: t.onSurface }}>{t.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Color Pickers */}
          <div className="space-y-3 mb-5">
            {colorFields.map(({ key, label, desc }) => (
              <div key={key} className="flex items-center gap-3">
                <input
                  type="color"
                  value={theme[key]}
                  onChange={e => updateColor(key, e.target.value)}
                  className="w-8 h-8 rounded-lg border border-outline-variant/10 cursor-pointer bg-transparent"
                />
                <div className="flex-1">
                  <div className="text-[11px] font-semibold text-on-surface">{label}</div>
                  <div className="text-[9px] text-on-surface-variant/30">{desc}</div>
                </div>
                <input
                  type="text"
                  value={theme[key]}
                  onChange={e => updateColor(key, e.target.value)}
                  className="w-20 text-[10px] font-mono px-2 py-1 rounded-lg bg-surface-container/50 border border-outline-variant/8 text-on-surface-variant/60 text-center"
                />
              </div>
            ))}
          </div>

          {/* Live Preview */}
          <div className="mb-5">
            <label className="text-[10px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-2 block">Preview</label>
            <div
              className="rounded-xl p-4 border border-outline-variant/10"
              style={{ background: theme.surface }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full" style={{ background: theme.primary }} />
                <span style={{ color: theme.onSurface, fontSize: 12, fontWeight: 600 }}>Agent Name</span>
                <span style={{ color: theme.onSurface, opacity: 0.3, fontSize: 10 }}>2m ago</span>
              </div>
              <div
                className="rounded-xl p-3 mb-2"
                style={{ background: theme.surfaceContainer, color: theme.onSurface, fontSize: 12 }}
              >
                Hello! This is a preview message with your custom theme.
              </div>
              <div className="flex gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: theme.primary + '20', color: theme.primary }}>Primary</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: theme.secondary + '20', color: theme.secondary }}>Secondary</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: theme.tertiary + '20', color: theme.tertiary }}>Tertiary</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onApply(theme)}
              className="flex-1 py-2.5 rounded-xl bg-primary-container text-white text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all"
            >
              Apply Theme
            </button>
            <button
              onClick={handleExport}
              className="px-3 py-2.5 rounded-xl bg-surface-container/50 border border-outline-variant/8 text-on-surface-variant/60 text-sm hover:text-on-surface transition-colors"
            >
              {copied ? 'Copied!' : 'Export'}
            </button>
            <button
              onClick={handleImport}
              className="px-3 py-2.5 rounded-xl bg-surface-container/50 border border-outline-variant/8 text-on-surface-variant/60 text-sm hover:text-on-surface transition-colors"
            >
              Import
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
