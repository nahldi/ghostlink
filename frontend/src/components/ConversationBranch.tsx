/**
 * Conversation Branching — fork conversations to explore different approaches.
 * Branch from any message to create an alternate thread without losing the main conversation.
 */
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { toast } from './Toast';
import type { Message } from '../types';

interface Branch {
  id: string;
  name: string;
  parent_channel: string;
  fork_message_id: number;
  fork_message_text: string;
  message_count: number;
  created_at: number;
  last_activity?: number;
}

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

// Branch creation modal — shown when user clicks "Branch" on a message
export function BranchFromMessage({ message, onClose }: { message: Message; onClose: () => void }) {
  const [name, setName] = useState(`Branch from "${message.text.slice(0, 30)}${message.text.length > 30 ? '...' : ''}"`);
  const [creating, setCreating] = useState(false);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          parent_channel: activeChannel,
          fork_message_id: message.id,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast('Branch created', 'success');
        // Switch to the new branch channel
        if (data.channel) {
          setActiveChannel(data.channel);
        }
        onClose();
      } else {
        toast('Failed to create branch', 'error');
      }
    } catch {
      toast('Failed to create branch', 'error');
    }
    setCreating(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-[400px] max-w-[92vw] rounded-2xl border border-outline-variant/15 p-4 space-y-3"
        style={{ background: 'rgba(10, 10, 18, 0.98)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">fork_right</span>
          <h3 className="text-sm font-semibold text-on-surface/80">Branch Conversation</h3>
        </div>

        {/* Fork point preview */}
        <div className="px-3 py-2 rounded-lg bg-surface-container-high/30 border border-outline-variant/10">
          <p className="text-[9px] text-on-surface-variant/40 mb-1">Branching from:</p>
          <p className="text-[11px] text-on-surface/60 line-clamp-2">{message.text}</p>
          <p className="text-[9px] text-on-surface-variant/25 mt-1">{message.sender} · {timeAgo(message.timestamp)}</p>
        </div>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="Branch name..."
          className="w-full bg-surface-container rounded-lg px-3 py-2 text-xs text-on-surface outline-none border border-outline-variant/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
          autoFocus
        />

        <p className="text-[9px] text-on-surface-variant/30">
          Messages up to this point will be copied into the new branch. The original conversation stays unchanged.
        </p>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg text-[11px] font-medium text-on-surface-variant/50 hover:bg-surface-container-high transition-colors">
            Cancel
          </button>
          <button
            onClick={create}
            disabled={creating || !name.trim()}
            className="flex-1 px-3 py-2 rounded-lg text-[11px] font-medium bg-primary text-on-primary hover:brightness-110 transition-all disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Branch'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// Branch list panel — shows all branches for current channel
export function BranchList({ channel, onClose }: { channel: string; onClose: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`/api/branches?channel=${encodeURIComponent(channel)}`);
      if (res.ok) {
        const data = await res.json();
        setBranches(data.branches || []);
      }
    } catch { /* ignored */ }
    setLoading(false);
  }, [channel]);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  const deleteBranch = async (id: string) => {
    try {
      const res = await fetch(`/api/branches/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setBranches(prev => prev.filter(b => b.id !== id));
        toast('Branch deleted', 'info');
      }
    } catch { /* ignored */ }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-[440px] max-w-[92vw] max-h-[70vh] rounded-2xl border border-outline-variant/15 overflow-hidden flex flex-col"
        style={{ background: 'rgba(10, 10, 18, 0.98)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-outline-variant/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">fork_right</span>
            <h3 className="text-sm font-semibold text-on-surface/80">Branches</h3>
            <span className="text-[9px] text-on-surface-variant/30">#{channel}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-container-high text-on-surface-variant/40">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="py-2 space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-lg skeleton-shimmer" />
                  <div className="flex-1 space-y-1">
                    <div className="w-2/3 h-3 rounded skeleton-shimmer" />
                    <div className="w-1/3 h-2 rounded skeleton-shimmer" />
                  </div>
                </div>
              ))}
            </div>
          ) : branches.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-8">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                <span className="material-symbols-outlined text-xl text-primary/30">fork_right</span>
              </div>
              <div className="text-center space-y-1">
                <p className="text-xs font-medium text-on-surface-variant/50">No branches</p>
                <p className="text-[10px] text-on-surface-variant/30 max-w-[200px]">
                  Right-click or long-press a message and select "Branch" to explore an alternate approach
                </p>
              </div>
            </div>
          ) : (
            <div className="py-1">
              {branches.map((b) => (
                <div key={b.id} className="px-4 py-3 flex items-start gap-3 hover:bg-surface-container-high/30 transition-colors group border-b border-outline-variant/5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[16px] text-primary">fork_right</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => { setActiveChannel(b.id); onClose(); }}
                      className="text-[11px] text-on-surface/70 font-medium truncate block hover:text-primary transition-colors text-left w-full"
                    >
                      {b.name}
                    </button>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-on-surface-variant/30">{b.message_count} messages</span>
                      <span className="text-[9px] text-on-surface-variant/20">{timeAgo(b.last_activity || b.created_at)}</span>
                    </div>
                    <p className="text-[9px] text-on-surface-variant/25 mt-0.5 truncate italic">
                      Fork: "{b.fork_message_text}"
                    </p>
                  </div>
                  <button
                    onClick={() => deleteBranch(b.id)}
                    className="p-0.5 rounded hover:bg-red-500/10 text-on-surface-variant/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
