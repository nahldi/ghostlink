/**
 * v3.9.5: Word-by-word streaming text reveal for new agent messages.
 * Only animates on initial render of NEW messages — not historical ones.
 * Uses requestAnimationFrame batching to prevent layout thrashing.
 */
import { useState, useEffect, useRef, useMemo } from 'react';

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
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; });

  // Tokenize text (derived from props, safe to compute during render)
  const tokens = useMemo(() => {
    const parts: string[] = [];
    const codeBlockRe = /```[\s\S]*?```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRe.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index);
      if (before) parts.push(...before.split(/(\s+)/));
      parts.push(match[0]);
      lastIndex = match.index + match[0].length;
    }
    const remaining = text.slice(lastIndex);
    if (remaining) parts.push(...remaining.split(/(\s+)/));

    return parts.filter(p => p.length > 0);
  }, [text]);

  useEffect(() => {
    const total = tokens.length;

    // For very short messages, show immediately
    if (total <= 3) {
      queueMicrotask(() => {
        setVisibleCount(total);
        onCompleteRef.current?.();
      });
      return;
    }

    setVisibleCount(0);
    let count = 0;
    // Batch multiple tokens per frame to reduce re-renders
    const tokensPerFrame = Math.max(1, Math.ceil(total / 60)); // complete in ~1s
    const interval = setInterval(() => {
      count = Math.min(count + tokensPerFrame, total);
      setVisibleCount(count);
      if (count >= total) {
        clearInterval(interval);
        onCompleteRef.current?.();
      }
    }, wordsPerMs);

    return () => clearInterval(interval);
  }, [tokens, wordsPerMs]);

  const visible = tokens.slice(0, visibleCount).join('');
  return <>{visible}</>;
}
