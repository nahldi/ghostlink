import { useEffect, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';

function useAnimatedValue(target: number) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(target);
  useEffect(() => {
    if (!ref.current || prev.current === target) return;
    const el = ref.current;
    el.style.transition = 'none';
    el.style.transform = target > prev.current ? 'translateY(-4px)' : 'translateY(4px)';
    el.style.opacity = '0.5';
    requestAnimationFrame(() => {
      el.style.transition = 'all 0.3s ease-out';
      el.style.transform = 'translateY(0)';
      el.style.opacity = '1';
    });
    prev.current = target;
  }, [target]);
  return ref;
}

export function StatsPanel() {
  const agents = useChatStore((s) => s.agents);
  const messages = useChatStore((s) => s.messages);
  const channels = useChatStore((s) => s.channels);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const jobs = useChatStore((s) => s.jobs);
  const sessionStart = useChatStore((s) => s.sessionStart);
  const sections = useChatStore((s) => s.settings.statsSections) || { session: true, tokens: true, agents: true, activity: true };

  const onlineAgents = agents.filter(a => a.state === 'active' || a.state === 'thinking');
  const channelMsgs = messages.filter(m => m.channel === activeChannel);
  const openJobs = jobs.filter(j => j.status === 'open');

  // Quick metrics
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const messagesToday = messages.filter(m => m.timestamp * 1000 >= todayStart.getTime()).length;
  const sessionMinutes = Math.floor((Date.now() - sessionStart) / 60000);
  const sessionDisplay = sessionMinutes < 60 ? `${sessionMinutes}m` : `${Math.floor(sessionMinutes / 60)}h ${sessionMinutes % 60}m`;

  // Estimated token usage (rough: ~4 chars per token)
  const totalChars = messages.reduce((sum, m) => sum + m.text.length, 0);
  const estimatedTokens = Math.round(totalChars / 4);
  const estimatedCost = (estimatedTokens / 1000000) * 3; // rough $3/MTok avg

  // Message counts per sender
  const senderCounts: Record<string, number> = {};
  channelMsgs.forEach(m => {
    senderCounts[m.sender] = (senderCounts[m.sender] || 0) + 1;
  });
  const topSenders = Object.entries(senderCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="w-56 min-w-0 shrink-0 hidden xl:flex flex-col gap-4 py-4 px-3 overflow-y-auto overflow-x-hidden border-l border-outline-variant/8">
      {/* Session overview */}
      {sections.session && (
        <StatCard title="Session">
          <StatRow label="Agents Online" value={`${onlineAgents.length}/${agents.length}`} color="#4ade80" />
          <StatRow label="Messages" value={String(channelMsgs.length)} color="#a78bfa" />
          <StatRow label="Channels" value={String(channels.length)} color="#38bdf8" />
          <StatRow label="Open Jobs" value={String(openJobs.length)} color="#fb923c" />
        </StatCard>
      )}

      {/* Token usage */}
      {sections.tokens && (
        <StatCard title="Token Usage">
          <StatRow label="Est. Tokens" value={estimatedTokens > 1000 ? `${(estimatedTokens / 1000).toFixed(1)}K` : String(estimatedTokens)} color="#c084fc" />
          <StatRow label="Est. Cost" value={`$${estimatedCost.toFixed(4)}`} color="#f0abfc" />
          <StatRow label="Msgs Today" value={String(messagesToday)} color="#38bdf8" />
          <StatRow label="Session" value={sessionDisplay} color="#4ade80" />
        </StatCard>
      )}

      {/* Agent status */}
      {sections.agents && (
        <StatCard title="Agents">
          {agents.map(a => {
            const isOn = a.state === 'active' || a.state === 'thinking';
            return (
              <div key={a.name} className="flex items-center gap-2 py-1">
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${isOn ? 'shadow-[0_0_4px]' : ''}`}
                  style={{ backgroundColor: isOn ? a.color : '#3a3548', boxShadow: isOn ? `0 0 6px ${a.color}50` : 'none' }}
                />
                <span className="text-[11px] text-on-surface-variant/60 flex-1 truncate">{a.label}</span>
                {a.role && (
                  <span className={`text-[7px] font-bold px-1 py-px rounded leading-none uppercase ${
                    a.role === 'manager' ? 'text-yellow-400 bg-yellow-500/15' : a.role === 'worker' ? 'text-blue-400 bg-blue-500/15' : 'text-purple-400 bg-purple-500/15'
                  }`}>
                    {a.role === 'manager' ? 'MGR' : a.role === 'worker' ? 'WKR' : 'PEER'}
                  </span>
                )}
                <span className={`text-[9px] font-medium ${
                  a.state === 'thinking' ? 'text-yellow-400' : isOn ? 'text-green-400/60' : 'text-on-surface-variant/40'
                }`}>
                  {a.state === 'thinking' ? 'ACTIVE' : isOn ? 'READY' : 'OFF'}
                </span>
              </div>
            );
          })}
        </StatCard>
      )}

      {/* Activity in this channel */}
      {sections.activity && topSenders.length > 0 && (
        <StatCard title={`#${activeChannel} Activity`}>
          {topSenders.map(([sender, count]) => {
            const agent = agents.find(a => a.name === sender);
            const color = agent?.color || '#a78bfa';
            const maxCount = topSenders[0][1];
            const pct = (count / maxCount) * 100;
            return (
              <div key={sender} className="py-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-on-surface-variant/50 truncate">{agent?.label || sender}</span>
                  <span className="text-[10px] text-on-surface-variant/30">{count}</span>
                </div>
                <div className="h-1 rounded-full bg-surface-container-highest/30 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color + '60' }} />
                </div>
              </div>
            );
          })}
        </StatCard>
      )}
    </div>
  );
}

function StatCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3" style={{
      background: 'rgba(17, 17, 25, 0.5)',
      border: '1px solid rgba(255, 255, 255, 0.03)',
    }}>
      <div className="text-[9px] font-semibold text-on-surface-variant/30 uppercase tracking-wider mb-2.5">
        {title}
      </div>
      <div className="space-y-0.5">
        {children}
      </div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  const num = parseFloat(value.replace(/[^0-9.]/g, ''));
  const ref = useAnimatedValue(isNaN(num) ? 0 : num);
  return (
    <div className="flex items-center justify-between gap-2 py-1 min-w-0 overflow-hidden">
      <span className="text-[11px] text-on-surface-variant/50 shrink-0">{label}</span>
      <span ref={ref} className="text-[11px] font-semibold truncate text-right" style={{ color }}>{value}</span>
    </div>
  );
}
