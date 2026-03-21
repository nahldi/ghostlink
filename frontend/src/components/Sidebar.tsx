import { useState, useMemo } from 'react';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import type { Agent } from '../types';

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
  const agents = useChatStore((s) => s.agents);

  // Build hierarchy tree: managers -> workers, plus standalone agents
  const { managers, standalone } = useMemo(() => {
    const mgrs: (Agent & { workers: Agent[] })[] = [];
    const solo: Agent[] = [];
    const workerNames = new Set<string>();

    // First pass: find managers and their workers
    agents.forEach(a => {
      if (a.role === 'manager') {
        const workers = agents.filter(w => w.parent === a.name);
        workers.forEach(w => workerNames.add(w.name));
        mgrs.push({ ...a, workers });
      }
    });

    // Second pass: standalone agents (not managers, not workers)
    agents.forEach(a => {
      if (a.role !== 'manager' && !workerNames.has(a.name)) {
        solo.push(a);
      }
    });

    return { managers: mgrs, standalone: solo };
  }, [agents]);

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
          <img src="/ghostlink.png" alt="GhostLink" className="w-6 h-6 object-contain" style={{ filter: 'invert(1)' }} />
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
              <div className="flex items-center gap-1">
                <button onClick={() => setAdding(!adding)} className="text-white/45 hover:text-white/50 transition-colors">
                  <span className="material-symbols-outlined text-[16px]">{adding ? 'close' : 'add'}</span>
                </button>
                <button onClick={() => setExpanded(false)} className="text-white/45 hover:text-white/60 transition-colors" title="Close panel">
                  <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                </button>
              </div>
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

            {/* Agent hierarchy */}
            {agents.length > 0 && (
              <div className="mt-4">
                <div className="px-4 mb-2">
                  <span className="text-[11px] font-bold text-white/45 uppercase tracking-wider">Agents</span>
                </div>
                <div className="px-2 space-y-0.5">
                  {/* Managers with their workers */}
                  {managers.map(mgr => (
                    <div key={mgr.name}>
                      <SidebarAgentRow agent={mgr} badge="MGR" badgeColor="text-yellow-400 bg-yellow-500/20" extra={mgr.workers.length > 0 ? `${mgr.workers.length} worker${mgr.workers.length > 1 ? 's' : ''}` : undefined} />
                      {mgr.workers.map(w => (
                        <div key={w.name} className="pl-4">
                          <SidebarAgentRow agent={w} badge="WKR" badgeColor="text-blue-400 bg-blue-500/20" />
                        </div>
                      ))}
                    </div>
                  ))}
                  {/* Standalone agents */}
                  {standalone.map(a => (
                    <SidebarAgentRow key={a.name} agent={a} badge={a.role === 'peer' ? 'PEER' : undefined} badgeColor="text-purple-400 bg-purple-500/20" />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function SidebarAgentRow({ agent, badge, badgeColor, extra }: { agent: Agent; badge?: string; badgeColor?: string; extra?: string }) {
  const isOn = agent.state === 'active' || agent.state === 'thinking' || agent.state === 'idle';
  const isPaused = agent.state === 'paused';
  const isThinking = agent.state === 'thinking';
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[12px] hover:bg-white/4 transition-all group">
      <div
        className={`w-2 h-2 rounded-full shrink-0 ${isThinking ? 'animate-pulse' : ''}`}
        style={{
          backgroundColor: isThinking ? agent.color : isOn ? '#4ade80' : isPaused ? '#fb923c' : '#3a3548',
          boxShadow: isOn ? `0 0 6px ${isThinking ? agent.color : '#4ade80'}50` : 'none',
        }}
      />
      <span className="flex-1 truncate" style={{ color: isOn ? agent.color : 'rgba(255,255,255,0.35)' }}>
        {agent.label}
      </span>
      {badge && (
        <span className={`text-[7px] font-bold px-1 py-px rounded leading-none uppercase ${badgeColor || ''}`}>
          {badge}
        </span>
      )}
      {extra && (
        <span className="text-[9px] text-white/25">{extra}</span>
      )}
      <span className={`text-[9px] font-medium ${
        isThinking ? 'text-yellow-400' : isOn ? 'text-green-400/50' : isPaused ? 'text-orange-400/50' : 'text-white/20'
      }`}>
        {isThinking ? 'Thinking' : isOn ? 'Online' : isPaused ? 'Paused' : 'Offline'}
      </span>
    </div>
  );
}
