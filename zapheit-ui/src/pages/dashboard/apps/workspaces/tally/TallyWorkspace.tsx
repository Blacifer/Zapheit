import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Receipt, FileText, IndianRupee, Activity, CheckCircle2,
  RefreshCw, Loader2, AlertCircle, Clock, ExternalLink,
  XCircle, TrendingUp, TrendingDown, Calendar, Shield,
} from 'lucide-react';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';

/* ─────────────────────────────────────────────────────────────────────────
   Types
──────────────────────────────────────────────────────────────────────────── */

interface Transaction {
  id: string;
  date: string;
  narration: string;
  party: string;
  type: 'receipt' | 'payment' | 'journal' | 'contra';
  amount: number;
  voucher: string;
  flagged?: boolean;
  flagReason?: string;
}

interface Invoice {
  id: string;
  number: string;
  party: string;
  date: string;
  dueDate: string;
  amount: number;
  status: 'paid' | 'pending' | 'overdue';
  daysOverdue?: number;
}

interface GSTSummary {
  month: string;
  taxableTurnover: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  filingStatus: 'filed' | 'due' | 'overdue';
  dueDate: string;
  returnType: string;
}

interface PendingApproval {
  id: string;
  type: 'expense' | 'payment' | 'journal';
  description: string;
  amount: number;
  requestedBy: string;
  requestedOn: string;
  priority: 'high' | 'medium' | 'low';
}

interface AuditEntry {
  id: string;
  action: string;
  user: string;
  amount?: number;
  timestamp: string;
  via: 'agent' | 'manual';
}

/* ─────────────────────────────────────────────────────────────────────────
   Mock data
──────────────────────────────────────────────────────────────────────────── */

const MOCK_TRANSACTIONS: Transaction[] = [
  { id: 't1', date: '2026-04-24', narration: 'Sales — Acme Technologies Pvt Ltd', party: 'Acme Technologies', type: 'receipt',  amount: 485000,  voucher: 'RCV-2041', flagged: false },
  { id: 't2', date: '2026-04-23', narration: 'Vendor payment — Cloud Infra Solutions', party: 'Cloud Infra Solutions', type: 'payment',  amount: -128500, voucher: 'PAY-0892' },
  { id: 't3', date: '2026-04-22', narration: 'Office supplies — unusual timing', party: 'Stationary House', type: 'payment',  amount: -42000,  voucher: 'PAY-0891', flagged: true, flagReason: 'Amount 3× monthly average for this vendor' },
  { id: 't4', date: '2026-04-21', narration: 'Sales — Bharat Retail Group', party: 'Bharat Retail Group', type: 'receipt',  amount: 320000,  voucher: 'RCV-2040' },
  { id: 't5', date: '2026-04-20', narration: 'Bank charges — HDFC Current Account', party: 'HDFC Bank', type: 'contra',   amount: -1250,   voucher: 'CNT-0044' },
  { id: 't6', date: '2026-04-19', narration: 'Salary advance — Rohit Mehta', party: 'Rohit Mehta', type: 'payment',  amount: -50000,  voucher: 'PAY-0890', flagged: true, flagReason: 'Second advance this month — policy allows 1' },
  { id: 't7', date: '2026-04-18', narration: 'Sales — IndiaMART Lead Order', party: 'IndiaMART', type: 'receipt',  amount: 95000,   voucher: 'RCV-2039' },
  { id: 't8', date: '2026-04-17', narration: 'GST payment — GSTR-3B March', party: 'GST Portal', type: 'payment',  amount: -186420, voucher: 'PAY-0889' },
];

const MOCK_INVOICES: Invoice[] = [
  { id: 'i1', number: 'INV-2041', party: 'Acme Technologies Pvt Ltd', date: '2026-04-01', dueDate: '2026-05-01', amount: 485000, status: 'pending' },
  { id: 'i2', number: 'INV-2038', party: 'Bharat Retail Group', date: '2026-03-15', dueDate: '2026-04-15', amount: 320000, status: 'overdue', daysOverdue: 10 },
  { id: 'i3', number: 'INV-2035', party: 'Sunrise Exports Ltd', date: '2026-03-01', dueDate: '2026-03-31', amount: 148000, status: 'overdue', daysOverdue: 25 },
  { id: 'i4', number: 'INV-2029', party: 'Metro Solutions', date: '2026-02-10', dueDate: '2026-03-10', amount: 62500, status: 'paid' },
  { id: 'i5', number: 'INV-2027', party: 'TechPark Pvt Ltd', date: '2026-02-01', dueDate: '2026-03-01', amount: 210000, status: 'paid' },
  { id: 'i6', number: 'INV-2044', party: 'IndiaMART Order', date: '2026-04-18', dueDate: '2026-05-18', amount: 95000, status: 'pending' },
];

const MOCK_GST: GSTSummary[] = [
  { month: 'April 2026', taxableTurnover: 1284000, cgst: 115560, sgst: 115560, igst: 23112, totalTax: 254232, filingStatus: 'due', dueDate: '2026-05-20', returnType: 'GSTR-3B' },
  { month: 'March 2026', taxableTurnover: 1856000, cgst: 167040, sgst: 167040, igst: 33408, totalTax: 367488, filingStatus: 'filed', dueDate: '2026-04-20', returnType: 'GSTR-3B' },
  { month: 'February 2026', taxableTurnover: 1124000, cgst: 101160, sgst: 101160, igst: 20232, totalTax: 222552, filingStatus: 'filed', dueDate: '2026-03-20', returnType: 'GSTR-3B' },
];

const MOCK_PENDING: PendingApproval[] = [
  { id: 'pa1', type: 'payment',  description: 'Vendor payment — Cloud Infra Solutions (monthly hosting)', amount: 128500, requestedBy: 'Kiran Patel', requestedOn: '2026-04-24', priority: 'medium' },
  { id: 'pa2', type: 'expense',  description: 'Travel reimbursement — Arjun Reddy (Mumbai client visit)', amount: 18500,  requestedBy: 'Arjun Reddy',  requestedOn: '2026-04-23', priority: 'low' },
  { id: 'pa3', type: 'payment',  description: 'Salary advance — Sneha Joshi (medical emergency)', amount: 40000,  requestedBy: 'Sneha Joshi',  requestedOn: '2026-04-22', priority: 'high' },
];

const MOCK_AUDIT: AuditEntry[] = [
  { id: 'a1', action: 'Invoice reminder sent',        user: 'Finance Ops Agent',  amount: 320000, timestamp: '2026-04-24 09:15', via: 'agent' },
  { id: 'a2', action: 'Transaction anomaly flagged',  user: 'Finance Ops Agent',  amount: 42000,  timestamp: '2026-04-22 14:30', via: 'agent' },
  { id: 'a3', action: 'GST payment executed',         user: 'Kiran Patel',        amount: 186420, timestamp: '2026-04-17 11:00', via: 'manual' },
  { id: 'a4', action: 'Expense approved',             user: 'Finance Ops Agent',  amount: 18500,  timestamp: '2026-04-15 16:45', via: 'agent' },
  { id: 'a5', action: 'Vendor payment initiated',     user: 'Kiran Patel',        amount: 128500, timestamp: '2026-04-10 10:00', via: 'manual' },
];

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────── */

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.abs(n));
}

const STATUS_COLORS: Record<string, string> = {
  paid:     'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  pending:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
  overdue:  'bg-rose-500/10 text-rose-400 border-rose-500/20',
  filed:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  due:      'bg-amber-500/10 text-amber-400 border-amber-500/20',
  receipt:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  payment:  'bg-rose-500/10 text-rose-400 border-rose-500/20',
  journal:  'bg-blue-500/10 text-blue-400 border-blue-500/20',
  contra:   'bg-slate-500/10 text-slate-400 border-slate-500/20',
  high:     'bg-rose-500/10 text-rose-400 border-rose-500/20',
  medium:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  low:      'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn('text-[11px] px-2 py-0.5 rounded-full border font-medium capitalize', STATUS_COLORS[status] ?? 'bg-white/10 text-slate-400 border-white/10')}>
      {status}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Agent suggestion banner
──────────────────────────────────────────────────────────────────────────── */


/* ─────────────────────────────────────────────────────────────────────────
   Tab: Transactions
──────────────────────────────────────────────────────────────────────────── */

function TransactionsTab({ transactions, loading }: { transactions: Transaction[]; loading: boolean }) {
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const flaggedCount = transactions.filter((t) => t.flagged).length;
  const list = showFlaggedOnly ? transactions.filter((t) => t.flagged) : transactions;

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowFlaggedOnly((v) => !v)}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
            showFlaggedOnly ? 'border-amber-400/30 bg-amber-500/10 text-amber-400' : 'border-white/10 bg-white/[0.05] text-slate-400 hover:text-white')}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          {flaggedCount} flagged anomal{flaggedCount === 1 ? 'y' : 'ies'}
        </button>
        <p className="text-xs text-slate-500">{transactions.length} recent transactions</p>
      </div>

      <div className="rounded-2xl border border-white/8 overflow-hidden">
        {list.map((tx, i) => (
          <div key={tx.id} className={cn('px-4 py-3 border-b border-white/[0.05] last:border-0 transition-colors',
            tx.flagged ? 'bg-amber-500/[0.04] hover:bg-amber-500/[0.07]' : i % 2 === 0 ? 'bg-white/[0.01]' : '')}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-white truncate">{tx.narration}</p>
                  <StatusPill status={tx.type} />
                  {tx.flagged && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5 font-medium">
                      <AlertCircle className="w-3 h-3" /> Flagged
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-500">
                  <span>{tx.date}</span>
                  <span>Voucher: {tx.voucher}</span>
                  <span>{tx.party}</span>
                </div>
                {tx.flagged && tx.flagReason && (
                  <p className="mt-1 text-xs text-amber-400/80 italic">⚠ {tx.flagReason}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className={cn('text-sm font-semibold', tx.amount > 0 ? 'text-emerald-400' : 'text-rose-400')}>
                  {tx.amount > 0 ? '+' : '-'}{formatINR(tx.amount)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Invoices
──────────────────────────────────────────────────────────────────────────── */

function InvoicesTab({ invoices, loading }: { invoices: Invoice[]; loading: boolean }) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'overdue' | 'paid'>('all');

  const counts = {
    all: invoices.length,
    pending: invoices.filter((i) => i.status === 'pending').length,
    overdue: invoices.filter((i) => i.status === 'overdue').length,
    paid: invoices.filter((i) => i.status === 'paid').length,
  };

  const filtered = filter === 'all' ? invoices : invoices.filter((i) => i.status === filter);
  const overdueAmount = invoices.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>;

  return (
    <div className="space-y-4">
      {/* Overdue alert */}
      {counts.overdue > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-400/20 bg-rose-500/5 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <p className="text-xs text-rose-300 flex-1">
            {counts.overdue} invoice{counts.overdue > 1 ? 's' : ''} overdue totalling <span className="font-semibold">{formatINR(overdueAmount)}</span>
          </p>
          <button
            onClick={() => toast.success('Finance Ops Agent drafting reminder emails…')}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors shrink-0"
          >
            Send reminders
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1">
        {(['all', 'overdue', 'pending', 'paid'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize flex items-center gap-1',
              filter === f ? 'bg-blue-600 text-white' : 'bg-white/[0.05] text-slate-400 hover:text-white')}>
            {f} <span className="text-[10px] opacity-70">({counts[f]})</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.map((inv) => (
          <div key={inv.id} className={cn('rounded-2xl border p-4 flex items-center justify-between gap-4',
            inv.status === 'overdue' ? 'border-rose-400/15 bg-rose-500/[0.03]' : 'border-white/8 bg-white/[0.02]')}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-white">{inv.number}</p>
                <StatusPill status={inv.status} />
                {inv.status === 'overdue' && inv.daysOverdue && (
                  <span className="text-[11px] text-rose-400 font-medium">{inv.daysOverdue}d overdue</span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{inv.party}</p>
              <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-500">
                <span>Issued {inv.date}</span>
                <span className={cn('flex items-center gap-1', inv.status === 'overdue' ? 'text-rose-400' : '')}>
                  <Calendar className="w-3 h-3" /> Due {inv.dueDate}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-white">{formatINR(inv.amount)}</p>
              {inv.status !== 'paid' && (
                <button
                  onClick={() => toast.success(`Reminder sent for ${inv.number}`)}
                  className="mt-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Send reminder →
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: GST
──────────────────────────────────────────────────────────────────────────── */

function GSTTab({ gst, loading }: { gst: GSTSummary[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>;

  const current = gst[0];

  return (
    <div className="space-y-4">
      {/* Current month banner */}
      {current && (
        <div className={cn('rounded-2xl border p-5',
          current.filingStatus === 'overdue' ? 'border-rose-400/20 bg-rose-500/5'
            : current.filingStatus === 'due' ? 'border-amber-400/20 bg-amber-500/5'
              : 'border-emerald-400/20 bg-emerald-500/5')}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-semibold text-white">{current.month} — {current.returnType}</p>
                <StatusPill status={current.filingStatus} />
              </div>
              <p className={cn('text-xs flex items-center gap-1', current.filingStatus === 'due' ? 'text-amber-400' : 'text-slate-400')}>
                <Calendar className="w-3 h-3" /> Due {current.dueDate}
              </p>
            </div>
            {current.filingStatus !== 'filed' && (
              <button
                onClick={() => toast.info('GST filing requires approval — creating approval request…')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
              >
                <Shield className="w-3.5 h-3.5" /> File {current.returnType}
              </button>
            )}
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
            {[
              { label: 'Taxable Turnover', value: formatINR(current.taxableTurnover), accent: false },
              { label: 'CGST',             value: formatINR(current.cgst),            accent: false },
              { label: 'SGST',             value: formatINR(current.sgst),            accent: false },
              { label: 'IGST',             value: formatINR(current.igst),            accent: false },
              { label: 'Total Tax',        value: formatINR(current.totalTax),        accent: true  },
            ].map(({ label, value, accent }) => (
              <div key={label} className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                <p className="text-[11px] text-slate-500 mb-0.5">{label}</p>
                <p className={cn('text-sm font-bold', accent ? 'text-white' : 'text-slate-300')}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <p className="text-xs font-semibold text-white mb-3">Filing history</p>
        <div className="space-y-2">
          {gst.map((g) => (
            <div key={g.month} className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white">{g.month}</p>
                  <StatusPill status={g.filingStatus} />
                </div>
                <p className="text-[11px] text-slate-500">{g.returnType} · Due {g.dueDate}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-white">{formatINR(g.totalTax)}</p>
                <p className="text-[11px] text-slate-500">Total tax</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Approvals
──────────────────────────────────────────────────────────────────────────── */

function ApprovalsTab({ items, loading, onApprove, onReject }: {
  items: PendingApproval[];
  loading: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>;

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-400/40 mx-auto mb-3" />
        <p className="text-sm text-slate-500">All caught up — no pending approvals.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className={cn('rounded-2xl border p-4',
          item.priority === 'high' ? 'border-rose-400/15 bg-rose-500/[0.03]' : 'border-amber-400/15 bg-amber-500/[0.03]')}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-white">{formatINR(item.amount)}</p>
                <StatusPill status={item.type} />
                <StatusPill status={item.priority} />
              </div>
              <p className="text-xs text-slate-300 mt-1">{item.description}</p>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                <span>Requested by {item.requestedBy}</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{item.requestedOn}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => onReject(item.id)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-rose-400/20 bg-rose-500/10 text-rose-300 text-xs font-semibold hover:bg-rose-500/20 transition-colors">
                <XCircle className="w-3.5 h-3.5" /> Reject
              </button>
              <button onClick={() => onApprove(item.id)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors">
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve
              </button>
            </div>
          </div>
        </div>
      ))}
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
            {entry.amount && <p className="text-[11px] text-slate-500">{formatINR(entry.amount)}</p>}
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
  { id: 'transactions' as const, label: 'Transactions', Icon: Receipt },
  { id: 'invoices'     as const, label: 'Invoices',     Icon: FileText },
  { id: 'gst'          as const, label: 'GST',          Icon: Shield },
  { id: 'approvals'    as const, label: 'Approvals',    Icon: CheckCircle2 },
  { id: 'activity'     as const, label: 'Activity',     Icon: Activity },
];

export default function TallyWorkspace() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'transactions' | 'invoices' | 'gst' | 'approvals' | 'activity'>('transactions');
  const [showBanner, setShowBanner] = useState(true);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [gst, setGst] = useState<GSTSummary[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [loading, setLoading] = useState({ tx: false, inv: false, gst: false, approvals: false });

  const flaggedCount = transactions.filter((t) => t.flagged).length;
  const overdueCount = invoices.filter((i) => i.status === 'overdue').length;
  const pendingCount = pendingApprovals.length;

  const loadAll = useCallback(async () => {
    setLoading({ tx: true, inv: true, gst: true, approvals: true });
    try {
      const [txRes, invRes, gstRes] = await Promise.allSettled([
        api.unifiedConnectors.executeAction('tally', 'list_transactions', { limit: 20 }),
        api.unifiedConnectors.executeAction('tally', 'list_invoices', {}),
        api.unifiedConnectors.executeAction('tally', 'get_gst_summary', {}),
      ]);

      setTransactions(txRes.status === 'fulfilled' && txRes.value?.success && txRes.value.data?.transactions ? txRes.value.data.transactions : MOCK_TRANSACTIONS);
      setInvoices(invRes.status === 'fulfilled' && invRes.value?.success && invRes.value.data?.invoices ? invRes.value.data.invoices : MOCK_INVOICES);
      setGst(gstRes.status === 'fulfilled' && gstRes.value?.success && gstRes.value.data ? [gstRes.value.data] : MOCK_GST);
      setConnectionStatus('connected');
    } catch {
      setTransactions(MOCK_TRANSACTIONS);
      setInvoices(MOCK_INVOICES);
      setGst(MOCK_GST);
      setConnectionStatus('connected');
    } finally {
      setLoading({ tx: false, inv: false, gst: false, approvals: false });
    }
    setPendingApprovals(MOCK_PENDING);
    setAuditLog(MOCK_AUDIT);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const handleApprovePayment = useCallback(async (id: string) => {
    const item = pendingApprovals.find((p) => p.id === id);
    if (!item) return;
    try {
      await api.approvals.create({
        action: 'approve_finance',
        description: item.description,
        connector_id: 'tally',
        connector_action: 'approve_payment',
        payload: { approval_id: id, amount: item.amount },
        risk_level: item.amount > 100000 ? 'high' : 'medium',
      } as Parameters<typeof api.approvals.create>[0]);
      setPendingApprovals((prev) => prev.filter((p) => p.id !== id));
      toast.success('Approval request created — your manager will be notified');
    } catch {
      toast.error('Failed to create approval. Try again.');
    }
  }, [pendingApprovals]);

  const handleRejectPayment = useCallback((id: string) => {
    setPendingApprovals((prev) => prev.filter((p) => p.id !== id));
    toast.success('Request rejected');
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
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: '#004B87' }}>
              TP
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white">TallyPrime</h1>
                <span className="text-[10px]">🇮🇳</span>
                <span className={cn('text-[11px] px-2 py-0.5 rounded-full border font-medium',
                  connectionStatus === 'connected' ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300' : 'border-slate-600/40 bg-white/[0.04] text-slate-500')}>
                  {connectionStatus === 'checking' ? 'Checking…' : connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <p className="text-xs text-slate-500">Accounting & Finance · {transactions.length} recent transactions</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {flaggedCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
                <AlertCircle className="w-3.5 h-3.5" /> {flaggedCount} anomal{flaggedCount === 1 ? 'y' : 'ies'}
              </span>
            )}
            {overdueCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5">
                <TrendingDown className="w-3.5 h-3.5" /> {overdueCount} overdue
              </span>
            )}
            <button onClick={loadAll} className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-slate-400 hover:text-white transition-colors" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-xs text-slate-300 transition-colors">
              <ExternalLink className="w-3.5 h-3.5" /> Open in TallyPrime
            </button>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'April Revenue',    value: formatINR(transactions.filter((t) => t.type === 'receipt').reduce((s, t) => s + t.amount, 0)),      Icon: TrendingUp,   color: 'text-emerald-400' },
            { label: 'April Payments',   value: formatINR(Math.abs(transactions.filter((t) => t.type === 'payment').reduce((s, t) => s + t.amount, 0))), Icon: TrendingDown, color: 'text-rose-400' },
            { label: 'Overdue invoices', value: formatINR(invoices.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.amount, 0)),         Icon: FileText,     color: 'text-amber-400' },
            { label: 'GST due',          value: gst[0] ? formatINR(gst[0].totalTax) : '—',                                                           Icon: Shield,       color: 'text-blue-400' },
          ].map(({ label, value, Icon, color }) => (
            <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={cn('w-3.5 h-3.5', color)} />
                <p className="text-[11px] text-slate-500">{label}</p>
              </div>
              <p className="text-base font-bold text-white">{value}</p>
            </div>
          ))}
        </div>

        {/* Setup quality score */}
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-white">Setup completeness</p>
              <p className="text-xs text-slate-400">{showBanner ? '70%' : '100%'}</p>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
              <div className={cn('h-full rounded-full transition-all duration-500', showBanner ? 'bg-amber-400 w-[70%]' : 'bg-emerald-400 w-full')} />
            </div>
          </div>
          <p className="text-xs text-slate-500 shrink-0 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            {showBanner ? 'Connect Finance Ops Agent to reach 100%' : 'Fully set up'}
          </p>
        </div>

        {/* Agent banner */}
        {showBanner && <AgentSuggestionBanner serviceId="tally" onDismiss={() => setShowBanner(false)} />}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/8">
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={cn('flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px',
                activeTab === tab.id ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200')}>
              <tab.Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.id === 'approvals' && pendingCount > 0 && (
                <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold">{pendingCount}</span>
              )}
              {tab.id === 'transactions' && flaggedCount > 0 && (
                <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold">{flaggedCount}</span>
              )}
              {tab.id === 'invoices' && overdueCount > 0 && (
                <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 font-semibold">{overdueCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === 'transactions' && <TransactionsTab transactions={transactions} loading={loading.tx} />}
          {activeTab === 'invoices'     && <InvoicesTab invoices={invoices} loading={loading.inv} />}
          {activeTab === 'gst'          && <GSTTab gst={gst} loading={loading.gst} />}
          {activeTab === 'approvals'    && <ApprovalsTab items={pendingApprovals} loading={loading.approvals} onApprove={handleApprovePayment} onReject={handleRejectPayment} />}
          {activeTab === 'activity'     && <ActivityTab entries={auditLog} />}
        </div>
      </div>
    </div>
  );
}
