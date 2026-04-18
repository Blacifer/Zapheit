import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';
import type { Incident } from '../../types';

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
   * Update incident metadata fields (owner, priority, source, notes, next_action, status)
   */
  async updateMeta(
    id: string,
    updates: Partial<{
      owner: string;
      priority: string;
      source: string;
      notes: string;
      next_action: string;
      status: string;
    }>
  ): Promise<ApiResponse<Incident>> {
    return authenticatedFetch<Incident>(`/incidents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
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
