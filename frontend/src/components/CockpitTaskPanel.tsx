import type { ReactNode } from 'react';
import type { CockpitTab } from './AgentCockpitChrome';

export function CockpitTaskPanel({
  tab,
  tasksView,
  checkpointsView,
}: {
  tab: CockpitTab;
  tasksView: ReactNode;
  checkpointsView: ReactNode;
}) {
  if (tab === 'tasks') return <>{tasksView}</>;
  if (tab === 'checkpoints') return <>{checkpointsView}</>;
  return null;
}
