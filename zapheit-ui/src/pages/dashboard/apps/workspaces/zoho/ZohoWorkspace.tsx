import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, CalendarDays, Clock,
  Activity, Bot, RefreshCw, Loader2,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import { EmployeeList, type ZohoEmployee } from './EmployeeList';
import { LeaveRequests, type LeaveRequest } from './LeaveRequests';
import { ZohoActivityTab } from './ZohoActivityTab';
import { ZohoAutomationTab } from './ZohoAutomationTab';

/* ------------------------------------------------------------------ */
/*  Tab Config                                                         */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'employees',  label: 'Employees',  Icon: Users },
  { id: 'leave',      label: 'Leave',      Icon: CalendarDays },
  { id: 'attendance', label: 'Attendance', Icon: Clock },
  { id: 'activity',   label: 'Activity',   Icon: Activity },
  { id: 'automation', label: 'Automation', Icon: Bot },
] as const;

type TabId = (typeof TABS)[number]['id'];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function ZohoWorkspace() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('employees');
  const [showBanner, setShowBanner] = useState(true);

  /* Data state */
  const [employees, setEmployees] = useState<ZohoEmployee[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');

  /* Loading */
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingLeave, setLoadingLeave] = useState(false);
  const [loadingAttendance, setLoadingAttendance] = useState(false);

  /* --------------------------------------------------------------- */
  /*  Data loaders                                                     */
  /* --------------------------------------------------------------- */

  const loadEmployees = useCallback(async () => {
    setLoadingEmployees(true);
    try {
      const res = await api.unifiedConnectors.executeAction('zoho-people', 'list_employees', { limit: 50 });
      if (res.success && res.data?.data) setEmployees(res.data.data);
      setConnectionStatus('connected');
    } catch {
      setConnectionStatus('disconnected');
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  const loadLeave = useCallback(async () => {
    setLoadingLeave(true);
    try {
      const res = await api.unifiedConnectors.executeAction('zoho-people', 'list_leave_requests', { limit: 50 });
      if (res.success && res.data?.data) setLeaveRequests(res.data.data);
    } catch { /* empty */ }
    finally { setLoadingLeave(false); }
  }, []);

  const loadAttendance = useCallback(async () => {
    setLoadingAttendance(true);
    try {
      const res = await api.unifiedConnectors.executeAction('zoho-people', 'list_attendance', { limit: 50 });
      if (res.success && res.data?.data) setAttendance(res.data.data);
    } catch { /* empty */ }
    finally { setLoadingAttendance(false); }
  }, []);

  /* --------------------------------------------------------------- */
  /*  Write actions                                                    */
  /* --------------------------------------------------------------- */

  const createEmployee = useCallback(async (data: Record<string, string>) => {
    try {
      const res = await api.unifiedConnectors.executeAction('zoho-people', 'create_employee', data);
      if (res.success) {
        toast.success('Employee created');
        void loadEmployees();
      } else {
        toast.error(res.error || 'Failed to create employee');
      }
    } catch { toast.error('Network error'); }
  }, [loadEmployees]);

  const approveLeave = useCallback(async (requestId: string) => {
    try {
      const res = await api.unifiedConnectors.executeAction('zoho-people', 'approve_leave', { requestId });
      if (res.success) {
        toast.success('Leave approved');
        void loadLeave();
      } else {
        toast.error(res.error || 'Failed to approve leave');
      }
    } catch { toast.error('Network error'); }
  }, [loadLeave]);

  const rejectLeave = useCallback(async (requestId: string) => {
    try {
      const res = await api.unifiedConnectors.executeAction('zoho-people', 'reject_leave', { requestId });
      if (res.success) {
        toast.success('Leave rejected');
        void loadLeave();
      } else {
        toast.error(res.error || 'Failed to reject leave');
      }
    } catch { toast.error('Network error'); }
  }, [loadLeave]);

  /* Auto-load on mount */
  useEffect(() => { void loadEmployees(); }, [loadEmployees]);

  /* Load tab data on switch */
  useEffect(() => {
    if (activeTab === 'leave' && leaveRequests.length === 0) void loadLeave();
    if (activeTab === 'attendance' && attendance.length === 0) void loadAttendance();
  }, [activeTab, leaveRequests.length, attendance.length, loadLeave, loadAttendance]);

  /* --------------------------------------------------------------- */
  /*  Refresh                                                          */
  /* --------------------------------------------------------------- */

  const refreshCurrent = useCallback(() => {
    if (activeTab === 'employees') void loadEmployees();
    else if (activeTab === 'leave') void loadLeave();
    else if (activeTab === 'attendance') void loadAttendance();
  }, [activeTab, loadEmployees, loadLeave, loadAttendance]);

  const isLoading = loadingEmployees || loadingLeave || loadingAttendance;

  /* --------------------------------------------------------------- */
  /*  Render                                                           */
  /* --------------------------------------------------------------- */

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 shrink-0">
        <button
          onClick={() => navigate('/dashboard/apps')}
          className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-yellow-500 flex items-center justify-center text-white font-bold text-sm">
          Z
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-white">Zoho People</h1>
            <StatusBadge status={connectionStatus} />
          </div>
          <p className="text-[10px] text-slate-500">HR Suite — Employees, Leave &amp; Attendance</p>
        </div>

        <button
          onClick={refreshCurrent}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 text-xs font-medium transition-colors disabled:opacity-40"
        >
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-5 py-1.5 border-b border-white/5 shrink-0 overflow-x-auto">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap',
              activeTab === id
                ? 'bg-white/[0.08] text-white'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
            )}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Agent suggestion banner */}
      {showBanner && (
        <div className="px-5 pt-3 pb-1 shrink-0">
          <AgentSuggestionBanner serviceId="zoho" onDismiss={() => setShowBanner(false)} />
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'employees' ? (
        <div className="flex-1 overflow-hidden">
          <EmployeeList
            employees={employees}
            loading={loadingEmployees}
            onCreate={createEmployee}
          />
        </div>
      ) : activeTab === 'leave' ? (
        <div className="flex-1 overflow-hidden">
          <LeaveRequests
            requests={leaveRequests}
            loading={loadingLeave}
            onApprove={approveLeave}
            onReject={rejectLeave}
          />
        </div>
      ) : activeTab === 'attendance' ? (
        <div className="flex-1 overflow-hidden">
          {loadingAttendance ? (
            <div className="animate-pulse space-y-1 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 bg-white/[0.03] rounded-lg" />
              ))}
            </div>
          ) : attendance.length === 0 ? (
            <EmptyState type="no-data" description="No attendance records found" />
          ) : (
            <div className="divide-y divide-white/[0.04] overflow-y-auto h-full">
              {attendance.map((a: any, idx: number) => (
                <div key={a.id || idx} className="px-5 py-3 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      {a.employeeName || a.employee_name || 'Employee'}
                    </span>
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[9px] font-medium border',
                      a.status === 'present' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                        : a.status === 'absent' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                        : 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                    )}>
                      {a.status || 'unknown'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 ml-6 text-[10px] text-slate-500">
                    {a.date && <span>{a.date}</span>}
                    {a.checkIn && <span>In: {a.checkIn}</span>}
                    {a.checkOut && <span>Out: {a.checkOut}</span>}
                    {a.totalHours && <span>{a.totalHours}h</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'activity' ? (
        <div className="flex-1 overflow-y-auto">
          <ZohoActivityTab />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <ZohoAutomationTab />
        </div>
      )}
    </div>
  );
}
