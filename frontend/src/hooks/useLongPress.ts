/**
 * v3.3.0: Long-press hook for mobile message actions.
 * Fires callback after 500ms hold without movement.
 */
import { useRef, useCallback } from 'react';

const LONG_PRESS_MS = 500;
const MOVE_THRESHOLD = 10; // px — cancel if finger moves more than this

export function useLongPress(callback: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  const start = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startPos.current = { x: touch.clientX, y: touch.clientY };
    timerRef.current = setTimeout(() => {
      callback();
      timerRef.current = null;
    }, LONG_PRESS_MS);
  }, [callback]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPos.current = null;
  }, []);

  const move = useCallback((e: React.TouchEvent) => {
    if (!startPos.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startPos.current.x;
    const dy = touch.clientY - startPos.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD) {
      cancel();
    }
  }, [cancel]);

  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: move,
    onTouchCancel: cancel,
  };
}
