import { useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';

type PanelId = 'jobs' | 'rules' | 'settings';

export function Sidebar() {
  const sidebarPanel = useChatStore((s) => s.sidebarPanel);
  const setSidebarPanel = useChatStore((s) => s.setSidebarPanel);
  const channels = useChatStore((s) => s.channels);
  const setChannels = useChatStore((s) => s.setChannels);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const clearUnread = useChatStore((s) => s.clearUnread);
  const settings = useChatStore((s) => s.settings);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleCreate = async () => {
    const name = newName.trim().toLowerCase();
    if (!name) return;
    try {
      const r = await api.createChannel(name) as { channels: string[] };
      setChannels(r.channels.map((n: string) => ({ name: n, unread: 0 })));
      setNewName(''); setAdding(false);
    } catch {}
  };

  const handleDelete = async (name: string) => {
    if (name === 'general') return;
    try {
      const r = await api.deleteChannel(name) as { channels: string[] };
      setChannels(r.channels.map((n: string) => ({ name: n, unread: 0 })));
      if (activeChannel === name) setActiveChannel('general');
    } catch {}
    setContextMenu(null);
  };

  const handleRename = async (oldName: string) => {
    const name = editName.trim().toLowerCase();
    if (!name || name === oldName) { setEditingChannel(null); return; }
    try {
      const r = await api.renameChannel(oldName, name) as { channels: string[] };
      setChannels(r.channels.map((n: string) => ({ name: n, unread: 0 })));
      if (activeChannel === oldName) setActiveChannel(name);
    } catch {}
    setEditingChannel(null);
  };


  const navItems: { icon: string; id: 'chat' | PanelId; tip: string }[] = [
    { icon: 'chat_bubble', id: 'chat', tip: 'Chat' },
    { icon: 'task_alt', id: 'jobs', tip: 'Jobs' },
    { icon: 'shield', id: 'rules', tip: 'Rules' },
    { icon: 'tune', id: 'settings', tip: 'Settings' },
  ];

  return (
    <>
      {/* Context menu */}
      {contextMenu && (
        <div className="fixed inset-0 z-[60]" onClick={() => setContextMenu(null)}>
          <div className="absolute rounded-xl p-1 min-w-[140px]" style={{
            left: contextMenu.x, top: contextMenu.y,
            background: 'rgba(14, 14, 22, 0.98)', border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}>
            <button onClick={() => { setEditingChannel(contextMenu.name); setEditName(contextMenu.name); setContextMenu(null); setExpanded(true); }}
              className="w-full text-left px-3 py-2 text-xs text-white/60 hover:bg-white/5 rounded-lg flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px]">edit</span> Rename
            </button>
            <button onClick={() => handleDelete(contextMenu.name)}
              className="w-full text-left px-3 py-2 text-xs text-red-400/70 hover:bg-red-400/10 rounded-lg flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px]">delete</span> Delete
            </button>
          </div>
        </div>
      )}

      {/* Thin icon rail — always visible */}
      <div className="sidebar-rail w-14 h-screen fixed left-0 top-0 z-30 max-lg:hidden flex flex-col items-center py-3 gap-1" style={{
        background: '#0a0a10',
        borderRight: '1px solid rgba(255,255,255,0.03)',
      }}>
        {/* Logo — toggles channel/nav panel */}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 cursor-pointer hover:scale-105 transition-transform"
          onClick={() => setExpanded(!expanded)}
          title="Channels & Navigation"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #a78bfa)', boxShadow: '0 0 16px rgba(124,58,237,0.3)' }}
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
            <path d="M12 2L14.5 8.5L21 11L14.5 13.5L12 20L9.5 13.5L3 11L9.5 8.5L12 2Z" fill="white" />
          </svg>
        </div>

        {/* Nav icons */}
        {navItems.map((item) => {
          const isActive = item.id === 'chat' ? sidebarPanel === null : sidebarPanel === item.id;
          return (
            <button key={item.id} title={item.tip}
              onClick={() => setSidebarPanel(item.id === 'chat' ? null : item.id)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                isActive ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/50 hover:bg-white/5'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
            </button>
          );
        })}

        <div className="flex-1" />

        {/* Search */}
        <button title="Search (Ctrl+K)"
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white/45 hover:text-white/60 hover:bg-white/5 transition-all"
        >
          <span className="material-symbols-outlined text-[20px]">search</span>
        </button>

        {/* User */}
        <div className="w-8 h-8 rounded-full bg-white/6 flex items-center justify-center mt-1" title={settings.username}>
          <span className="material-symbols-outlined text-white/45 text-[16px]">person</span>
        </div>
      </div>

      {/* Expandable channel panel — slides out from rail */}
      {expanded && (
        <div className="fixed inset-0 z-[29]" onClick={() => setExpanded(false)}>
          <div className="sidebar-panel fixed left-14 top-0 h-screen w-[200px] z-[31] py-3 overflow-y-auto" style={{
            background: '#0d0d15',
            borderRight: '1px solid rgba(255,255,255,0.04)',
            boxShadow: '4px 0 20px rgba(0,0,0,0.3)',
          }} onClick={e => e.stopPropagation()}>
            <div className="px-4 mb-3 flex items-center justify-between">
              <span className="text-[11px] font-bold text-white/45 uppercase tracking-wider">Channels</span>
              <button onClick={() => setAdding(!adding)} className="text-white/45 hover:text-white/50 transition-colors">
                <span className="material-symbols-outlined text-[16px]">{adding ? 'close' : 'add'}</span>
              </button>
            </div>

            {adding && (
              <div className="px-3 mb-2 flex gap-1">
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setAdding(false); }}
                  placeholder="name" autoFocus
                  className="flex-1 bg-white/5 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-white/30 outline-none border border-white/5 focus:border-purple-500/30" />
                <button onClick={handleCreate} className="px-2 rounded-lg bg-purple-500/20 text-purple-300 text-[10px]">+</button>
              </div>
            )}

            <div className="px-2 space-y-0.5">
              {channels.map((ch) => (
                <div key={ch.name} onContextMenu={(e) => { e.preventDefault(); if (ch.name !== 'general') setContextMenu({ name: ch.name, x: e.clientX, y: e.clientY }); }}>
                  {editingChannel === ch.name ? (
                    <div className="flex gap-1 px-1">
                      <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRename(ch.name); if (e.key === 'Escape') setEditingChannel(null); }}
                        autoFocus className="flex-1 bg-white/5 rounded-lg px-2 py-1 text-xs text-white outline-none border border-purple-500/30" />
                    </div>
                  ) : (
                    <button
                      onClick={() => { setActiveChannel(ch.name); clearUnread(ch.name); setSidebarPanel(null); setExpanded(false); }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] transition-all ${
                        activeChannel === ch.name
                          ? 'bg-purple-500/15 text-purple-300 font-semibold'
                          : 'text-white/45 hover:text-white/60 hover:bg-white/4'
                      }`}>
                      <span><span className="text-white/30 mr-1">#</span>{ch.name}</span>
                      {ch.unread > 0 && (
                        <span className="min-w-[16px] h-4 rounded-full bg-blue-500/25 text-blue-300 text-[9px] font-bold flex items-center justify-center px-1">
                          {ch.unread > 9 ? '9+' : ch.unread}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
