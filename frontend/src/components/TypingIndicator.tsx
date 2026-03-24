import { useEffect, useState } from 'react';
import { useChatStore } from '../stores/chatStore';

// v2.5.0: Per-channel typing indicators
export function TypingIndicator({ channel }: { channel?: string }) {
  const typingAgents = useChatStore((s) => s.typingAgents);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const agents = useChatStore((s) => s.agents);
  const [visible, setVisible] = useState<string[]>([]);

  const targetChannel = channel || activeChannel;

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const channelTyping = typingAgents[targetChannel] || {};
      const active = Object.entries(channelTyping)
        .filter(([, ts]) => now - ts < 3000)
        .map(([name]) => name);
      setVisible(prev => {
        // Only update if the list actually changed to avoid re-renders
        if (prev.length === active.length && prev.every((n, i) => n === active[i])) return prev;
        return active;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [typingAgents, targetChannel]);

  if (visible.length === 0) return null;

  const names = visible.map((name) => {
    const agent = agents.find((a) => a.name === name);
    return agent?.label || name;
  });

  const text =
    names.length === 1
      ? `${names[0]} is typing...`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing...`
        : `${names[0]} and ${names.length - 1} others are typing...`;

  return (
    <div className="px-6 py-1">
      <div className="text-[10px] text-on-surface-variant/60 flex items-center gap-2">
        <span className="flex gap-0.5">
          <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
        </span>
        {text}
      </div>
    </div>
  );
}
