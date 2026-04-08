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
  agent_id?: string;
  name: string;
  base: string;
  label: string;
  color: string;
  state: 'active' | 'idle' | 'pending' | 'offline' | 'thinking' | 'paused';
  slot: number;
  profile_id?: string;
  profile_name?: string;
  role?: 'manager' | 'worker' | 'peer';
  responseMode?: 'mentioned' | 'always' | 'listen' | 'silent';
  thinkingLevel?: '' | 'off' | 'minimal' | 'low' | 'medium' | 'high';
  parent?: string;
  workspace?: string;
  command?: string;
  args?: string[];
  drift_detected?: boolean;
  registered_at?: number;
  runner?: 'tmux' | 'mcp';
}

export interface EffectiveStateFieldSource {
  layer: string;
  value: unknown;
}

export interface EffectiveStateRule {
  source: string;
  content: string;
}

export interface AgentEffectiveStateResponse {
  agent_id?: string;
  profile_id?: string;
  profile_name?: string;
  display_name?: string;
  base?: string;
  provider?: string;
  workspace_id?: string;
  runner?: string;
  state?: string;
  degraded?: boolean;
  degraded_reason?: string;
  drift_detected?: boolean;
  drift_score?: number;
  drift_reason?: string;
  reinforcement_pending?: boolean;
  last_reinforcement_at?: number;
  reinforcement_count?: number;
  last_inject_trigger?: string;
  injection_count?: number;
  effective_state?: Record<string, unknown> & {
    enabled_skills?: string[];
    rules?: EffectiveStateRule[];
    sources?: Record<string, unknown>;
  };
  effective?: Record<string, unknown> & {
    enabled_skills?: string[];
    rules?: EffectiveStateRule[];
  };
  overrides?: Record<string, EffectiveStateFieldSource>;
}

export interface ProfileSummary {
  profile_id: string;
  name: string;
  description?: string;
  base_provider?: string;
  agent_count?: number;
}

export interface ProfileDetail extends ProfileSummary {
  settings?: Record<string, unknown>;
  skills?: Array<{
    skill_id: string;
    enabled: boolean;
    config?: Record<string, unknown>;
  }>;
  rules?: Array<{
    id?: number;
    rule_type?: string;
    content: string;
    priority?: number;
    created_at?: number;
  }>;
  agents?: Array<{
    agent_id?: string;
    name: string;
    label?: string;
  }>;
}

export interface AgentsMdImportResponse {
  workspace_id?: string;
  settings?: Record<string, unknown>;
  rules?: Array<Record<string, unknown>>;
  agents_md?: {
    imported_raw?: string;
    pending_raw?: string;
    pending_diff?: string;
    updated_at?: number;
    has_pending?: boolean;
  };
}

export interface AgentsMdDiffResponse {
  has_changes?: boolean;
  has_pending?: boolean;
  parsed?: {
    agents?: Array<Record<string, unknown>>;
    workspace_rules?: Array<Record<string, unknown>>;
    raw?: string;
  };
  pending_diff?: string;
  imported_raw?: string;
  pending_raw?: string;
  workspace_path?: string;
  workspace_id?: string;
}

export interface Channel {
  name: string;
  unread: number;
  description?: string;
  category?: string;
  pinned?: boolean;
  order?: number;
}

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'awaiting_approval'
  | 'awaiting_input'
  | 'interrupted';

export interface TaskProgressStep {
  label: string;
  status: 'done' | 'active' | 'pending';
}

export interface Task {
  id: number;
  task_id: string;
  parent_task_id?: string | null;
  source_type: 'manual' | 'job' | 'autonomous' | 'delegation' | 'fork' | string;
  source_ref?: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  agent_id?: string | null;
  agent_name?: string | null;
  channel: string;
  profile_id?: string | null;
  trace_id?: string | null;
  priority: number;
  progress_pct: number;
  progress_step: string;
  progress_total: number;
  progress_data: { steps?: TaskProgressStep[] } | TaskProgressStep[] | Record<string, unknown>;
  created_by: string;
  created_at: number;
  started_at?: number | null;
  completed_at?: number | null;
  updated_at: number;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export interface Checkpoint {
  id: number;
  checkpoint_id: string;
  task_id: string;
  agent_id?: string | null;
  agent_name: string;
  session_id?: string | null;
  trace_id?: string | null;
  sequence_num: number;
  trigger: string;
  state_snapshot: Record<string, unknown> & {
    task?: {
      task_id?: string;
      status?: string;
      progress_pct?: number;
      progress_step?: string;
      progress_data?: unknown;
    };
    artifact_log?: Array<Record<string, unknown>>;
    tool_journal?: Array<Record<string, unknown>>;
  };
  pending_actions: Array<Record<string, unknown>>;
  worktree_ref?: string | null;
  artifact_refs: Array<Record<string, unknown> | string>;
  context_window: Record<string, unknown>;
  metadata: Record<string, unknown>;
  size_bytes: number;
  created_at: number;
  expires_at?: number | null;
}

export interface ReplayState {
  active: boolean;
  mode?: 'readonly' | 'live' | string;
  source_task_id?: string;
  source_checkpoint_id?: string;
  fork_task_id?: string;
  journal_entries?: number;
  replay_blocked_tools?: string[];
  started_at?: number;
  stopped_at?: number;
}

export interface ChannelContextSettings {
  mode: 'full' | 'mentions_only' | 'recent' | 'filtered';
  visible_agents: string[];
  hidden_agents: string[];
  max_history: number;
  include_system_messages: boolean;
  include_progress_messages: boolean;
}

export interface AuditEvent {
  id: number;
  event_id: string;
  timestamp: number;
  timestamp_iso?: string | null;
  event_type: string;
  actor: string;
  actor_type: string;
  agent_id?: string | null;
  agent_name?: string | null;
  task_id?: string | null;
  trace_id?: string | null;
  channel?: string | null;
  provider?: string | null;
  profile_id?: string | null;
  action: string;
  outcome: string;
  detail: Record<string, unknown>;
  cost_usd?: number | null;
  duration_ms?: number | null;
  created_at: number;
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

export interface SessionPhase {
  name: string;
  prompt?: string;
  turns?: number;
  [key: string]: unknown;
}

export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  phases: SessionPhase[];
  roles: string[];
  [key: string]: unknown;
}

export interface Session {
  id: string;
  template_name: string;
  topic: string;
  phases: SessionPhase[];
  current_phase: number;
  current_turn: number;
  status: string;
  cast: Record<string, string>;
  execution_mode?: string;
  [key: string]: unknown;
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
  autoStart?: boolean;
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
  // Experience mode — controls UI density and feature visibility
  experienceMode?: 'beginner' | 'standard' | 'advanced';
  // First-run
  setupComplete?: boolean;
  budgets?: Record<string, BudgetConfig>;
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
  type: string;
  text: string;
  agent?: string;
  channel?: string;
  timestamp: number;
}

export interface AgentPresence {
  agent: string;
  label: string;
  surface: string;
  status: string;
  detail: string;
  path?: string;
  url?: string;
  query?: string;
  command?: string;
  tool?: string;
  artifact_url?: string;
  state?: string;
  updated_at: number;
}

export interface AgentBrowserState {
  agent: string;
  mode?: string;
  status?: string;
  url?: string;
  query?: string;
  title?: string;
  preview?: string;
  tool?: string;
  artifact_url?: string;
  updated_at: number;
}

export interface WorkspaceChange {
  agent: string;
  action: string;
  path: string;
  timestamp: number;
}

export interface AgentReplayEvent {
  id: string;
  agent: string;
  type: string;
  title: string;
  detail: string;
  surface: string;
  path?: string;
  url?: string;
  query?: string;
  command?: string;
  tool?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface FileDiffPayload {
  agent: string;
  path: string;
  action: string;
  before: string;
  after: string;
  diff: string;
  timestamp: number;
}

export interface McpInvocationEntry {
  timestamp: number;
  duration_ms: number;
  prompt: string;
  session_id?: string;
  agent?: string;
  status: 'success' | 'timeout' | 'error' | 'parse_error' | 'no_result';
  result_type?: string;
  result_text?: string;
  cost_usd?: number;
  num_turns?: number;
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
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

export interface Collaborator {
  id: string;
  username: string;
  color: string;
  avatar?: string;
  status: 'active' | 'idle' | 'away';
  viewing?: string | null;
  cursor?: { channel: string; messageId?: number } | null;
  joined_at: number;
  last_seen?: number;
  connections?: number;
}

export interface WorkspaceInvite {
  id: string;
  code: string;
  expires_at: number;
  uses: number;
  max_uses: number;
  created_at?: number;
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

export interface PolicyRule {
  id?: number;
  scope_type: string;
  scope_id: string;
  action: string;
  tier: string;
  behavior: 'allow' | 'ask' | 'deny' | 'escalate' | string;
  priority: number;
  conditions?: Record<string, unknown>;
  created_by?: string;
  enabled?: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface EgressRule {
  id?: number;
  scope_type: string;
  scope_id: string;
  rule_type: 'allow' | 'deny' | string;
  domain: string;
  protocol?: string;
  port?: number;
  priority?: number;
  enabled?: boolean;
  created_at?: number;
}

export interface SecretScope {
  secret_key: string;
  scope_type: string;
  scope_id: string;
}

export interface CircuitEvent {
  id?: number;
  agent_name?: string;
  task_id?: string;
  trace_id?: string;
  trigger_type?: string;
  event_key?: string;
  threshold?: number;
  actual_value?: number;
  cooldown_until?: number;
  detail?: Record<string, unknown>;
  created_at?: number;
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
  models?: Record<string, { label: string; tier: string }>;
  configured?: boolean;
  setup_instructions?: string;
  setup_url?: string;
  transport_mode?: string;
  auth_method?: string;
  usage_policy_flags?: string[];
  degraded_mode_behavior?: string;
  health?: {
    healthy: boolean;
    last_error: string;
    last_error_at: number;
    active: boolean;
  };
}

export interface ProviderCapability {
  available: boolean;
  provider: string | null;
  provider_name: string | null;
}

export interface FreeOption {
  name: string;
  description?: string;
  [key: string]: unknown;
}

export interface BudgetConfig {
  max_cost_usd_per_session?: number;
  max_tokens_per_session?: number;
  warning_threshold_pct?: number;
  hard_stop_threshold_pct?: number;
  budget_bypass?: boolean;
}

export interface UsageEntry {
  ts: number;
  agent: string;
  session_id: string;
  task_id: string;
  provider: string;
  model: string;
  transport: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost: number;
  latency_ms: number;
  metadata: Record<string, unknown>;
}

export interface UsageSnapshot {
  entries: UsageEntry[];
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  entry_count: number;
}

export interface CacheDiagnostics {
  providers: Record<string, { hits: number; misses: number }>;
  total_hits: number;
  total_misses: number;
}

export interface A2AAgentCard {
  agent_id?: string;
  name: string;
  description?: string;
  url?: string;
  version?: string;
  provider?: string;
  auth_mode?: string;
  default_input_modes?: string[];
  default_output_modes?: string[];
  capabilities?: string[];
  skills?: string[];
  metadata?: Record<string, unknown>;
}

export interface A2ADiscoveryResult {
  source_url: string;
  fetched_at?: number;
  agents: A2AAgentCard[];
}

export interface A2ADelegationResult {
  ok: boolean;
  task?: Task | null;
  remote_task_id?: string | null;
  target_agent_id?: string | null;
}

export interface ExecutionPlan {
  plan_id: string;
  agent_name: string;
  channel: string;
  prompt: string;
  status: string;
  steps: string[];
  files: string[];
  estimated_tokens: number;
  estimated_cost_usd: number;
  estimated_seconds: number;
  cost_threshold_usd?: number;
  metadata?: Record<string, unknown>;
  decision_note?: string;
  created_at: number;
  decided_at?: number | null;
  updated_at: number;
}

export interface PlanModeSettings {
  plan_mode_enabled: boolean;
  auto_threshold_usd: number;
}

export interface PlanEvaluation {
  requires_plan: boolean;
  reason: string;
  settings: PlanModeSettings;
  auto_threshold_usd: number;
  estimated_cost_usd: number;
  estimated_tokens: number;
  estimated_seconds: number;
  steps: string[];
  files: string[];
}

export type RolloutChannel = 'private' | 'beta' | 'stable';

export interface ProductVersionCompatibility {
  min_platform_version?: string;
  required_capabilities?: string[];
  provider_requirements?: string[];
}

export interface ProductVersionHealth {
  error_rate?: number;
  avg_cost_usd?: number;
  eval_score?: number;
  active_installs?: number;
}

export interface ProductAssetVersion {
  version: string;
  channel: RolloutChannel;
  changelog?: string;
  compatibility?: ProductVersionCompatibility;
  health?: ProductVersionHealth;
  deprecated?: boolean;
  deprecation_note?: string;
  migration_target?: string;
  policy_status?: string;
  published_at?: number;
  is_current?: boolean;
}

export interface ProductAsset {
  asset_id: string;
  kind: 'profile' | 'skill';
  name: string;
  description?: string;
  is_template?: boolean;
  versions: ProductAssetVersion[];
}

export type MemoryLayer = 'identity' | 'workspace' | 'session' | 'observation' | 'shared' | 'conflict' | 'unknown';

export interface MemoryEntry {
  key: string;
  content?: string;
  layer: MemoryLayer;
  source?: string | null;
  size?: number;
  size_tokens?: number;
  importance?: number;
  tags?: string[];
  created_at?: number;
  updated_at?: number;
  last_accessed?: number;
  access_count?: number;
  source_agent_id?: string | null;
  source_session_id?: string | null;
  promoted?: boolean;
  promoted_at?: number | null;
  evictable?: boolean;
  metadata?: Record<string, unknown>;
}

export interface MemoryConflict {
  key: string;
  agents?: string[];
  summary?: string;
  resolution_state?: string;
}

export interface MemoryDriftState {
  score?: number;
  detected?: boolean;
  reason?: string;
  last_reinforced_at?: number;
}

export interface AgentMemorySnapshot {
  memories: MemoryEntry[];
  observations: MemoryEntry[];
  counts_by_layer?: Partial<Record<MemoryLayer, number>>;
  available_tags?: string[];
  conflicts?: MemoryConflict[];
  drift?: MemoryDriftState | null;
  shared_count?: number;
}

export interface EvalManifest {
  generated_at?: number;
  task_count?: number;
  categories?: Record<string, number>;
  mandatory_scenario_count?: number;
  thresholds?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EvalTask {
  id: string;
  name: string;
  category: string;
  description?: string;
  difficulty?: string;
  required_capabilities?: string[];
  [key: string]: unknown;
}

export interface EvalScenarioSummary {
  count: number;
  scenarios: string[];
}

export interface EvalResult {
  id: number;
  run_id: string;
  task_id: string;
  task_name: string;
  category: string;
  provider: string;
  model: string;
  profile: string;
  sandbox_tier: string;
  agent_role: string;
  trace_id: string;
  task_ref: string;
  scores: Record<string, number>;
  composite: number;
  passed: boolean;
  hard_fails: string[];
  soft_alerts: string[];
  needs_review: boolean;
  authoritative_source: string;
  human_override: Record<string, unknown>;
  cost_usd?: number | null;
  duration_ms?: number | null;
  commit_hash: string;
  version: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export interface EvalRun {
  run_id: string;
  subset: string;
  baseline_run_id?: string;
  commit_hash?: string;
  version?: string;
  metadata?: Record<string, unknown>;
  created_at?: number;
  [key: string]: unknown;
}

export interface EvalRunSummary {
  run_id: string;
  count: number;
  pass_count: number;
  warn_count: number;
  fail_count: number;
  average_composite: number;
  results?: EvalResult[];
}

export interface EvalGateCheck {
  run_id: string;
  baseline_run_id: string;
  ok: boolean;
  average_composite: number;
  blocking: Array<{ task_id: string; reason: string }>;
}

export interface ReviewFinding {
  finding_id: string;
  fingerprint: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | string;
  title: string;
  suggestion: string;
  path?: string;
  line?: number | null;
  rule_id?: string | null;
  rule_text?: string;
  diff_line?: string;
}

export interface ReviewRule {
  rule_id: string;
  rule_text: string;
  category: string;
  match_text: string;
  suggestion: string;
  severity: 'low' | 'medium' | 'high' | string;
  origin: 'manual' | 'learned' | string;
  created_from: string;
  active: boolean;
  created_at: number;
  updated_at: number;
}

export interface ReviewResult {
  review_id: string;
  findings: ReviewFinding[];
}

export type WSEvent =
  | { type: 'message'; data: Message }
  | { type: 'typing'; data: { sender: string; channel: string } }
  | { type: 'status'; data: { agents: Agent[] } }
  | { type: 'job_update'; data: Job }
  | { type: 'task_update'; data: Task }
  | { type: 'task_progress'; data: { task_id: string; agent_name?: string; progress_pct: number; progress_step: string; progress_total: number; steps?: TaskProgressStep[]; updated_at: number } }
  | { type: 'rule_update'; data: { rules: Rule[] } }
  | { type: 'channel_update'; data: { channels: Channel[] } }
  | { type: 'channel_context'; data: { channel: string; context: ChannelContextSettings } }
  | { type: 'pin'; data: { message_id: number; pinned: boolean } }
  | { type: 'delete'; data: { message_ids: number[] } }
  | { type: 'reaction'; data: { message_id: number; reactions: Record<string, string[]> } }
  | { type: 'activity'; data: ActivityEvent }
  | { type: 'approval_response'; data: { agent: string; response: string; message_id: number } }
  | { type: 'session_update'; data: { channel: string; session: Record<string, unknown> } }
  | { type: 'thinking_stream'; data: { agent: string; text: string; active: boolean } }
  | { type: 'agent_presence'; data: AgentPresence }
  | { type: 'browser_state'; data: AgentBrowserState }
  | { type: 'terminal_stream'; data: { agent: string; output: string; active: boolean; updated_at: number } }
  | { type: 'workspace_change'; data: WorkspaceChange }
  | { type: 'workspace_presence'; data: { collaborators: Collaborator[] } }
  | { type: 'workspace_invites'; data: { invites: WorkspaceInvite[] } }
  | { type: 'agent_replay'; data: AgentReplayEvent }
  | { type: 'file_diff'; data: { agent: string; path: string; action: string; diff: string; timestamp: number } }
  | { type: 'token_stream'; data: { message_id: number; token: string; done: boolean } }
  | { type: 'mcp_invocation'; data: { agent: string; entry: McpInvocationEntry } }
  | { type: 'identity_drift'; data: { agent: string; agent_id?: string; reason?: string } }
  | { type: 'memory_conflict'; data: { key: string; agents?: string[]; tags?: string[] } }
  | { type: 'cache_alert'; data: { provider: string; capability?: string; cache_hit_rate?: number; consecutive_misses?: number; suggested_actions?: string[] } }
  | { type: 'agents_md_changed'; data: AgentsMdDiffResponse & { workspace_path?: string; workspace_id?: string } }
  | { type: 'system'; data: Record<string, unknown> };
