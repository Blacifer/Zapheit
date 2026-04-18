import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';
import type {
  SupportTicketHub,
  SalesLeadHub,
  AccessRequestHub,
  HubInvoice,
  HubExpense,
  HubDeadline,
  HubEvidence,
  HubIdentityEvent,
  HubAccessGraph,
} from '../../types';

// ─── Helper to build query string ────────────────────────────────────────────

function qs(params?: Record<string, string | number | undefined>): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function unwrapList<T>(res: any): ApiResponse<T[]> {
  return { success: res.success, data: res.data, error: res.error };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPORT HUB
// ═══════════════════════════════════════════════════════════════════════════════

export const supportHubApi = {
  async listTickets(params?: { status?: string; limit?: number }): Promise<ApiResponse<SupportTicketHub[]>> {
    const res = await authenticatedFetch<any>(`/hubs/support/tickets${qs(params)}`);
    return unwrapList(res);
  },

  async createTicket(data: Partial<SupportTicketHub>): Promise<ApiResponse<SupportTicketHub>> {
    return authenticatedFetch(`/hubs/support/tickets`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updateTicket(id: string, data: Record<string, any>): Promise<ApiResponse<SupportTicketHub>> {
    return authenticatedFetch(`/hubs/support/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async triageTicket(id: string): Promise<ApiResponse<SupportTicketHub>> {
    return authenticatedFetch(`/hubs/support/tickets/${id}/triage`, { method: 'POST' });
  },

  async triageAll(): Promise<ApiResponse<{ triaged: number; total: number }>> {
    return authenticatedFetch(`/hubs/support/triage-all`, { method: 'POST' });
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SALES HUB
// ═══════════════════════════════════════════════════════════════════════════════

export const salesHubApi = {
  async listLeads(params?: { status?: string; stage?: string; limit?: number }): Promise<ApiResponse<SalesLeadHub[]>> {
    const res = await authenticatedFetch<any>(`/hubs/sales/leads${qs(params)}`);
    return unwrapList(res);
  },

  async createLead(data: Partial<SalesLeadHub>): Promise<ApiResponse<SalesLeadHub>> {
    return authenticatedFetch(`/hubs/sales/leads`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updateLead(id: string, data: Record<string, any>): Promise<ApiResponse<SalesLeadHub>> {
    return authenticatedFetch(`/hubs/sales/leads/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async scoreLead(id: string): Promise<ApiResponse<SalesLeadHub>> {
    return authenticatedFetch(`/hubs/sales/leads/${id}/score`, { method: 'POST' });
  },

  async scoreAll(): Promise<ApiResponse<{ scored: number; total: number }>> {
    return authenticatedFetch(`/hubs/sales/score-all`, { method: 'POST' });
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// IT HUB
// ═══════════════════════════════════════════════════════════════════════════════

export const itHubApi = {
  async listRequests(params?: { status?: string; limit?: number }): Promise<ApiResponse<AccessRequestHub[]>> {
    const res = await authenticatedFetch<any>(`/hubs/it/access-requests${qs(params)}`);
    return unwrapList(res);
  },

  async createRequest(data: Partial<AccessRequestHub>): Promise<ApiResponse<AccessRequestHub>> {
    return authenticatedFetch(`/hubs/it/access-requests`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updateRequest(id: string, data: Record<string, any>): Promise<ApiResponse<AccessRequestHub>> {
    return authenticatedFetch(`/hubs/it/access-requests/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async evaluateRequest(id: string): Promise<ApiResponse<AccessRequestHub>> {
    return authenticatedFetch(`/hubs/it/access-requests/${id}/evaluate`, { method: 'POST' });
  },

  async evaluateAll(): Promise<ApiResponse<{ evaluated: number; total: number }>> {
    return authenticatedFetch(`/hubs/it/evaluate-all`, { method: 'POST' });
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCE HUB
// ═══════════════════════════════════════════════════════════════════════════════

export const financeHubApi = {
  async listInvoices(params?: { status?: string; matched_status?: string; limit?: number }): Promise<ApiResponse<HubInvoice[]>> {
    const res = await authenticatedFetch<any>(`/hubs/finance/invoices${qs(params)}`);
    return unwrapList(res);
  },

  async createInvoice(data: Partial<HubInvoice>): Promise<ApiResponse<HubInvoice>> {
    return authenticatedFetch(`/hubs/finance/invoices`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updateInvoice(id: string, data: Record<string, any>): Promise<ApiResponse<HubInvoice>> {
    return authenticatedFetch(`/hubs/finance/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async validateInvoice(id: string): Promise<ApiResponse<HubInvoice>> {
    return authenticatedFetch(`/hubs/finance/invoices/${id}/validate`, { method: 'POST' });
  },

  async listExpenses(params?: { status?: string; category?: string; limit?: number }): Promise<ApiResponse<HubExpense[]>> {
    const res = await authenticatedFetch<any>(`/hubs/finance/expenses${qs(params)}`);
    return unwrapList(res);
  },

  async createExpense(data: Partial<HubExpense>): Promise<ApiResponse<HubExpense>> {
    return authenticatedFetch(`/hubs/finance/expenses`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updateExpense(id: string, data: Record<string, any>): Promise<ApiResponse<HubExpense>> {
    return authenticatedFetch(`/hubs/finance/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async validateExpense(id: string): Promise<ApiResponse<HubExpense>> {
    return authenticatedFetch(`/hubs/finance/expenses/${id}/validate`, { method: 'POST' });
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLIANCE HUB
// ═══════════════════════════════════════════════════════════════════════════════

export const complianceHubApi = {
  async listDeadlines(params?: { status?: string; regulation?: string; limit?: number }): Promise<ApiResponse<HubDeadline[]>> {
    const res = await authenticatedFetch<any>(`/hubs/compliance-hub/deadlines${qs(params)}`);
    return unwrapList(res);
  },

  async createDeadline(data: Partial<HubDeadline>): Promise<ApiResponse<HubDeadline>> {
    return authenticatedFetch(`/hubs/compliance-hub/deadlines`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updateDeadline(id: string, data: Record<string, any>): Promise<ApiResponse<HubDeadline>> {
    return authenticatedFetch(`/hubs/compliance-hub/deadlines/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async generateChecklist(id: string): Promise<ApiResponse<HubDeadline>> {
    return authenticatedFetch(`/hubs/compliance-hub/deadlines/${id}/generate-checklist`, { method: 'POST' });
  },

  async getPosture(): Promise<ApiResponse<{ score: number; total: number; completed: number; overdue: number; upcoming: number }>> {
    return authenticatedFetch(`/hubs/compliance-hub/posture`);
  },

  async listEvidence(params?: { status?: string; deadline_id?: string; limit?: number }): Promise<ApiResponse<HubEvidence[]>> {
    const res = await authenticatedFetch<any>(`/hubs/compliance-hub/evidence${qs(params)}`);
    return unwrapList(res);
  },

  async createEvidence(data: Partial<HubEvidence>): Promise<ApiResponse<HubEvidence>> {
    return authenticatedFetch(`/hubs/compliance-hub/evidence`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updateEvidence(id: string, data: Record<string, any>): Promise<ApiResponse<HubEvidence>> {
    return authenticatedFetch(`/hubs/compliance-hub/evidence/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// IDENTITY HUB
// ═══════════════════════════════════════════════════════════════════════════════

export const identityHubApi = {
  // Events
  async listEvents(params?: { event_type?: string; severity?: string; actor_email?: string; limit?: number }): Promise<ApiResponse<HubIdentityEvent[]>> {
    const res = await authenticatedFetch<any>(`/hubs/identity/events${qs(params)}`);
    return unwrapList(res);
  },

  async createEvent(data: Partial<HubIdentityEvent>): Promise<ApiResponse<HubIdentityEvent>> {
    return authenticatedFetch(`/hubs/identity/events`, { method: 'POST', body: JSON.stringify(data) });
  },

  async scoreAnomaly(id: string): Promise<ApiResponse<HubIdentityEvent>> {
    return authenticatedFetch(`/hubs/identity/events/${id}/score-anomaly`, { method: 'POST' });
  },

  async scoreAllAnomalies(): Promise<ApiResponse<{ scored: number; total: number }>> {
    return authenticatedFetch(`/hubs/identity/score-all`, { method: 'POST' });
  },

  // Access Graph
  async listAccessGraph(params?: { user_email?: string; system_name?: string; status?: string; limit?: number }): Promise<ApiResponse<HubAccessGraph[]>> {
    const res = await authenticatedFetch<any>(`/hubs/identity/access-graph${qs(params)}`);
    return unwrapList(res);
  },

  async createAccessEntry(data: Partial<HubAccessGraph>): Promise<ApiResponse<HubAccessGraph>> {
    return authenticatedFetch(`/hubs/identity/access-graph`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updateAccessEntry(id: string, data: Record<string, any>): Promise<ApiResponse<HubAccessGraph>> {
    return authenticatedFetch(`/hubs/identity/access-graph/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async blastRadius(userEmail: string): Promise<ApiResponse<{ user_email: string; systems: HubAccessGraph[]; total_systems: number; risk_summary: { high: number; medium: number; low: number } }>> {
    return authenticatedFetch(`/hubs/identity/blast-radius?user_email=${encodeURIComponent(userEmail)}`);
  },

  async revokeAll(userEmail: string): Promise<ApiResponse<{ revoked: number }>> {
    return authenticatedFetch(`/hubs/identity/revoke-all`, { method: 'POST', body: JSON.stringify({ user_email: userEmail }) });
  },
};
