import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { AgentsMdDiffResponse, AgentsMdImportResponse } from '../types';
import { toast } from './Toast';

interface AgentsMdReviewProps {
  payload: AgentsMdDiffResponse | null;
  workspacePath?: string;
  onClose: () => void;
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value || {}, null, 2);
}

export function AgentsMdReview({ payload, workspacePath, onClose }: AgentsMdReviewProps) {
  const [importing, setImporting] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [scanned, setScanned] = useState<AgentsMdDiffResponse | null>(payload);
  const [importResult, setImportResult] = useState<AgentsMdImportResponse | null>(null);
  const workspaceId = workspacePath || payload?.workspace_id || payload?.workspace_path || '';

  useEffect(() => {
    setScanned(payload);
  }, [payload]);

  useEffect(() => {
    if (!workspaceId) return;
    if (scanned?.pending_diff || scanned?.parsed?.raw) return;
    let cancelled = false;
    api.scanAgentsMd(workspaceId)
      .then((result) => {
        if (!cancelled) setScanned(result);
      })
      .catch((error) => {
        if (!cancelled) toast(error instanceof Error ? error.message : 'Failed to scan AGENTS.md', 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [scanned?.parsed?.raw, scanned?.pending_diff, workspaceId]);

  const summary = useMemo(() => {
    const rawDiff = scanned?.pending_diff || '';
    return {
      hasPending: Boolean(scanned?.has_pending || scanned?.has_changes || rawDiff),
      ruleCount: Array.isArray(scanned?.parsed?.workspace_rules) ? scanned.parsed.workspace_rules.length : 0,
      agentCount: Array.isArray(scanned?.parsed?.agents) ? scanned.parsed.agents.length : 0,
    };
  }, [scanned]);

  const handleImport = async () => {
    if (!workspaceId) {
      toast('Workspace id missing for AGENTS.md import', 'error');
      return;
    }
    setImporting(true);
    try {
      const result = await api.importAgentsMd(workspaceId);
      setImportResult(result);
      toast(`Imported ${result.rules?.length || 0} workspace rules`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to import AGENTS.md', 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleIgnore = async () => {
    if (!workspaceId) {
      onClose();
      return;
    }
    setIgnoring(true);
    try {
      await api.ignoreAgentsMd(workspaceId);
      toast('Dismissed pending AGENTS.md changes', 'info');
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to ignore AGENTS.md change', 'error');
    } finally {
      setIgnoring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <div
        className="relative flex h-[84vh] w-[1180px] max-w-[96vw] flex-col overflow-hidden rounded-3xl border border-outline-variant/12 bg-[#0d0d15]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-outline-variant/10 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/35">AGENTS.md Review</div>
            <div className="text-[11px] text-on-surface-variant/30">
              Import reviewed workspace instructions into policy. Do not let the repo silently steer runtime behavior.
            </div>
            {workspaceId && (
              <div className="mt-2 text-[10px] text-on-surface-variant/35">{workspaceId}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleIgnore}
              disabled={ignoring}
              className="rounded-xl border border-outline-variant/12 bg-white/6 px-4 py-2 text-[11px] font-semibold text-on-surface-variant/65 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              {ignoring ? 'Ignoring...' : 'Ignore'}
            </button>
            <button
              onClick={handleImport}
              disabled={importing}
              className="rounded-xl border border-primary/20 bg-primary/12 px-4 py-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/18 disabled:opacity-50"
            >
              {importing ? 'Importing...' : 'Import to Workspace Layer'}
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-on-surface-variant/35 hover:bg-white/6">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>

        <div className="grid flex-1 gap-4 overflow-hidden p-5 lg:grid-cols-[0.7fr,1.3fr]">
          <div className="space-y-4 overflow-y-auto">
            <div className="grid grid-cols-3 gap-2">
              <SummaryCard label="Pending" value={summary.hasPending ? 'Yes' : 'No'} tone="primary" />
              <SummaryCard label="Rules" value={String(summary.ruleCount)} tone="emerald" />
              <SummaryCard label="Agents" value={String(summary.agentCount)} tone="amber" />
            </div>

            <div className="rounded-2xl border border-outline-variant/8 bg-surface-container/20 p-4">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Pending Diff</div>
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-on-surface-variant/55">
                {scanned?.pending_diff || 'No pending diff details were provided.'}
              </pre>
            </div>

            <div className="rounded-2xl border border-outline-variant/8 bg-surface-container/20 p-4">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Parsed Summary</div>
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-on-surface-variant/55">
                {prettyJson({
                  workspace_rules: scanned?.parsed?.workspace_rules || [],
                  agents: scanned?.parsed?.agents || [],
                })}
              </pre>
            </div>

            <div className="rounded-2xl border border-outline-variant/8 bg-surface-container/20 p-4">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Imported Policy State</div>
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-on-surface-variant/55">
                {prettyJson(importResult || { rules: [], settings: {} })}
              </pre>
            </div>
          </div>

          <div className="grid gap-4 overflow-hidden md:grid-cols-2">
            <DiffPane title="Imported" body={scanned?.imported_raw || 'No imported snapshot yet.'} />
            <DiffPane title="Current" body={scanned?.parsed?.raw || scanned?.pending_raw || 'No current AGENTS.md snapshot provided.'} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'amber' | 'primary' }) {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-500/12 text-emerald-200'
      : tone === 'amber'
        ? 'bg-amber-500/12 text-amber-200'
        : 'bg-primary/12 text-primary';
  return (
    <div className={`rounded-2xl border border-outline-variant/8 px-3 py-3 ${toneClass}`}>
      <div className="text-[9px] font-semibold uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}

function DiffPane({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-outline-variant/8 bg-surface-container/20">
      <div className="border-b border-outline-variant/8 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">
        {title}
      </div>
      <pre className="flex-1 overflow-auto whitespace-pre-wrap px-4 py-4 text-[10px] leading-relaxed text-on-surface-variant/55">
        {body}
      </pre>
    </div>
  );
}
