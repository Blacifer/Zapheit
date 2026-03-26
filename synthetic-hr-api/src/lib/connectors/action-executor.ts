// ---------------------------------------------------------------------------
// Connector Action Executor
// Makes real HTTP calls to third-party APIs using stored credentials.
// Handles token refresh, rate limiting, and structured error returns.
// ---------------------------------------------------------------------------

import { logger } from '../logger';

export type ActionResult = {
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
};

// ---------------------------------------------------------------------------
// Simple in-memory rate limiter: max N calls per window per (org, connector)
// ---------------------------------------------------------------------------
const RATE_LIMITS: Record<string, { count: number; resetAt: number }> = {};
const RATE_LIMIT_MAX = 30;        // requests
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

function checkRateLimit(orgId: string, connectorId: string): boolean {
  const key = `${orgId}:${connectorId}`;
  const now = Date.now();
  const bucket = RATE_LIMITS[key];

  if (!bucket || now > bucket.resetAt) {
    RATE_LIMITS[key] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    return true;
  }

  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export async function executeConnectorAction(
  connectorId: string,
  action: string,
  params: Record<string, any>,
  credentials: Record<string, string>,
  orgId?: string,
): Promise<ActionResult> {
  // Rate limiting (best-effort; in-memory only, resets on restart)
  if (orgId && !checkRateLimit(orgId, connectorId)) {
    return { success: false, error: 'Rate limit exceeded — try again in a minute', statusCode: 429 };
  }

  try {
    switch (connectorId) {
      case 'zendesk': return await zendeskAction(action, params, credentials);
      case 'slack': return await slackAction(action, params, credentials);
      case 'salesforce': return await salesforceAction(action, params, credentials);
      case 'hubspot': return await hubspotAction(action, params, credentials);
      case 'razorpay': return await razorpayAction(action, params, credentials);
      case 'paytm': return await paytmAction(action, params, credentials);
      case 'tally': return await tallyAction(action, params, credentials);
      case 'naukri': return await naukriAction(action, params, credentials);
      case 'cleartax': return await clearTaxAction(action, params, credentials);
      case 'google-workspace': return await googleWorkspaceAction(action, params, credentials);
      case 'microsoft-365': return await microsoft365Action(action, params, credentials);
      case 'zoho': return await zohoAction(action, params, credentials);
      case 'deel': return await deelAction(action, params, credentials);
      case 'gusto': return await gustoAction(action, params, credentials);
      case 'linkedin-recruiter': return await linkedinRecruiterAction(action, params, credentials);
      default:
        return { success: false, error: `Connector "${connectorId}" actions are not yet supported`, statusCode: 501 };
    }
  } catch (err: any) {
    logger.error('Connector action failed', { connectorId, action, error: err.message });
    return { success: false, error: err.message || 'Unknown error', statusCode: 500 };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function jsonFetch(url: string, opts: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
  const resp = await fetch(url, opts);
  let data: any;
  try { data = await resp.json(); } catch { data = {}; }
  return { ok: resp.ok, status: resp.status, data };
}

function bearerHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra };
}

// ---------------------------------------------------------------------------
// Zendesk
// ---------------------------------------------------------------------------
async function zendeskAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const subdomain = creds.subdomain;
  const email = creds.email;
  const apiToken = creds.api_token;

  if (!subdomain || !email || !apiToken) {
    return { success: false, error: 'Zendesk credentials missing: subdomain, email, api_token required' };
  }

  const base = `https://${subdomain}.zendesk.com/api/v2`;
  const basicAuth = Buffer.from(`${email}/token:${apiToken}`).toString('base64');
  const headers = { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/json' };

  switch (action) {
    case 'get_ticket': {
      const r = await jsonFetch(`${base}/tickets/${params.ticket_id}.json`, { headers });
      if (!r.ok) return { success: false, error: r.data?.error || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.ticket };
    }
    case 'update_ticket': {
      const update: Record<string, any> = {};
      if (params.status) update.status = params.status;
      if (params.priority) update.priority = params.priority;
      if (params.assignee_id) update.assignee_id = params.assignee_id;
      const r = await jsonFetch(`${base}/tickets/${params.ticket_id}.json`, {
        method: 'PUT', headers, body: JSON.stringify({ ticket: update }),
      });
      if (!r.ok) return { success: false, error: r.data?.error || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.ticket };
    }
    case 'create_ticket': {
      const r = await jsonFetch(`${base}/tickets.json`, {
        method: 'POST', headers,
        body: JSON.stringify({
          ticket: {
            subject: params.subject,
            comment: { body: params.body },
            requester: { email: params.requester_email },
            priority: params.priority || 'normal',
          },
        }),
      });
      if (!r.ok) return { success: false, error: r.data?.error || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.ticket };
    }
    case 'add_comment': {
      const isPublic = params.public !== 'false';
      const r = await jsonFetch(`${base}/tickets/${params.ticket_id}.json`, {
        method: 'PUT', headers,
        body: JSON.stringify({ ticket: { comment: { body: params.comment, public: isPublic } } }),
      });
      if (!r.ok) return { success: false, error: r.data?.error || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: { ticket_id: params.ticket_id, comment_added: true } };
    }
    case 'search_tickets': {
      const qs = new URLSearchParams({ query: params.query, per_page: String(params.limit || 10) });
      if (params.status) qs.set('query', `${params.query} status:${params.status}`);
      const r = await jsonFetch(`${base}/search.json?${qs}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.error || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.results };
    }
    default:
      return { success: false, error: `Unknown Zendesk action: ${action}`, statusCode: 400 };
  }
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------
async function slackAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const token = creds.access_token || creds.bot_token || creds.token;
  if (!token) return { success: false, error: 'Slack credentials missing: access_token required' };

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  switch (action) {
    case 'send_message': {
      const r = await jsonFetch('https://slack.com/api/chat.postMessage', {
        method: 'POST', headers,
        body: JSON.stringify({ channel: params.channel, text: params.text }),
      });
      if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
      return { success: true, data: { ts: r.data.ts, channel: r.data.channel } };
    }
    case 'get_channel_history': {
      // First resolve channel name to ID if needed
      let channelId = params.channel;
      if (channelId.startsWith('#')) {
        const listR = await jsonFetch(`https://slack.com/api/conversations.list?limit=200`, { headers: { Authorization: `Bearer ${token}` } });
        const found = listR.data?.channels?.find((c: any) => c.name === channelId.slice(1));
        if (!found) return { success: false, error: `Channel ${channelId} not found` };
        channelId = found.id;
      }
      const r = await jsonFetch(`https://slack.com/api/conversations.history?channel=${channelId}&limit=${params.limit || 10}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
      return { success: true, data: r.data.messages };
    }
    case 'get_user_info': {
      if (params.email) {
        const r = await jsonFetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(params.email)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return { success: true, data: r.data.user };
      }
      if (params.user_id) {
        const r = await jsonFetch(`https://slack.com/api/users.info?user=${params.user_id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return { success: true, data: r.data.user };
      }
      return { success: false, error: 'email or user_id required' };
    }
    case 'list_channels': {
      const r = await jsonFetch(`https://slack.com/api/conversations.list?limit=${params.limit || 20}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
      return { success: true, data: r.data.channels?.map((c: any) => ({ id: c.id, name: c.name, is_private: c.is_private })) };
    }
    default:
      return { success: false, error: `Unknown Slack action: ${action}`, statusCode: 400 };
  }
}

// ---------------------------------------------------------------------------
// Salesforce
// ---------------------------------------------------------------------------
async function salesforceAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const accessToken = creds.access_token;
  const instanceUrl = creds.instance_url;

  if (!accessToken || !instanceUrl) {
    return { success: false, error: 'Salesforce credentials missing: access_token and instance_url required' };
  }

  const base = `${instanceUrl}/services/data/v59.0`;
  const headers = bearerHeaders(accessToken);

  switch (action) {
    case 'get_lead': {
      const r = await jsonFetch(`${base}/sobjects/Lead/${params.lead_id}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'update_lead': {
      const update: Record<string, any> = {};
      if (params.status) update.Status = params.status;
      if (params.rating) update.Rating = params.rating;
      if (params.description) update.Description = params.description;
      const r = await jsonFetch(`${base}/sobjects/Lead/${params.lead_id}`, {
        method: 'PATCH', headers, body: JSON.stringify(update),
      });
      if (!r.ok) return { success: false, error: r.data?.[0]?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: { lead_id: params.lead_id, updated: true } };
    }
    case 'create_task': {
      const task: Record<string, any> = { Subject: params.subject };
      if (params.who_id) task.WhoId = params.who_id;
      if (params.what_id) task.WhatId = params.what_id;
      if (params.due_date) task.ActivityDate = params.due_date;
      if (params.description) task.Description = params.description;
      const r = await jsonFetch(`${base}/sobjects/Task`, {
        method: 'POST', headers, body: JSON.stringify(task),
      });
      if (!r.ok) return { success: false, error: r.data?.[0]?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'search_records': {
      const objectType = params.object_type || 'Lead';
      const sosl = `FIND {${params.query}} IN ALL FIELDS RETURNING ${objectType}(Id,Name,Email) LIMIT ${params.limit || 10}`;
      const r = await jsonFetch(`${base}/search/?q=${encodeURIComponent(sosl)}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.searchRecords };
    }
    default:
      return { success: false, error: `Unknown Salesforce action: ${action}`, statusCode: 400 };
  }
}

// ---------------------------------------------------------------------------
// HubSpot
// ---------------------------------------------------------------------------
async function hubspotAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const accessToken = creds.access_token;
  if (!accessToken) return { success: false, error: 'HubSpot credentials missing: access_token required' };

  const base = 'https://api.hubapi.com';
  const headers = bearerHeaders(accessToken);

  switch (action) {
    case 'get_contact': {
      if (params.email) {
        const r = await jsonFetch(`${base}/contacts/v1/contact/email/${encodeURIComponent(params.email)}/profile`, { headers });
        if (!r.ok) return { success: false, error: `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      const r = await jsonFetch(`${base}/crm/v3/objects/contacts/${params.contact_id}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
      return { success: true, data: r.data };
    }
    case 'create_contact': {
      const props: Record<string, string> = { email: params.email };
      if (params.firstname) props.firstname = params.firstname;
      if (params.lastname) props.lastname = params.lastname;
      if (params.company) props.company = params.company;
      if (params.phone) props.phone = params.phone;
      const r = await jsonFetch(`${base}/crm/v3/objects/contacts`, {
        method: 'POST', headers, body: JSON.stringify({ properties: props }),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
      return { success: true, data: r.data };
    }
    case 'update_deal': {
      const props: Record<string, string> = {};
      if (params.dealstage) props.dealstage = params.dealstage;
      if (params.amount) props.amount = params.amount;
      if (params.closedate) props.closedate = new Date(params.closedate).getTime().toString();
      const r = await jsonFetch(`${base}/crm/v3/objects/deals/${params.deal_id}`, {
        method: 'PATCH', headers, body: JSON.stringify({ properties: props }),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
      return { success: true, data: r.data };
    }
    case 'search_contacts': {
      const r = await jsonFetch(`${base}/crm/v3/objects/contacts/search`, {
        method: 'POST', headers,
        body: JSON.stringify({
          query: params.query,
          limit: Number(params.limit) || 10,
          properties: ['email', 'firstname', 'lastname', 'company'],
        }),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
      return { success: true, data: r.data.results };
    }
    default:
      return { success: false, error: `Unknown HubSpot action: ${action}`, statusCode: 400 };
  }
}

// ---------------------------------------------------------------------------
// Razorpay
// ---------------------------------------------------------------------------
async function razorpayAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const keyId = creds.key_id;
  const keySecret = creds.key_secret;

  if (!keyId || !keySecret) {
    return { success: false, error: 'Razorpay credentials missing: key_id and key_secret required' };
  }

  const base = 'https://api.razorpay.com/v1';
  const basicAuth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const headers = { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/json' };

  switch (action) {
    case 'get_order': {
      const r = await jsonFetch(`${base}/orders/${params.order_id}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.error?.description || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'initiate_refund': {
      const body: Record<string, any> = {};
      if (params.amount) body.amount = Number(params.amount);
      if (params.notes) body.notes = { reason: params.notes };
      const r = await jsonFetch(`${base}/payments/${params.payment_id}/refund`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      if (!r.ok) return { success: false, error: r.data?.error?.description || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'list_payments': {
      const qs = new URLSearchParams({ count: String(params.count || 10) });
      if (params.from) qs.set('from', params.from);
      const r = await jsonFetch(`${base}/payments?${qs}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.error?.description || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.items };
    }
    case 'get_settlement': {
      const r = await jsonFetch(`${base}/settlements/${params.settlement_id}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.error?.description || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    default:
      return { success: false, error: `Unknown Razorpay action: ${action}`, statusCode: 400 };
  }
}

async function paytmAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const merchantId = creds.merchant_id;
  const merchantKey = creds.merchant_key;
  const channelId = creds.channel_id;

  if (!merchantId || !merchantKey || !channelId) {
    return { success: false, error: 'Paytm credentials missing: merchant_id, merchant_key, channel_id required' };
  }

  const base = 'https://api.paytm.com/v1';
  const headers = {
    'X-Merchant-Id': merchantId,
    'X-Merchant-Key': merchantKey,
    'X-Channel-Id': channelId,
    'Content-Type': 'application/json',
  };

  switch (action) {
    case 'get_payment_status': {
      const r = await jsonFetch(`${base}/payments/${params.payment_id}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'list_transactions': {
      const qs = new URLSearchParams();
      qs.set('limit', String(params.limit || 10));
      if (params.status) qs.set('status', String(params.status));
      const r = await jsonFetch(`${base}/transactions?${qs.toString()}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data?.transactions || r.data };
    }
    case 'create_refund': {
      const body: Record<string, any> = {
        payment_id: params.payment_id,
      };
      if (params.amount != null) body.amount = Number(params.amount);
      if (params.reason) body.reason = params.reason;
      const r = await jsonFetch(`${base}/refunds`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'initiate_payout': {
      const body: Record<string, any> = {
        beneficiary_id: params.beneficiary_id,
        amount: Number(params.amount),
      };
      if (params.reference_id) body.reference_id = params.reference_id;
      if (params.note) body.note = params.note;
      const r = await jsonFetch(`${base}/payouts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    default:
      return { success: false, error: `Unknown Paytm action: ${action}`, statusCode: 400 };
  }
}

async function tallyAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const serverUrl = creds.server_url || creds.hostUrl;
  const companyName = params.company_name || creds.company_name || '';
  if (!serverUrl) return { success: false, error: 'Tally credentials missing: server_url required' };

  const xmlHeaders = { 'Content-Type': 'text/xml' };
  const xmlEscape = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const envelope = (reportName: string, staticVars = '', body = '') => `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>${reportName}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${companyName ? `<SVCURRENTCOMPANY>${xmlEscape(String(companyName))}</SVCURRENTCOMPANY>` : ''}
        ${staticVars}
      </STATICVARIABLES>
    </DESC>
    ${body}
  </BODY>
</ENVELOPE>`.trim();

  switch (action) {
    case 'list_ledgers': {
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: xmlHeaders,
        body: envelope('List of Accounts'),
      });
      const text = await response.text();
      if (!response.ok) return { success: false, error: `HTTP ${response.status}`, statusCode: response.status };
      return { success: true, data: { xml: text } };
    }
    case 'list_vouchers': {
      const staticVars = [
        params.from_date ? `<SVFROMDATE>${xmlEscape(String(params.from_date))}</SVFROMDATE>` : '',
        params.to_date ? `<SVTODATE>${xmlEscape(String(params.to_date))}</SVTODATE>` : '',
      ].filter(Boolean).join('');
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: xmlHeaders,
        body: envelope('Voucher Register', staticVars),
      });
      const text = await response.text();
      if (!response.ok) return { success: false, error: `HTTP ${response.status}`, statusCode: response.status };
      return { success: true, data: { xml: text } };
    }
    case 'post_voucher': {
      if (!params.voucher_xml) return { success: false, error: 'post_voucher requires: voucher_xml' };
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: xmlHeaders,
        body: String(params.voucher_xml),
      });
      const text = await response.text();
      if (!response.ok) return { success: false, error: text || `HTTP ${response.status}`, statusCode: response.status };
      return { success: true, data: { xml: text } };
    }
    default:
      return { success: false, error: `Unknown Tally action: ${action}`, statusCode: 400 };
  }
}

async function naukriAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const apiKey = creds.api_key;
  const clientId = creds.client_id;
  const employerId = creds.employer_id;
  if (!apiKey || !clientId || !employerId) {
    return { success: false, error: 'Naukri credentials missing: api_key, client_id, employer_id required' };
  }

  const base = 'https://api.naukri.com/v1';
  const headers = {
    'X-Api-Key': apiKey,
    'X-Client-Id': clientId,
    'X-Employer-Id': employerId,
    'Content-Type': 'application/json',
  };

  switch (action) {
    case 'search_candidates': {
      const qs = new URLSearchParams();
      qs.set('q', String(params.query || ''));
      qs.set('limit', String(params.limit || 10));
      if (params.job_id) qs.set('job_id', String(params.job_id));
      const r = await jsonFetch(`${base}/candidates/search?${qs.toString()}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data?.candidates || r.data };
    }
    case 'get_candidate': {
      const r = await jsonFetch(`${base}/candidates/${params.candidate_id}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'create_job': {
      const body: Record<string, any> = {
        title: params.title,
        description: params.description,
      };
      if (params.location) body.location = params.location;
      if (params.employment_type) body.employment_type = params.employment_type;
      const r = await jsonFetch(`${base}/jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'parse_resume': {
      const body: Record<string, any> = {};
      if (params.resume_text) body.resume_text = params.resume_text;
      if (params.candidate_id) body.candidate_id = params.candidate_id;
      const r = await jsonFetch(`${base}/candidates/parse`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    default:
      return { success: false, error: `Unknown Naukri action: ${action}`, statusCode: 400 };
  }
}

async function clearTaxAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const apiKey = creds.api_key;
  const gstin = creds.gstin;
  if (!apiKey) return { success: false, error: 'ClearTax credentials missing: api_key required' };

  const base = 'https://api.cleartax.in/v1';
  const headers = {
    'X-Cleartax-Api-Key': apiKey,
    'Content-Type': 'application/json',
  };

  switch (action) {
    case 'get_compliance_status': {
      const resolvedGstin = params.gstin || gstin;
      if (!resolvedGstin) return { success: false, error: 'get_compliance_status requires: gstin' };
      const r = await jsonFetch(`${base}/compliance/status?gstin=${encodeURIComponent(String(resolvedGstin))}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'list_notices': {
      const qs = new URLSearchParams();
      if (params.limit) qs.set('limit', String(params.limit));
      const r = await jsonFetch(`${base}/notices${qs.toString() ? `?${qs.toString()}` : ''}`, { headers });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data?.notices || r.data };
    }
    case 'calculate_tds': {
      const payload = typeof params.payload === 'string' ? JSON.parse(params.payload) : params.payload;
      const r = await jsonFetch(`${base}/tds/calculate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload || {}),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'file_gst_return': {
      const payload = typeof params.payload === 'string' ? JSON.parse(params.payload) : params.payload;
      const r = await jsonFetch(`${base}/gst/returns`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload || {}),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    default:
      return { success: false, error: `Unknown ClearTax action: ${action}`, statusCode: 400 };
  }
}

// ---------------------------------------------------------------------------
// Google Workspace (Gmail + Drive + Calendar + Docs)
// Credentials: { access_token }
// ---------------------------------------------------------------------------
async function googleWorkspaceAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const token = creds.access_token;
  if (!token) return { success: false, error: 'Google Workspace credentials missing: access_token required' };
  const h = bearerHeaders(token);

  switch (action) {
    case 'list_files': {
      const qs = new URLSearchParams({ pageSize: String(params.limit || 10) });
      if (params.query) qs.set('q', params.query);
      const r = await jsonFetch(`https://www.googleapis.com/drive/v3/files?${qs}`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.files };
    }
    case 'create_document': {
      const r = await jsonFetch('https://docs.googleapis.com/v1/documents', {
        method: 'POST', headers: h,
        body: JSON.stringify({ title: params.title || 'Untitled Document' }),
      });
      if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'send_email': {
      if (!params.to || !params.subject || !params.body) {
        return { success: false, error: 'send_email requires: to, subject, body' };
      }
      const raw = Buffer.from(
        `To: ${params.to}\r\nSubject: ${params.subject}\r\nContent-Type: text/plain\r\n\r\n${params.body}`
      ).toString('base64url');
      const r = await jsonFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: h,
        body: JSON.stringify({ raw }),
      });
      if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: { message_id: r.data.id, thread_id: r.data.threadId } };
    }
    case 'list_calendar_events': {
      const qs = new URLSearchParams({ maxResults: String(params.limit || 10) });
      if (params.time_min) qs.set('timeMin', params.time_min);
      if (params.time_max) qs.set('timeMax', params.time_max);
      const r = await jsonFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs}`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.items };
    }
    default:
      return { success: false, error: `Google Workspace action "${action}" not supported`, statusCode: 400 };
  }
}

// ---------------------------------------------------------------------------
// Microsoft 365 (Mail + Calendar + Teams via Microsoft Graph)
// Credentials: { access_token }
// ---------------------------------------------------------------------------
async function microsoft365Action(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const token = creds.access_token;
  if (!token) return { success: false, error: 'Microsoft 365 credentials missing: access_token required' };
  const h = bearerHeaders(token);
  const base = 'https://graph.microsoft.com/v1.0';

  switch (action) {
    case 'send_email': {
      if (!params.to || !params.subject || !params.body) {
        return { success: false, error: 'send_email requires: to, subject, body' };
      }
      const r = await jsonFetch(`${base}/me/sendMail`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          message: {
            subject: params.subject,
            body: { contentType: params.content_type || 'Text', content: params.body },
            toRecipients: [{ emailAddress: { address: params.to } }],
          },
        }),
      });
      if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: { sent: true } };
    }
    case 'list_emails': {
      const qs = new URLSearchParams({ $top: String(params.limit || 10) });
      const r = await jsonFetch(`${base}/me/messages?${qs}`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.value };
    }
    case 'create_calendar_event': {
      if (!params.subject || !params.start || !params.end) {
        return { success: false, error: 'create_calendar_event requires: subject, start, end' };
      }
      const r = await jsonFetch(`${base}/me/events`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          subject: params.subject,
          start: { dateTime: params.start, timeZone: params.timezone || 'Asia/Kolkata' },
          end: { dateTime: params.end, timeZone: params.timezone || 'Asia/Kolkata' },
          body: { contentType: 'Text', content: params.description || '' },
          attendees: params.attendees
            ? (params.attendees as string[]).map((e) => ({ emailAddress: { address: e }, type: 'required' }))
            : [],
        }),
      });
      if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'list_teams_channels': {
      if (!params.team_id) return { success: false, error: 'list_teams_channels requires: team_id' };
      const r = await jsonFetch(`${base}/teams/${params.team_id}/channels`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.error?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.value };
    }
    default:
      return { success: false, error: `Microsoft 365 action "${action}" not supported`, statusCode: 400 };
  }
}

// ---------------------------------------------------------------------------
// Zoho CRM
// Credentials: { access_token, api_domain? }
// ---------------------------------------------------------------------------
async function zohoAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const token = creds.access_token;
  if (!token) return { success: false, error: 'Zoho credentials missing: access_token required' };
  const domain = creds.api_domain || 'www.zohoapis.com';
  const base = `https://${domain}/crm/v2`;
  const h = bearerHeaders(token);

  switch (action) {
    case 'get_contact': {
      if (!params.contact_id && !params.email) {
        return { success: false, error: 'get_contact requires: contact_id or email' };
      }
      if (params.contact_id) {
        const r = await jsonFetch(`${base}/Contacts/${params.contact_id}`, { headers: h });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: r.data.data?.[0] };
      }
      const qs = new URLSearchParams({ criteria: `(Email:equals:${params.email})` });
      const r = await jsonFetch(`${base}/Contacts/search?${qs}`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.data?.[0] };
    }
    case 'create_lead': {
      if (!params.last_name) return { success: false, error: 'create_lead requires: last_name' };
      const r = await jsonFetch(`${base}/Leads`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ data: [{ Last_Name: params.last_name, First_Name: params.first_name, Email: params.email, Company: params.company, Phone: params.phone, Lead_Source: params.lead_source }] }),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.data?.[0] };
    }
    case 'update_deal': {
      if (!params.deal_id) return { success: false, error: 'update_deal requires: deal_id' };
      const update: Record<string, any> = {};
      if (params.stage) update.Stage = params.stage;
      if (params.amount !== undefined) update.Amount = Number(params.amount);
      if (params.close_date) update.Closing_Date = params.close_date;
      const r = await jsonFetch(`${base}/Deals/${params.deal_id}`, {
        method: 'PUT', headers: h,
        body: JSON.stringify({ data: [update] }),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.data?.[0] };
    }
    case 'search_records': {
      const module = params.module || 'Contacts';
      const qs = new URLSearchParams({ word: params.query || '' });
      const r = await jsonFetch(`${base}/${module}/search?${qs}`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.data || [] };
    }
    default:
      return { success: false, error: `Zoho action "${action}" not supported`, statusCode: 400 };
  }
}

// ---------------------------------------------------------------------------
// Deel (Contractor / Payroll)
// Credentials: { api_key } or { access_token }
// ---------------------------------------------------------------------------
async function deelAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const token = creds.api_key || creds.access_token;
  if (!token) return { success: false, error: 'Deel credentials missing: api_key or access_token required' };
  const base = 'https://api.letsdeel.com/rest/v2';
  const h = bearerHeaders(token);

  switch (action) {
    case 'list_workers': {
      const qs = new URLSearchParams({ limit: String(params.limit || 20) });
      if (params.status) qs.set('status', params.status);
      const r = await jsonFetch(`${base}/contracts?${qs}`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.data };
    }
    case 'get_contract': {
      if (!params.contract_id) return { success: false, error: 'get_contract requires: contract_id' };
      const r = await jsonFetch(`${base}/contracts/${params.contract_id}`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.data };
    }
    case 'list_payments': {
      const qs = new URLSearchParams({ limit: String(params.limit || 20) });
      if (params.contract_id) qs.set('contract_id', params.contract_id);
      const r = await jsonFetch(`${base}/payments?${qs}`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.data };
    }
    case 'create_payment': {
      if (!params.contract_id || !params.amount) {
        return { success: false, error: 'create_payment requires: contract_id, amount' };
      }
      const r = await jsonFetch(`${base}/payments`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          contract_id: params.contract_id,
          amount: { value: Number(params.amount), currency: params.currency || 'USD' },
          reason: params.reason || 'Payment via Rasi',
        }),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.data };
    }
    default:
      return { success: false, error: `Deel action "${action}" not supported`, statusCode: 400 };
  }
}

// ---------------------------------------------------------------------------
// Gusto (Payroll / HR)
// Credentials: { access_token, company_id }
// ---------------------------------------------------------------------------
async function gustoAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const token = creds.access_token;
  const companyId = creds.company_id || params.company_id;
  if (!token) return { success: false, error: 'Gusto credentials missing: access_token required' };
  if (!companyId) return { success: false, error: 'Gusto credentials missing: company_id required' };
  const base = `https://api.gusto.com/v1/companies/${companyId}`;
  const h = bearerHeaders(token);

  switch (action) {
    case 'list_employees': {
      const r = await jsonFetch(`${base}/employees`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'get_employee': {
      if (!params.employee_id) return { success: false, error: 'get_employee requires: employee_id' };
      const r = await jsonFetch(`https://api.gusto.com/v1/employees/${params.employee_id}`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'get_payroll': {
      if (!params.payroll_id) return { success: false, error: 'get_payroll requires: payroll_id' };
      const r = await jsonFetch(`${base}/payrolls/${params.payroll_id}`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'run_payroll': {
      if (!params.payroll_id) return { success: false, error: 'run_payroll requires: payroll_id' };
      const r = await jsonFetch(`${base}/payrolls/${params.payroll_id}/submit`, {
        method: 'PUT', headers: h, body: JSON.stringify({}),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    default:
      return { success: false, error: `Gusto action "${action}" not supported`, statusCode: 400 };
  }
}

// ---------------------------------------------------------------------------
// LinkedIn Recruiter
// Credentials: { access_token, organization_id? }
// ---------------------------------------------------------------------------
async function linkedinRecruiterAction(
  action: string,
  params: Record<string, any>,
  creds: Record<string, string>,
): Promise<ActionResult> {
  const token = creds.access_token;
  if (!token) return { success: false, error: 'LinkedIn Recruiter credentials missing: access_token required' };
  const h = { ...bearerHeaders(token), 'X-Restli-Protocol-Version': '2.0.0', 'LinkedIn-Version': '202401' };

  switch (action) {
    case 'search_candidates': {
      const qs = new URLSearchParams({ q: 'people', keywords: params.keywords || '' });
      if (params.location) qs.set('facetGeoRegion', params.location);
      const r = await jsonFetch(`https://api.linkedin.com/v2/search?${qs}`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.elements || [] };
    }
    case 'get_profile': {
      if (!params.profile_id) return { success: false, error: 'get_profile requires: profile_id' };
      const memberId = String(params.profile_id).startsWith('urn:') ? params.profile_id : `urn:li:person:${params.profile_id}`;
      const r = await jsonFetch(`https://api.linkedin.com/v2/people/(id:${encodeURIComponent(memberId)})`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data };
    }
    case 'send_inmail': {
      if (!params.profile_id || !params.subject || !params.body) {
        return { success: false, error: 'send_inmail requires: profile_id, subject, body' };
      }
      const orgId = creds.organization_id || params.organization_id;
      if (!orgId) return { success: false, error: 'send_inmail requires: organization_id in credentials' };
      const r = await jsonFetch('https://api.linkedin.com/v2/messages', {
        method: 'POST', headers: h,
        body: JSON.stringify({
          recipients: { values: [{ 'com.linkedin.common.MemberUrn': `urn:li:person:${params.profile_id}` }] },
          subject: params.subject,
          body: params.body,
          messageType: 'INMAIL',
          originToken: `rasi-${Date.now()}`,
        }),
      });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: { sent: true, message_id: r.data.id } };
    }
    case 'list_job_postings': {
      const orgId = creds.organization_id || params.organization_id;
      if (!orgId) return { success: false, error: 'list_job_postings requires: organization_id in credentials' };
      const qs = new URLSearchParams({ q: 'recruiting', count: String(params.limit || 10) });
      const r = await jsonFetch(`https://api.linkedin.com/v2/jobPostings?${qs}`, { headers: h });
      if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
      return { success: true, data: r.data.elements || [] };
    }
    default:
      return { success: false, error: `LinkedIn Recruiter action "${action}" not supported`, statusCode: 400 };
  }
}
