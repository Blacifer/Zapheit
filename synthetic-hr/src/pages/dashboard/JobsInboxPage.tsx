import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  X,
  RefreshCw,
  Clock,
  PlayCircle,
  AlertCircle,
  CheckCircle2,
  Download,
  RotateCcw,
  Calendar,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Send,
} from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import type { AgentJob } from '../../types';

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(text: string): JSX.Element {
  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-base font-semibold text-white mt-4 mb-1">{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-lg font-bold text-white mt-5 mb-2 border-b border-slate-700 pb-1">{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-xl font-bold text-white mt-5 mb-2">{renderInline(line.slice(2))}</h1>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: JSX.Element[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(<li key={i} className="ml-4 text-slate-200">{renderInline(lines[i].slice(2))}</li>);
        i++;
      }
      elements.push(<ul key={`ul-${i}`} className="list-disc list-inside space-y-1 my-3 text-slate-200">{items}</ul>);
      continue;
    } else if (/^\d+\.\s/.test(line)) {
      const items: JSX.Element[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={i} className="ml-4 text-slate-200">{renderInline(lines[i].replace(/^\d+\.\s/, ''))}</li>);
        i++;
      }
      elements.push(<ol key={`ol-${i}`} className="list-decimal list-inside space-y-1 my-3 text-slate-200">{items}</ol>);
      continue;
    } else if (line.startsWith('```')) {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 overflow-x-auto text-sm text-slate-200 my-3">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
    } else if (line.trim() === '') {
      if (elements.length > 0) elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-slate-200 leading-relaxed">{renderInline(line)}</p>);
    }
    i++;
  }

  return <div className="space-y-2 text-sm leading-relaxed text-slate-200">{elements}</div>;
}

function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={key++} className="text-white font-semibold">{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={key++} className="italic">{m[3]}</em>);
    else if (m[4]) parts.push(<code key={key++} className="bg-slate-900/60 px-1 rounded text-cyan-300 text-[11px]">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractJobResult(job: AgentJob): string {
  const output = job.output as any;
  if (!output) return '';
  if (output.final?.message) return output.final.message;
  if (output.message) return output.message;
  const stepsArr = Array.isArray(output.steps) ? output.steps : [];
  const lastStep = stepsArr[stepsArr.length - 1];
  if (lastStep?.message) return lastStep.message;
  return '';
}

function prettyAction(job: AgentJob): string {
  const input = job.input as any;
  if (!input) return 'Connector action';
  const action = input.action_type || input.action || input.connector_action;
  const resource = input.resource || input.entity || input.target;
  if (action && resource) return `${action} → ${resource}`;
  if (action) return String(action);
  return 'Connector action';
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function statusColor(status: string) {
  if (status === 'succeeded') return 'text-emerald-400';
  if (status === 'failed') return 'text-red-400';
  if (status === 'running') return 'text-cyan-400';
  if (status === 'queued') return 'text-amber-400';
  if (status === 'pending_approval') return 'text-orange-400';
  if (status === 'canceled') return 'text-slate-400';
  return 'text-slate-400';
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending_approval: 'Pending Approval',
    queued: 'Queued',
    running: 'Running',
    succeeded: 'Succeeded',
    failed: 'Failed',
    canceled: 'Canceled',
  };
  const colors: Record<string, string> = {
    pending_approval: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    queued: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    running: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    succeeded: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    failed: 'bg-red-500/15 text-red-300 border-red-500/30',
    canceled: 'bg-slate-700/50 text-slate-400 border-slate-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] border ${colors[status] || colors.canceled}`}>
      {labels[status] || status}
    </span>
  );
}

function approvalProgress(job: AgentJob) {
  const required = Math.max(1, Number(job.required_approvals || job.approval?.required_approvals || 1));
  const recorded = Math.max(0, Number(job.approvals_recorded || job.approval?.approval_history?.filter((entry) => entry.decision === 'approved').length || 0));
  return {
    required,
    recorded,
    remaining: Math.max(0, required - recorded),
  };
}

// ─── Comments panel ───────────────────────────────────────────────────────────

function CommentsPanel({ jobId }: { jobId: string }) {
  const [comments, setComments] = useState<Array<{ id: string; content: string; created_at: string; user_id?: string }>>([]);
  const [newComment, setNewComment] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.jobs.listComments(jobId).then((res: any) => {
      if (res.success) setComments(res.data || []);
    });
  }, [jobId]);

  const send = async () => {
    if (!newComment.trim()) return;
    setSending(true);
    try {
      const res = await api.jobs.addComment(jobId, newComment.trim()) as any;
      if (!res.success) throw new Error(res.error || 'Failed');
      setComments((prev) => [...prev, res.data]);
      setNewComment('');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add comment');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-slate-700 pt-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="w-4 h-4 text-slate-400" />
        <span className="text-xs text-slate-400 font-medium">Team Notes ({comments.length})</span>
      </div>
      {comments.length > 0 && (
        <div className="space-y-2 mb-3">
          {comments.map((c) => (
            <div key={c.id} className="bg-slate-900/40 border border-slate-700 rounded-lg p-3 text-xs">
              <p className="text-slate-200">{c.content}</p>
              <p className="text-slate-500 mt-1">{formatDate(c.created_at)}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Add a note for your team..."
          className="flex-1 bg-slate-900/40 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50"
        />
        <button
          onClick={send}
          disabled={sending || !newComment.trim()}
          className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Job detail panel ─────────────────────────────────────────────────────────

function JobDetail({
  job,
  agentNameById,
  onRerun,
  onDecide,
}: {
  job: AgentJob;
  agentNameById: Map<string, string>;
  onRerun: (job: AgentJob) => void;
  onDecide: (jobId: string, decision: 'approved' | 'rejected') => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const resultText = extractJobResult(job);
  const status = String(job.status || '');
  const isPending = status === 'pending_approval';
  const isConnector = job.type === 'connector_action';
  const approvalState = approvalProgress(job);

  const download = (format: 'txt' | 'html' = 'html') => {
    const slug = `run-${job.id.slice(0, 8)}`;
    const title = (job as any).playbook_id
      ? String((job as any).playbook_id).replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
      : 'Run Result';
    if (format === 'txt') {
      const clean = resultText
        .replace(/^#{1,3} /gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/^- /gm, '• ');
      const blob = new Blob([clean], { type: 'text/plain; charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${slug}.txt`; a.click();
      URL.revokeObjectURL(url);
    } else {
      const body = resultText
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
        .replace(/\n{2,}/g, '</p><p>').trim();
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:800px;margin:40px auto;padding:0 24px;line-height:1.75;color:#e2e8f0;background:#0f172a}h1,h2,h3{color:#f1f5f9;border-bottom:1px solid #334155;padding-bottom:6px;margin-top:28px}h1{font-size:1.6em}h2{font-size:1.3em}h3{font-size:1.1em}pre{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:12px;overflow-x:auto}code{background:#1e293b;color:#67e8f9;padding:2px 5px;border-radius:4px}ul,ol{padding-left:24px}li{margin:5px 0}strong{color:#f1f5f9}p{margin:12px 0}</style></head><body><h1>${title}</h1>${body}</body></html>`;
      const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${slug}.html`; a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">
              {(job as any).playbook_id
                ? (job as any).playbook_id.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
                : job.type}
            </span>
            <StatusBadge status={status} />
            {(job as any).batch_id && (
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-purple-500/15 text-purple-300 border border-purple-500/30">
                Batch
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {agentNameById.get(job.agent_id || '') || job.agent_id || 'Unknown agent'} · {formatDate(job.created_at)}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isPending && isConnector ? (
            <>
              <button
                onClick={() => onDecide(job.id, 'rejected')}
                className="px-3 py-1.5 rounded-lg bg-slate-900/40 hover:bg-slate-900/60 text-slate-200 text-xs border border-slate-700 inline-flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                Reject
              </button>
              <button
                onClick={() => onDecide(job.id, 'approved')}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                Approve
              </button>
            </>
          ) : null}
          {status === 'succeeded' && !isConnector && resultText ? (
            <>
              <button
                onClick={() => download('html')}
                title="Download as HTML"
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => download('txt')}
                title="Download as plain text"
                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-mono"
              >
                .txt
              </button>
              <button
                onClick={() => onRerun(job)}
                title="Re-run with same inputs"
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Error */}
      {job.error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-300">
          {job.error}
        </div>
      ) : null}

      {/* Connector action summary */}
      {isConnector && (
        <div className="bg-slate-900/40 border border-slate-700 rounded-lg p-3 space-y-2">
          <div>
            <div className="text-xs text-slate-400 mb-1">Action</div>
            <div className="text-sm text-slate-100 font-medium">{prettyAction(job)}</div>
          </div>
          {isPending && (job as any).required_role && (
            <div className="flex flex-wrap gap-3 text-xs">
              <div>
                <span className="text-slate-500">Required role: </span>
                <span className="text-amber-300 font-mono">{(job as any).required_role}</span>
              </div>
              {(job as any).assigned_to && (
                <div>
                  <span className="text-slate-500">Assigned to: </span>
                  <span className="text-cyan-300 font-mono">{(job as any).assigned_to}</span>
                  <span className="ml-1 text-slate-500">(only this user can approve)</span>
                </div>
              )}
            </div>
          )}
          {isPending && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-amber-200 font-medium">
                  Approval progress: {approvalState.recorded} of {approvalState.required}
                </span>
                {approvalState.remaining > 0 && (
                  <span className="text-slate-400">
                    {approvalState.remaining} approval{approvalState.remaining === 1 ? '' : 's'} remaining
                  </span>
                )}
              </div>
              {job.awaiting_additional_approval && (
                <p className="text-[11px] text-amber-300 mt-1">
                  One reviewer has already approved this action. A separate approver is still required before execution.
                </p>
              )}
              {Array.isArray(job.approval?.approval_history) && job.approval!.approval_history!.length > 0 && (
                <div className="mt-2 space-y-1">
                  {job.approval!.approval_history!.map((entry, idx) => (
                    <div key={`${entry.reviewer_id}-${entry.decided_at}-${idx}`} className="text-[11px] text-slate-400">
                      {entry.decision === 'approved' ? 'Approved' : 'Rejected'} by <span className="font-mono text-slate-300">{entry.reviewer_id}</span> at {formatDate(entry.decided_at)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {isPending && (
            <p className="text-xs text-amber-300">
              This action has side effects. Review carefully before approving.
            </p>
          )}
        </div>
      )}

      {/* Result output */}
      {resultText && !isConnector ? (
        <div className="bg-slate-900/30 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-400 font-medium">Result</span>
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
            >
              {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showRaw ? 'Hide raw' : 'Show raw'}
            </button>
          </div>
          {showRaw ? (
            <pre className="text-xs text-slate-200 bg-slate-900/60 border border-slate-700 rounded-lg p-3 overflow-auto max-h-[400px]">
              {JSON.stringify(job.output, null, 2)}
            </pre>
          ) : (
            <div className="prose-like max-h-[480px] overflow-auto pr-1">
              {renderMarkdown(resultText)}
            </div>
          )}
        </div>
      ) : !resultText && status === 'succeeded' && !isConnector ? (
        <div className="bg-slate-900/30 border border-slate-700 rounded-xl p-4">
          <pre className="text-xs text-slate-200 overflow-auto max-h-[400px]">
            {JSON.stringify(job.output, null, 2)}
          </pre>
        </div>
      ) : null}

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-900/30 border border-slate-700 rounded-lg p-2.5">
          <div className="text-slate-500">Started</div>
          <div className="text-slate-300 mt-0.5">{formatDate(job.started_at)}</div>
        </div>
        <div className="bg-slate-900/30 border border-slate-700 rounded-lg p-2.5">
          <div className="text-slate-500">Finished</div>
          <div className="text-slate-300 mt-0.5">{formatDate(job.finished_at)}</div>
        </div>
        {(job as any).batch_id && (
          <div className="col-span-2 bg-slate-900/30 border border-slate-700 rounded-lg p-2.5">
            <div className="text-slate-500">Batch ID</div>
            <div className="text-slate-300 mt-0.5 font-mono truncate">{(job as any).batch_id}</div>
          </div>
        )}
        {(job as any).parent_job_id && (
          <div className="col-span-2 bg-slate-900/30 border border-slate-700 rounded-lg p-2.5">
            <div className="text-slate-500">Chained from</div>
            <div className="text-slate-300 mt-0.5 font-mono truncate">{(job as any).parent_job_id}</div>
          </div>
        )}
      </div>

      {/* Comments */}
      {status === 'succeeded' && <CommentsPanel jobId={job.id} />}
    </div>
  );
}

// ─── Job list item ─────────────────────────────────────────────────────────────

function JobListItem({
  job,
  selected,
  agentNameById,
  onClick,
}: {
  job: AgentJob;
  selected: boolean;
  agentNameById: Map<string, string>;
  onClick: () => void;
}) {
  const status = String(job.status || '');

  function Icon() {
    if (status === 'pending_approval') return <Clock className="w-4 h-4 text-orange-400" />;
    if (status === 'queued') return <Clock className="w-4 h-4 text-amber-400" />;
    if (status === 'running') return <PlayCircle className="w-4 h-4 text-cyan-400" />;
    if (status === 'succeeded') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    if (status === 'failed') return <AlertCircle className="w-4 h-4 text-red-400" />;
    return <Clock className="w-4 h-4 text-slate-400" />;
  }

  const playbookName = (job as any).playbook_id
    ? (job as any).playbook_id.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
    : null;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors ${
        selected ? 'bg-cyan-500/10 border-l-2 border-l-cyan-500' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0">
          <Icon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-white truncate font-medium">
            {playbookName || agentNameById.get(job.agent_id || '') || job.type}
          </div>
          <div className={`text-xs mt-0.5 ${statusColor(status)}`}>
            {status.replace(/_/g, ' ')}
            {(job as any).batch_id ? ' · Batch' : ''}
            {(job as any).parent_job_id ? ' · Chained' : ''}
          </div>
          {status === 'pending_approval' && (job.approvals_recorded || job.required_approvals) ? (
            <div className="text-[11px] text-amber-300 mt-0.5">
              {job.approvals_recorded || 0} of {job.required_approvals || 1} approvals
            </div>
          ) : null}
          <div className="text-[11px] text-slate-500 mt-0.5">{formatDate(job.created_at)}</div>
        </div>
      </div>
    </button>
  );
}

// ─── Scheduled runs tab ────────────────────────────────────────────────────────

function ScheduledTab() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (api as any).playbooks?.listSchedules?.().then((res: any) => {
      if (res?.success) setSchedules(res.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading schedules…</div>;
  if (!schedules.length) return (
    <div className="p-6 text-sm text-slate-400">
      No scheduled playbooks yet. Create schedules from the Playbooks → Schedules tab.
    </div>
  );

  return (
    <div className="divide-y divide-slate-800">
      {schedules.map((s) => (
        <div key={s.id} className="px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-white font-medium">
              {s.playbook_id?.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) || s.playbook_id}
            </div>
            <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
              <Calendar className="w-3 h-3" />
              {s.cron_expression}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">Last run</div>
            <div className="text-xs text-slate-300">{formatDate(s.last_run_at)}</div>
            <div className="text-xs text-slate-500 mt-0.5">Next: {formatDate(s.next_run_at)}</div>
          </div>
          <div>
            <span className={`px-2 py-0.5 rounded-full text-[11px] border ${
              s.enabled
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-slate-700/50 text-slate-400 border-slate-600'
            }`}>
              {s.enabled ? 'Active' : 'Paused'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS = ['History', 'Pending Actions', 'Scheduled'] as const;
type Tab = typeof TABS[number];

export default function JobsInboxPage({ agents }: { agents: { id: string; name: string }[] }) {
  const [activeTab, setActiveTab] = useState<Tab>('History');
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const [pendingJobs, setPendingJobs] = useState<AgentJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);

  const agentNameById = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);

  const loadHistory = async () => {
    setBusy(true);
    try {
      const [histRes, pendRes] = await Promise.all([
        api.jobs.list({ limit: 100 }) as any,
        api.jobs.list({ status: 'pending_approval', type: 'connector_action', limit: 100 }) as any,
      ]);
      if (histRes.success) {
        const all = (histRes.data || []) as AgentJob[];
        // History tab: non-connector completed/active runs
        setJobs(all.filter((j: AgentJob) => j.type !== 'connector_action' || String(j.status) !== 'pending_approval'));
      }
      if (pendRes.success) {
        setPendingJobs((pendRes.data || []) as AgentJob[]);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load run history');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-select first job when tab or data changes
  useEffect(() => {
    const list = activeTab === 'Pending Actions' ? pendingJobs : jobs;
    if (list.length && !list.find((j) => j.id === selectedJobId)) {
      setSelectedJobId(list[0].id);
    }
  }, [activeTab, jobs, pendingJobs, selectedJobId]);

  const listForTab = activeTab === 'Pending Actions' ? pendingJobs : jobs;
  const selectedJobBase = listForTab.find((j) => j.id === selectedJobId) || null;

  // For pending connector actions, augment with approval metadata (assigned_to, required_role) from the detail endpoint.
  const [selectedJobDetail, setSelectedJobDetail] = useState<any>(null);
  useEffect(() => {
    if (!selectedJobId || !selectedJobBase || selectedJobBase.type !== 'connector_action' || String(selectedJobBase.status) !== 'pending_approval') {
      setSelectedJobDetail(null);
      return;
    }
    api.jobs.get(selectedJobId).then((res) => {
      if (res.success && (res.data as any)?.job) setSelectedJobDetail((res.data as any).job);
    }).catch(() => undefined);
  }, [selectedJobId, selectedJobBase]);

  const selectedJob = (selectedJobDetail || selectedJobBase) as AgentJob | null;

  const decide = async (jobId: string, decision: 'approved' | 'rejected') => {
    try {
      const res = await api.jobs.decide(jobId, decision) as any;
      if (!res.success) throw new Error(res.error || 'Decision failed');
      if (decision === 'approved' && res.data?.awaiting_additional_approval) {
        toast.success(`Recorded approval. ${res.data?.approvals_remaining ?? 0} still required.`);
      } else {
        toast.success(decision === 'approved' ? 'Approved' : 'Rejected');
      }
      await loadHistory();
    } catch (err: any) {
      toast.error(err?.message || 'Decision failed');
    }
  };

  const rerun = async (job: AgentJob) => {
    setRerunning(true);
    try {
      const res = await api.jobs.create({
        agent_id: job.agent_id || '',
        type: job.type as any,
        input: job.input as any,
        playbook_id: (job as any).playbook_id,
      }) as any;
      if (!res.success) throw new Error(res.error || 'Re-run failed');
      toast.success('Job re-queued');
      await loadHistory();
    } catch (err: any) {
      toast.error(err?.message || 'Re-run failed');
    } finally {
      setRerunning(false);
    }
  };

  const pendingCount = pendingJobs.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Run History</h1>
          <p className="text-sm text-slate-400 mt-1">
            View completed runs, review markdown output, approve connector actions, and manage schedules.
          </p>
        </div>
        <button
          onClick={loadHistory}
          disabled={busy}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700 inline-flex items-center gap-2 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800/40 border border-slate-700 rounded-xl p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors relative ${
              activeTab === tab
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab}
            {tab === 'Pending Actions' && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-[10px] font-bold">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Scheduled tab */}
      {activeTab === 'Scheduled' ? (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700">
            <div className="text-sm font-medium text-slate-200">Scheduled Playbooks</div>
            <div className="text-xs text-slate-500 mt-0.5">Upcoming and recent scheduled runs</div>
          </div>
          <ScheduledTab />
        </div>
      ) : (
        /* History / Pending Actions two-column layout */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: job list */}
          <div className="lg:col-span-1 bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
              <div className="text-sm text-slate-300">
                {activeTab === 'Pending Actions' ? 'Awaiting Approval' : 'Recent Runs'}
                <span className="ml-2 text-slate-500">({listForTab.length})</span>
              </div>
              {busy && <span className="text-xs text-slate-500">Loading…</span>}
            </div>
            <div className="max-h-[600px] overflow-auto">
              {listForTab.length === 0 ? (
                <div className="p-4 text-sm text-slate-400">
                  {activeTab === 'Pending Actions'
                    ? 'No connector actions awaiting approval.'
                    : 'No runs yet. Head to Playbooks to run your first template.'}
                </div>
              ) : (
                listForTab.map((job) => (
                  <JobListItem
                    key={job.id}
                    job={job}
                    selected={job.id === selectedJobId}
                    agentNameById={agentNameById}
                    onClick={() => setSelectedJobId(job.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right: detail */}
          <div className="lg:col-span-2 bg-slate-800/30 border border-slate-700 rounded-xl p-5 min-h-[300px]">
            {!selectedJob ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <CheckCircle2 className="w-10 h-10 text-slate-600 mb-3" />
                <div className="text-sm text-slate-400">Select a run to view details and output</div>
              </div>
            ) : (
              <JobDetail
                job={selectedJob}
                agentNameById={agentNameById}
                onRerun={rerun}
                onDecide={decide}
              />
            )}
            {rerunning && (
              <div className="mt-3 text-xs text-cyan-400 flex items-center gap-2">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Re-queuing job…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
