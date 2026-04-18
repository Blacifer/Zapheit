import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilingDeadline {
  id: string;
  organization_id: string;
  filing_type: string;
  title: string;
  description?: string;
  regulation?: string;
  authority?: string;
  due_day_of_month?: number;
  frequency: 'monthly' | 'quarterly' | 'annually' | 'one_time';
  quarter_months?: number[];
  annual_month?: number;
  is_active: boolean;
  api_provider?: string;
  form_name?: string;
  penalty_info?: string;
  created_at: string;
  updated_at: string;
}

export interface FilingSubmission {
  id: string;
  organization_id: string;
  deadline_id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  due_date: string;
  status: 'pending' | 'in_progress' | 'submitted' | 'accepted' | 'rejected' | 'overdue' | 'waived';
  submitted_at?: string;
  submitted_by?: string;
  reference_number?: string;
  amount?: number;
  receipt_url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  // Joined from filing_deadlines
  filing_deadlines?: {
    filing_type: string;
    title: string;
    authority?: string;
    form_name?: string;
  };
}

export interface FilingAlert {
  id: string;
  organization_id: string;
  submission_id?: string;
  deadline_id?: string;
  alert_type: 'reminder' | 'due_today' | 'overdue' | 'escalation' | 'submission_confirmed' | 'rejection';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message?: string;
  is_read: boolean;
  is_dismissed: boolean;
  created_at: string;
}

export interface FilingDashboard {
  compliance_score: number;
  active_deadlines: number;
  total_submissions: number;
  pending: number;
  overdue: number;
  submitted: number;
  unread_alerts: number;
  total_amount_filed: number;
}

export interface StatutoryFiling {
  filing_type: string;
  title: string;
  due_day: number;
  frequency: string;
  regulation: string;
  authority: string;
  form_name: string;
  api_provider: string;
  penalty_info: string;
  quarter_months?: readonly number[];
  annual_month?: number;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const filingsApi = {
  // Statutory calendar (static reference data)
  async getStatutoryCalendar(): Promise<ApiResponse<StatutoryFiling[]>> {
    return authenticatedFetch('/compliance/filings/statutory-calendar');
  },

  // Seed org deadlines from statutory calendar
  async seedDeadlines(): Promise<ApiResponse<{ seeded: number }>> {
    return authenticatedFetch('/compliance/filings/seed', { method: 'POST' });
  },

  // Deadlines
  async listDeadlines(): Promise<ApiResponse<FilingDeadline[]>> {
    return authenticatedFetch('/compliance/filings/deadlines');
  },

  async createDeadline(data: Partial<FilingDeadline>): Promise<ApiResponse<FilingDeadline>> {
    return authenticatedFetch('/compliance/filings/deadlines', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateDeadline(id: string, data: Partial<FilingDeadline>): Promise<ApiResponse<FilingDeadline>> {
    return authenticatedFetch(`/compliance/filings/deadlines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Submissions
  async listSubmissions(params?: { status?: string; deadline_id?: string; limit?: number }): Promise<ApiResponse<FilingSubmission[]>> {
    const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined);
    const qs = entries.length ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : '';
    return authenticatedFetch(`/compliance/filings/submissions${qs}`);
  },

  async createSubmission(data: {
    deadline_id: string;
    period_label: string;
    period_start: string;
    period_end: string;
    due_date: string;
    status?: string;
    amount?: number;
    notes?: string;
  }): Promise<ApiResponse<FilingSubmission>> {
    return authenticatedFetch('/compliance/filings/submissions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateSubmission(id: string, data: Partial<FilingSubmission>): Promise<ApiResponse<FilingSubmission>> {
    return authenticatedFetch(`/compliance/filings/submissions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Alerts
  async listAlerts(unread?: boolean): Promise<ApiResponse<FilingAlert[]>> {
    const qs = unread ? '?unread=true' : '';
    return authenticatedFetch(`/compliance/filings/alerts${qs}`);
  },

  async markAlertRead(id: string): Promise<ApiResponse<void>> {
    return authenticatedFetch(`/compliance/filings/alerts/${id}/read`, { method: 'PATCH' });
  },

  async markAllAlertsRead(): Promise<ApiResponse<void>> {
    return authenticatedFetch('/compliance/filings/alerts/read-all', { method: 'POST' });
  },

  // Dashboard
  async getDashboard(): Promise<ApiResponse<FilingDashboard>> {
    return authenticatedFetch('/compliance/filings/dashboard');
  },

  // Auto-generate current period submissions
  async generateSubmissions(): Promise<ApiResponse<{ generated: number }>> {
    return authenticatedFetch('/compliance/filings/generate-submissions', { method: 'POST' });
  },
};
