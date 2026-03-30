/**
 * Checkpoint Panel — save and restore workspace snapshots.
 * Accessible from the cockpit as a sub-panel or from command palette.
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from './Toast';
import type { Agent } from '../types';

interface Checkpoint {
  id: string;
  agent: string;
  label: string;
  timestamp: number;
  file_count: number;
  size_bytes: number;
  workspace: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function CheckpointPanel({ agent }: { agent: Agent }) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const fetchCheckpoints = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/checkpoints`);
      if (res.ok) {
        const data = await res.json();
        setCheckpoints(data.checkpoints || []);
      }
    } catch { /* ignored */ }
    setLoading(false);
  }, [agent.name]);

  useEffect(() => {
    // Intentional initialization sync: clear stale checkpoint state before fetching fresh data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setCheckpoints([]);
    fetchCheckpoints();
  }, [fetchCheckpoints]);

  const createCheckpoint = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/checkpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || `Checkpoint ${new Date().toLocaleTimeString()}` }),
      });
      if (res.ok) {
        toast('Checkpoint saved', 'success');
        setLabel('');
        setShowCreate(false);
        fetchCheckpoints();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        toast(err.error || 'Failed to create checkpoint', 'error');
      }
    } catch {
      toast('Failed to create checkpoint', 'error');
    }
    setCreating(false);
  };

  const restoreCheckpoint = async (id: string) => {
    if (restoring) return;
    setRestoring(id);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/checkpoints/${id}/restore`, {
        method: 'POST',
      });
      if (res.ok) {
        toast('Workspace restored to checkpoint', 'success');
        fetchCheckpoints();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        toast(err.error || 'Restore failed', 'error');
      }
    } catch {
      toast('Restore failed', 'error');
    }
    setRestoring(null);
  };

  const deleteCheckpoint = async (id: string) => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/checkpoints/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setCheckpoints(prev => prev.filter(c => c.id !== id));
        toast('Checkpoint deleted', 'info');
      }
    } catch { /* ignored */ }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-outline-variant/10 shrink-0">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm" style={{ color: agent.color }}>save</span>
          <span className="text-[11px] font-medium text-on-surface/70">Checkpoints</span>
          <span className="text-[9px] text-on-surface-variant/30">{checkpoints.length}</span>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          Save
        </button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-outline-variant/5 flex gap-2">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createCheckpoint()}
                placeholder="Checkpoint label (optional)..."
                className="flex-1 bg-surface-container rounded-lg px-2.5 py-1.5 text-[10px] text-on-surface outline-none border border-outline-variant/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
                autoFocus
              />
              <button
                onClick={createCheckpoint}
                disabled={creating}
                className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-primary text-on-primary hover:brightness-110 transition-all disabled:opacity-50"
              >
                {creating ? 'Saving...' : 'Save'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Checkpoint list */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-2 space-y-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2">
                <div className="w-8 h-8 rounded-lg skeleton-shimmer" />
                <div className="flex-1 space-y-1">
                  <div className="w-2/3 h-2.5 rounded skeleton-shimmer" />
                  <div className="w-1/3 h-2 rounded skeleton-shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : checkpoints.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 py-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-primary/30">save</span>
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs font-medium text-on-surface-variant/50">No checkpoints yet</p>
              <p className="text-[10px] text-on-surface-variant/30 leading-relaxed max-w-[180px]">
                Save a checkpoint to capture the current workspace state. Restore anytime.
              </p>
            </div>
          </div>
        ) : (
          <div className="py-1">
            {checkpoints.map((cp) => (
              <div
                key={cp.id}
                className="px-3 py-2.5 flex items-start gap-2.5 hover:bg-surface-container-high/30 transition-colors group"
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${agent.color}10` }}>
                  <span className="material-symbols-outlined text-[16px]" style={{ color: agent.color }}>save</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-on-surface/70 font-medium truncate">{cp.label}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] text-on-surface-variant/30">{timeAgo(cp.timestamp)}</span>
                    <span className="text-[9px] text-on-surface-variant/20">{cp.file_count} files</span>
                    <span className="text-[9px] text-on-surface-variant/20">{formatSize(cp.size_bytes)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => restoreCheckpoint(cp.id)}
                    disabled={restoring === cp.id}
                    className="p-1 rounded hover:bg-primary/15 text-primary/50 hover:text-primary transition-colors disabled:opacity-30"
                    title="Restore this checkpoint"
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {restoring === cp.id ? 'hourglass_empty' : 'restore'}
                    </span>
                  </button>
                  <button
                    onClick={() => deleteCheckpoint(cp.id)}
                    className="p-1 rounded hover:bg-red-500/10 text-on-surface-variant/30 hover:text-red-400 transition-colors"
                    title="Delete checkpoint"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
