import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  git_status?: string;
}

interface WorkspaceViewerProps {
  agentName: string;
  workspace: string;
  onClose: () => void;
}

/**
 * WorkspaceViewer — file tree and diff viewer for an agent's workspace.
 * Shows what files the agent has access to and any changes made.
 */
export function WorkspaceViewer({ agentName, workspace, onClose }: WorkspaceViewerProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [gitStatus, setGitStatus] = useState<string>('');

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/agents/${agentName}/workspace`);
      if (resp.ok) {
        const data = await resp.json();
        setFiles(data.files || []);
        setGitStatus(data.git_status || '');
      }
    } catch (e) {
      console.warn('Workspace load:', e);
    }
    setLoading(false);
  }, [agentName]);

  useEffect(() => { queueMicrotask(loadFiles); }, [loadFiles]);

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const viewFile = async (path: string) => {
    setSelectedFile(path);
    try {
      const resp = await fetch(`/api/agents/${agentName}/workspace/file?path=${encodeURIComponent(path)}`);
      if (resp.ok) {
        const data = await resp.json();
        setFileContent(data.content || '(empty)');
      } else {
        setFileContent('(could not read file)');
      }
    } catch {
      setFileContent('(error reading file)');
    }
  };

  const getIcon = (entry: FileEntry) => {
    if (entry.type === 'directory') return expandedDirs.has(entry.path) ? 'folder_open' : 'folder';
    const ext = entry.name.split('.').pop()?.toLowerCase();
    if (['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) return 'javascript';
    if (['py'].includes(ext || '')) return 'code';
    if (['md', 'txt'].includes(ext || '')) return 'description';
    if (['json', 'toml', 'yaml', 'yml'].includes(ext || '')) return 'settings';
    if (['css', 'html'].includes(ext || '')) return 'web';
    return 'draft';
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] flex"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

        <motion.div
          className="relative m-auto w-[900px] max-w-[95vw] h-[80vh] rounded-2xl flex overflow-hidden glass-card"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          {/* File Tree */}
          <div className="w-64 border-r border-outline-variant/10 flex flex-col">
            <div className="px-4 py-3 border-b border-outline-variant/10">
              <div className="text-xs font-semibold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-sm text-primary/60">folder_special</span>
                {agentName} Workspace
              </div>
              <div className="text-[9px] text-on-surface-variant/30 mt-0.5 font-mono truncate">{workspace}</div>
            </div>

            {gitStatus && (
              <div className="px-4 py-2 border-b border-outline-variant/5 text-[9px] text-on-surface-variant/40">
                <span className="material-symbols-outlined text-xs align-middle mr-1">commit</span>
                {gitStatus}
              </div>
            )}

            <div className="flex-1 overflow-y-auto py-2">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-on-surface-variant/20">
                  <span className="material-symbols-outlined animate-spin">sync</span>
                </div>
              ) : files.length === 0 ? (
                <div className="text-center py-8 text-[10px] text-on-surface-variant/30">No files found</div>
              ) : (
                files.map(f => (
                  <button
                    key={f.path}
                    onClick={() => f.type === 'directory' ? toggleDir(f.path) : viewFile(f.path)}
                    className={`w-full text-left px-4 py-1 flex items-center gap-2 text-[11px] hover:bg-surface-container/30 transition-colors ${
                      selectedFile === f.path ? 'bg-primary/8 text-primary' : 'text-on-surface-variant/60'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm opacity-40">{getIcon(f)}</span>
                    <span className="truncate">{f.name}</span>
                    {f.git_status && (
                      <span className={`text-[8px] font-bold shrink-0 ${
                        f.git_status.includes('M') ? 'text-amber-400' :
                        f.git_status.includes('A') || f.git_status === '??' ? 'text-green-400' :
                        f.git_status.includes('D') ? 'text-red-400' : 'text-on-surface-variant/40'
                      }`}>{f.git_status === '??' ? 'U' : f.git_status.trim()}</span>
                    )}
                    {f.size !== undefined && f.type === 'file' && !f.git_status && (
                      <span className="ml-auto text-[8px] text-on-surface-variant/20 shrink-0">{(f.size / 1024).toFixed(1)}K</span>
                    )}
                  </button>
                ))
              )}
            </div>

            <div className="px-4 py-2 border-t border-outline-variant/5">
              <button onClick={loadFiles} className="text-[10px] text-on-surface-variant/30 hover:text-primary transition-colors flex items-center gap-1" aria-label="Refresh file tree">
                <span className="material-symbols-outlined text-xs">refresh</span>
                Refresh
              </button>
            </div>
          </div>

          {/* File Content */}
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-3 border-b border-outline-variant/10 flex items-center justify-between">
              <div className="text-xs font-mono text-on-surface-variant/50 truncate">
                {selectedFile || 'Select a file to view'}
              </div>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-container text-on-surface-variant/30 hover:text-on-surface-variant transition-colors">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {selectedFile ? (
                <pre className="text-xs font-mono text-on-surface-variant/70 leading-relaxed whitespace-pre-wrap">
                  {fileContent.split('\n').map((line, i) => (
                    <div key={i} className="flex">
                      <span className="inline-block w-8 text-right mr-3 text-on-surface-variant/15 select-none shrink-0 tabular-nums">{i + 1}</span>
                      <span>{line}</span>
                    </div>
                  ))}
                </pre>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-on-surface-variant/20">
                  <span className="material-symbols-outlined text-[48px] mb-3">code</span>
                  <div className="text-sm">Select a file from the tree</div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
