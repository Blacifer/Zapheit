// ---------------------------------------------------------------------------
// Naukri RMS Connector Adapter
//
// Reads:  list_jobs, get_job, list_applications, get_application,
//         list_candidates, get_candidate, search_candidates
// Writes: create_job, update_job, pause_job, close_job,
//         update_application_status, add_application_note
//
// Credentials: api_key, client_id
// Base URL:    https://api.naukri.com/v1
// Auth:        X-Api-Key + X-Client-Id headers
// ---------------------------------------------------------------------------

import type { ActionResult } from '../action-executor';
import {
  type ConnectorAdapter,
  type HealthResult,
  jsonFetch,
  registerAdapter,
} from '../adapter';
import { decryptSecret } from '../../integrations/encryption';

const BASE_URL = 'https://api.naukri.com/v1';

function resolveAuth(creds: Record<string, string>) {
  const apiKey = decryptSecret(creds.api_key || '');
  const clientId = decryptSecret(creds.client_id || '');
  return { apiKey, clientId };
}

function naukHeaders(apiKey: string, clientId: string): Record<string, string> {
  return {
    'X-Api-Key': apiKey,
    'X-Client-Id': clientId,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// Application status labels Naukri uses in their RMS
const APPLICATION_STATUS_MAP: Record<string, string> = {
  new: 'New',
  shortlisted: 'Shortlisted',
  interview: 'Interview Scheduled',
  offered: 'Offer Extended',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  hold: 'On Hold',
};

function normalizeJob(j: any) {
  return {
    id: j.jobId || j.id,
    title: j.title || j.jobTitle,
    department: j.department,
    location: j.location || j.jobLocation,
    type: j.jobType || j.type || 'full_time',
    status: j.status || 'active',
    posted_at: j.postedDate || j.createdAt || j.created_at,
    expiry_date: j.expiryDate || j.expires_at,
    applicant_count: j.applicantCount || j.totalApplicants || 0,
    shortlisted_count: j.shortlistedCount || 0,
    description: j.description || j.jobDescription,
    required_experience: j.requiredExperience,
    skills: j.keySkills || j.skills || [],
    salary_range: j.salary || j.salaryRange,
  };
}

function normalizeCandidate(c: any) {
  return {
    id: c.candidateId || c.id,
    name: c.name || c.candidateName,
    email: c.email,
    phone: c.phone || c.mobile,
    experience_years: c.totalExperience || c.experience,
    current_role: c.currentDesignation || c.currentRole,
    current_company: c.currentCompany,
    location: c.location || c.currentLocation,
    skills: c.keySkills || c.skills || [],
    resume_url: c.resumeUrl || c.resume,
    source: 'naukri',
    applied_at: c.appliedDate || c.applied_at || c.createdAt,
  };
}

function normalizeApplication(a: any) {
  return {
    id: a.applicationId || a.id,
    job_id: a.jobId,
    candidate_id: a.candidateId,
    candidate_name: a.candidateName || a.name,
    status: a.status,
    applied_at: a.appliedDate || a.applied_at,
    last_updated: a.updatedDate || a.updated_at,
    notes: a.notes || [],
    resume_url: a.resumeUrl,
    ai_score: a.aiScore || a.matchScore || null,
    ai_summary: a.aiSummary || a.matchSummary || null,
  };
}

const naukriAdapter: ConnectorAdapter = {
  connectorId: 'naukri',
  displayName: 'Naukri RMS',
  requiredCredentials: ['api_key', 'client_id'],

  validateCredentials(creds) {
    const { apiKey, clientId } = resolveAuth(creds);
    const missing: string[] = [];
    if (!apiKey) missing.push('api_key');
    if (!clientId) missing.push('client_id');
    return { valid: missing.length === 0, missing };
  },

  async testConnection(creds): Promise<HealthResult> {
    const { apiKey, clientId } = resolveAuth(creds);
    if (!apiKey || !clientId) {
      return { healthy: false, error: 'Missing api_key or client_id' };
    }
    const start = Date.now();
    try {
      const r = await jsonFetch(`${BASE_URL}/jobs?limit=1`, {
        headers: naukHeaders(apiKey, clientId),
      });
      const latencyMs = Date.now() - start;
      if (r.status === 401 || r.status === 403) {
        return { healthy: false, latencyMs, error: 'Invalid API key or client ID' };
      }
      if (!r.ok) return { healthy: false, latencyMs, error: `HTTP ${r.status}` };
      return { healthy: true, latencyMs, accountLabel: 'Naukri RMS', details: { clientId } };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  },

  async executeRead(action, params, creds): Promise<ActionResult> {
    const { apiKey, clientId } = resolveAuth(creds);
    const headers = naukHeaders(apiKey, clientId);

    switch (action) {
      case 'list_jobs': {
        const limit = Math.min(Number(params.limit) || 50, 200);
        const page = Number(params.page) || 1;
        const status = params.status || 'active';
        const r = await jsonFetch(
          `${BASE_URL}/jobs?limit=${limit}&page=${page}&status=${encodeURIComponent(status)}`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        const jobs = (r.data?.jobs || r.data?.data || r.data || []);
        return { success: true, data: Array.isArray(jobs) ? jobs.map(normalizeJob) : [] };
      }

      case 'get_job': {
        const jobId = params.job_id || params.jobId || params.id;
        if (!jobId) return { success: false, error: 'job_id is required' };
        const r = await jsonFetch(`${BASE_URL}/jobs/${jobId}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: normalizeJob(r.data?.job || r.data) };
      }

      case 'list_applications': {
        const limit = Math.min(Number(params.limit) || 50, 200);
        const page = Number(params.page) || 1;
        let url = `${BASE_URL}/applications?limit=${limit}&page=${page}`;
        if (params.job_id) url += `&jobId=${encodeURIComponent(params.job_id)}`;
        if (params.status) url += `&status=${encodeURIComponent(params.status)}`;
        const r = await jsonFetch(url, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        const apps = r.data?.applications || r.data?.data || r.data || [];
        return { success: true, data: Array.isArray(apps) ? apps.map(normalizeApplication) : [] };
      }

      case 'get_application': {
        const appId = params.application_id || params.id;
        if (!appId) return { success: false, error: 'application_id is required' };
        const r = await jsonFetch(`${BASE_URL}/applications/${appId}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: normalizeApplication(r.data?.application || r.data) };
      }

      case 'list_candidates': {
        const limit = Math.min(Number(params.limit) || 50, 200);
        const page = Number(params.page) || 1;
        let url = `${BASE_URL}/candidates?limit=${limit}&page=${page}`;
        if (params.job_id) url += `&jobId=${encodeURIComponent(params.job_id)}`;
        const r = await jsonFetch(url, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        const candidates = r.data?.candidates || r.data?.data || r.data || [];
        return { success: true, data: Array.isArray(candidates) ? candidates.map(normalizeCandidate) : [] };
      }

      case 'get_candidate': {
        const candidateId = params.candidate_id || params.id;
        if (!candidateId) return { success: false, error: 'candidate_id is required' };
        const r = await jsonFetch(`${BASE_URL}/candidates/${candidateId}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: normalizeCandidate(r.data?.candidate || r.data) };
      }

      case 'search_candidates': {
        const query = params.query || params.q || params.keywords;
        if (!query) return { success: false, error: 'query is required' };
        const limit = Math.min(Number(params.limit) || 20, 100);
        const qs = new URLSearchParams({ q: query, limit: String(limit) });
        if (params.location) qs.set('location', params.location);
        if (params.min_experience) qs.set('minExperience', String(params.min_experience));
        if (params.max_experience) qs.set('maxExperience', String(params.max_experience));
        if (params.skills) qs.set('skills', Array.isArray(params.skills) ? params.skills.join(',') : params.skills);
        const r = await jsonFetch(`${BASE_URL}/candidates/search?${qs}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        const candidates = r.data?.candidates || r.data?.results || r.data || [];
        return {
          success: true,
          data: {
            results: Array.isArray(candidates) ? candidates.map(normalizeCandidate) : [],
            total: r.data?.total || candidates.length,
          },
        };
      }

      default:
        return { success: false, error: `Unknown read action: ${action}` };
    }
  },

  async executeWrite(action, params, creds): Promise<ActionResult> {
    const { apiKey, clientId } = resolveAuth(creds);
    const headers = naukHeaders(apiKey, clientId);

    switch (action) {
      case 'create_job': {
        const { title, description, location, department, job_type, required_experience, skills, salary_range } = params;
        if (!title || !description || !location) {
          return { success: false, error: 'title, description, and location are required' };
        }
        const body: Record<string, any> = {
          title,
          jobDescription: description,
          jobLocation: location,
          department: department || '',
          jobType: job_type || 'full_time',
          requiredExperience: required_experience || '',
          keySkills: Array.isArray(skills) ? skills : (skills ? [skills] : []),
          salary: salary_range || '',
        };
        const r = await jsonFetch(`${BASE_URL}/jobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: normalizeJob(r.data?.job || r.data) };
      }

      case 'update_job': {
        const jobId = params.job_id || params.id;
        if (!jobId) return { success: false, error: 'job_id is required' };
        const body: Record<string, any> = {};
        if (params.title) body.title = params.title;
        if (params.description) body.jobDescription = params.description;
        if (params.location) body.jobLocation = params.location;
        if (params.department) body.department = params.department;
        if (params.salary_range) body.salary = params.salary_range;
        if (params.skills) body.keySkills = Array.isArray(params.skills) ? params.skills : [params.skills];
        const r = await jsonFetch(`${BASE_URL}/jobs/${jobId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(body),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: normalizeJob(r.data?.job || r.data) };
      }

      case 'pause_job': {
        const jobId = params.job_id || params.id;
        if (!jobId) return { success: false, error: 'job_id is required' };
        const r = await jsonFetch(`${BASE_URL}/jobs/${jobId}/pause`, {
          method: 'POST',
          headers,
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: { job_id: jobId, status: 'paused' } };
      }

      case 'close_job': {
        const jobId = params.job_id || params.id;
        const reason = params.reason || 'Position filled';
        if (!jobId) return { success: false, error: 'job_id is required' };
        const r = await jsonFetch(`${BASE_URL}/jobs/${jobId}/close`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ reason }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: { job_id: jobId, status: 'closed', reason } };
      }

      case 'update_application_status': {
        const appId = params.application_id || params.id;
        const status = params.status;
        if (!appId || !status) return { success: false, error: 'application_id and status are required' };
        const naukStatus = APPLICATION_STATUS_MAP[status] || status;
        const r = await jsonFetch(`${BASE_URL}/applications/${appId}/status`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ status: naukStatus, remarks: params.remarks || '' }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: { application_id: appId, status } };
      }

      case 'add_application_note': {
        const appId = params.application_id || params.id;
        const note = params.note || params.text;
        if (!appId || !note) return { success: false, error: 'application_id and note are required' };
        const r = await jsonFetch(`${BASE_URL}/applications/${appId}/notes`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ note, type: params.type || 'general' }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      default:
        return { success: false, error: `Unknown write action: ${action}` };
    }
  },
};

registerAdapter(naukriAdapter);
