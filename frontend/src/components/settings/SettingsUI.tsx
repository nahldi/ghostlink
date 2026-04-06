import { useState } from 'react';
import type { Settings } from '../../types';

export type TabProps = {
  display: Settings;
  updateDraft: (u: Partial<Settings>) => void;
  applyInstant: (u: Partial<Settings>) => void;
  settings: Settings;
};

/* ── Collapsible Section ─────────────────────────────────────────── */

export function Section({ title, icon, defaultOpen = false, children }: {
  title: string;
  icon?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="setting-section">
      <button className="setting-section-header w-full" onClick={() => setOpen(!open)}>
        {icon && <span className="material-symbols-outlined text-[16px] text-on-surface-variant/50">{icon}</span>}
        <span className="text-[11px] font-semibold text-on-surface/80 flex-1 text-left">{title}</span>
        <span className={`material-symbols-outlined text-[16px] text-on-surface-variant/30 transition-transform ${open ? 'rotate-180' : ''}`}>expand_more</span>
      </button>
      <div className={`setting-section-content ${open ? '' : 'collapsed'}`}>
        <div className="inner space-y-3">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ── Reusable Toggle ─────────────────────────────────────────────── */

export function Toggle({
  checked,
  onChange,
  label,
  description,
  activeColor = 'bg-green-500/80',
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description?: string;
  activeColor?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex-1 mr-3">
        <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">
          {label}
        </div>
        {description && (
          <p className="text-[9px] text-on-surface-variant/30 mt-0.5">{description}</p>
        )}
      </div>
      <button
        onClick={onChange}
        className={`relative w-10 h-5 rounded-full transition-all shrink-0 ${
          checked ? activeColor : 'bg-outline-variant/45'
        }`}
      >
        <div
          className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all shadow-sm ${
            checked ? 'right-0.5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

/* ── Setting Field ───────────────────────────────────────────────── */

export function SettingField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-on-surface-variant/50 uppercase tracking-wider mb-2 block">
        {label}
      </label>
      {children}
    </div>
  );
}
