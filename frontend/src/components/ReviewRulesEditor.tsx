import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { ReviewRule } from '../types';
import { toast } from './Toast';
import { Section, SettingField } from './settings/SettingsUI';

function severityTone(severity: string) {
  switch (severity) {
    case 'high':
      return 'text-red-400';
    case 'medium':
      return 'text-amber-400';
    default:
      return 'text-sky-400';
  }
}

export function ReviewRulesEditor() {
  const [rules, setRules] = useState<ReviewRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    rule_text: '',
    category: 'custom',
    match_text: '',
    suggestion: '',
    severity: 'medium',
  });

  const loadRules = async () => {
    setLoading(true);
    try {
      const result = await api.getReviewRules();
      setRules(result.rules);
    } catch (error) {
      console.error('Failed to load review rules:', error);
      toast('Failed to load review rules', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules().catch(() => undefined);
  }, []);

  const learnedRules = useMemo(() => rules.filter((rule) => rule.origin === 'learned'), [rules]);
  const manualRules = useMemo(() => rules.filter((rule) => rule.origin !== 'learned'), [rules]);

  const createRule = async () => {
    if (!draft.rule_text.trim()) {
      toast('Rule text required', 'error');
      return;
    }
    setCreating(true);
    try {
      if (editingRuleId) {
        await api.deleteReviewRule(editingRuleId);
      }
      await api.createReviewRule(draft);
      setDraft({
        rule_text: '',
        category: 'custom',
        match_text: '',
        suggestion: '',
        severity: 'medium',
      });
      setEditingRuleId(null);
      toast(editingRuleId ? 'Review rule updated' : 'Review rule created', 'success');
      await loadRules();
    } catch (error) {
      console.error('Failed to create review rule:', error);
      toast(editingRuleId ? 'Failed to update review rule' : 'Failed to create review rule', 'error');
    } finally {
      setCreating(false);
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      await api.deleteReviewRule(ruleId);
      setRules((current) => current.filter((rule) => rule.rule_id !== ruleId));
      toast('Review rule deleted', 'info');
    } catch (error) {
      console.error('Failed to delete review rule:', error);
      toast('Failed to delete review rule', 'error');
    }
  };

  const renderRule = (rule: ReviewRule) => (
    <div key={rule.rule_id} className="rounded-xl border border-outline-variant/10 bg-surface-container-high/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${severityTone(rule.severity)}`}>
              {rule.severity}
            </span>
            <span className="text-[10px] text-on-surface-variant/35 uppercase tracking-[0.12em]">{rule.category}</span>
            <span className="text-[10px] text-on-surface-variant/35 uppercase tracking-[0.12em]">{rule.origin}</span>
          </div>
          <div className="text-[12px] font-semibold text-on-surface/80">{rule.rule_text}</div>
          {rule.match_text && (
            <div className="text-[10px] text-on-surface-variant/40 font-mono break-all">
              match: {rule.match_text}
            </div>
          )}
          {rule.suggestion && (
            <div className="text-[11px] text-on-surface/65 leading-relaxed">{rule.suggestion}</div>
          )}
          {rule.created_from && (
            <div className="text-[10px] text-on-surface-variant/30 font-mono">
              learned from {rule.created_from.slice(0, 8)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {rule.origin !== 'learned' && (
            <button
              onClick={() => {
                setEditingRuleId(rule.rule_id);
                setDraft({
                  rule_text: rule.rule_text,
                  category: rule.category,
                  match_text: rule.match_text,
                  suggestion: rule.suggestion,
                  severity: rule.severity,
                });
              }}
              className="p-1.5 rounded-lg hover:bg-primary/10 text-on-surface-variant/40 hover:text-primary"
              title="Edit rule"
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
            </button>
          )}
          <button
            onClick={() => deleteRule(rule.rule_id)}
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-on-surface-variant/40 hover:text-red-400"
            title="Delete rule"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <Section title="Review Rules" icon="rule" defaultOpen>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <SettingField label="Rule Text">
            <input
              value={draft.rule_text}
              onChange={(event) => setDraft((current) => ({ ...current, rule_text: event.target.value }))}
              className="setting-input"
              placeholder="Flag risky shell deletion"
            />
          </SettingField>
          <SettingField label="Category">
            <input
              value={draft.category}
              onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
              className="setting-input"
              placeholder="security"
            />
          </SettingField>
        </div>

        <SettingField label="Match Text">
          <input
            value={draft.match_text}
            onChange={(event) => setDraft((current) => ({ ...current, match_text: event.target.value }))}
            className="setting-input font-mono"
            placeholder="dangerouslySetInnerHTML"
          />
        </SettingField>

        <div className="grid grid-cols-[1fr_120px] gap-3">
          <SettingField label="Suggestion">
            <textarea
              value={draft.suggestion}
              onChange={(event) => setDraft((current) => ({ ...current, suggestion: event.target.value }))}
              className="setting-input min-h-[72px] resize-y"
              placeholder="Prefer safe rendering over raw HTML injection"
            />
          </SettingField>
          <SettingField label="Severity">
            <select
              value={draft.severity}
              onChange={(event) => setDraft((current) => ({ ...current, severity: event.target.value }))}
              className="setting-input"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </SettingField>
        </div>

        <div className="flex justify-end">
          <div className="flex gap-2">
            {editingRuleId && (
              <button
                onClick={() => {
                  setEditingRuleId(null);
                  setDraft({
                    rule_text: '',
                    category: 'custom',
                    match_text: '',
                    suggestion: '',
                    severity: 'medium',
                  });
                }}
                className="px-4 py-2 rounded-xl bg-surface-container-high text-on-surface-variant/60 text-[11px] font-semibold hover:text-on-surface/80"
              >
                Cancel
              </button>
            )}
            <button
              onClick={createRule}
              disabled={creating}
              className="px-4 py-2 rounded-xl bg-primary/15 text-primary text-[11px] font-semibold hover:bg-primary/25 transition-colors disabled:opacity-50"
            >
              {creating ? (editingRuleId ? 'Updating...' : 'Creating...') : (editingRuleId ? 'Update Rule' : 'Create Rule')}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-[11px] text-on-surface-variant/35">Loading rules...</div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/30">
                Manual Rules ({manualRules.length})
              </div>
              <div className="space-y-2">
                {manualRules.length === 0 ? (
                  <div className="text-[11px] text-on-surface-variant/30">No manual rules yet.</div>
                ) : manualRules.map(renderRule)}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/30">
                Learned Rules ({learnedRules.length})
              </div>
              <div className="space-y-2">
                {learnedRules.length === 0 ? (
                  <div className="text-[11px] text-on-surface-variant/30">No learned rules yet.</div>
                ) : learnedRules.map(renderRule)}
              </div>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
