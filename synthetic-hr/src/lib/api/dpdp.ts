import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsentRecord {
  id: string;
  organization_id: string;
  principal_type: 'employee' | 'candidate' | 'contact' | 'vendor' | 'customer';
  principal_id: string;
  principal_email?: string;
  principal_phone?: string;
  purpose: string;
  purpose_description?: string;
  data_categories: string[];
  legal_basis: string;
  status: 'active' | 'withdrawn' | 'expired' | 'superseded';
  granted_at: string;
  expires_at?: string;
  withdrawn_at?: string;
  withdrawal_reason?: string;
  collection_method: string;
  collection_point?: string;
  notice_version?: string;
  created_at: string;
  updated_at: string;
}

export interface ConsentStats {
  total: number;
  active: number;
  withdrawn: number;
  expired: number;
  by_purpose: Record<string, number>;
  by_principal_type: Record<string, number>;
  expiring_soon: number;
}

export interface RetentionPolicy {
  id: string;
  organization_id: string;
  data_category: string;
  retention_days: number;
  applies_to_table?: string;
  purge_strategy: 'delete' | 'anonymize' | 'archive';
  on_consent_withdrawal: 'immediate' | 'end_of_retention' | 'manual';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DataPrincipalRequest {
  id: string;
  organization_id: string;
  principal_type: string;
  principal_id: string;
  principal_email?: string;
  request_type: 'access' | 'correction' | 'erasure' | 'grievance' | 'portability';
  status: 'pending' | 'in_progress' | 'completed' | 'rejected' | 'escalated';
  priority: string;
  assigned_to?: string;
  description?: string;
  due_at: string;
  completed_at?: string;
  response_summary?: string;
  rejection_reason?: string;
  erasure_receipt?: string;
  submitted_via?: string;
  created_at: string;
  updated_at: string;
}

export interface DpdpDashboard {
  consent_summary: { total: number; active: number; withdrawn: number; expired: number; expiring_soon: number };
  request_summary: { total: number; pending: number; in_progress: number; completed: number; overdue: number; escalated: number };
  retention_policies: number;
  compliance_score: number;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function qs(params?: Record<string, string | undefined>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
  if (!entries.length) return '';
  return '?' + new URLSearchParams(entries).toString();
}

export const dpdpApi = {
  // Consents
  async listConsents(params?: { purpose?: string; status?: string; principal_type?: string }): Promise<ApiResponse<ConsentRecord[]>> {
    return authenticatedFetch(`/compliance/dpdp/consents${qs(params)}`);
  },

  async getConsentStats(): Promise<ApiResponse<ConsentStats>> {
    return authenticatedFetch('/compliance/dpdp/consents/stats');
  },

  async createConsent(data: {
    principal_type: string;
    principal_id: string;
    principal_email?: string;
    principal_phone?: string;
    purpose: string;
    purpose_description?: string;
    data_categories: string[];
    legal_basis: string;
    expires_at?: string;
    collection_method: string;
    collection_point?: string;
    notice_version?: string;
  }): Promise<ApiResponse<ConsentRecord>> {
    return authenticatedFetch('/compliance/dpdp/consents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async withdrawConsent(id: string, reason?: string): Promise<ApiResponse<ConsentRecord & { immediate_purge_categories?: string[] }>> {
    return authenticatedFetch(`/compliance/dpdp/consents/${id}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  // Retention Policies
  async listRetentionPolicies(): Promise<ApiResponse<RetentionPolicy[]>> {
    return authenticatedFetch('/compliance/dpdp/retention-policies');
  },

  async createRetentionPolicy(data: {
    data_category: string;
    retention_days: number;
    applies_to_table?: string;
    purge_strategy: string;
    on_consent_withdrawal: string;
  }): Promise<ApiResponse<RetentionPolicy>> {
    return authenticatedFetch('/compliance/dpdp/retention-policies', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateRetentionPolicy(id: string, updates: Partial<RetentionPolicy>): Promise<ApiResponse<RetentionPolicy>> {
    return authenticatedFetch(`/compliance/dpdp/retention-policies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  // Data Principal Requests
  async listRequests(params?: { status?: string; request_type?: string }): Promise<ApiResponse<DataPrincipalRequest[]>> {
    return authenticatedFetch(`/compliance/dpdp/requests${qs(params)}`);
  },

  async createRequest(data: {
    principal_type: string;
    principal_id: string;
    principal_email?: string;
    request_type: string;
    description?: string;
    submitted_via?: string;
  }): Promise<ApiResponse<DataPrincipalRequest>> {
    return authenticatedFetch('/compliance/dpdp/requests', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateRequest(id: string, updates: {
    status?: string;
    assigned_to?: string;
    response_summary?: string;
    rejection_reason?: string;
  }): Promise<ApiResponse<DataPrincipalRequest>> {
    return authenticatedFetch(`/compliance/dpdp/requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async getOverdueRequests(): Promise<ApiResponse<DataPrincipalRequest[]>> {
    return authenticatedFetch('/compliance/dpdp/requests/overdue');
  },

  // Dashboard
  async getDashboard(): Promise<ApiResponse<DpdpDashboard>> {
    return authenticatedFetch('/compliance/dpdp/dashboard');
  },
};
