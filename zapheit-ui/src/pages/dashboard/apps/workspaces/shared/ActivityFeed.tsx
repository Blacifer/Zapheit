import { Bot, User, Clock, ArrowRight } from 'lucide-react';

export interface ActivityItem {
  id: string;
  actor: 'user' | 'agent' | 'system';
  actorName?: string;
  action: string;
  target?: string;
  timestamp: string;
  status?: 'success' | 'pending' | 'failed';
  detail?: string;
}

export interface ActivityFeedProps {
  items: ActivityItem[];
  loading?: boolean;
  maxItems?: number;
  emptyMessage?: string;
}

const ACTOR_ICON = {
  user: User,
  agent: Bot,
  system: ArrowRight,
};

const STATUS_COLORS = {
  success: 'text-emerald-400',
  pending: 'text-amber-400',
  failed: 'text-red-400',
};

function formatRelativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function ActivityFeed({
  items,
  loading,
  maxItems = 20,
  emptyMessage = 'No activity yet',
}: ActivityFeedProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-zinc-800" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-zinc-800 rounded w-3/4" />
              <div className="h-2.5 bg-zinc-800/50 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center text-zinc-500 py-8 text-sm">{emptyMessage}</div>
    );
  }

  const visible = items.slice(0, maxItems);

  return (
    <div className="space-y-1">
      {visible.map((item) => {
        const Icon = ACTOR_ICON[item.actor] || ArrowRight;
        const statusColor = item.status ? STATUS_COLORS[item.status] : 'text-zinc-400';

        return (
          <div
            key={item.id}
            className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-zinc-800/30 transition-colors"
          >
            <div
              className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                item.actor === 'agent' ? 'bg-violet-500/15 text-violet-400' :
                item.actor === 'user' ? 'bg-cyan-500/15 text-cyan-400' :
                'bg-zinc-700/50 text-zinc-400'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm text-zinc-200 leading-snug">
                {item.actorName && (
                  <span className="font-medium">{item.actorName} </span>
                )}
                <span className={statusColor}>{item.action}</span>
                {item.target && (
                  <span className="text-zinc-400"> → {item.target}</span>
                )}
              </p>
              {item.detail && (
                <p className="text-xs text-zinc-500 mt-0.5 truncate">{item.detail}</p>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-xs text-zinc-500 shrink-0 mt-0.5">
              <Clock className="w-3 h-3" />
              {formatRelativeTime(item.timestamp)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
