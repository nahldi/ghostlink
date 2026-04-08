import { useState, useRef, useEffect } from "react";
import { useChatStore } from "../../stores/chatStore";
import { api } from "../../lib/api";
import { Section, Toggle } from "./SettingsUI";
import type { Settings } from "../../types";

/* ── Tab: Advanced ───────────────────────────────────────────────── */

export function AdvancedTab({
  display,
  applyInstant,
  settings,
}: {
  display: Settings;
  applyInstant: (u: Partial<Settings>) => void;
  settings: Settings;
}) {
  return (
    <>
      <Section title="Developer Mode" icon="bug_report" defaultOpen>
        <Toggle label="Developer Mode" description="Show technical details and WebSocket events"
          checked={!!display.debugMode} onChange={() => applyInstant({ debugMode: !settings.debugMode })} activeColor="bg-yellow-500/80" />
      </Section>

      <Section title="Server Settings" icon="dns">
        <ServerConfigSection />
      </Section>

      <Section title="Server Logs" icon="terminal">
        <ServerLogsSection />
      </Section>

      <Section title="Maintenance" icon="build">
        <CleanupSection />
      </Section>
    </>
  );
}

/* ── ServerConfigSection ───────────────────────────────────────────── */

function ServerConfigSection() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- server config shape varies
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    fetch('/api/server-config').then(r => r.json()).then(setConfig).catch((e) => console.warn('Server config fetch:', e.message || e));
  }, []);

  if (!config) return null;

  const rows = [
    ['Server Port', config.server?.port],
    ['Host', config.server?.host],
    ['Data Directory', config.server?.data_dir],
    ['Upload Directory', config.server?.upload_dir],
    ['Max Upload Size', `${config.server?.max_upload_mb} MB`],
    ['MCP HTTP Port', config.mcp?.http_port],
    ['MCP SSE Port', config.mcp?.sse_port],
    ['Routing Mode', config.routing?.default],
    ['Max Agent Hops', config.routing?.max_hops],
    ['Agents Online', config.agents_online],
    ['Uptime', `${Math.floor(config.uptime / 60)}m ${Math.floor(config.uptime % 60)}s`],
  ];

  return (
    <div>
      <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2">Server Configuration</div>
      <div className="rounded-xl bg-surface-container/20 border border-outline-variant/8 overflow-hidden">
        {rows.map(([label, value], i) => (
          <div key={i} className={`flex justify-between px-3 py-1.5 text-[10px] ${i % 2 === 0 ? '' : 'bg-surface-container/10'}`}>
            <span className="text-on-surface-variant/50">{label}</span>
            <span className="text-on-surface font-mono">{value}</span>
          </div>
        ))}
      </div>
      <div className="text-[9px] text-on-surface-variant/30 mt-1.5">
        Edit backend/config.toml to change server ports and paths. Restart required.
      </div>
    </div>
  );
}

/* ── ServerLogsSection ─────────────────────────────────────────────── */

function ServerLogsSection() {
  const [logs, setLogs] = useState<{ timestamp: number; level: string; module: string; message: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const r = await fetch(`/api/logs?limit=100${filter ? `&level=${filter}` : ''}`);
          const d = await r.json();
          if (!cancelled) setLogs(d.logs || []);
        } catch (e) { console.warn('Logs poll:', e instanceof Error ? e.message : String(e)); }
        await new Promise(r => setTimeout(r, 3000));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [open, filter]);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [logs]);

  const levelColor = (l: string) => {
    switch (l) {
      case 'ERROR': return 'text-red-400';
      case 'WARNING': return 'text-yellow-400';
      case 'INFO': return 'text-blue-400';
      default: return 'text-on-surface-variant/40';
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">Server Logs</span>
        <button onClick={() => setOpen(!open)} className="text-[10px] font-medium text-primary hover:text-primary/80">
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/8 overflow-hidden">
          <div className="flex gap-1 px-2 py-1.5 border-b border-outline-variant/5">
            {['', 'ERROR', 'WARNING', 'INFO', 'DEBUG'].map(l => (
              <button key={l} onClick={() => setFilter(l)}
                className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${filter === l ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/40 hover:text-on-surface-variant/60'}`}>
                {l || 'All'}
              </button>
            ))}
          </div>
          <pre ref={preRef} className="max-h-[200px] overflow-auto p-2 text-[10px] font-mono leading-relaxed">
            {logs.length === 0 ? (
              <span className="text-on-surface-variant/30">No logs yet</span>
            ) : logs.map((l, i) => (
              <div key={i}>
                <span className="text-on-surface-variant/25">{new Date(l.timestamp * 1000).toLocaleTimeString()}</span>{' '}
                <span className={`font-bold ${levelColor(l.level)}`}>{l.level.padEnd(7)}</span>{' '}
                <span className="text-on-surface-variant/60">{l.message}</span>
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── CleanupSection (includes Stop Server) ───────────────────────── */

function CleanupSection() {
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [serverStopped, setServerStopped] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [diagChecks, setDiagChecks] = useState<{ name: string; status: string; detail: string }[] | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);

  const handleCleanup = async () => {
    setCleaning(true);
    setResult(null);
    try {
      const r = await api.cleanup();
      setResult(r.count > 0 ? `Cleaned ${r.count} stale session${r.count > 1 ? 's' : ''}` : 'Nothing to clean');
    } catch {
      setResult('Cleanup failed');
    }
    setCleaning(false);
    setTimeout(() => setResult(null), 3000);
  };

  const handleStopServer = async () => {
    if (!confirmStop) {
      setConfirmStop(true);
      setTimeout(() => setConfirmStop(false), 5000);
      return;
    }
    setStopping(true);
    setConfirmStop(false);
    try {
      await api.stopServer();
      setServerStopped(true);
    } catch {
      // Server likely already killed itself before response arrived — that's expected
      setServerStopped(true);
    }
    setStopping(false);
  };

  return (
    <div>
      <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2">
        Maintenance
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleCleanup}
          disabled={cleaning}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container/40 border border-outline-variant/8 text-xs font-medium text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container/60 transition-all disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">{cleaning ? 'hourglass_empty' : 'cleaning_services'}</span>
          {cleaning ? 'Cleaning...' : 'Clean Stale Sessions'}
        </button>
        {result && (
          <span className="text-[11px] text-green-400/70">{result}</span>
        )}
      </div>
      <p className="text-[9px] text-on-surface-variant/30 mt-1.5">
        Kills orphaned tmux sessions and dead processes to free up resources
      </p>

      {/* Diagnostics */}
      <div className="mt-3">
        <button
          onClick={async () => {
            setDiagLoading(true);
            try {
              const r = await fetch('/api/diagnostics').then(r => r.json());
              setDiagChecks(r.checks);
            } catch { setDiagChecks(null); }
            setDiagLoading(false);
          }}
          disabled={diagLoading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container/40 border border-outline-variant/8 text-xs font-medium text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container/60 transition-all disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">{diagLoading ? 'hourglass_empty' : 'health_and_safety'}</span>
          {diagLoading ? 'Running...' : 'Run Diagnostics'}
        </button>
        {diagChecks && (
          <div className="mt-2 rounded-xl bg-surface-container/20 border border-outline-variant/8 overflow-hidden">
            {diagChecks.map((c, i) => (
              <div key={c.name} className={`flex items-center justify-between px-3 py-1.5 text-[10px] ${i % 2 === 0 ? '' : 'bg-surface-container/10'}`}>
                <span className="text-on-surface-variant/60">{c.name.replace(/_/g, ' ')}</span>
                <span className={`font-mono ${c.status === 'ok' ? 'text-green-400/70' : c.status === 'warn' ? 'text-yellow-400/70' : c.status === 'error' ? 'text-red-400/70' : 'text-on-surface-variant/40'}`}>{c.detail}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[9px] text-on-surface-variant/30 mt-1.5">
          Checks Python, database, disk space, agents, ports, and dependencies
        </p>
      </div>

      {/* Backup */}
      <div className="mt-3">
        <button
          onClick={async () => {
            setBackupLoading(true);
            try {
              const resp = await fetch('/api/backup');
              const blob = await resp.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = resp.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || 'ghostlink-backup.zip';
              a.click();
              URL.revokeObjectURL(url);
            } catch { /* download failed */ }
            setBackupLoading(false);
          }}
          disabled={backupLoading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container/40 border border-outline-variant/8 text-xs font-medium text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container/60 transition-all disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">{backupLoading ? 'hourglass_empty' : 'backup'}</span>
          {backupLoading ? 'Creating backup...' : 'Download Backup'}
        </button>
        <p className="text-[9px] text-on-surface-variant/30 mt-1.5">
          Downloads a ZIP of all data: messages, settings, configs, agent memory, uploads
        </p>
      </div>

      {/* Restore from backup */}
      <div className="mt-3">
        <button
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.zip';
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file) return;
              setRestoreResult(null);
              const form = new FormData();
              form.append('file', file);
              try {
                const r = await fetch('/api/restore', { method: 'POST', body: form }).then(r => r.json());
                if (r.error) { setRestoreResult(`Error: ${r.error}`); }
                else { setRestoreResult(`Restored ${r.restored} items. Reload to apply.`); }
              } catch { setRestoreResult('Restore failed'); }
              setTimeout(() => setRestoreResult(null), 8000);
            };
            input.click();
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container/40 border border-outline-variant/8 text-xs font-medium text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container/60 transition-all"
        >
          <span className="material-symbols-outlined text-[16px]">restore</span>
          Restore from Backup
        </button>
        {restoreResult && (
          <span className={`text-[11px] mt-1 block ${restoreResult.startsWith('Error') ? 'text-red-400/70' : 'text-green-400/70'}`}>{restoreResult}</span>
        )}
        <p className="text-[9px] text-on-surface-variant/30 mt-1.5">
          Upload a backup ZIP to restore settings, messages, and configs. Current data is backed up first.
        </p>
      </div>

      {/* Re-run Wizard */}
      <div className="mt-3">
        <button
          onClick={() => {
            localStorage.removeItem('ghostlink_setup_complete');
            useChatStore.getState().updateSettings({ setupComplete: false });
            api.saveSettings({ setupComplete: false }).catch((e) => console.error('Failed to persist setup reset:', e));
            window.location.reload();
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container/40 border border-outline-variant/8 text-xs font-medium text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container/60 transition-all"
        >
          <span className="material-symbols-outlined text-[16px]">restart_alt</span>
          Re-run Setup Wizard
        </button>
        <p className="text-[9px] text-on-surface-variant/30 mt-1.5">
          Re-opens the first-run wizard to update platform, shell, and workspace settings
        </p>
      </div>

      {/* Stop Server */}
      <div className="mt-3">
        {serverStopped ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-medium text-red-400">
            <span className="material-symbols-outlined text-[16px]">power_settings_new</span>
            Server stopped. Reload or restart to reconnect.
          </div>
        ) : (
          <button
            onClick={handleStopServer}
            disabled={stopping}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all disabled:opacity-50 ${
              confirmStop
                ? 'bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/25'
                : 'bg-surface-container/40 border-outline-variant/8 text-on-surface-variant/60 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {stopping ? 'hourglass_empty' : 'power_settings_new'}
            </span>
            {stopping ? 'Stopping...' : confirmStop ? 'Click again to confirm' : 'Stop Server'}
          </button>
        )}
        <p className="text-[9px] text-on-surface-variant/30 mt-1.5">
          Kills all agents and shuts down the backend server
        </p>
      </div>
    </div>
  );
}

