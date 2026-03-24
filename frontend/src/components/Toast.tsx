/**
 * v2.4.0: Toast notification system with spring animations.
 * Usage: import { toast } from './Toast'; toast('Message saved', 'success');
 */
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

let _addToast: (msg: string, type: ToastType) => void = () => {};

export function toast(message: string, type: ToastType = 'info') {
  _addToast(message, type);
}

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const COLORS: Record<ToastType, string> = {
  success: 'border-green-500/50 bg-green-500/10',
  error: 'border-red-500/50 bg-red-500/10',
  warning: 'border-yellow-500/50 bg-yellow-500/10',
  info: 'border-blue-500/50 bg-blue-500/10',
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  _addToast = useCallback((message: string, type: ToastType) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-lg shadow-lg ${COLORS[t.type]}`}
            style={{ color: 'var(--text-primary)' }}
          >
            <span className="text-lg">{ICONS[t.type]}</span>
            <span className="text-sm font-medium">{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
