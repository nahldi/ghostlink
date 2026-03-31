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

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 12, filter: 'blur(4px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { type: 'spring', stiffness: 300, damping: 25 } },
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="flex flex-col items-center justify-center py-16 px-8 text-center"
    >
      <motion.span variants={fadeUp} className="text-5xl mb-4">{icon}</motion.span>
      <motion.h3
        variants={fadeUp}
        className="text-lg font-semibold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
      </motion.h3>
      <motion.p
        variants={fadeUp}
        className="text-sm max-w-sm mb-6"
        style={{ color: 'var(--text-muted)' }}
      >
        {description}
      </motion.p>
      {action && (
        <motion.button
          variants={fadeUp}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          onClick={action.onClick}
          className="px-4 py-2 rounded-lg text-sm font-medium hover-lift press-scale"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          {action.label}
        </motion.button>
      )}
    </motion.div>
  );
}
