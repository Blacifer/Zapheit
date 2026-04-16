import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Bot,
  Brain,
  Clock,
  Cpu,
  Download,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Send,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  User,
  Wand2,
  Wrench,
} from 'lucide-react';
import type { AIAgent } from '../../types';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { loadFromStorage, removeFromStorage } from '../../utils/storage';
import { AGENT_TEMPLATES, type AgentTemplate } from '../../config/agentTemplates';

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

type ConversationRecord = {
  id: string;
  agentId: string;
  agentName: string;
  user: string;
  topic: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  timestamp: string;
  tokens: number;
  preview: string;
  status: string;
  platform: string;
};

type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokenCount: number;
  createdAt: string;
};

type ConversationDetail = ConversationRecord & {
  messages: ConversationMessage[];
};

type ConnectedAppOption = {
  id: string;
  label: string;
  service: string;
};

type ChatSession = {
  session_id: string;
  mode: 'operator' | 'employee' | 'external';
  agent_id: string;
  template_id: string | null;
  source: 'apps' | 'chat' | 'template';
  source_ref: string | null;
  job_id: string | null;
  governed_execution: any | null;
  approval_summary: any | null;
  audit_ref: string | null;
  cost_status: any | null;
  incident_ref: string | null;
};

const INCIDENT_CONTEXT_STORAGE_KEY = 'synthetic_hr_incident_context';
const AGENT_WORKSPACE_FOCUS_STORAGE_KEY = 'synthetic_hr_agent_workspace_focus';

function getAgentName(agents: AIAgent[], agentId?: string | null) {
  return agents.find((agent) => agent.id === agentId)?.name || 'Unknown Agent';
}

function summarizeTopic(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 'Conversation';
  const firstSentence = trimmed.split(/[.!?]/)[0] || trimmed;
  return firstSentence.slice(0, 60);
}

function deriveSentiment(status?: string, messages: any[] = []) {
  const combined = messages.map((message) => String(message?.content || '')).join(' ').toLowerCase();
  if (status === 'error' || combined.includes('angry') || combined.includes('furious') || combined.includes('complaint')) return 'negative';
  if (status === 'completed' || combined.includes('thank you') || combined.includes('resolved')) return 'positive';
  return 'neutral';
}

function normalizeConversation(raw: any, agents: AIAgent[]): ConversationRecord {
  const metadata = raw?.metadata || {};
  const preview =
    metadata.preview ||
    metadata.last_user_message ||
    metadata.summary ||
    `Conversation on ${raw?.platform || 'unknown platform'}`;

  return {
    id: raw.id,
    agentId: raw.agent_id || '',
    agentName: getAgentName(agents, raw.agent_id),
    user: metadata.user_email || metadata.customer_email || metadata.user_label || metadata.api_key_name || metadata.platform_label || raw.user_id || 'Unknown user',
    topic: metadata.topic || summarizeTopic(preview),
    sentiment: deriveSentiment(raw.status, raw.messages || metadata.messages || []),
    timestamp: raw.started_at || raw.created_at || new Date().toISOString(),
    tokens: Number(metadata.total_tokens || metadata.tokens || 0),
    preview,
    status: raw.status || 'unknown',
    platform: raw.platform || 'internal',
  };
}

function normalizeConversationDetail(raw: any, agents: AIAgent[]): ConversationDetail {
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

  const firstUserMessage = messages.find((message) => message.role === 'user')?.content;

  return {
    ...base,
    preview: firstUserMessage || base.preview,
    sentiment: deriveSentiment(raw.status, messages),
    tokens: messages.reduce((sum, message) => sum + message.tokenCount, 0) || base.tokens,
    messages,
    topic: raw?.metadata?.topic || summarizeTopic(firstUserMessage || base.preview),
    user: raw?.metadata?.user_email || raw?.metadata?.customer_email || base.user,
    agentName: getAgentName(agents, raw.agent_id),
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function governanceLabel(status?: string | null) {
  if (!status) return 'No governed run yet';
  return status.replace(/_/g, ' ');
}

function formatCost(costStatus: any) {
  if (!costStatus) return 'Not available yet';
  if (costStatus.state === 'captured' && typeof costStatus.amount === 'number') {
    return `${costStatus.amount.toFixed(4)} ${costStatus.currency || 'USD'}`;
  }
  return costStatus.reason || costStatus.state || 'Not available yet';
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function starterPromptSet(template: AgentTemplate | null) {
  if (template?.samplePrompts?.length) {
    return template.samplePrompts.slice(0, 4);
  }
  return [
    'Summarize the latest customer issue and suggest the safest next step.',
    'Draft an internal approval-ready action plan for a manager.',
    'Review this request for policy risk before anyone acts on it.',
    'Prepare a concise handoff note for the operations team.',
  ];
}

function isTerminalJobStatus(status?: string | null) {
  return ['succeeded', 'failed', 'canceled', 'cancelled', 'pending_approval'].includes(String(status || '').toLowerCase());
}

export default function ConversationsPage({ agents, onNavigate, initialAgentId }: ConversationsPageProps) {
  const [conversationList, setConversationList] = useState<ConversationRecord[]>([]);
  const [conversationCache, setConversationCache] = useState<Record<string, ConversationDetail>>({});
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'transcript' | 'trace'>('transcript');
  const [traces, setTraces] = useState<ReasoningTrace[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [conversationRating, setConversationRating] = useState<1 | -1 | null>(null);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [incidentContext, setIncidentContext] = useState<{ incidentId?: string; agentId?: string; incidentType?: string } | null>(null);
  const [connectedApps, setConnectedApps] = useState<ConnectedAppOption[]>([]);
  const [composeText, setComposeText] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string>(initialAgentId || '');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedAppService, setSelectedAppService] = useState<string>('');
  const [chatMode, setChatMode] = useState<'operator' | 'employee' | 'external'>('operator');
  const [sending, setSending] = useState(false);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [freshStart, setFreshStart] = useState(false);

  const selectedConversation = selectedConversationId ? conversationCache[selectedConversationId] || null : null;
  const selectedTemplate = useMemo(
    () => AGENT_TEMPLATES.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId],
  );
  const starterPrompts = useMemo(() => starterPromptSet(selectedTemplate), [selectedTemplate]);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return conversationList.filter((conversation) => {
      if (!query) return true;
      return [
        conversation.user,
        conversation.topic,
        conversation.preview,
        conversation.agentName,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [conversationList, searchQuery]);

  const selectedApp = useMemo(
    () => connectedApps.find((app) => app.service === selectedAppService) || null,
    [connectedApps, selectedAppService],
  );

  const loadConnectedApps = useCallback(async () => {
    const response = await api.integrations.getAppsInventory();
    if (!response.success || !Array.isArray(response.data)) return;
    const apps = response.data.map(mapConnectedApp).filter(Boolean) as ConnectedAppOption[];
    setConnectedApps(apps);
  }, []);

  const loadConversationList = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await api.conversations.getAll({ limit: 100 });
    if (!response.success || !Array.isArray(response.data)) {
      setConversationList([]);
      setError(response.error || 'Failed to load conversations.');
      setLoading(false);
      return;
    }

    const normalizedList = response.data.map((item) => normalizeConversation(item, agents));
    setConversationList(normalizedList);
    setLoading(false);

    if (!selectedConversationId && !freshStart && normalizedList.length > 0) {
      setSelectedConversationId(normalizedList[0].id);
    }
  }, [agents, freshStart, selectedConversationId]);

  const openConversation = useCallback(async (id: string) => {
    setSelectedConversationId(id);
    setActiveSession(null);
    if (conversationCache[id]) {
      setConversationRating((conversationCache[id] as any)?.rating ?? null);
      return;
    }

    const response = await api.conversations.getById(id);
    if (!response.success || !response.data) {
      toast.error(response.error || 'Failed to load conversation');
      return;
    }

    const detail = normalizeConversationDetail(response.data, agents);
    setConversationCache((current) => ({ ...current, [id]: detail }));
    setConversationList((current) => current.map((conversation) => conversation.id === id ? detail : conversation));
    setConversationRating((response.data as any)?.rating ?? null);
  }, [agents, conversationCache]);

  const refreshSelectedConversation = useCallback(async (conversationId: string) => {
    const response = await api.conversations.getById(conversationId);
    if (!response.success || !response.data) return;
    const detail = normalizeConversationDetail(response.data, agents);
    setConversationCache((current) => ({ ...current, [conversationId]: detail }));
    setConversationList((current) => {
      const updated = current.some((conversation) => conversation.id === conversationId)
        ? current.map((conversation) => conversation.id === conversationId ? detail : conversation)
        : [detail, ...current];
      return updated.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
    });
    setConversationRating((response.data as any)?.rating ?? null);
  }, [agents]);

  useEffect(() => {
    void loadConversationList();
    void loadConnectedApps();
  }, [loadConnectedApps, loadConversationList]);

  useEffect(() => {
    if (agents.length === 0) return;
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
  }, [agents, initialAgentId]);

  useEffect(() => {
    const context = loadFromStorage<{ incidentId?: string; agentId?: string; incidentType?: string } | null>(INCIDENT_CONTEXT_STORAGE_KEY, null);
    setIncidentContext(context);
    if (context) removeFromStorage(INCIDENT_CONTEXT_STORAGE_KEY);
  }, []);

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
      }
      setTracesLoading(false);
    };
    void loadTraces();
    return () => {
      cancelled = true;
    };
  }, [detailTab, selectedConversationId]);

  const handleNewConversation = () => {
    setSelectedConversationId(null);
    setComposeText('');
    setActiveSession(null);
    setDetailTab('transcript');
    setTraces([]);
    setConversationRating(null);
    setFreshStart(true);
  };

  const pollJobUntilSettled = useCallback(async (jobId: string, conversationId: string) => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await sleep(1500);
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

      await refreshSelectedConversation(conversationId);
      if (String(job.status).toLowerCase() === 'failed') {
        toast.error(job.error || 'Chat run failed');
      }
      if (String(job.status).toLowerCase() === 'pending_approval') {
        toast.info('This run is waiting for approval before it can continue.');
      }
      return;
    }

    toast.info('Chat run is still processing. You can refresh the conversation in a moment.');
  }, [refreshSelectedConversation]);

  const handleSend = async () => {
    const prompt = composeText.trim();
    if (!prompt) return;
    if (!selectedAgentId) {
      toast.error('Select an agent first');
      return;
    }

    const template = selectedTemplateId
      ? AGENT_TEMPLATES.find((item) => item.id === selectedTemplateId) || null
      : null;

    setSending(true);
    const response = await api.conversations.send({
      agent_id: selectedAgentId,
      prompt,
      conversation_id: selectedConversationId || undefined,
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
      toast.error(response.error || 'Failed to send chat turn');
      return;
    }

    const detail = normalizeConversationDetail(response.data.conversation, agents);
    setFreshStart(false);
    setConversationCache((current) => ({ ...current, [detail.id]: detail }));
    setConversationList((current) => {
      const next = current.some((conversation) => conversation.id === detail.id)
        ? current.map((conversation) => conversation.id === detail.id ? detail : conversation)
        : [detail, ...current];
      return next.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
    });
    setSelectedConversationId(detail.id);
    setComposeText('');
    setDetailTab('transcript');
    setActiveSession({
      session_id: response.data.session?.session_id || detail.id,
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
      void pollJobUntilSettled(response.data.job.id, detail.id);
    }
  };

  const handleRate = async (rating: 1 | -1) => {
    if (!selectedConversationId || ratingSubmitting) return;
    setRatingSubmitting(true);
    const response = await api.conversations.rate(selectedConversationId, rating);
    setRatingSubmitting(false);
    if (response.success) {
      setConversationRating(rating);
      toast.success(rating === 1 ? 'Thanks for the positive feedback.' : 'Thanks for the feedback.');
    } else {
      toast.error('Could not save rating.');
    }
  };

  const exportCSV = () => {
    const rows = filteredConversations.map((conversation) =>
      `${conversation.id},${conversation.timestamp},${conversation.user},${conversation.agentName},${conversation.sentiment},${conversation.tokens}`,
    );
    const csvContent = ['ID,Date,User,Agent,Sentiment,Tokens'].concat(rows).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `chat_export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 relative z-10 w-full max-w-[1600px] mx-auto">
      {incidentContext?.incidentId && (
        <div className="flex flex-col gap-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Investigating incident</p>
            <p className="mt-1 text-sm text-white">
              Focused on <span className="font-mono">{incidentContext.incidentId}</span>
              {incidentContext.incidentType ? ` · ${incidentContext.incidentType.replace(/_/g, ' ')}` : ''}
            </p>
          </div>
          <button
            onClick={() => onNavigate?.('incidents')}
            className="rounded-xl border border-cyan-500/20 bg-slate-950/60 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-400/40"
          >
            Back to incident
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 border-b border-slate-700/60 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
              <MessageSquare className="w-8 h-8 text-cyan-400" /> Chat
            </h1>
            <span className="inline-flex items-center rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
              Core
            </span>
          </div>
          <p className="text-slate-400 mt-1.5">Use Chat like a familiar AI workspace, with Zapheit tracking governed execution, linked apps, approvals, audit trail, incidents, and Zapheit-observed cost.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleNewConversation}
            className="px-4 py-2.5 bg-cyan-500 text-slate-950 font-semibold rounded-xl flex items-center gap-2 hover:bg-cyan-400 transition-all shadow-lg"
          >
            <Plus className="w-4 h-4" /> New chat
          </button>
          <button
            onClick={exportCSV}
            disabled={filteredConversations.length === 0}
            className="px-4 py-2.5 bg-slate-800 text-slate-300 border border-slate-700 font-semibold rounded-xl flex items-center gap-2 hover:bg-slate-700 hover:text-white transition-all shadow-lg disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[280px,minmax(0,1fr),320px]">
        <aside className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              id="chat-search"
              name="chat_search"
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search recent chats"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-4 py-2.5 text-sm text-white outline-none focus:border-cyan-500"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Recent chats</p>
              <span className="text-xs text-slate-500">{filteredConversations.length}</span>
            </div>
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {loading ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-6 text-center text-slate-400">
                  <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin text-cyan-400" />
                  Loading chats…
                </div>
              ) : error ? (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-4 text-sm text-rose-200">{error}</div>
              ) : filteredConversations.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-6 text-center text-slate-400">
                  No recent chats yet.
                </div>
              ) : (
                filteredConversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => {
                      setFreshStart(false);
                      setActiveSession(null);
                      setSelectedConversationId(conversation.id);
                    }}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                      selectedConversationId === conversation.id
                        ? 'border-cyan-500/30 bg-cyan-500/10'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white truncate">{conversation.topic}</p>
                      <span className="text-[11px] text-slate-500 shrink-0">{conversation.tokens}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400 truncate">{conversation.agentName}</p>
                    <p className="mt-2 text-xs text-slate-500 line-clamp-2">{conversation.preview}</p>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Pinned templates</p>
            <div className="space-y-2">
              {AGENT_TEMPLATES.filter((template) => template.maturity === 'Core').slice(0, 4).map((template) => (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplateId(template.id)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                    selectedTemplateId === template.id
                      ? 'border-violet-500/30 bg-violet-500/10'
                      : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Wand2 className="w-4 h-4 text-violet-300" />
                    <p className="text-sm font-semibold text-white truncate">{template.name}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-400 line-clamp-2">{template.businessPurpose || template.description}</p>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden min-h-[760px] flex flex-col">
          <div className="border-b border-slate-800 px-5 py-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Agent</span>
                <select
                  value={selectedAgentId}
                  onChange={(event) => setSelectedAgentId(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500"
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
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500"
                >
                  <option value="">No template context</option>
                  {AGENT_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Connected app context</span>
                <select
                  value={selectedAppService}
                  onChange={(event) => setSelectedAppService(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500"
                >
                  <option value="">No app context</option>
                  {connectedApps.map((app) => (
                    <option key={app.id} value={app.service}>{app.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setComposeText(prompt)}
                  className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-500/30 hover:text-white"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-4">
            {selectedConversation ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">{selectedConversation.topic}</h2>
                    <p className="text-sm text-slate-400">
                      {selectedConversation.agentName} · {formatDateTime(selectedConversation.timestamp)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDetailTab('transcript')}
                      className={`rounded-lg px-3 py-1.5 text-sm ${detailTab === 'transcript' ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-400 hover:text-white'}`}
                    >
                      Transcript
                    </button>
                    <button
                      onClick={() => setDetailTab('trace')}
                      className={`rounded-lg px-3 py-1.5 text-sm ${detailTab === 'trace' ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-400 hover:text-white'}`}
                    >
                      Trace
                    </button>
                  </div>
                </div>

                {detailTab === 'trace' ? (
                  tracesLoading ? (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-10 text-center text-slate-400">
                      <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin text-cyan-400" />
                      Loading reasoning traces…
                    </div>
                  ) : traces.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
                      No reasoning traces recorded for this conversation yet.
                    </div>
                  ) : (
                    traces.map((trace) => (
                      <div key={trace.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-white">{trace.model}</p>
                          <p className="text-xs text-slate-500">{formatDateTime(trace.created_at)}</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-4">
                          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                            <p className="text-xs text-slate-500 uppercase tracking-[0.16em]">Tokens</p>
                            <p className="mt-1 text-sm font-semibold text-white">{trace.total_tokens}</p>
                          </div>
                          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                            <p className="text-xs text-slate-500 uppercase tracking-[0.16em]">Latency</p>
                            <p className="mt-1 text-sm font-semibold text-white">{trace.latency_ms}ms</p>
                          </div>
                          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                            <p className="text-xs text-slate-500 uppercase tracking-[0.16em]">Risk</p>
                            <p className="mt-1 text-sm font-semibold text-white">{trace.risk_score != null ? `${Math.round(trace.risk_score * 100)}%` : '—'}</p>
                          </div>
                          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                            <p className="text-xs text-slate-500 uppercase tracking-[0.16em]">Entropy</p>
                            <p className="mt-1 text-sm font-semibold text-white">{trace.response_entropy != null ? trace.response_entropy.toFixed(2) : '—'}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )
                ) : selectedConversation.messages.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
                    No messages recorded for this conversation yet.
                  </div>
                ) : (
                  selectedConversation.messages.map((message) => (
                    <div key={message.id} className={`flex gap-3 ${message.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
                      {message.role === 'assistant' && (
                        <div className="w-9 h-9 rounded-full border border-cyan-500/20 bg-cyan-500/10 flex items-center justify-center shrink-0">
                          <Bot className="w-4 h-4 text-cyan-300" />
                        </div>
                      )}
                      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                        message.role === 'assistant'
                          ? 'bg-slate-950 border border-slate-800 text-slate-100 rounded-tl-sm'
                          : 'bg-cyan-500 text-slate-950 rounded-tr-sm'
                      }`}>
                        <p className={`text-xs font-semibold mb-1 ${message.role === 'assistant' ? 'text-cyan-300' : 'text-slate-900/75'}`}>
                          {message.role === 'assistant' ? selectedConversation.agentName : selectedConversation.user}
                        </p>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                        <p className={`mt-3 text-[11px] ${message.role === 'assistant' ? 'text-slate-500' : 'text-slate-900/70'}`}>
                          {formatDateTime(message.createdAt)} · {message.tokenCount} tokens
                        </p>
                      </div>
                      {message.role !== 'assistant' && (
                        <div className="w-9 h-9 rounded-full border border-slate-700 bg-slate-900 flex items-center justify-center shrink-0">
                          <User className="w-4 h-4 text-slate-300" />
                        </div>
                      )}
                    </div>
                  ))
                )}
              </>
            ) : (
              <div className="h-full rounded-2xl border border-dashed border-slate-700 p-8 flex flex-col items-center justify-center text-center text-slate-400">
                <Brain className="w-12 h-12 text-cyan-400 mb-4" />
                <h2 className="text-xl font-semibold text-white">Start a governed chat</h2>
                <p className="mt-2 max-w-xl">Choose an agent, optionally pin a template or connected app, then send a prompt. Zapheit will create a real conversation, dispatch a governed run, and keep the execution state attached to the thread.</p>
              </div>
            )}
          </div>

          <div className="border-t border-slate-800 p-5 space-y-4">
            {selectedConversationId && detailTab === 'transcript' && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Was this conversation helpful?</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRate(1)}
                    disabled={ratingSubmitting}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${conversationRating === 1 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-emerald-500/40 hover:text-emerald-400'}`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    Yes
                  </button>
                  <button
                    onClick={() => handleRate(-1)}
                    disabled={ratingSubmitting}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${conversationRating === -1 ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-rose-500/40 hover:text-rose-400'}`}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                    No
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
              <textarea
                id="chat-compose"
                name="chat_compose"
                value={composeText}
                onChange={(event) => setComposeText(event.target.value)}
                placeholder="Ask a question, draft governed work, or prepare an approval-ready request…"
                rows={4}
                className="w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="rounded-full border border-slate-700 px-2.5 py-1">Mode: {chatMode}</span>
                  {selectedTemplate ? <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-violet-200">Template: {selectedTemplate.name}</span> : null}
                  {selectedApp ? <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-cyan-200">App: {selectedApp.label}</span> : null}
                </div>
                <button
                  onClick={() => void handleSend()}
                  disabled={sending || !composeText.trim() || !selectedAgentId}
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Launch mode</p>
            <div className="grid grid-cols-3 gap-2">
              {(['operator', 'employee', 'external'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setChatMode(mode)}
                  className={`rounded-xl border px-3 py-2 text-sm capitalize ${
                    chatMode === mode
                      ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-300" />
              <p className="text-sm font-semibold text-white">Governance state</p>
            </div>
            {activeSession ? (
              <div className="space-y-3 text-sm">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Lifecycle</p>
                    <p className="mt-1 text-white capitalize">{governanceLabel(activeSession.governed_execution?.status)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Source</p>
                    <p className="mt-1 text-white capitalize">{activeSession.source}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Approval</p>
                    <p className="mt-1 text-white capitalize">{activeSession.approval_summary?.status || 'Not required'}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Cost</p>
                    <p className="mt-1 text-white">{formatCost(activeSession.cost_status)}</p>
                  </div>
                </div>

                {activeSession.governed_execution?.policy_result?.reasons?.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Policy result</p>
                    <div className="mt-2 space-y-2">
                      {activeSession.governed_execution.policy_result.reasons.map((reason: string) => (
                        <div key={reason} className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300">
                          {reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <button
                    onClick={() => onNavigate?.('apps')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-left text-sm text-slate-200 hover:border-cyan-500/30"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2"><Wrench className="w-4 h-4 text-cyan-300" /> Open linked apps</span>
                      <ArrowUpRight className="w-4 h-4 text-slate-500" />
                    </span>
                  </button>
                  <button
                    onClick={() => onNavigate?.('approvals')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-left text-sm text-slate-200 hover:border-cyan-500/30"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-cyan-300" /> Open approvals</span>
                      <ArrowUpRight className="w-4 h-4 text-slate-500" />
                    </span>
                  </button>
                  <button
                    onClick={() => onNavigate?.('execution-history')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-left text-sm text-slate-200 hover:border-cyan-500/30"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-300" /> Open job history</span>
                      <ArrowUpRight className="w-4 h-4 text-slate-500" />
                    </span>
                  </button>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-slate-400 space-y-1">
                  <p>Session: <span className="font-mono text-slate-300">{activeSession.session_id}</span></p>
                  {activeSession.job_id ? <p>Run: <span className="font-mono text-slate-300">{activeSession.job_id}</span></p> : null}
                  {activeSession.audit_ref ? <p>Audit: <span className="font-mono text-slate-300">{activeSession.audit_ref}</span></p> : null}
                  {activeSession.incident_ref ? <p>Incident: <span className="font-mono text-slate-300">{activeSession.incident_ref}</span></p> : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Send a prompt to create a governed chat run. The current session state, approval requirement, cost capture, and links to the surrounding control plane will appear here.</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-violet-300" />
              <p className="text-sm font-semibold text-white">Context</p>
            </div>
            <div className="space-y-2 text-sm text-slate-300">
              <p><span className="text-slate-500">Agent:</span> {getAgentName(agents, selectedAgentId || null)}</p>
              <p><span className="text-slate-500">Template:</span> {selectedTemplate?.name || 'None selected'}</p>
              <p><span className="text-slate-500">App target:</span> {selectedApp?.label || 'None selected'}</p>
              {selectedTemplate?.approvalDefault ? <p><span className="text-slate-500">Approval default:</span> {selectedTemplate.approvalDefault}</p> : null}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
