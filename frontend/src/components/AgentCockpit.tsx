/**
 * Agent Cockpit — in-app agent workspace viewer.
 * Tabs: Terminal | Files | Activity
 * Shows live terminal output, workspace file tree, and agent activity timeline.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import { AgentIcon } from './AgentIcon';
import { toast } from './Toast';
import type { Agent, ActivityEvent, AgentBrowserState, AgentReplayEvent, WorkspaceChange, FileDiffPayload } from '../types';
import { DiffViewer } from './DiffViewer';
import { CheckpointPanel } from './CheckpointPanel';
import { TaskQueue } from './TaskQueue';

// ── Terminal Tab ──────────────────────────────────────────────────────

function CockpitTerminal({ agent }: { agent: Agent }) {
  const stream = useChatStore((s) => s.terminalStreams[agent.name]);
  const storeMcpLog = useChatStore((s) => s.mcpLogs[agent.name]);
  const [output, setOutput] = useState('');
  const [active, setActive] = useState(false);
  const [runner, setRunner] = useState<'tmux' | 'mcp'>(agent.runner || 'tmux');
  const [autoScroll, setAutoScroll] = useState(true);
  const [mcpLog, setMcpLog] = useState<import('../types').McpInvocationEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setOutput('');
    setActive(false);
    setRunner('tmux');
    api.getAgentTerminalLive(agent.name)
      .then((data) => {
        if (!cancelled) {
          setOutput(data.output || '');
          setActive(data.active ?? false);
          if ((data as Record<string, unknown>).runner === 'mcp') setRunner('mcp');
        }
      })
      .catch(() => {
        if (!cancelled) { setOutput(''); setActive(false); }
      });
    // Also fetch MCP log in parallel
    api.getMcpLog(agent.name, 30).then((data) => {
      if (!cancelled && data.entries.length > 0) {
        setMcpLog(data.entries);
        setRunner('mcp');
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [agent.name]);

  useEffect(() => {
    if (!stream) return;
    setOutput(stream.output || '');
    setActive(stream.active ?? false);
    if ((stream as Record<string, unknown>).runner === 'mcp') setRunner('mcp');
  }, [stream]);

  // Merge real-time WS MCP logs with initial API fetch
  useEffect(() => {
    if (storeMcpLog && storeMcpLog.length > 0) {
      setMcpLog(storeMcpLog);
      setRunner('mcp');
    }
  }, [storeMcpLog]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output, autoScroll, mcpLog]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 flex items-center justify-between border-b border-outline-variant/10 shrink-0">
        <div className="flex items-center gap-2">
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
            active ? 'bg-green-500/15 text-green-400' : 'bg-surface-container-highest text-on-surface-variant/30'
          }`}>
            {active ? 'LIVE' : 'INACTIVE'}
          </span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
            runner === 'mcp'
              ? 'bg-blue-500/15 text-blue-400'
              : 'bg-surface-container-highest text-on-surface-variant/30'
          }`}>
            {runner === 'mcp' ? 'MCP' : 'TMUX'}
          </span>
          <span className="text-[10px] font-mono text-on-surface-variant/40">
            ghostlink-{agent.name}
          </span>
        </div>
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
            autoScroll ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/30 hover:text-on-surface-variant/50'
          }`}
        >
          {autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
        </button>
      </div>

      {runner === 'mcp' && mcpLog.length > 0 ? (
        /* MCP invocation log view */
        <div ref={scrollRef} className="flex-1 overflow-auto" style={{ background: '#06060c' }}>
          {mcpLog.map((entry, i) => (
            <div key={i} className="border-b border-outline-variant/5 px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[9px] px-1 py-0.5 rounded font-mono ${
                  entry.status === 'success' ? 'bg-green-500/15 text-green-400'
                    : entry.status === 'timeout' ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-red-500/15 text-red-400'
                }`}>
                  {entry.status}
                </span>
                <span className="text-[9px] text-on-surface-variant/30 font-mono">
                  {new Date(entry.timestamp * 1000).toLocaleTimeString()}
                </span>
                <span className="text-[9px] text-on-surface-variant/20 font-mono">
                  {entry.duration_ms}ms
                </span>
                {entry.cost_usd != null && (
                  <span className="text-[9px] text-emerald-400/50 font-mono">
                    ${entry.cost_usd.toFixed(4)}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-on-surface-variant/40 font-mono truncate mb-1">
                {entry.prompt}
              </div>
              {entry.result_text && (
                <div className="text-[10px] text-green-300/60 font-mono whitespace-pre-wrap line-clamp-3">
                  {entry.result_text}
                </div>
              )}
              {entry.error && (
                <div className="text-[10px] text-red-400/60 font-mono">
                  {entry.error}
                </div>
              )}
            </div>
          ))}
          {/* Also show live output below the log */}
          {output && (
            <pre className="p-3 font-mono text-[11px] leading-relaxed text-green-300/80 whitespace-pre-wrap">
              {output}
            </pre>
          )}
        </div>
      ) : (
        /* Traditional tmux terminal view */
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto"
          style={{ background: '#06060c' }}
        >
          <pre className="p-3 font-mono text-[11px] leading-relaxed text-green-300/80 whitespace-pre-wrap">
            {output || (active ? 'Waiting for output...' : `No active session for ${agent.name}`)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Files Tab ─────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

const FILE_ICONS: Record<string, string> = {
  ts: 'code', tsx: 'code', js: 'javascript', jsx: 'javascript',
  py: 'code', rs: 'code', go: 'code', java: 'code', cpp: 'code', c: 'code',
  html: 'html', css: 'css', scss: 'css',
  json: 'data_object', toml: 'settings', yaml: 'settings', yml: 'settings',
  md: 'article', txt: 'description', log: 'receipt_long',
  png: 'image', jpg: 'image', svg: 'image', gif: 'image',
  sh: 'terminal', bash: 'terminal', zsh: 'terminal',
};

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || 'description';
}

function CockpitFiles({ agent }: { agent: Agent }) {
  const setFileDiff = useChatStore((s) => s.setFileDiff);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [currentPath, setCurrentPath] = useState('.');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasChanges = editing && editContent !== null && editContent !== fileContent;

  const fetchFiles = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/files?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.entries || []);
        setCurrentPath(path);
        setFileContent(null);
        setEditContent(null);
        setViewingFile(null);
        setEditing(false);
      } else {
        toast('Failed to list files', 'error');
      }
    } catch {
      toast('Failed to connect', 'error');
    }
    setLoading(false);
  }, [agent.name]);

  const openFile = useCallback(async (target: string) => {
    const path = target.includes('/') || target.startsWith('./')
      ? target.replace(/^\.\//, '')
      : (currentPath === '.' ? target : `${currentPath}/${target}`);
    try {
      const [fileRes, diffData] = await Promise.all([
        fetch(`/api/agents/${encodeURIComponent(agent.name)}/file?path=${encodeURIComponent(path)}`),
        api.getAgentDiff(agent.name, path).catch(() => null),
      ]);
      if (fileRes.ok) {
        const data = await fileRes.json();
        const content = data.content || '';
        setFileContent(content);
        setEditContent(content);
        setViewingFile(path);
        setEditing(false);
      }
      if (diffData) setFileDiff(diffData);
    } catch {
      toast('Failed to read file', 'error');
    }
  }, [agent.name, currentPath, setFileDiff]);

  const saveFile = useCallback(async () => {
    if (!viewingFile || editContent === null) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: viewingFile, content: editContent }),
      });
      if (res.ok) {
        setFileContent(editContent);
        setEditing(false);
        toast('File saved', 'success');
      } else {
        toast('Failed to save', 'error');
      }
    } catch {
      toast('Save failed', 'error');
    }
    setSaving(false);
  }, [agent.name, viewingFile, editContent]);

  useEffect(() => { fetchFiles('.'); }, [fetchFiles]);

  // File viewer/editor
  if (viewingFile && fileContent !== null) {
    const lines = (editing ? editContent || '' : fileContent).split('\n');
    const lineNumWidth = String(lines.length).length;

    return (
      <div className="flex flex-col h-full">
        {/* File header with actions */}
        <div className="px-3 py-2 flex items-center gap-2 border-b border-outline-variant/10 shrink-0">
          <button onClick={() => { setFileContent(null); setViewingFile(null); setEditing(false); }} className="p-1 rounded hover:bg-surface-container-high">
            <span className="material-symbols-outlined text-sm text-on-surface-variant/50">arrow_back</span>
          </button>
          <span className="material-symbols-outlined text-sm" style={{ color: agent.color }}>{getFileIcon(viewingFile)}</span>
          <span className="text-[11px] font-mono text-on-surface-variant/60 truncate flex-1">{viewingFile}</span>
          <div className="flex items-center gap-1">
            {hasChanges && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 font-medium">Modified</span>
            )}
            {editing ? (
              <>
                <button
                  onClick={saveFile}
                  disabled={saving || !hasChanges}
                  className="px-2 py-1 rounded-md text-[10px] font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-30"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => { setEditing(false); setEditContent(fileContent); }}
                  className="p-1 rounded hover:bg-surface-container-high"
                  title="Cancel editing"
                >
                  <span className="material-symbols-outlined text-sm text-on-surface-variant/40">close</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    if (showDiff) { setShowDiff(false); return; }
                    const normPath = viewingFile!.replace(/\/\.\//g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
                    const cached = useChatStore.getState().fileDiffs[agent.name]?.[normPath];
                    if (cached) { setShowDiff(true); return; }
                    api.getAgentDiff(agent.name, viewingFile!).then((d) => {
                      if (d?.diff) { useChatStore.getState().setFileDiff(d); setShowDiff(true); }
                      else toast('No changes recorded', 'info');
                    }).catch(() => toast('Could not load diff', 'error'));
                  }}
                  className={`p-1 rounded hover:bg-surface-container-high ${showDiff ? 'bg-primary/15' : ''}`}
                  title={showDiff ? 'Show file' : 'Show changes'}
                >
                  <span className="material-symbols-outlined text-sm" style={{ color: showDiff ? agent.color : undefined }}>difference</span>
                </button>
                <button
                  onClick={() => { setEditing(true); if (textareaRef.current) textareaRef.current.focus(); }}
                  className="p-1 rounded hover:bg-surface-container-high"
                  title="Edit file"
                >
                  <span className="material-symbols-outlined text-sm text-on-surface-variant/40">edit</span>
                </button>
                <button
                  onClick={() => navigator.clipboard?.writeText(fileContent).then(() => toast('Copied', 'success'))}
                  className="p-1 rounded hover:bg-surface-container-high"
                  title="Copy contents"
                >
                  <span className="material-symbols-outlined text-sm text-on-surface-variant/40">content_copy</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* File content with line numbers */}
        {editing ? (
          <div className="flex-1 overflow-auto flex" style={{ background: '#06060c' }}>
            <div className="py-2 px-2 text-right select-none shrink-0 border-r border-outline-variant/5" style={{ minWidth: `${lineNumWidth + 2}ch` }}>
              {lines.map((_, i) => (
                <div key={i} className="font-mono text-[10px] leading-[1.6] text-on-surface-variant/20">{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={editContent || ''}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  saveFile();
                }
              }}
              className="flex-1 p-2 font-mono text-[11px] leading-[1.6] text-on-surface/80 bg-transparent resize-none outline-none"
              spellCheck={false}
            />
          </div>
        ) : showDiff ? (
          (() => {
            const normPath = viewingFile!.replace(/\/\.\//g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
            const diffPayload = useChatStore.getState().fileDiffs[agent.name]?.[normPath];
            return diffPayload?.diff ? (
              <DiffViewer diff={diffPayload.diff} path={normPath} before={diffPayload.before} after={diffPayload.after} agentName={agent.name} agentColor={agent.color} onRevert={() => { setShowDiff(false); openFile(viewingFile!); }} />
            ) : (
              <div className="flex-1 flex items-center justify-center text-on-surface-variant/30 text-xs">No diff available</div>
            );
          })()
        ) : (
          <div className="flex-1 overflow-auto flex" style={{ background: '#06060c' }}>
            <div className="py-2 px-2 text-right select-none shrink-0 border-r border-outline-variant/5" style={{ minWidth: `${lineNumWidth + 2}ch` }}>
              {lines.map((_, i) => (
                <div key={i} className="font-mono text-[10px] leading-[1.6] text-on-surface-variant/20">{i + 1}</div>
              ))}
            </div>
            <pre className="flex-1 p-2 font-mono text-[11px] leading-[1.6] text-on-surface/80 whitespace-pre overflow-x-auto">
              {fileContent}
            </pre>
          </div>
        )}
      </div>
    );
  }

  const filteredFiles = filter
    ? files.filter(f => f.name.toLowerCase().includes(filter.toLowerCase()))
    : files;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-outline-variant/10 shrink-0">
        {currentPath !== '.' && (
          <button onClick={() => {
            const parent = currentPath.split('/').slice(0, -1).join('/') || '.';
            fetchFiles(parent);
            setFilter('');
          }} className="p-1 rounded hover:bg-surface-container-high">
            <span className="material-symbols-outlined text-sm text-on-surface-variant/50">arrow_back</span>
          </button>
        )}
        <span className="text-[11px] font-mono text-on-surface-variant/40 truncate flex-1">
          {agent.workspace || '~'}/{currentPath === '.' ? '' : currentPath}
        </span>
        <span className="text-[9px] text-on-surface-variant/20">{files.length} items</span>
      </div>
      {/* File filter */}
      {files.length > 5 && (
        <div className="px-3 py-1.5 border-b border-outline-variant/5 shrink-0">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-container-high/30">
            <span className="material-symbols-outlined text-[12px] text-on-surface-variant/30">search</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files..."
              className="flex-1 bg-transparent text-[10px] text-on-surface/70 outline-none placeholder:text-on-surface-variant/20"
            />
            {filter && (
              <button onClick={() => setFilter('')} className="text-on-surface-variant/30 hover:text-on-surface-variant/50">
                <span className="material-symbols-outlined text-[12px]">close</span>
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-1 space-y-0.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                <div className="w-4 h-4 rounded skeleton-shimmer" />
                <div className="h-2.5 rounded skeleton-shimmer" style={{ width: `${40 + ((i * 37) % 40)}%` }} />
              </div>
            ))}
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="text-center py-8 text-on-surface-variant/30 text-xs">
            {agent.state === 'offline' ? 'Agent is offline — start it to browse files' : filter ? 'No matches' : 'No files found'}
          </div>
        ) : (
          <div className="py-1">
            {filteredFiles
              .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1))
              .map((f) => (
                <button
                  key={f.name}
                  onClick={() => f.type === 'directory' ? fetchFiles(currentPath === '.' ? f.name : `${currentPath}/${f.name}`) : openFile(f.name)}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-surface-container-high/50 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm" style={{ color: f.type === 'directory' ? '#60a5fa' : agent.color + '90' }}>
                    {f.type === 'directory' ? 'folder' : getFileIcon(f.name)}
                  </span>
                  <span className="text-[11px] text-on-surface/70 truncate">{f.name}</span>
                  {f.size !== undefined && f.type === 'file' && (
                    <span className="text-[9px] text-on-surface-variant/25 ml-auto">
                      {f.size < 1024 ? `${f.size}B` : f.size < 1048576 ? `${(f.size / 1024).toFixed(1)}K` : `${(f.size / 1048576).toFixed(1)}M`}
                    </span>
                  )}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Activity Tab ──────────────────────────────────────────────────────

function workspaceChangeText(change: WorkspaceChange): string {
  const action = change.action.replace(/_/g, ' ');
  return `${action} ${change.path}`;
}

function workspaceChangeIcon(action: string): string {
  switch (action) {
    case 'created': return 'note_add';
    case 'modified': return 'edit';
    case 'deleted': return 'delete';
    case 'renamed': return 'drive_file_rename_outline';
    default: return 'description';
  }
}

function CockpitActivity({ agent }: { agent: Agent }) {
  const liveEvents = useChatStore((s) => s.activities);
  const liveChanges = useChatStore((s) => s.workspaceChanges[agent.name] || []);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [changes, setChanges] = useState<WorkspaceChange[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getActivity().catch(() => ({ events: [] as ActivityEvent[] })),
      api.getAgentWorkspaceChanges(agent.name).catch(() => ({ changes: [] as WorkspaceChange[] })),
    ]).then(([activityData, changeData]) => {
      if (cancelled) return;
      const agentEvents = (activityData.events || []).filter(
        (e: ActivityEvent) => e.agent === agent.name || e.text?.includes(agent.name)
      );
      setEvents(agentEvents.slice(-50));
      setChanges((changeData.changes || []).slice(-50));
    });
    return () => { cancelled = true; };
  }, [agent.name]);

  const iconForType = (type: string) => {
    switch (type) {
      case 'message': return 'chat';
      case 'agent_join': return 'login';
      case 'agent_leave': return 'logout';
      case 'job_created': return 'task';
      case 'job_done': return 'task_alt';
      case 'error': return 'error';
      default: return 'info';
    }
  };

  const merged = [
    ...events.map((event) => ({ kind: 'activity' as const, id: `activity:${event.id}`, timestamp: event.timestamp, payload: event })),
    ...changes.map((change) => ({ kind: 'workspace' as const, id: `workspace:${change.timestamp}:${change.path}:${change.action}`, timestamp: change.timestamp, payload: change })),
    ...liveEvents
      .filter((e) => e.agent === agent.name || e.text?.includes(agent.name))
      .map((event) => ({ kind: 'activity' as const, id: `activity:${event.id}`, timestamp: event.timestamp, payload: event })),
    ...liveChanges.map((change) => ({ kind: 'workspace' as const, id: `workspace:${change.timestamp}:${change.path}:${change.action}`, timestamp: change.timestamp, payload: change })),
  ]
    .filter((item, index, arr) => arr.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 80);

  return (
    <div className="flex-1 overflow-auto">
      {merged.length === 0 ? (
        <div className="text-center py-8 text-on-surface-variant/30 text-xs">
          No recent activity for {agent.label || agent.name}
        </div>
      ) : (
        <div className="py-2">
          {merged.map((item) => item.kind === 'activity' ? (
            <div key={item.id} className="px-3 py-2 flex items-start gap-2 hover:bg-surface-container-high/30 transition-colors">
              <span className="material-symbols-outlined text-sm text-on-surface-variant/40 mt-0.5">{iconForType(item.payload.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-on-surface/70 leading-snug">{item.payload.text}</p>
                <p className="text-[9px] text-on-surface-variant/25 mt-0.5">
                  {new Date(item.payload.timestamp * 1000).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ) : (
            <div key={item.id} className="px-3 py-2 flex items-start gap-2 hover:bg-surface-container-high/30 transition-colors">
              <span className="material-symbols-outlined text-sm text-on-surface-variant/40 mt-0.5">{workspaceChangeIcon(item.payload.action)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-on-surface/70 leading-snug">{workspaceChangeText(item.payload)}</p>
                <p className="text-[9px] text-on-surface-variant/25 mt-0.5">
                  {new Date(item.payload.timestamp * 1000).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Browser Tab ───────────────────────────────────────────────────────

function CockpitBrowser({ agent }: { agent: Agent }) {
  const liveBrowser = useChatStore((s) => s.browserStates[agent.name]);
  const liveReplay = useChatStore((s) => s.agentReplay[agent.name] || []);
  const [browser, setBrowser] = useState<AgentBrowserState | null>(null);
  const [loading, setLoading] = useState(true);
  const [artifactErrored, setArtifactErrored] = useState(false);

  const browserHistory = useMemo(() => {
    return liveReplay
      .filter((event) =>
        event.surface === 'browser' ||
        ['web_fetch', 'web_search', 'browser_snapshot'].includes(event.tool || '')
      )
      .map((event) => {
        const metadata = (event.metadata || {}) as Record<string, unknown>;
        const artifactUrl = typeof metadata.artifact_url === 'string' ? metadata.artifact_url : '';
        const status = typeof metadata.status === 'string' ? metadata.status : event.title;
        return {
          id: event.id,
          title: event.title || event.url || event.query || event.tool || 'Browser event',
          detail: event.detail,
          url: event.url || '',
          query: event.query || '',
          tool: event.tool || '',
          status,
          artifactUrl,
          timestamp: event.timestamp,
        };
      })
      .filter((entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 8);
  }, [liveReplay]);

  const snapshotGallery = useMemo(
    () => browserHistory.filter((entry) => entry.artifactUrl),
    [browserHistory],
  );

  useEffect(() => {
    let cancelled = false;
    setBrowser(null);
    setLoading(true);
    api.getAgentBrowserState(agent.name)
      .then((data) => {
        if (!cancelled) {
          setBrowser(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agent.name]);

  useEffect(() => {
    if (!liveBrowser) return;
    setBrowser(liveBrowser);
    setLoading(false);
  }, [liveBrowser]);

  useEffect(() => {
    setArtifactErrored(false);
  }, [browser?.artifact_url, browser?.updated_at]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 flex items-center gap-2 border-b border-outline-variant/10">
          <div className="w-4 h-4 rounded skeleton-shimmer" />
          <div className="flex-1 h-3 rounded skeleton-shimmer" />
        </div>
        <div className="p-3 space-y-2">
          <div className="w-3/4 h-3 rounded skeleton-shimmer" />
          <div className="w-1/2 h-3 rounded skeleton-shimmer" />
          <div className="w-full h-20 rounded-lg skeleton-shimmer mt-3" />
        </div>
      </div>
    );
  }

  if (!browser || (!browser.url && !browser.query && !browser.preview)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant/20">language</span>
        <p className="text-xs text-on-surface-variant/40 text-center">
          No browser activity yet. When {agent.label || agent.name} browses the web, you'll see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* URL bar */}
      {browser.url && (
        <div className="px-3 py-2 flex items-center gap-2 border-b border-outline-variant/10 shrink-0">
          <span className="material-symbols-outlined text-sm text-on-surface-variant/40">language</span>
          <a
            href={browser.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono text-primary/70 hover:text-primary truncate flex-1"
          >
            {browser.url}
          </a>
          <button
            onClick={() => navigator.clipboard?.writeText(browser.url!).then(() => toast('URL copied', 'success'))}
            className="p-1 rounded hover:bg-surface-container-high shrink-0"
          >
            <span className="material-symbols-outlined text-[12px] text-on-surface-variant/30">content_copy</span>
          </button>
        </div>
      )}
      {/* Title + state */}
      {(browser.title || browser.status || browser.mode) && (
        <div className="px-3 py-2 border-b border-outline-variant/5 shrink-0 space-y-1.5">
          {browser.title && (
            <div className="text-[11px] text-on-surface/75 font-medium truncate">{browser.title}</div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            {browser.status && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                {browser.status}
              </span>
            )}
            {browser.mode && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant/35">
                {browser.mode}
              </span>
            )}
            {browser.artifact_url && (
              <a
                href={`${browser.artifact_url}${browser.updated_at ? `?t=${browser.updated_at}` : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant/35 hover:text-primary transition-colors"
              >
                Open snapshot
              </a>
            )}
          </div>
        </div>
      )}
      {/* Search query */}
      {browser.query && (
        <div className="px-3 py-1.5 flex items-center gap-2 border-b border-outline-variant/5 shrink-0">
          <span className="material-symbols-outlined text-sm text-on-surface-variant/30">search</span>
          <span className="text-[10px] text-on-surface-variant/50">"{browser.query}"</span>
          {browser.tool && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant/30 ml-auto">
              {browser.tool}
            </span>
          )}
        </div>
      )}
      {browserHistory.length > 0 && (
        <div className="px-3 pt-3 shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.12em] text-on-surface-variant/25">Recent Browser Steps</span>
            <span className="text-[9px] text-on-surface-variant/20">{browserHistory.length} items</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {browserHistory.map((entry) => (
              <div
                key={entry.id}
                className="min-w-[180px] max-w-[220px] rounded-lg border border-outline-variant/10 bg-surface-container-high/20 p-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[12px] text-primary/60">
                    {entry.tool === 'web_search' ? 'search' : entry.tool === 'browser_snapshot' ? 'photo_camera' : 'language'}
                  </span>
                  <span className="text-[10px] text-on-surface/70 truncate font-medium">{entry.status}</span>
                </div>
                <div className="mt-1 text-[10px] text-on-surface-variant/45 truncate">
                  {entry.query ? `"${entry.query}"` : entry.url || entry.title}
                </div>
                <div className="mt-1 text-[9px] text-on-surface-variant/20">
                  {new Date(entry.timestamp * 1000).toLocaleTimeString()}
                </div>
                {entry.url && (
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex text-[9px] text-primary/60 hover:text-primary transition-colors"
                  >
                    Open link
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {browser.artifact_url && !artifactErrored && (
        <div className="px-3 pt-3 shrink-0">
          <img
            src={`${browser.artifact_url}${browser.updated_at ? `?t=${browser.updated_at}` : ''}`}
            alt={`${agent.label || agent.name} browser snapshot`}
            className="w-full max-h-48 object-contain rounded-lg border border-outline-variant/10 bg-black/20"
            onError={() => setArtifactErrored(true)}
          />
        </div>
      )}
      {snapshotGallery.length > 0 && (
        <div className="px-3 pt-3 shrink-0 space-y-2">
          <div className="text-[10px] uppercase tracking-[0.12em] text-on-surface-variant/25">Snapshot Gallery</div>
          <div className="grid grid-cols-2 gap-2">
            {snapshotGallery.slice(0, 4).map((entry) => (
              <a
                key={entry.id}
                href={`${entry.artifactUrl}${entry.timestamp ? `?t=${entry.timestamp}` : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg overflow-hidden border border-outline-variant/10 bg-surface-container-high/10 hover:border-primary/30 transition-colors"
              >
                <img
                  src={`${entry.artifactUrl}${entry.timestamp ? `?t=${entry.timestamp}` : ''}`}
                  alt={`${agent.label || agent.name} snapshot`}
                  className="w-full h-24 object-cover bg-black/20"
                />
                <div className="px-2 py-1.5 text-[9px] text-on-surface-variant/35 truncate">
                  {entry.query ? `"${entry.query}"` : entry.url || entry.title}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
      {/* Preview content */}
      <div className="flex-1 overflow-auto p-3">
        {browser.preview ? (
          <div className="text-[11px] text-on-surface/60 leading-relaxed whitespace-pre-wrap font-mono">
            {browser.preview}
          </div>
        ) : (
          <div className="text-center py-8 text-on-surface-variant/25 text-xs">
            {browser.artifact_url ? 'Snapshot captured. Open it above for full view.' : 'Page content loading...'}
          </div>
        )}
      </div>
      {/* Timestamp */}
      {browser.updated_at && (
        <div className="px-3 py-1.5 border-t border-outline-variant/5 shrink-0">
          <span className="text-[9px] text-on-surface-variant/20">
            Last updated {new Date(browser.updated_at * 1000).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Replay Tab ────────────────────────────────────────────────────────

function CockpitReplay({ agent, onFileReverted }: { agent: Agent; onFileReverted?: () => void }) {
  const liveReplay = useChatStore((s) => s.agentReplay[agent.name] || []);
  const [events, setEvents] = useState<import('../types').AgentReplayEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<import('../types').AgentReplayEvent | null>(null);
  const fileDiffs = useChatStore((s) => s.fileDiffs[agent.name] || {});
  const normalizedSelectedPath = selectedEvent?.path
    ? selectedEvent.path.replace(/\/\.\//g, '/').replace(/\/+/g, '/').replace(/^\.\//, '')
    : '';
  const diffData = normalizedSelectedPath ? (fileDiffs[normalizedSelectedPath] as FileDiffPayload | undefined) : undefined;

  useEffect(() => {
    let cancelled = false;
    setEvents([]);
    setSelectedEvent(null);
    setLoading(true);
    api.getAgentReplay(agent.name)
      .then((data) => { if (!cancelled) { setEvents((data.events || []).slice(-100)); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [agent.name]);

  const allEvents = [
    ...events,
    ...liveReplay.filter((e) => !events.some((x) => x.id === e.id)),
  ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);

  const replayIcon = (type: string) => {
    switch (type) {
      case 'tool_start': return 'build';
      case 'tool_result': return 'check_circle';
      case 'file_open': case 'file_save': return 'edit_document';
      case 'browser_navigate': case 'web_fetch': case 'web_search': return 'language';
      case 'thinking_start': case 'thinking_update': return 'psychology';
      case 'command_run': return 'terminal';
      case 'agent_join': return 'login';
      case 'agent_leave': return 'logout';
      default: return 'radio_button_checked';
    }
  };

  const surfaceColor = (surface: string) => {
    switch (surface) {
      case 'terminal': return '#4ade80';
      case 'browser': return '#60a5fa';
      case 'files': return '#a78bfa';
      case 'thinking': return '#fbbf24';
      default: return '#8b8b8b';
    }
  };

  return (
    <div className="flex flex-col h-full">
      {selectedEvent ? (
        <div className="flex flex-col h-full">
          <div className="px-3 py-2 flex items-center gap-2 border-b border-outline-variant/10 shrink-0">
            <button onClick={() => setSelectedEvent(null)} className="p-1 rounded hover:bg-surface-container-high">
              <span className="material-symbols-outlined text-sm text-on-surface-variant/50">arrow_back</span>
            </button>
            <span className="material-symbols-outlined text-sm" style={{ color: surfaceColor(selectedEvent.surface) }}>
              {replayIcon(selectedEvent.type)}
            </span>
            <span className="text-[11px] text-on-surface/70 font-medium truncate">{selectedEvent.title}</span>
          </div>
          <div className="flex-1 overflow-auto p-3">
            <div className="space-y-2">
              <div className="text-[10px] text-on-surface-variant/40">
                {new Date(selectedEvent.timestamp * 1000).toLocaleString()}
              </div>
              <p className="text-[11px] text-on-surface/70 leading-relaxed">{selectedEvent.detail}</p>
              {selectedEvent.path && (
                <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant/40">
                  <span className="material-symbols-outlined text-[12px]">description</span>
                  <span className="font-mono">{selectedEvent.path}</span>
                </div>
              )}
              {selectedEvent.url && (
                <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant/40">
                  <span className="material-symbols-outlined text-[12px]">link</span>
                  <a href={selectedEvent.url} target="_blank" rel="noopener noreferrer" className="font-mono text-primary/60 hover:text-primary">{selectedEvent.url}</a>
                </div>
              )}
              {selectedEvent.command && (
                <pre className="mt-2 p-2 rounded-lg bg-surface-container-highest/30 text-[10px] font-mono text-green-300/70 whitespace-pre-wrap">
                  $ {selectedEvent.command}
                </pre>
              )}
              {/* Inline diff for file events */}
              {selectedEvent.path && diffData && (
                <div className="mt-3 rounded-lg overflow-hidden border border-outline-variant/10" style={{ maxHeight: '300px' }}>
                  <DiffViewer diff={diffData.diff} path={diffData.path} before={diffData.before} after={diffData.after} agentName={agent.name} agentColor={agent.color} onRevert={() => { setSelectedEvent(null); onFileReverted?.(); }} />
                </div>
              )}
              {selectedEvent.path && !diffData && (
                <button
                  onClick={() => {
                    api.getAgentDiff(agent.name, selectedEvent.path!).then((d) => {
                      if (d?.diff) useChatStore.getState().setFileDiff(d);
                    }).catch(() => {});
                  }}
                  className="mt-2 text-[10px] px-2 py-1 rounded-md bg-primary/10 text-primary/60 hover:bg-primary/20 transition-colors"
                >
                  Load diff
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="py-2 space-y-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2">
                  <div className="w-2 h-2 rounded-full skeleton-shimmer mt-1.5 shrink-0" />
                  <div className="flex-1 space-y-1">
                    <div className="h-2.5 rounded skeleton-shimmer" style={{ width: `${50 + ((i * 31) % 30)}%` }} />
                    <div className="h-2 rounded skeleton-shimmer" style={{ width: `${30 + ((i * 43) % 40)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : allEvents.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 py-8">
              <span className="material-symbols-outlined text-3xl text-on-surface-variant/20">replay</span>
              <p className="text-xs text-on-surface-variant/40 text-center">
                No replay events yet. Actions will appear here as {agent.label || agent.name} works.
              </p>
            </div>
          ) : (
            <div className="py-1">
              {allEvents.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedEvent(e)}
                  className="w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-surface-container-high/30 transition-colors"
                >
                  {/* Timeline dot */}
                  <div className="flex flex-col items-center mt-1 shrink-0">
                    <div className="w-2 h-2 rounded-full" style={{ background: surfaceColor(e.surface) }} />
                    <div className="w-px flex-1 bg-outline-variant/10 mt-1" />
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[13px]" style={{ color: surfaceColor(e.surface) }}>
                        {replayIcon(e.type)}
                      </span>
                      <span className="text-[11px] text-on-surface/70 font-medium truncate">{e.title}</span>
                    </div>
                    <p className="text-[10px] text-on-surface-variant/35 mt-0.5 truncate">{e.detail}</p>
                    <span className="text-[9px] text-on-surface-variant/20">
                      {new Date(e.timestamp * 1000).toLocaleTimeString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Cockpit Panel ────────────────────────────────────────────────

const TABS = ['terminal', 'files', 'browser', 'replay', 'activity', 'tasks', 'checkpoints'] as const;
type CockpitTab = typeof TABS[number];

const TAB_ICONS: Record<CockpitTab, string> = {
  terminal: 'terminal',
  files: 'folder_open',
  browser: 'language',
  replay: 'replay',
  activity: 'timeline',
  tasks: 'task_alt',
  checkpoints: 'save',
};

export function AgentCockpit() {
  const agents = useChatStore((s) => s.agents);
  const cockpitAgent = useChatStore((s) => s.cockpitAgent);
  const thinkingStreams = useChatStore((s) => s.thinkingStreams);
  const agentPresence = useChatStore((s) => s.agentPresence);
  const setAgentPresence = useChatStore((s) => s.setAgentPresence);
  const setWorkspaceChanges = useChatStore((s) => s.setWorkspaceChanges);
  const setAgentReplayEvents = useChatStore((s) => s.setAgentReplayEvents);
  const [tab, setTab] = useState<CockpitTab>('terminal');
  const prefersReducedMotion = useReducedMotion();

  // Reset tab to terminal when switching agents
  useEffect(() => { setTab('terminal'); }, [cockpitAgent]);

  // Keyboard shortcut listener for tab switching
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail;
      if (tab && TABS.includes(tab)) setTab(tab);
    };
    window.addEventListener('cockpit-tab', handler);
    return () => window.removeEventListener('cockpit-tab', handler);
  }, []);
  const [filesKey, setFilesKey] = useState(0);

  const agent = agents.find((a) => a.name === cockpitAgent) || null;
  const thinking = agent ? thinkingStreams[agent.name] : null;
  const presence = agent ? agentPresence[agent.name] : null;

  useEffect(() => {
    if (!agent || presence?.updated_at) return;
    let cancelled = false;
    api.getAgentPresence(agent.name)
      .then((data) => {
        if (!cancelled) setAgentPresence(data);
      })
      .catch(() => { /* ignored */ });
    return () => { cancelled = true; };
  }, [agent, presence?.updated_at, setAgentPresence]);

  useEffect(() => {
    if (!agent) return;
    let cancelled = false;
    Promise.all([
      api.getAgentWorkspaceChanges(agent.name).catch(() => ({ changes: [] as WorkspaceChange[] })),
      api.getAgentReplay(agent.name).catch(() => ({ events: [] as AgentReplayEvent[] })),
    ]).then(([changeData, replayData]) => {
      if (cancelled) return;
      setWorkspaceChanges(agent.name, changeData.changes || []);
      setAgentReplayEvents(agent.name, replayData.events || []);
    });
    return () => { cancelled = true; };
  }, [agent, setWorkspaceChanges, setAgentReplayEvents]);

  if (!agent) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-outline-variant/10">
          <h2 className="text-sm font-semibold text-on-surface/80">Agent Cockpit</h2>
          <p className="text-[10px] text-on-surface-variant/30 mt-0.5">Live workspace viewer</p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
            <span className="material-symbols-outlined text-2xl text-primary/30">monitor</span>
          </div>
          <div className="text-center space-y-1.5">
            <p className="text-xs font-medium text-on-surface-variant/50">No agent selected</p>
            <p className="text-[10px] text-on-surface-variant/30 leading-relaxed max-w-[200px]">
              Hover over an agent chip and click the monitor icon to open their live workspace
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-on-surface-variant/20">
            <kbd className="px-1.5 py-0.5 rounded bg-surface-container-highest/30 font-mono">Ctrl+K</kbd>
            <span>to search agents</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Agent header with status bar */}
      <div className="px-3 py-2.5 border-b shrink-0" style={{ borderColor: `${agent.color}15` }}>
        <div className="flex items-center gap-2.5">
          <AgentIcon base={agent.base} color={agent.color} size={20} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-on-surface/80 truncate">{agent.label || agent.name}</p>
            <p className="text-[9px] text-on-surface-variant/40 truncate">
              {thinking?.active
                ? 'Thinking...'
                : presence?.detail || (agent.state === 'active' ? 'Working' : agent.state === 'idle' ? 'Ready' : agent.state === 'paused' ? 'Paused' : agent.state)}
              {presence?.path && <span className="ml-1 text-on-surface-variant/25">at {presence.path}</span>}
              {!presence?.path && agent.workspace && <span className="ml-1 text-on-surface-variant/25">in {agent.workspace.split('/').pop()}</span>}
            </p>
          </div>
          <div
            className="w-2.5 h-2.5 rounded-full transition-all"
            style={{
              background: thinking?.active ? agent.color : agent.state === 'active' ? '#22c55e' : agent.state === 'idle' ? '#60a5fa' : agent.state === 'paused' ? '#fb923c' : '#6b7280',
              boxShadow: thinking?.active ? `0 0 8px ${agent.color}80` : agent.state === 'active' ? '0 0 6px rgba(34,197,94,0.5)' : 'none',
            }}
          />
        </div>
        {/* Thinking stream preview */}
        {thinking?.active && thinking.text ? (
          <p className="mt-1.5 text-[9px] text-on-surface-variant/35 truncate font-mono italic pl-7">
            {thinking.text.slice(-80)}
          </p>
        ) : presence?.surface ? (
          <p className="mt-1.5 text-[9px] text-on-surface-variant/35 truncate font-mono pl-7">
            {presence.surface}{presence.status ? ` · ${presence.status}` : ''}{presence.command ? ` · ${presence.command}` : ''}{presence.url ? ` · ${presence.url}` : ''}
          </p>
        ) : null}
      </div>

      {/* Tabs — scrollable, icon-only below 360px */}
      <div className="flex border-b border-outline-variant/10 shrink-0 overflow-x-auto scrollbar-none">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center justify-center gap-1 py-2 px-2.5 text-[9px] font-medium transition-colors whitespace-nowrap shrink-0 ${
              tab === t
                ? 'border-b-2'
                : 'text-on-surface-variant/40 hover:text-on-surface-variant/60'
            }`}
            style={tab === t ? { color: agent.color, borderColor: agent.color } : undefined}
            title={t.charAt(0).toUpperCase() + t.slice(1)}
          >
            <span className="material-symbols-outlined text-[13px]">{TAB_ICONS[t]}</span>
            <span className="hidden sm:inline">{t.charAt(0).toUpperCase() + t.slice(1)}</span>
          </button>
        ))}
      </div>

      {/* Tab content with smooth transitions */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${agent.name}-${tab}`}
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.12 }}
            className="absolute inset-0 flex flex-col"
          >
            {tab === 'terminal' && <CockpitTerminal agent={agent} />}
            {tab === 'files' && <CockpitFiles key={filesKey} agent={agent} />}
            {tab === 'browser' && <CockpitBrowser agent={agent} />}
            {tab === 'replay' && <CockpitReplay agent={agent} onFileReverted={() => setFilesKey(k => k + 1)} />}
            {tab === 'activity' && <CockpitActivity agent={agent} />}
            {tab === 'tasks' && <TaskQueue agent={agent} />}
            {tab === 'checkpoints' && <CheckpointPanel agent={agent} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
