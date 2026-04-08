import { useEffect, useMemo, useState } from 'react';
import type { Agent, AgentMemorySnapshot, MemoryEntry, MemoryLayer } from '../types';
import { api } from '../lib/api';
import { toast } from './Toast';
import { timeAgo } from '../lib/timeago';

const LAYER_LABELS: Record<MemoryLayer, string> = {
  identity: 'Identity',
  workspace: 'Workspace',
  session: 'Session',
  observation: 'Observations',
  shared: 'Shared',
  conflict: 'Conflicts',
  unknown: 'Unknown',
};

const LAYER_COLORS: Record<MemoryLayer, string> = {
  identity: '#60a5fa',
  workspace: '#a78bfa',
  session: '#34d399',
  observation: '#f59e0b',
  shared: '#38bdf8',
  conflict: '#f87171',
  unknown: '#94a3b8',
};

function formatImportance(value?: number) {
  if (typeof value !== 'number') return 'Legacy';
  return `${Math.round(value * 100)}%`;
}

function formatSize(entry: MemoryEntry) {
  if (typeof entry.size_tokens === 'number') return `${entry.size_tokens} tok`;
  if (typeof entry.size === 'number') return `${entry.size} B`;
  return 'Unknown size';
}

function recallSummary(entry: MemoryEntry) {
  const parts: string[] = [];
  if (typeof entry.access_count === 'number') parts.push(`${entry.access_count} recalls`);
  if (entry.last_accessed) parts.push(`last hit ${timeAgo(entry.last_accessed)}`);
  return parts.join(' | ');
}

function preview(entry: MemoryEntry) {
  if (entry.content) return entry.content;
  return 'Legacy memory entry. Backend has not exposed full content for this item yet.';
}

function sourceLabel(entry: MemoryEntry) {
  if (entry.source === 'rag') return 'RAG recall';
  if (entry.source) return `${entry.source} recall`;
  return null;
}

interface MemoryInspectorProps {
  agent: Agent;
  onSnapshot?: (snapshot: AgentMemorySnapshot) => void;
}

const EMPTY_SNAPSHOT: AgentMemorySnapshot = { memories: [], observations: [], conflicts: [], available_tags: [] };

export function MemoryInspector({ agent, onSnapshot }: MemoryInspectorProps) {
  const [snapshot, setSnapshot] = useState<AgentMemorySnapshot | null>(null);
  const [soul, setSoul] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingSoul, setSavingSoul] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [promotingKey, setPromotingKey] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [layer, setLayer] = useState<'all' | MemoryLayer>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getAgentSoul(agent.name).catch(() => ({ soul: '' })),
      api.getAgentNotes(agent.name).catch(() => ({ notes: '' })),
      api.getAgentMemories(agent.name).catch(() => EMPTY_SNAPSHOT),
    ]).then(([soulResp, notesResp, memoryResp]) => {
      if (cancelled) return;
      setSoul(soulResp.soul || '');
      setNotes(notesResp.notes || '');
      setSnapshot(memoryResp);
      onSnapshot?.(memoryResp);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setSnapshot(EMPTY_SNAPSHOT);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [agent.name, onSnapshot]);

  const reloadMemories = async () => {
    const memoryResp = await api.getAgentMemories(agent.name).catch(() => EMPTY_SNAPSHOT);
    setSnapshot(memoryResp);
    onSnapshot?.(memoryResp);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await reloadMemories();
      toast('Memory state refreshed', 'success');
    } catch {
      toast('Failed to refresh memory state', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const allEntries = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.memories, ...snapshot.observations];
  }, [snapshot]);

  const filteredEntries = useMemo(() => {
    return allEntries.filter((entry) => {
      if (layer !== 'all' && entry.layer !== layer) return false;
      if (tagFilter && !(entry.tags || []).some((tag) => tag.toLowerCase() === tagFilter.toLowerCase())) return false;
      if (!query) return true;
      const haystack = `${entry.key} ${entry.content || ''} ${(entry.tags || []).join(' ')}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    }).sort((a, b) => {
      const importanceDelta = (b.importance || 0) - (a.importance || 0);
      if (importanceDelta !== 0) return importanceDelta;
      const accessDelta = (b.access_count || 0) - (a.access_count || 0);
      if (accessDelta !== 0) return accessDelta;
      return (b.last_accessed || b.updated_at || 0) - (a.last_accessed || a.updated_at || 0);
    });
  }, [allEntries, layer, query, tagFilter]);

  const layerCounts = useMemo(() => {
    const counts = snapshot?.counts_by_layer ? { ...snapshot.counts_by_layer } : {};
    for (const entry of allEntries) {
      counts[entry.layer] = Math.max(counts[entry.layer] || 0, 0) + (snapshot?.counts_by_layer?.[entry.layer] ? 0 : 1);
    }
    return counts;
  }, [allEntries, snapshot]);

  const tags = useMemo(() => {
    const discovered = new Set(snapshot?.available_tags || []);
    for (const entry of allEntries) {
      for (const tag of entry.tags || []) discovered.add(tag);
    }
    return Array.from(discovered).sort();
  }, [allEntries, snapshot]);

  const handleSaveSoul = async () => {
    setSavingSoul(true);
    try {
      await api.setAgentSoul(agent.name, soul);
      toast('Identity memory saved', 'success');
    } catch {
      toast('Failed to save identity memory', 'error');
    } finally {
      setSavingSoul(false);
    }
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await api.setAgentNotes(agent.name, notes);
      toast('Workspace notes saved', 'success');
    } catch {
      toast('Failed to save notes', 'error');
    } finally {
      setSavingNotes(false);
    }
  };

  const handlePromote = async (entry: MemoryEntry) => {
    setPromotingKey(entry.key);
    try {
      await api.promoteAgentMemory(agent.name, entry.key, 'workspace');
      await reloadMemories();
      toast('Memory promoted to workspace', 'success');
    } catch {
      toast('Failed to promote memory', 'error');
    } finally {
      setPromotingKey('');
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {(['identity', 'workspace', 'session', 'observation'] as MemoryLayer[]).map((entryLayer) => (
          <button
            key={entryLayer}
            onClick={() => setLayer(entryLayer)}
            className={`rounded-xl border px-3 py-2 text-left transition-all ${layer === entryLayer ? 'border-transparent' : 'border-outline-variant/8'}`}
            style={{
              background: `${LAYER_COLORS[entryLayer]}12`,
              boxShadow: layer === entryLayer ? `inset 0 0 0 1px ${LAYER_COLORS[entryLayer]}55` : 'none',
            }}
          >
            <div className="text-[9px] uppercase tracking-wider text-on-surface-variant/45">{LAYER_LABELS[entryLayer]}</div>
            <div className="mt-1 text-lg font-semibold" style={{ color: LAYER_COLORS[entryLayer] }}>
              {layerCounts[entryLayer] || 0}
            </div>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-outline-variant/8 bg-surface-container/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/40">Drift & Coordination</div>
            <div className="mt-1 text-[11px] text-on-surface-variant/60">
              {(snapshot?.drift?.detected || agent.drift_detected) ? 'Identity drift flagged' : 'Identity stable'}
              {typeof snapshot?.drift?.score === 'number' ? ` · ${(snapshot?.drift?.score * 100).toFixed(0)}% drift` : ''}
              {typeof snapshot?.shared_count === 'number' ? ` · ${snapshot.shared_count} shared items` : ''}
            </div>
          </div>
          <span
            className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase"
            style={{
              background: (snapshot?.drift?.detected || agent.drift_detected) ? 'rgba(248,113,113,0.15)' : 'rgba(74,222,128,0.15)',
              color: (snapshot?.drift?.detected || agent.drift_detected) ? '#fca5a5' : '#86efac',
            }}
          >
            {(snapshot?.drift?.detected || agent.drift_detected) ? 'Watch' : 'Stable'}
          </span>
        </div>
        {snapshot?.drift?.reason && (
          <div className="mt-2 text-[10px] text-on-surface-variant/45">{snapshot.drift.reason}</div>
        )}
        {snapshot?.conflicts && snapshot.conflicts.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-400/15 bg-red-500/5 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-red-300">Memory Conflicts</div>
            <div className="mt-2 space-y-2">
              {snapshot.conflicts.map((conflict) => (
                <div key={conflict.key} className="text-[11px] text-on-surface-variant/65">
                  <span className="font-semibold text-on-surface">{conflict.key}</span>
                  {conflict.summary ? ` · ${conflict.summary}` : ''}
                  {conflict.agents?.length ? ` · ${conflict.agents.join(', ')}` : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-outline-variant/8 bg-surface-container/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/40">Identity Memory</div>
          <button onClick={handleSaveSoul} disabled={savingSoul} className="text-[9px] font-medium text-primary hover:text-primary/80">
            {savingSoul ? 'Saving...' : 'Save'}
          </button>
        </div>
        <textarea
          value={soul}
          onChange={(e) => setSoul(e.target.value)}
          rows={4}
          placeholder="Core identity, role, and soul live here."
          className="setting-input w-full resize-none text-[11px]"
        />
      </div>

      <div className="rounded-xl border border-outline-variant/8 bg-surface-container/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/40">Workspace Notes</div>
          <button onClick={handleSaveNotes} disabled={savingNotes} className="text-[9px] font-medium text-primary hover:text-primary/80">
            {savingNotes ? 'Saving...' : 'Save'}
          </button>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Project memory, scratch notes, and promoted context."
          className="setting-input w-full resize-none text-[11px]"
        />
      </div>

      <div className="rounded-xl border border-outline-variant/8 bg-surface-container/30 p-3">
        <div className="flex flex-wrap gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memory keys, tags, or content..."
            className="setting-input min-w-[180px] flex-1 text-[11px]"
          />
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="rounded-lg bg-surface-container-high/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/55 hover:text-on-surface disabled:opacity-50"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            onClick={() => setLayer('all')}
            className={`rounded-lg px-3 py-2 text-[10px] font-semibold uppercase tracking-wider ${layer === 'all' ? 'bg-primary/15 text-primary' : 'bg-surface-container-high/30 text-on-surface-variant/50'}`}
          >
            All layers
          </button>
        </div>
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => setTagFilter('')}
              className={`rounded-full px-2 py-1 text-[10px] ${!tagFilter ? 'bg-primary/15 text-primary' : 'bg-surface-container-high/30 text-on-surface-variant/45'}`}
            >
              all tags
            </button>
            {tags.slice(0, 12).map((tag) => (
              <button
                key={tag}
                onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
                className={`rounded-full px-2 py-1 text-[10px] ${tagFilter === tag ? 'bg-primary/15 text-primary' : 'bg-surface-container-high/30 text-on-surface-variant/45'}`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="rounded-xl border border-outline-variant/8 bg-surface-container/20 p-4 text-[11px] text-on-surface-variant/40">
            Loading memory state...
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="rounded-xl border border-outline-variant/8 bg-surface-container/20 p-4 text-[11px] text-on-surface-variant/40">
            No memory entries match the current filters.
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <div key={`${entry.layer}:${entry.key}`} className="rounded-xl border border-outline-variant/8 bg-surface-container/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-on-surface">{entry.key}</span>
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                      style={{ background: `${LAYER_COLORS[entry.layer]}18`, color: LAYER_COLORS[entry.layer] }}
                    >
                      {LAYER_LABELS[entry.layer]}
                    </span>
                    {entry.promoted && (
                      <span className="rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
                        promoted
                      </span>
                    )}
                    {entry.layer === 'observation' && (
                      <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300">
                        observed pattern
                      </span>
                    )}
                    {sourceLabel(entry) && (
                      <span className="rounded-full bg-sky-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-sky-300">
                        {sourceLabel(entry)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-[11px] leading-relaxed text-on-surface-variant/60">
                    {preview(entry)}
                  </div>
                  {entry.layer === 'observation' && (
                    <div className="mt-2 text-[9px] uppercase tracking-wider text-amber-200/70">
                      Derived from repeated runtime behavior, not a manual note.
                    </div>
                  )}
                  {(entry.layer === 'session' || entry.layer === 'observation') && !entry.promoted && (
                    <div className="mt-2">
                      <button
                        onClick={() => void handlePromote(entry)}
                        disabled={promotingKey === entry.key}
                        className="rounded-lg bg-primary/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-primary hover:bg-primary/15 disabled:opacity-50"
                      >
                        {promotingKey === entry.key ? 'Promoting...' : 'Promote to workspace'}
                      </button>
                    </div>
                  )}
                  {recallSummary(entry) && (
                    <div className="mt-2 text-[9px] uppercase tracking-wider text-on-surface-variant/40">
                      {recallSummary(entry)}
                    </div>
                  )}
                  {!!entry.tags?.length && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {entry.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-surface-container-high/30 px-2 py-0.5 text-[9px] text-on-surface-variant/50">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="min-w-[72px] text-right text-[10px] text-on-surface-variant/40">
                  <div>{formatImportance(entry.importance)}</div>
                  <div className="mt-1">{formatSize(entry)}</div>
                  {entry.updated_at && <div className="mt-1">{timeAgo(entry.updated_at)}</div>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
