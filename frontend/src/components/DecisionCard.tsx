import type { DecisionChoice } from '../types';

interface DecisionCardProps {
  title: string;
  description: string;
  choices: DecisionChoice[];
  onChoose: (value: string) => void;
  resolved?: string;
}

export function DecisionCard({
  title,
  description,
  choices,
  onChoose,
  resolved,
}: DecisionCardProps) {
  return (
    <div className="p-5 rounded-xl border border-primary/20 bg-surface-container-high-40 backdrop-blur-md my-3">
      <div className="text-[10px] font-bold text-primary uppercase tracking-widest mb-2">
        Decision Required
      </div>
      <div className="text-sm font-bold text-on-surface mb-1">{title}</div>
      <div className="text-xs text-on-surface-variant mb-4">{description}</div>

      {resolved ? (
        <div className="flex items-center gap-2 text-xs text-secondary">
          <span className="material-symbols-outlined text-sm">check_circle</span>
          Resolved: {resolved}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {choices.map((choice, i) => (
            <button
              key={choice.value}
              onClick={() => onChoose(choice.value)}
              className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95 ${
                i === 0
                  ? 'bg-primary-container text-primary-fixed hover:brightness-110'
                  : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-bright'
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
