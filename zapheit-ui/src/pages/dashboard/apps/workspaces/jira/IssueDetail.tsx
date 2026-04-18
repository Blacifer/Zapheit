import { useState } from 'react';
import { X, Send, Loader2, ArrowRightCircle, Tag, User, Calendar, AlertCircle } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import type { JiraIssue } from './IssueList';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface IssueDetailProps {
  issue: JiraIssue;
  onClose: () => void;
  onTransition: (issueKey: string, transitionId: string) => Promise<void>;
  onComment: (issueKey: string, body: string) => Promise<void>;
  onUpdate: (issueKey: string, fields: Record<string, any>) => Promise<void>;
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

const QUICK_TRANSITIONS = [
  { id: 'todo',        label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review',   label: 'In Review' },
  { id: 'done',        label: 'Done' },
];

function IssueTypeIcon({ type }: { type?: string }) {
  const t = (type || '').toLowerCase();
  if (t.includes('bug')) return <AlertCircle className="w-4 h-4 text-red-400" />;
  if (t.includes('story')) return <div className="w-4 h-4 rounded-sm bg-emerald-500/80" />;
  if (t.includes('epic')) return <div className="w-4 h-4 rounded-sm bg-violet-500/80" />;
  return <div className="w-4 h-4 rounded-sm bg-blue-500/80" />;
}

function formatDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function IssueDetail({ issue, onClose, onTransition, onComment, onUpdate }: IssueDetailProps) {
  const [comment, setComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const [editedSummary, setEditedSummary] = useState(issue.summary);

  const handleSendComment = async () => {
    if (!comment.trim()) return;
    setSendingComment(true);
    try {
      await onComment(issue.key, comment.trim());
      setComment('');
    } finally {
      setSendingComment(false);
    }
  };

  const handleTransition = async (transitionId: string) => {
    setTransitioning(transitionId);
    try {
      await onTransition(issue.key, transitionId);
    } finally {
      setTransitioning(null);
    }
  };

  const handleSaveSummary = async () => {
    if (editedSummary.trim() && editedSummary !== issue.summary) {
      await onUpdate(issue.key, { summary: editedSummary.trim() });
    }
    setEditingSummary(false);
  };

  const statusColor = STATUS_COLORS[issue.status] || 'bg-slate-500/20 text-slate-300 border-slate-500/30';

  return (
    <div className="w-full md:w-96 md:min-w-[24rem] border-l border-white/8 bg-[#080b12] flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <IssueTypeIcon type={issue.issuetype} />
          <span className="text-xs font-mono text-slate-400">{issue.key}</span>
          {issue.issuetype && (
            <span className="text-[10px] text-slate-600">{issue.issuetype}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Summary */}
        <div>
          {editingSummary ? (
            <div className="space-y-2">
              <input
                type="text"
                value={editedSummary}
                onChange={(e) => setEditedSummary(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveSummary(); if (e.key === 'Escape') setEditingSummary(false); }}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={() => void handleSaveSummary()} className="text-xs text-cyan-400 hover:text-cyan-300 font-medium">Save</button>
                <button onClick={() => setEditingSummary(false)} className="text-xs text-slate-500 hover:text-slate-300 font-medium">Cancel</button>
              </div>
            </div>
          ) : (
            <h2
              onClick={() => { setEditedSummary(issue.summary); setEditingSummary(true); }}
              className="text-sm font-semibold text-white cursor-pointer hover:text-cyan-300 transition-colors"
              title="Click to edit"
            >
              {issue.summary}
            </h2>
          )}
        </div>

        {/* Status */}
        <div className="space-y-2">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Status</label>
          <div className="flex items-center gap-2">
            <span className={cn('inline-flex items-center px-2.5 py-1 rounded-md border text-xs font-medium', statusColor)}>
              {issue.status}
            </span>
          </div>
        </div>

        {/* Quick transition buttons */}
        <div className="space-y-2">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Transition</label>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_TRANSITIONS.filter((t) => t.label !== issue.status).map((t) => (
              <button
                key={t.id}
                onClick={() => void handleTransition(t.id)}
                disabled={transitioning !== null}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-[11px] text-slate-300 hover:text-white font-medium transition-colors disabled:opacity-30"
              >
                {transitioning === t.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ArrowRightCircle className="w-3 h-3" />
                )}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1">
              <User className="w-3 h-3" /> Assignee
            </label>
            <p className="text-xs text-slate-300">{issue.assignee || 'Unassigned'}</p>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1">
              <User className="w-3 h-3" /> Reporter
            </label>
            <p className="text-xs text-slate-300">{issue.reporter || '—'}</p>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Priority</label>
            <p className="text-xs text-slate-300">{issue.priority || '—'}</p>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Updated
            </label>
            <p className="text-xs text-slate-300">{formatDate(issue.updated)}</p>
          </div>
        </div>

        {/* Labels */}
        {issue.labels && issue.labels.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1">
              <Tag className="w-3 h-3" /> Labels
            </label>
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((l) => (
                <span key={l} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-400">
                  {l}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Created */}
        <div className="text-[10px] text-slate-600">
          Created {formatDate(issue.created)}
        </div>
      </div>

      {/* Comment input */}
      <div className="border-t border-white/8 px-4 py-3 shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSendComment(); }}
            placeholder="Add a comment…"
            className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
            disabled={sendingComment}
          />
          <button
            onClick={() => void handleSendComment()}
            disabled={!comment.trim() || sendingComment}
            className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-30 shrink-0"
          >
            {sendingComment ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
