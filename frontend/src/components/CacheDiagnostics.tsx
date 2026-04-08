import type { CacheDiagnostics as CacheDiagnosticsData } from '../types';

function percent(value: number) {
  return `${((value || 0) * 100).toFixed(0)}%`;
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl bg-surface-container/25 p-3">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/35">{label}</div>
      <div className="mt-1 text-[14px] font-semibold text-on-surface">{value}</div>
      {detail ? <div className="mt-1 text-[9px] text-on-surface-variant/40">{detail}</div> : null}
    </div>
  );
}

export function CacheDiagnostics({ diagnostics }: { diagnostics: CacheDiagnosticsData | null }) {
  const hits = diagnostics?.total_hits || 0;
  const misses = diagnostics?.total_misses || 0;
  const total = hits + misses;
  const hitRate = hits / Math.max(total, 1);
  const providers = Object.entries(diagnostics?.providers || {}).sort((a, b) => (b[1].hits + b[1].misses) - (a[1].hits + a[1].misses));

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-4">
        <MetricCard label="Hit Rate" value={percent(hitRate)} detail={total > 0 ? `${total} observed requests` : 'Waiting for cache traffic'} />
        <MetricCard label="Hits" value={String(hits)} detail="Measured from live transport metadata when available." />
        <MetricCard label="Misses" value={String(misses)} detail="Falls back to aggregate request accounting." />
        <MetricCard
          label="Signal Quality"
          value={providers.length > 0 ? 'Measured' : 'Sparse'}
          detail={providers.length > 0 ? 'Current backend exposes provider-level hit/miss counts.' : 'No provider-level cache activity returned yet.'}
        />
      </div>

      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container/20 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Per-Provider Cache Health</div>
            <div className="text-[10px] text-on-surface-variant/40">
              Phase 6 bar: measured cache stats stay explicit, inferred values stay labeled.
            </div>
          </div>
          <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-blue-300">
            measured aggregates
          </span>
        </div>
        <div className="space-y-2">
          {providers.length > 0 ? providers.map(([providerId, stats]) => {
            const providerTotal = stats.hits + stats.misses;
            const providerRate = stats.hits / Math.max(providerTotal, 1);
            const missStreakRisk = providerTotal >= 5 && providerRate < 0.5;
            return (
              <div key={providerId} className="rounded-xl bg-surface-container/25 p-3">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-on-surface">{providerId}</div>
                    <div className="text-[9px] text-on-surface-variant/40">
                      Hits {stats.hits} | Misses {stats.misses}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-semibold text-on-surface">{percent(providerRate)}</div>
                    <div className={`text-[9px] ${missStreakRisk ? 'text-amber-300' : 'text-on-surface-variant/40'}`}>
                      {missStreakRisk ? 'Below 50% floor' : 'Within expected band'}
                    </div>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-highest/35">
                  <div
                    className={`h-full rounded-full ${providerRate < 0.5 ? 'bg-amber-400' : 'bg-green-400'}`}
                    style={{ width: `${Math.max(providerRate * 100, 4)}%` }}
                  />
                </div>
              </div>
            );
          }) : (
            <div className="rounded-xl bg-surface-container/25 p-3 text-[10px] text-on-surface-variant/40">
              No cache diagnostics returned yet. The panel stays truthful and empty instead of inventing trend data.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
