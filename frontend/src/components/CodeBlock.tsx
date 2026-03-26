import { useState, type ReactNode } from 'react';

interface CodeBlockProps {
  code: string;
  language?: string;
  highlighted?: ReactNode;
}

export function CodeBlock({ code, language, highlighted }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        // Fallback for insecure contexts / older browsers
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignored */ }
  };

  return (
    <div className="rounded-lg overflow-hidden border border-outline-variant/10 my-2">
      <div className="bg-surface-container-high/50 flex items-center justify-between px-4 py-2">
        <span className="text-[10px] font-bold text-secondary-dim uppercase tracking-widest">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="text-[10px] text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-sm">
            {copied ? 'check' : 'content_copy'}
          </span>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="bg-surface-container-lowest p-4 overflow-x-auto">
        <pre className="text-xs font-mono text-on-surface-variant leading-relaxed">
          <code className={language ? `hljs language-${language}` : undefined}>
            {highlighted || code.split('\n').map((line, i) => (
              <div key={i} className="flex">
                <span className="inline-block w-8 text-right mr-4 text-on-surface-variant/20 select-none shrink-0">{i + 1}</span>
                <span>{line}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
