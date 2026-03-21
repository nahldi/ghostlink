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

  uploadImage: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json());
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

  pickFolder: () =>
    request<{ windowsPath: string; path: string }>('/api/pick-folder', { method: 'POST' }),

  getAgentTemplates: () =>
    request<{ templates: import('../types').AgentTemplate[] }>('/api/agent-templates'),

  spawnAgent: (base: string, label: string, cwd: string, args: string[]) =>
    request<{ ok: boolean; pid: number; base: string; message: string }>('/api/spawn-agent', {
      method: 'POST',
      body: JSON.stringify({ base, label, cwd, args }),
    }),

  killAgent: (name: string) =>
    request<{ ok: boolean }>('/api/kill-agent/' + name, { method: 'POST' }),

  cleanup: () =>
    request<{ ok: boolean; cleaned: string[]; count: number }>('/api/cleanup', { method: 'POST' }),

  pauseAgent: (name: string) =>
    request<{ ok: boolean }>('/api/agents/' + name + '/pause', { method: 'POST' }),

  resumeAgent: (name: string) =>
    request<{ ok: boolean }>('/api/agents/' + name + '/resume', { method: 'POST' }),

  searchMessages: (q: string, channel?: string, sender?: string) =>
    request<{ results: import('../types').Message[]; query: string }>(
      '/api/search?q=' + encodeURIComponent(q) +
      (channel ? '&channel=' + encodeURIComponent(channel) : '') +
      (sender ? '&sender=' + encodeURIComponent(sender) : '')
    ),
};
