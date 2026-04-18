import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';
import type { JobPosting, JobApplication, AiScoringResult } from '../../types';

export const recruitmentApi = {
  // ─── Job Postings ──────────────────────────────────────────────────────

  async listJobs(params?: { status?: string; limit?: number }): Promise<ApiResponse<JobPosting[]>> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    const res = await authenticatedFetch<{ data: JobPosting[]; count: number }>(
      `/recruitment/jobs${query ? `?${query}` : ''}`
    );
    return { success: res.success, data: (res as any).data, error: res.error };
  },

  async getJob(id: string): Promise<ApiResponse<JobPosting>> {
    return authenticatedFetch<JobPosting>(`/recruitment/jobs/${id}`);
  },

  async createJob(job: Partial<JobPosting>): Promise<ApiResponse<JobPosting>> {
    return authenticatedFetch<JobPosting>('/recruitment/jobs', {
      method: 'POST',
      body: JSON.stringify(job),
    });
  },

  async updateJob(id: string, updates: Partial<JobPosting>): Promise<ApiResponse<JobPosting>> {
    return authenticatedFetch<JobPosting>(`/recruitment/jobs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async deleteJob(id: string): Promise<ApiResponse<void>> {
    return authenticatedFetch<void>(`/recruitment/jobs/${id}`, { method: 'DELETE' });
  },

  // ─── Applications ──────────────────────────────────────────────────────

  async listApplications(
    jobId: string,
    params?: { status?: string; min_score?: number; limit?: number }
  ): Promise<ApiResponse<JobApplication[]>> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (typeof params?.min_score === 'number') qs.set('min_score', String(params.min_score));
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    const res = await authenticatedFetch<{ data: JobApplication[]; count: number }>(
      `/recruitment/jobs/${jobId}/applications${query ? `?${query}` : ''}`
    );
    return { success: res.success, data: (res as any).data, error: res.error };
  },

  async createApplication(
    jobId: string,
    application: Partial<JobApplication>
  ): Promise<ApiResponse<JobApplication>> {
    return authenticatedFetch<JobApplication>(`/recruitment/jobs/${jobId}/applications`, {
      method: 'POST',
      body: JSON.stringify(application),
    });
  },

  async updateApplicationStatus(
    applicationId: string,
    status: string,
    rejectionReason?: string
  ): Promise<ApiResponse<JobApplication>> {
    return authenticatedFetch<JobApplication>(`/recruitment/applications/${applicationId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, rejection_reason: rejectionReason }),
    });
  },

  // ─── AI Scoring ────────────────────────────────────────────────────────

  async scoreApplication(
    applicationId: string
  ): Promise<ApiResponse<JobApplication & { scoring?: AiScoringResult }>> {
    return authenticatedFetch(`/recruitment/applications/${applicationId}/score`, {
      method: 'POST',
    });
  },

  async scoreAllApplications(
    jobId: string
  ): Promise<ApiResponse<{ scored: number; total: number; errors?: string[] }>> {
    return authenticatedFetch(`/recruitment/jobs/${jobId}/score-all`, {
      method: 'POST',
    });
  },
};
