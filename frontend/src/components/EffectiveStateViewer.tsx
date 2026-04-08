import type { AgentEffectiveStateResponse, EffectiveStateFieldSource, EffectiveStateRule } from '../types';

interface EffectiveStateViewerProps {
  state: AgentEffectiveStateResponse | null;
  emptyMessage?: string;
  compact?: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  model: 'Model',
  thinkingLevel: 'Thinking',
  responseMode: 'Response Mode',
  autoApprove: 'Auto Approve',
  failoverModel: 'Failover',
};

const LAYER_COLORS: Record<string, string> = {
  system: 'bg-blue-500/15 text-blue-200',
  workspace: 'bg-emerald-500/15 text-emerald-200',
  profile: 'bg-primary/15 text-primary',
  agent: 'bg-amber-500/15 text-amber-200',
};

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined || value === '') return 'Inherited';
  return String(value);
}

function layerClass(layer?: string): string {
  return LAYER_COLORS[layer || ''] || 'bg-white/6 text-on-surface-variant/55';
}

function labelFor(field: string): string {
  return FIELD_LABELS[field] || field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function ruleKey(rule: EffectiveStateRule, idx: number): string {
  return `${rule.source}-${idx}-${rule.content.slice(0, 24)}`;
}

function normalizeState(state: AgentEffectiveStateResponse): {
  effective: Record<string, unknown> & { enabled_skills?: string[]; rules?: EffectiveStateRule[] };
  overrides: Record<string, EffectiveStateFieldSource>;
} {
  const effective = (state.effective_state || state.effective || {}) as Record<string, unknown> & {
    enabled_skills?: string[];
    rules?: EffectiveStateRule[];
    sources?: Record<string, unknown>;
  };
  const rawSources = effective.sources || {};
  const derivedOverrides = Object.fromEntries(
    Object.entries(rawSources).map(([field, source]) => {
      if (typeof source === 'string') return [field, { layer: source, value: effective[field] }];
      if (source && typeof source === 'object' && 'layer' in (source as Record<string, unknown>)) {
        return [field, source as EffectiveStateFieldSource];
      }
      return [field, { layer: 'profile', value: source }];
    })
  ) as Record<string, EffectiveStateFieldSource>;
  const overrides = state.overrides || derivedOverrides;
  return { effective, overrides };
}

export function EffectiveStateViewer({
  state,
  emptyMessage = 'Effective state will appear here once the backend exposes profile layering.',
  compact = false,
}: EffectiveStateViewerProps) {
  if (!state) {
    return (
      <div className="rounded-xl border border-outline-variant/6 bg-surface-container/30 px-3 py-3 text-[11px] text-on-surface-variant/40">
        {emptyMessage}
      </div>
    );
  }

  const { effective, overrides } = normalizeState(state);
  const fieldEntries = Object.entries(effective).filter(([key, value]) => {
    if (key === 'enabled_skills' || key === 'rules' || key === 'sources' || key === 'profile_id') return false;
    return value !== undefined && value !== null && value !== '';
  });
  const enabledSkills = Array.isArray(effective.enabled_skills) ? effective.enabled_skills : [];
  const rules = Array.isArray(effective.rules) ? effective.rules : [];

  return (
    <div className="space-y-3">
      {fieldEntries.length > 0 && (
        <div className="space-y-2">
          {fieldEntries.map(([field, value]) => {
            const source = overrides[field];
            return (
              <div key={field} className="flex items-center justify-between gap-3 rounded-lg bg-surface-container/40 px-2.5 py-2">
                <span className="text-[10px] text-on-surface-variant/45">{labelFor(field)}</span>
                <div className="flex items-center gap-2 min-w-0">
                  {source?.layer && (
                    <span className={`rounded-md px-1.5 py-0.5 text-[8px] font-semibold uppercase ${layerClass(source.layer)}`}>
                      {source.layer}
                    </span>
                  )}
                  <span className="truncate text-[10px] font-medium text-on-surface/75">{formatValue(value)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!compact && state.degraded_reason && (
        <div className="rounded-lg border border-amber-400/15 bg-amber-400/8 px-3 py-2 text-[10px] text-amber-200/80">
          Degraded mode: {state.degraded_reason}
        </div>
      )}

      {enabledSkills.length > 0 && (
        <div>
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Enabled Skills</div>
          <div className="flex flex-wrap gap-1">
            {enabledSkills.map((skill) => (
              <span key={skill} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary/80">
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {rules.length > 0 && (
        <div>
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Layered Rules</div>
          <div className="space-y-1.5">
            {rules.map((rule, idx) => (
              <div key={ruleKey(rule, idx)} className="rounded-lg bg-surface-container/40 px-2.5 py-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className={`rounded-md px-1.5 py-0.5 text-[8px] font-semibold uppercase ${layerClass(rule.source)}`}>
                    {rule.source}
                  </span>
                </div>
                <div className="text-[10px] leading-relaxed text-on-surface-variant/60">{rule.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
