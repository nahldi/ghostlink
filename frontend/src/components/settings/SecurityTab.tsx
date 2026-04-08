import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { toast } from '../Toast';
import { Section } from './SettingsUI';
import type {
  AuditLogEntry,
  CircuitEvent,
  EgressRule,
  PolicyRule,
  RetentionPolicy,
  SecretScope,
} from '../../types';

export function SecurityTab({ experienceMode }: { experienceMode?: string }) {
  const isAdvanced = experienceMode === 'advanced';

  return (
    <>
      {/* Secrets and Data Management visible to all users */}
      <Section title="Secrets" icon="key" defaultOpen>
        <SecretsSection />
      </Section>
      <Section title="Data Management" icon="database">
        <DataManagementSection />
      </Section>

      {/* Everything below is Advanced-only */}
      {isAdvanced && (
        <>
          <Section title="Policy Rules" icon="policy">
            <PolicyRulesSection />
          </Section>
          <Section title="Rate Protection" icon="shield_lock">
            <CircuitEventsSection />
          </Section>
          <Section title="Outbound Access Rules" icon="language">
            <EgressRulesSection />
          </Section>
          <Section title="Secret Scopes" icon="lock_person">
            <SecretScopesSection />
          </Section>
          <Section title="Trusted Hooks" icon="verified_user">
            <TrustedHooksSection />
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
          <Section title="Audit Log" icon="history">
            <AuditLogSection />
          </Section>
        </>
      )}
    </>
  );
}

function Chip({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const cls =
    tone === 'good' ? 'bg-green-500/10 text-green-300 border-green-500/20' :
    tone === 'warn' ? 'bg-amber-500/10 text-amber-300 border-amber-500/20' :
    tone === 'bad' ? 'bg-red-500/10 text-red-300 border-red-500/20' :
    'bg-surface-container-high/40 text-on-surface-variant/55 border-outline-variant/10';
  return <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${cls}`}>{children}</span>;
}

function PolicyRulesSection() {
  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<PolicyRule>({
    scope_type: 'environment',
    scope_id: '*',
    action: '*',
    tier: 'shell_exec',
    behavior: 'ask',
    priority: 0,
    conditions: {},
    created_by: 'user',
    enabled: true,
  });

  useEffect(() => {
    let cancelled = false;
    api.getPolicyRules()
      .then((result) => {
        if (!cancelled) setRules(result.rules);
      })
      .catch(() => {
        if (!cancelled) toast('Failed to load policy rules', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    const counts = { allow: 0, ask: 0, deny: 0, escalate: 0 };
    rules.forEach((rule) => {
      if (rule.behavior in counts) counts[rule.behavior as keyof typeof counts] += 1;
    });
    return counts;
  }, [rules]);

  const saveRule = async () => {
    try {
      const result = await api.createPolicyRule(form);
      setRules(result.rules || []);
      setForm({
        scope_type: 'environment',
        scope_id: '*',
        action: '*',
        tier: 'shell_exec',
        behavior: 'ask',
        priority: 0,
        conditions: {},
        created_by: 'user',
        enabled: true,
      });
      toast('Policy rule saved', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to save policy rule', 'error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-on-surface-variant/45">
        Real Phase 4A rules. These are the engine rows Tyson moved into SQLite, not legacy advisory presets.
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip tone="good">allow {summary.allow}</Chip>
        <Chip tone="warn">ask {summary.ask}</Chip>
        <Chip tone="bad">deny {summary.deny}</Chip>
        <Chip>escalate {summary.escalate}</Chip>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <select value={form.scope_type} onChange={(e) => setForm((current) => ({ ...current, scope_type: e.target.value }))} className="setting-input">
          {['environment', 'workspace', 'profile', 'provider', 'agent', 'task', 'tool'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input value={form.scope_id} onChange={(e) => setForm((current) => ({ ...current, scope_id: e.target.value }))} placeholder="scope id" className="setting-input" />
        <input value={form.action} onChange={(e) => setForm((current) => ({ ...current, action: e.target.value }))} placeholder="action" className="setting-input" />
        <select value={form.tier} onChange={(e) => setForm((current) => ({ ...current, tier: e.target.value }))} className="setting-input">
          {['read_only', 'low_risk_write', 'high_risk_write', 'shell_exec', 'network_egress', 'secrets_access', 'git_mutation', 'external_messaging', 'deployment'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select value={form.behavior} onChange={(e) => setForm((current) => ({ ...current, behavior: e.target.value }))} className="setting-input">
          {['allow', 'ask', 'deny', 'escalate'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input
          type="number"
          value={form.priority}
          onChange={(e) => setForm((current) => ({ ...current, priority: Number(e.target.value) || 0 }))}
          placeholder="priority"
          className="setting-input"
        />
      </div>
      <button onClick={saveRule} className="rounded-lg bg-primary/15 px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/25">
        Add policy rule
      </button>
      <div className="space-y-1.5">
        {loading ? (
          <div className="text-[10px] text-on-surface-variant/35">Loading rules...</div>
        ) : rules.length === 0 ? (
          <div className="text-[10px] text-on-surface-variant/35">No policy rules found.</div>
        ) : rules.slice(0, 12).map((rule) => (
          <div key={`${rule.id}-${rule.scope_type}-${rule.scope_id}-${rule.action}`} className="rounded-lg border border-outline-variant/8 bg-surface-container/20 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip>{rule.scope_type}:{rule.scope_id}</Chip>
              <Chip>{rule.action}</Chip>
              <Chip>{rule.tier}</Chip>
              <Chip tone={rule.behavior === 'allow' ? 'good' : rule.behavior === 'ask' ? 'warn' : 'bad'}>{rule.behavior}</Chip>
              <Chip>p{rule.priority}</Chip>
            </div>
            {rule.conditions && Object.keys(rule.conditions).length > 0 && (
              <div className="mt-1 text-[9px] text-on-surface-variant/40 font-mono">
                {JSON.stringify(rule.conditions)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EgressRulesSection() {
  const [rules, setRules] = useState<EgressRule[]>([]);
  const [form, setForm] = useState<EgressRule>({
    scope_type: 'environment',
    scope_id: '*',
    rule_type: 'allow',
    domain: '',
    protocol: '*',
    port: 0,
    priority: 0,
  });

  const load = () => {
    api.getEgressRules()
      .then((result) => setRules(result.rules))
      .catch(() => toast('Failed to load egress rules', 'error'));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.domain.trim()) return;
    try {
      const result = await api.createEgressRule(form);
      setRules(result.rules || []);
      setForm({ scope_type: 'environment', scope_id: '*', rule_type: 'allow', domain: '', protocol: '*', port: 0, priority: 0 });
      toast('Egress rule saved', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to save egress rule', 'error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-on-surface-variant/45">
        Allowlist and denylist rows for outbound network access. SSRF blocking is still hard-deny even when you allow a domain.
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <select value={form.scope_type} onChange={(e) => setForm((current) => ({ ...current, scope_type: e.target.value }))} className="setting-input">
          {['environment', 'workspace', 'agent', 'task'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input value={form.scope_id} onChange={(e) => setForm((current) => ({ ...current, scope_id: e.target.value }))} placeholder="scope id" className="setting-input" />
        <select value={form.rule_type} onChange={(e) => setForm((current) => ({ ...current, rule_type: e.target.value }))} className="setting-input">
          {['allow', 'deny'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input value={form.domain} onChange={(e) => setForm((current) => ({ ...current, domain: e.target.value }))} placeholder="domain or *.domain.com" className="setting-input" />
      </div>
      <button onClick={save} className="rounded-lg bg-primary/15 px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/25">
        Add egress rule
      </button>
      <div className="space-y-1.5">
        {rules.length === 0 ? (
          <div className="text-[10px] text-on-surface-variant/35">No egress rules found.</div>
        ) : rules.slice(0, 12).map((rule) => (
          <div key={`${rule.id}-${rule.scope_type}-${rule.scope_id}-${rule.domain}`} className="rounded-lg border border-outline-variant/8 bg-surface-container/20 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip>{rule.scope_type}:{rule.scope_id}</Chip>
              <Chip tone={rule.rule_type === 'deny' ? 'bad' : 'good'}>{rule.rule_type}</Chip>
              <Chip>{rule.domain}</Chip>
              <Chip>{rule.protocol || '*'}</Chip>
              <Chip>port {rule.port || '*'}</Chip>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SecretScopesSection() {
  const [scopes, setScopes] = useState<SecretScope[]>([]);
  const [form, setForm] = useState<SecretScope>({ secret_key: '', scope_type: 'provider', scope_id: '' });

  const load = () => {
    api.getSecretScopes()
      .then((result) => setScopes(result.scopes))
      .catch(() => toast('Failed to load secret scopes', 'error'));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.secret_key.trim() || !form.scope_id.trim()) return;
    try {
      const result = await api.bindSecretScope(form);
      setScopes(result.scopes || []);
      setForm({ secret_key: '', scope_type: 'provider', scope_id: '' });
      toast('Secret scope saved', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to save secret scope', 'error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-on-surface-variant/45">
        Scope bindings control which agent, provider, profile, or task can actually read a secret. Values stay hidden here too.
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <input value={form.secret_key} onChange={(e) => setForm((current) => ({ ...current, secret_key: e.target.value }))} placeholder="secret key" className="setting-input" />
        <select value={form.scope_type} onChange={(e) => setForm((current) => ({ ...current, scope_type: e.target.value }))} className="setting-input">
          {['workspace', 'profile', 'agent', 'task', 'provider', 'environment'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input value={form.scope_id} onChange={(e) => setForm((current) => ({ ...current, scope_id: e.target.value }))} placeholder="scope id" className="setting-input" />
      </div>
      <button onClick={save} className="rounded-lg bg-primary/15 px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/25">
        Bind secret scope
      </button>
      <div className="space-y-1.5">
        {scopes.length === 0 ? (
          <div className="text-[10px] text-on-surface-variant/35">No scoped secrets yet.</div>
        ) : scopes.slice(0, 12).map((scope) => (
          <div key={`${scope.secret_key}-${scope.scope_type}-${scope.scope_id}`} className="rounded-lg border border-outline-variant/8 bg-surface-container/20 px-3 py-2">
            <div className="flex flex-wrap gap-1.5">
              <Chip>{scope.secret_key}</Chip>
              <Chip>{scope.scope_type}</Chip>
              <Chip>{scope.scope_id}</Chip>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrustedHooksSection() {
  const [hookName, setHookName] = useState('');
  const [signature, setSignature] = useState('');

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-on-surface-variant/45">
        Block-type hooks only run when the signature is trusted. This is the manual trust gate Tyson added on the backend.
      </div>
      <input value={hookName} onChange={(e) => setHookName(e.target.value)} placeholder="hook name" className="setting-input" />
      <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="signature" className="setting-input font-mono" />
      <button
        onClick={async () => {
          try {
            await api.trustHookSignature(hookName, signature);
            setHookName('');
            setSignature('');
            toast('Trusted hook saved', 'success');
          } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to trust hook', 'error');
          }
        }}
        className="rounded-lg bg-primary/15 px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/25"
      >
        Trust hook signature
      </button>
    </div>
  );
}

function CircuitEventsSection() {
  const [events, setEvents] = useState<CircuitEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getCircuitEvents(50)
      .then((result) => setEvents(result.events))
      .catch(() => toast('Failed to load circuit events', 'error'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-on-surface-variant/45">
        Active and recent breaker trips. If this is empty while destructive behavior is running hot, that is a backend bug, not a UX choice.
      </div>
      {loading ? (
        <div className="text-[10px] text-on-surface-variant/35">Loading circuit state...</div>
      ) : events.length === 0 ? (
        <div className="text-[10px] text-on-surface-variant/35">No circuit events recorded.</div>
      ) : (
        <div className="space-y-1.5">
          {events.slice(0, 12).map((event, index) => (
            <div key={`${event.id || index}-${event.created_at || 0}`} className="rounded-lg border border-outline-variant/8 bg-surface-container/20 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip tone="bad">{event.trigger_type || event.event_key || 'circuit'}</Chip>
                {event.agent_name && <Chip>{event.agent_name}</Chip>}
                {event.task_id && <Chip>{event.task_id.slice(0, 8)}</Chip>}
                {event.cooldown_until && <Chip tone="warn">cooldown until {new Date(event.cooldown_until * 1000).toLocaleTimeString()}</Chip>}
              </div>
              {(event.detail || event.actual_value || event.threshold) && (
                <div className="mt-1 text-[9px] text-on-surface-variant/40">
                  {event.actual_value != null && event.threshold != null
                    ? `threshold ${event.actual_value}/${event.threshold}`
                    : JSON.stringify(event.detail || {})}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
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
              <div className="text-[8px] text-on-surface-variant/40">Permanently erase all messages, settings, agent memories, and uploaded files</div>
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
