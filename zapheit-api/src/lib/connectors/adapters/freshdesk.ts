// ---------------------------------------------------------------------------
// Freshdesk Connector Adapter
//
// Reads:  list_tickets, get_ticket, list_contacts, get_contact,
//         list_agents, get_ticket_replies, search_tickets
// Writes: create_ticket, update_ticket, send_reply, add_note,
//         assign_ticket, set_ticket_status, create_contact
//
// Credentials: api_key, domain (e.g. "yourco.freshdesk.com")
// Base URL:    https://{domain}/api/v2
// Auth:        Basic auth — api_key as username, "X" as password
// ---------------------------------------------------------------------------

import type { ActionResult } from '../action-executor';
import {
  type ConnectorAdapter,
  type HealthResult,
  jsonFetch,
  basicAuthHeaders,
  registerAdapter,
} from '../adapter';
import { decryptSecret } from '../../integrations/encryption';

function resolveAuth(creds: Record<string, string>) {
  const apiKey = decryptSecret(creds.api_key || '');
  const domain = (creds.domain || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const baseUrl = `https://${domain}/api/v2`;
  return { apiKey, domain, baseUrl };
}

function fdHeaders(apiKey: string): Record<string, string> {
  return basicAuthHeaders(apiKey, 'X');
}

// Priority mapping: 1=Low, 2=Medium, 3=High, 4=Urgent
const PRIORITY_MAP: Record<number, string> = { 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' };
const PRIORITY_REVERSE: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 4 };

// Status mapping: 2=Open, 3=Pending, 4=Resolved, 5=Closed
const STATUS_MAP: Record<number, string> = { 2: 'open', 3: 'pending', 4: 'resolved', 5: 'closed' };
const STATUS_REVERSE: Record<string, number> = { open: 2, pending: 3, resolved: 4, closed: 5 };

function normalizeTicket(t: any) {
  return {
    id: t.id,
    subject: t.subject,
    status: STATUS_MAP[t.status] || String(t.status),
    priority: PRIORITY_MAP[t.priority] || String(t.priority),
    requester_id: t.requester_id,
    responder_id: t.responder_id,
    group_id: t.group_id,
    type: t.type,
    tags: t.tags || [],
    due_by: t.due_by,
    fr_due_by: t.fr_due_by,
    sla_policy_name: t.sla_policy_name,
    created_at: t.created_at,
    updated_at: t.updated_at,
    description: t.description_text || t.description,
  };
}

const freshdeskAdapter: ConnectorAdapter = {
  connectorId: 'freshdesk',
  displayName: 'Freshdesk',
  requiredCredentials: ['api_key', 'domain'],

  validateCredentials(creds) {
    const { apiKey, domain } = resolveAuth(creds);
    const missing: string[] = [];
    if (!apiKey) missing.push('api_key');
    if (!domain) missing.push('domain');
    return { valid: missing.length === 0, missing };
  },

  async testConnection(creds): Promise<HealthResult> {
    const { apiKey, domain, baseUrl } = resolveAuth(creds);
    if (!apiKey || !domain) {
      return { healthy: false, error: 'Missing api_key or domain' };
    }
    const start = Date.now();
    try {
      const r = await jsonFetch(`${baseUrl}/tickets?per_page=1`, {
        headers: fdHeaders(apiKey),
      });
      const latencyMs = Date.now() - start;
      if (r.status === 401) return { healthy: false, latencyMs, error: 'Invalid API key' };
      if (r.status === 404) return { healthy: false, latencyMs, error: `Domain not found: ${domain}` };
      if (!r.ok) return { healthy: false, latencyMs, error: `HTTP ${r.status}` };
      return { healthy: true, latencyMs, accountLabel: domain, details: { domain } };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  },

  async executeRead(action, params, creds): Promise<ActionResult> {
    const { apiKey, baseUrl } = resolveAuth(creds);
    const headers = fdHeaders(apiKey);

    switch (action) {
      case 'list_tickets': {
        const perPage = Math.min(Number(params.per_page) || 30, 100);
        const page = Number(params.page) || 1;
        const orderBy = params.order_by || 'created_at';
        const orderType = params.order_type || 'desc';
        const filter = params.filter || ''; // e.g. "open", "pending"
        let url = `${baseUrl}/tickets?per_page=${perPage}&page=${page}&order_by=${orderBy}&order_type=${orderType}`;
        if (filter) url += `&filter=${encodeURIComponent(filter)}`;
        if (params.priority) url += `&priority=${PRIORITY_REVERSE[params.priority] || params.priority}`;
        if (params.status) url += `&status=${STATUS_REVERSE[params.status] || params.status}`;
        const r = await jsonFetch(url, { headers });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: (r.data || []).map(normalizeTicket) };
      }

      case 'get_ticket': {
        const id = params.ticket_id || params.id;
        if (!id) return { success: false, error: 'ticket_id is required' };
        const r = await jsonFetch(`${baseUrl}/tickets/${id}?include=conversations`, { headers });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: normalizeTicket(r.data) };
      }

      case 'get_ticket_replies': {
        const id = params.ticket_id || params.id;
        if (!id) return { success: false, error: 'ticket_id is required' };
        const r = await jsonFetch(`${baseUrl}/tickets/${id}/conversations`, { headers });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: r.data || [] };
      }

      case 'search_tickets': {
        const query = params.query || params.q;
        if (!query) return { success: false, error: 'query is required' };
        const r = await jsonFetch(`${baseUrl}/search/tickets?query=${encodeURIComponent(`"${query}"`)}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: { results: (r.data?.results || []).map(normalizeTicket), total: r.data?.total || 0 } };
      }

      case 'list_contacts': {
        const perPage = Math.min(Number(params.per_page) || 30, 100);
        const page = Number(params.page) || 1;
        const r = await jsonFetch(`${baseUrl}/contacts?per_page=${perPage}&page=${page}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: r.data || [] };
      }

      case 'get_contact': {
        const id = params.contact_id || params.id;
        if (!id) return { success: false, error: 'contact_id is required' };
        const r = await jsonFetch(`${baseUrl}/contacts/${id}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'list_agents': {
        const r = await jsonFetch(`${baseUrl}/agents`, { headers });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: r.data || [] };
      }

      default:
        return { success: false, error: `Unknown read action: ${action}` };
    }
  },

  async executeWrite(action, params, creds): Promise<ActionResult> {
    const { apiKey, baseUrl } = resolveAuth(creds);
    const headers = fdHeaders(apiKey);

    switch (action) {
      case 'create_ticket': {
        const { subject, description, email, priority, status, type } = params;
        if (!subject || !description || !email) {
          return { success: false, error: 'subject, description, and email are required' };
        }
        const body: Record<string, any> = {
          subject,
          description,
          email,
          priority: PRIORITY_REVERSE[priority] || 2,
          status: STATUS_REVERSE[status] || 2,
        };
        if (type) body.type = type;
        if (params.tags) body.tags = params.tags;
        if (params.group_id) body.group_id = params.group_id;
        const r = await jsonFetch(`${baseUrl}/tickets`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: normalizeTicket(r.data) };
      }

      case 'update_ticket': {
        const id = params.ticket_id || params.id;
        if (!id) return { success: false, error: 'ticket_id is required' };
        const body: Record<string, any> = {};
        if (params.status) body.status = STATUS_REVERSE[params.status] || params.status;
        if (params.priority) body.priority = PRIORITY_REVERSE[params.priority] || params.priority;
        if (params.subject) body.subject = params.subject;
        if (params.group_id) body.group_id = params.group_id;
        if (params.responder_id) body.responder_id = params.responder_id;
        if (params.tags) body.tags = params.tags;
        const r = await jsonFetch(`${baseUrl}/tickets/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(body),
        });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: normalizeTicket(r.data) };
      }

      case 'send_reply': {
        const id = params.ticket_id || params.id;
        const body_text = params.body || params.reply || params.text;
        if (!id || !body_text) {
          return { success: false, error: 'ticket_id and body are required' };
        }
        const payload: Record<string, any> = { body: body_text };
        if (params.from_email) payload.from_email = params.from_email;
        if (params.cc_emails) payload.cc_emails = params.cc_emails;
        const r = await jsonFetch(`${baseUrl}/tickets/${id}/reply`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'add_note': {
        const id = params.ticket_id || params.id;
        const body_text = params.body || params.note || params.text;
        if (!id || !body_text) {
          return { success: false, error: 'ticket_id and body are required' };
        }
        const r = await jsonFetch(`${baseUrl}/tickets/${id}/notes`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ body: body_text, private: params.private !== false }),
        });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'assign_ticket': {
        const id = params.ticket_id || params.id;
        const agentId = params.agent_id || params.responder_id;
        if (!id || !agentId) return { success: false, error: 'ticket_id and agent_id are required' };
        const r = await jsonFetch(`${baseUrl}/tickets/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ responder_id: agentId }),
        });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: normalizeTicket(r.data) };
      }

      case 'set_ticket_status': {
        const id = params.ticket_id || params.id;
        const status = params.status;
        if (!id || !status) return { success: false, error: 'ticket_id and status are required' };
        const statusCode = STATUS_REVERSE[status];
        if (!statusCode) return { success: false, error: `Invalid status: ${status}. Use open, pending, resolved, or closed.` };
        const r = await jsonFetch(`${baseUrl}/tickets/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ status: statusCode }),
        });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: normalizeTicket(r.data) };
      }

      case 'create_contact': {
        const { name, email, phone, company_name } = params;
        if (!name || !email) return { success: false, error: 'name and email are required' };
        const body: Record<string, any> = { name, email };
        if (phone) body.phone = phone;
        if (company_name) body.company_name = company_name;
        const r = await jsonFetch(`${baseUrl}/contacts`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!r.ok) return { success: false, error: r.data?.description || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      default:
        return { success: false, error: `Unknown write action: ${action}` };
    }
  },
};

registerAdapter(freshdeskAdapter);
