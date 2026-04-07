import { useState } from 'react';
import { GitPullRequest, MessageSquare, GitMerge, Clock, User, Check, X, FileEdit } from 'lucide-react';
import { StatusBadge } from '../shared';
import { cn } from '../../../../../lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GitHubPR {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  user: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
  html_url: string;
  head: { ref: string; label: string };
  base: { ref: string; label: string };
  requested_reviewers: { login: string }[];
  comments: number;
  review_comments: number;
  additions: number;
  deletions: number;
  changed_files: number;
}

interface PullRequestListProps {
  pulls: GitHubPR[];
  loading: boolean;
  repoFullName: string | null;
  onMerge: (prNumber: number) => void;
  onComment: (prNumber: number, body: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function prStatusLabel(pr: GitHubPR): { label: string; variant: 'success' | 'warning' | 'error' | 'info' } {
  if (pr.merged) return { label: 'Merged', variant: 'info' };
  if (pr.state === 'closed') return { label: 'Closed', variant: 'error' };
  if (pr.draft) return { label: 'Draft', variant: 'warning' };
  return { label: 'Open', variant: 'success' };
}

function prStatusIcon(pr: GitHubPR) {
  if (pr.merged) return <GitMerge className="w-4 h-4 text-violet-400" />;
  if (pr.state === 'closed') return <X className="w-4 h-4 text-red-400" />;
  return <GitPullRequest className="w-4 h-4 text-emerald-400" />;
}

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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PullRequestList({ pulls, loading, repoFullName, onMerge, onComment }: PullRequestListProps) {
  const [expandedPr, setExpandedPr] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'closed' | 'merged'>('open');

  const filtered = pulls.filter((pr) => {
    if (filter === 'open') return pr.state === 'open' && !pr.merged;
    if (filter === 'closed') return pr.state === 'closed' && !pr.merged;
    if (filter === 'merged') return pr.merged;
    return true;
  });

  if (!repoFullName) {
    return (
      <div className="flex items-center justify-center h-full text-center">
        <div>
          <GitPullRequest className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Select a repository to view pull requests</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 shrink-0">
        {(['all', 'open', 'closed', 'merged'] as const).map((f) => (
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
        <span className="ml-auto text-[11px] text-slate-600">{filtered.length} pull requests</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-1 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Check className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No pull requests match this filter</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((pr) => {
              const status = prStatusLabel(pr);
              const expanded = expandedPr === pr.number;

              return (
                <div key={pr.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
                  <button
                    onClick={() => setExpandedPr(expanded ? null : pr.number)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start gap-2">
                      {prStatusIcon(pr)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-slate-200 truncate">{pr.title}</span>
                          {pr.draft && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-700 text-[9px] font-medium text-slate-400 shrink-0">
                              DRAFT
                            </span>
                          )}
                          <StatusBadge status={status.label.toLowerCase()} />
                        </div>

                        <div className="flex items-center gap-3 text-[10px] text-slate-500">
                          <span>#{pr.number}</span>
                          <span className="flex items-center gap-0.5">
                            <User className="w-2.5 h-2.5" /> {pr.user.login}
                          </span>
                          <span>
                            {pr.head.ref} → {pr.base.ref}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <MessageSquare className="w-2.5 h-2.5" /> {pr.comments + pr.review_comments}
                          </span>
                          {pr.requested_reviewers.length > 0 && (
                            <span>{pr.requested_reviewers.length} reviewers</span>
                          )}
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> {timeAgo(pr.updated_at)}
                          </span>
                        </div>

                        {/* Diff stats */}
                        <div className="flex items-center gap-2 mt-1 text-[10px]">
                          <span className="flex items-center gap-0.5">
                            <FileEdit className="w-2.5 h-2.5 text-slate-500" /> {pr.changed_files} files
                          </span>
                          <span className="text-emerald-400">+{pr.additions}</span>
                          <span className="text-red-400">-{pr.deletions}</span>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded actions */}
                  {expanded && (
                    <div className="mt-3 ml-6 space-y-3">
                      {pr.body && (
                        <p className="text-[11px] text-slate-400 line-clamp-4 whitespace-pre-wrap">{pr.body}</p>
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
                              onComment(pr.number, commentText.trim());
                              setCommentText('');
                            }
                          }}
                          disabled={!commentText.trim()}
                          className="px-3 py-1.5 rounded-lg bg-white/10 text-xs text-white disabled:opacity-40 hover:bg-white/20 transition-colors"
                        >
                          Comment
                        </button>
                      </div>

                      {/* Merge button */}
                      {pr.state === 'open' && !pr.draft && !pr.merged && (
                        <button
                          onClick={() => onMerge(pr.number)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 text-violet-300 text-xs font-medium hover:bg-violet-600/30 transition-colors"
                        >
                          <GitMerge className="w-3.5 h-3.5" />
                          Merge pull request
                        </button>
                      )}
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
