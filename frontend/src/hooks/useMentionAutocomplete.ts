import { useState, useMemo } from 'react';
import { useChatStore } from '../stores/chatStore';

export function useMentionAutocomplete(text: string, cursorPos: number) {
  const agents = useChatStore((s) => s.agents);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const mentionQuery = useMemo(() => {
    const before = text.slice(0, cursorPos);
    const match = before.match(/@(\w*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [text, cursorPos]);

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const base = [
      ...agents.map((a) => ({ name: a.name, label: a.label })),
      { name: 'all', label: 'All Agents' },
    ];
    if (mentionQuery === '') return base;
    return base.filter(
      (a) =>
        a.name.toLowerCase().includes(mentionQuery) ||
        a.label.toLowerCase().includes(mentionQuery)
    );
  }, [mentionQuery, agents]);

  const applyMention = (name: string): string => {
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const replaced = before.replace(/@\w*$/, `@${name} `);
    return replaced + after;
  };

  return {
    suggestions,
    selectedIndex,
    setSelectedIndex,
    mentionQuery,
    applyMention,
    isOpen: suggestions.length > 0,
  };
}
