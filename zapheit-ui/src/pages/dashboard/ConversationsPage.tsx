import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Brain,
  ChevronRight,
  Cpu,
  Globe,
  KeyRound,
  Loader2,
  MessageSquare,
  PanelRight,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type { AIAgent } from '../../types';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { LightMarkdown } from '../../components/markdown/LightMarkdown';
import { AGENT_TEMPLATES, type AgentTemplate } from '../../config/agentTemplates';
import { loadFromStorage, removeFromStorage, saveToStorage, STORAGE_KEYS } from '../../utils/storage';

type ReasoningTrace = {
  id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  latency_ms: number;
  risk_score: number | null;
  response_entropy: number | null;
  tool_calls: Array<{ name: string; arguments: string; result?: string; latency_ms?: number }>;
  interceptors_applied: string[];
  policy_violations: Array<{ policy_name: string; rule: string; action_taken: string }>;
  created_at: string;
};

interface ConversationsPageProps {
  agents: AIAgent[];
  onNavigate?: (page: string) => void;
  initialAgentId?: string | null;
}

type ChatRuntimeSource = 'managed' | 'provider_key' | 'gateway_key';
type BillingMode = 'managed' | 'byok_provider' | 'gateway_key';
type SessionType = 'standard' | 'governed';
type ProfileKind = 'provider' | 'gateway';
type ProviderType = 'openai' | 'anthropic' | 'openrouter' | 'zapheit_gateway';

type RuntimeProfile = {
  id: string;
  kind: ProfileKind;
  provider: ProviderType;
  label: string;
  status: 'active' | 'revoked';
  maskedKey: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastUsedAt: string | null;
};

type TemplateChatLaunchContext = {
  agentId: string;
  templateId: string;
  prompt?: string;
  appService?: string | null;
  mode?: 'operator' | 'employee' | 'external';
};

type ModelOption = {
  id: string;
  name: string;
  provider: string;
};

type ConnectedAppOption = {
  id: string;
  label: string;
  service: string;
};

type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokenCount: number;
  createdAt: string;
};

type ConversationRecord = {
  id: string;
  sessionType: SessionType;
  agentId: string | null;
  agentName: string | null;
  runtimeSource: ChatRuntimeSource | null;
  runtimeLabel: string | null;
  model: string | null;
  billingMode: BillingMode | null;
  topic: string;
  timestamp: string;
  preview: string;
  messages?: ConversationMessage[];
};

type ActiveChatSession = {
  session_id: string;
  session_type: 'standard_chat_session' | 'governed_chat_session';
  mode: 'operator' | 'employee' | 'external';
  runtime_source?: ChatRuntimeSource;
  runtime_profile_id?: string | null;
  runtime_label?: string | null;
  model?: string | null;
  billing_mode?: BillingMode;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_usd?: number | null;
  } | null;
  agent_id?: string | null;
  template_id?: string | null;
  source?: 'apps' | 'chat' | 'template';
  source_ref?: string | null;
  job_id?: string | null;
  governed_execution?: any | null;
  approval_summary?: any | null;
  audit_ref?: string | null;
  cost_status?: any | null;
  incident_ref?: string | null;
};

const INCIDENT_CONTEXT_STORAGE_KEY = 'synthetic_hr_incident_context';
const AGENT_WORKSPACE_FOCUS_STORAGE_KEY = 'synthetic_hr_agent_workspace_focus';
const TEMPLATE_CHAT_CONTEXT_STORAGE_KEY = STORAGE_KEYS.TEMPLATE_CHAT_CONTEXT;
const RUNTIME_PROFILES_STORAGE_KEY = STORAGE_KEYS.CHAT_RUNTIME_PROFILES;
const CHAT_PREFERENCES_STORAGE_KEY = STORAGE_KEYS.CHAT_PREFERENCES;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeTopic(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 'New chat';
  const firstSentence = trimmed.split(/[.!?]/)[0] || trimmed;
  return firstSentence.slice(0, 64);
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeDate(value?: string | null) {
  if (!value) return 'Just now';
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function formatCost(costStatus: any) {
  if (!costStatus) return 'Not available yet';
  if (costStatus.state === 'captured' && typeof costStatus.amount === 'number') {
    return `${costStatus.amount.toFixed(4)} ${costStatus.currency || 'USD'}`;
  }
  return costStatus.reason || costStatus.state || 'Not available yet';
}

function governanceLabel(status?: string | null) {
  if (!status) return 'Not started';
  return status.replace(/_/g, ' ');
}

function isTerminalJobStatus(status?: string | null) {
  return ['succeeded', 'failed', 'canceled', 'cancelled', 'pending_approval'].includes(String(status || '').toLowerCase());
}

function getAgentName(agents: AIAgent[], agentId?: string | null) {
  return agents.find((agent) => agent.id === agentId)?.name || null;
}

function starterPromptSet(template: AgentTemplate | null) {
  if (template?.samplePrompts?.length) {
    return template.samplePrompts.slice(0, 4);
  }
  return [
    'Summarize the meeting notes into an action list.',
    'Draft a concise product update for the leadership team.',
    'Help me compare two approaches and recommend one.',
    'Turn this rough idea into a polished business email.',
  ];
}

function runtimeSourceLabel(source: ChatRuntimeSource) {
  if (source === 'managed') return 'Zapheit Managed';
  if (source === 'provider_key') return 'My Provider Key';
  return 'My Zapheit Gateway Key';
}

function billingModeLabel(mode?: BillingMode | null) {
  if (mode === 'byok_provider') return 'Provider billed';
  if (mode === 'gateway_key') return 'Gateway key';
  return 'Zapheit managed';
}

function inferSessionType(raw: any): SessionType {
  const metadata = raw?.metadata || {};
  if (metadata.session_type === 'standard_chat_session') return 'standard';
  if (metadata.session_type === 'governed_chat_session') return 'governed';
  if (raw?.agent_id || metadata.template_id || metadata.app_target) return 'governed';
  return 'standard';
}

function normalizeConversation(raw: any, agents: AIAgent[]): ConversationRecord {
  const metadata = raw?.metadata || {};
  const preview =
    metadata.preview ||
    metadata.last_user_message ||
    metadata.summary ||
    'No message preview yet';
  const sessionType = inferSessionType(raw);

  return {
    id: raw.id,
    sessionType,
    agentId: raw.agent_id || null,
    agentName: getAgentName(agents, raw.agent_id),
    runtimeSource: metadata.runtime_source || null,
    runtimeLabel: metadata.runtime_label || null,
    model: metadata.model || null,
    billingMode: metadata.billing_mode || null,
    topic: metadata.topic || summarizeTopic(preview),
    timestamp: raw.started_at || raw.created_at || new Date().toISOString(),
    preview,
  };
}

function normalizeConversationDetail(raw: any, agents: AIAgent[]): ConversationRecord {
  const base = normalizeConversation(raw, agents);
  const messages: ConversationMessage[] = Array.isArray(raw?.messages)
    ? raw.messages.map((message: any) => ({
        id: message.id,
        role: message.role || 'user',
        content: message.content || '',
        tokenCount: Number(message.token_count || 0),
        createdAt: message.created_at || raw.started_at || new Date().toISOString(),
      }))
    : [];

  return {
    ...base,
    messages,
    preview: messages.find((message) => message.role === 'assistant')?.content || base.preview,
  };
}

function mapConnectedApp(item: any): ConnectedAppOption | null {
  const status = String(item?.status || item?.connection_status || item?.state || '').toLowerCase();
  const isConnected = ['connected', 'active', 'healthy', 'ok'].includes(status) || item?.connected === true;
  if (!isConnected) return null;
  const service = String(item?.service || item?.appId || item?.provider || item?.id || '').trim();
  if (!service) return null;
  return {
    id: String(item?.id || item?.appId || service),
    label: String(item?.name || item?.label || item?.display_name || service),
    service,
  };
}

function inferProfileModels(profile: RuntimeProfile | null, allModels: ModelOption[]) {
  if (!profile) return [];
  if (profile.kind === 'gateway' || profile.provider === 'openrouter') return allModels;
  return allModels.filter((model) => model.id.startsWith(`${profile.provider}/`));
}

function buildStandardSessionFromConversation(conversation: ConversationRecord): ActiveChatSession {
  return {
    session_id: conversation.id,
    session_type: 'standard_chat_session',
    mode: 'operator',
    runtime_source: conversation.runtimeSource || 'managed',
    runtime_label: conversation.runtimeLabel,
    model: conversation.model,
    billing_mode: conversation.billingMode || 'managed',
    usage: null,
  };
}

export default function ConversationsPage({ agents, onNavigate, initialAgentId }: ConversationsPageProps) {
  const [conversationList, setConversationList] = useState<ConversationRecord[]>([]);
  const [conversationCache, setConversationCache] = useState<Record<string, ConversationRecord>>({});
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailTab, setDetailTab] = useState<'transcript' | 'trace'>('transcript');
  const [traces, setTraces] = useState<ReasoningTrace[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [connectedApps, setConnectedApps] = useState<ConnectedAppOption[]>([]);
  const [composeText, setComposeText] = useState('');
  const [chatMode, setChatMode] = useState<'operator' | 'employee' | 'external'>('operator');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamAbortController, setStreamAbortController] = useState<AbortController | null>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollBottomRef = useRef<HTMLDivElement>(null);
  const [freshStart, setFreshStart] = useState(false);
  const [governedPanelOpen, setGovernedPanelOpen] = useState(false);
  const [governedEnabled, setGovernedEnabled] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(initialAgentId || '');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedAppService, setSelectedAppService] = useState('');
  const [activeSession, setActiveSession] = useState<ActiveChatSession | null>(null);
  const [runtimeSource, setRuntimeSource] = useState<ChatRuntimeSource>('managed');
  const [runtimeProfiles, setRuntimeProfiles] = useState<RuntimeProfile[]>([]);
  const [runtimeProfilesLoading, setRuntimeProfilesLoading] = useState(false);
  const [selectedRuntimeProfileId, setSelectedRuntimeProfileId] = useState<string>('');
  const [modelsCatalog, setModelsCatalog] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [gatewayModels, setGatewayModels] = useState<Record<string, ModelOption[]>>({});
  const [selectedModelId, setSelectedModelId] = useState<string>('openai/gpt-4o-mini');
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [newProfileKind, setNewProfileKind] = useState<ProfileKind>('provider');
  const [newProfileProvider, setNewProfileProvider] = useState<ProviderType>('openai');
  const [newProfileLabel, setNewProfileLabel] = useState('');
  const [newProfileApiKey, setNewProfileApiKey] = useState('');
  const [templateLaunchContext, setTemplateLaunchContext] = useState<TemplateChatLaunchContext | null>(null);
  const [governedPollAttempt, setGovernedPollAttempt] = useState(0);
  const [governedPollAbort, setGovernedPollAbort] = useState<AbortController | null>(null);

  const selectedTemplate = useMemo(
    () => AGENT_TEMPLATES.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId],
  );
  const starterPrompts = useMemo(() => starterPromptSet(selectedTemplate), [selectedTemplate]);
  const selectedRuntimeProfile = useMemo(
    () => runtimeProfiles.find((profile) => profile.id === selectedRuntimeProfileId) || null,
    [runtimeProfiles, selectedRuntimeProfileId],
  );
  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return conversationList.filter((conversation) => {
      if (!query) return true;
      return [
        conversation.topic,
        conversation.preview,
        conversation.agentName || '',
        conversation.runtimeLabel || '',
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [conversationList, searchQuery]);
  const selectedConversation = selectedConversationId
    ? (conversationCache[selectedConversationId] || conversationList.find((conversation) => conversation.id === selectedConversationId) || null)
    : null;
  const availableModels = useMemo(() => {
    if (runtimeSource === 'gateway_key') {
      return selectedRuntimeProfile ? (gatewayModels[selectedRuntimeProfile.id] || []) : [];
    }
    if (runtimeSource === 'provider_key') {
      return inferProfileModels(selectedRuntimeProfile, modelsCatalog);
    }
    return modelsCatalog;
  }, [gatewayModels, modelsCatalog, runtimeSource, selectedRuntimeProfile]);
  const selectedApp = useMemo(
    () => connectedApps.find((app) => app.service === selectedAppService) || null,
    [connectedApps, selectedAppService],
  );

  const loadConversations = useCallback(async () => {
    setLoading(true);
    const response = await api.conversations.getAll({ limit: 100 });
    if (!response.success || !Array.isArray(response.data)) {
      setConversationList([]);
      setLoading(false);
      return;
    }

    const normalized = response.data.map((item) => normalizeConversation(item, agents));
    setConversationList(normalized);
    setLoading(false);
    if (!selectedConversationId && !freshStart && normalized.length > 0) {
      setSelectedConversationId(normalized[0].id);
    }
  }, [agents, freshStart, selectedConversationId]);

  const loadConnectedApps = useCallback(async () => {
    const response = await api.integrations.getAppsInventory();
    if (!response.success || !Array.isArray(response.data)) return;
    const apps = response.data.map(mapConnectedApp).filter(Boolean) as ConnectedAppOption[];
    setConnectedApps(apps);
  }, []);

  const loadManagedModels = useCallback(async () => {
    setModelsLoading(true);
    const response = await api.dashboard.listModels();
    if (response.success && Array.isArray(response.data)) {
      setModelsCatalog(response.data.map((model) => ({
        id: model.id,
        name: model.name || model.id,
        provider: model.provider || model.id.split('/')[0] || 'unknown',
      })));
    }
    setModelsLoading(false);
  }, []);

  const loadRuntimeProfiles = useCallback(async () => {
    setRuntimeProfilesLoading(true);
    const response = await api.chatProfiles.list();
    if (response.success && Array.isArray(response.data)) {
      setRuntimeProfiles(response.data.map((profile) => ({
        id: profile.id,
        kind: profile.kind,
        provider: profile.provider,
        label: profile.label,
        status: profile.status,
        maskedKey: profile.masked_key,
        createdAt: profile.created_at || null,
        updatedAt: profile.updated_at || null,
        lastUsedAt: profile.last_used_at || null,
      })));
    } else if (!response.success) {
      toast.error(response.error || 'Failed to load chat runtime profiles');
    }
    setRuntimeProfilesLoading(false);
  }, []);

  const loadGatewayModels = useCallback(async (profile: RuntimeProfile) => {
    if (gatewayModels[profile.id]) return;
    const response = await api.chatProfiles.listModels(profile.id);
    if (!response.success || !response.data?.data) {
      toast.error(response.error || 'Failed to load gateway models');
      return;
    }
    const models = response.data.data.map((item: any) => ({
      id: item.id,
      name: item.id,
      provider: item.id.split('/')[0] || 'gateway',
    }));
    setGatewayModels((current) => ({ ...current, [profile.id]: models }));
  }, [gatewayModels]);

  const openConversation = useCallback(async (conversationId: string) => {
    setSelectedConversationId(conversationId);
    const cached = conversationCache[conversationId];
    if (cached?.messages) {
      if (cached.sessionType === 'standard') setActiveSession(buildStandardSessionFromConversation(cached));
      return;
    }

    const response = await api.conversations.getById(conversationId);
    if (!response.success || !response.data) {
      toast.error(response.error || 'Failed to load conversation');
      return;
    }
    const detail = normalizeConversationDetail(response.data, agents);
    setConversationCache((current) => ({ ...current, [conversationId]: detail }));
    setConversationList((current) => current.map((conversation) => conversation.id === conversationId ? detail : conversation));
    if (detail.sessionType === 'standard') {
      setActiveSession(buildStandardSessionFromConversation(detail));
    }
  }, [agents, conversationCache]);

  const refreshConversation = useCallback(async (conversationId: string) => {
    const response = await api.conversations.getById(conversationId);
    if (!response.success || !response.data) return;
    const detail = normalizeConversationDetail(response.data, agents);
    setConversationCache((current) => ({ ...current, [conversationId]: detail }));
    setConversationList((current) => {
      const next = current.some((conversation) => conversation.id === conversationId)
        ? current.map((conversation) => conversation.id === conversationId ? detail : conversation)
        : [detail, ...current];
      return next.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
    });
  }, [agents]);

  const resetComposer = useCallback(() => {
    setSelectedConversationId(null);
    setComposeText('');
    setActiveSession(null);
    setDetailTab('transcript');
    setTraces([]);
    setFreshStart(true);
  }, []);

  useEffect(() => {
    void loadConversations();
    void loadConnectedApps();
    void loadManagedModels();
    void loadRuntimeProfiles();
  }, [loadConnectedApps, loadConversations, loadManagedModels, loadRuntimeProfiles]);

  useEffect(() => {
    removeFromStorage(RUNTIME_PROFILES_STORAGE_KEY);
    const preferences = loadFromStorage<{
      runtimeSource?: ChatRuntimeSource;
      runtimeProfileId?: string;
      modelId?: string;
      governedPanelOpen?: boolean;
    }>(CHAT_PREFERENCES_STORAGE_KEY, {});
    if (preferences.runtimeSource) setRuntimeSource(preferences.runtimeSource);
    if (preferences.runtimeProfileId) setSelectedRuntimeProfileId(preferences.runtimeProfileId);
    if (preferences.modelId) setSelectedModelId(preferences.modelId);
    if (typeof preferences.governedPanelOpen === 'boolean') setGovernedPanelOpen(preferences.governedPanelOpen);

    const launchContext = loadFromStorage<TemplateChatLaunchContext | null>(TEMPLATE_CHAT_CONTEXT_STORAGE_KEY, null);
    if (launchContext) {
      setTemplateLaunchContext(launchContext);
      removeFromStorage(TEMPLATE_CHAT_CONTEXT_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    saveToStorage(CHAT_PREFERENCES_STORAGE_KEY, {
      runtimeSource,
      runtimeProfileId: selectedRuntimeProfileId,
      modelId: selectedModelId,
      governedPanelOpen,
    });
  }, [governedPanelOpen, runtimeSource, selectedModelId, selectedRuntimeProfileId]);

  useEffect(() => {
    if (runtimeSource === 'gateway_key' && selectedRuntimeProfile) {
      void loadGatewayModels(selectedRuntimeProfile);
    }
  }, [loadGatewayModels, runtimeSource, selectedRuntimeProfile]);

  useEffect(() => {
    if (availableModels.length === 0) return;
    if (!availableModels.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(availableModels[0].id);
    }
  }, [availableModels, selectedModelId]);

  useEffect(() => {
    if (agents.length === 0) return;
    if (templateLaunchContext?.agentId) {
      setSelectedAgentId(templateLaunchContext.agentId);
      return;
    }
    if (initialAgentId) {
      setSelectedAgentId(initialAgentId);
      return;
    }
    const workspaceFocus = loadFromStorage<{ agentId?: string } | null>(AGENT_WORKSPACE_FOCUS_STORAGE_KEY, null);
    if (workspaceFocus?.agentId) {
      setSelectedAgentId(workspaceFocus.agentId);
      return;
    }
    setSelectedAgentId((current) => current || agents[0]?.id || '');
  }, [agents, initialAgentId, templateLaunchContext]);

  useEffect(() => {
    const incidentContext = loadFromStorage<{ incidentId?: string; agentId?: string } | null>(INCIDENT_CONTEXT_STORAGE_KEY, null);
    if (!incidentContext) return;
    if (incidentContext.agentId) {
      setSelectedAgentId(incidentContext.agentId);
      setGovernedPanelOpen(true);
      setGovernedEnabled(true);
    }
    removeFromStorage(INCIDENT_CONTEXT_STORAGE_KEY);
  }, []);

  useEffect(() => {
    if (!templateLaunchContext) return;
    setGovernedPanelOpen(true);
    setGovernedEnabled(true);
    setChatMode(templateLaunchContext.mode || 'operator');
    setSelectedTemplateId(templateLaunchContext.templateId || '');
    setComposeText(templateLaunchContext.prompt || '');
    if (templateLaunchContext.appService && connectedApps.some((app) => app.service === templateLaunchContext.appService)) {
      setSelectedAppService(templateLaunchContext.appService);
    }
    resetComposer();
    setComposeText(templateLaunchContext.prompt || '');
    setTemplateLaunchContext(null);
  }, [connectedApps, resetComposer, templateLaunchContext]);

  useEffect(() => {
    if (!selectedConversationId && !freshStart && filteredConversations.length > 0) {
      setSelectedConversationId(filteredConversations[0].id);
    }
  }, [filteredConversations, freshStart, selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId) return;
    void openConversation(selectedConversationId);
  }, [openConversation, selectedConversationId]);

  useEffect(() => {
    if (detailTab !== 'trace' || !selectedConversationId) return;
    let cancelled = false;
    const loadTraces = async () => {
      setTracesLoading(true);
      const response = await api.conversations.getTrace(selectedConversationId);
      if (cancelled) return;
      if (response.success && Array.isArray(response.data)) {
        setTraces(response.data as ReasoningTrace[]);
      } else {
        setTraces([]);
      }
      setTracesLoading(false);
    };
    void loadTraces();
    return () => {
      cancelled = true;
    };
  }, [detailTab, selectedConversationId]);

  const saveProfiles = (profiles: RuntimeProfile[]) => {
    setRuntimeProfiles(profiles);
  };

  const handleAddProfile = async () => {
    const label = newProfileLabel.trim();
    const apiKey = newProfileApiKey.trim();
    if (!label || !apiKey) {
      toast.error('Profile label and API key are required');
      return;
    }

    const response = await api.chatProfiles.create({
      kind: newProfileKind,
      provider: newProfileKind === 'gateway' ? 'zapheit_gateway' : newProfileProvider,
      label,
      api_key: apiKey,
    });

    if (!response.success || !response.data) {
      toast.error(response.error || 'Failed to save chat runtime profile');
      return;
    }

    const profile: RuntimeProfile = {
      id: response.data.id,
      kind: response.data.kind,
      provider: response.data.provider,
      label: response.data.label,
      status: response.data.status,
      maskedKey: response.data.masked_key,
      createdAt: response.data.created_at || null,
      updatedAt: response.data.updated_at || null,
      lastUsedAt: response.data.last_used_at || null,
    };
    const next = [profile, ...runtimeProfiles.filter((item) => item.id !== profile.id)];
    saveProfiles(next);
    setSelectedRuntimeProfileId(profile.id);
    setNewProfileLabel('');
    setNewProfileApiKey('');
    setShowCredentialModal(false);
    toast.success('Chat runtime profile saved securely');
  };

  const handleDeleteProfile = async (profileId: string) => {
    const response = await api.chatProfiles.remove(profileId);
    if (!response.success) {
      toast.error(response.error || 'Failed to delete chat runtime profile');
      return;
    }
    const next = runtimeProfiles.filter((profile) => profile.id !== profileId);
    saveProfiles(next);
    if (selectedRuntimeProfileId === profileId) setSelectedRuntimeProfileId('');
  };

  const pollGovernedJobUntilSettled = useCallback(async (jobId: string, conversationId: string) => {
    const controller = new AbortController();
    setGovernedPollAbort(controller);
    setGovernedPollAttempt(0);

    for (let attempt = 0; attempt < 25; attempt += 1) {
      await sleep(1500);
      if (controller.signal.aborted) return;

      setGovernedPollAttempt(attempt + 1);
      const response = await api.jobs.get(jobId);
      if (!response.success || !response.data?.job) continue;
      const job = response.data.job;
      setActiveSession((current) => current ? {
        ...current,
        job_id: job.id,
        source: job.source || current.source,
        source_ref: job.source_ref || current.source_ref,
        governed_execution: job.governed_execution || current.governed_execution,
        approval_summary: job.approval_summary || current.approval_summary,
        audit_ref: job.audit_ref || current.audit_ref,
        cost_status: job.cost_status || current.cost_status,
        incident_ref: job.incident_ref || current.incident_ref,
      } : current);
      if (!isTerminalJobStatus(job.status)) continue;

      setGovernedPollAbort(null);
      setGovernedPollAttempt(0);
      await refreshConversation(conversationId);
      if (String(job.status).toLowerCase() === 'failed') {
        toast.error(job.error || 'Governed chat run failed');
      }
      if (String(job.status).toLowerCase() === 'pending_approval') {
        toast.info('This governed run is waiting for approval.');
      }
      return;
    }

    // Exhausted all attempts without a terminal status
    setGovernedPollAbort(null);
    setGovernedPollAttempt(-1); // sentinel: timed out
  }, [refreshConversation]);

  // Auto-scroll: jump to bottom when messages arrive unless user has scrolled up.
  const messageCount = selectedConversation?.messages?.length ?? 0;
  const lastMessageContent = selectedConversation?.messages?.slice(-1)[0]?.content ?? '';
  useEffect(() => {
    if (userScrolledUp) return;
    scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messageCount, lastMessageContent, userScrolledUp]);

  // Reset scroll-up flag when conversation changes.
  useEffect(() => {
    setUserScrolledUp(false);
  }, [selectedConversationId]);

  const handleScrollContainer = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setUserScrolledUp(distanceFromBottom > 80);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !streaming && !sending) {
      e.preventDefault();
      void handleSend();
    }
  // handleSend is stable enough for this dep array — recreating on every render is fine
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, sending]);

  const handleSend = async () => {
    const prompt = composeText.trim();
    if (!prompt) return;
    if (!selectedModelId && !governedEnabled) {
      toast.error('Select a model first');
      return;
    }

    setSending(true);

    if (governedEnabled) {
      if (!selectedAgentId) {
        setSending(false);
        toast.error('Select an agent before running governed mode');
        return;
      }

      const template = selectedTemplateId
        ? AGENT_TEMPLATES.find((item) => item.id === selectedTemplateId) || null
        : null;
      const selectedRecord = selectedConversationId ? (conversationCache[selectedConversationId] || conversationList.find((item) => item.id === selectedConversationId) || null) : null;
      const conversationId = selectedRecord?.sessionType === 'governed' ? selectedRecord.id : undefined;

      const response = await api.conversations.send({
        agent_id: selectedAgentId,
        prompt,
        conversation_id: conversationId,
        mode: chatMode,
        template_id: template?.id,
        template_context: template ? {
          name: template.name,
          businessPurpose: template.businessPurpose,
          riskLevel: template.riskLevel,
          approvalDefault: template.approvalDefault,
          requiredSystems: template.requiredSystems,
        } : undefined,
        app_target: selectedApp ? {
          service: selectedApp.service,
          label: selectedApp.label,
        } : undefined,
      });
      setSending(false);

      if (!response.success || !response.data) {
        toast.error(response.error || 'Failed to run governed chat');
        return;
      }

      const detail = normalizeConversationDetail(response.data.conversation, agents);
      setFreshStart(false);
      setComposeText('');
      setConversationCache((current) => ({ ...current, [detail.id]: detail }));
      setConversationList((current) => {
        const next = current.some((conversation) => conversation.id === detail.id)
          ? current.map((conversation) => conversation.id === detail.id ? detail : conversation)
          : [detail, ...current];
        return next.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
      });
      setSelectedConversationId(detail.id);
      setActiveSession({
        session_id: response.data.session?.session_id || detail.id,
        session_type: 'governed_chat_session',
        mode: response.data.session?.mode || chatMode,
        agent_id: selectedAgentId,
        template_id: template?.id || null,
        source: response.data.job?.source || response.data.session?.source || (template ? 'template' : 'chat'),
        source_ref: response.data.job?.source_ref || detail.id,
        job_id: response.data.job?.id || null,
        governed_execution: response.data.job?.governed_execution || response.data.session?.governed_execution || null,
        approval_summary: response.data.job?.approval_summary || response.data.session?.approval_summary || null,
        audit_ref: response.data.job?.audit_ref || response.data.session?.audit_ref || null,
        cost_status: response.data.job?.cost_status || response.data.session?.cost_status || null,
        incident_ref: response.data.job?.incident_ref || response.data.session?.incident_ref || null,
      });

      if (response.data.job?.id) {
        void pollGovernedJobUntilSettled(response.data.job.id, detail.id);
      }
      return;
    }

    if (runtimeSource !== 'managed' && !selectedRuntimeProfile) {
      setSending(false);
      toast.error('Select a saved runtime profile first');
      return;
    }

    let standardSessionId = selectedConversation?.sessionType === 'standard' ? selectedConversation.id : null;
    if (!standardSessionId) {
      const sessionRes = await api.conversations.createStandardSession({
        mode: chatMode,
        runtime_source: runtimeSource,
        runtime_profile_id: selectedRuntimeProfile?.id || null,
        model: selectedModelId,
      });
      if (!sessionRes.success || !sessionRes.data?.session_id) {
        setSending(false);
        toast.error(sessionRes.error || 'Failed to create chat session');
        return;
      }
      standardSessionId = sessionRes.data.session_id;
    }

    const sessionId = standardSessionId;
    const optimisticUserMsgId = `opt-user-${Date.now()}`;
    const optimisticAsstMsgId = `opt-asst-${Date.now()}`;

    // Optimistically add user + empty assistant bubble
    setConversationCache((current) => {
      const existing = current[sessionId];
      const messages = [
        ...(existing?.messages || []),
        { id: optimisticUserMsgId, role: 'user', content: prompt, created_at: new Date().toISOString() },
        { id: optimisticAsstMsgId, role: 'assistant', content: '', created_at: new Date().toISOString() },
      ];
      return { ...current, [sessionId]: { ...(existing || {}), id: sessionId, messages } as any };
    });
    setSelectedConversationId(sessionId);
    setFreshStart(false);
    setComposeText('');
    setSending(false);
    setStreaming(true);

    const controller = new AbortController();
    setStreamAbortController(controller);

    await api.conversations.streamStandardMessage(
      sessionId,
      { prompt, mode: chatMode, runtime_source: runtimeSource, runtime_profile_id: selectedRuntimeProfile?.id || null, model: selectedModelId },
      {
        signal: controller.signal,
        onDelta: (text) => {
          setConversationCache((current) => {
            const conv = current[sessionId];
            if (!conv) return current;
            const messages = (conv.messages || []).map((m: any) =>
              m.id === optimisticAsstMsgId ? { ...m, content: m.content + text } : m,
            );
            return { ...current, [sessionId]: { ...conv, messages } };
          });
        },
        onDone: (serverMessage, usage) => {
          setConversationCache((current) => {
            const conv = current[sessionId];
            if (!conv) return current;
            const messages = (conv.messages || []).map((m: any) =>
              m.id === optimisticAsstMsgId
                ? (serverMessage ? { ...serverMessage } : { ...m, content: m.content || 'No response returned.' })
                : m,
            );
            return { ...current, [sessionId]: { ...conv, messages } };
          });
          setActiveSession((prev) => prev ? { ...prev, usage } : prev);
          setStreaming(false);
          setStreamAbortController(null);
        },
        onError: (error) => {
          toast.error(error || 'Streaming failed');
          setConversationCache((current) => {
            const conv = current[sessionId];
            if (!conv) return current;
            const messages = (conv.messages || []).filter((m: any) => m.id !== optimisticAsstMsgId);
            return { ...current, [sessionId]: { ...conv, messages } };
          });
          setStreaming(false);
          setStreamAbortController(null);
        },
      },
    );
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
    const res = await api.conversations.remove(conversationId);
    if (!res.success) {
      toast.error((res as any).error || 'Failed to delete conversation');
      return;
    }
    setConversationList((prev) => prev.filter((c) => c.id !== conversationId));
    setConversationCache((prev) => { const next = { ...prev }; delete next[conversationId]; return next; });
    if (selectedConversationId === conversationId) setSelectedConversationId(null);
    toast.success('Conversation deleted');
  };

  const exportCurrentConversation = () => {
    if (!selectedConversation?.messages?.length) return;
    const content = selectedConversation.messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${selectedConversation.topic.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'chat'}.txt`;
    link.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10">
                <MessageSquare className="h-5 w-5 text-cyan-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-white">Chat</h1>
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                    Core
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-400">Normal AI chat first. Open Governed Mode when you need agents, approvals, apps, and auditability.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowCredentialModal(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:border-slate-600 hover:bg-slate-800"
            >
              <Settings2 className="h-4 w-4" />
              Manage Keys
            </button>
            <button
              onClick={() => setGovernedPanelOpen((current) => !current)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                governedPanelOpen
                  ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
                  : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 hover:bg-slate-800'
              }`}
            >
              <PanelRight className="h-4 w-4" />
              {governedPanelOpen ? 'Hide Governed Mode' : 'Open Governed Mode'}
            </button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-4">
          <label className="space-y-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Runtime source</span>
            <select
              value={runtimeSource}
              onChange={(event) => setRuntimeSource(event.target.value as ChatRuntimeSource)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500"
            >
              <option value="managed">Zapheit Managed</option>
              <option value="provider_key">My Provider Key</option>
              <option value="gateway_key">My Zapheit Gateway Key</option>
            </select>
          </label>

          <label className="space-y-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Credential profile</span>
            <select
              value={selectedRuntimeProfileId}
              onChange={(event) => setSelectedRuntimeProfileId(event.target.value)}
              disabled={runtimeSource === 'managed'}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">
                {runtimeSource === 'managed'
                  ? 'Managed by Zapheit'
                  : runtimeProfilesLoading
                    ? 'Loading saved keys...'
                    : 'Select saved key'}
              </option>
              {runtimeProfiles
                .filter((profile) => runtimeSource === 'provider_key' ? profile.kind === 'provider' : profile.kind === 'gateway')
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.label}</option>
                ))}
            </select>
          </label>

          <label className="space-y-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Model</span>
            <select
              value={selectedModelId}
              onChange={(event) => setSelectedModelId(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500"
            >
              {modelsLoading ? <option value="">Loading models...</option> : null}
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Audience mode</span>
            <select
              value={chatMode}
              onChange={(event) => setChatMode(event.target.value as 'operator' | 'employee' | 'external')}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500"
            >
              <option value="operator">Operator</option>
              <option value="employee">Employee</option>
              <option value="external">External</option>
            </select>
          </label>
        </div>
      </div>

      <div className="flex min-h-[780px] gap-4">
        <aside className="w-[300px] shrink-0 rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
          <button
            onClick={resetComposer}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:border-slate-600 hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </button>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search chats..."
              className="w-full rounded-2xl border border-slate-800 bg-slate-900 py-2.5 pl-9 pr-3 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500"
            />
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent chats</p>
            <div className="mt-3 space-y-2">
              {loading ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-6 text-center text-sm text-slate-400">Loading...</div>
              ) : filteredConversations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/50 px-4 py-6 text-center text-sm text-slate-500">No chats yet</div>
              ) : (
                filteredConversations.map((conversation) => (
                  <div key={conversation.id} className="group relative">
                    <button
                      onClick={() => setSelectedConversationId(conversation.id)}
                      className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                        selectedConversationId === conversation.id
                          ? 'border-cyan-500/30 bg-cyan-500/10'
                          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 pr-5">
                        <p className="truncate text-sm font-semibold text-white">{conversation.topic}</p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${
                          conversation.sessionType === 'standard'
                            ? 'bg-slate-800 text-slate-300'
                            : 'bg-cyan-500/10 text-cyan-200'
                        }`}>
                          {conversation.sessionType}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{conversation.preview}</p>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{conversation.runtimeLabel || conversation.agentName || 'Chat'}</span>
                        <span>{formatRelativeDate(conversation.timestamp)}</span>
                      </div>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDeleteConversation(conversation.id); }}
                      className="absolute right-2 top-2 hidden rounded-lg p-1 text-slate-500 hover:bg-rose-500/15 hover:text-rose-400 group-hover:flex"
                      aria-label="Delete conversation"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pinned templates</p>
            <div className="mt-3 space-y-2">
              {AGENT_TEMPLATES.filter((template) => template.maturity === 'Core').slice(0, 4).map((template) => (
                <button
                  key={template.id}
                  onClick={() => {
                    setSelectedTemplateId(template.id);
                    setGovernedPanelOpen(true);
                    setGovernedEnabled(true);
                    if (template.samplePrompts?.[0]) setComposeText(template.samplePrompts[0]);
                  }}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                    selectedTemplateId === template.id
                      ? 'border-violet-500/30 bg-violet-500/10'
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-violet-300" />
                    <p className="truncate text-sm font-semibold text-white">{template.name}</p>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-400">{template.businessPurpose || template.description}</p>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/70">
          <div className="border-b border-slate-800 px-5 py-4">
            {selectedConversation ? (
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-white">{selectedConversation.topic}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${
                      selectedConversation.sessionType === 'standard'
                        ? 'bg-slate-800 text-slate-300'
                        : 'bg-cyan-500/10 text-cyan-200'
                    }`}>
                      {selectedConversation.sessionType === 'standard' ? 'Standard chat' : 'Governed chat'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    {selectedConversation.runtimeLabel || selectedConversation.agentName || 'Chat'} · {formatDateTime(selectedConversation.timestamp)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setDetailTab('transcript')}
                    className={`rounded-xl px-3 py-1.5 text-sm ${
                      detailTab === 'transcript' ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Transcript
                  </button>
                  <button
                    onClick={() => setDetailTab('trace')}
                    className={`rounded-xl px-3 py-1.5 text-sm ${
                      detailTab === 'trace' ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Trace
                  </button>
                  <button
                    onClick={exportCurrentConversation}
                    className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-600 hover:bg-slate-800"
                  >
                    Export
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h2 className="text-lg font-semibold text-white">Start a new conversation</h2>
                <p className="mt-1 text-sm text-slate-400">Use Chat like a normal AI workspace. Open Governed Mode when the conversation needs agents, approvals, or apps.</p>
              </div>
            )}
          </div>

          <div ref={scrollContainerRef} onScroll={handleScrollContainer} className="relative flex-1 overflow-y-auto px-5 py-5">
            {userScrolledUp && streaming && (
              <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
                <button
                  onClick={() => { scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setUserScrolledUp(false); }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-cyan-300 shadow-lg backdrop-blur-sm hover:bg-slate-800"
                >
                  ↓ New message
                </button>
              </div>
            )}
            {selectedConversation && selectedConversation.messages?.length ? (
              detailTab === 'transcript' ? (
                <div className="space-y-5">
                  {selectedConversation.messages.map((message) => (
                    message.role === 'user' ? (
                      <div key={message.id} className="flex justify-end">
                        <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-cyan-500/15 border border-cyan-500/20 px-4 py-3">
                          <p className="text-sm leading-relaxed text-slate-100 whitespace-pre-wrap">{message.content}</p>
                          <p className="mt-1.5 text-[10px] text-slate-500 text-right">{formatDateTime(message.createdAt)}</p>
                        </div>
                      </div>
                    ) : (
                      <div key={message.id} className="flex items-start gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-xs font-semibold text-cyan-300">
                          {selectedConversation.agentName?.trim().charAt(0).toUpperCase() || 'A'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="rounded-2xl rounded-tl-sm border border-slate-800 bg-slate-900/80 px-4 py-3">
                            {message.content
                              ? <LightMarkdown text={message.content} tone="dark" />
                              : <span className="inline-flex gap-1 text-slate-500"><span className="animate-bounce [animation-delay:0ms]">·</span><span className="animate-bounce [animation-delay:150ms]">·</span><span className="animate-bounce [animation-delay:300ms]">·</span></span>
                            }
                          </div>
                          <p className="mt-1 pl-1 text-[10px] text-slate-600">{formatDateTime(message.createdAt)}</p>
                        </div>
                      </div>
                    )
                  ))}
                  <div ref={scrollBottomRef} />
                </div>
              ) : (
                <div className="space-y-3">
                  {tracesLoading ? (
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-10 text-center text-sm text-slate-400">Loading traces...</div>
                  ) : traces.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/60 px-4 py-10 text-center text-sm text-slate-500">No reasoning trace recorded for this conversation.</div>
                  ) : (
                    traces.map((trace) => (
                      <div key={trace.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                          <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-200">{trace.model}</span>
                          <span>{trace.total_tokens} tokens</span>
                          <span>{trace.latency_ms} ms</span>
                        </div>
                        {trace.policy_violations?.length ? (
                          <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                            {trace.policy_violations.map((item) => `${item.policy_name}: ${item.action_taken}`).join(' | ')}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              )
            ) : null}

            {/* Governed polling progress */}
            {governedPollAbort !== null && (
              <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-cyan-200">Running governed job…</p>
                    <p className="mt-0.5 text-xs text-slate-400">Poll {governedPollAttempt} / 25</p>
                    <progress
                      value={governedPollAttempt}
                      max={25}
                      className="mt-2 h-1.5 w-full rounded-full accent-cyan-400"
                    />
                  </div>
                  <button
                    onClick={() => {
                      governedPollAbort?.abort();
                      setGovernedPollAbort(null);
                      setGovernedPollAttempt(0);
                      toast.info('Cancelled — the job may continue in the background.');
                    }}
                    className="shrink-0 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Governed job timed out */}
            {governedPollAttempt === -1 && (
              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4">
                <p className="text-sm font-semibold text-amber-200">Still running</p>
                <p className="mt-1 text-xs text-slate-400">
                  This job is taking longer than expected.{' '}
                  <button
                    onClick={() => { setGovernedPollAttempt(0); onNavigate?.('jobs'); }}
                    className="underline hover:text-white"
                  >
                    Check Jobs for status →
                  </button>
                </p>
              </div>
            )}

            {!selectedConversation && governedPollAbort === null && governedPollAttempt === 0 && (
              <div className="flex h-full flex-col items-center justify-center">
                <div className="grid max-w-4xl gap-4 md:grid-cols-2">
                  {[
                    { title: 'Writing', prompt: 'Help me rewrite this into a polished customer email.', icon: Sparkles },
                    { title: 'Analysis', prompt: 'Compare these two options and recommend one.', icon: Brain },
                    { title: 'Coding', prompt: 'Review this implementation approach and suggest improvements.', icon: Cpu },
                    { title: 'Business', prompt: 'Turn these raw notes into an executive summary.', icon: Activity },
                  ].map(({ title, prompt, icon: Icon }) => (
                    <button
                      key={title}
                      onClick={() => setComposeText(prompt)}
                      className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 text-left transition-colors hover:border-slate-700 hover:bg-slate-900"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950">
                          <Icon className="h-5 w-5 text-cyan-300" />
                        </div>
                        <div>
                          <p className="text-base font-semibold text-white">{title}</p>
                          <p className="mt-1 text-sm text-slate-400">{prompt}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-800 px-5 py-4">
            <div className="flex flex-wrap gap-2 pb-3">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setComposeText(prompt)}
                  className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-500/30 hover:text-white"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-3">
              <textarea
                value={composeText}
                onChange={(event) => {
                  setComposeText(event.target.value);
                  const el = event.target;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
                }}
                onKeyDown={handleKeyDown}
                disabled={streaming || sending}
                placeholder={governedEnabled ? 'Describe the governed task you want to run...' : 'Start a new message…'}
                rows={2}
                style={{ minHeight: '2.5rem', maxHeight: '9rem' }}
                className="w-full resize-none bg-transparent text-sm text-white placeholder-slate-500 outline-none disabled:opacity-60"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="rounded-xl border border-slate-800 px-3 py-2 text-xs text-slate-400">
                  {runtimeSourceLabel(runtimeSource)}{selectedRuntimeProfile ? ` · ${selectedRuntimeProfile.label}` : ''}{selectedModelId ? ` · ${selectedModelId}` : ''}
                </div>
                <div className="flex items-center gap-2">
                  {streaming && (
                    <button
                      onClick={() => { streamAbortController?.abort(); setStreaming(false); setStreamAbortController(null); }}
                      className="inline-flex items-center gap-2 rounded-2xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-400"
                    >
                      <Square className="h-4 w-4 fill-current" /> Stop
                    </button>
                  )}
                  {!streaming && (
                    <button
                      onClick={() => void handleSend()}
                      disabled={sending || !composeText.trim()}
                      className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {governedEnabled ? 'Run Governed' : 'Send'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {governedPanelOpen ? (
          <aside className="w-[360px] shrink-0 rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-cyan-300" />
                  <h3 className="text-lg font-semibold text-white">Governed Mode</h3>
                </div>
                <p className="mt-1 text-sm text-slate-400">Escalate the current chat into agent-driven governed work when it needs apps, approvals, or auditability.</p>
              </div>
              <button
                onClick={() => setGovernedPanelOpen(false)}
                aria-label="Close Governed Mode"
                className="rounded-xl border border-slate-800 p-2 text-slate-400 hover:border-slate-700 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Execution mode</p>
                  <p className="mt-1 text-sm text-white">{governedEnabled ? 'Run as governed action' : 'Keep as normal chat'}</p>
                </div>
                <button
                  onClick={() => setGovernedEnabled((current) => !current)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
                    governedEnabled ? 'bg-cyan-300 text-slate-950' : 'bg-slate-900 text-slate-300'
                  }`}
                >
                  {governedEnabled ? 'Governed On' : 'Governed Off'}
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <label className="space-y-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Agent</span>
                <select
                  value={selectedAgentId}
                  onChange={(event) => setSelectedAgentId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500"
                >
                  <option value="">Select agent</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Template</span>
                <select
                  value={selectedTemplateId}
                  onChange={(event) => setSelectedTemplateId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500"
                >
                  <option value="">No template context</option>
                  {AGENT_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Connected app</span>
                <select
                  value={selectedAppService}
                  onChange={(event) => setSelectedAppService(event.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500"
                >
                  <option value="">No app context</option>
                  {connectedApps.map((app) => (
                    <option key={app.id} value={app.service}>{app.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Governance state</p>
              {activeSession?.session_type === 'governed_chat_session' ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-slate-500">Lifecycle</p>
                      <p className="mt-1 text-sm capitalize text-white">{governanceLabel(activeSession.governed_execution?.status)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Approval</p>
                      <p className="mt-1 text-sm capitalize text-white">{activeSession.approval_summary?.status || 'Not required'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Audit</p>
                      <p className="mt-1 break-all text-sm text-white">{activeSession.audit_ref || 'Pending'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Cost</p>
                      <p className="mt-1 text-sm text-white">{formatCost(activeSession.cost_status)}</p>
                    </div>
                  </div>
                  {activeSession.incident_ref ? (
                    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">
                      Incident: {activeSession.incident_ref}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-slate-500">Session type</p>
                      <p className="mt-1 text-sm text-white">Standard chat</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Billing</p>
                      <p className="mt-1 text-sm text-white">{billingModeLabel(activeSession?.billing_mode)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Runtime</p>
                      <p className="mt-1 text-sm text-white">{activeSession?.runtime_label || runtimeSourceLabel(runtimeSource)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Model</p>
                      <p className="mt-1 break-all text-sm text-white">{activeSession?.model || selectedModelId || 'None selected'}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
                    This conversation stays plain chat until you toggle governed execution on and send with an agent/template/app context.
                  </div>
                </>
              )}
            </div>

            <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
              <div className="flex items-center gap-2 text-white">
                <ArrowUpRight className="h-4 w-4 text-cyan-300" />
                Quick links
              </div>
              <div className="mt-3 space-y-2">
                <button
                  onClick={() => onNavigate?.('templates')}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-left hover:border-slate-700"
                >
                  <span>Open Templates</span>
                  <ChevronRight className="h-4 w-4 text-slate-500" />
                </button>
                <button
                  onClick={() => onNavigate?.('approvals')}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-left hover:border-slate-700"
                >
                  <span>Open Approvals</span>
                  <ChevronRight className="h-4 w-4 text-slate-500" />
                </button>
                <button
                  onClick={() => onNavigate?.('apps')}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-left hover:border-slate-700"
                >
                  <span>Open Apps</span>
                  <ChevronRight className="h-4 w-4 text-slate-500" />
                </button>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      {showCredentialModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-3xl border border-slate-800 bg-slate-950 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-cyan-300" />
                  <h3 className="text-xl font-semibold text-white">Manage Chat Keys</h3>
                </div>
                <p className="mt-1 text-sm text-slate-400">Save provider or Zapheit gateway keys for normal chat usage. These profiles are now stored server-side and encrypted at rest.</p>
              </div>
              <button
                onClick={() => setShowCredentialModal(false)}
                aria-label="Close Manage Chat Keys"
                className="rounded-xl border border-slate-800 p-2 text-slate-400 hover:border-slate-700 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Add profile</p>
                <div className="mt-4 space-y-4">
                  <label className="space-y-2 text-sm">
                    <span className="text-slate-300">Profile type</span>
                    <select
                      value={newProfileKind}
                      onChange={(event) => setNewProfileKind(event.target.value as ProfileKind)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500"
                    >
                      <option value="provider">Provider key</option>
                      <option value="gateway">Zapheit gateway key</option>
                    </select>
                  </label>

                  {newProfileKind === 'provider' ? (
                    <label className="space-y-2 text-sm">
                      <span className="text-slate-300">Provider</span>
                      <select
                        value={newProfileProvider}
                        onChange={(event) => setNewProfileProvider(event.target.value as ProviderType)}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500"
                      >
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="openrouter">OpenRouter</option>
                      </select>
                    </label>
                  ) : null}

                  <label className="space-y-2 text-sm">
                    <span className="text-slate-300">Label</span>
                    <input
                      value={newProfileLabel}
                      onChange={(event) => setNewProfileLabel(event.target.value)}
                      placeholder={newProfileKind === 'gateway' ? 'Production gateway key' : 'OpenAI personal key'}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-slate-300">API key</span>
                    <input
                      type="password"
                      value={newProfileApiKey}
                      onChange={(event) => setNewProfileApiKey(event.target.value)}
                      placeholder="Paste key"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500"
                    />
                  </label>

                  <button
                    onClick={handleAddProfile}
                    className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
                  >
                    <Plus className="h-4 w-4" />
                    Save profile
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Saved profiles</p>
                <div className="mt-4 space-y-3">
                  {runtimeProfiles.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-10 text-center text-sm text-slate-500">
                      {runtimeProfilesLoading ? 'Loading saved profiles...' : 'No chat runtime profiles saved yet.'}
                    </div>
                  ) : (
                    runtimeProfiles.map((profile) => (
                      <div key={profile.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              {profile.kind === 'gateway' ? <Globe className="h-4 w-4 text-cyan-300" /> : <KeyRound className="h-4 w-4 text-cyan-300" />}
                              <p className="font-medium text-white">{profile.label}</p>
                            </div>
                            <p className="mt-1 text-sm text-slate-400">
                              {profile.kind === 'gateway' ? 'Zapheit gateway key' : profile.provider}
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                              {profile.maskedKey} · {profile.lastUsedAt ? `Used ${formatRelativeDate(profile.lastUsedAt)}` : 'Not used yet'}
                            </p>
                          </div>
                          <button
                            onClick={() => void handleDeleteProfile(profile.id)}
                            className="rounded-xl border border-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:border-rose-500/30 hover:text-rose-200"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
