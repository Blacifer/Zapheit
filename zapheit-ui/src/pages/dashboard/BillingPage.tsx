import { useEffect, useState } from 'react';
import {
  CheckCircle2, Loader2, ArrowRight, CreditCard, Receipt,
  Zap, Shield, Building2, Star, AlertCircle, RefreshCw,
} from 'lucide-react';
import { authenticatedFetch } from '../../lib/api/_helpers';
import { cn } from '../../lib/utils';
import { toast } from '../../lib/toast';

/* ─────────────────────────────────────────────────────────────────────────
   Types
──────────────────────────────────────────────────────────────────────────── */

type Plan = 'free' | 'pro' | 'business' | 'enterprise';
type Cycle = 'monthly' | 'annual';
type OfferCode = 'pro_monthly' | 'pro_annual' | 'business_monthly' | 'business_annual';
type OrderStatus = 'created' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired';

interface BillingStatus {
  plan: Plan;
  plan_tier: Record<string, any>;
  grace_period_ends_at: string | null;
  recent_orders: Array<{
    id: string;
    merchant_order_id: string;
    offer_name: string;
    amount: number;
    status: OrderStatus;
    paid_at: string | null;
    created_at: string;
  }>;
}

interface CheckoutForm {
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  company_name: string;
}

function invoiceRequestUrl(order: BillingStatus['recent_orders'][number]) {
  const subject = encodeURIComponent(`Invoice request for ${order.merchant_order_id}`);
  const body = encodeURIComponent([
    `Please send the GST invoice for order ${order.merchant_order_id}.`,
    `Plan: ${order.offer_name}`,
    `Amount: ${order.amount}`,
  ].join('\n'));
  return `mailto:billing@zapheit.com?subject=${subject}&body=${body}`;
}

/* ─────────────────────────────────────────────────────────────────────────
   Plan definitions
──────────────────────────────────────────────────────────────────────────── */

const PLAN_FEATURES: Record<'free' | 'pro' | 'business', { icon: React.FC<{ className?: string }>; color: string; features: string[]; agentLimit: string; requestLimit: string }> = {
  free: {
    icon: Zap,
    color: 'border-slate-700 bg-white/[0.02]',
    agentLimit: '2 agents',
    requestLimit: '500 req / mo',
    features: [
      '2 AI agents',
      '500 governed requests / month',
      'Basic audit log (30 days)',
      'greytHR + Naukri connectors',
      'Email support',
    ],
  },
  pro: {
    icon: Star,
    color: 'border-blue-500/40 bg-blue-500/[0.04]',
    agentLimit: '10 agents',
    requestLimit: '10,000 req / mo',
    features: [
      '10 AI agents',
      '10,000 governed requests / month',
      'Full audit log (90 days)',
      'All 150+ connectors',
      'WhatsApp approvals',
      'NL Policy Builder',
      'Session recording',
      'Priority support',
    ],
  },
  business: {
    icon: Building2,
    color: 'border-violet-500/40 bg-violet-500/[0.04]',
    agentLimit: 'Unlimited agents',
    requestLimit: 'Unlimited req',
    features: [
      'Unlimited AI agents',
      'Unlimited governed requests',
      'Full audit log (1 year)',
      'All connectors + custom adapters',
      'SSO / SAML',
      'Custom approval workflows',
      'SLA-backed support',
      'Dedicated account manager',
      'On-premise deployment option',
    ],
  },
};

const PRICES: Record<Cycle, Record<'pro' | 'business', { amount: number; offerCode: OfferCode }>> = {
  monthly: {
    pro:      { amount: 4_999,   offerCode: 'pro_monthly' },
    business: { amount: 19_999,  offerCode: 'business_monthly' },
  },
  annual: {
    pro:      { amount: 49_999,  offerCode: 'pro_annual' },
    business: { amount: 1_99_999, offerCode: 'business_annual' },
  },
};

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────── */

function formatINR(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

function planLabel(plan: string): string {
  const m: Record<string, string> = { free: 'Free', pro: 'Pro', business: 'Business', enterprise: 'Enterprise' };
  return m[plan] ?? plan;
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  paid:      'text-emerald-400 border-emerald-400/20 bg-emerald-500/[0.07]',
  pending:   'text-amber-400 border-amber-400/20 bg-amber-500/[0.07]',
  created:   'text-slate-400 border-slate-600/40 bg-white/[0.04]',
  failed:    'text-rose-400 border-rose-400/20 bg-rose-500/[0.07]',
  cancelled: 'text-slate-500 border-slate-600/40 bg-white/[0.03]',
  expired:   'text-slate-500 border-slate-600/40 bg-white/[0.03]',
};

/* ─────────────────────────────────────────────────────────────────────────
   Checkout modal
──────────────────────────────────────────────────────────────────────────── */

function CheckoutModal({
  offerCode,
  offerLabel,
  amount,
  onClose,
}: {
  offerCode: OfferCode;
  offerLabel: string;
  amount: number;
  onClose: () => void;
}) {
  const [form, setForm] = useState<CheckoutForm>({
    customer_name: '', customer_email: '', customer_phone: '', company_name: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const set = (k: keyof CheckoutForm, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const ready = form.customer_name.trim() && form.customer_email.trim() && form.customer_phone.trim().length >= 10;

  const handleCheckout = async () => {
    setSubmitting(true);
    try {
      const res = await authenticatedFetch<{
        data?: { checkout_url?: string; merchant_order_id?: string };
      }>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
          offer_code: offerCode,
          customer_name: form.customer_name.trim(),
          customer_email: form.customer_email.trim(),
          customer_phone: form.customer_phone.trim(),
          company_name: form.company_name.trim() || undefined,
        }),
      });

      const checkoutUrl = (res as any)?.data?.checkout_url;
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      } else {
        toast.error('Could not generate checkout URL. Please try again or contact support.');
        setSubmitting(false);
      }
    } catch {
      toast.error('Checkout failed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1829] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold text-white">Upgrade to {offerLabel}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{formatINR(amount)} — via Cashfree</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors">✕</button>
        </div>

        <div className="space-y-3">
          {([
            { k: 'customer_name' as const,  label: 'Full name',         type: 'text',  placeholder: 'Priya Sharma' },
            { k: 'customer_email' as const, label: 'Work email',        type: 'email', placeholder: 'priya@acme.in' },
            { k: 'customer_phone' as const, label: 'Phone (10 digits)', type: 'tel',   placeholder: '9876543210' },
            { k: 'company_name' as const,   label: 'Company (optional)',type: 'text',  placeholder: 'Acme Pvt Ltd' },
          ] as const).map(({ k, label, type, placeholder }) => (
            <div key={k}>
              <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
              <input
                type={type}
                value={form[k]}
                onChange={(e) => set(k, e.target.value)}
                placeholder={placeholder}
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] p-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="text-[11px] text-slate-400">Payments secured by Cashfree. 18% GST will be added. Invoice sent to your email.</p>
        </div>

        <div className="flex items-center justify-between mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
          <button
            disabled={!ready || submitting}
            onClick={() => void handleCheckout()}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            Pay {formatINR(amount)}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Plan card
──────────────────────────────────────────────────────────────────────────── */

function PlanCard({
  planKey,
  currentPlan,
  cycle,
  onUpgrade,
}: {
  planKey: 'free' | 'pro' | 'business';
  currentPlan: Plan;
  cycle: Cycle;
  onUpgrade: (offerCode: OfferCode, label: string, amount: number) => void;
}) {
  const def = PLAN_FEATURES[planKey];
  const Icon = def.icon;
  const isCurrent = currentPlan === planKey;
  const isPaid = planKey !== 'free';
  const pricing = isPaid ? PRICES[cycle][planKey as 'pro' | 'business'] : null;
  const monthlyEquiv = pricing ? (cycle === 'annual' ? Math.round(pricing.amount / 12) : pricing.amount) : 0;
  const annualSaving = planKey !== 'free' ? Math.round((PRICES.monthly[planKey as 'pro' | 'business'].amount * 12 - PRICES.annual[planKey as 'pro' | 'business'].amount)) : 0;

  const isDowngrade = (currentPlan === 'business' && planKey === 'pro') || (currentPlan !== 'free' && planKey === 'free');

  return (
    <div className={cn('relative rounded-2xl border p-6 flex flex-col gap-4', def.color, isCurrent && 'ring-2 ring-blue-500/40')}>
      {isCurrent && (
        <span className="absolute top-4 right-4 text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 font-medium">Current plan</span>
      )}
      {planKey === 'pro' && !isCurrent && (
        <span className="absolute top-4 right-4 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 font-medium">Most popular</span>
      )}

      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: planKey === 'free' ? '#ffffff0a' : planKey === 'pro' ? '#3b82f615' : '#8b5cf615', border: `1px solid ${planKey === 'free' ? '#ffffff15' : planKey === 'pro' ? '#3b82f630' : '#8b5cf630'}` }}>
          <Icon className={cn('w-4 h-4', planKey === 'free' ? 'text-slate-400' : planKey === 'pro' ? 'text-blue-400' : 'text-violet-400')} />
        </div>
        <div>
          <p className="text-sm font-bold text-white">{planLabel(planKey)}</p>
          <p className="text-[11px] text-slate-500">{def.agentLimit} · {def.requestLimit}</p>
        </div>
      </div>

      {/* Price */}
      <div>
        {planKey === 'free' ? (
          <p className="text-2xl font-bold text-white">₹0 <span className="text-sm font-normal text-slate-500">/ month</span></p>
        ) : (
          <div>
            <p className="text-2xl font-bold text-white">
              {formatINR(monthlyEquiv)} <span className="text-sm font-normal text-slate-500">/ month</span>
            </p>
            {cycle === 'annual' && (
              <p className="text-[11px] text-emerald-400 mt-0.5">Save {formatINR(annualSaving)} / year — billed as {formatINR(pricing!.amount)}</p>
            )}
          </div>
        )}
      </div>

      {/* Features */}
      <ul className="space-y-2 flex-1">
        {def.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs text-slate-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            {f}
          </li>
        ))}
      </ul>

      {/* CTA */}
      {isCurrent ? (
        <button disabled className="w-full py-2.5 rounded-xl bg-white/[0.06] text-slate-500 text-sm font-semibold cursor-default">
          Your current plan
        </button>
      ) : isDowngrade ? (
        <button disabled className="w-full py-2.5 rounded-xl border border-slate-700 text-slate-600 text-sm cursor-default">
          Downgrade (contact support)
        </button>
      ) : planKey === 'free' ? (
        <button disabled className="w-full py-2.5 rounded-xl border border-slate-700 text-slate-500 text-sm cursor-default">
          Free forever
        </button>
      ) : (
        <button
          onClick={() => onUpgrade(pricing!.offerCode, `${planLabel(planKey)} (${cycle})`, pricing!.amount)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
        >
          Upgrade to {planLabel(planKey)} <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Page
──────────────────────────────────────────────────────────────────────────── */

export default function BillingPage({ onNavigate }: { onNavigate?: (route: string) => void }) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [checkout, setCheckout] = useState<{ offerCode: OfferCode; label: string; amount: number } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await authenticatedFetch<{ data: BillingStatus }>('/billing/status');
      if ((res as any)?.data) setStatus((res as any).data);
    } catch { /* silently ignore */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const currentPlan: Plan = status?.plan ?? 'free';

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[#080b12]">
      <div className="max-w-5xl mx-auto w-full px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Billing & Subscription</h1>
            <p className="text-sm text-slate-400 mt-1">
              Current plan: <span className="text-white font-semibold">{planLabel(currentPlan)}</span>
              {status?.grace_period_ends_at && (
                <span className="ml-2 text-amber-400">· Grace period ends {new Date(status.grace_period_ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              )}
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="p-2 rounded-lg hover:bg-white/[0.07] text-slate-500 hover:text-slate-300 transition-colors"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>

        {/* Annual / Monthly toggle */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCycle('monthly')}
            className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-colors', cycle === 'monthly' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300')}
          >
            Monthly
          </button>
          <button
            onClick={() => setCycle('annual')}
            className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2', cycle === 'annual' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300')}
          >
            Annual
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-semibold">Save ~16%</span>
          </button>
        </div>

        {/* Plan cards */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl border border-white/8 bg-white/[0.02] h-72 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {(['free', 'pro', 'business'] as const).map((p) => (
              <PlanCard
                key={p}
                planKey={p}
                currentPlan={currentPlan}
                cycle={cycle}
                onUpgrade={(offerCode, label, amount) => setCheckout({ offerCode, label, amount })}
              />
            ))}
          </div>
        )}

        {/* Enterprise callout */}
        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-5 flex items-center gap-4">
          <Shield className="w-8 h-8 text-violet-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Enterprise plan</p>
            <p className="text-xs text-slate-400 mt-0.5">Custom pricing · On-premise · SOC2 Type II · Dedicated CSM · Custom SLA. Contact us for a quote.</p>
          </div>
          <a
            href="mailto:enterprise@zapheit.com"
            className="shrink-0 px-4 py-2 rounded-xl border border-violet-500/30 bg-violet-500/10 text-violet-300 text-sm font-semibold hover:bg-violet-500/20 transition-colors"
          >
            Contact sales
          </a>
        </div>

        {/* Payment history */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Receipt className="w-4 h-4 text-slate-400" /> Payment history
            </h2>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1].map((i) => <div key={i} className="h-14 rounded-xl bg-white/[0.03] animate-pulse" />)}
            </div>
          ) : !status?.recent_orders?.length ? (
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-6 text-center">
              <p className="text-sm text-slate-500">No payments yet.</p>
              <p className="text-xs text-slate-600 mt-1">Upgrade to a paid plan and your invoices will appear here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {status.recent_orders.map((order) => (
                <div key={order.id} className="flex items-center gap-4 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{order.offer_name}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {order.paid_at
                        ? `Paid ${new Date(order.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                        : `Created ${new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                      {' · '}#{order.merchant_order_id}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-white shrink-0">{formatINR(order.amount)}</p>
                  <span className={cn('text-[11px] px-2 py-0.5 rounded-full border font-medium capitalize shrink-0', STATUS_STYLE[order.status])}>
                    {order.status}
                  </span>
                  {order.status === 'paid' && (
                    <a
                      href={invoiceRequestUrl(order)}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors shrink-0"
                    >
                      Request invoice
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* GST note */}
        <div className="flex items-start gap-2 text-[11px] text-slate-500 pb-4">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>All prices are exclusive of 18% GST. GST invoices are issued to the billing email on file. For GST credit, ensure your GSTIN is on record — contact <a href="mailto:billing@zapheit.com" className="text-blue-400/70 hover:underline">billing@zapheit.com</a>.</p>
        </div>
      </div>

      {/* Checkout modal */}
      {checkout && (
        <CheckoutModal
          offerCode={checkout.offerCode}
          offerLabel={checkout.label}
          amount={checkout.amount}
          onClose={() => setCheckout(null)}
        />
      )}
    </div>
  );
}
