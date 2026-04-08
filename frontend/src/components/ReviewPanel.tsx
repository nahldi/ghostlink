import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { ReviewFinding } from '../types';
import { toast } from './Toast';

function severityTone(severity: string) {
  switch (severity) {
    case 'high':
      return 'bg-red-500/15 text-red-400 border-red-500/20';
    case 'medium':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
    default:
      return 'bg-sky-500/15 text-sky-400 border-sky-500/20';
  }
}

function collectAnnotatedLines(diffText: string, findings: ReviewFinding[]) {
  const markers = new Map<string, ReviewFinding[]>();
  for (const finding of findings) {
    const key = `${finding.path || ''}:${finding.line ?? ''}`;
    const list = markers.get(key) || [];
    list.push(finding);
    markers.set(key, list);
  }

  let currentPath = '';
  let newLine = 0;
  return diffText.split('\n').map((raw, index) => {
    const line = raw;
    if (line.startsWith('+++ b/')) currentPath = line.slice(6);
    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)/);
      newLine = match ? Number(match[1]) : 0;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      const hit = markers.get(`${currentPath}:${newLine}`) || [];
      newLine += 1;
      return { index, line, hits: hit };
    } else if (!line.startsWith('-')) {
      newLine += 1;
    }
    return { index, line, hits: [] as ReviewFinding[] };
  });
}

export function ReviewPanel({ onClose }: { onClose: () => void }) {
  const [diffText, setDiffText] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const [modifyText, setModifyText] = useState<Record<string, string>>({});

  const annotated = useMemo(() => collectAnnotatedLines(diffText, findings), [diffText, findings]);

  const runReview = async () => {
    if (!diffText.trim()) {
      toast('Paste a diff first', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await api.reviewDiff(diffText);
      setReviewId(result.review_id);
      setFindings(result.findings);
      toast(`Review generated: ${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}`, 'success');
    } catch (error) {
      console.error('Review failed:', error);
      toast('Review failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const applyCorrection = async (finding: ReviewFinding, correction_type: 'accept' | 'dismiss' | 'modify') => {
    setActiveFindingId(finding.finding_id);
    try {
      await api.correctReviewFinding(finding.finding_id, {
        correction_type,
        correction_text: correction_type === 'modify' ? (modifyText[finding.finding_id] || finding.suggestion || '') : '',
      });
      if (correction_type === 'accept') {
        toast('Finding accepted', 'success');
      } else {
        toast(`Learning saved: ${correction_type}`, 'success');
      }
      setFindings((current) => current.filter((item) => item.finding_id !== finding.finding_id));
    } catch (error) {
      console.error('Correction failed:', error);
      toast('Correction failed', 'error');
    } finally {
      setActiveFindingId(null);
    }
  };

  useEffect(() => {
    const esc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[1100px] max-w-[96vw] h-[84vh] rounded-2xl overflow-hidden glass-card border border-outline-variant/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-outline-variant/10 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant/40">Code Review</div>
            <div className="text-[11px] text-on-surface-variant/35 mt-1">
              Submit a unified diff, inspect findings, and teach the reviewer with dismiss/modify corrections.
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-container-high text-on-surface-variant/50">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="grid grid-cols-[1.2fr_0.9fr] h-[calc(84vh-73px)]">
          <div className="border-r border-outline-variant/10 min-h-0 flex flex-col">
            <div className="p-4 border-b border-outline-variant/10 space-y-3">
              <textarea
                value={diffText}
                onChange={(event) => setDiffText(event.target.value)}
                placeholder="Paste a unified diff here..."
                className="w-full min-h-[180px] rounded-xl bg-surface-container-high/30 border border-outline-variant/10 px-3 py-3 font-mono text-[11px] leading-5 text-on-surface/80 outline-none focus:border-primary/30"
                spellCheck={false}
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={runReview}
                  disabled={busy}
                  className="px-4 py-2 rounded-xl bg-primary/15 text-primary text-[11px] font-semibold hover:bg-primary/25 transition-colors disabled:opacity-50"
                >
                  {busy ? 'Reviewing...' : 'Run Review'}
                </button>
                {reviewId && (
                  <span className="text-[10px] text-on-surface-variant/35 font-mono">
                    review {reviewId.slice(0, 8)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-[#06060c]">
              <div className="px-4 py-3 text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/25 border-b border-outline-variant/5">
                Diff Preview
              </div>
              <div className="font-mono text-[11px] leading-5">
                {annotated.length === 0 ? (
                  <div className="p-4 text-on-surface-variant/30">No diff loaded.</div>
                ) : (
                  annotated.map(({ index, line, hits }) => (
                    <div key={index} className={`px-4 py-0.5 ${hits.length > 0 ? 'bg-red-500/8' : ''}`}>
                      <div className="flex items-start gap-3">
                        <span className="w-5 shrink-0 text-on-surface-variant/20 select-none">
                          {line.startsWith('+') ? '+' : line.startsWith('-') ? '-' : ' '}
                        </span>
                        <span className={`flex-1 whitespace-pre-wrap break-all ${
                          line.startsWith('+')
                            ? 'text-green-300/80'
                            : line.startsWith('-')
                              ? 'text-red-300/70'
                              : 'text-on-surface-variant/55'
                        }`}>
                          {line}
                        </span>
                      </div>
                      {hits.length > 0 && (
                        <div className="ml-8 mt-1 mb-1 flex flex-wrap gap-1.5">
                          {hits.map((hit) => (
                            <span key={hit.finding_id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] ${severityTone(hit.severity)}`}>
                              {hit.severity}
                              <span className="text-on-surface/70">{hit.title}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex flex-col">
            <div className="px-4 py-3 border-b border-outline-variant/10 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/25">Findings</div>
              <div className="text-[10px] text-on-surface-variant/35">{findings.length}</div>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {findings.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-on-surface-variant/30 text-center">
                  No findings loaded yet.
                </div>
              ) : (
                findings.map((finding) => (
                  <div key={finding.finding_id} className="rounded-xl border border-outline-variant/10 bg-surface-container-high/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold ${severityTone(finding.severity)}`}>
                            {finding.severity}
                          </span>
                          <span className="text-[10px] text-on-surface-variant/40 uppercase tracking-[0.12em]">
                            {finding.category}
                          </span>
                        </div>
                        <div className="text-[12px] font-semibold text-on-surface/80">{finding.title}</div>
                        <div className="text-[10px] text-on-surface-variant/40 font-mono">
                          {finding.path || 'diff'}{finding.line ? `:${finding.line}` : ''}
                        </div>
                      </div>
                    </div>

                    {finding.diff_line && (
                      <pre className="mt-3 rounded-lg bg-black/25 px-3 py-2 text-[10px] text-on-surface-variant/55 whitespace-pre-wrap font-mono">
                        {finding.diff_line}
                      </pre>
                    )}

                    {finding.suggestion && (
                      <div className="mt-3 text-[11px] text-on-surface/70 leading-relaxed">
                        {finding.suggestion}
                      </div>
                    )}

                    <textarea
                      value={modifyText[finding.finding_id] ?? finding.suggestion ?? ''}
                      onChange={(event) =>
                        setModifyText((current) => ({ ...current, [finding.finding_id]: event.target.value }))
                      }
                      className="mt-3 w-full min-h-[72px] rounded-lg bg-surface-container-highest/30 border border-outline-variant/10 px-3 py-2 text-[11px] text-on-surface/75 outline-none focus:border-primary/30"
                      placeholder="Replacement suggestion for modify learning..."
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => applyCorrection(finding, 'accept')}
                        disabled={activeFindingId === finding.finding_id}
                        className="px-3 py-1.5 rounded-lg bg-green-500/12 text-green-400 text-[10px] font-semibold hover:bg-green-500/18 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => applyCorrection(finding, 'dismiss')}
                        disabled={activeFindingId === finding.finding_id}
                        className="px-3 py-1.5 rounded-lg bg-red-500/12 text-red-400 text-[10px] font-semibold hover:bg-red-500/18 disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={() => applyCorrection(finding, 'modify')}
                        disabled={activeFindingId === finding.finding_id}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/12 text-amber-400 text-[10px] font-semibold hover:bg-amber-500/18 disabled:opacity-50"
                      >
                        Modify
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
