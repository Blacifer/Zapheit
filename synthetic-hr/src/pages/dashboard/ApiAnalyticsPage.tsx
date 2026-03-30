import { useState, useEffect } from 'react';
import { ChevronDown, Download, CalendarDays, ChevronRight, User, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api-client';

type TimeRange = '24h' | '7d' | '30d';

interface ApiAnalyticsPageProps {
  isDemoMode: boolean;
}

type TrendPoint = {
  date: string;
  label: string;
  yearLabel: string;
  requests: number;
  tokens: number;
  cost: number;
};

type AnalyticsData = {
  totals: {
    requests: number;
    tokens: number;
    cost: number;
  };
  trend: TrendPoint[];
  models: Array<{ model: string; cost: number; tokens: number; requests: number }>;
  agents: Array<{ agentId: string; agentName: string; cost: number; tokens: number; requests: number }>;
};

const generateEmptyMetrics = (): AnalyticsData => ({
  totals: {
    requests: 0,
    tokens: 0,
    cost: 0,
  },
  trend: [],
  models: [],
  agents: [],
});

const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value);
const formatCompact = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return formatNumber(value);
};
const formatCurrency = (value: number) => `$${value.toFixed(2)}`;

export default function ApiAnalyticsPage({ isDemoMode }: ApiAnalyticsPageProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isAgentDropdownOpen, setIsAgentDropdownOpen] = useState(false);
  const [agentFilterId, setAgentFilterId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'capabilities' | 'spend'>('capabilities');
  const [data, setData] = useState<AnalyticsData>(generateEmptyMetrics());
  const [loading, setLoading] = useState(true);
  const [hoveredDay, setHoveredDay] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fleetAgents, setFleetAgents] = useState<Array<{ id: string; name: string }>>([]);

  const allAgentsForDropdown = (fleetAgents.length > 0
    ? fleetAgents
    : data.agents.map((a) => ({ id: a.agentId, name: a.agentName }))
  ).slice().sort((a, b) => a.name.localeCompare(b.name));

  const selectedAgentName = agentFilterId
    ? (allAgentsForDropdown.find((a) => a.id === agentFilterId)?.name || agentFilterId)
    : 'All agents';

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setErrorMessage(null);
      try {
        const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : 30;

        const [insightsRes, trendRes, comparisonRes] = await Promise.all([
          api.costs.getInsights(agentFilterId ? { agentId: agentFilterId } : undefined),
          api.costs.getTrend({ days, ...(agentFilterId ? { agentId: agentFilterId } : {}) }),
          api.costs.getComparison(),
        ]);

        if (!insightsRes.success || !trendRes.success) {
          setErrorMessage(insightsRes.error || trendRes.error || 'Unable to load analytics data.');
          setData(generateEmptyMetrics());
          return;
        }

        const insights = (insightsRes.data?.insights || {}) as any;
        const trend = trendRes.data?.trend || [];
        const comparison = comparisonRes.success ? comparisonRes.data?.comparison : null;

        const formattedTrend: TrendPoint[] = trend.map((t: any) => {
          const dateObj = new Date(t.date);
          return {
            date: t.date,
            label: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            yearLabel: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            requests: t.requests || 0,
            tokens: t.tokens || 0,
            cost: t.cost || 0,
          };
        });

        const totalRequests = formattedTrend.reduce((sum, point) => sum + (point.requests || 0), 0);
        const totalTokens = insights.totalTokens || formattedTrend.reduce((sum, point) => sum + (point.tokens || 0), 0);
        const totalCost = insights.totalCost || formattedTrend.reduce((sum, point) => sum + (point.cost || 0), 0);

        const models = Object.entries(insights.costByModel || {}).map(([model, stats]: any) => ({
          model,
          cost: stats.cost || 0,
          tokens: stats.tokens || 0,
          requests: stats.requests || 0,
        })).sort((a, b) => b.cost - a.cost);

        const agents = (comparison?.agents || [])
          .map((agent: any) => ({
            agentId: agent.agentId,
            agentName: agent.agentName || agent.agentId,
            cost: agent.cost || 0,
            tokens: agent.tokens || 0,
            requests: agent.requests || 0,
          }))
          .sort((a: any, b: any) => b.cost - a.cost);

        setData({
          totals: {
            requests: totalRequests,
            tokens: totalTokens,
            cost: totalCost,
          },
          trend: formattedTrend,
          models,
          agents,
        });
      } catch (err) {
        console.error('Failed to load api metrics', err);
        setErrorMessage('Unable to load analytics data.');
        setData(generateEmptyMetrics());
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [timeRange, isDemoMode, agentFilterId]);

  useEffect(() => {
    (async () => {
      try {
        const agentsRes = await api.agents.getAll();
        if (agentsRes.success && Array.isArray(agentsRes.data)) {
          setFleetAgents((agentsRes.data as any[]).map((a) => ({ id: a.id, name: a.name || a.id })));
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // Chart max
  const maxRequests = Math.max(...(data.trend || []).map((d) => d.requests || 0), 10);

  const handleExport = () => {
    if (!data.trend || data.trend.length === 0) return;

    // Build CSV Content
    const headers = ['Date', 'Requests', 'Tokens', 'Cost'];
    const rows = data.trend.map((d) => [
      d.date,
      d.requests,
      d.tokens,
      d.cost,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row: any[]) => row.join(','))
    ].join('\n');

    // Create Download Link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.setAttribute('href', url);
    link.setAttribute('download', `api_usage_${agentFilterId ? `agent_${agentFilterId}_` : ''}${timeRange}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="font-sans text-white max-w-[1240px] mx-auto pb-10">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#ececec]">Usage</h1>

        <div className="flex items-center gap-2 text-sm">
          <div className="relative">
            <button
              onClick={() => {
                setIsAgentDropdownOpen(!isAgentDropdownOpen);
                setIsDropdownOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#3f3f46] hover:bg-[#27272a] transition-colors bg-[#18181b] text-[#ececec]"
              aria-haspopup="listbox"
              aria-expanded={isAgentDropdownOpen}
            >
              <User className="w-4 h-4 text-zinc-400" />
              {selectedAgentName}
              <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isAgentDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isAgentDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-[#1f1f22] border border-[#3f3f46] rounded-lg shadow-xl overflow-hidden z-50">
                <div className="py-1 flex flex-col max-h-[320px] overflow-auto">
                  <button
                    onClick={() => {
                      setAgentFilterId('');
                      setIsAgentDropdownOpen(false);
                      setHoveredDay(null);
                    }}
                    className={`w-full text-left px-4 py-2 text-[13px] transition-colors ${agentFilterId === '' ? 'bg-[#27272a] text-white font-medium' : 'text-zinc-400 hover:bg-[#27272a] hover:text-white'}`}
                  >
                    All agents
                  </button>
                  {allAgentsForDropdown.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => {
                        setAgentFilterId(agent.id);
                        setIsAgentDropdownOpen(false);
                        setHoveredDay(null);
                      }}
                      className={`w-full text-left px-4 py-2 text-[13px] transition-colors ${agentFilterId === agent.id ? 'bg-[#27272a] text-white font-medium' : 'text-zinc-400 hover:bg-[#27272a] hover:text-white'}`}
                      title={agent.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate">{agent.name}</span>
                        <span className="font-mono text-[11px] text-zinc-500">{agent.id.slice(0, 8)}…</span>
                      </div>
                    </button>
                  ))}
                  {allAgentsForDropdown.length === 0 && (
                    <div className="px-4 py-2 text-[13px] text-zinc-500">
                      No agents found.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#3f3f46] hover:bg-[#27272a] transition-colors bg-[#18181b] text-[#ececec]"
            >
              <CalendarDays className="w-4 h-4 text-zinc-400" />
              {timeRange === '24h' ? 'Last 24 Hours' : timeRange === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
              <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-[#1f1f22] border border-[#3f3f46] rounded-lg shadow-xl overflow-hidden z-50">
                <div className="py-1 flex flex-col">
                  {(['24h', '7d', '30d'] as TimeRange[]).map((range) => (
                    <button
                      key={range}
                      onClick={() => {
                        setTimeRange(range);
                        setIsDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-[13px] transition-colors ${timeRange === range ? 'bg-[#27272a] text-white font-medium' : 'text-zinc-400 hover:bg-[#27272a] hover:text-white'}`}
                    >
                      {range === '24h' ? 'Last 24 Hours' : range === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-[#27272a] transition-colors text-[#ececec] border border-transparent hover:border-[#3f3f46]"
          >
            <Download className="w-4 h-4 text-zinc-400" /> Export
          </button>
        </div>
      </div>

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-[#3f3f46] bg-[#141417] px-4 py-3 text-sm text-zinc-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
        <div>
          <p className="font-medium text-white">{agentFilterId ? 'Agent-level usage' : 'Organization-level usage'}</p>
          <p className="text-zinc-400">
            {agentFilterId
              ? `Showing gateway-observed traffic attributed to: ${selectedAgentName}.`
              : 'This view aggregates traffic across the workspace. Per-key usage and limits live in the API Keys section.'}
          </p>
        </div>
      </div>

      {(isDemoMode || errorMessage) && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-[#3f3f46] bg-[#141417] px-4 py-3 text-sm text-zinc-300">
          <AlertTriangle className="h-4 w-4 text-amber-300" />
          <span>
            {errorMessage ? errorMessage : 'Demo mode is on. Data shown here may be simulated.'}
          </span>
        </div>
      )}

      {/* Main Top Section */}
      <div className="flex flex-col lg:flex-row border border-[#27272a] rounded-xl bg-[#0f0f11] mb-8">

        {/* Left Side: Main Chart */}
        <div className="flex-1 p-6 relative flex flex-col min-h-[340px] border-r border-[#27272a] group">
          <div className="flex-1 flex items-end gap-[4px] sm:gap-[6px] pb-6 relative mt-10 z-0">

            {/* Y-axis visual markers */}
            <div className="absolute inset-x-0 bottom-6 border-b border-[#27272a]/80" />
            <div className="absolute inset-x-0 bottom-[calc(33%+1.5rem)] border-b border-[#27272a]/40 border-dashed" />
            <div className="absolute inset-x-0 bottom-[calc(66%+1.5rem)] border-b border-[#27272a]/40 border-dashed" />

            {data.trend.map((day, i) => {
              const heightPct = (day.requests / maxRequests) * 100;
              const isHovered = hoveredDay === day.date;
              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col justify-end group/bar relative h-full cursor-pointer z-10"
                  onMouseEnter={() => setHoveredDay(day.date)}
                  onMouseLeave={() => setHoveredDay(null)}
                >
                  <div
                    className={`w-full rounded-t-sm transition-colors duration-150 ${isHovered ? 'bg-[#a78bfa]' : 'bg-[#8b5cf6]'}`}
                    style={{ height: `${Math.max(heightPct, 1)}%` }}
                  />

                  {/* Absolute Tooltip (anchored to the bar so it follows the mouse horizontally relative to the active bar) */}
                  {isHovered && (
                    <div className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 bg-[#1f1f22] border border-[#3f3f46] shadow-xl text-sm p-3 rounded-lg w-56 z-50 pointer-events-none">
                      <div className="text-zinc-400 text-xs mb-1 font-medium">{day.yearLabel}</div>
                      <div className="font-semibold text-white mb-2">{formatNumber(day.requests)} requests</div>
                      <div className="text-[11px] text-zinc-400 border-t border-[#3f3f46] pt-2 flex justify-between">
                        <span>Tokens</span>
                        <span className="text-white font-medium">{formatCompact(day.tokens)}</span>
                      </div>
                      <div className="text-[11px] text-zinc-400 pt-2 flex justify-between">
                        <span>Cost</span>
                        <span className="text-white font-medium">{formatCurrency(day.cost)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* X Axis Labels */}
          {data.trend && data.trend.length > 0 && (
            <div className="flex justify-between text-[11px] text-zinc-500 font-medium absolute bottom-6 inset-x-6 pt-2">
              <span>{data.trend[0].label}</span>
              <span>{data.trend[data.trend.length - 1].label}</span>
            </div>
          )}
        </div>

        {/* Right Side: Cumulative Stats */}
        <div className="w-full lg:w-[320px] flex flex-col shrink-0">
          <div className="p-6 border-b border-[#27272a] flex-1 flex flex-col justify-center">
            <h2 className="text-[32px] font-semibold mb-4 tracking-tight text-white leading-none">
              {formatNumber(data.totals.requests)}
            </h2>

            {/* Fake Sparkline SVG for aesthetics resembling OpenAI Usage */}
            <div className="h-10 w-full mb-6">
              <svg viewBox="0 0 100 30" className="w-full h-full preserve-aspect-ratio-none">
                <path d="M0,25 L15,25 L20,20 L25,25 L35,25 L40,25 L60,25 L70,25 L80,25 L85,25 L90,15 L95,25 L100,25" fill="none" stroke="#f43f5e" strokeWidth="1.2" />
                <circle cx="95" cy="25" r="1.5" fill="#f43f5e" />
              </svg>
            </div>

            <div className="text-[13px] text-zinc-400 mb-0.5">Total requests · {timeRange === '24h' ? 'last 24h' : timeRange === '7d' ? 'last 7 days' : 'last 30 days'}</div>
            <div className="text-sm font-semibold">{formatNumber(data.totals.requests)}</div>
            <div className="mt-4 text-[13px] text-zinc-400 mb-0.5">Total tokens · {timeRange === '24h' ? 'last 24h' : timeRange === '7d' ? 'last 7 days' : 'last 30 days'}</div>
            <div className="text-sm font-semibold">{formatCompact(data.totals.tokens)}</div>
            <div className="mt-4 text-[13px] text-zinc-400 mb-0.5">Total cost · {timeRange === '24h' ? 'last 24h' : timeRange === '7d' ? 'last 7 days' : 'last 30 days'}</div>
            <div className="text-sm font-semibold">{formatCurrency(data.totals.cost)}</div>
          </div>

          {/* User Row (Matches screenshot Pratik Agarwal row) */}
          <div className="px-6 py-4 flex items-center justify-between transition-colors group">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-600">
                <User className="w-[14px] h-[14px] text-zinc-300" />
              </div>
              <span className="text-sm text-[#ececec] font-medium transition-colors">Top agent</span>
            </div>
            <span className="text-sm text-zinc-400 font-medium">
              {agentFilterId ? selectedAgentName : (data.agents[0] ? `${data.agents[0].agentName}` : 'No agent usage yet')}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#27272a] mb-6 gap-6 px-1">
        <button
          onClick={() => setActiveTab('capabilities')}
          className={`pb-3 border-b-2 text-sm font-semibold -mb-[1px] ${activeTab === 'capabilities' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
        >
          API capabilities
        </button>
        <button
          onClick={() => setActiveTab('spend')}
          className={`pb-3 border-b-2 text-sm font-semibold -mb-[1px] ${activeTab === 'spend' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
        >
          Spend categories
        </button>
      </div>

      {activeTab === 'capabilities' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Completions Card */}
          <div className="bg-[#0f0f11] border border-[#27272a] rounded-xl p-5 transition-colors cursor-pointer group hover:border-[#3f3f46]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[14px] font-semibold text-[#ececec]">Responses and Chat Completions</h3>
              <ChevronRight className="w-[15px] h-[15px] text-zinc-500 group-hover:text-zinc-300 transition-colors" />
            </div>
            <div className="flex items-center gap-4 text-[13px] text-zinc-400 mb-8">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-[#8b5cf6] rounded-sm" />
                <span>{formatNumber(data.totals.requests)} requests</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-zinc-300 rounded-sm" />
                <span>{formatCompact(data.totals.tokens)} input tokens</span>
              </div>
            </div>
            <div className="h-14 flex items-end gap-[3px] mt-auto relative z-0">
              <div className="absolute inset-x-0 bottom-1/2 border-b border-[#27272a] border-dashed -z-10"></div>
              {data.trend.length > 0 ? (
                data.trend.map((day, i) => {
                  const pct = (day.requests / maxRequests) * 100;
                  return (
                    <div key={i} className="flex-1 flex flex-col justify-end h-full">
                      <div className="w-full bg-[#8b5cf6] rounded-t-[1px]" style={{ height: `${Math.max(pct, 1)}%` }} />
                    </div>
                  );
                })
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[11px] text-zinc-600">No data</div>
              )}
            </div>
            {data.trend.length > 0 && (
              <div className="flex justify-between mt-2 text-[11px] font-medium text-zinc-500 border-t border-[#27272a] pt-1.5">
                <span>{data.trend[0].label}</span>
                <span>{data.trend[data.trend.length - 1].label}</span>
              </div>
            )}
          </div>

          {/* Images Card */}
          <div className="bg-[#0f0f11] border border-[#27272a] rounded-xl p-5 transition-colors cursor-pointer group hover:border-[#3f3f46] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[14px] font-semibold text-[#ececec]">Images</h3>
              <ChevronRight className="w-[15px] h-[15px] text-zinc-500 group-hover:text-zinc-300 transition-colors" />
            </div>
            <div className="flex items-center gap-4 text-[13px] text-zinc-400 mb-8">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-[#8b5cf6] rounded-sm" />
                <span>0 requests</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-zinc-300 rounded-sm" />
                <span>0 images</span>
              </div>
            </div>
            <div className="flex-1 flex flex-col justify-end">
              <div className="h-14 flex items-end relative z-0">
                <div className="absolute inset-x-0 bottom-1/2 border-b border-[#27272a] border-dashed -z-10"></div>
              </div>
              <div className="flex justify-between mt-2 text-[11px] font-medium text-zinc-500 border-t border-[#27272a] pt-1.5">
                <span>{data.trend[0]?.label || '—'}</span>
                <span>{data.trend[data.trend.length - 1]?.label || '—'}</span>
              </div>
            </div>
          </div>

          {/* Web Searches Card */}
          <div className="bg-[#0f0f11] border border-[#27272a] rounded-xl p-5 hover:border-[#3f3f46] transition-colors cursor-pointer group">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[14px] font-semibold text-[#ececec]">Web Searches</h3>
              <ChevronRight className="w-[15px] h-[15px] text-zinc-500 group-hover:text-zinc-300 transition-colors" />
            </div>
            <div className="flex items-center gap-2 text-[13px] text-zinc-400">
              <div className="w-2 h-2 bg-[#8b5cf6] rounded-sm" />
              <span>0 requests</span>
            </div>
          </div>

          {/* File Searches Card */}
          <div className="bg-[#0f0f11] border border-[#27272a] rounded-xl p-5 hover:border-[#3f3f46] transition-colors cursor-pointer group">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[14px] font-semibold text-[#ececec]">File Searches</h3>
              <ChevronRight className="w-[15px] h-[15px] text-zinc-500 group-hover:text-zinc-300 transition-colors" />
            </div>
            <div className="flex items-center gap-2 text-[13px] text-zinc-400">
              <div className="w-2 h-2 bg-[#8b5cf6] rounded-sm" />
              <span>0 requests</span>
            </div>
          </div>

        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[#0f0f11] border border-[#27272a] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-semibold text-[#ececec]">Top models by spend</h3>
              <span className="text-xs text-zinc-500">{formatCurrency(data.totals.cost)} total</span>
            </div>
            {data.models.length > 0 ? (
              <div className="space-y-3">
                {data.models.slice(0, 6).map((model) => (
                  <div key={model.model} className="flex items-center justify-between text-sm text-zinc-300">
                    <div className="min-w-0">
                      <p className="font-medium text-white truncate">{model.model}</p>
                      <p className="text-xs text-zinc-500">{formatCompact(model.tokens)} tokens · {formatNumber(model.requests)} requests</p>
                    </div>
                    <span className="font-semibold">{formatCurrency(model.cost)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-500">No model spend data available.</div>
            )}
          </div>

          <div className="bg-[#0f0f11] border border-[#27272a] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-semibold text-[#ececec]">{agentFilterId ? 'Agent filter' : 'Top agents by spend'}</h3>
              <span className="text-xs text-zinc-500">{formatCurrency(data.totals.cost)} total</span>
            </div>
            {agentFilterId ? (
              <div className="text-sm text-zinc-300 space-y-3">
                <div>
                  <div className="text-xs text-zinc-500">Selected agent</div>
                  <div className="mt-1 text-white font-semibold truncate">{selectedAgentName}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAgentFilterId('')}
                  className="w-full px-3 py-2 rounded-lg bg-[#18181b] border border-[#3f3f46] hover:bg-[#27272a] text-sm font-semibold text-white"
                >
                  Clear filter (show all agents)
                </button>
                <div className="text-xs text-zinc-500">
                  Agent comparison is organization-wide. Clear the filter to see top agents by spend.
                </div>
              </div>
            ) : (
              data.agents.length > 0 ? (
                <div className="space-y-3">
                  {data.agents.slice(0, 6).map((agent) => (
                    <div key={agent.agentId} className="flex items-center justify-between text-sm text-zinc-300">
                      <div className="min-w-0">
                        <p className="font-medium text-white truncate">{agent.agentName}</p>
                        <p className="text-xs text-zinc-500">{formatCompact(agent.tokens)} tokens · {formatNumber(agent.requests)} requests</p>
                      </div>
                      <span className="font-semibold">{formatCurrency(agent.cost)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-zinc-500">No agent spend data available.</div>
              )
            )}
          </div>
        </div>
      )}

    </div>
  );
}
