import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ClipboardList, DollarSign, RefreshCw, Users, Check, X } from 'lucide-react';
import { authenticatedFetch } from '../../../../lib/api/_helpers';
import { toast } from '../../../../lib/toast';
import type { UnifiedApp } from '../types';

type HrWorkspaceSection = 'attendance' | 'leave' | 'payroll' | 'headcount';

interface AttendanceRecord {
  id: string;
  employee_name: string;
  employee_email: string;
  date: string;
  status: 'present' | 'absent' | 'wfh' | 'half-day';
  absence_risk: number | null;
}

interface LeaveRequest {
  id: string;
  employee_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
}

interface PayRun {
  id: string;
  month: string;
  total_gross: number;
  total_net: number;
  headcount: number;
  status: 'draft' | 'processing' | 'paid';
}

interface HeadcountStat {
  department: string;
  total: number;
  joiners_this_month: number;
  exits_this_month: number;
  attrition_risk: number | null;
}

function cx(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(' ');
}

function statusTone(status: string) {
  const map: Record<string, string> = {
    present: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    paid: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    absent: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
    rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    processing: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    wfh: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
    draft: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
    'half-day': 'bg-violet-500/15 text-violet-300 border-violet-500/25',
  };
  return map[status] || 'bg-slate-700/30 text-slate-300 border-slate-600/30';
}

function riskColor(score: number | null | undefined) {
  if (score == null) return 'text-slate-500';
  if (score >= 70) return 'text-rose-400';
  if (score >= 40) return 'text-amber-400';
  return 'text-emerald-400';
}

function formatAmount(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

async function fetchList<T>(endpoint: string): Promise<T[]> {
  const res: any = await authenticatedFetch(endpoint);
  if (res.success && res.data) return res.data as T[];
  return [];
}

interface HrWorkspaceTabProps {
  app: UnifiedApp;
  agentNames: string[];
}

export function HrWorkspaceTab({ app, agentNames }: HrWorkspaceTabProps) {
  const [section, setSection] = useState<HrWorkspaceSection>('leave');
  const [busy, setBusy] = useState(false);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [payroll, setPayroll] = useState<PayRun[]>([]);
  const [headcount, setHeadcount] = useState<HeadcountStat[]>([]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [attendanceData, leaveData, payrollData, headcountData] = await Promise.all([
        fetchList<AttendanceRecord>('/hubs/hr/attendance?limit=50'),
        fetchList<LeaveRequest>('/hubs/hr/leave?limit=50'),
        fetchList<PayRun>('/hubs/hr/payroll?limit=20'),
        fetchList<HeadcountStat>('/hubs/hr/headcount'),
      ]);
      setAttendance(attendanceData);
      setLeave(leaveData);
      setPayroll(payrollData);
      setHeadcount(headcountData);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingLeave = useMemo(() => leave.filter((row) => row.status === 'pending').length, [leave]);
  const employeesPresent = useMemo(() => attendance.filter((row) => row.status === 'present' || row.status === 'wfh').length, [attendance]);
  const atRiskDepartments = useMemo(() => headcount.filter((row) => (row.attrition_risk ?? 0) >= 40).length, [headcount]);

  const handleLeaveAction = async (id: string, status: 'approved' | 'rejected') => {
    setBusy(true);
    try {
      const res: any = await authenticatedFetch(`/hubs/hr/leave/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      if (res.success) {
        toast.success(`Leave ${status}`);
        await load();
      } else {
        toast.error(res.error || 'Failed to update leave');
      }
    } finally {
      setBusy(false);
    }
  };

  const sections: Array<{ id: HrWorkspaceSection; label: string; Icon: typeof Users }> = [
    { id: 'leave', label: 'Leave', Icon: ClipboardList },
    { id: 'attendance', label: 'Attendance', Icon: Calendar },
    { id: 'payroll', label: 'Payroll', Icon: DollarSign },
    { id: 'headcount', label: 'Headcount', Icon: Users },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">HR workspace</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{app.name} operations inside Zapheit</h3>
            <p className="mt-1 text-sm text-slate-400">
              Review employee operations, act on leave requests, and keep linked agents working from one governed workspace.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-60"
          >
            <RefreshCw className={cx('h-3.5 w-3.5', busy && 'animate-spin')} />
            Refresh
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Pending leave</p>
            <p className="mt-2 text-2xl font-semibold text-white">{pendingLeave}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Present today</p>
            <p className="mt-2 text-2xl font-semibold text-white">{employeesPresent}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Linked agents</p>
            <p className="mt-2 text-2xl font-semibold text-white">{agentNames.length}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Needs review</p>
            <p className="mt-2 text-2xl font-semibold text-white">{atRiskDepartments}</p>
          </div>
        </div>
        {agentNames.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Linked agents: <span className="text-slate-300">{agentNames.join(', ')}</span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {sections.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={cx(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
              section === id
                ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200'
                : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {id === 'leave' && pendingLeave > 0 ? (
              <span className="rounded-full border border-amber-500/25 bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                {pendingLeave}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {section === 'leave' && (
        <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
          <div className="border-b border-white/8 px-4 py-3">
            <h4 className="text-sm font-semibold text-white">Leave inbox</h4>
            <p className="mt-1 text-xs text-slate-500">Approve or reject time-sensitive HR actions without leaving Zapheit.</p>
          </div>
          <div className="divide-y divide-white/6">
            {leave.length === 0 ? (
              <div className="px-4 py-10 text-sm text-slate-500">No leave requests available for this workspace yet.</div>
            ) : leave.map((row) => (
              <div key={row.id} className="flex items-start justify-between gap-4 px-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-white">{row.employee_name}</p>
                    <span className={cx('rounded-full border px-2 py-0.5 text-[11px] capitalize', statusTone(row.status))}>
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    {row.leave_type} • {row.start_date} to {row.end_date}
                  </p>
                  {row.reason ? <p className="mt-1 text-xs text-slate-500">{row.reason}</p> : null}
                </div>
                {row.status === 'pending' ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => void handleLeaveAction(row.id, 'approved')}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-200"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button
                      onClick={() => void handleLeaveAction(row.id, 'rejected')}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-200"
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {section === 'attendance' && (
        <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
          <div className="border-b border-white/8 px-4 py-3">
            <h4 className="text-sm font-semibold text-white">Attendance queue</h4>
            <p className="mt-1 text-xs text-slate-500">Recent attendance signals and absence-risk indicators for HR review.</p>
          </div>
          <div className="divide-y divide-white/6">
            {attendance.length === 0 ? (
              <div className="px-4 py-10 text-sm text-slate-500">No attendance data available yet.</div>
            ) : attendance.slice(0, 12).map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-4 px-4 py-4">
                <div>
                  <p className="font-medium text-white">{row.employee_name}</p>
                  <p className="mt-1 text-xs text-slate-500">{row.employee_email} • {row.date}</p>
                </div>
                <div className="text-right">
                  <span className={cx('rounded-full border px-2 py-0.5 text-[11px] capitalize', statusTone(row.status))}>
                    {row.status}
                  </span>
                  <p className={cx('mt-2 text-xs font-medium', riskColor(row.absence_risk))}>
                    {row.absence_risk == null ? 'No risk signal' : `${row.absence_risk}% absence risk`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {section === 'payroll' && (
        <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
          <div className="border-b border-white/8 px-4 py-3">
            <h4 className="text-sm font-semibold text-white">Payroll runs</h4>
            <p className="mt-1 text-xs text-slate-500">Recent payroll cycles and payment readiness in one place.</p>
          </div>
          <div className="divide-y divide-white/6">
            {payroll.length === 0 ? (
              <div className="px-4 py-10 text-sm text-slate-500">No payroll runs available yet.</div>
            ) : payroll.map((row) => (
              <div key={row.id} className="grid grid-cols-4 gap-4 px-4 py-4 text-sm">
                <div>
                  <p className="font-medium text-white">{row.month}</p>
                  <p className="mt-1 text-xs text-slate-500">{row.headcount} employees</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Gross</p>
                  <p className="mt-1 font-medium text-slate-200">{formatAmount(row.total_gross)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Net</p>
                  <p className="mt-1 font-medium text-slate-200">{formatAmount(row.total_net)}</p>
                </div>
                <div className="text-right">
                  <span className={cx('rounded-full border px-2 py-0.5 text-[11px] capitalize', statusTone(row.status))}>
                    {row.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {section === 'headcount' && (
        <div className="grid gap-3 md:grid-cols-2">
          {headcount.length === 0 ? (
            <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-10 text-sm text-slate-500">
              No headcount data available yet.
            </div>
          ) : headcount.map((row) => (
            <div key={row.department} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-white">{row.department}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {row.joiners_this_month} joiners • {row.exits_this_month} exits this month
                  </p>
                </div>
                <p className="text-lg font-semibold text-white">{row.total}</p>
              </div>
              <p className={cx('mt-4 text-sm font-medium', riskColor(row.attrition_risk))}>
                {row.attrition_risk == null ? 'No attrition signal available' : `${row.attrition_risk}% attrition risk`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
