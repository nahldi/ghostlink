interface AudioPlayerProps {
  src: string;
  title?: string;
}

export function AudioPlayer({ src, title }: AudioPlayerProps) {
  return (
    <div className="mt-2 rounded-xl border border-outline-variant/10 bg-surface-container/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-primary">music_note</span>
        <span className="text-[11px] font-semibold text-on-surface">{title || 'Generated audio'}</span>
      </div>
      <audio controls preload="metadata" src={src} className="w-full" />
    </div>
  );
}
