import { useState, useMemo, useEffect, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { toast } from './Toast';
import { AgentMessageView, UserMessageView } from './chat-message/ChatMessageViews';
import { setMentionColorMap } from './chat-message/mentionColorMap';
import { useLongPress } from '../hooks/useLongPress';
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
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    const buttons = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[data-reaction-index]') || []
    );
    if (!buttons.length) return;

    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (index + delta + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0, y: 4 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.8, opacity: 0, y: 4 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="absolute bottom-full mb-1 left-0 z-50 flex gap-0.5 bg-surface-container-high border border-outline-variant/20 rounded-lg p-1 shadow-xl"
      role="toolbar"
      aria-label="Reaction picker"
    >
      {REACTION_EMOJIS.map((e, index) => (
        <motion.button
          key={e}
          type="button"
          data-reaction-index={index}
          autoFocus={index === 0}
          onClick={() => { onPick(e); onClose(); }}
          onKeyDown={(event) => handleKeyDown(event, index)}
          whileHover={{ scale: 1.2 }}
          whileTap={{ scale: 0.9 }}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-container-highest text-sm transition-colors"
          aria-label={`React with ${e}`}
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
            <span style={{ fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif' }}>{emoji}</span>
            <span className="font-medium">{users.length}</span>
          </button>
        );
      })}
    </div>
  );
}

interface ChatMessageProps { message: Message; }

const COLLAPSE_THRESHOLD = 600; // characters

// v3.2.0: Track which messages have completed streaming to avoid re-streaming
// Bounded to prevent memory leak in long sessions
const _streamedIds = new Set<number>();
const MAX_STREAMED = 2000;
function _markStreamed(id: number) {
  _streamedIds.add(id);
  if (_streamedIds.size > MAX_STREAMED) {
    const first = _streamedIds.values().next().value;
    if (first !== undefined) _streamedIds.delete(first);
  }
}

function ReplyPreview({ messageId }: { messageId: number }) {
  const messages = useChatStore((s) => s.messages);
  const parent = messages.find((m) => m.id === messageId);
  if (!parent) {
    return (
      <div className="text-[10px] text-on-surface-variant/30 border-l-2 border-outline-variant/15 pl-2 mb-1 italic">
        replying to message #{messageId}
      </div>
    );
  }
  return (
    <button
      onClick={() => {
        const el = document.querySelector(`[data-msg-id="${messageId}"]`);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('ring-2', 'ring-primary/30'); setTimeout(() => el.classList.remove('ring-2', 'ring-primary/30'), 2000); }
      }}
      className="flex items-center gap-1.5 text-[10px] text-on-surface-variant/40 border-l-2 border-outline-variant/20 pl-2 mb-1 hover:text-on-surface-variant/60 transition-colors text-left w-full"
    >
      <span className="font-semibold" style={{ color: parent.sender === 'system' ? undefined : 'var(--primary)' }}>
        {parent.sender}
      </span>
      <span className="truncate opacity-70">{parent.text.slice(0, 80)}{parent.text.length > 80 ? '...' : ''}</span>
    </button>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [collapsed, setCollapsed] = useState(message.text.length > COLLAPSE_THRESHOLD);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  // Streaming: agent messages <3s old that haven't streamed yet
  const [streaming, setStreaming] = useState(() => {
    const isNew = !_streamedIds.has(message.id) && (Date.now() / 1000 - message.timestamp) < 3;
    return isNew;
  });
  // Mobile long-press action menu
  const [showMobileActions, setShowMobileActions] = useState(false);
  // TTS playback
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const longPress = useLongPress(() => setShowMobileActions(true));
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
  // v4.2.1: Build color map (updates shared ref for MdParagraph mention highlighting)
  const agentColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    agents.forEach(a => { map[a.name] = a.color; map[a.base] = a.color; });
    return map;
  }, [agents]);
  // Sync to module-level ref for renderWithMentions (external to React tree)
  useEffect(() => { setMentionColorMap(agentColorMap); }, [agentColorMap]);
  const isUser = message.sender === settings.username || message.sender === 'You' || (!agentNames.has(message.sender) && message.type === 'chat');
  const isSystem = message.type === 'system' || message.type === 'join';

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <div className="text-[10px] text-on-surface-variant/30 tracking-widest bg-surface-container/30 px-4 py-1 rounded-full uppercase [&_strong]:text-on-surface-variant/60 [&_strong]:font-semibold [&_strong]:normal-case [&_em]:normal-case [&_p]:inline">
          <ReactMarkdown components={{ p: ({ children }: { children?: ReactNode }) => <>{children}</> }}>{message.text}</ReactMarkdown>
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

  const handlePin = async () => {
    try { await api.pinMessage(message.id, !message.pinned); pinMessage(message.id, !message.pinned); } catch { /* best-effort */ }
  };

  const handleBookmark = async () => {
    try { await api.bookmarkMessage(message.id, !message.bookmarked); bookmarkMessage(message.id, !message.bookmarked); } catch { /* best-effort */ }
  };

  const handleEdit = async () => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === message.text) { setEditing(false); return; }
    try { await api.editMessage(message.id, trimmed); editMessageInStore(message.id, trimmed); } catch { /* best-effort */ }
    setEditing(false);
  };

  const handleTTS = async () => {
    if (ttsPlaying) return;
    setTtsPlaying(true);
    try {
      const r = await api.textToSpeech(message.text);
      if (r.audio) {
        const audio = new Audio(r.audio);
        audio.onended = () => setTtsPlaying(false);
        audio.onerror = () => setTtsPlaying(false);
        audio.play().catch(() => setTtsPlaying(false));
      } else {
        setTtsPlaying(false);
      }
    } catch {
      setTtsPlaying(false);
    }
  };

  const handleDoubleClick = () => {
    if (isUser) {
      setEditing(true);
      setEditText(message.text);
    }
  };

  const displayText = collapsed ? message.text.slice(0, COLLAPSE_THRESHOLD) + '...' : message.text;

  const timestampLabel = `${timeAgo(message.timestamp)}${message.edited ? ' (edited)' : ''}`;
  const reactionPicker = showPicker ? <ReactionPicker onPick={handleReact} onClose={() => setShowPicker(false)} /> : null;
  const renderReactionBar = () => <ReactionBar reactions={reactions} messageId={message.id} username={settings.username} />;

  if (isUser) {
    return (
      <UserMessageView
        message={message}
        settings={settings}
        timestampLabel={timestampLabel}
        metadata={metadata}
        attachments={attachments}
        displayText={displayText}
        collapsed={collapsed}
        editing={editing}
        editText={editText}
        isSelected={isSelected}
        selectMode={selectMode}
        reactionPicker={reactionPicker}
        onToggleSelected={() => toggleSelected(message.id)}
        onTogglePicker={() => setShowPicker(!showPicker)}
        onCopy={() => navigator.clipboard?.writeText(message.text).then(() => toast('Copied to clipboard', 'success')).catch(() => { /* clipboard unavailable */ })}
        onReply={() => setReplyTo(message)}
        onToggleBookmark={handleBookmark}
        onSelectForDelete={() => { setSelectMode(true); toggleSelected(message.id); }}
        onDoubleClick={handleDoubleClick}
        onEditTextChange={setEditText}
        onEditCancel={() => setEditing(false)}
        onEditSave={handleEdit}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        renderReactionBar={renderReactionBar}
      />
    );
  }

  return (
    <AgentMessageView
      message={message}
      settings={settings}
      timestampLabel={timestampLabel}
      metadata={metadata}
      attachments={attachments}
      displayText={displayText}
      collapsed={collapsed}
      streaming={streaming && !isUser}
      showMobileActions={showMobileActions}
      isSelected={isSelected}
      selectMode={selectMode}
      agent={agent}
      agentColor={agentColor}
      agents={agents}
      longPressHandlers={longPress}
      reactionPicker={reactionPicker}
      replyPreview={message.reply_to != null ? <ReplyPreview messageId={message.reply_to} /> : null}
      onStreamingComplete={() => { _markStreamed(message.id); setStreaming(false); }}
      onToggleSelected={() => toggleSelected(message.id)}
      onTogglePicker={() => setShowPicker(!showPicker)}
      onReply={() => setReplyTo(message)}
      onCopy={() => navigator.clipboard?.writeText(message.text).then(() => toast('Copied to clipboard', 'success')).catch(() => { /* clipboard unavailable */ })}
      onTogglePin={handlePin}
      onToggleBookmark={handleBookmark}
      onSelectForDelete={() => { setSelectMode(true); toggleSelected(message.id); }}
      onToggleCollapsed={() => setCollapsed(!collapsed)}
      onToggleTTS={handleTTS}
      setShowMobileActions={setShowMobileActions}
      ttsPlaying={ttsPlaying}
      renderReactionBar={renderReactionBar}
    />
  );
}

