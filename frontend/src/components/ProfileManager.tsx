import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ProfileDetail, ProfileSummary } from '../types';
import { EffectiveStateViewer } from './EffectiveStateViewer';
import { toast } from './Toast';

interface ProfileManagerProps {
  onClose: () => void;
}

const DEFAULT_FORM = {
  name: '',
  description: '',
  base_provider: '',
};

export function ProfileManager({ onClose }: ProfileManagerProps) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedProfile, setSelectedProfile] = useState<ProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);

  useEffect(() => {
    let cancelled = false;
    api.getProfiles()
      .then((result) => {
        if (cancelled) return;
        setProfiles(result.profiles);
        const firstId = result.profiles[0]?.profile_id || '';
        setSelectedId(firstId);
      })
      .catch((error) => {
        if (!cancelled) toast(error instanceof Error ? error.message : 'Failed to load profiles', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedProfile(null);
      return;
    }
    let cancelled = false;
    api.getProfile(selectedId)
      .then((profile) => {
        if (cancelled) return;
        setSelectedProfile(profile);
        setForm({
          name: profile.name || '',
          description: profile.description || '',
          base_provider: profile.base_provider || '',
        });
      })
      .catch((error) => {
        if (!cancelled) toast(error instanceof Error ? error.message : 'Failed to load profile', 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const refreshProfiles = async (preferId?: string) => {
    const result = await api.getProfiles();
    setProfiles(result.profiles);
    const nextId = preferId || result.profiles[0]?.profile_id || '';
    setSelectedId(nextId);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast('Profile name is required', 'warning');
      return;
    }
    setSaving(true);
    try {
      const created = await api.createProfile({
        name: form.name.trim(),
        description: form.description.trim(),
        base_provider: form.base_provider.trim(),
      });
      await refreshProfiles(created.profile_id);
      toast(`Profile ${created.name} created`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to create profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const updated = await api.updateProfile(selectedId, {
        name: form.name.trim(),
        description: form.description.trim(),
        base_provider: form.base_provider.trim(),
      });
      setSelectedProfile(updated);
      await refreshProfiles(updated.profile_id);
      toast(`Saved ${updated.name}`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to save profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId || !selectedProfile) return;
    setSaving(true);
    try {
      await api.deleteProfile(selectedId);
      setSelectedProfile(null);
      setForm(DEFAULT_FORM);
      await refreshProfiles();
      toast(`Deleted ${selectedProfile.name}`, 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to delete profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative flex h-[82vh] w-[1100px] max-w-[96vw] overflow-hidden rounded-3xl border border-outline-variant/12 bg-[#0d0d15]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="w-[280px] border-r border-outline-variant/10 bg-surface-container/20 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/35">Profiles</div>
              <div className="text-[11px] text-on-surface-variant/30">Top-level agent behavior</div>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-on-surface-variant/35 hover:bg-white/6">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          <div className="space-y-2">
            {loading ? (
              <div className="rounded-xl border border-outline-variant/8 bg-surface-container/20 px-3 py-3 text-[11px] text-on-surface-variant/35">
                Loading profiles...
              </div>
            ) : profiles.length > 0 ? (
              profiles.map((profile) => (
                <button
                  key={profile.profile_id}
                  onClick={() => setSelectedId(profile.profile_id)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                    selectedId === profile.profile_id
                      ? 'border-primary/25 bg-primary/10'
                      : 'border-outline-variant/8 bg-surface-container/20 hover:bg-surface-container/35'
                  }`}
                >
                  <div className="text-[12px] font-semibold text-on-surface">{profile.name}</div>
                  <div className="mt-1 text-[10px] text-on-surface-variant/35">{profile.description || 'No description yet.'}</div>
                  <div className="mt-2 flex items-center justify-between text-[9px] uppercase tracking-wider text-on-surface-variant/30">
                    <span>{profile.base_provider || 'any provider'}</span>
                    <span>{profile.agent_count ?? 0} agents</span>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-outline-variant/8 bg-surface-container/20 px-3 py-3 text-[11px] text-on-surface-variant/35">
                No profiles yet. Create the first one on the right.
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-5 xl:grid-cols-[1.2fr,0.8fr]">
            <section className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/35">
                  {selectedProfile ? 'Edit Profile' : 'Create Profile'}
                </div>
                <div className="text-[11px] text-on-surface-variant/30">
                  Profiles are the durable layer between workspace defaults and agent overrides.
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Name</span>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    className="setting-input w-full"
                    placeholder="Backend Developer"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Base Provider</span>
                  <input
                    value={form.base_provider}
                    onChange={(event) => setForm((current) => ({ ...current, base_provider: event.target.value }))}
                    className="setting-input w-full"
                    placeholder="claude / codex / gemini"
                  />
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Description</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="setting-input w-full resize-none"
                  rows={4}
                  placeholder="Purpose, tone, and operational expectations for agents on this profile."
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={selectedProfile ? handleSave : handleCreate}
                  disabled={saving}
                  className="rounded-xl border border-primary/20 bg-primary/12 px-4 py-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/18 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : selectedProfile ? 'Save Profile' : 'Create Profile'}
                </button>
                {selectedProfile && (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-2 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-500/15 disabled:opacity-50"
                  >
                    Delete Profile
                  </button>
                )}
              </div>

              {selectedProfile && (
                <>
                  <div className="rounded-2xl border border-outline-variant/8 bg-surface-container/20 p-4">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Agents Using This Profile</div>
                    {selectedProfile.agents?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedProfile.agents.map((agent) => (
                          <span key={agent.agent_id || agent.name} className="rounded-md bg-white/6 px-2 py-1 text-[10px] text-on-surface-variant/65">
                            {agent.label || agent.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-on-surface-variant/35">No agents assigned yet.</div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-outline-variant/8 bg-surface-container/20 p-4">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Profile Skills</div>
                    {selectedProfile.skills?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedProfile.skills.map((skill) => (
                          <span key={skill.skill_id} className="rounded-md bg-primary/10 px-2 py-1 text-[10px] text-primary/80">
                            {skill.skill_id}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-on-surface-variant/35">No profile skills configured yet.</div>
                    )}
                  </div>
                </>
              )}
            </section>

            <section className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/35">Effective State Preview</div>
                <div className="text-[11px] text-on-surface-variant/30">
                  Source badges matter. The operator should see exactly where each value came from.
                </div>
              </div>

              <EffectiveStateViewer
                state={
                  selectedProfile
                    ? {
                        profile_id: selectedProfile.profile_id,
                        profile_name: selectedProfile.name,
                        effective_state: {
                          ...(selectedProfile.settings || {}),
                          rules: (selectedProfile.rules || []).map((rule) => ({
                            source: 'profile',
                            content: rule.content,
                          })),
                          sources: Object.fromEntries(
                            Object.entries(selectedProfile.settings || {}).map(([key, value]) => [
                              key,
                              { layer: 'profile', value },
                            ])
                          ),
                        },
                        overrides: Object.fromEntries(
                          Object.entries(selectedProfile.settings || {}).map(([key, value]) => [
                            key,
                            { layer: 'profile', value },
                          ])
                        ),
                      }
                    : null
                }
                emptyMessage="Select a profile to inspect its current settings layer."
              />

              <div className="rounded-2xl border border-outline-variant/8 bg-surface-container/20 p-4">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/35">Profile Rules</div>
                {selectedProfile?.rules?.length ? (
                  <div className="space-y-2">
                    {selectedProfile.rules.map((rule, idx) => (
                      <div key={`${rule.rule_type || 'profile'}-${idx}`} className="rounded-lg bg-surface-container/35 px-3 py-2">
                        <div className="mb-1 text-[8px] font-semibold uppercase tracking-wider text-primary">{rule.rule_type || 'profile'}</div>
                        <div className="text-[10px] leading-relaxed text-on-surface-variant/60">{rule.content}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-on-surface-variant/35">No profile rules yet.</div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
