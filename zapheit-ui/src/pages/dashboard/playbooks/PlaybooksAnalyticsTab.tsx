import { useEffect, useState } from 'react';
import { api } from '../../../lib/api-client';
import { usdToInr } from '../../../lib/currency';

type AnalyticsData = {
  totals: { runs: number; succeeded: number; cost_usd: number; days: number };
  by_playbook: Array<{ playbook_id: string; runs: number; succeeded: number; failed: number; thumbsUp: number; thumbsDown: number; avg_cost_usd: number; success_rate: number }>;
  daily_series: Array<{ date: string; runs: number }>;
};

export default function PlaybooksAnalyticsTab({
  schedules,
  triggers,
}: {
  schedules: any[];
  triggers: any[];
}) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    api.playbooks.getAnalytics(days).then((res) => {
      if (res.success && res.data) setData(res.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [days]);

  const maxRuns = data ? Math.max(1, ...data.by_playbook.map((playbook) => playbook.runs)) : 1;
  const maxDaily = data ? Math.max(1, ...data.daily_series.map((day) => day.runs)) : 1;
  const lineWidth = 560;
  const lineHeight = 80;
  const points = data?.daily_series.map((day, index, items) => {
    const x = (index / Math.max(1, items.length - 1)) * lineWidth;
    const y = lineHeight - (day.runs / maxDaily) * (lineHeight - 8) - 4;
    return `${x},${y}`;
  }).join(' ') || '';

  if (loading) {
    return <div className="py-8 text-center text-sm text-slate-400">Loading analytics…</div>;
  }

  if (!data) {
    return <div className="py-8 text-center text-sm text-slate-400">No data available yet. Run some playbooks first.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold text-white">Playbook Analytics</h2>
        <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-800/40 p-1">
          {[7, 30, 90].map((range) => (
            <button
              key={range}
              onClick={() => setDays(range)}
              className={`rounded px-3 py-1 text-xs font-medium ${days === range ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {range}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total runs', value: data.totals.runs },
          { label: 'Succeeded', value: data.totals.succeeded },
          { label: 'Cost (INR)', value: `₹${Math.round(usdToInr(data.totals.cost_usd))}` },
          { label: 'Active schedules', value: schedules.filter((schedule) => schedule.enabled).length },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
            <div className="text-2xl font-bold text-white">{stat.value}</div>
            <div className="mt-1 text-xs text-slate-400">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-5">
        <div className="mb-3 text-sm font-medium text-slate-200">Run volume — last {days} days</div>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${lineWidth} ${lineHeight + 20}`} className="w-full" style={{ minWidth: 280 }}>
            {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
              <line
                key={pct}
                x1={0}
                x2={lineWidth}
                y1={lineHeight - pct * (lineHeight - 8) - 4}
                y2={lineHeight - pct * (lineHeight - 8) - 4}
                stroke="#334155"
                strokeWidth={0.5}
              />
            ))}
            {data.daily_series.length > 1 && (
              <polyline
                points={`0,${lineHeight} ${points} ${lineWidth},${lineHeight}`}
                fill="rgba(6,182,212,0.12)"
                stroke="none"
              />
            )}
            {data.daily_series.length > 1 && (
              <polyline points={points} fill="none" stroke="#06b6d4" strokeWidth={2} strokeLinejoin="round" />
            )}
            {data.daily_series.map((day, index, items) => {
              const x = (index / Math.max(1, items.length - 1)) * lineWidth;
              const y = lineHeight - (day.runs / maxDaily) * (lineHeight - 8) - 4;
              return day.runs > 0 ? <circle key={index} cx={x} cy={y} r={3} fill="#06b6d4" /> : null;
            })}
            {data.daily_series.length > 1 && [0, Math.floor(data.daily_series.length / 2), data.daily_series.length - 1].map((index) => {
              const day = data.daily_series[index];
              const x = (index / Math.max(1, data.daily_series.length - 1)) * lineWidth;
              return (
                <text key={index} x={x} y={lineHeight + 16} textAnchor="middle" fill="#64748b" fontSize={9}>
                  {day.date.slice(5)}
                </text>
              );
            })}
          </svg>
        </div>
      </div>

      {data.by_playbook.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-5">
          <div className="mb-4 text-sm font-medium text-slate-200">Runs by playbook</div>
          <div className="space-y-3">
            {data.by_playbook.map((playbook) => {
              const name = playbook.playbook_id.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
              const pct = Math.round((playbook.runs / maxRuns) * 100);
              const feedbackTotal = playbook.thumbsUp + playbook.thumbsDown;
              const feedbackScore = feedbackTotal > 0 ? Math.round((playbook.thumbsUp / feedbackTotal) * 100) : null;
              return (
                <div key={playbook.playbook_id}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex-1 truncate text-xs text-slate-300">{name}</span>
                    <div className="flex flex-shrink-0 items-center gap-3 text-[11px] text-slate-500">
                      <span>{playbook.runs} runs</span>
                      <span className="text-emerald-400">{playbook.success_rate}% ok</span>
                      {feedbackScore !== null && <span className="text-amber-400">{feedbackScore}% ▲</span>}
                      {playbook.avg_cost_usd > 0 && <span>₹{Math.round(usdToInr(playbook.avg_cost_usd))}/run</span>}
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-900/60">
                    <div className="h-full rounded-full bg-cyan-500/70 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {triggers.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-5">
          <div className="mb-3 text-sm font-medium text-slate-200">Auto-trigger activity</div>
          <div className="space-y-2">
            {triggers.map((trigger) => (
              <div key={trigger.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{trigger.event_type} → {trigger.playbook_id}</span>
                <div className="flex items-center gap-3 text-slate-500">
                  <span>{trigger.fire_count || 0} fires</span>
                  <span className={trigger.enabled ? 'text-emerald-400' : 'text-slate-500'}>
                    {trigger.enabled ? 'Active' : 'Paused'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
