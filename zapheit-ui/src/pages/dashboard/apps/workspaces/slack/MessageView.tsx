import { useRef, useEffect } from 'react';
import { Bot, User } from 'lucide-react';
import { cn } from '../../../../../lib/utils';

export interface SlackMessage {
  ts: string;
  user?: string;
  username?: string;
  text: string;
  bot_id?: string;
  is_bot?: boolean;
  avatar?: string;
  reactions?: Array<{ name: string; count: number }>;
}

interface MessageViewProps {
  messages: SlackMessage[];
  channelName: string;
  loading?: boolean;
}

function formatTime(ts: string): string {
  try {
    const epoch = parseFloat(ts) * 1000;
    if (!isNaN(epoch)) {
      return new Date(epoch).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDate(ts: string): string {
  try {
    const epoch = parseFloat(ts) * 1000;
    const d = !isNaN(epoch) ? new Date(epoch) : new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function groupByDate(messages: SlackMessage[]): { date: string; msgs: SlackMessage[] }[] {
  const groups: { date: string; msgs: SlackMessage[] }[] = [];
  let current: { date: string; msgs: SlackMessage[] } | null = null;
  for (const msg of messages) {
    const d = formatDate(msg.ts);
    if (!current || current.date !== d) {
      current = { date: d, msgs: [] };
      groups.push(current);
    }
    current.msgs.push(msg);
  }
  return groups;
}

export function MessageView({ messages, channelName, loading }: MessageViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-white/[0.05]" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-white/[0.05] rounded w-1/4" />
              <div className="h-3 bg-white/[0.03] rounded w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-center p-8">
        <div>
          <p className="text-sm text-slate-400 font-medium">No messages in #{channelName}</p>
          <p className="text-xs text-slate-600 mt-1">Messages will appear here once activity starts.</p>
        </div>
      </div>
    );
  }

  const dateGroups = groupByDate(messages);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {dateGroups.map((group) => (
        <div key={group.date}>
          {/* Date separator */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="text-[10px] text-slate-500 font-medium px-2">{group.date}</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>

          {/* Messages */}
          {group.msgs.map((msg) => {
            const isBot = msg.is_bot || !!msg.bot_id;
            const displayName = msg.username || (isBot ? 'Bot' : msg.user || 'Unknown');

            return (
              <div key={msg.ts} className="flex gap-3 group py-1 hover:bg-white/[0.02] rounded-lg px-2 -mx-2 transition-colors">
                {/* Avatar */}
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold',
                  isBot ? 'bg-violet-500/15 text-violet-400' : 'bg-cyan-500/15 text-cyan-400',
                )}>
                  {msg.avatar ? (
                    <img src={msg.avatar} alt="" className="w-8 h-8 rounded-full" />
                  ) : isBot ? (
                    <Bot className="w-4 h-4" />
                  ) : (
                    <User className="w-4 h-4" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className={cn(
                      'text-sm font-semibold',
                      isBot ? 'text-violet-300' : 'text-white',
                    )}>
                      {displayName}
                    </span>
                    <span className="text-[10px] text-slate-600">{formatTime(msg.ts)}</span>
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words mt-0.5">
                    {msg.text}
                  </p>
                  {msg.reactions && msg.reactions.length > 0 && (
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {msg.reactions.map((r) => (
                        <span
                          key={r.name}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.08] text-xs"
                        >
                          <span>:{r.name}:</span>
                          <span className="text-[10px] text-slate-500">{r.count}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
