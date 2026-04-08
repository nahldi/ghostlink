import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mock
import { api } from './api';

describe('api', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('getStatus returns agent list', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agents: [{ name: 'claude', state: 'online' }], version: '4.5.0' }),
    });
    const result = await api.getStatus();
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('claude');
  });

  it('getMessages returns messages for channel', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [{ id: 1, text: 'hello', sender: 'user' }] }),
    });
    const result = await api.getMessages('general');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe('hello');
  });

  it('sendMessage posts to API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, text: 'test' }),
    });
    const result = await api.sendMessage('test', 'general', 'user');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/send'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.id).toBe(42);
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'server error',
    });
    await expect(api.getStatus()).rejects.toThrow();
  });

  it('saveSettings sends POST with settings body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await api.saveSettings({ theme: 'cyberpunk' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/settings'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ theme: 'cyberpunk' }),
      }),
    );
  });

  it('createChannel sends POST with channel name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ name: 'dev' }),
    });
    await api.createChannel('dev');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/channels'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'dev' }),
      }),
    );
  });

  it('deleteChannel sends DELETE', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await api.deleteChannel('dev');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/channels/dev'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('getMessages supports since_id parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    });
    await api.getMessages('general', 42);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('since_id=42'),
      expect.anything(),
    );
  });

  it('spawnAgent sends POST with agent config', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, pid: 1234, base: 'claude', message: 'spawned' }),
    });
    await api.spawnAgent('claude', 'Claude', '/project', ['--flag']);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/spawn-agent'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('handles network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    await expect(api.getStatus()).rejects.toThrow('Network error');
  });

  it('getProfiles normalizes missing profile arrays', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    const result = await api.getProfiles();
    expect(result.profiles).toEqual([]);
  });

  it('importAgentsMd posts workspace path', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ imported_rules_count: 2 }),
    });
    await api.importAgentsMd('C:/repo');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/workspace-policy/agents-md/import'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspace_id: 'C:/repo' }),
      }),
    );
  });

  it('getUsage returns the phase 4B usage snapshot shape', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entries: [{ agent: 'ned', provider: 'openai', cost: 0.12 }],
        total_cost: 0.12,
        total_input_tokens: 1200,
        total_output_tokens: 300,
        entry_count: 1,
      }),
    });
    const result = await api.getUsage();
    expect(result.total_cost).toBe(0.12);
    expect(result.entries[0].provider).toBe('openai');
  });

  it('getCacheDiagnostics returns provider hit and miss totals', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        providers: { openai: { hits: 4, misses: 1 } },
        total_hits: 4,
        total_misses: 1,
      }),
    });
    const result = await api.getCacheDiagnostics();
    expect(result.providers.openai.hits).toBe(4);
    expect(result.total_misses).toBe(1);
  });

  it('getAgentMemories normalizes the legacy flat memory payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        memories: [
          { key: 'build-instructions', size: 128 },
          { key: 'style-guide', size: 64 },
        ],
      }),
    });
    const result = await api.getAgentMemories('ned');
    expect(result.memories).toHaveLength(2);
    expect(result.memories[0].layer).toBe('workspace');
    expect(result.observations).toEqual([]);
  });

  it('getAgentMemories normalizes the stratified phase 6 payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entries: [
          { key: 'core_identity', layer: 'identity', content: 'You are Ned', importance: 1, tags: ['identity'], source: 'memory' },
          { key: 'repo-layout', layer: 'workspace', content: 'frontend owns ui', importance: 0.8, tags: ['repo'], source: 'rag' },
        ],
        observations: [
          { key: 'repeated-test-run', layer: 'observation', content: 'operator runs vitest after patch', tags: ['tests'] },
        ],
        counts_by_layer: { identity: 1, workspace: 1, observation: 1 },
        available_tags: ['identity', 'repo', 'tests'],
        conflicts: [{ key: 'repo-layout', agents: ['ned', 'tyson'], summary: 'conflicting ownership assumption' }],
        drift: { detected: true, score: 0.72, reason: 'missed role boundary' },
        shared_count: 2,
      }),
    });
    const result = await api.getAgentMemories('ned');
    expect(result.memories[0].layer).toBe('identity');
    expect(result.memories[1].source).toBe('rag');
    expect(result.observations[0].layer).toBe('observation');
    expect(result.available_tags).toContain('tests');
    expect(result.conflicts?.[0].agents).toContain('tyson');
    expect(result.drift?.detected).toBe(true);
    expect(result.shared_count).toBe(2);
  });

  it('promoteAgentMemory posts the target layer to the promote endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await api.promoteAgentMemory('ned', 'session-note', 'workspace');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/agents/ned/memories/session-note/promote'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ target_layer: 'workspace' }),
      }),
    );
  });

  it('getEvalResults builds the expected query string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ id: 1, run_id: 'run-1', task_id: 'golden-1', task_name: 'Golden', category: 'identity', provider: 'openai', model: 'gpt-5.4', profile: 'default', sandbox_tier: 'none', agent_role: 'single_agent', trace_id: 'trace-1', task_ref: 'task-1', scores: { correctness: 1 }, composite: 0.91, passed: true, hard_fails: [], soft_alerts: [], needs_review: false, authoritative_source: 'automated', human_override: {}, commit_hash: 'abc', version: '5.7.2', metadata: {}, timestamp: 1 }],
      }),
    });
    const result = await api.getEvalResults({ provider: 'openai', limit: 25 });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/evals/results?provider=openai&limit=25'),
      expect.anything(),
    );
    expect(result.results[0].run_id).toBe('run-1');
  });

  it('checkEvalGates posts run and baseline ids', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ run_id: 'run-2', baseline_run_id: 'run-1', ok: true, average_composite: 0.88, blocking: [] }),
    });
    const result = await api.checkEvalGates('run-2', 'run-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/evals/gates/check'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ run_id: 'run-2', baseline_run_id: 'run-1' }),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('discoverA2A posts a discovery probe and normalizes agent cards', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        source_url: 'https://remote.example.com/.well-known/agent-card.json',
        agents: [
          {
            agent_id: 'remote-1',
            name: 'Remote Planner',
            description: 'Handles planning',
            url: 'https://remote.example.com/a2a',
            skills: ['planning'],
            capabilities: ['delegate'],
          },
        ],
      }),
    });
    const result = await api.discoverA2A('https://remote.example.com/.well-known/agent-card.json');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/a2a/discover'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://remote.example.com/.well-known/agent-card.json' }),
      }),
    );
    expect(result.agents[0].name).toBe('Remote Planner');
    expect(result.agents[0].skills).toContain('planning');
  });

  it('updateA2AAgentCard puts the edited agent card payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: 'GhostLink Node',
        description: 'A2A-ready node',
        url: 'https://ghostlink.local',
      }),
    });
    const result = await api.updateA2AAgentCard({
      name: 'GhostLink Node',
      description: 'A2A-ready node',
      url: 'https://ghostlink.local',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/a2a/card'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          name: 'GhostLink Node',
          description: 'A2A-ready node',
          url: 'https://ghostlink.local',
        }),
      }),
    );
    expect(result?.name).toBe('GhostLink Node');
  });

  it('getProductizationAssets returns productized asset lists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        assets: [
          {
            asset_id: 'profile-1',
            kind: 'profile',
            name: 'Reviewer',
            versions: [{ version: '2.1.0', channel: 'beta' }],
          },
        ],
      }),
    });
    const result = await api.getProductizationAssets();
    expect(result.assets[0].asset_id).toBe('profile-1');
    expect(result.assets[0].versions[0].channel).toBe('beta');
  });

  it('promoteProductizationAssetVersion posts version and channel', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await api.promoteProductizationAssetVersion('skill', 'skill-1', '1.4.0', 'stable');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/productization/assets/skill/skill-1/promote'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ version: '1.4.0', channel: 'stable' }),
      }),
    );
  });

  it('getPlans builds the expected channel and agent filters', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        plans: [{ plan_id: 'plan-1', agent_name: 'ned', channel: 'general', prompt: 'Ship UI', status: 'pending_approval', steps: [], files: [], estimated_tokens: 500, estimated_cost_usd: 0.12, estimated_seconds: 60, created_at: 1, updated_at: 1 }],
      }),
    });
    const result = await api.getPlans({ channel: 'general', agent_name: 'ned', status: 'pending_approval' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/plans?channel=general&agent_name=ned&status=pending_approval'),
      expect.anything(),
    );
    expect(result.plans[0].plan_id).toBe('plan-1');
  });

  it('evaluatePlan posts prompt and files to the backend seam', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        requires_plan: true,
        reason: 'estimated cost exceeds threshold',
        settings: { plan_mode_enabled: true, auto_threshold_usd: 0.1 },
        auto_threshold_usd: 0.1,
        estimated_cost_usd: 0.12,
        estimated_tokens: 600,
        estimated_seconds: 90,
        steps: ['Review'],
        files: ['frontend/src/App.tsx'],
      }),
    });
    const result = await api.evaluatePlan({
      prompt: 'Refactor the chat shell',
      files: ['frontend/src/App.tsx'],
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/plans/evaluate'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ prompt: 'Refactor the chat shell', files: ['frontend/src/App.tsx'] }),
      }),
    );
    expect(result.requires_plan).toBe(true);
  });

  it('savePlanSettings posts the persisted auto-plan threshold', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plan_mode_enabled: true, auto_threshold_usd: 0.25 }),
    });
    const result = await api.savePlanSettings({ plan_mode_enabled: true, auto_threshold_usd: 0.25 });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/plans/settings'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ plan_mode_enabled: true, auto_threshold_usd: 0.25 }),
      }),
    );
    expect(result.auto_threshold_usd).toBe(0.25);
  });
});
