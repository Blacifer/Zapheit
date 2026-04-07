import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  DollarSign,
  Layers3,
  RefreshCw,
  ShieldAlert,
  ShoppingBag,
  Siren,
  Sparkles,
  TrendingUp,
  ThumbsUp,
  ThumbsDown,
  Upload,
  FileText,
  X,
  XCircle,
  Zap,
  UserCheck,
} from 'lucide-react';
import {
  BarChart as RechartsBarChart,
  Bar as RechartsBar,
  XAxis as RechartsXAxis,
  YAxis as RechartsYAxis,
  Tooltip as RechartsTooltip,
  Cell as RechartsCell,
  ResponsiveContainer,
} from 'recharts';

const BarChart = RechartsBarChart as any;
const Bar = RechartsBar as any;
const HeatXAxis = RechartsXAxis as any;
const HeatYAxis = RechartsYAxis as any;
const HeatTooltip = RechartsTooltip as any;
const HeatCell = RechartsCell as any;
import type { AIAgent, Incident, CostData } from '../../types';
import type { AuditLogEntry } from '../../lib/api/governance';
import { USD_TO_INR } from '../../lib/currency';
import { api } from '../../lib/api-client';
import { authenticatedFetch } from '../../lib/api/_helpers';
import { useCountUp } from '../../hooks/useCountUp';
import { useApp } from '../../context/AppContext';
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from '../../utils/storage';

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

const OperationalMetrics = lazy(() => import('../../components/OperationalMetrics'));

export default function DashboardOverview({
  agents,
  incidents,
  costData,
  onAddAgent,
  onNavigate,
}: DashboardOverviewProps) {
  const { user } = useApp();
  const [telemetry, setTelemetry] = useState<OverviewTelemetry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const AUTO_REFRESH_INTERVAL = 30; // seconds

  // Morning Briefing — show once per calendar day per org
  const orgScope = user?.organizationName || 'workspace';
  const onboardingCompletedKey = `synthetic_hr_onboarding_completed:${orgScope}`;
  const onboardingCompleted = typeof window !== 'undefined' ? Boolean(localStorage.getItem(onboardingCompletedKey)) : false;
  const briefingKey = `${STORAGE_KEYS.MORNING_BRIEFING_DATE}:${orgScope}`;
  const todayStr = new Date().toISOString().slice(0, 10);
  const [showBriefing, setShowBriefing] = useState<boolean>(() => {
    const lastSeen = loadFromStorage<string>(briefingKey, '');
    return lastSeen !== todayStr;
  });

  const dismissBriefing = useCallback(() => {
    saveToStorage(briefingKey, todayStr);
    setShowBriefing(false);
  }, [briefingKey, todayStr]);

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

  // Team Activity Feed — recent audit log entries
  const [teamActivity, setTeamActivity] = useState<AuditLogEntry[]>([]);
  const loadTeamActivity = useCallback(async () => {
    try {
      const res = await api.auditLogs.list({ limit: 8 });
      if (res.success && Array.isArray(res.data)) {
        setTeamActivity(res.data);
      } else {
        setTeamActivity([]);
      }
    } catch { /* silently ignore */ }
  }, []);

  // Plan & Usage
  type UsageData = { used: number; quota: number; plan: string; planKey: string; month: string; agentCount?: number; agentLimit?: number };
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const quotaWarnKey = `synthetic_hr_quota_warn_dismissed:${orgScope}`;
  const [quotaBannerDismissed, setQuotaBannerDismissed] = useState<boolean>(() => {
    const stored = loadFromStorage<string>(quotaWarnKey, '');
    const thisMonth = new Date().toISOString().slice(0, 7);
    return stored === thisMonth;
  });
  const dismissQuotaBanner = useCallback(() => {
    saveToStorage(quotaWarnKey, new Date().toISOString().slice(0, 7));
    setQuotaBannerDismissed(true);
  }, [quotaWarnKey]);

  useEffect(() => {
    authenticatedFetch<UsageData>('/usage').then((res) => {
      if (res.success && res.data) setUsageData(res.data);
    }).catch(() => {});
  }, []);

  // ROI widgets — caching savings + auto-healing interventions
  const [cachingSavingsUsd, setCachingSavingsUsd] = useState<number>(0);
  const [automationRulesTotal, setAutomationRulesTotal] = useState<number>(0);
  const [csatData, setCsatData] = useState<{ total_rated: number; thumbs_up: number; thumbs_down: number; satisfaction_pct: number | null } | null>(null);
  const [trendingTopics, setTrendingTopics] = useState<Array<{ word: string; count: number }>>([]);
  const [quickDeployState, setQuickDeployState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [quickDeployError, setQuickDeployError] = useState<string | null>(null);

  useEffect(() => {
    // Widget 1: cost avoided via semantic caching
    api.caching.getState().then((res) => {
      if (res.success && res.data) {
        setCachingSavingsUsd(res.data.telemetry?.stats?.estimatedSavedCostUsd ?? 0);
      }
    }).catch(() => {});

    // Widget 2: auto-healing interventions (proposed + accepted synthesized rules)
    Promise.all([
      authenticatedFetch<any[]>('/rules/synthesized'),
      authenticatedFetch<any[]>('/rules/synthesized?status=accepted'),
    ]).then(([proposed, accepted]) => {
      const n = (Array.isArray(proposed.data) ? proposed.data.length : 0)
              + (Array.isArray(accepted.data) ? accepted.data.length : 0);
      setAutomationRulesTotal(n);
    }).catch(() => {});

    // CSAT + trending topics
    api.conversations.csatSummary().then((res) => {
      if (res.success && res.data) setCsatData(res.data);
    }).catch(() => {});

    api.conversations.trendingTopics().then((res) => {
      if (res.success && res.data?.topics) setTrendingTopics(res.data.topics);
    }).catch(() => {});
  }, []);

  const quotaPct = usageData && usageData.quota > 0 ? Math.round((usageData.used / usageData.quota) * 100) : 0;
  const isUnlimited = usageData?.quota === -1;
  const resetLabel = (() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 1);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  })();

  // Initial load
  useEffect(() => { void loadOverviewState(); void loadTeamActivity(); }, [loadOverviewState, loadTeamActivity]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void loadOverviewState();
    }, AUTO_REFRESH_INTERVAL * 1000);
    return () => clearInterval(interval);
  }, [loadOverviewState]);

const hasData = agents.length > 0;

  const handleQuickDeploy = async (file: File) => {
    setQuickDeployState('uploading');
    setQuickDeployError(null);
    const result = await api.agents.quickDeploy(file);
    if (result.success) {
      setQuickDeployState('done');
      // Give the user a moment to see success, then navigate to fleet
      setTimeout(() => onNavigate?.('fleet'), 1500);
    } else {
      setQuickDeployState('error');
      setQuickDeployError(result.error || 'Upload failed. Please try again.');
    }
  };

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
        title: `${agent.name} added to agents`,
        detail: `${(agent as any).config?.display_provider || agent.platform} · ${agent.model_name}`,
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
    const steps = [
      { num: 1, label: 'Connect your first App', sub: 'Link Slack, Zendesk, or any integration', action: () => onNavigate?.('apps') },
      { num: 2, label: 'Create your first Agent', sub: 'Pick a template or start from scratch', action: () => onAddAgent() },
      { num: 3, label: 'Set your first Safety Rule', sub: 'Control what your agent can and cannot do', action: () => onNavigate?.('action-policies') },
    ];
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Welcome to Rasi</h1>
          <p className="mt-2 text-slate-400">Three steps to get your first AI agent running safely.</p>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] backdrop-blur-xl p-8 shadow-[0_18px_60px_rgba(2,6,23,0.25)] space-y-3">
          {steps.map((step) => (
            <button
              key={step.num}
              onClick={step.action}
              className="w-full flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-5 py-4 text-left hover:bg-white/[0.07] hover:border-cyan-500/20 transition-all group"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-sm font-bold text-cyan-300">
                {step.num}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">{step.label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{step.sub}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-600 group-hover:text-cyan-400 transition-colors shrink-0" />
            </button>
          ))}
        </div>

        {/* Quick Deploy */}
        <div className="rounded-[28px] border border-cyan-500/20 bg-[radial-gradient(ellipse_at_top_left,rgba(34,211,238,0.07),transparent_60%)] bg-slate-900/60 backdrop-blur-xl p-8">
          <div className="flex items-start gap-4 mb-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10">
              <Zap className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Quick Deploy from PDF</h3>
              <p className="text-sm text-slate-400 mt-0.5">Upload your Employee Handbook or HR policy document and we will create a knowledgeable HR agent in seconds.</p>
            </div>
          </div>

          {quickDeployState === 'idle' || quickDeployState === 'error' ? (
            <label className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/10 bg-white/[0.02] px-6 py-8 text-center cursor-pointer hover:border-cyan-500/30 hover:bg-cyan-500/[0.03] transition-all group">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] group-hover:border-cyan-500/20 transition-colors">
                <Upload className="h-5 w-5 text-slate-400 group-hover:text-cyan-400 transition-colors" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Upload Employee Handbook (PDF)</p>
                <p className="text-xs text-slate-500 mt-1">Max 20 MB · Text-based PDFs only</p>
              </div>
              {quickDeployError && (
                <p className="text-xs text-rose-400 font-medium">{quickDeployError}</p>
              )}
              <input
                type="file"
                accept="application/pdf"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleQuickDeploy(file);
                  e.target.value = '';
                }}
              />
            </label>
          ) : quickDeployState === 'uploading' ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-8 text-center">
              <div className="w-10 h-10 rounded-full border-2 border-slate-700 border-t-cyan-400 animate-spin" />
              <div>
                <p className="text-sm font-semibold text-white">Ingesting document…</p>
                <p className="text-xs text-slate-500 mt-1">Extracting knowledge and creating your HR agent</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.05] px-6 py-8 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-white">HR Agent created!</p>
                <p className="text-xs text-slate-400 mt-1">Taking you to your new agent…</p>
              </div>
            </div>
          )}

          <p className="mt-4 text-center text-xs text-slate-500">
            <FileText className="inline h-3.5 w-3.5 mr-1 align-middle" />
            The document text is stored securely as the agent&apos;s knowledge context — never shared externally.
          </p>
        </div>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button onClick={() => onNavigate?.('getting-started')} className="btn-primary">
            <Sparkles className="h-5 w-5" />
            Start guided setup
          </button>
          <button onClick={onAddAgent} className="btn-secondary">
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

  // Telemetry returns USD; fallbacks are already INR — convert before mixing
  const last24hIncidents = telemetry?.movement.incidentsCurrent24h ?? fallbackLast24hIncidents.length;
  const previous24hIncidents = telemetry?.movement.incidentsPrevious24h ?? fallbackPrevious24hIncidents.length;
  const last24hSpend = telemetry != null ? telemetry.movement.spendCurrentDay * USD_TO_INR : fallbackLast24hSpend;
  const previous24hSpend = telemetry != null ? telemetry.movement.spendPreviousDay * USD_TO_INR : fallbackPrevious24hSpend;
  const last24hConversations = telemetry?.movement.requestsCurrentDay ?? fallbackLast24hConversations;
  const previous24hConversations = telemetry?.movement.requestsPreviousDay ?? fallbackPrevious24hConversations;
  const costTrend = telemetry?.trends.cost.map((entry) => entry.value * USD_TO_INR)
    ?? [...costData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(-7).map((entry) => entry.cost);
  const incidentTrend = telemetry?.trends.incidents.map((entry) => entry.value)
    ?? [...incidents].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).slice(-7).map(() => 1);
  const requestTrend = telemetry?.trends.requests.map((entry) => entry.value)
    ?? [...costData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(-7).map((entry) => entry.requests);

  const heroTone =
    severeIncidents.length > 0 ? 'risk' :
      openIncidents.length > 0 ? 'warn' :
        'good';

  // Widget 2 — time saved heuristic: 5 min per detected intervention
  const timeSavedMinutes = automationRulesTotal * 5;
  const timeSavedDisplay = timeSavedMinutes < 60
    ? `${timeSavedMinutes} min`
    : `${(timeSavedMinutes / 60).toFixed(1)}h`;

  // Widget 3 — incident heatmap: group all incidents by hour of day
  const incidentsByHour = useMemo(() => {
    const counts = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`,
      count: 0,
    }));
    for (const inc of incidents) {
      try { counts[new Date(inc.created_at).getHours()].count++; } catch { /* skip malformed */ }
    }
    return counts;
  }, [incidents]);
  const heatmapPeak = incidentsByHour.reduce(
    (a: { hour: number; label: string; count: number }, b: { hour: number; label: string; count: number }) =>
      a.count >= b.count ? a : b
  );

  // Animated counters — re-trigger on each data refresh
  const animatedIncidents = useCountUp(openIncidents.length);
  const animatedAgents = useCountUp(activeAgents.length);
  const animatedTotalAgents = useCountUp(agents.length);
  const animatedRisk = useCountUp(avgRiskScore);

  const nowCards = [
    {
      label: 'Open incidents',
      value: `${animatedIncidents}`,
      note: severeIncidents.length > 0 ? `${severeIncidents.length} high severity` : 'Queue under control',
      tone: severeIncidents.length > 0 ? 'text-rose-300' : 'text-white',
    },
    {
      label: 'Governed agents',
      value: `${animatedAgents}/${animatedTotalAgents}`,
      note: terminatedAgents.length > 0 ? `${terminatedAgents.length} terminated` : 'Agents mostly active',
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
      value: `${animatedRisk}/100`,
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
      delta: terminatedAgents.length > 0 ? `${terminatedAgents.length} terminated` : 'Agents mostly active',
      tone: terminatedAgents.length > 0 ? 'warn' : 'good',
      trend: [],
      stroke: terminatedAgents.length > 0 ? 'text-amber-300' : 'text-emerald-300',
    },
  ];

  const actionQueue = [
    !onboardingCompleted
      ? {
        id: 'setup-guided',
        title: 'Finish guided setup',
        description: 'Connect one app, run one test, and confirm the first tracked request so the workspace starts with real signal.',
        tone: 'info' as const,
        action: () => onNavigate?.('getting-started'),
      }
      : null,
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
        action: () => onNavigate?.('agents'),
      }
      : null,
    totalConversations === 0
      ? {
        id: 'traffic-none',
        title: 'Generate live traffic',
        description: 'No governed conversations have been recorded yet, so reliability and cost baselines are still cold.',
        tone: 'info' as const,
        action: () => onNavigate?.('agents'),
      }
      : null,
  ].filter(Boolean) as Array<{ id: string; title: string; description: string; tone: 'warn' | 'risk' | 'info'; action: () => void }>;
  const primaryAction = actionQueue[0] ?? null;
  const primaryActionLabel = primaryAction?.tone === 'risk'
    ? 'Urgent'
    : primaryAction?.tone === 'warn'
      ? 'Needs attention'
      : 'Recommended next step';

  const healthLabel = heroTone === 'risk' ? 'INCIDENT ACTIVE' : heroTone === 'warn' ? 'MONITORING' : 'SYSTEM HEALTHY';
  const healthClasses = heroTone === 'risk'
    ? 'border-rose-500/30 bg-rose-500/[0.07] text-rose-300'
    : heroTone === 'warn'
      ? 'border-amber-500/30 bg-amber-500/[0.07] text-amber-300'
      : 'border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-300';
  const dotClasses = heroTone === 'risk' ? 'bg-rose-400' : heroTone === 'warn' ? 'bg-amber-400' : 'bg-emerald-400';

  const firstName = user?.email
    ? (user.email.split('@')[0].split('.')[0] ?? 'there')
        .replace(/[^a-zA-Z]/g, '')
        .replace(/^./, (c: string) => c.toUpperCase()) || 'there'
    : 'there';
  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Good morning' : greetingHour < 17 ? 'Good afternoon' : 'Good evening';
  const nearBudgetAgents = agents.filter((a) => {
    const limit = Number(a.budget_limit || 0);
    const spend = Number(a.current_spend || 0);
    return limit > 0 && spend / limit >= 0.75;
  });

  // Ambient health color based on system state
  const ambientColor = severeIncidents.length > 0
    ? '#EF4444'
    : openIncidents.length > 0
      ? '#F59E0B'
      : '#10B981';

  return (
    <div className="space-y-8">
      {primaryAction && (
        <section className="rounded-[28px] border border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_45%),rgba(8,47,73,0.45)] p-5 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">{primaryActionLabel}</p>
              <h2 className="mt-2 text-xl font-bold text-white">{primaryAction.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">{primaryAction.description}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={primaryAction.action}
                className="btn-primary px-4 py-2.5 text-sm"
              >
                {primaryAction.title}
              </button>
              {!onboardingCompleted && (
                <button
                  onClick={() => onNavigate?.('agents')}
                  className="btn-secondary px-4 py-2.5 text-sm"
                >
                  Open agents
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Ambient system health bar */}
      <motion.div
        className="h-0.5 rounded-full -mt-2 mb-0"
        animate={{ backgroundColor: ambientColor, opacity: [0.6, 1, 0.6] }}
        transition={{ backgroundColor: { duration: 1.5, ease: 'easeInOut' }, opacity: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }}
        style={{ backgroundColor: ambientColor }}
      />

      {/* 90% quota warning banner */}
      {usageData && !isUnlimited && quotaPct >= 90 && !quotaBannerDismissed && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-rose-300">
            <span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse shrink-0" />
            <span>
              You&apos;ve used <span className="font-semibold">{quotaPct}%</span> of your monthly gateway quota
              ({usageData.used.toLocaleString()} / {usageData.quota.toLocaleString()} requests).
              Requests will be blocked at 100%.
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={() => onNavigate?.('settings')} className="text-xs font-semibold text-rose-200 hover:text-white transition-colors underline underline-offset-2">
              Upgrade plan →
            </button>
            <button onClick={dismissQuotaBanner} className="p-1 text-rose-400 hover:text-rose-200 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Morning Briefing — shown once per calendar day */}
      {showBriefing && (
        <div className="relative flex items-start gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-5 py-4 shadow-sm">
          {/* Accent bar */}
          <div className="absolute left-0 inset-y-0 w-1 rounded-l-2xl bg-gradient-to-b from-cyan-400 to-blue-500" />
          <div className="flex-1 min-w-0 pl-2">
            <p className="text-sm font-semibold text-slate-200">
              {greeting}, {firstName}. Here&apos;s where things stand.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${openIncidents.length > 0 ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${openIncidents.length > 0 ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                {openIncidents.length > 0 ? `${openIncidents.length} incident${openIncidents.length !== 1 ? 's' : ''} open` : 'No open incidents'}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                {last24hConversations.toLocaleString()} request{last24hConversations !== 1 ? 's' : ''} yesterday
              </span>
              {nearBudgetAgents.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  {nearBudgetAgents[0].name} near budget limit
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-400">
                Month spend: {formatCompactCurrency(totalCost)}
              </span>
              {usageData && !isUnlimited && quotaPct >= 70 && (
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${quotaPct >= 90 ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${quotaPct >= 90 ? 'bg-rose-400' : 'bg-amber-400'}`} />
                  {quotaPct}% gateway quota used
                </span>
              )}
            </div>
          </div>
          <button
            onClick={dismissBriefing}
            className="flex-shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-300"
            aria-label="Dismiss briefing"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Agent Status Grid — one node per governed agent */}
      {agents.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Agents · {agents.length} agent{agents.length !== 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {agents.map((agent) => {
              const isActive = agent.status === 'active';
              const isPaused = agent.status === 'paused';
              const isTerminated = agent.status === 'terminated';
              const dotColor = isActive ? '#10B981' : isPaused ? '#F59E0B' : '#64748b';
              return (
                <motion.button
                  key={agent.id}
                  title={`${agent.name} · ${agent.status}`}
                  onClick={() => onNavigate?.('agents')}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: isTerminated ? 0.45 : 1, scale: 1 }}
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 24 }}
                  className="relative flex items-center justify-center w-8 h-8 rounded-full border border-white/10 bg-slate-800/60"
                >
                  {/* Pulse ring for active agents */}
                  {isActive && (
                    <motion.span
                      className="absolute inset-0 rounded-full"
                      animate={{ scale: [1, 1.45], opacity: [0.5, 0] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
                      style={{ border: `1.5px solid ${dotColor}` }}
                    />
                  )}
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: dotColor }}
                  />
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {/* Today's Focus — only show when there is something to act on */}
      {(() => {
        const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
        const todayMs = todayMidnight.getTime();
        const todayNewIncidents = incidents.filter((i) => new Date(i.created_at).getTime() >= todayMs);
        const todayOpen = incidents.filter((i) => ['open', 'investigating'].includes((i.status || '').toLowerCase()));
        const todayCritical = todayOpen.filter((i) => ['high', 'critical'].includes((i.severity || '').toLowerCase()));
        const todayNearBudget = agents.filter((a) => {
          const limit = Number(a.budget_limit || 0); const spend = Number(a.current_spend || 0);
          return limit > 0 && spend / limit >= 0.75;
        });

        const focusItems = [
          todayCritical.length > 0 && {
            id: 'critical',
            icon: <ShieldAlert className="h-4 w-4 text-rose-400" />,
            label: `${todayCritical.length} critical incident${todayCritical.length !== 1 ? 's' : ''} need attention`,
            sub: todayCritical[0]?.title || 'Review now',
            tone: 'rose' as const,
            action: () => onNavigate?.('incidents'),
            cta: 'Investigate →',
          },
          todayNewIncidents.length > 0 && todayCritical.length === 0 && {
            id: 'new-incidents',
            icon: <Siren className="h-4 w-4 text-amber-400" />,
            label: `${todayNewIncidents.length} new incident${todayNewIncidents.length !== 1 ? 's' : ''} today`,
            sub: `${todayOpen.length} still open`,
            tone: 'amber' as const,
            action: () => onNavigate?.('incidents'),
            cta: 'Review →',
          },
          todayNearBudget.length > 0 && {
            id: 'budget',
            icon: <Zap className="h-4 w-4 text-amber-400" />,
            label: `${todayNearBudget.length} agent${todayNearBudget.length !== 1 ? 's' : ''} near budget limit`,
            sub: todayNearBudget[0]?.name || '',
            tone: 'amber' as const,
            action: () => onNavigate?.('agents'),
            cta: 'Adjust →',
          },
        ].filter(Boolean) as Array<{ id: string; icon: ReactNode; label: string; sub: string; tone: 'rose' | 'amber' | 'emerald'; action: (() => void) | null; cta: string | null }>;

        const toneMap = {
          rose: 'border-rose-500/20 bg-rose-500/[0.06]',
          amber: 'border-amber-500/20 bg-amber-500/[0.06]',
          emerald: 'border-emerald-500/20 bg-emerald-500/[0.06]',
        };

        if (focusItems.length === 0) return null;

        return (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Today&apos;s Focus · {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {focusItems.slice(0, 3).map((item) => (
                <div key={item.id} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${toneMap[item.tone]}`}>
                  {item.icon}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-200 leading-tight">{item.label}</p>
                    {item.sub && <p className="text-xs text-slate-500 truncate mt-0.5">{item.sub}</p>}
                  </div>
                  {item.action && item.cta && (
                    <button
                      onClick={item.action}
                      className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-200 border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] transition-colors whitespace-nowrap"
                    >
                      {item.cta}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* System Health Banner */}
      <div className={`flex items-center justify-between rounded-2xl border px-4 py-2.5 text-xs font-semibold ${healthClasses}`}>
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full animate-pulse ${dotClasses}`} />
          <span className="font-mono tracking-[0.16em]">{healthLabel}</span>
          <span className="opacity-40">·</span>
          <span className="font-normal opacity-70">{agents.length} agent{agents.length !== 1 ? 's' : ''} governed</span>
          {openIncidents.length > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span className="font-normal opacity-70">{openIncidents.length} open incident{openIncidents.length !== 1 ? 's' : ''}</span>
            </>
          )}
        </div>
        <span className="font-mono text-[10px] opacity-50 hidden sm:block">
          {telemetry?.generatedAt ? `refreshed ${formatRelative(telemetry.generatedAt)}` : 'live'}
        </span>
      </div>

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
              Know what is running, what needs attention, and what to do next across your governed agents.
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
                onClick={() => onNavigate?.('incidents')}
                className="btn-primary px-4 py-2.5 text-sm"
              >
                Review incidents
              </button>
              <button
                onClick={() => onNavigate?.('agents')}
                className="btn-secondary px-4 py-2.5 text-sm"
              >
                Open agents
              </button>
            </div>
          </div>

          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            variants={{ show: { transition: { staggerChildren: 0.07 } } }}
            initial="hidden"
            animate="show"
          >
            {nowCards.map((card) => (
              <motion.div
                key={card.label}
                variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0 } }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                className="card-surface p-4"
              >
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-semibold">{card.label}</p>
                <p className={`mt-3 text-3xl font-bold font-mono tabular-nums ${card.tone}`}>{card.value}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">{card.note}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 border-t border-slate-800/80 pt-5 md:grid-cols-2 xl:grid-cols-4">
          {movementCards.map((card) => (
            <div key={card.label} className="card-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{card.label}</p>
                  <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-white">{card.value}</p>
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

      {/* ── ROI / Value Visualization ────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionEyebrow label="Platform Value" />

        {/* Widgets 1 & 2 — side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

          {/* Widget 1: Cost Avoided via Caching */}
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] backdrop-blur-sm p-5 flex items-start gap-4">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-500/80 font-semibold">Cost Avoided via Caching</p>
              <p className="mt-2 text-3xl font-bold font-mono tabular-nums text-emerald-300">
                {cachingSavingsUsd >= 1000
                  ? `$${(cachingSavingsUsd / 1000).toFixed(1)}K`
                  : `$${cachingSavingsUsd.toFixed(2)}`}
              </p>
              <p className="mt-1.5 text-sm text-emerald-400/70 leading-5">
                Semantic cache saved this amount in model API costs
              </p>
            </div>
          </div>

          {/* Widget 2: Operator Time Saved */}
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] backdrop-blur-sm p-5 flex items-start gap-4">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center">
              <Clock className="w-5 h-5 text-violet-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.18em] text-violet-500/80 font-semibold">Operator Time Saved</p>
              <p className="mt-2 text-3xl font-bold font-mono tabular-nums text-violet-300">
                {timeSavedDisplay}
              </p>
              <p className="mt-1.5 text-sm text-violet-400/70 leading-5">
                {automationRulesTotal} auto-healing intervention{automationRulesTotal !== 1 ? 's' : ''} · 5 min each
              </p>
            </div>
          </div>

        </div>

        {/* Widget 3: Incident Heatmap */}
        <div className="card-surface p-5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-semibold">Incidents by Hour of Day</p>
            <span className="text-xs text-slate-600">{incidents.length} incident{incidents.length !== 1 ? 's' : ''} total</span>
          </div>
          <p className="text-xs text-slate-600 mb-4">Spot patterns — e.g. "The Finance agent fails every night at 3 AM"</p>

          {incidents.length === 0 ? (
            <p className="text-sm text-slate-600 py-4 text-center">No incidents recorded yet</p>
          ) : (
            <>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={incidentsByHour} margin={{ top: 0, right: 0, bottom: 0, left: -24 }}>
                    <HeatXAxis
                      dataKey="label"
                      tick={{ fill: '#475569', fontSize: 10 }}
                      interval={2}
                      axisLine={false}
                      tickLine={false}
                    />
                    <HeatYAxis
                      allowDecimals={false}
                      tick={{ fill: '#475569', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <HeatTooltip
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      contentStyle={{ background: '#0f172a', border: '1px solid rgba(100,116,139,0.3)', borderRadius: 8, fontSize: 12 }}
                      formatter={(value: number, _: string, entry: any) => [
                        `${value} incident${value !== 1 ? 's' : ''}`,
                        `${entry?.payload?.hour}:00`,
                      ]}
                      labelFormatter={() => ''}
                    />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {incidentsByHour.map((entry: { hour: number; label: string; count: number }) => (
                        <HeatCell
                          key={entry.hour}
                          fill={entry.count === 0
                            ? 'rgba(100,116,139,0.15)'
                            : entry.count >= heatmapPeak.count * 0.75
                              ? '#f87171'
                              : entry.count >= heatmapPeak.count * 0.4
                                ? '#fb923c'
                                : '#fbbf24'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {heatmapPeak.count > 0 && (
                <p className="mt-3 text-xs text-slate-500">
                  Peak: <span className="text-slate-300 font-semibold">{heatmapPeak.hour}:00</span>
                  {' '}— {heatmapPeak.count} incident{heatmapPeak.count !== 1 ? 's' : ''}
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {/* Plan & Usage card */}
      {usageData && (
        <div className="card-surface p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-white">Plan &amp; Usage</p>
            <div className="flex items-center gap-3">
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/25 text-blue-300 font-medium">{usageData.plan}</span>
              <button onClick={() => onNavigate?.('settings')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                Settings →
              </button>
            </div>
          </div>
          {isUnlimited ? (
            <p className="text-sm text-emerald-300 font-medium">Unlimited requests — no quota</p>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-2">Gateway requests this month</p>
              <div className="flex items-center gap-3 mb-2">
                <div className="flex-1 h-2 rounded-full bg-slate-700/60 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${quotaPct >= 90 ? 'bg-rose-500' : quotaPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(quotaPct, 100)}%` }}
                  />
                </div>
                <span className={`text-xs font-semibold tabular-nums shrink-0 ${quotaPct >= 90 ? 'text-rose-300' : quotaPct >= 70 ? 'text-amber-300' : 'text-slate-300'}`}>
                  {quotaPct}%
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{usageData.used.toLocaleString()} / {usageData.quota.toLocaleString()} requests</span>
                <span>Resets {resetLabel}</span>
              </div>
              {quotaPct >= 70 && (
                <p className={`mt-3 text-xs ${quotaPct >= 90 ? 'text-rose-400' : 'text-amber-400'}`}>
                  {quotaPct >= 90
                    ? 'Over 90% used — requests will be blocked at 100%. Consider upgrading.'
                    : `${100 - quotaPct}% remaining — consider upgrading if usage is growing.`}
                </p>
              )}
            </>
          )}
          {usageData.agentLimit !== undefined && usageData.agentLimit !== -1 && (
            <div className="mt-4 pt-4 border-t border-slate-700/50 flex items-center justify-between text-xs text-slate-500">
              <span>Active agents</span>
              <span className={`font-semibold tabular-nums ${(usageData.agentCount ?? 0) >= usageData.agentLimit ? 'text-rose-300' : 'text-slate-300'}`}>
                {usageData.agentCount ?? 0} / {usageData.agentLimit}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="card-surface rounded-[28px] p-6 shadow-[0_10px_40px_rgba(2,6,23,0.25)]">
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
                  Agents and incidents are not currently surfacing any high-priority setup or response gaps.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="card-surface rounded-[28px] p-6 shadow-[0_10px_40px_rgba(2,6,23,0.25)]">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-300 shrink-0" />
            <h2 className="text-base font-semibold text-white">Reliability</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">Operational metrics from live platform telemetry.</p>
          <div className="mt-6">
            <Suspense
              fallback={
                <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-6">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                    {[1, 2, 3, 4].map((item) => (
                      <div key={item} className="animate-pulse rounded-lg border border-slate-700 bg-slate-900/50 p-4">
                        <div className="mb-3 h-4 w-3/4 rounded bg-slate-700" />
                        <div className="h-8 w-1/2 rounded bg-slate-700" />
                      </div>
                    ))}
                  </div>
                </div>
              }
            >
              <OperationalMetrics />
            </Suspense>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="card-surface rounded-[28px] p-6 shadow-[0_10px_40px_rgba(2,6,23,0.25)]">
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-blue-300 shrink-0" />
            <h2 className="text-base font-semibold text-white">Recent Activity</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">Latest incident, fleet, and cost signals.</p>

          <div className="mt-6 space-y-3">
            {activityFeed.length > 0 ? (
              <AnimatePresence initial={false}>
                {activityFeed.map((item, index) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 12, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -8, height: 0 }}
                    transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                    className={`flex items-start gap-4 rounded-2xl border border-slate-800 p-4 overflow-hidden ${index === 0
                      ? 'bg-[linear-gradient(180deg,rgba(8,47,73,0.24),rgba(2,6,23,0.56))] shadow-[inset_0_1px_0_rgba(34,211,238,0.10)]'
                      : 'bg-[linear-gradient(180deg,rgba(2,6,23,0.22),rgba(2,6,23,0.50))]'
                      }`}
                  >
                    <div className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${item.tone === 'risk' ? 'bg-rose-400' : item.tone === 'warn' ? 'bg-amber-400' : 'bg-blue-300'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <p className="font-semibold text-white">{item.title}</p>
                        <span className="whitespace-nowrap text-xs text-slate-500">{formatRelative(item.at)}</span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-400">{item.detail}</p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
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

        <section className="card-surface rounded-[28px] p-6 shadow-[0_10px_40px_rgba(2,6,23,0.25)]">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-300 shrink-0" />
            <h2 className="text-base font-semibold text-white">Coverage Snapshot</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">Governance and cost visibility across your fleet.</p>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="card-surface p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Budget coverage</p>
              <p className="mt-3 text-3xl font-bold tabular-nums text-emerald-300">{agents.length === 0 ? '0%' : `${Math.round((agents.length - agentsWithoutBudget.length) / agents.length * 100)}%`}</p>
              <p className="mt-2 text-sm text-slate-400">{agents.length - agentsWithoutBudget.length}/{agents.length} agents capped</p>
            </div>
            <div className="card-surface p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Open incidents</p>
              <p className="mt-3 text-3xl font-bold tabular-nums text-slate-100">{openIncidents.length}</p>
              <p className="mt-2 text-sm text-slate-400">{severeIncidents.length} high severity</p>
            </div>
            <div className="card-surface p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Spend per agent</p>
              <p className="mt-3 text-3xl font-bold tabular-nums text-violet-300">{formatCurrency(averageSpendPerAgent)}</p>
              <p className="mt-2 text-sm text-slate-400">Current blended average</p>
            </div>
            <div className="card-surface p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Spend per conversation</p>
              <p className="mt-3 text-3xl font-bold tabular-nums text-white">{formatCurrency(averageSpendPerConversation)}</p>
              <p className="mt-2 text-sm text-slate-400">{totalConversations.toLocaleString()} total governed conversations</p>
            </div>
          </div>
        </section>
      </div>

      {/* "You Saved This Much" milestone card — shown when there are governed conversations */}
      {totalConversations > 0 && (() => {
        const MINS_PER_CONV = 5;         // avg manual handling time
        const LABOR_RATE_PER_HOUR = 500; // ₹/hr blended support cost
        const hoursSaved = Math.round(totalConversations * MINS_PER_CONV / 60);
        const moneySaved = Math.round(hoursSaved * LABOR_RATE_PER_HOUR);
        const netSaving = moneySaved - Math.round(totalCost);
        return (
          <section className="relative overflow-hidden rounded-[28px] border border-emerald-500/20 bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.12),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(6,182,212,0.08),transparent_50%)] bg-slate-900/60 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400">Automation savings</p>
                <h2 className="mt-1 text-2xl font-bold text-white">
                  Your agents handled {totalConversations.toLocaleString()} conversation{totalConversations !== 1 ? 's' : ''}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  That&apos;s an estimated {hoursSaved.toLocaleString()} hours of manual support work saved.
                </p>
              </div>
              <div className="flex gap-4 shrink-0">
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-300">₹{moneySaved.toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-0.5">labor saved</p>
                </div>
                <div className="w-px bg-white/10" />
                <div className="text-center">
                  <p className={`text-2xl font-bold ${netSaving >= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {netSaving >= 0 ? '+' : ''}₹{Math.abs(netSaving).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">net benefit</p>
                </div>
              </div>
            </div>
          </section>
        );
      })()}

      {/* Team Activity Feed */}
      {teamActivity.length > 0 && (
        <section className="card-surface rounded-[28px] p-6 shadow-[0_10px_40px_rgba(2,6,23,0.25)]">
          <div className="flex items-center gap-2 mb-4">
            <UserCheck className="h-4 w-4 text-blue-300 shrink-0" />
            <h2 className="text-base font-semibold text-white">Team Activity</h2>
            <span className="ml-auto text-xs text-slate-500">Last {teamActivity.length} actions</span>
          </div>
          <div className="space-y-2">
            {teamActivity.map((entry: AuditLogEntry) => {
              const actor = entry.users?.email
                ? entry.users.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
                : 'System';
              const action = entry.action.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
              const resource = entry.resource_type.replace(/_/g, ' ');
              return (
                <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2.5">
                  <div className="h-7 w-7 shrink-0 rounded-full bg-slate-700 flex items-center justify-center text-[11px] font-bold text-slate-300">
                    {actor.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-200">{actor}</span>
                    <span className="text-sm text-slate-500"> · {action} </span>
                    <span className="text-sm text-slate-400">{resource}</span>
                  </div>
                  <span className="shrink-0 text-xs text-slate-600">{formatRelative(entry.created_at)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* App Health widget */}
      {telemetry && telemetry.integrations.total > 0 ? (
        <section className="card-surface rounded-[28px] p-6 shadow-[0_10px_40px_rgba(2,6,23,0.25)]">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <SectionEyebrow label="Integration health" />
              <h2 className="text-[1.75rem] font-bold leading-tight text-white">App Health</h2>
              <p className="mt-1 text-sm text-slate-400">Live status of installed apps powering your agents.</p>
            </div>
            <button
              onClick={() => onNavigate?.('apps')}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 transition hover:text-white"
            >
              <ShoppingBag className="h-4 w-4" />
              Open apps
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
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
        <section className="card-surface rounded-[28px] p-6 shadow-[0_10px_40px_rgba(2,6,23,0.25)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-blue-300 shrink-0" />
                <h2 className="text-base font-semibold text-white">AI Workforce</h2>
              </div>
              <p className="mt-1 text-sm text-slate-400">Agent posture and risk by governed agent.</p>
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

        <section className="card-surface rounded-[28px] p-6 shadow-[0_10px_40px_rgba(2,6,23,0.25)]">
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

      {severeIncidents.length > 0 && (
        <section className="rounded-[28px] border border-rose-500/20 bg-rose-500/10 p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-rose-300 shrink-0" />
              <div>
                <p className="font-semibold text-rose-200">Privacy &amp; Security Alerts</p>
                <p className="mt-0.5 text-sm text-rose-100/80">
                  {severeIncidents.length} high-severity {severeIncidents.length === 1 ? 'threat requires' : 'threats require'} your attention.
                </p>
              </div>
            </div>
            <button
              onClick={() => onNavigate?.('incidents')}
              className="shrink-0 flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 transition-colors"
            >
              View All
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-2">
            {severeIncidents.slice(0, 3).map((incident) => (
              <div key={incident.id} className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/10 bg-rose-500/5 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-rose-100 truncate">{incident.title || incident.incident_type || 'Security Alert'}</p>
                  <p className="text-[11px] text-rose-300/70 capitalize">{incident.severity} severity - {incident.agent_name || 'Unknown agent'}</p>
                </div>
                <button
                  onClick={async () => {
                    await api.incidents.updateMeta(incident.id, { status: 'acknowledged' });
                    onNavigate?.('incidents');
                  }}
                  className="shrink-0 flex items-center gap-1 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20 transition-colors"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Acknowledge
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CSAT + Trending Topics row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Employee Satisfaction (CSAT) */}
        <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
            <h2 className="text-sm font-bold text-white tracking-wide uppercase">Employee Satisfaction</h2>
          </div>
          {csatData === null ? (
            <div className="h-16 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-slate-600 border-t-emerald-400 animate-spin" />
            </div>
          ) : csatData.total_rated === 0 ? (
            <p className="text-sm text-slate-400">No ratings yet. Employees can rate conversations after each session.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">Based on {csatData.total_rated} rated conversation{csatData.total_rated !== 1 ? 's' : ''}</p>
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold text-white">{csatData.satisfaction_pct}%</span>
                <span className="text-sm text-emerald-400 font-medium">Positive</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${csatData.satisfaction_pct ?? 0}%` }}
                />
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1"><ThumbsUp className="w-3.5 h-3.5 text-emerald-400" /> {csatData.thumbs_up} positive</span>
                <span className="flex items-center gap-1"><ThumbsDown className="w-3.5 h-3.5 text-rose-400" /> {csatData.thumbs_down} needs improvement</span>
              </div>
            </div>
          )}
        </section>

        {/* Trending Topics */}
        <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-5 w-5 text-cyan-400" />
            <h2 className="text-sm font-bold text-white tracking-wide uppercase">Trending Topics</h2>
          </div>
          {trendingTopics.length === 0 ? (
            <p className="text-sm text-slate-400">No conversation data yet. Topics will appear once employees start chatting.</p>
          ) : (
            <>
              <p className="text-xs text-slate-400 mb-3">What employees are asking about</p>
              <div className="flex flex-wrap gap-2">
                {trendingTopics.map(({ word, count }) => (
                  <button
                    key={word}
                    onClick={() => onNavigate?.('conversations')}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-slate-700/60 border border-slate-600/50 text-xs font-medium text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors capitalize"
                  >
                    {word}
                    <span className="ml-1 text-slate-500">{count}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

      </div>
    </div>
  );
}
