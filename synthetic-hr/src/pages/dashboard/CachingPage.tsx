import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  Layers3,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { api } from '../../lib/api-client';
import { usdToInr } from '../../lib/currency';
import type { AIAgent } from '../../types';
import { toast } from '../../lib/toast';

interface CachePolicy {
  enabled: boolean;
  minContextTokens: number;
  retentionHours: number;
  cacheScope: 'organization' | 'agent';
  matchMode: 'exact' | 'normalized';
}

interface CacheTelemetryStats {
  totalObservedRequests: number;
  eligibleRequests: number;
  observedHits: number;
  estimatedSavedTokens: number;
  estimatedSavedCostUsd: number;
  hitRate: number;
  averageSavingsPercent: number;
  lastUpdatedAt: string | null;
}

interface CacheEntry {
  id: string;
  keyHash: string;
  keyPreview: string;
  modelName: string;
  endpoint: string;
  contextTokens: number;
  firstSeenAt: string;
  lastUsedAt: string;
  hits: number;
  requestsSeen: number;
  estimatedSavedTokens: number;
  estimatedSavedCostUsd: number;
}

interface CacheOpportunity {
  id: string;
  title: string;
  description: string;
  estimatedSavingsPercent: string;
  supportingMetric: string;
  badge: string;
}

const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const NUMBER_FORMATTER = new Intl.NumberFormat('en-IN');

const defaultPolicy: CachePolicy = {
  enabled: true,
  minContextTokens: 1200,
  retentionHours: 24,
  cacheScope: 'organization',
  matchMode: 'normalized',
};

const defaultStats: CacheTelemetryStats = {
  totalObservedRequests: 0,
  eligibleRequests: 0,
  observedHits: 0,
  estimatedSavedTokens: 0,
  estimatedSavedCostUsd: 0,
  hitRate: 0,
  averageSavingsPercent: 0,
  lastUpdatedAt: null,
};

function formatInr(value: number) {
  return INR_FORMATTER.format(Math.max(0, value));
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return NUMBER_FORMATTER.format(Math.round(value));
}

function formatDateTime(value: string | null) {
  if (!value) return 'No runtime data yet';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function selectClassName() {
  return 'w-full appearance-none rounded-2xl border border-slate-700 bg-[linear-gradient(180deg,rgba(2,6,23,0.96),rgba(15,23,42,0.96))] px-4 py-3 text-white outline-none transition-all focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/15';
}

export default function CachingPage() {
  const [policy, setPolicy] = useState<CachePolicy>(defaultPolicy);
  const [draftPolicy, setDraftPolicy] = useState<CachePolicy>(defaultPolicy);
  const [stats, setStats] = useState<CacheTelemetryStats>(defaultStats);
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [comparison, setComparison] = useState<Array<{ model: string; cost: number; tokens: number; requests: number }>>([]);
  const [insights, setInsights] = useState<{ totalCost: number; totalTokens: number; avgCostPerRequest: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [cachingRes, agentsRes, insightsRes, comparisonRes] = await Promise.all([
        api.caching.getState(),
        api.agents.getAll(),
        api.costs.getInsights(),
        api.costs.getComparison(),
      ]);

      if (cachingRes.success && cachingRes.data) {
        const nextPolicy = cachingRes.data.policy || defaultPolicy;
        setPolicy(nextPolicy);
        setDraftPolicy(nextPolicy);
        setStats(cachingRes.data.telemetry?.stats || defaultStats);
        setEntries(cachingRes.data.telemetry?.entries || []);
      }

      if (agentsRes.success && agentsRes.data) {
        setAgents(agentsRes.data);
      }

      if (insightsRes.success && insightsRes.data?.insights) {
        setInsights({
          totalCost: insightsRes.data.insights.totalCost || 0,
          totalTokens: insightsRes.data.insights.totalTokens || 0,
          avgCostPerRequest: insightsRes.data.insights.avgCostPerRequest || 0,
        });
      }

      if (comparisonRes.success && comparisonRes.data?.comparison?.models) {
        setComparison(comparisonRes.data.comparison.models);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const hasPolicyChanges = useMemo(
    () => JSON.stringify(policy) !== JSON.stringify(draftPolicy),
    [policy, draftPolicy],
  );

  const projectedSavingsInr = useMemo(() => {
    const monthlyUsd = insights?.totalCost || 0;
    const multiplier = draftPolicy.enabled ? (draftPolicy.matchMode === 'normalized' ? 0.38 : 0.28) : 0;
    return usdToInr(monthlyUsd * multiplier);
  }, [insights, draftPolicy]);

  const cacheableOverview = useMemo(() => {
    const totalRequests = comparison.reduce((sum, item) => sum + (item.requests || 0), 0);
    const eligibleModels = comparison.filter((item) => item.tokens >= draftPolicy.minContextTokens);
    const cacheableRequests = eligibleModels.reduce((sum, item) => sum + (item.requests || 0), 0);
    const projectedHitRate = totalRequests > 0 ? Math.round((cacheableRequests / totalRequests) * 100) : 0;
    const projectedTokens = eligibleModels.reduce((sum, item) => sum + (item.tokens || 0), 0);

    return {
      totalRequests,
      cacheableRequests,
      projectedHitRate,
      projectedTokens,
    };
  }, [comparison, draftPolicy.minContextTokens]);

  const opportunities = useMemo<CacheOpportunity[]>(() => {
    const modelOpportunities = comparison
      .filter((entry) => entry.tokens >= draftPolicy.minContextTokens)
      .slice(0, 3)
      .map((entry, index) => ({
        id: `model-${index}`,
        title: entry.model,
        description: 'Repeated high-token traffic on this model is a strong cache candidate if the prefix context is stable.',
        estimatedSavingsPercent: draftPolicy.matchMode === 'normalized' ? '35-55%' : '25-45%',
        supportingMetric: `${NUMBER_FORMATTER.format(entry.requests)} observed requests`,
        badge: 'Model hotspot',
      }));

    const agentOpportunities = agents
      .filter((agent) => Boolean(agent.system_prompt || agent.description))
      .slice(0, 3)
      .map((agent, index) => ({
        id: `agent-${index}`,
        title: agent.name,
        description: 'This agent carries reusable prompt instructions that can be cached before the dynamic user turn is appended.',
        estimatedSavingsPercent: '20-40%',
        supportingMetric: agent.model_name,
        badge: 'Agent context',
      }));

    return [...modelOpportunities, ...agentOpportunities].slice(0, 6);
  }, [comparison, agents, draftPolicy.minContextTokens, draftPolicy.matchMode]);

  const handleSavePolicy = async () => {
    setIsSaving(true);
    try {
      const response = await api.caching.updatePolicy(draftPolicy);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Could not save cache policy');
      }

      setPolicy(response.data.policy);
      setDraftPolicy(response.data.policy);
      setStats(response.data.telemetry?.stats || defaultStats);
      setEntries(response.data.telemetry?.entries || []);
      toast.success('Prompt cache policy saved');
    } catch (error: any) {
      toast.error(error?.message || 'Could not save cache policy');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setDraftPolicy(defaultPolicy);
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="relative overflow-hidden rounded-[28px] border border-slate-700/80 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.14),_transparent_22%),radial-gradient(circle_at_85%_15%,_rgba(168,85,247,0.12),_transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,8,23,0.98))] p-7 shadow-[0_0_0_1px_rgba(15,23,42,0.3),0_20px_70px_rgba(2,8,23,0.38)]">
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
            <ShieldCheck className="h-3.5 w-3.5" /> Runtime-aware caching
          </div>
          <div className="mt-4 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <h1 className="text-4xl font-extrabold tracking-tight text-white">Prompt Caching</h1>
              <p className="mt-3 max-w-2xl text-lg leading-relaxed text-slate-300">
                Persist cache policy in the backend, observe repeated prompt prefixes on live gateway traffic, and separate measured savings from projected opportunity.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm text-slate-300 sm:grid-cols-3 xl:min-w-[520px]">
              <div className="rounded-2xl border border-slate-700/80 bg-slate-950/60 px-4 py-3">Observed hit rate: <span className="font-semibold text-white">{stats.hitRate}%</span></div>
              <div className="rounded-2xl border border-slate-700/80 bg-slate-950/60 px-4 py-3">Eligible requests: <span className="font-semibold text-white">{NUMBER_FORMATTER.format(stats.eligibleRequests)}</span></div>
              <div className="rounded-2xl border border-slate-700/80 bg-slate-950/60 px-4 py-3">Last updated: <span className="font-semibold text-white">{formatDateTime(stats.lastUpdatedAt)}</span></div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 to-slate-950/80 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Observed Hit Rate</p>
              <p className="mt-2 text-4xl font-bold text-white">{stats.hitRate}%</p>
              <p className="mt-2 text-sm text-cyan-100/80">Measured from repeated live prompt prefixes</p>
            </div>
            <div className="rounded-2xl border border-green-500/20 bg-gradient-to-br from-green-500/10 to-slate-950/80 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-green-200">Saved This Month</p>
              <p className="mt-2 text-4xl font-bold text-white">{formatInr(usdToInr(stats.estimatedSavedCostUsd))}</p>
              <p className="mt-2 text-sm text-green-100/80">Observed reusable-prefix savings</p>
            </div>
            <div className="rounded-2xl border border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-500/10 to-slate-950/80 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-fuchsia-200">Projected Upside</p>
              <p className="mt-2 text-4xl font-bold text-white">{formatInr(projectedSavingsInr)}</p>
              <p className="mt-2 text-sm text-fuchsia-100/80">Estimate from current model usage</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-700/80 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.7))] p-6 shadow-sm">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">Policy</h2>
                <p className="mt-1 text-sm text-slate-400">Backend-persisted rules for what should count as cacheable prompt context.</p>
              </div>
              <div className={`rounded-full px-3 py-1 text-xs font-semibold ${draftPolicy.enabled ? 'border border-green-500/20 bg-green-500/10 text-green-300' : 'border border-slate-700 bg-slate-900/70 text-slate-300'}`}>
                {draftPolicy.enabled ? 'Enabled' : 'Disabled'}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-2xl border border-slate-700 bg-[linear-gradient(180deg,rgba(15,23,42,0.72),rgba(2,6,23,0.9))] px-4 py-4">
                <div className="pr-4">
                  <p className="font-medium text-white">Automatic prompt caching</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">Track stable prompt layers and estimate cache reuse on the backend.</p>
                </div>
                <button
                  onClick={() => setDraftPolicy((prev) => ({ ...prev, enabled: !prev.enabled }))}
                  className={`relative h-9 w-16 rounded-full border transition-all ${draftPolicy.enabled ? 'border-green-400/40 bg-green-500 shadow-[0_0_24px_rgba(34,197,94,0.25)]' : 'border-slate-600 bg-slate-800'}`}
                >
                  <div className={`absolute top-[3px] h-7 w-7 rounded-full bg-white transition-transform ${draftPolicy.enabled ? 'translate-x-8' : 'translate-x-1'}`} />
                </button>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-white">Minimum context tokens</label>
                <input
                  type="number"
                  min={256}
                  step={128}
                  value={draftPolicy.minContextTokens}
                  onChange={(e) => setDraftPolicy((prev) => ({ ...prev, minContextTokens: Number(e.target.value) || 0 }))}
                  className="w-full rounded-2xl border border-slate-700 bg-[linear-gradient(180deg,rgba(2,6,23,0.96),rgba(15,23,42,0.96))] px-4 py-3 text-white outline-none transition-all focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/15"
                />
                <p className="mt-2 text-xs text-slate-500">Requests below this threshold are ignored for cache telemetry to avoid noisy short prompts.</p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-white">Retention window</label>
                  <select
                    value={draftPolicy.retentionHours}
                    onChange={(e) => setDraftPolicy((prev) => ({ ...prev, retentionHours: Number(e.target.value) }))}
                    className={selectClassName()}
                  >
                    <option value={6}>6 hours</option>
                    <option value={24}>24 hours</option>
                    <option value={72}>72 hours</option>
                    <option value={168}>7 days</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-white">Scope</label>
                  <select
                    value={draftPolicy.cacheScope}
                    onChange={(e) => setDraftPolicy((prev) => ({ ...prev, cacheScope: e.target.value as CachePolicy['cacheScope'] }))}
                    className={selectClassName()}
                  >
                    <option value="organization">Organization-wide</option>
                    <option value="agent">Per agent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-white">Match mode</label>
                <select
                  value={draftPolicy.matchMode}
                  onChange={(e) => setDraftPolicy((prev) => ({ ...prev, matchMode: e.target.value as CachePolicy['matchMode'] }))}
                  className={selectClassName()}
                >
                  <option value="exact">Exact text only</option>
                  <option value="normalized">Normalize whitespace and formatting</option>
                </select>
                <p className="mt-2 text-xs text-slate-500">Normalized mode is more tolerant and usually produces better hit rates across templated requests.</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={handleSavePolicy}
                disabled={!hasPolicyChanges || isSaving}
                className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Policy
              </button>
              <button
                onClick={handleResetDefaults}
                disabled={isSaving}
                className="rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 font-medium text-slate-200 transition-colors hover:border-slate-500"
              >
                Reset Defaults
              </button>
              {hasPolicyChanges ? <span className="text-sm text-amber-300">Unsaved policy changes</span> : <span className="text-sm text-slate-500">Policy is in sync with backend</span>}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-700/80 bg-slate-900/60 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
              <Sparkles className="h-5 w-5 text-cyan-400" />
              How to get better cache hits
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-4">
                <p className="font-medium text-white">Keep stable first</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-200">
                  <li>System instructions and company policy blocks</li>
                  <li>Few-shot examples reused across requests</li>
                  <li>Long product or compliance documents</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/10 p-4">
                <p className="font-medium text-white">Keep dynamic last</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-200">
                  <li>User-specific turns and account state</li>
                  <li>Recent conversation deltas</li>
                  <li>Anything that changes every request</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-700/80 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,6,23,0.92))] p-6 shadow-sm">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">Observed Reuse</h2>
                <p className="mt-1 text-sm text-slate-400">Measured from real repeated prompt prefixes seen on gateway traffic.</p>
              </div>
              <button
                onClick={loadData}
                className="rounded-2xl border border-slate-700 bg-slate-900/60 p-2.5 text-slate-200 transition-colors hover:border-slate-500"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-700 p-8 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading cache telemetry...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 min-h-[168px] flex flex-col">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Observed</p>
                  <p className="mt-3 text-4xl font-bold text-white tabular-nums leading-none">{NUMBER_FORMATTER.format(stats.totalObservedRequests)}</p>
                  <p className="mt-auto pt-4 text-xs leading-relaxed text-slate-500">Requests inspected</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 min-h-[168px] flex flex-col">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Eligible</p>
                  <p className="mt-3 text-4xl font-bold text-cyan-400 tabular-nums leading-none">{NUMBER_FORMATTER.format(stats.eligibleRequests)}</p>
                  <p className="mt-auto pt-4 text-xs leading-relaxed text-slate-500">Passed the threshold</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 min-h-[168px] flex flex-col">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Saved Tokens</p>
                  <p className="mt-3 text-4xl font-bold text-green-400 tabular-nums leading-none">{formatCompactNumber(stats.estimatedSavedTokens)}</p>
                  <p className="mt-auto pt-4 text-xs leading-relaxed text-slate-500">Estimated reusable tokens</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 min-h-[168px] flex flex-col">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Avg Savings</p>
                  <p className="mt-3 text-4xl font-bold text-fuchsia-400 tabular-nums leading-none">{stats.averageSavingsPercent}%</p>
                  <p className="mt-auto pt-4 text-xs leading-relaxed text-slate-500">Across eligible repeats</p>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-700/80 bg-slate-900/60 p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-bold text-white">
                  <Database className="h-5 w-5 text-cyan-400" />
                  Live Cache Keys
                </h2>
                <p className="mt-1 text-sm text-slate-400">Live repeated prompt keys captured from gateway traffic.</p>
              </div>
              <div className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs text-slate-300">{entries.length} visible entries</div>
            </div>
            {entries.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-700 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.08),_transparent_40%),linear-gradient(180deg,rgba(15,23,42,0.75),rgba(2,6,23,0.92))] p-8">
                <div className="mx-auto max-w-lg text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10">
                    <Layers3 className="h-8 w-8 text-cyan-300" />
                  </div>
                  <p className="mt-4 text-lg font-semibold text-white">No repeated cache keys observed yet</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    This section fills only after live gateway requests reuse the same stable prefix. Repeated system prompts, reusable docs, and shared examples will start showing here first.
                  </p>
                  <div className="mt-5 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Step 1</p>
                      <p className="mt-2 text-sm text-slate-200">Send repeated requests through the gateway</p>
                    </div>
                    <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Step 2</p>
                      <p className="mt-2 text-sm text-slate-200">Keep stable context before the dynamic user turn</p>
                    </div>
                    <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Step 3</p>
                      <p className="mt-2 text-sm text-slate-200">Refresh to inspect keys, hits, and saved cost</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {entries.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-200">{entry.endpoint}</span>
                          <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300">{entry.modelName}</span>
                          <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-300">{entry.hits} hits</span>
                        </div>
                        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-200">{entry.keyPreview}</p>
                      </div>
                      <div className="grid min-w-[240px] grid-cols-2 gap-3 lg:w-[260px]">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Context</p>
                          <p className="mt-1 font-semibold text-white">{formatCompactNumber(entry.contextTokens)} tokens</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Saved</p>
                          <p className="mt-1 font-semibold text-green-400">{formatInr(usdToInr(entry.estimatedSavedCostUsd))}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">First seen</p>
                          <p className="mt-1 text-sm text-slate-300">{formatDateTime(entry.firstSeenAt)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Last used</p>
                          <p className="mt-1 text-sm text-slate-300">{formatDateTime(entry.lastUsedAt)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-green-500/25 bg-[linear-gradient(180deg,rgba(34,197,94,0.08),rgba(15,23,42,0.6))] p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
              <Target className="h-5 w-5 text-green-300" />
              Projected Savings
            </h2>
            <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-950/60 p-4 min-h-[168px] flex flex-col">
                <p className="text-sm text-slate-400">Projected hit rate</p>
                <p className="mt-3 text-4xl font-bold text-white tabular-nums leading-none">{cacheableOverview.projectedHitRate}%</p>
                <p className="mt-auto pt-4 text-xs text-slate-500">Based on current threshold and model traffic</p>
              </div>
              <div className="rounded-2xl bg-slate-950/60 p-4 min-h-[168px] flex flex-col">
                <p className="text-sm text-slate-400">Cacheable requests</p>
                <p className="mt-3 text-4xl font-bold text-cyan-400 tabular-nums leading-none">{NUMBER_FORMATTER.format(cacheableOverview.cacheableRequests)}</p>
                <p className="mt-auto pt-4 text-xs text-slate-500">Requests likely to benefit from stable prefixes</p>
              </div>
              <div className="rounded-2xl bg-slate-950/60 p-4 min-h-[168px] flex flex-col">
                <p className="text-sm text-slate-400">Projected savings</p>
                <p className="mt-3 text-4xl font-bold text-green-400 tabular-nums leading-none">{formatInr(projectedSavingsInr)}</p>
                <p className="mt-auto pt-4 text-xs text-slate-500">Estimate from current cost profile</p>
              </div>
            </div>

            {opportunities.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">
                <TrendingUp className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                <p className="font-medium text-slate-200">No strong opportunities detected yet</p>
                <p className="mt-2 text-sm text-slate-500">As more long-context requests flow through the system, model and agent hotspots will appear here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {opportunities.map((opportunity) => (
                  <div key={opportunity.id} className="rounded-2xl border border-green-500/15 bg-slate-950/60 p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{opportunity.title}</p>
                        <p className="mt-1 text-sm text-slate-400">{opportunity.description}</p>
                      </div>
                      <span className="whitespace-nowrap font-bold text-green-400">{opportunity.estimatedSavingsPercent}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs text-green-200">{opportunity.badge}</span>
                      <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300">{opportunity.supportingMetric}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-700/80 bg-slate-900/60 p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
              <Clock3 className="h-5 w-5 text-fuchsia-300" />
              What this page is measuring
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                <p className="font-medium text-white">Measured now</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-200">
                  <li>Observed repeated prompt prefixes</li>
                  <li>Hit counts and request reuse</li>
                  <li>Estimated saved tokens and cost</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <p className="font-medium text-white">Still estimated</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-200">
                  <li>Projected upside from current model usage</li>
                  <li>Opportunity cards by agent and model</li>
                  <li>Provider-native billing discounts</li>
                </ul>
              </div>
            </div>
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-300" />
              <p className="text-sm text-slate-300">
                The backend now persists cache policy under your organization settings and records repeated-prefix observations on live gateway traffic. Savings are still estimated from observed token reuse, not provider-native prompt-cache billing statements.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
