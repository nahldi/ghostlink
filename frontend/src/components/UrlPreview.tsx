import { useState, useEffect } from 'react';
import { api } from '../lib/api';

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

// Cache previews to avoid re-fetching (bounded to 200 entries)
const _cache: Record<string, { title: string; description: string; image: string; site_name: string } | null> = {};
const _cacheOrder: string[] = [];
const MAX_CACHE = 200;
function _cacheSet(url: string, val: typeof _cache[string]) {
  if (!(url in _cache)) {
    _cacheOrder.push(url);
    if (_cacheOrder.length > MAX_CACHE) {
      const evict = _cacheOrder.shift()!;
      delete _cache[evict];
    }
  }
  _cache[url] = val;
}

export function UrlPreviews({ text }: { text: string }) {
  const [previews, setPreviews] = useState<Record<string, { title: string; description: string; image: string; site_name: string }>>({});

  const urls = Array.from(new Set(text.match(URL_REGEX) || [])).slice(0, 3); // max 3

  useEffect(() => {
    if (urls.length === 0) return;
    let cancelled = false;
    urls.forEach(async (url) => {
      if (_cache[url] !== undefined) {
        if (_cache[url] && !cancelled) {
          setPreviews(p => ({ ...p, [url]: _cache[url]! }));
        }
        return;
      }
      try {
        const data = await api.getUrlPreview(url);
        if (data.title || data.description) {
          _cacheSet(url, data);
          if (!cancelled) setPreviews(p => ({ ...p, [url]: data }));
        } else {
          _cacheSet(url, null);
        }
      } catch {
        _cacheSet(url, null);
      }
    });
    return () => { cancelled = true; };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const entries = Object.entries(previews);
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {entries.map(([url, p]) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex gap-3 p-2.5 rounded-lg bg-surface-container/40 border border-outline-variant/10 hover:border-primary/15 transition-all group max-w-[400px]"
        >
          {p.image && (
            <img
              src={p.image}
              alt=""
              className="w-16 h-16 rounded-md object-cover shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <div className="min-w-0 flex-1">
            {p.site_name && (
              <div className="text-[9px] text-on-surface-variant/40 uppercase tracking-wider font-medium">{p.site_name}</div>
            )}
            <div className="text-[11px] font-semibold text-on-surface group-hover:text-primary transition-colors truncate">{p.title}</div>
            {p.description && (
              <div className="text-[10px] text-on-surface-variant/50 line-clamp-2 mt-0.5">{p.description}</div>
            )}
          </div>
        </a>
      ))}
    </div>
  );
}
