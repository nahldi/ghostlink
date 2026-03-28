interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], description: 'Open command palette' },
  { keys: ['Ctrl', 'F'], description: 'Search messages' },
  { keys: ['Ctrl', '/'], description: 'Show keyboard shortcuts' },
  { keys: ['Ctrl', 'N'], description: 'New channel' },
  { keys: ['Ctrl', '1-9'], description: 'Switch channel by number' },
  { keys: ['Alt', '\u2191/\u2193'], description: 'Previous / next channel' },
  { keys: ['Ctrl', 'Shift', 'M'], description: 'Toggle mute' },
  { keys: ['Escape'], description: 'Close panels / modals' },
  { keys: ['Enter'], description: 'Send message' },
  { keys: ['Shift', 'Enter'], description: 'New line in message' },
  { keys: ['/'], description: 'Slash commands (in empty input)' },
  { keys: ['@'], description: 'Mention agent autocomplete' },
  { keys: ['Tab'], description: 'Accept autocomplete suggestion' },
  { keys: ['Arrow Up/Down'], description: 'Navigate autocomplete / commands' },
  { keys: ['Ctrl', 'Shift', 'T'], description: 'Cockpit: Terminal tab' },
  { keys: ['Ctrl', 'Shift', 'F'], description: 'Cockpit: Files tab' },
  { keys: ['Ctrl', 'Shift', 'B'], description: 'Cockpit: Browser tab' },
  { keys: ['Ctrl', 'Shift', 'R'], description: 'Cockpit: Replay tab' },
  { keys: ['Ctrl', 'Shift', 'A'], description: 'Cockpit: Activity tab' },
  { keys: ['Ctrl', 'Shift', 'C'], description: 'Cockpit: Checkpoints tab' },
];

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[440px] max-w-[92vw] rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(160deg, #141420 0%, #08080f 100%)',
          border: '1px solid rgba(167, 139, 250, 0.15)',
          boxShadow: '0 0 60px rgba(124, 58, 237, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/8">
          <h2 className="text-sm font-semibold text-on-surface">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-container-high text-on-surface-variant/40 hover:text-on-surface-variant/70 transition-colors">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="p-5 space-y-2">
          {SHORTCUTS.map((shortcut, i) => (
            <div key={i} className="flex items-center justify-between py-1.5">
              <span className="text-[12px] text-on-surface-variant/60">{shortcut.description}</span>
              <div className="flex gap-1">
                {shortcut.keys.map((key, j) => (
                  <kbd
                    key={j}
                    className="px-2 py-0.5 text-[10px] font-mono text-on-surface-variant/50 bg-surface-container/60 border border-outline-variant/10 rounded"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
