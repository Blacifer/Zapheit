import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, CalendarDays, IndianRupee, Activity,
  RefreshCw, Loader2, CheckCircle2, XCircle, Clock,
  ExternalLink, Search, AlertCircle, TrendingUp,
} from 'lucide-react';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import { ProductionTruthBanner } from '../shared';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';

/* ─────────────────────────────────────────────────────────────────────────
   Types
──────────────────────────────────────────────────────────────────────────── */

interface Employee {
  id: string;
  name: string;
  role: string;
  department: string;
  status: 'active' | 'inactive' | 'on_leave';
  joinDate: string;
  email: string;
}

interface LeaveRequest {
  id: string;
  employee: string;
  department: string;
  type: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  appliedOn: string;
}

interface PayrollSummary {
  month: string;
  headcount: number;
  totalGross: number;
  totalNet: number;
  totalDeductions: number;
  status: 'pending' | 'processed' | 'disbursed';
  pendingCount: number;
}

interface AuditEntry {
  id: string;
  action: string;
  user: string;
  target: string;
  timestamp: string;
  via: 'agent' | 'manual';
}

/* ─────────────────────────────────────────────────────────────────────────
   Sample data — used when greytHR adapter returns no data
──────────────────────────────────────────────────────────────────────────── */

const MOCK_EMPLOYEES: Employee[] = [
  { id: '1', name: 'Priya Sharma',   role: 'Senior Engineer',      department: 'Engineering', status: 'active',   joinDate: '2022-03-15', email: 'priya.sharma@acme.in' },
  { id: '2', name: 'Rohit Mehta',    role: 'Product Manager',       department: 'Product',     status: 'active',   joinDate: '2021-07-01', email: 'rohit.mehta@acme.in' },
  { id: '3', name: 'Aishwarya Nair', role: 'HR Business Partner',   department: 'HR',          status: 'active',   joinDate: '2020-11-20', email: 'aishwarya.nair@acme.in' },
  { id: '4', name: 'Kiran Patel',    role: 'Finance Analyst',       department: 'Finance',     status: 'active',   joinDate: '2023-01-10', email: 'kiran.patel@acme.in' },
  { id: '5', name: 'Sneha Joshi',    role: 'QA Lead',               department: 'Engineering', status: 'on_leave', joinDate: '2021-04-05', email: 'sneha.joshi@acme.in' },
  { id: '6', name: 'Arjun Reddy',    role: 'Sales Executive',       department: 'Sales',       status: 'active',   joinDate: '2022-09-12', email: 'arjun.reddy@acme.in' },
  { id: '7', name: 'Divya Krishnan', role: 'UX Designer',           department: 'Design',      status: 'active',   joinDate: '2023-03-01', email: 'divya.krishnan@acme.in' },
  { id: '8', name: 'Manish Gupta',   role: 'DevOps Engineer',       department: 'Engineering', status: 'inactive', joinDate: '2019-06-14', email: 'manish.gupta@acme.in' },
];

const MOCK_LEAVES: LeaveRequest[] = [
  { id: 'L001', employee: 'Sneha Joshi',    department: 'Engineering', type: 'Sick Leave',    fromDate: '2026-04-28', toDate: '2026-04-30', days: 3, reason: 'Fever and fatigue',         status: 'pending', appliedOn: '2026-04-25' },
  { id: 'L002', employee: 'Arjun Reddy',    department: 'Sales',       type: 'Casual Leave',  fromDate: '2026-05-02', toDate: '2026-05-02', days: 1, reason: 'Personal work',              status: 'pending', appliedOn: '2026-04-24' },
  { id: 'L003', employee: 'Divya Krishnan', department: 'Design',      type: 'Annual Leave',  fromDate: '2026-05-05', toDate: '2026-05-09', days: 5, reason: 'Family vacation',            status: 'pending', appliedOn: '2026-04-23' },
  { id: 'L004', employee: 'Kiran Patel',    department: 'Finance',     type: 'Sick Leave',    fromDate: '2026-04-22', toDate: '2026-04-23', days: 2, reason: 'Medical appointment',        status: 'approved', appliedOn: '2026-04-21' },
  { id: 'L005', employee: 'Rohit Mehta',    department: 'Product',     type: 'Casual Leave',  fromDate: '2026-04-18', toDate: '2026-04-18', days: 1, reason: 'Personal work',              status: 'approved', appliedOn: '2026-04-17' },
];

const MOCK_PAYROLL: PayrollSummary = {
  month: 'April 2026',
  headcount: 48,
  totalGross: 4280000,
  totalNet: 3612000,
  totalDeductions: 668000,
  status: 'pending',
  pendingCount: 3,
};

const MOCK_AUDIT: AuditEntry[] = [
  { id: 'a1', action: 'Leave request approved',   user: 'HR Assistant',  target: 'Kiran Patel',    timestamp: '2026-04-21 14:32', via: 'agent' },
  { id: 'a2', action: 'Employee record updated',  user: 'Aishwarya Nair',target: 'Manish Gupta',   timestamp: '2026-04-20 11:15', via: 'manual' },
  { id: 'a3', action: 'Leave request approved',   user: 'HR Assistant',  target: 'Rohit Mehta',    timestamp: '2026-04-17 09:44', via: 'agent' },
  { id: 'a4', action: 'Payroll run initiated',    user: 'Kiran Patel',   target: 'April payroll',  timestamp: '2026-04-15 16:00', via: 'manual' },
  { id: 'a5', action: 'New employee onboarded',   user: 'HR Assistant',  target: 'Divya Krishnan', timestamp: '2026-03-01 10:00', via: 'agent' },
];

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  active:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  inactive:  'bg-slate-500/10 text-slate-400 border-slate-500/20',
  on_leave:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
  pending:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  approved:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  rejected:  'bg-rose-500/10 text-rose-400 border-rose-500/20',
  processed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  disbursed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn('text-[11px] px-2 py-0.5 rounded-full border font-medium capitalize', STATUS_COLORS[status] ?? 'bg-white/10 text-slate-400 border-white/10')}>
      {status.replace('_', ' ')}
    </span>
  );
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

/* ─────────────────────────────────────────────────────────────────────────
   Agent suggestion banner
──────────────────────────────────────────────────────────────────────────── */


/* ─────────────────────────────────────────────────────────────────────────
   Tab: Employees
──────────────────────────────────────────────────────────────────────────── */

function EmployeesTab({ employees, loading }: { employees: Employee[]; loading: boolean }) {
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');

  const departments = ['all', ...Array.from(new Set(employees.map((e) => e.department)))];
  const filtered = employees.filter((e) => {
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.role.toLowerCase().includes(search.toLowerCase());
    const matchDept = deptFilter === 'all' || e.department === deptFilter;
    return matchSearch && matchDept;
  });

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees…"
            className="w-full bg-white/[0.05] border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500/40 transition-colors"
          />
        </div>
        <div className="flex gap-1">
          {departments.map((d) => (
            <button key={d} onClick={() => setDeptFilter(d)}
              className={cn('px-2.5 py-1 rounded-lg text-xs font-medium transition-colors capitalize', deptFilter === d ? 'bg-blue-600 text-white' : 'bg-white/[0.05] text-slate-400 hover:text-white')}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/8 overflow-hidden">
        <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-x-4 px-4 py-2 border-b border-white/8 text-[11px] font-medium text-slate-500 uppercase tracking-wider">
          <span>Name</span><span>Role</span><span>Department</span><span>Join Date</span><span>Status</span>
        </div>
        {filtered.map((emp, i) => (
          <div key={emp.id} className={cn('grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-x-4 px-4 py-3 items-center', i % 2 === 0 ? 'bg-white/[0.01]' : '')}>
            <div>
              <p className="text-sm font-medium text-white">{emp.name}</p>
              <p className="text-[11px] text-slate-500">{emp.email}</p>
            </div>
            <span className="text-xs text-slate-300">{emp.role}</span>
            <span className="text-xs text-slate-400">{emp.department}</span>
            <span className="text-xs text-slate-500">{new Date(emp.joinDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <StatusPill status={emp.status} />
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-500">No employees match your search.</div>
        )}
      </div>
      <p className="text-[11px] text-slate-600">{filtered.length} of {employees.length} employees shown</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Leave Requests
──────────────────────────────────────────────────────────────────────────── */

function LeaveTab({ leaves, loading, onApprove, onReject }: {
  leaves: LeaveRequest[];
  loading: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const pending = leaves.filter((l) => l.status === 'pending');
  const historical = leaves.filter((l) => l.status !== 'pending');

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>;

  return (
    <div className="space-y-6">
      {/* Pending */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-white">Pending approval</h3>
          {pending.length > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">{pending.length}</span>
          )}
        </div>
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-white/8 py-10 text-center text-sm text-slate-500">All caught up — no pending leave requests.</div>
        ) : (
          <div className="space-y-2">
            {pending.map((leave) => (
              <div key={leave.id} className="rounded-2xl border border-amber-500/15 bg-amber-500/[0.03] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-white">{leave.employee}</p>
                      <span className="text-[11px] text-slate-500">{leave.department}</span>
                      <StatusPill status={leave.status} />
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 flex-wrap text-xs text-slate-400">
                      <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" /> {leave.fromDate} → {leave.toDate}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {leave.days} day{leave.days > 1 ? 's' : ''}</span>
                      <span className="text-slate-500">Type: {leave.type}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400 italic">"{leave.reason}"</p>
                    <p className="mt-1 text-[11px] text-slate-600">Applied on {leave.appliedOn}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onReject(leave.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-rose-400/20 bg-rose-500/10 text-rose-300 text-xs font-semibold hover:bg-rose-500/20 transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Remove sample
                    </button>
                    <button
                      onClick={() => onApprove(leave.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Request approval
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      {historical.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">Recent history</h3>
          <div className="space-y-2">
            {historical.map((leave) => (
              <div key={leave.id} className="rounded-2xl border border-white/8 p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white">{leave.employee} <span className="text-slate-500 font-normal text-xs">— {leave.type}</span></p>
                  <p className="text-xs text-slate-500">{leave.fromDate} → {leave.toDate} · {leave.days} day{leave.days > 1 ? 's' : ''}</p>
                </div>
                <StatusPill status={leave.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Payroll
──────────────────────────────────────────────────────────────────────────── */

function PayrollTab({
  summary,
  loading,
  onRequestDisbursement,
}: {
  summary: PayrollSummary | null;
  loading: boolean;
  onRequestDisbursement: (summary: PayrollSummary) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>;
  if (!summary) return <div className="py-12 text-center text-sm text-slate-500">Payroll data unavailable.</div>;

  const requestDisbursement = async () => {
    setSubmitting(true);
    try {
      await onRequestDisbursement(summary);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Headcount', value: summary.headcount.toString(), sub: 'employees' },
          { label: 'Gross pay', value: formatINR(summary.totalGross), sub: summary.month },
          { label: 'Net pay', value: formatINR(summary.totalNet), sub: 'after deductions' },
          { label: 'Deductions', value: formatINR(summary.totalDeductions), sub: 'PF · Tax · ESI' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <p className="text-[11px] text-slate-500 mb-1">{label}</p>
            <p className="text-lg font-bold text-white">{value}</p>
            <p className="text-[11px] text-slate-600 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Status */}
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white">{summary.month} Payroll</p>
            <StatusPill status={summary.status} />
          </div>
          {summary.pendingCount > 0 && (
            <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {summary.pendingCount} employees have pending salary queries
            </p>
          )}
        </div>
        <button
          onClick={() => void requestDisbursement()}
          disabled={submitting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
        >
          <IndianRupee className="w-3.5 h-3.5" /> {submitting ? 'Requesting...' : 'Request disbursement'}
        </button>
      </div>

      <p className="text-[11px] text-slate-600 flex items-center gap-1">
        <AlertCircle className="w-3 h-3" /> Payroll disbursement is approval-gated — your manager will be notified before funds are released.
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Activity
──────────────────────────────────────────────────────────────────────────── */

function ActivityTab({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3">
          <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', entry.via === 'agent' ? 'bg-blue-400' : 'bg-slate-500')} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white">{entry.action}</p>
            <p className="text-xs text-slate-500">{entry.target}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] text-slate-500">{entry.timestamp}</p>
            <p className={cn('text-[10px] font-medium', entry.via === 'agent' ? 'text-blue-400' : 'text-slate-500')}>
              {entry.via === 'agent' ? `🤖 ${entry.user}` : `👤 ${entry.user}`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Main Workspace
──────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'employees' as const, label: 'Employees',      Icon: Users },
  { id: 'leave' as const,     label: 'Leave Requests', Icon: CalendarDays },
  { id: 'payroll' as const,   label: 'Payroll',        Icon: IndianRupee },
  { id: 'activity' as const,  label: 'Activity',       Icon: Activity },
];

export default function GreythrWorkspace() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'employees' | 'leave' | 'payroll' | 'activity'>('employees');
  const [showBanner, setShowBanner] = useState(true);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [payroll, setPayroll] = useState<PayrollSummary | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'sample_data' | 'disconnected'>('checking');
  const [loading, setLoading] = useState({ employees: false, leave: false, payroll: false });

  const pendingLeaveCount = leaves.filter((l) => l.status === 'pending').length;

  const loadEmployees = useCallback(async () => {
    setLoading((p) => ({ ...p, employees: true }));
    try {
      const res = await api.unifiedConnectors.executeAction('greythr', 'list_employees', { limit: 50 });
      if (res.success && res.data?.data?.employees) {
        setEmployees(res.data.data.employees);
        setConnectionStatus('connected');
      } else {
        setEmployees(MOCK_EMPLOYEES);
        setConnectionStatus('sample_data');
      }
    } catch {
      setEmployees(MOCK_EMPLOYEES);
      setConnectionStatus('sample_data');
    } finally {
      setLoading((p) => ({ ...p, employees: false }));
    }
  }, []);

  const loadLeaves = useCallback(async () => {
    setLoading((p) => ({ ...p, leave: true }));
    try {
      const res = await api.unifiedConnectors.executeAction('greythr', 'list_leave_requests', {});
      if (res.success && res.data?.data?.requests) setLeaves(res.data.data.requests);
      else setLeaves(MOCK_LEAVES);
    } catch {
      setLeaves(MOCK_LEAVES);
    } finally {
      setLoading((p) => ({ ...p, leave: false }));
    }
  }, []);

  const loadPayroll = useCallback(async () => {
    setLoading((p) => ({ ...p, payroll: true }));
    try {
      const res = await api.unifiedConnectors.executeAction('greythr', 'get_payroll_summary', {});
      if (res.success && res.data?.data) setPayroll(res.data.data as PayrollSummary);
      else setPayroll(MOCK_PAYROLL);
    } catch {
      setPayroll(MOCK_PAYROLL);
    } finally {
      setLoading((p) => ({ ...p, payroll: false }));
    }
  }, []);

  useEffect(() => { void loadEmployees(); void loadLeaves(); void loadPayroll(); setAuditLog(MOCK_AUDIT); }, [loadEmployees, loadLeaves, loadPayroll]);

  const handleApprove = useCallback(async (id: string) => {
    const leave = leaves.find((l) => l.id === id);
    if (!leave) return;
    try {
      await api.approvals.create({
        service: 'greythr',
        action: 'approve_leave',
        action_payload: {
          leave_id: id,
          employee: leave.employee,
          leave_type: leave.type,
          from_date: leave.fromDate,
          to_date: leave.toDate,
          days: leave.days,
        },
        requested_by: 'HR Assistant',
        required_role: 'manager',
        expires_in_hours: 8,
      });
      setLeaves((prev) => prev.map((l) => l.id === id ? { ...l, status: 'approved' as const } : l));
      toast.success(`Leave approval request created for ${leave.employee}`);
    } catch {
      toast.error('Failed to approve leave. Try again.');
    }
  }, [leaves]);

  const handleReject = useCallback(async (id: string) => {
    const leave = leaves.find((l) => l.id === id);
    if (!leave) return;
    setLeaves((prev) => prev.map((l) => l.id === id ? { ...l, status: 'rejected' as const } : l));
    toast.success(`Sample leave request removed for ${leave.employee}`);
  }, [leaves]);

  const handleRequestPayrollDisbursement = useCallback(async (summary: PayrollSummary) => {
    try {
      await api.approvals.create({
        service: 'greythr',
        action: 'disburse_payroll',
        action_payload: {
          month: summary.month,
          headcount: summary.headcount,
          total_net: summary.totalNet,
          pending_count: summary.pendingCount,
        },
        requested_by: 'HR Assistant',
        required_role: 'admin',
        expires_in_hours: 4,
      });
      toast.success('Payroll disbursement approval request created');
    } catch {
      toast.error('Failed to request payroll disbursement approval');
    }
  }, []);

  return (
    <div className="min-h-full bg-[#080f1a] px-6 py-6">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-slate-400 hover:text-white transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
              style={{ background: '#00529B' }}
            >
              GH
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white">greytHR</h1>
                <span className="text-[10px]">🇮🇳</span>
                <span className={cn(
                  'text-[11px] px-2 py-0.5 rounded-full border font-medium',
                  connectionStatus === 'connected'
                    ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
                    : connectionStatus === 'sample_data'
                      ? 'border-amber-400/25 bg-amber-500/10 text-amber-200'
                      : 'border-slate-600/40 bg-white/[0.04] text-slate-500',
                )}>
                  {connectionStatus === 'checking'
                    ? 'Checking...'
                    : connectionStatus === 'connected'
                      ? 'Connected'
                      : connectionStatus === 'sample_data'
                        ? 'Sample data'
                        : 'Disconnected'}
                </span>
              </div>
              <p className="text-xs text-slate-500">HR Management · {employees.length} employees</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pendingLeaveCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
                <AlertCircle className="w-3.5 h-3.5" /> {pendingLeaveCount} pending approval{pendingLeaveCount > 1 ? 's' : ''}
              </span>
            )}
            <button onClick={() => { void loadEmployees(); void loadLeaves(); void loadPayroll(); }} className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-slate-400 hover:text-white transition-colors" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-xs text-slate-300 transition-colors">
              <ExternalLink className="w-3.5 h-3.5" /> Open in greytHR
            </button>
          </div>
        </div>

        {/* Setup quality score */}
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-white">Setup completeness</p>
              <p className="text-xs text-slate-400">{showBanner ? '75%' : '100%'}</p>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
              <div className={cn('h-full rounded-full transition-all duration-500', showBanner ? 'bg-amber-400 w-3/4' : 'bg-emerald-400 w-full')} />
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            {showBanner ? 'Connect an agent to reach 100%' : 'Fully set up'}
          </div>
        </div>

        {/* Agent banner */}
        {showBanner && <AgentSuggestionBanner serviceId="greythr" onDismiss={() => setShowBanner(false)} />}

        <ProductionTruthBanner title="greytHR sample sections visible" connectorName="greytHR">
          Employee, leave, payroll, or activity panels may contain sample records when greytHR does not return production data.
          The sample audit log is not compliance evidence; use only connector-returned records for paid-pilot proof.
        </ProductionTruthBanner>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/8 pb-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200',
              )}
            >
              <tab.Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.id === 'leave' && pendingLeaveCount > 0 && (
                <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold">{pendingLeaveCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === 'employees' && <EmployeesTab employees={employees} loading={loading.employees} />}
          {activeTab === 'leave'     && <LeaveTab leaves={leaves} loading={loading.leave} onApprove={handleApprove} onReject={handleReject} />}
          {activeTab === 'payroll'   && <PayrollTab summary={payroll} loading={loading.payroll} onRequestDisbursement={handleRequestPayrollDisbursement} />}
          {activeTab === 'activity'  && <ActivityTab entries={auditLog} />}
        </div>
      </div>
    </div>
  );
}
