import { createHash, createSign } from 'crypto';
import { Router } from 'express';
import { supabase, supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { requirePermission } from '../middleware/rbac';
import { decryptSecret } from '../lib/integrations/encryption';
import { evaluatePolicyConstraints } from '../lib/action-policy-constraints';
import { buildGovernedActionSnapshot } from '../lib/governed-actions';

const router = Router();

const CONNECTOR_VALIDATION_TIMEOUT_MS = 10000;

type ConnectorValidationResult = {
  valid: boolean;
  accountLabel?: string;
  details?: Record<string, any>;
  error?: string;
};

type ConnectorActionResult = {
  ok: boolean;
  actionType: 'alert' | 'ticket' | 'escalation' | 'webhook' | 'sync';
  targetLabel?: string;
  details?: Record<string, any>;
  error?: string;
};

const REQUIRED_CONNECTOR_FIELDS: Record<string, string[]> = {
  slack: ['botToken'],
  github: ['personalAccessToken'],
  jira: ['baseUrl', 'email', 'apiToken'],
  pagerduty: ['apiToken'],
  datadog: ['apiKey', 'appKey'],
  razorpay: ['keyId', 'keySecret'],
  cashfree: ['clientId', 'clientSecret', 'apiVersion', 'environment'],
  payu: ['merchantKey', 'merchantSalt'],
  'phonepe-business': ['merchantId', 'saltKey', 'saltIndex', 'environment'],
  setu: ['clientId', 'clientSecret'],
  stripe: ['secretKey'],
  paypal: ['clientId', 'clientSecret', 'environment'],
  shiprocket: ['email', 'password'],
  delhivery: ['apiToken', 'environment'],
  unicommerce: ['username', 'password', 'facilityCode', 'baseUrl'],
  svix: ['authToken'],
  hookdeck: ['apiKey'],
  make: ['webhookUrl'],
  zapier: ['webhookUrl'],
  tally: ['hostUrl'],
  'zoho-books': ['clientId', 'clientSecret', 'refreshToken'],
  clear: ['clientSecret', 'environment'],
  vyapar: ['apiKey'],
  keka: ['clientId', 'clientSecret', 'hostUrl'],
  greythr: ['apiKey'],
  darwinbox: ['apiKey'],
  'razorpayx-payroll': ['keyId', 'keySecret'],
  'zoho-crm': ['clientId', 'clientSecret', 'refreshToken'],
  freshsales: ['domain', 'apiKey'],
  salesforce: ['instanceUrl', 'clientId', 'clientSecret', 'refreshToken'],
  erpnext: ['baseUrl', 'apiKey', 'apiSecret'],
  agentforce: ['instanceUrl', 'clientId', 'clientSecret', 'refreshToken'],
  'freddy-ai': ['domain', 'apiKey'],
  'zendesk-ai': ['subdomain', 'email', 'apiToken'],
  'zia-ai': ['clientId', 'clientSecret', 'refreshToken'],
  'm365-copilot': ['tenantId', 'clientId', 'clientSecret'],
  teams: ['tenantId', 'clientId', 'clientSecret'],
  'google-gemini': ['serviceAccountJson', 'delegatedAdminEmail'],
  'slack-ai': ['botToken'],
  'zoom-ai': ['accountId', 'clientId', 'clientSecret'],
  'sap-joule': ['baseUrl', 'apiKey'],
  'darwin-assistant': ['apiKey'],
  gupshup: ['apiKey', 'appId'],
  msg91: ['authKey', 'senderId'],
  'route-mobile': ['apiKey', 'apiSecret'],
  karix: ['apiKey', 'apiSecret'],
  clevertap: ['accountId', 'passcode', 'baseUrl'],
  moengage: ['workspaceId', 'apiKey', 'baseUrl'],
  webengage: ['licenseCode', 'apiKey', 'baseUrl'],
  'netcore-cloud': ['apiKey'],
  'amazon-ses': ['region', 'accessKeyId', 'secretAccessKey'],
  sendgrid: ['apiKey'],
  mailgun: ['domain', 'apiKey'],
  suprsend: ['apiKey'],
};

const SENSITIVE_CONFIG_KEYS = ['token', 'secret', 'password', 'key', 'webhook'];

function redactSensitiveConfig(value: any): any {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(redactSensitiveConfig);
  }

  const output: Record<string, any> = {};
  for (const [key, innerValue] of Object.entries(value)) {
    const lower = key.toLowerCase();
    const isSensitive = SENSITIVE_CONFIG_KEYS.some((sensitiveKey) => lower.includes(sensitiveKey));
    output[key] = isSensitive ? '[REDACTED]' : redactSensitiveConfig(innerValue);
  }
  return output;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = CONNECTOR_VALIDATION_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function validateRequiredCredentials(provider: string, credentials: Record<string, string>): string[] {
  const required = REQUIRED_CONNECTOR_FIELDS[provider] || [];
  return required.filter((field) => !credentials[field] || !String(credentials[field]).trim());
}

function getProviderTargetLabel(provider: string, setup: Record<string, any>) {
  switch (provider) {
    case 'slack':
      return setup.channelId || setup.channel || null;
    case 'teams':
      return setup.webhookUrl || setup.channel || null;
    case 'pagerduty':
      return setup.routingKey || setup.serviceId || null;
    case 'jira':
      return setup.projectKey && setup.issueType
        ? `${setup.projectKey} / ${setup.issueType}`
        : setup.projectKey || null;
    case 'webhook':
      return setup.url || null;
    default:
      return null;
  }
}

function getActionSamplePayload(provider: string) {
  const now = new Date().toISOString();
  switch (provider) {
    case 'slack':
    case 'teams':
      return {
        type: 'incident.alert.test',
        created_at: now,
        data: {
          severity: 'high',
          agent: 'sales-support',
          message: 'Test alert from RASI integrations workspace',
        },
      };
    case 'pagerduty':
      return {
        summary: 'RASI integration workspace test incident',
        severity: 'error',
        source: 'rasi-integrations',
        event_action: 'trigger',
      };
    case 'jira':
      return {
        summary: `RASI test incident ${new Date().toLocaleDateString('en-GB')}`,
        description: 'This is a real connectivity test issue created from the RASI integrations workspace.',
      };
    case 'webhook':
      return {
        id: `evt_${Date.now()}`,
        type: 'integration.test',
        created_at: now,
        data: {
          provider: 'webhook',
          message: 'Test event from RASI integrations workspace',
        },
      };
    case 'zendesk':
    case 'freshdesk':
      return {
        subject: `RASI test ticket ${new Date().toLocaleDateString('en-GB')}`,
        description: 'Connectivity test ticket created from the RASI integrations workspace. Safe to delete.',
      };
    case 'intercom':
      return {
        role: 'lead',
        name: 'RASI Integration Test',
      };
    case 'hubspot':
      return {
        firstname: 'RASI',
        lastname: 'IntegrationTest',
        email: `rasi-test-${Date.now()}@example.com`,
      };
    case 'salesforce':
      return {
        FirstName: 'RASI',
        LastName: 'IntegrationTest',
        Company: 'RASI Test',
        Email: `rasi-test-${Date.now()}@example.com`,
      };
    case 'okta':
      return {
        firstName: 'RASI',
        lastName: 'TestUser',
        email: `rasi-test-${Date.now()}@example.com`,
      };
    case 'razorpayx':
      return {
        name: 'RASI Test Contact',
        type: 'vendor',
      };
    case 'google_workspace':
    case 'google-workspace':
      return { probe: 'calendar.events.list', maxResults: 5 };
    case 'microsoft_365':
    case 'microsoft-365':
      return { probe: 'graph.me' };
    case 'linkedin':
      return { probe: 'userinfo' };
    default:
      return { created_at: now };
  }
}

async function runProviderActionTest(
  provider: string,
  credentials: Record<string, string>,
  setup: Record<string, any>,
): Promise<ConnectorActionResult> {
  switch (provider) {
    case 'slack': {
      const channel = String(setup.channelId || setup.channel || '').trim();
      if (!channel) {
        return { ok: false, actionType: 'alert', error: 'Choose a Slack channel before sending a test alert.' };
      }
      const response = await fetchWithTimeout('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel,
          text: 'RASI test alert: your Slack integration is authenticated and ready.',
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        return {
          ok: false,
          actionType: 'alert',
          targetLabel: channel,
          error: data?.error || `Slack test alert failed (${response.status})`,
        };
      }
      return {
        ok: true,
        actionType: 'alert',
        targetLabel: channel,
        details: {
          provider_message_id: data.ts || null,
          probe: 'chat.postMessage',
        },
      };
    }
    case 'teams': {
      const webhookUrl = String(setup.webhookUrl || '').trim();
      if (!webhookUrl) {
        return { ok: false, actionType: 'alert', error: 'Add a Teams workflow webhook URL before sending a test alert.' };
      }
      const response = await fetchWithTimeout(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'message',
          attachments: [
            {
              contentType: 'application/vnd.microsoft.card.adaptive',
              content: {
                type: 'AdaptiveCard',
                version: '1.4',
                body: [
                  { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: 'RASI test alert' },
                  { type: 'TextBlock', wrap: true, text: 'Your Microsoft Teams integration is ready to deliver incident notifications.' },
                ],
              },
            },
          ],
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          ok: false,
          actionType: 'alert',
          targetLabel: webhookUrl,
          error: body || `Teams test alert failed (${response.status})`,
        };
      }
      return {
        ok: true,
        actionType: 'alert',
        targetLabel: webhookUrl,
        details: { probe: 'workflow.webhook' },
      };
    }
    case 'pagerduty': {
      const routingKey = String(setup.routingKey || '').trim();
      if (!routingKey) {
        return { ok: false, actionType: 'escalation', error: 'Add a PagerDuty routing key before triggering a test incident.' };
      }
      const payload = getActionSamplePayload(provider);
      const response = await fetchWithTimeout('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          routing_key: routingKey,
          event_action: 'trigger',
          payload: {
            summary: payload.summary,
            severity: payload.severity,
            source: payload.source,
          },
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok || data?.status !== 'success') {
        return {
          ok: false,
          actionType: 'escalation',
          targetLabel: routingKey,
          error: data?.message || `PagerDuty test incident failed (${response.status})`,
        };
      }
      return {
        ok: true,
        actionType: 'escalation',
        targetLabel: routingKey,
        details: {
          dedup_key: data?.dedup_key || null,
          probe: 'events.v2.enqueue',
        },
      };
    }
    case 'jira': {
      const projectKey = String(setup.projectKey || '').trim();
      const issueType = String(setup.issueType || '').trim();
      if (!projectKey || !issueType) {
        return { ok: false, actionType: 'ticket', error: 'Choose both a Jira project key and issue type before creating a test ticket.' };
      }
      const auth = Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64');
      const payload = getActionSamplePayload(provider);
      const response = await fetchWithTimeout(`${credentials.baseUrl.replace(/\/+$/, '')}/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            project: { key: projectKey },
            issuetype: { name: issueType },
            summary: payload.summary,
            description: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: payload.description }],
                },
              ],
            },
          },
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errors = data?.errors ? Object.values(data.errors).join(', ') : '';
        return {
          ok: false,
          actionType: 'ticket',
          targetLabel: `${projectKey} / ${issueType}`,
          error: errors || data?.errorMessages?.join(', ') || `Jira test issue failed (${response.status})`,
        };
      }
      return {
        ok: true,
        actionType: 'ticket',
        targetLabel: `${projectKey} / ${issueType}`,
        details: {
          issueKey: data?.key || null,
          probe: 'rest.api.3.issue.create',
        },
      };
    }
    case 'razorpay': {
      const auth = Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString('base64');
      const amount = Number.parseInt(String(setup.amountInPaise || '1000'), 10);
      const currency = String(setup.currency || 'INR').trim().toUpperCase();
      const receiptPrefix = String(setup.receiptPrefix || 'rasi-test').trim() || 'rasi-test';

      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, actionType: 'webhook', error: 'Provide a valid Razorpay test amount in paise before creating a test order.' };
      }

      const receipt = `${receiptPrefix}-${Date.now()}`.slice(0, 40);
      const response = await fetchWithTimeout('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount,
          currency,
          receipt,
          notes: {
            source: 'rasi-integrations',
            purpose: 'provider-action-test',
          },
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok || !data?.id) {
        return {
          ok: false,
          actionType: 'webhook',
          targetLabel: `${currency} ${amount}`,
          error: data?.error?.description || `Razorpay order creation failed (${response.status})`,
        };
      }
      return {
        ok: true,
        actionType: 'webhook',
        targetLabel: `${currency} ${amount}`,
        details: {
          orderId: data.id || null,
          receipt,
          probe: 'orders.create',
        },
      };
    }
    case 'cashfree': {
      const environment = (credentials.environment || 'sandbox').toLowerCase();
      const apiBase = environment === 'production'
        ? 'https://api.cashfree.com/pg'
        : 'https://sandbox.cashfree.com/pg';
      const orderAmount = Number.parseFloat(String(setup.orderAmount || '10.00'));
      const currency = String(setup.currency || 'INR').trim().toUpperCase();
      const receiptPrefix = String(setup.receiptPrefix || 'rasi-cf').trim() || 'rasi-cf';

      if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
        return { ok: false, actionType: 'webhook', error: 'Provide a valid Cashfree test order amount before creating an order.' };
      }

      const orderId = `${receiptPrefix}-${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 45);
      const response = await fetchWithTimeout(`${apiBase}/orders`, {
        method: 'POST',
        headers: {
          'x-client-id': credentials.clientId,
          'x-client-secret': credentials.clientSecret,
          'x-api-version': credentials.apiVersion,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_id: orderId,
          order_amount: Number(orderAmount.toFixed(2)),
          order_currency: currency,
          customer_details: {
            customer_id: 'rasi-integration-test',
            customer_name: 'RASI Test Customer',
            customer_email: 'test@rasi.synthetic',
            customer_phone: '9999999999',
          },
          order_note: 'RASI integrations provider action test',
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok || !data?.order_id) {
        return {
          ok: false,
          actionType: 'webhook',
          targetLabel: `${currency} ${orderAmount.toFixed(2)}`,
          error: data?.message || data?.error_details || data?.error_description || `Cashfree order creation failed (${response.status})`,
        };
      }
      return {
        ok: true,
        actionType: 'webhook',
        targetLabel: `${currency} ${orderAmount.toFixed(2)}`,
        details: {
          orderId: data.order_id || null,
          cfOrderId: data.cf_order_id || null,
          environment,
          probe: 'orders.create',
        },
      };
    }
    case 'webhook': {
      const url = String(setup.url || '').trim();
      if (!url) {
        return { ok: false, actionType: 'webhook', error: 'Add the destination URL before sending a test event.' };
      }
      const event = String((setup.events || [])[0] || 'incident.created');
      const payload = getActionSamplePayload(provider);
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Rasi-Event': event,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          ok: false,
          actionType: 'webhook',
          targetLabel: url,
          error: body || `Webhook test event failed (${response.status})`,
        };
      }
      return {
        ok: true,
        actionType: 'webhook',
        targetLabel: url,
        details: { event, probe: 'custom.webhook.post' },
      };
    }
    // ── SUPPORT ──────────────────────────────────────────────────────────────
    case 'zendesk': {
      const subdomain = String(credentials.subdomain || '').trim().replace(/\.zendesk\.com$/, '');
      if (!subdomain) {
        return { ok: false, actionType: 'ticket', error: 'Provide your Zendesk subdomain before creating a test ticket.' };
      }
      const auth = Buffer.from(`${credentials.email}/token:${credentials.apiToken}`).toString('base64');
      const payload = getActionSamplePayload(provider);
      const response = await fetchWithTimeout(`https://${subdomain}.zendesk.com/api/v2/tickets.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket: {
            subject: payload.subject,
            comment: { body: payload.description },
            tags: ['rasi-integration-test'],
          },
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false, actionType: 'ticket', targetLabel: subdomain,
          error: data?.error || data?.description || `Zendesk test ticket failed (${response.status})`,
        };
      }
      return {
        ok: true, actionType: 'ticket', targetLabel: subdomain,
        details: { ticketId: data?.ticket?.id ?? null, probe: 'api.v2.tickets.create' },
      };
    }
    case 'freshdesk': {
      const subdomain = String(credentials.subdomain || '').trim().replace(/\.freshdesk\.com$/, '');
      if (!subdomain) {
        return { ok: false, actionType: 'ticket', error: 'Provide your Freshdesk subdomain before creating a test ticket.' };
      }
      const auth = Buffer.from(`${credentials.apiKey}:X`).toString('base64');
      const payload = getActionSamplePayload(provider);
      const response = await fetchWithTimeout(`https://${subdomain}.freshdesk.com/api/v2/tickets`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: payload.subject,
          description: payload.description,
          email: 'rasi-integration-test@example.com',
          priority: 1,
          status: 2,
          tags: ['rasi-integration-test'],
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false, actionType: 'ticket', targetLabel: subdomain,
          error: data?.description || data?.message || `Freshdesk test ticket failed (${response.status})`,
        };
      }
      return {
        ok: true, actionType: 'ticket', targetLabel: subdomain,
        details: { ticketId: data?.id ?? null, probe: 'api.v2.tickets.create' },
      };
    }
    case 'intercom': {
      const testEmail = `rasi-test-${Date.now()}@example.com`;
      const response = await fetchWithTimeout('https://api.intercom.io/contacts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Intercom-Version': '2.10',
        },
        body: JSON.stringify({ role: 'lead', email: testEmail, name: 'RASI Integration Test' }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false, actionType: 'ticket',
          error: data?.errors?.[0]?.message || data?.message || `Intercom test contact creation failed (${response.status})`,
        };
      }
      return {
        ok: true, actionType: 'ticket',
        details: { contactId: data?.id ?? null, probe: 'contacts.create' },
      };
    }
    // ── SALES ─────────────────────────────────────────────────────────────────
    case 'hubspot': {
      const payload = getActionSamplePayload(provider);
      const response = await fetchWithTimeout('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: {
            firstname: payload.firstname,
            lastname: payload.lastname,
            email: payload.email,
            company: 'RASI Integration Test',
            hs_lead_status: 'NEW',
          },
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false, actionType: 'ticket',
          error: data?.message || `HubSpot test contact creation failed (${response.status})`,
        };
      }
      return {
        ok: true, actionType: 'ticket',
        details: { contactId: data?.id ?? null, probe: 'crm.v3.contacts.create' },
      };
    }
    case 'salesforce': {
      const instanceUrl = String(credentials.instanceUrl || '').trim().replace(/\/+$/, '');
      if (!instanceUrl) {
        return { ok: false, actionType: 'ticket', error: 'Salesforce instance URL is missing. Reconnect your Salesforce integration.' };
      }
      const payload = getActionSamplePayload(provider);
      const response = await fetchWithTimeout(`${instanceUrl}/services/data/v58.0/sobjects/Lead`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          FirstName: payload.FirstName,
          LastName: payload.LastName,
          Company: payload.Company,
          Email: payload.Email,
          LeadSource: 'Web',
          Description: 'RASI integration test lead — safe to delete.',
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errMsg = Array.isArray(data) ? data[0]?.message : data?.message;
        return {
          ok: false, actionType: 'ticket', targetLabel: instanceUrl,
          error: errMsg || `Salesforce test lead failed (${response.status})`,
        };
      }
      return {
        ok: true, actionType: 'ticket', targetLabel: instanceUrl,
        details: { leadId: data?.id ?? null, probe: 'sobjects.lead.create' },
      };
    }
    // ── IT / IDENTITY ─────────────────────────────────────────────────────────
    case 'okta': {
      const domain = String(credentials.domain || '').trim().replace(/\/+$/, '');
      if (!domain) {
        return { ok: false, actionType: 'ticket', error: 'Provide your Okta domain before creating a test user.' };
      }
      const testEmail = `rasi-test-${Date.now()}@example.com`;
      const response = await fetchWithTimeout(`https://${domain}/api/v1/users?activate=false`, {
        method: 'POST',
        headers: {
          Authorization: `SSWS ${credentials.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          profile: { firstName: 'RASI', lastName: 'TestUser', email: testEmail, login: testEmail },
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false, actionType: 'ticket', targetLabel: domain,
          error: data?.errorSummary || data?.message || `Okta test user creation failed (${response.status})`,
        };
      }
      return {
        ok: true, actionType: 'ticket', targetLabel: domain,
        details: { userId: data?.id ?? null, status: data?.status ?? null, probe: 'api.v1.users.create' },
      };
    }
    // ── FINANCE ───────────────────────────────────────────────────────────────
    case 'stripe': {
      if (!String(credentials.secretKey || '').startsWith('sk_test_')) {
        return { ok: false, actionType: 'webhook', error: 'Use a Stripe test key (sk_test_...) for action tests. Live keys are not used here.' };
      }
      const auth = Buffer.from(`${credentials.secretKey}:`).toString('base64');
      const response = await fetchWithTimeout('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          amount: '100',
          currency: 'usd',
          description: 'RASI integration test',
          'metadata[source]': 'rasi-integration-test',
        }).toString(),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false, actionType: 'webhook',
          error: data?.error?.message || `Stripe test PaymentIntent failed (${response.status})`,
        };
      }
      return {
        ok: true, actionType: 'webhook',
        details: { paymentIntentId: data?.id ?? null, status: data?.status ?? null, probe: 'payment_intents.create' },
      };
    }
    case 'razorpayx': {
      const auth = Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString('base64');
      const response = await fetchWithTimeout('https://api.razorpay.com/v1/contacts', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'RASI Test Contact',
          type: 'vendor',
          email: `rasi-test-${Date.now()}@example.com`,
          reference_id: `rasi-${Date.now()}`,
          notes: { source: 'rasi-integration-test' },
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok || !data?.id) {
        return {
          ok: false, actionType: 'webhook',
          error: data?.error?.description || `RazorpayX test contact creation failed (${response.status})`,
        };
      }
      return {
        ok: true, actionType: 'webhook',
        details: { contactId: data.id ?? null, probe: 'contacts.create' },
      };
    }
    // ── COMPLIANCE ────────────────────────────────────────────────────────────
    case 'cleartax': {
      const gstin = String(credentials.gstin || '').trim().toUpperCase();
      if (!gstin) {
        return { ok: false, actionType: 'ticket', error: 'Provide your GSTIN before validating your ClearTax connection.' };
      }
      const response = await fetchWithTimeout(
        `https://api.cleartax.in/v1/compliance/status?gstin=${encodeURIComponent(gstin)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${credentials.authToken}`, 'Content-Type': 'application/json' },
        },
      );
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false, actionType: 'ticket', targetLabel: gstin,
          error: data?.message || data?.error || `ClearTax credential validation failed (${response.status})`,
        };
      }
      return {
        ok: true, actionType: 'ticket', targetLabel: gstin,
        details: { filingStatus: data?.filing_status ?? data?.status ?? null, probe: 'compliance.status.get' },
      };
    }
    case 'epfo': {
      const establishmentId = String(credentials.establishmentId || credentials.username || '').trim();
      if (!establishmentId) {
        return { ok: false, actionType: 'ticket', error: 'Provide your EPFO establishment ID before validating the connection.' };
      }
      const response = await fetchWithTimeout('https://unifiedportal-emp.epfindia.gov.in/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ establishment_id: establishmentId, password: credentials.password }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false, actionType: 'ticket', targetLabel: establishmentId,
          error: data?.message || `EPFO credential validation failed (${response.status})`,
        };
      }
      return {
        ok: true, actionType: 'ticket', targetLabel: establishmentId,
        details: { status: data?.status ?? null, probe: 'epfo.validate' },
      };
    }
    // ── PRODUCTIVITY / COLLABORATION ───────────────────────────────────────
    case 'google_workspace':
    case 'google-workspace': {
      const token = credentials.accessToken || credentials.access_token;
      if (!token) {
        return { ok: false, actionType: 'sync', error: 'Google Workspace access token is missing. Reconnect the integration.' };
      }
      // Safe read-only test: list upcoming calendar events
      const calResponse = await fetchWithTimeout(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=5&orderBy=startTime&singleEvents=true&timeMin=' + encodeURIComponent(new Date().toISOString()),
        { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      );
      if (calResponse.status === 401) {
        return { ok: false, actionType: 'sync', error: 'Google token expired. Reconnect the integration to refresh.' };
      }
      const calData: any = await calResponse.json().catch(() => ({}));
      if (!calResponse.ok) {
        // Fallback: try userinfo endpoint (smaller scope requirement)
        const userResponse = await fetchWithTimeout('https://www.googleapis.com/oauth2/v2/userinfo', {
          method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        const userData: any = await userResponse.json().catch(() => ({}));
        if (!userResponse.ok) {
          return {
            ok: false, actionType: 'sync',
            error: calData?.error?.message || userData?.error?.message || `Google API probe failed (${calResponse.status})`,
          };
        }
        return {
          ok: true, actionType: 'sync',
          targetLabel: userData?.email || 'Google Workspace',
          details: { email: userData?.email ?? null, probe: 'oauth2.userinfo' },
        };
      }
      const eventCount = calData?.items?.length ?? 0;
      return {
        ok: true, actionType: 'sync',
        targetLabel: calData?.summary || 'Google Calendar',
        details: { upcomingEvents: eventCount, calendarId: 'primary', probe: 'calendar.v3.events.list' },
      };
    }
    case 'microsoft_365':
    case 'microsoft-365': {
      const token = credentials.accessToken || credentials.access_token;
      if (!token) {
        return { ok: false, actionType: 'sync', error: 'Microsoft 365 access token is missing. Reconnect the integration.' };
      }
      // Safe read-only test: get user profile from Microsoft Graph
      const msResponse = await fetchWithTimeout('https://graph.microsoft.com/v1.0/me', {
        method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (msResponse.status === 401) {
        return { ok: false, actionType: 'sync', error: 'Microsoft token expired. Reconnect the integration to refresh.' };
      }
      const msData: any = await msResponse.json().catch(() => ({}));
      if (!msResponse.ok) {
        return {
          ok: false, actionType: 'sync',
          error: msData?.error?.message || `Microsoft Graph probe failed (${msResponse.status})`,
        };
      }
      return {
        ok: true, actionType: 'sync',
        targetLabel: msData?.mail || msData?.userPrincipalName || 'Microsoft 365',
        details: {
          displayName: msData?.displayName ?? null,
          mail: msData?.mail ?? null,
          jobTitle: msData?.jobTitle ?? null,
          probe: 'graph.v1.me',
        },
      };
    }
    case 'linkedin': {
      const token = credentials.accessToken || credentials.access_token;
      if (!token) {
        return { ok: false, actionType: 'sync', error: 'LinkedIn access token is missing. Reconnect the integration.' };
      }
      // Safe read-only test: get user profile
      const liResponse = await fetchWithTimeout('https://api.linkedin.com/v2/userinfo', {
        method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (liResponse.status === 401) {
        return { ok: false, actionType: 'sync', error: 'LinkedIn token expired. Reconnect the integration to refresh.' };
      }
      const liData: any = await liResponse.json().catch(() => ({}));
      if (!liResponse.ok) {
        return {
          ok: false, actionType: 'sync',
          error: liData?.message || `LinkedIn API probe failed (${liResponse.status})`,
        };
      }
      return {
        ok: true, actionType: 'sync',
        targetLabel: liData?.email || liData?.name || 'LinkedIn',
        details: {
          name: liData?.name ?? null,
          email: liData?.email ?? null,
          sub: liData?.sub ?? null,
          probe: 'v2.userinfo',
        },
      };
    }
    default:
      return {
        ok: false,
        actionType: 'webhook',
        error: 'This provider does not support a live action test yet.',
      };
  }
}

function resolveZohoAccountsDomain(dataCenter?: string): string {
  switch ((dataCenter || 'in').toLowerCase()) {
    case 'com':
    case 'us':
      return 'https://accounts.zoho.com';
    case 'eu':
      return 'https://accounts.zoho.eu';
    case 'com.au':
    case 'au':
      return 'https://accounts.zoho.com.au';
    case 'jp':
      return 'https://accounts.zoho.jp';
    case 'sa':
      return 'https://accounts.zoho.sa';
    case 'ca':
      return 'https://accounts.zohocloud.ca';
    case 'in':
    default:
      return 'https://accounts.zoho.in';
  }
}

function resolvePhonePeBaseUrl(credentials: Record<string, string>): string {
  const explicitBaseUrl = credentials.baseUrl?.trim();
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/+$/, '');
  }

  const environment = credentials.environment?.trim().toLowerCase();
  if (environment === 'sandbox' || environment === 'test' || environment === 'uat' || environment === 'preprod') {
    return 'https://api-preprod.phonepe.com/apis/pg-sandbox';
  }

  return 'https://api.phonepe.com/apis/hermes';
}

function buildPhonePeXVerify(path: string, saltKey: string, saltIndex: string): string {
  const digest = createHash('sha256')
    .update(`${path}${saltKey}`)
    .digest('hex');

  return `${digest}###${saltIndex}`;
}

function resolveDelhiveryBaseUrl(credentials: Record<string, string>): string {
  const explicitBaseUrl = credentials.baseUrl?.trim();
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/+$/, '');
  }

  const environment = credentials.environment?.trim().toLowerCase();
  if (environment === 'sandbox' || environment === 'test' || environment === 'staging') {
    return 'https://staging-express.delhivery.com';
  }

  return 'https://track.delhivery.com';
}

function resolveClearBaseUrl(credentials: Record<string, string>): string {
  const explicitBaseUrl = credentials.baseUrl?.trim();
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/+$/, '');
  }

  const environment = credentials.environment?.trim().toLowerCase();
  if (environment === 'sandbox' || environment === 'test' || environment === 'staging') {
    return 'https://api-sandbox.clear.in';
  }

  return 'https://api.clear.in';
}

function normalizeFreshsalesBaseUrl(domain: string): string {
  const trimmed = domain.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }

  return `https://${trimmed.replace(/\/+$/, '')}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }

  return `https://${trimmed.replace(/\/+$/, '')}`;
}

function buildUnicommerceSoapEnvelope(username: string, password: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.v2.unicommerce.com/" xmlns:typ="http://types.v2.unicommerce.com">
  <soapenv:Header>
    <ser:AuthHeader>
      <typ:username>${username}</typ:username>
      <typ:password>${password}</typ:password>
    </ser:AuthHeader>
  </soapenv:Header>
  <soapenv:Body>
    <ser:getItemDetails/>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function buildTallyProbeEnvelope(companyName?: string): string {
  const currentCompany = companyName?.trim()
    ? `<SVCURRENTCOMPANY>${companyName.trim()}</SVCURRENTCOMPANY>`
    : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>DATA</TYPE>
    <ID>All Masters</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${currentCompany}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <FETCHLIST>
        <FETCH>Name</FETCH>
      </FETCHLIST>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function extractTallyServerCompanyName(xml: string): string | null {
  const match = xml.match(/<SERVERCOMPANYNAME>([\s\S]*?)<\/SERVERCOMPANYNAME>/i);
  return match?.[1]?.trim() || null;
}

function base64UrlEncode(value: Buffer | string): string {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function signGoogleJwt(header: Record<string, any>, payload: Record<string, any>, privateKey: string): string {
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const signature = signer.sign(privateKey);
  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`;
}

async function refreshZohoAccessToken(credentials: Record<string, string>) {
  const accountsDomain = resolveZohoAccountsDomain(credentials.dataCenter);
  const params = new URLSearchParams({
    refresh_token: credentials.refreshToken,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: 'refresh_token',
  });

  const response = await fetchWithTimeout(`${accountsDomain}/oauth/v2/token?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
  });

  const body = await response.json().catch(() => null) as any;
  if (!response.ok || !body?.access_token) {
    return {
      ok: false,
      error: body?.error || body?.error_description || 'Zoho token refresh failed',
    };
  }

  return {
    ok: true,
    accessToken: body.access_token as string,
    apiDomain: body.api_domain as string | undefined,
    expiresIn: body.expires_in as number | undefined,
  };
}

async function fetchKekaAccessToken(credentials: Record<string, string>) {
  const tokenUrl = credentials.tokenUrl?.trim() || 'https://login.keka.com/connect/token';
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'kekaapi',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });

  const response = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.access_token) {
    return {
      ok: false,
      error: payload?.error_description || payload?.error || 'Keka token generation failed',
    };
  }

  return {
    ok: true,
    accessToken: payload.access_token as string,
    expiresIn: payload.expires_in as number | undefined,
  };
}

async function fetchGoogleWorkspaceAccessToken(credentials: Record<string, string>) {
  let parsed: any;
  try {
    parsed = JSON.parse(credentials.serviceAccountJson);
  } catch {
    return {
      ok: false,
      error: 'Google service account JSON is invalid',
    };
  }

  const clientEmail = parsed.client_email as string | undefined;
  const privateKey = parsed.private_key as string | undefined;
  const tokenUri = (parsed.token_uri as string | undefined) || 'https://oauth2.googleapis.com/token';
  const delegatedAdminEmail = credentials.delegatedAdminEmail?.trim();

  if (!clientEmail || !privateKey || !delegatedAdminEmail) {
    return {
      ok: false,
      error: 'Google service account JSON must include client_email/private_key and delegated admin email is required',
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = signGoogleJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: clientEmail,
      sub: delegatedAdminEmail,
      scope: 'https://www.googleapis.com/auth/admin.directory.user.readonly',
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    },
    privateKey,
  );

  const response = await fetchWithTimeout(tokenUri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  const body = await response.json().catch(() => null) as any;
  if (!response.ok || !body?.access_token) {
    return {
      ok: false,
      error: body?.error_description || body?.error?.message || body?.error || 'Google Workspace token exchange failed',
    };
  }

  return {
    ok: true,
    accessToken: body.access_token as string,
    delegatedAdminEmail,
  };
}

async function fetchMicrosoftGraphAccessToken(credentials: Record<string, string>) {
  const tenantId = credentials.tenantId?.trim();
  const clientId = credentials.clientId?.trim();
  const clientSecret = credentials.clientSecret?.trim();

  if (!tenantId || !clientId || !clientSecret) {
    return {
      ok: false,
      error: 'Tenant ID, client ID, and client secret are required',
    };
  }

  const response = await fetchWithTimeout(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }).toString(),
  });

  const body = await response.json().catch(() => null) as any;
  if (!response.ok || !body?.access_token) {
    return {
      ok: false,
      error: body?.error_description || body?.error?.message || body?.error || 'Microsoft token exchange failed',
    };
  }

  return {
    ok: true,
    accessToken: body.access_token as string,
    tenantId,
  };
}

async function refreshSalesforceAccessToken(credentials: Record<string, string>) {
  const tokenUrl = `${credentials.instanceUrl.trim().replace(/\/+$/, '')}/services/oauth2/token`;
  const response = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
    }).toString(),
  });

  const body = await response.json().catch(() => null) as any;
  if (!response.ok || !body?.access_token || !body?.instance_url) {
    return {
      ok: false,
      error: body?.error_description || body?.error || 'Salesforce token refresh failed',
    };
  }

  return {
    ok: true,
    accessToken: body.access_token as string,
    instanceUrl: body.instance_url as string,
    idUrl: body.id as string | undefined,
  };
}

async function validateProviderConnection(
  provider: string,
  credentials: Record<string, string>
): Promise<ConnectorValidationResult> {
  const missingFields = validateRequiredCredentials(provider, credentials);
  if (missingFields.length > 0) {
    return {
      valid: false,
      error: `Missing required fields: ${missingFields.join(', ')}`,
    };
  }

  switch (provider) {
    case 'slack': {
      const botToken = credentials.botToken?.trim();
      if (!botToken) {
        return { valid: false, error: 'Slack Bot Token is required' };
      }

      const response = await fetchWithTimeout('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      const body = await response.json() as any;
      if (!response.ok || !body?.ok) {
        return { valid: false, error: body?.error || 'Slack authentication failed' };
      }

      return {
        valid: true,
        accountLabel: body.team ? `${body.team} (${body.user || 'bot'})` : (body.user || 'Slack workspace'),
        details: { team_id: body.team_id, user_id: body.user_id },
      };
    }
    case 'github': {
      const personalAccessToken = credentials.personalAccessToken?.trim();
      if (!personalAccessToken) {
        return { valid: false, error: 'GitHub Personal Access Token is required' };
      }

      const response = await fetchWithTimeout('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${personalAccessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'SyntheticHR-Connector',
        },
      });

      const body = await response.json() as any;
      if (!response.ok || !body?.login) {
        return { valid: false, error: body?.message || 'GitHub authentication failed' };
      }

      return {
        valid: true,
        accountLabel: body.login,
        details: { user_id: body.id },
      };
    }
    case 'jira': {
      const baseUrl = credentials.baseUrl?.trim();
      const email = credentials.email?.trim();
      const apiToken = credentials.apiToken?.trim();
      if (!baseUrl || !email || !apiToken) {
        return { valid: false, error: 'Jira base URL, email, and API token are required' };
      }

      const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
      const authHeader = Buffer.from(`${email}:${apiToken}`).toString('base64');
      const response = await fetchWithTimeout(`${normalizedBaseUrl}/rest/api/3/myself`, {
        headers: {
          Authorization: `Basic ${authHeader}`,
          Accept: 'application/json',
        },
      });
      const body = await response.json() as any;
      if (!response.ok || !body?.accountId) {
        return { valid: false, error: body?.errorMessages?.[0] || 'Jira authentication failed' };
      }

      return {
        valid: true,
        accountLabel: body.displayName || body.emailAddress || 'Jira account',
        details: { account_id: body.accountId, base_url: normalizedBaseUrl },
      };
    }
    case 'pagerduty': {
      const apiToken = credentials.apiToken?.trim();
      if (!apiToken) {
        return { valid: false, error: 'PagerDuty API token is required' };
      }

      const response = await fetchWithTimeout('https://api.pagerduty.com/users/me', {
        headers: {
          Authorization: `Token token=${apiToken}`,
          Accept: 'application/vnd.pagerduty+json;version=2',
        },
      });
      const body = await response.json() as any;
      if (!response.ok || !body?.user?.id) {
        return { valid: false, error: body?.error?.message || 'PagerDuty authentication failed' };
      }

      return {
        valid: true,
        accountLabel: body.user.summary || body.user.email || 'PagerDuty user',
        details: { user_id: body.user.id },
      };
    }
    case 'datadog': {
      const apiKey = credentials.apiKey?.trim();
      const appKey = credentials.appKey?.trim();
      if (!apiKey || !appKey) {
        return { valid: false, error: 'Datadog API key and App key are required' };
      }

      const validateResponse = await fetchWithTimeout('https://api.datadoghq.com/api/v1/validate', {
        headers: {
          'DD-API-KEY': apiKey,
          Accept: 'application/json',
        },
      });
      const validateBody = await validateResponse.json() as any;
      if (!validateResponse.ok || !validateBody?.valid) {
        return { valid: false, error: 'Datadog API key validation failed' };
      }

      const userResponse = await fetchWithTimeout('https://api.datadoghq.com/api/v2/current_user', {
        headers: {
          'DD-API-KEY': apiKey,
          'DD-APPLICATION-KEY': appKey,
          Accept: 'application/json',
        },
      });
      const userBody = await userResponse.json() as any;
      if (!userResponse.ok || !userBody?.data?.id) {
        return { valid: false, error: userBody?.errors?.[0] || 'Datadog application key validation failed' };
      }

      return {
        valid: true,
        accountLabel: userBody?.data?.attributes?.email || 'Datadog account',
        details: { user_id: userBody?.data?.id },
      };
    }
    case 'keka': {
      const tokenResult = await fetchKekaAccessToken(credentials);
      if (!tokenResult.ok) {
        return {
          valid: false,
          error: tokenResult.error,
        };
      }

      const hostUrl = credentials.hostUrl.replace(/\/+$/, '');
      const response = await fetchWithTimeout(`${hostUrl}/api/v1/hris/employees`, {
        headers: {
          Authorization: `Bearer ${tokenResult.accessToken}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok) {
        return {
          valid: false,
          error: body?.message || body?.title || 'Keka API probe failed',
        };
      }

      return {
        valid: true,
        accountLabel: credentials.hostUrl,
        details: {
          host_url: hostUrl,
          probe: 'hris.employees',
        },
      };
    }
    case 'cashfree': {
      const environment = (credentials.environment || 'sandbox').toLowerCase();
      const apiBase = environment === 'production'
        ? 'https://api.cashfree.com/pg'
        : 'https://sandbox.cashfree.com/pg';
      const response = await fetchWithTimeout(`${apiBase}/orders/integration_probe_cashfree`, {
        headers: {
          'x-client-id': credentials.clientId,
          'x-client-secret': credentials.clientSecret,
          'x-api-version': credentials.apiVersion,
          Accept: 'application/json',
        },
      });

      if (response.status === 404) {
        return {
          valid: true,
          accountLabel: `Cashfree ${environment}`,
          details: { environment, probe: 'orders.get' },
        };
      }

      const body = await response.json().catch(() => null) as any;
      if (!response.ok) {
        return {
          valid: false,
          error: body?.message || body?.error?.description || 'Cashfree authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: `Cashfree ${environment}`,
        details: { environment, probe: 'orders.get' },
      };
    }
    case 'setu': {
      const response = await fetchWithTimeout('https://accountservice.setu.co/v1/users/login', {
        method: 'POST',
        headers: {
          client: 'bridge',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          clientID: credentials.clientId,
          secret: credentials.clientSecret,
          grant_type: 'client_credentials',
        }),
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !body?.access_token) {
        return {
          valid: false,
          error: body?.message || body?.error || 'Setu authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: 'Setu account',
        details: {
          token_type: body.token_type || 'Bearer',
          expires_in: body.expires_in || 300,
          probe: 'oauth.login',
        },
      };
    }
    case 'phonepe-business': {
      const merchantId = credentials.merchantId?.trim();
      const saltKey = credentials.saltKey?.trim();
      const saltIndex = credentials.saltIndex?.trim();
      const environment = credentials.environment?.trim().toLowerCase();

      if (!merchantId || !saltKey || !saltIndex || !environment) {
        return {
          valid: false,
          error: 'PhonePe merchant ID, salt key, salt index, and environment are required',
        };
      }

      const probeTransactionId = 'integration-probe-phonepe-status';
      const statusPath = `/pg/v1/status/${merchantId}/${probeTransactionId}`;
      const response = await fetchWithTimeout(`${resolvePhonePeBaseUrl(credentials)}${statusPath}`, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-VERIFY': buildPhonePeXVerify(statusPath, saltKey, saltIndex),
          'X-MERCHANT-ID': merchantId,
        },
      });

      const body = await response.json().catch(() => null) as any;
      const bodyText = JSON.stringify(body || {}).toLowerCase();
      const looksLikeValidAuthWithUnknownTransaction =
        (bodyText.includes('transaction') || bodyText.includes('merchant transaction') || bodyText.includes('order')) &&
        (bodyText.includes('not found') || bodyText.includes('not exist') || bodyText.includes('no record'));

      if (!response.ok && !looksLikeValidAuthWithUnknownTransaction) {
        return {
          valid: false,
          error: body?.message || body?.code || 'PhonePe authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: merchantId,
        details: {
          merchant_id: merchantId,
          environment,
          probe: 'pg.status',
        },
      };
    }
    case 'zoho-books': {
      const tokenResult = await refreshZohoAccessToken(credentials);
      if (!tokenResult.ok) {
        return {
          valid: false,
          error: tokenResult.error,
        };
      }

      const apiDomain = tokenResult.apiDomain || 'https://www.zohoapis.in';
      const response = await fetchWithTimeout(`${apiDomain}/books/v4/organizations`, {
        headers: {
          Authorization: `Zoho-oauthtoken ${tokenResult.accessToken}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !Array.isArray(body?.organizations)) {
        return {
          valid: false,
          error: body?.message || body?.code || 'Zoho Books API probe failed',
        };
      }

      const matchedOrg = credentials.organizationId
        ? body.organizations.find((org: any) => String(org.organization_id) === String(credentials.organizationId))
        : body.organizations[0];

      if (credentials.organizationId && !matchedOrg) {
        return {
          valid: false,
          error: 'Zoho Books organization ID not found for the provided credentials',
        };
      }

      return {
        valid: true,
        accountLabel: matchedOrg?.name || 'Zoho Books organization',
        details: {
          organization_id: matchedOrg?.organization_id || null,
          api_domain: apiDomain,
          probe: 'organizations.list',
        },
      };
    }
    case 'zoho-crm': {
      const tokenResult = await refreshZohoAccessToken(credentials);
      if (!tokenResult.ok) {
        return {
          valid: false,
          error: tokenResult.error,
        };
      }

      const apiDomain = tokenResult.apiDomain || 'https://www.zohoapis.in';
      const response = await fetchWithTimeout(`${apiDomain}/crm/v8/__features`, {
        headers: {
          Authorization: `Zoho-oauthtoken ${tokenResult.accessToken}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !body) {
        return {
          valid: false,
          error: body?.message || body?.code || 'Zoho CRM API probe failed',
        };
      }

      return {
        valid: true,
        accountLabel: 'Zoho CRM organization',
        details: {
          api_domain: apiDomain,
          probe: '__features',
        },
      };
    }
    case 'clear': {
      const environment = credentials.environment?.trim().toLowerCase();
      const response = await fetchWithTimeout(`${resolveClearBaseUrl(credentials)}/integration/v1/authz/token`, {
        headers: {
          'x-cleartax-auth-token': credentials.clientSecret,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !body?.access_token) {
        return {
          valid: false,
          error: body?.message || body?.error || 'Clear authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: `Clear ${environment}`,
        details: {
          environment,
          probe: 'authz.token',
        },
      };
    }
    case 'tally': {
      const hostUrl = normalizeBaseUrl(credentials.hostUrl);
      const requestedCompanyName = credentials.companyName?.trim() || null;
      const response = await fetchWithTimeout(hostUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          Accept: 'application/xml, text/xml',
        },
        body: buildTallyProbeEnvelope(requestedCompanyName || undefined),
      }, 15000);

      const bodyText = await response.text();
      const normalizedBody = bodyText.toLowerCase();
      const hasSuccessStatus = /<status>\s*1\s*<\/status>/i.test(bodyText);
      const hasLineError = /<lineerror>/i.test(bodyText);
      const hasException = normalizedBody.includes('http/xml gateway') || normalizedBody.includes('lineerror');
      const validatedCompanyName = extractTallyServerCompanyName(bodyText);

      if (!response.ok || !hasSuccessStatus || hasLineError || hasException) {
        return {
          valid: false,
          error: 'TallyPrime gateway probe failed. Confirm TallyPrime is running, XML over HTTP is enabled, and the company is loaded.',
        };
      }

      if (requestedCompanyName && validatedCompanyName && validatedCompanyName.toLowerCase() !== requestedCompanyName.toLowerCase()) {
        return {
          valid: false,
          error: `TallyPrime responded with company "${validatedCompanyName}" instead of "${requestedCompanyName}". Confirm the correct company is loaded.`,
        };
      }

      if (requestedCompanyName && !validatedCompanyName) {
        return {
          valid: false,
          error: 'TallyPrime did not confirm the active company. Confirm the requested company is loaded and reachable.',
        };
      }

      return {
        valid: true,
        accountLabel: validatedCompanyName || requestedCompanyName || hostUrl,
        details: {
          host_url: hostUrl,
          company_name: validatedCompanyName || requestedCompanyName || null,
          probe: 'xml.export.all_masters',
        },
      };
    }
    case 'freshsales': {
      const baseUrl = normalizeFreshsalesBaseUrl(credentials.domain);
      const response = await fetchWithTimeout(`${baseUrl}/api/tasks?per_page=1&page=1`, {
        headers: {
          Authorization: `Token token=${credentials.apiKey}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok) {
        return {
          valid: false,
          error: body?.message || body?.description || body?.errors?.[0]?.message || 'Freshsales authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: credentials.domain,
        details: {
          domain: baseUrl,
          probe: 'tasks.list',
        },
      };
    }
    case 'teams': {
      const tokenResult = await fetchMicrosoftGraphAccessToken(credentials);
      if (!tokenResult.ok) {
        return {
          valid: false,
          error: tokenResult.error,
        };
      }

      const response = await fetchWithTimeout('https://graph.microsoft.com/v1.0/admin/teams/userConfigurations?$top=1', {
        headers: {
          Authorization: `Bearer ${tokenResult.accessToken}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !body) {
        return {
          valid: false,
          error: body?.error?.message || 'Microsoft Teams authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: credentials.tenantId,
        details: {
          tenant_id: credentials.tenantId,
          probe: 'graph.admin.teams.userConfigurations',
        },
      };
    }
    case 'm365-copilot': {
      const tokenResult = await fetchMicrosoftGraphAccessToken(credentials);
      if (!tokenResult.ok) {
        return {
          valid: false,
          error: tokenResult.error,
        };
      }

      const response = await fetchWithTimeout('https://graph.microsoft.com/v1.0/organization?$top=1', {
        headers: {
          Authorization: `Bearer ${tokenResult.accessToken}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !Array.isArray(body?.value) || !body.value[0]) {
        return {
          valid: false,
          error: body?.error?.message || 'Microsoft 365 authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: body.value[0].displayName || credentials.tenantId,
        details: {
          tenant_id: credentials.tenantId,
          organization_id: body.value[0].id || null,
          probe: 'graph.organization.list',
        },
      };
    }
    case 'google-gemini': {
      const tokenResult = await fetchGoogleWorkspaceAccessToken(credentials);
      if (!tokenResult.ok) {
        return {
          valid: false,
          error: tokenResult.error,
        };
      }

      const response = await fetchWithTimeout('https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&maxResults=1&orderBy=email', {
        headers: {
          Authorization: `Bearer ${tokenResult.accessToken}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !Array.isArray(body?.users)) {
        return {
          valid: false,
          error: body?.error?.message || 'Google Workspace authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: tokenResult.delegatedAdminEmail,
        details: {
          delegated_admin_email: tokenResult.delegatedAdminEmail,
          probe: 'admin.directory.users.list',
        },
      };
    }
    case 'zia-ai': {
      const tokenResult = await refreshZohoAccessToken(credentials);
      if (!tokenResult.ok) {
        return {
          valid: false,
          error: tokenResult.error,
        };
      }

      const apiDomain = tokenResult.apiDomain || 'https://www.zohoapis.in';
      const response = await fetchWithTimeout(`${apiDomain}/crm/v8/org`, {
        headers: {
          Authorization: `Zoho-oauthtoken ${tokenResult.accessToken}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !body) {
        return {
          valid: false,
          error: body?.message || body?.code || 'Zoho Zia authentication failed',
        };
      }

      const orgName = body?.org?.[0]?.company_name || body?.org?.[0]?.zgid || 'Zoho organization';
      return {
        valid: true,
        accountLabel: orgName,
        details: {
          api_domain: apiDomain,
          probe: 'crm.org',
        },
      };
    }
    case 'salesforce': {
      const tokenResult = await refreshSalesforceAccessToken(credentials);
      if (!tokenResult.ok) {
        return {
          valid: false,
          error: tokenResult.error,
        };
      }

      const instanceUrl = tokenResult.instanceUrl;
      if (!instanceUrl) {
        return {
          valid: false,
          error: 'Salesforce token refresh did not return an instance URL',
        };
      }

      const identityUrl = tokenResult.idUrl || `${instanceUrl.replace(/\/+$/, '')}/services/oauth2/userinfo`;
      const response = await fetchWithTimeout(identityUrl, {
        headers: {
          Authorization: `Bearer ${tokenResult.accessToken}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !body) {
        return {
          valid: false,
          error: body?.message || body?.error_description || body?.error || 'Salesforce authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: body.preferred_username || body.email || body.username || 'Salesforce org',
        details: {
          instance_url: instanceUrl,
          user_id: body.user_id || body.user_id_url || null,
          organization_id: body.organization_id || null,
          probe: tokenResult.idUrl ? 'oauth.identity' : 'oauth.userinfo',
        },
      };
    }
    case 'agentforce': {
      const tokenResult = await refreshSalesforceAccessToken(credentials);
      if (!tokenResult.ok) {
        return {
          valid: false,
          error: tokenResult.error,
        };
      }

      const instanceUrl = tokenResult.instanceUrl;
      if (!instanceUrl) {
        return {
          valid: false,
          error: 'Salesforce token refresh did not return an instance URL',
        };
      }

      const response = await fetchWithTimeout(`${instanceUrl.replace(/\/+$/, '')}/services/data/v61.0/`, {
        headers: {
          Authorization: `Bearer ${tokenResult.accessToken}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !Array.isArray(body)) {
        return {
          valid: false,
          error: body?.message || body?.error_description || body?.error || 'Agentforce authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: instanceUrl,
        details: {
          instance_url: instanceUrl,
          probe: 'salesforce.rest.versions',
        },
      };
    }
    case 'erpnext': {
      const baseUrl = normalizeBaseUrl(credentials.baseUrl);
      const authHeader = `token ${credentials.apiKey}:${credentials.apiSecret}`;
      const response = await fetchWithTimeout(`${baseUrl}/api/resource/User?limit_page_length=1`, {
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !Array.isArray(body?.data)) {
        return {
          valid: false,
          error: body?.exception || body?.message || 'ERPNext authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: baseUrl,
        details: {
          base_url: baseUrl,
          probe: 'resource.User.list',
        },
      };
    }
    case 'freddy-ai': {
      const baseUrl = normalizeFreshsalesBaseUrl(credentials.domain);
      const auth = Buffer.from(`${credentials.apiKey}:X`).toString('base64');
      const response = await fetchWithTimeout(`${baseUrl}/api/v2/agents/me`, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !body?.id) {
        return {
          valid: false,
          error: body?.message || body?.description || 'Freshworks authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: body?.contact?.email || body?.contact?.name || credentials.domain,
        details: {
          domain: baseUrl,
          agent_id: body.id,
          probe: 'freshdesk.agents.me',
        },
      };
    }
    case 'zendesk-ai': {
      const subdomain = credentials.subdomain?.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      const email = credentials.email?.trim();
      const apiToken = credentials.apiToken?.trim();
      const auth = Buffer.from(`${email}/token:${apiToken}`).toString('base64');
      const response = await fetchWithTimeout(`https://${subdomain}.zendesk.com/api/v2/users/me.json`, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !body?.user?.id) {
        return {
          valid: false,
          error: body?.error || body?.description || body?.details || 'Zendesk authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: body.user.email || body.user.name || `${subdomain}.zendesk.com`,
        details: {
          subdomain,
          user_id: body.user.id,
          probe: 'zendesk.users.me',
        },
      };
    }
    case 'clevertap': {
      const baseUrl = normalizeBaseUrl(credentials.baseUrl);
      const response = await fetchWithTimeout(`${baseUrl}/1/profile.json?identity=integration_probe_clevertap_identity`, {
        headers: {
          'X-CleverTap-Account-Id': credentials.accountId,
          'X-CleverTap-Passcode': credentials.passcode,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      const bodyText = JSON.stringify(body || {}).toLowerCase();
      const looksLikeValidAuthWithoutProfile =
        response.status === 404 ||
        (response.ok && (bodyText.includes('record not found') || bodyText.includes('profile not found') || bodyText.includes('does not exist')));

      if (!response.ok && !looksLikeValidAuthWithoutProfile) {
        return {
          valid: false,
          error: body?.error || body?.message || 'CleverTap authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: credentials.accountId,
        details: {
          base_url: baseUrl,
          probe: 'profile.get',
        },
      };
    }
    case 'moengage': {
      const baseUrl = normalizeBaseUrl(credentials.baseUrl);
      const response = await fetchWithTimeout(`${baseUrl}/v1.2/cards?count=1`, {
        headers: {
          'X-Project-Id': credentials.workspaceId,
          Authorization: `Basic ${Buffer.from(`${credentials.apiKey}:`).toString('base64')}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok) {
        return {
          valid: false,
          error: body?.message || body?.title || body?.error || 'MoEngage authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: credentials.workspaceId,
        details: {
          base_url: baseUrl,
          probe: 'cards.list',
        },
      };
    }
    case 'webengage': {
      const baseUrl = normalizeBaseUrl(credentials.baseUrl);
      const response = await fetchWithTimeout(`${baseUrl}/v1/accounts/${credentials.licenseCode}/users`, {
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      const looksLikeValidAuthWithoutUsers =
        response.status === 404 ||
        (response.ok && (Array.isArray(body?.data) || Array.isArray(body?.users) || body?.meta));

      if (!response.ok && !looksLikeValidAuthWithoutUsers) {
        return {
          valid: false,
          error: body?.message || body?.error || 'WebEngage authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: credentials.licenseCode,
        details: {
          base_url: baseUrl,
          license_code: credentials.licenseCode,
          probe: 'users.list',
        },
      };
    }
    case 'netcore-cloud': {
      const baseUrl = credentials.baseUrl?.trim()
        ? normalizeBaseUrl(credentials.baseUrl)
        : 'https://emailapi.netcorecloud.net';
      const response = await fetchWithTimeout(`${baseUrl}/v5/mail/send`, {
        method: 'POST',
        headers: {
          api_key: credentials.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({}),
      });

      const body = await response.json().catch(() => null) as any;
      const bodyText = JSON.stringify(body || {}).toLowerCase();
      const looksLikeValidAuthWithPayloadError =
        response.status !== 401 &&
        response.status !== 403 &&
        !bodyText.includes('invalid api key') &&
        !bodyText.includes('unauthorized') &&
        !bodyText.includes('authentication');

      if (!response.ok && !looksLikeValidAuthWithPayloadError) {
        return {
          valid: false,
          error: body?.message || body?.error || 'Netcore Cloud authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: 'Netcore Cloud',
        details: {
          base_url: baseUrl,
          probe: 'mail.send',
        },
      };
    }
    case 'gupshup': {
      const response = await fetchWithTimeout(`https://api.gupshup.io/wa/app/${credentials.appId}/group/nonexistent-group/invite_link`, {
        method: 'POST',
        headers: {
          apikey: credentials.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
        }),
      });

      const body = await response.json().catch(() => null) as any;
      if (response.status === 400 || response.status === 404) {
        return {
          valid: true,
          accountLabel: credentials.appId,
          details: {
            app_id: credentials.appId,
            probe: 'group.invite_link',
          },
        };
      }

      if (!response.ok) {
        return {
          valid: false,
          error: body?.message || body?.error?.message || 'Gupshup authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: credentials.appId,
        details: {
          app_id: credentials.appId,
          probe: 'group.invite_link',
        },
      };
    }
    case 'msg91': {
      const response = await fetchWithTimeout('https://control.msg91.com/api/v5/widget/verifyAccessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          authkey: credentials.authKey,
          'access-token': 'integration_probe_invalid_token',
        }).toString(),
      });

      const body = await response.json().catch(() => null) as any;
      const bodyText = JSON.stringify(body || {}).toLowerCase();

      if (!response.ok) {
        const looksLikeValidAuthWithInvalidToken = bodyText.includes('invalid') && bodyText.includes('token') && !bodyText.includes('auth');
        if (looksLikeValidAuthWithInvalidToken) {
          return {
            valid: true,
            accountLabel: credentials.senderId || 'MSG91 sender',
            details: {
              sender_id: credentials.senderId || null,
              probe: 'widget.verifyAccessToken',
            },
          };
        }

        return {
          valid: false,
          error: body?.message || body?.type || 'MSG91 authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: credentials.senderId || 'MSG91 sender',
        details: {
          sender_id: credentials.senderId || null,
          probe: 'widget.verifyAccessToken',
        },
      };
    }
    case 'suprsend': {
      const response = await fetchWithTimeout('https://hub.suprsend.com/heartbeat', {
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok) {
        return {
          valid: false,
          error: body?.message || body?.error || 'SuprSend authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: 'SuprSend workspace',
        details: {
          probe: 'heartbeat',
        },
      };
    }
    case 'shiprocket': {
      const response = await fetchWithTimeout('https://apiv2.shiprocket.in/v1/external/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
        }),
      });

      const body = await response.json().catch(() => null) as any;
      if (!response.ok || !body?.token) {
        return {
          valid: false,
          error: body?.message || body?.errors?.email?.[0] || 'Shiprocket authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: credentials.email,
        details: { token_expires_in_hours: 240, probe: 'auth.login' },
      };
    }
    case 'unicommerce': {
      const baseUrl = credentials.baseUrl.trim().replace(/\/+$/, '');
      const facilityCode = encodeURIComponent(credentials.facilityCode.trim());
      const response = await fetchWithTimeout(`${baseUrl}/services/soap/?version=1.6&facility=${facilityCode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8',
          Accept: 'text/xml',
        },
        body: buildUnicommerceSoapEnvelope(credentials.username, credentials.password),
      }, 15000);

      const bodyText = await response.text();
      const lowerBody = bodyText.toLowerCase();
      const looksLikeAuthFailure =
        lowerBody.includes('authentication failed') ||
        lowerBody.includes('invalid username') ||
        lowerBody.includes('invalid password') ||
        lowerBody.includes('access denied') ||
        lowerBody.includes('not authorized');

      if (!response.ok || looksLikeAuthFailure) {
        return {
          valid: false,
          error: 'Unicommerce authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: credentials.baseUrl,
        details: {
          facility_code: credentials.facilityCode,
          probe: 'soap.getItemDetails',
        },
      };
    }
    case 'delhivery': {
      const apiToken = credentials.apiToken?.trim();
      const environment = credentials.environment?.trim().toLowerCase();

      if (!apiToken || !environment) {
        return {
          valid: false,
          error: 'Delhivery API token and environment are required',
        };
      }

      const response = await fetchWithTimeout(`${resolveDelhiveryBaseUrl(credentials)}/api/backend/clientwarehouse/create/`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const body = await response.json().catch(() => null) as any;
      const bodyText = JSON.stringify(body || {}).toLowerCase();
      const looksLikeValidAuthWithPayloadError =
        response.status !== 401 &&
        response.status !== 403 &&
        !bodyText.includes('unauthorized') &&
        !bodyText.includes('invalid token') &&
        !bodyText.includes('authentication');

      if (!response.ok && !looksLikeValidAuthWithPayloadError) {
        return {
          valid: false,
          error: body?.detail || body?.message || 'Delhivery authentication failed',
        };
      }

      return {
        valid: true,
        accountLabel: `Delhivery ${environment}`,
        details: {
          environment,
          probe: 'clientwarehouse.create',
        },
      };
    }
    case 'stripe': {
      const secretKey = credentials.secretKey?.trim();
      const response = await fetchWithTimeout('https://api.stripe.com/v1/account', {
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: 'application/json',
        },
      });
      const body = await response.json() as any;
      if (!response.ok || !body?.id) {
        return { valid: false, error: body?.error?.message || 'Stripe authentication failed' };
      }
      return {
        valid: true,
        accountLabel: body.business_profile?.name || body.email || 'Stripe account',
        details: { account_id: body.id },
      };
    }
    case 'paypal': {
      const environment = (credentials.environment || 'sandbox').toLowerCase();
      const baseUrl = environment === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
      const auth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
      const response = await fetchWithTimeout(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      const body = await response.json() as any;
      if (!response.ok || !body?.access_token) {
        return { valid: false, error: body?.error_description || 'PayPal authentication failed' };
      }
      return {
        valid: true,
        accountLabel: `PayPal (${environment})`,
        details: { scope: body.scope || '' },
      };
    }
    case 'razorpay': {
      const auth = Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString('base64');
      const response = await fetchWithTimeout('https://api.razorpay.com/v1/items?count=1', {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });
      const body = await response.json() as any;
      if (!response.ok) {
        return { valid: false, error: body?.error?.description || 'Razorpay authentication failed' };
      }
      return {
        valid: true,
        accountLabel: 'Razorpay account',
        details: { test_call: 'items.list' },
      };
    }
    case 'sendgrid': {
      const response = await fetchWithTimeout('https://api.sendgrid.com/v3/user/account', {
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          Accept: 'application/json',
        },
      });
      const body = await response.json() as any;
      if (!response.ok || !body?.username) {
        return { valid: false, error: body?.errors?.[0]?.message || 'SendGrid authentication failed' };
      }
      return {
        valid: true,
        accountLabel: body.username,
        details: { type: body.type || null },
      };
    }
    case 'mailgun': {
      const domain = credentials.domain?.trim();
      const auth = Buffer.from(`api:${credentials.apiKey}`).toString('base64');
      const response = await fetchWithTimeout(`https://api.mailgun.net/v3/${domain}`, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });
      const body = await response.json() as any;
      if (!response.ok) {
        return { valid: false, error: body?.message || 'Mailgun authentication failed' };
      }
      return {
        valid: true,
        accountLabel: domain,
        details: { region: body?.region || null },
      };
    }
    case 'amazon-ses': {
      return {
        valid: true,
        accountLabel: `SES (${credentials.region})`,
        details: { validation_mode: 'credentials_only' },
      };
    }
    default:
      return {
        valid: true,
        accountLabel: provider,
        details: { validation_mode: 'credentials_only' },
      };
  }
}

// ==================== PLATFORM INTEGRATIONS ====================

// GET /api/connectors/integrations - List all platform integrations
router.get('/integrations', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const orgId = req.user?.organization_id;
    if (!orgId) {
      return res.json({ success: true, data: [], requestId: req.requestId });
    }

    const { data, error } = await supabaseAdmin
      .from('integration_connections')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) {
      // Table may not exist yet - return empty array gracefully
      logger.warn('integration_connections table may not exist', { error: error.message });
      return res.json({ success: true, data: [], requestId: req.requestId });
    }

    const sanitized = (data || []).map((item: any) => ({
      ...item,
      // hide the actual token on standard frontend pulls
      api_key: item.api_key ? '***' : null,
      access_token: item.access_token ? '***' : null,
      refresh_token: item.refresh_token ? '***' : null,
    }));

    res.json({ success: true, data: sanitized, requestId: req.requestId });
  } catch (err) {
    logger.error('Error fetching platform integrations', { error: err, requestId: req.requestId });
    res.json({ success: true, data: [], requestId: req.requestId });
  }
});

router.post('/integrations/api-key', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized', requestId: req.requestId });
    }

    const orgId = req.user?.organization_id;
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found', requestId: req.requestId });
    }

    const { providerId, providerName, credentials } = req.body;

    // Attempt real validation first 
    // In production we would only trust real validation. For demo, we just proceed if it passes or even without real logic.
    // We already have `validateProviderConnection`.
    const validateRes = await validateProviderConnection(providerId || providerName.toLowerCase(), credentials);
    if (!validateRes.valid) {
      return res.status(400).json({
        success: false,
        error: validateRes.error || 'Failed to validate API credentials',
        requestId: req.requestId,
      });
    }

    // Now call the database function to securely store it
    const apiKey = credentials.apiKey || credentials.api_key || credentials.token || Object.values(credentials)[0];

    const { data: dbData, error: dbError } = await supabaseAdmin.rpc('create_api_key_integration', {
      p_organization_id: orgId,
      p_provider_name: providerId || providerName.toLowerCase(),
      p_api_key: apiKey,
      p_webhook_secret: credentials.webhookSecret || credentials.webhook_secret || null,
      p_connection_metadata: credentials
    });

    if (dbError) {
      logger.error('Error saving api key integration in db', { error: dbError, requestId: req.requestId });
      return res.status(500).json({ success: false, error: 'Failed to save integration into database', requestId: req.requestId });
    }

    return res.json({
      success: true,
      data: {
        id: dbData, // Returns the ID natively
        provider: providerId || providerName.toLowerCase(),
        status: 'connected',
      },
      requestId: req.requestId,
    });
  } catch (err: any) {
    logger.error('Error saving API key integration', {
      error: err?.message || err,
      requestId: req.requestId,
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to create integration connection',
      requestId: req.requestId,
    });
  }
});

// POST /api/connectors/integrations/oauth/init - Start standard OAuth flow
router.post('/integrations/oauth/init', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const orgId = req.user?.organization_id;
    if (!orgId) {
      return res.status(400).json({ error: 'Organization not found', requestId: req.requestId });
    }

    const { provider } = req.body;
    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'Provider specifies required', requestId: req.requestId });
    }

    const stateId = crypto.randomUUID();
    const redirectUri = `${process.env.API_URL || 'http://localhost:3001'}/api/connectors/integrations/oauth/callback`;

    // Persist intent before redirecting
    const { error: stateError } = await supabaseAdmin.from('integration_oauth_states').insert({
      state: stateId,
      organization_id: orgId,
      user_id: userId,
      provider_name: provider.toLowerCase(),
      redirect_uri: redirectUri,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    if (stateError) {
      logger.error('Failed to create OAuth state intent', { error: stateError, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to establish OAuth intent secure state', requestId: req.requestId });
    }

    // Build auth url based on requested provider
    let authUrl = '';
    const stateParam = encodeURIComponent(stateId);
    if (provider === 'google-workspace') {
      const clientId = process.env.GOOGLE_CLIENT_ID || 'demo-google-client-id';
      const scopes = 'https://www.googleapis.com/auth/admin.directory.user.readonly';
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${stateParam}&access_type=offline&prompt=consent`;
    } else if (provider === 'microsoft-teams' || provider === 'microsoft-entra') {
      const clientId = process.env.MICROSOFT_CLIENT_ID || 'demo-microsoft-client-id';
      const scopes = 'User.Read offline_access';
      authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${encodeURIComponent(scopes)}&state=${stateParam}`;
    } else if (provider === 'linkedin') {
      const clientId = process.env.LINKEDIN_CLIENT_ID || 'demo-linkedin-client-id';
      const scopes = 'openid profile email';
      authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${stateParam}`;
    } else if (provider === 'deel' || provider === 'gusto' || provider === 'zoho-books') {
      return res.json({ success: true, data: { url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/apps?status=error&message=ProviderNotAutomatedInDemo` } });
    } else {
      return res.status(400).json({ success: false, error: 'Unsupported OAuth provider', requestId: req.requestId });
    }

    return res.json({ success: true, data: { url: authUrl } });
  } catch (err) {
    logger.error('Error initiating OAuth', { error: err, requestId: req.requestId });
    return res.status(500).json({ success: false, error: 'Internal Server Error during OAuth Init' });
  }
});

// GET /api/connectors/integrations/oauth/callback - Universal local callback
router.get('/integrations/oauth/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (oauthError) {
      return res.redirect(`${frontendUrl}/dashboard/apps?status=error&message=${encodeURIComponent(String(oauthError))}`);
    }

    if (!code || !state) {
      return res.redirect(`${frontendUrl}/dashboard/apps?status=error&message=MissingCodeOrState`);
    }

    // Attempt to verify the state
    const { data: stateRow, error: verifyError } = await supabaseAdmin
      .from('integration_oauth_states')
      .select('*')
      .eq('state', state)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (verifyError || !stateRow) {
      return res.redirect(`${frontendUrl}/dashboard/apps?status=error&message=InvalidOrExpiredOAuthState`);
    }

    // In a real application, you exchange the code here depending on the provider.
    let finalAccessToken = 'mock_demo_access_token_' + code;
    let finalRefreshToken = 'mock_demo_refresh_token_' + code;
    let externalAccountId = `external_team_${Math.floor(Math.random() * 1000)}`;
    let tokenMetadata: any = { installed_via: 'standard_oauth_router' };

    if (stateRow.provider_name === 'google-workspace') {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: process.env.GOOGLE_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
          redirect_uri: stateRow.redirect_uri,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData: any = await tokenResponse.json();
      if (!tokenResponse.ok) {
        logger.error('Google token exchange failed', { error: tokenData, requestId: req.requestId });
        return res.redirect(`${frontendUrl}/dashboard/apps?status=error&message=TokenExchangeFailed`);
      }

      finalAccessToken = tokenData.access_token;
      finalRefreshToken = tokenData.refresh_token || null;
      tokenMetadata = { ...tokenMetadata, expires_in: tokenData.expires_in, scope: tokenData.scope, token_type: tokenData.token_type };

      externalAccountId = 'google_workspace_verified';
    } else if (stateRow.provider_name === 'microsoft-teams' || stateRow.provider_name === 'microsoft-entra') {
      const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: process.env.MICROSOFT_CLIENT_ID || '',
          client_secret: process.env.MICROSOFT_CLIENT_SECRET || '',
          redirect_uri: stateRow.redirect_uri,
          grant_type: 'authorization_code',
          scope: 'User.Read offline_access',
        }),
      });

      const tokenData: any = await tokenResponse.json();
      if (!tokenResponse.ok) {
        logger.error('Microsoft token exchange failed', { error: tokenData, requestId: req.requestId });
        return res.redirect(`${frontendUrl}/dashboard/apps?status=error&message=TokenExchangeFailed`);
      }

      finalAccessToken = tokenData.access_token;
      finalRefreshToken = tokenData.refresh_token || null;
      tokenMetadata = { ...tokenMetadata, expires_in: tokenData.expires_in, scope: tokenData.scope, token_type: tokenData.token_type };
      externalAccountId = 'microsoft_365_verified';
    } else if (stateRow.provider_name === 'linkedin') {
      const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: process.env.LINKEDIN_CLIENT_ID || '',
          client_secret: process.env.LINKEDIN_CLIENT_SECRET || '',
          redirect_uri: stateRow.redirect_uri,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData: any = await tokenResponse.json();
      if (!tokenResponse.ok) {
        logger.error('LinkedIn token exchange failed', { error: tokenData, requestId: req.requestId });
        return res.redirect(`${frontendUrl}/dashboard/apps?status=error&message=TokenExchangeFailed`);
      }

      finalAccessToken = tokenData.access_token;
      finalRefreshToken = tokenData.refresh_token || null;
      tokenMetadata = { ...tokenMetadata, expires_in: tokenData.expires_in, scope: tokenData.scope };
      externalAccountId = 'linkedin_verified';
    }

    // Using the same RPC that the other integrations use:
    const { error: upsertError } = await supabaseAdmin.rpc('upsert_oauth_integration_service', {
      p_organization_id: stateRow.organization_id,
      p_provider_name: stateRow.provider_name,
      p_access_token: finalAccessToken,
      p_refresh_token: finalRefreshToken,
      p_webhook_secret: null,
      p_external_account_id: externalAccountId,
      p_connection_metadata: tokenMetadata
    });

    if (upsertError) {
      logger.error('Failed to securely store remote OAuth tokens', { error: upsertError, requestId: req.requestId });
      return res.redirect(`${frontendUrl}/dashboard/apps?status=error&message=FailedToStoreSecureTokens`);
    }

    // Mark the state as consumed
    await supabaseAdmin
      .from('integration_oauth_states')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', stateRow.id);

    return res.redirect(`${frontendUrl}/dashboard/apps?status=connected&provider=${stateRow.provider_name}`);
  } catch (err) {
    logger.error('Error handling OAuth callback', { error: err, requestId: req.requestId });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/dashboard/apps?status=error&message=InternalCallbackError`);
  }
});

router.post('/integrations/validate', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized', requestId: req.requestId });
    }

    const { provider, credentials } = req.body || {};
    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ success: false, error: 'Provider is required', requestId: req.requestId });
    }

    if (!credentials || typeof credentials !== 'object') {
      return res.status(400).json({ success: false, error: 'Credentials are required', requestId: req.requestId });
    }

    const result = await validateProviderConnection(provider, credentials);
    if (!result.valid) {
      return res.status(400).json({
        success: false,
        error: result.error || `Failed to validate ${provider} credentials`,
        requestId: req.requestId,
      });
    }

    return res.json({
      success: true,
      data: {
        provider,
        accountLabel: result.accountLabel || null,
        details: result.details || {},
      },
      requestId: req.requestId,
    });
  } catch (err: any) {
    logger.error('Error validating integration credentials', {
      error: err?.message || err,
      requestId: req.requestId,
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to validate integration credentials',
      requestId: req.requestId,
    });
  }
});

router.post('/integrations/:id/test', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized', requestId: req.requestId });
    }

    const orgId = req.user?.organization_id;
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found', requestId: req.requestId });
    }

    const { id } = req.params;
    const { data: integration, error: fetchError } = await supabaseAdmin
      .from('platform_integrations')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single();

    if (fetchError || !integration) {
      return res.status(404).json({
        success: false,
        error: 'Integration not found',
        requestId: req.requestId,
      });
    }

    const provider = integration.config?.catalogId || integration.config?.provider || integration.icon;
    const credentials = integration.config?.credentials;

    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Integration provider is missing',
        requestId: req.requestId,
      });
    }

    if (!credentials || typeof credentials !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'No saved credentials found for this integration',
        requestId: req.requestId,
      });
    }

    const result = await validateProviderConnection(provider, credentials);
    const testedAt = new Date().toISOString();
    const nextStatus = result.valid ? 'connected' : 'error';
    const mergedConfig = {
      ...(integration.config || {}),
      lastTestedAt: testedAt,
      lastTestResult: result.valid ? 'passed' : 'failed',
      lastTestError: result.valid ? null : (result.error || 'Connection test failed'),
      lastTestDetails: result.details || {},
      lastValidatedAccountLabel: result.accountLabel || null,
      lastSuccessfulValidationAt: result.valid ? testedAt : (integration.config?.lastSuccessfulValidationAt || null),
      lastFailedValidationAt: result.valid ? (integration.config?.lastFailedValidationAt || null) : testedAt,
    };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('platform_integrations')
      .update({
        status: nextStatus,
        requests: (integration.requests || 0) + 1,
        errors: (integration.errors || 0) + (result.valid ? 0 : 1),
        config: mergedConfig,
      })
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (updateError) {
      logger.error('Failed to update integration test status', { error: updateError, integrationId: id, requestId: req.requestId });
      return res.status(500).json({
        success: false,
        error: updateError.message || 'Failed to update integration test status',
        requestId: req.requestId,
      });
    }

    if (!result.valid) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Connection test failed',
        data: {
          id: updated.id,
          status: updated.status,
          provider,
          accountLabel: result.accountLabel || null,
          details: result.details || {},
        },
        requestId: req.requestId,
      });
    }

    return res.json({
      success: true,
      data: {
        id: updated.id,
        status: updated.status,
        provider,
        accountLabel: result.accountLabel || null,
        details: result.details || {},
      },
      requestId: req.requestId,
    });
  } catch (err: any) {
    logger.error('Error testing integration connection', {
      error: err?.message || err,
      requestId: req.requestId,
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to test integration connection',
      requestId: req.requestId,
    });
  }
});

router.post('/integrations/:id/action-test', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized', requestId: req.requestId });
    }

    const orgId = req.user?.organization_id;
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found', requestId: req.requestId });
    }

    const { id } = req.params;
    const { data: integration, error: fetchError } = await supabaseAdmin
      .from('platform_integrations')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single();

    if (fetchError || !integration) {
      return res.status(404).json({ success: false, error: 'Integration not found', requestId: req.requestId });
    }

    const provider = integration.config?.catalogId || integration.config?.provider || integration.icon;
    const credentials = integration.config?.credentials || {};
    const setup = integration.config?.setup || {};

    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ success: false, error: 'Integration provider is missing', requestId: req.requestId });
    }

    const actionResult = await runProviderActionTest(provider, credentials, setup);
    const testedAt = new Date().toISOString();
    const nextStatus = actionResult.ok ? integration.status || 'connected' : 'error';
    const nextConfig = {
      ...(integration.config || {}),
      configuredTargetLabel: actionResult.targetLabel || getProviderTargetLabel(provider, setup),
      lastActionTestedAt: testedAt,
      lastActionResult: actionResult.ok ? 'passed' : 'failed',
      lastActionError: actionResult.ok ? null : (actionResult.error || 'Provider action test failed'),
      lastActionType: actionResult.actionType,
      lastActionDetails: actionResult.details || {},
      lastSuccessfulActionAt: actionResult.ok ? testedAt : (integration.config?.lastSuccessfulActionAt || null),
      lastFailedActionAt: actionResult.ok ? (integration.config?.lastFailedActionAt || null) : testedAt,
    };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('platform_integrations')
      .update({
        status: nextStatus,
        requests: (integration.requests || 0) + 1,
        errors: (integration.errors || 0) + (actionResult.ok ? 0 : 1),
        config: nextConfig,
      })
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (updateError) {
      logger.error('Failed to update integration action-test status', { error: updateError, integrationId: id, requestId: req.requestId });
      return res.status(500).json({ success: false, error: updateError.message || 'Failed to save integration action test', requestId: req.requestId });
    }

    if (!actionResult.ok) {
      return res.status(400).json({
        success: false,
        error: actionResult.error || 'Provider action test failed',
        data: {
          id: updated.id,
          status: updated.status,
          provider,
          actionType: actionResult.actionType,
          targetLabel: actionResult.targetLabel || null,
          details: actionResult.details || {},
        },
        requestId: req.requestId,
      });
    }

    return res.json({
      success: true,
      data: {
        id: updated.id,
        status: updated.status,
        provider,
        actionType: actionResult.actionType,
        targetLabel: actionResult.targetLabel || null,
        details: actionResult.details || {},
      },
      requestId: req.requestId,
    });
  } catch (err: any) {
    logger.error('Error running integration action test', {
      error: err?.message || err,
      requestId: req.requestId,
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to run integration action test',
      requestId: req.requestId,
    });
  }
});

// POST /api/connectors/spec-integrations/:service/action-test — Run action test for spec-driven integrations
// (reads credentials from integration_credentials table, not platform_integrations.config)
router.post('/spec-integrations/:service/action-test', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found', requestId: req.requestId });

    const service = req.params.service;

    // Look up the integration in the spec-driven integrations table
    const { data: integration, error: fetchError } = await supabaseAdmin
      .from('integrations')
      .select('id, service_type, status')
      .eq('organization_id', orgId)
      .eq('service_type', service)
      .single();

    if (fetchError || !integration) {
      return res.status(404).json({ success: false, error: 'Integration not found. Connect it first.', requestId: req.requestId });
    }

    // Fetch all credentials for this integration
    const { data: credRows } = await supabaseAdmin
      .from('integration_credentials')
      .select('key, value, is_sensitive')
      .eq('integration_id', integration.id);

    if (!credRows || credRows.length === 0) {
      return res.status(400).json({ success: false, error: 'No credentials stored for this integration.', requestId: req.requestId });
    }

    // Build credentials map, decrypting sensitive values
    const credentials: Record<string, string> = {};
    for (const row of credRows) {
      try {
        credentials[row.key] = row.is_sensitive ? decryptSecret(row.value) : row.value;
      } catch {
        credentials[row.key] = row.value;
      }
    }

    // Map common credential keys to the format runProviderActionTest expects
    if (credentials.access_token && !credentials.accessToken) {
      credentials.accessToken = credentials.access_token;
    }

    const actionResult = await runProviderActionTest(service, credentials, {});
    const testedAt = new Date().toISOString();

    // Update integration status based on result
    await supabaseAdmin
      .from('integrations')
      .update({
        status: actionResult.ok ? 'connected' : 'error',
        last_sync_at: actionResult.ok ? testedAt : undefined,
        last_error_at: actionResult.ok ? undefined : testedAt,
        last_error_msg: actionResult.ok ? null : (actionResult.error || 'Action test failed'),
        updated_at: testedAt,
      })
      .eq('id', integration.id);

    if (!actionResult.ok) {
      return res.status(400).json({
        success: false,
        error: actionResult.error || 'Action test failed',
        data: { service, actionType: actionResult.actionType, details: actionResult.details },
        requestId: req.requestId,
      });
    }

    return res.json({
      success: true,
      data: {
        service,
        actionType: actionResult.actionType,
        targetLabel: actionResult.targetLabel,
        details: actionResult.details,
        testedAt,
      },
      requestId: req.requestId,
    });
  } catch (err: any) {
    logger.error('Error running spec-integration action test', { error: err?.message || err, requestId: req.requestId });
    return res.status(500).json({ success: false, error: 'Failed to run action test', requestId: req.requestId });
  }
});

// POST /api/connectors/integrations - Create platform integration (requires permissions)
router.post('/integrations', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const orgId = req.user?.organization_id;
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found', requestId: req.requestId });
    }

    const { name, status, icon, config } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required', requestId: req.requestId });
    }

    const provider = config?.catalogId || config?.provider || icon;
    if (provider && config?.credentials) {
      const validation = await validateProviderConnection(provider, config.credentials);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error || `Failed to validate ${provider} credentials`,
          requestId: req.requestId,
        });
      }

      const testedAt = new Date().toISOString();
      config.lastTestedAt = testedAt;
      config.lastTestResult = 'passed';
      config.lastTestError = null;
      config.lastTestDetails = validation.details || {};
      config.lastValidatedAccountLabel = validation.accountLabel || null;
      config.lastSuccessfulValidationAt = testedAt;
      config.lastFailedValidationAt = config.lastFailedValidationAt || null;
    }

    const { data, error } = await supabaseAdmin
      .from('platform_integrations')
      .insert({
        organization_id: orgId,
        name,
        status: status || 'disconnected',
        icon: icon || '🔌',
        requests: provider && config?.credentials ? 1 : 0,
        errors: 0,
        config: config || {}
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create platform integration', { error, requestId: req.requestId });
      return res.status(500).json({ success: false, error: error.message || 'Failed to create integration', requestId: req.requestId });
    }

    logger.info('Platform integration created', { integrationId: data.id, requestId: req.requestId });
    res.status(201).json({ success: true, data, requestId: req.requestId });
  } catch (err) {
    logger.error('Error creating platform integration', { error: err, requestId: req.requestId });
    res.status(500).json({ success: false, error: 'Internal server error', requestId: req.requestId });
  }
});

// PATCH /api/connectors/integrations/:id - Update platform integration (requires permissions)
router.patch('/integrations/:id', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const { id } = req.params;
    const updates = { ...(req.body || {}) };

    const orgId = req.user?.organization_id;
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found', requestId: req.requestId });
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('platform_integrations')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single();

    if (existingError || !existing) {
      return res.status(404).json({ success: false, error: 'Integration not found', requestId: req.requestId });
    }

    if (updates.config && typeof updates.config === 'object') {
      updates.config = {
        ...(existing.config || {}),
        ...updates.config,
      };
    }

    const { data, error } = await supabaseAdmin
      .from('platform_integrations')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update platform integration', { error, integrationId: id, requestId: req.requestId });
      return res.status(500).json({ success: false, error: error.message || 'Failed to update integration', requestId: req.requestId });
    }

    if (!data) {
      return res.status(404).json({ success: false, error: 'Integration not found', requestId: req.requestId });
    }

    logger.info('Platform integration updated', { integrationId: id, requestId: req.requestId });
    res.json({ success: true, data, requestId: req.requestId });
  } catch (err) {
    logger.error('Error updating platform integration', { error: err, requestId: req.requestId });
    res.status(500).json({ success: false, error: 'Internal server error', requestId: req.requestId });
  }
});

// DELETE /api/connectors/integrations/:id - Delete platform integration (requires permissions)
router.delete('/integrations/:id', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const { id } = req.params;

    const orgId = req.user?.organization_id;
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found', requestId: req.requestId });
    }

    const { error } = await supabaseAdmin
      .from('platform_integrations')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);

    if (error) {
      logger.error('Failed to delete platform integration', { error, integrationId: id, requestId: req.requestId });
      return res.status(500).json({ success: false, error: error.message || 'Failed to delete integration', requestId: req.requestId });
    }

    logger.info('Platform integration deleted', { integrationId: id, requestId: req.requestId });
    res.json({ success: true, requestId: req.requestId });
  } catch (err) {
    logger.error('Error deleting platform integration', { error: err, requestId: req.requestId });
    res.status(500).json({ success: false, error: 'Internal server error', requestId: req.requestId });
  }
});

// ==================== PROXY ENDPOINTS ====================

// GET /api/connectors/endpoints - List all proxy endpoints
router.get('/endpoints', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const orgId = req.user?.organization_id;
    if (!orgId) {
      return res.json({ success: true, data: [], requestId: req.requestId });
    }

    const { data, error } = await supabase
      .from('proxy_endpoints')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) {
      // Table may not exist yet - return empty array gracefully
      logger.warn('proxy_endpoints table may not exist', { error: error.message });
      return res.json({ success: true, data: [], requestId: req.requestId });
    }

    res.json({ success: true, data: data || [], requestId: req.requestId });
  } catch (err) {
    logger.error('Error fetching proxy endpoints', { error: err, requestId: req.requestId });
    res.json({ success: true, data: [], requestId: req.requestId });
  }
});

// POST /api/connectors/endpoints - Create proxy endpoint (requires permissions)
router.post('/endpoints', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    // Get user's organization
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      logger.error('Failed to fetch user organization', { error: userError, userId, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to fetch user organization', requestId: req.requestId });
    }

    const { path, method, description, config } = req.body;

    if (!path || !method) {
      return res.status(400).json({ error: 'Path and method are required', requestId: req.requestId });
    }

    const { data, error } = await supabase
      .from('proxy_endpoints')
      .insert({
        organization_id: userData.organization_id,
        path,
        method,
        requests: 0,
        latency: '0ms',
        status: 'active',
        description,
        config: config || {}
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create proxy endpoint', { error, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to create endpoint', requestId: req.requestId });
    }

    logger.info('Proxy endpoint created', { endpointId: data.id, requestId: req.requestId });
    res.status(201).json({ success: true, data, requestId: req.requestId });
  } catch (err) {
    logger.error('Error creating proxy endpoint', { error: err, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
  }
});

// PATCH /api/connectors/endpoints/:id - Update proxy endpoint (requires permissions)
router.patch('/endpoints/:id', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const { id } = req.params;
    const updates = req.body;

    // Get user's organization
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      logger.error('Failed to fetch user organization', { error: userError, userId, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to fetch user organization', requestId: req.requestId });
    }

    const { data, error } = await supabase
      .from('proxy_endpoints')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', userData.organization_id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update proxy endpoint', { error, endpointId: id, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to update endpoint', requestId: req.requestId });
    }

    if (!data) {
      return res.status(404).json({ error: 'Endpoint not found', requestId: req.requestId });
    }

    logger.info('Proxy endpoint updated', { endpointId: id, requestId: req.requestId });
    res.json({ success: true, data, requestId: req.requestId });
  } catch (err) {
    logger.error('Error updating proxy endpoint', { error: err, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
  }
});

// DELETE /api/connectors/endpoints/:id - Delete proxy endpoint (requires permissions)
router.delete('/endpoints/:id', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const { id } = req.params;

    // Get user's organization
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      logger.error('Failed to fetch user organization', { error: userError, userId, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to fetch user organization', requestId: req.requestId });
    }

    const { error } = await supabase
      .from('proxy_endpoints')
      .delete()
      .eq('id', id)
      .eq('organization_id', userData.organization_id);

    if (error) {
      logger.error('Failed to delete proxy endpoint', { error, endpointId: id, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to delete endpoint', requestId: req.requestId });
    }

    logger.info('Proxy endpoint deleted', { endpointId: id, requestId: req.requestId });
    res.json({ success: true, requestId: req.requestId });
  } catch (err) {
    logger.error('Error deleting proxy endpoint', { error: err, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
  }
});

// ==================== LOG SCRAPER CONFIGS ====================

// GET /api/connectors/scrapers - List all log scraper configs
router.get('/scrapers', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const orgId = req.user?.organization_id;
    if (!orgId) {
      return res.json({ success: true, data: [], requestId: req.requestId });
    }

    const { data, error } = await supabase
      .from('log_scraper_configs')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) {
      // Table may not exist yet - return empty array gracefully
      logger.warn('log_scraper_configs table may not exist', { error: error.message });
      return res.json({ success: true, data: [], requestId: req.requestId });
    }

    res.json({ success: true, data: data || [], requestId: req.requestId });
  } catch (err) {
    logger.error('Error fetching log scraper configs', { error: err, requestId: req.requestId });
    res.json({ success: true, data: [], requestId: req.requestId });
  }
});

// POST /api/connectors/scrapers - Create log scraper config (requires permissions)
router.post('/scrapers', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    // Get user's organization
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      logger.error('Failed to fetch user organization', { error: userError, userId, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to fetch user organization', requestId: req.requestId });
    }

    const { source, config } = req.body;

    if (!source) {
      return res.status(400).json({ error: 'Source is required', requestId: req.requestId });
    }

    const { data, error } = await supabase
      .from('log_scraper_configs')
      .insert({
        organization_id: userData.organization_id,
        source,
        last_sync: new Date().toISOString(),
        messages: 0,
        status: 'idle',
        config: config || {}
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create log scraper config', { error, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to create scraper', requestId: req.requestId });
    }

    logger.info('Log scraper config created', { scraperId: data.id, requestId: req.requestId });
    res.status(201).json({ success: true, data, requestId: req.requestId });
  } catch (err) {
    logger.error('Error creating log scraper config', { error: err, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
  }
});

// PATCH /api/connectors/scrapers/:id - Update log scraper config (requires permissions)
router.patch('/scrapers/:id', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const { id } = req.params;
    const updates = req.body;

    // Get user's organization
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      logger.error('Failed to fetch user organization', { error: userError, userId, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to fetch user organization', requestId: req.requestId });
    }

    const { data, error } = await supabase
      .from('log_scraper_configs')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', userData.organization_id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update log scraper config', { error, scraperId: id, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to update scraper', requestId: req.requestId });
    }

    if (!data) {
      return res.status(404).json({ error: 'Scraper not found', requestId: req.requestId });
    }

    logger.info('Log scraper config updated', { scraperId: id, requestId: req.requestId });
    res.json({ success: true, data, requestId: req.requestId });
  } catch (err) {
    logger.error('Error updating log scraper config', { error: err, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
  }
});

// DELETE /api/connectors/scrapers/:id - Delete log scraper config (requires permissions)
router.delete('/scrapers/:id', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const { id } = req.params;

    // Get user's organization
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      logger.error('Failed to fetch user organization', { error: userError, userId, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to fetch user organization', requestId: req.requestId });
    }

    const { error } = await supabase
      .from('log_scraper_configs')
      .delete()
      .eq('id', id)
      .eq('organization_id', userData.organization_id);

    if (error) {
      logger.error('Failed to delete log scraper config', { error, scraperId: id, requestId: req.requestId });
      return res.status(500).json({ error: 'Failed to delete scraper', requestId: req.requestId });
    }

    logger.info('Log scraper config deleted', { scraperId: id, requestId: req.requestId });
    res.json({ success: true, requestId: req.requestId });
  } catch (err) {
    logger.error('Error deleting log scraper config', { error: err, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
  }
});

// ---------------------------------------------------------------------------
// Unified Connector Catalog
// ---------------------------------------------------------------------------

import { PARTNER_APP_CATALOG, getInstalledAppHealth } from './marketplace';
import { PHASE1_INTEGRATIONS } from '../lib/integrations/spec-registry';
import { ACTION_REGISTRY } from '../lib/connectors/action-registry';
import { executeConnectorAction } from '../lib/connectors/action-executor';
import { eq as eqFilter, supabaseRestAsService } from '../lib/supabase-rest';
import { authenticateToken } from '../middleware/auth';

// GET /api/connectors/catalog/unified — merged catalog (marketplace + spec-driven)
// with per-org install status and agent-usage counts.
router.get('/catalog/unified', authenticateToken, async (req, res) => {
  try {
    const orgId = (req as any).user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const domain = (req.query.domain as string | undefined)?.toLowerCase();

    // Load installed status for all integrations in this org
    const healthMap = await getInstalledAppHealth(orgId);

    // Load agents to compute agentCount per connector
    const agents = (await supabaseRestAsService('ai_agents', new URLSearchParams({
      organization_id: eqFilter(orgId),
      select: 'id,metadata',
    }))) as Array<{ id: string; metadata?: any }>;

    // Build a map: connectorId → count of agents using it
    const agentCountMap = new Map<string, number>();
    for (const agent of agents || []) {
      const integrationIds: string[] = agent.metadata?.publish?.integration_ids || [];
      for (const id of integrationIds) {
        agentCountMap.set(id, (agentCountMap.get(id) || 0) + 1);
      }
    }

    // Get catalog ids already covered by marketplace
    const marketplaceIds = new Set(PARTNER_APP_CATALOG.map((a) => a.id));

    const entries: object[] = [];

    // Marketplace apps first
    for (const app of PARTNER_APP_CATALOG) {
      if (domain && app.category !== domain) continue;
      const health = healthMap.get(app.id);
      entries.push({
        id: app.id,
        name: app.name,
        category: app.category,
        description: app.description,
        authType: app.installMethod,
        requiredFields: app.requiredFields,
        badge: app.badge,
        comingSoon: !!app.comingSoon,
        featured: app.featured,
        installCount: app.installCount,
        logoLetter: app.logoLetter,
        colorHex: app.colorHex,
        developer: app.developer,
        setupTimeMinutes: app.setupTimeMinutes,
        permissions: app.permissions,
        actionsUnlocked: app.actionsUnlocked,
        bundleIds: app.bundleIds,
        relatedAgentIds: app.relatedAgentIds,
        source: 'marketplace' as const,
        installed: !!health,
        connectionStatus: health?.status ?? null,
        lastSyncAt: health?.last_sync_at ?? null,
        lastErrorMsg: health?.last_error_msg ?? null,
        agentCount: agentCountMap.get(app.id) || 0,
        hasActions: ACTION_REGISTRY.hasOwnProperty(app.id),
      });
    }

    // Spec-driven integrations not already in marketplace catalog
    for (const spec of PHASE1_INTEGRATIONS) {
      if (marketplaceIds.has(spec.id)) continue; // marketplace version wins
      const catLower = (spec.category || '').toLowerCase();
      if (domain && catLower !== domain) continue;
      const health = healthMap.get(spec.id);
      entries.push({
        id: spec.id,
        name: spec.name,
        category: catLower,
        description: spec.description || '',
        authType: spec.authType,
        requiredFields: spec.apiKeyConfig?.requiredFields,
        badge: spec.tags?.[0],
        comingSoon: spec.status === 'COMING_SOON',
        featured: false,
        installCount: 0,
        logoLetter: (spec.name || '?')[0].toUpperCase(),
        colorHex: spec.color || '#6B7280',
        developer: undefined,
        setupTimeMinutes: undefined,
        permissions: spec.capabilities?.reads?.map((r: string) => `Read: ${r}`),
        actionsUnlocked: spec.capabilities?.writes?.map((w: any) => w.label),
        bundleIds: [],
        relatedAgentIds: [],
        source: 'integration' as const,
        installed: !!health,
        connectionStatus: health?.status ?? null,
        lastSyncAt: health?.last_sync_at ?? null,
        lastErrorMsg: health?.last_error_msg ?? null,
        agentCount: agentCountMap.get(spec.id) || 0,
        hasActions: ACTION_REGISTRY.hasOwnProperty(spec.id),
      });
    }

    return res.json({ success: true, data: entries });
  } catch (err: any) {
    logger.error('Failed to load unified connector catalog', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/connectors/:connectorId/actions — tool definitions for a connector
router.get('/:connectorId/actions', authenticateToken, (req, res) => {
  const { connectorId } = req.params;
  const schema = (ACTION_REGISTRY as any)[connectorId];
  if (!schema) return res.json({ success: true, data: [] });
  return res.json({ success: true, data: schema.tools || [] });
});

// POST /api/connectors/:connectorId/execute — run a connector action
router.post('/:connectorId/execute', authenticateToken, requirePermission('connectors.manage'), async (req, res) => {
  try {
    const orgId = (req as any).user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { connectorId } = req.params;
    const { action, params = {}, agentId } = req.body as { action: string; params?: Record<string, any>; agentId?: string };

    if (!action) return res.status(400).json({ success: false, error: 'action is required' });

    // Check action_policies — is this action enabled for the org?
    const policies = (await supabaseRestAsService('action_policies', new URLSearchParams({
      organization_id: eqFilter(orgId),
      service: eqFilter(connectorId),
      action: eqFilter(action),
      select: 'id,enabled,require_approval,required_role,policy_constraints',
      limit: '1',
    }))) as Array<{ id?: string; enabled: boolean; require_approval: boolean; required_role?: string; policy_constraints?: Record<string, any> }>;
    const policy = policies?.[0] || null;
    const constraintEvaluation = evaluatePolicyConstraints(params, policy?.policy_constraints || {});

    if (policy?.enabled === false) {
      await supabaseRestAsService('connector_action_executions', '', {
        method: 'POST',
        body: {
          organization_id: orgId,
          agent_id: agentId || null,
          integration_id: null,
          connector_id: connectorId,
          action,
          params,
          result: { blocked: true },
          success: false,
          error_message: `Action "${action}" is disabled for this connector`,
          requested_by: (req as any).user?.id || null,
          policy_snapshot: buildGovernedActionSnapshot({
            source: 'connector_console',
            service: connectorId,
            action,
            recordedAt: new Date().toISOString(),
            decision: 'blocked',
            result: 'blocked',
            policyId: policy?.id || null,
            requiredRole: policy?.required_role || null,
            approvalRequired: Boolean(policy?.require_approval),
            constraints: policy?.policy_constraints || {},
            blockReasons: [`Action "${action}" is disabled for this connector`],
            requestedBy: (req as any).user?.id || null,
            agentId: agentId || null,
          }),
          remediation: { suggested: 'Enable the action policy or choose a permitted action.' },
        },
      }).catch(() => {});
      return res.status(403).json({ success: false, error: `Action "${action}" is disabled for this connector` });
    }
    if (constraintEvaluation.blocked) {
      await supabaseRestAsService('connector_action_executions', '', {
        method: 'POST',
        body: {
          organization_id: orgId,
          agent_id: agentId || null,
          integration_id: null,
          connector_id: connectorId,
          action,
          params,
          result: { blocked: true },
          success: false,
          error_message: constraintEvaluation.blockReasons[0] || 'Action blocked by policy constraints',
          requested_by: (req as any).user?.id || null,
          policy_snapshot: buildGovernedActionSnapshot({
            source: 'connector_console',
            service: connectorId,
            action,
            recordedAt: new Date().toISOString(),
            decision: 'blocked',
            result: 'blocked',
            policyId: policy?.id || null,
            requiredRole: constraintEvaluation.requiredRole || policy?.required_role || null,
            approvalRequired: Boolean(policy?.require_approval),
            constraints: policy?.policy_constraints || {},
            constraintEvaluation,
            blockReasons: constraintEvaluation.blockReasons,
            requestedBy: (req as any).user?.id || null,
            agentId: agentId || null,
          }),
          remediation: { suggested: 'Adjust the payload or policy constraints, then retry.' },
        },
      }).catch(() => {});
      return res.status(403).json({
        success: false,
        error: constraintEvaluation.blockReasons[0] || 'Action blocked by policy constraints',
        policy_reasons: constraintEvaluation.blockReasons,
      });
    }

    if ((policy?.require_approval ?? false) || constraintEvaluation.approvalRequired) {
      // Create an approval request instead of executing
      const now = new Date().toISOString();
      const approvalRows = (await supabaseRestAsService('approval_requests', '', {
        method: 'POST',
        body: {
          organization_id: orgId,
          action_policy_id: policy?.id || null,
          service: connectorId,
          action,
          action_payload: {
            ...params,
            __policy: {
              constraint_evaluation: constraintEvaluation,
            },
          },
          requested_by: 'user',
          required_role: constraintEvaluation.requiredRole || policy?.required_role || 'manager',
          status: 'pending',
          assigned_to: null,
          expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          updated_at: now,
          created_at: now,
        },
      })) as any[];
      const approvalId = approvalRows?.[0]?.id;
      await supabaseRestAsService('connector_action_executions', '', {
        method: 'POST',
        body: {
          organization_id: orgId,
          agent_id: agentId || null,
          integration_id: null,
          connector_id: connectorId,
          action,
          params,
          result: { pending: true },
          success: false,
          error_message: 'Action requires approval before executing',
          approval_required: true,
          approval_id: approvalId || null,
          requested_by: (req as any).user?.id || null,
          policy_snapshot: buildGovernedActionSnapshot({
            source: 'connector_console',
            service: connectorId,
            action,
            recordedAt: now,
            decision: 'pending_approval',
            result: 'pending',
            policyId: policy?.id || null,
            requiredRole: constraintEvaluation.requiredRole || policy?.required_role || 'manager',
            approvalRequired: true,
            approvalId: approvalId || null,
            constraints: policy?.policy_constraints || {},
            constraintEvaluation,
            approvalReasons: constraintEvaluation.approvalReasons,
            requestedBy: (req as any).user?.id || null,
            agentId: agentId || null,
          }),
          remediation: { suggested: 'Approve or deny the action from the approvals queue.' },
          created_at: now,
        },
      }).catch(() => {});
      return res.json({ success: true, pending: true, approvalId, message: 'Action requires approval before executing' });
    }

    // Load credentials for the org's integration
    const integrations = (await supabaseRestAsService('integrations', new URLSearchParams({
      organization_id: eqFilter(orgId),
      service_type: eqFilter(connectorId),
      select: 'id,status',
      limit: '1',
    }))) as Array<{ id: string; status: string }>;

    if (!integrations?.length || integrations[0].status !== 'connected') {
      return res.status(400).json({ success: false, error: `${connectorId} is not connected` });
    }

    const integrationId = integrations[0].id;
    const credRows = (await supabaseRestAsService('integration_credentials', new URLSearchParams({
      integration_id: eqFilter(integrationId),
      select: 'key,value,expires_at',
    }))) as Array<{ key: string; value: string; expires_at?: string }>;

    const credentials: Record<string, string> = {};
    for (const row of credRows || []) {
      try { credentials[row.key] = decryptSecret(row.value); } catch { credentials[row.key] = row.value; }
    }

    const start = Date.now();
    const result = await executeConnectorAction(connectorId, action, params, credentials);
    const duration = Date.now() - start;

    // Log the action execution
    try {
      await supabaseRestAsService('connector_action_executions', '', {
        method: 'POST',
        body: {
          organization_id: orgId,
          agent_id: agentId || null,
          integration_id: integrationId,
          connector_id: connectorId,
          action,
          params,
          result: result.data || result.error || {},
          success: result.success,
          error_message: result.error || null,
          duration_ms: duration,
          requested_by: (req as any).user?.id || null,
          ...(result.idempotencyKey ? { idempotency_key: result.idempotencyKey } : {}),
          policy_snapshot: buildGovernedActionSnapshot({
            source: 'connector_console',
            service: connectorId,
            action,
            recordedAt: new Date().toISOString(),
            decision: 'executed',
            result: result.success ? 'succeeded' : 'failed',
            policyId: policy?.id || null,
            approvalRequired: policy?.require_approval ?? false,
            constraints: policy?.policy_constraints || {},
            constraintEvaluation,
            requestedBy: (req as any).user?.id || null,
            agentId: agentId || null,
            durationMs: duration,
            idempotencyKey: result.idempotencyKey || null,
          }),
          remediation: result.success ? {} : { suggested: 'Check connector credentials, provider state, and retry conditions.' },
        },
      });
    } catch { /* non-critical */ }

    return res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('Connector action execution failed', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
