import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Receipt, CreditCard, TrendingUp, RefreshCw, Plus, X, Check, Loader2, Sparkles, AlertTriangle,
} from 'lucide-react';
import { DollarSign as DollarIcon } from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { HubLiveMetrics } from './hubs/HubLiveMetrics';
import type { IntegrationConfig } from './hubs/HubLiveMetrics';
import type { HubInvoice, HubExpense } from '../../types';

type TabId = 'invoices' | 'expenses' | 'runway';

const FINANCE_INTEGRATIONS: IntegrationConfig[] = [
  {
    connectorId: 'quickbooks',
    appName: 'QuickBooks',
    icon: <DollarIcon className="w-3.5 h-3.5 text-green-400" />,
    workspacePath: '/dashboard/apps/quickbooks/workspace',
    brandBg: 'bg-green-500/20',
    metrics: [
      { label: 'Unpaid Invoices', action: 'list_invoices', params: { limit: 100 }, transform: d => {
        if (!Array.isArray(d)) return '—';
        return d.filter((inv: any) => Number(inv.Balance) > 0).length;
      }},
      { label: 'Revenue Total', action: 'list_invoices', params: { limit: 100 }, transform: d => {
        if (!Array.isArray(d)) return '—';
        const sum = d.reduce((s: number, inv: any) => s + Number(inv.TotalAmt || 0), 0);
        if (sum >= 10000000) return `₹${(sum / 10000000).toFixed(1)}Cr`;
        if (sum >= 100000) return `₹${(sum / 100000).toFixed(1)}L`;
        return `₹${sum.toLocaleString('en-IN')}`;
      }},
      { label: 'Customers', action: 'list_customers', params: { limit: 1 }, transform: d => Array.isArray(d) ? d.length : '—' },
    ],
  },
];

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }

function confidenceColor(s: number | null | undefined) {
  if (s == null) return 'text-slate-500';
  if (s >= 80) return 'text-emerald-400';
  if (s >= 50) return 'text-amber-400';
  return 'text-rose-400';
}

function confidenceBg(s: number | null | undefined) {
  if (s == null) return 'bg-slate-800/50';
  if (s >= 80) return 'bg-emerald-500/15 border-emerald-500/30';
  if (s >= 50) return 'bg-amber-500/15 border-amber-500/30';
  return 'bg-rose-500/15 border-rose-500/30';
}

function statusBadge(s: string) {
  const m: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    paid: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    reimbursed: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    unmatched: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
    matched: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    exception: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  };
  return m[s] || m.pending;
}

function formatAmount(amount: number, currency?: string) {
  const c = currency || 'INR';
  if (c === 'INR') return `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  return `${c} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export default function FinanceHubPage() {
  const [tab, setTab] = useState<TabId>('invoices');
  const [busy, setBusy] = useState(false);
  const [invoices, setInvoices] = useState<HubInvoice[]>([]);
  const [expenses, setExpenses] = useState<HubExpense[]>([]);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('');
  const [invoiceMatchFilter, setInvoiceMatchFilter] = useState('');
  const [expenseStatusFilter, setExpenseStatusFilter] = useState('');
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [showCreateExpense, setShowCreateExpense] = useState(false);

  const loadInvoices = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.hubs.finance.listInvoices({ status: invoiceStatusFilter || undefined, matched_status: invoiceMatchFilter || undefined, limit: 200 });
      if (res.success && res.data) setInvoices(res.data);
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  }, [invoiceStatusFilter, invoiceMatchFilter]);

  const loadExpenses = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.hubs.finance.listExpenses({ status: expenseStatusFilter || undefined, limit: 200 });
      if (res.success && res.data) setExpenses(res.data);
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  }, [expenseStatusFilter]);

  useEffect(() => { void loadInvoices(); }, [invoiceStatusFilter, invoiceMatchFilter]);
  useEffect(() => { void loadExpenses(); }, [expenseStatusFilter]);

  const handleValidateInvoice = async (id: string) => {
    setBusy(true);
    try {
      const res = await api.hubs.finance.validateInvoice(id);
      if (res.success) { toast.success('Invoice validated'); void loadInvoices(); }
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const handleUpdateInvoice = async (id: string, data: Record<string, any>) => {
    try {
      const res = await api.hubs.finance.updateInvoice(id, data);
      if (res.success) { toast.success('Invoice updated'); void loadInvoices(); }
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
  };

  const handleValidateExpense = async (id: string) => {
    setBusy(true);
    try {
      const res = await api.hubs.finance.validateExpense(id);
      if (res.success) { toast.success('Expense validated'); void loadExpenses(); }
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const handleUpdateExpense = async (id: string, data: Record<string, any>) => {
    try {
      const res = await api.hubs.finance.updateExpense(id, data);
      if (res.success) { toast.success('Expense updated'); void loadExpenses(); }
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
  };

  // Runway stats
  const stats = useMemo(() => {
    const pendingInv = invoices.filter(i => i.status === 'pending');
    const pendingExp = expenses.filter(e => e.status === 'pending');
    const approvedInv = invoices.filter(i => i.status === 'approved' || i.status === 'paid');
    const flagged = [...invoices.filter(i => (i.ai_flags?.length || 0) > 0), ...expenses.filter(e => (e.ai_flags?.length || 0) > 0)];
    return {
      pendingInvCount: pendingInv.length, pendingInvSum: pendingInv.reduce((s, i) => s + Number(i.amount), 0),
      pendingExpCount: pendingExp.length, pendingExpSum: pendingExp.reduce((s, e) => s + Number(e.amount), 0),
      approvedSum: approvedInv.reduce((s, i) => s + Number(i.amount), 0),
      flaggedCount: flagged.length, flaggedItems: flagged,
    };
  }, [invoices, expenses]);

  const tabs = [
    { id: 'invoices' as const, label: 'Invoices', icon: Receipt },
    { id: 'expenses' as const, label: 'Expenses', icon: CreditCard },
    { id: 'runway' as const, label: 'Runway', icon: TrendingUp },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Finance Hub</h1>
          <p className="text-sm text-slate-400 mt-1">Invoice matching, expense validation, and runway tracking powered by AI.</p>
        </div>
        <button onClick={() => { void loadInvoices(); void loadExpenses(); }} disabled={busy} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700 inline-flex items-center gap-2 disabled:opacity-60">
          <RefreshCw className={cx('w-4 h-4', busy && 'animate-spin')} /> Refresh
        </button>
      </div>

      <HubLiveMetrics configs={FINANCE_INTEGRATIONS} />

      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cx(
            'px-3 py-1.5 rounded-full text-xs border inline-flex items-center gap-2',
            tab === t.id ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-slate-800/30 text-slate-300 border-slate-700 hover:bg-slate-800/60'
          )}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ═══ INVOICES ═══ */}
      {tab === 'invoices' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select value={invoiceStatusFilter} onChange={e => setInvoiceStatusFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All statuses</option>
              {['pending', 'approved', 'rejected', 'paid'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <select value={invoiceMatchFilter} onChange={e => setInvoiceMatchFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All matches</option>
              {['unmatched', 'matched', 'exception'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <div className="flex-1" />
            <button onClick={() => setShowCreateInvoice(true)} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Invoice
            </button>
          </div>

          {invoices.length === 0 ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <Receipt className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No invoices found.</p>
            </div>
          ) : (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-800/60">
              {invoices.map(inv => (
                <div key={inv.id} className="p-4">
                  <div className="flex items-start gap-4">
                    <div className={cx('w-14 h-14 rounded-full border flex flex-col items-center justify-center shrink-0', confidenceBg(inv.ai_match_confidence))}>
                      {inv.ai_match_confidence != null ? (
                        <><span className={cx('text-lg font-bold', confidenceColor(inv.ai_match_confidence))}>{inv.ai_match_confidence}</span><span className="text-[8px] text-slate-500 -mt-0.5">match</span></>
                      ) : (<span className="text-xs text-slate-500">N/A</span>)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-semibold">{inv.vendor_name}</span>
                        {inv.invoice_number && <span className="text-xs text-slate-400">#{inv.invoice_number}</span>}
                        <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', statusBadge(inv.status))}>{inv.status}</span>
                        <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold border', statusBadge(inv.matched_status))}>{inv.matched_status}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm">
                        <span className="text-emerald-400 font-semibold">{formatAmount(inv.amount, inv.currency)}</span>
                        {inv.due_date && <span className="text-xs text-slate-400">Due: {new Date(inv.due_date).toLocaleDateString()}</span>}
                        {inv.po_number && <span className="text-xs text-slate-500">PO: {inv.po_number}</span>}
                      </div>
                      {inv.ai_flags && inv.ai_flags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {inv.ai_flags.map((f, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> {f.type}: {f.detail}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!inv.ai_validated_at && <button onClick={() => handleValidateInvoice(inv.id)} disabled={busy} className="p-2 rounded-lg text-purple-400 hover:bg-purple-500/10 disabled:opacity-40" title="Validate"><Sparkles className="w-4 h-4" /></button>}
                      {inv.status === 'pending' && <button onClick={() => handleUpdateInvoice(inv.id, { status: 'approved' })} className="p-2 rounded-lg text-emerald-400 hover:bg-emerald-500/10" title="Approve"><Check className="w-4 h-4" /></button>}
                      {inv.status === 'pending' && <button onClick={() => handleUpdateInvoice(inv.id, { status: 'rejected' })} className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10" title="Reject"><X className="w-4 h-4" /></button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ EXPENSES ═══ */}
      {tab === 'expenses' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select value={expenseStatusFilter} onChange={e => setExpenseStatusFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All statuses</option>
              {['pending', 'approved', 'rejected', 'reimbursed'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <div className="flex-1" />
            <button onClick={() => setShowCreateExpense(true)} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Expense
            </button>
          </div>

          {expenses.length === 0 ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <CreditCard className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No expenses found.</p>
            </div>
          ) : (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-800/60">
              {expenses.map(exp => (
                <div key={exp.id} className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full border flex items-center justify-center shrink-0 bg-slate-800/50">
                      {exp.ai_policy_compliant === true && <Check className="w-5 h-5 text-emerald-400" />}
                      {exp.ai_policy_compliant === false && <X className="w-5 h-5 text-rose-400" />}
                      {exp.ai_policy_compliant == null && <span className="text-slate-500 text-xs">?</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-semibold">{exp.claimant_name}</span>
                        {exp.category && <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/15 text-blue-300 border border-blue-500/30">{exp.category}</span>}
                        <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', statusBadge(exp.status))}>{exp.status}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-emerald-400 font-semibold text-sm">{formatAmount(exp.amount, exp.currency)}</span>
                        {exp.expense_date && <span className="text-xs text-slate-400">{new Date(exp.expense_date).toLocaleDateString()}</span>}
                        {exp.claimant_email && <span className="text-xs text-slate-500">{exp.claimant_email}</span>}
                      </div>
                      {exp.description && <p className="text-sm text-slate-400 mt-1 line-clamp-2">{exp.description}</p>}
                      {exp.ai_flags && exp.ai_flags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {exp.ai_flags.map((f, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> {f.type}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!exp.ai_validated_at && <button onClick={() => handleValidateExpense(exp.id)} disabled={busy} className="p-2 rounded-lg text-purple-400 hover:bg-purple-500/10 disabled:opacity-40" title="Validate"><Sparkles className="w-4 h-4" /></button>}
                      {exp.status === 'pending' && <button onClick={() => handleUpdateExpense(exp.id, { status: 'approved' })} className="p-2 rounded-lg text-emerald-400 hover:bg-emerald-500/10" title="Approve"><Check className="w-4 h-4" /></button>}
                      {exp.status === 'pending' && <button onClick={() => handleUpdateExpense(exp.id, { status: 'rejected' })} className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10" title="Reject"><X className="w-4 h-4" /></button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ RUNWAY ═══ */}
      {tab === 'runway' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Pending Invoices', value: `${stats.pendingInvCount} / ${formatAmount(stats.pendingInvSum)}`, color: 'text-amber-400' },
              { label: 'Pending Expenses', value: `${stats.pendingExpCount} / ${formatAmount(stats.pendingExpSum)}`, color: 'text-amber-400' },
              { label: 'Approved Total', value: formatAmount(stats.approvedSum), color: 'text-emerald-400' },
              { label: 'Flagged Items', value: String(stats.flaggedCount), color: stats.flaggedCount > 0 ? 'text-rose-400' : 'text-emerald-400' },
            ].map((s, i) => (
              <div key={i} className="bg-slate-800/30 border border-slate-700 rounded-xl p-4">
                <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                <p className={cx('text-lg font-bold', s.color)}>{s.value}</p>
              </div>
            ))}
          </div>

          {stats.flaggedCount > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-white mb-3">Flagged Items</h3>
              <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-800/60">
                {stats.flaggedItems.sort((a, b) => Number(b.amount) - Number(a.amount)).map((item) => (
                  <div key={item.id} className="p-3 flex items-center gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-white text-sm flex-1">{'vendor_name' in item ? (item as HubInvoice).vendor_name : (item as HubExpense).claimant_name}</span>
                    <span className="text-emerald-400 text-sm font-semibold">{formatAmount(Number(item.amount))}</span>
                    <div className="flex gap-1">
                      {(item.ai_flags || []).map((f: any, i: number) => (
                        <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30">{f.type}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showCreateInvoice && <CreateInvoiceDrawer onClose={() => setShowCreateInvoice(false)} onCreated={() => { setShowCreateInvoice(false); void loadInvoices(); }} />}
      {showCreateExpense && <CreateExpenseDrawer onClose={() => setShowCreateExpense(false)} onCreated={() => { setShowCreateExpense(false); void loadExpenses(); }} />}
    </div>
  );
}

function CreateInvoiceDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ vendor_name: '', invoice_number: '', amount: '', due_date: '', po_number: '', notes: '' });
  const handleSubmit = async () => {
    if (!form.vendor_name.trim() || !form.amount) { toast.error('Vendor and amount required'); return; }
    setSaving(true);
    try {
      const res = await api.hubs.finance.createInvoice({ vendor_name: form.vendor_name.trim(), invoice_number: form.invoice_number.trim() || undefined, amount: Number(form.amount), due_date: form.due_date || undefined, po_number: form.po_number.trim() || undefined, notes: form.notes.trim() || undefined } as any);
      if (res.success) { toast.success('Invoice created'); onCreated(); } else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end"><div className="absolute inset-0 bg-black/50" onClick={onClose} /><div className="relative w-full max-w-lg h-full border-l border-white/10 bg-slate-900 p-6 overflow-auto">
      <div className="flex items-center justify-between mb-6"><h2 className="text-xl font-bold text-white">Add Invoice</h2><button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button></div>
      <div className="space-y-4">
        <div><label className="text-sm text-slate-300 block mb-1">Vendor *</label><input value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" placeholder="Vendor name" /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="text-sm text-slate-300 block mb-1">Invoice #</label><input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          <div><label className="text-sm text-slate-300 block mb-1">Amount (INR) *</label><input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="text-sm text-slate-300 block mb-1">Due Date</label><input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" /></div>
          <div><label className="text-sm text-slate-300 block mb-1">PO Number</label><input value={form.po_number} onChange={e => setForm(f => ({ ...f, po_number: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
        </div>
      </div>
      <div className="mt-6 flex gap-3"><button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700">Cancel</button><button onClick={handleSubmit} disabled={saving} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Invoice</button></div>
    </div></div>
  );
}

function CreateExpenseDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ claimant_name: '', claimant_email: '', category: '', amount: '', description: '', expense_date: '' });
  const handleSubmit = async () => {
    if (!form.claimant_name.trim() || !form.amount) { toast.error('Claimant and amount required'); return; }
    setSaving(true);
    try {
      const res = await api.hubs.finance.createExpense({ claimant_name: form.claimant_name.trim(), claimant_email: form.claimant_email.trim() || undefined, category: form.category || undefined, amount: Number(form.amount), description: form.description.trim() || undefined, expense_date: form.expense_date || undefined } as any);
      if (res.success) { toast.success('Expense created'); onCreated(); } else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end"><div className="absolute inset-0 bg-black/50" onClick={onClose} /><div className="relative w-full max-w-lg h-full border-l border-white/10 bg-slate-900 p-6 overflow-auto">
      <div className="flex items-center justify-between mb-6"><h2 className="text-xl font-bold text-white">Add Expense</h2><button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button></div>
      <div className="space-y-4">
        <div><label className="text-sm text-slate-300 block mb-1">Claimant Name *</label><input value={form.claimant_name} onChange={e => setForm(f => ({ ...f, claimant_name: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="text-sm text-slate-300 block mb-1">Email</label><input type="email" value={form.claimant_email} onChange={e => setForm(f => ({ ...f, claimant_email: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          <div><label className="text-sm text-slate-300 block mb-1">Category</label><select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"><option value="">Select...</option><option value="travel">Travel</option><option value="meals">Meals</option><option value="software">Software</option><option value="equipment">Equipment</option><option value="other">Other</option></select></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="text-sm text-slate-300 block mb-1">Amount (INR) *</label><input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          <div><label className="text-sm text-slate-300 block mb-1">Date</label><input type="date" value={form.expense_date} onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" /></div>
        </div>
        <div><label className="text-sm text-slate-300 block mb-1">Description</label><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 resize-y" /></div>
      </div>
      <div className="mt-6 flex gap-3"><button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700">Cancel</button><button onClick={handleSubmit} disabled={saving} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Expense</button></div>
    </div></div>
  );
}
