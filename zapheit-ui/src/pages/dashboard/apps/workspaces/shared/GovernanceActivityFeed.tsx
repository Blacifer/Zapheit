import { useState } from 'react';
import {
  Bot, User, Clock, ChevronDown, CheckCircle2, XCircle, AlertCircle,
  Loader2, Mail, Calendar, HardDrive, MessageSquare, List, Share2,
  FileText, Send,
} from 'lucide-react';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GovernanceActivityFeedProps {
  actions: any[];
  loading?: boolean;
  maxItems?: number;
  emptyMessage?: string;
  onApprovalResolved?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Human-readable summary                                             */
/* ------------------------------------------------------------------ */

function actionSummary(action: string, params: any, connector: string): { text: string; Icon: typeof Mail } {
  const p = params ?? {};
  switch (action) {
    case 'send_email':
      return { text: `Sent email to ${p.to ?? '?'}${p.subject ? ` — "${p.subject}"` : ''}`, Icon: Send };
    case 'list_emails':
      return { text: 'Listed inbox emails', Icon: Mail };
    case 'list_files':
      return { text: 'Listed Google Drive files', Icon: HardDrive };
    case 'share_file':
      return { text: `Shared file with ${p.email ?? '?'} as ${p.role ?? 'reader'}`, Icon: Share2 };
    case 'create_document':
      return { text: `Created document "${p.title ?? 'Untitled'}"`, Icon: FileText };
    case 'list_events':
    case 'list_calendar_events':
      return { text: 'Listed calendar events', Icon: Calendar };
    case 'create_event':
      return { text: `Created event "${p.summary ?? 'Untitled'}"`, Icon: Calendar };
    case 'send_message':
    case 'post_message':
      return { text: `Sent message to #${p.channel ?? '?'}`, Icon: Send };
    case 'list_channels':
      return { text: 'Listed Slack channels', Icon: List };
    case 'get_channel_history':
      return { text: `Read messages in #${p.channel ?? '?'}`, Icon: MessageSquare };
    default:
      return { text: action.replace(/_/g, ' '), Icon: connector.includes('slack') ? MessageSquare : FileText };
  }
}

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Single row                                                         */
/* ------------------------------------------------------------------ */

function ActionRow({ row, onApprovalResolved }: { row: any; onApprovalResolved?: () => void }) {
  const [showDetails, setShowDetails] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState<'approve' | 'deny' | null>(null);

  const gov = row.governance ?? {};
  const source = gov.source ?? 'connector_console';
  const decision = gov.decision ?? (row.success ? 'executed' : 'allow');
  const isPending = decision === 'pending_approval' || decision === 'require_approval';
  const isBlocked = decision === 'blocked' || decision === 'block';
  const approvalId = row.approval_id ?? gov.approval_id;

  const actorName = gov.requested_by ?? row.requested_by
    ?? (source === 'runtime' ? 'AI Agent'
      : source === 'gateway' ? 'Gateway'
      : 'You');

  const isAgent = source === 'runtime' || source === 'gateway';
  const { text, Icon } = actionSummary(row.action, row.params, row.connector_id ?? '');

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!approvalId) return;
    setApprovalLoading('approve');
    try {
      const res = await api.approvals.approve(approvalId);
      if (res.success) { toast.success('Approved'); onApprovalResolved?.(); }
      else toast.error((res as any).error || 'Failed');
    } catch { toast.error('Network error'); }
    finally { setApprovalLoading(null); }
  };

  const handleDeny = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!approvalId) return;
    setApprovalLoading('deny');
    try {
      const res = await api.approvals.deny(approvalId);
      if (res.success) { toast.success('Denied'); onApprovalResolved?.(); }
      else toast.error((res as any).error || 'Failed');
    } catch { toast.error('Network error'); }
    finally { setApprovalLoading(null); }
  };

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${
      isPending ? 'border-amber-500/25 bg-amber-500/[0.04]'
        : isBlocked ? 'border-rose-500/20 bg-rose-500/[0.03]'
        : 'border-white/[0.06] bg-white/[0.01]'
    }`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Action icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          isAgent ? 'bg-violet-500/15 text-violet-400' : 'bg-cyan-500/10 text-cyan-400'
        }`}>
          <Icon className="w-4 h-4" />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-200 leading-snug truncate">{text}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {isAgent
              ? <span className="flex items-center gap-1 text-[11px] text-violet-400"><Bot className="w-3 h-3" />{actorName}</span>
              : <span className="flex items-center gap-1 text-[11px] text-cyan-400"><User className="w-3 h-3" />{actorName}</span>
            }
            <span className="text-slate-600">·</span>
            <span className="flex items-center gap-0.5 text-[11px] text-slate-500">
              <Clock className="w-3 h-3" />{formatRelative(row.created_at)}
            </span>
          </div>
        </div>

        {/* Status + actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isPending && approvalId ? (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={handleApprove}
                disabled={!!approvalLoading}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
              >
                {approvalLoading === 'approve' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                Approve
              </button>
              <button
                onClick={handleDeny}
                disabled={!!approvalLoading}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-400 text-xs font-medium hover:bg-rose-500/25 transition-colors disabled:opacity-40"
              >
                {approvalLoading === 'deny' ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                Deny
              </button>
            </div>
          ) : isPending ? (
            <span className="text-[11px] text-amber-400 font-medium px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">Pending approval</span>
          ) : isBlocked ? (
            <span className="flex items-center gap-1 text-[11px] text-rose-400 font-medium"><AlertCircle className="w-3.5 h-3.5" />Blocked</span>
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-500/60" />
          )}

          <button
            onClick={() => setShowDetails((v) => !v)}
            className="p-1 rounded-md hover:bg-white/[0.05] text-slate-600 hover:text-slate-400 transition-colors"
            title="Details"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Expandable technical details — out of the way */}
      {showDetails && (
        <div className="border-t border-white/[0.05] px-4 py-3 space-y-2 bg-black/10">
          {row.error_message && (
            <p className="text-xs text-rose-400">{row.error_message}</p>
          )}
          {gov.block_reasons?.map((r: string, i: number) => (
            <p key={i} className="text-xs text-rose-400">Blocked: {r}</p>
          ))}
          {gov.approval_reasons?.map((r: string, i: number) => (
            <p key={i} className="text-xs text-amber-400">Needs approval: {r}</p>
          ))}
          {row.params && Object.keys(row.params).length > 0 && (
            <details className="text-[11px] text-slate-500">
              <summary className="cursor-pointer hover:text-slate-400 select-none">Technical details</summary>
              <pre className="mt-2 text-slate-400 bg-black/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(row.params, null, 2)}
              </pre>
            </details>
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
          <div key={i} className="h-14 bg-white/[0.03] rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (actions.length === 0) {
    return <div className="text-center text-zinc-500 py-10 text-sm">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-2">
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
