import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardList,
  Clock,
  DollarSign,
  Layers3,
  Pause,
  Play,
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
import type { ApprovalRequest } from '../../lib/api/approvals';
import { USD_TO_INR } from '../../lib/currency';
import { calculatePortfolioRoi, formatInr as formatRoiInr } from '../../lib/roi';
import { api } from '../../lib/api-client';
import { authenticatedFetch } from '../../lib/api/_helpers';
import { useCountUp } from '../../hooks/useCountUp';
import { useActivityStream, type ActivityStreamStatus } from '../../hooks/useActivityStream';
import { useApp } from '../../context/AppContext';
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from '../../utils/storage';
import { HubLiveMetrics, type IntegrationConfig } from './hubs/HubLiveMetrics';
import {
  deriveOrgReadinessScore,
  readinessTone,
  READINESS_LABELS,
  type UnifiedActivityEvent,
} from '../../lib/production-readiness';

// ── Connected App Metrics for Dashboard Overview ──────────────────────────────
const DASHBOARD_INTEGRATIONS: IntegrationConfig[] = [
  {
    connectorId: 'jira',
    appName: 'Jira',
    icon: <ClipboardList className="w-3.5 h-3.5 text-blue-400" />,
    workspacePath: '/dashboard/apps/jira/workspace',
    brandBg: 'bg-blue-500/20',
    metrics: [
      { label: 'Open Issues', action: 'list_issues', params: { jql: 'status != Done', limit: 1 }, transform: (d: any) => Array.isArray(d) ? d.length : (d?.total ?? '—') },
    ],
  },
  {
    connectorId: 'github',
    appName: 'GitHub',
    icon: <Activity className="w-3.5 h-3.5 text-slate-300" />,
    workspacePath: '/dashboard/apps/github/workspace',
    brandBg: 'bg-slate-700/60',
    metrics: [
      { label: 'Open PRs', action: 'list_pulls', params: { state: 'open', limit: 50 }, transform: (d: any) => Array.isArray(d) ? d.length : 0 },
    ],
  },
  {
    connectorId: 'quickbooks',
    appName: 'QuickBooks',
    icon: <DollarSign className="w-3.5 h-3.5 text-green-400" />,
    workspacePath: '/dashboard/apps/quickbooks/workspace',
    brandBg: 'bg-green-500/20',
    metrics: [
      { label: 'Unpaid Invoices', action: 'list_invoices', params: { limit: 100 }, transform: (d: any) => Array.isArray(d) ? d.filter((i: any) => Number(i.Balance) > 0).length : '—' },
    ],
  },
  {
    connectorId: 'hubspot',
    appName: 'HubSpot',
    icon: <TrendingUp className="w-3.5 h-3.5 text-orange-400" />,
    workspacePath: '/dashboard/apps/hubspot/workspace',
    brandBg: 'bg-orange-500/20',
    metrics: [
      { label: 'Deals', action: 'list_deals', params: { limit: 1 }, transform: (d: any) => d?.results?.length ?? (Array.isArray(d) ? d.length : '—') },
    ],
  },
];

interface DashboardOverviewProps {
  agents: AIAgent[];
  incidents: Incident[];
  costData: CostData[];
  onAddAgent: () => void;
  onNavigate?: (page: string) => void;
}

type ActivityItem = UnifiedActivityEvent;

const ACTIVITY_EVENT_TYPES = new Set<ActivityItem['type']>(['approval', 'incident', 'job', 'connector', 'audit', 'cost']);
const ACTIVITY_STATUSES = new Set<ActivityItem['status']>(['not_configured', 'needs_policy', 'ready', 'deployed', 'degraded', 'blocked']);
const ACTIVITY_TONES = new Set<ActivityItem['tone']>(['info', 'success', 'warn', 'risk']);

function activityFromAuditEntry(entry: AuditLogEntry): ActivityItem {
  const raw = entry.details?.unified_activity_event;
  if (raw && typeof raw === 'object') {
    const type = ACTIVITY_EVENT_TYPES.has(raw.type) ? raw.type : 'audit';
    const status = ACTIVITY_STATUSES.has(raw.status) ? raw.status : 'deployed';
    const tone = ACTIVITY_TONES.has(raw.tone) ? raw.tone : 'success';
    return {
      id: String(raw.id || `audit-${entry.id}`),
      type,
      at: String(raw.at || entry.created_at),
      title: String(raw.title || entry.action.replace(/[._]/g, ' ')),
      detail: String(raw.detail || `${entry.resource_type.replace(/_/g, ' ')} · audit evidence recorded`),
      status,
      tone,
      route: typeof raw.route === 'string' ? raw.route : 'audit-log',
      actor: typeof raw.actor === 'string' ? raw.actor : entry.user_id,
      sourceRef: typeof raw.sourceRef === 'string' ? raw.sourceRef : entry.id,
      evidenceRef: typeof raw.evidenceRef === 'string' ? raw.evidenceRef : null,
    };
  }

  return {
    id: `audit-${entry.id}`,
    type: 'audit',
    at: entry.created_at,
    title: entry.action.replace(/[._]/g, ' '),
    detail: `${entry.resource_type.replace(/_/g, ' ')} · audit evidence recorded`,
    status: 'deployed',
    tone: 'success',
    route: 'audit-log',
    sourceRef: entry.id,
  };
}

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

function activityStreamTone(status: ActivityStreamStatus) {
  if (status === 'live') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
  if (status === 'polling') return 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200';
  if (status === 'error') return 'border-amber-500/25 bg-amber-500/10 text-amber-200';
  return 'border-slate-600/40 bg-slate-800/70 text-slate-300';
}

function activityStreamLabel(status: ActivityStreamStatus) {
  if (status === 'live') return 'Live audit stream';
  if (status === 'polling') return 'Polling evidence';
  if (status === 'error') return 'Evidence stream delayed';
  if (status === 'connecting') return 'Connecting stream';
  return 'Stream idle';
}

function activityActorLabel(actor?: string | null) {
  if (!actor || actor === 'system') return 'System';
  if (actor.includes('@')) {
    return actor.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (/^[0-9a-f-]{20,}$/i.test(actor)) return 'User';
  return actor.replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

/* ─────────────────────────────────────────────────────────────────────────
   Today's Priorities — unified cross-app inbox
──────────────────────────────────────────────────────────────────────────── */

type CrossAppInsight = {
  naukriApplicants: number;
  greythrHires: number;
};

type PriorityTone = 'risk' | 'warn' | 'info' | 'good';

type CommandPriorityItem = {
  id: string;
  tone: PriorityTone;
  label: string;
  title: string;
  detail: string;
  meta: string;
  cta: string;
  route?: string;
  priority: number;
};

function normalizeRiskScore(score?: number | null): number {
  if (score == null || !Number.isFinite(score)) return 0;
  const normalized = score <= 1 ? score * 100 : score;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function formatPriorityTime(value?: string | null): string {
  if (!value) return 'No deadline';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No deadline';
  const diffMs = date.getTime() - Date.now();
  const absMinutes = Math.max(0, Math.round(Math.abs(diffMs) / 60000));
  if (diffMs < 0) {
    if (absMinutes < 60) return `${absMinutes}m overdue`;
    const hours = Math.round(absMinutes / 60);
    if (hours < 24) return `${hours}h overdue`;
    return `${Math.round(hours / 24)}d overdue`;
  }
  if (absMinutes < 60) return `Due in ${absMinutes}m`;
  const hours = Math.round(absMinutes / 60);
  if (hours < 24) return `Due in ${hours}h`;
  return `Due in ${Math.round(hours / 24)}d`;
}

function friendlyServiceName(service?: string | null): string {
  const normalized = String(service || '').toLowerCase();
  if (normalized.includes('greythr') || normalized.includes('greyt')) return 'greytHR';
  if (normalized.includes('tally')) return 'TallyPrime';
  if (normalized.includes('naukri')) return 'Naukri';
  if (normalized.includes('cashfree')) return 'Cashfree';
  if (normalized.includes('razorpay')) return 'Razorpay';
  if (normalized.includes('keka')) return 'Keka';
  if (normalized.includes('darwinbox')) return 'Darwinbox';
  if (normalized.includes('whatsapp')) return 'WhatsApp';
  if (normalized.includes('slack')) return 'Slack';
  if (normalized.includes('github')) return 'GitHub';
  if (normalized.includes('jira')) return 'Jira';
  if (normalized.includes('hubspot')) return 'HubSpot';
  if (normalized.includes('google')) return 'Google Workspace';
  if (normalized.includes('microsoft')) return 'Microsoft 365';
  return service ? service.replace(/[-_]/g, ' ') : 'Zapheit';
}

function friendlyActionName(action?: string | null): string {
  const normalized = String(action || '').trim().toLowerCase().replace(/[-\s]/g, '_');
  const labels: Record<string, string> = {
    send_message: 'send a message',
    send_email: 'send an email',
    create_record: 'create a record',
    update_record: 'update a record',
    delete_record: 'delete a record',
    create_issue: 'create an issue',
    update_issue: 'update an issue',
    close_issue: 'close an issue',
    create_task: 'create a task',
    update_task: 'update a task',
    post_comment: 'post a comment',
    list_records: 'read records',
    search: 'run a search',
    execute: 'run a command',
    webhook: 'trigger a webhook',
    api_call: 'make an API call',
  };
  return labels[normalized] || normalized.replace(/_/g, ' ') || 'take an action';
}

function priorityToneClasses(tone: PriorityTone) {
  if (tone === 'risk') {
    return {
      row: 'border-rose-500/25 bg-rose-500/[0.05]',
      badge: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
      dot: 'bg-rose-400',
      button: 'border-rose-500/25 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25',
    };
  }
  if (tone === 'warn') {
    return {
      row: 'border-amber-500/25 bg-amber-500/[0.05]',
      badge: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
      dot: 'bg-amber-400',
      button: 'border-amber-500/25 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25',
    };
  }
  if (tone === 'good') {
    return {
      row: 'border-emerald-500/20 bg-emerald-500/[0.05]',
      badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
      dot: 'bg-emerald-400',
      button: 'border-emerald-500/25 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25',
    };
  }
  return {
    row: 'border-blue-500/20 bg-blue-500/[0.04]',
    badge: 'border-blue-500/25 bg-blue-500/10 text-blue-300',
    dot: 'bg-blue-400',
    button: 'border-blue-500/25 bg-blue-500/15 text-blue-200 hover:bg-blue-500/25',
  };
}

function buildPriorityItems(args: {
  pendingApprovals: ApprovalRequest[];
  teamActivity: AuditLogEntry[];
  incidents: Incident[];
  agents: AIAgent[];
  agentsWithoutBudget: AIAgent[];
  staleApprovals: ApprovalRequest[];
  severeIncidents: Incident[];
  openIncidents: Incident[];
  crossAppInsight?: CrossAppInsight | null;
}): CommandPriorityItem[] {
  const handledApprovalIds = new Set<string>();
  const sortedApprovals = [...args.pendingApprovals].sort((left, right) => {
    const leftRisk = normalizeRiskScore(left.risk_score);
    const rightRisk = normalizeRiskScore(right.risk_score);
    const leftOverdue = left.sla_deadline ? new Date(left.sla_deadline).getTime() < Date.now() : false;
    const rightOverdue = right.sla_deadline ? new Date(right.sla_deadline).getTime() < Date.now() : false;
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
    if (leftRisk !== rightRisk) return rightRisk - leftRisk;
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });

  const approvalItems = sortedApprovals.slice(0, 4).map((approval, index): CommandPriorityItem => {
    handledApprovalIds.add(approval.id);
    const score = normalizeRiskScore(approval.risk_score);
    const overdue = approval.sla_deadline ? new Date(approval.sla_deadline).getTime() < Date.now() : false;
    const service = friendlyServiceName(approval.service);
    const action = friendlyActionName(approval.action);
    const tone: PriorityTone = overdue || score >= 70 ? 'risk' : score >= 40 ? 'warn' : 'info';
    return {
      id: `approval:${approval.id}`,
      tone,
      label: overdue ? 'Overdue approval' : score >= 70 ? 'High-risk approval' : 'Approval',
      title: `${service} wants to ${action}`,
      detail: approval.reason_message || approval.recommended_next_action || 'Human approval is required before this agent can continue.',
      meta: `${score > 0 ? `Risk ${score}/100 · ` : ''}${formatPriorityTime(approval.sla_deadline || approval.expires_at)}`,
      cta: 'Review',
      route: 'approvals',
      priority: index + (tone === 'risk' ? 0 : tone === 'warn' ? 10 : 20),
    };
  });

  const incidentItems = args.severeIncidents.slice(0, 2).map((incident, index): CommandPriorityItem => ({
    id: `incident:${incident.id}`,
    tone: 'risk',
    label: `${incident.severity} incident`,
    title: incident.title,
    detail: incident.description || `${incident.agent_name} needs attention before the workflow is trusted again.`,
    meta: `${incident.agent_name || 'Agent'} · ${formatRelative(incident.created_at)}`,
    cta: 'Open incident',
    route: 'incidents',
    priority: 30 + index,
  }));

  const staleApprovalCount = args.staleApprovals.filter((approval) => !handledApprovalIds.has(approval.id)).length;
  const staleItem: CommandPriorityItem | null = staleApprovalCount > 0
    ? {
      id: 'stale-approvals',
      tone: 'warn',
      label: 'Stale queue',
      title: `${staleApprovalCount} approval${staleApprovalCount !== 1 ? 's' : ''} waiting more than 1 hour`,
      detail: 'Old approvals slow down agent execution and create operational drag for the team.',
      meta: 'Approval SLA needs attention',
      cta: 'Clear queue',
      route: 'approvals',
      priority: 45,
    }
    : null;

  const budgetItem: CommandPriorityItem | null = args.agentsWithoutBudget.length > 0
    ? {
      id: 'budget-caps',
      tone: 'warn',
      label: 'Budget control',
      title: `${args.agentsWithoutBudget.length} agent${args.agentsWithoutBudget.length !== 1 ? 's' : ''} without budget caps`,
      detail: 'Set spend limits so high-volume agents cannot create surprise LLM costs.',
      meta: `${args.agents.length} total agent${args.agents.length !== 1 ? 's' : ''}`,
      cta: 'Add caps',
      route: 'agents',
      priority: 50,
    }
    : null;

  const crossAppItem: CommandPriorityItem | null =
    args.crossAppInsight && args.crossAppInsight.naukriApplicants > 10 && args.crossAppInsight.greythrHires < args.crossAppInsight.naukriApplicants * 0.1
      ? {
        id: 'cross-app:naukri-greythr',
        tone: 'warn',
        label: 'Cross-app insight',
        title: 'Hiring pipeline may be leaking after offer',
        detail: `${args.crossAppInsight.naukriApplicants} Naukri candidates but only ${args.crossAppInsight.greythrHires} greytHR hire${args.crossAppInsight.greythrHires !== 1 ? 's' : ''} this month.`,
        meta: 'Naukri + greytHR',
        cta: 'Review',
        route: 'apps/naukri/workspace',
        priority: 60,
      }
      : null;

  const agentActions = args.teamActivity.filter((entry) =>
    entry.action.startsWith('agent.') || entry.details?.via === 'agent',
  ).slice(0, 2);

  const activityItems = agentActions.map((entry, index): CommandPriorityItem => ({
    id: `activity:${entry.id}`,
    tone: 'info',
    label: 'Agent work handled',
    title: friendlyActionName(entry.action.replace(/^agent\./, 'agent_')),
    detail: `${entry.users?.full_name || entry.users?.email || 'Zapheit Agent'} recorded governed activity.`,
    meta: formatRelative(entry.created_at),
    cta: 'View audit',
    route: 'audit-log',
    priority: 70 + index,
  }));

  const allItems = [
    ...approvalItems,
    ...incidentItems,
    staleItem,
    budgetItem,
    crossAppItem,
    ...activityItems,
  ].filter(Boolean) as CommandPriorityItem[];

  return allItems.sort((left, right) => left.priority - right.priority).slice(0, 7);
}

function TodaysPriorities({
  pendingApprovals,
  teamActivity,
  incidents,
  agents,
  costData,
  agentsWithoutBudget,
  staleApprovals,
  severeIncidents,
  openIncidents,
  crossAppInsight,
  onNavigate,
}: {
  pendingApprovals: ApprovalRequest[];
  teamActivity: AuditLogEntry[];
  incidents: Incident[];
  agents: AIAgent[];
  costData: CostData[];
  agentsWithoutBudget: AIAgent[];
  staleApprovals: ApprovalRequest[];
  severeIncidents: Incident[];
  openIncidents: Incident[];
  crossAppInsight?: CrossAppInsight | null;
  onNavigate?: (route: string) => void;
}) {
  const agentActions = teamActivity.filter((e) =>
    e.action.startsWith('agent.') || e.details?.via === 'agent',
  ).slice(0, 5);
  const roi = calculatePortfolioRoi(agents, costData, incidents, 800);

  const priorityItems = buildPriorityItems({
    pendingApprovals,
    teamActivity,
    incidents,
    agents,
    agentsWithoutBudget,
    staleApprovals,
    severeIncidents,
    openIncidents,
    crossAppInsight,
  });
  const highRiskApprovalCount = pendingApprovals.filter((approval) => normalizeRiskScore(approval.risk_score) >= 70).length;
  const urgentCount = pendingApprovals.length + severeIncidents.length;
  const allClear = pendingApprovals.length === 0 && openIncidents.length === 0 && agentsWithoutBudget.length === 0;
  const statusLine = urgentCount > 0
    ? `${urgentCount} decision${urgentCount !== 1 ? 's' : ''} need attention before agents continue.`
    : 'Your AI workforce is operating normally.';
  const nextPriority = priorityItems[0];
  const nextActionLabel = nextPriority
    ? `${nextPriority.cta}: ${nextPriority.title}`
    : allClear
      ? 'No blocker needs action. Review ROI or deploy the next governed agent.'
      : 'Review informational items when convenient.';
  const operatingSummary = nextPriority
    ? nextPriority.detail
    : allClear
      ? 'Approvals, incidents, and budget controls are clear on the overview signals currently loaded.'
      : 'No urgent blocker is present, but Zapheit has non-blocking operational context to review.';
  const roiInsight = roi.totalValueInr > 0 && roi.topAgent
    ? `Your agents created ${formatRoiInr(roi.totalValueInr)} in value this month across ${roi.departments.length} department${roi.departments.length === 1 ? '' : 's'}. ${roi.topAgent.agent.name} is your top performer.`
    : 'No ROI data yet — deploy your first agent to start tracking value.';
  const counters = [
    { label: 'Pending approvals', value: pendingApprovals.length, tone: pendingApprovals.length > 0 ? 'warn' as const : 'good' as const },
    { label: 'High-risk', value: highRiskApprovalCount + severeIncidents.length, tone: highRiskApprovalCount + severeIncidents.length > 0 ? 'risk' as const : 'good' as const },
    { label: 'Open incidents', value: openIncidents.length, tone: openIncidents.length > 0 ? 'risk' as const : 'good' as const },
    { label: 'Agent work handled', value: agentActions.length, tone: 'info' as const },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="px-5 py-4 border-b border-white/8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${urgentCount > 0 ? 'bg-rose-400' : 'bg-emerald-400'}`} />
              <p className="text-sm font-semibold text-white">Today's Command Center</p>
            </div>
            <p className={`mt-1 text-xs ${urgentCount > 0 ? 'text-rose-200' : 'text-emerald-200'}`}>{statusLine}</p>
          </div>
          <button
            onClick={() => onNavigate?.('approvals')}
            className="self-start text-xs font-semibold text-blue-300 hover:text-blue-200 transition-colors"
          >
            Open approvals
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {counters.map((counter) => {
            const tone = priorityToneClasses(counter.tone);
            return (
              <div key={counter.label} className={`rounded-xl border px-3 py-2 ${tone.row}`}>
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{counter.label}</p>
                </div>
                <p className="mt-1 text-lg font-semibold text-white">{counter.value}</p>
              </div>
            );
          })}
        </div>
        <div className={`mt-3 rounded-xl border px-4 py-3 ${
          nextPriority
            ? priorityToneClasses(nextPriority.tone).row
            : 'border-emerald-500/20 bg-emerald-500/[0.05]'
        }`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Next best action</p>
              <p className="mt-1 text-sm font-semibold text-white line-clamp-1">{nextActionLabel}</p>
              <p className="mt-0.5 text-xs text-slate-400 line-clamp-2">{operatingSummary}</p>
            </div>
            <button
              onClick={() => nextPriority?.route ? onNavigate?.(nextPriority.route) : onNavigate?.('roi')}
              className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-slate-100 transition-colors hover:bg-white/[0.10]"
            >
              {nextPriority ? 'Act now' : 'Review ROI'}
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-3">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">ROI insight</p>
            <p className="mt-1 text-xs text-slate-300">{roiInsight}</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        {priorityItems.length > 0 ? (
          <div className="space-y-2">
            {priorityItems.map((item) => {
              const tone = priorityToneClasses(item.tone);
              return (
                <div key={item.id} className={`rounded-xl border px-4 py-3 ${tone.row}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${tone.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                          {item.label}
                        </span>
                        <span className="text-[11px] text-slate-500">{item.meta}</span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-white line-clamp-1">{item.title}</p>
                      <p className="mt-0.5 text-xs text-slate-400 line-clamp-2">{item.detail}</p>
                    </div>
                    <button
                      onClick={() => item.route && onNavigate?.(item.route)}
                      disabled={!item.route}
                      className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-default disabled:opacity-60 ${tone.button}`}
                    >
                      {item.cta}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <p className="text-sm font-semibold text-white">All clear across the AI workforce</p>
                </div>
                <p className="mt-1 text-xs text-emerald-200">
                  No pending approvals, open incidents, or unbudgeted agents need attention right now.
                </p>
                {agentActions.length > 0 && (
                  <p className="mt-1 text-xs text-slate-400">
                    {agentActions.length} governed agent action{agentActions.length !== 1 ? 's' : ''} handled recently.
                  </p>
                )}
              </div>
              <button
                onClick={() => onNavigate?.('roi')}
                className="shrink-0 rounded-lg border border-emerald-500/25 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/25"
              >
                Review ROI
              </button>
            </div>
          </div>
        )}
        {allClear && priorityItems.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Core controls are clear; remaining items are informational.
          </div>
        )}
      </div>
    </div>
  );
}

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

  // Kill switch — org-wide pause/resume all active agents
  const allPaused = agents.length > 0 && agents.every((a) => a.status !== 'active');
  const [killSwitchLoading, setKillSwitchLoading] = useState(false);
  const handleKillSwitch = useCallback(async () => {
    if (killSwitchLoading) return;
    setKillSwitchLoading(true);
    try {
      const activeIds = agents.filter((a) => a.status === 'active').map((a) => a.id);
      const pausedIds = agents.filter((a) => a.status === 'paused').map((a) => a.id);
      if (!allPaused && activeIds.length > 0) {
        await Promise.all(activeIds.map((id) => authenticatedFetch(`/agents/${id}/pause`, { method: 'POST', body: JSON.stringify({ reason: 'Org-wide kill switch activated from dashboard' }) })));
      } else if (allPaused && pausedIds.length > 0) {
        await Promise.all(pausedIds.map((id) => authenticatedFetch(`/agents/${id}/resume`, { method: 'POST', body: JSON.stringify({ reason: 'Org-wide kill switch released from dashboard' }) })));
      }
    } catch {
      // best effort — page reload will reflect actual state
    } finally {
      setKillSwitchLoading(false);
    }
  }, [agents, allPaused, killSwitchLoading]);

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
  const {
    events: liveActivityEvents,
    status: activityStreamStatus,
    lastEventAt: activityStreamLastAt,
  } = useActivityStream({ limit: 12 });

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
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [crossAppInsight, setCrossAppInsight] = useState<CrossAppInsight | null>(null);
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

    api.approvals.list({ status: 'pending', limit: 20 }).then((res) => {
      if (res.success && Array.isArray(res.data)) setPendingApprovals(res.data);
    }).catch(() => {});

    // Cross-app insight: compare Naukri pipeline vs greytHR new hires
    api.unifiedConnectors.getCatalog().then(async (catalogRes) => {
      if (!catalogRes.success || !Array.isArray(catalogRes.data)) return;
      const naukriEntry = catalogRes.data.find((c) => c.id === 'naukri' || c.app_key === 'naukri');
      const greythrEntry = catalogRes.data.find((c) => c.id === 'greythr' || c.app_key === 'greythr');
      const naukriConnected = naukriEntry?.installed && (naukriEntry?.connectionStatus === 'connected' || naukriEntry?.connection_status === 'connected');
      const greythrConnected = greythrEntry?.installed && (greythrEntry?.connectionStatus === 'connected' || greythrEntry?.connection_status === 'connected');
      if (!naukriConnected || !greythrConnected) return;
      try {
        const [naukriRes, greythrRes] = await Promise.all([
          api.unifiedConnectors.executeAction('naukri', 'list_applications', { limit: 1, status: 'new' }),
          api.unifiedConnectors.executeAction('greythr', 'list_employees', { status: 'active', joined_this_month: true, limit: 1 }),
        ]);
        const naukriApplicants: number =
          (naukriRes.data?.data?.total as number) ??
          (Array.isArray(naukriRes.data?.data) ? (naukriRes.data.data as any[]).length : 0);
        const greythrHires: number =
          (greythrRes.data?.data?.total as number) ??
          (Array.isArray(greythrRes.data?.data) ? (greythrRes.data.data as any[]).length : 0);
        if (naukriApplicants > 0 || greythrHires > 0) {
          setCrossAppInsight({ naukriApplicants, greythrHires });
        }
      } catch { /* silently ignore */ }
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

  const teamActivityEvents = useMemo(() => {
    return liveActivityEvents.length > 0
      ? liveActivityEvents
      : teamActivity.map(activityFromAuditEntry);
  }, [liveActivityEvents, teamActivity]);

  const activityFeed = useMemo(() => {
    const items: ActivityItem[] = [
      ...liveActivityEvents.slice(0, 8),
      ...incidents.slice(0, 6).map((incident): ActivityItem => ({
        id: `incident-${incident.id}`,
        type: 'incident',
        at: incident.created_at,
        title: incident.title,
        detail: `${incident.agent_name} · ${incident.severity} · ${incident.status}`,
        status: ['high', 'critical'].includes((incident.severity || '').toLowerCase()) ? 'blocked' : 'degraded',
        tone: ['high', 'critical'].includes((incident.severity || '').toLowerCase()) ? 'risk' : 'warn',
        route: 'incidents',
        sourceRef: incident.id,
      })),
      ...pendingApprovals.slice(0, 6).map((approval): ActivityItem => ({
        id: `approval-${approval.id}`,
        type: 'approval',
        at: approval.created_at,
        title: `Approval waiting: ${approval.action.replace(/_/g, ' ')}`,
        detail: `${approval.service} · required role ${approval.required_role || 'manager'}`,
        status: 'needs_policy',
        tone: 'warn',
        route: 'approvals',
        sourceRef: approval.id,
      })),
      ...(liveActivityEvents.length > 0 ? [] : teamActivity.slice(0, 6).map(activityFromAuditEntry)),
      ...agents.slice(0, 6).map((agent): ActivityItem => ({
        id: `agent-${agent.id}`,
        type: 'job',
        at: agent.created_at,
        title: `${agent.name} added to agents`,
        detail: `${(agent as any).config?.display_provider || agent.platform} · ${agent.model_name}`,
        status: agent.status === 'terminated' ? 'blocked' : agent.conversations > 0 ? 'deployed' : 'ready',
        tone: agent.status === 'terminated' ? 'warn' : 'info',
        route: 'agents',
        sourceRef: agent.id,
      })),
      ...costData.slice(0, 6).map((entry): ActivityItem => ({
        id: `cost-${entry.id}`,
        type: 'cost',
        at: entry.date,
        title: `Cost recorded ${formatCurrency(entry.cost)}`,
        detail: `${entry.requests.toLocaleString()} request(s) · ${entry.tokens.toLocaleString()} tokens`,
        status: 'deployed',
        tone: 'info',
        route: 'costs',
        sourceRef: entry.id,
      })),
    ];

    const seen = new Set<string>();
    return items
      .filter((item) => item.at)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 6);
  }, [agents, costData, incidents, liveActivityEvents, pendingApprovals, teamActivity]);

  const totalCost = costData.reduce((sum, item) => sum + item.cost, 0);
  const latestCostAt = [...costData]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]?.date;
  const activeAgents = agents.filter((agent) => agent.status === 'active');
  const terminatedAgents = agents.filter((agent) => agent.status === 'terminated');
  const agentsWithoutBudget = agents.filter((agent) => Number(agent.budget_limit || 0) <= 0);
  const openIncidents = incidents.filter((incident) => ['open', 'investigating'].includes((incident.status || '').toLowerCase()) && incident.source !== 'manual_test');
  const severeIncidents = openIncidents.filter((incident) => ['high', 'critical'].includes((incident.severity || '').toLowerCase()));
  const orgReadiness = useMemo(() => deriveOrgReadinessScore({
    agents,
    pendingApprovals: pendingApprovals.length,
    openIncidents: openIncidents.length,
    severeIncidents: severeIncidents.length,
    connectedConnectors: telemetry?.integrations.healthy ?? agents.filter((agent) => (agent.integrationIds || []).length > 0).length,
    degradedConnectors: telemetry?.integrations.degraded ?? 0,
  }), [agents, openIncidents.length, pendingApprovals.length, severeIncidents.length, telemetry]);
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

  // P2-C: stale approvals (pending >1hr) + plain-English metrics
  const staleApprovals = pendingApprovals.filter(
    (a) => Date.now() - new Date(a.created_at).getTime() > 60 * 60 * 1000,
  );
  const statusBannerProblems = severeIncidents.length + staleApprovals.length;
  const weekMessages = requestTrend.reduce((s, v) => s + v, 0);
  const weekMessagesDisplay = weekMessages >= 1000
    ? `${(weekMessages / 1000).toFixed(1)}k`
    : weekMessages.toLocaleString();

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
      label: 'Spend this month',
      value: formatCurrency(totalCost),
      note: totalConversations > 0 ? `≈ ${Math.round(totalConversations / 800).toLocaleString()} messages estimated` : latestCostAt ? `Last signal ${formatRelative(latestCostAt)}` : 'No cost signal yet',
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
        title: 'Review high-severity incidents',
        description: `${severeIncidents.length} incident(s) are still high or critical.`,
        tone: 'risk' as const,
        action: () => onNavigate?.('incidents'),
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

  if (!hasData) {
    const steps = [
      { num: 1, label: 'Connect one app', sub: 'Link Slack, Jira, GitHub, or another governed app', action: () => onNavigate?.('apps') },
      { num: 2, label: 'Create your first Agent', sub: 'Pick a template or start from scratch', action: () => onAddAgent() },
      { num: 3, label: 'Set your first Safety Rule', sub: 'Control what your agent can and cannot do', action: () => onNavigate?.('action-policies') },
    ];
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Welcome to Zapheit</h1>
          <p className="mt-2 text-slate-400">Three steps to get your first AI agent running safely.</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-8 space-y-3" style={{ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', boxShadow: '0 8px 32px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.10)' }}>
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
        <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/40 p-8" style={{ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', backgroundImage: 'radial-gradient(ellipse at top left, rgba(34,211,238,0.10), transparent 60%)', boxShadow: '0 8px 32px rgba(0,0,0,0.20), inset 0 1px 0 rgba(34,211,238,0.10)' }}>
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

  return (
    <div className="space-y-8">
      {/* Kill switch — org-wide pause/resume */}
      {agents.length > 0 && (
        <div className={`flex items-center justify-between gap-4 rounded-2xl border px-5 py-4 ${allPaused ? 'border-amber-500/30 bg-amber-500/[0.08]' : 'border-white/[0.08] bg-white/[0.03]'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${allPaused ? 'bg-amber-500/20' : 'bg-emerald-500/15'}`}>
              {allPaused
                ? <Pause className="h-4 w-4 text-amber-400" />
                : <Play className="h-4 w-4 text-emerald-400" />}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                {allPaused ? 'All AI assistants are paused' : `${agents.filter((a) => a.status === 'active').length} AI assistant${agents.filter((a) => a.status === 'active').length !== 1 ? 's' : ''} running`}
              </p>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {allPaused ? 'Your AI workforce is offline — no requests will be processed.' : 'Use the kill switch to pause all assistants instantly.'}
              </p>
            </div>
          </div>
          <button
            onClick={handleKillSwitch}
            disabled={killSwitchLoading}
            className={`shrink-0 flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all disabled:opacity-60 ${allPaused ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/25'}`}
          >
            {killSwitchLoading
              ? <RefreshCw className="h-4 w-4 animate-spin" />
              : allPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {allPaused ? 'Resume all' : 'Pause all'}
          </button>
        </div>
      )}

      {/* ── Today's Priorities ─────────────────────────────────────────── */}
      <TodaysPriorities
        pendingApprovals={pendingApprovals}
        teamActivity={teamActivity}
        incidents={incidents}
        agents={agents}
        costData={costData}
        agentsWithoutBudget={agentsWithoutBudget}
        staleApprovals={staleApprovals}
        severeIncidents={severeIncidents}
        openIncidents={openIncidents}
        crossAppInsight={crossAppInsight}
        onNavigate={onNavigate}
      />

      <section className="rounded-2xl border border-white/[0.10] bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.10),transparent_38%),rgba(255,255,255,0.04)] p-6" style={{ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)' }}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Production readiness</p>
              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${readinessTone(orgReadiness.status)}`}>
                {READINESS_LABELS[orgReadiness.status]}
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-bold text-white">{orgReadiness.score}/100 · {orgReadiness.label}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{orgReadiness.summary}</p>
          </div>
          <div className="grid min-w-[260px] grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-slate-950/30 p-3">
            <div className="text-center">
              <p className="text-xl font-bold text-white">{agents.length}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">Agents</p>
            </div>
            <div className="border-x border-white/10 text-center">
              <p className="text-xl font-bold text-emerald-300">{telemetry?.integrations.healthy ?? agents.filter((agent) => (agent.integrationIds || []).length > 0).length}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">Connected</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-amber-300">{pendingApprovals.length + openIncidents.length}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">Open work</p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {orgReadiness.issues.slice(0, 3).map((issue) => (
            <button
              key={issue.id}
              onClick={() => issue.route && onNavigate?.(issue.route)}
              className={`group rounded-xl border p-4 text-left transition hover:brightness-110 ${readinessTone(issue.status)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{issue.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-300/85">{issue.detail}</p>
                </div>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-90" />
              </div>
            </button>
          ))}
          {orgReadiness.issues.length === 0 && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-4 lg:col-span-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                <p className="text-sm font-semibold text-white">No production blockers detected from currently loaded signals.</p>
              </div>
              <p className="mt-1 text-xs text-emerald-100/75">Keep monitoring approvals, incidents, runtime jobs, connector health, cost, and audit evidence from this command center.</p>
            </div>
          )}
        </div>
      </section>

      {primaryAction && (
        <section className="rounded-2xl border border-white/[0.10] bg-white/[0.05] p-6" style={{ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', boxShadow: '0 8px 32px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-medium uppercase tracking-widest text-cyan-400/80">{primaryActionLabel}</p>
              <h2 className="mt-2 text-lg font-semibold text-white">{primaryAction.title}</h2>
              <p className="mt-1 text-sm text-slate-400">{primaryAction.description}</p>
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
        className="h-px rounded-full -mt-4 mb-0 opacity-30"
        animate={{ backgroundColor: ambientColor }}
        transition={{ backgroundColor: { duration: 1.5, ease: 'easeInOut' } }}
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
        <div className="relative flex items-start gap-4 rounded-2xl border border-white/[0.10] bg-white/[0.05] px-5 py-4" style={{ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', boxShadow: '0 8px 32px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
          {/* Accent bar */}
          <div className="absolute left-0 inset-y-0 w-1 rounded-l-2xl bg-gradient-to-b from-cyan-400 to-blue-500" style={{ boxShadow: '0 0 8px rgba(34,211,238,0.30)' }} />
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

      {/* P2-C: Needs your attention — unified pending approvals + open alerts */}
      {(() => {
        type AttentionItem = {
          id: string;
          icon: ReactNode;
          label: string;
          sub: string;
          tone: 'rose' | 'amber';
          action: () => void;
          cta: string;
          at: string;
        };

        const items: AttentionItem[] = [
          ...severeIncidents.slice(0, 3).map((inc): AttentionItem => ({
            id: `inc-${inc.id}`,
            icon: <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0" />,
            label: inc.title || 'Safety alert detected',
            sub: `${inc.agent_name || 'Unknown assistant'} · ${inc.severity}`,
            tone: 'rose',
            action: () => onNavigate?.('incidents'),
            cta: 'Review',
            at: inc.created_at,
          })),
          ...openIncidents.filter((i) => !['high', 'critical'].includes((i.severity || '').toLowerCase())).slice(0, 2).map((inc): AttentionItem => ({
            id: `inc-warn-${inc.id}`,
            icon: <Siren className="h-4 w-4 text-amber-400 shrink-0" />,
            label: inc.title || 'Alert open',
            sub: `${inc.agent_name || 'Unknown assistant'} · ${inc.severity}`,
            tone: 'amber',
            action: () => onNavigate?.('incidents'),
            cta: 'Review',
            at: inc.created_at,
          })),
          ...pendingApprovals.slice(0, 5).map((appr): AttentionItem => ({
            id: `appr-${appr.id}`,
            icon: <UserCheck className="h-4 w-4 text-amber-400 shrink-0" />,
            label: `Your AI wants to: ${appr.action.replace(/_/g, ' ')}`,
            sub: `${appr.service} · waiting ${formatRelative(appr.created_at)}`,
            tone: 'amber',
            action: () => onNavigate?.('approvals'),
            cta: 'Decide',
            at: appr.created_at,
          })),
        ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 6);

        if (items.length === 0) return null;

        return (
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Needs your attention · {items.length} item{items.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${item.tone === 'rose' ? 'border-rose-500/20 bg-rose-500/[0.06]' : 'border-amber-500/20 bg-amber-500/[0.06]'}`}
                >
                  {item.icon}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-200 leading-tight truncate">{item.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{item.sub}</p>
                  </div>
                  <button
                    onClick={item.action}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-200 border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] transition-colors whitespace-nowrap"
                  >
                    {item.cta}
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* P2-C Status Banner */}
      <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border px-5 py-4 ${statusBannerProblems > 0 ? 'border-rose-500/30 bg-rose-500/[0.07]' : 'border-emerald-500/30 bg-emerald-500/[0.07]'}`}>
        <div className="flex items-center gap-3 min-w-0">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${statusBannerProblems > 0 ? 'bg-rose-500/15' : 'bg-emerald-500/15'}`}>
            <span className={`h-3 w-3 rounded-full ${statusBannerProblems > 0 ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400'}`} />
          </span>
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${statusBannerProblems > 0 ? 'text-rose-200' : 'text-emerald-200'}`}>
              {statusBannerProblems > 0
                ? `${statusBannerProblems} problem${statusBannerProblems !== 1 ? 's' : ''} need${statusBannerProblems === 1 ? 's' : ''} attention`
                : 'Everything running smoothly'}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {weekMessagesDisplay} messages this week&nbsp;·&nbsp;{pendingApprovals.length} approval{pendingApprovals.length !== 1 ? 's' : ''} waiting&nbsp;·&nbsp;{formatCompactCurrency(totalCost)} this month
            </p>
          </div>
        </div>
        {statusBannerProblems > 0 && (
          <button
            onClick={() => onNavigate?.('incidents')}
            className="shrink-0 rounded-xl border border-rose-500/30 bg-rose-500/15 px-4 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 transition-colors"
          >
            Review now
          </button>
        )}
      </div>

      <section className="rounded-2xl border border-white/[0.10] bg-white/[0.05] p-6" style={{ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', boxShadow: '0 8px 32px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
        <div className="grid gap-6 xl:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500 mb-3">Command center</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${heroTone === 'risk' ? 'bg-rose-500/10 text-rose-400' : heroTone === 'warn' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${heroTone === 'risk' ? 'bg-rose-400' : heroTone === 'warn' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                {heroTone === 'risk' ? 'Needs intervention' : heroTone === 'warn' ? 'Watch closely' : 'Stable'}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${avgRiskScore >= 70 ? 'bg-rose-500/10 text-rose-400' : avgRiskScore >= 40 ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                Risk {avgRiskScore}/100
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-white">Overview</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-400 leading-relaxed">
              What&apos;s running, what needs attention, and what to do next.
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
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-5 flex items-start gap-4" style={{ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', boxShadow: '0 8px 32px rgba(0,0,0,0.16), inset 0 1px 0 rgba(16,185,129,0.08)' }}>
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
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] p-5 flex items-start gap-4" style={{ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', boxShadow: '0 8px 32px rgba(0,0,0,0.16), inset 0 1px 0 rgba(139,92,246,0.08)' }}>
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
            <p className="text-sm font-semibold text-slate-200">Incidents by hour of day</p>
            <span className="text-xs text-slate-400">{incidents.length} incident{incidents.length !== 1 ? 's' : ''} total</span>
          </div>
          <p className="text-xs text-slate-400 mb-4">Spot patterns — e.g. "The Finance agent fails every night at 3 AM"</p>

          {incidents.length === 0 ? (
            <p className="text-sm text-slate-600 py-4 text-center">No incidents recorded yet</p>
          ) : (
            <>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={incidentsByHour} margin={{ top: 0, right: 0, bottom: 0, left: -24 }}>
                    <HeatXAxis
                      dataKey="label"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      interval={2}
                      axisLine={false}
                      tickLine={false}
                    />
                    <HeatYAxis
                      allowDecimals={false}
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <HeatTooltip
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      contentStyle={{ background: '#0f172a', border: '1px solid rgba(100,116,139,0.3)', borderRadius: 8, fontSize: 12, color: '#e2e8f0' }}
                      formatter={(value: number, _: string, entry: any) => [
                        `${value} incident${value !== 1 ? 's' : ''}`,
                        `${entry?.payload?.hour}:00`,
                      ]}
                      labelFormatter={() => ''}
                    />
                    <Bar dataKey="count" radius={[6, 6, 2, 2]}>
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
        <section className="card-surface rounded-2xl p-6 ">
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

        <section className="card-surface rounded-2xl p-6 ">
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
        <section className="card-surface rounded-2xl p-6 ">
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-blue-300 shrink-0" />
            <h2 className="text-base font-semibold text-white">Recent Activity</h2>
            <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${activityStreamTone(activityStreamStatus)}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${activityStreamStatus === 'live' ? 'bg-emerald-300' : activityStreamStatus === 'error' ? 'bg-amber-300' : 'bg-cyan-300'}`} />
              {activityStreamLabel(activityStreamStatus)}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Production-backed incident, approval, connector, runtime, cost, and audit signals.
            {activityStreamLastAt ? ` Last event ${formatRelative(activityStreamLastAt)}.` : ''}
          </p>

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

        <section className="card-surface rounded-2xl p-6 ">
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
          <section className="relative overflow-hidden rounded-2xl border border-white/[0.10] bg-white/[0.05] p-6" style={{ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', boxShadow: '0 8px 32px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
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
      {teamActivityEvents.length > 0 && (
        <section className="card-surface rounded-2xl p-6 ">
          <div className="flex items-center gap-2 mb-4">
            <UserCheck className="h-4 w-4 text-blue-300 shrink-0" />
            <h2 className="text-base font-semibold text-white">Team Activity</h2>
            <span className="ml-auto text-xs text-slate-500">
              {liveActivityEvents.length > 0 ? activityStreamLabel(activityStreamStatus) : `Last ${teamActivityEvents.length} actions`}
            </span>
          </div>
          <div className="space-y-2">
            {teamActivityEvents.map((activity: ActivityItem) => {
              const actor = activityActorLabel(activity.actor);
              const action = activity.title.replace(/\b\w/g, (c: string) => c.toUpperCase());
              const resource = activity.detail;
              return (
                <div key={activity.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2.5">
                  <div className="h-7 w-7 shrink-0 rounded-full bg-slate-700 flex items-center justify-center text-[11px] font-bold text-slate-300">
                    {actor.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-200">{actor}</span>
                    <span className="text-sm text-slate-500"> · {action} </span>
                    <span className="text-sm text-slate-400">{resource}</span>
                  </div>
                  <span className="shrink-0 text-xs text-slate-600">{formatRelative(activity.at)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Connected Apps widget */}
      {telemetry && telemetry.integrations.total > 0 ? (
        <section className="card-surface rounded-2xl p-6 ">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <SectionEyebrow label="Integration health" />
              <h2 className="text-[1.75rem] font-bold leading-tight text-white">Connected Apps Health</h2>
              <p className="mt-1 text-sm text-slate-400">Live status of the apps and business systems feeding governed actions, approvals, and runtime jobs.</p>
            </div>
            <button
              onClick={() => onNavigate?.('apps')}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 transition hover:text-white"
            >
              <ShoppingBag className="h-4 w-4" />
              Review apps
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
                <span className="font-semibold">{telemetry.integrations.degraded} connected app{telemetry.integrations.degraded > 1 ? 's' : ''}</span> need attention — re-auth or check credentials.
              </p>
              <button
                onClick={() => onNavigate?.('apps')}
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

      {/* Connected Apps Pulse */}
      <HubLiveMetrics
        configs={DASHBOARD_INTEGRATIONS}
        title="Connected Apps Pulse"
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="card-surface rounded-2xl p-6 ">
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

        <section className="card-surface rounded-2xl p-6 ">
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
        <section className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-5 space-y-3">
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
                    onClick={() => onNavigate?.('chat')}
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
