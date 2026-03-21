import { useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import { timeAgo } from '../lib/timeago';

const ACTION_ICONS: Record<string, string> = {
  message: 'chat_bubble',
  thinking: 'psychology',
  tool_use: 'build',
  handoff: 'swap_horiz',
  error: 'error',
  spawn: 'rocket_launch',
  kill: 'power_settings_new',
  job: 'task_alt',
  decision: 'gavel',
  rule: 'policy',
};

export function ActivityTimeline() {
  const activities = useChatStore((s) => s.activities);
  const setActivities = useChatStore((s) => s.setActivities);
  const agents = useChatStore((s) => s.agents);

  useEffect(() => {
    api.getActivity().then((r) => setActivities(r.events)).catch(() => {});
  }, [setActivities]);

  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: 'rgba(17, 17, 25, 0.5)',
        border: '1px solid rgba(255, 255, 255, 0.03)',
      }}
    >
      <div className="text-[9px] font-semibold text-on-surface-variant/30 uppercase tracking-wider mb-2.5">
        Activity
      </div>

      <div className="space-y-0.5 max-h-64 overflow-y-auto">
        {activities.length === 0 && (
          <div className="text-[10px] text-on-surface-variant/20 py-2 text-center">
            No recent activity
          </div>
        )}
        {activities
          .slice()
          .reverse()
          .slice(0, 30)
          .map((event, i) => {
            const agent = agents.find((a) => a.name === event.agent);
            const color = agent?.color || '#a78bfa';
            const icon = ACTION_ICONS[event.action_type] || 'circle';
            return (
              <div key={`${event.timestamp}-${i}`} className="flex items-start gap-2 py-1.5">
                <span
                  className="material-symbols-outlined text-[14px] mt-px shrink-0"
                  style={{ color: color + '80' }}
                >
                  {icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-[10px] font-semibold truncate"
                      style={{ color }}
                    >
                      {agent?.label || event.agent}
                    </span>
                    <span className="text-[9px] text-on-surface-variant/20 ml-auto shrink-0">
                      {timeAgo(event.timestamp)}
                    </span>
                  </div>
                  <div className="text-[10px] text-on-surface-variant/45 truncate leading-snug">
                    {event.description}
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
