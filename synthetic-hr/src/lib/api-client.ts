/**
 * API Client for SyntheticHR Backend
 * Handles all HTTP requests to the backend with authentication
 */

import { getSupabaseClient } from './supabase';
import { getFrontendConfig } from './config';
import type { AIAgent, Incident, CostData, SupportTicket, SalesLead, AccessRequest, AgentWorkspaceData } from '../types';

const API_BASE_URL = getFrontendConfig().apiUrl || 'http://localhost:3001/api';

const isAnonymousEndpoint = (endpoint: string): boolean => {
  return endpoint === '/health' || endpoint === '/invites/accept' || /\/invites\/[^/]+\/reject$/.test(endpoint);
};

/**
 * API Response wrapper
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  errors?: string[];
  requestId?: string;
}

function normalizeErrorPayload(response: Response, payload: any): ApiResponse<never> {
  const requestId = response.headers.get('x-request-id') || undefined;

  const candidateErrors = [
    payload?.error,
    payload?.error?.message,
    payload?.error?.error,
    payload?.message,
    payload?.details,
  ].filter((value) => typeof value === 'string' && value.trim().length > 0) as string[];

  return {
    success: false,
    error: candidateErrors[0] || `Request failed with status ${response.status}`,
    errors: Array.isArray(payload?.errors) ? payload.errors : undefined,
    requestId,
  };
}

/**
 * Get authenticated fetch headers
 */
async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const supabase = getSupabaseClient();
  if (!supabase) {
    return headers;
  }

  const { data: { session } } = await supabase.auth.getSession();

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  return headers;
}

/**
 * Authenticated fetch wrapper
 */
async function authenticatedFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const headers = await getAuthHeaders();
    const hasAuthorization = Boolean((headers as Record<string, string>).Authorization);

    if (!hasAuthorization && !isAnonymousEndpoint(endpoint)) {
      return {
        success: false,
        error: 'Not authenticated',
      };
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    const rawBody = await response.text();
    let data: any = {};

    if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = { message: rawBody };
      }
    }

    if (!response.ok) {
      return normalizeErrorPayload(response, data);
    }

    return {
      ...data,
      requestId: response.headers.get('x-request-id') || undefined,
    };
  } catch (error) {
    // AbortError is common during navigation/refresh/overlapping polls; don't spam console.
    const isAbortError = (err: unknown) => {
      if (!err) return false;
      const anyErr = err as any;
      if (anyErr?.name === 'AbortError') return true;
      const msg = typeof anyErr?.message === 'string' ? anyErr.message : '';
      return msg.toLowerCase().includes('aborterror') || msg.toLowerCase().includes('lock broken');
    };

    if (!isAbortError(error)) {
      console.error('API request failed:', error);
    }
    return {
      success: false,
      error: isAbortError(error)
        ? 'Request canceled'
        : error instanceof Error
          ? `${error.message} (API: ${API_BASE_URL})`
          : `Network request failed (API: ${API_BASE_URL})`,
    };
  }
}

/**
 * Agent API methods
 */
export const agentApi = {
  /**
   * Get all agents for the authenticated user's organization
   */
  async getAll(): Promise<ApiResponse<AIAgent[]>> {
    return authenticatedFetch<AIAgent[]>('/agents', {
      method: 'GET',
    });
  },

  /**
   * Get a single agent by ID
   */
  async getById(id: string): Promise<ApiResponse<AIAgent>> {
    return authenticatedFetch<AIAgent>(`/agents/${id}`, {
      method: 'GET',
    });
  },

  /**
   * Create a new agent
   */
  async create(agentData: {
    name: string;
    description?: string;
    agent_type: string;
    platform: string;
    model_name: string;
    system_prompt?: string;
    budget_limit?: number;
    config?: Record<string, any>;
  }): Promise<ApiResponse<AIAgent>> {
    const response = await authenticatedFetch<AIAgent | AIAgent[]>('/agents', {
      method: 'POST',
      body: JSON.stringify(agentData),
    });

    if (!response.success) {
      return response as ApiResponse<AIAgent>;
    }

    const normalizedData = Array.isArray(response.data)
      ? response.data[0]
      : response.data;

    return {
      ...response,
      data: normalizedData,
    };
  },

  /**
   * Update an existing agent
   */
  async update(
    id: string,
    updates: Partial<{
      name: string;
      description: string;
      status: 'active' | 'paused' | 'terminated';
      model_name: string;
      system_prompt: string;
      budget_limit: number;
      config: Record<string, any>;
    }>
  ): Promise<ApiResponse<AIAgent>> {
    return authenticatedFetch<AIAgent>(`/agents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async getPublishState(id: string): Promise<ApiResponse<{
    publishStatus: 'not_live' | 'ready' | 'live';
    primaryPack: string | null;
    integrationIds: string[];
    connectedTargets: Array<{
      integrationId: string;
      integrationName: string;
      packId: string;
      status: string;
      lastSyncAt?: string | null;
      lastActivityAt?: string | null;
    }>;
    lastIntegrationSyncAt?: string | null;
  }>> {
    return authenticatedFetch(`/agents/${id}/publish`, {
      method: 'GET',
    });
  },

  async getWorkspace(id: string): Promise<ApiResponse<AgentWorkspaceData>> {
    return authenticatedFetch(`/agents/${id}/workspace`, {
      method: 'GET',
    });
  },

  async updatePublishState(
    id: string,
    updates: Partial<{
      publish_status: 'not_live' | 'ready' | 'live';
      primary_pack: 'recruitment' | 'support' | 'sales' | 'it' | 'finance' | 'compliance' | null;
      integration_ids: string[];
    }>
  ): Promise<ApiResponse<{
    publishStatus: 'not_live' | 'ready' | 'live';
    primaryPack: string | null;
    integrationIds: string[];
    connectedTargets: Array<{
      integrationId: string;
      integrationName: string;
      packId: string;
      status: string;
      lastSyncAt?: string | null;
      lastActivityAt?: string | null;
    }>;
    lastIntegrationSyncAt?: string | null;
  }>> {
    return authenticatedFetch(`/agents/${id}/publish`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async pause(id: string, reason?: string): Promise<ApiResponse<AIAgent>> {
    return authenticatedFetch(`/agents/${id}/pause`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async resume(id: string, reason?: string): Promise<ApiResponse<AIAgent>> {
    return authenticatedFetch(`/agents/${id}/resume`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async goLive(id: string): Promise<ApiResponse<AIAgent>> {
    return authenticatedFetch(`/agents/${id}/go-live`, {
      method: 'POST',
    });
  },

  async escalate(
    id: string,
    options?: { notes?: string; assignee?: string }
  ): Promise<ApiResponse<{ agent: AIAgent; incident: any | null }>> {
    return authenticatedFetch(`/agents/${id}/escalate`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  },

  /**
   * Delete an agent permanently
   */
  async delete(id: string): Promise<ApiResponse<{ id: string }>> {
    return authenticatedFetch<{ id: string }>(`/agents/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Kill switch - terminate agent immediately
   */
  async kill(
    id: string,
    options: {
      level?: 1 | 2 | 3;
      reason?: string;
    }
  ): Promise<ApiResponse<AIAgent>> {
    return authenticatedFetch<AIAgent>(`/agents/${id}/kill`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  },

  /**
   * Run a shadow-mode adversarial test on an agent
   */
  async test(
    id: string,
    attackPrompt: string,
    category?: string
  ): Promise<ApiResponse<{
    latency: number;
    simulatedResponse: string;
    expectedPass: boolean;
    details: string;
    costUSD: number;
  }>> {
    return authenticatedFetch(`/agents/${id}/test`, {
      method: 'POST',
      body: JSON.stringify({ attackPrompt, category }),
    });
  },
};

/**
 * Conversation API methods
 */
export const conversationApi = {
  /**
   * Get all conversations with optional filters
   */
  async getAll(filters?: {
    agent_id?: string;
    status?: string;
    limit?: number;
  }): Promise<ApiResponse<any[]>> {
    const params = new URLSearchParams();
    if (filters?.agent_id) params.append('agent_id', filters.agent_id);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.limit) params.append('limit', filters.limit.toString());

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return authenticatedFetch<any[]>(`/conversations${queryString}`, {
      method: 'GET',
    });
  },

  /**
   * Get a single conversation with all messages
   */
  async getById(id: string): Promise<ApiResponse<any>> {
    return authenticatedFetch<any>(`/conversations/${id}`, {
      method: 'GET',
    });
  },
};

/**
 * Incident API methods
 */
export const incidentApi = {
  /**
   * Get all incidents with optional filters
   */
  async getAll(filters?: {
    agent_id?: string;
    severity?: string;
    status?: string;
    limit?: number;
  }): Promise<ApiResponse<Incident[]>> {
    const params = new URLSearchParams();
    if (filters?.agent_id) params.append('agent_id', filters.agent_id);
    if (filters?.severity) params.append('severity', filters.severity);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.limit) params.append('limit', filters.limit.toString());

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return authenticatedFetch<Incident[]>(`/incidents${queryString}`, {
      method: 'GET',
    });
  },

  /**
   * Create a new incident
   */
  async create(incidentData: {
    agent_id: string;
    conversation_id?: string;
    incident_type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    description: string;
    trigger_content?: string;
    ai_response?: string;
  }): Promise<ApiResponse<Incident>> {
    return authenticatedFetch<Incident>('/incidents', {
      method: 'POST',
      body: JSON.stringify(incidentData),
    });
  },

  /**
   * Resolve an incident
   */
  async resolve(
    id: string,
    resolution_notes?: string
  ): Promise<ApiResponse<Incident>> {
    return authenticatedFetch<Incident>(`/incidents/${id}/resolve`, {
      method: 'PUT',
      body: JSON.stringify({ resolution_notes }),
    });
  },

  /**
   * Delete an incident
   */
  async delete(id: string): Promise<ApiResponse<{ id: string }>> {
    return authenticatedFetch<{ id: string }>(`/incidents/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Run incident detection on content
   */
  async detect(content: string, agent_id?: string): Promise<ApiResponse<{
    results: any[];
    highest: any;
    needsIncident: boolean;
  }>> {
    return authenticatedFetch(`/detect`, {
      method: 'POST',
      body: JSON.stringify({ content, agent_id }),
    });
  },
};

/**
 * Cost API methods
 */
export const costApi = {
  /**
   * Get comprehensive cost insights and breakdown
   */
  async getInsights(filters?: {
    startDate?: string;
    endDate?: string;
    agentId?: string;
  }): Promise<ApiResponse<{
    insights: {
      totalCost: number;
      totalTokens: number;
      avgCostPerRequest: number;
      avgTokensPerRequest: number;
      topAgents: Array<{ agentId: string; cost: number }>;
      costByModel: Record<string, { cost: number; tokens: number; requests: number }>;
      dailyAverage: number;
    };
  }>> {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.agentId) params.append('agentId', filters.agentId);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const res: any = await authenticatedFetch(`/costs/insights${queryString}`, {
      method: 'GET',
    });

    // The backend returns { success: true, insights } directly, map it to { success, data: { insights } }
    return { success: res.success, data: { insights: res.insights }, error: res.error };
  },

  /**
   * Get cost trend over time (daily breakdown)
   */
  async getTrend(options?: {
    days?: number;
    agentId?: string;
  }): Promise<ApiResponse<{
    trend: Array<{
      date: string;
      cost: number;
      tokens: number;
      requests: number;
    }>;
  }>> {
    const params = new URLSearchParams();
    if (options?.days) params.append('days', options.days.toString());
    if (options?.agentId) params.append('agentId', options.agentId);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const res: any = await authenticatedFetch(`/costs/trend${queryString}`, {
      method: 'GET',
    });

    return { success: res.success, data: { trend: res.trend }, error: res.error };
  },

  /**
   * Get cost comparison between agents and models
   */
  async getComparison(): Promise<ApiResponse<{
    comparison: {
      agents: Array<{
        agentId: string;
        agentName: string;
        cost: number;
        tokens: number;
        requests: number;
      }>;
      models: Array<{
        model: string;
        cost: number;
        tokens: number;
        requests: number;
      }>;
    };
  }>> {
    return authenticatedFetch(`/costs/comparison`, {
      method: 'GET',
    });
  },

  /**
   * Get AI-powered cost optimization recommendations
   */
  async getOptimizationRecommendations(): Promise<ApiResponse<{
    recommendations: Array<{
      type: 'model_downgrade' | 'model_optimization';
      priority: 'low' | 'medium' | 'high';
      from?: string;
      to?: string;
      agent?: string;
      current?: string;
      recommendation?: string;
      agents?: string[];
      currentCost: number;
      estimatedSavings: number;
      percentSavings: number;
      rationale: string;
    }>;
  }>> {
    return authenticatedFetch(`/costs/optimization-recommendations`, {
      method: 'GET',
    });
  },

  /**
   * Get cost analytics with optional filters (legacy endpoint)
   */
  async getAnalytics(filters?: {
    agent_id?: string;
    period?: '7d' | '30d' | '90d';
  }): Promise<ApiResponse<{
    data: CostData[];
    totals: {
      totalCost: number;
      totalTokens: number;
      totalRequests: number;
    };
    byDate: Record<string, { cost: number; tokens: number; requests: number }>;
    period: number;
  }>> {
    const params = new URLSearchParams();
    if (filters?.agent_id) params.append('agent_id', filters.agent_id);
    if (filters?.period) params.append('period', filters.period);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return authenticatedFetch(`/costs${queryString}`, {
      method: 'GET',
    });
  },

  /**
   * Record a cost entry (for webhook/integration)
   */
  async record(costData: {
    agent_id: string;
    conversation_id?: string;
    model_name: string;
    input_tokens: number;
    output_tokens: number;
    request_count?: number;
    avg_latency_ms?: number;
  }): Promise<ApiResponse<CostData>> {
    return authenticatedFetch<CostData>('/costs', {
      method: 'POST',
      body: JSON.stringify(costData),
    });
  },
};

export const webhooksApi = {
  async list(): Promise<ApiResponse<{
    webhooks: Array<{
      id: string;
      url: string;
      events: string[];
      secret: string;
      status: 'not_tested' | 'healthy' | 'failing' | 'disabled';
      createdAt: string;
      updatedAt: string;
      lastTestedAt?: string;
      lastDeliveryAt?: string;
      successCount: number;
      failureCount: number;
    }>;
    logs: Array<{
      id: string;
      webhookId: string;
      event: string;
      endpoint: string;
      attemptedAt: string;
      status: 'delivered' | 'failed';
      responseCode?: number;
      latencyMs?: number;
      note: string;
    }>;
  }>> {
    return authenticatedFetch('/webhooks', {
      method: 'GET',
    });
  },

  async create(data: {
    url: string;
    events: string[];
  }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: {
    status?: 'not_tested' | 'healthy' | 'failing' | 'disabled';
  }): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/webhooks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async rotateSecret(id: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/webhooks/${id}/rotate-secret`, {
      method: 'POST',
    });
  },

  async delete(id: string): Promise<ApiResponse<{ id: string }>> {
    return authenticatedFetch(`/webhooks/${id}`, {
      method: 'DELETE',
    });
  },

  async test(id: string, data: {
    event: string;
  }): Promise<ApiResponse<{
    webhook: any;
    log: any;
    payload: Record<string, unknown>;
    deliveryMode: string;
  }>> {
    return authenticatedFetch(`/webhooks/${id}/test`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

/**
 * Dashboard API methods
 */
export const dashboardApi = {
  /**
   * Get dashboard summary with all metrics
   */
  async getSummary(): Promise<ApiResponse<{
    agents: {
      total: number;
      active: number;
      paused: number;
      terminated: number;
      highRisk: number;
    };
    incidents: {
      total: number;
      open: number;
      critical: number;
    };
    costs: {
      totalUSD: number;
      totalTokens: number;
      avgDaily: number;
    };
    riskScore: number;
    riskByCategory: {
      security: number;
      financial: number;
      brand: number;
      legal: number;
      cost: number;
    };
    agentList: AIAgent[];
  }>> {
    return authenticatedFetch('/dashboard', {
      method: 'GET',
    });
  },

  async getTelemetry(days = 7): Promise<ApiResponse<{
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
  }>> {
    return authenticatedFetch(`/dashboard/telemetry?days=${days}`, {
      method: 'GET',
    });
  },
};

/**
 * API Key management for integrations
 */
type ApiKeyManagerRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type ApiKeyUsageRecord = {
  date: string;
  requests: number;
  errors: number;
  last_used_at?: string;
};

type ApiKeyRecord = {
  id: string;
  name: string;
  status: 'active' | 'expired' | 'revoked';
  environment: 'production' | 'staging' | 'development';
  masked_key: string;
  key_prefix: string;
  created_at: string;
  created_by?: string | null;
  created_by_user?: ApiKeyManagerRecord | null;
  last_used?: string | null;
  permissions: string[];
  preset: 'read_only' | 'operations' | 'billing' | 'full_access' | 'custom';
  manager_ids: string[];
  manager_users: ApiKeyManagerRecord[];
  description?: string | null;
  expires_at?: string | null;
  rate_limit?: number | null;
  usage_7d: ApiKeyUsageRecord[];
  usage_30d: ApiKeyUsageRecord[];
  requests_30d: number;
  errors_30d: number;
};

export const apiKeysApi = {
  async list(): Promise<ApiResponse<ApiKeyRecord[]>> {
    return authenticatedFetch('/api-keys', { method: 'GET' });
  },

  async getById(id: string): Promise<ApiResponse<ApiKeyRecord>> {
    return authenticatedFetch(`/api-keys/${id}`, { method: 'GET' });
  },

  async getActivity(id: string): Promise<ApiResponse<{
    usage_7d: ApiKeyUsageRecord[];
    usage_30d: ApiKeyUsageRecord[];
  }>> {
    return authenticatedFetch(`/api-keys/${id}/activity`, { method: 'GET' });
  },

  async create(options: {
    name: string;
    environment: 'production' | 'staging' | 'development';
    preset: 'read_only' | 'operations' | 'billing' | 'full_access' | 'custom';
    permissions?: string[];
    description?: string;
    expiresAt?: string;
    manager_ids?: string[];
    rateLimit?: number;
  }): Promise<ApiResponse<ApiKeyRecord & { key: string }>> {
    return authenticatedFetch('/api-keys', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  },

  async update(id: string, updates: {
    name?: string;
    status?: 'active' | 'expired' | 'revoked';
    environment?: 'production' | 'staging' | 'development';
    preset?: 'read_only' | 'operations' | 'billing' | 'full_access' | 'custom';
    permissions?: string[];
    manager_ids?: string[];
    expiresAt?: string | null;
    description?: string | null;
    rateLimit?: number;
  }): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/api-keys/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async revoke(id: string): Promise<ApiResponse<{ message: string }>> {
    return authenticatedFetch(`/api-keys/${id}`, { method: 'DELETE' });
  },

  async rotate(id: string): Promise<ApiResponse<any & { key: string }>> {
    return authenticatedFetch(`/api-keys/${id}/refresh`, { method: 'POST' });
  },
};

/**
 * Escalation management for critical incidents
 */
export const escalationsApi = {
  /**
   * Escalate an incident to Slack, PagerDuty, or Email
   */
  async escalate(
    incidentId: string,
    options: {
      channel: 'slack' | 'pagerduty' | 'email';
      severity?: 'low' | 'medium' | 'high' | 'critical';
      assignee?: string;
      notes?: string;
    }
  ): Promise<ApiResponse<{
    data: {
      id: string;
      incident_id: string;
      channel: string;
      severity: string;
      status: string;
      escalation_details: Record<string, any>;
      created_at: string;
    };
    message: string;
  }>> {
    return authenticatedFetch(`/incidents/${incidentId}/escalate`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  },

  /**
   * List all escalations for the organization
   */
  async list(): Promise<ApiResponse<{
    data: Array<{
      id: string;
      incident_id: string;
      channel: string;
      severity: string;
      status: 'open' | 'acknowledged' | 'resolved';
      assignee?: string;
      created_at: string;
      updated_at: string;
    }>;
    count: number;
  }>> {
    return authenticatedFetch('/escalations', {
      method: 'GET',
    });
  },

  /**
   * Get a specific escalation
   */
  async getById(id: string): Promise<ApiResponse<{
    data: {
      id: string;
      incident_id: string;
      channel: string;
      severity: string;
      status: string;
      escalation_details: Record<string, any>;
      created_at: string;
    };
  }>> {
    return authenticatedFetch(`/escalations/${id}`, {
      method: 'GET',
    });
  },

  /**
   * Update escalation status (acknowledge or resolve)
   */
  async update(
    id: string,
    updates: {
      status?: 'open' | 'acknowledged' | 'resolved';
      notes?: string;
    }
  ): Promise<ApiResponse<{
    data: {
      id: string;
      status: string;
      updated_at: string;
    };
  }>> {
    return authenticatedFetch(`/escalations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },
};

/**
 * Incident alert relay API (server-side webhook dispatch)
 */
export const alertsApi = {
  async incident(options: {
    title: string;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    incident_type: string;
    agent_name?: string;
    assignee?: string;
    notes?: string;
  }): Promise<ApiResponse<{
    message: string;
    data: Record<string, any>;
  }>> {
    return authenticatedFetch('/alerts/incident', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  },
};

/**
 * Team management for multi-user collaboration
 */
export const teamApi = {
  /**
   * Send a team invitation
   */
  async sendInvite(options: {
    email: string;
    role: 'admin' | 'manager' | 'viewer';
    message?: string;
  }): Promise<ApiResponse<{
    data: {
      id: string;
      email: string;
      role: string;
      status: string;
      expires_at: string;
      created_at: string;
    };
    message: string;
  }>> {
    return authenticatedFetch('/invites', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  },

  /**
   * List all invitations for the organization
   */
  async listInvites(status?: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled'): Promise<ApiResponse<{
    data: Array<{
      id: string;
      email: string;
      role: string;
      status: string;
      invited_by?: string;
      message?: string;
      expires_at: string;
      created_at: string;
    }>;
    count: number;
  }>> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    const queryString = params.toString() ? `?${params.toString()}` : '';
    return authenticatedFetch(`/invites${queryString}`, {
      method: 'GET',
    });
  },

  /**
   * Get a specific invitation
   */
  async getInvite(id: string): Promise<ApiResponse<{
    data: {
      id: string;
      email: string;
      role: string;
      status: string;
      created_at: string;
    };
  }>> {
    return authenticatedFetch(`/invites/${id}`, {
      method: 'GET',
    });
  },

  /**
   * Accept an invitation (public, no auth required)
   */
  async acceptInvite(token: string): Promise<ApiResponse<{
    message: string;
    data: {
      organization_id: string;
      role: string;
      email: string;
    };
  }>> {
    return authenticatedFetch('/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  /**
   * Claim an invitation (auth required; user may not be provisioned yet)
   */
  async claimInvite(token: string): Promise<ApiResponse<{
    message: string;
    data: {
      organization_id: string;
      role: string;
      email: string;
    };
  }>> {
    return authenticatedFetch('/invites/claim', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  /**
   * Reject an invitation
   */
  async rejectInvite(id: string, token: string): Promise<ApiResponse<{
    message: string;
  }>> {
    return authenticatedFetch(`/invites/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  /**
   * Cancel/revoke an invitation
   */
  async cancelInvite(id: string): Promise<ApiResponse<{
    message: string;
  }>> {
    return authenticatedFetch(`/invites/${id}`, {
      method: 'DELETE',
    });
  },
};

/**
 * Health check
 */
export const healthApi = {
  async check(): Promise<ApiResponse<{ status: string; timestamp: string }>> {
    return authenticatedFetch('/health', {
      method: 'GET',
    });
  },
};

/**
 * Connectors API
 */
export const connectorsApi = {
  // Platform Integrations
  async getIntegrations(): Promise<ApiResponse<Array<{
    id: string;
    organization_id: string;
    provider: string;
    status: string;
    auth_type: string;
    created_at: string;
    account_label?: string;
  }>>> {
    return authenticatedFetch('/connectors/integrations', {
      method: 'GET',
    });
  },

  async connectApiKeyIntegration(providerId: string, providerName: string, credentials: Record<string, string>): Promise<ApiResponse<{
    id: string;
    provider: string;
    status: string;
  }>> {
    return authenticatedFetch(`/connectors/integrations/api-key`, {
      method: 'POST',
      body: JSON.stringify({ providerId, providerName, credentials }),
    });
  },

  async initOAuthIntegration(provider: string): Promise<ApiResponse<{ url: string }>> {
    return authenticatedFetch('/connectors/integrations/oauth/init', {
      method: 'POST',
      body: JSON.stringify({ provider }),
    });
  },

  async validateIntegration(data: { provider: string; credentials: Record<string, string> }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/connectors/integrations/validate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async createIntegration(data: { name: string; status?: string; icon?: string; config?: any }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/connectors/integrations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async testIntegration(id: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/connectors/integrations/${id}/test`, {
      method: 'POST',
    });
  },

  async runIntegrationActionTest(id: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/connectors/integrations/${id}/action-test`, {
      method: 'POST',
    });
  },

  async updateIntegration(id: string, data: any): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/connectors/integrations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteIntegration(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return authenticatedFetch(`/connectors/integrations/${id}`, {
      method: 'DELETE',
    });
  },

  // Proxy Endpoints
  async getEndpoints(): Promise<ApiResponse<any[]>> {
    return authenticatedFetch('/connectors/endpoints', {
      method: 'GET',
    });
  },

  async createEndpoint(data: { path: string; method: string; description?: string; config?: any }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/connectors/endpoints', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateEndpoint(id: string, data: any): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/connectors/endpoints/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteEndpoint(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return authenticatedFetch(`/connectors/endpoints/${id}`, {
      method: 'DELETE',
    });
  },

  // Log Scrapers
  async getScrapers(): Promise<ApiResponse<any[]>> {
    return authenticatedFetch('/connectors/scrapers', {
      method: 'GET',
    });
  },

  async createScraper(data: { source: string; config?: any }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/connectors/scrapers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateScraper(id: string, data: any): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/connectors/scrapers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteScraper(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return authenticatedFetch(`/connectors/scrapers/${id}`, {
      method: 'DELETE',
    });
  },
};

/**
 * Integrations API (spec-driven)
 */
export const integrationsApi = {
  async getCatalog(): Promise<ApiResponse<{
    phase: number;
    integrations: any[];
  }>> {
    return authenticatedFetch('/integrations/catalog', { method: 'GET' });
  },

  async getAll(): Promise<ApiResponse<any[]>> {
    return authenticatedFetch('/integrations', { method: 'GET' });
  },

  async connect(service: string, credentials: Record<string, string>): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/${encodeURIComponent(service)}/connect`, {
      method: 'POST',
      body: JSON.stringify({ credentials }),
    });
  },

  async configure(service: string, credentials: Record<string, string>): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/${encodeURIComponent(service)}/configure`, {
      method: 'POST',
      body: JSON.stringify({ credentials }),
    });
  },

  // Backwards-compatible alias (older UI calls).
  async connectApiKey(service: string, credentials: Record<string, string>): Promise<ApiResponse<any>> {
    return integrationsApi.connect(service, credentials);
  },

  async disconnect(service: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/${encodeURIComponent(service)}/disconnect`, {
      method: 'POST',
    });
  },

  async test(service: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/test/${encodeURIComponent(service)}`, {
      method: 'POST',
    });
  },

  async getLogs(service: string, limit = 20): Promise<ApiResponse<any[]>> {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    return authenticatedFetch(`/integrations/${encodeURIComponent(service)}/logs?${params.toString()}`, {
      method: 'GET',
    });
  },

  async refresh(service: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/refresh/${encodeURIComponent(service)}`, {
      method: 'POST',
    });
  },

  async samplePull(service: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/${encodeURIComponent(service)}/sample-pull`, {
      method: 'POST',
    });
  },

  async initOAuth(service: string, returnTo: string, connection?: Record<string, string>, popup?: boolean): Promise<ApiResponse<{ url: string }>> {
    return authenticatedFetch('/integrations/oauth/init', {
      method: 'POST',
      body: JSON.stringify({
        service,
        returnTo,
        connection: connection || {},
        ...(popup ? { popup: true } : {}),
      }),
    });
  },

  async getActionCatalog(): Promise<ApiResponse<any[]>> {
    return authenticatedFetch('/integrations/actions', { method: 'GET' });
  },

  async upsertActions(items: Array<{ service: string; action: string; enabled: boolean }>): Promise<ApiResponse<any>> {
    return authenticatedFetch('/integrations/actions', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  },

  getOAuthAuthorizeUrl(service: string, returnTo: string): string {
    const base = API_BASE_URL.replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('return_to', returnTo);
    return `${base}/integrations/oauth/authorize/${encodeURIComponent(service)}?${params.toString()}`;
  },
};

export type SlackMessage = {
  id: string;
  slack_channel_id: string;
  slack_channel_name: string | null;
  slack_user_id: string;
  slack_user_name: string | null;
  slack_ts: string;
  thread_ts: string | null;
  text: string;
  event_type: string;
  status: 'new' | 'reviewed' | 'replied' | 'dismissed';
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
};

export const slackApi = {
  async getMessages(params?: {
    status?: 'new' | 'reviewed' | 'replied' | 'dismissed';
    limit?: number;
    offset?: number;
  }): Promise<ApiResponse<SlackMessage[]>> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return authenticatedFetch(`/integrations/slack/messages${q ? '?' + q : ''}`, { method: 'GET' });
  },

  async reply(messageId: string, text: string): Promise<ApiResponse<{ slack_ts: string }>> {
    return authenticatedFetch(`/integrations/slack/messages/${encodeURIComponent(messageId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  async updateStatus(
    messageId: string,
    status: 'new' | 'reviewed' | 'replied' | 'dismissed',
  ): Promise<ApiResponse<void>> {
    return authenticatedFetch(`/integrations/slack/messages/${encodeURIComponent(messageId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },
};

/**
 * Metrics API
 */
export const metricsApi = {
  async getSystemMetrics(): Promise<ApiResponse<any>> {
    return authenticatedFetch('/metrics/system', {
      method: 'GET',
    });
  },

  async getDeliveryMetrics(): Promise<ApiResponse<any>> {
    return authenticatedFetch('/metrics/delivery', {
      method: 'GET',
    });
  },

  async getIncidentMetrics(): Promise<ApiResponse<any>> {
    return authenticatedFetch('/metrics/incidents', {
      method: 'GET',
    });
  },
};

/**
 * Policies API
 */
export const policiesApi = {
  async getPolicyPacks(): Promise<ApiResponse<any[]>> {
    return authenticatedFetch('/policies/packs', {
      method: 'GET',
    });
  },

  async getPolicyPack(id: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/policies/packs/${id}`, {
      method: 'GET',
    });
  },

  async createPolicyPack(data: {
    name: string;
    description?: string;
    policy_type: string;
    rules: any[];
    enforcement_level?: string;
  }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/policies/packs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updatePolicyPack(id: string, updates: any): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/policies/packs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async deletePolicyPack(id: string): Promise<ApiResponse<void>> {
    return authenticatedFetch(`/policies/packs/${id}`, {
      method: 'DELETE',
    });
  },

  async getAssignments(): Promise<ApiResponse<any[]>> {
    return authenticatedFetch('/policies/assignments', {
      method: 'GET',
    });
  },

  async assignPolicy(data: {
    policy_pack_id: string;
    target_type: string;
    target_id: string;
  }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/policies/assignments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async removeAssignment(id: string): Promise<ApiResponse<void>> {
    return authenticatedFetch(`/policies/assignments/${id}`, {
      method: 'DELETE',
    });
  },

  async checkPolicy(data: {
    target_type: string;
    target_id: string;
    operation: string;
    context?: any;
  }): Promise<ApiResponse<{ allowed: boolean; violations: any[]; warnings: any[] }>> {
    return authenticatedFetch('/policies/check', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

/**
 * Compliance API
 */
export const complianceApi = {
  async getExports(): Promise<ApiResponse<any[]>> {
    return authenticatedFetch('/compliance/exports', {
      method: 'GET',
    });
  },

  async requestExport(data: {
    export_type: string;
    date_range_start?: string;
    date_range_end?: string;
    filters?: any;
  }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/compliance/exports', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getExport(id: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/compliance/exports/${id}`, {
      method: 'GET',
    });
  },

  async getEvents(params?: {
    event_type?: string;
    severity?: string;
    limit?: number;
  }): Promise<ApiResponse<any[]>> {
    const query = new URLSearchParams();
    if (params?.event_type) query.append('event_type', params.event_type);
    if (params?.severity) query.append('severity', params.severity);
    if (params?.limit) query.append('limit', params.limit.toString());

    return authenticatedFetch(`/compliance/events?${query.toString()}`, {
      method: 'GET',
    });
  },

  async logEvent(data: {
    event_type: string;
    severity?: string;
    resource_type?: string;
    resource_id?: string;
    details?: any;
  }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/compliance/events', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getStats(days?: number): Promise<ApiResponse<any>> {
    const query = days ? `?days=${days}` : '';
    return authenticatedFetch(`/compliance/stats${query}`, {
      method: 'GET',
    });
  },
};

/**
 * Batches API
 */
export const batchesApi = {
  async processLine(prompt: string, model: string): Promise<ApiResponse<{
    latency: number;
    response: string;
    costUSD: number;
  }>> {
    const response = await authenticatedFetch<any>('/batches/process-line', {
      method: 'POST',
      body: JSON.stringify({ prompt, model }),
    });

    if (!response.success) {
      return response as ApiResponse<{
        latency: number;
        response: string;
        costUSD: number;
      }>;
    }

    const normalizedData = (response.data && 'data' in response.data)
      ? response.data.data
      : response.data;

    return {
      ...response,
      data: normalizedData,
    };
  },
};

/**
 * Fine-tuning API
 */
export const fineTunesApi = {
  async createOpenAIJob(data: {
    name: string;
    baseModel: string;
    epochs: number;
    trainingRecords: Array<{ prompt: string; completion: string }>;
    validationRecords?: Array<{ prompt: string; completion: string }>;
  }): Promise<ApiResponse<{
    provider: 'openai';
    id: string;
    model: string;
    status: string;
    trainingFileId: string;
    validationFileId: string | null;
    trainedTokens: number | null;
  }>> {
    return authenticatedFetch('/fine-tunes/openai', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getOpenAIJobStatus(jobId: string): Promise<ApiResponse<{
    id: string;
    status: string;
    model: string;
    fineTunedModel: string | null;
    trainedTokens: number | null;
    estimatedFinish: number | null;
    finishedAt: number | null;
  }>> {
    return authenticatedFetch(`/fine-tunes/openai/${jobId}`, {
      method: 'GET',
    });
  },
};

/**
 * Prompt caching API
 */
export const cachingApi = {
  async getState(): Promise<ApiResponse<{
    policy: {
      enabled: boolean;
      minContextTokens: number;
      retentionHours: number;
      cacheScope: 'organization' | 'agent';
      matchMode: 'exact' | 'normalized';
    };
    telemetry: {
      stats: {
        totalObservedRequests: number;
        eligibleRequests: number;
        observedHits: number;
        estimatedSavedTokens: number;
        estimatedSavedCostUsd: number;
        hitRate: number;
        averageSavingsPercent: number;
        lastUpdatedAt: string | null;
      };
      entries: Array<{
        id: string;
        keyHash: string;
        keyPreview: string;
        modelName: string;
        endpoint: string;
        contextTokens: number;
        firstSeenAt: string;
        lastUsedAt: string;
        hits: number;
        requestsSeen: number;
        estimatedSavedTokens: number;
        estimatedSavedCostUsd: number;
      }>;
    };
  }>> {
    return authenticatedFetch('/caching', {
      method: 'GET',
    });
  },

  async updatePolicy(data: {
    enabled?: boolean;
    minContextTokens?: number;
    retentionHours?: number;
    cacheScope?: 'organization' | 'agent';
    matchMode?: 'exact' | 'normalized';
  }): Promise<ApiResponse<{
    policy: {
      enabled: boolean;
      minContextTokens: number;
      retentionHours: number;
      cacheScope: 'organization' | 'agent';
      matchMode: 'exact' | 'normalized';
    };
    telemetry: {
      stats: {
        totalObservedRequests: number;
        eligibleRequests: number;
        observedHits: number;
        estimatedSavedTokens: number;
        estimatedSavedCostUsd: number;
        hitRate: number;
        averageSavingsPercent: number;
        lastUpdatedAt: string | null;
      };
      entries: Array<{
        id: string;
        keyHash: string;
        keyPreview: string;
        modelName: string;
        endpoint: string;
        contextTokens: number;
        firstSeenAt: string;
        lastUsedAt: string;
        hits: number;
        requestsSeen: number;
        estimatedSavedTokens: number;
        estimatedSavedCostUsd: number;
      }>;
    };
  }>> {
    return authenticatedFetch('/caching/policy', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};

/**
 * Pricing API
 */
export const pricingApi = {
  async getState(): Promise<ApiResponse<{
    config: {
      requestPriceInr: number;
      batchDiscount: number;
      gstRate: number;
      models: Array<{
        id: string;
        label: string;
        provider: string;
        category: string;
        tokenPriceInr: number;
      }>;
    };
    quotes: Array<{
      id: string;
      name: string;
      scenarioId: string;
      scenarioName: string;
      createdAt: string;
      totalInr: number;
      totalWithoutCachingInr: number;
      annualRunRateInr: number;
      gstMode: 'excluded' | 'included';
      monthlyRequests: number;
      avgInputTokens: number;
      avgOutputTokens: number;
      repeatableContext: number;
      batchShare: number;
      agentCount: number;
      cacheEnabled: boolean;
      mixRows: Array<{ modelId: string; allocation: number }>;
      shareUrl?: string;
    }>;
  }>> {
    return authenticatedFetch('/pricing', {
      method: 'GET',
    });
  },

  async saveQuote(data: {
    name: string;
    scenarioId: string;
    scenarioName: string;
    totalInr: number;
    totalWithoutCachingInr: number;
    annualRunRateInr: number;
    gstMode: 'excluded' | 'included';
    monthlyRequests: number;
    avgInputTokens: number;
    avgOutputTokens: number;
    repeatableContext: number;
    batchShare: number;
    agentCount: number;
    cacheEnabled: boolean;
    mixRows: Array<{ modelId: string; allocation: number }>;
    shareUrl?: string;
  }): Promise<ApiResponse<{
    config: {
      requestPriceInr: number;
      batchDiscount: number;
      gstRate: number;
      models: Array<{
        id: string;
        label: string;
        provider: string;
        category: string;
        tokenPriceInr: number;
      }>;
    };
    quotes: Array<any>;
  }>> {
    return authenticatedFetch('/pricing/quotes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteQuote(id: string): Promise<ApiResponse<{
    config: {
      requestPriceInr: number;
      batchDiscount: number;
      gstRate: number;
      models: Array<{
        id: string;
        label: string;
        provider: string;
        category: string;
        tokenPriceInr: number;
      }>;
    };
    quotes: Array<any>;
  }>> {
    return authenticatedFetch(`/pricing/quotes/${id}`, {
      method: 'DELETE',
    });
  },
};

/**
 * Safe Harbor API
 */
type SafeHarborStateResponse = {
  organization: {
    id: string;
    name: string;
    plan: string;
    updatedAt: string;
  };
  config: {
    slaOverrides: {
      tier: string;
      uptimeTarget: string;
      supportResponseTarget: string;
      incidentAlertTarget: string;
      auditRetentionDays: number;
    };
    updatedAt: string | null;
  };
  contract: {
    id: string;
    status: 'standard' | 'requested' | 'under_review' | 'approved' | 'executed';
    reference: string;
    notes: string;
    attachments: Array<{
      id: string;
      name: string;
      contentType: string;
      path: string;
      uploadedAt: string;
    }>;
    updatedAt: string | null;
  };
  sla: {
    tier: string;
    uptimeTarget: string;
    supportResponseTarget: string;
    incidentAlertTarget: string;
    auditRetentionDays: number;
    source: string;
  };
  proofs: {
    lastWebhookDelivery: {
      id: string;
      webhookId: string;
      attemptedAt: string;
      event: string;
      status: string;
      endpoint: string;
      responseCode: number | null;
      latencyMs: number | null;
      note: string;
      sourcePage: string;
      sourceId: string;
    } | null;
    lastKillSwitchEvent: {
      createdAt: string;
      agentId: string | null;
      level: number | null;
      reason: string;
      sourcePage: string;
      sourceId: string | null;
    } | null;
    lastPolicySyncAt: string | null;
  };
};

export const safeHarborApi = {
  async getState(): Promise<ApiResponse<SafeHarborStateResponse>> {
    return authenticatedFetch('/safe-harbor', {
      method: 'GET',
    });
  },

  async downloadDocument(type: 'sla' | 'dpa' | 'security'): Promise<ApiResponse<{ filename: string }>> {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/safe-harbor/documents/${type}`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const rawBody = await response.text();
        let data: any = {};
        if (rawBody) {
          try {
            data = JSON.parse(rawBody);
          } catch {
            data = { message: rawBody };
          }
        }
        return normalizeErrorPayload(response, data);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      const match = contentDisposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `rasi-${type}-summary.pdf`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);

      return {
        success: true,
        data: { filename },
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      console.error('Safe Harbor document download failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Document download failed',
      };
    }
  },

  async updateConfig(data: {
    slaOverrides?: {
      tier?: string;
      uptimeTarget?: string;
      supportResponseTarget?: string;
      incidentAlertTarget?: string;
      auditRetentionDays?: number;
    };
  }): Promise<ApiResponse<SafeHarborStateResponse>> {
    return authenticatedFetch('/safe-harbor/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async updateContract(data: {
    status?: 'standard' | 'requested' | 'under_review' | 'approved' | 'executed';
    reference?: string;
    notes?: string;
    attachments?: Array<{
      name: string;
      contentType: string;
      contentBase64: string;
    }>;
  }): Promise<ApiResponse<SafeHarborStateResponse>> {
    return authenticatedFetch('/safe-harbor/contract', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};

export const adminApi = {
  async getCoverageStatus(): Promise<ApiResponse<{
    generatedAt: string;
    organization: {
      id: string;
      name: string;
      slug: string;
      plan: string;
      createdAt: string;
    } | null;
    bootstrap: {
      organizationReady: boolean;
      currentUserProfileReady: boolean;
      operatorReady: boolean;
      pendingInvites: number;
    };
    users: {
      total: number;
      admins: number;
      operators: number;
    };
    agents: {
      total: number;
      active: number;
      paused: number;
      terminated: number;
    };
    apiKeys: {
      total: number;
      active: number;
      recentlyUsed30d: number;
      lastUsedAt: string | null;
    };
    telemetry: {
      gatewayObserved: boolean;
      coverageScore: number;
      status: 'healthy' | 'partial' | 'at_risk';
      lastTrackedAt: string | null;
      lastTrackedModel: string | null;
      lastTrackedEndpoint: string | null;
      costRecords30d: number;
      requests30d: number;
      tokens30d: number;
      spend30dUsd: number;
    };
    providerReconciliation: {
      configured: boolean;
      totalReportedSpendUsd: number | null;
      gapUsd: number | null;
      lastSyncedAt: string | null;
      providers: Array<{
        provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
        reportedSpendUsd: number;
        source: 'manual' | 'api';
        lastSyncedAt: string | null;
        notes: string | null;
        updatedAt: string;
      }>;
    };
    providerSync: {
      providers: Array<{
        provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
        enabled: boolean;
        organizationId: string | null;
        projectId: string | null;
        updatedAt: string;
        updatedBy: string | null;
        lastTestAt?: string | null;
        lastTestStatus?: 'ok' | 'failed' | null;
        lastTestMessage?: string | null;
        lastSyncAt?: string | null;
        lastSyncStatus?: 'ok' | 'failed' | null;
        lastSyncMessage?: string | null;
        credentialsAvailable: boolean;
        automatedSyncSupported: boolean;
      }>;
      history: Array<{
        provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
        ok: boolean;
        message: string;
        runAt: string;
        trigger: 'manual' | 'scheduler';
        importedSpendUsd?: number | null;
      }>;
      scheduler: {
        lastRunAt: string | null;
        lastRunFinishedAt: string | null;
        nextRunAt: string | null;
        running: boolean;
        lastTrigger: 'manual' | 'scheduler' | null;
        lastSummary: {
          organizations: number;
          attempted: number;
          okCount: number;
          failedCount: number;
        } | null;
      };
    };
    reconciliationAlerts: Array<{
      severity: 'info' | 'warning' | 'critical';
      code: string;
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other' | 'all';
      title: string;
      message: string;
    }>;
    reconciliationAlertConfig: {
      channels: {
        inApp: boolean;
        email: boolean;
        webhook: boolean;
      };
      thresholds: {
        absoluteGapUsd: number;
        relativeGapRatio: number;
        staleSyncHours: number;
      };
      updatedAt?: string;
      updatedBy?: string | null;
    };
    reconciliationNotifications: {
      history: Array<{
        id: string;
        code: string;
        provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other' | 'all';
        severity: 'warning' | 'critical';
        title: string;
        message: string;
        sentAt: string;
      }>;
    };
    incidents: {
      open: number;
      critical: number;
      lastIncidentAt: string | null;
    };
    notes: string[];
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/coverage-status`, {
        method: 'GET',
        headers,
      });

      const rawBody = await response.text();
      let data: any = {};

      if (rawBody) {
        try {
          data = JSON.parse(rawBody);
        } catch {
          data = { message: rawBody };
        }
      }

      if (!response.ok) {
        return normalizeErrorPayload(response, data);
      }

      return {
        ...data,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load admin coverage status',
      };
    }
  },

  async updateProviderReconciliation(data: {
    provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
    reportedSpendUsd: number;
    source?: 'manual' | 'api';
    lastSyncedAt?: string;
    notes?: string | null;
  }): Promise<ApiResponse<{
    providers: Array<{
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
      reportedSpendUsd: number;
      source: 'manual' | 'api';
      lastSyncedAt: string | null;
      notes: string | null;
      updatedAt: string;
    }>;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-reconciliation`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      });

      const rawBody = await response.text();
      let payload: any = {};

      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { message: rawBody };
        }
      }

      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }

      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update provider reconciliation',
      };
    }
  },

  async deleteProviderReconciliation(provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other'): Promise<ApiResponse<{
    providers: Array<{
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
      reportedSpendUsd: number;
      source: 'manual' | 'api';
      lastSyncedAt: string | null;
      notes: string | null;
      updatedAt: string;
    }>;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-reconciliation/${provider}`, {
        method: 'DELETE',
        headers,
      });

      const rawBody = await response.text();
      let payload: any = {};

      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { message: rawBody };
        }
      }

      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }

      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete provider reconciliation',
      };
    }
  },

  async updateProviderSyncConfig(data: {
    provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
    enabled: boolean;
    organizationId?: string | null;
    projectId?: string | null;
  }): Promise<ApiResponse<{
    providers: Array<{
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
      enabled: boolean;
      organizationId: string | null;
      projectId: string | null;
      updatedAt: string;
      updatedBy: string | null;
    }>;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync-config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      });

      const rawBody = await response.text();
      let payload: any = {};
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { message: rawBody };
        }
      }
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update provider sync config',
      };
    }
  },

  async testOpenAIProviderSync(): Promise<ApiResponse<{
    provider: 'openai';
    lastTestAt: string;
    lastTestStatus: 'ok' | 'failed';
    lastTestMessage: string;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/openai/test`, {
        method: 'POST',
        headers,
      });

      const rawBody = await response.text();
      let payload: any = {};
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { message: rawBody };
        }
      }
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to test OpenAI provider sync',
      };
    }
  },

  async syncOpenAIProviderCosts(days = 30): Promise<ApiResponse<{
    provider: 'openai';
    importedSpendUsd: number;
    bucketCount: number;
    days: number;
    syncedAt: string;
    message: string;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/openai/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ days }),
      });

      const rawBody = await response.text();
      let payload: any = {};
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { message: rawBody };
        }
      }
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync OpenAI provider costs',
      };
    }
  },

  async testAnthropicProviderSync(): Promise<ApiResponse<{
    provider: 'anthropic';
    lastTestAt: string;
    lastTestStatus: 'ok' | 'failed';
    lastTestMessage: string;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/anthropic/test`, {
        method: 'POST',
        headers,
      });

      const rawBody = await response.text();
      let payload: any = {};
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { message: rawBody };
        }
      }
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to test Anthropic provider sync',
      };
    }
  },

  async syncAnthropicProviderCosts(days = 30): Promise<ApiResponse<{
    provider: 'anthropic';
    importedSpendUsd: number;
    bucketCount: number;
    days: number;
    syncedAt: string;
    message: string;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/anthropic/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ days }),
      });

      const rawBody = await response.text();
      let payload: any = {};
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { message: rawBody };
        }
      }
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync Anthropic provider costs',
      };
    }
  },

  async testOpenRouterProviderSync(): Promise<ApiResponse<{
    provider: 'openrouter';
    lastTestAt: string;
    lastTestStatus: 'ok' | 'failed';
    lastTestMessage: string;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/openrouter/test`, {
        method: 'POST',
        headers,
      });

      const rawBody = await response.text();
      let payload: any = {};
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { message: rawBody };
        }
      }
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to test OpenRouter provider sync',
      };
    }
  },

  async syncOpenRouterProviderCosts(days = 30): Promise<ApiResponse<{
    provider: 'openrouter';
    importedSpendUsd: number;
    bucketCount: number;
    days: number;
    syncedAt: string;
    message: string;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/openrouter/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ days }),
      });

      const rawBody = await response.text();
      let payload: any = {};
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { message: rawBody };
        }
      }
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync OpenRouter provider costs',
      };
    }
  },

  async runProviderSyncSweep(days = 30): Promise<ApiResponse<{
    organizations: number;
    attempted: number;
    okCount: number;
    failedCount: number;
    results: Array<{
      organizationId: string;
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
      ok: boolean;
      message: string;
    }>;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ days }),
      });

      const rawBody = await response.text();
      let payload: any = {};
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { message: rawBody };
        }
      }
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run provider sync sweep',
      };
    }
  },

  async updateReconciliationAlertConfig(data: {
    channels: {
      inApp: boolean;
      email: boolean;
      webhook: boolean;
    };
    thresholds: {
      absoluteGapUsd: number;
      relativeGapRatio: number;
      staleSyncHours: number;
    };
  }): Promise<ApiResponse<{
    channels: {
      inApp: boolean;
      email: boolean;
      webhook: boolean;
    };
    thresholds: {
      absoluteGapUsd: number;
      relativeGapRatio: number;
      staleSyncHours: number;
    };
    updatedAt?: string;
    updatedBy?: string | null;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/reconciliation-alert-config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      });

      const rawBody = await response.text();
      let payload: any = {};
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { message: rawBody };
        }
      }
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update reconciliation alert config',
      };
    }
  },
};

/**
 * OpenAI-compatible gateway (API key auth, not JWT auth)
 */
export const gatewayApi = {
  async listModels(options: { apiKey: string }): Promise<ApiResponse<{ object: string; data: Array<{ id: string }> }>> {
    try {
      const gatewayBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${gatewayBaseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
        },
      });

      const rawBody = await response.text();
      let data: any = {};

      if (rawBody) {
        try {
          data = JSON.parse(rawBody);
        } catch {
          data = { message: rawBody };
        }
      }

      if (!response.ok) {
        return normalizeErrorPayload(response, data);
      }

      return {
        success: true,
        data,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load gateway models',
      };
    }
  },

  async chatCompletions(options: {
    apiKey: string;
    model: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    agentId?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<ApiResponse<any>> {
    try {
      const gatewayBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${gatewayBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
          ...(options.agentId ? { 'x-rasi-agent-id': options.agentId } : {}),
        },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages,
          stream: false,
          agent_id: options.agentId,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
        }),
      });

      const rawBody = await response.text();
      let data: any = {};

      if (rawBody) {
        try {
          data = JSON.parse(rawBody);
        } catch {
          data = { message: rawBody };
        }
      }

      if (!response.ok) {
        return normalizeErrorPayload(response, data);
      }

      return {
        success: true,
        data,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Gateway request failed',
      };
    }
  },
};

// ============================
// Runtime + Job orchestration
// ============================

export type RuntimeInstance = {
  id: string;
  organization_id: string;
  name: string;
  mode: 'hosted' | 'vpc' | string;
  status: 'pending' | 'online' | 'offline' | 'degraded' | string;
  last_heartbeat_at: string | null;
  version: string | null;
  capabilities: any;
  metadata: any;
  created_at: string;
  updated_at: string;
};

export type AgentDeployment = {
  id: string;
  organization_id: string;
  agent_id: string;
  runtime_instance_id: string;
  status: 'active' | 'paused' | 'terminated' | string;
  execution_policy: any;
  created_at: string;
  updated_at: string;
};

export type AgentJob = {
  id: string;
  organization_id: string;
  agent_id: string | null;
  runtime_instance_id: string | null;
  type: 'chat_turn' | 'workflow_run' | 'connector_action' | string;
  status: 'pending_approval' | 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | string;
  input: any;
  output: any;
  error: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type AgentJobApproval = {
  id: string;
  job_id: string;
  requested_by: string | null;
  approved_by: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  policy_snapshot: any;
  created_at: string;
  decided_at: string | null;
};

export const runtimesApi = {
  async list(): Promise<ApiResponse<RuntimeInstance[]>> {
    return authenticatedFetch('/runtimes', { method: 'GET' });
  },

  async create(payload: { name: string; mode?: 'hosted' | 'vpc' }): Promise<ApiResponse<RuntimeInstance & { enrollment_token: string; enrollment_expires_at: string }>> {
    return authenticatedFetch('/runtimes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as any;
  },

  async rotateEnrollment(id: string): Promise<ApiResponse<RuntimeInstance & { enrollment_token: string; enrollment_expires_at: string }>> {
    return authenticatedFetch(`/runtimes/${id}/rotate-enrollment`, {
      method: 'POST',
    }) as any;
  },

  async listDeployments(agentId?: string): Promise<ApiResponse<AgentDeployment[]>> {
    const qs = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
    return authenticatedFetch(`/runtimes/deployments${qs}`, { method: 'GET' });
  },

  async deployAgent(payload: { agent_id: string; runtime_instance_id: string; execution_policy?: any }): Promise<ApiResponse<AgentDeployment>> {
    return authenticatedFetch('/runtimes/deployments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export const jobsApi = {
  async list(params?: { agent_id?: string; status?: string; limit?: number }): Promise<ApiResponse<AgentJob[]>> {
    const query = new URLSearchParams();
    if (params?.agent_id) query.set('agent_id', params.agent_id);
    if (params?.status) query.set('status', params.status);
    if (typeof params?.limit === 'number') query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return authenticatedFetch(`/jobs${suffix}`, { method: 'GET' });
  },

  async create(payload: { agent_id: string; type: 'chat_turn' | 'workflow_run' | 'connector_action'; input?: any }): Promise<ApiResponse<{ job: AgentJob; approval: AgentJobApproval | null }>> {
    return authenticatedFetch('/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async decide(jobId: string, decision: 'approved' | 'rejected'): Promise<ApiResponse<{ job: AgentJob; approval: AgentJobApproval }>> {
    return authenticatedFetch(`/jobs/${jobId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
  },
};

export const workItemsApi = {
  supportTickets: {
    async list(params?: { status?: string; limit?: number }): Promise<ApiResponse<SupportTicket[]>> {
      const query = new URLSearchParams();
      if (params?.status) query.set('status', params.status);
      if (typeof params?.limit === 'number') query.set('limit', String(params.limit));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return authenticatedFetch(`/work-items/support-tickets${suffix}`, { method: 'GET' });
    },
  },
  salesLeads: {
    async list(params?: { stage?: string; limit?: number }): Promise<ApiResponse<SalesLead[]>> {
      const query = new URLSearchParams();
      if (params?.stage) query.set('stage', params.stage);
      if (typeof params?.limit === 'number') query.set('limit', String(params.limit));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return authenticatedFetch(`/work-items/sales-leads${suffix}`, { method: 'GET' });
    },
  },
  accessRequests: {
    async list(params?: { status?: string; limit?: number }): Promise<ApiResponse<AccessRequest[]>> {
      const query = new URLSearchParams();
      if (params?.status) query.set('status', params.status);
      if (typeof params?.limit === 'number') query.set('limit', String(params.limit));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return authenticatedFetch(`/work-items/access-requests${suffix}`, { method: 'GET' });
    },
  },
};

export type PlaybookSettingRow = {
  id: string;
  organization_id: string;
  playbook_id: string;
  enabled: boolean;
  overrides: Record<string, any>;
  updated_by: string | null;
  updated_at: string;
};

export const playbooksApi = {
  async listSettings(): Promise<ApiResponse<PlaybookSettingRow[]>> {
    return authenticatedFetch('/playbooks/settings', { method: 'GET' });
  },

  async updateSetting(playbookId: string, payload: { enabled?: boolean; overrides?: Record<string, any> }): Promise<ApiResponse<PlaybookSettingRow>> {
    return authenticatedFetch(`/playbooks/settings/${encodeURIComponent(playbookId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};

export type ActionPolicyRow = {
  id: string;
  organization_id: string;
  service: string;
  action: string;
  enabled: boolean;
  require_approval: boolean;
  required_role: 'viewer' | 'manager' | 'admin' | 'super_admin';
  webhook_allowlist: string[];
  notes?: string | null;
  updated_by: string | null;
  updated_at: string;
};

export const actionPoliciesApi = {
  async list(params?: { service?: string; action?: string; limit?: number }): Promise<ApiResponse<ActionPolicyRow[]>> {
    const query = new URLSearchParams();
    if (params?.service) query.set('service', params.service);
    if (params?.action) query.set('action', params.action);
    if (typeof params?.limit === 'number') query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return authenticatedFetch(`/action-policies${suffix}`, { method: 'GET' });
  },

  async upsert(payload: {
    service: string;
    action: string;
    enabled?: boolean;
    require_approval?: boolean;
    required_role?: 'viewer' | 'manager' | 'admin' | 'super_admin';
    webhook_allowlist?: string[];
    notes?: string;
  }): Promise<ApiResponse<ActionPolicyRow>> {
    return authenticatedFetch('/action-policies', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async remove(id: string): Promise<ApiResponse<{ id: string }>> {
    return authenticatedFetch(`/action-policies/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

export type MarketplaceApp = {
  id: string;
  name: string;
  developer: string;
  category: string;
  description: string;
  permissions: string[];
  relatedAgentIds: string[];
  actionsUnlocked: string[];
  setupTimeMinutes: number;
  bundleIds: string[];
  installMethod: 'free' | 'api_key' | 'oauth2';
  requiredFields?: Array<{ name: string; label: string; type: 'text' | 'password'; placeholder?: string; required: boolean }>;
  installCount: number;
  featured: boolean;
  badge?: string;
  colorHex: string;
  logoLetter: string;
  installed: boolean;
  connectionStatus?: string | null;
  lastSyncAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorMsg?: string | null;
  comingSoon?: boolean;
  connectionSource?: 'marketplace' | 'connections' | null;
};

export type AppBundle = {
  id: string;
  name: string;
  description: string;
  intentLabel: string;
  appIds: string[];
  colorHex: string;
  icon: string;
};

export const marketplaceApi = {
  async getAll(): Promise<ApiResponse<MarketplaceApp[]>> {
    return authenticatedFetch<MarketplaceApp[]>('/marketplace/apps', { method: 'GET' });
  },

  async getBundles(): Promise<ApiResponse<AppBundle[]>> {
    return authenticatedFetch<AppBundle[]>('/marketplace/bundles', { method: 'GET' });
  },

  async getInstalled(): Promise<ApiResponse<MarketplaceApp[]>> {
    return authenticatedFetch<MarketplaceApp[]>('/marketplace/apps/installed', { method: 'GET' });
  },

  async install(appId: string, credentials: Record<string, string> = {}): Promise<ApiResponse<{ integration_id?: string; oauth?: boolean; state?: string; message: string }>> {
    return authenticatedFetch(`/marketplace/apps/${encodeURIComponent(appId)}/install`, {
      method: 'POST',
      body: JSON.stringify({ credentials }),
    });
  },

  async uninstall(appId: string): Promise<ApiResponse<{ message: string }>> {
    return authenticatedFetch(`/marketplace/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' });
  },
};

/**
 * Export all API methods
 */
export const api = {
  agents: agentApi,
  conversations: conversationApi,
  incidents: incidentApi,
  costs: costApi,
  apiKeys: apiKeysApi,
  escalations: escalationsApi,
  alerts: alertsApi,
  team: teamApi,
  dashboard: dashboardApi,
  connectors: connectorsApi,
  integrations: integrationsApi,
  webhooks: webhooksApi,
  metrics: metricsApi,
  policies: policiesApi,
  compliance: complianceApi,
  batches: batchesApi,
  fineTunes: fineTunesApi,
  caching: cachingApi,
  pricing: pricingApi,
  safeHarbor: safeHarborApi,
  health: healthApi,
  admin: adminApi,
  gateway: gatewayApi,
  runtimes: runtimesApi,
  jobs: jobsApi,
  workItems: workItemsApi,
  playbooks: playbooksApi,
  actionPolicies: actionPoliciesApi,
  marketplace: marketplaceApi,
  slack: slackApi,
};

export default api;
