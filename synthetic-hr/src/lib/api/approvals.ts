import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';

export type ApprovalRequest = {
  id: string;
  organization_id: string;
  agent_id?: string | null;
  conversation_id?: string | null;
  action_policy_id?: string | null;
  service: string;
  action: string;
  action_payload: Record<string, unknown>;
  requested_by: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
  required_role: 'viewer' | 'manager' | 'admin' | 'super_admin';
  assigned_to?: string | null;
  risk_score?: number | null;
  sla_deadline?: string | null;
  reviewer_id?: string | null;
  reviewer_note?: string | null;
  expires_at: string;
  reviewed_at?: string | null;
  reason_category?: 'policy_blocked' | 'approval_required' | 'reliability_degraded' | 'execution_failed' | null;
  reason_message?: string | null;
  recommended_next_action?: string | null;
  created_at: string;
  updated_at: string;
};

export const approvalsApi = {
  async list(params?: {
    status?: string;
    agent_id?: string;
    service?: string;
    action?: string;
    limit?: number;
  }): Promise<ApiResponse<ApprovalRequest[]>> {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.agent_id) q.set('agent_id', params.agent_id);
    if (params?.service) q.set('service', params.service);
    if (params?.action) q.set('action', params.action);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return authenticatedFetch<ApprovalRequest[]>(`/approvals${qs ? `?${qs}` : ''}`, { method: 'GET' });
  },

  async create(data: {
    service: string;
    action: string;
    action_payload?: Record<string, unknown>;
    requested_by?: string;
    required_role?: 'viewer' | 'manager' | 'admin' | 'super_admin';
    agent_id?: string;
    conversation_id?: string;
    action_policy_id?: string;
    expires_in_hours?: number;
  }): Promise<ApiResponse<ApprovalRequest>> {
    return authenticatedFetch<ApprovalRequest>('/approvals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async approve(id: string, note?: string): Promise<ApiResponse<ApprovalRequest>> {
    return authenticatedFetch<ApprovalRequest>(`/approvals/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  },

  async deny(id: string, note?: string): Promise<ApiResponse<ApprovalRequest>> {
    return authenticatedFetch<ApprovalRequest>(`/approvals/${encodeURIComponent(id)}/deny`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  },

  async cancel(id: string): Promise<ApiResponse<ApprovalRequest>> {
    return authenticatedFetch<ApprovalRequest>(`/approvals/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    });
  },

  async snooze(id: string, hours: 1 | 4 | 24): Promise<ApiResponse<ApprovalRequest>> {
    return authenticatedFetch<ApprovalRequest>(`/approvals/${encodeURIComponent(id)}/snooze`, {
      method: 'POST',
      body: JSON.stringify({ hours }),
    });
  },

  async escalate(id: string): Promise<ApiResponse<ApprovalRequest>> {
    return authenticatedFetch<ApprovalRequest>(`/approvals/${encodeURIComponent(id)}/escalate`, {
      method: 'POST',
    });
  },

  async getComments(id: string): Promise<ApiResponse<any[]>> {
    return authenticatedFetch<any[]>(`/approvals/${encodeURIComponent(id)}/comments`, { method: 'GET' });
  },

  async addComment(id: string, content: string, mentionIds?: string[]): Promise<ApiResponse<any>> {
    return authenticatedFetch<any>(`/approvals/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, mention_ids: mentionIds ?? [] }),
    });
  },

  async updateSubTasks(id: string, subTasks: Array<{ title: string; completed: boolean }>): Promise<ApiResponse<any>> {
    return authenticatedFetch<any>(`/approvals/${encodeURIComponent(id)}/subtasks`, {
      method: 'PATCH',
      body: JSON.stringify({ sub_tasks: subTasks }),
    });
  },

  async bulkApprove(ids: string[], note?: string): Promise<ApiResponse<any> & { approved?: number }> {
    return authenticatedFetch<any>('/approvals/bulk-approve', {
      method: 'POST',
      body: JSON.stringify({ ids, note }),
    });
  },

  async bulkDeny(ids: string[], note?: string): Promise<ApiResponse<any> & { denied?: number }> {
    return authenticatedFetch<any>('/approvals/bulk-deny', {
      method: 'POST',
      body: JSON.stringify({ ids, note }),
    });
  },
};
