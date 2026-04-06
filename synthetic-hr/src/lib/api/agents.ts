import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';
import type { AIAgent, AgentVersion, AgentWorkspaceData } from '../../types';

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
    primary_pack?: string | null;
    integration_ids?: string[];
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

  async getVersions(agentId: string): Promise<ApiResponse<AgentVersion[]>> {
    return authenticatedFetch<AgentVersion[]>(`/agents/${agentId}/versions`, { method: 'GET' });
  },

  async rollbackToVersion(agentId: string, versionId: string): Promise<ApiResponse<AIAgent & { rolledBackToVersion: number }>> {
    return authenticatedFetch<AIAgent & { rolledBackToVersion: number }>(`/agents/${agentId}/versions/${versionId}/rollback`, { method: 'POST' });
  },

  async getForecast(agentId: string): Promise<ApiResponse<{
    agentId: string;
    rollingAvg7d: number;
    forecastMonthly: number;
    confidenceLow: number;
    confidenceHigh: number;
    trend: 'up' | 'flat' | 'down';
    sparkline: Array<{ date: string; cost: number }>;
  }>> {
    return authenticatedFetch(`/agents/${agentId}/forecast`, { method: 'GET' });
  },

  async getTrustScore(agentId: string): Promise<ApiResponse<{
    agentId: string;
    score: number;
    grade: 'A' | 'B' | 'C' | 'D';
    breakdown: { riskComponent: number; errorRateComponent: number; redTeamComponent: number; policyComponent: number };
    inputs: { riskScore: number; errorRate: number; redTeamPassRate: number; policyCompliancePct: number };
  }>> {
    return authenticatedFetch(`/agents/${agentId}/trust-score`, { method: 'GET' });
  },

  async getHealth(agentId: string): Promise<ApiResponse<{
    agentId: string;
    latency: { p50: number; p95: number; p99: number };
    errorRate: number;
    totalRequests: number;
    uptimePct: number;
    sparkline: Array<{ date: string; requests: number; avgLatency: number; cost: number }>;
  }>> {
    return authenticatedFetch(`/agents/${agentId}/health`, { method: 'GET' });
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
      deploy_method: 'website' | 'api' | 'terminal' | null;
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

  async getTraces(params?: {
    agent_id?: string;
    model?: string;
    from?: string;
    to?: string;
    min_latency?: number;
    limit?: number;
    offset?: number;
    sort_by?: string;
    sort_dir?: 'asc' | 'desc';
  }): Promise<ApiResponse<{ traces: any[]; total: number; stats: any }>> {
    const query = new URLSearchParams();
    if (params?.agent_id) query.set('agent_id', params.agent_id);
    if (params?.model) query.set('model', params.model);
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    if (params?.min_latency != null) query.set('min_latency', String(params.min_latency));
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    if (params?.sort_by) query.set('sort_by', params.sort_by);
    if (params?.sort_dir) query.set('sort_dir', params.sort_dir);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return authenticatedFetch(`/traces${suffix}`, { method: 'GET' });
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

  /**
   * Get reasoning traces for a conversation
   */
  async getTrace(id: string): Promise<ApiResponse<any[]>> {
    return authenticatedFetch<any[]>(`/conversations/${id}/trace`, {
      method: 'GET',
    });
  },
};
