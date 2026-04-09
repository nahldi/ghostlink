import { useChatStore } from '../stores/chatStore';
import { AgentIcon } from './AgentIcon';

export function MobileHeader() {
  const activeChannel = useChatStore((s) => s.activeChannel);
  const mobileMenuOpen = useChatStore((s) => s.mobileMenuOpen);
  const setMobileMenuOpen = useChatStore((s) => s.setMobileMenuOpen);
  const agents = useChatStore((s) => s.agents);
  const setCockpitAgent = useChatStore((s) => s.setCockpitAgent);

  const onlineAgents = agents.filter(a => a.state === 'active' || a.state === 'idle');

  return (
    <header className="lg:hidden fixed top-0 left-0 right-0 z-40 glass-strong safe-top">
      <div className="flex items-center justify-between px-3 h-14">
        {/* Left: menu + channel */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 -ml-1 rounded-lg text-on-surface-variant/60 active:bg-surface-container-high"
          >
            <span className="material-symbols-outlined text-[22px]">
              {mobileMenuOpen ? 'close' : 'menu'}
            </span>
          </button>
          <img src="/ghostlink.png" alt="GhostLink" className="w-7 h-7 object-contain" style={{ filter: 'invert(1)' }} />
          <div>
            <div className="text-sm font-semibold text-on-surface">
              <span className="text-on-surface-variant/40">#</span> {activeChannel}
            </div>
          </div>
        </div>

        {/* Right: agent status dots */}
        <div className="flex items-center gap-1.5">
          {agents.slice(0, 4).map((agent) => {
            const isOnline = agent.state === 'active' || agent.state === 'idle';
            return (
              <div
                key={agent.name}
                className="relative cursor-pointer"
                title={`${agent.label}: ${isOnline ? 'Online' : 'Offline'}`}
                onClick={() => setCockpitAgent(isOnline ? agent.name : null)}
              >
                <AgentIcon base={agent.base} color={isOnline ? agent.color : '#3a3548'} size={28} />
                <div
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-[1.5px] ${
                    isOnline
                      ? 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.5)]'
                      : 'bg-gray-600'
                  }`}
                  style={{ borderColor: '#08080f' }}
                />
              </div>
            );
          })}
          {agents.length > 4 && (
            <span className="text-[10px] text-on-surface-variant/40 font-medium ml-0.5">
              +{agents.length - 4}
            </span>
          )}
          {onlineAgents.length > 0 && (
            <span className="text-[10px] text-green-400/60 font-medium ml-1">
              {onlineAgents.length} online
            </span>
          )}
          {onlineAgents.length === 0 && agents.length > 0 && (
            <span className="text-[10px] text-on-surface-variant/25 font-medium ml-1">
              0 online
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
