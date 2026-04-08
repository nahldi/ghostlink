import type { ReactNode } from 'react';
import type { CockpitTab } from './AgentCockpitChrome';

export function CockpitToolsPanel({
  tab,
  terminalView,
  replayView,
}: {
  tab: CockpitTab;
  terminalView: ReactNode;
  replayView: ReactNode;
}) {
  if (tab === 'terminal') return <>{terminalView}</>;
  if (tab === 'replay') return <>{replayView}</>;
  return null;
}
