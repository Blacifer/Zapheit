import { useState } from 'react';
import { CircleDot, MessageSquare, Tag, User, Clock, Plus, Check, X } from 'lucide-react';
import { StatusBadge, WriteForm, type WriteFormField } from '../shared';
import { cn } from '../../../../../lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  user: { login: string; avatar_url: string };
  labels: { name: string; color: string }[];
  comments: number;
  assignees: { login: string }[];
  created_at: string;
  updated_at: string;
  html_url: string;
}

interface GitHubIssuesListProps {
  issues: GitHubIssue[];
  loading: boolean;
  repoFullName: string | null;
  onCreate: (title: string, body: string) => void;
  onComment: (issueNumber: number, body: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function hexColor(c: string) {
  if (c.startsWith('#')) return c;
  return `#${c}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function GitHubIssuesList({ issues, loading, repoFullName, onCreate, onComment }: GitHubIssuesListProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open');

  const filtered = issues.filter((iss) => {
    if (filter === 'open') return iss.state === 'open';
    if (filter === 'closed') return iss.state === 'closed';
    return true;
  });

  const createFields: WriteFormField[] = [
    { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Issue title' },
    { name: 'body', label: 'Description', type: 'textarea', placeholder: 'Describe the issue…' },
  ];

  if (!repoFullName) {
    return (
      <div className="flex items-center justify-center h-full text-center">
        <div>
          <CircleDot className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Select a repository to view issues</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 shrink-0">
        {(['all', 'open', 'closed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors capitalize',
              filter === f
                ? 'bg-white/10 text-white'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
            )}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-600">{filtered.length} issues</span>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 text-[11px] font-medium hover:bg-emerald-600/30 transition-colors"
        >
          <Plus className="w-3 h-3" /> New Issue
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <WriteForm
            title="New Issue"
            fields={createFields}
            onSubmit={async (values) => {
              onCreate(values.title, values.body || '');
              setShowCreate(false);
            }}
            onCancel={() => setShowCreate(false)}
            submitLabel="Create Issue"
          />
        </div>
      )}

      {/* Issue list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-1 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Check className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No issues match this filter</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((iss) => {
              const expanded = expandedIssue === iss.number;

              return (
                <div key={iss.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
                  <button
                    onClick={() => setExpandedIssue(expanded ? null : iss.number)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start gap-2">
                      {iss.state === 'open' ? (
                        <CircleDot className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <X className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="text-xs font-semibold text-slate-200">{iss.title}</span>
                          <StatusBadge
                            status={iss.state}
                          />
                          {iss.labels.map((l) => (
                            <span
                              key={l.name}
                              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium"
                              style={{
                                backgroundColor: hexColor(l.color) + '20',
                                color: hexColor(l.color),
                                border: `1px solid ${hexColor(l.color)}40`,
                              }}
                            >
                              <Tag className="w-2 h-2" />
                              {l.name}
                            </span>
                          ))}
                        </div>

                        <div className="flex items-center gap-3 text-[10px] text-slate-500">
                          <span>#{iss.number}</span>
                          <span className="flex items-center gap-0.5">
                            <User className="w-2.5 h-2.5" /> {iss.user.login}
                          </span>
                          {iss.assignees.length > 0 && (
                            <span>→ {iss.assignees.map((a) => a.login).join(', ')}</span>
                          )}
                          <span className="flex items-center gap-0.5">
                            <MessageSquare className="w-2.5 h-2.5" /> {iss.comments}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> {timeAgo(iss.updated_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {expanded && (
                    <div className="mt-3 ml-6 space-y-3">
                      {iss.body && (
                        <p className="text-[11px] text-slate-400 line-clamp-6 whitespace-pre-wrap">{iss.body}</p>
                      )}

                      {/* Comment form */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          placeholder="Add a comment…"
                          className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
                        />
                        <button
                          onClick={() => {
                            if (commentText.trim()) {
                              onComment(iss.number, commentText.trim());
                              setCommentText('');
                            }
                          }}
                          disabled={!commentText.trim()}
                          className="px-3 py-1.5 rounded-lg bg-white/10 text-xs text-white disabled:opacity-40 hover:bg-white/20 transition-colors"
                        >
                          Comment
                        </button>
                      </div>
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
