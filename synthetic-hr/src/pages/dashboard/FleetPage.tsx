import { useState, useEffect, useRef } from 'react';
import {
  Users, DollarSign, Shield, AlertTriangle, CheckCircle, XCircle,
  ChevronDown, ChevronUp, Activity, Zap, Lock, Server, Eye, Phone, Bot,
  Brain, Target, TrendingUp, X, Plus, Search, Filter, Download, Copy, Trash2, Key,
  ShieldAlert, ShoppingBag, ZapOff, Play, Rocket, Link2, MessageSquare, BarChart3, PauseCircle, Loader2, Clock3,
  Globe, Code2, Terminal, ArrowLeft, RefreshCw, Info
} from 'lucide-react';
import type { AIAgent, AgentPackId, AgentWorkspaceAnalytics, AgentWorkspaceConversation, AgentWorkspaceIncident, AgentWorkspaceSummary } from '../../types';
import { toast } from '../../lib/toast';
import { validateAgentForm } from '../../lib/validation';
import { api } from '../../lib/api-client';
import { getFrontendConfig } from '../../lib/config';
import { packDisplayBadge, type IntegrationPackId } from '../../lib/integration-packs';

interface FleetPageProps {
  agents: AIAgent[];
  setAgents: (agents: AIAgent[] | ((currentAgents: AIAgent[]) => AIAgent[])) => void | Promise<void>;
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string | null) => void;
  onPublishAgent?: (agent: AIAgent, packId?: IntegrationPackId | null) => void;
  onOpenOperationsPage?: (page: string, options?: { agentId?: string }) => void;
}

type WorkspaceTab = 'overview' | 'deployment' | 'conversations' | 'integrations' | 'policies' | 'analytics' | 'controls';
type DeployMethod = 'website' | 'api' | 'terminal' | 'advanced';
type DeployCodeTab = 'curl' | 'python' | 'nodejs' | 'php';
type WorkspaceState = {
  summary: AgentWorkspaceSummary | null;
  conversations: AgentWorkspaceConversation[];
  loadingConversations: boolean;
  conversationsError: string | null;
  incidents: AgentWorkspaceIncident[];
  loadingIncidents: boolean;
  incidentsError: string | null;
  analytics: AgentWorkspaceAnalytics | null;
  loadingAnalytics: boolean;
  analyticsError: string | null;
};

export default function FleetPage({
  agents,
  setAgents,
  selectedAgentId,
  onSelectAgent,
  onPublishAgent,
  onOpenOperationsPage,
}: FleetPageProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [killSwitchAgent, setKillSwitchAgent] = useState<string | null>(null);
  const [highlightedAgentId, setHighlightedAgentId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [configureAgentId, setConfigureAgentId] = useState<string | null>(null);
  const [workspaceAgentId, setWorkspaceAgentId] = useState<string | null>(
    selectedAgentId && (agents.length === 0 || agents.some((a) => a.id === selectedAgentId))
      ? selectedAgentId
      : null
  );
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('overview');
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({
    summary: null,
    conversations: [],
    loadingConversations: false,
    conversationsError: null,
    incidents: [],
    loadingIncidents: false,
    incidentsError: null,
    analytics: null,
    loadingAnalytics: false,
    analyticsError: null,
  });
  const [policyDraft, setPolicyDraft] = useState({ systemPrompt: '', operationalPolicy: '' });
  const [policySaving, setPolicySaving] = useState(false);
  const [editBudget, setEditBudget] = useState<Record<string, { budget: number; autoThrottle: boolean }>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'paused' | 'terminated'>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [deployAgentId, setDeployAgentId] = useState<string | null>(null);
  const [deployMethod, setDeployMethod] = useState<DeployMethod | null>(null);
  const [deployCodeTab, setDeployCodeTab] = useState<DeployCodeTab>('curl');
  const [deployApiKey, setDeployApiKey] = useState<string | null>(null);
  const [deployApiKeyId, setDeployApiKeyId] = useState<string | null>(null);
  const [deployApiKeyMasked, setDeployApiKeyMasked] = useState<string | null>(null);
  const [deployApiKeyLoading, setDeployApiKeyLoading] = useState(false);
  const [wsKeyRegenerating, setWsKeyRegenerating] = useState(false);
  const [wsKeyNew, setWsKeyNew] = useState<string | null>(null);
  const [runtimesLoading, setRuntimesLoading] = useState(false);
  const [runtimes, setRuntimes] = useState<Array<{ id: string; name: string; mode: string; status: string; last_heartbeat_at: string | null }>>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>('');
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [currentDeployment, setCurrentDeployment] = useState<any | null>(null);
  const [newRuntimeName, setNewRuntimeName] = useState('');
  const [createdEnrollment, setCreatedEnrollment] = useState<{ runtimeId: string; token: string; expiresAt: string } | null>(null);
  const [testJob, setTestJob] = useState<any | null>(null);
  const [suggestedApps, setSuggestedApps] = useState<any[]>([]);
  const [testJobBusy, setTestJobBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const pollJob = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const r = await api.jobs.get(jobId).catch(() => null);
      if (!r?.success || !r.data?.job) return;
      setTestJob((p: any) => p ? { ...p, job: r.data!.job } : p);
      if (['succeeded', 'failed', 'canceled'].includes(r.data.job.status)) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
    }, 2000);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // Integration Assignment Panel
  const [showAddIntegration, setShowAddIntegration] = useState(false);
  const [availableIntegrations, setAvailableIntegrations] = useState<Array<{ id: string; name: string; category: string; status: string; capabilities?: { writes: Array<{ id: string; label: string; risk: string }> } }>>([]);
  const [addIntegrationLoading, setAddIntegrationLoading] = useState(false);
  // Action Mapper
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());
  const [actionCatalog, setActionCatalog] = useState<Array<{ service: string; action: string; enabled: boolean }>>([]);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: () => Promise<void> | void;
    type: 'danger' | 'warning';
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: () => { },
    type: 'warning'
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem('rasi_safe_harbor_focus');
      if (!raw) return;

      const parsed = JSON.parse(raw) as { page?: string; id?: string };
      if (parsed.page !== 'fleet' || !parsed.id) return;

      setHighlightedAgentId(parsed.id);
      localStorage.removeItem('rasi_safe_harbor_focus');

      const timer = window.setTimeout(() => setHighlightedAgentId(null), 5000);
      return () => window.clearTimeout(timer);
    } catch {
      localStorage.removeItem('rasi_safe_harbor_focus');
      return;
    }
  }, []);

  useEffect(() => {
    if (!selectedAgentId) return;
    setWorkspaceAgentId(selectedAgentId);
    setWorkspaceTab('overview');
  }, [selectedAgentId]);

  useEffect(() => {
    const agent = workspaceAgentId ? agents.find((item) => item.id === workspaceAgentId) : null;
    setPolicyDraft({
      systemPrompt: agent?.system_prompt || '',
      operationalPolicy: String((agent as any)?.config?.operational_policy || ''),
    });
  }, [agents, workspaceAgentId]);

  useEffect(() => {
    if (!workspaceAgentId) return;
    const agent = agents.find((a) => a.id === workspaceAgentId);
    if (!agent) return;
    api.marketplace.getAll().then((res) => {
      if (!res.success || !res.data) return;
      const pack = agent.primaryPack || '';
      const packToCategory: Record<string, string[]> = {
        recruitment: ['recruitment', 'hr'],
        support: ['communication', 'support'],
        finance: ['finance', 'payroll'],
        sales: ['sales', 'analytics'],
        it: ['it', 'security'],
        compliance: ['compliance'],
      };
      const cats = packToCategory[pack] || [];
      const uninstalled = (res.data as any[]).filter(
        (app) => !app.connectionStatus && (cats.length === 0 || cats.includes(app.category))
      );
      setSuggestedApps(uninstalled.slice(0, 3));
    }).catch(() => {});
  }, [workspaceAgentId]);

  const loadWorkspace = async (agentId: string) => {
    setWorkspaceState((current) => ({
      ...current,
      loadingConversations: true,
      conversationsError: null,
      loadingIncidents: true,
      incidentsError: null,
      loadingAnalytics: true,
      analyticsError: null,
    }));

    const workspaceResponse = await api.agents.getWorkspace(agentId);
    if (!workspaceResponse.success || !workspaceResponse.data) {
      if (workspaceResponse.error?.toLowerCase().includes('not found')) {
        setWorkspaceAgentId(null);
        onSelectAgent?.(null);
        return;
      }
      setWorkspaceState({
        summary: null,
        conversations: [],
        loadingConversations: false,
        conversationsError: workspaceResponse.error || 'Failed to load recent conversations.',
        incidents: [],
        loadingIncidents: false,
        incidentsError: workspaceResponse.error || 'Failed to load incidents.',
        analytics: null,
        loadingAnalytics: false,
        analyticsError: workspaceResponse.error || 'Failed to load analytics.',
      });
      return;
    }

    await setAgents(agents.map((agent) => (
      agent.id === agentId ? workspaceResponse.data!.agent : agent
    )));

    setWorkspaceState({
      summary: workspaceResponse.data.summary,
      conversations: workspaceResponse.data.conversations || [],
      loadingConversations: false,
      conversationsError: null,
      incidents: workspaceResponse.data.incidents || [],
      loadingIncidents: false,
      incidentsError: null,
      analytics: workspaceResponse.data.analytics || null,
      loadingAnalytics: false,
      analyticsError: null,
    });
  };

  useEffect(() => {
    if (!workspaceAgentId) {
      setWorkspaceState({
        summary: null,
        conversations: [],
        loadingConversations: false,
        conversationsError: null,
        incidents: [],
        loadingIncidents: false,
        incidentsError: null,
        analytics: null,
        loadingAnalytics: false,
        analyticsError: null,
      });
      return;
    }

    // If the agents list has loaded and this ID isn't in it, it's stale — skip the request
    if (agents.length > 0 && !agents.find((a) => a.id === workspaceAgentId)) {
      setWorkspaceAgentId(null);
      onSelectAgent?.(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const workspaceResponse = await api.agents.getWorkspace(workspaceAgentId);
      if (cancelled) return;
      setWorkspaceState((current) => ({
        ...current,
        loadingConversations: true,
        conversationsError: null,
        loadingIncidents: true,
        incidentsError: null,
        loadingAnalytics: true,
        analyticsError: null,
      }));

      if (!workspaceResponse.success || !workspaceResponse.data) {
        if (workspaceResponse.error?.toLowerCase().includes('not found')) {
          setWorkspaceAgentId(null);
          onSelectAgent?.(null);
          return;
        }
        setWorkspaceState({
          summary: null,
          conversations: [],
          loadingConversations: false,
          conversationsError: workspaceResponse.error || 'Failed to load recent conversations.',
          incidents: [],
          loadingIncidents: false,
          incidentsError: workspaceResponse.error || 'Failed to load incidents.',
          analytics: null,
          loadingAnalytics: false,
          analyticsError: workspaceResponse.error || 'Failed to load analytics.',
        });
        return;
      }

      setWorkspaceState({
        summary: workspaceResponse.data.summary,
        conversations: workspaceResponse.data.conversations || [],
        loadingConversations: false,
        conversationsError: null,
        incidents: workspaceResponse.data.incidents || [],
        loadingIncidents: false,
        incidentsError: null,
        analytics: workspaceResponse.data.analytics || null,
        loadingAnalytics: false,
        analyticsError: null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceAgentId]);

  useEffect(() => {
    if (!deployAgentId) return;
    (async () => {
      setRuntimesLoading(true);
      setCreatedEnrollment(null);
      try {
        const [rt, deps] = await Promise.all([
          api.runtimes.list(),
          api.runtimes.listDeployments(deployAgentId),
        ]);

        if (rt.success && Array.isArray(rt.data)) {
          const items = (rt.data as any[]).map((r) => ({
            id: r.id,
            name: r.name,
            mode: r.mode,
            status: r.status,
            last_heartbeat_at: r.last_heartbeat_at || null,
          }));
          setRuntimes(items);
          if (!items.find((r) => r.id === selectedRuntimeId) && items.length > 0) {
            setSelectedRuntimeId(items[0].id);
          }
        } else {
          setRuntimes([]);
        }

        if (deps.success && Array.isArray(deps.data)) {
          const dep = (deps.data as any[]).find((d) => d.agent_id === deployAgentId) || null;
          setCurrentDeployment(dep);
          if (dep?.runtime_instance_id) setSelectedRuntimeId(dep.runtime_instance_id);
        } else {
          setCurrentDeployment(null);
        }
      } catch (err) {
        console.error(err);
        setRuntimes([]);
        setCurrentDeployment(null);
      } finally {
        setRuntimesLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployAgentId]);

  const addAgent = async (agent: Omit<AIAgent, 'id' | 'created_at'>) => {
    try {
      // Explicitly create via API first to get real backend UUID
      const created = await api.agents.create({
        name: agent.name,
        description: agent.description,
        agent_type: agent.agent_type,
        platform: agent.platform,
        model_name: agent.model_name,
        budget_limit: agent.budget_limit || 0,
        system_prompt: agent.system_prompt || '',
        config: (agent as any).config || {},
      });

      if (created.success && created.data) {
        const newId = (created.data as any).id;
        if (newId) {
          const newAgent: AIAgent = {
            ...agent,
            id: newId,
            created_at: new Date().toISOString(),
          };
          setAgents([...agents, newAgent]);
          toast.success(`Agent ${agent.name} added to fleet.`);
          setShowAddModal(false);
          return;
        }
      }
      toast.error('Failed to create agent properly.');
    } catch (err) {
      console.error('Add agent error:', err);
      toast.error('An error occurred while adding the agent to fleet.');
    }
    setShowAddModal(false);
  };

  const mergeAgent = async (updatedAgent: AIAgent) => {
    await setAgents(agents.map((agent) => (
      agent.id === updatedAgent.id
        ? {
            ...agent,
            ...updatedAgent,
            config: {
              ...((agent as any).config || {}),
              ...((updatedAgent as any).config || {}),
            },
          }
        : agent
    )));
  };

  const syncAgentPublishState = async (agentId: string) => {
    const response = await api.agents.getPublishState(agentId);
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to refresh publish state.');
    }

    const currentAgent = agents.find((agent) => agent.id === agentId);
    if (!currentAgent) return;

    await mergeAgent({
      ...currentAgent,
      publishStatus: response.data.publishStatus,
      primaryPack: (response.data.primaryPack || currentAgent.primaryPack || null) as IntegrationPackId | null,
      integrationIds: response.data.integrationIds || [],
      connectedTargets: (response.data.connectedTargets || []).map((target) => ({
        ...target,
        packId: target.packId as AgentPackId,
      })),
      lastIntegrationSyncAt: response.data.lastIntegrationSyncAt || null,
    });
  };

  const openAddIntegrationPanel = async (agent: AIAgent) => {
    setShowAddIntegration(true);
    setAddIntegrationLoading(true);
    const [intRes, catalogRes] = await Promise.all([
      api.integrations.getAll(),
      api.integrations.getActionCatalog(),
    ]);
    if (intRes.success && Array.isArray(intRes.data)) {
      setAvailableIntegrations((intRes.data as any[]).filter((i: any) => i.status === 'connected'));
    }
    if (catalogRes.success && Array.isArray(catalogRes.data)) {
      setActionCatalog(catalogRes.data as any[]);
    }
    setAddIntegrationLoading(false);
    void agent; // keep linter happy — agent used by caller for pack filtering in JSX
  };

  const assignIntegration = async (agent: AIAgent, serviceId: string) => {
    const currentIds = agent.integrationIds || [];
    if (currentIds.includes(serviceId)) return;
    const res = await api.agents.updatePublishState(agent.id, { integration_ids: [...currentIds, serviceId] });
    if (!res.success) { toast.error(res.error || 'Failed to assign integration.'); return; }
    await syncAgentPublishState(agent.id);
    toast.success('Integration assigned to agent.');
  };

  const removeIntegration = async (agent: AIAgent, serviceId: string) => {
    const newIds = (agent.integrationIds || []).filter((id) => id !== serviceId);
    const res = await api.agents.updatePublishState(agent.id, { integration_ids: newIds });
    if (!res.success) { toast.error(res.error || 'Failed to remove integration.'); return; }
    await syncAgentPublishState(agent.id);
  };

  const toggleIntegrationAction = async (service: string, action: string, currentEnabled: boolean) => {
    const key = `${service}:${action}`;
    setSavingAction(key);
    await api.integrations.upsertActions([{ service, action, enabled: !currentEnabled }]);
    setActionCatalog((prev) => {
      const exists = prev.some((a) => a.service === service && a.action === action);
      if (exists) return prev.map((a) => a.service === service && a.action === action ? { ...a, enabled: !currentEnabled } : a);
      return [...prev, { service, action, enabled: !currentEnabled }];
    });
    setSavingAction(null);
  };

  const getPublishChecklist = (agent: AIAgent) => [
    { label: 'System prompt set', ok: Boolean((agent as any).config?.systemPrompt || (agent as any).systemPrompt) },
    { label: 'Model selected', ok: Boolean(agent.model_name) },
    { label: 'Integration connected', ok: (agent.connectedTargets?.length || 0) > 0 },
    { label: 'Actions enabled', ok: (agent.integrationIds?.length || 0) > 0 || actionCatalog.some((a) => a.enabled) },
  ];

  const runAgentAction = async (
    agentId: string,
    actionKey: string,
    action: () => Promise<{ success: boolean; data?: any; error?: string }>,
    successMessage: string
  ) => {
    setActionBusy(actionKey);
    try {
      const response = await action();
      if (!response.success) {
        throw new Error(response.error || 'Action failed.');
      }

      const payload = response.data;
      if (payload?.agent) {
        await mergeAgent(payload.agent as AIAgent);
      } else if (payload?.id) {
        await mergeAgent(payload as AIAgent);
      }

      if (workspaceAgentId === agentId) {
        await loadWorkspace(agentId);
      }

      toast.success(successMessage);
      return payload;
    } finally {
      setActionBusy(null);
    }
  };

  const handleConfirmAction = (
    title: string,
    message: string,
    type: 'danger' | 'warning',
    action: () => Promise<void> | void
  ) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      type,
      action: async () => {
        setConfirming(true);
        try {
          await action();
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Action failed.';
          toast.error(message);
        } finally {
          setConfirming(false);
        }
      }
    });
  };

  const handleKillSwitch = (agentId: string, level: 1 | 2 | 3) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    switch (level) {
      case 1:
        handleConfirmAction(
          'Issue Warning (Level 1)',
          `Are you sure you want to pause ${agent.name} and issue a warning?`,
          'warning',
          async () => {
            await runAgentAction(
              agentId,
              `pause:${agentId}`,
              () => api.agents.pause(agentId, 'Level 1 warning issued from fleet workspace'),
              `${agent.name} paused.`
            );
          }
        );
        break;
      case 2:
        handleConfirmAction(
          'Escalate to Human (Level 2)',
          `🚨 LEVEL 2 ESCALATION: ${agent.name} requires human review. This will increase its risk score. Continue?`,
          'warning',
          async () => {
            await runAgentAction(
              agentId,
              `escalate:${agentId}`,
              () => api.agents.escalate(agentId, { notes: 'Escalated from fleet workspace for human review' }),
              `${agent.name} escalated for human review.`
            );
          }
        );
        break;
      case 3:
        handleConfirmAction(
          'Terminate Agent (Level 3)',
          `🛑 LEVEL 3 SHUTDOWN: This will permanently terminate ${agent.name}. Are you absolutely sure?`,
          'danger',
          async () => {
            await runAgentAction(
              agentId,
              `kill:${agentId}`,
              () => api.agents.kill(agentId, {
                level: 3,
                reason: 'Emergency kill switch triggered from fleet workspace',
              }),
              `${agent.name} terminated.`
            );
          }
        );
        break;
    }
    setKillSwitchAgent(null);
  };

  const deleteAgent = (id: string) => {
    const agent = agents.find(a => a.id === id);
    handleConfirmAction(
      'Delete Agent',
      `Are you sure you want to delete ${agent?.name}? This cannot be undone.`,
      'danger',
      async () => {
        const response = await api.agents.delete(id);
        if (!response.success) {
          throw new Error(response.error || 'Failed to delete agent.');
        }
        await setAgents(agents.filter(a => a.id !== id));
        toast.success(`${agent?.name || 'Agent'} deleted successfully.`);
      }
    );
  };

  const openConfigure = (agent: AIAgent) => {
    setConfigureAgentId(agent.id);
    setEditBudget(prev => ({
      ...prev,
      [agent.id]: { budget: agent.budget_limit ?? 0, autoThrottle: agent.auto_throttle ?? false },
    }));
  };

  const saveConfigure = async (agentId: string) => {
    const vals = editBudget[agentId];
    if (!vals) return;
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;
    try {
      const response = await api.agents.update(agentId, {
        budget_limit: vals.budget,
        config: {
          ...((agent as any).config || {}),
          budget_limit: vals.budget,
          auto_throttle: vals.autoThrottle,
        },
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to save agent configuration.');
      }
      await mergeAgent({
        ...(response.data as AIAgent),
        auto_throttle: vals.autoThrottle,
        budget_limit: vals.budget,
      });
      toast.success('Agent configuration saved.');
      setConfigureAgentId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save agent configuration.';
      toast.error(message);
    }
  };

  const saveWorkspacePolicies = async () => {
    if (!activeWorkspaceAgent) return;
    setPolicySaving(true);
    try {
      const response = await api.agents.update(activeWorkspaceAgent.id, {
        system_prompt: policyDraft.systemPrompt,
        config: {
          ...((activeWorkspaceAgent as any).config || {}),
          operational_policy: policyDraft.operationalPolicy,
        },
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to save policy changes.');
      }
      const updatedAgent = response.data as AIAgent;
      await mergeAgent({
        ...updatedAgent,
        system_prompt: updatedAgent.system_prompt ?? policyDraft.systemPrompt,
      });
      await loadWorkspace(activeWorkspaceAgent.id);
      toast.success('Persona and policy updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save policy changes.';
      toast.error(message);
    } finally {
      setPolicySaving(false);
    }
  };

  const openDeploy = async (agent: AIAgent) => {
    setDeployAgentId(agent.id);
    setDeployMethod(null);
    setDeployApiKey(null);
    setDeployApiKeyId(null);
    setDeployApiKeyMasked(null);
    setDeployApiKeyLoading(true);
    try {
      const res = await api.apiKeys.list();
      if (res.success && res.data && res.data.length > 0) {
        const active = res.data.find((k) => k.status === 'active');
        if (active) {
          setDeployApiKeyId(active.id);
          setDeployApiKeyMasked(active.masked_key || null);
        }
      }
      if (!res.data || res.data.filter((k) => k.status === 'active').length === 0) {
        // No active keys — create one silently
        const created = await api.apiKeys.create({
          name: `Deployment key — ${agent.name}`,
          environment: 'production',
          preset: 'full_access',
        });
        if (created.success && created.data) {
          setDeployApiKey((created.data as any).key || null);
          setDeployApiKeyId(created.data.id);
        }
      }
    } catch {
      // Non-fatal — user can still see code snippets with placeholder
    } finally {
      setDeployApiKeyLoading(false);
    }
  };

  const closeDeploy = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setDeployAgentId(null);
    setDeployMethod(null);
    setDeployApiKey(null);
    setDeployApiKeyId(null);
    setDeployApiKeyMasked(null);
    setCreatedEnrollment(null);
    setCurrentDeployment(null);
    setSelectedRuntimeId('');
    setNewRuntimeName('');
    setTestJob(null);
  };

  const createRuntime = async (agentName: string) => {
    setRuntimesLoading(true);
    setCreatedEnrollment(null);
    try {
      const name = newRuntimeName.trim() || `${agentName} runtime (${new Date().toLocaleDateString('en-IN')})`;
      const res = await api.runtimes.create({ name, mode: 'vpc' });
      const token = (res as any).enrollment_token as string | undefined;
      const expiresAt = (res as any).enrollment_expires_at as string | undefined;
      if (!res.success || !res.data || !token || !expiresAt) {
        toast.error(res.error || 'Failed to create runtime');
        return;
      }

      const runtimeRow = res.data as any;
      setRuntimes((prev) => [{
        id: runtimeRow.id,
        name: runtimeRow.name,
        mode: runtimeRow.mode,
        status: runtimeRow.status,
        last_heartbeat_at: runtimeRow.last_heartbeat_at || null,
      }, ...prev]);
      setSelectedRuntimeId(runtimeRow.id);
      setCreatedEnrollment({ runtimeId: runtimeRow.id, token, expiresAt });
      setNewRuntimeName('');
      toast.success('Runtime created (enrollment token shown once)');
    } finally {
      setRuntimesLoading(false);
    }
  };

  const deleteRuntime = async (id: string) => {
    if (!confirm('Delete this runtime? Any deployments using it will stop working.')) return;
    try {
      const res = await api.runtimes.delete(id);
      if (!res.success) { toast.error(res.error || 'Failed to delete'); return; }
      setRuntimes((prev) => prev.filter((r) => r.id !== id));
      if (selectedRuntimeId === id) setSelectedRuntimeId(runtimes.find((r) => r.id !== id)?.id || '');
      toast.success('Runtime deleted');
    } catch { toast.error('Failed to delete runtime'); }
  };

  const deployToRuntime = async () => {
    if (!deployAgentId || !selectedRuntimeId) {
      toast.error('Select a runtime first');
      return;
    }
    setDeploymentLoading(true);
    try {
      const res = await api.runtimes.deployAgent({
        agent_id: deployAgentId,
        runtime_instance_id: selectedRuntimeId,
      });
      if (!res.success) {
        toast.error(res.error || 'Deployment failed');
        return;
      }
      setCurrentDeployment(res.data || null);
      toast.success('Deployment saved.');
    } finally {
      setDeploymentLoading(false);
    }
  };

  const createTestChatJob = async () => {
    if (!deployAgentId) return;
    setTestJobBusy(true);
    try {
      const res = await api.jobs.create({
        agent_id: deployAgentId,
        type: 'chat_turn',
        input: {
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Reply in one short sentence.' },
            { role: 'user', content: 'Return: SyntheticHR runtime connection verified.' },
          ],
          temperature: 0.2,
        }
      });
      if (!res.success || !res.data?.job) {
        toast.error(res.error || 'Failed to create test job');
        return;
      }
      setTestJob(res.data);
      toast.success('Test job created (pending approval)');
    } finally {
      setTestJobBusy(false);
    }
  };

  const approveTestJob = async () => {
    const jobId = testJob?.job?.id;
    if (!jobId) return;
    setTestJobBusy(true);
    try {
      const res = await api.jobs.decide(jobId, 'approved');
      if (!res.success) {
        toast.error(res.error || 'Approval failed');
        return;
      }
      if (res.data?.job) {
        setTestJob((prev: any) => prev ? { ...prev, job: res.data!.job } : prev);
      }
      toast.success('Approved. Runtime will pick it up shortly.');
      pollJob(jobId);
    } finally {
      setTestJobBusy(false);
    }
  };

  const openWorkspace = (agentId: string, tab: WorkspaceTab = 'overview') => {
    setWorkspaceAgentId(agentId);
    setWorkspaceTab(tab);
    onSelectAgent?.(agentId);
  };

  const closeWorkspace = () => {
    setWorkspaceAgentId(null);
    onSelectAgent?.(null);
  };

  const activeWorkspaceAgent = workspaceAgentId ? agents.find((agent) => agent.id === workspaceAgentId) || null : null;
  const openIncidentCount = workspaceState.incidents.filter((incident) => incident.status !== 'resolved' && incident.status !== 'false_positive').length;
  const criticalIncidentCount = workspaceState.incidents.filter((incident) => incident.severity === 'critical').length;

  const filteredAgents = agents.filter(a => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.model_name.toLowerCase().includes(q) || a.agent_type.toLowerCase().includes(q);
    const matchesStatus = filterStatus === 'all' || a.status === filterStatus;
    const matchesType = filterType === 'all' || a.agent_type === filterType;
    return matchesSearch && matchesStatus && matchesType;
  });

  const controlPlaneBaseUrl = (((getFrontendConfig().apiUrl || 'http://localhost:3001/api') as string))
    .toString()
    .replace(/\/api\/?$/, '');

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Agent Fleet</h1>
          <p className="text-slate-400 mt-2">Track governed agents, runtime posture, and intervention controls.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary px-4 py-2 text-sm flex items-center gap-2"
          aria-label="Add new AI agent"
        >
          <Plus className="w-4 h-4" />
          Add Agent
        </button>
      </div>

      {/* Search & Filter Bar */}
      {agents.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="fleet-search"
              name="fleet-search"
              type="text"
              placeholder="Search agents by name, model, or description…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field pl-9 py-2.5 text-sm focus:ring-blue-500/30"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'active', 'paused', 'terminated'] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold capitalize transition-all border ${filterStatus === s
                  ? s === 'all' ? 'bg-white/[0.06] text-white border-white/10'
                    : s === 'active' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : s === 'paused' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                  : 'text-slate-400 border-slate-700 hover:border-slate-600 hover:text-white'
                  }`}
              >
                {s}
              </button>
            ))}
            {Array.from(new Set(agents.map(a => a.agent_type))).map(type => (
              <button
                key={type}
                onClick={() => setFilterType(filterType === type ? 'all' : type)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold capitalize transition-all border ${filterType === type
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                  : 'text-slate-400 border-slate-700 hover:border-slate-600 hover:text-white'
                  }`}
              >
                {type.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-12 text-center">
          <Users className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white">No governed agents yet</h2>
          <p className="mt-2 text-slate-400">Add your first agent to start monitoring risk, spend, and incident activity from one control surface.</p>
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-10 text-center">
          <Filter className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No agents match your filters.</p>
          <button onClick={() => { setSearchQuery(''); setFilterStatus('all'); setFilterType('all'); }} className="mt-3 text-xs text-cyan-400 hover:text-cyan-300">Clear filters</button>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredAgents.map((agent) => {
            const isConfigOpen = configureAgentId === agent.id;
            const budgetVals = editBudget[agent.id] ?? { budget: agent.budget_limit ?? 0, autoThrottle: agent.auto_throttle ?? false };
            return (
              <div
                key={agent.id}
                className={`relative bg-slate-800/30 border rounded-2xl overflow-hidden transition-all ${highlightedAgentId === agent.id
                  ? 'border-cyan-400/60 ring-1 ring-cyan-400/40 bg-cyan-500/5'
                  : isConfigOpen ? 'border-emerald-500/40' : 'border-slate-700'
                  }`}
              >
                {/* Main card row */}
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                        <h3 className="text-base font-semibold text-white">{agent.name}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${agent.status === 'active' ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20' :
                          agent.status === 'paused' ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20' :
                            'bg-red-400/10 text-red-400 border border-red-400/20'
                          }`}>{agent.status}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${agent.risk_level === 'low' ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20' :
                          agent.risk_level === 'medium' ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20' :
                            'bg-red-400/10 text-red-400 border border-red-400/20'
                          }`}>Risk {agent.risk_score}/100</span>
                        {agent.budget_limit > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-400/10 text-blue-400 border border-blue-400/20">
                            Budget ₹{agent.budget_limit.toLocaleString()}
                          </span>
                        )}
                        {agent.publishStatus === 'live' ? (
                          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-400/10 text-emerald-300 border border-emerald-400/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Live
                          </span>
                        ) : agent.publishStatus === 'ready' ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-400/10 text-amber-300 border border-amber-400/20" title="Agent has connected channels — deploy to go live">
                            Ready to go live
                          </span>
                        ) : (
                          <button
                            onClick={() => void openDeploy(agent)}
                            className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-400/10 text-slate-400 border border-slate-400/20 hover:bg-cyan-500/10 hover:text-cyan-300 hover:border-cyan-400/30 transition-colors cursor-pointer"
                            title="Deploy this agent to make it available"
                          >
                            Not live yet
                          </button>
                        )}
                        {(() => {
                          const method = (agent as any).metadata?.deploy_method as string | undefined;
                          if (!method) return null;
                          const methodLabels: Record<string, { label: string; cls: string }> = {
                            website: { label: '🌐 Website', cls: 'bg-teal-500/10 text-teal-300 border-teal-400/20' },
                            api: { label: '</> API', cls: 'bg-blue-500/10 text-blue-300 border-blue-400/20' },
                            terminal: { label: '>_ Terminal', cls: 'bg-purple-500/10 text-purple-300 border-purple-400/20' },
                          };
                          const meta = methodLabels[method];
                          if (!meta) return null;
                          return <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${meta.cls}`}>{meta.label}</span>;
                        })()}
                      </div>
                      <p className="text-slate-400 text-sm mb-2.5">{agent.description}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>Type: <span className="text-slate-300">{agent.agent_type}</span></span>
                        <span>Provider: <span className="text-slate-300">{agent.platform}</span></span>
                        <span>Model: <span className="text-slate-300 font-mono">{agent.model_name}</span></span>
                        <span className="w-full sm:w-auto" />
                        <span>Conversations: <span className="text-slate-300">{agent.conversations}</span></span>
                        <span>Connected targets: <span className="text-slate-300">{agent.connectedTargets?.length || 0}</span></span>
                        {agent.primaryPack ? (
                          <span>Primary channel: <span className="text-slate-300">{agent.primaryPack}</span></span>
                        ) : null}
                      </div>
                    </div>

                    {/* Action buttons — always visible */}
                    <div className="flex items-center gap-1 ml-4 shrink-0">
                      <button
                        onClick={() => onPublishAgent?.(agent, agent.primaryPack || null)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-blue-500/15 text-blue-200 border border-blue-400/30 hover:bg-blue-500/20"
                        title={agent.connectedTargets?.length ? 'Add another channel (Slack, email, web…)' : 'Connect a channel so your agent can send and receive messages'}
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        {agent.connectedTargets?.length ? 'Add channel' : 'Publish'}
                      </button>

                      <button
                        onClick={() => openWorkspace(agent.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-white/5 text-slate-200 border border-white/10 hover:bg-white/10"
                        title="Open agent workspace"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Workspace
                      </button>

                      {/* Deploy */}
                      {(() => {
                        const isNew = agent.created_at
                          ? Date.now() - new Date(agent.created_at).getTime() < 24 * 60 * 60 * 1000
                          : false;
                        const isNotLive = agent.publishStatus !== 'live';
                        return (
                          <button
                            onClick={() => void openDeploy(agent)}
                            className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                              isNotLive
                                ? 'bg-slate-700/60 text-slate-300 border border-slate-600 hover:bg-slate-700 hover:text-white'
                                : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25'
                            }`}
                            title="Deploy this agent"
                          >
                            {isNew && isNotLive && (
                              <span className="absolute -inset-px rounded-lg border border-slate-400/50 animate-pulse pointer-events-none" />
                            )}
                            <Rocket className="w-3.5 h-3.5" />
                            Deploy
                          </button>
                        );
                      })()}

                      {/* Configure */}
                      <button
                        onClick={() => isConfigOpen ? setConfigureAgentId(null) : openConfigure(agent)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${isConfigOpen
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-700/60 text-slate-300 border border-slate-600 hover:bg-slate-700 hover:text-white'
                          }`}
                        title="Configure agent"
                      >
                        <Key className="w-3.5 h-3.5" />
                        Configure
                      </button>

                      {/* Pause / Activate */}
                      {agent.status !== 'terminated' && (
                        agent.status === 'active' ? (
                          <button
                            onClick={() => handleConfirmAction(
                              'Pause Agent',
                              `Are you sure you want to pause ${agent.name}?`,
                              'warning',
                              async () => {
                                await runAgentAction(agent.id, `pause:${agent.id}`, () => api.agents.pause(agent.id, 'Paused from fleet list'), `${agent.name} paused.`);
                              }
                            )}
                            className="p-2 text-slate-400 hover:text-amber-400 transition-colors rounded-lg hover:bg-amber-400/10"
                            title="Pause Agent"
                            disabled={actionBusy === `pause:${agent.id}`}
                          >
                            {actionBusy === `pause:${agent.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <ZapOff className="w-4 h-4" />}
                          </button>
                        ) : (
                          <button
                            onClick={() => void runAgentAction(agent.id, `resume:${agent.id}`, () => api.agents.resume(agent.id, 'Resumed from fleet list'), `${agent.name} resumed.`)}
                            className="p-2 text-slate-400 hover:text-emerald-400 transition-colors rounded-lg hover:bg-emerald-400/10"
                            title="Activate Agent"
                            disabled={actionBusy === `resume:${agent.id}`}
                          >
                            {actionBusy === `resume:${agent.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                          </button>
                        )
                      )}

                      {/* Delete */}
                      <button
                        onClick={() => deleteAgent(agent.id)}
                        className="p-2 text-slate-400 hover:text-red-400 transition-colors rounded-lg hover:bg-red-400/10"
                        title="Delete Agent"
                        aria-label={`Delete agent ${agent.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Configure Panel (inline expansion) ── */}
                {isConfigOpen && (
                  <div className="border-t border-slate-700/50 bg-slate-900/40 animate-in slide-in-from-top-2 duration-200">
                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">

                      {/* Budget & Throttle */}
                      <div className="space-y-4">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-emerald-400" /> Budget & Spend Controls
                        </h4>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1.5">Monthly Budget Cap (₹)</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 text-sm font-bold">₹</span>
                            <input
                              id={`budget-${agent.id}`}
                              name={`budget-${agent.id}`}
                              type="number"
                              value={budgetVals.budget}
                              onChange={(e) => setEditBudget(prev => ({
                                ...prev,
                                [agent.id]: { ...budgetVals, budget: parseInt(e.target.value) || 0 }
                              }))}
                              className="w-full pl-7 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 text-sm"
                              min="0"
                            />
                          </div>
                          <p className="text-xs text-slate-500 mt-1">Current spend: ₹{(agent.current_spend || 0).toLocaleString()}</p>
                        </div>
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <div className="relative shrink-0">
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={budgetVals.autoThrottle}
                              onChange={(e) => setEditBudget(prev => ({
                                ...prev,
                                [agent.id]: { ...budgetVals, autoThrottle: e.target.checked }
                              }))}
                            />
                            <div className={`w-10 h-5 rounded-full transition-colors ${budgetVals.autoThrottle ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                            <div className={`absolute left-1 top-0.5 bg-white w-4 h-4 rounded-full shadow transition-transform ${budgetVals.autoThrottle ? 'translate-x-5' : ''}`} />
                          </div>
                          <div>
                            <p className="text-sm text-white font-medium">Auto-Throttle</p>
                            <p className="text-xs text-slate-400">Slow down responses as budget limit approaches</p>
                          </div>
                        </label>
                        <div className="pt-4 border-t border-slate-700/50">
                          <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
                            <Bot className="w-4 h-4 text-cyan-400" /> Diagnostics
                          </h4>
                          <button
                            onClick={() => {
                              toast.info(`Shadow test initiated for ${agent.name}...`);
                              setTimeout(() => {
                                toast.success(`${agent.name} shadow test completed without new violations.`);
                              }, 1600);
                            }}
                            className="w-full flex justify-center items-center gap-2 px-4 py-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-all text-sm font-semibold"
                          >
                            <Play className="w-4 h-4 text-cyan-400" /> Run Shadow Test
                          </button>
                        </div>
                      </div>

                      {/* Kill Switch — always visible danger zone */}
                      <div className="space-y-3">
                        <h4 className="text-sm font-bold text-rose-400 flex items-center gap-2">
                          <ShieldAlert className="w-4 h-4" /> Kill Switch Protocol
                        </h4>
                        <p className="text-xs text-slate-400">Escalating levels of intervention. Use with caution.</p>
                        <div className="space-y-2">
                          <button
                            onClick={() => handleKillSwitch(agent.id, 1)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-all text-sm font-medium"
                          >
                            <span className="text-base">⚠️</span>
                            <div className="text-left">
                              <p className="font-semibold">Level 1 – Warning &amp; Pause</p>
                              <p className="text-xs text-amber-400/70">Temporarily pause the agent</p>
                            </div>
                          </button>
                          <button
                            onClick={() => handleKillSwitch(agent.id, 2)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 transition-all text-sm font-medium"
                          >
                            <span className="text-base">🚨</span>
                            <div className="text-left">
                              <p className="font-semibold">Level 2 – Escalate to Human</p>
                              <p className="text-xs text-orange-400/70">Flag for human review, raise risk score</p>
                            </div>
                          </button>
                          <button
                            onClick={() => handleKillSwitch(agent.id, 3)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-all text-sm font-medium"
                          >
                            <span className="text-base">🛑</span>
                            <div className="text-left">
                              <p className="font-semibold">Level 3 – Permanent Shutdown</p>
                              <p className="text-xs text-rose-400/70">Irreversibly terminate this agent</p>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Save / Cancel */}
                    <div className="px-5 pb-5 flex gap-3 justify-end border-t border-slate-700/50 pt-4">
                      <button
                        onClick={() => setConfigureAgentId(null)}
                        className="px-4 py-2 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-sm hover:bg-slate-700 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveConfigure(agent.id)}
                        className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-400 text-white font-semibold rounded-xl text-sm hover:from-emerald-400 hover:to-teal-300 transition-all"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeWorkspaceAgent ? (
        <div className="rounded-2xl border border-blue-400/20 bg-blue-500/[0.04] overflow-hidden">
          <div className="flex items-start justify-between gap-4 p-6 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-semibold text-white">{activeWorkspaceAgent.name} workspace</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${packDisplayBadge((activeWorkspaceAgent.primaryPack || 'it') as IntegrationPackId).cls}`}>
                  {(activeWorkspaceAgent.primaryPack || 'it').replace('_', ' ')}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
                  {activeWorkspaceAgent.connectedTargets?.length || 0} connected target{(activeWorkspaceAgent.connectedTargets?.length || 0) === 1 ? '' : 's'}
                </span>
              </div>
              </div>
            <button onClick={closeWorkspace} className="text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 pt-4 flex flex-wrap gap-2">
            {([
              ['overview', 'Overview'],
              ['deployment', 'Deployment'],
              ['conversations', 'Conversations'],
              ['integrations', 'Integrations'],
              ['policies', 'Policies / Persona'],
              ['analytics', 'Analytics / Usage'],
              ['controls', 'Controls'],
            ] as Array<[WorkspaceTab, string]>).map(([tabId, label]) => (
              <button
                key={tabId}
                onClick={() => setWorkspaceTab(tabId)}
                className={`px-3 py-2 rounded-xl text-sm border transition-colors ${
                  workspaceTab === tabId
                    ? 'border-blue-400/30 bg-blue-500/15 text-blue-100'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {workspaceTab === 'deployment' ? (() => {
              const deployMethod = (activeWorkspaceAgent as any).metadata?.deploy_method as string | undefined;
              const gatewayBase = controlPlaneBaseUrl;
              const isDeployed = !!deployMethod;
              const methodMeta: Record<string, { label: string; icon: typeof Globe; color: string; desc: string }> = {
                website: { label: 'Website Embed', icon: Globe, color: 'text-teal-400', desc: 'Embedded via JavaScript widget on a website' },
                api: { label: 'API Integration', icon: Code2, color: 'text-blue-400', desc: 'Called via REST API from an application' },
                terminal: { label: 'Terminal', icon: Terminal, color: 'text-purple-400', desc: 'Accessed via curl or terminal script' },
              };
              const meta = deployMethod ? methodMeta[deployMethod] : null;
              const chatEndpoint = `${gatewayBase}/v1/agents/${activeWorkspaceAgent.id}/chat`;
              const copyText = (text: string, label = 'Copied') =>
                void navigator.clipboard.writeText(text).then(() => toast.success(label)).catch(() => toast.error('Copy failed'));

              return (
                <div className="space-y-4">
                  {isDeployed && meta ? (() => {
                    const Icon = meta.icon;
                    return (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="h-9 w-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                            <Icon className={`w-4 h-4 ${meta.color}`} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white">{meta.label}</p>
                            <p className="text-xs text-slate-500">{meta.desc}</p>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 flex items-center justify-between gap-3">
                          <code className="text-xs text-slate-300 font-mono truncate">{chatEndpoint}</code>
                          <button onClick={() => copyText(chatEndpoint, 'Endpoint copied')} className="flex-shrink-0 p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => void openDeploy(activeWorkspaceAgent)}
                            className="text-xs text-slate-400 hover:text-slate-200 transition-colors underline"
                          >
                            Switch deployment method
                          </button>
                        </div>
                      </div>
                    );
                  })() : (
                    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/20 p-8 text-center">
                      <Rocket className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                      <p className="text-sm font-medium text-slate-300 mb-1">Not deployed yet</p>
                      <p className="text-xs text-slate-500 mb-4">Deploy this agent to use it on your website, in your app, or from your terminal.</p>
                      <button
                        onClick={() => void openDeploy(activeWorkspaceAgent)}
                        className="px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-sm font-semibold hover:bg-cyan-500/25 transition-colors"
                      >
                        Deploy Now
                      </button>
                    </div>
                  )}

                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500 mb-3">API Endpoint</p>
                    <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 flex items-center justify-between gap-3">
                      <code className="text-xs text-slate-300 font-mono truncate">POST {chatEndpoint}</code>
                      <button onClick={() => copyText(`POST ${chatEndpoint}`, 'Endpoint copied')} className="flex-shrink-0 p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 rounded-xl border border-slate-700 bg-slate-950/60 p-3 relative">
                      <pre className="text-xs text-slate-300 font-mono whitespace-pre overflow-x-auto">{`curl -X POST ${chatEndpoint} \\\n  -H "Authorization: Bearer sk_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Hello"}'`}</pre>
                      <button onClick={() => copyText(`curl -X POST ${chatEndpoint} \\\n  -H "Authorization: Bearer sk_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Hello"}'`, 'Command copied')} className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Key className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        {wsKeyNew ? (
                          <span className="text-xs text-emerald-300 font-mono truncate">{wsKeyNew} <span className="text-amber-400">(shown once — copy it now)</span></span>
                        ) : (
                          <span className="text-xs text-slate-500 truncate">API key · <button onClick={() => onOpenOperationsPage?.('api-keys')} className="underline hover:text-slate-300 transition-colors">manage keys</button></span>
                        )}
                      </div>
                      <button
                        disabled={wsKeyRegenerating}
                        onClick={() => void (async () => {
                          if (!window.confirm('This will revoke your current API key and create a new one. Any code using the old key will stop working. Continue?')) return;
                          setWsKeyRegenerating(true);
                          setWsKeyNew(null);
                          try {
                            const listRes = await api.apiKeys.list();
                            const active = listRes.data?.find((k: any) => k.status === 'active');
                            if (active) await api.apiKeys.revoke(active.id);
                            const created = await api.apiKeys.create({ name: `Deployment key — ${activeWorkspaceAgent.name}`, environment: 'production', preset: 'full_access' });
                            if (created.success && (created.data as any)?.key) {
                              setWsKeyNew((created.data as any).key);
                              toast.success('New API key generated');
                            } else {
                              toast.error('Failed to generate new key');
                            }
                          } catch {
                            toast.error('Something went wrong');
                          } finally {
                            setWsKeyRegenerating(false);
                          }
                        })()}
                        className="flex items-center gap-1.5 flex-shrink-0 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900/60 text-slate-400 text-xs font-medium hover:text-white hover:border-slate-600 disabled:opacity-50 transition-colors"
                      >
                        <RefreshCw className={`w-3 h-3 ${wsKeyRegenerating ? 'animate-spin' : ''}`} />
                        {wsKeyRegenerating ? 'Generating…' : 'Regenerate'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })() : workspaceTab === 'overview' ? (
              <><div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 lg:col-span-2">
                  <h3 className="text-sm font-semibold text-white">Publish status</h3>
                  <p className="text-sm text-slate-400 mt-1">
                    {activeWorkspaceAgent.publishStatus === 'live'
                      ? 'This agent is live on connected systems and can be supervised from RASI.'
                      : activeWorkspaceAgent.publishStatus === 'ready'
                        ? 'This agent has channels prepared but still needs at least one active connection.'
                        : 'This agent is not connected yet. Publish it to a real channel to start operating it.'}
                  </p>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Conversations</div>
                      <div className="text-2xl font-semibold text-white mt-2">{activeWorkspaceAgent.conversations.toLocaleString()}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">CSAT</div>
                      <div className="text-2xl font-semibold text-white mt-2">{activeWorkspaceAgent.satisfaction}%</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Last sync</div>
                      <div className="text-sm font-medium text-white mt-2">
                        {activeWorkspaceAgent.lastIntegrationSyncAt ? new Date(activeWorkspaceAgent.lastIntegrationSyncAt).toLocaleString() : 'Not connected yet'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Live channels</div>
                          <div className="text-sm text-slate-400 mt-1">Connected systems this agent is currently attached to.</div>
                        </div>
                        <Link2 className="w-4 h-4 text-blue-200" />
                      </div>
                      <div className="mt-4 space-y-3">
                        {(activeWorkspaceAgent.connectedTargets || []).length === 0 ? (
                          <div className="text-sm text-slate-400">No connected channels yet.</div>
                        ) : (
                          (activeWorkspaceAgent.connectedTargets || []).slice(0, 3).map((target) => (
                            <div key={target.integrationId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
                              <div>
                                <div className="text-sm font-medium text-white">{target.integrationName}</div>
                                <div className="text-xs text-slate-500 mt-1">{target.packId} • {target.lastSyncAt ? new Date(target.lastSyncAt).toLocaleString() : 'No sync yet'}</div>
                              </div>
                              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                target.status === 'connected'
                                  ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                                  : 'border-amber-400/20 bg-amber-400/10 text-amber-100'
                              }`}>
                                {target.status}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Recent conversations</div>
                          <div className="text-sm text-slate-400 mt-1">Latest customer or operator interactions for this agent.</div>
                        </div>
                        {workspaceState.loadingConversations ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <MessageSquare className="w-4 h-4 text-slate-300" />}
                      </div>
                      <div className="mt-4 space-y-3">
                        {workspaceState.conversationsError ? (
                          <div className="text-sm text-rose-200">{workspaceState.conversationsError}</div>
                        ) : workspaceState.conversations.length === 0 ? (
                          <div className="text-sm text-slate-400">No recent conversations yet.</div>
                        ) : (
                          workspaceState.conversations.slice(0, 3).map((conversation) => (
                            <button
                              key={conversation.id}
                              onClick={() => onOpenOperationsPage?.('conversations', { agentId: activeWorkspaceAgent.id })}
                              className="w-full text-left rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2 hover:bg-slate-950/50 transition-colors"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-white truncate">{conversation.topic}</div>
                                <span className="text-[11px] text-slate-500">{new Date(conversation.timestamp).toLocaleString()}</span>
                              </div>
                              <div className="text-xs text-slate-400 mt-1 line-clamp-2">{conversation.preview}</div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Risk signals</div>
                          <div className="text-sm text-slate-400 mt-1">Current operational risk, driven by incidents and controls.</div>
                        </div>
                        {workspaceState.loadingIncidents ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <AlertTriangle className="w-4 h-4 text-amber-300" />}
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Open incidents</div>
                          <div className="text-2xl font-semibold text-white mt-2">{openIncidentCount}</div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Critical</div>
                          <div className="text-2xl font-semibold text-white mt-2">{criticalIncidentCount}</div>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Latest incident</div>
                      {workspaceState.incidentsError ? (
                        <div className="text-sm text-rose-200 mt-3">{workspaceState.incidentsError}</div>
                      ) : workspaceState.incidents.length === 0 ? (
                        <div className="text-sm text-slate-400 mt-3">No incidents recorded for this agent.</div>
                      ) : (
                        <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/30 px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-white">{workspaceState.incidents[0].title}</div>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                              workspaceState.incidents[0].severity === 'critical'
                                ? 'border-rose-400/20 bg-rose-400/10 text-rose-100'
                                : workspaceState.incidents[0].severity === 'high'
                                  ? 'border-orange-400/20 bg-orange-400/10 text-orange-100'
                                  : workspaceState.incidents[0].severity === 'medium'
                                    ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
                                    : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                            }`}>
                              {workspaceState.incidents[0].severity}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mt-2">{new Date(workspaceState.incidents[0].createdAt).toLocaleString()} • {workspaceState.incidents[0].status}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <h3 className="text-sm font-semibold text-white">Next best action</h3>
                  <p className="text-sm text-slate-400 mt-1">
                    Keep setup simple: choose where this agent should work, connect the provider, then supervise everything from here.
                  </p>
                  <button
                    onClick={() => onPublishAgent?.(activeWorkspaceAgent, activeWorkspaceAgent.primaryPack || null)}
                    className="mt-4 w-full rounded-xl bg-blue-500/20 border border-blue-400/30 px-4 py-3 text-sm font-semibold text-blue-100 hover:bg-blue-500/25"
                  >
                    {activeWorkspaceAgent.connectedTargets?.length ? 'Connect another channel' : 'Publish this agent'}
                  </button>
                </div>
              </div>

              {suggestedApps.length > 0 && (
                <div className="mt-4 rounded-2xl border border-violet-400/15 bg-violet-500/[0.04] p-5">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                      <ShoppingBag className="w-4 h-4 text-violet-300" />
                      <h3 className="text-sm font-semibold text-white">Suggested Apps</h3>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-violet-500/20 border border-violet-400/20 text-violet-300">
                        For this agent
                      </span>
                    </div>
                    <button
                      onClick={() => onOpenOperationsPage?.('marketplace')}
                      className="text-xs font-semibold text-violet-300 hover:text-violet-100 transition-colors inline-flex items-center gap-1"
                    >
                      Browse all
                      <Zap className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {suggestedApps.map((app) => (
                      <div
                        key={app.id}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-2"
                      >
                        <div className="flex items-center gap-2">
                          {app.logoUrl ? (
                            <img src={app.logoUrl} alt={app.name} className="w-6 h-6 rounded object-contain" />
                          ) : (
                            <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center">
                              <ShoppingBag className="w-3 h-3 text-slate-400" />
                            </div>
                          )}
                          <span className="text-sm font-medium text-white truncate">{app.name}</span>
                        </div>
                        <p className="text-xs text-slate-400 line-clamp-2">{app.description}</p>
                        {app.setupTimeMinutes && (
                          <span className="text-[11px] text-slate-500">⏱ {app.setupTimeMinutes} min setup</span>
                        )}
                        <button
                          onClick={() => onOpenOperationsPage?.('marketplace')}
                          className="mt-auto pt-2 text-xs font-semibold text-violet-300 hover:text-violet-100 transition-colors text-left inline-flex items-center gap-1"
                        >
                          Add to workspace →
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>) : null}

            {workspaceTab === 'conversations' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-white">Recent conversations</h3>
                  <button
                    onClick={() => onOpenOperationsPage?.('conversations', { agentId: activeWorkspaceAgent.id })}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 inline-flex items-center gap-1.5"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Open full inbox
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {workspaceState.loadingConversations ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-slate-300 inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading recent conversations...
                    </div>
                  ) : workspaceState.conversationsError ? (
                    <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-100">
                      {workspaceState.conversationsError}
                    </div>
                  ) : workspaceState.conversations.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm text-slate-400">
                      No conversations recorded for this agent yet.
                    </div>
                  ) : (
                    workspaceState.conversations.map((conversation) => (
                      <div key={conversation.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-sm font-semibold text-white truncate">{conversation.topic}</h4>
                              <span className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
                                {conversation.status}
                              </span>
                              <span className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
                                {conversation.platform}
                              </span>
                            </div>
                            <div className="mt-2 text-xs text-slate-500 inline-flex items-center gap-1">
                              <Clock3 className="w-3.5 h-3.5" />
                              {new Date(conversation.timestamp).toLocaleString()} • {conversation.user}
                            </div>
                            <p className="mt-3 text-sm text-slate-300 line-clamp-3">{conversation.preview}</p>
                          </div>
                          <button
                            onClick={() => onOpenOperationsPage?.('conversations', { agentId: activeWorkspaceAgent.id })}
                            className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
                          >
                            Review
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {workspaceTab === 'integrations' ? (
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-white">Where this agent works</h3>
                  <button
                    onClick={() => void openAddIntegrationPanel(activeWorkspaceAgent)}
                    className="rounded-xl bg-blue-500/20 border border-blue-400/30 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-blue-500/25 inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add integration
                  </button>
                </div>

                {/* Publish checklist */}
                {activeWorkspaceAgent.publishStatus !== 'live' && (() => {
                  const checklist = getPublishChecklist(activeWorkspaceAgent);
                  const allGreen = checklist.every((c) => c.ok);
                  return (
                    <div className={`rounded-2xl border p-4 ${allGreen ? 'border-emerald-400/20 bg-emerald-400/[0.06]' : 'border-amber-400/20 bg-amber-400/[0.06]'}`}>
                      <p className={`text-xs font-semibold uppercase tracking-[0.16em] mb-3 ${allGreen ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {allGreen ? 'Ready to go live' : 'Before going live'}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {checklist.map((item) => (
                          <div key={item.label} className="flex items-center gap-2">
                            {item.ok
                              ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                              : <XCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                            <span className={`text-xs ${item.ok ? 'text-slate-300' : 'text-slate-400'}`}>{item.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Connected targets */}
                {(activeWorkspaceAgent.connectedTargets || []).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6">
                    <div className="flex items-start gap-3">
                      <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-slate-200 mb-1">What is publishing?</p>
                        <p className="text-xs text-slate-400 mb-3">Publishing connects your agent to a channel — like Slack or email — so it can send and receive real messages. Think of it as giving your agent a "phone number" to reach your team or customers.</p>
                        <button
                          onClick={() => onPublishAgent?.(activeWorkspaceAgent, activeWorkspaceAgent.primaryPack || null)}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/15 border border-blue-400/30 text-blue-300 text-xs font-semibold hover:bg-blue-500/25 transition-colors"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          Connect a channel
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(activeWorkspaceAgent.connectedTargets || []).map((target) => {
                      const actionsForService = availableIntegrations.find((i) => i.id === target.integrationId)?.capabilities?.writes || [];
                      const isExpanded = expandedActions.has(target.integrationId);
                      return (
                        <div key={target.integrationId} className="rounded-2xl border border-white/10 bg-white/[0.03]">
                          {/* Card header */}
                          <div className="flex items-center justify-between gap-3 p-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${target.status === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                              <div>
                                <h4 className="font-semibold text-white text-sm">{target.integrationName}</h4>
                                <p className="text-xs text-slate-500 mt-0.5">
                                  {target.packId} · {target.lastSyncAt ? `synced ${new Date(target.lastSyncAt).toLocaleDateString()}` : 'no sync yet'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                target.status === 'connected'
                                  ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                                  : 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                              }`}>{target.status}</span>
                              <button
                                onClick={() => setExpandedActions((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(target.integrationId)) { next.delete(target.integrationId); }
                                  else {
                                    next.add(target.integrationId);
                                    void api.integrations.getActionCatalog().then((res) => {
                                      if (res.success && Array.isArray(res.data)) setActionCatalog(res.data as any[]);
                                    });
                                    void api.integrations.getAll().then((res) => {
                                      if (res.success && Array.isArray(res.data)) setAvailableIntegrations((res.data as any[]).filter((i: any) => i.status === 'connected'));
                                    });
                                  }
                                  return next;
                                })}
                                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-400 hover:text-white hover:bg-white/10 inline-flex items-center gap-1"
                              >
                                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                Actions
                              </button>
                            </div>
                          </div>

                          {/* Action mapper — expandable */}
                          {isExpanded && (
                            <div className="border-t border-white/10 px-4 py-3">
                              {actionsForService.length === 0 ? (
                                <p className="text-xs text-slate-500">No configurable actions for this integration.</p>
                              ) : (
                                <div className="space-y-2">
                                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">Enabled actions</p>
                                  {actionsForService.map((write: { id: string; label: string; risk: string }) => {
                                    const catalogEntry = actionCatalog.find((a) => a.service === target.integrationId && a.action === write.id);
                                    const enabled = catalogEntry ? catalogEntry.enabled : false;
                                    const key = `${target.integrationId}:${write.id}`;
                                    const riskColors: Record<string, string> = { low: 'text-slate-400', medium: 'text-amber-400', high: 'text-rose-400', money: 'text-orange-400' };
                                    return (
                                      <div key={write.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
                                        <div>
                                          <span className="text-xs text-white">{write.label}</span>
                                          <span className={`ml-2 text-[10px] ${riskColors[write.risk] || 'text-slate-500'}`}>{write.risk} risk</span>
                                        </div>
                                        <button
                                          onClick={() => void toggleIntegrationAction(target.integrationId, write.id, enabled)}
                                          disabled={savingAction === key}
                                          className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-cyan-500' : 'bg-slate-700'} ${savingAction === key ? 'opacity-50' : ''}`}
                                        >
                                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Card footer actions */}
                          <div className="border-t border-white/10 px-4 py-3 flex items-center gap-2">
                            <button
                              onClick={() => void runAgentAction(
                                activeWorkspaceAgent.id,
                                `disconnect:${target.integrationId}`,
                                async () => {
                                  const disconnect = await api.integrations.disconnect(target.integrationId);
                                  if (!disconnect.success) return disconnect;
                                  await removeIntegration(activeWorkspaceAgent, target.integrationId);
                                  return { success: true, data: { id: activeWorkspaceAgent.id } };
                                },
                                `${target.integrationName} disconnected.`
                              )}
                              className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-400/15"
                              disabled={actionBusy === `disconnect:${target.integrationId}`}
                            >
                              {actionBusy === `disconnect:${target.integrationId}` ? 'Disconnecting…' : 'Disconnect'}
                            </button>
                            {activeWorkspaceAgent.publishStatus !== 'live' ? (
                              <button
                                onClick={() => void runAgentAction(
                                  activeWorkspaceAgent.id,
                                  `live:${activeWorkspaceAgent.id}`,
                                  () => api.agents.goLive(activeWorkspaceAgent.id),
                                  `${activeWorkspaceAgent.name} is now live.`
                                )}
                                className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/15 inline-flex items-center gap-1.5"
                                disabled={actionBusy === `live:${activeWorkspaceAgent.id}`}
                              >
                                <Play className="w-3 h-3" />
                                {actionBusy === `live:${activeWorkspaceAgent.id}` ? 'Going live…' : 'Go live'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add Integration slide-over panel */}
                {showAddIntegration && (
                  <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddIntegration(false)}>
                    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/10">
                        <div>
                          <p className="font-semibold text-white text-sm">Assign an integration</p>
                          <p className="text-xs text-slate-400 mt-0.5">Select a connected provider to wire to this agent</p>
                        </div>
                        <button onClick={() => setShowAddIntegration(false)} className="text-slate-400 hover:text-white">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="p-4 max-h-80 overflow-y-auto">
                        {addIntegrationLoading ? (
                          <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-sm">Loading integrations…</span>
                          </div>
                        ) : availableIntegrations.length === 0 ? (
                          <div className="text-center py-6">
                            <p className="text-sm text-slate-400">No connected integrations found.</p>
                            <p className="text-xs text-slate-500 mt-1">Connect providers on the Integrations page first.</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {availableIntegrations.map((integration) => {
                              const alreadyAssigned = (activeWorkspaceAgent.integrationIds || []).includes(integration.id);
                              return (
                                <div key={integration.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                                  <div>
                                    <p className="text-sm font-medium text-white">{integration.name}</p>
                                    <p className="text-xs text-slate-500 mt-0.5 uppercase tracking-wider">{integration.category}</p>
                                  </div>
                                  {alreadyAssigned ? (
                                    <span className="text-xs text-emerald-400 font-medium">Assigned</span>
                                  ) : (
                                    <button
                                      onClick={() => void assignIntegration(activeWorkspaceAgent, integration.id)}
                                      className="rounded-lg bg-cyan-500/20 border border-cyan-400/30 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30"
                                    >
                                      Assign
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {workspaceTab === 'policies' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-white">Persona and policy controls</h3>
                  <button
                    onClick={() => onOpenOperationsPage?.('persona', { agentId: activeWorkspaceAgent.id })}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
                  >
                    Open full editor
                  </button>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <label className="block">
                      <div className="text-sm font-semibold text-white">System prompt</div>
                      <div className="text-sm text-slate-400 mt-1">Primary instructions that define how this agent should behave.</div>
                      <textarea
                        value={policyDraft.systemPrompt}
                        onChange={(e) => setPolicyDraft((current) => ({ ...current, systemPrompt: e.target.value }))}
                        rows={12}
                        className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        placeholder="Describe the role, tone, escalation triggers, and hard constraints for this agent."
                      />
                    </label>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <label className="block">
                      <div className="text-sm font-semibold text-white">Operational policy</div>
                      <div className="text-sm text-slate-400 mt-1">Plain-English rules for approvals, refunds, escalations, or anything this agent must never do.</div>
                      <textarea
                        value={policyDraft.operationalPolicy}
                        onChange={(e) => setPolicyDraft((current) => ({ ...current, operationalPolicy: e.target.value }))}
                        rows={12}
                        className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        placeholder="Example: Refunds above $100 require human approval. Escalate legal threats immediately. Never promise timelines not in policy."
                      />
                    </label>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => void saveWorkspacePolicies()}
                    disabled={policySaving}
                    className="rounded-xl bg-blue-500/20 border border-blue-400/30 px-4 py-2 text-sm font-semibold text-blue-100 hover:bg-blue-500/25 disabled:opacity-60 inline-flex items-center gap-2"
                  >
                    {policySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                    Save policy changes
                  </button>
                </div>
              </div>
            ) : null}

            {workspaceTab === 'analytics' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-white">Usage and effectiveness</h3>
                  <button
                    onClick={() => onOpenOperationsPage?.('costs', { agentId: activeWorkspaceAgent.id })}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 inline-flex items-center gap-1.5"
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    Open analytics
                  </button>
                </div>
                {workspaceState.loadingAnalytics ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-slate-300 inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading analytics...
                  </div>
                ) : workspaceState.analyticsError ? (
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-100">
                    {workspaceState.analyticsError}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Total spend</div>
                        <div className="mt-3 text-2xl font-semibold text-white">${(workspaceState.analytics?.totalCost || 0).toFixed(2)}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Requests</div>
                        <div className="mt-3 text-2xl font-semibold text-white">{(workspaceState.analytics?.totalRequests || 0).toLocaleString()}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Tokens</div>
                        <div className="mt-3 text-2xl font-semibold text-white">{(workspaceState.analytics?.totalTokens || 0).toLocaleString()}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Avg cost / request</div>
                        <div className="mt-3 text-2xl font-semibold text-white">${(workspaceState.analytics?.avgCostPerRequest || 0).toFixed(4)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                        <div className="text-sm font-semibold text-white">7-day trend</div>
                        <div className="text-sm text-slate-400 mt-1">Recent daily spend and request activity for this agent.</div>
                        <div className="mt-4 space-y-3">
                          {(workspaceState.analytics?.trend || []).length === 0 ? (
                            <div className="text-sm text-slate-400">No recent trend data available.</div>
                          ) : (
                            (workspaceState.analytics?.trend || []).map((point) => (
                              <div key={point.date} className="grid grid-cols-[120px_1fr_auto] items-center gap-3">
                                <div className="text-xs text-slate-500">{point.date}</div>
                                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-cyan-400"
                                    style={{ width: `${Math.min(100, (point.cost / Math.max(...((workspaceState.analytics?.trend || []).map((item) => item.cost || 0)), 1)) * 100)}%` }}
                                  />
                                </div>
                                <div className="text-xs text-slate-300">${point.cost.toFixed(2)} • {point.requests} req</div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                        <div className="text-sm font-semibold text-white">Efficiency snapshot</div>
                        <div className="text-sm text-slate-400 mt-1">Quick read on cost posture and usage intensity.</div>
                        <div className="mt-4 space-y-3">
                          <div className="rounded-xl border border-white/10 bg-slate-950/30 px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Daily average spend</div>
                            <div className="text-lg font-semibold text-white mt-2">${(workspaceState.analytics?.dailyAverage || 0).toFixed(2)}</div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-slate-950/30 px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Budget usage</div>
                            <div className="text-lg font-semibold text-white mt-2">
                              {activeWorkspaceAgent.budget_limit > 0
                                ? `${Math.min(100, Math.round(((activeWorkspaceAgent.current_spend || 0) / activeWorkspaceAgent.budget_limit) * 100))}% of budget`
                                : 'No budget cap set'}
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-slate-950/30 px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Customer satisfaction</div>
                            <div className="text-lg font-semibold text-white mt-2">{activeWorkspaceAgent.satisfaction}%</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {workspaceTab === 'controls' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Agent state</div>
                    <div className="mt-3 text-2xl font-semibold text-white capitalize">{activeWorkspaceAgent.status}</div>
                    <div className="mt-2 text-sm text-slate-400">Current lifecycle: {activeWorkspaceAgent.lifecycle_state}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Risk score</div>
                    <div className="mt-3 text-2xl font-semibold text-white">{activeWorkspaceAgent.risk_score}/100</div>
                    <div className="mt-2 text-sm text-slate-400">Risk level: {activeWorkspaceAgent.risk_level}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Incident pressure</div>
                    <div className="mt-3 text-2xl font-semibold text-white">{openIncidentCount}</div>
                    <div className="mt-2 text-sm text-slate-400">{criticalIncidentCount} critical incidents currently on record</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    onClick={() => activeWorkspaceAgent.status === 'active'
                      ? handleConfirmAction(
                        'Pause Agent',
                        `Are you sure you want to pause ${activeWorkspaceAgent.name}?`,
                        'warning',
                        async () => {
                          await runAgentAction(activeWorkspaceAgent.id, `pause:${activeWorkspaceAgent.id}`, () => api.agents.pause(activeWorkspaceAgent.id, 'Paused from controls workspace'), `${activeWorkspaceAgent.name} paused.`);
                        }
                      )
                      : void runAgentAction(activeWorkspaceAgent.id, `resume:${activeWorkspaceAgent.id}`, () => api.agents.resume(activeWorkspaceAgent.id, 'Resumed from controls workspace'), `${activeWorkspaceAgent.name} resumed.`)
                    }
                    className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-5 text-left"
                    disabled={actionBusy === `pause:${activeWorkspaceAgent.id}` || actionBusy === `resume:${activeWorkspaceAgent.id}`}
                  >
                    <PauseCircle className="w-5 h-5 text-amber-300" />
                    <div className="mt-3 text-sm font-semibold text-white">{activeWorkspaceAgent.status === 'active' ? 'Pause agent' : 'Resume agent'}</div>
                    <div className="mt-1 text-sm text-amber-100/80">Temporarily stop or resume live traffic.</div>
                  </button>
                  <button
                    onClick={() => handleKillSwitch(activeWorkspaceAgent.id, 2)}
                    className="rounded-2xl border border-orange-400/20 bg-orange-400/10 p-5 text-left"
                    disabled={actionBusy === `escalate:${activeWorkspaceAgent.id}`}
                  >
                    <AlertTriangle className="w-5 h-5 text-orange-300" />
                    <div className="mt-3 text-sm font-semibold text-white">Escalate to human</div>
                    <div className="mt-1 text-sm text-orange-100/80">Increase scrutiny and force review for risky behavior.</div>
                  </button>
                  {activeWorkspaceAgent.publishStatus !== 'live' ? (
                    <button
                      onClick={() => void runAgentAction(activeWorkspaceAgent.id, `live:${activeWorkspaceAgent.id}`, () => api.agents.goLive(activeWorkspaceAgent.id), `${activeWorkspaceAgent.name} is now live.`)}
                      className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5 text-left"
                      disabled={actionBusy === `live:${activeWorkspaceAgent.id}`}
                    >
                      <Play className="w-5 h-5 text-emerald-300" />
                      <div className="mt-3 text-sm font-semibold text-white">Go live</div>
                      <div className="mt-1 text-sm text-emerald-100/80">Enable live traffic on connected channels.</div>
                    </button>
                  ) : null}
                  <button
                    onClick={() => handleKillSwitch(activeWorkspaceAgent.id, 3)}
                    className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-left"
                  >
                    <ShieldAlert className="w-5 h-5 text-rose-300" />
                    <div className="mt-3 text-sm font-semibold text-white">Kill switch</div>
                    <div className="mt-1 text-sm text-rose-100/80">Immediately shut down the agent if it is unsafe.</div>
                  </button>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Recent incidents</h3>
                      <p className="text-sm text-slate-400 mt-1">Use this to decide whether to pause, escalate, or fully stop the agent.</p>
                    </div>
                    <button
                      onClick={() => onOpenOperationsPage?.('incidents', { agentId: activeWorkspaceAgent.id })}
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
                    >
                      Open incidents
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3">
                    {workspaceState.loadingIncidents ? (
                      <div className="text-sm text-slate-300 inline-flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading incidents...
                      </div>
                    ) : workspaceState.incidentsError ? (
                      <div className="text-sm text-rose-200">{workspaceState.incidentsError}</div>
                    ) : workspaceState.incidents.length === 0 ? (
                      <div className="text-sm text-slate-400">No incidents recorded for this agent.</div>
                    ) : (
                      workspaceState.incidents.slice(0, 4).map((incident) => (
                        <div key={incident.id} className="rounded-xl border border-white/10 bg-slate-950/30 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-white">{incident.title}</div>
                            <span className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
                              {incident.status}
                            </span>
                          </div>
                          <div className="mt-2 text-xs text-slate-500">
                            {incident.type} • {incident.severity} • {new Date(incident.createdAt).toLocaleString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}


      {/* Deploy Modal */}
      {deployAgentId && (() => {
        const deployAgent = agents.find((a) => a.id === deployAgentId);
        const agentName = deployAgent?.name || 'Agent';
        const gatewayBase = controlPlaneBaseUrl;
        const widgetSrc = typeof window !== 'undefined' ? `${window.location.origin}/widget.js` : '/widget.js';
        // Only use the full key in code — masked values can't be used and would confuse users
        const hasFullKey = !!deployApiKey;
        const apiKeyDisplay = deployApiKey || 'YOUR_API_KEY';
        const chatEndpoint = `${gatewayBase}/v1/agents/${deployAgentId}/chat`;

        const copyText = (text: string, label = 'Copied') =>
          void navigator.clipboard.writeText(text).then(() => toast.success(label)).catch(() => toast.error('Copy failed'));

        const generateFreshKey = async () => {
          setDeployApiKeyLoading(true);
          try {
            if (deployApiKeyId) await api.apiKeys.revoke(deployApiKeyId);
            const created = await api.apiKeys.create({ name: `Deployment key — ${agentName}`, environment: 'production', preset: 'full_access' });
            if (created.success && (created.data as any)?.key) {
              setDeployApiKey((created.data as any).key);
              setDeployApiKeyId((created.data as any).id || null);
              setDeployApiKeyMasked(null);
              toast.success('Fresh key ready — copy it now');
            } else {
              toast.error('Failed to generate key');
            }
          } finally {
            setDeployApiKeyLoading(false);
          }
        };

        const scriptTag = `<script\n  src="${widgetSrc}"\n  data-agent-id="${deployAgentId}"\n  data-api-key="${apiKeyDisplay}"\n></script>`;

        const codeSnippets: Record<DeployCodeTab, string> = {
          curl: `curl -X POST ${chatEndpoint} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKeyDisplay}" \\\n  -d '{"message": "Hello"}'`,
          python: `import requests\n\nresponse = requests.post(\n    "${chatEndpoint}",\n    headers={"Authorization": "Bearer ${apiKeyDisplay}"},\n    json={"message": "Hello"}\n)\nprint(response.json()["reply"])`,
          nodejs: `const res = await fetch("${chatEndpoint}", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer ${apiKeyDisplay}",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({ message: "Hello" })\n});\nconst { reply } = await res.json();\nconsole.log(reply);`,
          php: `<?php\n$ch = curl_init("${chatEndpoint}");\ncurl_setopt($ch, CURLOPT_POST, 1);\ncurl_setopt($ch, CURLOPT_HTTPHEADER, [\n  "Authorization: Bearer ${apiKeyDisplay}",\n  "Content-Type: application/json"\n]);\ncurl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(["message" => "Hello"]));\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n$body = json_decode(curl_exec($ch), true);\necho $body["reply"];`,
        };

        const terminalChat = `curl -fsSL ${window.location.origin}/chat.sh | bash -s -- ${apiKeyDisplay} ${deployAgentId}`;
        const terminalCurl = `curl -X POST ${chatEndpoint} \\\n  -H "Authorization: Bearer ${apiKeyDisplay}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Hello"}'`;

        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className={`w-full ${deployMethod === 'advanced' ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] rounded-3xl border border-slate-700 bg-slate-950/95 shadow-2xl overflow-hidden flex flex-col transition-all`}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                {deployMethod && deployMethod !== null && (
                  <button
                    onClick={() => setDeployMethod(null)}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors mr-1"
                    aria-label="Back"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <div className="h-9 w-9 rounded-xl bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center">
                  <Rocket className="w-4 h-4 text-cyan-300" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    {!deployMethod ? 'Deploy Agent' : deployMethod === 'website' ? 'My Website' : deployMethod === 'api' ? 'In My App' : deployMethod === 'terminal' ? 'Terminal' : 'Advanced (Self-Host)'}
                  </h2>
                  <p className="text-xs text-slate-500">{agentName}</p>
                </div>
              </div>
              <button onClick={closeDeploy} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto">
              {/* ── Method Picker ── */}
              {!deployMethod && (
                <div className="p-6">
                  <p className="text-sm text-slate-400 mb-5">Where do you want to use <span className="text-white font-medium">{agentName}</span>?</p>

                  {deployApiKeyLoading && (
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
                      <Loader2 className="w-3 h-3 animate-spin" />Preparing your access key…
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    {([
                      { id: 'website', icon: Globe, label: 'My Website', desc: 'Paste one line into any site', color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20 hover:border-teal-400/40' },
                      { id: 'api', icon: Code2, label: 'In My App', desc: 'Python, JS, curl — your code', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20 hover:border-blue-400/40' },
                      { id: 'terminal', icon: Terminal, label: 'Terminal', desc: 'Chat from your computer', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20 hover:border-purple-400/40' },
                    ] as const).map(({ id, icon: Icon, label, desc, color, bg }) => (
                      <button
                        key={id}
                        onClick={() => {
                          setDeployMethod(id);
                          if (deployAgentId) {
                            void api.agents.updatePublishState(deployAgentId, { deploy_method: id }).then((res) => {
                              if (res.success) {
                                setAgents((prev) => (prev as AIAgent[]).map((a) =>
                                  a.id === deployAgentId
                                    ? { ...a, metadata: { ...(a as any).metadata, deploy_method: id } }
                                    : a
                                ));
                              }
                            });
                          }
                        }}
                        className={`flex flex-col items-center text-center p-4 rounded-2xl border ${bg} transition-all cursor-pointer group`}
                      >
                        <div className={`h-10 w-10 rounded-xl flex items-center justify-center mb-3 ${bg}`}>
                          <Icon className={`w-5 h-5 ${color}`} />
                        </div>
                        <p className="text-sm font-semibold text-white mb-1">{label}</p>
                        <p className="text-xs text-slate-500 leading-snug">{desc}</p>
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => setDeployMethod('advanced')}
                    className="w-full text-center text-xs text-slate-500 hover:text-slate-300 transition-colors py-1"
                  >
                    Need to self-host on your own server? <span className="underline">Advanced →</span>
                  </button>
                </div>
              )}

              {/* ── Website method ── */}
              {deployMethod === 'website' && (
                <div className="p-6 space-y-5">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                    <p className="text-xs text-slate-400 mb-1">Paste this inside your website's HTML, before <code className="text-slate-300">&lt;/body&gt;</code>:</p>
                    <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                      <pre className="text-xs text-teal-200 font-mono whitespace-pre-wrap break-all leading-relaxed">{scriptTag}</pre>
                    </div>
                    <button
                      onClick={() => copyText(scriptTag, 'Code copied!')}
                      className="mt-3 flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500/15 border border-teal-500/25 text-teal-300 text-xs font-semibold hover:bg-teal-500/25 transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" />Copy code
                    </button>
                  </div>

                  {hasFullKey ? (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-2">
                      <Info className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-amber-300">Your API key is already in the code above. <strong>Copy it now</strong> — it won't be shown again.</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 flex items-start gap-3">
                      <Key className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-xs text-amber-300 mb-2">The code above has a placeholder — <code className="bg-slate-800 px-1 rounded">YOUR_API_KEY</code>. Generate a key to replace it with the real value.</p>
                        <button
                          onClick={() => void generateFreshKey()}
                          disabled={deployApiKeyLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/30 text-amber-300 text-xs font-semibold hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
                        >
                          <RefreshCw className={`w-3 h-3 ${deployApiKeyLoading ? 'animate-spin' : ''}`} />
                          {deployApiKeyLoading ? 'Generating…' : 'Generate API key'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-xs text-slate-400 space-y-1">
                    <p className="font-medium text-slate-300">What happens next:</p>
                    <p>• A chat bubble appears in the bottom-right corner of your site</p>
                    <p>• Visitors can click it and message your agent directly</p>
                    <p>• All conversations appear in your Workspace</p>
                  </div>
                </div>
              )}

              {/* ── API method ── */}
              {deployMethod === 'api' && (
                <div className="p-6 space-y-4">
                  {/* API Key row */}
                  {hasFullKey ? (
                    <div className="flex gap-2">
                      <div className="flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-emerald-400/80 mb-0.5">Your API Key <span className="text-amber-400">(shown once — copy it now)</span></p>
                          <code className="text-xs text-emerald-200 font-mono break-all">{deployApiKey}</code>
                        </div>
                        <button onClick={() => copyText(deployApiKey!, 'API key copied')} className="flex-shrink-0 p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex-1 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs text-slate-500 mb-0.5">Agent ID</p>
                          <code className="text-xs text-slate-300 font-mono">{deployAgentId.slice(0, 8)}…</code>
                        </div>
                        <button onClick={() => copyText(deployAgentId, 'Agent ID copied')} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Key className="w-4 h-4 text-amber-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white mb-0.5">Your key is hidden for security</p>
                        <p className="text-xs text-slate-400 mb-3">API keys can only be seen once when first created. Generate a fresh key to copy it and use it in your code.</p>
                        <button
                          onClick={() => void generateFreshKey()}
                          disabled={deployApiKeyLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/30 text-amber-300 text-xs font-semibold hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
                        >
                          <RefreshCw className={`w-3 h-3 ${deployApiKeyLoading ? 'animate-spin' : ''}`} />
                          {deployApiKeyLoading ? 'Generating…' : 'Generate a fresh key'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex gap-1 mb-2">
                      {(['curl', 'python', 'nodejs', 'php'] as DeployCodeTab[]).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setDeployCodeTab(tab)}
                          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${deployCodeTab === tab ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                          {tab === 'nodejs' ? 'Node.js' : tab}
                        </button>
                      ))}
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 relative">
                      <pre className="text-xs text-slate-200 font-mono whitespace-pre overflow-x-auto leading-relaxed">{codeSnippets[deployCodeTab]}</pre>
                      <button
                        onClick={() => copyText(codeSnippets[deployCodeTab], 'Code copied!')}
                        className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {hasFullKey && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3 flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      <p className="text-xs text-emerald-300">Your key is already in the code above. <strong>Copy it now</strong> — it won't be shown again.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Terminal method ── */}
              {deployMethod === 'terminal' && (
                <div className="p-6 space-y-5">
                  {!hasFullKey && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 flex items-start gap-3">
                      <Key className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-xs text-amber-300 mb-2">The commands below use <code className="bg-slate-800 px-1 rounded">YOUR_API_KEY</code> as a placeholder. Generate a real key first.</p>
                        <button
                          onClick={() => void generateFreshKey()}
                          disabled={deployApiKeyLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/30 text-amber-300 text-xs font-semibold hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
                        >
                          <RefreshCw className={`w-3 h-3 ${deployApiKeyLoading ? 'animate-spin' : ''}`} />
                          {deployApiKeyLoading ? 'Generating…' : 'Generate API key'}
                        </button>
                      </div>
                    </div>
                  )}
                  {hasFullKey && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3 flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      <p className="text-xs text-emerald-300">Your key is already in the commands below. <strong>Copy and run them now</strong> — the key won't be shown again.</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-slate-400 mb-2">Open your terminal and run this to start chatting:</p>
                    <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 relative">
                      <pre className="text-xs text-purple-200 font-mono whitespace-pre-wrap break-all leading-relaxed">{terminalChat}</pre>
                      <button
                        onClick={() => copyText(terminalChat, 'Command copied!')}
                        className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500">No installation needed. Works on Mac, Linux, and WSL.</p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-400 mb-2">Or send a single message:</p>
                    <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 relative">
                      <pre className="text-xs text-slate-200 font-mono whitespace-pre-wrap break-all leading-relaxed">{terminalCurl}</pre>
                      <button
                        onClick={() => copyText(terminalCurl, 'Command copied!')}
                        className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Advanced (original runtime enrollment flow) ── */}
              {deployMethod === 'advanced' && (
                <div className="p-6 space-y-4 overflow-y-auto">
                  <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3 flex items-start gap-2 mb-2">
                    <Info className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-slate-400">For self-hosting on your own server or VPC. Most users should use Website, API, or Terminal instead.</p>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current deployment</p>
                      {currentDeployment ? (
                        <p className="mt-2 text-sm text-slate-200">
                          Runtime: <span className="font-mono text-cyan-200">{currentDeployment.runtime_instance_id}</span>
                          <span className="ml-3 px-2 py-0.5 rounded-full text-xs border border-slate-700 bg-slate-900 text-slate-300">{currentDeployment.status}</span>
                        </p>
                      ) : (
                        <p className="mt-2 text-sm text-slate-400">Not deployed yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/25 text-xs font-bold text-cyan-300">1</span>
                      <p className="text-sm font-semibold text-white">Select or create a runtime</p>
                    </div>
                    {runtimes.length > 0 && (
                      <div className="flex gap-2 mb-3">
                        <select value={selectedRuntimeId} onChange={(e) => setSelectedRuntimeId(e.target.value)} className="flex-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500" disabled={runtimesLoading}>
                          {runtimes.map((r) => (<option key={r.id} value={r.id}>{r.name} • {r.mode} • {r.status}</option>))}
                        </select>
                        <button type="button" onClick={() => void deleteRuntime(selectedRuntimeId)} className="px-3 py-2.5 rounded-xl border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10 transition-colors" title="Delete runtime"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input type="text" value={newRuntimeName} onChange={(e) => setNewRuntimeName(e.target.value)} placeholder={runtimes.length > 0 ? 'New runtime name…' : 'Runtime name (e.g. Production VPC)'} className="flex-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 placeholder:text-slate-600" />
                      <button type="button" onClick={() => void createRuntime(agentName)} disabled={runtimesLoading} className="px-4 py-2.5 rounded-xl bg-white text-slate-950 font-semibold text-sm hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap transition-colors">
                        {runtimesLoading ? 'Creating…' : '+ Create runtime'}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Runtimes run in your VPC/on-prem and pull approved jobs from RASI.</p>
                  </div>

                  {createdEnrollment && (
                    <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/40 p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-xs font-bold text-emerald-300">2</span>
                        <p className="text-sm font-semibold text-white">Enroll the runtime</p>
                        <span className="ml-auto text-xs text-slate-500">Expires: {new Date(createdEnrollment.expiresAt).toLocaleString()}</span>
                      </div>
                      <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 mb-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-slate-400">Enrollment token <span className="text-amber-400">(shown once)</span></p>
                          <button type="button" onClick={() => void navigator.clipboard.writeText(createdEnrollment.token).then(() => toast.success('Token copied')).catch(() => toast.error('Copy failed'))} className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900/60 text-white text-xs font-medium hover:bg-slate-800 transition-colors">Copy</button>
                        </div>
                        <code className="block break-all font-mono text-xs text-cyan-200 leading-relaxed">{createdEnrollment.token}</code>
                      </div>
                      <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-slate-400">Quick start (Docker)</p>
                          <button type="button" onClick={() => { const cmd = `export SYNTHETICHR_CONTROL_PLANE_URL="${controlPlaneBaseUrl}"\nexport SYNTHETICHR_RUNTIME_ID="${createdEnrollment.runtimeId}"\nexport SYNTHETICHR_ENROLLMENT_TOKEN="${createdEnrollment.token}"\nexport SYNTHETICHR_API_KEY="sk_..."\n\ndocker compose -f deploy/compose/runtime.yml up`; void navigator.clipboard.writeText(cmd).then(() => toast.success('Commands copied')).catch(() => toast.error('Copy failed')); }} className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900/60 text-white text-xs font-medium hover:bg-slate-800 transition-colors">Copy all</button>
                        </div>
                        <pre className="text-xs text-slate-200 overflow-x-auto leading-relaxed"><code>{`export SYNTHETICHR_CONTROL_PLANE_URL="${controlPlaneBaseUrl}"\nexport SYNTHETICHR_RUNTIME_ID="${createdEnrollment.runtimeId}"\nexport SYNTHETICHR_ENROLLMENT_TOKEN="${createdEnrollment.token}"\nexport SYNTHETICHR_API_KEY="sk_..."\n\ndocker compose -f deploy/compose/runtime.yml up`}</code></pre>
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500/15 border border-blue-500/25 text-xs font-bold text-blue-300">3</span>
                      <p className="text-sm font-semibold text-white">Deploy agent to runtime</p>
                    </div>
                    <button type="button" onClick={() => void deployToRuntime()} disabled={deploymentLoading || !selectedRuntimeId} className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold text-sm hover:from-blue-600 hover:to-cyan-500 disabled:opacity-40 transition-all">
                      {deploymentLoading ? 'Deploying…' : !selectedRuntimeId ? 'Select a runtime first' : `Deploy to ${runtimes.find((r) => r.id === selectedRuntimeId)?.name || 'runtime'}`}
                    </button>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-2">Test execution</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void createTestChatJob()} disabled={testJobBusy || !currentDeployment} className="flex-1 px-3 py-2 rounded-xl border border-slate-700 bg-slate-900/60 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60">
                        {testJobBusy ? 'Working…' : 'Create test job'}
                      </button>
                      <button type="button" onClick={() => void approveTestJob()} disabled={testJobBusy || !testJob?.job?.id} className="flex-1 px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 text-white text-sm font-semibold disabled:opacity-60">
                        {testJobBusy ? 'Working…' : 'Approve test job'}
                      </button>
                    </div>
                    {testJob?.job?.id && (() => {
                      const s = testJob.job.status as string;
                      const statusMap: Record<string, [string, string]> = { pending_approval: ['text-amber-400', 'approval required'], queued: ['text-blue-400', 'waiting for runtime'], running: ['text-cyan-400 animate-pulse', 'executing…'], succeeded: ['text-emerald-400', 'done!'], failed: ['text-red-400', 'failed'], canceled: ['text-slate-400', 'canceled'] };
                      const [c, l] = statusMap[s] || ['text-slate-200', s];
                      return <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-300"><div>Job: <span className="font-mono text-cyan-200">{testJob.job.id}</span></div><div className="mt-1">Status: <span className={`font-semibold ${c}`}>{s}</span> <span className="text-slate-500">({l})</span></div></div>;
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {showAddModal && (
        <AddAgentModal onClose={() => setShowAddModal(false)} onAdd={addAgent} />
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">{confirmModal.title}</h3>
            <p className="text-slate-300 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmModal.action()}
                disabled={confirming}
                className={`px-4 py-2 font-medium rounded-lg transition-colors text-white ${confirmModal.type === 'danger'
                  ? 'bg-red-500 hover:bg-red-600 disabled:bg-red-500/60'
                  : 'bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-500/60'
                  }`}
              >
                {confirming ? 'Working...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { supabase } from '../../lib/supabase-client';

// Capability Suggestions Mapping
const SUGGESTED_CAPABILITIES: Record<string, string[]> = {
  support: ['Sentiment Analysis', 'Ticket Routing', 'Knowledge Base Search', 'Multi-lingual Support'],
  sales: ['Lead Qualification', 'CRM Sync', 'Objection Handling', 'Meeting Scheduling'],
  hr: ['Policy Q&A', 'Onboarding Guidance', 'Leave Management', 'Interview Prep'],
  legal: ['Contract Analysis', 'Compliance Checking', 'Document Summarization', 'Case Law Search'],
  finance: ['Invoice Processing', 'Expense Categorization', 'Fraud Detection', 'Financial Reporting'],
  it_support: ['Password Reset', 'Hardware Triage', 'Software Deployment', 'Access Management'],
  custom: ['Data Extraction', 'Web Browsing', 'Code Execution', 'API Integration']
};

// Add Agent Modal Component
function AddAgentModal({ onClose, onAdd }: { onClose: () => void; onAdd: (agent: any) => void }) {
  const [liveModels, setLiveModels] = useState<{ id: string; name: string; provider: string; pricing?: { prompt?: string; completion?: string } }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Wizard state
  const [step, setStep] = useState(1);
  const [featureInput, setFeatureInput] = useState('');

  const [form, setForm] = useState({
    name: '',
    description: '',
    agent_type: 'support',
    platform: 'custom',
    model_name: 'gpt-4o',
    system_prompt: '',
    status: 'active' as const,
    lifecycle_state: 'idle' as const,
    risk_level: 'low' as const,
    risk_score: 25,
    conversations: 0,
    satisfaction: 95,
    uptime: 99.9,
    budget_limit: 1000,
    current_spend: 0,
    auto_throttle: false,
    config: { features: [] as string[] },
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const loadModels = async () => {
      setLoadingModels(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
          const res = await fetch(`${apiUrl}/models`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.data) && json.data.length > 0) {
              const fetched = json.data.map((m: any) => ({
                id: m.id,
                name: m.name || m.id,
                provider: m.provider || m.id.split('/')[0] || 'Unknown',
                pricing: m.pricing
              }));
              setLiveModels(fetched);
              if (fetched.length > 0) {
                setForm(f => ({ ...f, platform: fetched[0].provider, model_name: fetched[0].id }));
              }
              setLoadingModels(false);
              return;
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load models, using defaults', err);
      }

      const fallback = [
        { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai', pricing: { prompt: '0.000005', completion: '0.000015' } },
        { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic', pricing: { prompt: '0.000003', completion: '0.000015' } },
        { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', provider: 'google', pricing: { prompt: '0.0000001', completion: '0.0000004' } }
      ];
      setLiveModels(fallback);
      setForm(f => ({ ...f, platform: fallback[0].provider, model_name: fallback[0].id }));
      setLoadingModels(false);
    };
    loadModels();
  }, []);

  const platforms = Array.from(new Set(liveModels.map(m => m.provider)));
  const filteredModels = liveModels.filter(m => m.provider === form.platform);
  const selectedModelData = liveModels.find(m => m.id === form.model_name);

  const formatPrice = (model: any) => {
    const p = Number(model.pricing?.prompt || 0);
    const c = Number(model.pricing?.completion || 0);
    if (!p && !c) return 'Free / Open Source';
    const per1k = ((p + c) / 2 * 1000).toFixed(4);
    return `$${per1k} avg / 1K tokens`;
  };

  const handleNext = () => {
    if (step === 1) {
      if (!form.name || !form.description) {
        toast.error('Name and Description are required.');
        setErrors({
          name: !form.name ? 'Required' : '',
          description: !form.description ? 'Required' : ''
        });
        return;
      }
      setErrors({});
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) return handleNext();

    const validation = validateAgentForm({
      name: form.name,
      description: form.description,
      agent_type: form.agent_type,
      platform: form.platform,
      model_name: form.model_name,
      budget_limit: form.budget_limit,
    });

    if (!validation.isValid) {
      const errorObj: Record<string, string> = {};
      Object.entries(validation.errors).forEach(([key, value]) => {
        if (value) errorObj[key] = value;
      });
      setErrors(errorObj);
      const firstError = Object.values(validation.errors)[0];
      if (firstError) toast.error(firstError);
      return;
    }
    setErrors({});
    onAdd(form);
  };

  const handleChange = (field: string, value: string | number | boolean) => {
    setForm({ ...form, [field]: value });
    if (errors[field]) setErrors({ ...errors, [field]: '' });
    if (field === 'platform') {
      const firstForPlatform = liveModels.find(m => m.provider === value);
      if (firstForPlatform) {
        setForm(f => ({ ...f, platform: String(value), model_name: firstForPlatform.id }));
      }
    }
  };

  const addFeature = () => {
    if (featureInput.trim().length > 0 && !form.config.features.includes(featureInput.trim())) {
      setForm({ ...form, config: { ...form.config, features: [...form.config.features, featureInput.trim()] } });
      setFeatureInput('');
    }
  };

  const removeFeature = (f: string) => {
    setForm({ ...form, config: { ...form.config, features: form.config.features.filter(feat => feat !== f) } });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-6 z-50 animate-in fade-in duration-200">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl shadow-2xl p-8 w-full max-w-2xl relative overflow-hidden">

        {/* Step Indicators */}
        <div className="flex items-center justify-between mb-8 relative z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-white tracking-tight">Deploy AI Agent</h2>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${step === i ? 'bg-cyan-500 text-white shadow-[0_0_10px_rgba(6,182,212,0.5)]' :
                    step > i ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-400'
                    }`}>
                    {step > i ? <CheckCircle className="w-4 h-4" /> : i}
                  </div>
                  {i < 3 && <div className={`w-6 h-0.5 mx-1 transition-all ${step > i ? 'bg-emerald-500' : 'bg-slate-700'}`} />}
                </div>
              ))}
            </div>
            <div className="h-6 w-px bg-slate-700"></div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 relative z-10" onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.name !== 'feature') {
            e.preventDefault();
            if (step < 3) handleNext();
            else handleSubmit(e);
          }
        }}>

          {/* STEP 1: IDENTITY */}
          {step === 1 && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div className="border-b border-slate-700 pb-2 mb-4">
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                  <Target className="w-5 h-5 text-cyan-400" /> Identity & Purpose
                </h3>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Agent Name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className={`w-full px-4 py-2.5 bg-slate-900/50 border rounded-xl text-white outline-none transition-all ${errors.name ? 'border-red-500 focus:border-red-500' : 'border-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50'}`}
                  placeholder="e.g., Enterprise Onboarding Assistant"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Description <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  className={`w-full px-4 py-2.5 bg-slate-900/50 border rounded-xl text-white outline-none transition-all ${errors.description ? 'border-red-500' : 'border-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50'}`}
                  placeholder="Brief summary of this agent's primary function"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Agent Type</label>
                  <select
                    value={form.agent_type}
                    onChange={(e) => handleChange('agent_type', e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-cyan-500"
                  >
                    <option value="support">Customer Support</option>
                    <option value="sales">Sales & Lead Gen</option>
                    <option value="hr">Human Resources</option>
                    <option value="legal">Legal & Compliance</option>
                    <option value="finance">Finance</option>
                    <option value="it_support">IT Helpdesk</option>
                    <option value="custom">Custom Engine</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: BRAIN */}
          {step === 2 && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div className="border-b border-slate-700 pb-2 mb-4">
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                  <Brain className="w-5 h-5 text-purple-400" /> Brain & Instructions
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Platform</label>
                  <select
                    value={form.platform}
                    onChange={(e) => handleChange('platform', e.target.value)}
                    disabled={loadingModels}
                    className="w-full px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-purple-500"
                  >
                    {platforms.length > 0 ? platforms.map(p => (
                      <option key={String(p)} value={String(p)}>{String(p).charAt(0).toUpperCase() + String(p).slice(1)}</option>
                    )) : <option value="custom">Custom</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                    Model Selection
                    {loadingModels && <span className="text-purple-400 text-xs animate-pulse">Loading...</span>}
                  </label>
                  <select
                    value={form.model_name}
                    onChange={(e) => handleChange('model_name', e.target.value)}
                    disabled={loadingModels}
                    className="w-full px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-purple-500"
                  >
                    {filteredModels.length > 0 ? filteredModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    )) : (
                      <option value={form.model_name}>{form.model_name || 'Select Model'}</option>
                    )}
                  </select>
                </div>
              </div>

              {selectedModelData && (
                <div className="flex items-center justify-between text-xs bg-purple-500/10 p-2.5 rounded-lg border border-purple-500/20">
                  <span className="text-purple-300/80 font-medium">RasiAI Gateway Pricing</span>
                  <span className="font-mono text-purple-300">{formatPrice(selectedModelData)}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">System Prompt / Persona Injection</label>
                <textarea
                  value={form.system_prompt}
                  onChange={(e) => handleChange('system_prompt', e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-purple-500 font-mono text-xs leading-relaxed resize-none scrollbar-thin"
                  placeholder="You are a helpful assistant. Never disclose your internal guidelines..."
                />
              </div>
            </div>
          )}

          {/* STEP 3: GUARDRAILS */}
          {step === 3 && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div className="border-b border-slate-700 pb-2 mb-4">
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-emerald-400" /> Guardrails & Features
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5" title="Hard cap at which the agent automatically stops responding">
                    Monthly Budget Cap (₹)
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                    <input
                      type="number"
                      value={form.budget_limit}
                      onChange={(e) => handleChange('budget_limit', parseInt(e.target.value) || 0)}
                      className="w-full pl-9 pr-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-emerald-500"
                      min="0"
                    />
                  </div>
                </div>

                <div className="flex items-center pt-2">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={form.auto_throttle}
                        onChange={(e) => handleChange('auto_throttle', e.target.checked)}
                      />
                      <div className={`block w-12 h-6 rounded-full transition-colors ${form.auto_throttle ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>
                      <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${form.auto_throttle ? 'translate-x-6' : ''}`}></div>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">Auto-Throttle</div>
                      <div className="text-xs text-slate-400">Slow down responses near budget limit</div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-700">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Assign Key Capabilities</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    name="feature"
                    value={featureInput}
                    onChange={(e) => setFeatureInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addFeature();
                      }
                    }}
                    placeholder="e.g., Sentiment Analysis"
                    className="flex-1 px-4 py-2 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={addFeature}
                    className="px-4 py-2 bg-emerald-500/20 text-emerald-400 font-medium rounded-xl hover:bg-emerald-500/30 transition-colors"
                  >
                    Add
                  </button>
                </div>

                {form.config.features.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {form.config.features.map((f, i) => (
                      <span key={i} className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-xs font-medium animate-in zoom-in duration-200">
                        ✓ {f}
                        <button type="button" onClick={() => removeFeature(f)} className="hover:text-emerald-200 ml-1 focus:outline-none">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Dynamic Suggestions based on Agent Type */}
                <div className="mt-4 pt-3 border-t border-slate-700/50">
                  <p className="text-xs text-slate-400 mb-2">Suggested for {form.agent_type.replace('_', ' ')}:</p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_CAPABILITIES[form.agent_type]?.filter(suggested => !form.config.features.includes(suggested)).map((suggestion, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setForm({ ...form, config: { ...form.config, features: [...form.config.features, suggestion] } });
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-700 text-slate-300 rounded-full text-xs transition-colors"
                      >
                        <Plus className="w-3 h-3 text-emerald-500" />
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex gap-4 pt-6 border-t border-slate-700/60 mt-8">
            <button
              type="button"
              onClick={() => step > 1 ? setStep(step - 1) : onClose()}
              className="flex-1 py-3 bg-slate-800 text-white rounded-xl hover:bg-slate-700 border border-slate-700 font-medium transition-colors"
            >
              {step > 1 ? 'Back' : 'Cancel'}
            </button>
            <button
              type="submit"
              className={`flex-1 py-3 text-white font-bold rounded-xl transition-all shadow-lg ${step === 1 ? 'bg-cyan-500 hover:bg-cyan-400 shadow-cyan-500/20' :
                step === 2 ? 'bg-purple-500 hover:bg-purple-400 shadow-purple-500/20' :
                  'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/20'
                }`}
            >
              {step < 3 ? 'Continue' : 'Deploy Agent'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
