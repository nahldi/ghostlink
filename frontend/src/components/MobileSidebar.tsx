import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { AgentStatusPill } from './AgentStatusPill';
import { AddAgentModal } from './AddAgentModal';

export function MobileSidebar() {
  const mobileMenuOpen = useChatStore((s) => s.mobileMenuOpen);
  const setMobileMenuOpen = useChatStore((s) => s.setMobileMenuOpen);
  const agents = useChatStore((s) => s.agents);
  const channels = useChatStore((s) => s.channels);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const clearUnread = useChatStore((s) => s.clearUnread);
  const setSidebarPanel = useChatStore((s) => s.setSidebarPanel);
  const sidebarPanel = useChatStore((s) => s.sidebarPanel);
  const [showAddAgent, setShowAddAgent] = useState(false);

  return (
    <AnimatePresence>
      {mobileMenuOpen && (
    <>
      {showAddAgent && <AddAgentModal onClose={() => setShowAddAgent(false)} />}
      <motion.div
        className="lg:hidden fixed inset-0 z-[45] flex"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />

        <motion.aside
          className="relative w-[280px] h-full glass-strong flex flex-col pt-14 z-10 safe-top"
          initial={{ x: -280 }}
          animate={{ x: 0 }}
          exit={{ x: -280 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          drag="x"
          dragConstraints={{ left: -280, right: 0 }}
          dragElastic={0.1}
          onDragEnd={(_, info) => {
            if (info.offset.x < -60 || info.velocity.x < -200) {
              setMobileMenuOpen(false);
            }
          }}
        >
          {/* Quick nav */}
          <div className="px-3 py-3 flex gap-1 border-b border-outline-variant/8">
            {(['chat', 'jobs', 'rules', 'settings'] as const).map((id) => {
              const icons: Record<string, string> = { chat: 'chat_bubble', jobs: 'task_alt', rules: 'shield', settings: 'tune' };
              const isActive = id === 'chat' ? !sidebarPanel : sidebarPanel === id;
              return (
                <button
                  key={id}
                  onClick={() => {
                    setSidebarPanel(id === 'chat' ? null : id);
                    if (id === 'chat') setMobileMenuOpen(false);
                  }}
                  className={`flex-1 py-2 rounded-lg text-[10px] font-medium flex flex-col items-center gap-1 transition-all ${
                    isActive ? 'bg-primary/10 text-primary' : 'text-on-surface-variant/40'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">{icons[id]}</span>
                  {id.charAt(0).toUpperCase() + id.slice(1)}
                </button>
              );
            })}
          </div>

          {/* Channels */}
          <div className="px-3 pt-4 pb-2">
            <div className="px-2 mb-2 text-[10px] font-semibold text-on-surface-variant/40 uppercase tracking-wider">
              Channels
            </div>
            <div className="space-y-0.5">
              {channels.map((ch) => (
                <button
                  key={ch.name}
                  onClick={() => {
                    setActiveChannel(ch.name);
                    clearUnread(ch.name);
                    setSidebarPanel(null);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all ${
                    activeChannel === ch.name
                      ? 'channel-active text-primary font-semibold'
                      : 'text-on-surface-variant/50 active:bg-surface-container-high/30'
                  }`}
                >
                  <span><span className="opacity-40">#</span> {ch.name}</span>
                  {ch.unread > 0 && (
                    <span className="min-w-[20px] h-5 rounded-full bg-secondary/20 text-secondary text-[10px] font-bold flex items-center justify-center px-1.5">
                      {ch.unread > 9 ? '9+' : ch.unread}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Agents */}
          <div className="flex-1 overflow-y-auto px-3 pt-2">
            <div className="px-2 mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-on-surface-variant/40 uppercase tracking-wider">
                Agents
              </span>
              <button
                onClick={() => setShowAddAgent(true)}
                className="w-6 h-6 rounded-lg flex items-center justify-center text-on-surface-variant/30 active:bg-primary/10"
              >
                <span className="material-symbols-outlined text-sm">add</span>
              </button>
            </div>
            <div className="space-y-0.5">
              {agents.length === 0 && (
                <button
                  onClick={() => setShowAddAgent(true)}
                  className="w-full text-left px-3 py-2 rounded-lg text-on-surface-variant/25 text-[11px] hover:bg-primary/5 transition-colors"
                >
                  No agents running — tap + to launch one
                </button>
              )}
              {agents.map((agent) => (
                <AgentStatusPill key={agent.name} agent={agent} />
              ))}
            </div>
          </div>
        </motion.aside>
      </motion.div>
    </>
      )}
    </AnimatePresence>
  );
}
