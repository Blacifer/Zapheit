import { lazy, Suspense, useMemo, useState } from 'react';
import { useCostData } from '../../hooks/useData';
import {
  Plus, DollarSign, Cpu, Activity, AlertOctagon, ShieldCheck,
  AlertTriangle, TrendingDown, AlertCircle, TrendingUp,
  Download, Zap, BarChart2, ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';

import { CostData, AIAgent, Incident } from '../../types';
import { toast } from '../../lib/toast';
import { validateCostForm } from '../../lib/validation';

interface CostsPageProps {
  agents: AIAgent[];
  incidents: Incident[];
  onNavigate: (page: string) => void;
}

const CostsChartsSection = lazy(() => import('./costs/CostsChartsSection'));

const formatInr = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value || 0);

export default function CostsPage({ agents, incidents, onNavigate }: CostsPageProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'all'>('30d');
  const [chartMode, setChartMode] = useState<'cost' | 'tokens' | 'requests'>('cost');

  const { costData, refetch: refetchCosts } = useCostData(dateRange);

  const addCostEntry = (_entry: Omit<CostData, 'id'>) => {
    setShowAddModal(false);
    refetchCosts();
  };

  const filteredCostData = useMemo(() => {
    if (dateRange === 'all') return costData;
    const now = new Date();
    const days = dateRange === '7d' ? 7 : 30;
    const cutoff = new Date(now.setDate(now.getDate() - days));
    return costData.filter(d => new Date(d.date) >= cutoff);
  }, [costData, dateRange]);

  const totalCost = filteredCostData.reduce((sum, d) => sum + d.cost, 0);
  const totalTokens = filteredCostData.reduce((sum, d) => sum + d.tokens, 0);
  const totalRequests = filteredCostData.reduce((sum, d) => sum + d.requests, 0);
  const costPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;
  const TOKENS_PER_MESSAGE = 800;
  const estimatedMessages = Math.round(totalTokens / TOKENS_PER_MESSAGE);
  const messagesDisplay = estimatedMessages >= 1000
    ? `${(estimatedMessages / 1000).toFixed(1)}k`
    : estimatedMessages.toLocaleString();

  // Build chart data — ALWAYS show a baseline even if data is empty
  const chartData = useMemo(() => {
    const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 30;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build a day-keyed map from actual data
    const dataByDay: Record<string, { cost: number; tokens: number; requests: number }> = {};
    filteredCostData.forEach(d => {
      const key = new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!dataByDay[key]) dataByDay[key] = { cost: 0, tokens: 0, requests: 0 };
      dataByDay[key].cost += d.cost;
      dataByDay[key].tokens += d.tokens;
      dataByDay[key].requests += d.requests;
    });

    // Generate full day series so the chart always has data points
    const result = [];
    for (let offset = days - 1; offset >= 0; offset--) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      result.push({
        formattedDate: label,
        cost: dataByDay[label]?.cost ?? 0,
        tokens: dataByDay[label]?.tokens ?? 0,
        requests: dataByDay[label]?.requests ?? 0,
      });
    }
    return result;
  }, [filteredCostData, dateRange]);

  const exportCSV = () => {
    const headers = ['Date,Cost (INR),Tokens,Requests'];
    const rows = filteredCostData.map(d => `${new Date(d.date).toLocaleDateString()},${d.cost},${d.tokens},${d.requests}`);
    const csvContent = headers.concat(rows).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `rasi_costs_${dateRange}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Cost data exported successfully');
  };

  // Per-agent spend for the breakdown table — aggregate from cost_tracking data
  const agentSpend = useMemo(() => {
    const grouped: Record<string, {
      id: string;
      name: string;
      model: string;
      spend: number;
      budget: number;
      pct: number;
      status: string;
      modelCounts: Record<string, number>;
    }> = {};
    filteredCostData.forEach(d => {
      const key = d.agent_id || '__unattributed__';
      if (!grouped[key]) {
        const agent = agents.find(a => a.id === d.agent_id);
        grouped[key] = {
          id: d.agent_id || '__unattributed__',
          name: agent?.name ?? 'Unattributed',
          model: (d.model || agent?.model_name || '').replace(/^[^/]+\//, '') || '—',
          spend: 0,
          budget: agent?.budget_limit || 0,
          pct: 0,
          status: agent?.status || 'active',
          modelCounts: {},
        };
      }
      grouped[key].spend += d.cost || 0;
      const modelKey = (d.model || '').replace(/^[^/]+\//, '') || grouped[key].model;
      grouped[key].modelCounts[modelKey] = (grouped[key].modelCounts[modelKey] || 0) + 1;
    });
    return Object.values(grouped)
      .map(a => ({
        ...a,
        model: Object.entries(a.modelCounts).sort((left, right) => right[1] - left[1])[0]?.[0] || a.model,
        pct: a.budget > 0 ? Math.min((a.spend / a.budget) * 100, 100) : 0,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [filteredCostData, agents]);

  // Efficiency score: 100 - (incidents per 1000 requests * 10) clamped 0-100
  const efficiencyScore = useMemo(() => {
    const openCount = incidents.filter(i => i.status === 'open' || i.status === 'investigating').length;
    if (totalRequests === 0) return 100;
    const incidentRate = (openCount / totalRequests) * 1000;
    return Math.max(0, Math.round(100 - incidentRate * 10));
  }, [incidents, totalRequests]);

  // When cost_usd is not stored in DB, fall back to token-based distribution
  const modelSpendByTokens = totalCost === 0 && totalTokens > 0;
  const modelSpend = useMemo(() => {
    const grouped: Record<string, number> = {};
    filteredCostData.filter((d: CostData) => d.cost > 0 || d.tokens > 0).forEach((d: CostData) => {
      const raw = d.model || 'unknown';
      const m = raw.replace(/^[^/]+\//, ''); // strip provider prefix e.g. "openai/"
      grouped[m] = (grouped[m] || 0) + (modelSpendByTokens ? (d.tokens || 0) : (d.cost || 0));
    });
    const sorted = Object.entries(grouped).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    if (sorted.length <= 5) return sorted;
    const top4 = sorted.slice(0, 4);
    const others = sorted.slice(4).reduce((s, i) => s + i.value, 0);
    return [...top4, { name: 'Others', value: others }];
  }, [filteredCostData, modelSpendByTokens]);

  const PIE_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899'];

  const effColor = efficiencyScore >= 80 ? 'text-emerald-400' : efficiencyScore >= 50 ? 'text-amber-400' : 'text-rose-400';
  const effBg = efficiencyScore >= 80 ? 'from-emerald-500/20 to-emerald-500/5' : efficiencyScore >= 50 ? 'from-amber-500/20 to-amber-500/5' : 'from-rose-500/20 to-rose-500/5';
  const effBorder = efficiencyScore >= 80 ? 'border-emerald-500/30' : efficiencyScore >= 50 ? 'border-amber-500/30' : 'border-rose-500/30';

  return (
    <div className="space-y-8 animate-in fade-in duration-300 relative z-10 w-full max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-700/60 pb-5">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-emerald-400" /> Usage & Spending
          </h1>
          <p className="text-slate-400 mt-1.5">AI spending tracked through Zapheit. Does not include traffic outside the Zapheit gateway or registered integrations.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            id="date-range-select"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as any)}
            className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none cursor-pointer hover:bg-slate-700 transition-colors"
          >
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
          <button
            onClick={exportCSV}
            className="px-4 py-2.5 bg-slate-800 text-slate-300 border border-slate-700 font-semibold rounded-xl flex items-center gap-2 hover:bg-slate-700 hover:text-white transition-all shadow-lg hidden sm:flex"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-400 text-white font-semibold rounded-xl flex items-center gap-2 hover:from-emerald-400 hover:to-teal-300 transition-all shadow-lg shadow-emerald-500/20 whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Log Expense</span>
            <span className="sm:hidden">Log</span>
          </button>
        </div>
      </div>

      {/* Plain-language summary */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-sm text-white">
        <span className="font-bold text-2xl text-white">{messagesDisplay}</span>
        <span className="text-slate-400">messages sent</span>
        <span className="text-slate-600 mx-1">·</span>
        <span className="font-bold text-2xl text-emerald-300">{formatInr(totalCost)}</span>
        <span className="text-slate-400">this period</span>
        {totalRequests > 0 && (
          <>
            <span className="text-slate-600 mx-1">·</span>
            <span className="text-slate-400">{totalRequests.toLocaleString()} AI requests</span>
          </>
        )}
        {dateRange === '30d' && <span className="ml-auto text-xs text-slate-500">Last 30 days</span>}
        {dateRange === '7d' && <span className="ml-auto text-xs text-slate-500">Last 7 days</span>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr_0.8fr]">
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 backdrop-blur-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Observed by Zapheit</p>
          <p className="mt-3 text-2xl font-bold text-white">{formatInr(totalCost)}</p>
          <p className="mt-2 text-sm leading-6 text-cyan-100/80">
            Live provider spend captured from your organization&apos;s Zapheit-observed traffic. If an agent calls OpenAI, Anthropic, or another provider directly outside Zapheit, that spend will not appear here.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 backdrop-blur-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Zapheit Platform Fee</p>
          <p className="mt-3 text-2xl font-bold text-white">Quoted separately</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Governance, incidents, black box, and operations fees are not mixed into provider runtime cost on this page.
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 backdrop-blur-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">Coverage Status</p>
          <p className="mt-3 text-2xl font-bold text-white">{filteredCostData.length > 0 ? 'Tracked through Zapheit' : 'Waiting for traffic'}</p>
          <p className="mt-2 text-sm leading-6 text-emerald-100/80">
            Accuracy is strongest when requests pass through the Zapheit gateway or connected telemetry path. Provider console totals may be higher if traffic bypasses Zapheit.
          </p>
        </div>
      </div>

      {/* Top Metrics Row — 4 cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Observed Provider Spend',
            value: `₹${totalCost.toFixed(2)}`,
            sub: totalCost === 0 ? 'No Zapheit-observed spend recorded yet' : `Across ${filteredCostData.length} tracked entries`,
            icon: <DollarSign className="w-5 h-5 text-emerald-400" />,
            bg: 'bg-emerald-500/10',
            glow: 'group-hover:bg-emerald-500/5',
          },
          {
            label: 'Messages sent',
            value: messagesDisplay,
            sub: estimatedMessages === 0 ? 'No messages tracked yet' : `Across ${totalRequests.toLocaleString()} AI requests`,
            icon: <Cpu className="w-5 h-5 text-blue-400" />,
            bg: 'bg-blue-500/10',
            glow: 'group-hover:bg-blue-500/5',
          },
          {
            label: 'AI requests',
            value: totalRequests.toLocaleString(),
            sub: totalRequests === 0 ? 'No Zapheit-tracked requests yet' : `≈${Math.round(totalTokens / Math.max(totalRequests, 1) / 800)} messages/request on average`,
            icon: <Activity className="w-5 h-5 text-purple-400" />,
            bg: 'bg-purple-500/10',
            glow: 'group-hover:bg-purple-500/5',
          },
          {
            label: 'Cost per message',
            value: estimatedMessages > 0 ? `₹${(totalCost / estimatedMessages).toFixed(2)}` : '₹0.00',
            sub: costPerRequest === 0 ? 'No activity yet' : costPerRequest < 0.01 ? 'Very efficient' : costPerRequest < 0.05 ? 'Good efficiency' : 'Consider optimization',
            icon: <Zap className="w-5 h-5 text-amber-400" />,
            bg: 'bg-amber-500/10',
            glow: 'group-hover:bg-amber-500/5',
          },
        ].map((card) => (
          <div key={card.label} className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-5 backdrop-blur-sm relative overflow-hidden group">
            <div className={`absolute inset-0 ${card.glow} transition-opacity opacity-0 group-hover:opacity-100`} />
            <div className="flex justify-between items-start relative z-10">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">{card.label}</p>
                <h3 className="text-2xl font-bold text-white tabular-nums truncate">{card.value}</h3>
                <p className="text-xs text-slate-500 mt-1.5 truncate">{card.sub}</p>
              </div>
              <div className={`p-2.5 ${card.bg} rounded-xl shrink-0 ml-2`}>{card.icon}</div>
            </div>
          </div>
        ))}
      </div>

      <Suspense
        fallback={
          <div className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
            <div className="h-[24rem] rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6 backdrop-blur-sm">
              <div className="h-full animate-pulse rounded-xl bg-slate-700/30" />
            </div>
            <div className="h-[24rem] rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6 backdrop-blur-sm">
              <div className="h-full animate-pulse rounded-xl bg-slate-700/30" />
            </div>
          </div>
        }
      >
        <div className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
          <CostsChartsSection
            chartData={chartData}
            chartMode={chartMode}
            dateRange={dateRange}
            modelSpend={modelSpend}
            modelSpendByTokens={modelSpendByTokens}
            onChartModeChange={setChartMode}
            onNavigate={onNavigate}
            pieColors={PIE_COLORS}
            totalCost={totalCost}
          />
        </div>
      </Suspense>

      {/* Bottom Row: 3 cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Leakage Monitor */}
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-sm flex flex-col">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 bg-rose-500/10 rounded-lg">
              <AlertOctagon className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Leakage Monitor</h2>
              <p className="text-xs text-slate-400">Automated diagnostic alerts</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-3">
            {(() => {
              const leaks = incidents.filter(i =>
                i.status !== 'resolved' &&
                (i.incident_type === 'data_extraction_attempt' || i.incident_type === 'refund_abuse')
              );
              if (leaks.length === 0) {
                return (
                  <div className="border border-emerald-500/30 bg-emerald-500/10 rounded-xl p-5 text-center">
                    <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-2.5" />
                    <h4 className="font-bold text-emerald-300 text-sm">System Healthy</h4>
                    <p className="text-xs text-emerald-400/80 mt-1">No cost anomalies detected.</p>
                  </div>
                );
              }
              return leaks.map((leak) => (
                <div key={leak.id} className="relative overflow-hidden border border-slate-700/50 bg-slate-900/50 rounded-xl p-4 hover:bg-slate-800 transition-colors">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${leak.severity === 'critical' || leak.severity === 'high' ? 'bg-rose-500' : 'bg-orange-500'}`} />
                  <div className="flex gap-3 ml-2">
                    <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${leak.severity === 'critical' || leak.severity === 'high' ? 'text-rose-400' : 'text-orange-400'}`} />
                    <div>
                      <p className="text-sm font-medium text-slate-200 leading-snug">{leak.title}</p>
                      <p className="text-xs font-mono text-cyan-400 mt-1.5 flex items-center gap-1">
                        <TrendingDown className="w-3 h-3" /> Terminate agent or update prompt
                      </p>
                    </div>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>

        {/* Efficiency Score + Budget Forecast */}
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-sm flex flex-col gap-5">

          {/* Efficiency Score */}
          <div className={`rounded-2xl border ${effBorder} bg-gradient-to-br ${effBg} p-4`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">Efficiency Score</p>
                <p className={`text-4xl font-black tabular-nums ${effColor}`}>{efficiencyScore}<span className="text-lg font-semibold text-slate-500">/100</span></p>
                <p className="text-xs text-slate-400 mt-1">
                  {efficiencyScore >= 80 ? 'Excellent — low incident-to-request ratio' : efficiencyScore >= 50 ? 'Moderate — review open incidents' : 'Needs attention — high incident rate'}
                </p>
              </div>
              <div className={`text-5xl font-black ${effColor} opacity-20 select-none`}>
                {efficiencyScore >= 80 ? '●' : efficiencyScore >= 50 ? '◑' : '○'}
              </div>
            </div>
          </div>

          {/* Forecast */}
          <div>
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-purple-400" /> Forecasting & Limits
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="border border-slate-700/50 bg-slate-900/50 rounded-xl p-3">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">30-Day Projection</p>
                <p className="text-xl font-bold text-white">₹{(totalCost * 4.3).toFixed(0)}</p>
              </div>
              <div className="border border-slate-700/50 bg-slate-900/50 rounded-xl p-3">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Monthly Avg</p>
                <p className="text-xl font-bold text-white">₹{costData.length > 0 ? (totalCost / Math.max(costData.length / 30, 1)).toFixed(0) : '0'}</p>
              </div>
            </div>
          </div>

          {/* Budget health bars */}
          {agentSpend.length > 0 && (
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Budget Health</p>
              {agentSpend.map(agent => {
                const isOver = agent.pct >= 100;
                const isWarn = agent.pct >= 80;
                const barColor = isOver ? 'bg-rose-500 shadow-rose-500/30' : isWarn ? 'bg-amber-500 shadow-amber-500/30' : 'bg-emerald-500 shadow-emerald-500/30';
                const textColor = isOver ? 'text-rose-400' : isWarn ? 'text-amber-400' : 'text-emerald-400';
                return (
                  <div key={agent.id}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300 truncate max-w-[120px]">{agent.name}</span>
                      <span className={`font-medium ${textColor} shrink-0`}>
                        ₹{agent.spend.toLocaleString()} / ₹{agent.budget.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-700/30">
                      <div
                        className={`h-full rounded-full transition-all duration-700 shadow-sm ${barColor}`}
                        style={{ width: `${Math.max(agent.pct, agent.spend > 0 ? 3 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {agentSpend.length === 0 && (
                <p className="text-xs text-slate-500 italic">No agents with budget limits set.</p>
              )}
            </div>
          )}

          {(totalTokens / Math.max(totalRequests, 1)) > 1500 && (
            <div className="flex items-start gap-2 text-xs border border-orange-500/20 bg-orange-500/5 p-3 rounded-lg">
              <AlertCircle className="w-4 h-4 text-orange-400 shrink-0" />
              <span className="text-slate-300">High token usage per request — consider prompt caching or compression.</span>
            </div>
          )}
        </div>
      </div>

      {/* Agent Spend Table */}
      {agentSpend.length > 0 && (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-sm">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" /> Agent Cost Breakdown
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 uppercase tracking-wider border-b border-slate-700/50">
                  <th className="text-left pb-3 font-medium">Agent</th>
                  <th className="text-left pb-3 font-medium">Model</th>
                  <th className="text-left pb-3 font-medium">Status</th>
                  <th className="text-right pb-3 font-medium">Spend</th>
                  <th className="text-right pb-3 font-medium">Budget</th>
                  <th className="text-right pb-3 font-medium">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {agentSpend.map(agent => {
                  const isOver = agent.pct >= 100;
                  const isWarn = agent.pct >= 80;
                  const utilColor = isOver ? 'text-rose-400' : isWarn ? 'text-amber-400' : 'text-emerald-400';
                  const Icon = isOver ? ArrowUpRight : isWarn ? Minus : ArrowDownRight;
                  return (
                    <tr key={agent.id} className="group hover:bg-slate-700/20 transition-colors">
                      <td className="py-3 pr-4 font-semibold text-white">{agent.name}</td>
                      <td className="py-3 pr-4 text-slate-400 font-mono text-xs">{agent.model}</td>
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${agent.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' :
                          agent.status === 'paused' ? 'bg-amber-500/15 text-amber-400' :
                            'bg-rose-500/15 text-rose-400'
                          }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${agent.status === 'active' ? 'bg-emerald-400' :
                            agent.status === 'paused' ? 'bg-amber-400' : 'bg-rose-400'
                            }`} />
                          {agent.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right font-semibold text-white">₹{agent.spend.toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right text-slate-400">₹{agent.budget.toLocaleString()}</td>
                      <td className="py-3 text-right">
                        <span className={`inline-flex items-center gap-1 font-semibold ${utilColor}`}>
                          <Icon className="w-3.5 h-3.5" />
                          {agent.pct.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddModal && <AddCostModal onClose={() => setShowAddModal(false)} onAdd={addCostEntry} agents={agents} />}
    </div>
  );
}

function AddCostModal({ onClose, onAdd, agents }: { onClose: () => void; onAdd: (entry: Omit<CostData, 'id'>) => void; agents: AIAgent[] }) {
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], cost: 0, tokens: 0, requests: 0 });
  const [selectedAgent, setSelectedAgent] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleAgentSelect = (agentId: string) => {
    setSelectedAgent(agentId);
    if (!agentId) return;

    // Auto-calculate realistic footprint
    const agent = agents.find(a => a.id === agentId);
    const model = (agent?.model_name || '').toLowerCase();

    // Base requests
    const baseRequests = Math.floor(Math.random() * 800) + 150;

    // Approx tokens per request (depends on agent type vaguely)
    let tokensPerReq = 400;
    if (agent?.agent_type === 'support') tokensPerReq = 1200;
    if (agent?.agent_type === 'sales') tokensPerReq = 800;

    const totalTokens = baseRequests * tokensPerReq;

    // GPT4 / Opus pricing vs cheaper ones
    let ratePer1k = 0.05; // cheap base
    if (model.includes('gpt-4')) ratePer1k = 2.5;
    else if (model.includes('gpt-3.5') || model.includes('gpt-4o-mini') || model.includes('haiku')) ratePer1k = 0.15;
    else if (model.includes('claude-3-opus') || model.includes('sonnet')) ratePer1k = 1.2;
    else if (model.includes('llama') || model.includes('gemini')) ratePer1k = 0.5;

    const computedCost = Math.round((totalTokens / 1000) * ratePer1k);

    setForm(prev => ({
      ...prev,
      requests: baseRequests,
      tokens: totalTokens,
      cost: computedCost
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateCostForm(form);
    if (!validation.isValid) {
      const errorObj: Record<string, string> = {};
      Object.entries(validation.errors).forEach(([k, v]) => { if (v) errorObj[k] = v; });
      setErrors(errorObj);
      const first = Object.values(validation.errors)[0];
      if (first) toast.error(first);
      return;
    }
    setErrors({});
    onAdd(form);
  };

  const handleChange = (field: string, value: string | number) => {
    setForm({ ...form, [field]: value });
    if (errors[field]) setErrors({ ...errors, [field]: '' });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
          <Plus className="w-5 h-5 text-emerald-400" /> Log Cost Entry
        </h2>
        <form onSubmit={handleSubmit} id="add-cost-form" name="add-cost-form" className="space-y-4">

          <div>
            <label className="block text-sm text-slate-300 mb-1.5 flex items-center justify-between">
              <span>Agent (Smart Fill)</span>
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Auto</span>
            </label>
            <select
              value={selectedAgent}
              onChange={(e) => handleAgentSelect(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-800 border border-emerald-500/30 rounded-xl text-white outline-none focus:ring-2 focus:ring-emerald-500/50 cursor-pointer"
            >
              <option value="">-- Select Agent to auto-calculate --</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.model_name})</option>
              ))}
            </select>
          </div>

          {[
            { label: 'Date', field: 'date', type: 'date', value: form.date, parse: (v: string) => v },
            { label: 'Cost (₹)', field: 'cost', type: 'number', value: form.cost, step: '0.01', parse: (v: string) => parseFloat(v) || 0 },
            { label: 'Tokens', field: 'tokens', type: 'number', value: form.tokens, parse: (v: string) => parseInt(v) || 0 },
            { label: 'Requests', field: 'requests', type: 'number', value: form.requests, parse: (v: string) => parseInt(v) || 0 },
          ].map(({ label, field, type, value, parse, ...rest }) => (
            <div key={field}>
              <label htmlFor={`cost-field-${field}`} className="block text-sm text-slate-300 mb-1.5">{label}</label>
              <input
                id={`cost-field-${field}`}
                name={field}
                type={type}
                value={value}
                onChange={(e) => handleChange(field, parse(e.target.value))}
                className={`w-full px-4 py-2.5 bg-slate-800 border rounded-xl text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-emerald-500/50 ${errors[field] ? 'border-red-500' : 'border-slate-700'}`}
                {...rest}
              />
              {errors[field] && <p className="text-red-400 text-xs mt-1">{errors[field]}</p>}
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-slate-800 border border-slate-700 text-white rounded-xl hover:bg-slate-700 transition-colors">
              Cancel
            </button>
            <button type="submit" className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-400 text-white font-semibold rounded-xl hover:from-emerald-400 hover:to-teal-300 transition-all">
              Add Entry
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
