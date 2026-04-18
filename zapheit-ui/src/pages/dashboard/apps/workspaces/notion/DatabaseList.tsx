import { Database, Table, Clock } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface NotionDatabase {
  id: string;
  title?: { plain_text: string }[];
  description?: { plain_text: string }[];
  icon?: { type: string; emoji?: string };
  last_edited_time?: string;
  properties?: Record<string, { type: string }>;
  url?: string;
}

interface DatabaseListProps {
  databases: NotionDatabase[];
  loading: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function DatabaseList({ databases, loading }: DatabaseListProps) {
  if (loading) {
    return (
      <div className="animate-pulse space-y-1 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 bg-white/[0.03] rounded-lg" />
        ))}
      </div>
    );
  }

  if (databases.length === 0) {
    return (
      <div className="text-center py-16">
        <Database className="w-8 h-8 text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-500">No databases found</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full divide-y divide-white/[0.04]">
      {databases.map((db) => {
        const title = db.title?.[0]?.plain_text || 'Untitled Database';
        const desc = db.description?.[0]?.plain_text || '';
        const propCount = db.properties ? Object.keys(db.properties).length : 0;

        return (
          <div key={db.id} className="px-5 py-3 hover:bg-white/[0.02] transition-colors">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-200/20 to-slate-400/20 flex items-center justify-center text-lg shrink-0">
                {db.icon?.emoji || '📊'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-200 truncate">{title}</p>
                {desc && (
                  <p className="text-[10px] text-slate-500 truncate mt-0.5">{desc}</p>
                )}
                <div className="flex items-center gap-3 text-[10px] text-slate-600 mt-1">
                  {propCount > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Table className="w-2.5 h-2.5" /> {propCount} properties
                    </span>
                  )}
                  {db.last_edited_time && (
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" /> {timeAgo(db.last_edited_time)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
