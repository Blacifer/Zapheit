import { useEffect, useState } from 'react';
import { load as loadCashfree } from '@cashfreepayments/cashfree-js';
import { CreditCard, Download, ExternalLink, RefreshCw, Save, TrendingUp } from 'lucide-react';
import { api } from '../../../lib/api-client';
import { getFrontendConfig } from '../../../lib/config';
import { supabase } from '../../../lib/supabase-client';
import type { PaymentOffer, PaymentOrder } from '../../../lib/api/payments';
import { toast } from '../../../lib/toast';

function formatAmount(amount: number, currency: string) {
  if (currency === 'INR') {
    return `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  }
  return `${currency} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

type BillingReviewState = {
  state?: string;
  fulfillment_mode?: string;
  latest_payment?: {
    payment_order_id?: string;
    merchant_order_id?: string;
    offer_name?: string;
    amount?: number;
    currency?: string;
    status?: string;
    paid_at?: string;
  };
  review_queue?: {
    status?: string;
    work_item_id?: string | null;
    queued_at?: string;
  };
};

export function BillingDataSection({
  usageData,
  orgName,
  setOrgName,
  dataRetention,
  setDataRetention,
  handleSaveOrg,
  savingOrg,
  setShowUpgradeModal,
  handleExportAllData,
  exportingData,
  billingContactName,
  billingContactEmail,
}: {
  usageData: { used: number; quota: number; plan: string; planKey: string; month: string } | null;
  orgName: string;
  setOrgName: React.Dispatch<React.SetStateAction<string>>;
  dataRetention: number;
  setDataRetention: React.Dispatch<React.SetStateAction<number>>;
  handleSaveOrg: () => void;
  savingOrg: boolean;
  setShowUpgradeModal: React.Dispatch<React.SetStateAction<boolean>>;
  handleExportAllData: () => void;
  exportingData: boolean;
  billingContactName: string;
  billingContactEmail: string;
}) {
  const usagePct = usageData && usageData.quota > 0 ? Math.min(100, Math.round((usageData.used / usageData.quota) * 100)) : 0;
  const barColor = usagePct >= 90 ? 'bg-rose-500' : usagePct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  const usageLabel = usageData
    ? usageData.quota === -1
      ? 'Unlimited requests'
      : `${usageData.used.toLocaleString()} / ${usageData.quota.toLocaleString()} requests`
    : null;

  const [offers, setOffers] = useState<PaymentOffer[]>([]);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [paymentLoadError, setPaymentLoadError] = useState<string | null>(null);
  const [billingReviewState, setBillingReviewState] = useState<BillingReviewState | null>(null);
  const [customerName, setCustomerName] = useState(billingContactName);
  const [customerEmail, setCustomerEmail] = useState(billingContactEmail);
  const [customerPhone, setCustomerPhone] = useState('');

  const auditOffer = offers[0] || null;

  useEffect(() => {
    setCustomerName((prev) => prev || billingContactName);
  }, [billingContactName]);

  useEffect(() => {
    setCustomerEmail((prev) => prev || billingContactEmail);
  }, [billingContactEmail]);

  useEffect(() => {
    let cancelled = false;

    const loadBillingReviewState = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
      const response = await fetch(`${apiUrl}/organizations/settings`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!response.ok) {
        throw new Error('Unable to load billing state.');
      }

      const json = await response.json();
      return (json?.data?.rasi_billing || null) as BillingReviewState | null;
    };

    const loadPayments = async () => {
      setLoadingPayments(true);
      setPaymentLoadError(null);

      const [offerRes, orderRes, billingStateRes] = await Promise.all([
        api.payments.listOffers(),
        api.payments.listOrders({ limit: 5 }),
        loadBillingReviewState(),
      ]);

      if (cancelled) return;

      setBillingReviewState(billingStateRes);

      if (offerRes.success && offerRes.data) {
        setOffers(offerRes.data);
      } else if (offerRes.error && offerRes.error !== 'Not authenticated') {
        setPaymentLoadError(offerRes.error);
      }

      if (orderRes.success && orderRes.data) {
        setOrders(orderRes.data);
      } else if (orderRes.error && orderRes.error !== 'Not authenticated') {
        setPaymentLoadError((prev) => prev || orderRes.error || 'Unable to load payment history.');
      }

      setLoadingPayments(false);
    };

    void loadPayments();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshOrders = async () => {
    setLoadingPayments(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
      const [response, settingsResponse] = await Promise.all([
        api.payments.listOrders({ limit: 5 }),
        session
          ? fetch(`${apiUrl}/organizations/settings`, {
              headers: { Authorization: `Bearer ${session.access_token}` },
            })
          : Promise.resolve(null),
      ]);

      if (response.success && response.data) {
        setOrders(response.data);
        setPaymentLoadError(null);
      } else if (response.error) {
        setPaymentLoadError(response.error);
      }

      if (settingsResponse?.ok) {
        const json = await settingsResponse.json();
        setBillingReviewState((json?.data?.rasi_billing || null) as BillingReviewState | null);
      }
    } catch (error: any) {
      setPaymentLoadError(error?.message || 'Unable to refresh payment history.');
    }
    setLoadingPayments(false);
  };

  const handleStartAuditPayment = async () => {
    if (!customerName.trim()) {
      toast.warning('Enter the billing contact name first.');
      return;
    }
    if (!customerEmail.trim()) {
      toast.warning('Enter the billing contact email first.');
      return;
    }
    if (!/^[0-9]{10,15}$/.test(customerPhone.trim())) {
      toast.warning('Enter a valid billing contact phone number.');
      return;
    }

    setStartingCheckout(true);
    const response = await api.payments.createOrder({
      offerCode: 'audit',
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      customerPhone: customerPhone.trim(),
      companyName: orgName.trim() || undefined,
      returnPath: '/billing/cashfree/return',
    });
    setStartingCheckout(false);

    if (!response.success || !response.checkout?.paymentSessionId) {
      toast.error(response.error || 'Unable to start Cashfree checkout.');
      return;
    }

    try {
      const cashfree = await loadCashfree({
        mode: response.checkout.environment,
      });

      if (!cashfree) {
        toast.error('Cashfree checkout could not be initialized in this environment.');
        return;
      }

      const checkoutResult = await cashfree.checkout({
        paymentSessionId: response.checkout.paymentSessionId,
        returnUrl: response.checkout.returnUrl,
        redirectTarget: '_self',
      });

      if (checkoutResult?.error?.message) {
        toast.error(checkoutResult.error.message);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Cashfree checkout failed to open.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Billing &amp; Data</h2>
        <p className="text-slate-400 text-sm">Manage plan capacity, retention, data portability, and the first Cashfree payment flow for the whole workspace.</p>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Plan &amp; Usage</h3>
          {usageData && (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">
              {usageData.plan}
            </span>
          )}
        </div>
        {usageData ? (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-400">Gateway requests this month</span>
                <span className={`font-mono font-semibold ${usagePct >= 90 ? 'text-rose-300' : usagePct >= 80 ? 'text-amber-300' : 'text-slate-300'}`}>
                  {usageData.quota === -1 ? 'Unlimited' : `${usagePct}%`}
                </span>
              </div>
              {usageData.quota !== -1 && (
                <div className="h-2 w-full rounded-full bg-slate-700/60 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${usagePct}%` }} />
                </div>
              )}
              {usageLabel && <p className="text-xs text-slate-500 mt-1.5 font-mono">{usageLabel}</p>}
            </div>
            {usageData.quota !== -1 && usagePct >= 80 && (
              <div className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs ${usagePct >= 90 ? 'border-rose-500/20 bg-rose-500/5 text-rose-300' : 'border-amber-500/20 bg-amber-500/5 text-amber-300'}`}>
                <TrendingUp className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>{usagePct >= 90 ? 'You\'ve used over 90% of your monthly quota. Upgrade to avoid request blocking.' : 'You\'re approaching your monthly quota. Consider upgrading your plan.'}</span>
              </div>
            )}
            {usageData.planKey !== 'enterprise' && (
              <div className="flex justify-end">
                <button
                  onClick={() => setShowUpgradeModal(true)}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-semibold hover:from-cyan-500/20 hover:to-blue-500/20 transition-all"
                >
                  View plans &amp; upgrade →
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="h-3 rounded-full bg-slate-700/60 animate-pulse w-full" />
            <div className="h-3 rounded-full bg-slate-700/40 animate-pulse w-2/3" />
          </div>
        )}
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white">Cashfree Payments</h3>
            <p className="text-sm text-slate-400 mt-1">Create a hosted checkout for The Audit and review the most recent payment attempts for this workspace.</p>
          </div>
          <button
            onClick={() => void refreshOrders()}
            disabled={loadingPayments}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingPayments ? 'animate-spin' : ''}`} />
            Refresh payments
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-cyan-500/15 bg-[linear-gradient(180deg,rgba(34,211,238,0.08),rgba(15,23,42,0.45))] p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Hosted Checkout</p>
                <h4 className="mt-2 text-xl font-bold text-white">{auditOffer?.name || 'The Audit'}</h4>
                <p className="mt-1 text-sm text-slate-300">{auditOffer?.description || 'One-time AI governance assessment'}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-white">{auditOffer ? formatAmount(auditOffer.amount, auditOffer.currency) : '₹25,000.00'}</p>
                <p className="text-xs text-slate-400">INR only</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 mb-2">Billing contact name</label>
                <input
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  className="w-full px-4 py-3 bg-slate-950/70 border border-slate-700 text-white rounded-xl outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 mb-2">Billing email</label>
                <input
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  className="w-full px-4 py-3 bg-slate-950/70 border border-slate-700 text-white rounded-xl outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  placeholder="name@company.com"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 mb-2">Billing phone</label>
                <input
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value.replace(/[^0-9]/g, '').slice(0, 15))}
                  className="w-full px-4 py-3 bg-slate-950/70 border border-slate-700 text-white rounded-xl outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  placeholder="10-15 digit mobile number"
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4 text-sm text-slate-300">
              Cashfree opens a hosted checkout and returns the browser to the app afterward. For this first rollout, successful payments are recorded immediately and then reviewed manually before fulfillment.
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void handleStartAuditPayment()}
                disabled={startingCheckout || loadingPayments}
                className="px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
              >
                <CreditCard className="w-4 h-4" />
                {startingCheckout ? 'Opening checkout…' : 'Pay for The Audit'}
              </button>
              <button
                onClick={() => setShowUpgradeModal(true)}
                className="px-5 py-3 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-sm font-semibold text-slate-200 inline-flex items-center gap-2"
              >
                View plans
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/55 p-5 space-y-4">
            <div>
              <h4 className="text-base font-semibold text-white">Recent payment attempts</h4>
              <p className="mt-1 text-sm text-slate-400">Latest Cashfree order records for this workspace.</p>
            </div>

            {paymentLoadError && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                {paymentLoadError}
              </div>
            )}

            {loadingPayments ? (
              <div className="space-y-3">

          {billingReviewState?.state === 'payment_received_pending_review' && (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-emerald-300">Payment received and queued for manual review</p>
                <span className="text-[11px] uppercase tracking-[0.16em] text-emerald-200/80">pending review</span>
              </div>
              <p className="text-sm text-emerald-100/90">Cashfree has confirmed the payment. Fulfillment is intentionally held until an operator reviews and closes the queue item.</p>
              {billingReviewState.latest_payment && (
                <p className="text-xs text-emerald-100/70">
                  Latest payment: {billingReviewState.latest_payment.offer_name || 'The Audit'} · {typeof billingReviewState.latest_payment.amount === 'number' && billingReviewState.latest_payment.currency
                    ? formatAmount(billingReviewState.latest_payment.amount, billingReviewState.latest_payment.currency)
                    : 'Amount pending'}
                </p>
              )}
              {billingReviewState.review_queue?.work_item_id && (
                <p className="text-xs font-mono text-emerald-100/60 break-all">
                  Review work item: {billingReviewState.review_queue.work_item_id}
                </p>
              )}
            </div>
          )}
                <div className="h-16 rounded-xl bg-slate-800 animate-pulse" />
                <div className="h-16 rounded-xl bg-slate-800 animate-pulse" />
              </div>
            ) : orders.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                No payment attempts recorded yet.
              </div>
            ) : (
              <div className="space-y-3">
                {orders.map((order) => (
                  <div key={order.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-white">{order.offerName}</span>
                      <span className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${order.status === 'paid' ? 'text-emerald-300' : order.status === 'pending' || order.status === 'created' ? 'text-amber-300' : 'text-rose-300'}`}>
                        {order.status}
                      </span>
                    </div>
                    <div className="text-sm text-slate-300">{formatAmount(order.amount, order.currency)}</div>
                    <div className="text-xs text-slate-500 font-mono break-all">{order.merchantOrderId}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-5">
        <h3 className="text-base font-semibold text-white">Workspace Data Controls</h3>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Billing Workspace Name</label>
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-xl outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Data Retention Period <span className="text-cyan-400 font-bold">{dataRetention} days</span>
          </label>
          <input
            type="range"
            min={30}
            max={365}
            step={30}
            value={dataRetention}
            onChange={(e) => setDataRetention(parseInt(e.target.value, 10))}
            className="w-full accent-cyan-500"
          />
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            <span>30 days</span><span>6 months</span><span>1 year</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">Incident logs, agent activity, and audit trails are retained for this duration before automatic deletion. Higher retention improves forensic depth but increases storage footprint.</p>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={handleSaveOrg} disabled={savingOrg} className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-xl flex items-center gap-2 hover:from-cyan-400 hover:to-blue-400 transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/20">
            {savingOrg ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savingOrg ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white">Data Portability</h3>
          <p className="text-sm text-slate-400 mt-1">Your data is yours — export or delete it at any time. Exports include agents, conversations, incidents, policies, audit logs, cost records, and webhooks.</p>
        </div>
        <div className="flex items-center justify-between p-4 bg-slate-900/50 border border-slate-700/30 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
              <Download className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Export all my data</p>
              <p className="text-xs text-slate-500">Downloads a ZIP archive with all your organization's data as JSON files.</p>
            </div>
          </div>
          <button
            onClick={handleExportAllData}
            disabled={exportingData}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-all disabled:opacity-50 flex-shrink-0 ml-4"
          >
            {exportingData ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exportingData ? 'Exporting…' : 'Export ZIP'}
          </button>
        </div>
      </div>
    </div>
  );
}
