import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { useChatStore } from './stores/chatStore';
import { useWebSocket } from './hooks/useWebSocket';
import { api } from './lib/api';
import { Sidebar } from './components/Sidebar';
import { MobileHeader } from './components/MobileHeader';
import { MobileSidebar } from './components/MobileSidebar';
import { AgentBar } from './components/AgentBar';
import { ChannelTabs } from './components/ChannelTabs';
import { ChatMessage } from './components/ChatMessage';
import { MessageInput } from './components/MessageInput';
import { TypingIndicator } from './components/TypingIndicator';
import { StatsPanel } from './components/StatsPanel';
import { ConnectionBanner } from './components/ConnectionBanner';
import { BulkDeleteBar } from './components/BulkDeleteBar';
import { SoundManager } from './lib/sounds';
import { SessionBar } from './components/SessionBar';


// Lazy-loaded components (reduce initial bundle from ~900KB)
const JobsPanel = lazy(() => import('./components/JobsPanel').then(m => ({ default: m.JobsPanel })));
const RulesPanel = lazy(() => import('./components/RulesPanel').then(m => ({ default: m.RulesPanel })));
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const SearchModal = lazy(() => import('./components/SearchModal').then(m => ({ default: m.SearchModal })));
const KeyboardShortcutsModal = lazy(() => import('./components/KeyboardShortcutsModal').then(m => ({ default: m.KeyboardShortcutsModal })));
const RemoteSession = lazy(() => import('./components/RemoteSession').then(m => ({ default: m.RemoteSession })));
const OnboardingTour = lazy(() => import('./components/OnboardingTour').then(m => ({ default: m.OnboardingTour })));
const HelpPanel = lazy(() => import('./components/HelpPanel').then(m => ({ default: m.HelpPanel })));
const SessionLauncher = lazy(() => import('./components/SessionLauncher').then(m => ({ default: m.SessionLauncher })));
const FirstRunWizard = lazy(() => import('./components/FirstRunWizard').then(m => ({ default: m.FirstRunWizard })));
const AgentCockpit = lazy(() => import('./components/AgentCockpit').then(m => ({ default: m.AgentCockpit })));
const CommandPalette = lazy(() => import('./components/CommandPalette').then(m => ({ default: m.CommandPalette })));

const CONVERSATION_STARTERS = [
  { text: 'Ask @claude to review your code', icon: 'code' },
  { text: 'Brainstorm with @all agents', icon: 'psychology' },
  { text: 'Start a new task with @codex', icon: 'task_alt' },
  { text: 'Research a topic with @gemini', icon: 'search' },
  { text: 'Check /status of all agents', icon: 'monitoring' },
  { text: 'Type /help for commands', icon: 'help' },
];

function ThinkingBubbles() {
  const thinkingStreams = useChatStore((s) => s.thinkingStreams);
  const agents = useChatStore((s) => s.agents);

  const activeStreams = Object.entries(thinkingStreams).filter(([, s]) => s.active && s.text);
  if (activeStreams.length === 0) return null;

  return (
    <>
      {activeStreams.map(([agentName, stream]) => {
        const agent = agents.find(a => a.name === agentName);
        const color = agent?.color || '#a78bfa';
        const label = agent?.label || agentName;
        // Show last 3 non-empty lines — compact and readable
        const lines = stream.text.split('\n').filter(l => l.trim()).slice(-3);

        return (
          <div key={agentName} className="flex items-start gap-2.5 py-1">
            <div className="relative w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: `${color}18` }}>
              <span className="text-[9px] font-bold" style={{ color }}>{label[0]}</span>
              <div className="absolute -inset-0.5 rounded-full opacity-40 animate-pulse" style={{ boxShadow: `0 0 6px ${color}` }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] font-semibold opacity-70" style={{ color }}>{label}</span>
                <span className="thinking-dots text-[9px] text-on-surface-variant/25 font-medium">thinking</span>
              </div>
              <div className="rounded-xl px-3 py-2 text-[10px] text-on-surface-variant/35 leading-relaxed overflow-hidden max-h-[60px] font-mono"
                style={{
                  background: `color-mix(in srgb, ${color} 3%, rgba(17,17,25,0.4))`,
                  border: `1px solid color-mix(in srgb, ${color} 6%, transparent)`,
                }}>
                {lines.map((line, i) => (
                  <div key={i} className="truncate">{line}</div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

function ConversationStarters({ channel }: { channel: string }) {
  const settings = useChatStore((s) => s.settings);
  const sendMessage = (text: string) => {
    api.sendMessage(settings.username, text, channel).catch((e) => console.warn('Send message:', e.message || e));
  };
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-12">
      <img src="/ghostlink.png" alt="GhostLink" className="w-14 h-14 mb-4 opacity-40" style={{ filter: 'invert(1)' }} />
      <div className="text-sm font-semibold text-on-surface/40 mb-1">
        #{channel}
      </div>
      <div className="text-xs text-on-surface-variant/30 mb-6">
        Start a conversation or try one of these:
      </div>
      <div className="flex flex-wrap justify-center gap-2 max-w-md">
        {CONVERSATION_STARTERS.map((s) => (
          <button
            key={s.text}
            onClick={() => sendMessage(s.text)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container/60 border border-outline-variant/10 text-xs text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high hover:border-primary/20 transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-[14px]">{s.icon}</span>
            {s.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatFeed() {
  const messages = useChatStore((s) => s.messages);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const feedRef = useRef<HTMLDivElement>(null);
  const channelMessages = messages.filter((m) => m.channel === activeChannel);

  const atBottom = useChatStore((s) => s.chatAtBottom);
  const setChatAtBottom = useChatStore((s) => s.setChatAtBottom);
  const setNewMsgCount = useChatStore((s) => s.setNewMsgCount);
  const prevMsgCount = useRef(0);

  // v2.5.0: Virtual scrolling for large message lists (performance)
  const VIRTUALIZE_THRESHOLD = 200; // Only virtualize when many messages
  const useVirtual = channelMessages.length > VIRTUALIZE_THRESHOLD;

  const scrollToBottom = useCallback(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
      setNewMsgCount(0);
      setChatAtBottom(true);
    }
  }, [setNewMsgCount, setChatAtBottom]);

  const handleScroll = () => {
    if (!feedRef.current) return;
    const el = feedRef.current;
    const isBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setChatAtBottom(isBottom);
    if (isBottom) setNewMsgCount(0);
  };

  // Check scroll position on mount and after messages load
  useEffect(() => {
    const timer = setTimeout(() => {
      if (feedRef.current) {
        const el = feedRef.current;
        const isBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
        setChatAtBottom(isBottom);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [channelMessages.length, setChatAtBottom]);

  useEffect(() => {
    if (channelMessages.length > prevMsgCount.current) {
      if (atBottom) {
        requestAnimationFrame(() => scrollToBottom());
      } else {
        setNewMsgCount((n: number) => n + (channelMessages.length - prevMsgCount.current));
      }
    }
    prevMsgCount.current = channelMessages.length;
  }, [channelMessages.length, atBottom, scrollToBottom, setNewMsgCount]);

  useEffect(() => {
    requestAnimationFrame(() => scrollToBottom());
    prevMsgCount.current = channelMessages.length;
  }, [activeChannel, scrollToBottom, channelMessages.length]);

  return (
    <div ref={feedRef} onScroll={handleScroll} onWheel={handleScroll} data-chat-feed className="flex-1 overflow-y-auto overflow-x-hidden py-3 relative min-h-0">
      <div className="px-4 lg:px-6">
      {channelMessages.length === 0 ? (
        <ConversationStarters channel={activeChannel} />
      ) : useVirtual ? (
        // v2.5.0: Only render recent messages when there are many — keeps DOM small
        <>
          {channelMessages.length > VIRTUALIZE_THRESHOLD && (
            <div className="text-center py-4">
              <span className="text-xs text-on-surface-variant/40">
                Showing latest {VIRTUALIZE_THRESHOLD} of {channelMessages.length} messages
              </span>
            </div>
          )}
          {channelMessages.slice(-VIRTUALIZE_THRESHOLD).map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
        </>
      ) : (
        // Render messages without stagger animation to prevent glitch/shake on rapid sends.
        // Only new messages get a subtle entrance via AnimatePresence.
        <div>
          {channelMessages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
        </div>
      )}
      <ThinkingBubbles />
      </div>

    </div>
  );
}

function ScrollArrow() {
  const atBottom = useChatStore((s) => s.chatAtBottom);
  const newMsgCount = useChatStore((s) => s.newMsgCount);

  if (atBottom) return null;

  const scrollDown = () => {
    const feed = document.querySelector('[data-chat-feed]') as HTMLElement;
    if (feed) {
      feed.scrollTop = feed.scrollHeight;
      useChatStore.getState().setChatAtBottom(true);
      useChatStore.getState().setNewMsgCount(0);
    }
  };

  return (
    <button
      onClick={scrollDown}
      className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-5 py-2.5 rounded-full transition-all hover:brightness-110 active:scale-95"
      style={{
        background: 'rgba(124, 58, 237, 0.95)',
        boxShadow: '0 4px 24px rgba(124, 58, 237, 0.4), 0 2px 8px rgba(0,0,0,0.4)',
      }}
    >
      <span className="material-symbols-outlined text-white text-[20px]">expand_more</span>
      {newMsgCount > 0 && (
        <span className="text-white text-[12px] font-bold">{newMsgCount} new</span>
      )}
    </button>
  );
}

function RightPanel() {
  const panel = useChatStore((s) => s.sidebarPanel);
  const setSidebarPanel = useChatStore((s) => s.setSidebarPanel);
  const [panelWidth, setPanelWidth] = useState(panel === 'cockpit' ? 400 : 320);
  const isDragging = useRef(false);

  // Update default width when panel type changes
  useEffect(() => {
    setPanelWidth(panel === 'cockpit' ? 400 : 320);
  }, [panel]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;
    const handleMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX - e.clientX;
      setPanelWidth(Math.max(280, Math.min(startWidth + delta, 600)));
    };
    const handleUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelWidth]);

  return (
    <AnimatePresence>
      {panel && (
        <>
          <div className="fixed inset-0 z-[29] max-lg:hidden" onClick={() => setSidebarPanel(null)} />
          <motion.aside
            key="right-panel"
            initial={{ x: panelWidth, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: panelWidth, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="h-screen glass-strong fixed right-0 top-0 z-30 max-lg:hidden flex flex-col"
            style={{ width: panelWidth }}
          >
            {/* Resize handle */}
            <div
              onMouseDown={handleResizeStart}
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
              title="Drag to resize"
            />
            <button
              onClick={() => setSidebarPanel(null)}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant/40 hover:text-on-surface-variant/70 transition-colors"
              title="Close panel"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
            <Suspense fallback={<div className="flex items-center justify-center p-8"><span className="material-symbols-outlined animate-spin text-primary/40">progress_activity</span></div>}>
              {panel === 'jobs' && <JobsPanel />}
              {panel === 'rules' && <RulesPanel />}
              {panel === 'settings' && <SettingsPanel />}
              {panel === 'cockpit' && <AgentCockpit />}
            </Suspense>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function MobilePanel() {
  const panel = useChatStore((s) => s.sidebarPanel);
  return (
    <AnimatePresence>
      {panel && (
        <motion.div
          key="mobile-panel"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="lg:hidden fixed inset-0 z-50 bg-surface/95 backdrop-blur-xl overflow-y-auto pt-14"
        >
          <button
            onClick={() => useChatStore.getState().setSidebarPanel(null)}
            className="absolute top-3 right-3 p-2 rounded-lg hover:bg-surface-container-high text-on-surface-variant/40"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
          {panel === 'jobs' && <JobsPanel />}
          {panel === 'rules' && <RulesPanel />}
          {panel === 'settings' && <SettingsPanel />}
          {panel === 'cockpit' && <AgentCockpit />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import { Component, type ReactNode } from 'react';

class ErrorBoundary extends Component<{children: ReactNode}, {error: Error | null}> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[GhostLink ErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding: 40, color: '#e0dff0', background: '#08080f', minHeight: '100vh', fontFamily: 'Inter, sans-serif'}}>
          <h1 style={{color: '#a78bfa', marginBottom: 16, fontSize: 20}}>GhostLink</h1>
          <p style={{color: '#fca5a5', fontSize: 14}}>Something went wrong:</p>
          <pre style={{color: '#a9a4b8', fontSize: 12, marginTop: 12, whiteSpace: 'pre-wrap'}}>{this.state.error.message}</pre>
          <button onClick={() => window.location.reload()} style={{marginTop: 20, padding: '10px 20px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer'}}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const setMessages = useChatStore((s) => s.setMessages);
  const setAgents = useChatStore((s) => s.setAgents);
  const setJobs = useChatStore((s) => s.setJobs);
  const setRules = useChatStore((s) => s.setRules);
  const setChannels = useChatStore((s) => s.setChannels);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const clearUnread = useChatStore((s) => s.clearUnread);
  const sidebarPanel = useChatStore((s) => s.sidebarPanel);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const fontSize = useChatStore((s) => s.settings.fontSize);
  const title = useChatStore((s) => s.settings.title);
  const theme = useChatStore((s) => s.settings.theme);
  const showStatsPanel = useChatStore((s) => s.settings.showStatsPanel);
  const showAgentBar = useChatStore((s) => s.settings.showAgentBar) !== false;
  const showChannelTabs = useChatStore((s) => s.settings.showChannelTabs) !== false;
  const showTypingIndicator = useChatStore((s) => s.settings.showTypingIndicator) !== false;

  const [showSearch, setShowSearch] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSessionLauncher, setShowSessionLauncher] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  useWebSocket();

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+K — command palette
      if (ctrl && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
        return;
      }
      // Ctrl+F — search messages
      if (ctrl && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        return;
      }
      // Ctrl+/ — keyboard shortcuts help
      if (ctrl && e.key === '/') {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      // Ctrl+N — new channel (open sidebar with channel adding)
      if (ctrl && e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        // Dispatch custom event that Sidebar can listen to
        window.dispatchEvent(new CustomEvent('ghostlink:new-channel'));
        return;
      }
      // Ctrl+1-9 — switch channel by number
      if (ctrl && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const channels = useChatStore.getState().channels;
        if (channels.length > 0 && idx >= 0 && idx < channels.length) {
          useChatStore.getState().setActiveChannel(channels[idx].name);
          useChatStore.getState().clearUnread(channels[idx].name);
        }
        return;
      }
      // Ctrl+Shift+T/F/B/R/A — cockpit tabs (Terminal/Files/Browser/Replay/Activity)
      // Skip if user is typing in an input/textarea/contenteditable
      if (ctrl && e.shiftKey && 'tfbra'.includes(e.key.toLowerCase()) && useChatStore.getState().sidebarPanel === 'cockpit') {
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        const editable = document.activeElement?.getAttribute('contenteditable') === 'true';
        if (tag === 'input' || tag === 'textarea' || editable) return;
        e.preventDefault();
        const tabMap: Record<string, string> = { t: 'terminal', f: 'files', b: 'browser', r: 'replay', a: 'activity' };
        window.dispatchEvent(new CustomEvent('cockpit-tab', { detail: tabMap[e.key.toLowerCase()] }));
        return;
      }
      // Alt+Up/Down — prev/next channel
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const state = useChatStore.getState();
        if (state.channels.length === 0) return;
        const idx = state.channels.findIndex(c => c.name === state.activeChannel);
        const next = e.key === 'ArrowDown'
          ? (idx + 1) % state.channels.length
          : (idx - 1 + state.channels.length) % state.channels.length;
        state.setActiveChannel(state.channels[next].name);
        state.clearUnread(state.channels[next].name);
        return;
      }
      // Ctrl+Shift+M — toggle mute
      if (ctrl && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        const current = useChatStore.getState().settings.notificationSounds;
        useChatStore.getState().updateSettings({ notificationSounds: !current });
        api.saveSettings({ notificationSounds: !current }).catch((e) => console.warn('Settings save:', e.message || e));
        return;
      }
      // Escape — close panels / exit select mode
      if (e.key === 'Escape') {
        if (useChatStore.getState().selectMode) { useChatStore.getState().clearSelection(); return; }
        if (showCommandPalette) { setShowCommandPalette(false); return; }
        if (showSearch) { setShowSearch(false); return; }
        if (showShortcuts) { setShowShortcuts(false); return; }
        const panel = useChatStore.getState().sidebarPanel;
        if (panel) { useChatStore.getState().setSidebarPanel(null); return; }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSearch, showShortcuts, showCommandPalette]);

  // Apply font size to root
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  // Apply title to document
  useEffect(() => {
    document.title = title || 'GhostLink';
  }, [title]);

  // Help panel toggle from sidebar
  useEffect(() => {
    const handler = () => setShowHelp(prev => !prev);
    window.addEventListener('ghostlink:toggle-help', handler);
    return () => window.removeEventListener('ghostlink:toggle-help', handler);
  }, []);

  // Session launcher toggle
  useEffect(() => {
    const handler = () => setShowSessionLauncher(prev => !prev);
    window.addEventListener('ghostlink:open-session-launcher', handler);
    return () => window.removeEventListener('ghostlink:open-session-launcher', handler);
  }, []);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme || 'dark');
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'light' ? '#f5f5fa' : '#08080f');
    }
  }, [theme]);

  useEffect(() => {
    api.getStatus().then((r) => setAgents(r.agents)).catch((e) => console.warn('Status fetch:', e.message || e));
    api.getJobs().then((r) => setJobs(r.jobs)).catch((e) => console.warn('Jobs fetch:', e.message || e));
    api.getRules().then((r) => setRules(r.rules)).catch((e) => console.warn('Rules fetch:', e.message || e));
    api.getChannels().then((r) =>
      setChannels(r.channels.map((name) => ({ name, unread: 0 })))
    ).catch((e) => console.warn('Channels fetch:', e.message || e));
    api.getSettings().then((s) => {
      updateSettings(s);
      if (s.agentSounds) SoundManager.setCustomSounds(s.agentSounds);
    }).catch((e) => console.warn('Settings fetch:', e.message || e));
  }, [setAgents, setJobs, setRules, setChannels, updateSettings]);

  useEffect(() => {
    let stale = false;
    api.getMessages(activeChannel).then((r) => {
      if (!stale) {
        setMessages(r.messages);
        clearUnread(activeChannel);
      }
    }).catch((e) => console.warn('Messages fetch:', e.message || e));
    return () => { stale = true; };
  }, [activeChannel, setMessages, clearUnread]);

  return (
    <div className="min-h-[100dvh] relative w-full">
      <div className="ambient-bg" />

      {/* Desktop sidebar (nav + channels only, no agents) */}
      <Sidebar />
      {/* Mobile header + drawer */}
      <MobileHeader />
      <MobileSidebar />

      <main
        role="main"
        aria-label="Chat area"
        className={`flex flex-col h-[100dvh] relative z-10 transition-all overflow-hidden ${
          sidebarPanel ? 'lg:ml-14 lg:mr-80' : 'lg:ml-14'
        }`}
      >
        {/* Top bar: agents + channels */}
        <header className="sticky top-0 z-20 glass max-lg:mt-14">
          {/* Agent bar — desktop only */}
          {showAgentBar && (
            <div className="hidden lg:flex items-center px-6 py-2.5 border-b border-outline-variant/6 w-full min-w-0">
              <div className="flex-1 min-w-0 overflow-hidden">
                <AgentBar />
              </div>
              <div className="ml-3 shrink-0">
                <Suspense fallback={<div className="flex items-center justify-center p-8"><span className="material-symbols-outlined animate-spin text-primary/40">progress_activity</span></div>}><RemoteSession /></Suspense>
              </div>
            </div>
          )}
          {/* Channel tabs */}
          {showChannelTabs && (
            <div className="hidden lg:block py-1.5 px-2 w-full">
              <ChannelTabs />
            </div>
          )}
        </header>
        {/* Remote session — mobile */}
        <div className="lg:hidden flex items-center justify-end px-4 py-1 border-b border-outline-variant/6">
          <Suspense fallback={<div className="flex items-center justify-center p-8"><span className="material-symbols-outlined animate-spin text-primary/40">progress_activity</span></div>}><RemoteSession /></Suspense>
        </div>
        {/* Mobile spacer for fixed header */}
        <div className="lg:hidden h-14" />
        {/* Session bar — shows during active sessions */}
        <SessionBar />

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 min-h-0 relative overflow-hidden">
            <ChatFeed />
            {showTypingIndicator && <TypingIndicator />}
            <ScrollArrow />
            <BulkDeleteBar />
            <div className="sticky bottom-0 z-20 input-float">
              <MessageInput />
            </div>
          </div>
          {/* Stats sidebar — only on wide screens when no right panel open */}
          {!sidebarPanel && showStatsPanel !== false && <StatsPanel />}
        </div>
      </main>

      <RightPanel />
      <MobilePanel />
      <AnimatePresence>
        {showCommandPalette && (
          <motion.div key="command-palette" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}>
            <Suspense fallback={<div className="flex items-center justify-center p-8"><span className="material-symbols-outlined animate-spin text-primary/40">progress_activity</span></div>}><CommandPalette onClose={() => setShowCommandPalette(false)} /></Suspense>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showSearch && (
          <motion.div key="search-modal" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}>
            <Suspense fallback={<div className="flex items-center justify-center p-8"><span className="material-symbols-outlined animate-spin text-primary/40">progress_activity</span></div>}><SearchModal onClose={() => setShowSearch(false)} /></Suspense>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showShortcuts && (
          <motion.div key="shortcuts-modal" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}>
            <Suspense fallback={<div className="flex items-center justify-center p-8"><span className="material-symbols-outlined animate-spin text-primary/40">progress_activity</span></div>}><KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} /></Suspense>
          </motion.div>
        )}
      </AnimatePresence>
      <ConnectionBanner />
      <Suspense fallback={<div className="flex items-center justify-center p-8"><span className="material-symbols-outlined animate-spin text-primary/40">progress_activity</span></div>}><FirstRunWizard /></Suspense>
      <Suspense fallback={<div className="flex items-center justify-center p-8"><span className="material-symbols-outlined animate-spin text-primary/40">progress_activity</span></div>}><OnboardingTour /></Suspense>
      <AnimatePresence>
        {showHelp && (
          <motion.div key="help-panel" initial={{ opacity: 0, x: 320 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 320 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
            <Suspense fallback={<div className="flex items-center justify-center p-8"><span className="material-symbols-outlined animate-spin text-primary/40">progress_activity</span></div>}><HelpPanel onClose={() => setShowHelp(false)} /></Suspense>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showSessionLauncher && (
          <motion.div key="session-launcher" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}>
            <Suspense fallback={<div className="flex items-center justify-center p-8"><span className="material-symbols-outlined animate-spin text-primary/40">progress_activity</span></div>}><SessionLauncher onClose={() => setShowSessionLauncher(false)} /></Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        <AppInner />
      </ErrorBoundary>
    </MotionConfig>
  );
}
