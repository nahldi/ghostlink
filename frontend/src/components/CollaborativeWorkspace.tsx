/**
 * Collaborative Workspace — multi-user presence and shared agent sessions.
 * Shows who's online, what they're looking at, and enables real-time collaboration.
 */
import { useState, useEffect } from 'react';
// framer-motion available for future animations
import { toast } from './Toast';

interface Collaborator {
  id: string;
  username: string;
  color: string;
  avatar?: string;
  status: 'active' | 'idle' | 'away';
  viewing?: string; // channel or cockpit agent
  cursor?: { channel: string; messageId?: number };
  joined_at: number;
}

interface WorkspaceInvite {
  id: string;
  code: string;
  expires_at: number;
  uses: number;
  max_uses: number;
}

const STATUS_COLORS = {
  active: '#22c55e',
  idle: '#fb923c',
  away: '#6b7280',
};

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function CollaborativeWorkspace() {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingInvite, setCreatingInvite] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/workspace/collaborators').then(r => r.ok ? r.json() : { collaborators: [] }),
      fetch('/api/workspace/invites').then(r => r.ok ? r.json() : { invites: [] }),
    ]).then(([collabData, inviteData]) => {
      if (cancelled) return;
      setCollaborators(collabData.collaborators || []);
      setInvites(inviteData.invites || []);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const createInvite = async () => {
    setCreatingInvite(true);
    try {
      const res = await fetch('/api/workspace/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_uses: 5, expires_hours: 24 }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.invite) {
          setInvites(prev => [...prev, data.invite]);
          navigator.clipboard?.writeText(data.invite.code).then(() => toast('Invite code copied!', 'success'));
        }
      }
    } catch { toast('Failed to create invite', 'error'); }
    setCreatingInvite(false);
  };

  const revokeInvite = async (id: string) => {
    try {
      await fetch(`/api/workspace/invites/${id}`, { method: 'DELETE' });
      setInvites(prev => prev.filter(i => i.id !== id));
      toast('Invite revoked', 'info');
    } catch { /* ignored */ }
  };

  const activeCount = collaborators.filter(c => c.status === 'active').length;

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-outline-variant/10 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-on-surface/80">Workspace</h2>
            <p className="text-[10px] text-on-surface-variant/30 mt-0.5">
              {activeCount > 0 ? `${activeCount} collaborator${activeCount > 1 ? 's' : ''} online` : 'Solo session'}
            </p>
          </div>
          <button onClick={createInvite} disabled={creatingInvite}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50">
            <span className="material-symbols-outlined text-[16px]">person_add</span>
            Invite
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-2 space-y-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-full skeleton-shimmer" />
                <div className="flex-1 space-y-1">
                  <div className="w-1/3 h-3 rounded skeleton-shimmer" />
                  <div className="w-1/4 h-2 rounded skeleton-shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Collaborators */}
            {collaborators.length > 0 && (
              <div className="py-2">
                <div className="px-4 py-1.5">
                  <span className="text-[9px] font-semibold text-on-surface-variant/25 uppercase tracking-wider">Online</span>
                </div>
                {collaborators.map(c => (
                  <div key={c.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-surface-container-high/30 transition-colors">
                    <div className="relative">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: c.color }}>
                        {c.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface"
                        style={{ background: STATUS_COLORS[c.status] }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-on-surface/70 font-medium">{c.username}</p>
                      <p className="text-[9px] text-on-surface-variant/30">
                        {c.viewing ? `Viewing ${c.viewing}` : c.status === 'active' ? 'Active' : c.status === 'idle' ? 'Idle' : 'Away'}
                        {' · '}{timeAgo(c.joined_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Solo state */}
            {collaborators.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-4 px-6 py-8">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl text-primary/30">groups</span>
                </div>
                <div className="text-center space-y-1.5">
                  <p className="text-xs font-medium text-on-surface-variant/50">Solo workspace</p>
                  <p className="text-[10px] text-on-surface-variant/30 leading-relaxed max-w-[200px]">
                    Invite collaborators to work with your agents together in real-time
                  </p>
                </div>
              </div>
            )}

            {/* Invites */}
            {invites.length > 0 && (
              <div className="py-2 border-t border-outline-variant/5">
                <div className="px-4 py-1.5">
                  <span className="text-[9px] font-semibold text-on-surface-variant/25 uppercase tracking-wider">Active Invites</span>
                </div>
                {invites.map(inv => (
                  <div key={inv.id} className="px-4 py-2 flex items-center gap-3 group">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant/30">link</span>
                    <div className="flex-1 min-w-0">
                      <button onClick={() => navigator.clipboard?.writeText(inv.code).then(() => toast('Code copied', 'success'))}
                        className="text-[11px] font-mono text-primary/60 hover:text-primary transition-colors">{inv.code}</button>
                      <p className="text-[9px] text-on-surface-variant/25">{inv.uses}/{inv.max_uses} uses · expires {timeAgo(inv.expires_at)}</p>
                    </div>
                    <button onClick={() => revokeInvite(inv.id)}
                      className="p-0.5 rounded hover:bg-red-500/10 text-on-surface-variant/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
