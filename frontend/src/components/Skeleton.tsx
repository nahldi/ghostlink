/**
 * v2.4.0: Loading skeleton components for premium feel.
 * Replace spinners with these for a smoother loading experience.
 */
import { motion } from 'framer-motion';

interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
}

export function Skeleton({ className = '', width = '100%', height = '1rem' }: SkeletonProps) {
  return (
    <motion.div
      className={`rounded bg-[var(--bg-tertiary)] ${className}`}
      style={{ width, height }}
      animate={{ opacity: [0.3, 0.6, 0.3] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
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
