interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

const shortcuts = [
  { keys: 'Ctrl+K', description: 'Open search / command palette' },
  { keys: 'Ctrl+/', description: 'Show keyboard shortcuts' },
  { keys: 'Ctrl+N', description: 'New channel' },
  { keys: 'Ctrl+1-9', description: 'Switch to channel by number' },
  { keys: 'Alt+Up', description: 'Previous channel' },
  { keys: 'Alt+Down', description: 'Next channel' },
  { keys: 'Ctrl+Shift+M', description: 'Toggle mute' },
  { keys: 'Escape', description: 'Close any open panel/modal' },
  { keys: 'Enter', description: 'Send message' },
  { keys: 'Shift+Enter', description: 'New line in message' },
  { keys: '/', description: 'Slash commands (in input)' },
  { keys: '@', description: 'Mention agent (in input)' },
];

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[420px] max-w-[92vw] rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(160deg, #141420 0%, #08080f 100%)',
          border: '1px solid rgba(167, 139, 250, 0.15)',
          boxShadow: '0 0 60px rgba(124, 58, 237, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/8">
          <h2 className="text-sm font-semibold text-on-surface">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="text-on-surface-variant/30 hover:text-on-surface-variant/60 transition-colors">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="p-5 space-y-2 max-h-[60vh] overflow-y-auto">
          {shortcuts.map((s) => (
            <div key={s.keys} className="flex items-center justify-between py-1.5">
              <span className="text-[12px] text-on-surface-variant/60">{s.description}</span>
              <div className="flex gap-1">
                {s.keys.split('+').map((key, i) => (
                  <span key={i}>
                    {i > 0 && <span className="text-on-surface-variant/20 text-[10px] mx-0.5">+</span>}
                    <kbd className="text-[10px] text-on-surface-variant/50 bg-surface-container/60 px-2 py-1 rounded border border-outline-variant/10 font-mono">
                      {key}
                    </kbd>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
