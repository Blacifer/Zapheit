// ---------------------------------------------------------------------------
// Google Workspace Connector Adapter
//
// Full ConnectorAdapter for Google Workspace (Gmail, Calendar, Drive, Admin).
// Reads: list_emails, get_email, list_events, list_files, list_users
// Writes: send_email, reply_email, forward_email, archive_email,
//         mark_email_read, mark_email_unread,
//         create_event, update_event, cancel_event, share_file,
//         create_user, suspend_user
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

// Extract all headers from a Gmail payload into a flat { name → value } map.
function extractHeaders(payload: any): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of payload?.headers ?? []) {
    result[h.name.toLowerCase()] = h.value;
  }
  return result;
}

// Recursively walk a Gmail MIME part tree to find the best body text.
// Prefers text/html over text/plain.
function extractBody(payload: any): { body: string; isHtml: boolean } {
  const mime: string = payload?.mimeType ?? '';

  if (mime === 'text/html' && payload?.body?.data) {
    return { body: Buffer.from(payload.body.data, 'base64').toString('utf-8'), isHtml: true };
  }
  if (mime === 'text/plain' && payload?.body?.data) {
    return { body: Buffer.from(payload.body.data, 'base64').toString('utf-8'), isHtml: false };
  }

  // Walk parts: collect html and plain candidates, prefer html
  const parts: any[] = payload?.parts ?? [];
  let plain: { body: string; isHtml: boolean } | null = null;
  for (const part of parts) {
    const result = extractBody(part);
    if (result.body) {
      if (result.isHtml) return result;
      if (!plain) plain = result;
    }
  }
  return plain ?? { body: '', isHtml: false };
}

// Check recursively if any MIME part is an attachment (has a filename).
function hasAttachmentParts(payload: any): boolean {
  if (payload?.filename && payload.filename.length > 0) return true;
  return (payload?.parts ?? []).some(hasAttachmentParts);
}

// Fetch metadata (subject, from, to, date, labels, snippet) for a single
// message ID using the lightweight format=metadata endpoint.
async function fetchMessageMeta(id: string, threadId: string, headers: Record<string, string>) {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}` +
    `?format=metadata&metadataHeaders=Subject&metadataHeaders=From` +
    `&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Date`;
  const r = await jsonFetch(url, { headers });
  if (!r.ok) return { id, threadId, snippet: '', subject: '', from: '', to: '', date: '', labelIds: [], isUnread: false, hasAttachment: false };
  const h = extractHeaders(r.data?.payload);
  return {
    id,
    threadId,
    snippet: r.data?.snippet ?? '',
    subject: h['subject'] ?? '(no subject)',
    from: h['from'] ?? '',
    to: h['to'] ?? '',
    date: h['date'] ?? '',
    labelIds: r.data?.labelIds ?? [],
    isUnread: (r.data?.labelIds ?? []).includes('UNREAD'),
    hasAttachment: hasAttachmentParts(r.data?.payload),
  };
}

// Build a raw RFC 2822 email string for the Gmail send API.
function buildRaw(fields: {
  to: string; from?: string; subject: string; body: string;
  inReplyTo?: string; references?: string; threadId?: string;
}): string {
  const lines = [
    `To: ${fields.to}`,
    fields.from ? `From: ${fields.from}` : null,
    `Subject: ${fields.subject}`,
    `Content-Type: text/html; charset=utf-8`,
    fields.inReplyTo ? `In-Reply-To: ${fields.inReplyTo}` : null,
    fields.references ? `References: ${fields.references}` : null,
    '',
    fields.body,
  ].filter((l) => l !== null);
  return Buffer.from(lines.join('\r\n')).toString('base64url');
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
        const max = Math.min(Number(params.maxResults) || 50, 500);
        const pageToken = params.pageToken as string | undefined;

        let url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}`;
        if (q) url += `&q=${encodeURIComponent(q as string)}`;
        if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

        const r = await jsonFetch(url, { headers });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };

        const msgIds: Array<{ id: string; threadId: string }> = r.data?.messages ?? [];
        const nextPageToken: string | undefined = r.data?.nextPageToken;

        // Enrich all messages in parallel (lightweight metadata calls)
        const enriched = await Promise.all(
          msgIds.map(({ id, threadId }) => fetchMessageMeta(id, threadId, headers)),
        );

        return { success: true, data: { data: enriched, nextPageToken: nextPageToken ?? null } };
      }

      case 'get_email': {
        const id = params.messageId || params.id;
        if (!id) return { success: false, error: 'messageId is required' };
        const r = await jsonFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };

        const h = extractHeaders(r.data?.payload);
        const { body, isHtml } = extractBody(r.data?.payload);

        return {
          success: true,
          data: {
            data: {
              id: r.data.id,
              threadId: r.data.threadId,
              messageId: h['message-id'],
              snippet: r.data.snippet ?? '',
              subject: h['subject'] ?? '(no subject)',
              from: h['from'] ?? '',
              to: h['to'] ?? '',
              cc: h['cc'] ?? '',
              replyTo: h['reply-to'] ?? h['from'] ?? '',
              date: h['date'] ?? '',
              labelIds: r.data.labelIds ?? [],
              isUnread: (r.data.labelIds ?? []).includes('UNREAD'),
              hasAttachment: hasAttachmentParts(r.data?.payload),
              body,
              isHtml,
            },
          },
        };
      }

      case 'list_events': {
        const calId = params.calendarId || 'primary';
        const timeMin = params.timeMin || new Date().toISOString();
        const max = params.maxResults || 50;
        const r = await jsonFetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calId}/events` +
          `?maxResults=${max}&timeMin=${encodeURIComponent(timeMin as string)}&singleEvents=true&orderBy=startTime`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: { data: r.data?.items ?? [] } };
      }

      case 'list_files': {
        const q = params.query || '';
        const max = params.pageSize || params.maxResults || 50;
        const pageToken = params.pageToken as string | undefined;
        let url =
          `https://www.googleapis.com/drive/v3/files?pageSize=${max}` +
          `&fields=nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,owners,size)`;
        if (q) url += `&q=${encodeURIComponent(q as string)}`;
        if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
        const r = await jsonFetch(url, { headers });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: { data: r.data?.files ?? [], nextPageToken: r.data?.nextPageToken ?? null } };
      }

      case 'list_users': {
        const domain = params.domain;
        if (!domain) return { success: false, error: 'domain is required' };
        const r = await jsonFetch(
          `https://admin.googleapis.com/admin/directory/v1/users?domain=${encodeURIComponent(domain as string)}&maxResults=${params.maxResults || 50}`,
          { headers },
        );
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
        const raw = buildRaw({ to: to as string, subject: subject as string, body: (body as string) || '' });
        const r = await jsonFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST', headers, body: JSON.stringify({ raw }),
        });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'reply_email': {
        const { to, subject, body, threadId, messageId } = params;
        if (!to || !subject) return { success: false, error: 'to and subject are required' };
        const raw = buildRaw({
          to: to as string,
          subject: `Re: ${subject}`,
          body: (body as string) || '',
          inReplyTo: messageId as string,
          references: messageId as string,
        });
        const payload: any = { raw };
        if (threadId) payload.threadId = threadId;
        const r = await jsonFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST', headers, body: JSON.stringify(payload),
        });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'forward_email': {
        const { to, subject, body } = params;
        if (!to || !subject) return { success: false, error: 'to and subject are required' };
        const raw = buildRaw({ to: to as string, subject: `Fwd: ${subject}`, body: (body as string) || '' });
        const r = await jsonFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST', headers, body: JSON.stringify({ raw }),
        });
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'archive_email': {
        const id = params.id || params.messageId;
        if (!id) return { success: false, error: 'id is required' };
        const r = await jsonFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`,
          { method: 'POST', headers, body: JSON.stringify({ removeLabelIds: ['INBOX'] }) },
        );
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: { id } };
      }

      case 'mark_email_read': {
        const id = params.id || params.messageId;
        if (!id) return { success: false, error: 'id is required' };
        const r = await jsonFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`,
          { method: 'POST', headers, body: JSON.stringify({ removeLabelIds: ['UNREAD'] }) },
        );
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: { id } };
      }

      case 'mark_email_unread': {
        const id = params.id || params.messageId;
        if (!id) return { success: false, error: 'id is required' };
        const r = await jsonFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`,
          { method: 'POST', headers, body: JSON.stringify({ addLabelIds: ['UNREAD'] }) },
        );
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: { id } };
      }

      case 'create_event': {
        const calId = params.calendarId || 'primary';
        if (!params.summary) return { success: false, error: 'summary is required' };
        const event: any = { summary: params.summary, description: params.description };
        if (params.start) event.start = { dateTime: params.start, timeZone: params.timeZone || 'UTC' };
        if (params.end) event.end = { dateTime: params.end, timeZone: params.timeZone || 'UTC' };
        if (params.attendees) event.attendees = (params.attendees as string[]).map((e) => ({ email: e }));
        const r = await jsonFetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
          { method: 'POST', headers, body: JSON.stringify(event) },
        );
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
        const r = await jsonFetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}`,
          { method: 'PATCH', headers, body: JSON.stringify(patch) },
        );
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'cancel_event': {
        const calId = params.calendarId || 'primary';
        const eventId = params.eventId || params.id;
        if (!eventId) return { success: false, error: 'eventId is required' };
        const r = await jsonFetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}`,
          { method: 'DELETE', headers },
        );
        // 204 No Content on success
        if (!r.ok && r.status !== 204) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: { eventId } };
      }

      case 'share_file': {
        const fileId = params.fileId || params.id;
        const email = params.email;
        if (!fileId || !email) return { success: false, error: 'fileId and email are required' };
        const r = await jsonFetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
          { method: 'POST', headers, body: JSON.stringify({ type: 'user', role: params.role || 'reader', emailAddress: email }) },
        );
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
        const r = await jsonFetch(
          `https://admin.googleapis.com/admin/directory/v1/users/${encodeURIComponent(userKey as string)}`,
          { method: 'PATCH', headers, body: JSON.stringify({ suspended: true }) },
        );
        if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      default:
        return { success: false, error: `Unknown write action: ${action}` };
    }
  },
};

registerAdapter(googleAdapter);
// Also register under the underscore alias used by the execute route resolver
registerAdapter({ ...googleAdapter, connectorId: 'google_workspace' });
