import { authenticatedFetch, getAuthHeaders, normalizeErrorPayload, API_BASE_URL } from './_helpers';
import type { ApiResponse } from './_helpers';

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

  async validateYaml(_id: string, yamlSource: string): Promise<{ valid: boolean; error?: string }> {
    const res = await authenticatedFetch<{ valid: boolean; error?: string }>('/policies/packs/_/validate-yaml', {
      method: 'POST',
      body: JSON.stringify({ yaml_source: yamlSource }),
    });
    return (res as any).data ?? (res as any);
  },

  async simulate(yamlSources: string[], context: Record<string, unknown>): Promise<ApiResponse<any>> {
    return authenticatedFetch<any>('/policies/simulate', {
      method: 'POST',
      body: JSON.stringify({ yaml_sources: yamlSources, context }),
    });
  },

  async getTemplates(): Promise<ApiResponse<Array<{ key: string; yaml_source: string }>>> {
    return authenticatedFetch<Array<{ key: string; yaml_source: string }>>('/policies/templates', {
      method: 'GET',
    });
  },

  async getVersionHistory(id: string): Promise<ApiResponse<any[]>> {
    return authenticatedFetch<any[]>(`/policies/packs/${encodeURIComponent(id)}/versions`, {
      method: 'GET',
    });
  },

  async saveVersion(id: string, yamlSource: string, rules: unknown, changeNote?: string): Promise<ApiResponse<any>> {
    return authenticatedFetch<any>(`/policies/packs/${encodeURIComponent(id)}/versions`, {
      method: 'POST',
      body: JSON.stringify({ yaml_source: yamlSource, rules, change_note: changeNote }),
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

  async getAgentScorecard(agentId: string, days = 30): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/compliance/agents/${encodeURIComponent(agentId)}/scorecard?days=${days}`, {
      method: 'GET',
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
      const filename = match?.[1] || `zapheit-${type}-summary.pdf`;
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

export interface AuditLogEntry {
  id: string;
  organization_id: string;
  user_id: string | null;
  resource_type: string;
  resource_id: string | null;
  action: string;
  details: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  users?: { id: string; email: string; full_name: string | null } | null;
}

export const auditLogsApi = {
  async list(params?: {
    action?: string;
    resource_type?: string;
    user_id?: string;
    from?: string;
    to?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<AuditLogEntry[]> & { total?: number; page?: number; limit?: number }> {
    const query = new URLSearchParams();
    if (params?.action) query.set('action', params.action);
    if (params?.resource_type) query.set('resource_type', params.resource_type);
    if (params?.user_id) query.set('user_id', params.user_id);
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    if (params?.search) query.set('search', params.search);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return authenticatedFetch(`/compliance/audit-logs${qs ? `?${qs}` : ''}`, { method: 'GET' });
  },
};
