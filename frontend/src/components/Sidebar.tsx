import { useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';

type PanelId = 'jobs' | 'rules' | 'settings';

const NAV_ITEMS: { icon: string; label: string; id: 'chat' | PanelId }[] = [
  { icon: 'chat_bubble', label: 'Chat', id: 'chat' },
  { icon: 'task_alt', label: 'Jobs', id: 'jobs' },
  { icon: 'shield', label: 'Rules', id: 'rules' },
  { icon: 'tune', label: 'Settings', id: 'settings' },
];

export function Sidebar() {
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const sidebarPanel = useChatStore((s) => s.sidebarPanel);
  const setSidebarPanel = useChatStore((s) => s.setSidebarPanel);
  const channels = useChatStore((s) => s.channels);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const clearUnread = useChatStore((s) => s.clearUnread);
  const settings = useChatStore((s) => s.settings);

  const handleCreateChannel = async () => {
    const name = newChannelName.trim().toLowerCase();
    if (!name) return;
    try {
      await api.createChannel(name);
      setNewChannelName('');
      setCreatingChannel(false);
    } catch {
      // channel may already exist or invalid name
    }
  };

  return (
    <aside className="w-56 h-screen flex flex-col glass-strong fixed left-0 top-0 z-30 max-lg:hidden">
      {/* Brand */}
      <div className="px-4 py-4 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{
          background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
          boxShadow: '0 0 16px rgba(124, 58, 237, 0.25)',
        }}>
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
            <path d="M12 2L14.5 8.5L21 11L14.5 13.5L12 20L9.5 13.5L3 11L9.5 8.5L12 2Z" fill="white" />
          </svg>
        </div>
        <div>
          <div className="text-[13px] font-semibold text-on-surface tracking-tight">{settings.title}</div>
          <div className="text-[9px] text-on-surface-variant/40 font-medium">Command Center</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="px-2 space-y-0.5 mb-3">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === 'chat' ? sidebarPanel === null : sidebarPanel === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setSidebarPanel(item.id === 'chat' ? null : item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-on-surface-variant/50 hover:text-on-surface-variant hover:bg-surface-container-high/30'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mx-4 h-px bg-outline-variant/8 mb-3" />

      {/* Channels */}
      <div className="flex-1 overflow-y-auto px-2">
        <div className="flex items-center justify-between px-3 mb-2">
          <span className="text-[9px] font-semibold text-on-surface-variant/35 uppercase tracking-wider">
            Channels
          </span>
          <button
            onClick={() => setCreatingChannel(!creatingChannel)}
            className="w-4 h-4 rounded flex items-center justify-center text-on-surface-variant/30 hover:text-on-surface-variant/60 hover:bg-surface-container-high/30 transition-colors"
            title="Create channel"
          >
            <span className="material-symbols-outlined text-[14px]">{creatingChannel ? 'close' : 'add'}</span>
          </button>
        </div>
        {creatingChannel && (
          <div className="px-2 mb-1">
            <input
              type="text"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value.replace(/[^a-z0-9-]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateChannel();
                if (e.key === 'Escape') { setCreatingChannel(false); setNewChannelName(''); }
              }}
              placeholder="channel-name"
              maxLength={20}
              autoFocus
              className="w-full px-2 py-1 text-xs bg-surface-container/60 border border-outline-variant/15 rounded-md text-on-surface placeholder:text-on-surface-variant/25 outline-none focus:border-primary/30"
            />
          </div>
        )}
        <div className="space-y-0.5">
          {channels.map((ch) => (
            <button
              key={ch.name}
              onClick={() => {
                setActiveChannel(ch.name);
                clearUnread(ch.name);
                setSidebarPanel(null);
              }}
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-all ${
                activeChannel === ch.name
                  ? 'channel-active text-primary font-semibold'
                  : 'text-on-surface-variant/40 hover:text-on-surface-variant/60 hover:bg-surface-container-high/20'
              }`}
            >
              <span><span className="opacity-40">#</span> {ch.name}</span>
              {ch.unread > 0 && (
                <span className="min-w-[16px] h-4 rounded-full bg-secondary/20 text-secondary text-[9px] font-bold flex items-center justify-center px-1">
                  {ch.unread > 9 ? '9+' : ch.unread}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* User */}
      <div className="px-3 py-3 border-t border-outline-variant/5 flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-full bg-surface-container-highest/50 flex items-center justify-center">
          <span className="material-symbols-outlined text-on-surface-variant/40 text-[14px]">person</span>
        </div>
        <span className="text-[11px] font-medium text-on-surface-variant/50">{settings.username}</span>
      </div>
    </aside>
  );
}
