import { useState, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import type { WSConnectionState } from '../stores/chatStore';

export function ConnectionBanner() {
  const wsState = useChatStore((s) => s.wsState);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (wsState === 'disconnected') {
      setVisible(true);
      setRetryCountdown(5);
      const interval = setInterval(() => {
        setRetryCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    } else if (wsState === 'connected') {
      // Show connected briefly then hide
      if (visible) {
        const timer = setTimeout(() => setVisible(false), 2000);
        return () => clearTimeout(timer);
      }
    } else if (wsState === 'connecting') {
      setVisible(true);
    }
  }, [wsState]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  const stateConfig: Record<WSConnectionState, { color: string; bg: string; icon: string; text: string }> = {
    disconnected: {
      color: 'text-red-300',
      bg: 'bg-red-500/10 border-red-500/20',
      icon: 'cloud_off',
      text: retryCountdown > 0 ? `Connection lost. Retrying in ${retryCountdown}s...` : 'Connection lost. Reconnecting...',
    },
    connecting: {
      color: 'text-yellow-300',
      bg: 'bg-yellow-500/10 border-yellow-500/20',
      icon: 'sync',
      text: 'Reconnecting...',
    },
    connected: {
      color: 'text-green-300',
      bg: 'bg-green-500/10 border-green-500/20',
      icon: 'cloud_done',
      text: 'Connected',
    },
  };

  const config = stateConfig[wsState];

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-center py-1.5 px-4 border-b transition-all ${config.bg}`}>
      <div className="flex items-center gap-2">
        <span className={`material-symbols-outlined text-[16px] ${config.color} ${wsState === 'connecting' ? 'animate-spin' : ''}`}>
          {config.icon}
        </span>
        <span className={`text-[11px] font-medium ${config.color}`}>{config.text}</span>
      </div>
    </div>
  );
}
