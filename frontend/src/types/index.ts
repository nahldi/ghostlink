export interface Message {
  id: number;
  uid: string;
  sender: string;
  text: string;
  type: 'chat' | 'system' | 'proposal' | 'join' | 'decision' | 'rule_proposal' | 'job_proposal';
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
  channels?: string[];
  persistentAgents?: PersistentAgent[];
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
  | { type: 'activity'; data: ActivityEvent };
