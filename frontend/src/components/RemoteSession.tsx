import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import QRCodeLib from 'qrcode';

function QRCode({ url, onClose }: { url: string; onClose: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    // Generate real scannable QR code locally — URL never sent to external service
    QRCodeLib.toDataURL(url, {
      width: 220,
      margin: 2,
      color: { dark: '#09090f', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then(setQrDataUrl)
      .catch(() => {
        // Fallback: simple text display if QR generation fails
        const canvas = document.createElement('canvas');
        canvas.width = 220; canvas.height = 220;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, 220, 220);
          ctx.fillStyle = '#09090f';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Scan failed — copy URL', 110, 110);
        }
        setQrDataUrl(canvas.toDataURL('image/png'));
      });
  }, [url]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative rounded-2xl p-6 text-center max-w-xs glass-card"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-3 right-3 p-1 rounded-lg hover:bg-surface-container-high text-on-surface-variant/40 hover:text-on-surface-variant">
          <span className="material-symbols-outlined text-lg">close</span>
        </button>

        <div className="flex items-center justify-center gap-1.5 mb-4">
          <span className="material-symbols-outlined text-primary text-[18px]">phone_iphone</span>
          <span className="text-xs font-bold text-on-surface uppercase tracking-wider">Mobile Access</span>
        </div>

        <div className="bg-white rounded-xl p-3 mb-4 inline-block shadow-lg">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR Code" width={220} height={220} className="block rounded-lg" />
          ) : (
            <div className="w-[220px] h-[220px] flex items-center justify-center">
              <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          )}
        </div>

        <div className="text-[10px] text-on-surface-variant/40 mb-1">Scan with your phone camera</div>
        <div className="text-[10px] text-on-surface-variant/30 break-all font-mono px-2 py-1.5 rounded-lg bg-surface-container/40 mb-4 select-all">
          {url}
        </div>

        <div className="flex gap-2 justify-center">
          <button
            onClick={() => {
              navigator.clipboard?.writeText(url).catch(() => {});
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-on-surface-variant/60 hover:text-on-surface bg-surface-container/50 hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">content_copy</span>
            Copy URL
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-on-surface-variant/40 hover:text-on-surface-variant/60 transition-colors"
          >
            Done
          </button>
        </div>
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
    }).catch((e) => console.warn('Tunnel status fetch:', e.message || e));
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
    } catch (e) { console.warn('Stop tunnel:', e instanceof Error ? e.message : String(e)); }
    setActive(false);
    setUrl(null);
    setShowQR(false);
  }, []);

  const copy = useCallback(() => {
    if (!url) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
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
