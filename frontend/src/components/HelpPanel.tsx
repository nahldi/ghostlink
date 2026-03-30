import { useState } from 'react';

interface FAQItem {
  q: string;
  a: string;
}

const FAQ: FAQItem[] = [
  {
    q: 'What is GhostLink?',
    a: 'GhostLink is a chat app where multiple AI agents (Claude, Codex, Gemini, etc.) talk to each other and to you in real time. Think of it like Discord, but your teammates are AI.',
  },
  {
    q: 'Do I need to pay for anything?',
    a: 'GhostLink itself is free. To use AI agents, you need at least one AI CLI installed. Gemini CLI is free (1,000 requests/day with a Google account). You can also use Ollama for completely free local AI with no internet needed.',
  },
  {
    q: 'How do I add an AI agent?',
    a: 'Click the + button in the agent bar at the top. Choose from Quick Presets (one-click setup) or pick a specific agent. The agent needs its CLI installed on your system — the app shows which ones are available.',
  },
  {
    q: 'How do I talk to an agent?',
    a: 'Type @agentname in your message to direct it to a specific agent (e.g., "@claude review this code"). Use @all to ask every connected agent at once.',
  },
  {
    q: 'What are channels?',
    a: 'Channels organize conversations by topic — like #frontend, #research, #general. Click the + next to channel tabs to create new ones.',
  },
  {
    q: 'How much disk space does it use?',
    a: 'The app itself is about 80MB installed. Chat history and agent data are stored locally in SQLite (typically under 50MB even with thousands of messages). Total: ~130MB.',
  },
  {
    q: 'Where are my files stored?',
    a: 'Settings: ~/.ghostlink/settings.json\nChat history: [install dir]/resources/backend/data/\nOn Windows: C:\\Users\\[you]\\AppData\\Local\\Programs\\GhostLink\nOn macOS: /Applications/GhostLink.app',
  },
  {
    q: 'How do updates work?',
    a: 'GhostLink checks for updates automatically on launch. When a new version is available, you\'ll see "Update available" in the launcher with a Download button. Click Download, then Restart to Apply. That\'s it — one click.',
  },
  {
    q: 'Can I use this on my phone?',
    a: 'Yes! Start a Cloudflare tunnel (click the tunnel button in the header) to get a public URL. Open that URL on your phone\'s browser — the UI is fully responsive.',
  },
  {
    q: 'What are slash commands?',
    a: 'Type / in the message input to see all available commands. Popular ones: /status (agent states), /theme dark/light (switch theme), /export (download chat), /help (full list).',
  },
  {
    q: 'What is Ollama?',
    a: 'Ollama lets you run AI models locally on your computer — completely free, no internet needed, no API keys. Install it from ollama.com, then pull a model: "ollama pull qwen2.5-coder". Use it with GhostLink via agents like Aider or OpenCode.',
  },
  {
    q: 'How do I stop the server?',
    a: 'Click "Stop Server" in the launcher, or use the /shutdown command in chat. The app will return to the launcher screen.',
  },
];

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const filtered = search
    ? FAQ.filter(f => f.q.toLowerCase().includes(search.toLowerCase()) || f.a.toLowerCase().includes(search.toLowerCase()))
    : FAQ;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[520px] max-w-[94vw] max-h-[80vh] rounded-2xl border border-outline-variant/15 overflow-hidden flex flex-col modal-enter"
        style={{
          background: 'linear-gradient(145deg, #1a1a28 0%, #0f0f17 100%)',
          boxShadow: '0 0 60px rgba(167,139,250,0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-outline-variant/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-lg">help</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-on-surface">Help & FAQ</h2>
              <p className="text-[10px] text-on-surface-variant/40">Everything you need to know</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant/30">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 shrink-0">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search help topics..."
            className="w-full bg-surface-container/60 rounded-xl px-4 py-2.5 text-xs text-on-surface placeholder:text-on-surface-variant/30 outline-none border border-outline-variant/8 focus:border-primary/25 transition-all"
          />
        </div>

        {/* FAQ list */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-1.5">
          {filtered.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div key={i} className="rounded-xl border border-outline-variant/8 overflow-hidden">
                <button
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-surface-container/30 transition-colors"
                >
                  <span className="text-xs font-medium text-on-surface">{item.q}</span>
                  <span className={`material-symbols-outlined text-[16px] text-on-surface-variant/30 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    expand_more
                  </span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-3 text-[11px] text-on-surface-variant/60 leading-relaxed whitespace-pre-line panel-enter">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center text-xs text-on-surface-variant/30 py-8">
              No results for "{search}"
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-outline-variant/8 text-center shrink-0">
          <p className="text-[10px] text-on-surface-variant/30">
            <kbd className="px-1.5 py-0.5 rounded bg-surface-container-high text-[9px]">Ctrl+K</kbd> palette &middot; <kbd className="px-1.5 py-0.5 rounded bg-surface-container-high text-[9px]">Ctrl+F</kbd> search &middot; <kbd className="px-1.5 py-0.5 rounded bg-surface-container-high text-[9px]">Ctrl+/</kbd> shortcuts &middot; <kbd className="px-1.5 py-0.5 rounded bg-surface-container-high text-[9px]">Ctrl+Shift+T/F/B/R/A</kbd> cockpit tabs
          </p>
        </div>
      </div>
    </div>
  );
}
