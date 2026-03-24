/**
 * v3.2.0: Word-by-word streaming text reveal for new agent messages.
 * Only animates on initial render of NEW messages — not historical ones.
 */
import { useState, useEffect, useRef } from 'react';

interface StreamingTextProps {
  text: string;
  wordsPerMs?: number;
  onComplete?: () => void;
}

/**
 * Reveals text word by word at ~15ms per word.
 * Code blocks (``` ... ```) are revealed as complete units to avoid
 * breaking syntax highlighting.
 */
export function StreamingText({ text, wordsPerMs = 15, onComplete }: StreamingTextProps) {
  const [visibleCount, setVisibleCount] = useState(0);
  const tokens = useRef<string[]>([]);

  useEffect(() => {
    // Split into tokens: words and code blocks as units
    const parts: string[] = [];
    const codeBlockRe = /```[\s\S]*?```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRe.exec(text)) !== null) {
      // Words before this code block
      const before = text.slice(lastIndex, match.index);
      if (before) parts.push(...before.split(/(\s+)/));
      // Whole code block as one token
      parts.push(match[0]);
      lastIndex = match.index + match[0].length;
    }
    // Remaining text
    const remaining = text.slice(lastIndex);
    if (remaining) parts.push(...remaining.split(/(\s+)/));

    tokens.current = parts.filter(p => p.length > 0);

    setVisibleCount(0);
    let count = 0;
    const interval = setInterval(() => {
      count++;
      setVisibleCount(count);
      if (count >= tokens.current.length) {
        clearInterval(interval);
        onComplete?.();
      }
    }, wordsPerMs);

    return () => clearInterval(interval);
  }, [text, wordsPerMs, onComplete]);

  const visible = tokens.current.slice(0, visibleCount).join('');
  return <>{visible}</>;
}
