import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';

export function ConnectionBanner() {
  const wsState = useChatStore((s) => s.wsState);

  return (
    <AnimatePresence>
      {wsState !== 'connected' && (
        <motion.div
          key="connection-banner"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className={`fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-2 py-2 text-xs font-medium ${
            wsState === 'disconnected'
              ? 'bg-red-500/90 text-white'
              : 'bg-yellow-500/90 text-black'
          }`}
        >
          <span className={`material-symbols-outlined text-sm ${wsState === 'connecting' ? 'animate-spin' : ''}`}>
            {wsState === 'disconnected' ? 'cloud_off' : 'sync'}
          </span>
          {wsState === 'disconnected' ? 'Connection lost. Trying to reconnect...' : 'Reconnecting...'}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
