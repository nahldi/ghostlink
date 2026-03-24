/**
 * v2.4.0: Empty state component for when there's no data to show.
 * Provides a consistent, animated empty state across the app.
 */
import { motion } from 'framer-motion';

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center py-16 px-8 text-center"
    >
      <span className="text-5xl mb-4">{icon}</span>
      <h3
        className="text-lg font-semibold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
      </h3>
      <p
        className="text-sm max-w-sm mb-6"
        style={{ color: 'var(--text-muted)' }}
      >
        {description}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 rounded-lg text-sm font-medium hover-lift press-scale"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
