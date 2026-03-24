import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { CodeBlock } from './CodeBlock';
import { DecisionCard } from './DecisionCard';
import { JobProposal } from './JobProposal';
import { ProgressCard } from './ProgressCard';
import { HandoffCard } from './HandoffCard';
import { ApprovalCard } from './ApprovalCard';
import { UrlPreviews } from './UrlPreview';
import { GenerativeCard } from './GenerativeCard';
import { AgentIcon } from './AgentIcon';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import { timeAgo } from '../lib/timeago';
import type { Message, Attachment } from '../types';

const REACTION_EMOJIS = ['👍', '❤️', '🎉', '👀', '🔥', '✅'];

function parseAttachments(raw: unknown): Attachment[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) || []; } catch { return []; }
  }
  return [];
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return typeof p === 'object' && p ? p : {}; } catch { return {}; }
  }
  return {};
}

function parseReactions(raw: unknown): Record<string, string[]> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, string[]>;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return typeof p === 'object' && p ? p : {}; } catch { return {}; }
  }
  return {};
}

function ReactionPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0, y: 4 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.8, opacity: 0, y: 4 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="absolute bottom-full mb-1 left-0 z-50 flex gap-0.5 bg-surface-container-high border border-outline-variant/20 rounded-lg p-1 shadow-xl"
    >
      {REACTION_EMOJIS.map((e) => (
        <motion.button
          key={e}
          onClick={() => { onPick(e); onClose(); }}
          whileHover={{ scale: 1.2 }}
          whileTap={{ scale: 0.9 }}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-container-highest text-sm transition-colors"
        >
          {e}
        </motion.button>
      ))}
    </motion.div>
  );
}

function ReactionBar({ reactions, messageId, username }: { reactions: Record<string, string[]>; messageId: number; username: string }) {
  const entries = Object.entries(reactions).filter(([, users]) => users.length > 0);
  if (!entries.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {entries.map(([emoji, users]) => {
        const active = users.includes(username) || users.includes('You');
        return (
          <button
            key={emoji}
            onClick={() => api.reactToMessage(messageId, emoji, username).catch((e: Error) => console.warn('Reaction failed:', e.message))}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] transition-colors ${
              active
                ? 'bg-primary/15 border border-primary/25 text-primary'
                : 'bg-surface-container-high/50 border border-outline-variant/10 text-on-surface-variant/60 hover:bg-surface-container-highest/60'
            }`}
          >
            <span>{emoji}</span>
            <span className="font-medium">{users.length}</span>
          </button>
        );
      })}
    </div>
  );
}

interface ChatMessageProps { message: Message; }

const COLLAPSE_THRESHOLD = 600; // characters

export function ChatMessage({ message }: ChatMessageProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [collapsed, setCollapsed] = useState(message.text.length > COLLAPSE_THRESHOLD);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const agents = useChatStore((s) => s.agents);
  const settings = useChatStore((s) => s.settings);
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const pinMessage = useChatStore((s) => s.pinMessage);
  const bookmarkMessage = useChatStore((s) => s.bookmarkMessage);
  const editMessageInStore = useChatStore((s) => s.editMessage);
  const selectMode = useChatStore((s) => s.selectMode);
  const selectedIds = useChatStore((s) => s.selectedIds);
  const toggleSelected = useChatStore((s) => s.toggleSelected);
  const setSelectMode = useChatStore((s) => s.setSelectMode);
  const isSelected = selectedIds.has(message.id);
  const agent = agents.find((a) => a.name === message.sender);
  const agentNames = new Set(agents.map(a => a.name));
  // v2.5.1: Build color map via useMemo instead of module-level mutation (React safety)
  useMemo(() => {
    const map: Record<string, string> = {};
    agents.forEach(a => { map[a.name] = a.color; map[a.base] = a.color; });
    _agentColorMap = map; // Still needed for renderWithMentions helper
  }, [agents]);
  const isUser = message.sender === settings.username || message.sender === 'You' || (!agentNames.has(message.sender) && message.type === 'chat');
  const isSystem = message.type === 'system' || message.type === 'join';

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <div className="text-[10px] text-on-surface-variant/30 uppercase tracking-widest bg-surface-container/30 px-4 py-1 rounded-full">
          {message.text}
        </div>
      </div>
    );
  }

  const metadata = parseMetadata(message.metadata);
  const attachments = parseAttachments(message.attachments);
  const reactions = parseReactions(message.reactions);
  const agentColor = agent?.color || '#a78bfa';

  const handleReact = (emoji: string) => {
    api.reactToMessage(message.id, emoji, settings.username).catch((e: Error) => {
      console.warn('Reaction failed:', e.message);
    });
  };

  const decision = metadata.decision as { title: string; description: string; choices: { label: string; value: string }[]; resolved?: string } | undefined;
  const proposal = metadata.proposal as { title: string; assignee: string; description: string; accepted?: boolean } | undefined;
  const progress = metadata.progress as { steps: { label: string; status: 'done' | 'active' | 'pending' }[]; current: number; total: number; title?: string } | undefined;
  const handoff = metadata.handoff as { from: string; to: string; reason?: string; context?: string } | undefined;
  const approval = message.type === 'approval_request' ? metadata as { agent?: string; prompt?: string; responded?: string } : undefined;
  const card = metadata.card as { type: string; title?: string; [key: string]: unknown } | undefined;

  const handlePin = async () => {
    try { await api.pinMessage(message.id, !message.pinned); pinMessage(message.id, !message.pinned); } catch {}
  };

  const handleBookmark = async () => {
    try { await api.bookmarkMessage(message.id, !message.bookmarked); bookmarkMessage(message.id, !message.bookmarked); } catch {}
  };

  const handleEdit = async () => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === message.text) { setEditing(false); return; }
    try { await api.editMessage(message.id, trimmed); editMessageInStore(message.id, trimmed); } catch {}
    setEditing(false);
  };

  const handleDoubleClick = () => {
    if (isUser) {
      setEditing(true);
      setEditText(message.text);
    }
  };

  const displayText = collapsed ? message.text.slice(0, COLLAPSE_THRESHOLD) + '...' : message.text;

  if (isUser) {
    // ── USER MESSAGE (right side) ──
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={`group flex justify-end gap-2 py-1.5 msg-enter ${selectMode ? 'pl-2' : ''} ${isSelected ? 'bg-red-500/5' : ''}`}>
        {selectMode && (
          <button onClick={() => toggleSelected(message.id)} className="shrink-0 self-center">
            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-red-500 border-red-500' : 'border-outline-variant/30 hover:border-red-400'}`}>
              {isSelected && <span className="material-symbols-outlined text-white text-[11px]">check</span>}
            </div>
          </button>
        )}
        <div className="relative opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
          {!selectMode && <>
            <MsgAction icon="add_reaction" title="React" onClick={() => setShowPicker(!showPicker)} />
            <MsgAction icon="content_copy" title="Copy" onClick={() => navigator.clipboard?.writeText(message.text).catch(() => { /* clipboard unavailable */ })} />
            <MsgAction icon="reply" title="Reply" onClick={() => setReplyTo(message)} />
            <MsgAction icon="bookmark" title={message.bookmarked ? 'Remove bookmark' : 'Bookmark'} active={message.bookmarked} onClick={handleBookmark} />
            <MsgAction icon="delete" title="Select to delete" danger onClick={() => { setSelectMode(true); toggleSelected(message.id); }} />
          </>}
          <AnimatePresence>{showPicker && <ReactionPicker onPick={handleReact} onClose={() => setShowPicker(false)} />}</AnimatePresence>
        </div>
        <div className="max-w-[70%] lg:max-w-[55%]">
          <div className="flex items-center justify-end gap-2 mb-0.5">
            <span className="text-[10px] text-on-surface-variant/30" title={message.time}>{timeAgo(message.timestamp)}</span>
            <span className="text-[11px] font-semibold text-[#38bdf8]">{settings.username}</span>
          </div>
          <div
            className="p-3 rounded-2xl rounded-tr-md text-sm text-on-surface leading-relaxed"
            style={{
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.12)',
            }}
            onDoubleClick={handleDoubleClick}
          >
            {editing ? (
              <div className="space-y-2">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEdit(); }
                    if (e.key === 'Escape') setEditing(false);
                  }}
                  autoFocus
                  className="w-full bg-surface-container/60 rounded-lg px-3 py-2 text-sm text-on-surface outline-none border border-secondary/20 resize-none"
                  rows={3}
                />
                <div className="flex gap-1 justify-end">
                  <button onClick={() => setEditing(false)} className="text-[10px] px-2 py-1 rounded text-on-surface-variant/50 hover:bg-surface-container-high">Cancel</button>
                  <button onClick={handleEdit} className="text-[10px] px-2 py-1 rounded bg-primary/15 text-primary font-medium">Save</button>
                </div>
              </div>
            ) : (
              <>
                <div className="prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ code: MdCode, p: MdParagraph }}>{displayText}</ReactMarkdown>
                </div>
                {message.text.length > COLLAPSE_THRESHOLD && (
                  <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="text-[10px] text-secondary/70 hover:text-secondary mt-1 font-medium"
                  >
                    {collapsed ? 'Show more' : 'Show less'}
                  </button>
                )}
              </>
            )}
            <UrlPreviews text={message.text} />
            <Attachments attachments={attachments} />
          </div>
          <div className="flex justify-end items-center gap-1">
            {message.bookmarked && <span className="material-symbols-outlined text-[12px] text-tertiary">bookmark</span>}
            <ReactionBar reactions={reactions} messageId={message.id} username={settings.username} />
          </div>
        </div>
      </motion.div>
    );
  }

  // ── AGENT MESSAGE (left side) ──
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`group flex gap-3 py-1.5 msg-enter ${isSelected ? 'bg-red-500/5' : ''}`}>
      {selectMode && (
        <button onClick={() => toggleSelected(message.id)} className="shrink-0 self-center">
          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-red-500 border-red-500' : 'border-outline-variant/30 hover:border-red-400'}`}>
            {isSelected && <span className="material-symbols-outlined text-white text-[11px]">check</span>}
          </div>
        </button>
      )}
      <div className="shrink-0 mt-1">
        <AgentIcon base={agent?.base || message.sender} color={agentColor} size={34} />
      </div>
      <div className="max-w-[80%] lg:max-w-[70%] min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11px] font-bold" style={{ color: agentColor, textShadow: `0 0 10px ${agentColor}40` }}>
            {agent?.label || message.sender}
          </span>
          <span className="text-[10px] text-on-surface-variant/30" title={message.time}>{timeAgo(message.timestamp)}</span>
          {message.pinned && <span className="material-symbols-outlined text-[10px] text-tertiary">push_pin</span>}
        </div>

        {message.reply_to != null && (
          <div className="text-[10px] text-on-surface-variant/40 border-l-2 border-outline-variant/20 pl-2 mb-1 italic">
            replying to #{message.reply_to}
          </div>
        )}

        <div
          className="p-3 rounded-2xl rounded-tl-md text-sm text-on-surface leading-relaxed bubble-glow"
          style={{
            background: `color-mix(in srgb, ${agentColor} 5%, rgba(17,17,25,0.5))`,
            border: `1px solid color-mix(in srgb, ${agentColor} 8%, transparent)`,
          }}
        >
          <div className="prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ code: MdCode, p: MdParagraph }}>{displayText}</ReactMarkdown>
          </div>
          {message.text.length > COLLAPSE_THRESHOLD && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="text-[10px] text-secondary/70 hover:text-secondary mt-1 font-medium"
            >
              {collapsed ? 'Show more' : 'Show less'}
            </button>
          )}
          <UrlPreviews text={message.text} />
          <Attachments attachments={attachments} />
          {progress && <ProgressCard steps={progress.steps} current={progress.current} total={progress.total} title={progress.title} />}
          {decision && <DecisionCard title={decision.title} description={decision.description} choices={decision.choices} resolved={decision.resolved} onChoose={() => {}} />}
          {proposal && <JobProposal title={proposal.title} assignee={proposal.assignee} description={proposal.description} accepted={proposal.accepted} onAccept={() => {}} onDismiss={() => {}} />}
          {handoff && <HandoffCard from={handoff.from} to={handoff.to} reason={handoff.reason} context={handoff.context} fromColor={agents.find(a => a.name === handoff.from)?.color} toColor={agents.find(a => a.name === handoff.to)?.color} />}
          {approval && <ApprovalCard messageId={message.id} agent={approval.agent || message.sender} agentColor={agentColor} agentBase={agent?.base} prompt={approval.prompt || message.text} responded={approval.responded} />}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {card && 'type' in card && <GenerativeCard card={card as any} agentColor={agentColor} />}
        </div>

        {/* Reactions display */}
        <div className="flex items-center gap-1">
          {message.bookmarked && <span className="material-symbols-outlined text-[12px] text-tertiary">bookmark</span>}
          <ReactionBar reactions={reactions} messageId={message.id} username={settings.username} />
        </div>

        {/* Actions */}
        {!selectMode && (
          <div className="relative opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 mt-0.5">
            <MsgAction icon="add_reaction" title="React" onClick={() => setShowPicker(!showPicker)} />
            <MsgAction icon="reply" title="Reply" onClick={() => setReplyTo(message)} />
            <MsgAction icon="content_copy" title="Copy" onClick={() => navigator.clipboard?.writeText(message.text).catch(() => { /* clipboard unavailable */ })} />
            <MsgAction icon="push_pin" title={message.pinned ? 'Unpin' : 'Pin'} active={message.pinned} onClick={handlePin} />
            <MsgAction icon="bookmark" title={message.bookmarked ? 'Remove bookmark' : 'Bookmark'} active={message.bookmarked} onClick={handleBookmark} />
            <MsgAction icon="delete" title="Select to delete" danger onClick={() => { setSelectMode(true); toggleSelected(message.id); }} />
            <AnimatePresence>{showPicker && <ReactionPicker onPick={handleReact} onClose={() => setShowPicker(false)} />}</AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function MsgAction({ icon, title, onClick, active, danger }: {
  icon: string; title: string; onClick: () => void; active?: boolean; danger?: boolean;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.15, y: -1 }}
      whileTap={{ scale: 0.85 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className={`p-1 rounded-md transition-colors ${
        danger ? 'text-on-surface-variant/20 hover:text-red-400 hover:bg-red-400/10'
        : active ? 'text-tertiary'
        : 'text-on-surface-variant/20 hover:text-on-surface-variant/60 hover:bg-surface-container-high/40'
      }`}
      title={title}
    >
      <span className="material-symbols-outlined text-[13px]">{icon}</span>
    </motion.button>
  );
}

function Attachments({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((att, i) => (
        <div key={att.url || i}>
          {att.type?.startsWith('image/') ? (
            <img src={att.url} alt={att.name} className="max-w-[280px] max-h-[180px] rounded-lg border border-outline-variant/10 object-cover" />
          ) : (
            <a href={att.url} className="text-xs text-secondary underline" target="_blank" rel="noopener noreferrer">{att.name}</a>
          )}
        </div>
      ))}
    </div>
  );
}

// Render text with @mention highlights
// Agent color map — updated by ChatMessage on render
let _agentColorMap: Record<string, string> = {};

function renderWithMentions(text: string): React.ReactNode[] {
  const parts = text.split(/(@\w[\w-]*)/g);
  return parts.map((part, i) => {
    if (part.match(/^@\w/)) {
      const name = part.slice(1); // remove @
      const color = _agentColorMap[name] || '#a78bfa';
      return (
        <span key={i} style={{
          background: `${color}25`,
          color: color,
          padding: '1px 6px',
          borderRadius: '4px',
          fontWeight: 600,
          fontSize: 'inherit',
          border: `1px solid ${color}20`,
        }}>
          {part}
        </span>
      );
    }
    return part;
  });
}

// Custom paragraph that highlights @mentions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MdParagraph(props: any) {
  const { children } = props;
  if (typeof children === 'string') {
    return <p>{renderWithMentions(children)}</p>;
  }
  // Process children array
  if (Array.isArray(children)) {
    return <p>{children.map((child: unknown, i: number) => {
      if (typeof child === 'string') return <span key={i}>{renderWithMentions(child)}</span>;
      return child as React.ReactNode;
    })}</p>;
  }
  return <p>{children}</p>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MdCode(props: any) {
  const { className, children, node, ...rest } = props;
  const match = /language-(\w+)/.exec(className || '');
  const codeStr = String(children).replace(/\n$/, '');
  // For fenced code blocks: pass highlighted HTML from rehype-highlight
  if (match) {
    // rehype-highlight adds hljs classes to the children — pass raw HTML
    const hasHljs = typeof children === 'object';
    return <CodeBlock code={codeStr} language={match[1]} highlighted={hasHljs ? props.children : undefined} />;
  }
  return <code className={className} {...rest}>{children}</code>;
}

