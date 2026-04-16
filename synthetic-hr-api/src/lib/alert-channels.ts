/**
 * Alert channel notification service.
 *
 * Supports: PagerDuty (Events API v2), Microsoft Teams (Adaptive Card webhook),
 * Opsgenie (Alerts API), and email (via existing email.ts).
 *
 * Config values stored in alert_channels.config are encrypted with encryptSecret /
 * decryptSecret — the same scheme used for integration_credentials.
 *
 * Called fire-and-forget from incidents.ts after an incident row is inserted.
 */

import { buildFrontendUrl } from './frontend-url';
import { logger } from './logger';
import { decryptSecret, encryptSecret } from './integrations/encryption';
import { sendTransactionalEmail } from './email';

export type ChannelType = 'pagerduty' | 'teams' | 'opsgenie' | 'email';
export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';

const SEVERITY_ORDER: Record<SeverityLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function meetsMinSeverity(incident: SeverityLevel, min: SeverityLevel): boolean {
  return SEVERITY_ORDER[incident] >= SEVERITY_ORDER[min];
}

export interface AlertChannelRow {
  id: string;
  organization_id: string;
  name: string;
  channel_type: ChannelType;
  enabled: boolean;
  min_severity: SeverityLevel;
  config: Record<string, string>;
}

export interface IncidentPayload {
  incidentId: string;
  title: string;
  severity: SeverityLevel;
  incidentType: string;
  agentId?: string;
  description?: string;
  dashboardUrl?: string;
}

// ---------------------------------------------------------------------------
// Fetch enabled channels for org (using service role — bypasses RLS)
// ---------------------------------------------------------------------------

async function getEnabledChannels(orgId: string): Promise<AlertChannelRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/alert_channels?organization_id=eq.${orgId}&enabled=eq.true&select=id,organization_id,name,channel_type,enabled,min_severity,config`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const rows = await res.json().catch(() => []) as any[];
    return Array.isArray(rows) ? rows : [];
  } catch (err: any) {
    logger.warn('alert-channels: failed to fetch channels', { error: err?.message, orgId });
    return [];
  }
}

// ---------------------------------------------------------------------------
// PagerDuty — Events API v2
// ---------------------------------------------------------------------------

const PD_SEVERITY_MAP: Record<SeverityLevel, string> = {
  critical: 'critical',
  high: 'error',
  medium: 'warning',
  low: 'info',
};

async function sendPagerDuty(config: Record<string, string>, incident: IncidentPayload): Promise<void> {
  const routingKey = decryptSecret(config.routing_key || '');
  if (!routingKey) { logger.warn('alert-channels/pagerduty: routing_key missing'); return; }

  const body = {
    routing_key: routingKey,
    event_action: 'trigger',
    dedup_key: `zapheit-incident-${incident.incidentId}`,
    payload: {
      summary: incident.title,
      severity: PD_SEVERITY_MAP[incident.severity] || 'warning',
      source: 'Zapheit AI Governance',
      custom_details: {
        incident_type: incident.incidentType,
        agent_id: incident.agentId || 'unknown',
        description: incident.description?.slice(0, 500) || '',
        dashboard_url: incident.dashboardUrl || '',
      },
    },
    links: incident.dashboardUrl
      ? [{ href: incident.dashboardUrl, text: 'View in Zapheit' }]
      : [],
  };

  const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.warn('alert-channels/pagerduty: enqueue failed', { status: res.status, body: text.slice(0, 200) });
  } else {
    logger.info('alert-channels/pagerduty: event enqueued', { incidentId: incident.incidentId });
  }
}

// ---------------------------------------------------------------------------
// Microsoft Teams — Incoming Webhook (Adaptive Card)
// ---------------------------------------------------------------------------

const TEAMS_COLORS: Record<SeverityLevel, string> = {
  critical: 'attention',
  high: 'warning',
  medium: 'accent',
  low: 'good',
};

async function sendTeams(config: Record<string, string>, incident: IncidentPayload): Promise<void> {
  const webhookUrl = decryptSecret(config.webhook_url || '');
  if (!webhookUrl) { logger.warn('alert-channels/teams: webhook_url missing'); return; }

  // Validate URL before sending
  try { new URL(webhookUrl); } catch {
    logger.warn('alert-channels/teams: invalid webhook_url'); return;
  }

  const color = TEAMS_COLORS[incident.severity] || 'accent';
  const url = incident.dashboardUrl || '';

  const card = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: `**${incident.severity.toUpperCase()} Incident Detected**`,
              weight: 'bolder',
              size: 'medium',
              color,
            },
            {
              type: 'FactSet',
              facts: [
                { title: 'Title', value: incident.title },
                { title: 'Type', value: incident.incidentType.replace(/_/g, ' ') },
                { title: 'Severity', value: incident.severity },
                { title: 'Agent', value: incident.agentId || 'unknown' },
                { title: 'Time', value: new Date().toISOString() },
              ],
            },
            ...(incident.description
              ? [{ type: 'TextBlock', text: incident.description.slice(0, 300), wrap: true, isSubtle: true }]
              : []),
          ],
          actions: url
            ? [{ type: 'Action.OpenUrl', title: 'View in Zapheit', url }]
            : [],
        },
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.warn('alert-channels/teams: webhook failed', { status: res.status, body: text.slice(0, 200) });
  } else {
    logger.info('alert-channels/teams: card sent', { incidentId: incident.incidentId });
  }
}

// ---------------------------------------------------------------------------
// Opsgenie — Alerts API
// ---------------------------------------------------------------------------

const OG_PRIORITY_MAP: Record<SeverityLevel, string> = {
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
  low: 'P5',
};

async function sendOpsgenie(config: Record<string, string>, incident: IncidentPayload): Promise<void> {
  const apiKey = decryptSecret(config.api_key || '');
  if (!apiKey) { logger.warn('alert-channels/opsgenie: api_key missing'); return; }

  const region = (config.region || 'us').toLowerCase();
  const baseUrl = region === 'eu'
    ? 'https://api.eu.opsgenie.com'
    : 'https://api.opsgenie.com';

  const body = {
    message: `[${incident.severity.toUpperCase()}] ${incident.title}`,
    alias: `zapheit-incident-${incident.incidentId}`,
    description: incident.description?.slice(0, 500) || '',
    priority: OG_PRIORITY_MAP[incident.severity] || 'P3',
    source: 'Zapheit AI Governance',
    tags: ['zapheit', incident.severity, incident.incidentType],
    details: {
      incident_type: incident.incidentType,
      agent_id: incident.agentId || '',
      dashboard_url: incident.dashboardUrl || '',
    },
  };

  const res = await fetch(`${baseUrl}/v2/alerts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `GenieKey ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.warn('alert-channels/opsgenie: alert failed', { status: res.status, body: text.slice(0, 200) });
  } else {
    logger.info('alert-channels/opsgenie: alert created', { incidentId: incident.incidentId });
  }
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

async function sendEmailAlert(config: Record<string, string>, incident: IncidentPayload): Promise<void> {
  const rawRecipients = config.recipients || '';
  const recipients = rawRecipients.split(',').map((r) => r.trim()).filter(Boolean);
  if (recipients.length === 0) { logger.warn('alert-channels/email: no recipients configured'); return; }

  const url = incident.dashboardUrl || buildFrontendUrl('/dashboard/incidents');
  const severityColor: Record<SeverityLevel, string> = {
    critical: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#6b7280',
  };
  const color = severityColor[incident.severity] || '#6b7280';

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:${color};padding:16px 24px">
        <span style="font-size:18px;font-weight:700;color:#fff">
          ${incident.severity.toUpperCase()} Incident — ${incident.title}
        </span>
      </div>
      <div style="padding:24px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#94a3b8;width:120px">Type</td><td style="padding:6px 0">${incident.incidentType.replace(/_/g, ' ')}</td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8">Severity</td><td style="padding:6px 0;color:${color};font-weight:700">${incident.severity}</td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8">Agent</td><td style="padding:6px 0">${incident.agentId || 'unknown'}</td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8">Time</td><td style="padding:6px 0">${new Date().toLocaleString()}</td></tr>
        </table>
        ${incident.description ? `<p style="margin-top:16px;font-size:13px;color:#94a3b8;line-height:1.6">${incident.description.slice(0, 400)}</p>` : ''}
        <a href="${url}" style="display:inline-block;margin-top:20px;padding:10px 20px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View in Zapheit</a>
      </div>
    </div>`;

  for (const recipient of recipients) {
    await sendTransactionalEmail({
      to: recipient,
      subject: `[Zapheit] ${incident.severity.toUpperCase()} Incident: ${incident.title}`,
      html,
      text: `${incident.severity.toUpperCase()} Incident: ${incident.title}\nType: ${incident.incidentType}\nAgent: ${incident.agentId || 'unknown'}\n${incident.description || ''}\n\n${url}`,
    }).catch((err: any) => {
      logger.warn('alert-channels/email: send failed', { to: recipient, error: err?.message });
    });
  }
  logger.info('alert-channels/email: sent', { recipients: recipients.length, incidentId: incident.incidentId });
}

// ---------------------------------------------------------------------------
// Public: dispatch to a single channel row (used by test endpoint)
// ---------------------------------------------------------------------------

export async function notifyOneChannel(channel: AlertChannelRow, incident: IncidentPayload): Promise<void> {
  try {
    if (channel.channel_type === 'pagerduty') await sendPagerDuty(channel.config, incident);
    else if (channel.channel_type === 'teams') await sendTeams(channel.config, incident);
    else if (channel.channel_type === 'opsgenie') await sendOpsgenie(channel.config, incident);
    else if (channel.channel_type === 'email') await sendEmailAlert(channel.config, incident);
  } catch (err: any) {
    logger.warn('alert-channels: notifyOneChannel failed', { type: channel.channel_type, error: err?.message });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public: dispatch to all matching channels for an org
// ---------------------------------------------------------------------------

export async function notifyAlertChannels(orgId: string, incident: IncidentPayload): Promise<void> {
  let channels: AlertChannelRow[];
  try {
    channels = await getEnabledChannels(orgId);
  } catch (err: any) {
    logger.warn('alert-channels: getEnabledChannels failed', { error: err?.message, orgId });
    return;
  }

  for (const ch of channels) {
    if (!meetsMinSeverity(incident.severity, ch.min_severity)) continue;
    try {
      if (ch.channel_type === 'pagerduty') await sendPagerDuty(ch.config, incident);
      else if (ch.channel_type === 'teams') await sendTeams(ch.config, incident);
      else if (ch.channel_type === 'opsgenie') await sendOpsgenie(ch.config, incident);
      else if (ch.channel_type === 'email') await sendEmailAlert(ch.config, incident);
    } catch (err: any) {
      logger.warn('alert-channels: channel dispatch failed', { channel_id: ch.id, type: ch.channel_type, error: err?.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Helper exported for the CRUD route — encrypt secrets before storing
// ---------------------------------------------------------------------------

export function encryptChannelConfig(
  channelType: ChannelType,
  raw: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const secretFields: Record<ChannelType, string[]> = {
    pagerduty: ['routing_key'],
    teams: ['webhook_url'],
    opsgenie: ['api_key'],
    email: [],
  };
  const secrets = new Set(secretFields[channelType] || []);
  for (const [k, v] of Object.entries(raw)) {
    result[k] = secrets.has(k) && v ? encryptSecret(v) : v;
  }
  return result;
}

export function decryptChannelConfigForDisplay(
  channelType: ChannelType,
  stored: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const secretFields: Record<ChannelType, string[]> = {
    pagerduty: ['routing_key'],
    teams: ['webhook_url'],
    opsgenie: ['api_key'],
    email: [],
  };
  const secrets = new Set(secretFields[channelType] || []);
  for (const [k, v] of Object.entries(stored)) {
    // Return masked value for secrets so UI can show "configured" without leaking the key
    result[k] = secrets.has(k) && v ? '••••••••' : v;
  }
  return result;
}
