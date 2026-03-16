import { useState, useEffect, lazy, Suspense, useCallback, useRef } from 'react';
import { useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Brain, Bell, User, LogOut, BarChart3, Users, Zap, FileText,
  DollarSign, Eye, Database, Building2, Key, CreditCard, Settings, X, Play, Link2,
  TrendingUp, Sparkles, Webhook, ChevronLeft, MessageSquare, AlertTriangle, PlugZap, ClipboardList, ListChecks, ListTodo, Shield, Bot, ShoppingBag
} from 'lucide-react';
import { AIAgent, Incident, CostData, ApiKey } from '../types';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api-client';
import { useAgents, useIncidents, useCostData, queryKeys } from '../hooks/useData';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { cn } from '../lib/utils';
import { guessPackForIntegration, type IntegrationPackId } from '../lib/integration-packs';

const DashboardOverview = lazy(() => import('./dashboard/DashboardOverview'));
const GettingStartedPage = lazy(() => import('./dashboard/GettingStartedPage'));
const ConnectAgentPage = lazy(() => import('./dashboard/ConnectAgentPage'));
const FleetPage = lazy(() => import('./dashboard/FleetPage'));
const AgentTemplatesPage = lazy(() => import('./dashboard/AgentTemplatesPage'));
const PlaybooksPage = lazy(() => import('./dashboard/PlaybooksPage'));
const JobsInboxPage = lazy(() => import('./dashboard/JobsInboxPage'));
const WorkItemsPage = lazy(() => import('./dashboard/WorkItemsPage'));
const ActionPoliciesPage = lazy(() => import('./dashboard/ActionPoliciesPage'));
const IncidentsPage = lazy(() => import('./dashboard/IncidentsPage'));
const IntegrationsPage = lazy(() => import('./dashboard/IntegrationsPage'));
const PersonaPage = lazy(() => import('./dashboard/PersonaPage'));
const CostsPage = lazy(() => import('./dashboard/CostsPage'));
const ShadowModePage = lazy(() => import('./dashboard/ShadowModePage'));
const BlackBoxPage = lazy(() => import('./dashboard/BlackBoxPage'));
const ApiKeysPage = lazy(() => import('./dashboard/ApiKeysPage'));
const PricingPage = lazy(() => import('./dashboard/PricingPage'));
const SafeHarborPage = lazy(() => import('./dashboard/SafeHarborPage'));
const SettingsPage = lazy(() => import('./dashboard/SettingsPage'));
const ApiAnalyticsPage = lazy(() => import('./dashboard/ApiAnalyticsPage'));
const ModelComparisonPage = lazy(() => import('./dashboard/ModelComparisonPage'));
const WebhooksPage = lazy(() => import('./dashboard/WebhooksPage'));
const BatchProcessingPage = lazy(() => import('./dashboard/BatchProcessingPage'));
const ModelFineTuningPage = lazy(() => import('./dashboard/ModelFineTuningPage'));
const CachingPage = lazy(() => import('./dashboard/CachingPage'));
const ConversationsPage = lazy(() => import('./dashboard/ConversationsPage'));
const CoverageStatusPage = lazy(() => import('./dashboard/CoverageStatusPage'));
const DeveloperPage = lazy(() => import('./dashboard/DeveloperPage'));
const DomainAgentLibraryPage = lazy(() => import('./dashboard/DomainAgentLibraryPage'));
const MarketplacePage = lazy(() => import('./dashboard/MarketplacePage'));

interface DashboardProps {
  isDemoMode?: boolean;
  onSignUp?: () => void;
}

function DashboardSectionLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/15 border-t-blue-300"></div>
    </div>
  );
}

type DashboardNotification = {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  source: 'local' | 'reconciliation';
};

const COVERAGE_FOCUS_STORAGE_KEY = 'synthetic_hr_coverage_focus';
const AGENT_WORKSPACE_FOCUS_STORAGE_KEY = 'synthetic_hr_agent_workspace_focus';

type CoverageNotificationPayload = Awaited<ReturnType<typeof api.admin.getCoverageStatus>>['data'];
type IntegrationSummaryRow = {
  id: string;
  name: string;
  category: string;
  tags?: string[];
  status?: string;
  lifecycleStatus?: string;
  lastSyncAt?: string | null;
};

type AgentConnectionDraft = {
  integrationIds: string[];
  primaryPack: IntegrationPackId | null;
};

function getNotificationReadStorageKey(orgName?: string | null) {
  return `synthetic_hr_notification_reads:${orgName || 'workspace'}`;
}

function getAgentConnectionStorageKey(orgName?: string | null) {
  return `synthetic_hr_agent_connections:${orgName || 'workspace'}`;
}

function readAgentConnectionState(orgName?: string | null) {
  if (typeof window === 'undefined') return {} as Record<string, AgentConnectionDraft>;
  try {
    const raw = localStorage.getItem(getAgentConnectionStorageKey(orgName));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as Record<string, AgentConnectionDraft> : {};
  } catch {
    return {} as Record<string, AgentConnectionDraft>;
  }
}

function writeAgentConnectionState(orgName: string | null | undefined, state: Record<string, AgentConnectionDraft>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(getAgentConnectionStorageKey(orgName), JSON.stringify(state));
}

function readNotificationState(orgName?: string | null) {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const raw = localStorage.getItem(getNotificationReadStorageKey(orgName));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
}

function writeNotificationState(orgName: string | null | undefined, ids: Iterable<string>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(getNotificationReadStorageKey(orgName), JSON.stringify(Array.from(ids)));
}

function readFocusedAgentWorkspace() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AGENT_WORKSPACE_FOCUS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { agentId?: string };
    return parsed?.agentId ? parsed.agentId : null;
  } catch {
    return null;
  }
}

function writeFocusedAgentWorkspace(agentId: string | null | undefined) {
  if (typeof window === 'undefined') return;
  if (!agentId) {
    localStorage.removeItem(AGENT_WORKSPACE_FOCUS_STORAGE_KEY);
    return;
  }
  localStorage.setItem(AGENT_WORKSPACE_FOCUS_STORAGE_KEY, JSON.stringify({ agentId }));
}

function buildCoverageNotifications(
  coverage: CoverageNotificationPayload | undefined,
  readIds: Set<string>,
): DashboardNotification[] {
  if (!coverage) return [];

  const sentNotifications = (coverage.reconciliationNotifications?.history || []).map((entry) => ({
    id: `recon:${entry.id}`,
    type: entry.severity === 'critical' ? 'error' as const : 'warning' as const,
    title: entry.title,
    message: entry.message,
    timestamp: entry.sentAt,
    read: readIds.has(`recon:${entry.id}`),
    source: 'reconciliation' as const,
  }));

  const activeAlerts = (coverage.reconciliationAlerts || []).map((alert) => {
    const id = `active:${alert.code}:${alert.provider}`;
    return {
      id,
      type: alert.severity === 'critical'
        ? 'error' as const
        : alert.severity === 'warning'
          ? 'warning' as const
          : 'info' as const,
      title: alert.title,
      message: alert.message,
      timestamp: coverage.generatedAt,
      read: readIds.has(id),
      source: 'reconciliation' as const,
    };
  });

  if (coverage.reconciliationAlertConfig?.channels?.inApp === false) {
    return [];
  }

  const deduped = new Map<string, DashboardNotification>();

  [...activeAlerts, ...sentNotifications]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .forEach((notification) => {
      const key = `${notification.title}::${notification.message}`;
      const existing = deduped.get(key);

      if (!existing) {
        deduped.set(key, notification);
        return;
      }

      const existingTime = new Date(existing.timestamp).getTime();
      const nextTime = new Date(notification.timestamp).getTime();
      const preferred = nextTime >= existingTime ? notification : existing;
      const merged: DashboardNotification = {
        ...preferred,
        read: existing.read && notification.read,
      };

      deduped.set(key, merged);
    });

  return Array.from(deduped.values())
    .sort((left, right) => {
      const severityRank = (notification: DashboardNotification) => {
        if (notification.type === 'error') return 0;
        if (notification.type === 'warning') return 1;
        if (notification.type === 'info') return 2;
        return 3;
      };
      const sourceRank = (notification: DashboardNotification) => {
        if (notification.source === 'reconciliation') return 0;
        return 1;
      };
      const readRank = (notification: DashboardNotification) => notification.read ? 1 : 0;

      const readDiff = readRank(left) - readRank(right);
      if (readDiff !== 0) return readDiff;

      const severityDiff = severityRank(left) - severityRank(right);
      if (severityDiff !== 0) return severityDiff;

      const sourceDiff = sourceRank(left) - sourceRank(right);
      if (sourceDiff !== 0) return sourceDiff;

      return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
    })
    .slice(0, 50);
}

export default function Dashboard({ isDemoMode, onSignUp }: DashboardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  // Derive current page from URL path: /dashboard/fleet → 'fleet'
  const currentPage = location.pathname.replace(/^\/dashboard\/?/, '').split('/')[0] || 'overview';
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);

  // Demo mode local state (React Query is disabled in demo mode)
  const [demoAgents, setDemoAgents] = useState<AIAgent[]>([]);
  const [demoIncidents, setDemoIncidents] = useState<Incident[]>([]);
  const [demoCostData, setDemoCostData] = useState<CostData[]>([]);
  const [demoLoading, setDemoLoading] = useState(!!isDemoMode);

  // React Query hooks (disabled when in demo mode)
  const { agents: liveAgents, loading: agentsLoading } = useAgents({ enabled: !isDemoMode });
  const { incidents: liveIncidents } = useIncidents(undefined, { enabled: !isDemoMode });
  const { costData: liveCostData } = useCostData('30d', { enabled: !isDemoMode });

  // Unified data — demo or live
  const agents = isDemoMode ? demoAgents : liveAgents;
  const incidents = isDemoMode ? demoIncidents : liveIncidents;
  const costData = isDemoMode ? demoCostData : liveCostData;
  const loading = isDemoMode ? demoLoading : agentsLoading;

  const [integrationRows, setIntegrationRows] = useState<IntegrationSummaryRow[]>([]);
  const [agentConnections, setAgentConnections] = useState<Record<string, AgentConnectionDraft>>({});
  const [fleetWorkspaceAgentId, setFleetWorkspaceAgentId] = useState<string | null>(null);
  const [integrationAgentId, setIntegrationAgentId] = useState<string | null>(null);
  const [integrationRecommendedPack, setIntegrationRecommendedPack] = useState<IntegrationPackId | null>(null);
  const [domainAgentPreselect, setDomainAgentPreselect] = useState<{ packId: IntegrationPackId; agentId: string } | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const { user, signOut } = useApp();

  // Simple local state for notifications and role
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [role, setRole] = useState<string>('super_admin');
  const [coverageStatus, setCoverageStatus] = useState<CoverageNotificationPayload | null>(null);

  const hasUserNavigatedRef = useRef(false);
  const hasAutoRedirectedRef = useRef(false);

  const navigateTo = useCallback((page: string, options?: { userInitiated?: boolean }) => {
    const userInitiated = options?.userInitiated ?? true;
    if (userInitiated) {
      hasUserNavigatedRef.current = true;
    }
    navigate(`/dashboard/${page}`);
  }, [navigate]);

  const suggestPackForAgent = useCallback((agent: AIAgent): IntegrationPackId => {
    const type = String(agent.agent_type || '').toLowerCase();
    const name = String(agent.name || '').toLowerCase();
    const text = `${type} ${name}`;
    if (text.includes('support') || text.includes('customer')) return 'support';
    if (text.includes('sales') || text.includes('lead') || text.includes('revenue')) return 'sales';
    if (text.includes('refund') || text.includes('finance') || text.includes('billing') || text.includes('payment')) return 'finance';
    if (text.includes('recruit') || text.includes('talent') || text.includes('hiring') || text.includes('hr')) return 'recruitment';
    if (text.includes('compliance') || text.includes('legal') || text.includes('policy')) return 'compliance';
    return 'it';
  }, []);

  const openIntegrationsForAgent = useCallback((agent: AIAgent, packId?: IntegrationPackId | null) => {
    setIntegrationAgentId(agent.id);
    setFleetWorkspaceAgentId(agent.id);
    writeFocusedAgentWorkspace(agent.id);
    setIntegrationRecommendedPack(packId || agent.primaryPack || suggestPackForAgent(agent));
    navigateTo('integrations', { userInitiated: false });
  }, [navigateTo, suggestPackForAgent]);

  const handleIntegrationConnected = useCallback((payload: {
    agentId: string;
    integrationId: string;
    integrationName: string;
    packId: IntegrationPackId;
    status: string;
    lastSyncAt?: string | null;
  }) => {
    void api.agents.updatePublishState(payload.agentId, {
      publish_status: payload.status === 'connected' ? 'live' : 'ready',
      primary_pack: payload.packId,
      integration_ids: Array.from(new Set([
        ...(agentConnections[payload.agentId]?.integrationIds || agents.find((agent) => agent.id === payload.agentId)?.integrationIds || []),
        payload.integrationId,
      ])),
    });
    setAgentConnections((current) => {
      const existing = current[payload.agentId] || { integrationIds: [], primaryPack: payload.packId };
      const next = {
        ...current,
        [payload.agentId]: {
          integrationIds: Array.from(new Set([...existing.integrationIds, payload.integrationId])),
          primaryPack: existing.primaryPack || payload.packId,
        },
      };
      writeAgentConnectionState(user?.organizationName, next);
      return next;
    });
    setFleetWorkspaceAgentId(payload.agentId);
    writeFocusedAgentWorkspace(payload.agentId);
  }, [agentConnections, agents, user?.organizationName]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    setAgentConnections(readAgentConnectionState(user?.organizationName));
  }, [mounted, user?.organizationName]);

  // Initialise agentConnections from live API data on first successful load
  const agentConnectionsInitialized = useRef(false);
  useEffect(() => {
    if (isDemoMode || liveAgents.length === 0 || agentConnectionsInitialized.current) return;
    agentConnectionsInitialized.current = true;
    setAgentConnections(Object.fromEntries(
      liveAgents.map((agent) => [
        agent.id,
        {
          integrationIds: agent.integrationIds || [],
          primaryPack: agent.primaryPack || suggestPackForAgent(agent),
        },
      ]),
    ));
  }, [liveAgents, isDemoMode, suggestPackForAgent]);

  useEffect(() => {
    if (!mounted) return;
    const focusedAgentId = readFocusedAgentWorkspace();
    if (focusedAgentId) {
      setFleetWorkspaceAgentId(focusedAgentId);
      setIntegrationAgentId(focusedAgentId);
    }
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    writeFocusedAgentWorkspace(fleetWorkspaceAgentId);
  }, [fleetWorkspaceAgentId, mounted]);

  const refreshData = useCallback(async () => {
    // Demo mode: populate local demo state directly
    if (isDemoMode) {
      setDemoLoading(true);
      const demoAgentsList: AIAgent[] = [
        { id: '1', name: 'Support Bot', description: 'Customer support AI agent', agent_type: 'support', platform: 'web', model_name: 'GPT-4', status: 'active', lifecycle_state: 'processing', risk_level: 'low', risk_score: 23, conversations: 15420, created_at: '2024-01-15', satisfaction: 94, uptime: 99.5, budget_limit: 1000, current_spend: 462, auto_throttle: true, publishStatus: 'live', primaryPack: 'support', integrationIds: ['zendesk', 'intercom'] },
        { id: '2', name: 'Sales Assistant', description: 'Sales qualification AI agent', agent_type: 'sales', platform: 'web', model_name: 'Claude-3', status: 'active', lifecycle_state: 'processing', risk_level: 'medium', risk_score: 45, conversations: 8932, created_at: '2024-02-01', satisfaction: 88, uptime: 98.2, budget_limit: 500, current_spend: 267, auto_throttle: false, publishStatus: 'live', primaryPack: 'sales', integrationIds: ['hubspot'] },
        { id: '3', name: 'HR Bot', description: 'HR internal support agent', agent_type: 'hr', platform: 'web', model_name: 'GPT-4', status: 'active', lifecycle_state: 'idle', risk_level: 'low', risk_score: 18, conversations: 4521, created_at: '2024-02-15', satisfaction: 96, uptime: 99.8, budget_limit: 300, current_spend: 135, auto_throttle: true, publishStatus: 'ready', primaryPack: 'recruitment', integrationIds: [] },
        { id: '4', name: 'Refund Handler', description: 'Automated refund processing', agent_type: 'finance', platform: 'web', model_name: 'GPT-4', status: 'paused', lifecycle_state: 'error', risk_level: 'high', risk_score: 78, conversations: 2341, created_at: '2024-03-01', satisfaction: 72, uptime: 95.5, budget_limit: 200, current_spend: 70, auto_throttle: false, publishStatus: 'ready', primaryPack: 'finance', integrationIds: ['stripe'] },
        { id: '5', name: 'Knowledge Base', description: 'Internal knowledge assistant', agent_type: 'support', platform: 'web', model_name: 'Claude-3', status: 'active', lifecycle_state: 'processing', risk_level: 'low', risk_score: 12, conversations: 28754, created_at: '2024-01-20', satisfaction: 97, uptime: 99.9, budget_limit: 1500, current_spend: 862, auto_throttle: true, publishStatus: 'not_live', primaryPack: 'support', integrationIds: [] },
      ];
      setIntegrationRows([
        { id: 'zendesk', name: 'Zendesk', category: 'SUPPORT', status: 'connected', lifecycleStatus: 'connected', lastSyncAt: new Date().toISOString() },
        { id: 'intercom', name: 'Intercom', category: 'SUPPORT', status: 'connected', lifecycleStatus: 'connected', lastSyncAt: new Date().toISOString() },
        { id: 'hubspot', name: 'HubSpot', category: 'CRM', status: 'connected', lifecycleStatus: 'connected', lastSyncAt: new Date().toISOString() },
        { id: 'stripe', name: 'Stripe', category: 'PAYMENTS', status: 'configured', lifecycleStatus: 'configured', lastSyncAt: new Date(Date.now() - 86400000).toISOString() },
      ]);
      setAgentConnections({
        '1': { integrationIds: ['zendesk', 'intercom'], primaryPack: 'support' },
        '2': { integrationIds: ['hubspot'], primaryPack: 'sales' },
        '3': { integrationIds: [], primaryPack: 'recruitment' },
        '4': { integrationIds: ['stripe'], primaryPack: 'finance' },
        '5': { integrationIds: [], primaryPack: 'support' },
      });
      const demoIncidentsList: Incident[] = [
        { id: '1', agent_id: '4', agent_name: 'Refund Handler', incident_type: 'policy_override', severity: 'critical', status: 'open', title: 'Unauthorized Refund Approved', description: 'Bot approved a refund request without proper verification', created_at: new Date().toISOString() },
        { id: '2', agent_id: '2', agent_name: 'Sales Assistant', incident_type: 'hallucination', severity: 'low', status: 'resolved', title: 'Incorrect Pricing Information', description: 'Bot provided wrong pricing for enterprise plan', resolved_at: new Date().toISOString(), created_at: new Date(Date.now() - 86400000).toISOString() },
        { id: '3', agent_id: '1', agent_name: 'Support Bot', incident_type: 'pii_extraction', severity: 'high', status: 'open', title: 'Potential PII Exposure', description: 'Bot may have shared customer email in response', created_at: new Date(Date.now() - 172800000).toISOString() },
      ];
      const demoCostList: CostData[] = [
        { id: '1', tokens: 1542000, cost: 462.60, date: new Date().toISOString(), requests: 5000 },
        { id: '2', tokens: 893200, cost: 267.96, date: new Date().toISOString(), requests: 2800 },
        { id: '3', tokens: 452100, cost: 135.63, date: new Date().toISOString(), requests: 1500 },
        { id: '4', tokens: 234100, cost: 70.23, date: new Date().toISOString(), requests: 750 },
        { id: '5', tokens: 2875400, cost: 862.62, date: new Date().toISOString(), requests: 9200 },
      ];
      const demoNotificationsList: DashboardNotification[] = [
        { id: '1', type: 'incident', title: 'Critical Incident Detected', message: 'Refund Handler approved unauthorized refund', read: false, created_at: new Date().toISOString() },
        { id: '2', type: 'cost', title: 'Cost Alert', message: 'Monthly AI costs exceeded budget by 15%', read: false, created_at: new Date(Date.now() - 86400000).toISOString() },
        { id: '3', type: 'system', title: 'Shadow Mode Complete', message: 'New agent passed deployment testing with 92% score', read: true, created_at: new Date(Date.now() - 172800000).toISOString() },
      ].map((n: any) => ({
        id: n.id,
        type: n.type === 'cost' ? 'warning' as const : n.type === 'incident' ? 'error' as const : 'success' as const,
        title: n.title,
        message: n.message,
        timestamp: n.created_at,
        read: n.read,
        source: 'local' as const,
      }));

      setDemoAgents(demoAgentsList);
      setDemoIncidents(demoIncidentsList);
      setDemoCostData(demoCostList);
      setNotifications(demoNotificationsList);
      setApiKeys([
        { id: '1', name: 'Production Key', key: 'sk-demo-xxxx', permissions: ['agents.read', 'agents.update'], created: new Date().toISOString(), lastUsed: new Date().toISOString() },
      ]);
      setDemoLoading(false);
      return;
    }

    // Live mode: invalidate React Query caches + reload supplemental data
    try {
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agents }),
        queryClient.invalidateQueries({ queryKey: queryKeys.incidents() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.costAnalytics('30d') }),
      ]);

      const [integrationsRes, , coverageResult] = await Promise.all([
        api.integrations.getAll(),
        Promise.resolve({ apiKeys: [], error: 'unavailable' }),
        api.admin.getCoverageStatus().catch(() => ({ success: false, error: 'unavailable' } as any)),
      ]);

      if (integrationsRes.success && Array.isArray(integrationsRes.data)) {
        setIntegrationRows((integrationsRes.data as any[]).map((integration) => ({
          id: integration.id,
          name: integration.name,
          category: integration.category,
          tags: integration.tags || [],
          status: integration.status,
          lifecycleStatus: integration.lifecycleStatus,
          lastSyncAt: integration.lastSyncAt || null,
        })));
      } else {
        setIntegrationRows([]);
      }

      const readIds = readNotificationState(user?.organizationName);
      if (coverageResult?.success && coverageResult.data) {
        setCoverageStatus(coverageResult.data);
        setNotifications(buildCoverageNotifications(coverageResult.data, readIds));
      } else {
        setCoverageStatus(null);
        setNotifications([]);
      }
    } catch (err) {
      console.error('Failed to load supplemental data:', err);
      setNotifications([]);
      setError('Unable to load live operational data right now.');
    }
  }, [isDemoMode, queryClient, user?.organizationName]);

  useEffect(() => {
    if (!mounted) return;
    void refreshData();
  }, [mounted, refreshData]);

  const onboardingStorageScope = user?.organizationName || 'workspace';
  const onboardingDismissedKey = `synthetic_hr_onboarding_dismissed:${onboardingStorageScope}`;
  const onboardingCompletedKey = `synthetic_hr_onboarding_completed:${onboardingStorageScope}`;
  const onboardingDismissed = typeof window !== 'undefined' ? Boolean(localStorage.getItem(onboardingDismissedKey)) : false;
  const onboardingCompleted = typeof window !== 'undefined' ? Boolean(localStorage.getItem(onboardingCompletedKey)) : false;
  const needsOnboarding = Boolean(
    !isDemoMode
    && !onboardingCompleted
    && !onboardingDismissed
    && (
      (coverageStatus?.agents?.total ?? agents.length) === 0
      || (coverageStatus?.telemetry?.gatewayObserved === false)
    )
  );

  const enrichedAgents = agents.map((agent) => {
    const connectionState = agentConnections[agent.id] || {
      integrationIds: agent.integrationIds || [],
      primaryPack: agent.primaryPack || suggestPackForAgent(agent),
    };
    const linkedIntegrations = connectionState.integrationIds
      .map((integrationId) => integrationRows.find((row) => row.id === integrationId))
      .filter(Boolean) as IntegrationSummaryRow[];
    const connectedTargets = linkedIntegrations.map((integration) => ({
      integrationId: integration.id,
      integrationName: integration.name,
      packId: guessPackForIntegration(integration),
      status: integration.lifecycleStatus || integration.status || 'disconnected',
      lastSyncAt: integration.lastSyncAt || null,
      lastActivityAt: integration.lastSyncAt || null,
    }));
    const connectedCount = connectedTargets.filter((target) => target.status === 'connected').length;
    const publishStatus = connectedTargets.length === 0
      ? 'not_live'
      : connectedCount > 0
        ? 'live'
        : 'ready';

    return {
      ...agent,
      publishStatus,
      primaryPack: connectionState.primaryPack || suggestPackForAgent(agent),
      integrationIds: connectionState.integrationIds,
      connectedTargets,
      lastIntegrationSyncAt: connectedTargets[0]?.lastSyncAt || null,
    } as AIAgent;
  });

  useEffect(() => {
    if (!mounted) return;
    if (loading) return;
    // Auto-route to onboarding only once on first load.
    // Never override explicit user navigation (e.g. clicking "Overview").
    if (!hasAutoRedirectedRef.current && !hasUserNavigatedRef.current && needsOnboarding && currentPage === 'overview') {
      hasAutoRedirectedRef.current = true;
      navigateTo('getting-started', { userInitiated: false });
    }
  }, [mounted, loading, needsOnboarding, currentPage, navigateTo]);

  useEffect(() => {
    if (!mounted || isDemoMode) return;
    writeAgentConnectionState(user?.organizationName, agentConnections);
  }, [agentConnections, isDemoMode, mounted, user?.organizationName]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = async (id: string) => {
    const updated = notifications.map((n) => n.id === id ? { ...n, read: true } : n);
    setNotifications(updated);
    const readIds = new Set(updated.filter((notification) => notification.read).map((notification) => notification.id));
    writeNotificationState(user?.organizationName, readIds);

    // Sync to Appwrite
    /*try {
      await appwriteDB.markNotificationRead(id);
    } catch (awError) {
      console.warn('Failed to sync notification to Appwrite:', awError);
    }*/
  };

  const openCoverageFromNotification = async (notification: DashboardNotification) => {
    await markAsRead(notification.id);
    if (notification.source === 'reconciliation') {
      localStorage.setItem(COVERAGE_FOCUS_STORAGE_KEY, JSON.stringify({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        timestamp: notification.timestamp,
      }));
    }
    navigateTo('coverage', { userInitiated: false });
    setShowNotificationPanel(false);
  };

  const markAllAsRead = async () => {
    const updated = notifications.map((n) => ({ ...n, read: true }));
    setNotifications(updated);
    writeNotificationState(user?.organizationName, updated.map((notification) => notification.id));

    // Sync all to Appwrite
    /*try {
      for (const n of notifications) {
        await appwriteDB.markNotificationRead(n.id);
      }
    } catch (awError) {
      console.warn('Failed to sync notifications to Appwrite:', awError);
    }*/
  };

  const clearNotifications = () => {
    const updated = notifications.map((notification) => ({ ...notification, read: true }));
    setNotifications(updated);
    writeNotificationState(user?.organizationName, updated.map((notification) => notification.id));
  };

  const addNotification = async (type: string, title: string, message: string) => {
    const newNotification: DashboardNotification = {
      id: crypto.randomUUID(),
      type: type === 'error' ? 'error' : type === 'warning' ? 'warning' : type === 'success' ? 'success' : 'info',
      title,
      message,
      timestamp: new Date().toISOString(),
      read: false,
      source: 'local',
    };
    const updated = [newNotification, ...notifications].slice(0, 50);
    setNotifications(updated);
    const readIds = new Set(updated.filter((notification) => notification.read).map((notification) => notification.id));
    writeNotificationState(user?.organizationName, readIds);

    // Sync to Appwrite
    /*try {
      await appwriteDB.createNotification({
        type,
        title,
        message,
        read: false
      });
    } catch (awError) {
      console.warn('Failed to sync notification to Appwrite:', awError);
    }*/
  };

  const [error, setError] = useState<string | null>(null);

  const saveAgents = async (newAgentsOrUpdater: AIAgent[] | ((currentAgents: AIAgent[]) => AIAgent[])) => {
    try {
      const previousAgents = agents;
      const resolvedAgents = typeof newAgentsOrUpdater === 'function'
        ? newAgentsOrUpdater(previousAgents)
        : newAgentsOrUpdater;
      const nextAgents = [...resolvedAgents];

      const prevMap = new Map(previousAgents.map(a => [a.id, a]));
      const nextIds = new Set(nextAgents.map(a => a.id));

      // Upsert current agents to backend
      for (let i = 0; i < nextAgents.length; i++) {
        const agent = nextAgents[i];
        const existing = prevMap.get(agent.id);

        if (existing) {
          const updated = await api.agents.update(agent.id, {
            name: agent.name,
            description: agent.description,
            status: agent.status,
            model_name: agent.model_name,
            system_prompt: (agent as any).system_prompt || '',
            config: (agent as any).config || {},
          });
          if (!updated.success) {
            const msg = updated.error || 'Failed to update agent.';
            if (msg.toLowerCase().includes('not found')) {
              setError('That agent no longer exists on the server. Reloading fleet to sync state.');
              await refreshData();
              return;
            }
            throw new Error(msg);
          }
        } else {
          const created = await api.agents.create({
            name: agent.name,
            description: agent.description,
            agent_type: agent.agent_type || 'custom',
            platform: agent.platform || 'openai',
            model_name: agent.model_name || 'gpt-4o',
            system_prompt: (agent as any).system_prompt || '',
            config: (agent as any).config || {},
          });

          if (created.success && created.data && (created.data as any).id) {
            nextAgents[i] = {
              ...agent,
              id: (created.data as any).id,
            };
          }
        }
      }

      // Agents removed in the UI: prefer real delete; treat missing as already removed.
      const removedAgents = previousAgents.filter(a => !nextIds.has(a.id));
      for (const removed of removedAgents) {
        const deleted = await api.agents.delete(removed.id);
        if (deleted.success) continue;

        const msg = deleted.error || '';
        if (msg.toLowerCase().includes('not found')) {
          continue;
        }

        const killed = await api.agents.kill(removed.id, {
          level: 1,
          reason: 'Removed from dashboard UI (fallback terminate)',
        });

        if (!killed.success) {
          const killMsg = killed.error || '';
          if (!killMsg.toLowerCase().includes('not found')) {
            throw new Error(killMsg || 'Failed to terminate removed agent.');
          }
        }
      }

      if (isDemoMode) {
        setDemoAgents(nextAgents);
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
      }
    } catch (err) {
      console.error('Failed to save agents:', err);
      setError('Failed to save agents to backend.');
    }
  };

  const saveIncidents = async (newIncidents: Incident[]) => {
    try {
      const previousIncidents = incidents;
      const prevMap = new Map(previousIncidents.map(i => [i.id, i]));
      const nextIncidents = [...newIncidents];

      for (let i = 0; i < nextIncidents.length; i++) {
        const incident = nextIncidents[i];
        const prev = prevMap.get(incident.id) as Incident | undefined;

        if (!prev) {
          const created = await api.incidents.create({
            agent_id: incident.agent_id,
            incident_type: incident.incident_type as any,
            severity: incident.severity,
            title: incident.title,
            description: incident.description,
          });

          const createdRecord = Array.isArray(created.data)
            ? (created.data as any[])[0]
            : (created.data as any);
          if (created.success && createdRecord?.id) {
            nextIncidents[i] = { ...incident, id: createdRecord.id };
          }
        } else if (prev.status !== 'resolved' && incident.status === 'resolved') {
          await api.incidents.resolve(incident.id, 'Resolved from dashboard UI');
        }
      }

      // Delete incidents removed in the UI
      const nextIds = new Set(nextIncidents.map((incident) => incident.id));
      const removedIncidents = previousIncidents.filter((incident) => !nextIds.has(incident.id));
      for (const removed of removedIncidents) {
        await api.incidents.delete(removed.id);
      }

      if (isDemoMode) {
        setDemoIncidents(nextIncidents);
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.incidents() });
      }
    } catch (err) {
      console.error('Failed to save incidents:', err);
      setError('Failed to save incidents to backend.');
    }
  };

  const saveCostData = async (newCostData: CostData[]) => {
    try {
      const previousCosts = costData;
      const prevIds = new Set(previousCosts.map(c => c.id));

      for (const entry of newCostData) {
        if (!prevIds.has(entry.id) && agents.length > 0) {
          await api.costs.record({
            agent_id: agents[0].id,
            model_name: 'gpt-4o',
            input_tokens: Math.max(0, Math.floor(entry.tokens * 0.4)),
            output_tokens: Math.max(0, Math.floor(entry.tokens * 0.6)),
            request_count: entry.requests || 1,
          });
        }
      }

      if (isDemoMode) {
        setDemoCostData(newCostData);
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.costAnalytics('30d') });
      }
    } catch (err) {
      console.error('Failed to save cost data:', err);
      setError('Failed to save cost data to backend.');
    }
  };

  const saveApiKeys = useCallback(async (newApiKeys: ApiKey[]) => {
    try {
      setApiKeys(newApiKeys);
    } catch (err) {
      console.error('Failed to save API keys:', err);
      setError('Failed to save API keys. Storage may be full.');
    }
  }, []);

  // Live Budget Monitoring and Cost Simulation
  useEffect(() => {
    // Disabled the simulation loop since agents are real and we don't want them consuming random fake cost
    // Real budget tracking will be powered by backend usage logs
  }, [agents, isDemoMode]);

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="min-h-screen app-bg flex items-center justify-center text-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-white/15 border-t-blue-300"></div>
      </div>
    );
  }

  // Removed full-page loading block to render layout skeleton immediately

  return (
    <div className="min-h-screen app-bg flex text-slate-50">
      {/* Demo Mode Banner */}
      {isDemoMode && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-cyan-500/90 to-blue-600/90 backdrop-blur-md text-white px-4 py-2.5 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded-md bg-white/20 text-xs font-bold tracking-wider uppercase">Demo</span>
            <span className="text-sm font-medium">You're exploring with sample data — nothing is real or saved.</span>
          </div>
          {onSignUp && (
            <button
              onClick={onSignUp}
              className="flex-shrink-0 px-4 py-1.5 bg-white text-blue-700 rounded-lg text-sm font-semibold hover:bg-slate-100 transition-colors shadow"
            >
              Sign Up Free →
            </button>
          )}
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-red-500/90 text-white px-4 py-2 flex items-center justify-between" style={isDemoMode ? { top: '46px' } : undefined}>
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hover:text-red-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className={`flex flex-1 w-full min-h-screen ${isDemoMode ? 'pt-[46px]' : ''} ${error ? 'pt-12' : ''}`}>
        {/* Sidebar */}
        <aside className="w-64 sidebar-surface p-4 flex flex-col min-h-screen">
          <div className="flex items-center gap-3 mb-8 px-2">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold text-white">RASI</span>
              <span className="text-xs text-blue-300 block">Synthetic HR</span>
            </div>
          </div>

          <nav className="flex-1 space-y-1" role="navigation" aria-label="Main navigation">
            {/* ── Workspace ── */}
            {[
              { id: 'getting-started', icon: Sparkles, label: 'Getting Started', badge: needsOnboarding ? 'Recommended' : null },
              { id: 'overview', icon: BarChart3, label: 'Overview' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => navigateTo(item.id)}
                className={cn('nav-item', currentPage === item.id && 'nav-item-active')}
                aria-current={currentPage === item.id ? 'page' : undefined}
                aria-label={item.label}
              >
                <item.icon className="w-5 h-5" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-left">{item.label}</span>
                {item.badge ? (
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25 font-semibold">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            ))}

            {/* ── Agents ── */}
            <div className="px-2 pt-4 pb-1.5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-medium">Agents</div>
            </div>
            {[
              { id: 'fleet', icon: Users, label: 'Fleet' },
              { id: 'templates', icon: Zap, label: 'Templates' },
              { id: 'agent-library', icon: Bot, label: 'Agent Library' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => navigateTo(item.id)}
                className={cn('nav-item', currentPage === item.id && 'nav-item-active')}
                aria-current={currentPage === item.id ? 'page' : undefined}
                aria-label={item.label}
              >
                <item.icon className="w-5 h-5" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-left">{item.label}</span>
              </button>
            ))}

            {/* ── Apps & Data ── */}
            <div className="px-2 pt-4 pb-1.5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-medium">Apps & Data</div>
            </div>
            {[
              { id: 'marketplace', icon: ShoppingBag, label: 'Apps', sublabel: 'Browse & install' },
              { id: 'integrations', icon: Link2, label: 'Connections', sublabel: 'Manage configured' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => navigateTo(item.id)}
                className={cn('nav-item', currentPage === item.id && 'nav-item-active')}
                aria-current={currentPage === item.id ? 'page' : undefined}
                aria-label={item.label}
              >
                <item.icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-left">
                  <span className="block text-[13px] leading-tight">{item.label}</span>
                  <span className="block text-[10px] text-slate-500 leading-tight mt-0.5">{item.sublabel}</span>
                </span>
              </button>
            ))}

            {/* ── Monitor ── */}
            <div className="px-2 pt-4 pb-1.5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-medium">Monitor</div>
            </div>
            {[
              { id: 'conversations', icon: MessageSquare, label: 'Conversations' },
              { id: 'incidents', icon: AlertTriangle, label: 'Incidents' },
              { id: 'costs', icon: DollarSign, label: 'Costs' },
              { id: 'model-comparison', icon: TrendingUp, label: 'Models' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => navigateTo(item.id)}
                className={cn('nav-item', currentPage === item.id && 'nav-item-active')}
                aria-current={currentPage === item.id ? 'page' : undefined}
                aria-label={item.label}
              >
                <item.icon className="w-5 h-5" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-left">{item.label}</span>
              </button>
            ))}

            {/* ── Configure ── */}
            <div className="px-2 pt-4 pb-1.5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-medium">Configure</div>
            </div>
            {[
              { id: 'api-access', icon: Key, label: 'API Access' },
              { id: 'settings', icon: Settings, label: 'Settings' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => navigateTo(item.id)}
                className={cn('nav-item', currentPage === item.id && 'nav-item-active')}
                aria-current={currentPage === item.id ? 'page' : undefined}
                aria-label={item.label}
              >
                <item.icon className="w-5 h-5" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-left">{item.label}</span>
              </button>
            ))}

            {/* ── Advanced Tools ── */}
            <div className="px-2 pt-4 pb-1.5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-medium">Advanced Tools</div>
            </div>
            {[
              { id: 'developer', icon: PlugZap, label: 'Developer' },
              { id: 'playbooks', icon: FileText, label: 'Playbooks' },
              { id: 'blackbox', icon: Database, label: 'Black Box' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => navigateTo(item.id)}
                className={cn('nav-item', currentPage === item.id && 'nav-item-active')}
                aria-current={currentPage === item.id ? 'page' : undefined}
                aria-label={item.label}
              >
                <item.icon className="w-5 h-5" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-left">{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="pt-4 border-t border-white/10">
            {/* Demo Mode Badge */}
            {isDemoMode && (
              <div className="flex items-center gap-2 px-2 mb-3">
                <span className="px-2 py-1 rounded text-xs bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-400 border border-purple-500/30 flex items-center gap-1">
                  <Play className="w-3 h-3" />
                  Demo Mode
                </span>
              </div>
            )}
            {/* Role Badge */}
            <div className="flex items-center gap-2 px-2 mb-4">
              <span className={`px-2 py-1 rounded text-xs ${role === 'super_admin' ? 'bg-purple-400/10 text-purple-400' :
                role === 'ops_manager' ? 'bg-blue-400/10 text-blue-400' :
                  'bg-slate-400/10 text-slate-400'
                }`}>
                {role === 'super_admin' ? 'Admin' : role === 'ops_manager' ? 'Manager' : 'Auditor'}
              </span>
            </div>

            <div className="flex items-center gap-3 px-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                <User className="w-4 h-4 text-slate-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user?.organizationName}</p>
                <p className="text-xs text-slate-400 truncate">{user?.email}</p>
              </div>
              {/* Notification Bell */}
              <button
                onClick={() => setShowNotificationPanel(!showNotificationPanel)}
                className="relative p-2 text-slate-400 hover:text-white transition-colors"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            </div>
            <button
              onClick={signOut}
              className="w-full flex items-center gap-3 px-4 py-2 text-slate-400 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </aside>

        {/* Notification Panel */}
        {showNotificationPanel && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShowNotificationPanel(false)} />
            <div className="relative w-96 h-full border-l border-white/10 bg-white/[0.03] backdrop-blur-xl p-6 overflow-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white">Notifications</h2>
                <button
                  onClick={() => setShowNotificationPanel(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {notifications.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No notifications</p>
              ) : (
                <>
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={markAllAsRead}
                      className="text-sm text-slate-300 hover:text-white transition-colors"
                    >
                      Mark all read
                    </button>
                    <span className="text-slate-600">|</span>
                    <button
                      onClick={clearNotifications}
                      className="text-sm text-red-400 hover:text-red-300"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="space-y-3">
                    {notifications.some((notification) => !notification.read) ? (
                      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200">
                        Unread items are pinned first. Critical reconciliation alerts stay above lower-severity updates.
                      </div>
                    ) : null}
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        onClick={() => void openCoverageFromNotification(notification)}
                        className={`p-4 rounded-lg border cursor-pointer transition-all ${notification.read
                          ? 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'
                          : 'bg-white/[0.06] border-white/15 hover:bg-white/[0.08]'
                          }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-2 h-2 rounded-full mt-2 ${notification.type === 'error' ? 'bg-red-400' :
                            notification.type === 'warning' ? 'bg-yellow-400' :
                              notification.type === 'success' ? 'bg-green-400' :
                                'bg-blue-400'
                            }`} />
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-white">{notification.title}</p>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                                notification.type === 'error'
                                  ? 'bg-rose-500/15 text-rose-200'
                                  : notification.type === 'warning'
                                    ? 'bg-amber-500/15 text-amber-100'
                                    : notification.type === 'info'
                                      ? 'bg-blue-500/15 text-blue-100'
                                      : 'bg-emerald-500/15 text-emerald-200'
                              }`}>
                                {notification.type}
                              </span>
                              <span className="rounded-full bg-slate-900/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                                {notification.source}
                              </span>
                            </div>
                            <p className="text-sm text-slate-400">{notification.message}</p>
                            <p className="text-xs text-slate-500 mt-2">
                              {new Date(notification.timestamp || Date.now()).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 p-8 overflow-auto">
          {loading ? (
            <DashboardSectionLoading />
          ) : (
            <Suspense fallback={<DashboardSectionLoading />}>
              {[
                'persona', 'shadow', 'api-analytics',
                'model-comparison', 'webhooks', 'batch',
                'fine-tuning', 'caching', 'pricing', 'legal'
              ].includes(currentPage) && (
	                  <div className="mb-6">
	                    <button
	                      onClick={() => navigateTo('settings')}
	                      className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
	                    >
	                      <ChevronLeft className="w-4 h-4" />
	                      Back to Settings
	                    </button>
	                  </div>
	                )}
              <ErrorBoundary key={currentPage} variant="local" fallbackMessage={`Failed to load the ${currentPage} page`}>
                <Routes>
                  <Route index element={<Navigate to="overview" replace />} />
                  <Route path="overview" element={
                    <DashboardOverview
                      agents={enrichedAgents}
                      incidents={incidents}
                      costData={costData}
                      onAddAgent={() => navigateTo('fleet')}
                      onNavigate={(page) => navigateTo(page)}
                    />
                  } />
                  <Route path="getting-started" element={
                    <GettingStartedPage
                      agents={enrichedAgents}
                      onNavigate={(page) => navigateTo(page)}
                      onRefresh={refreshData}
                      storageScope={onboardingStorageScope}
                    />
                  } />
                  <Route path="connect" element={
                    <ConnectAgentPage
                      agents={enrichedAgents}
                      onNavigate={(page) => navigateTo(page)}
                      onRefresh={refreshData}
                    />
                  } />
                  <Route path="fleet" element={
                    <FleetPage
                      agents={enrichedAgents}
                      setAgents={saveAgents}
                      selectedAgentId={fleetWorkspaceAgentId}
                      onSelectAgent={setFleetWorkspaceAgentId}
                      onPublishAgent={openIntegrationsForAgent}
                      onOpenOperationsPage={(page, options) => {
                        if (options?.agentId) writeFocusedAgentWorkspace(options.agentId);
                        navigateTo(page, { userInitiated: false });
                      }}
                    />
                  } />
                  <Route path="templates" element={
                    <AgentTemplatesPage onDeploy={async (template) => {
                      try {
                        const created = await api.agents.create({
                          name: template.name,
                          description: template.description,
                          agent_type: template.type,
                          platform: template.platform,
                          model_name: template.model,
                          budget_limit: template.budget,
                          config: {},
                        });
                        if (created.success && created.data) {
                          const newId = (created.data as any).id;
                          if (newId) {
                            const newAgent: AIAgent = {
                              id: newId,
                              name: template.name,
                              description: template.description,
                              agent_type: template.type,
                              platform: template.platform,
                              model_name: template.model,
                              status: (created.data as any).status || 'active',
                              lifecycle_state: 'idle',
                              risk_level: (created.data as any).risk_level || 'low',
                              risk_score: (created.data as any).risk_score || 50,
                              created_at: (created.data as any).created_at || new Date().toISOString(),
                              conversations: 0,
                              satisfaction: 0,
                              uptime: 100,
                              budget_limit: template.budget,
                              current_spend: 0,
                              auto_throttle: false,
                            };
                            if (isDemoMode) {
                              setDemoAgents(prev => [...prev, newAgent]);
                            } else {
                              void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
                            }
                            addNotification('success', 'Agent Added To Fleet', `${template.name} is now available for governance and monitoring`);
                            navigateTo('fleet', { userInitiated: false });
                          }
                        } else {
                          throw new Error('Agent creation rejected by server');
                        }
                      } catch (err) {
                        console.error('Template deploy error:', err);
                        setError('Failed to add agent from template.');
                      }
                    }} />
                  } />
                  <Route path="agent-library" element={
                    <DomainAgentLibraryPage
                      initialPackId={domainAgentPreselect?.packId}
                      initialAgentId={domainAgentPreselect?.agentId}
                      onNavigate={navigateTo}
                      onDeploy={async (agentData) => {
                        try {
                          const created = await api.agents.create({
                            name: agentData.name,
                            description: agentData.description,
                            agent_type: agentData.agent_type,
                            platform: agentData.platform,
                            model_name: agentData.model_name,
                            config: { ...agentData.config, system_prompt: agentData.system_prompt },
                          });
                          if (created.success && created.data) {
                            const d = created.data as any;
                            const newAgent: AIAgent = {
                              id: d.id,
                              name: agentData.name,
                              description: agentData.description,
                              agent_type: agentData.agent_type,
                              platform: agentData.platform,
                              model_name: agentData.model_name,
                              status: d.status || 'active',
                              lifecycle_state: 'idle',
                              risk_level: d.risk_level || 'low',
                              risk_score: d.risk_score || 50,
                              created_at: d.created_at || new Date().toISOString(),
                              conversations: 0,
                              satisfaction: 0,
                              uptime: 100,
                              budget_limit: d.budget_limit || 500,
                              current_spend: 0,
                              auto_throttle: false,
                            };
                            if (isDemoMode) {
                              setDemoAgents(prev => [...prev, newAgent]);
                            } else {
                              void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
                            }
                            addNotification('success', 'Domain Agent Deployed', `${agentData.name} has been added to your fleet.`);
                            setDomainAgentPreselect(null);
                            navigateTo('fleet', { userInitiated: false });
                          } else {
                            throw new Error('Agent creation rejected by server');
                          }
                        } catch (err) {
                          console.error('Domain agent deploy error:', err);
                          throw err;
                        }
                      }}
                    />
                  } />
                  <Route path="marketplace" element={<MarketplacePage onNavigate={navigateTo} agents={enrichedAgents} />} />
                  <Route path="integrations" element={
                    <IntegrationsPage
                      selectedAgent={enrichedAgents.find((a) => a.id === integrationAgentId) || enrichedAgents.find((a) => a.id === fleetWorkspaceAgentId) || null}
                      recommendedPackId={integrationRecommendedPack}
                      entryMode={integrationAgentId || fleetWorkspaceAgentId ? 'publish' : 'browse'}
                      onNavigate={navigateTo}
                      onActivateDomainAgent={(packId, agentId) => {
                        setDomainAgentPreselect({ packId, agentId });
                        navigateTo('agent-library', { userInitiated: false });
                      }}
                      onIntegrationConnected={handleIntegrationConnected}
                      onIntegrationDisconnected={() => { void refreshData(); }}
                    />
                  } />
                  <Route path="conversations" element={<ConversationsPage agents={enrichedAgents} onNavigate={navigateTo} initialAgentId={fleetWorkspaceAgentId} />} />
                  <Route path="incidents" element={<IncidentsPage incidents={incidents} setIncidents={saveIncidents} agents={enrichedAgents} onNavigate={navigateTo} />} />
                  <Route path="costs" element={<CostsPage costData={costData} setCostData={saveCostData} agents={enrichedAgents} incidents={incidents} onNavigate={navigateTo} />} />
                  <Route path="model-comparison" element={<ModelComparisonPage />} />
                  <Route path="api-access" element={<ApiKeysPage apiKeys={apiKeys} setApiKeys={saveApiKeys} initialView="keys" />} />
                  <Route path="settings" element={<SettingsPage onNavigate={navigateTo} isDemoMode={!!isDemoMode} />} />
                  <Route path="developer" element={<DeveloperPage onNavigate={navigateTo} />} />
                  <Route path="playbooks" element={<PlaybooksPage agents={enrichedAgents} onNavigate={(page) => navigateTo(page)} />} />
                  <Route path="blackbox" element={<BlackBoxPage incidents={incidents} onNavigate={navigateTo} />} />
                  <Route path="coverage" element={<CoverageStatusPage />} />
                  <Route path="jobs" element={<JobsInboxPage agents={agents} />} />
                  <Route path="work-items" element={<WorkItemsPage />} />
                  <Route path="action-policies" element={<ActionPoliciesPage />} />
                  {/* Settings sub-pages */}
                  <Route path="persona" element={<PersonaPage agents={enrichedAgents} initialAgentId={fleetWorkspaceAgentId} />} />
                  <Route path="shadow" element={<ShadowModePage />} />
                  <Route path="api-analytics" element={<ApiAnalyticsPage isDemoMode={!!isDemoMode} />} />
                  <Route path="webhooks" element={<WebhooksPage />} />
                  <Route path="batch" element={<BatchProcessingPage />} />
                  <Route path="fine-tuning" element={<ModelFineTuningPage />} />
                  <Route path="caching" element={<CachingPage />} />
                  <Route path="pricing" element={<PricingPage onNavigate={navigateTo} />} />
                  <Route path="legal" element={<SafeHarborPage onNavigate={navigateTo} userRole={role} />} />
                  <Route path="*" element={<Navigate to="overview" replace />} />
                </Routes>
              </ErrorBoundary>
	            </Suspense>
	          )}
	        </main>
      </div>
    </div>
  );
}
