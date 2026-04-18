import { useMemo } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import type { JiraIssue } from './IssueList';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface IssueBoardProps {
  issues: JiraIssue[];
  loading: boolean;
  onSelect: (issue: JiraIssue) => void;
  onTransition: (issueKey: string, transitionId: string) => Promise<void>;
}

interface BoardColumn {
  id: string;
  label: string;
  statuses: string[];
  color: string;
  accent: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COLUMNS: BoardColumn[] = [
  { id: 'todo',        label: 'To Do',       statuses: ['To Do', 'Open', 'Backlog', 'New'],             color: 'border-slate-500/30',  accent: 'text-slate-400' },
  { id: 'in_progress', label: 'In Progress', statuses: ['In Progress', 'In Development', 'Active'],     color: 'border-blue-500/30',   accent: 'text-blue-400' },
  { id: 'in_review',   label: 'In Review',   statuses: ['In Review', 'Code Review', 'QA', 'Testing'],   color: 'border-violet-500/30', accent: 'text-violet-400' },
  { id: 'done',        label: 'Done',        statuses: ['Done', 'Closed', 'Resolved', 'Complete'],      color: 'border-emerald-500/30', accent: 'text-emerald-400' },
];

function matchColumn(status: string): string {
  const lower = status.toLowerCase();
  for (const col of COLUMNS) {
    if (col.statuses.some((s) => s.toLowerCase() === lower)) return col.id;
  }
  // Heuristic fallback
  if (lower.includes('progress') || lower.includes('dev') || lower.includes('active')) return 'in_progress';
  if (lower.includes('review') || lower.includes('qa') || lower.includes('test')) return 'in_review';
  if (lower.includes('done') || lower.includes('close') || lower.includes('resolv')) return 'done';
  return 'todo';
}

function IssueTypeIcon({ type }: { type?: string }) {
  const t = (type || '').toLowerCase();
  if (t.includes('bug')) return <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />;
  if (t.includes('story')) return <div className="w-3 h-3 rounded-sm bg-emerald-500/80 shrink-0" />;
  if (t.includes('epic')) return <div className="w-3 h-3 rounded-sm bg-violet-500/80 shrink-0" />;
  return <div className="w-3 h-3 rounded-sm bg-blue-500/80 shrink-0" />;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function IssueBoard({ issues, loading, onSelect }: IssueBoardProps) {
  const grouped = useMemo(() => {
    const map: Record<string, JiraIssue[]> = {};
    for (const col of COLUMNS) map[col.id] = [];
    for (const issue of issues) {
      const colId = matchColumn(issue.status);
      map[colId].push(issue);
    }
    return map;
  }, [issues]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex gap-3 p-4 h-full overflow-x-auto">
      {COLUMNS.map((col) => {
        const items = grouped[col.id] || [];
        return (
          <div
            key={col.id}
            className={cn(
              'flex flex-col w-64 min-w-[16rem] shrink-0 rounded-xl border bg-white/[0.015]',
              col.color,
            )}
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/5">
              <div className="flex items-center gap-2">
                <div className={cn('w-2 h-2 rounded-full', col.accent.replace('text-', 'bg-'))} />
                <span className={cn('text-xs font-semibold', col.accent)}>{col.label}</span>
              </div>
              <span className="text-[10px] text-slate-600 font-medium">{items.length}</span>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {items.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-[10px] text-slate-600">No issues</p>
                </div>
              ) : (
                items.map((issue) => (
                  <button
                    key={issue.key}
                    onClick={() => onSelect(issue)}
                    className="w-full text-left p-3 rounded-lg border border-white/8 bg-white/[0.03] hover:bg-white/[0.06] transition-colors space-y-2"
                  >
                    <div className="flex items-center gap-1.5">
                      <IssueTypeIcon type={issue.issuetype} />
                      <span className="text-[10px] text-slate-500 font-mono">{issue.key}</span>
                    </div>
                    <p className="text-xs text-white leading-snug line-clamp-2">{issue.summary}</p>
                    <div className="flex items-center justify-between">
                      {issue.priority && (
                        <span className="text-[10px] text-slate-500">{issue.priority}</span>
                      )}
                      {issue.assignee && (
                        <span className="text-[10px] text-slate-500 truncate max-w-[8rem]">{issue.assignee}</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
