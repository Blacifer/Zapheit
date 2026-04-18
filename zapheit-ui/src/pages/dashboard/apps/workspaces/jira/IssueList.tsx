import { useState, useMemo } from 'react';
import { Search, Plus, ChevronDown, AlertCircle, ArrowUpCircle, ArrowDownCircle, MinusCircle } from 'lucide-react';
import { cn } from '../../../../../lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee?: string;
  issuetype?: string;
  updated?: string;
  created?: string;
  description?: any;
  reporter?: string;
  labels?: string[];
}

interface IssueListProps {
  issues: JiraIssue[];
  loading: boolean;
  selectedKey: string | null;
  onSelect: (issue: JiraIssue) => void;
  onSearch: (jql: string) => void;
  onCreate: (data: { project_key: string; summary: string; issue_type: string; description?: string; priority?: string }) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<string, string> = {
  'To Do':       'bg-slate-500/20 text-slate-300 border-slate-500/30',
  'Open':        'bg-slate-500/20 text-slate-300 border-slate-500/30',
  'In Progress': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'In Review':   'bg-violet-500/20 text-violet-300 border-violet-500/30',
  'Done':        'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'Closed':      'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

const PRIORITY_ICONS: Record<string, { Icon: typeof ArrowUpCircle; color: string }> = {
  Highest:  { Icon: ArrowUpCircle, color: 'text-red-400' },
  High:     { Icon: ArrowUpCircle, color: 'text-orange-400' },
  Medium:   { Icon: MinusCircle,   color: 'text-amber-400' },
  Low:      { Icon: ArrowDownCircle, color: 'text-blue-400' },
  Lowest:   { Icon: ArrowDownCircle, color: 'text-slate-400' },
};

function PriorityIcon({ priority }: { priority: string }) {
  const meta = PRIORITY_ICONS[priority];
  if (!meta) return <MinusCircle className="w-3.5 h-3.5 text-slate-500" />;
  return <meta.Icon className={cn('w-3.5 h-3.5', meta.color)} />;
}

function StatusBadgeLocal({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-medium', color)}>
      {status}
    </span>
  );
}

function IssueTypeIcon({ type }: { type?: string }) {
  const t = (type || '').toLowerCase();
  if (t.includes('bug')) return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
  if (t.includes('story')) return <div className="w-3.5 h-3.5 rounded-sm bg-emerald-500/80" />;
  if (t.includes('epic')) return <div className="w-3.5 h-3.5 rounded-sm bg-violet-500/80" />;
  return <div className="w-3.5 h-3.5 rounded-sm bg-blue-500/80" />;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function IssueList({ issues, loading, selectedKey, onSelect, onSearch, onCreate }: IssueListProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [newProjectKey, setNewProjectKey] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [newType, setNewType] = useState('Task');
  const [creating, setCreating] = useState(false);

  const statuses = useMemo(() => {
    const set = new Set(issues.map((i) => i.status));
    return ['all', ...Array.from(set)];
  }, [issues]);

  const filtered = useMemo(() => {
    let list = issues;
    if (statusFilter !== 'all') {
      list = list.filter((i) => i.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.key.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q) ||
          (i.assignee || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [issues, statusFilter, search]);

  const handleSearchSubmit = () => {
    if (search.trim()) {
      onSearch(`text ~ "${search.trim()}" order by updated DESC`);
    } else {
      onSearch('order by updated DESC');
    }
  };

  const handleCreate = async () => {
    if (!newProjectKey.trim() || !newSummary.trim()) return;
    setCreating(true);
    try {
      await onCreate({ project_key: newProjectKey.trim(), summary: newSummary.trim(), issue_type: newType });
      setShowCreate(false);
      setNewProjectKey('');
      setNewSummary('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 shrink-0">
        <div className="flex-1 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearchSubmit(); }}
              placeholder="Search issues…"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
            />
          </div>

          {/* Status filter */}
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="appearance-none pl-3 pr-7 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
            >
              {statuses.map((s) => (
                <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
          </div>
        </div>

        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors shrink-0"
        >
          <Plus className="w-3 h-3" /> Create
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-white/5 space-y-2 bg-white/[0.02]">
          <div className="flex gap-2">
            <input
              type="text"
              value={newProjectKey}
              onChange={(e) => setNewProjectKey(e.target.value)}
              placeholder="Project key (e.g. PROJ)"
              className="w-28 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="appearance-none px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
            >
              <option value="Task">Task</option>
              <option value="Bug">Bug</option>
              <option value="Story">Story</option>
              <option value="Epic">Epic</option>
            </select>
          </div>
          <input
            type="text"
            value={newSummary}
            onChange={(e) => setNewSummary(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
            placeholder="What needs to be done?"
            className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void handleCreate()}
              disabled={!newProjectKey.trim() || !newSummary.trim() || creating}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-30"
            >
              {creating ? 'Creating…' : 'Create issue'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs text-slate-400 hover:text-white font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Issue list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-1 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-slate-500">No issues found</p>
            <p className="text-xs text-slate-600 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((issue) => (
              <button
                key={issue.key}
                onClick={() => onSelect(issue)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04] transition-colors',
                  selectedKey === issue.key && 'bg-white/[0.06]',
                )}
              >
                <IssueTypeIcon type={issue.issuetype} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500 font-mono shrink-0">{issue.key}</span>
                    <span className="text-xs text-white truncate">{issue.summary}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusBadgeLocal status={issue.status} />
                    {issue.assignee && (
                      <span className="text-[10px] text-slate-500 truncate">{issue.assignee}</span>
                    )}
                  </div>
                </div>
                <PriorityIcon priority={issue.priority} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
