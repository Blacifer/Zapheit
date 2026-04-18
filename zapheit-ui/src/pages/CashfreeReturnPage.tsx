import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { api } from '../lib/api-client';
import type { PaymentOrder } from '../lib/api/payments';

type ViewState = 'loading' | 'success' | 'pending' | 'failed' | 'needs-login' | 'missing-order';

function formatAmount(amount: number, currency: string) {
  if (currency === 'INR') {
    return `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  }
  return `${currency} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function statusCopy(status: string): { tone: ViewState; title: string; detail: string } {
  if (status === 'paid') {
    return {
      tone: 'success',
      title: 'Payment received',
      detail: 'Your payment was verified. Our team will review it and begin the Audit engagement shortly.',
    };
  }
  if (status === 'pending' || status === 'created') {
    return {
      tone: 'pending',
      title: 'Payment still processing',
      detail: 'Cashfree has not marked this payment final yet. Retry the status check in a few moments.',
    };
  }
  return {
    tone: 'failed',
    title: 'Payment not completed',
    detail: 'This payment was cancelled, failed, or expired. Return to Billing & Data and start a new payment attempt if needed.',
  };
}

export default function CashfreeReturnPage() {
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const merchantOrderId = params.get('merchant_order_id') || '';

  const [viewState, setViewState] = useState<ViewState>(merchantOrderId ? 'loading' : 'missing-order');
  const [message, setMessage] = useState(merchantOrderId ? 'Checking payment status...' : 'Missing merchant order reference.');
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (shouldSync = true) => {
    if (!merchantOrderId) {
      setViewState('missing-order');
      setMessage('Missing merchant order reference.');
      return;
    }

    setRefreshing(true);
    const response = shouldSync
      ? await api.payments.syncOrderByMerchantOrderId(merchantOrderId)
      : await api.payments.getOrderByMerchantOrderId(merchantOrderId);
    setRefreshing(false);

    if (!response.success) {
      const error = response.error || 'Unable to verify payment.';
      if (error === 'Not authenticated') {
        setViewState('needs-login');
        setMessage('Please log in again with the same workspace account to verify this payment.');
        return;
      }
      if (/not found/i.test(error)) {
        setViewState('missing-order');
        setMessage('We could not find that payment order in your workspace.');
        return;
      }
      setViewState('failed');
      setMessage(error);
      return;
    }

    setOrder(response.data || null);
    const copy = statusCopy(response.data?.status || 'failed');
    setViewState(copy.tone);
    setMessage(copy.detail);
  };

  useEffect(() => {
    void load(true);
  }, []);

  const icon = viewState === 'success'
    ? <CheckCircle2 className="w-12 h-12 text-emerald-400" />
    : viewState === 'pending' || viewState === 'loading'
      ? <Clock3 className="w-12 h-12 text-amber-300" />
      : <AlertTriangle className="w-12 h-12 text-rose-300" />;

  const title = viewState === 'loading'
    ? 'Checking payment status'
    : viewState === 'needs-login'
      ? 'Log in to verify payment'
      : viewState === 'missing-order'
        ? 'Payment reference missing'
        : statusCopy(order?.status || 'failed').title;

  return (
    <div className="min-h-screen bg-[#020617] text-white flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-950/80 p-8 shadow-2xl shadow-black/30">
        <div className="flex items-center justify-center">{icon}</div>
        <div className="mt-6 text-center space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-400">Cashfree Return</p>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-slate-400 text-sm leading-relaxed">{message}</p>
        </div>

        {order && (
          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400">Offer</span>
              <span className="font-semibold text-white">{order.offerName}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400">Amount</span>
              <span className="font-semibold text-white">{formatAmount(order.amount, order.currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400">Status</span>
              <span className="font-semibold uppercase tracking-wide text-white">{order.status}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400">Merchant order</span>
              <span className="font-mono text-xs text-slate-300">{order.merchantOrderId}</span>
            </div>
            {order.providerOrderId && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-400">Cashfree order</span>
                <span className="font-mono text-xs text-slate-300">{order.providerOrderId}</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => void load(true)}
            disabled={refreshing || !merchantOrderId}
            className="flex-1 px-4 py-3 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-sm font-semibold text-white inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Check again
          </button>
          <button
            onClick={() => navigate('/dashboard/settings/billing_data')}
            className="flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-sm font-semibold text-white inline-flex items-center justify-center gap-2"
          >
            Back to Billing & Data
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {viewState === 'needs-login' && (
          <p className="mt-4 text-center text-sm text-slate-400">
            <Link to="/login" className="text-cyan-300 hover:text-cyan-200">Log in</Link>
            {' '}with the same workspace account, then return here and check again.
          </p>
        )}
      </div>
    </div>
  );
}