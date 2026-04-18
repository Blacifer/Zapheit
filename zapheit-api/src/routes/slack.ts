import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { supabaseRestAsService, eq } from '../lib/supabase-rest';
import { logger } from '../lib/logger';

const router = express.Router();

/**
 * Verify Slack's HMAC-SHA256 request signature.
 * Must be called with the raw request body Buffer — not a parsed object.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: Buffer,
  providedSig: string,
): boolean {
  // Replay-guard: reject requests older than 5 minutes
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (ageSeconds > 300) return false;

  const base = `v0:${timestamp}:${rawBody.toString('utf8')}`;
  const expected = 'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');

  if (expected.length !== providedSig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedSig));
}

/**
 * POST /events/slack
 *
 * Public endpoint — Slack pushes workspace events here.
 * Registered in index.ts with express.raw() BEFORE express.json() so that
 * req.body is a raw Buffer suitable for HMAC verification.
 */
router.post('/', async (req: Request, res: Response) => {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    logger.error('SLACK_SIGNING_SECRET not configured — Slack webhook is disabled');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // req.body is a Buffer (express.raw applied at mount in index.ts)
  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody)) {
    logger.error('Slack webhook received non-Buffer body — check express.raw() mount order');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // Handle url_verification challenge first — this is a one-time setup ping from Slack
  // and must respond immediately before signature checks can be fully validated.
  if (payload.type === 'url_verification') {
    return res.status(200).json({ challenge: payload.challenge });
  }

  // For all real events, enforce HMAC-SHA256 signature verification.
  const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
  const signature = req.headers['x-slack-signature'] as string | undefined;

  if (!timestamp || !signature) {
    return res.status(400).json({ error: 'Missing Slack signature headers' });
  }

  if (!verifySlackSignature(signingSecret, timestamp, rawBody, signature)) {
    logger.warn('Slack signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Acknowledge immediately — Slack requires a 200 within 3 seconds
  res.status(200).send('');

  // Process asynchronously after acknowledging
  void processSlackEvent(payload).catch((err: any) => {
    logger.error('Slack event processing failed', { error: err?.message || String(err) });
  });
});

async function processSlackEvent(payload: any): Promise<void> {
  const event = payload?.event;
  const teamId: string | undefined = payload?.team_id;

  if (!event || !teamId) return;

  // Only handle plain messages and app_mention events
  if (!['message', 'app_mention'].includes(event.type)) return;

  // Skip bot messages, message edits, deletes, and other subtypes
  if (event.bot_id || event.subtype) return;

  // Find which org owns this Slack workspace by matching the team_id stored
  // as an integration_credential after OAuth connect.
  const integrations = await supabaseRestAsService(
    'integrations',
    new URLSearchParams({
      service_type: eq('slack'),
      status: eq('connected'),
      select: 'id,organization_id',
    }),
  ) as Array<{ id: string; organization_id: string }> | null;

  if (!integrations?.length) {
    logger.warn('Slack event received but no connected Slack integrations found', { team_id: teamId });
    return;
  }

  let matchedIntegration: { id: string; organization_id: string } | null = null;

  for (const integration of integrations) {
    const creds = await supabaseRestAsService(
      'integration_credentials',
      new URLSearchParams({
        integration_id: eq(integration.id),
        key: eq('team_id'),
        select: 'value',
        limit: '1',
      }),
    ) as Array<{ value: string }> | null;

    if (creds?.[0]?.value === teamId) {
      matchedIntegration = integration;
      break;
    }
  }

  if (!matchedIntegration) {
    logger.warn('Slack event received for unknown team_id', { team_id: teamId });
    return;
  }

  const now = new Date().toISOString();

  const messageRow = {
    organization_id: matchedIntegration.organization_id,
    integration_id: matchedIntegration.id,
    slack_team_id: teamId,
    slack_channel_id: event.channel || '',
    slack_channel_name: event.channel_name || null,
    slack_user_id: event.user || '',
    slack_user_name: null, // could be enriched later via users.info
    slack_ts: event.ts || String(Date.now()),
    thread_ts: event.thread_ts !== event.ts ? (event.thread_ts || null) : null,
    text: event.text || '',
    event_type: event.type,
    status: 'new',
    metadata: { raw_event: event, api_app_id: payload.api_app_id || null },
    created_at: now,
    updated_at: now,
  };

  try {
    await supabaseRestAsService('slack_messages', new URLSearchParams(), {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' }, // ON CONFLICT DO NOTHING
      body: messageRow,
    });

    logger.info('Slack message stored', {
      org_id: matchedIntegration.organization_id,
      channel: event.channel,
      ts: event.ts,
    });
  } catch (err: any) {
    logger.error('Failed to store Slack message', { error: err?.message || String(err) });
  }
}

export default router;
