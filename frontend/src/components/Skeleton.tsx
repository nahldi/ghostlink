/**
 * v2.4.0: Loading skeleton components for premium feel.
 * v2.9.0: Replaced opacity pulse with CSS gradient shimmer.
 */

interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
}

export function Skeleton({ className = '', width = '100%', height = '1rem' }: SkeletonProps) {
  return (
    <div
      className={`rounded skeleton-shimmer ${className}`}
      style={{ width, height }}
    />
  );
}

export function MessageSkeleton() {
  return (
    <div className="flex gap-3 p-4">
      <Skeleton width="2rem" height="2rem" className="rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton width="30%" height="0.75rem" />
        <Skeleton width="80%" />
        <Skeleton width="60%" />
      </div>
    </div>
  );
}

export function AgentSkeleton() {
  return (
    <div className="flex items-center gap-2 p-2">
      <Skeleton width="1.5rem" height="1.5rem" className="rounded-full" />
      <Skeleton width="4rem" height="0.75rem" />
    </div>
  );
}

export function ChannelSkeleton() {
  return (
    <div className="flex items-center gap-2 p-2 px-3">
      <Skeleton width="1rem" height="1rem" className="rounded" />
      <Skeleton width="5rem" height="0.75rem" />
    </div>
  );
}

export function TerminalSkeleton() {
  return (
    <div className="p-3 space-y-1.5" style={{ background: '#06060c' }}>
      <Skeleton width="60%" height="0.65rem" className="rounded-sm" />
      <Skeleton width="80%" height="0.65rem" className="rounded-sm" />
      <Skeleton width="45%" height="0.65rem" className="rounded-sm" />
      <Skeleton width="70%" height="0.65rem" className="rounded-sm" />
      <Skeleton width="55%" height="0.65rem" className="rounded-sm" />
      <Skeleton width="90%" height="0.65rem" className="rounded-sm" />
    </div>
  );
}

export function FileListSkeleton() {
  const widths = ['44%', '58%', '71%', '49%', '63%', '77%'];
  return (
    <div className="py-1 space-y-0.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-1.5">
          <Skeleton width="1rem" height="1rem" className="rounded" />
          <Skeleton width={widths[i % widths.length]} height="0.65rem" />
        </div>
      ))}
    </div>
  );
}

export function ActivitySkeleton() {
  const widths = ['52%', '68%', '57%', '74%'];
  return (
    <div className="py-2 space-y-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-start gap-2 px-3 py-2">
          <Skeleton width="1rem" height="1rem" className="rounded-full shrink-0" />
          <div className="flex-1 space-y-1">
            <Skeleton width={widths[i % widths.length]} height="0.6rem" />
            <Skeleton width="3rem" height="0.5rem" />
          </div>
        </div>
      ))}
    </div>
  );
}
