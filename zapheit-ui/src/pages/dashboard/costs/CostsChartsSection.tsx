import {
  AreaChart,
  Area as RechartsArea,
  XAxis as RechartsXAxis,
  YAxis as RechartsYAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie as RechartsPie,
  Cell as RechartsCell,
} from 'recharts';
import { TrendingUp, BarChart2 } from 'lucide-react';

const Area = RechartsArea as any;
const XAxis = RechartsXAxis as any;
const YAxis = RechartsYAxis as any;
const Tooltip = RechartsTooltip as any;
const Pie = RechartsPie as any;
const Cell = RechartsCell as any;

interface ChartPoint {
  formattedDate: string;
  cost: number;
  tokens: number;
  requests: number;
}

interface ModelSpendEntry {
  name: string;
  value: number;
}

interface CostsChartsSectionProps {
  chartData: ChartPoint[];
  chartMode: 'cost' | 'tokens' | 'requests';
  dateRange: '7d' | '30d' | 'all';
  totalCost: number;
  modelSpend: ModelSpendEntry[];
  modelSpendByTokens: boolean;
  pieColors: string[];
  onChartModeChange: (mode: 'cost' | 'tokens' | 'requests') => void;
  onNavigate: (page: string) => void;
}

const SpendingTooltip = ({ active, payload, label, mode }: any) => {
  if (!active || !payload) return null;
  const value = payload[0]?.value ?? 0;
  const formatValue = () => {
    if (mode === 'cost') return `₹${Number(value).toFixed(2)}`;
    if (mode === 'tokens') return `${Number(value).toLocaleString()} tokens`;
    return `${Number(value).toLocaleString()} requests`;
  };

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/95 px-4 py-3 shadow-2xl backdrop-blur-sm">
      <p className="mb-1 text-xs text-slate-400">{label}</p>
      <p className="text-lg font-bold text-emerald-400">{formatValue()}</p>
    </div>
  );
};

export default function CostsChartsSection({
  chartData,
  chartMode,
  dateRange,
  totalCost,
  modelSpend,
  modelSpendByTokens,
  pieColors,
  onChartModeChange,
  onNavigate,
}: CostsChartsSectionProps) {
  const chartKey = chartMode === 'cost' ? 'cost' : chartMode === 'tokens' ? 'tokens' : 'requests';
  const chartColor = chartMode === 'cost' ? '#10b981' : chartMode === 'tokens' ? '#3b82f6' : '#8b5cf6';
  const chartLabel = chartMode === 'cost' ? 'Cost (₹)' : chartMode === 'tokens' ? 'Tokens' : 'Requests';

  return (
    <>
      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6 backdrop-blur-sm">
        <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <TrendingUp className="h-5 w-5 text-emerald-400" /> Spending Trend
            {totalCost === 0 && (
              <span className="ml-1 text-xs font-normal text-slate-500">(baseline — no spend yet)</span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {(['cost', 'tokens', 'requests'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => onChartModeChange(mode)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition-all ${
                  chartMode === mode
                    ? 'border-emerald-500/30 bg-emerald-500/20 text-emerald-300'
                    : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="h-72 w-full" style={{ minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColor} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="formattedDate"
                dy={8}
                fontSize={11}
                interval={dateRange === '30d' ? 4 : 0}
                stroke="#475569"
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                domain={totalCost === 0 && chartMode === 'cost' ? [0, 10] : undefined}
                fontSize={11}
                stroke="#475569"
                tickFormatter={(value: number) =>
                  chartMode === 'cost' ? `₹${value}` : value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value)
                }
                tickLine={false}
              />
              <Tooltip content={<SpendingTooltip mode={chartMode} />} />
              <Area
                activeDot={{ r: 5, fill: chartColor, stroke: '#0f172a', strokeWidth: 2 }}
                dataKey={chartKey}
                dot={false}
                fill="url(#colorMetric)"
                fillOpacity={1}
                name={chartLabel}
                stroke={chartColor}
                strokeWidth={2.5}
                type="monotone"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6 backdrop-blur-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-lg bg-blue-500/10 p-2">
            <BarChart2 className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">{modelSpendByTokens ? 'Usage by Model' : 'Cost by Model'}</h2>
            <p className="text-xs text-slate-400">
              {modelSpendByTokens ? 'Token distribution (no cost data stored)' : 'Total spending distribution'}
            </p>
          </div>
        </div>
        <div className="relative flex min-h-[220px] flex-col items-center justify-center">
          {modelSpend.length === 0 ? (
            <div className="space-y-2 text-center">
              <BarChart2 className="mx-auto h-10 w-10 text-slate-600" />
              <p className="text-sm text-slate-500">No agent spend to track yet.</p>
              <button onClick={() => onNavigate('fleet')} className="text-xs text-cyan-400 transition-colors hover:text-cyan-300">
                Configure agents →
              </button>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    cx="50%"
                    cy="45%"
                    data={modelSpend}
                    dataKey="value"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={4}
                    stroke="none"
                  >
                    {modelSpend.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', color: '#fff' }}
                    formatter={(value: number) => [
                      modelSpendByTokens ? `${value.toLocaleString()} tokens` : `₹${value.toLocaleString()}`,
                      modelSpendByTokens ? 'Tokens' : 'Spend',
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 w-full space-y-1.5">
                {modelSpend.map((entry, index) => (
                  <div key={entry.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: pieColors[index % pieColors.length] }} />
                      <span className="max-w-[100px] truncate text-slate-300">{entry.name}</span>
                    </div>
                    <span className="shrink-0 font-medium text-white">
                      {modelSpendByTokens ? `${(entry.value / 1000).toFixed(1)}K tok` : `₹${entry.value.toLocaleString()}`}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
