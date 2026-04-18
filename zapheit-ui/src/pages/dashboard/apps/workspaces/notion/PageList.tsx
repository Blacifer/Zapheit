import { useState, useMemo } from 'react';
import { Search, FileText, Plus, Archive, Clock } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { WriteForm, type WriteFormField } from '../shared';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface NotionPage {
  id: string;
  object?: string;
  icon?: { type: string; emoji?: string };
  properties?: Record<string, any>;
  parent?: { type: string; database_id?: string; page_id?: string };
  created_time?: string;
  last_edited_time?: string;
  archived?: boolean;
  url?: string;
}

interface PageListProps {
  pages: NotionPage[];
  loading: boolean;
  onCreate: (data: Record<string, string>) => void;
  onArchive: (pageId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function pageTitle(page: NotionPage): string {
  if (!page.properties) return 'Untitled';
  const titleProp = page.properties.title || page.properties.Title || page.properties.Name;
  if (titleProp?.title?.[0]?.plain_text) return titleProp.title[0].plain_text;
  // Try other text props
  for (const val of Object.values(page.properties)) {
    if ((val as any)?.title?.[0]?.plain_text) return (val as any).title[0].plain_text;
  }
  return 'Untitled';
}

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

export function PageList({ pages, loading, onCreate, onArchive }: PageListProps) {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const createFields: WriteFormField[] = [
    { name: 'parentDatabaseId', label: 'Parent Database ID', type: 'text', required: true, placeholder: 'Database ID to create page in' },
    { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Page title' },
    { name: 'content', label: 'Content', type: 'textarea', placeholder: 'Initial page content…' },
  ];

  const filtered = useMemo(() => {
    if (!search.trim()) return pages;
    const q = search.toLowerCase();
    return pages.filter((p) => pageTitle(p).toLowerCase().includes(q));
  }, [pages, search]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pages…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-white/20"
          />
        </div>
        <span className="text-[11px] text-slate-600">{filtered.length} pages</span>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 text-white text-[11px] font-medium hover:bg-white/20 transition-colors"
        >
          <Plus className="w-3 h-3" /> New Page
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <WriteForm
            title="New Page"
            fields={createFields}
            onSubmit={async (values) => {
              onCreate(values);
              setShowCreate(false);
            }}
            onCancel={() => setShowCreate(false)}
            submitLabel="Create Page"
          />
        </div>
      )}

      {/* Page list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-1 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No pages found</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((page) => {
              const title = pageTitle(page);
              const expanded = expandedId === page.id;

              return (
                <div key={page.id} className="hover:bg-white/[0.02] transition-colors">
                  <button
                    onClick={() => setExpandedId(expanded ? null : page.id)}
                    className="w-full text-left px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg shrink-0">{page.icon?.emoji || '📄'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={cn(
                            'text-xs font-semibold truncate',
                            page.archived ? 'text-slate-500 line-through' : 'text-slate-200',
                          )}>
                            {title}
                          </span>
                          {page.archived && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium border border-white/10 bg-white/5 text-slate-500">
                              Archived
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-slate-600">
                          {page.last_edited_time && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" /> {timeAgo(page.last_edited_time)}
                            </span>
                          )}
                          {page.parent?.database_id && (
                            <span>in database</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>

                  {expanded && !page.archived && (
                    <div className="px-4 pb-3 ml-7">
                      <button
                        onClick={() => onArchive(page.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 text-[10px] font-medium hover:bg-rose-500/30 transition-colors"
                      >
                        <Archive className="w-3 h-3" /> Archive
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
