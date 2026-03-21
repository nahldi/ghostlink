import { useEffect, useState } from 'react';
import { useChatStore } from '../stores/chatStore';

export function TypingIndicator() {
  const typingAgents = useChatStore((s) => s.typingAgents);
  const agents = useChatStore((s) => s.agents);
  const [visible, setVisible] = useState<string[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const active = Object.entries(typingAgents)
        .filter(([, ts]) => now - ts < 3000)
        .map(([name]) => name);
      setVisible(active);
    }, 500);
    return () => clearInterval(interval);
  }, [typingAgents]);

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
