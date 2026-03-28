export interface Message {
  id: number;
  uid: string;
  sender: string;
  text: string;
  type: 'chat' | 'system' | 'proposal' | 'join' | 'decision' | 'rule_proposal' | 'job_proposal' | 'approval_request' | 'progress' | 'widget';
  timestamp: number;
  time: string;
  channel: string;
  attachments?: Attachment[];
  reply_to?: number;
  metadata?: Record<string, unknown>;
  pinned?: boolean;
  bookmarked?: boolean;
  edited?: boolean;
  thread_count?: number;
  reactions?: Record<string, string[]>;
}

export interface Attachment {
  name: string;
  url: string;
  type: string;
  size?: number;
}

export interface Agent {
  name: string;
  base: string;
  label: string;
  color: string;
  state: 'active' | 'idle' | 'pending' | 'offline' | 'thinking' | 'paused';
  slot: number;
  role?: 'manager' | 'worker' | 'peer';
  responseMode?: 'mentioned' | 'always' | 'listen' | 'silent';
  parent?: string;
  workspace?: string;
  command?: string;
  args?: string[];
  registered_at?: number;
}

export interface Channel {
  name: string;
  unread: number;
  description?: string;
  category?: string;
  pinned?: boolean;
  order?: number;
}

export interface Job {
  id: number;
  uid: string;
  type: string;
  title: string;
  body: string;
  status: 'open' | 'done' | 'archived';
  channel: string;
  created_by: string;
  assignee: string;
  created_at: number;
  updated_at: number;
  sort_order: number;
}

export interface Rule {
  id: number;
  text: string;
  status: 'active' | 'draft' | 'archived' | 'pending';
  author: string;
  reason: string;
  created_at: number;
}

export interface DecisionChoice {
  label: string;
  value: string;
}

export interface PersistentAgent {
  base: string;
  label: string;
  command: string;
  args: string[];
  cwd: string;
  color: string;
  nickname?: string;
  defaultPrompt?: string;
}

export interface StatsSections {
  session: boolean;
  tokens: boolean;
  agents: boolean;
  activity: boolean;
}

export interface Settings {
  username: string;
  title: string;
  theme: 'dark' | 'light' | 'cyberpunk' | 'terminal' | 'ocean' | 'sunset' | 'midnight' | 'rosegold' | 'arctic';
  fontSize: number;
  loopGuard: number;
  notificationSounds: boolean;
  desktopNotifications: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  debugMode: boolean;
  showStatsPanel: boolean;
  statsSections: StatsSections;
  autoRoute?: boolean;
  channels?: string[];
  persistentAgents?: PersistentAgent[];
  timezone?: string;
  timeFormat?: '12h' | '24h';
  voiceLanguage?: string;
  agentSounds?: Record<string, string>;
  // Layout toggles
  showAgentBar?: boolean;
  showChannelTabs?: boolean;
  showTypingIndicator?: boolean;
  showTimestamps?: boolean;
  showSenderLabels?: boolean;
  // First-run
  setupComplete?: boolean;
}

export interface AgentTemplate {
  base: string;
  command: string;
  label: string;
  color: string;
  defaultCwd: string;
  defaultArgs: string[];
  available: boolean;
  provider?: string;
}

export interface ActivityEvent {
  id: string;
  type: 'message' | 'agent_join' | 'agent_leave' | 'job_created' | 'job_done' | 'rule_proposed' | 'channel_created' | 'error';
  text: string;
  agent?: string;
  channel?: string;
  timestamp: number;
}

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  action: string;
  enabled: boolean;
  last_run?: number;
  next_run?: number;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: number;
}

// Plugins and Marketplace
export interface Plugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category?: string;
  installed?: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  cost?: number;
  icon: string;
  enabled: boolean;
  [key: string]: unknown;
}

export interface SkillPack {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
}

// Hooks and Automation
export interface Hook {
  id: string;
  name: string;
  event: string;
  action: string;
  enabled: boolean;
  trigger_count?: number;
}

// Bridges/Integrations
export interface Bridge {
  platform: string;
  has_token?: boolean;
  configured?: boolean;
  connected?: boolean;
  enabled?: boolean;
  channel_map?: Record<string, string>;
  [key: string]: unknown;
}

// Policies and Security
export interface ExecutionPolicy {
  allowed_commands?: string[];
  blocked_commands?: string[];
  require_approval?: boolean;
  [key: string]: unknown;
}

export interface RetentionPolicy {
  enabled: boolean;
  max_age_days?: number;
  [key: string]: unknown;
}

export interface AuditLogEntry {
  timestamp: number;
  type: string;
  actor: string;
  detail?: string;
  [key: string]: unknown;
}

// Provider types
export interface Provider {
  id: string;
  name: string;
  available?: boolean;
  free_tier?: boolean;
  local?: boolean;
  capabilities?: string[];
  configured?: boolean;
}

export interface FreeOption {
  name: string;
  description?: string;
  [key: string]: unknown;
}

export type WSEvent =
  | { type: 'message'; data: Message }
  | { type: 'typing'; data: { sender: string; channel: string } }
  | { type: 'status'; data: { agents: Agent[] } }
  | { type: 'job_update'; data: Job }
  | { type: 'rule_update'; data: { rules: Rule[] } }
  | { type: 'channel_update'; data: { channels: Channel[] } }
  | { type: 'pin'; data: { message_id: number; pinned: boolean } }
  | { type: 'delete'; data: { message_ids: number[] } }
  | { type: 'reaction'; data: { message_id: number; reactions: Record<string, string[]> } }
  | { type: 'activity'; data: ActivityEvent }
  | { type: 'approval_response'; data: { agent: string; response: string; message_id: number } }
  | { type: 'session_update'; data: { channel: string; session: Record<string, unknown> } }
  | { type: 'thinking_stream'; data: { agent: string; text: string; active: boolean } }
  | { type: 'token_stream'; data: { message_id: number; token: string; done: boolean } }
  | { type: 'system'; data: Record<string, unknown> };
