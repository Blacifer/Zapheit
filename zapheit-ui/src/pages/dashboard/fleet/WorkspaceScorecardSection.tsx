/**
 * WorkspaceScorecardSection.tsx
 *
 * Agent Performance Scorecard — the agent's "quarterly review".
 * Displays a composite 0–100 score weighted across satisfaction,
 * SLO compliance, incident rate, and cost efficiency, plus a
 * 3-period trend chart.
 */

import { useEffect, useState } from 'react';
import {
  Star, TrendingUp, TrendingDown, Minus, RefreshCw,
  CheckCircle2, AlertTriangle, DollarSign, Heart,
} from 'lucide-react';
import { api } from '../../../lib/api-client';
import type { AIAgent } from '../../../types';

interface Props {
  agent: AIAgent;
}

type ScorecardData = NonNullable<Awaited<ReturnType<typeof api.agents.getScorecard>>['data']>;

const GRADE_COLORS: Record<string, string> = {
  A: 'text-emerald-400',
  B: 'text-blue-400',
  C: 'text-amber-400',
  D: 'text-red-400',
};

const GRADE_BG: Record<string, string> = {
  A: 'bg-emerald-500/10 border-emerald-500/20',
  B: 'bg-blue-500/10 border-blue-500/20',
  C: 'bg-amber-500/10 border-amber-500/20',
  D: 'bg-red-500/10 border-red-500/20',
};

const SCORE_BAR_COLOR: Record<string, string> = {
  A: 'bg-emerald-500',
  B: 'bg-blue-500',
  C: 'bg-amber-500',
  D: 'bg-red-500',
};

function ScoreBar({ label, value, icon, weight }: {
  label: string;
  value: number;
  icon: React.ReactNode;
  weight: string;
}) {
  const grade = value >= 90 ? 'A' : value >= 75 ? 'B' : value >= 60 ? 'C' : 'D';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-white/60">
          {icon}
          {label}
          <span className="text-white/30">({weight})</span>
        </span>
        <span className={`font-semibold ${GRADE_COLORS[grade]}`}>{value}</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${SCORE_BAR_COLOR[grade]}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function TrendBar({ scores }: { scores: number[] }) {
  const max = Math.max(...scores, 1);
  const labels = ['2mo ago', 'Last mo', 'This mo'];
  return (
    <div className="flex items-end gap-3 h-16">
      {scores.map((s, i) => {
        const grade = s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : 'D';
        const heightPct = Math.max(8, (s / max) * 100);
        const isLatest = i === scores.length - 1;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-xs text-white/50">{s}</span>
            <div
              className={`w-full rounded-t ${SCORE_BAR_COLOR[grade]} ${isLatest ? 'opacity-100' : 'opacity-40'} transition-all duration-500`}
              style={{ height: `${heightPct}%` }}
            />
            <span className="text-[10px] text-white/30">{labels[i]}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function WorkspaceScorecardSection({ agent }: Props) {
  const [data, setData] = useState<ScorecardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await api.agents.getScorecard(agent.id);
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? 'Failed to load scorecard');
      return;
    }
    setData(res.data);
  }

  useEffect(() => { load(); }, [agent.id]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/40 py-6">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Computing performance score…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-3 text-sm text-red-400/80 py-4">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        {error ?? 'No scorecard data available'}
        <button onClick={load} className="ml-auto text-white/40 hover:text-white/60 transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const { current, trend, history } = data;
  const trendScores = history.map((h) => h.score);
  const TrendIcon = trend === 'improving' ? TrendingUp : trend === 'declining' ? TrendingDown : Minus;
  const trendColor = trend === 'improving' ? 'text-emerald-400' : trend === 'declining' ? 'text-red-400' : 'text-white/50';

  return (
    <div className="space-y-6">
      {/* Hero score card */}
      <div className="bg-white/5 rounded-xl p-5 border border-white/10 flex items-center gap-6 flex-wrap">
        <div className={`w-24 h-24 rounded-2xl border flex flex-col items-center justify-center shrink-0 ${GRADE_BG[current.grade]}`}>
          <span className={`text-4xl font-bold ${GRADE_COLORS[current.grade]}`}>{current.grade}</span>
          <span className="text-xs text-white/40 mt-0.5">{current.score}/100</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Star className="w-4 h-4 text-white/40" />
            <span className="text-sm font-semibold text-white">Performance Score</span>
            <button onClick={load} className="ml-auto text-white/30 hover:text-white/60 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs text-white/40 mb-3">
            Composite score weighted across satisfaction, SLO compliance, incident rate, and cost efficiency.
          </p>
          <div className={`inline-flex items-center gap-1.5 text-xs font-medium ${trendColor}`}>
            <TrendIcon className="w-3.5 h-3.5" />
            {trend === 'improving' ? 'Improving vs last month' :
             trend === 'declining' ? 'Declining vs last month' :
             'Stable vs last month'}
          </div>
        </div>
      </div>

      {/* Score breakdown */}
      <div className="bg-white/5 rounded-xl p-5 border border-white/10 space-y-4">
        <h3 className="text-sm font-semibold text-white/70">Score Breakdown</h3>
        <ScoreBar
          label="Satisfaction"
          value={current.breakdown.satisfaction}
          icon={<Heart className="w-3.5 h-3.5" />}
          weight="40%"
        />
        <ScoreBar
          label="SLO Compliance"
          value={current.breakdown.slo_pass_rate}
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          weight="30%"
        />
        <ScoreBar
          label="Incident Score"
          value={current.breakdown.incident_score}
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          weight="20%"
        />
        <ScoreBar
          label="Cost Efficiency"
          value={current.breakdown.cost_efficiency}
          icon={<DollarSign className="w-3.5 h-3.5" />}
          weight="10%"
        />
      </div>

      {/* 3-period trend */}
      <div className="bg-white/5 rounded-xl p-5 border border-white/10">
        <h3 className="text-sm font-semibold text-white/70 mb-4">3-Month Trend</h3>
        <TrendBar scores={trendScores} />
      </div>

      {/* Raw inputs */}
      <div className="bg-white/5 rounded-xl p-5 border border-white/10">
        <h3 className="text-sm font-semibold text-white/70 mb-3">This Month's Inputs</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Conversations', value: current.inputs.total_conversations.toLocaleString() },
            { label: 'Incident Rate', value: `${current.inputs.incident_rate_pct}%` },
            { label: 'Cost / Conv', value: `$${current.inputs.cost_per_conv_usd.toFixed(4)}` },
            { label: 'Satisfaction', value: current.inputs.satisfaction_pct != null ? `${current.inputs.satisfaction_pct}%` : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="space-y-1">
              <div className="text-xs text-white/40">{label}</div>
              <div className="text-sm font-semibold text-white">{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
