import { CalendarDays, Check, X, User, Clock } from 'lucide-react';
import { cn } from '../../../../../lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LeaveRequest {
  id?: string;
  requestId?: string;
  employeeName?: string;
  leaveType?: string;
  from?: string;
  to?: string;
  days?: number;
  reason?: string;
  status?: string;
  appliedDate?: string;
}

interface LeaveRequestsProps {
  requests: LeaveRequest[];
  loading: boolean;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<string, string> = {
  pending:  'text-amber-400 bg-amber-500/10 border-amber-500/20',
  approved: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  rejected: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LeaveRequests({ requests, loading, onApprove, onReject }: LeaveRequestsProps) {
  if (loading) {
    return (
      <div className="animate-pulse space-y-1 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 bg-white/[0.03] rounded-lg" />
        ))}
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="text-center py-16">
        <CalendarDays className="w-8 h-8 text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-500">No leave requests found</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full divide-y divide-white/[0.04]">
      {requests.map((r) => {
        const rId = r.id || r.requestId || '';
        const status = (r.status || 'pending').toLowerCase();
        const isPending = status === 'pending';

        return (
          <div key={rId} className="px-5 py-3 hover:bg-white/[0.02] transition-colors">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-500/30 to-yellow-500/30 flex items-center justify-center text-red-300 text-xs font-semibold shrink-0 mt-0.5">
                {(r.employeeName?.[0] || '?').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-semibold text-slate-200">
                    {r.employeeName || 'Unknown Employee'}
                  </span>
                  <span className={cn(
                    'px-1.5 py-0.5 rounded text-[9px] font-medium border capitalize',
                    STATUS_COLORS[status] || STATUS_COLORS.pending,
                  )}>
                    {status}
                  </span>
                  {r.leaveType && (
                    <span className="text-[9px] text-slate-500 uppercase">{r.leaveType}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-500">
                  {r.from && <span>{r.from}{r.to ? ` → ${r.to}` : ''}</span>}
                  {r.days && <span>{r.days} day{r.days > 1 ? 's' : ''}</span>}
                  {r.reason && <span className="truncate max-w-[200px]">{r.reason}</span>}
                </div>
              </div>

              {isPending && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onApprove(rId)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 text-[10px] font-medium hover:bg-emerald-500/30 transition-colors"
                  >
                    <Check className="w-3 h-3" /> Approve
                  </button>
                  <button
                    onClick={() => onReject(rId)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/20 text-rose-300 text-[10px] font-medium hover:bg-rose-500/30 transition-colors"
                  >
                    <X className="w-3 h-3" /> Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
