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
  state: 'active' | 'idle' | 'pending' | 'offline' | 'thinking';
  slot: number;
  role?: string;
  workspace?: string;
  command?: string;
  args?: string[];
  registered_at?: number;
}

export interface Channel {
  name: string;
  unread: number;
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

export interface Settings {
  username: string;
  title: string;
  theme: 'dark' | 'light';
  fontSize: number;
  loopGuard: number;
  notificationSounds: boolean;
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
  | { type: 'reaction'; data: { message_id: number; reactions: Record<string, string[]> } };
