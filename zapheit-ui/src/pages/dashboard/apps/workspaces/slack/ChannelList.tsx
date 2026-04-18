import { useState } from 'react';
import { Hash, Lock, Search, X } from 'lucide-react';
import { cn } from '../../../../../lib/utils';

export interface SlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
  topic?: string;
  num_members?: number;
  unread_count?: number;
}

interface ChannelListProps {
  channels: SlackChannel[];
  selectedId: string | null;
  onSelect: (channel: SlackChannel) => void;
  loading?: boolean;
}

export function ChannelList({ channels, selectedId, onSelect, loading }: ChannelListProps) {
  const [search, setSearch] = useState('');

  const filtered = search
    ? channels.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : channels;

  if (loading) {
    return (
      <div className="space-y-1 p-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-9 rounded-lg bg-white/[0.03] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 py-2 border-b border-white/5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Filter channels…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 placeholder:text-slate-600 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {filtered.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">No channels found</p>
        ) : (
          filtered.map((ch) => (
            <button
              key={ch.id}
              onClick={() => onSelect(ch)}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors text-sm',
                selectedId === ch.id
                  ? 'bg-cyan-500/10 text-white'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200',
              )}
            >
              {ch.is_private ? (
                <Lock className="w-3.5 h-3.5 shrink-0 text-slate-500" />
              ) : (
                <Hash className="w-3.5 h-3.5 shrink-0 text-slate-500" />
              )}
              <span className="flex-1 truncate font-medium">{ch.name}</span>
              {(ch.unread_count ?? 0) > 0 && (
                <span className="shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-cyan-500 text-white text-[10px] font-bold px-1">
                  {ch.unread_count}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
