import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { DecisionCard } from './DecisionCard';
import { JobProposal } from './JobProposal';
import { ProgressCard } from './ProgressCard';
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
    <div className="absolute bottom-full mb-1 left-0 z-50 flex gap-0.5 bg-surface-container-high border border-outline-variant/20 rounded-lg p-1 shadow-xl">
      {REACTION_EMOJIS.map((e) => (
        <button
          key={e}
          onClick={() => { onPick(e); onClose(); }}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-container-highest text-sm transition-colors"
        >
          {e}
        </button>
      ))}
    </div>
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
            onClick={() => api.reactToMessage(messageId, emoji, username).catch(() => {})}
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

export function ChatMessage({ message }: ChatMessageProps) {
  const [showPicker, setShowPicker] = useState(false);
  const agents = useChatStore((s) => s.agents);
  const settings = useChatStore((s) => s.settings);
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const pinMessage = useChatStore((s) => s.pinMessage);
  const agent = agents.find((a) => a.name === message.sender);
  const agentNames = new Set(agents.map(a => a.name));
  // Update color map for @mention highlighting
  agents.forEach(a => { _agentColorMap[a.name] = a.color; _agentColorMap[a.base] = a.color; });
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

  const highlightedText = message.text;

  const handleReact = (emoji: string) => {
    api.reactToMessage(message.id, emoji, settings.username).catch(() => {});
  };

  const decision = metadata.decision as { title: string; description: string; choices: { label: string; value: string }[]; resolved?: string } | undefined;
  const proposal = metadata.proposal as { title: string; assignee: string; description: string; accepted?: boolean } | undefined;
  const progress = metadata.progress as { steps: { label: string; status: 'done' | 'active' | 'pending' }[]; current: number; total: number; title?: string } | undefined;

  const handlePin = async () => {
    try { await api.pinMessage(message.id, !message.pinned); pinMessage(message.id, !message.pinned); } catch {}
  };

  if (isUser) {
    // ── USER MESSAGE (right side) ──
    return (
      <div className="group flex justify-end gap-2 py-1.5 msg-enter">
        <div className="relative opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
          <MsgAction icon="add_reaction" title="React" onClick={() => setShowPicker(!showPicker)} />
          <MsgAction icon="content_copy" title="Copy" onClick={() => navigator.clipboard.writeText(message.text).catch(() => {})} />
          <MsgAction icon="reply" title="Reply" onClick={() => setReplyTo(message)} />
          <MsgAction icon="delete" title="Delete" danger onClick={async () => { try { await api.deleteMessage(message.id); } catch {} }} />
          {showPicker && <ReactionPicker onPick={handleReact} onClose={() => setShowPicker(false)} />}
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
          >
            <div className="prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: MdCode, p: MdParagraph }}>{highlightedText}</ReactMarkdown>
            </div>
            <Attachments attachments={attachments} />
          </div>
          <div className="flex justify-end">
            <ReactionBar reactions={reactions} messageId={message.id} username={settings.username} />
          </div>
        </div>
      </div>
    );
  }

  // ── AGENT MESSAGE (left side) ──
  return (
    <div className="group flex gap-3 py-1.5 msg-enter">
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
          className="p-3 rounded-2xl rounded-tl-md text-sm text-on-surface leading-relaxed"
          style={{
            background: `color-mix(in srgb, ${agentColor} 5%, rgba(17,17,25,0.5))`,
            border: `1px solid color-mix(in srgb, ${agentColor} 8%, transparent)`,
          }}
        >
          <div className="prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: MdCode, p: MdParagraph }}>{highlightedText}</ReactMarkdown>
          </div>
          <Attachments attachments={attachments} />
          {progress && <ProgressCard steps={progress.steps} current={progress.current} total={progress.total} title={progress.title} />}
          {decision && <DecisionCard title={decision.title} description={decision.description} choices={decision.choices} resolved={decision.resolved} onChoose={() => {}} />}
          {proposal && <JobProposal title={proposal.title} assignee={proposal.assignee} description={proposal.description} accepted={proposal.accepted} onAccept={() => {}} onDismiss={() => {}} />}
        </div>

        {/* Reactions display */}
        <ReactionBar reactions={reactions} messageId={message.id} username={settings.username} />

        {/* Actions */}
        <div className="relative opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 mt-0.5">
          <MsgAction icon="add_reaction" title="React" onClick={() => setShowPicker(!showPicker)} />
          <MsgAction icon="reply" title="Reply" onClick={() => setReplyTo(message)} />
          <MsgAction icon="content_copy" title="Copy" onClick={() => navigator.clipboard.writeText(message.text).catch(() => {})} />
          <MsgAction icon="push_pin" title={message.pinned ? 'Unpin' : 'Pin'} active={message.pinned} onClick={handlePin} />
          <MsgAction icon="delete" title="Delete" danger onClick={async () => { try { await api.deleteMessage(message.id); } catch {} }} />
          {showPicker && <ReactionPicker onPick={handleReact} onClose={() => setShowPicker(false)} />}
        </div>
      </div>
    </div>
  );
}

function MsgAction({ icon, title, onClick, active, danger }: {
  icon: string; title: string; onClick: () => void; active?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-1 rounded-md transition-colors ${
        danger ? 'text-on-surface-variant/20 hover:text-red-400 hover:bg-red-400/10'
        : active ? 'text-tertiary'
        : 'text-on-surface-variant/20 hover:text-on-surface-variant/60 hover:bg-surface-container-high/40'
      }`}
      title={title}
    >
      <span className="material-symbols-outlined text-[13px]">{icon}</span>
    </button>
  );
}

function Attachments({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((att, i) => (
        <div key={i}>
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
  const { className, children, ...rest } = props;
  const match = /language-(\w+)/.exec(className || '');
  const codeStr = String(children).replace(/\n$/, '');
  if (match) return <CodeBlock code={codeStr} language={match[1]} />;
  return <code className={className} {...rest}>{children}</code>;
}
