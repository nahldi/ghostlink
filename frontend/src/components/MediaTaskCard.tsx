import { AudioPlayer } from './AudioPlayer';
import { VideoPlayer } from './VideoPlayer';

interface MediaTaskCardProps {
  task: {
    kind?: string;
    artifact_type?: string;
    mime_type?: string;
    status?: string;
    progress_pct?: number;
    provider?: string;
    model?: string;
    cost_usd?: number;
    eta_seconds?: number;
    error?: string;
    output_url?: string;
    artifact_path?: string;
    thumbnail_url?: string;
    steps?: Array<{ label?: string; status?: 'done' | 'active' | 'pending' | string }>;
    duration?: number;
    genre?: string;
    mood?: string;
    tempo?: string;
    lyrics?: string;
    instrumental?: boolean;
  };
}

function formatEta(seconds?: number) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  return `${Math.ceil(seconds / 60)}m left`;
}

function resolveKind(task: MediaTaskCardProps['task']) {
  if (task.kind) return task.kind;
  if (task.artifact_type) return task.artifact_type;
  if (task.mime_type?.startsWith('video/')) return 'video';
  if (task.mime_type?.startsWith('audio/')) return 'music';
  if (task.mime_type?.startsWith('image/')) return 'image';
  return 'media';
}

export function MediaTaskCard({ task }: MediaTaskCardProps) {
  const pct = Math.max(0, Math.min(100, Math.round(task.progress_pct || 0)));
  const status = task.status || 'queued';
  const eta = formatEta(task.eta_seconds);
  const outputSrc = task.output_url || task.artifact_path;
  const kind = resolveKind(task);

  return (
    <div className="my-3 rounded-xl border border-outline-variant/12 bg-surface-container/25 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary/75">
            {kind} task
          </div>
          <div className="mt-1 text-[12px] text-on-surface">
            {status}
            {eta ? ` | ${eta}` : ''}
          </div>
        </div>
        <div className="text-right text-[10px] text-on-surface-variant/45">
          {task.provider ? <div>{task.provider}{task.model ? ` · ${task.model}` : ''}</div> : null}
          {typeof task.cost_usd === 'number' ? <div>${task.cost_usd.toFixed(4)}</div> : null}
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-container-highest/30">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #38bdf8, #7c3aed)' }}
        />
      </div>

      <div className="mt-2 text-right text-[10px] text-on-surface-variant/40">{pct}%</div>

      {(task.genre || task.mood || task.tempo || typeof task.duration === 'number' || task.instrumental || task.lyrics) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {typeof task.duration === 'number' && (
            <span className="rounded-full bg-surface-container-high/30 px-2 py-1 text-[10px] text-on-surface-variant/55">
              {task.duration}s
            </span>
          )}
          {task.genre && (
            <span className="rounded-full bg-surface-container-high/30 px-2 py-1 text-[10px] text-on-surface-variant/55">
              {task.genre}
            </span>
          )}
          {task.mood && (
            <span className="rounded-full bg-surface-container-high/30 px-2 py-1 text-[10px] text-on-surface-variant/55">
              {task.mood}
            </span>
          )}
          {task.tempo && (
            <span className="rounded-full bg-surface-container-high/30 px-2 py-1 text-[10px] text-on-surface-variant/55">
              {task.tempo}
            </span>
          )}
          {task.instrumental && (
            <span className="rounded-full bg-surface-container-high/30 px-2 py-1 text-[10px] text-on-surface-variant/55">
              instrumental
            </span>
          )}
          {task.lyrics && (
            <span className="rounded-full bg-surface-container-high/30 px-2 py-1 text-[10px] text-on-surface-variant/55">
              lyrics
            </span>
          )}
        </div>
      )}

      {task.steps && task.steps.length > 0 && (
        <div className="mt-3 space-y-1">
          {task.steps.map((step, index) => (
            <div key={`${step.label || 'step'}-${index}`} className="flex items-center gap-2 text-[10px]">
              <span className="w-4 text-center">
                {step.status === 'done' ? '✓' : step.status === 'active' ? '…' : '○'}
              </span>
              <span className={step.status === 'active' ? 'text-on-surface' : 'text-on-surface-variant/45'}>
                {step.label || `Step ${index + 1}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {task.error && (
        <div className="mt-3 rounded-lg border border-red-400/15 bg-red-500/5 px-3 py-2 text-[11px] text-red-200">
          {task.error}
        </div>
      )}

      {outputSrc && kind === 'video' && (
        <VideoPlayer src={outputSrc} poster={task.thumbnail_url} title="Generated video output" />
      )}

      {outputSrc && kind === 'music' && (
        <AudioPlayer src={outputSrc} title="Generated music output" />
      )}

      {outputSrc && kind === 'image' && (
        <div className="mt-3">
          <img
            src={outputSrc}
            alt="Generated image output"
            className="max-h-[320px] w-full rounded-xl border border-outline-variant/10 object-contain"
          />
        </div>
      )}
    </div>
  );
}
