import { motion } from 'framer-motion';
import type { DragEvent } from 'react';

export interface PendingAttachment {
  name: string;
  url: string;
  type: string;
}

interface ReplyTarget {
  sender: string;
}

interface MentionSuggestion {
  name: string;
  label: string;
}

interface SlashCommandOption {
  name: string;
  description: string;
}

function formatRecordingTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function DropZoneOverlay({
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: {
  isDragging: boolean;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary/40 rounded-xl backdrop-blur-sm">
          <div className="flex items-center gap-2 text-primary text-sm font-medium">
            <span className="material-symbols-outlined">cloud_upload</span>
            Drop files to upload
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

export function ReplyIndicator({
  replyTo,
  onClear,
}: {
  replyTo: ReplyTarget | null;
  onClear: () => void;
}) {
  if (!replyTo) return null;
  return (
    <div className="w-full flex items-center gap-2 px-4 py-2 bg-surface-container border-t border-outline-variant/10 text-xs text-on-surface-variant">
      <span className="material-symbols-outlined text-sm">reply</span>
      Replying to <span className="font-bold text-primary">{replyTo.sender}</span>
      <button onClick={onClear} className="ml-auto text-outline hover:text-on-surface">
        <span className="material-symbols-outlined text-sm">close</span>
      </button>
    </div>
  );
}

export function MentionAutocomplete({
  isOpen,
  suggestions,
  selectedIndex,
  onSelect,
}: {
  isOpen: boolean;
  suggestions: MentionSuggestion[];
  selectedIndex: number;
  onSelect: (name: string) => void;
}) {
  if (!isOpen) return null;
  return (
    <div className="absolute bottom-full left-4 right-4 mb-1 glass-strong rounded-xl overflow-hidden shadow-xl z-50">
      {suggestions.map((suggestion, index) => (
        <button
          key={suggestion.name}
          onClick={() => onSelect(suggestion.name)}
          className={`w-full text-left px-4 py-2 text-xs flex items-center gap-2 transition-colors ${
            index === selectedIndex
              ? 'bg-primary-container/20 text-primary'
              : 'text-on-surface-variant hover:bg-surface-container-highest'
          }`}
        >
          <span className="font-bold">@{suggestion.name}</span>
          <span className="text-outline">{suggestion.label}</span>
        </button>
      ))}
    </div>
  );
}

export function SlashCommandPicker({
  commands,
  selectedIndex,
  onPick,
}: {
  commands: SlashCommandOption[];
  selectedIndex: number;
  onPick: (commandName: string) => void;
}) {
  if (commands.length === 0) return null;
  return (
    <div className="absolute bottom-full left-4 right-4 mb-1 glass-strong rounded-xl overflow-hidden shadow-xl z-50">
      {commands.map((command, index) => (
        <button
          key={command.name}
          onClick={() => onPick(command.name)}
          className={`w-full text-left px-4 py-2.5 text-xs flex items-center gap-3 transition-colors ${
            index === selectedIndex
              ? 'bg-primary-container/20 text-primary'
              : 'text-on-surface-variant hover:bg-surface-container-highest'
          }`}
        >
          <span className="font-bold text-primary/80">{command.name}</span>
          <span className="text-outline">{command.description}</span>
        </button>
      ))}
    </div>
  );
}

export function PendingAttachmentPreview({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (index: number) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {attachments.map((attachment, index) => (
        <div key={`${attachment.url}-${index}`} className="relative group">
          {attachment.type.startsWith('image/') ? (
            <img src={attachment.url} alt={attachment.name} className="w-8 h-8 rounded-lg object-cover border border-outline-variant/15" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center border border-outline-variant/15">
              <span className="material-symbols-outlined text-[14px] text-on-surface-variant/40">description</span>
            </div>
          )}
          <button
            onClick={() => onRemove(index)}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-error/90 text-white flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label={`Remove ${attachment.name}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function VoiceControls({
  isRecording,
  recordingTime,
  canUseVoiceInput,
  onCancelRecording,
  onStopRecording,
  onStartRecording,
  onOpenVoiceCall,
}: {
  isRecording: boolean;
  recordingTime: number;
  canUseVoiceInput: boolean;
  onCancelRecording: () => void;
  onStopRecording: () => void;
  onStartRecording: () => void;
  onOpenVoiceCall: () => void;
}) {
  if (isRecording) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        <span className="text-[11px] text-red-400 font-mono tabular-nums w-8">
          {formatRecordingTime(recordingTime)}
        </span>
        <button onClick={onCancelRecording} className="p-1.5 rounded-lg text-on-surface-variant/40 hover:text-red-400 hover:bg-red-500/10 transition-colors" aria-label="Cancel recording" title="Cancel">
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
        <button onClick={onStopRecording} className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors" aria-label="Send voice note" title="Send voice note">
          <span className="material-symbols-outlined text-lg">send</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        onClick={onStartRecording}
        disabled={!canUseVoiceInput}
        className="p-2.5 rounded-xl text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container-high/60 transition-all active:scale-90"
        title={canUseVoiceInput ? 'Record voice note' : 'Voice input unavailable in this browser'}
        aria-label="Record voice note"
      >
        <span className="material-symbols-outlined text-xl">mic</span>
      </button>
      <button
        onClick={onOpenVoiceCall}
        disabled={!canUseVoiceInput}
        className="p-2.5 rounded-xl text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container-high/60 transition-all active:scale-90"
        title={canUseVoiceInput ? 'Start voice call' : 'Voice input unavailable in this browser'}
        aria-label="Start voice call with agent"
      >
        <span className="material-symbols-outlined text-xl">call</span>
      </button>
    </div>
  );
}

export function SendButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.88 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className="p-2.5 rounded-xl bg-primary-container text-primary-fixed hover:brightness-110 transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
    >
      <span className="material-symbols-outlined text-xl">send</span>
    </motion.button>
  );
}
