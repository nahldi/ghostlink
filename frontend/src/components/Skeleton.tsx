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
