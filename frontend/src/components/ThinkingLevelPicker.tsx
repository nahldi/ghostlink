import { useState } from 'react';
import { api } from '../lib/api';
import { toast } from './Toast';
import type { Agent } from '../types';

const OPTIONS: Array<{ value: '' | 'off' | 'minimal' | 'low' | 'medium' | 'high'; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function ThinkingLevelPicker({ agent }: { agent: Agent | null }) {
  const [saving, setSaving] = useState(false);

  if (!agent) return null;

  const current = agent.thinkingLevel || 'off';

  return (
    <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-surface-container-high/40 border border-outline-variant/10">
      <span className="material-symbols-outlined text-[15px] text-primary/70">neurology</span>
      <span className="text-[10px] uppercase tracking-wider text-on-surface-variant/45 font-semibold">Thinking</span>
      <select
        value={current}
        disabled={saving}
        onChange={async (e) => {
          const next = e.target.value as Agent['thinkingLevel'];
          setSaving(true);
          try {
            await api.setAgentConfig(agent.name, { thinkingLevel: next });
          } catch {
            toast('Failed to update thinking level', 'error');
          } finally {
            setSaving(false);
          }
        }}
        className="bg-transparent text-[11px] text-on-surface outline-none"
      >
        {OPTIONS.map((option) => (
          <option key={option.value || 'off'} value={option.value} className="bg-surface text-on-surface">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
