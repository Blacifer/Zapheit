import type { AIAgent } from '../types';

export type ReadinessStatus =
  | 'not_configured'
  | 'needs_policy'
  | 'ready'
  | 'deployed'
  | 'degraded'
  | 'blocked';

export type UnifiedActivityEventType =
  | 'approval'
  | 'incident'
  | 'job'
  | 'connector'
  | 'audit'
  | 'cost';

export interface UnifiedActivityEvent {
  id: string;
  type: UnifiedActivityEventType;
  at: string;
  title: string;
  detail: string;
  status: ReadinessStatus;
  tone: 'info' | 'success' | 'warn' | 'risk';
  route?: string;
  actor?: string | null;
  sourceRef?: string | null;
  evidenceRef?: string | null;
}

export type ConnectorCertificationState =
  | 'production_ready'
  | 'approval_gated'
  | 'read_only'
  | 'unavailable'
  | 'degraded';

export interface ConnectorCertification {
  connectorId: string;
  state: ConnectorCertificationState;
  certified: boolean;
  label: string;
  reasons: string[];
  readActions: number;
  writeActions: number;
  approvalGatedActions: number;
}

export interface AgentProductionProfile {
  agentId: string;
  owner: string;
  purpose: string;
  budgetInr: number;
  riskScore: number;
  lifecycleState: string;
  connectedApps: string[];
  readiness: ReadinessStatus;
  lastExecutionAt?: string | null;
  nextAction: string;
}

export interface OrgReadinessIssue {
  id: string;
  status: ReadinessStatus;
  title: string;
  detail: string;
  route?: string;
}

export interface OrgReadinessScore {
  score: number;
  status: ReadinessStatus;
  label: string;
  summary: string;
  issues: OrgReadinessIssue[];
}

type CapabilityPolicyLike = {
  requires_human_approval?: boolean;
  risk_level?: 'low' | 'medium' | 'high' | string;
  enabled?: boolean;
};

export const PRODUCTION_CERTIFIED_CONNECTORS = new Set([
  'slack',
  'google-workspace',
  'google_workspace',
  'microsoft-365',
  'microsoft_365',
  'jira',
  'github',
  'hubspot',
  'quickbooks',
  'cashfree',
  'naukri',
  'greythr',
]);

export const READINESS_LABELS: Record<ReadinessStatus, string> = {
  not_configured: 'Not configured',
  needs_policy: 'Needs policy',
  ready: 'Ready',
  deployed: 'Deployed',
  degraded: 'Degraded',
  blocked: 'Blocked',
};

export function normalizeConnectorId(value: string) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

export function isCertifiedProductionConnector(connectorId: string) {
  const normalized = normalizeConnectorId(connectorId);
  return PRODUCTION_CERTIFIED_CONNECTORS.has(connectorId) || PRODUCTION_CERTIFIED_CONNECTORS.has(normalized);
}

export function readinessTone(status: ReadinessStatus) {
  if (status === 'blocked') return 'border-rose-500/25 bg-rose-500/10 text-rose-200';
  if (status === 'degraded') return 'border-amber-500/25 bg-amber-500/10 text-amber-200';
  if (status === 'needs_policy') return 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200';
  if (status === 'deployed') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
  if (status === 'ready') return 'border-blue-500/25 bg-blue-500/10 text-blue-200';
  return 'border-slate-600/40 bg-slate-800/70 text-slate-300';
}

export function certificationTone(state: ConnectorCertificationState) {
  if (state === 'degraded') return 'border-amber-500/25 bg-amber-500/10 text-amber-200';
  if (state === 'approval_gated') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
  if (state === 'production_ready') return 'border-blue-500/25 bg-blue-500/10 text-blue-200';
  if (state === 'read_only') return 'border-violet-500/25 bg-violet-500/10 text-violet-200';
  return 'border-slate-600/40 bg-slate-800/70 text-slate-300';
}

export function deriveConnectorCertification(args: {
  connectorId: string;
  comingSoon?: boolean;
  connected?: boolean;
  status?: string | null;
  healthStatus?: string | null;
  capabilityPolicies?: CapabilityPolicyLike[];
  permissions?: string[];
  actionsUnlocked?: string[];
}): ConnectorCertification {
  const policies = args.capabilityPolicies || [];
  const enabledPolicies = policies.filter((policy) => policy.enabled !== false);
  const approvalGatedActions = enabledPolicies.filter((policy) => policy.requires_human_approval).length;
  const highRiskActions = enabledPolicies.filter((policy) => policy.risk_level === 'high' || policy.risk_level === 'medium').length;
  const writeActions = Math.max(approvalGatedActions, highRiskActions, args.actionsUnlocked?.length || 0);
  const readActions = Math.max(
    enabledPolicies.length - writeActions,
    args.permissions?.length || 0,
    0,
  );
  const certified = !args.comingSoon && isCertifiedProductionConnector(args.connectorId);
  const connectionDegraded = Boolean(
    args.connected && (
      args.status === 'error'
      || args.status === 'expired'
      || args.healthStatus === 'degraded'
    ),
  );

  if (connectionDegraded) {
    return {
      connectorId: args.connectorId,
      state: 'degraded',
      certified,
      label: 'Connection degraded',
      reasons: ['The connector is installed, but health or credential status needs attention.'],
      readActions,
      writeActions,
      approvalGatedActions,
    };
  }

  if (!certified) {
    return {
      connectorId: args.connectorId,
      state: 'unavailable',
      certified: false,
      label: args.comingSoon ? 'Not production-certified yet' : 'Certification required',
      reasons: args.comingSoon
        ? ['This connector is not exposed as a production-ready path yet.']
        : ['Use only after auth, action policy, failure handling, and audit capture are verified.'],
      readActions,
      writeActions,
      approvalGatedActions,
    };
  }

  if (approvalGatedActions > 0 || writeActions > 0) {
    return {
      connectorId: args.connectorId,
      state: 'approval_gated',
      certified: true,
      label: 'Certified with governed writes',
      reasons: ['Write actions are available only through configured policy, approval, and audit evidence.'],
      readActions,
      writeActions,
      approvalGatedActions,
    };
  }

  return {
    connectorId: args.connectorId,
    state: readActions > 0 ? 'read_only' : 'production_ready',
    certified: true,
    label: readActions > 0 ? 'Certified read path' : 'Certified production path',
    reasons: [readActions > 0 ? 'Read actions are available for production workflows.' : 'Connector path is certified for production setup.'],
    readActions,
    writeActions,
    approvalGatedActions,
  };
}

export function deriveAgentProductionProfile(agent: AIAgent): AgentProductionProfile {
  const connectedApps = agent.integrationIds || [];
  const budgetInr = Number(agent.budget_limit || 0);
  const riskScore = Number(agent.risk_score || 0);
  const lifecycleState = agent.lifecycle_state || agent.status;
  const readiness: ReadinessStatus =
    agent.status === 'terminated'
      ? 'blocked'
      : agent.status === 'paused'
        ? 'degraded'
        : budgetInr <= 0
          ? 'needs_policy'
          : connectedApps.length === 0
            ? 'not_configured'
            : agent.conversations > 0
              ? 'deployed'
              : 'ready';

  const nextAction =
    readiness === 'blocked'
      ? 'Review termination reason before reactivation.'
      : readiness === 'degraded'
        ? 'Resolve pause or runtime health before sending work.'
        : readiness === 'needs_policy'
          ? 'Add a budget cap and approval guardrails.'
          : readiness === 'not_configured'
            ? 'Connect at least one production app or channel.'
            : readiness === 'ready'
              ? 'Deploy to a runtime or live channel.'
              : 'Monitor execution, cost, and audit evidence.';

  return {
    agentId: agent.id,
    owner: 'Unassigned',
    purpose: agent.description || agent.agent_type || 'Production AI workflow',
    budgetInr,
    riskScore,
    lifecycleState,
    connectedApps,
    readiness,
    lastExecutionAt: agent.lastIntegrationSyncAt || null,
    nextAction,
  };
}

export function deriveOrgReadinessScore(args: {
  agents: AIAgent[];
  pendingApprovals: number;
  openIncidents: number;
  severeIncidents: number;
  connectedConnectors?: number;
  degradedConnectors?: number;
}): OrgReadinessScore {
  const profiles = args.agents.map(deriveAgentProductionProfile);
  const agentsWithoutBudget = profiles.filter((profile) => profile.budgetInr <= 0);
  const agentsWithoutApps = profiles.filter((profile) => profile.connectedApps.length === 0);
  const activeAgents = args.agents.filter((agent) => agent.status === 'active');
  const issues: OrgReadinessIssue[] = [];

  if (args.agents.length === 0) {
    issues.push({
      id: 'no-agents',
      status: 'not_configured',
      title: 'No production agents deployed',
      detail: 'Deploy at least one governed agent before a pilot can prove value.',
      route: 'agent-studio',
    });
  }

  if ((args.connectedConnectors || 0) === 0) {
    issues.push({
      id: 'no-connectors',
      status: 'not_configured',
      title: 'No production apps connected',
      detail: 'Connect a certified app so agents can work on real systems.',
      route: 'apps',
    });
  }

  if (agentsWithoutBudget.length > 0) {
    issues.push({
      id: 'budget-caps',
      status: 'needs_policy',
      title: `${agentsWithoutBudget.length} agent${agentsWithoutBudget.length !== 1 ? 's need' : ' needs'} budget caps`,
      detail: 'Budget caps are required before broad production rollout.',
      route: 'agents',
    });
  }

  if (agentsWithoutApps.length > 0) {
    issues.push({
      id: 'app-links',
      status: 'not_configured',
      title: `${agentsWithoutApps.length} agent${agentsWithoutApps.length !== 1 ? 's need' : ' needs'} connected apps`,
      detail: 'Agents without connected production systems cannot complete real work.',
      route: 'agents',
    });
  }

  if (args.pendingApprovals > 0) {
    issues.push({
      id: 'pending-approvals',
      status: 'needs_policy',
      title: `${args.pendingApprovals} approval${args.pendingApprovals !== 1 ? 's' : ''} waiting`,
      detail: 'Approval queues must stay clear so production work does not stall.',
      route: 'approvals',
    });
  }

  if (args.openIncidents > 0) {
    issues.push({
      id: 'open-incidents',
      status: args.severeIncidents > 0 ? 'blocked' : 'degraded',
      title: `${args.openIncidents} live incident${args.openIncidents !== 1 ? 's' : ''} open`,
      detail: args.severeIncidents > 0 ? 'High-severity incidents block production confidence.' : 'Resolve incidents to keep pilot trust high.',
      route: 'incidents',
    });
  }

  if ((args.degradedConnectors || 0) > 0) {
    issues.push({
      id: 'degraded-connectors',
      status: 'degraded',
      title: `${args.degradedConnectors} connector${args.degradedConnectors !== 1 ? 's' : ''} degraded`,
      detail: 'Production workflows depend on healthy connector credentials and scopes.',
      route: 'apps',
    });
  }

  const penalty =
    (args.agents.length === 0 ? 25 : 0)
    + ((args.connectedConnectors || 0) === 0 ? 20 : 0)
    + Math.min(20, agentsWithoutBudget.length * 5)
    + Math.min(15, agentsWithoutApps.length * 5)
    + Math.min(15, args.pendingApprovals * 3)
    + Math.min(30, args.openIncidents * 8 + args.severeIncidents * 8)
    + Math.min(15, (args.degradedConnectors || 0) * 5);

  const score = Math.max(0, Math.min(100, 100 - penalty));
  const status: ReadinessStatus =
    args.severeIncidents > 0
      ? 'blocked'
      : args.openIncidents > 0 || (args.degradedConnectors || 0) > 0
        ? 'degraded'
        : args.agents.length === 0 || (args.connectedConnectors || 0) === 0
          ? 'not_configured'
          : agentsWithoutBudget.length > 0 || args.pendingApprovals > 0
            ? 'needs_policy'
            : activeAgents.length > 0
              ? 'deployed'
              : 'ready';

  const label =
    status === 'blocked'
      ? 'Blocked'
      : status === 'degraded'
        ? 'Degraded'
        : status === 'needs_policy'
          ? 'Needs policy'
          : status === 'not_configured'
            ? 'Needs setup'
            : status === 'deployed'
              ? 'Production active'
              : 'Ready to deploy';

  const summary =
    issues.length > 0
      ? `${issues.length} production requirement${issues.length !== 1 ? 's' : ''} need attention before this workspace is hard to dismiss.`
      : 'Core production signals are clean: agents, connectors, policies, incidents, and approvals are in good shape.';

  return { score, status, label, summary, issues };
}
