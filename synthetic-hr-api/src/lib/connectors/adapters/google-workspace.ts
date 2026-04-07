// ---------------------------------------------------------------------------
// Google Workspace Connector Adapter
//
// Full ConnectorAdapter for Google Workspace (Gmail, Calendar, Drive, Admin).
// Reads: list_emails, get_email, list_events, list_files, list_users
// Writes: send_email, create_event, update_event, share_file, create_user, suspend_user
// ---------------------------------------------------------------------------

import type { ActionResult } from '../action-executor';
import {
  ConnectorAdapter,
  HealthResult,
  jsonFetch,
  bearerHeaders,
  registerAdapter,
} from '../adapter';

function resolveAuth(creds: Record<string, string>) {
  const token = creds.token || creds.access_token;
  return { token };
}

const googleAdapter: ConnectorAdapter = {
  connectorId: 'google-workspace',
  displayName: 'Google Workspace',
  requiredCredentials: ['token'],

  validateCredentials(creds) {
    const { token } = resolveAuth(creds);
    const missing: string[] = [];
    if (!token) missing.push('token');
    return { valid: missing.length === 0, missing };
  },

  async testConnection(creds): Promise<HealthResult> {
    const { token } = resolveAuth(creds);
    if (!token) return { healthy: false, error: 'Missing required credential: token' };
    const start = Date.now();
    try {
      const headers = bearerHeaders(token);
      const r = await jsonFetch('https://www.googleapis.com/oauth2/v1/userinfo', { headers });
      const latencyMs = Date.now() - start;
      if (!r.ok) return { healthy: false, latencyMs, error: r.data?.error?.message || `HTTP ${r.status}` };
      return { healthy: true, latencyMs, accountLabel: r.data?.email || 'Google Workspace', details: { email: r.data?.email } };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  },

  async executeRead(action, params, creds): Promise<ActionResult> {
    const { token } = resolveAuth(creds);
    const headers = bearerHeaders(token);

    switch (action) {
      case 'list_emails': {
        const q = params.query || '';
        const max = params.maxResults || 20;
        const r = await jsonFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.messages || [], meta: { resultSizeEstimate: r.data?.resultSizeEstimate } };
      }
      case 'get_email': {
        const id = params.messageId || params.id;
        if (!id) return { success: false, error: 'messageId is required' };
        const r = await jsonFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'list_events': {
        const calId = params.calendarId || 'primary';
        const timeMin = params.timeMin || new Date().toISOString();
        const max = params.maxResults || 20;
        const r = await jsonFetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events?maxResults=${max}&timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime`, { headers });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.items || [] };
      }
      case 'list_files': {
        const q = params.query || '';
        const max = params.maxResults || 20;
        const r = await jsonFetch(`https://www.googleapis.com/drive/v3/files?pageSize=${max}${q ? `&q=${encodeURIComponent(q)}` : ''}&fields=files(id,name,mimeType,modifiedTime,webViewLink,owners,size)`, { headers });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.files || [] };
      }
      case 'list_users': {
        const domain = params.domain;
        if (!domain) return { success: false, error: 'domain is required' };
        const r = await jsonFetch(`https://admin.googleapis.com/admin/directory/v1/users?domain=${encodeURIComponent(domain)}&maxResults=${params.maxResults || 50}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.users || [] };
      }
      default:
        return { success: false, error: `Unknown read action: ${action}` };
    }
  },

  async executeWrite(action, params, creds): Promise<ActionResult> {
    const { token } = resolveAuth(creds);
    const headers = bearerHeaders(token);

    switch (action) {
      case 'send_email': {
        const { to, subject, body } = params;
        if (!to || !subject) return { success: false, error: 'to and subject are required' };
        const raw = Buffer.from(
          `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${body || ''}`,
        ).toString('base64url');
        const r = await jsonFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST', headers, body: JSON.stringify({ raw }),
        });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'create_event': {
        const calId = params.calendarId || 'primary';
        if (!params.summary) return { success: false, error: 'summary is required' };
        const event: any = { summary: params.summary, description: params.description };
        if (params.start) event.start = { dateTime: params.start, timeZone: params.timeZone || 'UTC' };
        if (params.end) event.end = { dateTime: params.end, timeZone: params.timeZone || 'UTC' };
        if (params.attendees) event.attendees = params.attendees.map((e: string) => ({ email: e }));
        const r = await jsonFetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events`, {
          method: 'POST', headers, body: JSON.stringify(event),
        });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'update_event': {
        const calId = params.calendarId || 'primary';
        const eventId = params.eventId || params.id;
        if (!eventId) return { success: false, error: 'eventId is required' };
        const patch: any = {};
        if (params.summary) patch.summary = params.summary;
        if (params.description) patch.description = params.description;
        if (params.start) patch.start = { dateTime: params.start, timeZone: params.timeZone || 'UTC' };
        if (params.end) patch.end = { dateTime: params.end, timeZone: params.timeZone || 'UTC' };
        const r = await jsonFetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}`, {
          method: 'PATCH', headers, body: JSON.stringify(patch),
        });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'share_file': {
        const fileId = params.fileId || params.id;
        const email = params.email;
        if (!fileId || !email) return { success: false, error: 'fileId and email are required' };
        const r = await jsonFetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
          method: 'POST', headers, body: JSON.stringify({ type: 'user', role: params.role || 'reader', emailAddress: email }),
        });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'create_user': {
        if (!params.email || !params.firstName || !params.lastName) return { success: false, error: 'email, firstName, lastName required' };
        const r = await jsonFetch('https://admin.googleapis.com/admin/directory/v1/users', {
          method: 'POST', headers, body: JSON.stringify({
            primaryEmail: params.email,
            name: { givenName: params.firstName, familyName: params.lastName },
            password: params.password || crypto.randomUUID().slice(0, 16),
            changePasswordAtNextLogin: true,
          }),
        });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'suspend_user': {
        const userKey = params.userId || params.email;
        if (!userKey) return { success: false, error: 'userId or email is required' };
        const r = await jsonFetch(`https://admin.googleapis.com/admin/directory/v1/users/${encodeURIComponent(userKey)}`, {
          method: 'PATCH', headers, body: JSON.stringify({ suspended: true }),
        });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      default:
        return { success: false, error: `Unknown write action: ${action}` };
    }
  },
};

registerAdapter(googleAdapter);
