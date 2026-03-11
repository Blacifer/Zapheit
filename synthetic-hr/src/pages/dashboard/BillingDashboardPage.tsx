import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CreditCard,
  Download,
  FileText,
  Landmark,
  Loader2,
  Receipt,
  Save,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  AreaChart,
  Area as RechartsArea,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis as RechartsXAxis,
  YAxis as RechartsYAxis,
} from 'recharts';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';

const Area = RechartsArea as any;
const XAxis = RechartsXAxis as any;
const YAxis = RechartsYAxis as any;
const Tooltip = RechartsTooltip as any;

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value || 0);
};

const formatNumber = (value: number) => {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(value || 0);
};

type BillingProfile = {
  legalName: string;
  gstin: string;
  billingEmail: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
};

type BudgetControls = {
  monthlyLimit: number;
  warnAt: number;
  criticalAt: number;
  hardCap: boolean;
};

type InvoiceRecord = {
  id: string;
  period: string;
  subtotal: number;
  gst: number;
  total: number;
  status: 'paid' | 'due' | 'draft';
  issuedOn: string;
};

const DEFAULT_BILLING_PROFILE: BillingProfile = {
  legalName: 'Rasi Solutions Pvt. Ltd.',
  gstin: '',
  billingEmail: 'finance@rasisolutions.com',
  addressLine: '',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '',
};

const DEFAULT_BUDGET_CONTROLS: BudgetControls = {
  monthlyLimit: 250,
  warnAt: 60,
  criticalAt: 85,
  hardCap: false,
};

const DEMO_INVOICES: InvoiceRecord[] = [];

export default function BillingDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [billingProfile, setBillingProfile] = useState<BillingProfile>(DEFAULT_BILLING_PROFILE);
  const [budgetControls, setBudgetControls] = useState<BudgetControls>(DEFAULT_BUDGET_CONTROLS);
  const [insights, setInsights] = useState<{
    totalCost: number;
    totalTokens: number;
    avgCostPerRequest: number;
    avgTokensPerRequest: number;
    topAgents: Array<{ agentId: string; cost: number }>;
    costByModel: Record<string, { cost: number; tokens: number; requests: number }>;
    dailyAverage: number;
  }>({
    totalCost: 0,
    totalTokens: 0,
    avgCostPerRequest: 0,
    avgTokensPerRequest: 0,
    topAgents: [],
    costByModel: {},
    dailyAverage: 0,
  });
  const [trend, setTrend] = useState<Array<{ date: string; cost: number; tokens: number; requests: number }>>([]);
  const [comparison, setComparison] = useState<{
    agents: Array<{ agentId: string; agentName: string; cost: number; tokens: number; requests: number }>;
    models: Array<{ model: string; cost: number; tokens: number; requests: number }>;
  }>({ agents: [], models: [] });
  const [recommendations, setRecommendations] = useState<Array<{
    type: 'model_downgrade' | 'model_optimization';
    priority: 'low' | 'medium' | 'high';
    from?: string;
    to?: string;
    agent?: string;
    current?: string;
    recommendation?: string;
    agents?: string[];
    currentCost?: number;
    estimatedSavings: number;
    percentSavings?: number;
    rationale: string;
  }>>([]);

  useEffect(() => {
    let cancelled = false;

    const loadBillingData = async () => {
      setLoading(true);
      setError(null);

      const [insightsRes, trendRes, comparisonRes, recommendationsRes] = await Promise.all([
        api.costs.getInsights(),
        api.costs.getTrend({ days: 30 }),
        api.costs.getComparison(),
        api.costs.getOptimizationRecommendations(),
      ]);

      if (cancelled) return;

      const failedResponse = [insightsRes, trendRes, comparisonRes, recommendationsRes].find((response) => !response.success);
      if (failedResponse) {
        setError(failedResponse.error || 'Failed to load billing data.');
        setLoading(false);
        return;
      }

      const normalizedInsights = (insightsRes as any).insights ?? insightsRes.data?.insights;
      const normalizedTrend = (trendRes as any).trend ?? trendRes.data?.trend;
      const normalizedComparison = (comparisonRes as any).comparison ?? comparisonRes.data?.comparison;
      const normalizedRecommendations = (recommendationsRes as any).recommendations ?? recommendationsRes.data?.recommendations;

      setInsights(normalizedInsights || {
        totalCost: 0,
        totalTokens: 0,
        avgCostPerRequest: 0,
        avgTokensPerRequest: 0,
        topAgents: [],
        costByModel: {},
        dailyAverage: 0,
      });
      setTrend(normalizedTrend || []);
      setComparison(normalizedComparison || { agents: [], models: [] });
      setRecommendations(normalizedRecommendations || []);
      setLoading(false);
    };

    void loadBillingData();

    return () => {
      cancelled = true;
    };
  }, []);

  const projectedCost = useMemo(() => {
    if (trend.length === 0) return insights.totalCost;
    const now = new Date();
    const currentDay = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (currentDay <= 0) return insights.totalCost;
    return (insights.totalCost / currentDay) * daysInMonth;
  }, [insights.totalCost, trend.length]);

  const spendRemaining = Math.max(0, budgetControls.monthlyLimit - projectedCost);
  const percentageUsed = budgetControls.monthlyLimit > 0
    ? Math.min((projectedCost / budgetControls.monthlyLimit) * 100, 100)
    : 0;
  const percentageRemaining = Math.max(0, 100 - percentageUsed);

  const trendChartData = trend.map((entry) => ({
    ...entry,
    label: new Date(entry.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
  }));

  const topModels = comparison.models.slice(0, 5);
  const topAgents = comparison.agents.slice(0, 5);

  const saveBudgetControls = () => {
    toast.success('Budget controls saved locally. Wire a billing settings API next to persist them.');
  };

  const saveBillingProfile = () => {
    toast.success('Billing profile saved locally. Wire invoice settings persistence next to make this authoritative.');
  };

  const usageStatus = percentageUsed >= budgetControls.criticalAt
    ? 'critical'
    : percentageUsed >= budgetControls.warnAt
      ? 'warning'
      : 'healthy';

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col gap-4 border-b border-slate-800/80 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Plan, Billing & Invoices</h1>
          <p className="mt-2 max-w-3xl text-slate-400">
            Finance operations for your AI fleet. Runtime usage is live from the cost APIs; invoices and tax settings are explicit until a billing system is wired.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-400">
          <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-emerald-300">
            Live usage data
          </div>
          <div className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-amber-300">
            Invoices not connected yet
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">
          <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Billing data could not be loaded</p>
            <p className="text-sm text-rose-200/80">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <SummaryCard
          title="Month-to-date usage"
          value={formatCurrency(insights.totalCost)}
          detail={loading ? 'Loading runtime cost...' : 'Live runtime spend from cost tracking'}
          accent="from-amber-500/15 to-rose-500/15"
          border="border-amber-500/30"
        />
        <SummaryCard
          title="Projected month-end"
          value={formatCurrency(projectedCost)}
          detail="Forecast from current month spend velocity"
          accent="from-cyan-500/15 to-blue-500/15"
          border="border-cyan-500/30"
        />
        <SummaryCard
          title="Budget remaining"
          value={formatCurrency(spendRemaining)}
          detail={`${percentageRemaining.toFixed(0)}% remaining of configured limit`}
          accent="from-violet-500/15 to-fuchsia-500/15"
          border="border-violet-500/30"
        />
        <SummaryCard
          title="Billing status"
          value={DEMO_INVOICES.length > 0 ? 'Invoices live' : 'Usage only'}
          detail={DEMO_INVOICES.length > 0 ? 'Invoices and tax records available' : 'Invoice generation not wired yet'}
          accent="from-emerald-500/15 to-teal-500/15"
          border="border-emerald-500/30"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.35)]">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-white">
                <TrendingUp className="h-5 w-5 text-emerald-400" />
                Usage Intelligence
              </h2>
              <p className="mt-1 text-sm text-slate-400">Live runtime usage by trend, model, and agent.</p>
            </div>
            <div className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              usageStatus === 'critical'
                ? 'border border-rose-500/30 bg-rose-500/10 text-rose-300'
                : usageStatus === 'warning'
                  ? 'border border-amber-500/30 bg-amber-500/10 text-amber-300'
                  : 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            }`}>
              {usageStatus === 'critical' ? 'Critical budget pressure' : usageStatus === 'warning' ? 'Budget watch' : 'Within budget'}
            </div>
          </div>

          <div className="mb-8 h-80 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
            {loading ? (
              <div className="flex h-full items-center justify-center text-slate-400">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Loading usage trend
              </div>
            ) : trendChartData.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="No runtime usage recorded yet"
                description="This chart will populate after agents generate billable requests. Until then, projected spend and invoices should remain at zero."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendChartData} margin={{ top: 10, right: 12, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="billingTrendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `₹${value}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(15, 23, 42, 0.96)',
                      border: '1px solid rgba(51, 65, 85, 0.8)',
                      borderRadius: '16px',
                      color: '#fff',
                    }}
                    formatter={(value: number) => [formatCurrency(value), 'Cost']}
                  />
                  <Area type="monotone" dataKey="cost" stroke="#22c55e" strokeWidth={3} fill="url(#billingTrendGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <MetricListCard
              title="Top cost drivers by model"
              emptyTitle="No model spend yet"
              emptyDescription="Model-level breakdown appears after runtime cost entries are recorded."
              items={topModels.map((item) => ({
                label: item.model,
                meta: `${formatNumber(item.requests)} requests • ${formatNumber(item.tokens)} tokens`,
                value: formatCurrency(item.cost),
              }))}
            />
            <MetricListCard
              title="Top cost drivers by agent"
              emptyTitle="No agent spend yet"
              emptyDescription="Agent ranking appears once active agents start generating requests."
              items={topAgents.map((item) => ({
                label: item.agentName,
                meta: `${formatNumber(item.requests)} requests • ${formatNumber(item.tokens)} tokens`,
                value: formatCurrency(item.cost),
              }))}
            />
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-bold text-white">
                  <CreditCard className="h-5 w-5 text-cyan-400" />
                  Plan & Controls
                </h2>
                <p className="mt-1 text-sm text-slate-400">Current plan position and budget guardrails.</p>
              </div>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300">
                Starter
              </span>
            </div>

            <div className="mb-5 rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 to-blue-500/10 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-400">Current plan</p>
                  <p className="mt-1 text-2xl font-bold text-white">Starter</p>
                  <p className="mt-2 text-sm text-slate-300">Usage is live. Subscription billing, payment method storage, and invoice generation still need a billing provider.</p>
                </div>
                <button className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20">
                  Compare plans
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <LabeledNumberInput
                label="Monthly budget limit"
                value={budgetControls.monthlyLimit}
                min={0}
                step={10}
                prefix="₹"
                onChange={(value) => setBudgetControls((prev) => ({ ...prev, monthlyLimit: value }))}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LabeledNumberInput
                  label="Warn threshold"
                  value={budgetControls.warnAt}
                  min={10}
                  max={100}
                  step={5}
                  suffix="%"
                  onChange={(value) => setBudgetControls((prev) => ({ ...prev, warnAt: value }))}
                />
                <LabeledNumberInput
                  label="Critical threshold"
                  value={budgetControls.criticalAt}
                  min={10}
                  max={100}
                  step={5}
                  suffix="%"
                  onChange={(value) => setBudgetControls((prev) => ({ ...prev, criticalAt: value }))}
                />
              </div>
              <label className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-white">Hard cap</p>
                  <p className="text-xs text-slate-400">Block new spend when the projected limit is crossed.</p>
                </div>
                <input
                  type="checkbox"
                  checked={budgetControls.hardCap}
                  onChange={(event) => setBudgetControls((prev) => ({ ...prev, hardCap: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-cyan-400 focus:ring-cyan-500"
                />
              </label>
              <button
                onClick={saveBudgetControls}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 font-semibold text-slate-950 transition-colors hover:bg-slate-100"
              >
                <Save className="h-4 w-4" />
                Save Controls
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-6">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Optimization Queue
            </h2>
            <p className="mt-1 text-sm text-slate-400">Only recommendations generated from your recorded usage appear here.</p>
            <div className="mt-5 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-8 text-slate-400">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading recommendations
                </div>
              ) : recommendations.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="No optimization signals yet"
                  description="Once the system sees enough runtime spend, this section will recommend model downgrades, routing changes, or caching opportunities."
                />
              ) : (
                recommendations.slice(0, 4).map((recommendation, index) => (
                  <div key={`${recommendation.type}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        recommendation.priority === 'high'
                          ? 'bg-rose-500/10 text-rose-300'
                          : recommendation.priority === 'medium'
                            ? 'bg-amber-500/10 text-amber-300'
                            : 'bg-cyan-500/10 text-cyan-300'
                      }`}>
                        {recommendation.priority} priority
                      </span>
                      <span className="text-sm font-semibold text-emerald-300">
                        Save {formatCurrency(recommendation.estimatedSavings)}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-white">
                      {recommendation.from && recommendation.to
                        ? `${recommendation.from} -> ${recommendation.to}`
                        : `${recommendation.agent || 'Usage segment'} -> ${recommendation.recommendation || 'lower-cost routing'}`}
                    </p>
                    <p className="mt-2 text-sm text-slate-400">{recommendation.rationale}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_1.25fr]">
        <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-white">
                <Building2 className="h-5 w-5 text-violet-400" />
                Billing Entity & Tax Profile
              </h2>
              <p className="mt-1 text-sm text-slate-400">India-first billing profile for GST-ready invoicing once invoice generation is wired.</p>
            </div>
            <button
              onClick={saveBillingProfile}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-900"
            >
              <Save className="h-4 w-4" />
              Save Profile
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <LabeledTextInput label="Legal business name" value={billingProfile.legalName} onChange={(value) => setBillingProfile((prev) => ({ ...prev, legalName: value }))} />
            <LabeledTextInput label="Billing email" value={billingProfile.billingEmail} onChange={(value) => setBillingProfile((prev) => ({ ...prev, billingEmail: value }))} />
            <LabeledTextInput label="GSTIN" value={billingProfile.gstin} placeholder="29ABCDE1234F1Z5" onChange={(value) => setBillingProfile((prev) => ({ ...prev, gstin: value.toUpperCase() }))} />
            <LabeledTextInput label="State" value={billingProfile.state} onChange={(value) => setBillingProfile((prev) => ({ ...prev, state: value }))} />
            <div className="sm:col-span-2">
              <LabeledTextInput label="Billing address" value={billingProfile.addressLine} onChange={(value) => setBillingProfile((prev) => ({ ...prev, addressLine: value }))} />
            </div>
            <LabeledTextInput label="City" value={billingProfile.city} onChange={(value) => setBillingProfile((prev) => ({ ...prev, city: value }))} />
            <LabeledTextInput label="Postal code" value={billingProfile.postalCode} onChange={(value) => setBillingProfile((prev) => ({ ...prev, postalCode: value }))} />
          </div>

          <div className="mt-5 rounded-2xl border border-violet-500/20 bg-violet-500/10 p-4 text-sm text-violet-100">
            <p className="font-semibold">What this unlocks next</p>
            <p className="mt-1 text-violet-100/80">GST invoice headers, billing contact routing, tax breakup on invoice PDFs, and cleaner finance exports once invoice generation is connected.</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-white">
                <FileText className="h-5 w-5 text-cyan-400" />
                Invoices & Collections
              </h2>
              <p className="mt-1 text-sm text-slate-400">Make invoice state explicit until a billing provider is integrated.</p>
            </div>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">
              Invoice pipeline pending
            </span>
          </div>

          {DEMO_INVOICES.length === 0 ? (
            <div className="space-y-4">
              <EmptyState
                icon={Landmark}
                title="No invoices have been issued"
                description="Runtime usage is already live, but invoice generation, payment collection, and PDF download need a billing backend. This section should stay explicit about that state."
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  'Generate GST-compliant invoice PDFs',
                  'Track paid, due, and failed payment states',
                  'Export invoices to finance inbox and ERP',
                ].map((item) => (
                  <div key={item} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-300">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px]">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-[0.18em] text-slate-500">
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3">Subtotal</th>
                    <th className="px-4 py-3">GST</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {DEMO_INVOICES.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-slate-800/70 text-sm text-slate-300">
                      <td className="px-4 py-4 font-mono text-white">{invoice.id}</td>
                      <td className="px-4 py-4">{invoice.period}</td>
                      <td className="px-4 py-4">{formatCurrency(invoice.subtotal)}</td>
                      <td className="px-4 py-4">{formatCurrency(invoice.gst)}</td>
                      <td className="px-4 py-4 font-semibold text-white">{formatCurrency(invoice.total)}</td>
                      <td className="px-4 py-4">{invoice.status}</td>
                      <td className="px-4 py-4 text-right">
                        <button
                          onClick={() => toast.success(`Downloading ${invoice.id}`)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-white transition-colors hover:bg-slate-900"
                        >
                          <Download className="h-4 w-4" />
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  detail,
  accent,
  border,
}: {
  title: string;
  value: string;
  detail: string;
  accent: string;
  border: string;
}) {
  return (
    <div className={`rounded-3xl border ${border} bg-gradient-to-br ${accent} p-6`}>
      <p className="text-sm text-slate-400">{title}</p>
      <p className="mt-3 text-3xl font-bold text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{detail}</p>
    </div>
  );
}

function MetricListCard({
  title,
  items,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  items: Array<{ label: string; meta: string; value: string }>;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</h3>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-400">
            <p className="font-semibold text-slate-300">{emptyTitle}</p>
            <p className="mt-1">{emptyDescription}</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.label} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div>
                <p className="font-semibold text-white">{item.label}</p>
                <p className="mt-1 text-xs text-slate-400">{item.meta}</p>
              </div>
              <p className="font-semibold text-emerald-300">{item.value}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 px-6 py-8 text-center">
      <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
        <Icon className="h-6 w-6 text-slate-500" />
      </div>
      <p className="text-lg font-semibold text-white">{title}</p>
      <p className="mt-2 max-w-md text-sm text-slate-400">{description}</p>
    </div>
  );
}

function LabeledTextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-300">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-white outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-500/50"
      />
    </label>
  );
}

function LabeledNumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  prefix,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-300">{label}</span>
      <div className="flex items-center rounded-2xl border border-slate-800 bg-slate-950/70 px-4 focus-within:border-cyan-500/50">
        {prefix && <span className="text-sm text-slate-500">{prefix}</span>}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full bg-transparent px-2 py-3 text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
      </div>
    </label>
  );
}
