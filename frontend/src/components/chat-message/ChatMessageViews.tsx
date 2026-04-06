import type { Dispatch, ReactNode, SetStateAction } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { motion, AnimatePresence } from 'framer-motion';

import { ChatWidget } from '../ChatWidget';
import { CodeBlock } from '../CodeBlock';
import { DecisionCard } from '../DecisionCard';
import { JobProposal } from '../JobProposal';
import { ProgressCard } from '../ProgressCard';
import { HandoffCard } from '../HandoffCard';
import { ApprovalCard } from '../ApprovalCard';
import { UrlPreviews } from '../UrlPreview';
import { GenerativeCard } from '../GenerativeCard';
import { AgentIcon } from '../AgentIcon';
import { StreamingText } from '../StreamingText';
import type { Agent, Attachment, Message, Settings } from '../../types';
import { getMentionColorMap } from './mentionColorMap';

type ParsedMetadata = Record<string, unknown>;

interface UserMessageViewProps {
  message: Message;
  settings: Settings;
  timestampLabel: string;
  metadata: ParsedMetadata;
  attachments: Attachment[];
  displayText: string;
  collapsed: boolean;
  editing: boolean;
  editText: string;
  isSelected: boolean;
  selectMode: boolean;
  reactionPicker: ReactNode;
  onToggleSelected: () => void;
  onTogglePicker: () => void;
  onCopy: () => void;
  onReply: () => void;
  onToggleBookmark: () => void;
  onSelectForDelete: () => void;
  onDoubleClick: () => void;
  onEditTextChange: (text: string) => void;
  onEditCancel: () => void;
  onEditSave: () => void;
  onToggleCollapsed: () => void;
  renderReactionBar: () => ReactNode;
}

interface AgentMessageViewProps {
  message: Message;
  settings: Settings;
  timestampLabel: string;
  metadata: ParsedMetadata;
  attachments: Attachment[];
  displayText: string;
  collapsed: boolean;
  streaming: boolean;
  showMobileActions: boolean;
  isSelected: boolean;
  selectMode: boolean;
  agent: Agent | undefined;
  agentColor: string;
  agents: Agent[];
  longPressHandlers: Record<string, unknown>;
  reactionPicker: ReactNode;
  replyPreview: ReactNode;
  onStreamingComplete: () => void;
  onToggleSelected: () => void;
  onTogglePicker: () => void;
  onReply: () => void;
  onCopy: () => void;
  onTogglePin: () => void;
  onToggleBookmark: () => void;
  onSelectForDelete: () => void;
  onToggleCollapsed: () => void;
  onToggleTTS: () => void;
  setShowMobileActions: Dispatch<SetStateAction<boolean>>;
  ttsPlaying: boolean;
  renderReactionBar: () => ReactNode;
}

const COLLAPSE_THRESHOLD = 600;

function MsgAction({ icon, title, onClick, active, danger }: {
  icon: string; title: string; onClick: () => void; active?: boolean; danger?: boolean;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.15, y: -1 }}
      whileTap={{ scale: 0.85 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className={`p-1.5 rounded-lg transition-colors ${
        danger ? 'text-on-surface-variant/20 hover:text-red-400 hover:bg-red-400/10'
        : active ? 'text-tertiary'
        : 'text-on-surface-variant/20 hover:text-on-surface-variant/60 hover:bg-surface-container-high/40'
      }`}
      title={title}
      aria-label={title}
    >
      <span className="material-symbols-outlined text-[14px]">{icon}</span>
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

function renderWithMentions(text: string): React.ReactNode[] {
  const colorMap = getMentionColorMap();
  const parts = text.split(/(@\w[\w-]*)/g);
  return parts.map((part, i) => {
    if (part.match(/^@\w/)) {
      const name = part.slice(1);
      const color = colorMap[name] || '#a78bfa';
      return (
        <span key={i} style={{
          background: `${color}25`,
          color,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MdParagraph({ children }: any) {
  if (typeof children === 'string') {
    return <p>{renderWithMentions(children)}</p>;
  }
  if (Array.isArray(children)) {
    return <p>{children.map((child: unknown, i: number) => {
      if (typeof child === 'string') return <span key={i}>{renderWithMentions(child)}</span>;
      return child as ReactNode;
    })}</p>;
  }
  return <p>{children}</p>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MdLink({ href, children }: any) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline break-all"
    >
      {children}
    </a>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MdCode({ className, children, ...rest }: any) {
  const match = /language-(\w+)/.exec(className || '');
  const codeStr = String(children).replace(/\n$/, '');
  if (match) {
    const hasHljs = typeof children === 'object';
    return <CodeBlock code={codeStr} language={match[1]} highlighted={hasHljs ? children : undefined} />;
  }
  return <code className={className} {...rest}>{children}</code>;
}

function MessageMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{ code: MdCode, p: MdParagraph, a: MdLink }}
    >
      {text}
    </ReactMarkdown>
  );
}

export function UserMessageView({
  message,
  settings,
  timestampLabel,
  metadata,
  attachments,
  displayText,
  collapsed,
  editing,
  editText,
  isSelected,
  selectMode,
  reactionPicker,
  onToggleSelected,
  onTogglePicker,
  onCopy,
  onReply,
  onToggleBookmark,
  onSelectForDelete,
  onDoubleClick,
  onEditTextChange,
  onEditCancel,
  onEditSave,
  onToggleCollapsed,
  renderReactionBar,
}: UserMessageViewProps) {
  return (
    <div
      data-msg-id={message.id}
      className={`group flex justify-end gap-2 py-2.5 ${selectMode ? 'pl-2' : ''} ${isSelected ? 'bg-red-500/5' : ''}`}
    >
      {selectMode && (
        <button onClick={onToggleSelected} className="shrink-0 self-center">
          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-red-500 border-red-500' : 'border-outline-variant/30 hover:border-red-400'}`}>
            {isSelected && <span className="material-symbols-outlined text-white text-[11px]">check</span>}
          </div>
        </button>
      )}
      <div className="relative opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
        {!selectMode && <>
          <MsgAction icon="add_reaction" title="React" onClick={onTogglePicker} />
          <MsgAction icon="content_copy" title="Copy" onClick={onCopy} />
          <MsgAction icon="reply" title="Reply" onClick={onReply} />
          <MsgAction icon="bookmark" title={message.bookmarked ? 'Remove bookmark' : 'Bookmark'} active={message.bookmarked} onClick={onToggleBookmark} />
          <MsgAction icon="delete" title="Select to delete" danger onClick={onSelectForDelete} />
        </>}
        <AnimatePresence>{reactionPicker}</AnimatePresence>
      </div>
      <div className="max-w-[70%] lg:max-w-[55%]">
        {(settings.showTimestamps !== false || settings.showSenderLabels !== false) && (
          <div className="flex items-center justify-end gap-2 mb-0.5">
            {settings.showTimestamps !== false && <span className="text-[10px] text-on-surface-variant/30" title={message.time}>{timestampLabel}</span>}
            {settings.showSenderLabels !== false && <span className="text-[11px] font-semibold text-[#38bdf8]">{settings.username}</span>}
          </div>
        )}
        <div
          className="p-3.5 rounded-2xl rounded-tr-md text-sm text-on-surface/90 leading-relaxed"
          style={{ background: 'rgba(124, 58, 237, 0.08)' }}
          onDoubleClick={onDoubleClick}
        >
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={(e) => onEditTextChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditSave(); }
                  if (e.key === 'Escape') onEditCancel();
                }}
                autoFocus
                className="w-full bg-surface-container/60 rounded-lg px-3 py-2 text-sm text-on-surface outline-none border border-secondary/20 resize-none"
                rows={3}
              />
              <div className="flex gap-1 justify-end">
                <button onClick={onEditCancel} className="text-[10px] px-2 py-1 rounded text-on-surface-variant/50 hover:bg-surface-container-high">Cancel</button>
                <button onClick={onEditSave} className="text-[10px] px-2 py-1 rounded bg-primary/15 text-primary font-medium">Save</button>
              </div>
            </div>
          ) : (
            <>
              {metadata.voice_note && (
                <div className="flex items-center gap-2 mb-1.5 p-2 rounded-xl bg-surface-container/40 border border-outline-variant/5">
                  <button
                    onClick={() => {
                      const audio = new Audio(metadata.voice_note as string);
                      audio.play().catch(() => { /* best-effort */ });
                    }}
                    className="p-1.5 rounded-full bg-primary/15 text-primary hover:bg-primary/25 transition-colors shrink-0"
                    aria-label="Play voice note"
                  >
                    <span className="material-symbols-outlined text-lg">play_arrow</span>
                  </button>
                  <div className="flex-1">
                    <div className="h-1 bg-primary/15 rounded-full overflow-hidden">
                      <div className="h-full bg-primary/40 rounded-full" style={{ width: '100%' }} />
                    </div>
                  </div>
                  {metadata.duration != null && (
                    <span className="text-[9px] text-on-surface-variant/30 font-mono shrink-0">
                      {Math.floor(Number(metadata.duration) / 60)}:{String(Number(metadata.duration) % 60).padStart(2, '0')}
                    </span>
                  )}
                </div>
              )}
              {message.type === 'widget' && metadata.html ? (
                <ChatWidget html={metadata.html as string} title={metadata.widgetTitle as string} />
              ) : (
                <div className="prose">
                  <MessageMarkdown text={displayText} />
                </div>
              )}
              {message.text.length > COLLAPSE_THRESHOLD && (
                <button
                  onClick={onToggleCollapsed}
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
          {renderReactionBar()}
        </div>
      </div>
    </div>
  );
}

export function AgentMessageView({
  message,
  settings,
  timestampLabel,
  metadata,
  attachments,
  displayText,
  collapsed,
  streaming,
  showMobileActions,
  isSelected,
  selectMode,
  agent,
  agentColor,
  agents,
  longPressHandlers,
  reactionPicker,
  replyPreview,
  onStreamingComplete,
  onToggleSelected,
  onTogglePicker,
  onReply,
  onCopy,
  onTogglePin,
  onToggleBookmark,
  onSelectForDelete,
  onToggleCollapsed,
  onToggleTTS,
  setShowMobileActions,
  ttsPlaying,
  renderReactionBar,
}: AgentMessageViewProps) {
  const progress = metadata.progress as { steps: { label: string; status: 'done' | 'active' | 'pending' }[]; current: number; total: number; title?: string } | undefined;
  const decision = metadata.decision as { title: string; description: string; choices: { label: string; value: string }[]; resolved?: string } | undefined;
  const proposal = metadata.proposal as { title: string; assignee: string; description: string; accepted?: boolean } | undefined;
  const handoff = metadata.handoff as { from: string; to: string; reason?: string; context?: string } | undefined;
  const approval = message.type === 'approval_request' ? metadata as { agent?: string; prompt?: string; responded?: string } : undefined;
  const card = metadata.card as { type: string; title?: string; [key: string]: unknown } | undefined;

  return (
    <div
      data-msg-id={message.id}
      className={`group flex gap-3 py-2.5 ${isSelected ? 'bg-red-500/5' : ''}`}
      {...longPressHandlers}
    >
      {selectMode && (
        <button onClick={onToggleSelected} className="shrink-0 self-center">
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
          {settings.showSenderLabels !== false && (
            <span className="text-[12px] font-semibold" style={{ color: agentColor }}>
              {agent?.label || message.sender}
            </span>
          )}
          {settings.showTimestamps !== false && <span className="text-[10px] text-on-surface-variant/30" title={message.time}>{timestampLabel}</span>}
          {message.pinned && <span className="material-symbols-outlined text-[10px] text-tertiary">push_pin</span>}
        </div>

        {replyPreview}

        <div
          className="p-3.5 rounded-2xl rounded-tl-md text-sm text-on-surface/90 leading-relaxed"
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            borderLeft: `2px solid ${agentColor}40`,
          }}
        >
          <div className="prose">
            {streaming ? (
              <p className="text-sm leading-relaxed">
                <StreamingText
                  text={displayText}
                  wordsPerMs={15}
                  onComplete={onStreamingComplete}
                />
              </p>
            ) : (
              <MessageMarkdown text={displayText} />
            )}
          </div>
          {message.text.length > COLLAPSE_THRESHOLD && (
            <button
              onClick={onToggleCollapsed}
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
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- card shape validated by 'type' in check */}
          {card && 'type' in card && <GenerativeCard card={card as any} agentColor={agentColor} />}
        </div>

        <div className="flex items-center gap-1">
          {message.bookmarked && <span className="material-symbols-outlined text-[12px] text-tertiary">bookmark</span>}
          {renderReactionBar()}
        </div>

        {!selectMode && (
          <div className="relative opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 mt-1">
            <MsgAction icon="add_reaction" title="React" onClick={onTogglePicker} />
            <MsgAction icon="reply" title="Reply" onClick={onReply} />
            <MsgAction icon="content_copy" title="Copy" onClick={onCopy} />
            <MsgAction icon={ttsPlaying ? 'stop_circle' : 'volume_up'} title={ttsPlaying ? 'Playing...' : 'Read aloud'} active={ttsPlaying} onClick={onToggleTTS} />
            <MsgAction icon="push_pin" title={message.pinned ? 'Unpin' : 'Pin'} active={message.pinned} onClick={onTogglePin} />
            <MsgAction icon="bookmark" title={message.bookmarked ? 'Remove bookmark' : 'Bookmark'} active={message.bookmarked} onClick={onToggleBookmark} />
            <MsgAction icon="delete" title="Select to delete" danger onClick={onSelectForDelete} />
            <AnimatePresence>{reactionPicker}</AnimatePresence>
          </div>
        )}

        <AnimatePresence>
          {showMobileActions && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="lg:hidden absolute left-8 mt-1 z-50 flex gap-1 bg-surface-container-high border border-outline-variant/20 rounded-xl p-1.5 shadow-xl"
              onClick={() => setShowMobileActions(false)}
            >
              {[
                { icon: 'add_reaction', fn: onTogglePicker },
                { icon: 'reply', fn: onReply },
                { icon: 'content_copy', fn: onCopy },
                { icon: 'push_pin', fn: onTogglePin },
                { icon: 'bookmark', fn: onToggleBookmark },
                { icon: 'delete', fn: onSelectForDelete },
              ].map(({ icon, fn }) => (
                <button key={icon} onClick={fn} className="p-2 rounded-lg text-on-surface-variant/60 hover:bg-surface-container-highest active:scale-95 transition-all">
                  <span className="material-symbols-outlined text-[18px]">{icon}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
