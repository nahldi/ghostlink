interface VideoPlayerProps {
  src: string;
  title?: string;
  poster?: string;
}

export function VideoPlayer({ src, title, poster }: VideoPlayerProps) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container/20">
      <video
        controls
        preload="metadata"
        poster={poster}
        src={src}
        title={title || 'Generated video'}
        className="max-h-[320px] w-full bg-black object-contain"
      />
      {title && (
        <div className="border-t border-outline-variant/10 px-3 py-2 text-[11px] text-on-surface-variant/55">
          {title}
        </div>
      )}
    </div>
  );
}
