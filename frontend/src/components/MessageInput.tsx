import { useState, useRef, useCallback, useMemo, type KeyboardEvent, type ClipboardEvent } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useMentionAutocomplete } from '../hooks/useMentionAutocomplete';
import { api } from '../lib/api';

interface SlashCommand {
  name: string;
  description: string;
  execute: () => void;
}

export function MessageInput() {
  const [text, setText] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const settings = useChatStore((s) => s.settings);
  const replyTo = useChatStore((s) => s.replyTo);
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const messages = useChatStore((s) => s.messages);
  const agents = useChatStore((s) => s.agents);
  const setMessages = useChatStore((s) => s.setMessages);
  const addMessage = useChatStore((s) => s.addMessage);

  const { suggestions, selectedIndex, setSelectedIndex, isOpen, applyMention } =
    useMentionAutocomplete(text, cursorPos);

  // Slash commands
  const slashCommands: SlashCommand[] = useMemo(() => [
    {
      name: '/status',
      description: 'Show agent states',
      execute: () => {
        const lines = agents.length
          ? agents.map(a => `${a.label || a.name}: ${a.state}`).join('\n')
          : 'No agents registered';
        addMessage({
          id: Date.now(),
          uid: 'cmd-' + Date.now(),
          sender: 'system',
          text: lines,
          type: 'system',
          timestamp: Date.now() / 1000,
          time: new Date().toLocaleTimeString(),
          channel: activeChannel,
        });
      },
    },
    {
      name: '/clear',
      description: 'Clear chat display',
      execute: () => {
        setMessages(messages.filter(m => m.channel !== activeChannel));
      },
    },
    {
      name: '/export',
      description: 'Download channel as markdown',
      execute: () => {
        const channelMsgs = messages.filter(m => m.channel === activeChannel);
        const md = channelMsgs
          .map(m => `**${m.sender}** (${m.time})\n${m.text}`)
          .join('\n\n---\n\n');
        const blob = new Blob([`# #${activeChannel}\n\n${md}`], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeChannel}-export.md`;
        a.click();
        URL.revokeObjectURL(url);
      },
    },
    {
      name: '/help',
      description: 'Show available commands',
      execute: () => {
        addMessage({
          id: Date.now(),
          uid: 'cmd-' + Date.now(),
          sender: 'system',
          text: '/status — show agent states\n/clear — clear chat display\n/export — download channel as markdown\n/help — show this help',
          type: 'system',
          timestamp: Date.now() / 1000,
          time: new Date().toLocaleTimeString(),
          channel: activeChannel,
        });
      },
    },
  ], [agents, activeChannel, messages, addMessage, setMessages]);

  const slashQuery = text.startsWith('/') && !text.includes(' ') ? text.toLowerCase() : '';
  const filteredCommands = slashQuery
    ? slashCommands.filter(c => c.name.startsWith(slashQuery))
    : [];
  const showSlash = filteredCommands.length > 0 && slashQuery.length > 0;

  const executeSlashCommand = (cmd: SlashCommand) => {
    cmd.execute();
    setText('');
    setSlashIndex(0);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Check for slash command
    if (trimmed.startsWith('/')) {
      const cmd = slashCommands.find(c => c.name === trimmed);
      if (cmd) {
        cmd.execute();
        setText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }
    }

    try {
      await api.sendMessage(settings.username, trimmed, activeChannel, replyTo?.id);
      setText('');
      setReplyTo(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (e) {
      console.error('Send failed:', e);
    }
  }, [text, activeChannel, settings.username, replyTo, setReplyTo, slashCommands]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash command picker navigation
    if (showSlash) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((slashIndex + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((slashIndex - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        setText(filteredCommands[slashIndex].name);
        setSlashIndex(0);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        executeSlashCommand(filteredCommands[slashIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setText('');
        return;
      }
    }
    // Mention autocomplete
    if (isOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((selectedIndex + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(
          (selectedIndex - 1 + suggestions.length) % suggestions.length
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const newText = applyMention(suggestions[selectedIndex].name);
        setText(newText);
        setSelectedIndex(0);
        return;
      }
      if (e.key === 'Escape') {
        setCursorPos(0);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        try {
          const result = await api.uploadImage(file);
          if (result.url) {
            setText((prev) => prev + `![image](${result.url})`);
          }
        } catch (err) {
          console.error('Upload failed:', err);
        }
        return;
      }
    }
  };

  const handleInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 160) + 'px';
      setCursorPos(textareaRef.current.selectionStart);
    }
  };

  const handleFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const result = await api.uploadImage(file);
        if (result.url) {
          setText((prev) => prev + `![image](${result.url})`);
        }
      } catch (err) {
        console.error('Upload failed:', err);
      }
    };
    input.click();
  };

  return (
    <div className="relative">
      {/* Reply indicator */}
      {replyTo && (
        <div className="w-full flex items-center gap-2 px-4 py-2 bg-surface-container border-t border-outline-variant/10 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-sm">reply</span>
          Replying to <span className="font-bold text-primary">{replyTo.sender}</span>
          <button
            onClick={() => setReplyTo(null)}
            className="ml-auto text-outline hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {/* Mention autocomplete dropdown */}
      {isOpen && (
        <div className="absolute bottom-full left-4 right-4 mb-1 bg-surface-container-high border border-outline-variant/20 rounded-lg overflow-hidden shadow-xl z-50">
          {suggestions.map((s, i) => (
            <button
              key={s.name}
              onClick={() => {
                const newText = applyMention(s.name);
                setText(newText);
                setSelectedIndex(0);
                textareaRef.current?.focus();
              }}
              className={`w-full text-left px-4 py-2 text-xs flex items-center gap-2 transition-colors ${
                i === selectedIndex
                  ? 'bg-primary-container/20 text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-highest'
              }`}
            >
              <span className="font-bold">@{s.name}</span>
              <span className="text-outline">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Slash command picker */}
      {showSlash && (
        <div className="absolute bottom-full left-4 right-4 mb-1 bg-surface-container-high border border-outline-variant/20 rounded-lg overflow-hidden shadow-xl z-50">
          {filteredCommands.map((cmd, i) => (
            <button
              key={cmd.name}
              onClick={() => executeSlashCommand(cmd)}
              className={`w-full text-left px-4 py-2.5 text-xs flex items-center gap-3 transition-colors ${
                i === slashIndex
                  ? 'bg-primary-container/20 text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-highest'
              }`}
            >
              <span className="font-bold text-primary/80">{cmd.name}</span>
              <span className="text-outline">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="w-full flex items-end gap-2 p-3 lg:px-6 lg:py-4 safe-bottom">
        <button
          onClick={handleFileUpload}
          className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors shrink-0"
          title="Upload image"
        >
          <span className="material-symbols-outlined text-xl">attachment</span>
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onClick={handleInput}
          placeholder={`Message #${activeChannel}...`}
          rows={1}
          className="flex-1 bg-surface-container/60 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 resize-none max-h-40 outline-none border border-outline-variant/8 focus:border-primary/25 focus:shadow-[0_0_16px_rgba(167,139,250,0.08)] transition-all"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim()}
          className="p-2 rounded-lg bg-primary-container text-primary-fixed hover:brightness-110 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          <span className="material-symbols-outlined text-xl">send</span>
        </button>
      </div>
    </div>
  );
}
