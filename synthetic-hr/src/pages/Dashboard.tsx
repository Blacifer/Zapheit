import { useState, useEffect, lazy, Suspense, useCallback, useRef } from 'react';
import { useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  Brain, Bell, User, LogOut, BarChart3, Users, DollarSign, Settings, X,
  Layers, Sparkles, ChevronLeft, MessageSquare, AlertTriangle, Menu,
} from 'lucide-react';
import { AIAgent, Incident, CostData, ApiKey } from '../types';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api-client';
import { useAgents, useIncidents, useCostData, queryKeys } from '../hooks/useData';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { cn } from '../lib/utils';
import { CommandPalette } from '../components/CommandPalette';
import { Sidebar } from '../components/Sidebar';
import { guessPackForIntegration, type IntegrationPackId } from '../lib/integration-packs';
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from '../utils/storage';

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
const PersonaPage = lazy(() => import('./dashboard/PersonaPage'));
const CostsPage = lazy(() => import('./dashboard/CostsPage'));
const ShadowModePage = lazy(() => import('./dashboard/ShadowModePage'));
const BlackBoxPage = lazy(() => import('./dashboard/BlackBoxPage'));
const ApiKeysPage = lazy(() => import('./dashboard/ApiKeysPage'));
const PricingPage = lazy(() => import('./dashboard/PricingPage'));
const SafeHarborPage = lazy(() => import('./dashboard/SafeHarborPage'));
const SettingsPage = lazy(() => import('./dashboard/SettingsPage'));
const ApiAnalyticsPage = lazy(() => import('./dashboard/ApiAnalyticsPage'));
const WebhooksPage = lazy(() => import('./dashboard/WebhooksPage'));
const BatchProcessingPage = lazy(() => import('./dashboard/BatchProcessingPage'));
const ModelFineTuningPage = lazy(() => import('./dashboard/ModelFineTuningPage'));
const CachingPage = lazy(() => import('./dashboard/CachingPage'));
const ConversationsPage = lazy(() => import('./dashboard/ConversationsPage'));
const CoverageStatusPage = lazy(() => import('./dashboard/CoverageStatusPage'));
const DeveloperPage = lazy(() => import('./dashboard/DeveloperPage'));
const DomainAgentLibraryPage = lazy(() => import('./dashboard/DomainAgentLibraryPage'));
const ConnectorsPage = lazy(() => import('./dashboard/ConnectorsPage'));
const AppsPage = lazy(() => import('./dashboard/AppsPage'));
const MarketingHubPage = lazy(() => import('./dashboard/MarketingHubPage'));
const HRHubPage = lazy(() => import('./dashboard/HRHubPage'));
const RecruitmentHubPage = lazy(() => import('./dashboard/RecruitmentHubPage'));
const SupportHubPage = lazy(() => import('./dashboard/SupportHubPage'));
const SalesHubPage = lazy(() => import('./dashboard/SalesHubPage'));
const ITHubPage = lazy(() => import('./dashboard/ITHubPage'));
const FinanceHubPage = lazy(() => import('./dashboard/FinanceHubPage'));
const ComplianceHubPage = lazy(() => import('./dashboard/ComplianceHubPage'));
const IdentityHubPage = lazy(() => import('./dashboard/IdentityHubPage'));
const ApprovalsPage = lazy(() => import('./dashboard/ApprovalsPage'));
const AuditLogPage = lazy(() => import('./dashboard/AuditLogPage'));
const RuntimeWorkersPage = lazy(() => import('./dashboard/RuntimeWorkersPage'));

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
  const [domainAgentPreselect, setDomainAgentPreselect] = useState<{ packId: IntegrationPackId; agentId: string } | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const { user, signOut } = useApp();

  // Simple local state for notifications and role
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [role, setRole] = useState<string>('super_admin');
  const [coverageStatus, setCoverageStatus] = useState<CoverageNotificationPayload | null>(null);

  // Dark/Light mode toggle
  const themePrefKey = 'synthetic_hr_theme';
  const [isLightMode, setIsLightMode] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem(themePrefKey) === 'light'
  );
  useEffect(() => {
    document.documentElement.classList.toggle('light', isLightMode);
    localStorage.setItem(themePrefKey, isLightMode ? 'light' : 'dark');
  }, [isLightMode]);

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Setup progress bar
  const setupBarDismissKey = `synthetic_hr_setup_bar_dismissed:${user?.organizationName || 'workspace'}`;
  const [setupBarDismissed, setSetupBarDismissed] = useState(() =>
    typeof window !== 'undefined' ? Boolean(localStorage.getItem(setupBarDismissKey)) : false
  );
  const dismissSetupBar = useCallback(() => {
    localStorage.setItem(setupBarDismissKey, '1');
    setSetupBarDismissed(true);
  }, [setupBarDismissKey]);

  // "What changed since you left" banner — shown on first load after 24h+ absence
  const lastVisitKey = `synthetic_hr_last_visit:${user?.organizationName || 'workspace'}`;
  const [whatsNewDismissed, setWhatsNewDismissed] = useState(false);
  const [whatsNewData, setWhatsNewData] = useState<{
    newIncidents: number;
    openIncidents: number;
    agentCount: number;
    prevAgentCount: number;
    hoursAway: number;
  } | null>(null);

  // Record visit + compute delta on first data load
  useEffect(() => {
    if (loading || isDemoMode) return;
    const now = Date.now();
    const lastVisitStr = localStorage.getItem(lastVisitKey);
    const lastVisit = lastVisitStr ? parseInt(lastVisitStr, 10) : 0;
    const hoursAway = lastVisit ? (now - lastVisit) / 3600000 : 0;

    if (hoursAway > 24 && lastVisit) {
      // Count incidents created since last visit
      const newIncidents = incidents.filter((i: Incident) => new Date(i.created_at).getTime() > lastVisit).length;
      const openIncidents = incidents.filter((i: Incident) => i.status === 'open').length;
      const prevAgentCount = parseInt(localStorage.getItem(`${lastVisitKey}:agents`) || '0', 10);
      setWhatsNewData({ newIncidents, openIncidents, agentCount: agents.length, prevAgentCount, hoursAway: Math.round(hoursAway) });
    }

    // Update last visit timestamp
    localStorage.setItem(lastVisitKey, String(now));
    localStorage.setItem(`${lastVisitKey}:agents`, String(agents.length));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Memorable moments
  const orgScope = user?.organizationName || 'workspace';
  const [agentAliveData, setAgentAliveData] = useState<{ agentName: string; agentId: string } | null>(null);
  const [caughtSomethingData, setCaughtSomethingData] = useState<Incident | null>(null);

  // "Your Agent is Alive" — fires once per agent that reaches its first real conversation
  useEffect(() => {
    if (!agents.length) return;
    const seenKey = `${STORAGE_KEYS.AGENT_ALIVE_SEEN}:${orgScope}`;
    const seenIds = loadFromStorage<string[]>(seenKey, []);
    const firstLive = agents.find(
      (a) => a.conversations > 0 && !seenIds.includes(a.id),
    );
    if (firstLive) {
      setAgentAliveData({ agentName: firstLive.name, agentId: firstLive.id });
    }
  }, [agents, orgScope]);

  const dismissAgentAlive = useCallback(() => {
    if (!agentAliveData) return;
    const seenKey = `${STORAGE_KEYS.AGENT_ALIVE_SEEN}:${orgScope}`;
    const seenIds = loadFromStorage<string[]>(seenKey, []);
    saveToStorage(seenKey, [...seenIds, agentAliveData.agentId]);
    setAgentAliveData(null);
  }, [agentAliveData, orgScope]);

  // "We Caught Something" — fires once ever per org on first live-traffic incident
  useEffect(() => {
    if (!incidents.length) return;
    const seenKey = `${STORAGE_KEYS.CAUGHT_SOMETHING_SEEN}:${orgScope}`;
    const alreadySeen = loadFromStorage<boolean>(seenKey, false);
    if (alreadySeen) return;
    const firstReal = [...incidents]
      .sort((a: Incident, b: Incident) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .find((inc) => inc.source === 'live_traffic');
    if (firstReal) {
      setCaughtSomethingData(firstReal);
    }
  }, [incidents, orgScope]);

  const dismissCaughtSomething = useCallback((goToIncidents?: boolean) => {
    const seenKey = `${STORAGE_KEYS.CAUGHT_SOMETHING_SEEN}:${orgScope}`;
    saveToStorage(seenKey, true);
    setCaughtSomethingData(null);
    if (goToIncidents) navigate('/dashboard/incidents');
  }, [orgScope, navigate]);

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

  const openIntegrationsForAgent = useCallback((agent: AIAgent, _packId?: IntegrationPackId | null) => {
    setFleetWorkspaceAgentId(agent.id);
    writeFocusedAgentWorkspace(agent.id);
    navigateTo(`connectors?agentId=${agent.id}&tab=all`, { userInitiated: false });
  }, [navigateTo]);

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
        { id: '1', agent_id: '4', agent_name: 'Refund Handler', incident_type: 'refund_abuse', severity: 'critical', status: 'open', title: 'Unauthorized Refund Approved', description: 'Bot approved a refund request without proper verification', created_at: new Date().toISOString() },
        { id: '2', agent_id: '2', agent_name: 'Sales Assistant', incident_type: 'hallucination', severity: 'low', status: 'resolved', title: 'Incorrect Pricing Information', description: 'Bot provided wrong pricing for enterprise plan', resolved_at: new Date().toISOString(), created_at: new Date(Date.now() - 86400000).toISOString() },
        { id: '3', agent_id: '1', agent_name: 'Support Bot', incident_type: 'pii_leak', severity: 'high', status: 'open', title: 'Potential PII Exposure', description: 'Bot may have shared customer email in response', created_at: new Date(Date.now() - 172800000).toISOString() },
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
      {/* Command Palette — Cmd+K */}
      <CommandPalette onNavigate={navigateTo} agents={agents} />

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

      {/* Mobile top bar */}
      <div className={`md:hidden fixed left-0 right-0 z-40 flex items-center gap-3 px-4 py-3 sidebar-surface border-b border-white/10 ${isDemoMode ? 'top-[46px]' : error ? 'top-12' : 'top-0'}`}>
        <button onClick={() => setMobileNavOpen(true)} className="p-2 text-slate-400 hover:text-white transition-colors">
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-white" />
          <span className="font-bold text-white text-sm">RASI</span>
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {mobileNavOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileNavOpen(false)}
            />
            <motion.aside
              className="relative w-72 sidebar-surface flex flex-col min-h-screen overflow-y-auto"
              initial={{ x: -288 }}
              animate={{ x: 0 }}
              exit={{ x: -288 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                    <Brain className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <span className="text-base font-bold text-white leading-none">RASI</span>
                    <span className="text-[10px] text-blue-300 block leading-none mt-0.5">Synthetic HR</span>
                  </div>
                </div>
                <button onClick={() => setMobileNavOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Cmd+K */}
              <div className="px-3 pt-3 pb-1">
                <button
                  onClick={() => { setMobileNavOpen(false); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })); }}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-500 text-xs hover:border-slate-600 hover:text-slate-400 transition-colors"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 opacity-0 absolute" aria-hidden />
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  <span className="flex-1 text-left">Search...</span>
                  <kbd className="font-mono text-[10px] bg-slate-700/60 border border-slate-600/50 rounded px-1">⌘K</kbd>
                </button>
              </div>

              {/* Nav */}
              <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
                {needsOnboarding && (
                  <button onClick={() => { navigateTo('getting-started'); setMobileNavOpen(false); }} className={cn('nav-item', currentPage === 'getting-started' && 'nav-item-active')}>
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span className="flex-1 text-left text-sm">Getting Started</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25 font-semibold">New</span>
                  </button>
                )}
                {([
                  { id: 'overview', icon: BarChart3, label: 'Overview', badge: null as number | null },
                  { id: 'fleet', icon: Users, label: 'Fleet', badge: null },
                  { id: 'incidents', icon: AlertTriangle, label: 'Incidents', badge: incidents.filter(i => i.status !== 'resolved' && i.status !== 'false_positive').length || null },
                  { id: 'conversations', icon: MessageSquare, label: 'Conversations', badge: null },
                  { id: 'costs', icon: DollarSign, label: 'Costs', badge: null },
                  { id: 'apps', icon: Layers, label: 'Apps', badge: null },
                  { id: 'settings', icon: Settings, label: 'Settings', badge: null },
                ] as const).map((item) => (
                  <button key={item.id} onClick={() => { navigateTo(item.id); setMobileNavOpen(false); }} className={cn('nav-item', currentPage === item.id && 'nav-item-active')}>
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1 text-left text-sm">{item.label}</span>
                    {item.badge ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/25 font-semibold tabular-nums">{item.badge}</span> : null}
                  </button>
                ))}

                <div className="my-2 border-t border-white/[0.06]" />
                <p className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-[0.18em] text-slate-600 font-semibold">Build</p>
                {(['templates', 'agent-library', 'playbooks', 'action-policies'] as const).map((id) => {
                  const labels: Record<string, string> = { templates: 'Templates', 'agent-library': 'Agent Library', playbooks: 'Playbooks', 'action-policies': 'Action Policies' };
                  return (
                    <button key={id} onClick={() => { navigateTo(id); setMobileNavOpen(false); }} className={cn('nav-item', currentPage === id && 'nav-item-active')}>
                      <span className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left text-sm">{labels[id]}</span>
                    </button>
                  );
                })}

                <p className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-slate-600 font-semibold">Observe</p>
                {(['approvals', 'audit-log', 'api-access'] as const).map((id) => {
                  const labels: Record<string, string> = { approvals: 'Approvals', 'audit-log': 'Audit Log', 'api-access': 'API Access' };
                  return (
                    <button key={id} onClick={() => { navigateTo(id); setMobileNavOpen(false); }} className={cn('nav-item', currentPage === id && 'nav-item-active')}>
                      <span className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left text-sm">{labels[id]}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Footer */}
              <div className="px-4 py-4 border-t border-white/[0.06]">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                    <User className="w-3.5 h-3.5 text-slate-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{user?.organizationName}</p>
                    <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
                  </div>
                </div>
                <button onClick={signOut} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-400 hover:text-red-400 transition-colors rounded-lg hover:bg-white/[0.03]">
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <div className={`flex flex-1 w-full min-h-screen ${isDemoMode ? 'pt-[46px]' : ''} ${error ? 'pt-12' : ''} md:pt-0`}>
        {/* Sidebar — desktop only */}
        <Sidebar
          currentPage={currentPage}
          onNavigate={navigateTo}
          incidentBadge={incidents.filter(i => i.status !== 'resolved' && i.status !== 'false_positive').length}
          unreadCount={unreadCount}
          needsOnboarding={needsOnboarding}
          isDemoMode={isDemoMode}
          isLightMode={isLightMode}
          onToggleTheme={() => setIsLightMode((v: boolean) => !v)}
          onToggleNotifications={() => setShowNotificationPanel(!showNotificationPanel)}
          onSignOut={signOut}
          orgName={user?.organizationName}
          email={user?.email}
          role={role}
        />

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

        {/* "Your Agent is Alive" overlay — fires once per agent on first real conversation */}
        {agentAliveData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="relative mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-8 text-center shadow-2xl">
              {/* Pulsing alive dot */}
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
                <span className="h-4 w-4 animate-pulse rounded-full bg-emerald-400" />
              </div>
              <h2 className="mb-2 text-2xl font-bold text-white">Your agent is alive</h2>
              <p className="mb-1 text-sm text-slate-400">
                <span className="font-semibold text-slate-200">{agentAliveData.agentName}</span> just received its first real conversation.
              </p>
              <p className="mb-8 text-xs text-slate-500">The governance clock is running — costs, incidents, and policies are now active.</p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => { dismissAgentAlive(); navigateTo('conversations'); }}
                  className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
                >
                  View First Conversation
                </button>
                <button
                  onClick={dismissAgentAlive}
                  className="w-full rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* "We Caught Something" overlay — fires once ever per org on first live-traffic incident */}
        {caughtSomethingData && (
          <div
            className={`fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm ${
              ['critical', 'high'].includes(caughtSomethingData.severity?.toLowerCase() ?? '')
                ? 'bg-rose-950/80'
                : 'bg-orange-950/80'
            }`}
            style={{ animation: 'overlayIn 150ms ease-out' }}
          >
            <div className="relative mx-4 w-full max-w-lg rounded-2xl border border-rose-500/20 bg-slate-900 p-8 shadow-2xl">
              {/* Severity badge */}
              <div className="mb-5 flex items-center gap-2">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-rose-400">
                  {(caughtSomethingData.severity || 'high').toUpperCase()} · LIVE DETECTION
                </span>
              </div>
              <h2 className="mb-2 text-3xl font-bold text-rose-100">We caught something.</h2>
              <p className="mb-1 text-sm text-slate-300">
                <span className="font-semibold text-white">
                  {(caughtSomethingData.incident_type || 'Incident').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                </span>{' '}
                detected on{' '}
                <span className="font-semibold text-white">{caughtSomethingData.agent_name || 'an agent'}</span>.
              </p>
              {caughtSomethingData.description && (
                <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/30 px-4 py-3">
                  <p className="line-clamp-2 font-mono text-xs text-slate-400">{caughtSomethingData.description}</p>
                </div>
              )}
              <div className="mt-8 flex flex-col gap-3">
                <button
                  onClick={() => dismissCaughtSomething(true)}
                  className="w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-rose-500"
                >
                  Investigate Now →
                </button>
                <button
                  onClick={() => dismissCaughtSomething(false)}
                  className="w-full text-sm text-slate-500 transition hover:text-slate-300"
                >
                  Mark as false positive and dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-auto pt-[52px] md:pt-0">
          {/* Setup progress bar — slim sticky bar shown during onboarding */}
          {needsOnboarding && !setupBarDismissed && !isDemoMode && (() => {
            const steps = [
              true,                                                                                          // workspace ready
              (coverageStatus?.apiKeys?.total ?? 0) > 0,                                                   // api key created
              agents.length > 0,                                                                             // agent created
              integrationRows.some(r => r.status === 'connected' || r.lifecycleStatus === 'connected'),    // app connected
              coverageStatus?.telemetry?.gatewayObserved === true,                                         // test request sent
              coverageStatus?.telemetry?.gatewayObserved === true,                                         // coverage verified
            ];
            const done = steps.filter(Boolean).length;
            const total = steps.length;
            const pct = Math.round((done / total) * 100);
            return (
              <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-blue-500/15 bg-slate-950/90 px-6 py-2.5 backdrop-blur-sm">
                <span className="text-xs font-semibold text-blue-300 shrink-0">Setup {done}/{total}</span>
                <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden max-w-xs">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <button
                  onClick={() => navigateTo('getting-started')}
                  className="text-xs text-slate-300 hover:text-white transition-colors shrink-0"
                >
                  Continue setup →
                </button>
                <button onClick={dismissSetupBar} className="text-slate-500 hover:text-slate-300 transition-colors shrink-0 ml-1" aria-label="Dismiss">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })()}
          {/* "What changed since you left" banner */}
          {whatsNewData && !whatsNewDismissed && (
            <div className="flex items-start gap-4 border-b border-white/[0.06] bg-slate-900/60 px-6 py-3">
              <div className="mt-0.5 shrink-0 text-slate-400">
                <Bell className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-slate-200">
                  Welcome back — you were away {whatsNewData.hoursAway >= 48
                    ? `${Math.round(whatsNewData.hoursAway / 24)} days`
                    : `${whatsNewData.hoursAway}h`}.
                </span>
                <span className="ml-3 text-xs text-slate-400">
                  {whatsNewData.newIncidents > 0 && (
                    <span className="mr-3 text-rose-300">{whatsNewData.newIncidents} new incident{whatsNewData.newIncidents !== 1 ? 's' : ''}</span>
                  )}
                  {whatsNewData.openIncidents > 0 && (
                    <span className="mr-3">{whatsNewData.openIncidents} open</span>
                  )}
                  {whatsNewData.agentCount !== whatsNewData.prevAgentCount && whatsNewData.prevAgentCount > 0 && (
                    <span className="mr-3 text-emerald-300">
                      {whatsNewData.agentCount > whatsNewData.prevAgentCount
                        ? `+${whatsNewData.agentCount - whatsNewData.prevAgentCount} agent${whatsNewData.agentCount - whatsNewData.prevAgentCount !== 1 ? 's' : ''}`
                        : `${whatsNewData.agentCount - whatsNewData.prevAgentCount} agent${Math.abs(whatsNewData.agentCount - whatsNewData.prevAgentCount) !== 1 ? 's' : ''}`}
                    </span>
                  )}
                </span>
              </div>
              <button onClick={() => setWhatsNewDismissed(true)} className="text-slate-600 hover:text-slate-400 transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="p-8">
          {loading ? (
            <DashboardSectionLoading />
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={currentPage}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              >
            <Suspense fallback={<DashboardSectionLoading />}>
              {[
                'persona', 'shadow', 'api-analytics',
                'webhooks', 'batch',
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
                      isLoading={loading}
                      onOpenOperationsPage={(page, options) => {
                        if (options?.agentId) writeFocusedAgentWorkspace(options.agentId);
                        navigateTo(page, { userInitiated: false });
                      }}
                    />
                  } />
                  <Route path="templates" element={
                    <AgentTemplatesPage
                      onDeploy={async (template) => {
                      const TEMPLATE_TYPE_TO_PACK: Record<string, string> = {
                        // Support
                        customer_support: 'support',
                        customer_success: 'support',
                        call_center: 'support',
                        healthcare: 'support',
                        // Sales
                        sales: 'sales',
                        marketing: 'sales',
                        // Recruitment
                        hr: 'recruitment',
                        recruiting: 'recruitment',
                        onboarding: 'recruitment',
                        learning: 'recruitment',
                        // Compliance
                        legal: 'compliance',
                        compliance: 'compliance',
                        security: 'compliance',
                        security_ops: 'compliance',
                        // Finance
                        finance: 'finance',
                        procurement: 'finance',
                        logistics: 'finance',
                        refund: 'finance',
                        payroll: 'finance',
                        // IT
                        it_support: 'it',
                        devops: 'it',
                        data_analyst: 'it',
                        data_analysis: 'it',
                        engineering: 'it',
                        qa: 'it',
                        documentation: 'it',
                        facilities: 'it',
                      };
                      try {
                        const created = await api.agents.create({
                          name: template.name,
                          description: template.description,
                          agent_type: template.type,
                          platform: template.platform,
                          model_name: template.model,
                          budget_limit: template.budget,
                          primary_pack: TEMPLATE_TYPE_TO_PACK[template.type] || null,
                          integration_ids: (template as any).integration_ids || [],
                          config: { system_prompt: (template as any).system_prompt || '' },
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
                            primary_pack: (agentData as any).primary_pack || null,
                            integration_ids: (agentData as any).integration_ids || [],
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
                  <Route path="connectors" element={<ConnectorsPage onNavigate={navigateTo} agents={enrichedAgents} />} />
                  <Route path="apps" element={<AppsPage onNavigate={navigateTo} />} />
                  <Route path="marketing-hub" element={<MarketingHubPage />} />
                  <Route path="hr-hub" element={<HRHubPage />} />
                  <Route path="recruitment" element={<RecruitmentHubPage />} />
                  <Route path="support-hub" element={<SupportHubPage />} />
                  <Route path="sales-hub" element={<SalesHubPage />} />
                  <Route path="it-hub" element={<ITHubPage />} />
                  <Route path="finance-hub" element={<FinanceHubPage />} />
                  <Route path="compliance-hub" element={<ComplianceHubPage />} />
                  <Route path="identity-hub" element={<IdentityHubPage />} />
                  <Route path="marketplace" element={<Navigate to="/dashboard/apps" replace />} />
                  <Route path="integrations" element={<Navigate to="/dashboard/apps" replace />} />
                  <Route path="conversations" element={<ConversationsPage agents={enrichedAgents} onNavigate={navigateTo} initialAgentId={fleetWorkspaceAgentId} />} />
                  <Route path="incidents" element={<IncidentsPage incidents={incidents} setIncidents={saveIncidents} agents={enrichedAgents} onNavigate={navigateTo} isLoading={loading} />} />
                  <Route path="approvals" element={<ApprovalsPage />} />
                  <Route path="costs" element={<CostsPage agents={enrichedAgents} incidents={incidents} onNavigate={navigateTo} />} />
                  <Route path="api-access" element={<ApiKeysPage apiKeys={apiKeys} setApiKeys={saveApiKeys} initialView="keys" />} />
                  <Route path="settings" element={<SettingsPage onNavigate={navigateTo} isDemoMode={!!isDemoMode} />} />
                  <Route path="developer" element={<DeveloperPage onNavigate={navigateTo} />} />
                  <Route path="playbooks" element={<PlaybooksPage agents={enrichedAgents} onNavigate={(page) => navigateTo(page)} />} />
                  <Route path="blackbox" element={<BlackBoxPage incidents={incidents} onNavigate={navigateTo} />} />
                  <Route path="runtime-workers" element={<RuntimeWorkersPage />} />
                  <Route path="audit-log" element={<AuditLogPage />} />
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
              </motion.div>
            </AnimatePresence>
	          )}
          </div>
	        </main>
      </div>
    </div>
  );
}
