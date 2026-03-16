import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MessageSquare, Search, Filter, Bot, User, Clock,
  CheckCircle, AlertTriangle, Eye, Download, X, Loader2
} from 'lucide-react';
import type { AIAgent } from '../../types';
import { api } from '../../lib/api-client';
import { loadFromStorage, removeFromStorage } from '../../utils/storage';
import { toast } from '../../lib/toast';

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

const INCIDENT_CONTEXT_STORAGE_KEY = 'synthetic_hr_incident_context';
const AGENT_WORKSPACE_FOCUS_STORAGE_KEY = 'synthetic_hr_agent_workspace_focus';

function getAgentName(agents: AIAgent[], agentId?: string | null) {
  return agents.find((agent) => agent.id === agentId)?.name || 'Unknown Agent';
}

function summarizeTopic(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 'Conversation';
  const firstSentence = trimmed.split(/[.!?]/)[0] || trimmed;
  return firstSentence.slice(0, 48);
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
    user: metadata.user_email || metadata.customer_email || raw.user_id || 'Unknown user',
    topic: metadata.topic || summarizeTopic(preview),
    sentiment: deriveSentiment(raw.status, metadata.messages || []),
    timestamp: raw.started_at || raw.created_at || new Date().toISOString(),
    tokens: Number(metadata.total_tokens || metadata.tokens || 0),
    preview,
    status: raw.status || 'unknown',
    platform: raw.platform || 'internal',
  };
}

function isSparseConversation(conversation: ConversationRecord) {
  return (
    conversation.user === 'Unknown user' ||
    conversation.tokens === 0 ||
    conversation.preview.startsWith('Conversation on ') ||
    conversation.topic === 'Conversation'
  );
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
  const firstAssistantMessage = messages.find((message) => message.role === 'assistant')?.content;

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

export default function ConversationsPage({ agents, onNavigate, initialAgentId }: ConversationsPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAgent, setFilterAgent] = useState('all');
  const [filterSentiment, setFilterSentiment] = useState('all');
  const [selectedConversation, setSelectedConversation] = useState<ConversationDetail | null>(null);
  const [conversationList, setConversationList] = useState<ConversationRecord[]>([]);
  const [conversationCache, setConversationCache] = useState<Record<string, ConversationDetail>>({});
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incidentContext, setIncidentContext] = useState<{ incidentId?: string; agentId?: string; incidentType?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadConversations = async () => {
      setLoading(true);
      setError(null);

      const response = await api.conversations.getAll({ limit: 100 });
      if (cancelled) return;

      if (!response.success || !Array.isArray(response.data)) {
        setConversationList([]);
        setError(response.error || 'Failed to load conversations.');
        setLoading(false);
        return;
      }

      const normalizedList = response.data.map((item) => normalizeConversation(item, agents));
      setConversationList(normalizedList);
      setLoading(false);

      const sparseIds = normalizedList
        .filter(isSparseConversation)
        .slice(0, 20)
        .map((conversation) => conversation.id);

      if (sparseIds.length === 0) {
        return;
      }

      const detailResponses = await Promise.all(sparseIds.map((id) => api.conversations.getById(id)));
      if (cancelled) return;

      const detailMap: Record<string, ConversationDetail> = {};
      for (const detailResponse of detailResponses) {
        if (!detailResponse.success || !detailResponse.data?.id) continue;
        const detail = normalizeConversationDetail(detailResponse.data, agents);
        detailMap[detail.id] = detail;
      }

      if (Object.keys(detailMap).length > 0) {
        setConversationCache((current) => ({ ...current, ...detailMap }));
        setConversationList((current) => current.map((conversation) => detailMap[conversation.id] || conversation));
      }
    };

    void loadConversations();
    return () => {
      cancelled = true;
    };
  }, [agents]);

  const filteredConversations = useMemo(() => {
    return conversationList.filter((conversation) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        conversation.user.toLowerCase().includes(q) ||
        conversation.topic.toLowerCase().includes(q) ||
        conversation.preview.toLowerCase().includes(q) ||
        conversation.agentName.toLowerCase().includes(q);
      const matchesAgent = filterAgent === 'all' || conversation.agentId === filterAgent;
      const matchesSentiment = filterSentiment === 'all' || conversation.sentiment === filterSentiment;
      return matchesSearch && matchesAgent && matchesSentiment;
    });
  }, [conversationList, filterAgent, filterSentiment, searchQuery]);

  useEffect(() => {
    const context = loadFromStorage<{ incidentId?: string; agentId?: string; incidentType?: string } | null>(INCIDENT_CONTEXT_STORAGE_KEY, null);
    setIncidentContext(context);
    if (context) {
      removeFromStorage(INCIDENT_CONTEXT_STORAGE_KEY);
    }
    if (!context) return;

    if (context.agentId) {
      setFilterAgent(context.agentId);
    }

    if (context.incidentType === 'escalation' || context.incidentType === 'toxicity' || context.incidentType === 'legal_risk') {
      setFilterSentiment('negative');
    }
  }, []);

  useEffect(() => {
    if (initialAgentId) {
      setFilterAgent(initialAgentId);
      return;
    }

    const workspaceFocus = loadFromStorage<{ agentId?: string } | null>(AGENT_WORKSPACE_FOCUS_STORAGE_KEY, null);
    if (workspaceFocus?.agentId) {
      setFilterAgent(workspaceFocus.agentId);
    }
  }, [initialAgentId]);

  const openConversation = useCallback(async (id: string) => {
    const cached = conversationCache[id];
    if (cached) {
      setSelectedConversation(cached);
      return;
    }

    setDetailLoading(true);
    const response = await api.conversations.getById(id);
    setDetailLoading(false);

    if (!response.success || !response.data) {
      toast.error(response.error || 'Failed to load conversation transcript');
      return;
    }

    const detail = normalizeConversationDetail(response.data, agents);
    setConversationCache((current) => ({ ...current, [detail.id]: detail }));
    setConversationList((current) => current.map((conversation) => conversation.id === detail.id ? detail : conversation));
    setSelectedConversation(detail);
  }, [agents, conversationCache]);

  useEffect(() => {
    if (!incidentContext?.agentId || filteredConversations.length === 0 || selectedConversation) return;
    const matchingConversation = filteredConversations.find((conversation) => conversation.agentId === incidentContext.agentId);
    if (matchingConversation) {
      void openConversation(matchingConversation.id);
    }
  }, [filteredConversations, incidentContext, openConversation, selectedConversation]);

  const clearIncidentFocus = () => {
    setIncidentContext(null);
    setFilterAgent('all');
    setFilterSentiment('all');
    setSearchQuery('');
    setSelectedConversation(null);
  };

  const exportCSV = () => {
    const rows = filteredConversations.map((conversation) =>
      `${conversation.id},${conversation.timestamp},${conversation.user},${conversation.agentName},${conversation.sentiment},${conversation.tokens}`
    );
    const csvContent = ['ID,Date,User,Agent,Sentiment,Tokens'].concat(rows).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `conversations_export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 relative z-10 w-full max-w-7xl mx-auto">
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
            onClick={clearIncidentFocus}
            className="rounded-xl border border-cyan-500/20 bg-slate-950/60 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-400/40"
          >
            Clear focus
          </button>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-700/60 pb-5">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <MessageSquare className="w-8 h-8 text-cyan-400" /> Conversations
          </h1>
          <p className="text-slate-400 mt-1.5">Review real conversation history, transcript evidence, and runtime interaction patterns.</p>
        </div>
        <div className="flex items-center gap-3">
          {incidentContext?.incidentId && (
            <button
              onClick={() => onNavigate?.('incidents')}
              className="px-4 py-2.5 bg-slate-800 text-slate-300 border border-slate-700 font-semibold rounded-xl flex items-center gap-2 hover:bg-slate-700 hover:text-white transition-all shadow-lg"
            >
              <AlertTriangle className="w-4 h-4" /> Back to incident
            </button>
          )}
          <button
            onClick={exportCSV}
            disabled={filteredConversations.length === 0}
            className="px-4 py-2.5 bg-slate-800 text-slate-300 border border-slate-700 font-semibold rounded-xl flex items-center gap-2 hover:bg-slate-700 hover:text-white transition-all shadow-lg disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4 flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            id="conversations-search"
            name="conversations_search"
            type="text"
            placeholder="Search by user, topic, content, or agent..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-cyan-500 text-sm transition-colors"
          />
        </div>

        <select
          id="conversations-agent"
          name="conversations_agent"
          value={filterAgent}
          onChange={(event) => setFilterAgent(event.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-300 text-sm rounded-xl px-4 py-2.5 outline-none hover:border-slate-600 focus:border-cyan-500"
        >
          <option value="all">All Agents</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>

        <select
          id="conversations-sentiment"
          name="conversations_sentiment"
          value={filterSentiment}
          onChange={(event) => setFilterSentiment(event.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-300 text-sm rounded-xl px-4 py-2.5 outline-none hover:border-slate-600 focus:border-cyan-500"
        >
          <option value="all">Any Sentiment</option>
          <option value="positive">Positive</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-16 bg-slate-800/30 rounded-2xl border border-slate-700/50">
          <Loader2 className="w-10 h-10 text-cyan-400 mx-auto mb-4 animate-spin" />
          <p className="text-slate-400">Loading live conversations...</p>
        </div>
      ) : error ? (
        <div className="text-center py-16 bg-slate-800/30 rounded-2xl border border-rose-500/20">
          <AlertTriangle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">Conversation data unavailable</h3>
          <p className="text-slate-400">{error}</p>
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/30 rounded-2xl border border-slate-700/50">
          <Bot className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">No active agents</h3>
          <p className="text-slate-400">Add an agent to fleet before expecting governed conversation telemetry here.</p>
        </div>
      ) : conversationList.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/30 rounded-2xl border border-slate-700/50">
          <MessageSquare className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">No conversation records yet</h3>
          <p className="text-slate-400">Live conversations will appear here as governed agents start handling requests.</p>
        </div>
      ) : filteredConversations.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/30 rounded-2xl border border-slate-700/50">
          <Filter className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">No conversation records found</h3>
          <p className="text-slate-400">There are no live conversations for the current filters yet.</p>
        </div>
      ) : (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl overflow-hidden backdrop-blur-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-900/50 text-slate-400 border-b border-slate-700/50 uppercase tracking-wider text-xs">
                  <th className="px-6 py-4 font-medium">User & Topic</th>
                  <th className="px-6 py-4 font-medium">Agent</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                  <th className="px-6 py-4 font-medium">Sentiment</th>
                  <th className="px-6 py-4 font-medium">Date & Tokens</th>
                  <th className="px-6 py-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {filteredConversations.map((conversation) => (
                  <tr key={conversation.id} className="hover:bg-slate-700/20 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                          <User className="w-4 h-4 text-slate-400" />
                        </div>
                        <div>
                          <p className="font-semibold text-white">{conversation.user}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{conversation.topic}</p>
                          <p className="text-xs text-slate-600 mt-1 line-clamp-1">{conversation.preview}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="inline-flex items-center gap-2 bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-lg">
                        <Bot className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="text-slate-300 font-medium text-xs">{conversation.agentName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <span className="inline-flex rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300">
                          {conversation.status}
                        </span>
                        <p className="text-xs text-slate-500">{conversation.platform}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${conversation.sentiment === 'positive' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        conversation.sentiment === 'negative' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                          'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                        }`}>
                        {conversation.sentiment === 'positive' ? <CheckCircle className="w-3 h-3" /> :
                          conversation.sentiment === 'negative' ? <AlertTriangle className="w-3 h-3" /> : null}
                        <span className="capitalize">{conversation.sentiment}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-slate-300 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        {new Date(conversation.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{conversation.tokens} tokens</p>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => void openConversation(conversation.id)}
                        className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-400/10 px-3 py-1.5 rounded-lg transition-colors bg-transparent border border-transparent hover:border-cyan-400/20"
                      >
                        <Eye className="w-4 h-4" /> View log
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(selectedConversation || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !detailLoading && setSelectedConversation(null)} />
          <div className="relative w-full max-w-2xl bg-slate-900 border-l border-slate-700/60 h-full flex flex-col animate-in slide-in-from-right duration-300 shadow-2xl">
            <div className="px-6 py-5 border-b border-slate-700/60 flex items-center justify-between bg-slate-800/50">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-cyan-400" />
                  Conversation Transcript
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Session ID: <span className="font-mono text-slate-300">{selectedConversation?.id || 'Loading...'}</span>
                </p>
              </div>
              <button
                onClick={() => setSelectedConversation(null)}
                disabled={detailLoading}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-xl transition-colors disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {detailLoading || !selectedConversation ? (
                <div className="py-20 text-center">
                  <Loader2 className="w-10 h-10 text-cyan-400 mx-auto mb-4 animate-spin" />
                  <p className="text-slate-400">Loading transcript...</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
                      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Agent</p>
                      <p className="text-sm font-semibold text-white truncate">{selectedConversation.agentName}</p>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
                      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Tokens</p>
                      <p className="text-sm font-semibold text-white truncate">{selectedConversation.tokens} used</p>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
                      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Time</p>
                      <p className="text-sm font-semibold text-white truncate">
                        {new Date(selectedConversation.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 flex flex-col justify-center">
                      <span className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${selectedConversation.sentiment === 'positive' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        selectedConversation.sentiment === 'negative' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                          'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                        }`}>
                        <span className="capitalize">{selectedConversation.sentiment}</span>
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider border-b border-slate-700/50 pb-2">Transcript</h3>

                    {selectedConversation.messages.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
                        No message records are attached to this conversation yet.
                      </div>
                    ) : (
                      selectedConversation.messages.map((message) => (
                        <div key={message.id} className={`flex gap-4 ${message.role === 'assistant' ? 'flex-row-reverse' : ''}`}>
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${message.role === 'assistant' ? 'bg-cyan-500/20 border border-cyan-500/30' : 'bg-slate-700'}`}>
                            {message.role === 'assistant' ? <Bot className="w-4 h-4 text-cyan-400" /> : <User className="w-4 h-4 text-slate-300" />}
                          </div>
                          <div className={`max-w-[85%] rounded-2xl p-4 text-sm ${message.role === 'assistant' ? 'bg-cyan-500/10 rounded-tr-sm border border-cyan-500/20 text-cyan-100' : 'bg-slate-800 rounded-tl-sm border border-slate-700/50 text-slate-200'}`}>
                            <p className={`mb-1 text-xs font-semibold ${message.role === 'assistant' ? 'text-cyan-400' : 'text-slate-400'}`}>
                              {message.role === 'assistant' ? selectedConversation.agentName : selectedConversation.user}
                            </p>
                            <p>{message.content}</p>
                            <p className="mt-3 text-[11px] text-slate-500">
                              {new Date(message.createdAt).toLocaleString()} · {message.tokenCount} tokens
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="p-6 border-t border-slate-700/60 bg-slate-800/30">
              <button
                onClick={() => setSelectedConversation(null)}
                className="w-full xl:w-auto px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-xl transition-colors"
              >
                Close Transcript
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
