// ---------------------------------------------------------------------------
// WhatsApp Cloud API Webhook Endpoint
//
// GET  /webhooks/whatsapp  — Meta verification handshake
// POST /webhooks/whatsapp  — Incoming messages & status updates
//
// Must be mounted with express.raw() BEFORE express.json() in index.ts.
// Follows the same pattern as the Slack webhook handler.
// ---------------------------------------------------------------------------

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { supabaseRestAsService, eq } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { sendWhatsAppText } from '../lib/whatsapp-sender';

const router = express.Router();

// ────────────────────────────────────────────────────────────────────────────
// Signature verification
// ────────────────────────────────────────────────────────────────────────────

function verifyWhatsAppSignature(
  appSecret: string,
  rawBody: Buffer,
  providedSig: string,
): boolean {
  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  if (expected.length !== providedSig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedSig));
}

// ────────────────────────────────────────────────────────────────────────────
// GET — Meta Webhook Verification (one-time setup)
// ────────────────────────────────────────────────────────────────────────────

router.get('/', (req: Request, res: Response) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    logger.error('WHATSAPP_VERIFY_TOKEN not configured');
    return res.sendStatus(403);
  }

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }

  logger.warn('WhatsApp webhook verification failed', { mode, token: '***' });
  return res.sendStatus(403);
});

// ────────────────────────────────────────────────────────────────────────────
// POST — Incoming Events (messages + statuses)
// ────────────────────────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    logger.error('WHATSAPP_APP_SECRET not configured — WhatsApp webhook disabled');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody)) {
    logger.error('WhatsApp webhook received non-Buffer body — check express.raw() mount');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  // Verify HMAC-SHA256 signature
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  if (!signature) {
    return res.status(400).json({ error: 'Missing X-Hub-Signature-256 header' });
  }

  if (!verifyWhatsAppSignature(appSecret, rawBody, signature)) {
    logger.warn('WhatsApp signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // Acknowledge immediately — Meta requires 200 within 20 seconds
  res.status(200).send('');

  // Process asynchronously
  void processWhatsAppPayload(payload).catch((err: any) => {
    logger.error('WhatsApp event processing failed', { error: err?.message || String(err) });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Event Processing
// ────────────────────────────────────────────────────────────────────────────

async function processWhatsAppPayload(payload: any): Promise<void> {
  if (payload?.object !== 'whatsapp_business_account') return;

  const entries: any[] = payload.entry || [];

  for (const entry of entries) {
    const changes: any[] = entry.changes || [];

    for (const change of changes) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      if (!value) continue;

      const phoneNumberId: string = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // Match this phone_number_id to an org via integration_credentials
      const matched = await matchPhoneToOrg(phoneNumberId);
      if (!matched) {
        logger.warn('WhatsApp event for unmatched phone_number_id', { phoneNumberId });
        continue;
      }

      // Process incoming messages
      const messages: any[] = value.messages || [];
      for (const msg of messages) {
        await storeInboundMessage(matched, phoneNumberId, msg, value.contacts);
      }

      // Process status updates (sent/delivered/read/failed)
      const statuses: any[] = value.statuses || [];
      for (const status of statuses) {
        await updateMessageStatus(matched, status);
      }
    }
  }
}

type MatchedOrg = { integrationId: string; organizationId: string; wabaId: string };

async function matchPhoneToOrg(phoneNumberId: string): Promise<MatchedOrg | null> {
  // Look up integrations where service_type = 'whatsapp' and status = 'connected'
  const integrations = (await supabaseRestAsService(
    'integrations',
    new URLSearchParams({
      service_type: eq('whatsapp'),
      status: eq('connected'),
      select: 'id,organization_id',
    }),
  )) as Array<{ id: string; organization_id: string }> | null;

  if (!integrations?.length) return null;

  for (const integration of integrations) {
    const creds = (await supabaseRestAsService(
      'integration_credentials',
      new URLSearchParams({
        integration_id: eq(integration.id),
        key: eq('phone_number_id'),
        select: 'value',
        limit: '1',
      }),
    )) as Array<{ value: string }> | null;

    if (creds?.[0]?.value === phoneNumberId) {
      // Also grab waba_id
      const wabaCreds = (await supabaseRestAsService(
        'integration_credentials',
        new URLSearchParams({
          integration_id: eq(integration.id),
          key: eq('waba_id'),
          select: 'value',
          limit: '1',
        }),
      )) as Array<{ value: string }> | null;

      return {
        integrationId: integration.id,
        organizationId: integration.organization_id,
        wabaId: wabaCreds?.[0]?.value || '',
      };
    }
  }

  return null;
}

async function storeInboundMessage(
  org: MatchedOrg,
  phoneNumberId: string,
  msg: any,
  contacts: any[] | undefined,
): Promise<void> {
  const from = msg.from; // sender phone (E.164 without +)
  const waMessageId = msg.id;
  const waTimestamp = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString();

  // Determine message type and extract content
  let messageType = msg.type || 'text';
  let content = '';
  let mediaUrl: string | null = null;

  switch (messageType) {
    case 'text':
      content = msg.text?.body || '';
      break;
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker':
      content = msg[messageType]?.caption || '';
      mediaUrl = msg[messageType]?.id || null; // media ID — needs separate download
      break;
    case 'location':
      content = JSON.stringify(msg.location || {});
      break;
    case 'contacts':
      content = JSON.stringify(msg.contacts || []);
      break;
    case 'interactive':
      content = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
      break;
    case 'reaction':
      content = msg.reaction?.emoji || '';
      break;
    default:
      content = JSON.stringify(msg[messageType] || {});
  }

  const now = new Date().toISOString();

  // Upsert the message (ON CONFLICT wa_message_id per waba DO NOTHING)
  try {
    await supabaseRestAsService('whatsapp_messages', new URLSearchParams(), {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: {
        organization_id: org.organizationId,
        integration_id: org.integrationId,
        waba_id: org.wabaId,
        phone_number_id: phoneNumberId,
        from_number: from,
        to_number: phoneNumberId,
        direction: 'inbound',
        message_type: messageType,
        content,
        media_url: mediaUrl,
        wa_message_id: waMessageId,
        wa_timestamp: waTimestamp,
        status: 'received',
        thread_phone: from,
        metadata: { raw: msg },
        created_at: now,
        updated_at: now,
      },
    });
  } catch (err: any) {
    logger.error('Failed to store WhatsApp inbound message', { error: err?.message, wa_message_id: waMessageId });
  }

  // Upsert contact — include BSUID if present (Meta 2026 migration)
  const contactInfo = contacts?.find((c: any) => c.wa_id === from);
  const contactName = contactInfo?.profile?.name || from;
  const bsuid = contactInfo?.user_id || null; // Business Scoped User ID

  try {
    await supabaseRestAsService('whatsapp_contacts', new URLSearchParams(), {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: {
        organization_id: org.organizationId,
        phone: from,
        name: contactName,
        wa_id: from,
        ...(bsuid ? { bsuid } : {}),
        opted_in: true,
        last_message_at: now,
        updated_at: now,
      },
    });
  } catch (err: any) {
    logger.error('Failed to upsert WhatsApp contact', { error: err?.message, phone: from });
  }

  // Handle approval quick-reply buttons
  if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
    await handleApprovalButtonReply(org, from, msg.interactive.button_reply?.id || '');
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   Process approval quick-reply button taps from WhatsApp
──────────────────────────────────────────────────────────────────────────── */

async function handleApprovalButtonReply(org: MatchedOrg, from: string, buttonId: string): Promise<void> {
  // buttonId format: "approve:<uuid>" or "reject:<uuid>"
  const match = buttonId.match(/^(approve|reject):([0-9a-f-]{36})$/i);
  if (!match) return;

  const [, decision, approvalId] = match;
  const now = new Date().toISOString();

  try {
    const q = new URLSearchParams();
    q.set('id', eq(approvalId));
    q.set('organization_id', eq(org.organizationId));
    q.set('status', eq('pending'));
    q.set('select', 'id,status,service,action');
    q.set('limit', '1');
    const rows = await supabaseRestAsService('approval_requests', q) as any[];
    const row = rows?.[0];

    if (!row) {
      await sendWhatsAppText(org.organizationId, from, '❌ This approval request was not found or has already been resolved. Please check the Zapheit dashboard.');
      return;
    }

    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(approvalId));
    patchQ.set('organization_id', eq(org.organizationId));
    await supabaseRestAsService('approval_requests', patchQ, {
      method: 'PATCH',
      body: {
        status: decision === 'approve' ? 'approved' : 'rejected',
        reviewer_note: `Decided via WhatsApp (${from})`,
        reviewed_at: now,
        updated_at: now,
      },
    });

    logger.info('Approval decided via WhatsApp button reply', { approvalId, decision, from, orgId: org.organizationId });

    const emoji = decision === 'approve' ? '✅' : '❌';
    const verb = decision === 'approve' ? 'approved' : 'rejected';
    await sendWhatsAppText(org.organizationId, from, `${emoji} Decision recorded — *${row.service} → ${row.action}* has been *${verb}*. Your team has been notified.`);
  } catch (err: any) {
    logger.warn('Failed to process WhatsApp approval button reply', { approvalId, decision, from, error: err?.message });
    try {
      await sendWhatsAppText(org.organizationId, from, '⚠️ Something went wrong processing your decision. Please use the Zapheit dashboard to review this request.');
    } catch { /* best-effort */ }
  }
}

async function updateMessageStatus(org: MatchedOrg, status: any): Promise<void> {
  const waMessageId = status.id;
  const newStatus = status.status; // sent | delivered | read | failed
  if (!waMessageId || !newStatus) return;

  try {
    await supabaseRestAsService(
      'whatsapp_messages',
      new URLSearchParams({
        organization_id: eq(org.organizationId),
        wa_message_id: eq(waMessageId),
      }),
      {
        method: 'PATCH',
        body: {
          status: newStatus,
          updated_at: new Date().toISOString(),
          metadata: status.errors ? { delivery_error: status.errors } : undefined,
        },
      },
    );
  } catch (err: any) {
    logger.error('Failed to update WhatsApp message status', {
      error: err?.message,
      wa_message_id: waMessageId,
      status: newStatus,
    });
  }
}

export default router;
