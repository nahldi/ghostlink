import { useEffect, useRef } from 'react';
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
import { JobsPanel } from './components/JobsPanel';
import { RulesPanel } from './components/RulesPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { StatsPanel } from './components/StatsPanel';

function ChatFeed() {
  const messages = useChatStore((s) => s.messages);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const feedRef = useRef<HTMLDivElement>(null);
  const channelMessages = messages.filter((m) => m.channel === activeChannel);

  const atBottom = useChatStore((s) => s.chatAtBottom);
  const setChatAtBottom = useChatStore((s) => s.setChatAtBottom);
  const setNewMsgCount = useChatStore((s) => s.setNewMsgCount);
  const prevMsgCount = useRef(0);

  const scrollToBottom = () => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
      setNewMsgCount(0);
      setChatAtBottom(true);
    }
  };

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
  }, [channelMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    requestAnimationFrame(() => scrollToBottom());
    prevMsgCount.current = channelMessages.length;
  }, [activeChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={feedRef} onScroll={handleScroll} onWheel={handleScroll} data-chat-feed className="flex-1 overflow-y-auto overflow-x-hidden py-3 relative min-h-0">
      <div className="px-4 lg:px-6">
      {channelMessages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-center opacity-30">
          <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 mb-3">
            <path d="M12 2L14.5 8.5L21 11L14.5 13.5L12 20L9.5 13.5L3 11L9.5 8.5L12 2Z" fill="#a78bfa" opacity="0.5" />
          </svg>
          <div className="text-xs text-on-surface-variant/40">
            #{activeChannel} — waiting for messages
          </div>
        </div>
      ) : (
        channelMessages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
      )}
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
  if (!panel) return null;
  return (
    <aside className="w-80 h-screen glass-strong fixed right-0 top-0 z-30 max-lg:hidden">
      {panel === 'jobs' && <JobsPanel />}
      {panel === 'rules' && <RulesPanel />}
      {panel === 'settings' && <SettingsPanel />}
    </aside>
  );
}

function MobilePanel() {
  const panel = useChatStore((s) => s.sidebarPanel);
  if (!panel) return null;
  return (
    <div className="lg:hidden fixed inset-0 z-50 bg-surface/95 backdrop-blur-xl overflow-y-auto pt-14">
      <button
        onClick={() => useChatStore.getState().setSidebarPanel(null)}
        className="absolute top-3 right-3 p-2 rounded-lg hover:bg-surface-container-high text-on-surface-variant/40"
      >
        <span className="material-symbols-outlined">close</span>
      </button>
      {panel === 'jobs' && <JobsPanel />}
      {panel === 'rules' && <RulesPanel />}
      {panel === 'settings' && <SettingsPanel />}
    </div>
  );
}

import { Component, type ReactNode } from 'react';

class ErrorBoundary extends Component<{children: ReactNode}, {error: Error | null}> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding: 40, color: '#e0dff0', background: '#08080f', minHeight: '100vh', fontFamily: 'Inter, sans-serif'}}>
          <h1 style={{color: '#a78bfa', marginBottom: 16, fontSize: 20}}>AI Chattr</h1>
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

  useWebSocket();

  // Apply font size to root
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  // Apply title to document
  useEffect(() => {
    document.title = title || 'AI Chattr';
  }, [title]);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme || 'dark');
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'light' ? '#f5f5fa' : '#08080f');
    }
  }, [theme]);

  useEffect(() => {
    api.getStatus().then((r) => setAgents(r.agents)).catch(() => {});
    api.getJobs().then((r) => setJobs(r.jobs)).catch(() => {});
    api.getRules().then((r) => setRules(r.rules)).catch(() => {});
    api.getChannels().then((r) =>
      setChannels(r.channels.map((name) => ({ name, unread: 0 })))
    ).catch(() => {});
    api.getSettings().then((s) => updateSettings(s)).catch(() => {});
  }, [setAgents, setJobs, setRules, setChannels, updateSettings]);

  useEffect(() => {
    api.getMessages(activeChannel).then((r) => {
      setMessages(r.messages);
      clearUnread(activeChannel);
    }).catch(() => {});
  }, [activeChannel, setMessages, clearUnread]);

  return (
    <div className="min-h-screen relative w-full">
      <div className="ambient-bg" />

      {/* Desktop sidebar (nav + channels only, no agents) */}
      <Sidebar />
      {/* Mobile header + drawer */}
      <MobileHeader />
      <MobileSidebar />

      <main
        className={`flex flex-col h-screen relative z-10 transition-all overflow-hidden ${
          sidebarPanel ? 'lg:ml-56 lg:mr-80' : 'lg:ml-56'
        }`}
        style={{ width: '100%' }}
      >
        {/* Top bar: agents + channels */}
        <header className="sticky top-0 z-20 glass max-lg:mt-14">
          {/* Agent bar — desktop only */}
          <div className="hidden lg:flex items-center px-6 py-2.5 border-b border-outline-variant/6 w-full">
            <AgentBar />
          </div>
          {/* Channel tabs */}
          <div className="hidden lg:block py-1.5 px-2 w-full">
            <ChannelTabs />
          </div>
        </header>
        {/* Mobile spacer for fixed header */}
        <div className="lg:hidden h-14" />

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
            <ChatFeed />
            <TypingIndicator />
            <ScrollArrow />
            <div className="sticky bottom-0 z-20 input-float">
              <MessageInput />
            </div>
          </div>
          {/* Stats sidebar — only on wide screens when no right panel open */}
          {!sidebarPanel && <StatsPanel />}
        </div>
      </main>

      <RightPanel />
      <MobilePanel />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
