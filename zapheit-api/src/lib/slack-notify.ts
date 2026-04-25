/**
 * Slack notification service for Zapheit governance events.
 *
 * Looks up the org's connected Slack integration, then posts formatted
 * Block Kit messages for incidents and HITL approval requests.
 *
 * Channel resolution order:
 *   1. `alert_channel_id` credential stored on the integration
 *   2. `SLACK_ALERTS_CHANNEL` env var (fallback for all orgs)
 *   3. `#general` as last resort
 */

import { buildFrontendUrl } from './frontend-url';
import { logger } from './logger';
import { decryptSecret } from './integrations/encryption';

const SLACK_API = 'https://slack.com/api';
const DEFAULT_CHANNEL = process.env.SLACK_ALERTS_CHANNEL || '#general';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getSlackToken(orgId: string): Promise<{ token: string; channel: string } | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // Find connected Slack integration for this org
  const intRes = await fetch(
    `${supabaseUrl}/rest/v1/integrations?organization_id=eq.${orgId}&service_type=eq.slack&status=eq.connected&select=id&limit=1`,
    { headers }
  );
  const intRows: any[] = await intRes.json().catch(() => []) as any[];
  if (!Array.isArray(intRows) || intRows.length === 0) return null;
  const integrationId = intRows[0].id;

  // Fetch token + optional alert channel
  const credRes = await fetch(
    `${supabaseUrl}/rest/v1/integration_credentials?integration_id=eq.${integrationId}&key=in.(access_token,alert_channel_id)&select=key,value`,
    { headers }
  );
  const credRows: any[] = await credRes.json().catch(() => []) as any[];
  if (!Array.isArray(credRows)) return null;

  const tokenRow = credRows.find((r) => r.key === 'access_token');
  const channelRow = credRows.find((r) => r.key === 'alert_channel_id');
  if (!tokenRow) return null;

  return {
    token: decryptSecret(tokenRow.value),
    channel: channelRow ? channelRow.value : DEFAULT_CHANNEL,
  };
}

async function postMessage(token: string, payload: object): Promise<boolean> {
  try {
    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const json: any = await res.json().catch(() => null);
    if (!json?.ok) {
      logger.warn('Slack postMessage failed', { error: json?.error });
      return false;
    }
    return true;
  } catch (err: any) {
    logger.warn('Slack postMessage error', { error: err?.message });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const SEVERITY_EMOJI: Record<string, string> = {
  critical: ':red_circle:',
  high: ':large_orange_circle:',
  medium: ':large_yellow_circle:',
  low: ':white_circle:',
};

/**
 * Send a rich incident alert to the org's Slack alerts channel.
 * Called fire-and-forget from incidents.ts.
 */
export async function notifySlackIncident(orgId: string, params: {
  incidentId: string;
  title: string;
  severity: string;
  incidentType: string;
  agentId?: string;
  description?: string;
  confidence?: number;
  dashboardUrl?: string;
}): Promise<void> {
  try {
    const slack = await getSlackToken(orgId);
    if (!slack) return;

    const emoji = SEVERITY_EMOJI[params.severity] || ':warning:';
    const confidenceText = params.confidence != null ? ` _(${Math.round(params.confidence * 100)}% confidence)_` : '';
    const url = params.dashboardUrl || buildFrontendUrl('/dashboard/incidents');

    await postMessage(slack.token, {
      channel: slack.channel,
      text: `${emoji} *${params.severity.toUpperCase()} Incident Detected* — ${params.title}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${emoji} ${params.severity.toUpperCase()} Incident: ${params.title}`, emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Type*\n${params.incidentType.replace(/_/g, ' ')}${confidenceText}` },
            { type: 'mrkdwn', text: `*Severity*\n${params.severity}` },
            { type: 'mrkdwn', text: `*Agent*\n${params.agentId || 'unknown'}` },
            { type: 'mrkdwn', text: `*Time*\n${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` },
          ],
        },
        ...(params.description ? [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*Details*\n${params.description.slice(0, 200)}` },
        }] : []),
        { type: 'divider' },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: ':white_check_mark: Resolve', emoji: true },
              style: 'primary',
              action_id: 'rasi_resolve_incident',
              value: params.incidentId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: ':rotating_light: Escalate', emoji: true },
              style: 'danger',
              action_id: 'rasi_escalate_incident',
              value: params.incidentId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View Details', emoji: true },
              url,
            },
          ],
        },
      ],
    });
  } catch (err: any) {
    logger.warn('notifySlackIncident error', { error: err?.message, orgId });
  }
}

/**
 * Send an approval request notification with Approve / Deny buttons.
 * Buttons use Slack interactive components — requires the org to have
 * configured the Slack app's Interactivity URL to:
 *   POST /api/integrations/slack/actions
 *
 * Falls back gracefully: if interactive components aren't configured,
 * the message still shows with a dashboard link.
 */
export async function notifySlackApproval(orgId: string, params: {
  approvalId: string;
  action: string;
  agentName?: string;
  requestedBy?: string;
  details?: string;
  dashboardUrl?: string;
}): Promise<void> {
  try {
    const slack = await getSlackToken(orgId);
    if (!slack) return;

    const url = params.dashboardUrl || buildFrontendUrl('/dashboard/approvals');

    await postMessage(slack.token, {
      channel: slack.channel,
      text: `:hourglass_flowing_sand: *Approval Required* — ${params.action}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: ':hourglass_flowing_sand: Approval Required', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Action*\n\`${params.action}\`` },
            { type: 'mrkdwn', text: `*Agent*\n${params.agentName || 'unknown'}` },
            { type: 'mrkdwn', text: `*Requested by*\n${params.requestedBy || 'system'}` },
            { type: 'mrkdwn', text: `*Time*\n${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` },
          ],
        },
        ...(params.details ? [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*Details*\n${params.details.slice(0, 300)}` },
        }] : []),
        { type: 'divider' },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: ':white_check_mark: Approve', emoji: true },
              style: 'primary',
              action_id: 'rasi_approve',
              value: params.approvalId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: ':x: Deny', emoji: true },
              style: 'danger',
              action_id: 'rasi_deny',
              value: params.approvalId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View Details', emoji: true },
              url,
            },
          ],
        },
      ],
    });
  } catch (err: any) {
    logger.warn('notifySlackApproval error', { error: err?.message, orgId });
  }
}
