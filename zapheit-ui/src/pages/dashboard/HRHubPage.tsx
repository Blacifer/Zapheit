import { useCallback, useEffect, useState } from 'react';
import {
  Users, Calendar, ClipboardList, DollarSign,
  RefreshCw, X, Check, Database,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import { authenticatedFetch } from '../../lib/api/_helpers';
import { HubLiveMetrics } from './hubs/HubLiveMetrics';
import type { IntegrationConfig } from './hubs/HubLiveMetrics';

type TabId = 'attendance' | 'leave' | 'payroll' | 'headcount';

const HR_INTEGRATIONS: IntegrationConfig[] = [
  {
    connectorId: 'zoho-people',
    appName: 'Zoho People',
    icon: <Users className="w-3.5 h-3.5 text-red-400" />,
    workspacePath: '/dashboard/apps/zoho/workspace',
    brandBg: 'bg-red-500/20',
    metrics: [
      { label: 'Employees', action: 'list_employees', params: { limit: 1 }, transform: d => Array.isArray(d) ? d.length : (d?.total ?? '—') },
      { label: 'Pending Leave', action: 'list_leave_requests', params: { status: 'pending' }, transform: d => Array.isArray(d) ? d.length : 0 },
    ],
  },
  {
    connectorId: 'notion',
    appName: 'Notion',
    icon: <Database className="w-3.5 h-3.5 text-slate-300" />,
    workspacePath: '/dashboard/apps/notion/workspace',
    brandBg: 'bg-slate-700/60',
    metrics: [
      { label: 'HR Pages', action: 'search', params: { query: 'HR' }, transform: d => Array.isArray(d) ? d.length : 0 },
      { label: 'Databases', action: 'list_databases', transform: d => Array.isArray(d) ? d.length : 0 },
    ],
  },
];

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }

function riskBg(s: number | null | undefined) {
  if (s == null) return 'bg-slate-800/50 border-slate-700/40';
  if (s >= 70) return 'bg-rose-500/15 border-rose-500/30';
  if (s >= 40) return 'bg-amber-500/15 border-amber-500/30';
  return 'bg-emerald-500/15 border-emerald-500/30';
}
function riskColor(s: number | null | undefined) {
  if (s == null) return 'text-slate-500';
  if (s >= 70) return 'text-rose-400';
  if (s >= 40) return 'text-amber-400';
  return 'text-emerald-400';
}

const ATTENDANCE_STATUS_COLORS: Record<string, string> = {
  present: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  absent: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
  wfh: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  'half-day': 'bg-amber-500/15 text-amber-300 border-amber-500/25',
};

const LEAVE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
};

const PAYROLL_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
  processing: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  paid: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
};

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

async function listAttendance(): Promise<AttendanceRecord[]> {
  try {
    const res: any = await authenticatedFetch('/hubs/hr/attendance?limit=200');
    if (res.success && res.data) return res.data;
  } catch { /* no endpoint yet */ }
  return [];
}

async function listLeave(): Promise<LeaveRequest[]> {
  try {
    const res: any = await authenticatedFetch('/hubs/hr/leave?limit=200');
    if (res.success && res.data) return res.data;
  } catch { /* no endpoint yet */ }
  return [];
}

async function listPayroll(): Promise<PayRun[]> {
  try {
    const res: any = await authenticatedFetch('/hubs/hr/payroll?limit=200');
    if (res.success && res.data) return res.data;
  } catch { /* no endpoint yet */ }
  return [];
}

async function listHeadcount(): Promise<HeadcountStat[]> {
  try {
    const res: any = await authenticatedFetch('/hubs/hr/headcount');
    if (res.success && res.data) return res.data;
  } catch { /* no endpoint yet */ }
  return [];
}

function formatAmount(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function HRHubPage() {
  const [tab, setTab] = useState<TabId>('attendance');
  const [busy, setBusy] = useState(false);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [payroll, setPayroll] = useState<PayRun[]>([]);
  const [headcount, setHeadcount] = useState<HeadcountStat[]>([]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [a, l, p, h] = await Promise.all([listAttendance(), listLeave(), listPayroll(), listHeadcount()]);
      setAttendance(a);
      setLeave(l);
      setPayroll(p);
      setHeadcount(h);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSeedDemo = async () => {
    setBusy(true);
    try {
      const res: any = await authenticatedFetch('/hubs/demo/generate', { method: 'POST', body: JSON.stringify({ hub: 'hr' }) });
      if (res.success) { toast.success('Sample records loaded - not production evidence'); void load(); }
      else toast.error(res.error || 'Failed to load sample data');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const handleLeaveAction = async (id: string, action: 'approved' | 'rejected') => {
    setBusy(true);
    try {
      const res: any = await authenticatedFetch(`/hubs/hr/leave/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: action }),
      });
      if (res.success) { toast.success(`Leave ${action}`); void load(); }
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'attendance', label: 'Attendance', icon: Calendar },
    { id: 'leave', label: 'Leave', icon: ClipboardList },
    { id: 'payroll', label: 'Payroll', icon: DollarSign },
    { id: 'headcount', label: 'Headcount', icon: Users },
  ];

  const pendingLeave = leave.filter(l => l.status === 'pending').length;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* Header */}
      <div className="flex-none px-6 pt-6 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <Users className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-100">HR Hub</h1>
              <p className="text-xs text-slate-500 mt-0.5">Attendance, leave, payroll, and headcount analytics</p>
            </div>
          </div>
          <button
            onClick={() => void load()}
            disabled={busy}
            className="h-8 px-3 flex items-center gap-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 text-xs transition-colors"
          >
            <RefreshCw className={cx('w-3.5 h-3.5', busy && 'animate-spin')} />
            Refresh
          </button>
        </div>

        <div className="mt-4">
          <HubLiveMetrics configs={HR_INTEGRATIONS} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium transition-colors',
                tab === t.id
                  ? 'bg-white/[0.08] text-slate-100'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
              {t.id === 'leave' && pendingLeave > 0 && (
                <span className="ml-0.5 text-[10px] px-1.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/25">{pendingLeave}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* Attendance Tab */}
        {tab === 'attendance' && (
          attendance.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center mb-4">
                <Calendar className="w-6 h-6 text-cyan-400" />
              </div>
              <p className="text-slate-300 font-medium">No attendance records</p>
              <p className="text-slate-500 text-sm mt-1 max-w-xs">Connect an HR app like Keka or Darwinbox to sync attendance data here.</p>
              <p className="text-amber-300/80 text-xs mt-3 max-w-xs">
                Sample records are for layout inspection only and are not audit or paid-pilot evidence.
              </p>
              <button
                onClick={handleSeedDemo}
                disabled={busy}
                className="mt-4 h-9 px-4 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 text-sm transition-colors flex items-center gap-1.5"
              >
                <Database className="w-3.5 h-3.5" />
                Load sample records
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Employee</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Absence Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {attendance.map(a => (
                    <tr key={a.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-slate-200 font-medium">{a.employee_name}</p>
                        <p className="text-slate-500 text-xs">{a.employee_email}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs tabular-nums">{a.date}</td>
                      <td className="px-4 py-3">
                        <span className={cx('px-2 py-0.5 rounded-full text-xs border capitalize', ATTENDANCE_STATUS_COLORS[a.status] || 'bg-slate-700/30 text-slate-400 border-slate-600/30')}>
                          {a.status.replace('-', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {a.absence_risk != null ? (
                          <span className={cx('inline-block px-2 py-0.5 rounded-full text-xs border tabular-nums font-mono', riskBg(a.absence_risk), riskColor(a.absence_risk))}>
                            {a.absence_risk}
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Leave Tab */}
        {tab === 'leave' && (
          leave.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
                <ClipboardList className="w-6 h-6 text-amber-400" />
              </div>
              <p className="text-slate-300 font-medium">No leave requests</p>
              <p className="text-slate-500 text-sm mt-1 max-w-xs">Leave requests submitted through connected HR apps will appear here for approval.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Employee</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Dates</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {leave.map(l => (
                    <tr key={l.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-slate-200 font-medium">{l.employee_name}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs capitalize">{l.leave_type}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs tabular-nums">{l.start_date} → {l.end_date}</td>
                      <td className="px-4 py-3">
                        <span className={cx('px-2 py-0.5 rounded-full text-xs border capitalize', LEAVE_STATUS_COLORS[l.status] || 'bg-slate-700/30 text-slate-400 border-slate-600/30')}>
                          {l.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {l.status === 'pending' && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleLeaveAction(l.id, 'approved')}
                              disabled={busy}
                              className="h-7 px-2 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs border border-emerald-500/25 transition-colors flex items-center gap-1"
                            >
                              <Check className="w-3 h-3" />
                              Approve
                            </button>
                            <button
                              onClick={() => handleLeaveAction(l.id, 'rejected')}
                              disabled={busy}
                              className="h-7 px-2 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs border border-rose-500/20 transition-colors flex items-center gap-1"
                            >
                              <X className="w-3 h-3" />
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Payroll Tab */}
        {tab === 'payroll' && (
          payroll.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                <DollarSign className="w-6 h-6 text-green-400" />
              </div>
              <p className="text-slate-300 font-medium">No pay runs yet</p>
              <p className="text-slate-500 text-sm mt-1 max-w-xs">Connect a payroll app like Keka or GreytHR to view pay run history here.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Month</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Headcount</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Total Gross</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Total Net</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {payroll.map(p => (
                    <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-slate-200 font-medium">{p.month}</td>
                      <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{p.headcount}</td>
                      <td className="px-4 py-3 text-right text-slate-300 tabular-nums font-mono text-xs">{formatAmount(p.total_gross)}</td>
                      <td className="px-4 py-3 text-right text-slate-300 tabular-nums font-mono text-xs">{formatAmount(p.total_net)}</td>
                      <td className="px-4 py-3">
                        <span className={cx('px-2 py-0.5 rounded-full text-xs border capitalize', PAYROLL_STATUS_COLORS[p.status] || 'bg-slate-700/30 text-slate-400 border-slate-600/30')}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Headcount Tab */}
        {tab === 'headcount' && (
          headcount.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-indigo-400" />
              </div>
              <p className="text-slate-300 font-medium">No headcount data</p>
              <p className="text-slate-500 text-sm mt-1 max-w-xs">Department breakdowns and attrition risk will show here once an HR system is connected.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Department</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Total</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Joiners</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Exits</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Attrition Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {headcount.map(h => (
                    <tr key={h.department} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-slate-200 font-medium">{h.department}</td>
                      <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{h.total}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={h.joiners_this_month > 0 ? 'text-emerald-400 tabular-nums' : 'text-slate-500 tabular-nums'}>
                          +{h.joiners_this_month}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={h.exits_this_month > 0 ? 'text-rose-400 tabular-nums' : 'text-slate-500 tabular-nums'}>
                          -{h.exits_this_month}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {h.attrition_risk != null ? (
                          <span className={cx('inline-block px-2 py-0.5 rounded-full text-xs border tabular-nums font-mono', riskBg(h.attrition_risk), riskColor(h.attrition_risk))}>
                            {h.attrition_risk}
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
