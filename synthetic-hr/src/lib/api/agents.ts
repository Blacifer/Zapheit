import { authenticatedFetch, getAuthHeaders, API_BASE_URL } from './_helpers';
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

  /** Get agent performance scorecard (composite 0–100 score + 3-period trend) */
  async getScorecard(id: string): Promise<ApiResponse<{
    agentId: string;
    agentName: string;
    current: {
      score: number;
      grade: 'A' | 'B' | 'C' | 'D';
      breakdown: { satisfaction: number; slo_pass_rate: number; incident_score: number; cost_efficiency: number };
      inputs: { total_conversations: number; incident_rate_pct: number; total_cost_usd: number; cost_per_conv_usd: number; satisfaction_pct: number | null };
    };
    trend: 'improving' | 'declining' | 'stable';
    history: Array<{ score: number; grade: 'A' | 'B' | 'C' | 'D'; breakdown: any; inputs: any }>;
    slo_targets: Record<string, any>;
  }>> {
    return authenticatedFetch(`/agents/${id}/scorecard`, { method: 'GET' });
  },

  /** Get agent manifest + live SLO status */
  async getManifest(id: string): Promise<ApiResponse<{
    agent_id: string;
    manifest: {
      capabilities?: string[];
      slo_targets?: {
        uptime_pct?: number;
        max_latency_ms?: number;
        min_satisfaction?: number;
        max_cost_per_request_usd?: number;
      };
      tags?: string[];
      owner_email?: string;
      deployment_environment?: 'production' | 'staging' | 'sandbox';
      review_cadence?: 'weekly' | 'monthly' | 'quarterly' | 'none';
      notes?: string;
    };
    slo_status: {
      satisfaction: { target: number | null; actual: number | null; passing: boolean | null };
      cost_per_request: { target: number | null; actual: number | null; passing: boolean | null };
      incidents_30d: number;
    };
  }>> {
    return authenticatedFetch(`/agents/${id}/manifest`);
  },

  /** Update agent manifest fields */
  async updateManifest(id: string, manifest: Record<string, any>): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/agents/${id}/manifest`, {
      method: 'PATCH',
      body: JSON.stringify(manifest),
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

  /**
   * Fetch historical shadow-mode test runs for an agent
   */
  async getTestRuns(id: string, limit = 20): Promise<ApiResponse<any[]>> {
    const query = new URLSearchParams({ limit: String(limit) });
    return authenticatedFetch(`/agents/${id}/test-runs?${query}`);
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

  /** Get portal link for an agent (null data if not yet created) */
  async getPortalLink(agentId: string): Promise<ApiResponse<{ share_token: string; is_enabled: boolean; created_at: string } | null>> {
    return authenticatedFetch(`/agents/${agentId}/portal`, { method: 'GET' });
  },

  /** Create a portal link for an agent (idempotent) */
  async createPortalLink(agentId: string): Promise<ApiResponse<{ share_token: string; is_enabled: boolean; created_at: string }>> {
    return authenticatedFetch(`/agents/${agentId}/portal`, { method: 'POST' });
  },

  /** Toggle portal link enabled/disabled */
  async updatePortalLink(agentId: string, is_enabled: boolean): Promise<ApiResponse<{ share_token: string; is_enabled: boolean }>> {
    return authenticatedFetch(`/agents/${agentId}/portal`, {
      method: 'PATCH',
      body: JSON.stringify({ is_enabled }),
    });
  },

  /** Transition an agent to a new lifecycle state */
  async transitionLifecycle(
    agentId: string,
    to_state: 'draft' | 'provisioning' | 'active' | 'suspended' | 'decommissioning' | 'terminated',
    reason?: string,
  ): Promise<ApiResponse<{ agentId: string; fromState: string; toState: string; transitionId: string }>> {
    return authenticatedFetch(`/agents/${agentId}/lifecycle`, {
      method: 'POST',
      body: JSON.stringify({ to_state, reason }),
    });
  },

  /** Shadow compare: run standard test suite against two agents side-by-side */
  async shadowCompare(baseline_agent_id: string, candidate_agent_id: string): Promise<ApiResponse<{
    rows: Array<{
      testId: string; category: string; name: string;
      baseline: { passed: boolean; latency: number; details: string } | undefined;
      candidate: { passed: boolean; latency: number; details: string } | undefined;
    }>;
    summary: {
      baseline: { passRate: number; avgLatencyMs: number };
      candidate: { passRate: number; avgLatencyMs: number };
      promotionReady: boolean;
      promotionBlockReason: string | null;
    };
  }>> {
    return authenticatedFetch('/agents/shadow-compare', {
      method: 'POST',
      body: JSON.stringify({ baseline_agent_id, candidate_agent_id }),
    });
  },

  /** Get lifecycle transition history for an agent */
  async getLifecycleHistory(agentId: string): Promise<ApiResponse<Array<{
    id: string;
    from_state: string;
    to_state: string;
    reason: string | null;
    actor_email: string | null;
    created_at: string;
  }>>> {
    return authenticatedFetch(`/agents/${agentId}/lifecycle`, { method: 'GET' });
  },

  /**
   * Quick Deploy: upload a PDF and get back a new HR Knowledge Bot agent.
   * Uses multipart/form-data — cannot go through authenticatedFetch (no Content-Type override).
   */
  async quickDeploy(
    file: File,
    agentName?: string
  ): Promise<ApiResponse<AIAgent & { meta?: { chars_ingested: number; truncated: boolean; source_filename: string } }>> {
    try {
      const headers = await getAuthHeaders() as Record<string, string>;
      // Remove Content-Type so fetch sets the correct multipart boundary
      delete headers['Content-Type'];

      const form = new FormData();
      form.append('pdf', file);
      if (agentName) form.append('agent_name', agentName);

      const response = await fetch(`${API_BASE_URL}/agents/quick-deploy`, {
        method: 'POST',
        headers,
        body: form,
      });

      const payload = await response.json();
      if (!response.ok) {
        return { success: false, error: payload?.error || `Upload failed (${response.status})` };
      }
      return { success: true, data: payload.data, ...payload };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error' };
    }
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

  async send(payload: {
    agent_id: string;
    prompt: string;
    conversation_id?: string;
    mode?: 'operator' | 'employee' | 'external';
    template_id?: string;
    template_context?: {
      name?: string;
      businessPurpose?: string;
      riskLevel?: string;
      approvalDefault?: string;
      requiredSystems?: string[];
    };
    app_target?: {
      service?: string;
      label?: string;
    };
  }): Promise<ApiResponse<{
    conversation: any;
    message: any;
    job: any;
    approval: any;
    session: any;
  }>> {
    return authenticatedFetch(`/conversations/chat`, {
      method: 'POST',
      body: JSON.stringify(payload),
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

  /**
   * Rate a conversation (thumbs up = 1, thumbs down = -1)
   */
  async rate(id: string, rating: 1 | -1, feedback_text?: string): Promise<ApiResponse<any>> {
    return authenticatedFetch<any>(`/conversations/${id}/rate`, {
      method: 'POST',
      body: JSON.stringify({ rating, feedback_text }),
    });
  },

  /**
   * Get CSAT summary (aggregate thumbs up/down counts)
   */
  async csatSummary(): Promise<ApiResponse<{ total_rated: number; thumbs_up: number; thumbs_down: number; satisfaction_pct: number | null }>> {
    return authenticatedFetch('/conversations/csat-summary', { method: 'GET' });
  },

  /**
   * Get trending topics (top keywords from recent user messages)
   */
  async trendingTopics(): Promise<ApiResponse<{ topics: Array<{ word: string; count: number }> }>> {
    return authenticatedFetch('/analytics/trending-topics', { method: 'GET' });
  },
};
