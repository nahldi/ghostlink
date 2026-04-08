import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { ProductAsset, ProductAssetVersion, RolloutChannel } from '../types';
import { toast } from './Toast';

function badgeTone(channel: RolloutChannel) {
  switch (channel) {
    case 'stable':
      return 'bg-green-500/15 text-green-300/85';
    case 'beta':
      return 'bg-amber-500/15 text-amber-300/85';
    default:
      return 'bg-surface-container-high text-on-surface-variant/55';
  }
}

function formatPct(value?: number) {
  if (typeof value !== 'number') return null;
  return `${Math.round(value * 100)}%`;
}

function formatUsd(value?: number) {
  if (typeof value !== 'number') return null;
  return `$${value.toFixed(2)}`;
}

function newestVersion(asset: ProductAsset) {
  return asset.versions.find((version) => version.is_current) || asset.versions[0] || null;
}

export function ProductizationPanel() {
  const [assets, setAssets] = useState<ProductAsset[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getProductizationAssets()
      .then((result) => {
        if (cancelled) return;
        setAssets(result.assets);
        setSelectedId(result.assets[0]?.asset_id || '');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load versioned assets');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.asset_id === selectedId) || assets[0] || null,
    [assets, selectedId],
  );
  const summary = useMemo(() => {
    const versions = assets.flatMap((asset) => asset.versions);
    return {
      assets: assets.length,
      beta: versions.filter((version) => version.channel === 'beta').length,
      private: versions.filter((version) => version.channel === 'private').length,
      deprecated: versions.filter((version) => version.deprecated).length,
      unhealthy: versions.filter((version) => (version.health?.error_rate || 0) >= 0.1).length,
    };
  }, [assets]);

  const applyUpdatedAsset = (next: ProductAsset | null | undefined) => {
    if (!next) return;
    setAssets((current) => current.map((asset) => asset.asset_id === next.asset_id ? next : asset));
  };

  const promote = async (asset: ProductAsset, version: ProductAssetVersion, channel: RolloutChannel) => {
    const busyId = `${asset.asset_id}:${version.version}:promote:${channel}`;
    setBusyKey(busyId);
    try {
      const result = await api.promoteProductizationAssetVersion(asset.kind, asset.asset_id, version.version, channel);
      applyUpdatedAsset(result.asset);
      toast(`${asset.name} ${version.version} promoted to ${channel}`, 'success');
    } catch {
      toast('Version promotion failed', 'error');
    } finally {
      setBusyKey('');
    }
  };

  const rollback = async (asset: ProductAsset, version: ProductAssetVersion) => {
    const busyId = `${asset.asset_id}:${version.version}:rollback`;
    setBusyKey(busyId);
    try {
      const result = await api.rollbackProductizationAssetVersion(asset.kind, asset.asset_id, version.version);
      applyUpdatedAsset(result.asset);
      toast(`Rolled back ${asset.name} to ${version.version}`, 'info');
    } catch {
      toast('Rollback failed', 'error');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/50">Versioned Assets</div>

      <div className="rounded-xl border border-outline-variant/8 bg-surface-container/20 p-3">
        <div className="mb-2 text-[11px] font-semibold text-on-surface">Rollout And Rollback</div>
        <div className="mb-3 text-[9px] text-on-surface-variant/40">
          Phase 8.5 keeps profiles and skills deployable instead of turning every edit into a one-way door.
        </div>

        {loading ? <div className="text-[10px] text-on-surface-variant/35">Loading versioned assets...</div> : null}
        {!loading && error ? <div className="text-[10px] text-red-300/80">{error}</div> : null}
        {!loading && !error && assets.length === 0 ? (
          <div className="text-[10px] text-on-surface-variant/35">No versioned profiles or skills published yet.</div>
        ) : null}

        {!loading && !error && assets.length > 0 ? (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-5">
              <div className="rounded-lg bg-surface-container/25 px-2.5 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Assets</div>
                <div className="mt-1 text-[12px] font-semibold text-on-surface">{summary.assets}</div>
              </div>
              <div className="rounded-lg bg-amber-500/8 px-2.5 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-200/55">Beta</div>
                <div className="mt-1 text-[12px] font-semibold text-amber-200/90">{summary.beta}</div>
              </div>
              <div className="rounded-lg bg-surface-container-high/60 px-2.5 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Private</div>
                <div className="mt-1 text-[12px] font-semibold text-on-surface">{summary.private}</div>
              </div>
              <div className="rounded-lg bg-red-500/8 px-2.5 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-red-200/55">Deprecated</div>
                <div className="mt-1 text-[12px] font-semibold text-red-200/90">{summary.deprecated}</div>
              </div>
              <div className="rounded-lg bg-red-500/8 px-2.5 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-red-200/55">Hot Versions</div>
                <div className="mt-1 text-[12px] font-semibold text-red-200/90">{summary.unhealthy}</div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[0.95fr,1.05fr]">
            <div className="space-y-2">
              {assets.map((asset) => {
                const latest = newestVersion(asset);
                const selected = selectedAsset?.asset_id === asset.asset_id;
                return (
                  <button
                    key={asset.asset_id}
                    onClick={() => setSelectedId(asset.asset_id)}
                    className={`w-full rounded-xl border p-3 text-left transition-all ${
                      selected
                        ? 'border-primary/30 bg-primary/10'
                        : 'border-outline-variant/8 bg-surface-container/20 hover:border-primary/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold text-on-surface">{asset.name}</div>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-[9px] uppercase text-on-surface-variant/50">{asset.kind}</span>
                        {asset.is_template ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary/85">template</span> : null}
                        {latest ? <span className={`rounded px-1.5 py-0.5 text-[9px] ${badgeTone(latest.channel)}`}>{latest.channel}</span> : null}
                      </div>
                    </div>
                    <div className="mt-1 text-[9px] text-on-surface-variant/45">{asset.description || 'No description yet.'}</div>
                    {latest ? (
                      <div className="mt-2 text-[9px] text-on-surface-variant/35">
                        v{latest.version}
                        {latest.health?.error_rate != null ? ` · errors ${formatPct(latest.health.error_rate)}` : ''}
                        {latest.health?.eval_score != null ? ` · eval ${Math.round(latest.health.eval_score * 100)}` : ''}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {selectedAsset ? (
              <div className="space-y-2">
                {selectedAsset.versions.map((version) => (
                  <div key={`${selectedAsset.asset_id}-${version.version}`} className="rounded-xl border border-outline-variant/8 bg-surface-container/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold text-on-surface">
                          {selectedAsset.name} · v{version.version}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className={`rounded px-1.5 py-0.5 text-[9px] ${badgeTone(version.channel)}`}>{version.channel}</span>
                          {version.is_current ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary/85">current</span> : null}
                          {version.policy_status ? <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-[9px] text-on-surface-variant/55">{version.policy_status}</span> : null}
                          {version.deprecated ? <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] text-red-300/85">deprecated</span> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1">
                        {version.channel !== 'stable' ? (
                          <button
                            onClick={() => promote(selectedAsset, version, 'stable')}
                            disabled={busyKey === `${selectedAsset.asset_id}:${version.version}:promote:stable`}
                            className="rounded-lg bg-primary/10 px-2 py-1 text-[9px] font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
                          >
                            Promote to stable
                          </button>
                        ) : null}
                        {!version.is_current ? (
                          <button
                            onClick={() => rollback(selectedAsset, version)}
                            disabled={busyKey === `${selectedAsset.asset_id}:${version.version}:rollback`}
                            className="rounded-lg bg-surface-container-high px-2 py-1 text-[9px] font-medium text-on-surface-variant/60 hover:text-on-surface disabled:opacity-40"
                          >
                            Roll back
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {version.changelog ? <div className="mt-2 text-[10px] text-on-surface-variant/55">{version.changelog}</div> : null}

                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div className="rounded-lg bg-surface-container/25 px-2.5 py-2">
                        <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Compatibility</div>
                        <div className="text-[9px] text-on-surface-variant/50">
                          min platform {version.compatibility?.min_platform_version || 'unspecified'}
                        </div>
                        {version.compatibility?.required_capabilities?.length ? (
                          <div className="mt-1 text-[9px] text-on-surface-variant/45">caps: {version.compatibility.required_capabilities.join(', ')}</div>
                        ) : null}
                        {version.compatibility?.provider_requirements?.length ? (
                          <div className="mt-1 text-[9px] text-on-surface-variant/45">providers: {version.compatibility.provider_requirements.join(', ')}</div>
                        ) : null}
                      </div>

                      <div className="rounded-lg bg-surface-container/25 px-2.5 py-2">
                        <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Health</div>
                        <div className="text-[9px] text-on-surface-variant/50">
                          errors {formatPct(version.health?.error_rate) || 'n/a'}
                          {' · '}
                          cost {formatUsd(version.health?.avg_cost_usd) || 'n/a'}
                        </div>
                        <div className="mt-1 text-[9px] text-on-surface-variant/45">
                          eval {version.health?.eval_score != null ? Math.round(version.health.eval_score * 100) : 'n/a'}
                          {' · '}
                          installs {version.health?.active_installs ?? 'n/a'}
                        </div>
                      </div>
                    </div>

                    {version.channel === 'beta' ? (
                      <div className="mt-2 rounded-lg border border-amber-500/15 bg-amber-500/5 px-2.5 py-2 text-[9px] text-amber-100/80">
                        Promotion to stable is policy-gated.
                        {version.policy_status ? ` Current state: ${version.policy_status}.` : ''}
                      </div>
                    ) : null}

                    {version.deprecated ? (
                      <div className="mt-2 rounded-lg border border-red-500/15 bg-red-500/5 px-2.5 py-2 text-[9px] text-red-200/80">
                        {version.deprecation_note || 'Deprecated version.'}
                        {version.migration_target ? ` Migrate to ${version.migration_target}.` : ''}
                      </div>
                    ) : null}

                  </div>
                ))}
              </div>
            ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
