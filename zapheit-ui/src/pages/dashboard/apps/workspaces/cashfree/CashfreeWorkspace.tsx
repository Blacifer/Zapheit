import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, IndianRupee, Send, Link2, Activity,
  RefreshCw, Loader2, CheckCircle2, XCircle, Clock,
  AlertCircle, TrendingUp, TrendingDown, ExternalLink, Copy,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import { ProductionTruthBanner } from '../shared';

/* ─────────────────────────────────────────────────────────────────────────
   Types
──────────────────────────────────────────────────────────────────────────── */

interface CashfreeTransaction {
  id: string;
  type: 'payment' | 'refund' | 'settlement';
  amount: number;
  status: 'success' | 'failed' | 'pending' | 'processing';
  party: string;
  method: string;
  createdAt: string;
  settlementDate?: string;
  orderId?: string;
}

interface Payout {
  id: string;
  beneficiary: string;
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  bankAccount: string;
  createdAt: string;
  scheduledAt?: string;
}

interface PaymentLink {
  id: string;
  description: string;
  amount: number;
  status: 'active' | 'paid' | 'expired';
  expiresAt: string;
  createdAt: string;
  paidAt?: string;
  url: string;
  paidCount: number;
}

/* ─────────────────────────────────────────────────────────────────────────
   Sample data
──────────────────────────────────────────────────────────────────────────── */

const fmtINR = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const MOCK_TRANSACTIONS: CashfreeTransaction[] = [
  { id: 'TXN-8841', type: 'payment', amount: 48000, status: 'success', party: 'Acme Corp', method: 'UPI', createdAt: '2026-04-25T09:30:00Z', orderId: 'ORD-2041' },
  { id: 'TXN-8840', type: 'payment', amount: 12500, status: 'success', party: 'Rohan Sharma', method: 'Net Banking', createdAt: '2026-04-25T08:15:00Z', orderId: 'ORD-2040' },
  { id: 'TXN-8839', type: 'refund', amount: 5000, status: 'processing', party: 'Priya Nair', method: 'UPI', createdAt: '2026-04-25T07:45:00Z' },
  { id: 'TXN-8838', type: 'payment', amount: 95000, status: 'failed', party: 'GlobalTech Ltd', method: 'NEFT', createdAt: '2026-04-24T18:00:00Z', orderId: 'ORD-2039' },
  { id: 'TXN-8837', type: 'settlement', amount: 245000, status: 'success', party: 'Cashfree → HDFC', method: 'Settlement', createdAt: '2026-04-24T10:00:00Z', settlementDate: '2026-04-24' },
  { id: 'TXN-8836', type: 'payment', amount: 18750, status: 'success', party: 'Vikram Joshi', method: 'Credit Card', createdAt: '2026-04-24T09:30:00Z', orderId: 'ORD-2038' },
  { id: 'TXN-8835', type: 'payment', amount: 3200, status: 'success', party: 'Neha Das', method: 'UPI', createdAt: '2026-04-23T17:00:00Z', orderId: 'ORD-2037' },
  { id: 'TXN-8834', type: 'refund', amount: 12500, status: 'success', party: 'Arjun Kumar', method: 'Net Banking', createdAt: '2026-04-23T14:00:00Z' },
];

const MOCK_PAYOUTS: Payout[] = [
  { id: 'PAY-441', beneficiary: 'Rasi Technologies Pvt Ltd', amount: 85000, status: 'pending', bankAccount: 'HDFC ···3421', createdAt: '2026-04-25T08:00:00Z', scheduledAt: '2026-04-25T15:00:00Z' },
  { id: 'PAY-440', beneficiary: 'Vendor — Print Solutions', amount: 22500, status: 'pending', bankAccount: 'ICICI ···8811', createdAt: '2026-04-25T07:00:00Z', scheduledAt: '2026-04-25T15:00:00Z' },
  { id: 'PAY-439', beneficiary: 'Freelancer — Aditya Rao', amount: 45000, status: 'processing', bankAccount: 'SBI ···6622', createdAt: '2026-04-24T16:00:00Z' },
  { id: 'PAY-438', beneficiary: 'Office Supplies — Staples India', amount: 8750, status: 'completed', bankAccount: 'Axis ···9910', createdAt: '2026-04-23T11:00:00Z' },
];

const MOCK_LINKS: PaymentLink[] = [
  { id: 'LINK-1', description: 'April Consulting Invoice — Rasi Technologies', amount: 120000, status: 'active', expiresAt: '2026-04-30T23:59:00Z', createdAt: '2026-04-20T10:00:00Z', url: 'pay.cashfree.com/rasi/apr-consulting', paidCount: 0 },
  { id: 'LINK-2', description: 'Workshop Registration — Data + AI Summit', amount: 4999, status: 'active', expiresAt: '2026-04-28T23:59:00Z', createdAt: '2026-04-18T12:00:00Z', url: 'pay.cashfree.com/rasi/ai-summit', paidCount: 12 },
  { id: 'LINK-3', description: 'Q4 Software License Renewal', amount: 75000, status: 'paid', expiresAt: '2026-04-20T23:59:00Z', createdAt: '2026-04-10T09:00:00Z', paidAt: '2026-04-15T14:30:00Z', url: 'pay.cashfree.com/rasi/q4-license', paidCount: 1 },
  { id: 'LINK-4', description: 'Annual Maintenance Contract — 2026', amount: 36000, status: 'expired', expiresAt: '2026-04-10T23:59:00Z', createdAt: '2026-04-01T09:00:00Z', url: 'pay.cashfree.com/rasi/amc-2026', paidCount: 0 },
];

const MOCK_ACTIVITY = [
  { id: 1, desc: 'Settlement of ₹2,45,000 received from Cashfree', agent: false, at: '2026-04-24T10:00:00Z' },
  { id: 2, desc: 'Finance Ops Agent flagged TXN-8838 (₹95,000 NEFT failed) for review', agent: true, at: '2026-04-24T18:05:00Z' },
  { id: 3, desc: 'Payout PAY-439 initiated to Aditya Rao — ₹45,000', agent: false, at: '2026-04-24T16:00:00Z' },
  { id: 4, desc: '12 payments received via Workshop Registration link', agent: false, at: '2026-04-24T15:00:00Z' },
  { id: 5, desc: 'Finance Ops Agent reconciled April settlements — 3 mismatches found', agent: true, at: '2026-04-23T09:00:00Z' },
  { id: 6, desc: 'Refund of ₹12,500 processed to Arjun Kumar', agent: false, at: '2026-04-23T14:00:00Z' },
];

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Transactions
──────────────────────────────────────────────────────────────────────────── */

const TX_TYPE_COLOR: Record<string, string> = {
  payment:    'bg-emerald-500/15 text-emerald-400',
  refund:     'bg-orange-500/15 text-orange-400',
  settlement: 'bg-blue-500/15 text-blue-400',
};

const TX_STATUS_COLOR: Record<string, string> = {
  success:    'bg-emerald-500/15 text-emerald-400',
  failed:     'bg-red-500/15 text-red-400',
  pending:    'bg-amber-500/15 text-amber-400',
  processing: 'bg-blue-500/15 text-blue-400',
};

function TransactionsTab({ txns }: { txns: CashfreeTransaction[] }) {
  const [filter, setFilter] = useState<'all' | 'payment' | 'refund' | 'settlement'>('all');
  const filtered = filter === 'all' ? txns : txns.filter(t => t.type === filter);

  const totals = { in: txns.filter(t => t.type === 'payment' && t.status === 'success').reduce((a, t) => a + t.amount, 0), out: txns.filter(t => t.type === 'refund' && t.status === 'success').reduce((a, t) => a + t.amount, 0) };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Received', value: fmtINR(totals.in), icon: <TrendingUp className="w-4 h-4 text-emerald-400" /> },
          { label: 'Refunded', value: fmtINR(totals.out), icon: <TrendingDown className="w-4 h-4 text-orange-400" /> },
          { label: 'Settled', value: fmtINR(245000), icon: <IndianRupee className="w-4 h-4 text-blue-400" /> },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-white/8 bg-white/3 p-3">
            <div className="flex items-center gap-1.5 mb-1">{s.icon}<span className="text-xs text-slate-400">{s.label}</span></div>
            <p className="text-base font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {(['all', 'payment', 'refund', 'settlement'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors capitalize',
              filter === f ? 'bg-blue-600 border-blue-500 text-white' : 'border-white/10 text-slate-400 hover:text-white hover:border-white/20'
            )}>
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map(tx => (
          <div key={tx.id} className={cn('rounded-xl border bg-white/3 p-3 flex items-center gap-3', tx.status === 'failed' ? 'border-red-500/20' : 'border-white/8')}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', TX_TYPE_COLOR[tx.type])}>{tx.type}</span>
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', TX_STATUS_COLOR[tx.status])}>{tx.status}</span>
                {tx.status === 'failed' && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
              </div>
              <p className="text-sm font-medium text-white mt-0.5">{tx.party}</p>
              <p className="text-xs text-slate-500">{tx.id}{tx.orderId ? ` · ${tx.orderId}` : ''} · {tx.method} · {fmtTime(tx.createdAt)}</p>
            </div>
            <p className={cn('text-sm font-bold shrink-0', tx.type === 'refund' ? 'text-orange-400' : 'text-emerald-400')}>
              {tx.type === 'refund' ? '-' : '+'}{fmtINR(tx.amount)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Payouts (approval-gated)
──────────────────────────────────────────────────────────────────────────── */

const PAYOUT_STATUS_COLOR: Record<string, string> = {
  pending:    'bg-amber-500/15 text-amber-400',
  processing: 'bg-blue-500/15 text-blue-400',
  completed:  'bg-emerald-500/15 text-emerald-400',
  failed:     'bg-red-500/15 text-red-400',
};

function PayoutsTab({ payouts }: { payouts: Payout[] }) {
  const [submitting, setSubmitting] = useState<string | null>(null);

  const initiatePayout = async (payoutId: string, amount: number, beneficiary: string) => {
    setSubmitting(payoutId);
    try {
      await api.approvals.create({
        service: 'cashfree',
        action: 'initiate_payout',
        action_payload: { payout_id: payoutId, amount, beneficiary },
        requested_by: 'Finance Ops Agent',
        required_role: 'admin',
        expires_in_hours: 4,
      });
      toast.success('Payout approval requested — admin will be notified');
    } catch {
      toast.error('Failed to initiate payout');
    } finally {
      setSubmitting(null);
    }
  };

  const pending = payouts.filter(p => p.status === 'pending');
  const rest = payouts.filter(p => p.status !== 'pending');

  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">Pending Payouts ({pending.length})</h3>
          <div className="space-y-3">
            {pending.map(p => (
              <div key={p.id} className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{p.beneficiary}</p>
                    <p className="text-xs text-slate-500">{p.id} · {p.bankAccount}</p>
                    {p.scheduledAt && <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><Clock className="w-3 h-3" /> Scheduled: {fmtTime(p.scheduledAt)}</p>}
                  </div>
                  <p className="text-lg font-bold text-white shrink-0">{fmtINR(p.amount)}</p>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => initiatePayout(p.id, p.amount, p.beneficiary)}
                    disabled={submitting === p.id}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                  >
                    {submitting === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    Initiate Payout
                  </button>
                  <p className="text-xs text-slate-500 flex items-center">Requires admin approval</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-400 mb-3">All Payouts</h3>
        <div className="space-y-2">
          {rest.map(p => (
            <div key={p.id} className="rounded-xl border border-white/8 bg-white/3 p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{p.beneficiary}</p>
                <p className="text-xs text-slate-500">{p.id} · {p.bankAccount} · {fmtTime(p.createdAt)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-white">{fmtINR(p.amount)}</p>
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', PAYOUT_STATUS_COLOR[p.status])}>{p.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Payment Links (approval-gated creation)
──────────────────────────────────────────────────────────────────────────── */

const LINK_STATUS_COLOR: Record<string, string> = {
  active:  'bg-emerald-500/15 text-emerald-400',
  paid:    'bg-blue-500/15 text-blue-400',
  expired: 'bg-slate-500/15 text-slate-400',
};

function PaymentLinksTab() {
  const [creating, setCreating] = useState(false);

  const handleCreateLink = async () => {
    setCreating(true);
    try {
      await api.approvals.create({
        service: 'cashfree',
        action: 'create_payment_link',
        action_payload: { description: 'New payment link', amount: 0 },
        requested_by: 'Finance Ops Agent',
        required_role: 'manager',
        expires_in_hours: 24,
      });
      toast.success('Payment link creation request sent for approval');
    } catch {
      toast.error('Failed to request link creation');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={handleCreateLink}
          disabled={creating}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          Create Payment Link
        </button>
      </div>

      <div className="space-y-3">
        {MOCK_LINKS.map(link => (
          <div key={link.id} className="rounded-2xl border border-white/8 bg-white/3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', LINK_STATUS_COLOR[link.status])}>{link.status}</span>
                  {link.paidCount > 0 && <span className="text-xs text-slate-400">{link.paidCount} payment{link.paidCount > 1 ? 's' : ''}</span>}
                </div>
                <p className="text-sm font-medium text-white">{link.description}</p>
                <p className="text-xs text-slate-500 mt-0.5">{link.url}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {link.status === 'paid' ? `Paid ${fmtTime(link.paidAt!)}` : `Expires ${fmtTime(link.expiresAt)}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold text-white">{fmtINR(link.amount)}</p>
                <div className="flex gap-1 mt-1 justify-end">
                  <button onClick={() => { navigator.clipboard.writeText(link.url); toast.success('Link copied'); }}
                    className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
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
            <p className="text-xs text-white">{entry.desc}</p>
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
  { id: 'transactions', label: 'Transactions',   Icon: IndianRupee },
  { id: 'payouts',      label: 'Payouts',         Icon: Send },
  { id: 'links',        label: 'Payment Links',   Icon: Link2 },
  { id: 'activity',    label: 'Activity',         Icon: Activity },
] as const;

type TabId = typeof TABS[number]['id'];

export default function CashfreeWorkspace() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('transactions');
  const [loading, setLoading] = useState(true);
  const [txns, setTxns] = useState<CashfreeTransaction[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [showBanner, setShowBanner] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await api.unifiedConnectors?.executeAction?.('cashfree', 'list_transactions', {});
    } catch { /* fall through to sample records */ }
    setTxns(MOCK_TRANSACTIONS);
    setPayouts(MOCK_PAYOUTS);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const pendingPayouts = payouts.filter(p => p.status === 'pending').length;
  const totalReceived = txns.filter(t => t.type === 'payment' && t.status === 'success').reduce((a, t) => a + t.amount, 0);
  const failedCount = txns.filter(t => t.status === 'failed').length;

  return (
    <div className="h-full flex flex-col bg-[#0B0F1A] text-white">
      {/* Header */}
      <div className="border-b border-white/8 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard/apps')} className="p-1.5 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: '#1A73E8' }}>CF</div>
          <div>
            <h1 className="text-lg font-semibold">Cashfree Payments</h1>
            <p className="text-xs text-slate-400">Payments workspace</p>
          </div>
        </div>
        <button onClick={load} className="p-2 text-slate-400 hover:text-white transition-colors">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Quick stats */}
      <div className="border-b border-white/8 px-6 py-3 flex items-center gap-6 text-xs shrink-0">
        <span className="text-slate-400">Received <span className="text-emerald-400 font-semibold ml-1">{fmtINR(totalReceived)}</span></span>
        <span className="text-slate-400">Payouts Pending <span className="text-amber-400 font-semibold ml-1">{pendingPayouts}</span></span>
        <span className="text-slate-400">Failed Txns <span className={cn('font-semibold ml-1', failedCount > 0 ? 'text-red-400' : 'text-white')}>{failedCount}</span></span>
        <span className="text-slate-400">Settlement <span className="text-blue-400 font-semibold ml-1">T+2</span></span>
      </div>

      {/* Tabs */}
      <div className="border-b border-white/8 px-6 flex gap-1 shrink-0">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
              tab === id ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-white'
            )}>
            <Icon className="w-4 h-4" /> {label}
            {id === 'payouts' && pendingPayouts > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold">{pendingPayouts}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {showBanner && <AgentSuggestionBanner serviceId="cashfree" onDismiss={() => setShowBanner(false)} />}

        <ProductionTruthBanner title="Cashfree sample records visible" connectorName="Cashfree">
          This workspace currently displays sample transactions, payouts, payment links, and activity while the Cashfree production datasets are being mapped.
          Approval actions still create governed requests, but these amounts and records are not audit evidence.
        </ProductionTruthBanner>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            {tab === 'transactions' && <TransactionsTab txns={txns} />}
            {tab === 'payouts'      && <PayoutsTab payouts={payouts} />}
            {tab === 'links'        && <PaymentLinksTab />}
            {tab === 'activity'     && <ActivityTab />}
          </>
        )}
      </div>
    </div>
  );
}
