import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export function RemoteSession() {
  const [active, setActive] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Check status on mount
  useEffect(() => {
    api.getTunnelStatus().then((s) => {
      setActive(s.active);
      setUrl(s.url);
    }).catch(() => {});
  }, []);

  const start = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.startTunnel();
      setUrl(res.url);
      setActive(true);
    } catch (e) {
      console.error('Failed to start tunnel:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await api.stopTunnel();
    } catch {}
    setActive(false);
    setUrl(null);
  }, []);

  const copy = useCallback(() => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [url]);

  // Inactive state — just a button
  if (!active && !loading) {
    return (
      <button
        onClick={start}
        title="Start Remote Session"
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <span className="material-symbols-outlined text-[20px]">phone_iphone</span>
      </button>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 rounded-lg text-on-surface-variant/60" title="Starting tunnel...">
        <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
        <span className="text-xs">Starting...</span>
      </div>
    );
  }

  // Active state
  const shortUrl = url ? url.replace('https://', '').slice(0, 28) + (url.replace('https://', '').length > 28 ? '...' : '') : '';

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-container" title="Remote session active">
      {/* Green dot */}
      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
      {/* Truncated URL */}
      <span className="text-xs text-on-surface-variant/80 max-w-[180px] truncate select-all">{shortUrl}</span>
      {/* Copy button */}
      <button
        onClick={copy}
        title={copied ? 'Copied!' : 'Copy URL'}
        className="flex items-center px-1 py-0.5 rounded text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high transition-colors"
      >
        <span className="material-symbols-outlined text-[16px]">
          {copied ? 'check' : 'content_copy'}
        </span>
      </button>
      {/* Stop button */}
      <button
        onClick={stop}
        title="Stop Remote Session"
        className="flex items-center px-1 py-0.5 rounded text-on-surface-variant/60 hover:text-red-400 hover:bg-surface-container-high transition-colors"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}
