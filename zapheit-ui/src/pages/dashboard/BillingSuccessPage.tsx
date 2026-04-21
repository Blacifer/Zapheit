import { useEffect, useState } from 'react';
import { CheckCircle, Clock, AlertTriangle, ArrowRight } from 'lucide-react';
import { authenticatedFetch } from '../../lib/api/_helpers';

interface VerifyResult {
  status: 'paid' | 'pending' | 'failed' | string;
  plan: string | null;
}

const PLAN_LABELS: Record<string, string> = { pro: 'Pro', business: 'Business', enterprise: 'Enterprise' };

export default function BillingSuccessPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [status, setStatus] = useState<'loading' | 'paid' | 'pending' | 'failed'>('loading');
  const [plan, setPlan] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order_id');
    if (!orderId) { setStatus('failed'); return; }

    let attempts = 0;
    const poll = async () => {
      try {
        const res = await authenticatedFetch<{ success: boolean; data: VerifyResult }>(`/billing/verify/${orderId}`);
        const data = (res as any)?.data as VerifyResult | undefined;
        if (data?.status === 'paid') {
          setPlan(data.plan);
          setStatus('paid');
        } else if (attempts < 5) {
          attempts++;
          setTimeout(poll, 3000);
        } else {
          setStatus('pending');
        }
      } catch {
        setStatus('failed');
      }
    };
    void poll();
  }, []);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md w-full text-center space-y-6 px-4">
        {status === 'loading' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-cyan-500/15 border border-cyan-500/20">
              <Clock className="h-8 w-8 text-cyan-400 animate-pulse" />
            </div>
            <div>
              <p className="text-xl font-bold text-white">Confirming your payment…</p>
              <p className="mt-2 text-sm text-slate-400">This usually takes a few seconds.</p>
            </div>
          </>
        )}

        {status === 'paid' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/20">
              <CheckCircle className="h-8 w-8 text-emerald-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-white">
                Welcome to {plan ? (PLAN_LABELS[plan] || plan) : 'your new plan'}!
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Your account has been upgraded. Your new limits are active immediately.
              </p>
            </div>
            <button
              onClick={() => onNavigate?.('overview')}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 text-sm font-semibold text-white hover:bg-cyan-400 transition-colors"
            >
              Go to dashboard
              <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}

        {status === 'pending' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 border border-amber-500/20">
              <Clock className="h-8 w-8 text-amber-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-white">Payment received — activating soon</p>
              <p className="mt-2 text-sm text-slate-400">
                Your payment was successful. Your plan upgrade will be active within a few minutes.
                You'll receive a confirmation email at the address you provided.
              </p>
            </div>
            <button
              onClick={() => onNavigate?.('usage')}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-6 py-3 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-colors"
            >
              Check usage & plan
              <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}

        {status === 'failed' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/15 border border-rose-500/20">
              <AlertTriangle className="h-8 w-8 text-rose-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-white">Something went wrong</p>
              <p className="mt-2 text-sm text-slate-400">
                We couldn't verify your payment status. If you were charged, please contact{' '}
                <a href="mailto:support@zapheit.com" className="text-cyan-400 hover:underline">
                  support@zapheit.com
                </a>
                .
              </p>
            </div>
            <button
              onClick={() => onNavigate?.('usage')}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
            >
              Back to dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
