import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Ban, Bot, CheckCircle2, Clock, Download,
  ExternalLink, FileText, IndianRupee, Loader2, PauseCircle, Play,
  Shield, ShieldAlert, ShieldCheck, Sparkles, TrendingUp, XCircle, Zap,
} from 'lucide-react';
import type { AIAgent, Incident } from '../../types';
import { api } from '../../lib/api-client';
import type { ApprovalRequest, AuditLogEntry, UnifiedConnectorEntry } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';

type AgentProfilePageProps = {
  agents: AIAgent[];
  incidents: Incident[];
  onNavigate?: (page: string) => void;
};

type HealthScore = {
  total: number;
  performance?: number;
  safety?: number;
  cost?: number;
  activity?: number;
  recommendations?: string[];
};

type WorkspaceData = Awaited<ReturnType<typeof api.agents.getWorkspace>>['data'];
type HealthData = Awaited<ReturnType<typeof api.agents.getHealth>>['data'];
type CostComparison = Awaited<ReturnType<typeof api.costs.getComparison>>['data'];

const IST_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

function formatIst(value?: string | null) {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No activity yet';
  return `${IST_FORMATTER.format(date)} IST`;
}

function formatInr(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(value || 0)));
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value)}%`;
}

function statusLabel(agent: AIAgent | null) {
  if (!agent) return 'Unknown';
  const config = (agent as any).config || {};
  if (config.shadow_mode || config.deployment_mode === 'shadow') return 'Shadow';
  return agent.status.charAt(0).toUpperCase() + agent.status.slice(1);
}

function statusClasses(label: string) {
  if (label === 'Active') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
  if (label === 'Shadow') return 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200';
  if (label === 'Paused') return 'border-amber-500/25 bg-amber-500/10 text-amber-200';
  if (label === 'Terminated') return 'border-rose-500/25 bg-rose-500/10 text-rose-200';
  return 'border-slate-600 bg-slate-800 text-slate-300';
}

function healthTone(score: number) {
  if (score >= 80) return { text: 'text-emerald-300', border: 'border-emerald-500/25', bg: 'bg-emerald-500/10', bar: 'bg-emerald-400' };
  if (score >= 50) return { text: 'text-amber-300', border: 'border-amber-500/25', bg: 'bg-amber-500/10', bar: 'bg-amber-400' };
  return { text: 'text-rose-300', border: 'border-rose-500/25', bg: 'bg-rose-500/10', bar: 'bg-rose-400' };
}

function friendlyAction(action?: string | null) {
  if (!action) return 'recorded governed activity';
  return action
    .replace(/^agent\./, '')
    .replace(/[_:.]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function appName(value?: string | null) {
  if (!value) return 'Zapheit';
  const normalized = value.toLowerCase();
  if (normalized.includes('greythr')) return 'greytHR';
  if (normalized.includes('naukri')) return 'Naukri';
  if (normalized.includes('tally')) return 'TallyPrime';
  if (normalized.includes('cashfree')) return 'Cashfree';
  if (normalized.includes('razorpay')) return 'Razorpay';
  if (normalized.includes('whatsapp')) return 'WhatsApp';
  if (normalized.includes('github')) return 'GitHub';
  if (normalized.includes('jira')) return 'Jira';
  if (normalized.includes('hubspot')) return 'HubSpot';
  return value.replace(/[-_]/g, ' ');
}

function MetricCard({ label, value, detail, tone = 'text-white' }: { label: string; value: string | number; detail?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={cn('mt-2 text-2xl font-bold', tone)}>{value}</p>
      {detail ? <p className="mt-1 text-xs text-slate-400">{detail}</p> : null}
    </div>
  );
}

function Section({ title, icon: Icon, children, action }: { title: string; icon: typeof Bot; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">
          <Icon className="h-4 w-4 text-cyan-300" />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Sparkline({ points, tone = 'bg-cyan-400' }: { points: number[]; tone?: string }) {
  const normalized = points.length ? points : [35, 42, 40, 55, 62, 70, 76];
  const max = Math.max(...normalized, 1);
  return (
    <div className="flex h-16 items-end gap-1">
      {normalized.map((point, index) => (
        <div
          key={`${point}-${index}`}
          className={cn('flex-1 rounded-sm opacity-80', tone)}
          style={{ height: `${Math.max(8, (point / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export default function AgentProfilePage({ agents, incidents, onNavigate }: AgentProfilePageProps) {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AIAgent | null>(() => agents.find((item) => item.id === agentId) || null);
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [healthScore, setHealthScore] = useState<HealthScore | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [connectors, setConnectors] = useState<UnifiedConnectorEntry[]>([]);
  const [costComparison, setCostComparison] = useState<CostComparison | null>(null);
  const [selectedAudit, setSelectedAudit] = useState<AuditLogEntry | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    const local = agents.find((item) => item.id === agentId);
    if (local) setAgent(local);
  }, [agents, agentId]);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    const [agentRes, workspaceRes, healthScoreRes, healthRes, approvalsRes, auditRes, connectorRes, costRes] = await Promise.allSettled([
      api.agents.getById(agentId),
      api.agents.getWorkspace(agentId),
      api.agents.getHealthScore(agentId),
      api.agents.getHealth(agentId),
      api.approvals.list({ agent_id: agentId, limit: 200 }),
      api.auditLogs.list({ search: agentId, limit: 100 }),
      api.unifiedConnectors.getCatalog(),
      api.costs.getComparison(),
    ]);

    if (agentRes.status === 'fulfilled' && agentRes.value.success && agentRes.value.data) setAgent(agentRes.value.data);
    if (workspaceRes.status === 'fulfilled' && workspaceRes.value.success) setWorkspace(workspaceRes.value.data || null);
    if (healthScoreRes.status === 'fulfilled' && healthScoreRes.value.success) setHealthScore(healthScoreRes.value.data || null);
    if (healthRes.status === 'fulfilled' && healthRes.value.success) setHealth(healthRes.value.data || null);
    if (approvalsRes.status === 'fulfilled' && approvalsRes.value.success) setApprovals(approvalsRes.value.data || []);
    if (auditRes.status === 'fulfilled' && auditRes.value.success) setAuditLogs(auditRes.value.data || []);
    if (connectorRes.status === 'fulfilled' && connectorRes.value.success) setConnectors(connectorRes.value.data || []);
    if (costRes.status === 'fulfilled' && costRes.value.success) setCostComparison(costRes.value.data || null);
    setLoading(false);
  }, [agentId]);

  useEffect(() => { void load(); }, [load]);

  const config = (agent as any)?.config || {};
  const isShadow = Boolean(config.shadow_mode || config.deployment_mode === 'shadow');
  const managerName = config.manager_name || config.manager || 'AI Operations Manager';
  const department = config.department || agent?.primaryPack || agent?.agent_type || 'Operations';
  const score = Math.round(healthScore?.total ?? Math.max(0, Math.min(100, 100 - (agent?.risk_score || 35) + Math.round((agent?.uptime || 95) / 10))));
  const tone = healthTone(score);

  const agentIncidents = useMemo(() => {
    const workspaceIncidents = (workspace?.incidents || []).map((item: any) => ({
      ...item,
      agent_id: agentId,
      severity: item.severity,
      status: item.status,
      title: item.title,
      description: item.description || item.type,
      created_at: item.createdAt || item.created_at,
    }));
    const globalIncidents = incidents.filter((incident) => incident.agent_id === agentId);
    return [...globalIncidents, ...workspaceIncidents as Incident[]];
  }, [agentId, incidents, workspace?.incidents]);

  const openIncidents = agentIncidents.filter((incident: any) => !['resolved', 'false_positive', 'auto_resolved'].includes(String(incident.status || '').toLowerCase()));
  const lastIncident = [...agentIncidents].sort((a: any, b: any) => new Date(b.created_at || b.createdAt || 0).getTime() - new Date(a.created_at || a.createdAt || 0).getTime())[0];
  const completedActions = Math.max(workspace?.analytics?.totalRequests || 0, auditLogs.filter((entry) => entry.status === 'success').length, agent?.conversations || 0);
  const blockedActions = approvals.filter((approval) => ['denied', 'cancelled', 'expired'].includes(approval.status)).length + auditLogs.filter((entry) => entry.status === 'blocked' || entry.error_message).length;
  const approvedActions = approvals.filter((approval) => approval.status === 'approved').length;
  const approvalDecisions = approvals.filter((approval) => approval.status !== 'pending').length;
  const approvalRate = approvalDecisions ? (approvedActions / approvalDecisions) * 100 : 0;
  const avgApprovalHours = (() => {
    const durations = approvals
      .filter((approval) => approval.reviewed_at || approval.decision_at)
      .map((approval) => (new Date(approval.reviewed_at || approval.decision_at || '').getTime() - new Date(approval.created_at).getTime()) / 36e5)
      .filter((hours) => Number.isFinite(hours) && hours >= 0);
    if (!durations.length) return 0;
    return durations.reduce((sum, hours) => sum + hours, 0) / durations.length;
  })();
  const errors = auditLogs.filter((entry) => entry.status === 'error' || entry.error_message).length;
  const retryCount = auditLogs.filter((entry) => /retry/i.test(entry.action) || /retry/i.test(JSON.stringify(entry.details || {}))).length;

  const agentCost = costComparison?.comparison?.agents?.find((item) => item.agentId === agentId);
  const monthlyCostInr = Math.round((agentCost?.cost || agent?.current_spend || workspace?.analytics?.totalCost || 0) * 83);
  const hourlyRate = Number(config.hourly_rate_inr || 850);
  const timeSavedHours = Math.max(0, Math.round((completedActions * 12) / 60));
  const valueCreatedInr = Number(config.estimated_monthly_savings_inr || (timeSavedHours * hourlyRate));
  const successfulActions = Math.max(1, completedActions - errors - blockedActions);
  const roiRatio = monthlyCostInr > 0 ? valueCreatedInr / monthlyCostInr : valueCreatedInr > 0 ? 99 : 0;
  const budgetCap = agent?.budget_limit || Number(config.safety_controls?.budget_cap_inr || config.budget_cap_inr || 0);
  const spendPct = budgetCap > 0 ? Math.min(100, Math.round(((agent?.current_spend || monthlyCostInr) / budgetCap) * 100)) : 0;

  const connectedApps = useMemo(() => {
    const ids = new Set<string>([
      ...((agent as any)?.integrationIds || []),
      ...((agent as any)?.integration_ids || []),
      ...((agent as any)?.connectedTargets || []).map((target: any) => target.integrationId),
      ...(config.connector_ids || []),
    ].filter(Boolean));
    const labels = new Set<string>([...(config.connected_apps || [])].filter(Boolean));
    const matched = connectors.filter((connector) => ids.has(connector.id) || ids.has(connector.integrationId || '') || ids.has(connector.appId || '') || labels.has(connector.display_name || connector.name));
    const targetApps = ((agent as any)?.connectedTargets || []).map((target: any) => ({ name: target.integrationName, id: target.integrationId }));
    const configApps = [...labels].map((name) => ({ name, id: name }));
    return [...matched.map((connector) => ({ name: connector.display_name || connector.name || connector.id, id: connector.id })), ...targetApps, ...configApps]
      .filter((item, index, arr) => arr.findIndex((other) => other.name === item.name) === index)
      .slice(0, 8);
  }, [agent, config.connected_apps, config.connector_ids, connectors]);

  const capabilities = [
    ...(config.success_metrics || []),
    ...((agent as any)?.connectedTargets || []).map((target: any) => `Operate with ${target.integrationName}`),
    agent?.agent_type ? `${agent.agent_type.replace(/_/g, ' ')} workflows` : 'Governed workflow execution',
  ].filter(Boolean).slice(0, 8);
  const cannotDo = [
    isShadow ? 'Cannot write to connected apps while in shadow mode' : 'Cannot bypass human approval policies',
    'Cannot expose PII, secrets, tokens, Aadhaar, PAN, or bank data',
    'Cannot exceed budget or safety controls without review',
  ];
  const policyRules = [
    ...(config.safety_controls?.read_only_first ? ['Start read-only and require promotion before live writes.'] : []),
    ...(config.safety_controls?.human_approval_before_writes ? ['Ask a human before write actions, messages, refunds, deletes, or updates.'] : []),
    ...(config.safety_controls?.auto_disable_on_incident ? ['Auto-disable or pause when a serious incident is detected.'] : []),
    budgetCap > 0 ? `Stay within a monthly budget cap of ${formatInr(budgetCap)}.` : 'Record spend and alert before high-volume execution.',
    'Log every governed action to the audit trail.',
  ];

  const timeline = auditLogs.slice(0, 10).map((entry) => ({
    id: entry.id,
    timestamp: entry.created_at,
    app: appName(entry.resource_type || (entry.details as any)?.service),
    action: friendlyAction(entry.action),
    outcome: entry.error_message ? 'failed' : entry.status === 'blocked' ? 'blocked' : entry.status === 'approved' ? 'approved' : 'completed',
    impact: Number((entry.details as any)?.inr_impact || (entry.details as any)?.estimated_savings_inr || 0),
    entry,
  }));

  const shadowDay = Math.min(7, Math.max(1, Math.floor((Date.now() - new Date(agent?.created_at || Date.now()).getTime()) / 86400000) + 1));
  const shadowWouldTake = Math.max(completedActions, Number(config.shadow_actions_drafted || auditLogs.length || 0));
  const shadowApprovals = Math.max(approvals.length, Number(config.shadow_approvals_needed || Math.ceil(shadowWouldTake * 0.4)));
  const shadowSavings = Number(config.estimated_monthly_savings_inr || valueCreatedInr || 0);
  const shadowConfidence = Number(config.discovery_confidence || Math.max(55, Math.min(96, score - 5)));

  const runAgentAction = async (mode: 'pause' | 'resume' | 'terminate') => {
    if (!agent) return;
    setActionBusy(true);
    const res = mode === 'resume'
      ? await api.agents.resume(agent.id, 'Resumed from agent employee profile')
      : mode === 'pause'
        ? await api.agents.pause(agent.id, 'Paused from agent employee profile')
        : await api.agents.kill(agent.id, { level: 1, reason: 'Terminated from agent employee profile' });
    setActionBusy(false);
    if (res.success && res.data) {
      setAgent(res.data);
      toast.success(mode === 'resume' ? 'Agent resumed' : mode === 'pause' ? 'Agent paused' : 'Agent terminated');
    } else {
      toast.error(res.error || `Failed to ${mode} agent`);
    }
  };

  const promoteShadow = async () => {
    if (!agent) return;
    setActionBusy(true);
    const res = await api.agents.goLive(agent.id);
    setActionBusy(false);
    if (res.success && res.data) {
      setAgent({ ...res.data, status: res.data.status || 'active' });
      toast.success('Agent promoted to live');
    } else {
      toast.error(res.error || 'Failed to promote agent');
    }
  };

  const reviewSummary = agent
    ? `${agent.name} operated as a ${String(department).replace(/_/g, ' ')} digital employee over the last 30 days. It completed ${completedActions.toLocaleString('en-IN')} governed action${completedActions === 1 ? '' : 's'}, had ${blockedActions.toLocaleString('en-IN')} blocked or failed action${blockedActions === 1 ? '' : 's'}, and created an estimated ${formatInr(valueCreatedInr)} in value at a monthly cost of ${formatInr(monthlyCostInr)}. ${isShadow ? `It is on day ${shadowDay} of a 7-day shadow run with ${shadowConfidence}% confidence; keep it in shadow until reviewers validate the proposed actions, then promote if no critical incidents appear.` : score >= 80 ? 'Recommendation: keep live and expand its connected workflows carefully.' : score >= 50 ? 'Recommendation: keep active but review policies, incidents, and budget controls before expanding scope.' : 'Recommendation: pause or limit scope until risk and reliability improve.'}`
    : 'Agent profile is loading. Once data is available, Zapheit will generate a plain-English performance review.';

  if (!agent && loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-300" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
        <Bot className="mx-auto mb-3 h-10 w-10 text-slate-500" />
        <h1 className="text-xl font-bold text-white">Agent profile not found</h1>
        <p className="mt-2 text-sm text-slate-400">This agent may have been deleted or is not available in this workspace.</p>
        <button onClick={() => onNavigate?.('agents') || navigate('/dashboard/agents')} className="mt-5 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500">
          Back to fleet
        </button>
      </div>
    );
  }

  const currentStatus = statusLabel(agent);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <button onClick={() => onNavigate?.('agents') || navigate('/dashboard/agents')} className="flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-white">
        <ArrowLeft className="h-4 w-4" />
        Back to Fleet
      </button>

      <header className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/25 bg-cyan-500/10">
              <Bot className="h-7 w-7 text-cyan-200" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-white">{agent.name}</h1>
                <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', statusClasses(currentStatus))}>{currentStatus}</span>
                <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-xs font-semibold text-slate-300 capitalize">
                  {String(department).replace(/_/g, ' ')}
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">{agent.description || 'This agent is configured for governed business workflows.'}</p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                <span>Manager: <span className="text-slate-300">{managerName}</span></span>
                <span>Created: <span className="text-slate-300">{formatIst(agent.created_at)}</span></span>
                <span>Last active: <span className="text-slate-300">{formatIst(agent.lastIntegrationSyncAt || (agent.connectedTargets || [])[0]?.lastActivityAt || workspace?.summary?.lastActivityAt)}</span></span>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[170px_220px]">
            <div className={cn('rounded-2xl border p-4', tone.border, tone.bg)}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Health score</p>
              <p className={cn('mt-1 text-4xl font-bold', tone.text)}>{score}</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-900">
                <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${score}%` }} />
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Kill switch</p>
              <p className="mt-1 text-xs text-slate-400">Pause or resume this agent instantly.</p>
              <button
                onClick={() => void runAgentAction(agent.status === 'active' ? 'pause' : 'resume')}
                disabled={actionBusy || agent.status === 'terminated'}
                className={cn(
                  'mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  agent.status === 'active' ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-emerald-600 text-white hover:bg-emerald-500',
                )}
              >
                {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : agent.status === 'active' ? <PauseCircle className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {agent.status === 'active' ? 'Pause agent' : 'Resume agent'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Section title="Identity & Permissions" icon={ShieldCheck}>
            <div className="space-y-4">
              <div className="rounded-xl border border-white/[0.07] bg-slate-950/40 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Role description</p>
                <p className="mt-2 text-sm text-slate-200">
                  {agent.name} is responsible for {String(department).replace(/_/g, ' ')} work, drafting governed actions and following Zapheit policies before touching business systems.
                </p>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Connected apps</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {(connectedApps.length ? connectedApps : [{ id: 'none', name: 'No app connected yet' }]).map((app) => (
                    <div key={app.id} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
                      <span className="text-sm font-medium text-white">{app.name}</span>
                      <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200">
                        {isShadow ? 'Read-only' : config.safety_controls?.human_approval_before_writes ? 'Read-Write gated' : 'Read-Write'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Can do</p>
                  <div className="flex flex-wrap gap-2">
                    {capabilities.map((capability) => <span key={capability} className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200">{capability}</span>)}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Cannot do</p>
                  <div className="flex flex-wrap gap-2">
                    {cannotDo.map((rule) => <span key={rule} className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-200">{rule}</span>)}
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Policy rules applied</p>
                <div className="grid gap-2">
                  {policyRules.map((rule) => (
                    <div key={rule} className="flex items-start gap-2 rounded-xl border border-white/[0.07] bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
                      <Shield className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                      {rule}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section title="Performance This Month" icon={TrendingUp}>
            <div className="grid gap-3 md:grid-cols-3">
              <MetricCard label="Actions completed" value={completedActions.toLocaleString('en-IN')} detail="Successful governed work" tone="text-emerald-300" />
              <MetricCard label="Actions blocked" value={blockedActions.toLocaleString('en-IN')} detail="Policy, approval, or errors" tone={blockedActions > 0 ? 'text-amber-300' : 'text-emerald-300'} />
              <MetricCard label="Human approved" value={approvedActions.toLocaleString('en-IN')} detail={`${formatPercent(approvalRate)} approval rate`} tone="text-cyan-300" />
              <MetricCard label="Avg approval time" value={avgApprovalHours ? `${avgApprovalHours.toFixed(1)}h` : 'No reviews yet'} detail="Reviewed decisions" />
              <MetricCard label="Errors & retries" value={`${errors} / ${retryCount}`} detail="Errors / retries" tone={errors > 0 ? 'text-rose-300' : 'text-emerald-300'} />
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Health trend</p>
                <Sparkline points={(health?.sparkline || []).map((point) => point.requests)} tone={tone.bar} />
              </div>
            </div>
          </Section>

          <Section title="Recent Activity" icon={Clock}>
            {timeline.length === 0 ? (
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] p-4">
                <p className="text-sm font-semibold text-white">No actions yet</p>
                <p className="mt-1 text-sm text-slate-400">This profile is still useful: permissions, policies, budget cap, and shadow plan are already visible before the first run.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.07] overflow-hidden rounded-xl border border-white/[0.08]">
                {timeline.map((item) => (
                  <button key={item.id} onClick={() => setSelectedAudit(item.entry)} className="grid w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] md:grid-cols-[150px_120px_minmax(0,1fr)_110px_100px] md:items-center">
                    <span className="text-xs text-slate-500">{formatIst(item.timestamp)}</span>
                    <span className="text-sm font-medium text-slate-200">{item.app}</span>
                    <span className="text-sm text-white">{item.action}</span>
                    <span className={cn('rounded-full px-2 py-1 text-center text-[11px] font-semibold capitalize',
                      item.outcome === 'completed' ? 'bg-emerald-500/10 text-emerald-200' :
                        item.outcome === 'approved' ? 'bg-cyan-500/10 text-cyan-200' :
                          item.outcome === 'blocked' ? 'bg-amber-500/10 text-amber-200' : 'bg-rose-500/10 text-rose-200'
                    )}>{item.outcome}</span>
                    <span className="text-xs text-slate-400">{item.impact ? formatInr(item.impact) : 'Tracked'}</span>
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section title="Incidents & Risk" icon={ShieldAlert}>
            <div className="grid gap-3 md:grid-cols-3">
              <MetricCard label="Open incidents" value={openIncidents.length} detail={openIncidents[0]?.severity ? `${openIncidents[0].severity} severity` : 'No active incident'} tone={openIncidents.length > 0 ? 'text-rose-300' : 'text-emerald-300'} />
              <MetricCard label="Policy violations" value={blockedActions} detail="Blocked or failed governed actions" tone={blockedActions > 0 ? 'text-amber-300' : 'text-emerald-300'} />
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Risk trend</p>
                <Sparkline points={[agent.risk_score - 8, agent.risk_score - 3, agent.risk_score, agent.risk_score + 2, agent.risk_score - 1, agent.risk_score]} tone={agent.risk_score >= 70 ? 'bg-rose-400' : agent.risk_score >= 40 ? 'bg-amber-400' : 'bg-emerald-400'} />
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-white/[0.07] bg-slate-950/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Last incident summary</p>
              <p className="mt-2 text-sm text-slate-300">{lastIncident ? `${lastIncident.title || (lastIncident as any).type || 'Incident'} · ${formatIst((lastIncident as any).created_at || (lastIncident as any).createdAt)}` : 'No incidents recorded for this agent yet.'}</p>
            </div>
          </Section>

          {isShadow && (
            <Section title="Shadow Mode" icon={Sparkles}>
              <div className="grid gap-3 md:grid-cols-5">
                <MetricCard label="Run day" value={`Day ${shadowDay} of 7`} detail="Read-only validation" tone="text-cyan-300" />
                <MetricCard label="Would act" value={shadowWouldTake} detail="Actions drafted" />
                <MetricCard label="Approvals needed" value={shadowApprovals} detail="Human gates" tone="text-amber-300" />
                <MetricCard label="Savings if promoted" value={formatInr(shadowSavings)} detail="Estimated monthly" tone="text-emerald-300" />
                <MetricCard label="Confidence" value={`${shadowConfidence}%`} detail="Discovery signal" tone={shadowConfidence >= 80 ? 'text-emerald-300' : 'text-amber-300'} />
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button onClick={promoteShadow} disabled={actionBusy} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                  <Zap className="h-4 w-4" /> Promote to live
                </button>
                <button onClick={() => toast.success('Agent kept in shadow mode')} className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20">
                  <Clock className="h-4 w-4" /> Keep in shadow
                </button>
                <button onClick={() => void runAgentAction('terminate')} disabled={actionBusy} className="inline-flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-50">
                  <Ban className="h-4 w-4" /> Terminate
                </button>
              </div>
            </Section>
          )}

          <Section
            title="Performance Review"
            icon={FileText}
            action={<button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500"><Download className="h-3.5 w-3.5" /> Agent Review Report</button>}
          >
            <p className="text-sm leading-relaxed text-slate-300">{reviewSummary}</p>
          </Section>
        </div>

        <aside className="space-y-5">
          <Section title="Financial Impact" icon={IndianRupee}>
            <div className="space-y-3">
              <MetricCard label="Monthly cost" value={formatInr(monthlyCostInr)} detail="Model and platform spend" />
              <MetricCard label="Value created" value={formatInr(valueCreatedInr)} detail={`${timeSavedHours}h saved at ${formatInr(hourlyRate)}/h`} tone="text-emerald-300" />
              <MetricCard label="Cost/action" value={formatInr(monthlyCostInr / successfulActions)} detail={`${successfulActions} successful actions`} />
              <MetricCard label="ROI ratio" value={`${roiRatio.toFixed(1)}x`} detail="Value divided by cost" tone={roiRatio >= 3 ? 'text-emerald-300' : roiRatio >= 1 ? 'text-amber-300' : 'text-rose-300'} />
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Budget cap</p>
                  <p className="text-xs text-slate-400">{budgetCap ? `${spendPct}% used` : 'No cap'}</p>
                </div>
                <p className="mt-2 text-lg font-bold text-white">{budgetCap ? `${formatInr(agent.current_spend || monthlyCostInr)} / ${formatInr(budgetCap)}` : 'No budget cap set'}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-900">
                  <div className={cn('h-full rounded-full', spendPct >= 90 ? 'bg-rose-400' : spendPct >= 70 ? 'bg-amber-400' : 'bg-emerald-400')} style={{ width: `${spendPct}%` }} />
                </div>
              </div>
            </div>
          </Section>

          <Section title="Health Inputs" icon={ActivityIcon}>
            <div className="space-y-2 text-sm text-slate-300">
              {(healthScore?.recommendations || ['Keep policies current before expanding scope.', 'Review approval and incident history after every major workflow change.']).slice(0, 4).map((item) => (
                <div key={item} className="flex items-start gap-2 rounded-xl border border-white/[0.07] bg-slate-950/40 px-3 py-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </Section>
        </aside>
      </div>

      {selectedAudit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="font-bold text-white">Audit detail</h3>
                <p className="text-xs text-slate-400">{formatIst(selectedAudit.created_at)} · {friendlyAction(selectedAudit.action)}</p>
              </div>
              <button onClick={() => setSelectedAudit(null)} className="rounded-lg p-2 text-slate-400 hover:bg-white/[0.06] hover:text-white">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <pre className="max-h-[60vh] overflow-auto p-5 text-xs leading-relaxed text-slate-300">{JSON.stringify(selectedAudit, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

const ActivityIcon = TrendingUp;
