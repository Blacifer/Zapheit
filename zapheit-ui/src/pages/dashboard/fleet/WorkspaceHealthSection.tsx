import { useState, useEffect, useCallback } from 'react';
import { Activity, Loader2, AlertTriangle, RotateCcw, TrendingUp, Zap, ShieldCheck } from 'lucide-react';
import { api } from '../../../lib/api-client';
import type { AIAgent } from '../../../types';

interface HealthData {
  agentId: string;
  period: string;
  latency: { p50: number; p95: number; p99: number };
  errorRate: number;
  totalRequests: number;
  totalIncidents: number;
  highSeverityIncidents: number;
  totalCostUsd: number;
  uptimePct: number;
  agentStatus: string;
  sparkline: Array<{ date: string; requests: number; avgLatency: number; cost: number }>;
}

// Simple SVG sparkline — no external library
function Sparkline({
  data,
  valueKey,
  color,
  height = 40,
}: {
  data: Array<{ date: string; requests: number; avgLatency: number; cost: number }>;
  valueKey: 'requests' | 'avgLatency';
  color: string;
  height?: number;
}) {
  const values = data.map((d) => d[valueKey]);
  const max = Math.max(...values, 1);
  const width = 200;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - (v / max) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const polyline = pts.join(' ');
  const fillPts = `0,${height} ${polyline} ${width},${height}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
      <polygon points={fillPts} fill={color} fillOpacity="0.15" />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        {label}
      </div>
      <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function LatencyBar({ label, ms, max }: { label: string; ms: number; max: number }) {
  const pct = max > 0 ? (ms / max) * 100 : 0;
  const color = pct >= 80 ? 'bg-rose-500' : pct >= 50 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-white">{ms > 0 ? `${ms}ms` : '—'}</span>
      </div>
      <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface TrustScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  breakdown: { riskComponent: number; errorRateComponent: number; redTeamComponent: number; policyComponent: number };
  inputs: { riskScore: number; errorRate: number; redTeamPassRate: number; policyCompliancePct: number };
}

export function WorkspaceHealthSection({ agent }: { agent: AIAgent }) {
  const [data, setData] = useState<HealthData | null>(null);
  const [trustScore, setTrustScore] = useState<TrustScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthRes, trustRes] = await Promise.all([
        api.agents.getHealth(agent.id),
        api.agents.getTrustScore(agent.id).catch(() => null),
      ]);
      if (!healthRes.success || !healthRes.data) throw new Error(healthRes.error || 'Failed to load health data');
      setData(healthRes.data as HealthData);
      if (trustRes?.success && trustRes.data) setTrustScore(trustRes.data as TrustScore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [agent.id]);

  useEffect(() => { void load(); }, [load]);

  const uptimeColor = !data ? 'text-slate-400'
    : data.uptimePct >= 99 ? 'text-emerald-400'
    : data.uptimePct >= 95 ? 'text-amber-400'
    : 'text-rose-400';

  const errorColor = !data ? 'text-slate-400'
    : data.errorRate === 0 ? 'text-emerald-400'
    : data.errorRate < 1 ? 'text-amber-400'
    : 'text-rose-400';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" /> Agent Health — Last 30 Days
        </h4>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 text-xs text-slate-500 py-12">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading health metrics…
        </div>
      ) : data ? (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Uptime SLA"
              value={`${data.uptimePct}%`}
              sub={data.agentStatus === 'terminated' ? 'Agent terminated' : 'Last 30 days'}
              color={uptimeColor}
              icon={ShieldCheck}
            />
            <StatCard
              label="Error Rate"
              value={`${data.errorRate}%`}
              sub={`${data.highSeverityIncidents} high/critical incidents`}
              color={errorColor}
              icon={AlertTriangle}
            />
            <StatCard
              label="P95 Latency"
              value={data.latency.p95 > 0 ? `${data.latency.p95}ms` : '—'}
              sub={`P99: ${data.latency.p99 > 0 ? data.latency.p99 + 'ms' : '—'}`}
              color="text-purple-400"
              icon={Zap}
            />
            <StatCard
              label="Total Requests"
              value={data.totalRequests.toLocaleString()}
              sub={`$${data.totalCostUsd.toFixed(4)} total cost`}
              color="text-blue-400"
              icon={TrendingUp}
            />
          </div>

          {/* Latency breakdown */}
          {(data.latency.p50 > 0 || data.latency.p95 > 0 || data.latency.p99 > 0) && (
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Latency Percentiles</p>
              <div className="space-y-2">
                {(() => {
                  const max = data.latency.p99 || data.latency.p95 || data.latency.p50 || 1;
                  return (
                    <>
                      <LatencyBar label="P50 (median)" ms={data.latency.p50} max={max} />
                      <LatencyBar label="P95" ms={data.latency.p95} max={max} />
                      <LatencyBar label="P99" ms={data.latency.p99} max={max} />
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Sparklines */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Daily Requests — 14 Days</p>
              <Sparkline data={data.sparkline} valueKey="requests" color="#22d3ee" />
              <div className="flex justify-between text-[10px] text-slate-600">
                <span>{data.sparkline[0]?.date}</span>
                <span>{data.sparkline[data.sparkline.length - 1]?.date}</span>
              </div>
            </div>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Avg Latency (ms) — 14 Days</p>
              <Sparkline data={data.sparkline} valueKey="avgLatency" color="#a78bfa" />
              <div className="flex justify-between text-[10px] text-slate-600">
                <span>{data.sparkline[0]?.date}</span>
                <span>{data.sparkline[data.sparkline.length - 1]?.date}</span>
              </div>
            </div>
          </div>

          {data.totalRequests === 0 && (
            <p className="text-xs text-slate-500 text-center py-4">
              No gateway traffic recorded for this agent in the last 30 days.
              Latency and error metrics will appear once requests flow through the Zapheit gateway.
            </p>
          )}

          {trustScore && (
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Trust Score</p>
                <div className="flex items-center gap-2">
                  <span className={`text-2xl font-bold font-mono ${trustScore.grade === 'A' ? 'text-emerald-400' : trustScore.grade === 'B' ? 'text-blue-400' : trustScore.grade === 'C' ? 'text-amber-400' : 'text-rose-400'}`}>
                    {trustScore.score}
                  </span>
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold border ${trustScore.grade === 'A' ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' : trustScore.grade === 'B' ? 'bg-blue-400/10 text-blue-400 border-blue-400/20' : trustScore.grade === 'C' ? 'bg-amber-400/10 text-amber-400 border-amber-400/20' : 'bg-rose-400/10 text-rose-400 border-rose-400/20'}`}>
                    Grade {trustScore.grade}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Risk Profile', value: trustScore.breakdown.riskComponent, max: 35, sub: `Risk score: ${trustScore.inputs.riskScore}/100` },
                  { label: 'Error Rate', value: trustScore.breakdown.errorRateComponent, max: 30, sub: `${trustScore.inputs.errorRate}% high-severity` },
                  { label: 'Red Team', value: trustScore.breakdown.redTeamComponent, max: 20, sub: `${trustScore.inputs.redTeamPassRate}% pass rate` },
                  { label: 'Policy', value: trustScore.breakdown.policyComponent, max: 15, sub: `${trustScore.inputs.policyCompliancePct}% compliance` },
                ].map(({ label, value, max, sub }) => (
                  <div key={label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">{label}</span>
                      <span className="font-mono text-white">{value}/{max}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${(value / max) * 100}%` }} />
                    </div>
                    <p className="text-[10px] text-slate-600">{sub}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
