import { BarChart3, Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { AIAgent, AgentWorkspaceAnalytics } from '../../../types';

interface ForecastData {
  forecastMonthly: number;
  confidenceLow: number;
  confidenceHigh: number;
  trend: 'up' | 'flat' | 'down';
  rollingAvg7d: number;
}

interface WorkspaceAnalyticsSectionProps {
  activeWorkspaceAgent: AIAgent;
  analytics: AgentWorkspaceAnalytics | null;
  analyticsError: string | null;
  loadingAnalytics: boolean;
  forecast?: ForecastData | null;
  onOpenOperationsPage?: (page: string, options?: { agentId?: string }) => void;
}

export function WorkspaceAnalyticsSection({
  activeWorkspaceAgent,
  analytics,
  analyticsError,
  loadingAnalytics,
  forecast,
  onOpenOperationsPage,
}: WorkspaceAnalyticsSectionProps) {
  const trend = analytics?.trend || [];
  const maxTrendCost = Math.max(...trend.map((item) => item.cost || 0), 1);

  const forecastColor = forecast && activeWorkspaceAgent.budget_limit > 0
    ? forecast.forecastMonthly >= activeWorkspaceAgent.budget_limit ? 'text-rose-400'
      : forecast.forecastMonthly >= activeWorkspaceAgent.budget_limit * 0.8 ? 'text-amber-400'
      : 'text-emerald-400'
    : 'text-white';

  const TrendIcon = forecast?.trend === 'up' ? TrendingUp : forecast?.trend === 'down' ? TrendingDown : Minus;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold text-white">Usage and effectiveness</h3>
        <button
          onClick={() => onOpenOperationsPage?.('costs', { agentId: activeWorkspaceAgent.id })}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 inline-flex items-center gap-1.5"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Open analytics
        </button>
      </div>
      {loadingAnalytics ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-slate-300 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading analytics...
        </div>
      ) : analyticsError ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-100">
          {analyticsError}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Total spend</div>
              <div className="mt-3 text-2xl font-semibold text-white">${(analytics?.totalCost || 0).toFixed(2)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Requests</div>
              <div className="mt-3 text-2xl font-semibold text-white">{(analytics?.totalRequests || 0).toLocaleString()}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Tokens</div>
              <div className="mt-3 text-2xl font-semibold text-white">{(analytics?.totalTokens || 0).toLocaleString()}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Avg cost / request</div>
              <div className="mt-3 text-2xl font-semibold text-white">${(analytics?.avgCostPerRequest || 0).toFixed(4)}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-sm font-semibold text-white">7-day trend</div>
              <div className="text-sm text-slate-400 mt-1">Recent daily spend and request activity for this agent.</div>
              <div className="mt-4 space-y-3">
                {trend.length === 0 ? (
                  <div className="text-sm text-slate-400">No recent trend data available.</div>
                ) : (
                  trend.map((point) => (
                    <div key={point.date} className="grid grid-cols-[120px_1fr_auto] items-center gap-3">
                      <div className="text-xs text-slate-500">{point.date}</div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-cyan-400"
                          style={{ width: `${Math.min(100, (point.cost / maxTrendCost) * 100)}%` }}
                        />
                      </div>
                      <div className="text-xs text-slate-300">${point.cost.toFixed(2)} • {point.requests} req</div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-sm font-semibold text-white">Efficiency snapshot</div>
              <div className="text-sm text-slate-400 mt-1">Quick read on cost posture and usage intensity.</div>
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-white/10 bg-slate-950/30 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Daily average spend</div>
                  <div className="text-lg font-semibold text-white mt-2">${(analytics?.dailyAverage || 0).toFixed(2)}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/30 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Budget usage</div>
                  <div className="text-lg font-semibold text-white mt-2">
                    {activeWorkspaceAgent.budget_limit > 0
                      ? `${Math.min(100, Math.round(((activeWorkspaceAgent.current_spend || 0) / activeWorkspaceAgent.budget_limit) * 100))}% of budget`
                      : 'No budget cap set'}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/30 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Customer satisfaction</div>
                  <div className="text-lg font-semibold text-white mt-2">{activeWorkspaceAgent.satisfaction}%</div>
                </div>
              </div>
            </div>
          </div>
          {forecast && (
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-sm font-semibold text-white">30-day Cost Forecast</div>
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${forecast.trend === 'up' ? 'bg-rose-500/10 text-rose-400 border-rose-400/20' : forecast.trend === 'down' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-400/20' : 'bg-slate-700/40 text-slate-400 border-slate-600/40'}`}>
                  <TrendIcon className="w-3 h-3" />
                  {forecast.trend === 'up' ? 'Spending up' : forecast.trend === 'down' ? 'Spending down' : 'Steady'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Forecast (month)</div>
                  <div className={`mt-2 text-2xl font-bold ${forecastColor}`}>${forecast.forecastMonthly.toFixed(2)}</div>
                  <div className="mt-1 text-xs text-slate-500">range: ${forecast.confidenceLow.toFixed(2)} – ${forecast.confidenceHigh.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">7-day daily avg</div>
                  <div className="mt-2 text-xl font-semibold text-white">${(forecast.rollingAvg7d).toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">vs budget cap</div>
                  <div className={`mt-2 text-xl font-semibold ${forecastColor}`}>
                    {activeWorkspaceAgent.budget_limit > 0
                      ? `${Math.round((forecast.forecastMonthly / activeWorkspaceAgent.budget_limit) * 100)}% of cap`
                      : 'No cap set'}
                  </div>
                </div>
              </div>
              {activeWorkspaceAgent.budget_limit > 0 && forecast.forecastMonthly >= activeWorkspaceAgent.budget_limit * 0.8 && (
                <p className={`mt-3 text-xs ${forecast.forecastMonthly >= activeWorkspaceAgent.budget_limit ? 'text-rose-300' : 'text-amber-300'}`}>
                  {forecast.forecastMonthly >= activeWorkspaceAgent.budget_limit
                    ? `At this rate, the agent will exceed its $${activeWorkspaceAgent.budget_limit} budget cap this month.`
                    : `At this rate, the agent will reach 80%+ of its $${activeWorkspaceAgent.budget_limit} budget cap.`}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
