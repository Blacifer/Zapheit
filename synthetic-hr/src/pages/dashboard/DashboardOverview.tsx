import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  Layers3,
  RefreshCw,
  ShieldAlert,
  ShoppingBag,
  Siren,
  Sparkles,
  TrendingUp,
  Users,
  XCircle,
  Zap,
} from 'lucide-react';
import type { AIAgent, Incident, CostData } from '../../types';
import OperationalMetrics from '../../components/OperationalMetrics';
import { api } from '../../lib/api-client';

interface DashboardOverviewProps {
  agents: AIAgent[];
  incidents: Incident[];
  costData: CostData[];
  onAddAgent: () => void;
  onNavigate?: (page: string) => void;
}

type ActivityItem = {
  id: string;
  at: string;
  title: string;
  detail: string;
  tone: 'info' | 'warn' | 'risk';
};

type OverviewTelemetry = {
  generatedAt: string;
  days: number;
  movement: {
    spendCurrentDay: number;
    spendPreviousDay: number;
    requestsCurrentDay: number;
    requestsPreviousDay: number;
    incidentsCurrent24h: number;
    incidentsPrevious24h: number;
    healthyIntegrations: number;
    degradedIntegrations: number;
  };
  trends: {
    cost: Array<{ date: string; value: number }>;
    requests: Array<{ date: string; value: number }>;
    incidents: Array<{ date: string; value: number }>;
  };
  integrations: {
    total: number;
    healthy: number;
    degraded: number;
    requestVolumeAvailable: boolean;
  };
};

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1000 ? 1 : 2,
  }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatRelative(value?: string | null) {
  if (!value) return 'No timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No timestamp';
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

function statusToneClasses(tone: 'good' | 'warn' | 'risk' | 'info') {
  if (tone === 'good') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
  if (tone === 'warn') return 'border-amber-500/20 bg-amber-500/10 text-amber-300';
  if (tone === 'risk') return 'border-rose-500/20 bg-rose-500/10 text-rose-300';
  return 'border-white/10 bg-white/[0.04] text-slate-200';
}

function ActionPill({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: 'good' | 'warn' | 'risk' | 'info';
  onClick?: () => void;
}) {
  const className = `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${onClick ? 'hover:brightness-110' : ''} ${statusToneClasses(tone)}`;

  if (!onClick) {
    return (
      <span className={className}>
        {label}
      </span>
    );
  }

  return (
    <button onClick={onClick} className={className}>
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}

function Sparkline({
  values,
  strokeClass,
}: {
  values: number[];
  strokeClass: string;
}) {
  const safeValues = values.length > 1 ? values : [0, 0];
  const width = 120;
  const height = 36;
  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);
  const range = max - min || 1;
  const points = safeValues
    .map((value, index) => {
      const x = (index / (safeValues.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-9 w-full">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        className={strokeClass}
      />
    </svg>
  );
}

function SectionEyebrow({ label }: { label: string }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>;
}

export default function DashboardOverview({
  agents,
  incidents,
  costData,
  onAddAgent,
  onNavigate,
}: DashboardOverviewProps) {
  const [telemetry, setTelemetry] = useState<OverviewTelemetry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const AUTO_REFRESH_INTERVAL = 30; // seconds

  const loadOverviewState = useCallback(async () => {
    setRefreshing(true);
    try {
      const telemetryResponse = await api.dashboard.getTelemetry(7);
      if (telemetryResponse.success && telemetryResponse.data) {
        setTelemetry(telemetryResponse.data);
      }
    } catch { /* silently ignore */ }
    setRefreshing(false);
  }, []);

  // Initial load
  useEffect(() => { void loadOverviewState(); }, [loadOverviewState]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void loadOverviewState();
    }, AUTO_REFRESH_INTERVAL * 1000);
    return () => clearInterval(interval);
  }, [loadOverviewState]);

const hasData = agents.length > 0;

  const activityFeed = useMemo(() => {
    const items: ActivityItem[] = [
      ...incidents.slice(0, 6).map((incident): ActivityItem => ({
        id: `incident-${incident.id}`,
        at: incident.created_at,
        title: incident.title,
        detail: `${incident.agent_name} · ${incident.severity} · ${incident.status}`,
        tone: ['high', 'critical'].includes((incident.severity || '').toLowerCase()) ? 'risk' : 'warn',
      })),
      ...agents.slice(0, 6).map((agent): ActivityItem => ({
        id: `agent-${agent.id}`,
        at: agent.created_at,
        title: `${agent.name} added to fleet`,
        detail: `${agent.platform} · ${agent.model_name}`,
        tone: agent.status === 'terminated' ? 'warn' : 'info',
      })),
      ...costData.slice(0, 6).map((entry): ActivityItem => ({
        id: `cost-${entry.id}`,
        at: entry.date,
        title: `Cost recorded ${formatCurrency(entry.cost)}`,
        detail: `${entry.requests.toLocaleString()} request(s) · ${entry.tokens.toLocaleString()} tokens`,
        tone: 'info',
      })),
    ];

    return items
      .filter((item) => item.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 6);
  }, [agents, costData, incidents]);

  if (!hasData) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Overview</h1>
          <p className="mt-2 text-slate-400">Your command center wakes up after the first governed agent is added to fleet.</p>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] backdrop-blur-xl p-12 text-center shadow-[0_18px_60px_rgba(2,6,23,0.25)]">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl border border-white/10 bg-black/20">
            <Users className="h-10 w-10 text-slate-500" />
          </div>
          <h2 className="mb-4 text-2xl font-bold text-white">No governed agents yet</h2>
          <p className="mx-auto mb-8 max-w-md text-slate-400">
            Add your first agent to unlock live risk, spend, reliability, and incident telemetry across the overview.
          </p>
          <button
            onClick={onAddAgent}
            className="btn-primary"
          >
            <Bot className="h-5 w-5" />
            Add your first agent
          </button>
        </div>
      </div>
    );
  }

  const totalCost = costData.reduce((sum, item) => sum + item.cost, 0);
  const latestCostAt = [...costData]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]?.date;
  const activeAgents = agents.filter((agent) => agent.status === 'active');
  const terminatedAgents = agents.filter((agent) => agent.status === 'terminated');
  const agentsWithoutBudget = agents.filter((agent) => Number(agent.budget_limit || 0) <= 0);
  const openIncidents = incidents.filter((incident) => ['open', 'investigating'].includes((incident.status || '').toLowerCase()));
  const severeIncidents = openIncidents.filter((incident) => ['high', 'critical'].includes((incident.severity || '').toLowerCase()));
  const avgRiskScore = Math.round(agents.reduce((sum, agent) => sum + agent.risk_score, 0) / Math.max(agents.length, 1));
  const totalConversations = agents.reduce((sum, agent) => sum + agent.conversations, 0);
  const averageSpendPerAgent = totalCost / Math.max(agents.length, 1);
  const averageSpendPerConversation = totalCost / Math.max(totalConversations, 1);
  const now = Date.now();
  const fallbackLast24hIncidents = incidents.filter((incident) => now - new Date(incident.created_at).getTime() <= 24 * 60 * 60 * 1000);
  const fallbackPrevious24hIncidents = incidents.filter((incident) => {
    const age = now - new Date(incident.created_at).getTime();
    return age > 24 * 60 * 60 * 1000 && age <= 48 * 60 * 60 * 1000;
  });
  const fallbackLast24hSpend = costData
    .filter((entry) => now - new Date(entry.date).getTime() <= 24 * 60 * 60 * 1000)
    .reduce((sum, entry) => sum + entry.cost, 0);
  const fallbackPrevious24hSpend = costData
    .filter((entry) => {
      const age = now - new Date(entry.date).getTime();
      return age > 24 * 60 * 60 * 1000 && age <= 48 * 60 * 60 * 1000;
    })
    .reduce((sum, entry) => sum + entry.cost, 0);
  const fallbackLast24hConversations = costData
    .filter((entry) => now - new Date(entry.date).getTime() <= 24 * 60 * 60 * 1000)
    .reduce((sum, entry) => sum + entry.requests, 0);
  const fallbackPrevious24hConversations = costData
    .filter((entry) => {
      const age = now - new Date(entry.date).getTime();
      return age > 24 * 60 * 60 * 1000 && age <= 48 * 60 * 60 * 1000;
    })
    .reduce((sum, entry) => sum + entry.requests, 0);

  const last24hIncidents = telemetry?.movement.incidentsCurrent24h ?? fallbackLast24hIncidents.length;
  const previous24hIncidents = telemetry?.movement.incidentsPrevious24h ?? fallbackPrevious24hIncidents.length;
  const last24hSpend = telemetry?.movement.spendCurrentDay ?? fallbackLast24hSpend;
  const previous24hSpend = telemetry?.movement.spendPreviousDay ?? fallbackPrevious24hSpend;
  const last24hConversations = telemetry?.movement.requestsCurrentDay ?? fallbackLast24hConversations;
  const previous24hConversations = telemetry?.movement.requestsPreviousDay ?? fallbackPrevious24hConversations;
  const costTrend = telemetry?.trends.cost.map((entry) => entry.value)
    ?? [...costData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(-7).map((entry) => entry.cost);
  const incidentTrend = telemetry?.trends.incidents.map((entry) => entry.value)
    ?? [...incidents].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).slice(-7).map(() => 1);
  const requestTrend = telemetry?.trends.requests.map((entry) => entry.value)
    ?? [...costData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(-7).map((entry) => entry.requests);

  const heroTone =
    severeIncidents.length > 0 ? 'risk' :
      openIncidents.length > 0 ? 'warn' :
        'good';

  const nowCards = [
    {
      label: 'Open incidents',
      value: `${openIncidents.length}`,
      note: severeIncidents.length > 0 ? `${severeIncidents.length} high severity` : 'Queue under control',
      tone: severeIncidents.length > 0 ? 'text-rose-300' : 'text-white',
    },
    {
      label: 'Governed agents',
      value: `${activeAgents.length}/${agents.length}`,
      note: terminatedAgents.length > 0 ? `${terminatedAgents.length} terminated` : 'Fleet mostly active',
      tone: 'text-slate-100',
    },
    {
      label: 'Month spend',
      value: formatCurrency(totalCost),
      note: latestCostAt ? `Last cost signal ${formatRelative(latestCostAt)}` : 'No cost signal yet',
      tone: 'text-emerald-300',
    },
    {
      label: 'Average risk',
      value: `${avgRiskScore}/100`,
      note: avgRiskScore >= 70 ? 'Elevated governance risk' : avgRiskScore >= 40 ? 'Monitor risk posture' : 'Risk posture stable',
      tone: avgRiskScore >= 70 ? 'text-rose-300' : avgRiskScore >= 40 ? 'text-amber-300' : 'text-violet-300',
    },
  ];

  const movementCards = [
    {
      label: 'Spend last 24h',
      value: formatCompactCurrency(last24hSpend),
      delta: previous24hSpend > 0 ? `${last24hSpend >= previous24hSpend ? '+' : ''}${Math.round(((last24hSpend - previous24hSpend) / previous24hSpend) * 100)}% vs prior day` : 'No prior-day baseline',
      tone: last24hSpend > previous24hSpend ? 'warn' : 'good',
      trend: costTrend,
      stroke: last24hSpend > previous24hSpend ? 'text-amber-300' : 'text-emerald-300',
    },
    {
      label: 'Incidents last 24h',
      value: `${last24hIncidents}`,
      delta: previous24hIncidents > 0 ? `${last24hIncidents - previous24hIncidents >= 0 ? '+' : ''}${last24hIncidents - previous24hIncidents} vs prior day` : 'No prior-day baseline',
      tone: last24hIncidents > previous24hIncidents ? 'risk' : 'good',
      trend: incidentTrend,
      stroke: last24hIncidents > previous24hIncidents ? 'text-rose-300' : 'text-blue-200',
    },
    {
      label: 'Requests last 24h',
      value: `${last24hConversations.toLocaleString()}`,
      delta: previous24hConversations > 0 ? `${last24hConversations >= previous24hConversations ? '+' : ''}${Math.round(((last24hConversations - previous24hConversations) / previous24hConversations) * 100)}% vs prior day` : 'No prior-day baseline',
      tone: 'info',
      trend: requestTrend,
      stroke: 'text-blue-200',
    },
    {
      label: 'Active agents',
      value: `${activeAgents.length}`,
      delta: terminatedAgents.length > 0 ? `${terminatedAgents.length} terminated` : 'Fleet mostly active',
      tone: terminatedAgents.length > 0 ? 'warn' : 'good',
      trend: [],
      stroke: terminatedAgents.length > 0 ? 'text-amber-300' : 'text-emerald-300',
    },
  ];

  const actionQueue = [
    severeIncidents.length > 0
      ? {
        id: 'incidents-critical',
        title: 'Review high-severity incident evidence',
        description: `${severeIncidents.length} incident(s) are still high or critical.`,
        tone: 'risk' as const,
        action: () => onNavigate?.('blackbox'),
      }
      : null,
    agentsWithoutBudget.length > 0
      ? {
        id: 'agents-budget',
        title: 'Add budget caps to unguarded agents',
        description: `${agentsWithoutBudget.length} agent(s) still run without a budget limit.`,
        tone: 'warn' as const,
        action: () => onNavigate?.('fleet'),
      }
      : null,
    totalConversations === 0
      ? {
        id: 'traffic-none',
        title: 'Generate live traffic',
        description: 'No governed conversations have been recorded yet, so reliability and cost baselines are still cold.',
        tone: 'info' as const,
        action: () => onNavigate?.('fleet'),
      }
      : null,
  ].filter(Boolean) as Array<{ id: string; title: string; description: string; tone: 'warn' | 'risk' | 'info'; action: () => void }>;

  return (
    <div className="space-y-8">
      <section className="rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.06),transparent_28%),linear-gradient(135deg,rgba(2,6,23,0.90),rgba(2,6,23,0.98))] p-6 shadow-[0_18px_60px_rgba(2,6,23,0.26)]">
        <div className="grid gap-6 xl:grid-cols-2">
          <div>
            <SectionEyebrow label="Live command center" />
            <div className="flex flex-wrap items-center gap-3">
              <ActionPill
                label={heroTone === 'risk' ? 'Needs intervention' : heroTone === 'warn' ? 'Watch closely' : 'Stable now'}
                tone={heroTone}
              />
              <ActionPill label={`Risk score ${avgRiskScore}/100`} tone={avgRiskScore >= 70 ? 'risk' : avgRiskScore >= 40 ? 'warn' : 'good'} />
            </div>
            <h1 className="mt-3 text-2xl font-bold text-white">Overview</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-400">
              Live command center for fleet health, open risk, spend, and governance readiness.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <div className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${heroTone === 'risk' ? 'bg-rose-400' : heroTone === 'warn' ? 'bg-amber-400' : 'bg-emerald-400'} animate-pulse`} />
                Live
              </div>
              <span>·</span>
              <span>{telemetry?.generatedAt ? `Updated ${formatRelative(telemetry.generatedAt)}` : activityFeed.length > 0 ? formatRelative(activityFeed[0].at) : 'Awaiting data'}</span>
              <button
                onClick={() => void loadOverviewState()}
                disabled={refreshing}
                className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
              >
                <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => onNavigate?.('blackbox')}
                className="btn-primary px-4 py-2.5 text-sm"
              >
                Review incident evidence
              </button>
              <button
                onClick={() => onNavigate?.('fleet')}
                className="btn-secondary px-4 py-2.5 text-sm"
              >
                Open fleet
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {nowCards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-slate-800/90 bg-[linear-gradient(180deg,rgba(2,6,23,0.28),rgba(2,6,23,0.62))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
                <p className={`mt-3 text-3xl font-bold tabular-nums ${card.tone}`}>{card.value}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">{card.note}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 border-t border-slate-800/80 pt-5 md:grid-cols-2 xl:grid-cols-4">
          {movementCards.map((card) => (
            <div key={card.label} className="rounded-2xl border border-slate-800/90 bg-slate-950/45 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{card.label}</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-white">{card.value}</p>
                  <p className={`mt-1 text-xs ${card.tone === 'risk' ? 'text-rose-300' : card.tone === 'warn' ? 'text-amber-300' : card.tone === 'good' ? 'text-emerald-300' : 'text-slate-200'}`}>
                    {card.delta}
                  </p>
                </div>
                <TrendingUp className={`h-4 w-4 ${card.stroke}`} />
              </div>
              <div className="mt-3">
                {card.trend.length > 1 ? (
                  <Sparkline values={card.trend} strokeClass={card.stroke} />
                ) : (
                  <div className="flex h-9 items-center text-[11px] uppercase tracking-[0.18em] text-slate-500">Snapshot only</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-[28px] border border-slate-800/90 bg-slate-900/50 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
          <div className="flex items-center gap-2">
            <Siren className="h-4 w-4 text-blue-300 shrink-0" />
            <h2 className="text-base font-semibold text-white">Action Queue</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">Shortest path to reducing real risk right now.</p>

          <div className="mt-6 space-y-3">
            {actionQueue.length > 0 ? (
              actionQueue.map((item) => (
                <button
                  key={item.id}
                  onClick={item.action}
                  className="group flex w-full items-start justify-between gap-4 rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,rgba(2,6,23,0.22),rgba(2,6,23,0.50))] p-4 text-left transition hover:border-white/15 hover:bg-slate-950/75"
                >
                  <div>
                    <p className="font-semibold text-white">{item.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{item.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <ActionPill label={item.tone === 'risk' ? 'Urgent' : item.tone === 'warn' ? 'Needs setup' : 'Next step'} tone={item.tone} />
                    <ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:text-blue-200" />
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_45%),rgba(16,185,129,0.08)] p-5">
                <p className="font-semibold text-emerald-200">No urgent queue items right now</p>
                <p className="mt-2 text-sm leading-6 text-emerald-100/80">
                  Fleet and incidents are not currently surfacing any high-priority setup or response gaps.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-800/90 bg-slate-900/50 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-300 shrink-0" />
            <h2 className="text-base font-semibold text-white">Reliability</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">Operational metrics from live platform telemetry.</p>
          <div className="mt-6">
            <OperationalMetrics />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-[28px] border border-slate-800/90 bg-slate-900/50 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-blue-300 shrink-0" />
            <h2 className="text-base font-semibold text-white">Recent Activity</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">Latest incident, fleet, and cost signals.</p>

          <div className="mt-6 space-y-3">
            {activityFeed.length > 0 ? (
              activityFeed.map((item, index) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-4 rounded-2xl border border-slate-800 p-4 ${index === 0
                    ? 'bg-[linear-gradient(180deg,rgba(8,47,73,0.24),rgba(2,6,23,0.56))] shadow-[inset_0_1px_0_rgba(34,211,238,0.10)]'
                    : 'bg-[linear-gradient(180deg,rgba(2,6,23,0.22),rgba(2,6,23,0.50))]'
                    }`}
                >
                  <div className={`mt-1 h-2.5 w-2.5 rounded-full ${item.tone === 'risk' ? 'bg-rose-400' : item.tone === 'warn' ? 'bg-amber-400' : 'bg-blue-300'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <p className="font-semibold text-white">{item.title}</p>
                      <span className="whitespace-nowrap text-xs text-slate-500">{formatRelative(item.at)}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{item.detail}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.10),transparent_42%),rgba(2,6,23,0.55)] p-5">
                <p className="font-semibold text-white">No recent activity yet</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Once incidents, costs, or new fleet events land, the latest records will show up here automatically.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-800/90 bg-slate-900/50 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-300 shrink-0" />
            <h2 className="text-base font-semibold text-white">Coverage Snapshot</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">Governance and cost visibility across your fleet.</p>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,rgba(2,6,23,0.22),rgba(2,6,23,0.50))] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Budget coverage</p>
              <p className="mt-3 text-3xl font-bold tabular-nums text-emerald-300">{agents.length === 0 ? '0%' : `${Math.round((agents.length - agentsWithoutBudget.length) / agents.length * 100)}%`}</p>
              <p className="mt-2 text-sm text-slate-400">{agents.length - agentsWithoutBudget.length}/{agents.length} agents capped</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,rgba(2,6,23,0.22),rgba(2,6,23,0.50))] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Open incidents</p>
              <p className="mt-3 text-3xl font-bold tabular-nums text-slate-100">{openIncidents.length}</p>
              <p className="mt-2 text-sm text-slate-400">{severeIncidents.length} high severity</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,rgba(2,6,23,0.22),rgba(2,6,23,0.50))] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Spend per agent</p>
              <p className="mt-3 text-3xl font-bold tabular-nums text-violet-300">{formatCurrency(averageSpendPerAgent)}</p>
              <p className="mt-2 text-sm text-slate-400">Current blended average</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,rgba(2,6,23,0.22),rgba(2,6,23,0.50))] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Spend per conversation</p>
              <p className="mt-3 text-3xl font-bold tabular-nums text-white">{formatCurrency(averageSpendPerConversation)}</p>
              <p className="mt-2 text-sm text-slate-400">{totalConversations.toLocaleString()} total governed conversations</p>
            </div>
          </div>
        </section>
      </div>

      {/* App Health widget */}
      {telemetry && telemetry.integrations.total > 0 ? (
        <section className="rounded-[28px] border border-slate-800/90 bg-slate-900/50 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <SectionEyebrow label="Integration health" />
              <h2 className="text-[1.75rem] font-bold leading-tight text-white">App Health</h2>
              <p className="mt-1 text-sm text-slate-400">Live status of installed apps powering your agents.</p>
            </div>
            <button
              onClick={() => onNavigate?.('marketplace')}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 transition hover:text-white"
            >
              <ShoppingBag className="h-4 w-4" />
              App Store
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
              <p className="text-2xl font-bold tabular-nums text-emerald-300">{telemetry.integrations.healthy}</p>
              <p className="text-xs text-slate-400 mt-1">Connected</p>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-center">
              <XCircle className="w-5 h-5 text-amber-400 mx-auto mb-2" />
              <p className="text-2xl font-bold tabular-nums text-amber-300">{telemetry.integrations.degraded}</p>
              <p className="text-xs text-slate-400 mt-1">Degraded</p>
            </div>
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4 text-center">
              <Zap className="w-5 h-5 text-slate-400 mx-auto mb-2" />
              <p className="text-2xl font-bold tabular-nums text-slate-200">{telemetry.integrations.total}</p>
              <p className="text-xs text-slate-400 mt-1">Total apps</p>
            </div>
          </div>
          {telemetry.integrations.degraded > 0 ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-500/[0.06] px-4 py-3">
              <p className="text-sm text-amber-200">
                <span className="font-semibold">{telemetry.integrations.degraded} app{telemetry.integrations.degraded > 1 ? 's' : ''}</span> need attention — re-auth or check credentials.
              </p>
              <button
                onClick={() => onNavigate?.('integrations')}
                className="shrink-0 text-xs font-semibold text-amber-300 hover:text-amber-100 transition-colors inline-flex items-center gap-1"
              >
                Fix now <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] px-4 py-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <p className="text-sm text-emerald-200">All connected apps are healthy.</p>
            </div>
          )}
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-[28px] border border-slate-800/90 bg-slate-900/50 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-blue-300 shrink-0" />
                <h2 className="text-base font-semibold text-white">AI Workforce</h2>
              </div>
              <p className="mt-1 text-sm text-slate-400">Fleet posture and risk by governed agent.</p>
            </div>
            <ActionPill label={`${activeAgents.length} active`} tone={activeAgents.length === agents.length ? 'good' : 'warn'} />
          </div>

          <div className="mt-6 space-y-3">
            {agents.map((agent) => (
              <div key={agent.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,rgba(2,6,23,0.22),rgba(2,6,23,0.50))] p-4">
                <div className="flex min-w-0 items-center gap-4">
                  <div className={`h-3 w-3 rounded-full ${agent.status === 'active' ? 'bg-emerald-400' : agent.status === 'paused' ? 'bg-amber-400' : 'bg-rose-400'
                    }`} />
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{agent.name}</p>
                    <p className="truncate text-sm text-slate-400">{agent.agent_type} · {agent.model_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ActionPill
                    label={agent.risk_level === 'low' ? 'Stable' : agent.risk_level === 'medium' ? 'Watch' : 'High risk'}
                    tone={agent.risk_level === 'low' ? 'good' : agent.risk_level === 'medium' ? 'warn' : 'risk'}
                  />
                  <span className="text-sm font-semibold tabular-nums text-slate-300">{formatCurrency(agent.current_spend || 0)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-800/90 bg-slate-900/50 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-blue-300 shrink-0" />
                <h2 className="text-base font-semibold text-white">Open Incidents</h2>
              </div>
              <p className="mt-1 text-sm text-slate-400">Active incidents requiring attention.</p>
            </div>
            <button
              onClick={() => onNavigate?.('blackbox')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
            >
              View all
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {openIncidents.length === 0 ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-3 text-sm text-emerald-200">
                No open incidents right now.
              </div>
            ) : (
              openIncidents.slice(0, 5).map((incident) => (
                <div key={incident.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{incident.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{incident.agent_name} · {formatRelative(incident.created_at)}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${['high', 'critical'].includes((incident.severity || '').toLowerCase()) ? 'border-rose-400/20 bg-rose-400/10 text-rose-300' : 'border-amber-400/20 bg-amber-400/10 text-amber-300'}`}>
                    {incident.severity}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {severeIncidents.length > 0 ? (
        <section className="rounded-[28px] border border-rose-500/20 bg-rose-500/10 p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-rose-300" />
            <div>
              <p className="font-semibold text-rose-200">Escalation notice</p>
              <p className="mt-1 text-sm leading-6 text-rose-100/80">
                High-severity incidents are still open. The overview is intentionally surfacing real risk instead of smoothing it away with cosmetic “healthy” states.
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
