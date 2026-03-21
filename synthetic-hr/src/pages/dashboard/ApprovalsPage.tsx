import { useCallback, useEffect, useState } from 'react';
import {
  CheckSquare, Clock, RefreshCw, CheckCircle2, XCircle,
  AlertCircle, Ban, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react';
import { api } from '../../lib/api-client';
import type { ApprovalRequest } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';

type Tab = 'queue' | 'history';

const STATUS_CONFIG: Record<ApprovalRequest['status'], { label: string; icon: typeof CheckCircle2; color: string }> = {
  pending:   { label: 'Pending',   icon: Clock,         color: 'text-amber-400 bg-amber-400/10 border-amber-500/20' },
  approved:  { label: 'Approved',  icon: CheckCircle2,  color: 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20' },
  denied:    { label: 'Denied',    icon: XCircle,       color: 'text-red-400 bg-red-400/10 border-red-500/20' },
  expired:   { label: 'Expired',   icon: AlertCircle,   color: 'text-slate-400 bg-slate-400/10 border-slate-500/20' },
  cancelled: { label: 'Cancelled', icon: Ban,           color: 'text-slate-400 bg-slate-400/10 border-slate-500/20' },
};

const ROLE_LABELS: Record<string, string> = {
  viewer: 'Viewer',
  manager: 'Manager',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTimeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h left`;
  return `${Math.floor(h / 24)}d left`;
}

function PayloadPreview({ payload }: { payload: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const json = JSON.stringify(payload, null, 2);
  const isEmpty = Object.keys(payload).length === 0;
  if (isEmpty) return <span className="text-xs text-slate-500 italic">No payload</span>;
  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {expanded ? 'Hide payload' : 'Show payload'}
      </button>
      {expanded && (
        <pre className="mt-2 p-3 rounded-lg bg-black/30 text-xs text-slate-300 overflow-x-auto max-h-48 font-mono">
          {json}
        </pre>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ApprovalRequest['status'] }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', cfg.color)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

type ReviewState = { note: string; submitting: boolean };

function PendingCard({
  request,
  onApprove,
  onDeny,
  onCancel,
}: {
  request: ApprovalRequest;
  onApprove: (id: string, note: string) => Promise<void>;
  onDeny: (id: string, note: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}) {
  const [review, setReview] = useState<ReviewState>({ note: '', submitting: false });
  const [showNote, setShowNote] = useState(false);
  const isExpired = new Date(request.expires_at) < new Date();

  const handleApprove = async () => {
    setReview(r => ({ ...r, submitting: true }));
    await onApprove(request.id, review.note);
    setReview(r => ({ ...r, submitting: false }));
  };

  const handleDeny = async () => {
    setReview(r => ({ ...r, submitting: true }));
    await onDeny(request.id, review.note);
    setReview(r => ({ ...r, submitting: false }));
  };

  return (
    <div className={cn(
      'rounded-xl border p-5 space-y-4',
      isExpired
        ? 'border-slate-700 bg-white/[0.02] opacity-60'
        : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.05] transition-colors'
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
              {request.service}
            </span>
            <span className="text-xs text-slate-500">/</span>
            <span className="text-sm font-medium text-white truncate">{request.action}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>From: <span className="text-slate-300">{request.requested_by}</span></span>
            {request.agent_id && <span>Agent: <span className="text-slate-400 font-mono text-[10px]">{request.agent_id.slice(0, 8)}…</span></span>}
            <span>Needs: <span className="text-amber-300">{ROLE_LABELS[request.required_role] || request.required_role}</span></span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0 text-xs">
          {isExpired
            ? <span className="text-slate-500">Expired</span>
            : <span className="text-amber-400">{formatTimeUntil(request.expires_at)}</span>
          }
          <span className="text-slate-500">{formatTimeAgo(request.created_at)}</span>
        </div>
      </div>

      {/* Payload */}
      <PayloadPreview payload={request.action_payload} />

      {/* Note + Actions */}
      {!isExpired && (
        <div className="space-y-3 pt-1 border-t border-white/[0.06]">
          <button
            onClick={() => setShowNote(v => !v)}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            {showNote ? 'Hide reviewer note' : 'Add reviewer note (optional)'}
          </button>
          {showNote && (
            <textarea
              value={review.note}
              onChange={e => setReview(r => ({ ...r, note: e.target.value }))}
              placeholder="Reason for approval or denial…"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500/50"
              rows={2}
              maxLength={2000}
            />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleApprove}
              disabled={review.submitting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {review.submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Approve
            </button>
            <button
              onClick={handleDeny}
              disabled={review.submitting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-600/70 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {review.submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              Deny
            </button>
            <button
              onClick={() => onCancel(request.id)}
              disabled={review.submitting}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] text-xs transition-colors disabled:opacity-50"
            >
              <Ban className="w-3.5 h-3.5" />
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryCard({ request }: { request: ApprovalRequest }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <StatusBadge status={request.status} />
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-500/10 text-slate-400 border border-slate-500/20">
              {request.service}
            </span>
            <span className="text-sm font-medium text-white truncate">{request.action}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>From: <span className="text-slate-400">{request.requested_by}</span></span>
            {request.reviewer_id && <span>Reviewed by: <span className="text-slate-400 font-mono text-[10px]">{request.reviewer_id.slice(0, 8)}…</span></span>}
          </div>
        </div>
        <span className="text-xs text-slate-500 shrink-0">
          {request.reviewed_at ? formatTimeAgo(request.reviewed_at) : formatTimeAgo(request.created_at)}
        </span>
      </div>
      {request.reviewer_note && (
        <p className="text-sm text-slate-400 italic border-l-2 border-white/10 pl-3">
          "{request.reviewer_note}"
        </p>
      )}
      <PayloadPreview payload={request.action_payload} />
    </div>
  );
}

export default function ApprovalsPage() {
  const [tab, setTab] = useState<Tab>('queue');
  const [all, setAll] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const pending = all.filter(r => r.status === 'pending');
  const history = all.filter(r => r.status !== 'pending');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await api.approvals.list({ limit: 200 });
      if (res.success) setAll(res.data || []);
      else toast.error(res.error || 'Failed to load approval requests');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleApprove = async (id: string, note: string) => {
    const res = await api.approvals.approve(id, note || undefined);
    if (res.success) {
      toast.success('Request approved');
      setAll(prev => prev.map(r => r.id === id ? { ...r, status: 'approved', reviewer_note: note || null, reviewed_at: new Date().toISOString() } : r));
    } else {
      toast.error(res.error || 'Failed to approve request');
    }
  };

  const handleDeny = async (id: string, note: string) => {
    const res = await api.approvals.deny(id, note || undefined);
    if (res.success) {
      toast.error('Request denied');
      setAll(prev => prev.map(r => r.id === id ? { ...r, status: 'denied', reviewer_note: note || null, reviewed_at: new Date().toISOString() } : r));
    } else {
      toast.error(res.error || 'Failed to deny request');
    }
  };

  const handleCancel = async (id: string) => {
    const res = await api.approvals.cancel(id);
    if (res.success) {
      toast.success('Request cancelled');
      setAll(prev => prev.map(r => r.id === id ? { ...r, status: 'cancelled' } : r));
    } else {
      toast.error(res.error || 'Failed to cancel request');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <CheckSquare className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Approvals</h1>
            <p className="text-sm text-slate-400">Human-in-the-loop review queue for agent actions</p>
          </div>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-white/[0.04] rounded-xl border border-white/[0.06] w-fit">
        {([
          { id: 'queue' as Tab, label: 'Queue', count: pending.length },
          { id: 'history' as Tab, label: 'History', count: history.length },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:text-white'
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className={cn(
                'px-1.5 py-0.5 rounded-full text-xs font-semibold',
                t.id === 'queue' && t.count > 0
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-white/10 text-slate-400'
              )}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
        </div>
      ) : tab === 'queue' ? (
        pending.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500/40 mb-3" />
            <p className="text-white font-medium">Queue is empty</p>
            <p className="text-sm text-slate-400 mt-1">No pending approval requests</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pending.map(r => (
              <PendingCard
                key={r.id}
                request={r}
                onApprove={handleApprove}
                onDeny={handleDeny}
                onCancel={handleCancel}
              />
            ))}
          </div>
        )
      ) : (
        history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Clock className="w-12 h-12 text-slate-600 mb-3" />
            <p className="text-white font-medium">No history yet</p>
            <p className="text-sm text-slate-400 mt-1">Reviewed requests will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map(r => (
              <HistoryCard key={r.id} request={r} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
