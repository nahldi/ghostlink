import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export function UpdateBanner() {
  const [update, setUpdate] = useState<{ version: string; release_notes: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const health = await api.getHealth();
        if (!cancelled && health.update_available) {
          setUpdate(health.update_available);
        }
      } catch { /* server not reachable */ }
    };
    check();
    const interval = setInterval(check, 60_000); // check every 60s
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (!update || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-4">
      <div className="bg-primary/95 text-white rounded-xl p-4 shadow-2xl backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[20px] mt-0.5">system_update</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Update Available</div>
            <div className="text-xs opacity-80 mt-0.5">Version {update.version} is ready to install</div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="p-1 rounded-lg hover:bg-white/20 transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => {
              // Trigger download + install via the launcher's update flow
              window.location.href = `https://github.com/nahldi/ghostlink/releases/tag/v${update.version}`;
            }}
            className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-white text-primary hover:bg-white/90 transition-colors"
          >
            Download Update
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="text-xs font-medium py-1.5 px-3 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
