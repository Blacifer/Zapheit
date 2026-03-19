import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';
import type { AIAgent, SupportTicket, SalesLead, AccessRequest } from '../../types';

/**
 * API Key management for integrations
 */
export type ApiKeyManagerRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ApiKeyUsageRecord = {
  date: string;
  requests: number;
  errors: number;
  last_used_at?: string;
};

export type ApiKeyRecord = {
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
 * Health check
 */
export const healthApi = {
  async check(): Promise<ApiResponse<{ status: string; timestamp: string }>> {
    return authenticatedFetch('/health', {
      method: 'GET',
    });
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

  async get(jobId: string): Promise<ApiResponse<{ job: AgentJob }>> {
    return authenticatedFetch(`/jobs/${jobId}`, { method: 'GET' });
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
