import { useEffect, useState } from 'react';
import { BarChart3, RefreshCw, ArrowRight, Zap, Users, Bot, Clock, AlertTriangle } from 'lucide-react';
import { authenticatedFetch } from '../../lib/api/_helpers';

interface UsageData {
  plan: string;
  used: number;
  quota: number;
  agentCount?: number;
  agentLimit?: number;
  memberCount?: number;
  memberLimit?: number;
  resetDate?: string;
}

interface UsageBar {
  label: string;
  used: number;
  limit: number;
  unit: string;
  icon: React.ElementType;
  unlimited?: boolean;
}

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function barColor(p: number): string {
  if (p >= 90) return 'bg-rose-500';
  if (p >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function textColor(p: number): string {
  if (p >= 90) return 'text-rose-300';
  if (p >= 70) return 'text-amber-300';
  return 'text-slate-300';
}

const PLAN_ORDER = ['free', 'pro', 'business', 'enterprise'];
const PLAN_LABELS: Record<string, string> = { free: 'Free', pro: 'Pro', business: 'Business', enterprise: 'Enterprise' };
const NEXT_PLAN: Record<string, string> = { free: 'Pro', pro: 'Business', business: 'Enterprise', enterprise: '' };

export default function UsagePage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authenticatedFetch<UsageData>('/usage');
      if ('error' in res) throw new Error(res.error as string);
      setData(res as UsageData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load usage data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const plan = (data?.plan || 'free').toLowerCase();
  const nextPlan = NEXT_PLAN[plan];
  const isEnterprise = plan === 'enterprise';
  const resetLabel = data?.resetDate ? new Date(data.resetDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'end of month';

  const bars: UsageBar[] = data ? [
    {
      label: 'AI messages this month',
      used: data.used,
      limit: data.quota,
      unit: 'messages',
      icon: Zap,
      unlimited: data.quota === -1,
    },
    ...(data.agentLimit !== undefined ? [{
      label: 'AI assistants',
      used: data.agentCount ?? 0,
      limit: data.agentLimit,
      unit: 'assistants',
      icon: Bot,
      unlimited: data.agentLimit === -1,
    }] : []),
    ...(data.memberLimit !== undefined ? [{
      label: 'Team members',
      used: data.memberCount ?? 0,
      limit: data.memberLimit,
      unit: 'members',
      icon: Users,
      unlimited: data.memberLimit === -1,
    }] : []),
  ] : [];

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-cyan-400" />
            Usage & Spending
          </h1>
          <p className="text-sm text-slate-400 mt-1">Your plan limits and how much you've used this month.</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Plan badge */}
      {data && (
        <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 border border-cyan-500/20">
              <BarChart3 className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{PLAN_LABELS[plan] || plan} Plan</p>
              <p className="text-xs text-slate-400 mt-0.5">Resets {resetLabel}</p>
            </div>
          </div>
          {nextPlan && (
            <button
              onClick={() => onNavigate?.('settings')}
              className="flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-colors"
            >
              Upgrade to {nextPlan}
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Usage bars */}
      {loading && !data && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5 animate-pulse">
              <div className="h-4 w-48 rounded bg-slate-700 mb-3" />
              <div className="h-2 rounded-full bg-slate-700" />
            </div>
          ))}
        </div>
      )}

      {bars.map((bar) => {
        const p = bar.unlimited ? 0 : pct(bar.used, bar.limit);
        return (
          <div key={bar.label} className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <bar.icon className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-200">{bar.label}</span>
              </div>
              {bar.unlimited ? (
                <span className="text-xs text-emerald-400 font-semibold">Unlimited</span>
              ) : (
                <span className={`text-xs font-semibold tabular-nums ${textColor(p)}`}>
                  {bar.used.toLocaleString('en-IN')} / {bar.limit.toLocaleString('en-IN')} {bar.unit}
                </span>
              )}
            </div>
            {!bar.unlimited && (
              <>
                <div className="h-2.5 rounded-full bg-slate-700/60 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor(p)}`}
                    style={{ width: `${p}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className={`text-xs ${p >= 70 ? textColor(p) : 'text-slate-500'}`}>
                    {p >= 90
                      ? 'Almost at your limit — upgrade to avoid interruption'
                      : p >= 70
                        ? `${100 - p}% remaining this month`
                        : `${100 - p}% remaining`}
                  </span>
                  <span className="text-xs text-slate-500">{p}%</span>
                </div>
              </>
            )}
          </div>
        );
      })}

      {/* Upgrade banner for free plan */}
      {data && plan === 'free' && (
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06] p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15">
              <Clock className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">You're on the Free plan</p>
              <p className="text-sm text-slate-400 mt-1">
                Free gives you 1 AI assistant and 1,000 messages/month — great for getting started.
                Upgrade to Pro for 10 assistants, 50,000 messages/month, and 90-day activity history.
              </p>
              <button
                onClick={() => onNavigate?.('settings')}
                className="mt-4 flex items-center gap-1.5 rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-400 transition-colors"
              >
                Upgrade to Pro — from ₹4,999/mo
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overage pricing note */}
      {data && (plan === 'pro' || plan === 'business') && !isEnterprise && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <p className="text-xs text-slate-500">
            {plan === 'pro'
              ? "Pro overage: \u20b90.40 per message after 50,000. You'll receive an email alert at 50%, 80%, and 100% of your limit."
              : "Business overage: \u20b90.30 per message after 2,50,000. You'll receive an email alert at 50%, 80%, and 100% of your limit."}
          </p>
        </div>
      )}
    </div>
  );
}
