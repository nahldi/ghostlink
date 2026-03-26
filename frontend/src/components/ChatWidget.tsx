import { useState, useRef, useEffect } from 'react';

interface ChatWidgetProps {
  html: string;
  title?: string;
  height?: number;
}

/**
 * ChatWidget — renders agent-provided HTML/JS in a sandboxed iframe.
 * Used for interactive charts, tables, diagrams, and custom widgets.
 */
export function ChatWidget({ html, title, height = 300 }: ChatWidgetProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    // Write content into sandboxed iframe
    doc.open();
    doc.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Inter, system-ui, sans-serif;
      background: transparent;
      color: #e0dff0;
      padding: 12px;
      overflow: auto;
    }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid rgba(167, 139, 250, 0.15); padding: 6px 10px; text-align: left; font-size: 12px; }
    th { background: rgba(167, 139, 250, 0.08); font-weight: 600; }
    tr:hover { background: rgba(167, 139, 250, 0.04); }
    pre { background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 11px; }
    code { font-family: 'JetBrains Mono', monospace; }
    .chart { display: flex; align-items: end; gap: 4px; height: 120px; }
    .bar { background: rgba(167, 139, 250, 0.6); border-radius: 4px 4px 0 0; min-width: 24px; transition: height 0.3s; }
    .bar:hover { background: rgba(167, 139, 250, 0.9); }
  </style>
</head>
<body>${html}</body>
</html>`);
    doc.close();
  }, [html]);

  // Use iframe onLoad for loaded state (avoids setState in effect body)
  const handleLoad = () => setLoaded(true);

  const containerHeight = expanded ? Math.max(height, 500) : height;

  return (
    <div className="my-2 rounded-xl border border-outline-variant/10 overflow-hidden" style={{ background: 'rgba(20, 20, 32, 0.6)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-outline-variant/5">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-xs text-primary/60">widgets</span>
          <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wider">
            {title || 'Widget'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 rounded hover:bg-surface-container text-on-surface-variant/30 hover:text-on-surface-variant/60 transition-colors"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <span className="material-symbols-outlined text-sm">
              {expanded ? 'collapse_content' : 'expand_content'}
            </span>
          </button>
        </div>
      </div>
      {/* Iframe */}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        onLoad={handleLoad}
        style={{
          width: '100%',
          height: containerHeight,
          border: 'none',
          background: 'transparent',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.2s, height 0.3s',
        }}
        title={title || 'Agent widget'}
      />
    </div>
  );
}
