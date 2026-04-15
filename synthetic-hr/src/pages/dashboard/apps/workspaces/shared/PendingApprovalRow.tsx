import { useState } from 'react';
import { Bot, CheckCircle, XCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../../../../../lib/api-client';
import type { ApprovalRequest } from '../../../../../lib/api/approvals';
import { toast } from '../../../../../lib/toast';

interface PendingApprovalRowProps {
  approval: ApprovalRequest;
  onResolved: (id: string) => void;
}

function payloadSummary(action: string, payload: Record<string, any>): string {
  switch (action) {
    case 'send_email':
      return `To: ${payload.to ?? '?'} · ${payload.subject ?? '(no subject)'}`;
    case 'create_event':
      return `${payload.summary ?? 'Untitled event'} · ${payload.startDateTime ?? ''}`;
    case 'share_file':
      return `Share file with ${payload.email ?? '?'} as ${payload.role ?? 'reader'}`;
    case 'post_message':
    case 'send_message':
      return `#${payload.channel ?? '?'} · ${String(payload.text ?? '').slice(0, 60)}`;
    default:
      return JSON.stringify(payload).slice(0, 80);
  }
}

function actionLabel(action: string): string {
  return action.replace(/_/g, ' ');
}

export function PendingApprovalRow({ approval, onResolved }: PendingApprovalRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState<'approve' | 'deny' | null>(null);

  const payload = (approval.action_payload ?? {}) as Record<string, any>;
  const summary = payloadSummary(approval.action, payload);

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading('approve');
    try {
      const res = await api.approvals.approve(approval.id);
      if (res.success) {
        toast.success('Action approved');
        onResolved(approval.id);
      } else {
        toast.error((res as any).error || 'Approval failed');
      }
    } catch { toast.error('Network error'); }
    finally { setLoading(null); }
  };

  const handleDeny = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading('deny');
    try {
      const res = await api.approvals.deny(approval.id);
      if (res.success) {
        toast.success('Action denied');
        onResolved(approval.id);
      } else {
        toast.error((res as any).error || 'Deny failed');
      }
    } catch { toast.error('Network error'); }
    finally { setLoading(null); }
  };

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] overflow-hidden">
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-amber-500/[0.04] transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-amber-500/50 shrink-0">
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5" />
            : <ChevronRight className="w-3.5 h-3.5" />}
        </span>

        <Bot className="w-3.5 h-3.5 text-violet-400 shrink-0" />

        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-200 truncate">{summary}</p>
          <p className="text-[10px] text-amber-400/70 mt-0.5">
            <span className="font-medium">{approval.requested_by}</span>
            {' '}wants to {actionLabel(approval.action)}
            {' '}· requires {approval.required_role}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={handleApprove}
            disabled={!!loading}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-400 text-[11px] font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
          >
            {loading === 'approve'
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <CheckCircle className="w-3 h-3" />}
            Approve
          </button>
          <button
            onClick={handleDeny}
            disabled={!!loading}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-rose-500/15 text-rose-400 text-[11px] font-medium hover:bg-rose-500/25 transition-colors disabled:opacity-40"
          >
            {loading === 'deny'
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <XCircle className="w-3 h-3" />}
            Deny
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t border-amber-500/10 space-y-2">
          <pre className="mt-2 text-[10px] text-slate-400 bg-black/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(payload, null, 2)}
          </pre>
          {approval.reason_message && (
            <p className="text-[10px] text-amber-400/70">{approval.reason_message}</p>
          )}
          {approval.recommended_next_action && (
            <p className="text-[10px] text-slate-500">{approval.recommended_next_action}</p>
          )}
        </div>
      )}
    </div>
  );
}
