import type { Agent, AgentPresence } from '../types';
import type { CockpitTab } from './AgentCockpitChrome';
import { AgentCockpitHeader, AgentCockpitTabs } from './AgentCockpitChrome';

export function CockpitStatusBar({
  agent,
  thinking,
  presence,
  tab,
  onSelectTab,
}: {
  agent: Agent;
  thinking: { text: string; active: boolean } | null;
  presence: AgentPresence | null;
  tab: CockpitTab;
  onSelectTab: (tab: CockpitTab) => void;
}) {
  return (
    <>
      <AgentCockpitHeader agent={agent} thinking={thinking} presence={presence} />
      <AgentCockpitTabs agentColor={agent.color} tab={tab} onSelect={onSelectTab} />
    </>
  );
}
