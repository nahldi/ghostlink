import type { ReactNode } from 'react';
import type { CockpitTab } from './AgentCockpitChrome';

export function CockpitMemoryPanel({
  tab,
  filesView,
  browserView,
  activityView,
}: {
  tab: CockpitTab;
  filesView: ReactNode;
  browserView: ReactNode;
  activityView: ReactNode;
}) {
  if (tab === 'files') return <>{filesView}</>;
  if (tab === 'browser') return <>{browserView}</>;
  if (tab === 'activity') return <>{activityView}</>;
  return null;
}
