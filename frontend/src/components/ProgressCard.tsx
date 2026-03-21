interface ProgressStep {
  label: string;
  status: 'done' | 'active' | 'pending';
}

interface ProgressCardProps {
  steps: ProgressStep[];
  current: number;
  total: number;
  title?: string;
}

export function ProgressCard({ steps, current, total, title }: ProgressCardProps) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="my-2 p-3 rounded-xl border border-outline-variant/10" style={{ background: 'rgba(167, 139, 250, 0.04)' }}>
      {title && (
        <div className="text-[11px] font-semibold text-primary/70 mb-2">{title}</div>
      )}

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-surface-container-highest/30 overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: pct === 100
              ? 'linear-gradient(90deg, #4ade80, #22c55e)'
              : 'linear-gradient(90deg, #a78bfa, #7c3aed)',
          }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-1">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[12px] w-4 text-center shrink-0">
              {step.status === 'done' ? '✅' : step.status === 'active' ? '⏳' : '⬜'}
            </span>
            <span className={`text-[11px] ${
              step.status === 'done' ? 'text-green-400/60 line-through' :
              step.status === 'active' ? 'text-on-surface font-medium' :
              'text-on-surface-variant/30'
            }`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-on-surface-variant/30 mt-2 text-right">
        {current}/{total} — {pct}%
      </div>
    </div>
  );
}
