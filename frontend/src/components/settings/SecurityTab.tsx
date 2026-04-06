import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { Section } from './SettingsUI';
import type { RetentionPolicy, AuditLogEntry } from '../../types';

export function SecurityTab() {
  return (
    <>
      <Section title="Secrets" icon="key" defaultOpen>
        <SecretsSection />
      </Section>
      <Section title="Permission Presets" icon="shield">
        <PermissionPresetsSection />
      </Section>
      <Section title="Tool Usage Log" icon="build">
        <ToolLogSection />
      </Section>
      <Section title="Data Retention" icon="schedule">
        <RetentionSection />
      </Section>
      <Section title="Data Management" icon="database">
        <DataManagementSection />
      </Section>
      <Section title="Audit Log" icon="history">
        <AuditLogSection />
      </Section>
    </>
  );
}

function PermissionPresetsSection() {
  const [presets, setPresets] = useState<{ id: string; name: string; description: string }[]>([]);
  useEffect(() => {
    fetch('/api/security/permission-presets').then(r => r.json()).then(d => setPresets(d.presets || [])).catch((e) => console.error('Failed to load permission presets:', e));
  }, []);
  return (
    <div>
      <div className="text-[10px] text-on-surface-variant/50 mb-2">Available presets for agent permissions. Assign via agent config.</div>
      <div className="space-y-1.5">
        {presets.map(p => (
          <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-container/30">
            <span className="material-symbols-outlined text-[14px] text-primary/60">verified_user</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-on-surface">{p.name}</div>
              <div className="text-[9px] text-on-surface-variant/40">{p.description}</div>
            </div>
          </div>
        ))}
        {presets.length === 0 && <div className="text-[10px] text-on-surface-variant/40 text-center py-2">Loading presets...</div>}
      </div>
    </div>
  );
}

function ToolLogSection() {
  const [entries, setEntries] = useState<{ tool: string; actor: string; timestamp: string; details: Record<string, unknown> }[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    fetch('/api/security/tool-log?limit=50').then(r => r.json()).then(d => setEntries(d.entries || [])).catch((e) => console.error('Failed to load tool log:', e));
  }, [open]);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">MCP Tool Calls</span>
        <button onClick={() => setOpen(!open)} className="text-[10px] font-medium text-primary hover:text-primary/80">{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/8 max-h-[200px] overflow-auto">
          {entries.length === 0 ? (
            <div className="text-[10px] text-on-surface-variant/30 text-center py-4">No tool calls recorded</div>
          ) : (
            <div className="divide-y divide-outline-variant/5">
              {entries.map((e, i) => (
                <div key={i} className="px-3 py-1.5 flex items-center gap-2">
                  <span className="text-[9px] text-on-surface-variant/30 w-16 shrink-0 font-mono">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  <span className="text-[10px] font-medium text-primary/70 w-20 shrink-0 truncate">{e.actor}</span>
                  <span className="text-[10px] text-on-surface/70 font-mono">{e.tool || (e.details as Record<string, string>)?.tool || '?'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SecretsSection() {
  const [secrets, setSecrets] = useState<{ key: string; preview: string; length: number }[]>([]);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secretError, setSecretError] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const load = () => { api.getSecrets().then(r => setSecrets(r.secrets || [])).catch((e) => console.warn('Secrets fetch:', e instanceof Error ? e.message : String(e))); };
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim() || saving) return;
    setSaving(true);
    setSecretError('');
    try {
      await api.setSecret(newKey.trim(), newValue.trim());
      setNewKey(''); setNewValue(''); setAdding(false);
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSecretError(msg);
      console.warn('Set secret:', msg);
    }
    setSaving(false);
  };

  const handleDelete = async (key: string) => {
    try { await api.deleteSecret(key); load(); } catch (e) { console.warn('Delete secret:', e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">Secrets Vault</span>
        <button onClick={() => setAdding(!adding)} className="text-[10px] font-medium text-primary hover:text-primary/80">{adding ? 'Cancel' : '+ Add'}</button>
      </div>
      <div className="text-[9px] text-on-surface-variant/35 mb-2">Encrypted storage for API keys and tokens. Values are never logged or exposed.</div>
      {adding && (
        <div className="p-3 rounded-xl bg-surface-container/30 border border-outline-variant/8 space-y-2 mb-2">
          <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Key name (e.g. ANTHROPIC_API_KEY)" className="w-full bg-surface-container-highest rounded-md px-2 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 outline-none" />
          <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Secret value" type="password" className="w-full bg-surface-container-highest rounded-md px-2 py-1.5 text-[11px] text-on-surface border border-outline-variant/10 outline-none font-mono" />
          {secretError && <div className="text-red-400 text-[9px]">{secretError}</div>}
          <button onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim() || saving} className="w-full py-1.5 rounded-lg bg-primary/15 text-primary text-[11px] font-semibold hover:bg-primary/25 transition-colors disabled:opacity-40">{saving ? 'Saving...' : 'Save Secret'}</button>
        </div>
      )}
      <div className="space-y-1">
        {secrets.map(s => (
          <div key={s.key} className="flex items-center gap-2 p-2 rounded-lg bg-surface-container/30 border border-outline-variant/5">
            <span className="material-symbols-outlined text-[14px] text-primary/50">key</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-on-surface font-mono">{s.key}</div>
              <div className="text-[9px] text-on-surface-variant/40">{s.preview} ({s.length} chars)</div>
            </div>
            <button onClick={() => handleDelete(s.key)} className="p-1 rounded text-on-surface-variant/40 hover:text-red-400 hover:bg-red-400/10 transition-colors">
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        ))}
        {secrets.length === 0 && !adding && <div className="text-[10px] text-on-surface-variant/30 text-center py-3">No secrets stored</div>}
      </div>
    </div>
  );
}

function RetentionSection() {
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);

  useEffect(() => { api.getRetention().then(r => setPolicy(r.policy)).catch((e) => console.warn('Retention fetch:', e instanceof Error ? e.message : String(e))); }, []);

  const handleSave = async (updates: Partial<RetentionPolicy>) => {
    if (!policy) return;
    const updated: RetentionPolicy = { ...policy, ...updates };
    setPolicy(updated);
    try { await api.setRetention(updated); } catch (e) { console.warn('Retention save:', e instanceof Error ? e.message : String(e)); }
  };

  if (!policy) return null;

  return (
    <div>
      <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2">Data Retention</div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] text-on-surface">Auto-delete old messages</div>
            <div className="text-[9px] text-on-surface-variant/40">Automatically delete messages older than the retention period</div>
          </div>
          <button onClick={() => handleSave({ enabled: !policy.enabled })}
            className={`w-8 h-4 rounded-full transition-all relative ${policy.enabled ? 'bg-green-500/80' : 'bg-surface-container-highest'}`}>
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${policy.enabled ? 'left-4' : 'left-0.5'}`} />
          </button>
        </div>
        {policy.enabled && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-on-surface-variant/50">Keep messages for</span>
            <input type="number" value={policy.max_age_days} onChange={e => handleSave({ max_age_days: parseInt(e.target.value, 10) || 90 })} min={1} max={365}
              className="w-16 bg-surface-container-highest rounded-md px-2 py-1 text-[11px] text-on-surface border border-outline-variant/10 outline-none text-center" />
            <span className="text-[10px] text-on-surface-variant/50">days</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DataManagementSection() {
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'ghostlink-export.zip';
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { console.warn('Export:', e instanceof Error ? e.message : String(e)); }
    setExporting(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      await api.deleteAllData();
      window.location.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      console.warn('Delete all:', msg);
    }
    setDeleting(false);
  };

  return (
    <div>
      <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2">Data Management</div>
      <div className="space-y-2">
        <button onClick={handleExport} disabled={exporting}
          className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-surface-container/20 border border-outline-variant/8 hover:border-primary/20 transition-all disabled:opacity-40 text-left">
          <span className="material-symbols-outlined text-[16px] text-primary">download</span>
          <div>
            <div className="text-[11px] font-semibold text-on-surface">{exporting ? 'Exporting...' : 'Export All Data'}</div>
            <div className="text-[8px] text-on-surface-variant/40">Download messages, settings, memories as ZIP</div>
          </div>
        </button>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)}
            className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-red-500/5 border border-red-500/10 hover:border-red-500/20 transition-all text-left">
            <span className="material-symbols-outlined text-[16px] text-red-400">delete_forever</span>
            <div>
              <div className="text-[11px] font-semibold text-red-400">Delete All Data</div>
              <div className="text-[8px] text-on-surface-variant/40">Permanently erase all messages, settings, and agent data</div>
            </div>
          </button>
        ) : (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 space-y-2">
            <div className="text-[11px] font-semibold text-red-400">Are you absolutely sure?</div>
            <div className="text-[9px] text-on-surface-variant/50">This will permanently delete all messages, settings, agent memories, and uploaded files. This cannot be undone.</div>
            <div className="flex gap-2">
              <button onClick={handleDelete} disabled={deleting} className="flex-1 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-[11px] font-semibold hover:bg-red-500/30 disabled:opacity-40">{deleting ? 'Deleting...' : 'Yes, Delete Everything'}</button>
              <button onClick={() => setConfirmDelete(false)} className="flex-1 py-1.5 rounded-lg bg-surface-container text-on-surface-variant/60 text-[11px] font-semibold hover:bg-surface-container-high">Cancel</button>
            </div>
            {error && <div className="text-red-400 text-[9px] mt-2">Error: {error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function AuditLogSection() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.getAuditLog(50).then(r => setEntries(r.entries || [])).catch((e) => console.warn('Audit log:', e instanceof Error ? e.message : String(e)));
  }, [open]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">Audit Log</span>
        <button onClick={() => setOpen(!open)} className="text-[10px] font-medium text-primary hover:text-primary/80">{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/8 max-h-[200px] overflow-auto">
          {entries.length === 0 ? (
            <div className="text-[10px] text-on-surface-variant/30 text-center py-4">No audit events</div>
          ) : entries.map((e, i) => (
            <div key={i} className={`px-3 py-1.5 text-[10px] ${i % 2 === 0 ? '' : 'bg-surface-container/10'}`}>
              <span className="text-on-surface-variant/25">{new Date(e.timestamp * 1000).toLocaleString()}</span>{' '}
              <span className="font-semibold text-primary/70">{e.type}</span>{' '}
              <span className="text-on-surface-variant/50">by {e.actor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
