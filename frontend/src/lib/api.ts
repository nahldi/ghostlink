const BASE = '';
type SessionTemplate = import('../types').SessionTemplate;
type SessionState = import('../types').Session | null;
type Provider = import('../types').Provider;
type ProviderCapability = import('../types').ProviderCapability;
type FreeOption = import('../types').FreeOption;
type UsageSnapshot = import('../types').UsageSnapshot;
type CacheDiagnostics = import('../types').CacheDiagnostics;
type A2AAgentCard = import('../types').A2AAgentCard;
type A2ADiscoveryResult = import('../types').A2ADiscoveryResult;
type A2ADelegationResult = import('../types').A2ADelegationResult;
type ExecutionPlan = import('../types').ExecutionPlan;
type PlanModeSettings = import('../types').PlanModeSettings;
type PlanEvaluation = import('../types').PlanEvaluation;
type ProductAsset = import('../types').ProductAsset;
type AgentMemorySnapshot = import('../types').AgentMemorySnapshot;
type MemoryConflict = import('../types').MemoryConflict;
type MemoryDriftState = import('../types').MemoryDriftState;
type MemoryEntry = import('../types').MemoryEntry;
type MemoryLayer = import('../types').MemoryLayer;
type EvalManifest = import('../types').EvalManifest;
type EvalTask = import('../types').EvalTask;
type EvalScenarioSummary = import('../types').EvalScenarioSummary;
type EvalResult = import('../types').EvalResult;
type EvalRunSummary = import('../types').EvalRunSummary;
type EvalGateCheck = import('../types').EvalGateCheck;
type McpInvocationEntry = import('../types').McpInvocationEntry;
type AgentEffectiveStateResponse = import('../types').AgentEffectiveStateResponse;
type ProfileSummary = import('../types').ProfileSummary;
type ProfileDetail = import('../types').ProfileDetail;
type AgentsMdImportResponse = import('../types').AgentsMdImportResponse;
type AgentsMdDiffResponse = import('../types').AgentsMdDiffResponse;
type Task = import('../types').Task;
type ChannelContextSettings = import('../types').ChannelContextSettings;
type AuditEvent = import('../types').AuditEvent;
type Checkpoint = import('../types').Checkpoint;
type ReplayState = import('../types').ReplayState;
type PolicyRule = import('../types').PolicyRule;
type EgressRule = import('../types').EgressRule;
type SecretScope = import('../types').SecretScope;
type CircuitEvent = import('../types').CircuitEvent;
type ReviewRule = import('../types').ReviewRule;
type ReviewResult = import('../types').ReviewResult;

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeMemoryLayer(value: unknown): MemoryLayer {
  switch (value) {
    case 'identity':
    case 'workspace':
    case 'session':
    case 'observation':
    case 'shared':
    case 'conflict':
      return value;
    default:
      return 'workspace';
  }
}

function normalizeMemoryEntry(value: unknown, fallbackLayer: MemoryLayer = 'workspace'): MemoryEntry | null {
  const record = asRecord(value);
  const key = typeof record.key === 'string' ? record.key : '';
  if (!key) return null;
  return {
    key,
    content: typeof record.content === 'string' ? record.content : undefined,
    layer: normalizeMemoryLayer(record.layer ?? fallbackLayer),
    source: typeof record.source === 'string' ? record.source : null,
    size: typeof record.size === 'number' ? record.size : undefined,
    size_tokens: typeof record.size_tokens === 'number' ? record.size_tokens : undefined,
    importance: typeof record.importance === 'number' ? record.importance : undefined,
    tags: asArray<string>(record.tags).filter((tag) => typeof tag === 'string'),
    created_at: typeof record.created_at === 'number' ? record.created_at : undefined,
    updated_at: typeof record.updated_at === 'number' ? record.updated_at : undefined,
    last_accessed: typeof record.last_accessed === 'number' ? record.last_accessed : undefined,
    access_count: typeof record.access_count === 'number' ? record.access_count : undefined,
    source_agent_id: typeof record.source_agent_id === 'string' ? record.source_agent_id : null,
    source_session_id: typeof record.source_session_id === 'string' ? record.source_session_id : null,
    promoted: typeof record.promoted === 'boolean' ? record.promoted : undefined,
    promoted_at: typeof record.promoted_at === 'number' ? record.promoted_at : null,
    evictable: typeof record.evictable === 'boolean' ? record.evictable : undefined,
    metadata: asRecord(record.metadata),
  };
}

function normalizeMemoryConflicts(value: unknown): MemoryConflict[] {
  const conflicts: MemoryConflict[] = [];
  for (const item of asArray<unknown>(value)) {
    const record = asRecord(item);
    const key = typeof record.key === 'string' ? record.key : '';
    if (!key) continue;
    conflicts.push({
      key,
      agents: asArray<string>(record.agents).filter((agent) => typeof agent === 'string'),
      summary: typeof record.summary === 'string' ? record.summary : undefined,
      resolution_state: typeof record.resolution_state === 'string' ? record.resolution_state : undefined,
    });
  }
  return conflicts;
}

function normalizeMemorySnapshot(value: unknown): AgentMemorySnapshot {
  const record = asRecord(value);
  const legacy = asArray<unknown>(record.memories).map((entry) => normalizeMemoryEntry(entry, 'workspace')).filter((entry): entry is MemoryEntry => Boolean(entry));
  const entries = asArray<unknown>(record.entries).map((entry) => normalizeMemoryEntry(entry)).filter((entry): entry is MemoryEntry => Boolean(entry));
  const memories = (entries.length > 0 ? entries : legacy).filter((entry) => entry.layer !== 'observation');
  const observations = asArray<unknown>(record.observations)
    .map((entry) => normalizeMemoryEntry(entry, 'observation'))
    .filter((entry): entry is MemoryEntry => Boolean(entry));
  const countsRecord = asRecord(record.counts_by_layer);
  const counts_by_layer = Object.keys(countsRecord).reduce<Partial<Record<MemoryLayer, number>>>((acc, key) => {
    const layer = normalizeMemoryLayer(key);
    const count = countsRecord[key];
    if (typeof count === 'number') acc[layer] = count;
    return acc;
  }, {});
  const driftRecord = asRecord(record.drift);
  const drift: MemoryDriftState | null = Object.keys(driftRecord).length > 0 ? {
    score: typeof driftRecord.score === 'number' ? driftRecord.score : undefined,
    detected: typeof driftRecord.detected === 'boolean' ? driftRecord.detected : undefined,
    reason: typeof driftRecord.reason === 'string' ? driftRecord.reason : undefined,
    last_reinforced_at: typeof driftRecord.last_reinforced_at === 'number' ? driftRecord.last_reinforced_at : undefined,
  } : null;
  return {
    memories,
    observations,
    counts_by_layer,
    available_tags: asArray<string>(record.available_tags).filter((tag) => typeof tag === 'string'),
    conflicts: normalizeMemoryConflicts(record.conflicts),
    drift,
    shared_count: typeof record.shared_count === 'number' ? record.shared_count : undefined,
  };
}

function normalizeA2AAgentCard(value: unknown): A2AAgentCard | null {
  const record = asRecord(value);
  const name = typeof record.name === 'string' ? record.name : '';
  if (!name) return null;
  return {
    agent_id: typeof record.agent_id === 'string' ? record.agent_id : undefined,
    name,
    description: typeof record.description === 'string' ? record.description : undefined,
    url: typeof record.url === 'string' ? record.url : undefined,
    version: typeof record.version === 'string' ? record.version : undefined,
    provider: typeof record.provider === 'string' ? record.provider : undefined,
    auth_mode: typeof record.auth_mode === 'string'
      ? record.auth_mode
      : (typeof asRecord(record.metadata).auth_mode === 'string' ? String(asRecord(record.metadata).auth_mode) : undefined),
    default_input_modes: asArray<string>(record.default_input_modes).filter((value) => typeof value === 'string'),
    default_output_modes: asArray<string>(record.default_output_modes).filter((value) => typeof value === 'string'),
    capabilities: asArray<string>(record.capabilities).filter((value) => typeof value === 'string'),
    skills: asArray<string>(record.skills).filter((value) => typeof value === 'string'),
    metadata: asRecord(record.metadata),
  };
}

export const api = {
  getMessages: (channel: string, sinceId = 0, limit = 50) =>
    request<{ messages: import('../types').Message[] }>(
      `/api/messages?channel=${channel}&since_id=${sinceId}&limit=${limit}`
    ),

  sendMessage: (sender: string, text: string, channel: string, replyTo?: number, attachments?: { name: string; url: string; type: string }[]) =>
    request<import('../types').Message>('/api/send', {
      method: 'POST',
      body: JSON.stringify({ sender, text, channel, reply_to: replyTo, attachments }),
    }),

  uploadImage: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },

  pinMessage: (msgId: number, pinned: boolean) =>
    request('/api/messages/' + msgId + '/pin', {
      method: 'POST',
      body: JSON.stringify({ pinned }),
    }),

  getStatus: async () => {
    const res = await request<{ agents?: import('../types').Agent[] }>('/api/status');
    return { agents: asArray<import('../types').Agent>(res?.agents) };
  },

  getSettings: () =>
    request<import('../types').Settings>('/api/settings'),

  saveSettings: (settings: Partial<import('../types').Settings>) =>
    request('/api/settings', { method: 'POST', body: JSON.stringify(settings) }),

  getChannels: async () => {
    const res = await request<{ channels?: string[] }>('/api/channels');
    return { channels: asArray<string>(res?.channels) };
  },

  createChannel: (name: string) =>
    request('/api/channels', { method: 'POST', body: JSON.stringify({ name }) }),

  deleteChannel: (name: string) =>
    request('/api/channels/' + name, { method: 'DELETE' }),

  renameChannel: (name: string, newName: string) =>
    request('/api/channels/' + name, { method: 'PATCH', body: JSON.stringify({ name: newName }) }),

  getChannelContext: (name: string) =>
    request<{ channel: string; context: ChannelContextSettings }>(`/api/channels/${encodeURIComponent(name)}/context`),

  setChannelContext: (name: string, context: Partial<ChannelContextSettings>) =>
    request<{ channel: string; context: ChannelContextSettings }>(`/api/channels/${encodeURIComponent(name)}/context`, {
      method: 'PUT',
      body: JSON.stringify(context),
    }),

  getJobs: async (channel?: string, status?: string) => {
    const params = new URLSearchParams();
    if (channel) params.set('channel', channel);
    if (status) params.set('status', status);
    const res = await request<{ jobs?: import('../types').Job[] }>('/api/jobs?' + params);
    return { jobs: asArray<import('../types').Job>(res?.jobs) };
  },

  createJob: (title: string, channel: string, createdBy: string, assignee?: string, body?: string) =>
    request<import('../types').Job>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ title, channel, created_by: createdBy, assignee, body }),
    }),

  updateJob: (jobId: number, updates: Partial<import('../types').Job>) =>
    request('/api/jobs/' + jobId, { method: 'PATCH', body: JSON.stringify(updates) }),

  getTasks: async (params?: {
    channel?: string;
    agent?: string;
    status?: string;
    trace_id?: string;
    parent_task_id?: string;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.channel) query.set('channel', params.channel);
    if (params?.agent) query.set('agent', params.agent);
    if (params?.status) query.set('status', params.status);
    if (params?.trace_id) query.set('trace_id', params.trace_id);
    if (params?.parent_task_id) query.set('parent_task_id', params.parent_task_id);
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    const res = await request<{ tasks?: Task[] }>(`/api/tasks${query.size > 0 ? `?${query.toString()}` : ''}`);
    return { tasks: asArray<Task>(res?.tasks) };
  },

  createTask: (body: {
    title: string;
    description?: string;
    channel?: string;
    agent_name?: string;
    priority?: number;
    trace_id?: string;
    created_by?: string;
  }) =>
    request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateTask: (taskId: string, body: Record<string, unknown>) =>
    request<Task>(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  updateTaskProgress: (taskId: string, body: { pct: number; step: string; total: number; steps: import('../types').TaskProgressStep[] }) =>
    request<Task>(`/api/tasks/${encodeURIComponent(taskId)}/progress`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  cancelTask: (taskId: string) =>
    request<Task>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
    }),

  deleteTask: (taskId: string) =>
    request<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    }),

  getTaskCheckpoints: async (taskId: string) => {
    const res = await request<{ checkpoints?: Checkpoint[] }>(`/api/tasks/${encodeURIComponent(taskId)}/checkpoints`);
    return { checkpoints: asArray<Checkpoint>(res?.checkpoints) };
  },

  getCheckpoint: (checkpointId: string) =>
    request<Checkpoint>(`/api/checkpoints/${encodeURIComponent(checkpointId)}`),

  createTaskCheckpoint: (taskId: string, label?: string) =>
    request<{ ok: boolean; checkpoint: Checkpoint | null }>(`/api/tasks/${encodeURIComponent(taskId)}/checkpoints`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),

  deleteCheckpoint: (checkpointId: string) =>
    request<{ ok: boolean }>(`/api/checkpoints/${encodeURIComponent(checkpointId)}`, {
      method: 'DELETE',
    }),

  compactTaskCheckpoints: (taskId: string, keep_every_n = 5) =>
    request<{ ok: boolean; deleted: number }>(`/api/tasks/${encodeURIComponent(taskId)}/checkpoints/compact`, {
      method: 'POST',
      body: JSON.stringify({ keep_every_n }),
    }),

  pauseTask: (taskId: string) =>
    request<Task>(`/api/tasks/${encodeURIComponent(taskId)}/pause`, {
      method: 'POST',
    }),

  resumeTask: (taskId: string) =>
    request<Task>(`/api/tasks/${encodeURIComponent(taskId)}/resume`, {
      method: 'POST',
    }),

  forkTask: (taskId: string, checkpoint_id?: string) =>
    request<{ ok: boolean; task: Task }>(`/api/tasks/${encodeURIComponent(taskId)}/fork`, {
      method: 'POST',
      body: JSON.stringify({ checkpoint_id }),
    }),

  replayTask: (taskId: string, body: { checkpoint_id?: string; mode?: 'readonly' | 'live' }) =>
    request<{ ok: boolean; replay: ReplayState; task: Task }>(`/api/tasks/${encodeURIComponent(taskId)}/replay`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getReplayStatus: (taskId: string) =>
    request<{ replay: ReplayState }>(`/api/tasks/${encodeURIComponent(taskId)}/replay/status`),

  stopReplay: (taskId: string) =>
    request<{ ok: boolean; replay: ReplayState }>(`/api/tasks/${encodeURIComponent(taskId)}/replay/stop`, {
      method: 'POST',
    }),

  getRules: async () => {
    const res = await request<{ rules?: import('../types').Rule[] }>('/api/rules');
    return { rules: asArray<import('../types').Rule>(res?.rules) };
  },

  proposeRule: (text: string, author: string, reason: string) =>
    request('/api/rules', {
      method: 'POST',
      body: JSON.stringify({ text, author, reason }),
    }),

  updateRule: (ruleId: number, updates: Partial<import('../types').Rule>) =>
    request('/api/rules/' + ruleId, { method: 'PATCH', body: JSON.stringify(updates) }),

  reactToMessage: (msgId: number, emoji: string, sender: string) =>
    request('/api/messages/' + msgId + '/react', {
      method: 'POST',
      body: JSON.stringify({ emoji, sender }),
    }),

  deleteMessage: (msgId: number) =>
    request('/api/messages/' + msgId, { method: 'DELETE' }),

  deleteMessages: (msgIds: number[]) =>
    request<{ ok: boolean; deleted: number[] }>('/api/messages/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids: msgIds }),
    }),

  pickFolder: () =>
    request<{ windowsPath: string; path: string }>('/api/pick-folder', { method: 'POST' }),

  getAgentTemplates: (connectedAgents?: string[]) => {
    const params = connectedAgents?.length ? `?connected=${connectedAgents.join(',')}` : '';
    return request<{ templates: import('../types').AgentTemplate[] }>(`/api/agent-templates${params}`);
  },

  spawnAgent: (base: string, label: string, cwd: string, args: string[], roleDescription?: string, mcpMode?: boolean) =>
    request<{ ok: boolean; pid: number; base: string; message: string }>('/api/spawn-agent', {
      method: 'POST',
      body: JSON.stringify({ base, label, cwd, args, ...(roleDescription ? { roleDescription } : {}), ...(mcpMode ? { mcpMode: true } : {}) }),
    }),

  killAgent: (name: string) =>
    request<{ ok: boolean }>('/api/kill-agent/' + name, { method: 'POST' }),

  cleanup: () =>
    request<{ ok: boolean; cleaned: string[]; count: number }>('/api/cleanup', { method: 'POST' }),

  stopServer: () =>
    request<{ ok: boolean; message: string }>('/api/shutdown', { method: 'POST' }),

  pauseAgent: (name: string) =>
    request<{ ok: boolean }>('/api/agents/' + name + '/pause', { method: 'POST' }),

  resumeAgent: (name: string) =>
    request<{ ok: boolean }>('/api/agents/' + name + '/resume', { method: 'POST' }),

  editMessage: (msgId: number, text: string) =>
    request('/api/messages/' + msgId, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    }),

  bookmarkMessage: (msgId: number, bookmarked: boolean) =>
    request('/api/messages/' + msgId + '/bookmark', {
      method: 'POST',
      body: JSON.stringify({ bookmarked }),
    }),

  searchMessages: (q: string, channel?: string, sender?: string, signal?: AbortSignal) =>
    request<{ results: import('../types').Message[]; query: string }>(
      '/api/search?q=' + encodeURIComponent(q) +
      (channel ? '&channel=' + encodeURIComponent(channel) : '') +
      (sender ? '&sender=' + encodeURIComponent(sender) : ''),
      signal ? { signal } : undefined,
    ),

  getActivity: () =>
    request<{ events: import('../types').ActivityEvent[] }>('/api/activity'),

  reportUsage: (data: { agent: string; tokens: number; model?: string }) =>
    request('/api/usage', { method: 'POST', body: JSON.stringify(data) }),

  getUsage: () =>
    request<UsageSnapshot>('/api/usage'),

  getAgentPresence: (name: string) =>
    request<import('../types').AgentPresence>(`/api/agents/${encodeURIComponent(name)}/presence`),

  getAgentBrowserState: (name: string) =>
    request<import('../types').AgentBrowserState>(`/api/agents/${encodeURIComponent(name)}/browser`),

  getAgentTerminalLive: (name: string) =>
    request<{ agent: string; output: string; active: boolean; updated_at: number }>(`/api/agents/${encodeURIComponent(name)}/terminal/live`),

  getAgentWorkspaceChanges: (name: string, since = 0, limit = 100) =>
    request<{ changes: import('../types').WorkspaceChange[] }>(
      `/api/agents/${encodeURIComponent(name)}/workspace/changes?since=${since}&limit=${limit}`
    ),

  getAgentReplay: (name: string, since = 0, limit = 100) =>
    request<{ events: import('../types').AgentReplayEvent[] }>(
      `/api/agents/${encodeURIComponent(name)}/replay?since=${since}&limit=${limit}`
    ),

  getAgentDiff: (name: string, path: string) =>
    request<import('../types').FileDiffPayload>(
      `/api/agents/${encodeURIComponent(name)}/diff?path=${encodeURIComponent(path)}`
    ),

  exportChannel: (channel: string) =>
    request<{ markdown: string; filename?: string; message_count?: number }>(`/api/conversations/${encodeURIComponent(channel)}/export-markdown`),

  getHierarchy: () =>
    request<{ agents: import('../types').Agent[]; tree: Record<string, string[]> }>('/api/hierarchy'),

  startTunnel: () =>
    request<{ url: string; pid: number; already?: boolean }>('/api/tunnel/start', { method: 'POST' }),

  stopTunnel: () =>
    request<{ ok: boolean }>('/api/tunnel/stop', { method: 'POST' }),

  getTunnelStatus: () =>
    request<{ active: boolean; url: string | null }>('/api/tunnel/status'),

  textToSpeech: (text: string, voice?: string) =>
    request<{ audio: string; provider: string }>('/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text: text.slice(0, 4096), voice: voice || 'alloy' }),
    }),

  sendVoiceNote: (audio: Blob, channel: string, sender: string, duration: number) => {
    const form = new FormData();
    form.append('audio', audio, 'voice.webm');
    form.append('channel', channel);
    form.append('sender', sender);
    form.append('duration', String(Math.round(duration)));
    return fetch('/api/voice-note', { method: 'POST', body: form })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); });
  },

  // Skills
  getSkills: (category?: string, search?: string) => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (search) params.set('search', search);
    return request<{ skills: import('../types').Skill[]; categories: string[] }>('/api/skills?' + params);
  },

  getAgentSkills: (agentName: string) =>
    request<{ skills: import('../types').Skill[]; agent: string }>('/api/skills/agent/' + encodeURIComponent(agentName)),

  toggleAgentSkill: (agentName: string, skillId: string, enabled: boolean) =>
    request('/api/skills/agent/' + encodeURIComponent(agentName) + '/toggle', {
      method: 'POST',
      body: JSON.stringify({ skillId, enabled }),
    }),

  // URL preview
  getUrlPreview: (url: string) =>
    request<{ url: string; title: string; description: string; image: string; site_name: string }>(
      '/api/preview?url=' + encodeURIComponent(url)
    ),

  // Approval prompts
  respondApproval: (agent: string, response: string, messageId: number) =>
    request<{ ok: boolean }>('/api/approval/respond', {
      method: 'POST',
      body: JSON.stringify({ agent, response, message_id: messageId }),
    }),

  // Dashboard
  getDashboard: () =>
    request<{
      total_messages: number;
      messages_by_channel: Record<string, number>;
      messages_by_sender: Record<string, number>;
      hourly_messages: Record<string, number>;
      agents_total: number;
      agents_online: number;
      total_tokens: number;
      usage_by_agent: Record<string, number>;
      estimated_cost: number;
      channels: number;
      uptime_seconds: number;
    }>('/api/dashboard'),

  getCacheDiagnostics: () =>
    request<CacheDiagnostics>('/api/diagnostics/cache'),

  getA2AAgentCard: async () => {
    const res = await request<unknown>('/api/a2a/card');
    return normalizeA2AAgentCard(res);
  },

  getPlans: async (params?: {
    channel?: string;
    agent_name?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.channel) query.set('channel', params.channel);
    if (params?.agent_name) query.set('agent_name', params.agent_name);
    if (params?.status) query.set('status', params.status);
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    const res = await request<{ plans?: ExecutionPlan[] }>(`/api/plans${query.size > 0 ? `?${query.toString()}` : ''}`);
    return { plans: asArray<ExecutionPlan>(res?.plans) };
  },

  createPlan: (body: {
    agent_name?: string;
    channel: string;
    prompt: string;
    files?: string[];
    cost_threshold_usd?: number;
    metadata?: Record<string, unknown>;
  }) =>
    request<ExecutionPlan>('/api/plans', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getPlanSettings: () =>
    request<PlanModeSettings>('/api/plans/settings'),

  savePlanSettings: (body: Partial<PlanModeSettings>) =>
    request<PlanModeSettings>('/api/plans/settings', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  evaluatePlan: (body: {
    prompt: string;
    files?: string[];
    auto_threshold_usd?: number;
    estimated_cost_usd?: number;
    force_plan?: boolean;
  }) =>
    request<PlanEvaluation>('/api/plans/evaluate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getPlan: (planId: string) =>
    request<ExecutionPlan>(`/api/plans/${encodeURIComponent(planId)}`),

  approvePlan: (planId: string, note = '') =>
    request<ExecutionPlan>(`/api/plans/${encodeURIComponent(planId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  rejectPlan: (planId: string, note = '') =>
    request<ExecutionPlan>(`/api/plans/${encodeURIComponent(planId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  updateA2AAgentCard: async (body: Record<string, unknown>) => {
    const res = await request<unknown>('/api/a2a/card', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return normalizeA2AAgentCard(res);
  },

  discoverA2A: async (url: string): Promise<A2ADiscoveryResult> => {
    const res = await request<unknown>('/api/a2a/discover', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    const record = asRecord(res);
    const directCard = normalizeA2AAgentCard(record.agent_card);
    const agents = [
      ...asArray<unknown>(record.agents).map((item) => normalizeA2AAgentCard(item)).filter((item): item is A2AAgentCard => Boolean(item)),
      ...(directCard ? [directCard] : []),
    ];
    return {
      source_url: typeof record.source_url === 'string' ? record.source_url : url,
      fetched_at: typeof record.fetched_at === 'number' ? record.fetched_at : undefined,
      agents,
    };
  },

  delegateA2ATask: (body: {
    target_url: string;
    remote_agent_id?: string;
    local_agent_name?: string;
    title: string;
    prompt: string;
    channel?: string;
  }) =>
    request<A2ADelegationResult>('/api/a2a/delegate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  refreshA2ATask: (taskId: string) =>
    request<Task>(`/api/a2a/tasks/${encodeURIComponent(taskId)}/refresh`, {
      method: 'POST',
    }),

  getProductizationAssets: async () => {
    const res = await request<{ assets?: ProductAsset[] }>('/api/productization/assets');
    return { assets: asArray<ProductAsset>(res?.assets) };
  },

  promoteProductizationAssetVersion: (kind: 'profile' | 'skill', assetId: string, version: string, channel: import('../types').RolloutChannel) =>
    request<{ ok: boolean; asset?: ProductAsset | null }>(`/api/productization/assets/${encodeURIComponent(kind)}/${encodeURIComponent(assetId)}/promote`, {
      method: 'POST',
      body: JSON.stringify({ version, channel }),
    }),

  rollbackProductizationAssetVersion: (kind: 'profile' | 'skill', assetId: string, version: string) =>
    request<{ ok: boolean; asset?: ProductAsset | null }>(`/api/productization/assets/${encodeURIComponent(kind)}/${encodeURIComponent(assetId)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ version }),
    }),

  // Agent feedback
  sendFeedback: (agentName: string, messageId: number, rating: 'up' | 'down') =>
    request<{ ok: boolean }>('/api/agents/' + encodeURIComponent(agentName) + '/feedback', {
      method: 'POST',
      body: JSON.stringify({ message_id: messageId, rating }),
    }),

  // Session snapshots
  exportSnapshot: () =>
    request<{ version: string; settings: Record<string, unknown>; agents: import('../types').Agent[]; channels: string[]; messages: import('../types').Message[]; jobs: import('../types').Job[]; rules: import('../types').Rule[] }>('/api/snapshot'),

  importSnapshot: (snapshot: Record<string, unknown>) =>
    request<{ ok: boolean; imported_messages: number; channels: string[] }>('/api/snapshot/import', {
      method: 'POST',
      body: JSON.stringify(snapshot),
    }),

  // Message templates
  getTemplates: () =>
    request<{ templates: { id: string; name: string; text: string; category: string; created_at: number }[] }>('/api/templates'),

  createTemplate: (name: string, text: string, category?: string) =>
    request<{ id: string; name: string; text: string }>('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name, text, category }),
    }),

  deleteTemplate: (id: string) =>
    request<{ ok: boolean }>('/api/templates/' + id, { method: 'DELETE' }),

  // DM channels
  createDmChannel: (agent1: string, agent2: string) =>
    request<{ channel: string; agents: string[] }>('/api/dm-channel', {
      method: 'POST',
      body: JSON.stringify({ agent1, agent2 }),
    }),

  // Terminal peek & visible terminal
  peekTerminal: (agentName: string, lines?: number) =>
    request<{ name: string; output: string; active: boolean }>(
      `/api/agents/${encodeURIComponent(agentName)}/terminal?lines=${lines || 30}`
    ),

  openTerminal: (agentName: string) =>
    request<{ ok: boolean; method: string }>(`/api/agents/${encodeURIComponent(agentName)}/terminal/open`, {
      method: 'POST',
    }),

  // MCP invocation logs
  getMcpLog: (agentName: string, limit = 50) =>
    request<{ agent: string; entries: McpInvocationEntry[] }>(
      `/api/agents/${encodeURIComponent(agentName)}/mcp/log?limit=${limit}`
    ),

  // Schedules
  getSchedules: () =>
    request<{ schedules: import('../types').Schedule[] }>('/api/schedules'),

  createSchedule: (cronExpr: string, agent: string, command: string, channel?: string) =>
    request('/api/schedules', {
      method: 'POST',
      body: JSON.stringify({ cron_expr: cronExpr, agent, command, channel }),
    }),

  deleteSchedule: (id: number) =>
    request<{ ok: boolean }>('/api/schedules/' + id, { method: 'DELETE' }),

  // Agent config
  setAgentConfig: (name: string, config: Record<string, unknown>) =>
    request('/api/agents/' + encodeURIComponent(name) + '/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  // Agent soul, notes, memories
  getAgentSoul: (name: string) =>
    request<{ soul: string }>(`/api/agents/${encodeURIComponent(name)}/soul`),

  setAgentSoul: (name: string, content: string) =>
    request(`/api/agents/${encodeURIComponent(name)}/soul`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  getAgentNotes: (name: string) =>
    request<{ notes: string }>(`/api/agents/${encodeURIComponent(name)}/notes`),

  setAgentNotes: (name: string, content: string) =>
    request(`/api/agents/${encodeURIComponent(name)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  getAgentMemories: async (name: string) => {
    const res = await request<unknown>(`/api/agents/${encodeURIComponent(name)}/memories`);
    return normalizeMemorySnapshot(res);
  },

  promoteAgentMemory: (name: string, key: string, targetLayer = 'workspace') =>
    request<{ ok: boolean; entry?: MemoryEntry | null }>(`/api/agents/${encodeURIComponent(name)}/memories/${encodeURIComponent(key)}/promote`, {
      method: 'POST',
      body: JSON.stringify({ target_layer: targetLayer }),
    }),

  getAgentEffectiveState: (name: string) =>
    request<AgentEffectiveStateResponse>(`/api/agents/${encodeURIComponent(name)}/effective-state`),

  getProfiles: async () => {
    const res = await request<{ profiles?: ProfileSummary[] }>('/api/profiles');
    return { profiles: asArray<ProfileSummary>(res?.profiles) };
  },

  createProfile: (body: { name: string; description?: string; base_provider?: string }) =>
    request<ProfileDetail>('/api/profiles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getProfile: (profileId: string) =>
    request<ProfileDetail>(`/api/profiles/${encodeURIComponent(profileId)}`),

  updateProfile: (profileId: string, body: Record<string, unknown>) =>
    request<ProfileDetail>(`/api/profiles/${encodeURIComponent(profileId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  deleteProfile: (profileId: string) =>
    request<{ ok: boolean }>(`/api/profiles/${encodeURIComponent(profileId)}`, {
      method: 'DELETE',
    }),

  getProfileSettings: (profileId: string) =>
    request<{ profile_id: string; settings: Record<string, unknown> }>(`/api/profiles/${encodeURIComponent(profileId)}/settings`),

  setProfileSettings: (profileId: string, body: Record<string, unknown>) =>
    request<{ profile_id: string; settings: Record<string, unknown> }>(`/api/profiles/${encodeURIComponent(profileId)}/settings`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  getProfileSkills: (profileId: string) =>
    request<{ profile_id: string; skills?: ProfileDetail['skills'] }>(`/api/profiles/${encodeURIComponent(profileId)}/skills`),

  setProfileSkills: (profileId: string, skill_ids: string[]) =>
    request<{ profile_id: string; skills?: ProfileDetail['skills'] }>(`/api/profiles/${encodeURIComponent(profileId)}/skills`, {
      method: 'PUT',
      body: JSON.stringify({ skill_ids }),
    }),

  toggleProfileSkill: (profileId: string, skillId: string, enabled: boolean) =>
    request<{ profile_id: string; skills?: ProfileDetail['skills'] }>(`/api/profiles/${encodeURIComponent(profileId)}/skills/${encodeURIComponent(skillId)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),

  getProfileRules: (profileId: string) =>
    request<{ profile_id: string; rules?: ProfileDetail['rules'] }>(`/api/profiles/${encodeURIComponent(profileId)}/rules`),

  addProfileRule: (profileId: string, body: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/profiles/${encodeURIComponent(profileId)}/rules`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteProfileRule: (profileId: string, ruleId: string) =>
    request<{ ok: boolean }>(`/api/profiles/${encodeURIComponent(profileId)}/rules/${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
    }),

  getWorkspacePolicy: (workspaceId?: string) =>
    request<AgentsMdImportResponse>(`/api/workspace-policy${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`),

  scanAgentsMd: (workspaceId: string) =>
    request<AgentsMdDiffResponse>('/api/workspace-policy/agents-md/scan', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId }),
    }),

  importAgentsMd: (workspaceId: string) =>
    request<AgentsMdImportResponse>('/api/workspace-policy/agents-md/import', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId }),
    }),

  ignoreAgentsMd: (workspaceId: string) =>
    request<AgentsMdImportResponse>('/api/workspace-policy/agents-md/ignore', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId }),
    }),

  // Share
  shareConversation: (channel: string) =>
    request<{ html: string; filename: string; message_count: number }>(`/api/share?channel=${encodeURIComponent(channel)}`),

  // Sessions
  getSessionTemplates: () =>
    request<{ templates: SessionTemplate[] }>('/api/session-templates'),

  getSession: (channel: string) =>
    request<{ session: SessionState }>(`/api/sessions/${encodeURIComponent(channel)}`),

  startSession: (channel: string, templateId: string, cast: Record<string, string>, topic?: string) =>
    request<{ session: SessionState }>(`/api/sessions/${encodeURIComponent(channel)}/start`, {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId, cast, topic }),
    }),

  advanceSession: (channel: string) =>
    request<{ session: SessionState }>(`/api/sessions/${encodeURIComponent(channel)}/advance`, { method: 'POST' }),

  endSession: (channel: string) =>
    request<{ session: SessionState }>(`/api/sessions/${encodeURIComponent(channel)}/end`, { method: 'POST' }),

  pauseSession: (channel: string) =>
    request<{ session: SessionState }>(`/api/sessions/${encodeURIComponent(channel)}/pause`, { method: 'POST' }),

  resumeSession: (channel: string) =>
    request<{ session: SessionState }>(`/api/sessions/${encodeURIComponent(channel)}/resume`, { method: 'POST' }),

  setSessionMode: (channel: string, mode: string) =>
    request<{ session: SessionState }>(`/api/sessions/${encodeURIComponent(channel)}/mode`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  // Providers
  getProviders: () =>
    request<{
      providers: Provider[];
      capabilities: Record<string, ProviderCapability>;
      free_options: FreeOption[];
      total_configured: number;
      user_preferences?: Record<string, string>;
      overrides?: Record<string, Record<string, unknown>>;
    }>('/api/providers'),

  configureProvider: (provider: string, apiKey?: string, preferredFor?: string) =>
    request<{ ok: boolean }>('/api/providers/configure', {
      method: 'POST',
      body: JSON.stringify({ provider, api_key: apiKey, preferred_for: preferredFor }),
    }),

  updateProviderOverrides: (provider: string, body: Record<string, unknown>) =>
    request<{ ok: boolean; status: Awaited<ReturnType<typeof api.getProviders>> }>('/api/providers/configure', {
      method: 'POST',
      body: JSON.stringify({ provider, ...body }),
    }),

  getProviderModels: (provider: string) =>
    request<{
      provider: string;
      name: string;
      available: boolean;
      models: Record<string, { label: string; tier: string }>;
      capabilities: string[];
    }>(`/api/providers/${encodeURIComponent(provider)}/models`),

  resolveProvider: (capability: string) =>
    request<{
      provider: string;
      name: string;
      models: Record<string, { label: string; tier: string }>;
      transport_mode?: string;
      auth_method?: string;
    }>(`/api/providers/resolve/${encodeURIComponent(capability)}`),

  getEvalManifest: (regenerate = false) =>
    request<EvalManifest>(`/api/evals/manifest${regenerate ? '?regenerate=true' : ''}`),

  getEvalTasks: async () => {
    const res = await request<{ tasks?: EvalTask[] }>('/api/evals/tasks');
    return { tasks: asArray<EvalTask>(res?.tasks) };
  },

  getMandatoryEvalScenarios: () =>
    request<EvalScenarioSummary>('/api/evals/scenarios/mandatory'),

  getEvalResults: async (params?: {
    run_id?: string;
    provider?: string;
    model?: string;
    profile?: string;
    version?: string;
    since?: number;
    until?: number;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const res = await request<{ results?: EvalResult[] }>(`/api/evals/results${query.size ? `?${query.toString()}` : ''}`);
    return { results: asArray<EvalResult>(res?.results) };
  },

  getEvalRunSummary: (runId: string) =>
    request<EvalRunSummary>(`/api/evals/runs/${encodeURIComponent(runId)}/summary`),

  checkEvalGates: (runId: string, baselineRunId = '') =>
    request<EvalGateCheck>('/api/evals/gates/check', {
      method: 'POST',
      body: JSON.stringify({ run_id: runId, baseline_run_id: baselineRunId }),
    }),

  getChannelSummary: (channel: string) =>
    request<{
      channel: string;
      summary: string;
      message_count: number;
      participants: { name: string; count: number }[];
      topics: string[];
      first_message?: number;
      last_message?: number;
    }>(`/api/channels/${encodeURIComponent(channel)}/summary`),

  // Bridges (channel integrations)
  getBridges: () =>
    request<{ bridges: import('../types').Bridge[] }>('/api/bridges'),

  configureBridge: (platform: string, config: Record<string, unknown>) =>
    request('/api/bridges/' + platform + '/configure', {
      method: 'POST', body: JSON.stringify(config),
    }),

  startBridge: (platform: string) =>
    request('/api/bridges/' + platform + '/start', { method: 'POST' }),

  stopBridge: (platform: string) =>
    request('/api/bridges/' + platform + '/stop', { method: 'POST' }),

  // GhostHub Marketplace
  browseMarketplace: (category?: string, search?: string) => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (search) params.set('search', search);
    return request<{ plugins: import('../types').Plugin[]; categories: string[] }>('/api/marketplace?' + params);
  },

  installMarketplacePlugin: (pluginId: string) =>
    request('/api/marketplace/' + pluginId + '/install', { method: 'POST' }),

  uninstallMarketplacePlugin: (pluginId: string) =>
    request('/api/marketplace/' + pluginId + '/uninstall', { method: 'POST' }),

  // Skill Packs
  getSkillPacks: () =>
    request<{ packs: import('../types').SkillPack[] }>('/api/skill-packs'),

  applySkillPack: (packId: string, agent: string) =>
    request('/api/skill-packs/' + packId + '/apply', {
      method: 'POST', body: JSON.stringify({ agent }),
    }),

  // Hooks
  getHooks: () =>
    request<{ hooks: import('../types').Hook[]; events: Record<string, string> }>('/api/hooks'),

  createHook: (name: string, event: string, action: string, config?: Record<string, unknown>) =>
    request('/api/hooks', {
      method: 'POST', body: JSON.stringify({ name, event, action, config }),
    }),

  updateHook: (hookId: string, updates: Partial<import('../types').Hook>) =>
    request('/api/hooks/' + hookId, {
      method: 'PATCH', body: JSON.stringify(updates),
    }),

  deleteHook: (hookId: string) =>
    request('/api/hooks/' + hookId, { method: 'DELETE' }),

  // Security
  getSecrets: () =>
    request<{ secrets: { key: string; preview: string; length: number }[] }>('/api/security/secrets'),

  setSecret: (key: string, value: string) =>
    request('/api/security/secrets', {
      method: 'POST', body: JSON.stringify({ key, value }),
    }),

  deleteSecret: (key: string) =>
    request('/api/security/secrets/' + encodeURIComponent(key), { method: 'DELETE' }),

  getExecPolicies: () =>
    request<{ policies: Record<string, import('../types').ExecutionPolicy> }>('/api/security/exec-policies'),

  getExecPolicy: (agent: string) =>
    request<{ policy: import('../types').ExecutionPolicy }>('/api/security/exec-policy/' + encodeURIComponent(agent)),

  setExecPolicy: (agent: string, policy: import('../types').ExecutionPolicy) =>
    request('/api/security/exec-policy/' + encodeURIComponent(agent), {
      method: 'POST', body: JSON.stringify(policy),
    }),

  getPolicyRules: async () => {
    const res = await request<{ rules?: PolicyRule[] }>('/api/security/policy-rules');
    return { rules: asArray<PolicyRule>(res?.rules) };
  },

  createPolicyRule: (body: PolicyRule) =>
    request<{ ok: boolean; rules?: PolicyRule[] }>('/api/security/policy-rules', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getEgressRules: async () => {
    const res = await request<{ rules?: EgressRule[] }>('/api/security/egress-rules');
    return { rules: asArray<EgressRule>(res?.rules) };
  },

  createEgressRule: (body: EgressRule) =>
    request<{ ok: boolean; rules?: EgressRule[] }>('/api/security/egress-rules', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSecretScopes: async () => {
    const res = await request<{ scopes?: SecretScope[] }>('/api/security/secret-scopes');
    return { scopes: asArray<SecretScope>(res?.scopes) };
  },

  bindSecretScope: (body: SecretScope) =>
    request<{ ok: boolean; scopes?: SecretScope[] }>('/api/security/secret-scopes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  trustHookSignature: (hook_name: string, signature: string) =>
    request<{ ok: boolean }>('/api/security/trusted-hooks', {
      method: 'POST',
      body: JSON.stringify({ hook_name, signature }),
    }),

  getCircuitEvents: async (limit = 100) => {
    const res = await request<{ events?: CircuitEvent[] }>(`/api/security/circuit-events?limit=${limit}`);
    return { events: asArray<CircuitEvent>(res?.events) };
  },

  getAuditLog: (limit?: number) =>
    request<{ entries: import('../types').AuditLogEntry[] }>('/api/security/audit-log?limit=' + (limit || 100)),

  getAuditEvents: async (params?: {
    event_type?: string;
    actor?: string;
    agent?: string;
    task_id?: string;
    trace_id?: string;
    channel?: string;
    provider?: string;
    outcome?: string;
    since?: number;
    until?: number;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const res = await request<{ events?: AuditEvent[] }>(`/api/audit/events${query.size > 0 ? `?${query.toString()}` : ''}`);
    return { events: asArray<AuditEvent>(res?.events) };
  },

  getAuditStats: (limit?: number) =>
    request<{ by_event_type: Record<string, number>; by_agent: Record<string, number>; by_outcome: Record<string, number> }>(
      `/api/audit/stats?limit=${limit || 1000}`
    ),

  exportAudit: async (params?: {
    format?: 'json' | 'csv';
    event_type?: string;
    actor?: string;
    agent?: string;
    task_id?: string;
    trace_id?: string;
    channel?: string;
    provider?: string;
    outcome?: string;
    since?: number;
    until?: number;
    limit?: number;
  }) => {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const res = await fetch(`/api/audit/export${query.size > 0 ? `?${query.toString()}` : ''}`);
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    if ((params?.format || 'json') === 'csv') {
      return res.text();
    }
    return res.json() as Promise<{ events: AuditEvent[] }>;
  },

  getRetention: () =>
    request<{ policy: import('../types').RetentionPolicy }>('/api/security/retention'),

  setRetention: (policy: import('../types').RetentionPolicy) =>
    request('/api/security/retention', {
      method: 'POST', body: JSON.stringify(policy),
    }),

  exportData: () => fetch('/api/security/export').then(r => r.blob()),

  deleteAllData: () =>
    request('/api/security/delete-all', {
      method: 'POST', body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' }),
    }),

  reviewDiff: (diff_text: string) =>
    request<ReviewResult>('/api/review', {
      method: 'POST',
      body: JSON.stringify({ diff_text }),
    }),

  getReviewRules: async (activeOnly = false) => {
    const query = activeOnly ? '?active_only=true' : '';
    const res = await request<{ rules?: ReviewRule[] }>(`/api/review/rules${query}`);
    return { rules: asArray<ReviewRule>(res?.rules) };
  },

  createReviewRule: (body: {
    rule_text: string;
    category?: string;
    match_text?: string;
    suggestion?: string;
    severity?: string;
  }) =>
    request<{ rule: ReviewRule }>('/api/review/rules', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  correctReviewFinding: (findingId: string, body: {
    correction_type: 'accept' | 'dismiss' | 'modify';
    correction_text?: string;
  }) =>
    request<{ finding_id: string; correction_type: string; rule: ReviewRule | null }>(`/api/review/${encodeURIComponent(findingId)}/correct`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteReviewRule: (ruleId: string) =>
    request<{ ok: boolean }>(`/api/review/rules/${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
    }),
};
