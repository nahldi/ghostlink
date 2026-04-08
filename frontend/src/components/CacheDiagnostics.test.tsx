import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CacheDiagnostics } from './CacheDiagnostics';

describe('CacheDiagnostics', () => {
  it('shows measured provider aggregates from the current backend contract', () => {
    const html = renderToStaticMarkup(<CacheDiagnostics diagnostics={{
      total_hits: 8,
      total_misses: 2,
      providers: {
        openai: { hits: 5, misses: 1 },
        anthropic: { hits: 3, misses: 1 },
      },
    }} />);

    expect(html).toContain('80%');
    expect(html).toContain('openai');
    expect(html).toContain('Hits 5');
    expect(html).toContain('measured aggregates');
  });

  it('stays empty and honest when the backend returns no cache activity', () => {
    const html = renderToStaticMarkup(<CacheDiagnostics diagnostics={{ total_hits: 0, total_misses: 0, providers: {} }} />);

    expect(html).toContain('No cache diagnostics returned yet');
    expect(html).toContain('stays truthful and empty');
  });

  it('surfaces the low-hit-rate warning when a provider falls below the floor', () => {
    const html = renderToStaticMarkup(<CacheDiagnostics diagnostics={{
      total_hits: 2,
      total_misses: 5,
      providers: {
        openai: { hits: 2, misses: 5 },
      },
    }} />);

    expect(html).toContain('Below 50% floor');
    expect(html).toContain('Hits 2');
    expect(html).toContain('Misses 5');
  });
});
