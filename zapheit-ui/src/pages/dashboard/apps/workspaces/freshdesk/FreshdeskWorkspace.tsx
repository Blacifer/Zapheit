import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Ticket, MessageSquare, BarChart2, Activity,
  RefreshCw, Loader2, AlertCircle, Clock, CheckCircle2,
  XCircle, ExternalLink, TrendingUp, TrendingDown, Star,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';

/* ─────────────────────────────────────────────────────────────────────────
   Types
──────────────────────────────────────────────────────────────────────────── */

interface SupportTicket {
  id: string;
  subject: string;
  requester: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'open' | 'pending' | 'resolved' | 'closed';
  group: string;
  createdAt: string;
  slaDeadline: string;
  slaBreach: boolean;
  draftReply?: string;
}

interface DraftResponse {
  id: string;
  ticketId: string;
  ticketSubject: string;
  requester: string;
  draftText: string;
  generatedBy: string;
  generatedAt: string;
  status: 'pending_approval' | 'approved' | 'rejected';
}

interface AnalyticsStat {
  label: string;
  value: string;
  change: number;
  icon: React.ReactNode;
}

/* ─────────────────────────────────────────────────────────────────────────
   Mock data
──────────────────────────────────────────────────────────────────────────── */

const MOCK_TICKETS: SupportTicket[] = [
  { id: 'TKT-1041', subject: 'Cannot log in to the portal after password reset', requester: 'Ananya Krishnan', priority: 'urgent', status: 'open', group: 'Technical Support', createdAt: '2026-04-25T07:14:00Z', slaDeadline: '2026-04-25T11:14:00Z', slaBreach: true, draftReply: 'Hi Ananya, I can see your account was locked after multiple failed attempts. I\'ve reset your login and sent a fresh link to your registered email. Please try again and let us know if the issue persists.' },
  { id: 'TKT-1040', subject: 'Invoice #INV-2041 shows wrong GST amount', requester: 'Rahul Mehta', priority: 'high', status: 'open', group: 'Billing', createdAt: '2026-04-25T06:50:00Z', slaDeadline: '2026-04-25T14:50:00Z', slaBreach: false, draftReply: 'Hi Rahul, we\'ve identified the discrepancy — the GST was computed on the pre-discount amount. A corrected invoice will be issued within 2 business hours.' },
  { id: 'TKT-1039', subject: 'Feature request: bulk export of audit logs', requester: 'Priya Sharma', priority: 'medium', status: 'open', group: 'Product', createdAt: '2026-04-24T15:30:00Z', slaDeadline: '2026-04-27T15:30:00Z', slaBreach: false },
  { id: 'TKT-1038', subject: 'Slow response time on reports page', requester: 'Vikram Nair', priority: 'high', status: 'pending', group: 'Technical Support', createdAt: '2026-04-24T12:00:00Z', slaDeadline: '2026-04-25T20:00:00Z', slaBreach: false, draftReply: 'Hi Vikram, we\'ve identified a query optimisation issue on reports with >10k rows. A fix is being deployed to production today — you should see improvement by evening.' },
  { id: 'TKT-1037', subject: 'Need to update billing contact email', requester: 'Neha Joshi', priority: 'low', status: 'open', group: 'Billing', createdAt: '2026-04-24T09:15:00Z', slaDeadline: '2026-04-28T09:15:00Z', slaBreach: false },
  { id: 'TKT-1036', subject: 'WhatsApp approval button not showing on mobile', requester: 'Arjun Das', priority: 'high', status: 'open', group: 'Technical Support', createdAt: '2026-04-23T17:45:00Z', slaDeadline: '2026-04-25T17:45:00Z', slaBreach: true, draftReply: 'Hi Arjun, this is a known issue with WhatsApp Business template rendering on Android 13. A hotfix was released yesterday — please update your WhatsApp app and try again.' },
];

const MOCK_DRAFTS: DraftResponse[] = [
  { id: 'DFT-001', ticketId: 'TKT-1041', ticketSubject: 'Cannot log in to the portal after password reset', requester: 'Ananya Krishnan', draftText: 'Hi Ananya, I can see your account was locked after multiple failed attempts. I\'ve reset your login and sent a fresh link to your registered email. Please try again and let us know if the issue persists.', generatedBy: 'Support Agent', generatedAt: '2026-04-25T07:20:00Z', status: 'pending_approval' },
  { id: 'DFT-002', ticketId: 'TKT-1040', ticketSubject: 'Invoice #INV-2041 shows wrong GST amount', requester: 'Rahul Mehta', draftText: 'Hi Rahul, we\'ve identified the discrepancy — the GST was computed on the pre-discount amount. A corrected invoice will be issued within 2 business hours.', generatedBy: 'Support Agent', generatedAt: '2026-04-25T07:05:00Z', status: 'pending_approval' },
  { id: 'DFT-003', ticketId: 'TKT-1036', ticketSubject: 'WhatsApp approval button not showing on mobile', requester: 'Arjun Das', draftText: 'Hi Arjun, this is a known issue with WhatsApp Business template rendering on Android 13. A hotfix was released yesterday — please update your WhatsApp app and try again.', generatedBy: 'Support Agent', generatedAt: '2026-04-24T18:00:00Z', status: 'pending_approval' },
  { id: 'DFT-004', ticketId: 'TKT-1038', ticketSubject: 'Slow response time on reports page', requester: 'Vikram Nair', draftText: 'Hi Vikram, we\'ve identified a query optimisation issue on reports with >10k rows. A fix is being deployed to production today — you should see improvement by evening.', generatedBy: 'Support Agent', generatedAt: '2026-04-24T12:30:00Z', status: 'approved' },
];

const MOCK_ACTIVITY = [
  { id: 1, action: 'agent.draft_reply', description: 'Support Agent drafted reply for TKT-1041', agent: true, at: '2026-04-25T07:20:00Z' },
  { id: 2, action: 'ticket.sla_breach', description: 'SLA breached for TKT-1041 — escalated to Technical Support lead', agent: false, at: '2026-04-25T07:14:00Z' },
  { id: 3, action: 'agent.draft_reply', description: 'Support Agent drafted reply for TKT-1040', agent: true, at: '2026-04-25T07:05:00Z' },
  { id: 4, action: 'approval.created', description: 'Reply for TKT-1040 sent for approval', agent: false, at: '2026-04-25T07:05:00Z' },
  { id: 5, action: 'approval.approved', description: 'Reply for TKT-1038 approved and sent', agent: false, at: '2026-04-24T13:00:00Z' },
  { id: 6, action: 'agent.sla_alert', description: 'Support Agent flagged 2 tickets at risk of SLA breach', agent: true, at: '2026-04-24T12:00:00Z' },
];

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────── */

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500/15 text-red-400 border-red-500/20',
  high:   'bg-orange-500/15 text-orange-400 border-orange-500/20',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  low:    'bg-slate-500/15 text-slate-400 border-slate-500/20',
};

const STATUS_COLORS: Record<string, string> = {
  open:     'bg-blue-500/15 text-blue-400',
  pending:  'bg-amber-500/15 text-amber-400',
  resolved: 'bg-emerald-500/15 text-emerald-400',
  closed:   'bg-slate-500/15 text-slate-400',
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Tickets
──────────────────────────────────────────────────────────────────────────── */

function TicketsTab({ tickets }: { tickets: SupportTicket[] }) {
  const [filter, setFilter] = useState<'all' | 'sla_breach' | 'urgent'>('all');

  const filtered = tickets.filter(t => {
    if (filter === 'sla_breach') return t.slaBreach;
    if (filter === 'urgent') return t.priority === 'urgent' || t.priority === 'high';
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['all', 'sla_breach', 'urgent'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('px-3 py-1.5 rounded-xl text-xs font-medium transition-colors border',
              filter === f ? 'bg-blue-600 border-blue-500 text-white' : 'border-white/10 text-slate-400 hover:text-white hover:border-white/20'
            )}>
            {f === 'all' ? 'All Tickets' : f === 'sla_breach' ? '⚠ SLA Breach' : 'Urgent / High'}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map(ticket => (
          <div key={ticket.id} className={cn('rounded-2xl border bg-white/3 p-4 space-y-2', ticket.slaBreach ? 'border-red-500/30' : 'border-white/8')}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-slate-500">{ticket.id}</span>
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium border', PRIORITY_COLORS[ticket.priority])}>
                    {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                  </span>
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[ticket.status])}>
                    {ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}
                  </span>
                  {ticket.slaBreach && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400">
                      <AlertCircle className="w-3 h-3" /> SLA Breached
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-white mt-1 truncate">{ticket.subject}</p>
                <p className="text-xs text-slate-500 mt-0.5">{ticket.requester} · {ticket.group} · Created {fmtTime(ticket.createdAt)}</p>
              </div>
              <button className="shrink-0 p-1.5 text-slate-500 hover:text-slate-300 transition-colors">
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>

            {ticket.draftReply && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
                <p className="text-xs font-semibold text-blue-400 mb-1">AI Draft Reply</p>
                <p className="text-xs text-slate-300 leading-relaxed">{ticket.draftReply}</p>
                <p className="text-xs text-slate-500 mt-2">Review & send in the Responses tab →</p>
              </div>
            )}

            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Clock className="w-3 h-3" />
              <span className={ticket.slaBreach ? 'text-red-400' : ''}>
                SLA deadline: {fmtTime(ticket.slaDeadline)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Responses (approval-gated drafts)
──────────────────────────────────────────────────────────────────────────── */

function ResponsesTab({ drafts, setDrafts }: { drafts: DraftResponse[]; setDrafts: React.Dispatch<React.SetStateAction<DraftResponse[]>> }) {
  const [submitting, setSubmitting] = useState<string | null>(null);

  const handleDecision = async (draftId: string, decision: 'approved' | 'rejected') => {
    setSubmitting(draftId);
    try {
      await api.approvals.create({
        service: 'freshdesk',
        action: 'send_reply',
        action_payload: { draft_id: draftId },
        requested_by: 'Support Agent',
        required_role: 'manager',
        expires_in_hours: 8,
      });
      setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, status: decision } : d));
      toast.success(decision === 'approved' ? 'Reply approved and sent to customer' : 'Draft rejected');
    } catch {
      toast.error('Failed to process decision');
    } finally {
      setSubmitting(null);
    }
  };

  const pending = drafts.filter(d => d.status === 'pending_approval');
  const history = drafts.filter(d => d.status !== 'pending_approval');

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Pending Approval ({pending.length})</h3>
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-white/3 p-8 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No replies waiting for approval</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map(draft => (
              <div key={draft.id} className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                <div>
                  <p className="text-xs font-mono text-slate-500">{draft.ticketId}</p>
                  <p className="text-sm font-medium text-white">{draft.ticketSubject}</p>
                  <p className="text-xs text-slate-500">To: {draft.requester} · Drafted by {draft.generatedBy} at {fmtTime(draft.generatedAt)}</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/3 p-3">
                  <p className="text-xs text-slate-300 leading-relaxed">{draft.draftText}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDecision(draft.id, 'approved')}
                    disabled={submitting === draft.id}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                  >
                    {submitting === draft.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                    Approve & Send
                  </button>
                  <button
                    onClick={() => handleDecision(draft.id, 'rejected')}
                    disabled={submitting === draft.id}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-50 text-slate-300 text-xs font-semibold transition-colors"
                  >
                    <XCircle className="w-3 h-3" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-400 mb-3">History</h3>
          <div className="space-y-2">
            {history.map(draft => (
              <div key={draft.id} className="rounded-xl border border-white/8 bg-white/3 p-3 flex items-center gap-3">
                {draft.status === 'approved'
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  : <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{draft.ticketSubject}</p>
                  <p className="text-xs text-slate-500">{draft.status === 'approved' ? 'Sent' : 'Rejected'} · {fmtTime(draft.generatedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Analytics
──────────────────────────────────────────────────────────────────────────── */

function AnalyticsTab() {
  const stats: AnalyticsStat[] = [
    { label: 'Avg Resolution Time', value: '4h 22m', change: -12, icon: <Clock className="w-4 h-4" /> },
    { label: 'CSAT Score', value: '4.3 / 5', change: 5, icon: <Star className="w-4 h-4" /> },
    { label: 'Open Tickets', value: '24', change: 8, icon: <Ticket className="w-4 h-4" /> },
    { label: 'SLA Breach Rate', value: '8.3%', change: -3, icon: <AlertCircle className="w-4 h-4" /> },
  ];

  const volumeData = [
    { day: 'Mon', count: 18 }, { day: 'Tue', count: 24 }, { day: 'Wed', count: 31 },
    { day: 'Thu', count: 22 }, { day: 'Fri', count: 29 }, { day: 'Sat', count: 10 }, { day: 'Sun', count: 6 },
  ];
  const maxCount = Math.max(...volumeData.map(d => d.count));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        {stats.map(stat => (
          <div key={stat.label} className="rounded-2xl border border-white/8 bg-white/3 p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-2">{stat.icon}<span className="text-xs">{stat.label}</span></div>
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <div className={cn('flex items-center gap-1 text-xs mt-1', stat.change < 0 ? 'text-emerald-400' : 'text-red-400')}>
              {stat.change < 0 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
              {Math.abs(stat.change)}% vs last week
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/8 bg-white/3 p-4">
        <p className="text-sm font-semibold text-white mb-4">Ticket Volume — Last 7 Days</p>
        <div className="flex items-end gap-2 h-28">
          {volumeData.map(d => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-slate-500">{d.count}</span>
              <div
                className="w-full rounded-t-lg bg-blue-500/40 hover:bg-blue-500/60 transition-colors"
                style={{ height: `${(d.count / maxCount) * 80}px` }}
              />
              <span className="text-xs text-slate-500">{d.day}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/8 bg-white/3 p-4 space-y-3">
        <p className="text-sm font-semibold text-white">Tickets by Group</p>
        {[
          { group: 'Technical Support', count: 11, pct: 46 },
          { group: 'Billing', count: 8, pct: 33 },
          { group: 'Product', count: 5, pct: 21 },
        ].map(g => (
          <div key={g.group} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">{g.group}</span>
              <span className="text-slate-500">{g.count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/8">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${g.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Activity
──────────────────────────────────────────────────────────────────────────── */

function ActivityTab() {
  return (
    <div className="space-y-2">
      {MOCK_ACTIVITY.map(entry => (
        <div key={entry.id} className="rounded-xl border border-white/8 bg-white/3 p-3 flex items-start gap-3">
          <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', entry.agent ? 'bg-blue-400' : 'bg-slate-500')} />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white">{entry.description}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {entry.agent && <span className="text-xs font-medium text-blue-400">Agent</span>}
              <span className="text-xs text-slate-500">{fmtTime(entry.at)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Root workspace component
──────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'tickets',   label: 'Tickets',   Icon: Ticket },
  { id: 'responses', label: 'Responses', Icon: MessageSquare },
  { id: 'analytics', label: 'Analytics', Icon: BarChart2 },
  { id: 'activity',  label: 'Activity',  Icon: Activity },
] as const;

type TabId = typeof TABS[number]['id'];

export default function FreshdeskWorkspace() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('tickets');
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [drafts, setDrafts] = useState<DraftResponse[]>([]);
  const [showBanner, setShowBanner] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await api.unifiedConnectors?.executeAction?.('freshdesk', 'list_tickets', {});
    } catch { /* fall through to mock */ }
    setTickets(MOCK_TICKETS);
    setDrafts(MOCK_DRAFTS);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const slaBreachCount = tickets.filter(t => t.slaBreach).length;
  const openCount = tickets.filter(t => t.status === 'open').length;
  const pendingDrafts = drafts.filter(d => d.status === 'pending_approval').length;

  return (
    <div className="h-full flex flex-col bg-[#0B0F1A] text-white">
      {/* Header */}
      <div className="border-b border-white/8 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard/apps')} className="p-1.5 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: '#25C16F' }}>FD</div>
          <div>
            <h1 className="text-lg font-semibold">Freshdesk</h1>
            <p className="text-xs text-slate-400">Support workspace</p>
          </div>
        </div>
        <button onClick={load} className="p-2 text-slate-400 hover:text-white transition-colors">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Quick stats */}
      <div className="border-b border-white/8 px-6 py-3 flex items-center gap-6 text-xs shrink-0">
        <span className="text-slate-400">Open <span className="text-white font-semibold ml-1">{openCount}</span></span>
        <span className="text-slate-400">SLA Breached <span className="text-red-400 font-semibold ml-1">{slaBreachCount}</span></span>
        <span className="text-slate-400">Drafts Pending <span className="text-amber-400 font-semibold ml-1">{pendingDrafts}</span></span>
        <span className="text-slate-400">CSAT <span className="text-emerald-400 font-semibold ml-1">4.3 / 5</span></span>
      </div>

      {/* Tabs */}
      <div className="border-b border-white/8 px-6 flex gap-1 shrink-0">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
              tab === id ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-white'
            )}>
            <Icon className="w-4 h-4" /> {label}
            {id === 'responses' && pendingDrafts > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold">{pendingDrafts}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {showBanner && <AgentSuggestionBanner serviceId="freshdesk" onDismiss={() => setShowBanner(false)} />}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            {tab === 'tickets'   && <TicketsTab tickets={tickets} />}
            {tab === 'responses' && <ResponsesTab drafts={drafts} setDrafts={setDrafts} />}
            {tab === 'analytics' && <AnalyticsTab />}
            {tab === 'activity'  && <ActivityTab />}
          </>
        )}
      </div>
    </div>
  );
}
