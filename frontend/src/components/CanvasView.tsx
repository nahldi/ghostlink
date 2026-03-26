import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface CanvasViewProps {
  content: string;
  language?: string;
  title?: string;
  onClose: () => void;
}

/**
 * CanvasView — full-screen artifact viewer for code, documents, and generated content.
 * Inspired by Claude.ai Artifacts and ChatGPT Canvas.
 */
export function CanvasView({ content, language, title, onClose }: CanvasViewProps) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);

  const lines = content.split('\n');

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const ta = document.createElement('textarea');
        ta.value = content;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignored */ }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] flex"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

        {/* Panel */}
        <motion.div
          className="relative ml-auto w-full max-w-4xl h-full flex flex-col"
          style={{ background: 'linear-gradient(180deg, #0e0e1a 0%, #08080f 100%)' }}
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/10">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-primary/60">article</span>
              <div>
                <div className="text-sm font-semibold text-on-surface">{title || 'Artifact'}</div>
                {language && (
                  <div className="text-[10px] text-on-surface-variant/40 uppercase tracking-wider">{language}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setWrap(!wrap)}
                className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                  wrap ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/40 hover:text-on-surface-variant'
                }`}
              >
                Wrap
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-on-surface-variant/40 hover:text-on-surface-variant transition-colors"
              >
                <span className="material-symbols-outlined text-sm">{copied ? 'check' : 'content_copy'}</span>
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant/40 hover:text-on-surface-variant transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-5">
            <pre className={`text-xs font-mono text-on-surface-variant leading-relaxed ${wrap ? 'whitespace-pre-wrap' : ''}`}>
              <code>
                {lines.map((line, i) => (
                  <div key={i} className="flex hover:bg-surface-container/20 rounded">
                    <span className="inline-block w-10 text-right mr-4 text-on-surface-variant/15 select-none shrink-0 tabular-nums">
                      {i + 1}
                    </span>
                    <span>{line}</span>
                  </div>
                ))}
              </code>
            </pre>
          </div>

          {/* Footer */}
          <div className="px-5 py-2 border-t border-outline-variant/5 flex items-center justify-between text-[10px] text-on-surface-variant/30">
            <span>{lines.length} lines · {content.length.toLocaleString()} chars</span>
            <span>{language || 'text'}</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
