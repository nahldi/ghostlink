import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface WorkflowNode {
  id: string;
  type: 'agent' | 'condition' | 'action' | 'trigger';
  label: string;
  config: Record<string, string>;
  x: number;
  y: number;
}

interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
}

interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  enabled: boolean;
}

interface WorkflowBuilderProps {
  onClose: () => void;
  onSave: (workflow: Workflow) => void;
  initialWorkflow?: Workflow;
}

const NODE_TYPES = [
  { type: 'trigger', label: 'Trigger', icon: 'bolt', color: '#f59e0b', desc: 'Start event (webhook, schedule, message)' },
  { type: 'agent', label: 'Agent', icon: 'smart_toy', color: '#a78bfa', desc: 'Run an AI agent task' },
  { type: 'condition', label: 'Condition', icon: 'call_split', color: '#38bdf8', desc: 'Branch based on a condition' },
  { type: 'action', label: 'Action', icon: 'play_arrow', color: '#34d399', desc: 'Execute an action (send, post, save)' },
] as const;

let _nodeCounter = 0;

/**
 * WorkflowBuilder — visual drag-and-drop workflow editor.
 * Connect agents, tools, conditions, and data flows visually.
 */
export function WorkflowBuilder({ onClose, onSave, initialWorkflow }: WorkflowBuilderProps) {
  const [workflow, setWorkflow] = useState<Workflow>(
    initialWorkflow || { id: `wf-${Date.now()}`, name: 'New Workflow', nodes: [], edges: [], enabled: true }
  );
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  const addNode = useCallback((type: string) => {
    const nodeType = NODE_TYPES.find(n => n.type === type);
    if (!nodeType) return;
    const id = `node-${++_nodeCounter}`;
    const node: WorkflowNode = {
      id,
      type: type as WorkflowNode['type'],
      label: nodeType.label,
      config: {},
      x: 100 + Math.random() * 300,
      y: 80 + workflow.nodes.length * 100,
    };
    setWorkflow(w => ({ ...w, nodes: [...w.nodes, node] }));
    setSelectedNode(id);
  }, [workflow.nodes.length]);

  const removeNode = useCallback((id: string) => {
    setWorkflow(w => ({
      ...w,
      nodes: w.nodes.filter(n => n.id !== id),
      edges: w.edges.filter(e => e.from !== id && e.to !== id),
    }));
    if (selectedNode === id) setSelectedNode(null);
  }, [selectedNode]);

  const startConnect = useCallback((id: string) => {
    if (connecting) {
      // Complete connection
      if (connecting !== id) {
        setWorkflow(w => ({
          ...w,
          edges: [...w.edges, { from: connecting, to: id }],
        }));
      }
      setConnecting(null);
    } else {
      setConnecting(id);
    }
  }, [connecting]);

  const updateNodeConfig = useCallback((id: string, key: string, value: string) => {
    setWorkflow(w => ({
      ...w,
      nodes: w.nodes.map(n => n.id === id ? { ...n, config: { ...n.config, [key]: value } } : n),
    }));
  }, []);

  const selected = workflow.nodes.find(n => n.id === selectedNode);
  const nodeTypeInfo = selected ? NODE_TYPES.find(t => t.type === selected.type) : null;

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
          className="relative m-auto w-[1000px] max-w-[95vw] h-[80vh] rounded-2xl flex overflow-hidden"
          style={{ background: 'linear-gradient(160deg, #141420 0%, #08080f 100%)', border: '1px solid rgba(167, 139, 250, 0.1)' }}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Sidebar — Node Palette */}
          <div className="w-56 border-r border-outline-variant/10 flex flex-col">
            <div className="px-4 py-3 border-b border-outline-variant/10">
              <input
                type="text"
                value={workflow.name}
                onChange={e => setWorkflow(w => ({ ...w, name: e.target.value }))}
                className="w-full bg-transparent text-sm font-semibold text-on-surface outline-none"
                aria-label="Workflow name"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <div className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-2">Add Node</div>
              {NODE_TYPES.map(nt => (
                <button
                  key={nt.type}
                  onClick={() => addNode(nt.type)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-container/40 transition-colors text-left"
                  aria-label={`Add ${nt.label} node`}
                >
                  <span className="material-symbols-outlined text-sm" style={{ color: nt.color }}>{nt.icon}</span>
                  <div>
                    <div className="text-[11px] font-medium text-on-surface">{nt.label}</div>
                    <div className="text-[8px] text-on-surface-variant/30">{nt.desc}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="p-3 border-t border-outline-variant/10 space-y-2">
              <button
                onClick={() => onSave(workflow)}
                className="w-full py-2 rounded-xl bg-primary-container text-white text-xs font-semibold hover:brightness-110 transition-all"
                aria-label="Save workflow"
              >
                Save Workflow
              </button>
              <button
                onClick={onClose}
                className="w-full py-2 rounded-xl bg-surface-container/50 text-on-surface-variant/60 text-xs hover:text-on-surface transition-colors"
                aria-label="Cancel"
              >
                Cancel
              </button>
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 relative overflow-auto" style={{ backgroundImage: 'radial-gradient(circle, rgba(167,139,250,0.03) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
            {/* Edges (SVG lines) */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {workflow.edges.map((edge, i) => {
                const fromNode = workflow.nodes.find(n => n.id === edge.from);
                const toNode = workflow.nodes.find(n => n.id === edge.to);
                if (!fromNode || !toNode) return null;
                return (
                  <line
                    key={i}
                    x1={fromNode.x + 70} y1={fromNode.y + 25}
                    x2={toNode.x + 70} y2={toNode.y + 25}
                    stroke="rgba(167,139,250,0.3)"
                    strokeWidth={2}
                    markerEnd="url(#arrow)"
                  />
                );
              })}
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(167,139,250,0.4)" />
                </marker>
              </defs>
            </svg>

            {/* Nodes */}
            {workflow.nodes.map(node => {
              const info = NODE_TYPES.find(t => t.type === node.type);
              return (
                <div
                  key={node.id}
                  className={`absolute cursor-pointer select-none rounded-xl border transition-all ${
                    selectedNode === node.id
                      ? 'border-primary/40 ring-2 ring-primary/15'
                      : connecting === node.id
                        ? 'border-secondary/40 ring-2 ring-secondary/15'
                        : 'border-outline-variant/10 hover:border-outline-variant/20'
                  }`}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: 140,
                    background: 'rgba(20,20,32,0.9)',
                  }}
                  onClick={() => setSelectedNode(node.id)}
                  onDoubleClick={() => startConnect(node.id)}
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className="material-symbols-outlined text-sm" style={{ color: info?.color }}>{info?.icon}</span>
                    <span className="text-[10px] font-medium text-on-surface truncate">{node.config.label || node.label}</span>
                  </div>
                </div>
              );
            })}

            {connecting && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-secondary/15 border border-secondary/20 text-[10px] text-secondary font-medium">
                Click another node to connect
              </div>
            )}

            {workflow.nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <span className="material-symbols-outlined text-3xl text-on-surface-variant/10">account_tree</span>
                  <div className="text-[11px] text-on-surface-variant/20 mt-2">Add nodes from the sidebar to build your workflow</div>
                </div>
              </div>
            )}
          </div>

          {/* Properties Panel */}
          {selected && (
            <div className="w-56 border-l border-outline-variant/10 flex flex-col">
              <div className="px-4 py-3 border-b border-outline-variant/10 flex items-center justify-between">
                <div className="text-xs font-semibold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm" style={{ color: nodeTypeInfo?.color }}>{nodeTypeInfo?.icon}</span>
                  Properties
                </div>
                <button onClick={() => removeNode(selected.id)} className="p-1 rounded hover:bg-red-500/10 text-on-surface-variant/30 hover:text-red-400 transition-colors" aria-label="Delete node">
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                <div>
                  <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-1 block">Label</label>
                  <input
                    type="text"
                    value={selected.config.label || selected.label}
                    onChange={e => updateNodeConfig(selected.id, 'label', e.target.value)}
                    className="setting-input text-[11px]"
                    aria-label="Node label"
                  />
                </div>

                {selected.type === 'agent' && (
                  <div>
                    <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-1 block">Agent</label>
                    <input
                      type="text"
                      value={selected.config.agent || ''}
                      onChange={e => updateNodeConfig(selected.id, 'agent', e.target.value)}
                      className="setting-input text-[11px]"
                      placeholder="claude, codex, gemini..."
                      aria-label="Agent name"
                    />
                  </div>
                )}

                {selected.type === 'trigger' && (
                  <div>
                    <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-1 block">Event</label>
                    <select
                      value={selected.config.event || ''}
                      onChange={e => updateNodeConfig(selected.id, 'event', e.target.value)}
                      className="setting-input text-[11px]"
                      aria-label="Trigger event"
                    >
                      <option value="">Select trigger...</option>
                      <option value="webhook">Webhook</option>
                      <option value="schedule">Schedule (cron)</option>
                      <option value="message">New message</option>
                      <option value="agent_join">Agent join</option>
                    </select>
                  </div>
                )}

                {selected.type === 'condition' && (
                  <div>
                    <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-1 block">Condition</label>
                    <input
                      type="text"
                      value={selected.config.condition || ''}
                      onChange={e => updateNodeConfig(selected.id, 'condition', e.target.value)}
                      className="setting-input text-[11px]"
                      placeholder="e.g. result.success === true"
                      aria-label="Condition expression"
                    />
                  </div>
                )}

                {selected.type === 'action' && (
                  <div>
                    <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-1 block">Action</label>
                    <select
                      value={selected.config.action || ''}
                      onChange={e => updateNodeConfig(selected.id, 'action', e.target.value)}
                      className="setting-input text-[11px]"
                      aria-label="Action type"
                    >
                      <option value="">Select action...</option>
                      <option value="send_message">Send message</option>
                      <option value="spawn_agent">Spawn agent</option>
                      <option value="webhook">Call webhook</option>
                      <option value="save_file">Save to file</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider mb-1 block">Notes</label>
                  <textarea
                    value={selected.config.notes || ''}
                    onChange={e => updateNodeConfig(selected.id, 'notes', e.target.value)}
                    className="setting-input text-[11px] h-16 resize-none"
                    placeholder="Optional description..."
                    aria-label="Node notes"
                  />
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
