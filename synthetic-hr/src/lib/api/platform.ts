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
  allowed_origins?: string[];
  allowed_agent_ids?: string[];
  deployment_type?: 'website' | 'api' | 'terminal' | 'internal' | null;
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
    allowedOrigins?: string[];
    allowedAgentIds?: string[];
    deploymentType?: 'website' | 'api' | 'terminal' | 'internal' | null;
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
    allowedOrigins?: string[];
    allowedAgentIds?: string[];
    deploymentType?: 'website' | 'api' | 'terminal' | 'internal' | null;
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
  required_role?: string | null;
  assigned_to?: string | null;
  required_approvals?: number;
  approvals_recorded?: number;
  approvals_remaining?: number;
  awaiting_additional_approval?: boolean;
  approval?: AgentJobApproval | null;
  reason_category?: 'policy_blocked' | 'approval_required' | 'reliability_degraded' | 'execution_failed' | null;
  reason_message?: string | null;
  recommended_next_action?: string | null;
};

export type AgentJobApproval = {
  id: string;
  job_id: string;
  requested_by: string | null;
  approved_by: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  policy_snapshot: any;
  required_approvals?: number;
  approval_history?: Array<{
    reviewer_id: string;
    decision: 'approved' | 'rejected';
    decided_at: string;
  }>;
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

  async delete(id: string): Promise<ApiResponse<{ id: string }>> {
    return authenticatedFetch(`/runtimes/${id}`, { method: 'DELETE' });
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
  async list(params?: { agent_id?: string; status?: string; type?: string; batch_id?: string; playbook_id?: string; limit?: number }): Promise<ApiResponse<AgentJob[]>> {
    const query = new URLSearchParams();
    if (params?.agent_id) query.set('agent_id', params.agent_id);
    if (params?.status) query.set('status', params.status);
    if (params?.type) query.set('type', params.type);
    if (params?.batch_id) query.set('batch_id', params.batch_id);
    if (params?.playbook_id) query.set('playbook_id', params.playbook_id);
    if (typeof params?.limit === 'number') query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return authenticatedFetch(`/jobs${suffix}`, { method: 'GET' });
  },

  async get(jobId: string): Promise<ApiResponse<{ job: AgentJob }>> {
    return authenticatedFetch(`/jobs/${jobId}`, { method: 'GET' });
  },

  async create(payload: { agent_id: string; type: 'chat_turn' | 'workflow_run' | 'connector_action'; input?: any; playbook_id?: string; batch_id?: string; parent_job_id?: string }): Promise<ApiResponse<{ job: AgentJob; approval: AgentJobApproval | null }>> {
    return authenticatedFetch('/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async bulk(payload: { agent_id: string; type: string; playbook_id?: string; rows: any[] }): Promise<ApiResponse<{ batch_id: string; jobs: AgentJob[]; count: number }>> {
    return authenticatedFetch('/jobs/bulk', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async decide(jobId: string, decision: 'approved' | 'rejected'): Promise<ApiResponse<{ job: AgentJob; approval: AgentJobApproval; awaiting_additional_approval?: boolean; approvals_remaining?: number }>> {
    return authenticatedFetch(`/jobs/${jobId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
  },

  async share(jobId: string, ttlDays = 7): Promise<ApiResponse<{ token: string; expires_at: string; url_path: string }>> {
    return authenticatedFetch(`/jobs/${jobId}/share`, {
      method: 'POST',
      body: JSON.stringify({ ttl_days: ttlDays }),
    });
  },

  async feedback(jobId: string, feedback: 1 | -1 | 0): Promise<ApiResponse<{ id: string; feedback: number }>> {
    return authenticatedFetch(`/jobs/${jobId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    });
  },

  async listComments(jobId: string): Promise<ApiResponse<PlaybookComment[]>> {
    return authenticatedFetch(`/jobs/${jobId}/comments`, { method: 'GET' });
  },

  async addComment(jobId: string, content: string): Promise<ApiResponse<PlaybookComment>> {
    return authenticatedFetch(`/jobs/${jobId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
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
  api_enabled?: boolean;
  api_slug?: string | null;
};

export type PlaybookSchedule = {
  id: string;
  organization_id: string;
  playbook_id: string;
  agent_id: string;
  input_template: Record<string, any>;
  cron_expression: string;
  timezone: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PlaybookTrigger = {
  id: string;
  organization_id: string;
  name: string;
  playbook_id: string;
  agent_id: string;
  event_type: string;
  event_filter: Record<string, any>;
  field_mappings: Record<string, string>;
  enabled: boolean;
  fire_count: number;
  last_fired_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type CustomPlaybook = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  output_description: string | null;
  field_extractor_prompt: string | null;
  category: string;
  icon_name: string | null;
  fields: Array<{ key: string; label: string; placeholder?: string; kind: 'text' | 'textarea' }>;
  workflow: any;
  version: number;
  version_history: any[];
  test_cases: any[];
  api_enabled: boolean;
  api_slug: string | null;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PlaybookComment = {
  id: string;
  job_id: string;
  user_id: string | null;
  content: string;
  created_at: string;
};

export const playbooksApi = {
  async listSettings(): Promise<ApiResponse<PlaybookSettingRow[]>> {
    return authenticatedFetch('/playbooks/settings', { method: 'GET' });
  },

  async updateSetting(playbookId: string, payload: { enabled?: boolean; overrides?: Record<string, any>; api_enabled?: boolean; api_slug?: string | null }): Promise<ApiResponse<PlaybookSettingRow>> {
    return authenticatedFetch(`/playbooks/settings/${encodeURIComponent(playbookId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async generateInputs(playbookId: string, payload: { context: string; field_extractor_prompt?: string; fields?: Array<{ key: string }> }): Promise<ApiResponse<{ fields: Record<string, string> }>> {
    return authenticatedFetch(`/playbooks/${encodeURIComponent(playbookId)}/generate-inputs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Schedules
  async listSchedules(): Promise<ApiResponse<PlaybookSchedule[]>> {
    return authenticatedFetch('/playbooks/schedules', { method: 'GET' });
  },
  async createSchedule(payload: Omit<PlaybookSchedule, 'id' | 'organization_id' | 'fire_count' | 'last_run_at' | 'next_run_at' | 'created_by' | 'created_at' | 'updated_at'>): Promise<ApiResponse<PlaybookSchedule>> {
    return authenticatedFetch('/playbooks/schedules', { method: 'POST', body: JSON.stringify(payload) });
  },
  async updateSchedule(id: string, payload: Partial<PlaybookSchedule>): Promise<ApiResponse<PlaybookSchedule>> {
    return authenticatedFetch(`/playbooks/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  async deleteSchedule(id: string): Promise<ApiResponse<void>> {
    return authenticatedFetch(`/playbooks/schedules/${id}`, { method: 'DELETE' });
  },

  // Triggers
  async listTriggers(): Promise<ApiResponse<PlaybookTrigger[]>> {
    return authenticatedFetch('/playbooks/triggers', { method: 'GET' });
  },
  async createTrigger(payload: Pick<PlaybookTrigger, 'name' | 'playbook_id' | 'agent_id' | 'event_type' | 'event_filter' | 'field_mappings' | 'enabled'>): Promise<ApiResponse<PlaybookTrigger>> {
    return authenticatedFetch('/playbooks/triggers', { method: 'POST', body: JSON.stringify(payload) });
  },
  async updateTrigger(id: string, payload: Partial<PlaybookTrigger>): Promise<ApiResponse<PlaybookTrigger>> {
    return authenticatedFetch(`/playbooks/triggers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  async deleteTrigger(id: string): Promise<ApiResponse<void>> {
    return authenticatedFetch(`/playbooks/triggers/${id}`, { method: 'DELETE' });
  },

  // Custom playbooks
  async listCustom(): Promise<ApiResponse<CustomPlaybook[]>> {
    return authenticatedFetch('/playbooks/custom', { method: 'GET' });
  },
  async createCustom(payload: Partial<CustomPlaybook>): Promise<ApiResponse<CustomPlaybook>> {
    return authenticatedFetch('/playbooks/custom', { method: 'POST', body: JSON.stringify(payload) });
  },
  async updateCustom(id: string, payload: Partial<CustomPlaybook>): Promise<ApiResponse<CustomPlaybook>> {
    return authenticatedFetch(`/playbooks/custom/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  async deleteCustom(id: string): Promise<ApiResponse<void>> {
    return authenticatedFetch(`/playbooks/custom/${id}`, { method: 'DELETE' });
  },

  async getAnalytics(days = 30): Promise<ApiResponse<{
    totals: { runs: number; succeeded: number; cost_usd: number; days: number };
    by_playbook: Array<{ playbook_id: string; runs: number; succeeded: number; failed: number; thumbsUp: number; thumbsDown: number; totalCostUsd: number; avg_cost_usd: number; success_rate: number }>;
    daily_series: Array<{ date: string; runs: number }>;
  }>> {
    return authenticatedFetch(`/playbooks/analytics?days=${days}`, { method: 'GET' });
  },
};

export type RoutingRule = {
  condition?: string | null;
  required_role: 'viewer' | 'manager' | 'admin' | 'super_admin';
  required_user_id?: string | null;
};

export type InterceptorRule = {
  id?: string;
  enabled?: boolean;
  match_type?: 'always' | 'pii_detected' | 'keyword' | 'regex';
  match_value?: string;
  transform?: 'redact_pii' | 'replace' | 'append_system' | 'prepend_system';
  find?: string;
  replacement?: string;
  text?: string;
  // Route-model condition fields
  condition?: 'always' | 'risk_score_above' | 'monthly_cost_above';
  threshold?: number;
  target_model?: string;
};

export type PolicyBusinessHours = {
  start: string;
  end: string;
  utc_offset?: string | null;
};

export type ActionPolicyConstraints = {
  amount_field?: string | null;
  amount_threshold?: number | null;
  threshold_required_role?: 'viewer' | 'manager' | 'admin' | 'super_admin' | null;
  entity_field?: string | null;
  allowed_entities?: string[] | null;
  business_hours?: PolicyBusinessHours | null;
  emergency_disabled?: boolean | null;
  dual_approval?: boolean | null;
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
  routing_rules: RoutingRule[];
  interceptor_rules?: InterceptorRule[];
  policy_constraints?: ActionPolicyConstraints | null;
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
    routing_rules?: RoutingRule[];
    interceptor_rules?: InterceptorRule[];
    policy_constraints?: ActionPolicyConstraints;
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
