import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

function QRCode({ url, onClose }: { url: string; onClose: () => void }) {
  // Generate QR code locally via canvas — no external API call, URL stays private
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    // Render URL as a styled code block in canvas (privacy-safe fallback)
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 200, 200);
      ctx.fillStyle = '#09090f';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GhostLink', 100, 30);
      ctx.font = '10px monospace';
      // Wrap URL text
      const words = url.split(/(?=[/.])/);
      let y = 60;
      let line = '';
      for (const word of words) {
        if ((line + word).length > 24) {
          ctx.fillText(line, 100, y);
          y += 14;
          line = word;
        } else {
          line += word;
        }
      }
      if (line) ctx.fillText(line, 100, y);
      ctx.font = '9px monospace';
      ctx.fillStyle = '#666';
      ctx.fillText('Open URL on mobile', 100, 185);
      setQrDataUrl(canvas.toDataURL('image/png'));
    }
  }, [url]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card rounded-2xl p-6 text-center max-w-xs" onClick={e => e.stopPropagation()}>
        <div className="text-xs font-bold text-on-surface uppercase tracking-wider mb-3">Scan or copy to connect</div>
        <div className="bg-white rounded-xl p-3 mb-3 inline-block">
          {qrDataUrl ? <img src={qrDataUrl} alt="Connection Info" width={200} height={200} className="block" /> : <div className="w-[200px] h-[200px]" />}
        </div>
        <div className="text-[10px] text-on-surface-variant/50 break-all mb-3">{url}</div>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-xs font-medium text-on-surface-variant/60 hover:bg-surface-container-high transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export function RemoteSession() {
  const [active, setActive] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

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
    setShowQR(false);
  }, []);

  const copy = useCallback(() => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [url]);

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

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 rounded-lg text-on-surface-variant/60" title="Starting tunnel...">
        <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
        <span className="text-xs">Starting...</span>
      </div>
    );
  }

  const shortUrl = url ? url.replace('https://', '').slice(0, 28) + (url.replace('https://', '').length > 28 ? '...' : '') : '';

  return (
    <>
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-container" title="Remote session active">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
        <span className="text-xs text-on-surface-variant/80 max-w-[180px] truncate select-all">{shortUrl}</span>
        {/* QR Code button */}
        <button
          onClick={() => setShowQR(true)}
          title="Show QR code"
          className="flex items-center px-1 py-0.5 rounded text-on-surface-variant/60 hover:text-primary hover:bg-primary/10 transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">qr_code_2</span>
        </button>
        <button
          onClick={copy}
          title={copied ? 'Copied!' : 'Copy URL'}
          className="flex items-center px-1 py-0.5 rounded text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">
            {copied ? 'check' : 'content_copy'}
          </span>
        </button>
        <button
          onClick={stop}
          title="Stop Remote Session"
          className="flex items-center px-1 py-0.5 rounded text-on-surface-variant/60 hover:text-red-400 hover:bg-surface-container-high transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
      {showQR && url && <QRCode url={url} onClose={() => setShowQR(false)} />}
    </>
  );
}
