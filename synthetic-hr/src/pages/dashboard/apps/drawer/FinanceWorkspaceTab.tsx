import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, CreditCard, Receipt, RefreshCw, Sparkles, TrendingUp, X } from 'lucide-react';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import type { HubExpense, HubInvoice } from '../../../../types';
import type { UnifiedApp } from '../types';

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }

function confidenceColor(s: number | null | undefined) {
  if (s == null) return 'text-slate-500';
  if (s >= 80) return 'text-emerald-400';
  if (s >= 50) return 'text-amber-400';
  return 'text-rose-400';
}

function confidenceBg(s: number | null | undefined) {
  if (s == null) return 'bg-slate-800/50 border-slate-700/40';
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

interface FinanceWorkspaceTabProps {
  app: UnifiedApp;
  agentNames: string[];
}

export function FinanceWorkspaceTab({ app, agentNames }: FinanceWorkspaceTabProps) {
  const [busy, setBusy] = useState(false);
  const [invoices, setInvoices] = useState<HubInvoice[]>([]);
  const [expenses, setExpenses] = useState<HubExpense[]>([]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [invoiceRes, expenseRes] = await Promise.all([
        api.hubs.finance.listInvoices({ limit: 40 }),
        api.hubs.finance.listExpenses({ limit: 40 }),
      ]);
      if (invoiceRes.success && invoiceRes.data) setInvoices(invoiceRes.data);
      if (expenseRes.success && expenseRes.data) setExpenses(expenseRes.data);
      if (!invoiceRes.success) toast.error(invoiceRes.error || 'Failed to load invoices');
      if (!expenseRes.success) toast.error(expenseRes.error || 'Failed to load expenses');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const pendingInvoices = invoices.filter((invoice) => invoice.status === 'pending');
    const pendingExpenses = expenses.filter((expense) => expense.status === 'pending');
    const flagged = [
      ...invoices.filter((invoice) => (invoice.ai_flags?.length || 0) > 0),
      ...expenses.filter((expense) => (expense.ai_flags?.length || 0) > 0),
    ];
    return {
      pendingInvoiceCount: pendingInvoices.length,
      pendingInvoiceSum: pendingInvoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0),
      pendingExpenseCount: pendingExpenses.length,
      pendingExpenseSum: pendingExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0),
      flaggedCount: flagged.length,
    };
  }, [expenses, invoices]);

  const handleValidateInvoice = async (id: string) => {
    const res = await api.hubs.finance.validateInvoice(id);
    if (res.success) {
      toast.success('Invoice validated');
      await load();
    } else {
      toast.error(res.error || 'Validation failed');
    }
  };

  const handleValidateExpense = async (id: string) => {
    const res = await api.hubs.finance.validateExpense(id);
    if (res.success) {
      toast.success('Expense validated');
      await load();
    } else {
      toast.error(res.error || 'Validation failed');
    }
  };

  const handleUpdateInvoice = async (id: string, status: string) => {
    const res = await api.hubs.finance.updateInvoice(id, { status });
    if (res.success) {
      toast.success(`Invoice ${status}`);
      await load();
    } else {
      toast.error(res.error || 'Update failed');
    }
  };

  const handleUpdateExpense = async (id: string, status: string) => {
    const res = await api.hubs.finance.updateExpense(id, { status });
    if (res.success) {
      toast.success(`Expense ${status}`);
      await load();
    } else {
      toast.error(res.error || 'Update failed');
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">Finance workspace</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{app.name} finance operations inside Rasi</h3>
            <p className="mt-1 text-sm text-slate-400">Monitor invoice match confidence, validate expenses, and keep approvals and exception handling inside one controlled workspace.</p>
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
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Pending invoices</p>
            <p className="mt-2 text-2xl font-semibold text-white">{stats.pendingInvoiceCount}</p>
            <p className="mt-1 text-xs text-slate-500">{formatAmount(stats.pendingInvoiceSum)}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Pending expenses</p>
            <p className="mt-2 text-2xl font-semibold text-white">{stats.pendingExpenseCount}</p>
            <p className="mt-1 text-xs text-slate-500">{formatAmount(stats.pendingExpenseSum)}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Flagged items</p>
            <p className="mt-2 text-2xl font-semibold text-white">{stats.flaggedCount}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Linked agents</p>
            <p className="mt-2 text-2xl font-semibold text-white">{agentNames.length}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
          <div className="border-b border-white/8 px-4 py-3">
            <h4 className="text-sm font-semibold text-white">Invoice review</h4>
          </div>
          <div className="divide-y divide-white/6">
            {invoices.length === 0 ? (
              <div className="px-4 py-10 text-sm text-slate-500">No invoices available.</div>
            ) : invoices.slice(0, 10).map((invoice) => (
              <div key={invoice.id} className="px-4 py-4">
                <div className="flex items-start gap-4">
                  <div className={cx('flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full border', confidenceBg(invoice.ai_match_confidence))}>
                    <span className={cx('text-sm font-bold', confidenceColor(invoice.ai_match_confidence))}>{invoice.ai_match_confidence ?? '—'}</span>
                    <span className="text-[8px] text-slate-500">match</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-white">{invoice.vendor_name}</p>
                      <span className={cx('rounded-full border px-2 py-0.5 text-[10px] uppercase', statusBadge(invoice.status))}>{invoice.status}</span>
                      <span className={cx('rounded-full border px-2 py-0.5 text-[10px] uppercase', statusBadge(invoice.matched_status))}>{invoice.matched_status}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{formatAmount(invoice.amount, invoice.currency)} {invoice.invoice_number ? `• #${invoice.invoice_number}` : ''}</p>
                    {(invoice.ai_flags?.length || 0) > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {invoice.ai_flags?.slice(0, 3).map((flag, index) => (
                          <span key={index} className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                            <AlertTriangle className="h-3 w-3" />
                            {flag.type}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!invoice.ai_validated_at && (
                      <button onClick={() => void handleValidateInvoice(invoice.id)} className="rounded-lg p-2 text-purple-300 hover:bg-purple-500/10" title="Validate">
                        <Sparkles className="h-4 w-4" />
                      </button>
                    )}
                    {invoice.status === 'pending' && (
                      <>
                        <button onClick={() => void handleUpdateInvoice(invoice.id, 'approved')} className="rounded-lg p-2 text-emerald-300 hover:bg-emerald-500/10" title="Approve">
                          <Check className="h-4 w-4" />
                        </button>
                        <button onClick={() => void handleUpdateInvoice(invoice.id, 'rejected')} className="rounded-lg p-2 text-rose-300 hover:bg-rose-500/10" title="Reject">
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
            <div className="border-b border-white/8 px-4 py-3">
              <h4 className="text-sm font-semibold text-white">Expense review</h4>
            </div>
            <div className="divide-y divide-white/6">
              {expenses.length === 0 ? (
                <div className="px-4 py-10 text-sm text-slate-500">No expenses available.</div>
              ) : expenses.slice(0, 8).map((expense) => (
                <div key={expense.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-white">{expense.claimant_name}</p>
                        <span className={cx('rounded-full border px-2 py-0.5 text-[10px] uppercase', statusBadge(expense.status))}>{expense.status}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-400">{formatAmount(expense.amount, expense.currency)} {expense.category ? `• ${expense.category}` : ''}</p>
                      {expense.ai_flags?.length ? (
                        <p className="mt-1 text-xs text-amber-300">{expense.ai_flags[0].detail}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {!expense.ai_validated_at && (
                        <button onClick={() => void handleValidateExpense(expense.id)} className="rounded-lg p-2 text-purple-300 hover:bg-purple-500/10" title="Validate">
                          <Sparkles className="h-4 w-4" />
                        </button>
                      )}
                      {expense.status === 'pending' && (
                        <>
                          <button onClick={() => void handleUpdateExpense(expense.id, 'approved')} className="rounded-lg p-2 text-emerald-300 hover:bg-emerald-500/10" title="Approve">
                            <Check className="h-4 w-4" />
                          </button>
                          <button onClick={() => void handleUpdateExpense(expense.id, 'rejected')} className="rounded-lg p-2 text-rose-300 hover:bg-rose-500/10" title="Reject">
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-300" />
              <h4 className="text-sm font-semibold text-white">Runway snapshot</h4>
            </div>
            <p className="mt-3 text-sm text-slate-400">Use this workspace to triage finance exceptions before letting agents or operators trigger outbound payment or accounting actions.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
                <div className="flex items-center gap-2 text-slate-300"><Receipt className="h-4 w-4 text-blue-300" />Invoices</div>
                <p className="mt-2 text-lg font-semibold text-white">{invoices.length}</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
                <div className="flex items-center gap-2 text-slate-300"><CreditCard className="h-4 w-4 text-violet-300" />Expenses</div>
                <p className="mt-2 text-lg font-semibold text-white">{expenses.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
