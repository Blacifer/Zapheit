/**
 * Slack Interactive Components handler.
 *
 * Handles Approve / Deny button clicks sent by Slack to this endpoint.
 *
 * Mounted in index.ts BEFORE express.json() with:
 *   app.use('/events/slack-actions', express.raw({ type: 'application/x-www-form-urlencoded', limit: '1mb' }), slackActionsRoutes)
 *
 * This means req.body is a raw Buffer, which lets us HMAC-verify the request
 * before doing anything else — same pattern as /events/slack.
 *
 * Slack app setup: set the Interactivity Request URL to:
 *   {BASE_URL}/events/slack-actions
 */

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { auditLog } from '../lib/audit-logger';

const router = express.Router();

// ---------------------------------------------------------------------------
// HMAC signature verification — identical to the one in slack.ts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * POST /events/slack-actions
 *
 * Public endpoint — Slack posts interactive component payloads here.
 * Registered with express.raw() so req.body is a Buffer for HMAC verification.
 */
router.post('/', async (req: Request, res: Response) => {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    logger.error('SLACK_SIGNING_SECRET not configured — Slack interactive actions disabled');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody)) {
    logger.error('slack-actions: non-Buffer body received — check express.raw() mount order');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  // Verify HMAC before doing anything
  const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
  const signature = req.headers['x-slack-signature'] as string | undefined;

  if (!timestamp || !signature) {
    return res.status(400).json({ error: 'Missing Slack signature headers' });
  }

  if (!verifySlackSignature(signingSecret, timestamp, rawBody, signature)) {
    logger.warn('slack-actions: signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Parse URL-encoded body — Slack sends: payload=<URL-encoded JSON>
  let payload: any;
  try {
    const params = new URLSearchParams(rawBody.toString('utf8'));
    const raw = params.get('payload');
    if (!raw) return res.status(400).json({ error: 'Missing payload field' });
    payload = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const action = payload?.actions?.[0];
  if (!action) {
    // Unknown event type — ACK and ignore
    return res.status(200).send('');
  }

  const { action_id, value: approvalId } = action;
  if (!approvalId || (action_id !== 'rasi_approve' && action_id !== 'rasi_deny')) {
    return res.status(200).send('');
  }

  const slackUserId: string = payload?.user?.id || 'unknown';
  const slackUserName: string = payload?.user?.name || slackUserId;
  const responseUrl: string | undefined = payload?.response_url;
  const isApprove = action_id === 'rasi_approve';

  // ACK Slack immediately (must respond within 3 seconds)
  res.status(200).json({ text: `Processing ${isApprove ? 'approval' : 'denial'}…` });

  // Process asynchronously after ACK
  void processSlackAction({
    approvalId,
    isApprove,
    slackUserName,
    responseUrl,
  }).catch((err: any) => {
    logger.error('slack-actions: async processing failed', { approvalId, error: err?.message });
  });
});

// ---------------------------------------------------------------------------
// Async processing — runs after the 200 ACK is sent to Slack
// ---------------------------------------------------------------------------

async function processSlackAction(params: {
  approvalId: string;
  isApprove: boolean;
  slackUserName: string;
  responseUrl?: string;
}): Promise<void> {
  const { approvalId, isApprove, slackUserName, responseUrl } = params;

  // 1. Look up the approval to get org_id and verify it's still pending
  const { data: rows, error: fetchErr } = await supabaseAdmin
    .from('approval_requests')
    .select('id, organization_id, status, service, action')
    .eq('id', approvalId)
    .limit(1);

  if (fetchErr) {
    logger.warn('slack-actions: approval lookup failed', { approvalId, error: fetchErr.message });
    return;
  }

  const approval = rows?.[0];
  if (!approval) {
    logger.warn('slack-actions: approval not found', { approvalId });
    await updateSlackMessage(responseUrl, `⚠️ Approval request not found.`);
    return;
  }

  if (approval.status !== 'pending') {
    const statusLabel = approval.status === 'approved' ? '✅ already approved' : `already ${approval.status}`;
    logger.info('slack-actions: approval already actioned', { approvalId, status: approval.status });
    await updateSlackMessage(responseUrl, `ℹ️ This request was ${statusLabel}.`);
    return;
  }

  const orgId: string = approval.organization_id;
  const newStatus = isApprove ? 'approved' : 'denied';
  const reviewerNote = `${isApprove ? 'Approved' : 'Denied'} via Slack by @${slackUserName}`;
  const now = new Date().toISOString();

  // 2. Update the approval record directly (no auth middleware needed — we verified via HMAC)
  const { error: updateErr } = await supabaseAdmin
    .from('approval_requests')
    .update({
      status: newStatus,
      reviewer_note: reviewerNote,
      reviewed_at: now,
      updated_at: now,
    })
    .eq('id', approvalId)
    .eq('status', 'pending'); // idempotency guard

  if (updateErr) {
    logger.warn('slack-actions: approval update failed', { approvalId, error: updateErr.message });
    await updateSlackMessage(responseUrl, `⚠️ Failed to process your action. Please use the dashboard.`);
    return;
  }

  // 3. Write audit log
  await auditLog.log({
    user_id: slackUserName || 'slack',
    organization_id: orgId,
    action: isApprove ? 'approval.approved_via_slack' : 'approval.denied_via_slack',
    resource_type: 'approval_request',
    resource_id: approvalId,
    metadata: { slack_user: slackUserName, reviewer_note: reviewerNote },
  }).catch((err: any) => {
    logger.warn('slack-actions: audit log failed', { error: err?.message });
  });

  // 4. Update the original Slack message to reflect the decision
  const messageText = isApprove
    ? `:white_check_mark: *Approved* by @${slackUserName}`
    : `:x: *Denied* by @${slackUserName}`;

  await updateSlackMessage(responseUrl, messageText);

  logger.info('slack-actions: approval actioned', { approvalId, status: newStatus, by: slackUserName });
}

async function updateSlackMessage(responseUrl: string | undefined, text: string): Promise<void> {
  if (!responseUrl) return;
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replace_original: true, text }),
    });
  } catch (err: any) {
    logger.warn('slack-actions: response_url update failed', { error: err?.message });
  }
}

export default router;
