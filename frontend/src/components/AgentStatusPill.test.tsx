import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentStatusPill } from './AgentStatusPill';

vi.mock('./AgentInfoPanel', () => ({
  AgentInfoPanel: () => null,
}));

vi.mock('./AgentIcon', () => ({
  AgentIcon: ({ base }: { base: string }) => <span>{base}</span>,
}));

describe('AgentStatusPill', () => {
  it('shows drift badge and drift subtitle when the agent is flagged', () => {
    const html = renderToStaticMarkup(
      <AgentStatusPill agent={{
        name: 'ned',
        label: 'Ned',
        base: 'codex',
        color: '#10a37f',
        state: 'active',
        drift_detected: true,
      } as never} />,
    );

    expect(html).toContain('Drift');
    expect(html).toContain('Identity drift detected');
  });

  it('falls back to provider tag when there is no drift flag', () => {
    const html = renderToStaticMarkup(
      <AgentStatusPill agent={{
        name: 'ned',
        label: 'Ned',
        base: 'codex',
        color: '#10a37f',
        state: 'active',
        drift_detected: false,
      } as never} />,
    );

    expect(html).not.toContain('Identity drift detected');
    expect(html).toContain('OpenAI');
  });
});
