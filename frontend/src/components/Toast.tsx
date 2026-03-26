/**
 * v2.4.0: Toast notification system with spring animations.
 * v3.2.0: Stacking offset, swipe-to-dismiss, max 5 visible.
 * Usage: import { toast } from './Toast'; toast('Message saved', 'success');
 */
import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

const MAX_TOASTS = 5;

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

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = crypto.randomUUID();
    setToasts(prev => {
      // Cap at MAX_TOASTS — drop oldest if needed
      const next = [...prev, { id, message, type }];
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  // Register the add function for the module-level toast() helper
  useEffect(() => { _addToast = addToast; return () => { _addToast = () => {}; }; }, [addToast]);

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 items-end">
      <AnimatePresence>
        {toasts.map((t, i) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 60, scale: 0.92 }}
            animate={{
              opacity: 1,
              x: 0,
              scale: 1 - (toasts.length - 1 - i) * 0.02,  // slight scale stacking
              y: (toasts.length - 1 - i) * -2,             // slight y offset stacking
            }}
            exit={{ opacity: 0, x: 80, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            drag="x"
            dragConstraints={{ left: 0, right: 80 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.x > 50) dismiss(t.id);
            }}
            onClick={() => dismiss(t.id)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-lg shadow-lg cursor-pointer select-none ${COLORS[t.type]}`}
            style={{ color: 'var(--text-primary)' }}
          >
            <span className="text-lg">{ICONS[t.type]}</span>
            <span className="text-sm font-medium">{t.message}</span>
            <span className="text-xs text-on-surface-variant/40 ml-1">✕</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
