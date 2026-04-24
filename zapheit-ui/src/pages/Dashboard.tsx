import { useState, useEffect, lazy, Suspense, useCallback, useRef } from 'react';
import { useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  Brain, Bell, User, LogOut, BarChart3, Users, DollarSign, Settings, X,
  Sparkles, ChevronLeft, MessageSquare, AlertTriangle, Menu, Building2,
} from 'lucide-react';
import { AIAgent, Incident, CostData, ApiKey } from '../types';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api-client';
import { useAgents, useIncidents, useIncidentStream, useCostData, queryKeys } from '../hooks/useData';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SectionErrorBoundary } from '../components/SectionErrorBoundary';
import { cn } from '../lib/utils';
import { CommandPalette } from '../components/CommandPalette';
import { Sidebar } from '../components/Sidebar';
import { DEMO_AGENTS, DEMO_INTEGRATIONS, DEMO_AGENT_CONNECTIONS, DEMO_INCIDENTS, DEMO_COST_DATA, DEMO_NOTIFICATIONS, DEMO_API_KEYS } from '../lib/demo-fixtures';
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from '../utils/storage';
import { OnboardingTour } from '../components/OnboardingTour';
import { useDashboardNotifications, readNotificationState, buildCoverageNotifications } from '../hooks/useDashboardNotifications';
import { useDashboardAgentConnections, writeFocusedAgentWorkspace } from '../hooks/useDashboardAgentConnections';
import { useDashboardSetup } from '../hooks/useDashboardSetup';
import type { AgentTemplate } from '../config/agentTemplates';

import { MfaNudgeBanner } from '../components/MfaNudgeBanner';
const DashboardOverview = lazy(() => import('./dashboard/DashboardOverview'));
const GettingStartedPage = lazy(() => import('./dashboard/GettingStartedPage'));
const ConnectAgentPage = lazy(() => import('./dashboard/ConnectAgentPage'));
const FleetPage = lazy(() => import('./dashboard/FleetPage'));
const WorkItemsPage = lazy(() => import('./dashboard/WorkItemsPage'));
const ActionPoliciesPage = lazy(() => import('./dashboard/ActionPoliciesPage'));
const IncidentsPage = lazy(() => import('./dashboard/IncidentsPage'));
const PersonaPage = lazy(() => import('./dashboard/PersonaPage'));
const CostsPage = lazy(() => import('./dashboard/CostsPage'));
const UsagePage = lazy(() => import('./dashboard/UsagePage'));
const ShadowModePage = lazy(() => import('./dashboard/ShadowModePage'));
const BlackBoxPage = lazy(() => import('./dashboard/BlackBoxPage'));
const PricingPage = lazy(() => import('./dashboard/PricingPage'));
const ROIPage = lazy(() => import('./dashboard/ROIPage'));
const BillingSuccessPage = lazy(() => import('./dashboard/BillingSuccessPage'));
const SafeHarborPage = lazy(() => import('./dashboard/SafeHarborPage'));
const SettingsPage = lazy(() => import('./dashboard/SettingsPage'));
const ApiAnalyticsPage = lazy(() => import('./dashboard/ApiAnalyticsPage'));
const ConversationsPage = lazy(() => import('./dashboard/ConversationsPage'));
const CoverageStatusPage = lazy(() => import('./dashboard/CoverageStatusPage'));
const DeveloperPage = lazy(() => import('./dashboard/DeveloperPage'));
const AppsPage = lazy(() => import('./dashboard/apps'));
const ApprovalsPage = lazy(() => import('./dashboard/ApprovalsPage'));
const GovernedActionsPage = lazy(() => import('./dashboard/GovernedActionsPage'));
const AuditLogPage = lazy(() => import('./dashboard/AuditLogPage'));
const CTCCalculatorPage = lazy(() => import('./dashboard/CTCCalculatorPage'));
const HubsPage = lazy(() => import('./dashboard/hubs/HubsPage'));
const AgentStudioPage = lazy(() => import('./dashboard/AgentStudioPage'));
const PlatformPage = lazy(() => import('./dashboard/PlatformPage'));
const ApiWebhooksPage = lazy(() => import('./dashboard/ApiWebhooksPage'));
const ExecutionHistoryPage = lazy(() => import('./dashboard/ExecutionHistoryPage'));
const SlackWorkspace = lazy(() => import('./dashboard/apps/workspaces/slack/SlackWorkspace'));
const JiraWorkspace = lazy(() => import('./dashboard/apps/workspaces/jira/JiraWorkspace'));
const GitHubWorkspace = lazy(() => import('./dashboard/apps/workspaces/github/GitHubWorkspace'));
const HubSpotWorkspace = lazy(() => import('./dashboard/apps/workspaces/hubspot/HubSpotWorkspace'));
const QuickBooksWorkspace = lazy(() => import('./dashboard/apps/workspaces/quickbooks/QuickBooksWorkspace'));
const GoogleWorkspace = lazy(() => import('./dashboard/apps/workspaces/google-workspace/GoogleWorkspace'));
const Microsoft365Workspace = lazy(() => import('./dashboard/apps/workspaces/microsoft-365/Microsoft365'));
const ZohoWorkspace = lazy(() => import('./dashboard/apps/workspaces/zoho/ZohoWorkspace'));
const NotionWorkspace = lazy(() => import('./dashboard/apps/workspaces/notion/NotionWorkspace'));
const WhatsAppWorkspace = lazy(() => import('./dashboard/apps/workspaces/whatsapp/WhatsAppWorkspace'));
const LinkedInWorkspace = lazy(() => import('./dashboard/apps/workspaces/linkedin/LinkedInWorkspace'));
const RecruitmentWorkspace = lazy(() => import('./dashboard/apps/workspaces/recruitment/RecruitmentWorkspace'));

interface DashboardProps {
  isDemoMode?: boolean;
  onSignUp?: () => void;
}

type DeployableTemplate = AgentTemplate & { system_prompt?: string; integration_ids?: string[] };

function DashboardSectionLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/15 border-t-blue-300"></div>
    </div>
  );
}

function areAgentWritableFieldsEqual(left: AIAgent, right: AIAgent) {
  const leftPrompt = String((left as any).system_prompt || '');
  const rightPrompt = String((right as any).system_prompt || '');
  const leftConfig = JSON.stringify((left as any).config || {});
  const rightConfig = JSON.stringify((right as any).config || {});

  return (
    left.name === right.name &&
    (left.description || '') === (right.description || '') &&
    left.status === right.status &&
    left.model_name === right.model_name &&
    leftPrompt === rightPrompt &&
    leftConfig === rightConfig
  );
}

export default function Dashboard({ isDemoMode, onSignUp }: DashboardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  // Derive current page from URL path and normalize old route names.
  const rawCurrentPage = location.pathname.replace(/^\/dashboard\/?/, '').split('/')[0] || 'overview';
  const currentPage = rawCurrentPage === 'fleet'
    ? 'agents'
    : rawCurrentPage === 'conversations'
      ? 'chat'
      : rawCurrentPage;
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
  useIncidentStream({ enabled: !isDemoMode });
  const { costData: liveCostData } = useCostData('30d', { enabled: !isDemoMode });

  // Unified data — demo or live
  const agents = isDemoMode ? demoAgents : liveAgents;
  const incidents = isDemoMode ? demoIncidents : liveIncidents;
  const costData = isDemoMode ? demoCostData : liveCostData;
  const loading = isDemoMode ? demoLoading : agentsLoading;

  const { user, signOut } = useApp();

  // navigateTo must be declared before hooks that accept it as a parameter
  const hasUserNavigatedRef = useRef(false);
  const hasAutoRedirectedRef = useRef(false);

  const navigateTo = useCallback((page: string, options?: { userInitiated?: boolean }) => {
    const userInitiated = options?.userInitiated ?? true;
    const normalizedPage = page === 'fleet' ? 'agents' : page;
    if (userInitiated) {
      hasUserNavigatedRef.current = true;
    }
    navigate(`/dashboard/${normalizedPage}`);
  }, [navigate]);

  // ── Custom hooks ─────────────────────────────────────────────────────────
  const {
    notifications, setNotifications,
    showNotificationPanel, setShowNotificationPanel,
    coverageStatus, setCoverageStatus,
    unreadCount,
    addNotification, markAsRead, markAllAsRead, clearNotifications, openCoverageFromNotification,
  } = useDashboardNotifications({ orgName: user?.organizationName, navigateTo });

  const {
    agentConnections, setAgentConnections,
    integrationRows, setIntegrationRows,
    fleetWorkspaceAgentId, setFleetWorkspaceAgentId,
    domainAgentPreselect, setDomainAgentPreselect,
    apiKeys, setApiKeys,
    suggestPackForAgent, openIntegrationsForAgent, handleIntegrationConnected,
    enrichedAgents,
  } = useDashboardAgentConnections({
    orgName: user?.organizationName,
    agents, liveAgents, isDemoMode: !!isDemoMode, mounted, navigateTo,
  });

  const { setupBarDismissed, whatsNewDismissed, setWhatsNewDismissed, whatsNewData, needsOnboarding, dismissSetupBar } =
    useDashboardSetup({ orgName: user?.organizationName, isDemoMode: !!isDemoMode, agents, incidents, loading, coverageStatus });

  const [role, setRole] = useState<string>('super_admin');

  // Dark/Light mode toggle
  const themePrefKey = 'synthetic_hr_theme';
  const [isLightMode, setIsLightMode] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem(themePrefKey) === 'light'
  );
  useEffect(() => {
    document.documentElement.classList.toggle('light', isLightMode);
    localStorage.setItem(themePrefKey, isLightMode ? 'light' : 'dark');
  }, [isLightMode]);

  // Show technical terms toggle (for power users)
  const techTermsKey = 'zapheit_tech_terms';
  const [showTechTerms, setShowTechTerms] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem(techTermsKey) === 'true'
  );
  useEffect(() => {
    localStorage.setItem(techTermsKey, showTechTerms ? 'true' : 'false');
  }, [showTechTerms]);

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  const [error, setError] = useState<string | null>(null);

  const createAgentFromTemplate = useCallback(async (template: DeployableTemplate) => {
    const TEMPLATE_TYPE_TO_PACK: Record<string, string> = {
      customer_support: 'support', customer_success: 'support', call_center: 'support', healthcare: 'support',
      sales: 'sales', marketing: 'sales',
      hr: 'recruitment', recruiting: 'recruitment', onboarding: 'recruitment', learning: 'recruitment',
      legal: 'compliance', compliance: 'compliance', security: 'compliance', security_ops: 'compliance',
      finance: 'finance', procurement: 'finance', logistics: 'finance', refund: 'finance', payroll: 'finance',
      it_support: 'it', devops: 'it', data_analyst: 'it', data_analysis: 'it', engineering: 'it', qa: 'it', documentation: 'it', facilities: 'it',
    };
    const primaryPack = TEMPLATE_TYPE_TO_PACK[template.type];
    const created = await api.agents.create({
      name: template.name, description: template.description, agent_type: template.type,
      platform: template.platform, model_name: template.model, budget_limit: template.budget,
      ...(primaryPack ? { primary_pack: primaryPack } : {}),
      integration_ids: template.integration_ids || [],
      system_prompt: template.system_prompt || '', config: {},
    });
    if (!created.success || !created.data) {
      throw new Error(created.error || created.errors?.join(', ') || 'Agent creation rejected by server');
    }

    const newId = (created.data as any).id;
    if (!newId) {
      throw new Error('Agent creation did not return an id');
    }

    const newAgent: AIAgent = {
      id: newId, name: template.name, description: template.description,
      agent_type: template.type, platform: template.platform, model_name: template.model,
      status: (created.data as any).status || 'active', lifecycle_state: 'idle',
      risk_level: (created.data as any).risk_level || 'low', risk_score: (created.data as any).risk_score || 50,
      created_at: (created.data as any).created_at || new Date().toISOString(),
      conversations: 0, satisfaction: 0, uptime: 100, budget_limit: template.budget, current_spend: 0, auto_throttle: false,
    };

    if (isDemoMode) {
      setDemoAgents(prev => [...prev, newAgent]);
    } else {
      queryClient.setQueryData<AIAgent[]>(queryKeys.agents, (current) => {
        if (!Array.isArray(current)) return [newAgent];
        if (current.some((agent) => agent.id === newAgent.id)) return current;
        return [newAgent, ...current];
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
    }

    return { agentId: newId };
  }, [isDemoMode, queryClient]);

  const handleTemplateDeploy = useCallback(async (template: DeployableTemplate) => {
    try {
      await createAgentFromTemplate(template);
      addNotification('success', 'Agent Added To Fleet', `${template.name} is now available for governance and monitoring`);
      navigateTo('agents', { userInitiated: false });
    } catch (err) {
      console.error('Template deploy error:', err);
      setError(err instanceof Error ? err.message : 'Failed to add agent from template.');
      throw err;
    }
  }, [addNotification, createAgentFromTemplate, navigateTo, setError]);

  const handleTemplateLaunchInChat = useCallback(async (template: DeployableTemplate) => {
    try {
      const { agentId } = await createAgentFromTemplate(template);
      saveToStorage(STORAGE_KEYS.TEMPLATE_CHAT_CONTEXT, {
        agentId,
        templateId: template.id,
        prompt: template.samplePrompts?.[0] || `Help me get ${template.name} ready for live governed work.`,
        mode: 'operator',
      });
      addNotification('success', 'Template Ready In Chat', `${template.name} is deployed and ready for a governed operator run.`);
      navigateTo('chat', { userInitiated: false });
    } catch (err) {
      console.error('Template launch in chat error:', err);
      setError(err instanceof Error ? err.message : 'Failed to launch template in chat.');
      throw err;
    }
  }, [addNotification, createAgentFromTemplate, navigateTo, setError]);

  const handleLibraryAgentDeploy = useCallback(async (agentData: any) => {
    try {
      const created = await api.agents.create({
        name: agentData.name, description: agentData.description, agent_type: agentData.agent_type,
        platform: agentData.platform, model_name: agentData.model_name,
        ...((agentData as any).primary_pack ? { primary_pack: (agentData as any).primary_pack } : {}),
        integration_ids: (agentData as any).integration_ids || [],
        config: { ...agentData.config, system_prompt: agentData.system_prompt },
      });
      if (created.success && created.data) {
        const d = created.data as any;
        const newAgent: AIAgent = {
          id: d.id, name: agentData.name, description: agentData.description,
          agent_type: agentData.agent_type, platform: agentData.platform, model_name: agentData.model_name,
          status: d.status || 'active', lifecycle_state: 'idle',
          risk_level: d.risk_level || 'low', risk_score: d.risk_score || 50,
          created_at: d.created_at || new Date().toISOString(),
          conversations: 0, satisfaction: 0, uptime: 100, budget_limit: d.budget_limit || 500, current_spend: 0, auto_throttle: false,
        };
        if (isDemoMode) { setDemoAgents(prev => [...prev, newAgent]); }
        else { void queryClient.invalidateQueries({ queryKey: queryKeys.agents }); }
        addNotification('success', 'Domain Agent Deployed', `${agentData.name} has been added to your fleet.`);
        setDomainAgentPreselect(null);
        navigateTo('agents', { userInitiated: false });
      } else {
        throw new Error(created.error || created.errors?.join(', ') || 'Agent creation rejected by server');
      }
    } catch (err) { console.error('Domain agent deploy error:', err); throw err; }
  }, [isDemoMode, queryClient, navigateTo, addNotification]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshData = useCallback(async () => {
    // Demo mode: populate local demo state directly
    if (isDemoMode) {
      setDemoLoading(true);
      setIntegrationRows(DEMO_INTEGRATIONS);
      setAgentConnections(DEMO_AGENT_CONNECTIONS);
      setDemoAgents(DEMO_AGENTS);
      setDemoIncidents(DEMO_INCIDENTS);
      setDemoCostData(DEMO_COST_DATA);
      setNotifications(DEMO_NOTIFICATIONS);
      setApiKeys(DEMO_API_KEYS);
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

  const hasPriorityOverlay = Boolean(caughtSomethingData || agentAliveData);
  const showSetupProgress = Boolean(needsOnboarding && !setupBarDismissed && !isDemoMode && !hasPriorityOverlay);
  const showWhatsNewBanner = Boolean(whatsNewData && !whatsNewDismissed && !showSetupProgress && !hasPriorityOverlay);

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
          if (areAgentWritableFieldsEqual(existing, agent)) {
            continue;
          }

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

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="min-h-screen app-bg flex items-center justify-center text-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-white/15 border-t-blue-300"></div>
      </div>
    );
  }

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

      <OnboardingTour />

      {/* Mobile top bar */}
      <div className={`md:hidden fixed left-0 right-0 z-40 flex items-center gap-3 px-4 py-3 sidebar-surface border-b border-white/10 ${isDemoMode ? 'top-[46px]' : error ? 'top-12' : 'top-0'}`}>
        <button onClick={() => setMobileNavOpen(true)} className="p-2 text-slate-400 hover:text-white transition-colors">
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-white" />
          <span className="font-bold text-white text-sm">Zapheit</span>
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
                    <span className="text-base font-bold text-white leading-none">Zapheit</span>
                    <span className="text-[10px] text-blue-300 block leading-none mt-0.5">AI Workforce Manager</span>
                  </div>
                </div>
                <button onClick={() => setMobileNavOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Cmd+K */}
              <div className="px-3 pt-3 pb-1">
                <button
                  onClick={() => {
                    setMobileNavOpen(false);
                    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
                    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: isMac, ctrlKey: !isMac, bubbles: true }));
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-500 text-xs hover:border-slate-600 hover:text-slate-400 transition-colors"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  <span className="flex-1 text-left">Search...</span>
                  <kbd className="font-mono text-[10px] bg-slate-700/60 border border-slate-600/50 rounded px-1">{/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? '⌘K' : 'Ctrl+K'}</kbd>
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
                  { id: 'agents', icon: Users, label: 'Agents', badge: null },
                  { id: 'apps', icon: Building2, label: 'Apps', badge: null },
                  { id: 'chat', icon: MessageSquare, label: 'Chat', badge: null },
                  { id: 'agent-studio', icon: Sparkles, label: 'Create an Assistant', badge: null },
                  { id: 'action-policies', icon: Sparkles, label: 'Rules', badge: null },
                  { id: 'approvals', icon: Sparkles, label: 'Human Review', badge: null },
                  { id: 'incidents', icon: AlertTriangle, label: 'Safety Alerts', badge: incidents.filter(i => i.status !== 'resolved' && i.status !== 'false_positive' && i.source !== 'manual_test').length || null },
                  { id: 'audit-log', icon: Sparkles, label: 'Activity History', badge: null },
                  { id: 'costs', icon: DollarSign, label: 'Usage & Spending', badge: null },
                ] as const).map((item) => (
                  <button key={item.id} data-tour={item.id} onClick={() => { navigateTo(item.id); setMobileNavOpen(false); }} className={cn('nav-item', currentPage === item.id && 'nav-item-active')}>
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1 text-left text-sm">{item.label}</span>
                    {item.badge ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/25 font-semibold tabular-nums">{item.badge}</span> : null}
                  </button>
                ))}

                <div className="my-2 border-t border-white/[0.06]" />
                <p className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-[0.18em] text-slate-600 font-semibold">Business Workspaces</p>
                {(['hubs', 'governed-actions', 'work-items', 'coverage', 'ctc-calculator', 'blackbox'] as const).map((id) => {
                  const labels: Record<string, string> = { hubs: 'Hubs', 'governed-actions': 'Governed Actions', 'work-items': 'Work Items', coverage: 'Coverage', 'ctc-calculator': 'CTC Calculator', blackbox: 'Black Box' };
                  return (
                    <button key={id} data-tour={id} onClick={() => { navigateTo(id); setMobileNavOpen(false); }} className={cn('nav-item', currentPage === id && 'nav-item-active')}>
                      <span className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left text-sm">{labels[id]}</span>
                    </button>
                  );
                })}

                <div className="my-2 border-t border-white/[0.06]" />
                <p className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-[0.18em] text-slate-600 font-semibold">Admin & Developer</p>
                {(['settings', 'api-webhooks', 'developer', 'execution-history', 'platform'] as const).map((id) => {
                  const labels: Record<string, string> = { settings: 'Settings', 'api-webhooks': 'API & Webhooks', developer: 'Developer', 'execution-history': 'Execution History', platform: 'Platform' };
                  return (
                    <button key={id} data-tour={id} onClick={() => { navigateTo(id); setMobileNavOpen(false); }} className={cn('nav-item', currentPage === id && 'nav-item-active')}>
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

      <div className={cn(
        'flex flex-1 w-full min-h-screen md:pt-0',
        isDemoMode && error ? 'pt-[94px]' :
        isDemoMode ? 'pt-[46px]' :
        error ? 'pt-12' :
        undefined,
      )}>
        {/* Sidebar — desktop only */}
        <Sidebar
          currentPage={currentPage}
          onNavigate={navigateTo}
          incidentBadge={incidents.filter(i => i.status !== 'resolved' && i.status !== 'false_positive' && i.source !== 'manual_test').length}
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
          showTechTerms={showTechTerms}
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
        {agentAliveData && !caughtSomethingData && (
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
                  onClick={() => { dismissAgentAlive(); navigateTo('chat'); }}
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
          {showSetupProgress && (() => {
            const steps = [
              true,                                                                                          // workspace checked
              agents.length > 0,                                                                             // agent created
              integrationRows.some(r => r.status === 'connected' || r.lifecycleStatus === 'connected'),    // app connected
              coverageStatus?.telemetry?.gatewayObserved === true,                                         // test request sent
              coverageStatus?.telemetry?.gatewayObserved === true,                                         // insight confirmed
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
          {showWhatsNewBanner && whatsNewData && (
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
          <MfaNudgeBanner user={user} onNavigateToSecurity={() => navigateTo('settings/security')} />
          <div className="p-4 sm:p-8">
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
                'pricing', 'legal'
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
                    <SectionErrorBoundary fallbackMessage="Overview failed to load">
                      <DashboardOverview
                        agents={enrichedAgents}
                        incidents={incidents}
                        costData={costData}
                        onAddAgent={() => navigateTo('agents')}
                        onNavigate={(page) => navigateTo(page)}
                      />
                    </SectionErrorBoundary>
                  } />
                  <Route path="getting-started" element={
                    <SectionErrorBoundary fallbackMessage="Getting started failed to load">
                      <GettingStartedPage
                        agents={enrichedAgents}
                        onNavigate={(page) => navigateTo(page)}
                        onRefresh={refreshData}
                        storageScope={user?.organizationName || 'workspace'}
                      />
                    </SectionErrorBoundary>
                  } />
                  <Route path="connect" element={
                    <SectionErrorBoundary fallbackMessage="Connect agent failed to load">
                      <ConnectAgentPage
                        agents={enrichedAgents}
                        onNavigate={(page) => navigateTo(page)}
                        onRefresh={refreshData}
                      />
                    </SectionErrorBoundary>
                  } />
                  <Route path="agents" element={
                    <SectionErrorBoundary fallbackMessage="Fleet failed to load">
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
                    </SectionErrorBoundary>
                  } />
                  <Route path="fleet" element={<Navigate to="/dashboard/agents" replace />} />
                  {/* Agent Studio — consolidates Templates + Agent Library + Playbooks */}
                  <Route path="agent-studio" element={
                    <SectionErrorBoundary fallbackMessage="Agent Studio failed to load">
                      <AgentStudioPage
                        onDeployTemplate={handleTemplateDeploy}
                        onLaunchTemplateChat={handleTemplateLaunchInChat}
                        onDeployLibraryAgent={handleLibraryAgentDeploy}
                        agents={enrichedAgents}
                        onNavigate={navigateTo}
                        initialPackId={domainAgentPreselect?.packId}
                        initialAgentId={domainAgentPreselect?.agentId}
                      />
                    </SectionErrorBoundary>
                  } />
                  <Route path="templates" element={<Navigate to="/dashboard/agent-studio?tab=templates" replace />} />
                  <Route path="agent-library" element={<Navigate to="/dashboard/agent-studio?tab=library" replace />} />
                  <Route path="playbooks" element={<Navigate to="/dashboard/agent-studio?tab=playbooks" replace />} />
                  <Route path="connectors" element={<Navigate to="/dashboard/apps" replace />} />
                  <Route path="apps" element={
                    <SectionErrorBoundary fallbackMessage="Apps failed to load">
                      <AppsPage onNavigate={navigateTo} agents={enrichedAgents} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="apps/slack/workspace" element={<SectionErrorBoundary fallbackMessage="Slack workspace failed to load"><SlackWorkspace /></SectionErrorBoundary>} />
                  <Route path="apps/jira/workspace" element={<SectionErrorBoundary fallbackMessage="Jira workspace failed to load"><JiraWorkspace /></SectionErrorBoundary>} />
                  <Route path="apps/github/workspace" element={<SectionErrorBoundary fallbackMessage="GitHub workspace failed to load"><GitHubWorkspace /></SectionErrorBoundary>} />
                  <Route path="apps/hubspot/workspace" element={<SectionErrorBoundary fallbackMessage="HubSpot workspace failed to load"><HubSpotWorkspace /></SectionErrorBoundary>} />
                  <Route path="apps/quickbooks/workspace" element={<SectionErrorBoundary fallbackMessage="QuickBooks workspace failed to load"><QuickBooksWorkspace /></SectionErrorBoundary>} />
                  <Route path="apps/google-workspace/workspace" element={<SectionErrorBoundary fallbackMessage="Google Workspace failed to load"><GoogleWorkspace /></SectionErrorBoundary>} />
                  <Route path="apps/microsoft-365/workspace" element={<SectionErrorBoundary fallbackMessage="Microsoft 365 failed to load"><Microsoft365Workspace /></SectionErrorBoundary>} />
                  <Route path="apps/zoho/workspace" element={<SectionErrorBoundary fallbackMessage="Zoho People workspace failed to load"><ZohoWorkspace /></SectionErrorBoundary>} />
                  <Route path="apps/notion/workspace" element={<SectionErrorBoundary fallbackMessage="Notion workspace failed to load"><NotionWorkspace /></SectionErrorBoundary>} />
                  <Route path="apps/whatsapp/workspace" element={<SectionErrorBoundary fallbackMessage="WhatsApp workspace failed to load"><WhatsAppWorkspace /></SectionErrorBoundary>} />
                  <Route path="apps/linkedin/workspace" element={<SectionErrorBoundary fallbackMessage="LinkedIn workspace failed to load"><LinkedInWorkspace /></SectionErrorBoundary>} />
                  <Route path="apps/workspaces/recruitment" element={<SectionErrorBoundary fallbackMessage="Recruitment workspace failed to load"><RecruitmentWorkspace /></SectionErrorBoundary>} />
                  {/* Unified Hubs Page — replaces individual hub pages */}
                  <Route path="hubs" element={
                    <SectionErrorBoundary fallbackMessage="Hubs failed to load">
                      <HubsPage />
                    </SectionErrorBoundary>
                  } />
                  <Route path="marketing-hub" element={<Navigate to="/dashboard/hubs?domain=marketing" replace />} />
                  <Route path="hr-hub" element={<Navigate to="/dashboard/hubs?domain=hr" replace />} />
                  <Route path="recruitment" element={<Navigate to="/dashboard/hubs?domain=recruitment" replace />} />
                  <Route path="support-hub" element={<Navigate to="/dashboard/hubs?domain=support" replace />} />
                  <Route path="sales-hub" element={<Navigate to="/dashboard/hubs?domain=sales" replace />} />
                  <Route path="it-hub" element={<Navigate to="/dashboard/hubs?domain=it" replace />} />
                  <Route path="finance-hub" element={<Navigate to="/dashboard/hubs?domain=finance" replace />} />
                  <Route path="compliance-hub" element={<Navigate to="/dashboard/hubs?domain=compliance" replace />} />
                  <Route path="identity-hub" element={<Navigate to="/dashboard/hubs?domain=identity" replace />} />
                  <Route path="marketplace" element={<Navigate to="/dashboard/apps" replace />} />
                  <Route path="integrations" element={<Navigate to="/dashboard/apps" replace />} />
                  <Route path="chat" element={
                    <SectionErrorBoundary fallbackMessage="Governed chat failed to load">
                      <ConversationsPage agents={enrichedAgents} onNavigate={navigateTo} initialAgentId={fleetWorkspaceAgentId} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="conversations" element={<Navigate to="/dashboard/chat" replace />} />
                  <Route path="incidents" element={
                    <SectionErrorBoundary fallbackMessage="Incidents failed to load">
                      <IncidentsPage incidents={incidents} setIncidents={saveIncidents} agents={enrichedAgents} onNavigate={navigateTo} isLoading={loading} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="governed-actions" element={
                    <SectionErrorBoundary fallbackMessage="Governed actions failed to load">
                      <GovernedActionsPage onNavigate={navigateTo} currentUserId={user?.id} currentRole={role} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="approvals" element={
                    <SectionErrorBoundary fallbackMessage="Approvals failed to load">
                      <ApprovalsPage />
                    </SectionErrorBoundary>
                  } />
                  <Route path="costs" element={
                    <SectionErrorBoundary fallbackMessage="Cost analytics failed to load">
                      <CostsPage agents={enrichedAgents} incidents={incidents} onNavigate={navigateTo} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="usage" element={
                    <SectionErrorBoundary fallbackMessage="Usage page failed to load">
                      <UsagePage onNavigate={navigateTo} />
                    </SectionErrorBoundary>
                  } />
                  {/* API & Webhooks — consolidated */}
                  <Route path="api-webhooks" element={
                    <SectionErrorBoundary fallbackMessage="API & Webhooks failed to load">
                      <ApiWebhooksPage apiKeys={apiKeys} setApiKeys={saveApiKeys} onNavigate={navigateTo} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="api-access" element={<Navigate to="/dashboard/api-webhooks?tab=keys" replace />} />
                  <Route path="webhooks" element={<Navigate to="/dashboard/api-webhooks?tab=webhooks" replace />} />
                  <Route path="settings/*" element={
                    <SectionErrorBoundary fallbackMessage="Settings failed to load">
                      <SettingsPage onNavigate={navigateTo} isDemoMode={!!isDemoMode} isLightMode={isLightMode} onToggleTheme={() => setIsLightMode((v: boolean) => !v)} showTechTerms={showTechTerms} onToggleTechTerms={() => setShowTechTerms((v: boolean) => !v)} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="developer" element={
                    <SectionErrorBoundary fallbackMessage="Developer tools failed to load">
                      <DeveloperPage onNavigate={navigateTo} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="blackbox" element={
                    <SectionErrorBoundary fallbackMessage="Black-box replay failed to load">
                      <BlackBoxPage incidents={incidents} onNavigate={navigateTo} />
                    </SectionErrorBoundary>
                  } />
                  {/* Execution History — consolidated Run History + Traces */}
                  <Route path="execution-history" element={
                    <SectionErrorBoundary fallbackMessage="Execution history failed to load">
                      <ExecutionHistoryPage agents={enrichedAgents} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="jobs" element={<Navigate to="/dashboard/execution-history?tab=runs" replace />} />
                  <Route path="traces" element={<Navigate to="/dashboard/execution-history?tab=traces" replace />} />
                  {/* Platform — consolidated Models + Fine-tuning + Runtime + Caching + Batch */}
                  <Route path="platform" element={
                    <SectionErrorBoundary fallbackMessage="Platform settings failed to load">
                      <PlatformPage />
                    </SectionErrorBoundary>
                  } />
                  <Route path="runtime-workers" element={<Navigate to="/dashboard/platform?tab=runtime" replace />} />
                  <Route path="models" element={<Navigate to="/dashboard/platform?tab=models" replace />} />
                  <Route path="fine-tuning" element={<Navigate to="/dashboard/platform?tab=fine-tuning" replace />} />
                  <Route path="caching" element={<Navigate to="/dashboard/platform?tab=caching" replace />} />
                  <Route path="batch" element={<Navigate to="/dashboard/platform?tab=batch" replace />} />
                  <Route path="audit-log" element={
                    <SectionErrorBoundary fallbackMessage="Audit log failed to load">
                      <AuditLogPage />
                    </SectionErrorBoundary>
                  } />
                  <Route path="coverage" element={
                    <SectionErrorBoundary fallbackMessage="Coverage status failed to load">
                      <CoverageStatusPage />
                    </SectionErrorBoundary>
                  } />
                  <Route path="work-items" element={
                    <SectionErrorBoundary fallbackMessage="Work items failed to load">
                      <WorkItemsPage />
                    </SectionErrorBoundary>
                  } />
                  <Route path="action-policies" element={
                    <SectionErrorBoundary fallbackMessage="Action policies failed to load">
                      <ActionPoliciesPage />
                    </SectionErrorBoundary>
                  } />
                  <Route path="ctc-calculator" element={
                    <SectionErrorBoundary fallbackMessage="CTC calculator failed to load">
                      <CTCCalculatorPage />
                    </SectionErrorBoundary>
                  } />
                  {/* Settings sub-pages */}
                  <Route path="persona" element={
                    <SectionErrorBoundary fallbackMessage="Persona page failed to load">
                      <PersonaPage agents={enrichedAgents} initialAgentId={fleetWorkspaceAgentId} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="shadow" element={
                    <SectionErrorBoundary fallbackMessage="Shadow mode failed to load">
                      <ShadowModePage />
                    </SectionErrorBoundary>
                  } />
                  <Route path="api-analytics" element={
                    <SectionErrorBoundary fallbackMessage="API analytics failed to load">
                      <ApiAnalyticsPage isDemoMode={!!isDemoMode} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="pricing" element={
                    <SectionErrorBoundary fallbackMessage="Pricing failed to load">
                      <PricingPage onNavigate={navigateTo} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="legal" element={
                    <SectionErrorBoundary fallbackMessage="Legal page failed to load">
                      <SafeHarborPage onNavigate={navigateTo} userRole={role} />
                    </SectionErrorBoundary>
                  } />
                  <Route path="roi" element={
                    <SectionErrorBoundary fallbackMessage="ROI dashboard failed to load">
                      <ROIPage />
                    </SectionErrorBoundary>
                  } />
                  <Route path="billing/success" element={
                    <SectionErrorBoundary fallbackMessage="Billing confirmation failed to load">
                      <BillingSuccessPage onNavigate={navigateTo} />
                    </SectionErrorBoundary>
                  } />
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
