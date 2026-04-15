import { useState } from 'react';
import {
  Bot, User, Clock, ChevronDown, ChevronRight,
  CheckCircle, XCircle, Loader2, ShieldAlert, ShieldCheck, ShieldOff,
} from 'lucide-react';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GovernanceActivityFeedProps {
  /** Raw governed-action rows from listGovernedActions / getGovernedActions */
  actions: any[];
  loading?: boolean;
  maxItems?: number;
  emptyMessage?: string;
  /** Called after approve/deny so parent can re-fetch */
  onApprovalResolved?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function decisionBadge(decision: string | undefined) {
  switch (decision) {
    case 'executed':
    case 'allow':
      return <span className="flex items-center gap-0.5 text-emerald-400 text-[10px] font-medium">
        <ShieldCheck className="w-3 h-3" /> Executed
      </span>;
    case 'pending_approval':
    case 'require_approval':
      return <span className="flex items-center gap-0.5 text-amber-400 text-[10px] font-medium">
        <ShieldAlert className="w-3 h-3" /> Pending
      </span>;
    case 'blocked':
    case 'block':
      return <span className="flex items-center gap-0.5 text-rose-400 text-[10px] font-medium">
        <ShieldOff className="w-3 h-3" /> Blocked
      </span>;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Row                                                                */
/* ------------------------------------------------------------------ */

function ActionRow({
  row,
  onApprovalResolved,
}: {
  row: any;
  onApprovalResolved?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState<'approve' | 'deny' | null>(null);

  const gov = row.governance ?? {};
  const source = gov.source ?? 'connector_console';
  const decision = gov.decision ?? (row.success ? 'executed' : 'allow');
  const isPending = decision === 'pending_approval' || decision === 'require_approval';
  const approvalId = row.approval_id ?? gov.approval_id;

  const actorName = gov.requested_by ?? row.requested_by
    ?? (source === 'runtime' ? 'AI Agent'
      : source === 'gateway' ? 'Gateway'
      : source ?? 'System');

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!approvalId) return;
    setApprovalLoading('approve');
    try {
      const res = await api.approvals.approve(approvalId);
      if (res.success) {
        toast.success('Action approved');
        onApprovalResolved?.();
      } else {
        toast.error((res as any).error || 'Approval failed');
      }
    } catch { toast.error('Network error'); }
    finally { setApprovalLoading(null); }
  };

  const handleDeny = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!approvalId) return;
    setApprovalLoading('deny');
    try {
      const res = await api.approvals.deny(approvalId);
      if (res.success) {
        toast.success('Action denied');
        onApprovalResolved?.();
      } else {
        toast.error((res as any).error || 'Deny failed');
      }
    } catch { toast.error('Network error'); }
    finally { setApprovalLoading(null); }
  };

  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.01] overflow-hidden">
      {/* Row header */}
      <div
        className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-slate-600 shrink-0 mt-0.5">
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5" />
            : <ChevronRight className="w-3.5 h-3.5" />}
        </span>

        <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
          source === 'runtime' ? 'bg-violet-500/15 text-violet-400'
            : source === 'gateway' ? 'bg-cyan-500/15 text-cyan-400'
            : 'bg-slate-700/50 text-slate-400'
        }`}>
          {source === 'runtime' ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-200 leading-snug">
            <span className="font-medium">{actorName}</span>
            {' '}<span className="text-slate-400">{row.action?.replace(/_/g, ' ')}</span>
            {row.connector_id && <span className="text-slate-500"> → {row.connector_id}</span>}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {decisionBadge(decision)}
            {row.duration_ms != null && (
              <span className="text-[10px] text-slate-600">{row.duration_ms}ms</span>
            )}
            {row.error_message && (
              <span className="text-[10px] text-rose-400 truncate">{row.error_message}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isPending && approvalId && (
            <div className="flex items-center gap-1 mr-1" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={handleApprove}
                disabled={!!approvalLoading}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
              >
                {approvalLoading === 'approve' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <CheckCircle className="w-2.5 h-2.5" />}
                Approve
              </button>
              <button
                onClick={handleDeny}
                disabled={!!approvalLoading}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 text-[10px] font-medium hover:bg-rose-500/25 transition-colors disabled:opacity-40"
              >
                {approvalLoading === 'deny' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <XCircle className="w-2.5 h-2.5" />}
                Deny
              </button>
            </div>
          )}
          <span className="flex items-center gap-1 text-[10px] text-slate-600">
            <Clock className="w-3 h-3" />
            {formatRelative(row.created_at)}
          </span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-white/[0.05] px-3 py-3 space-y-3">
          {/* Params */}
          {row.params && Object.keys(row.params).length > 0 && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Payload</p>
              <pre className="text-[10px] text-slate-400 bg-black/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(row.params, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {row.result && Object.keys(row.result).length > 0 && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Result</p>
              <pre className="text-[10px] text-slate-400 bg-black/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(row.result, null, 2)}
              </pre>
            </div>
          )}

          {/* Policy */}
          {(gov.policy_id || gov.required_role || gov.block_reasons?.length > 0 || gov.approval_reasons?.length > 0) && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Governance</p>
              <div className="space-y-0.5 text-[10px] text-slate-400">
                {gov.policy_id && <p>Policy: <span className="text-slate-300 font-mono">{gov.policy_id}</span></p>}
                {gov.required_role && <p>Required role: <span className="text-slate-300">{gov.required_role}</span></p>}
                {gov.block_reasons?.map((r: string, i: number) => (
                  <p key={i} className="text-rose-400">Block reason: {r}</p>
                ))}
                {gov.approval_reasons?.map((r: string, i: number) => (
                  <p key={i} className="text-amber-400">Approval reason: {r}</p>
                ))}
              </div>
            </div>
          )}

          {/* Agent attribution */}
          {(gov.agent_id ?? row.agent_id) && (
            <p className="text-[10px] text-violet-400/80 flex items-center gap-1">
              <Bot className="w-3 h-3" />
              Agent ID: {gov.agent_id ?? row.agent_id}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Feed                                                               */
/* ------------------------------------------------------------------ */

export function GovernanceActivityFeed({
  actions,
  loading,
  maxItems = 50,
  emptyMessage = 'No activity yet',
  onApprovalResolved,
}: GovernanceActivityFeedProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 bg-white/[0.03] rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (actions.length === 0) {
    return <div className="text-center text-zinc-500 py-8 text-sm">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-1.5">
      {actions.slice(0, maxItems).map((row) => (
        <ActionRow
          key={row.id ?? String(Math.random())}
          row={row}
          onApprovalResolved={onApprovalResolved}
        />
      ))}
    </div>
  );
}
