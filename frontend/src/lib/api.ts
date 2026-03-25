const BASE = '';

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
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

  getStatus: () =>
    request<{ agents: import('../types').Agent[] }>('/api/status'),

  getSettings: () =>
    request<import('../types').Settings>('/api/settings'),

  saveSettings: (settings: Partial<import('../types').Settings>) =>
    request('/api/settings', { method: 'POST', body: JSON.stringify(settings) }),

  getChannels: () =>
    request<{ channels: string[] }>('/api/channels'),

  createChannel: (name: string) =>
    request('/api/channels', { method: 'POST', body: JSON.stringify({ name }) }),

  deleteChannel: (name: string) =>
    request('/api/channels/' + name, { method: 'DELETE' }),

  renameChannel: (name: string, newName: string) =>
    request('/api/channels/' + name, { method: 'PATCH', body: JSON.stringify({ name: newName }) }),

  getJobs: (channel?: string, status?: string) => {
    const params = new URLSearchParams();
    if (channel) params.set('channel', channel);
    if (status) params.set('status', status);
    return request<{ jobs: import('../types').Job[] }>('/api/jobs?' + params);
  },

  createJob: (title: string, channel: string, createdBy: string, assignee?: string, body?: string) =>
    request<import('../types').Job>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ title, channel, created_by: createdBy, assignee, body }),
    }),

  updateJob: (jobId: number, updates: Partial<import('../types').Job>) =>
    request('/api/jobs/' + jobId, { method: 'PATCH', body: JSON.stringify(updates) }),

  getRules: () =>
    request<{ rules: import('../types').Rule[] }>('/api/rules'),

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

  spawnAgent: (base: string, label: string, cwd: string, args: string[], roleDescription?: string) =>
    request<{ ok: boolean; pid: number; base: string; message: string }>('/api/spawn-agent', {
      method: 'POST',
      body: JSON.stringify({ base, label, cwd, args, ...(roleDescription ? { roleDescription } : {}) }),
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

  searchMessages: (q: string, channel?: string, sender?: string) =>
    request<{ results: import('../types').Message[]; query: string }>(
      '/api/search?q=' + encodeURIComponent(q) +
      (channel ? '&channel=' + encodeURIComponent(channel) : '') +
      (sender ? '&sender=' + encodeURIComponent(sender) : '')
    ),

  getActivity: () =>
    request<{ events: import('../types').ActivityEvent[] }>('/api/activity'),

  reportUsage: (data: { agent: string; tokens: number; model?: string }) =>
    request('/api/usage', { method: 'POST', body: JSON.stringify(data) }),

  getUsage: () =>
    request<{ total_tokens: number; by_agent: Record<string, number>; estimated_cost: number }>('/api/usage'),

  exportChannel: (channel: string) =>
    request<{ markdown: string; filename: string }>('/api/export?channel=' + encodeURIComponent(channel)),

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

  // Skills
  getSkills: (category?: string, search?: string) => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (search) params.set('search', search);
    return request<{ skills: any[]; categories: string[] }>('/api/skills?' + params);
  },

  getAgentSkills: (agentName: string) =>
    request<{ skills: any[]; agent: string }>('/api/skills/agent/' + encodeURIComponent(agentName)),

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

  // Agent feedback
  sendFeedback: (agentName: string, messageId: number, rating: 'up' | 'down') =>
    request<{ ok: boolean }>('/api/agents/' + encodeURIComponent(agentName) + '/feedback', {
      method: 'POST',
      body: JSON.stringify({ message_id: messageId, rating }),
    }),

  // Session snapshots
  exportSnapshot: () =>
    request<{ version: string; settings: any; agents: any[]; channels: string[]; messages: any[]; jobs: any[]; rules: any[] }>('/api/snapshot'),

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

  // Schedules
  getSchedules: () =>
    request<{ schedules: any[] }>('/api/schedules'),

  createSchedule: (cronExpr: string, agent: string, command: string, channel?: string) =>
    request('/api/schedules', {
      method: 'POST',
      body: JSON.stringify({ cron_expr: cronExpr, agent, command, channel }),
    }),

  deleteSchedule: (id: number) =>
    request<{ ok: boolean }>('/api/schedules/' + id, { method: 'DELETE' }),

  // Agent config
  setAgentConfig: (name: string, config: Record<string, any>) =>
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

  getAgentMemories: (name: string) =>
    request<{ memories: { key: string; size: number }[] }>(`/api/agents/${encodeURIComponent(name)}/memories`),

  // Share
  shareConversation: (channel: string) =>
    request<{ html: string; filename: string; message_count: number }>(`/api/share?channel=${encodeURIComponent(channel)}`),

  // Sessions
  getSessionTemplates: () =>
    request<{ templates: any[] }>('/api/session-templates'),

  getSession: (channel: string) =>
    request<{ session: any }>(`/api/sessions/${encodeURIComponent(channel)}`),

  startSession: (channel: string, templateId: string, cast: Record<string, string>, topic?: string) =>
    request<any>(`/api/sessions/${encodeURIComponent(channel)}/start`, {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId, cast, topic }),
    }),

  advanceSession: (channel: string) =>
    request<{ session: any }>(`/api/sessions/${encodeURIComponent(channel)}/advance`, { method: 'POST' }),

  endSession: (channel: string) =>
    request<{ session: any }>(`/api/sessions/${encodeURIComponent(channel)}/end`, { method: 'POST' }),

  pauseSession: (channel: string) =>
    request<{ session: any }>(`/api/sessions/${encodeURIComponent(channel)}/pause`, { method: 'POST' }),

  resumeSession: (channel: string) =>
    request<{ session: any }>(`/api/sessions/${encodeURIComponent(channel)}/resume`, { method: 'POST' }),

  setSessionMode: (channel: string, mode: string) =>
    request<{ session: any }>(`/api/sessions/${encodeURIComponent(channel)}/mode`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  // Providers
  getProviders: () =>
    request<{
      providers: { id: string; name: string; available: boolean; free_tier: boolean; local: boolean; capabilities: string[]; models: Record<string, { label: string; tier: string }>; configured: boolean }[];
      capabilities: Record<string, { available: boolean; provider: string | null; provider_name: string | null }>;
      free_options: any[];
      total_configured: number;
    }>('/api/providers'),

  configureProvider: (provider: string, apiKey?: string, preferredFor?: string) =>
    request<{ ok: boolean }>('/api/providers/configure', {
      method: 'POST',
      body: JSON.stringify({ provider, api_key: apiKey, preferred_for: preferredFor }),
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
    request<{ bridges: any[] }>('/api/bridges'),

  configureBridge: (platform: string, config: any) =>
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
    return request<{ plugins: any[]; categories: string[] }>('/api/marketplace?' + params);
  },

  installMarketplacePlugin: (pluginId: string) =>
    request('/api/marketplace/' + pluginId + '/install', { method: 'POST' }),

  uninstallMarketplacePlugin: (pluginId: string) =>
    request('/api/marketplace/' + pluginId + '/uninstall', { method: 'POST' }),

  // Skill Packs
  getSkillPacks: () =>
    request<{ packs: any[] }>('/api/skill-packs'),

  applySkillPack: (packId: string, agent: string) =>
    request('/api/skill-packs/' + packId + '/apply', {
      method: 'POST', body: JSON.stringify({ agent }),
    }),

  // Hooks
  getHooks: () =>
    request<{ hooks: any[]; events: Record<string, string> }>('/api/hooks'),

  createHook: (name: string, event: string, action: string, config?: any) =>
    request('/api/hooks', {
      method: 'POST', body: JSON.stringify({ name, event, action, config }),
    }),

  updateHook: (hookId: string, updates: any) =>
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
    request<{ policies: Record<string, any> }>('/api/security/exec-policies'),

  getExecPolicy: (agent: string) =>
    request<{ policy: any }>('/api/security/exec-policy/' + encodeURIComponent(agent)),

  setExecPolicy: (agent: string, policy: any) =>
    request('/api/security/exec-policy/' + encodeURIComponent(agent), {
      method: 'POST', body: JSON.stringify(policy),
    }),

  getAuditLog: (limit?: number) =>
    request<{ entries: any[] }>('/api/security/audit-log?limit=' + (limit || 100)),

  getRetention: () =>
    request<{ policy: any }>('/api/security/retention'),

  setRetention: (policy: any) =>
    request('/api/security/retention', {
      method: 'POST', body: JSON.stringify(policy),
    }),

  exportData: () => fetch('/api/security/export').then(r => r.blob()),

  deleteAllData: () =>
    request('/api/security/delete-all', {
      method: 'POST', body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' }),
    }),
};
