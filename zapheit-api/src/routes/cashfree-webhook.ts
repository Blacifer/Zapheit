import express, { Request, Response } from 'express';
import { auditLog } from '../lib/audit-logger';
import {
  CashfreeConfigError,
  getCashfreeWebhookSigningSecret,
  mapCashfreeWebhookPaymentStatus,
  verifyCashfreeWebhookSignature,
} from '../lib/cashfree';
import { logger } from '../lib/logger';
import { eq, supabaseRestAsService } from '../lib/supabase-rest';

const router = express.Router();

type CashfreeWebhookPayload = {
  type?: string;
  event_time?: string;
  data?: {
    order?: {
      order_id?: string;
      order_amount?: number;
      order_currency?: string;
      order_tags?: Record<string, any> | null;
    };
    payment?: {
      cf_payment_id?: string;
      payment_status?: string;
      payment_amount?: number;
      payment_currency?: string;
      payment_message?: string;
      payment_time?: string;
      bank_reference?: string | null;
      payment_group?: string | null;
    };
    customer_details?: Record<string, any> | null;
    payment_gateway_details?: {
      gateway_name?: string | null;
      gateway_order_id?: string | null;
      gateway_payment_id?: string | null;
      gateway_order_reference_id?: string | null;
      gateway_settlement?: string | null;
      gateway_status_code?: string | null;
    };
    error_details?: Record<string, any> | null;
  };
};

function deepMerge(base: Record<string, any>, patch: Record<string, any>): Record<string, any> {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, any>, value as Record<string, any>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function buildProviderEventId(payload: CashfreeWebhookPayload, idempotencyKey?: string | null): string | null {
  if (idempotencyKey) return idempotencyKey;

  const fallback = [
    payload.type,
    payload.data?.order?.order_id,
    payload.data?.payment?.cf_payment_id,
    payload.event_time,
  ].filter(Boolean).join(':');

  return fallback || null;
}

async function getPaymentOrderByMerchantOrderId(merchantOrderId: string) {
  const query = new URLSearchParams();
  query.set('merchant_order_id', eq(merchantOrderId));
  query.set('limit', '1');
  const rows = (await supabaseRestAsService('payment_orders', query)) as Array<Record<string, any>> | null;
  return rows?.[0] || null;
}

async function getOrganizationById(organizationId: string) {
  const query = new URLSearchParams();
  query.set('id', eq(organizationId));
  query.set('select', 'id,name,settings');
  query.set('limit', '1');
  const rows = (await supabaseRestAsService('organizations', query)) as Array<Record<string, any>> | null;
  return rows?.[0] || null;
}

async function findExistingPaymentReviewWorkItem(organizationId: string, paymentOrderId: string) {
  const query = new URLSearchParams();
  query.set('organization_id', eq(organizationId));
  query.set('metadata->>payment_order_id', eq(paymentOrderId));
  query.set('select', 'id,metadata');
  query.set('limit', '1');
  const rows = (await supabaseRestAsService('work_items', query)) as Array<Record<string, any>> | null;
  return rows?.[0] || null;
}

async function ensurePaymentReviewWorkItem(input: {
  order: Record<string, any>;
  payload: CashfreeWebhookPayload;
  providerEventId: string | null;
}) {
  const existing = await findExistingPaymentReviewWorkItem(input.order.organization_id, input.order.id);
  if (existing?.id) {
    return { id: existing.id as string, created: false };
  }

  const now = new Date().toISOString();
  const title = `Manual review required for paid ${input.order.offer_name}`;
  const description = [
    `A verified Cashfree payment has been received for ${input.order.offer_name}.`,
    `Merchant order: ${input.order.merchant_order_id}`,
    `Amount: ${Number(input.order.amount || 0).toFixed(2)} ${input.order.currency}`,
    `Customer: ${input.order.customer_name} (${input.order.customer_email})`,
    input.payload.data?.payment?.cf_payment_id ? `Cashfree payment ID: ${input.payload.data.payment.cf_payment_id}` : null,
    input.payload.data?.payment?.payment_message ? `Gateway message: ${input.payload.data.payment.payment_message}` : null,
  ].filter(Boolean).join('\n');

  const created = (await supabaseRestAsService('work_items', '', {
    method: 'POST',
    body: {
      organization_id: input.order.organization_id,
      type: 'support_ticket',
      status: 'open',
      stage: 'new',
      title,
      description,
      priority: 'high',
      created_at: now,
      updated_at: now,
      metadata: {
        payment_review: true,
        payment_order_id: input.order.id,
        merchant_order_id: input.order.merchant_order_id,
        provider_event_id: input.providerEventId,
        offer_code: input.order.offer_code,
        offer_name: input.order.offer_name,
        amount: Number(input.order.amount || 0),
        currency: input.order.currency,
        paid_at: input.order.paid_at || null,
        customer_name: input.order.customer_name,
        customer_email: input.order.customer_email,
        raw_payload: input.payload,
      },
    },
  })) as Array<Record<string, any>> | null;

  return { id: created?.[0]?.id || null, created: true };
}

async function updatePaymentOrderFulfillmentState(input: {
  order: Record<string, any>;
  workItemId?: string | null;
}) {
  const query = new URLSearchParams();
  query.set('id', eq(input.order.id));
  query.set('organization_id', eq(input.order.organization_id));

  const mergedMetadata = {
    ...(input.order.metadata || {}),
    fulfillmentState: 'pending_review',
    reviewRequired: true,
    reviewQueuedAt: input.order.metadata?.reviewQueuedAt || new Date().toISOString(),
    reviewWorkItemId: input.workItemId || input.order.metadata?.reviewWorkItemId || null,
  };

  const updated = (await supabaseRestAsService('payment_orders', query, {
    method: 'PATCH',
    body: {
      metadata: mergedMetadata,
      updated_at: new Date().toISOString(),
    },
  })) as Array<Record<string, any>> | null;

  return updated?.[0] || { ...input.order, metadata: mergedMetadata };
}

async function persistOrganizationBillingState(input: {
  order: Record<string, any>;
  providerEventId: string | null;
  workItemId?: string | null;
}) {
  const org = await getOrganizationById(input.order.organization_id);
  if (!org) return;

  const mergedSettings = deepMerge(org.settings || {}, {
    rasi_billing: {
      state: 'payment_received_pending_review',
      fulfillment_mode: 'manual_review',
      latest_payment: {
        provider: 'cashfree',
        payment_order_id: input.order.id,
        merchant_order_id: input.order.merchant_order_id,
        provider_order_id: input.order.provider_order_id || null,
        provider_event_id: input.providerEventId,
        offer_code: input.order.offer_code,
        offer_name: input.order.offer_name,
        amount: Number(input.order.amount || 0),
        currency: input.order.currency,
        status: input.order.status,
        paid_at: input.order.paid_at || null,
      },
      review_queue: {
        status: 'pending_review',
        work_item_id: input.workItemId || null,
        queued_at: input.order.metadata?.reviewQueuedAt || new Date().toISOString(),
      },
    },
  });

  const query = new URLSearchParams();
  query.set('id', eq(input.order.organization_id));
  await supabaseRestAsService('organizations', query, {
    method: 'PATCH',
    body: { settings: mergedSettings },
  });
}

async function logPaymentWebhookEvent(input: {
  organizationId?: string | null;
  paymentOrderId?: string | null;
  providerEventId?: string | null;
  eventType: string;
  eventStatus: string;
  payload: Record<string, any>;
  signatureVerified: boolean;
  errorMessage?: string | null;
}) {
  await supabaseRestAsService('payment_events', '', {
    method: 'POST',
    headers: input.providerEventId
      ? { Prefer: 'resolution=merge-duplicates,return=representation' }
      : { Prefer: 'return=representation' },
    body: {
      organization_id: input.organizationId || null,
      payment_order_id: input.paymentOrderId || null,
      provider: 'cashfree',
      provider_event_id: input.providerEventId || null,
      event_type: input.eventType,
      event_status: input.eventStatus,
      signature_verified: input.signatureVerified,
      payload: input.payload,
      error_message: input.errorMessage || null,
      processed_at: new Date().toISOString(),
    },
  });
}

function mergeWebhookMetadata(existing: Record<string, any> | null | undefined, payload: CashfreeWebhookPayload, headers: {
  attempt?: string | null;
  idempotencyKey?: string | null;
  version?: string | null;
}) {
  return {
    ...(existing || {}),
    lastWebhookType: payload.type || null,
    lastWebhookEventTime: payload.event_time || null,
    lastWebhookVersion: headers.version || null,
    lastWebhookAttempt: headers.attempt ? Number(headers.attempt) : null,
    lastWebhookIdempotencyKey: headers.idempotencyKey || null,
    lastPaymentStatus: payload.data?.payment?.payment_status || null,
    lastPaymentId: payload.data?.payment?.cf_payment_id || null,
    paymentGroup: payload.data?.payment?.payment_group || (existing || {}).paymentGroup || null,
    bankReference: payload.data?.payment?.bank_reference || null,
    errorDetails: payload.data?.error_details || null,
    customerDetails: payload.data?.customer_details || (existing || {}).customerDetails || null,
  };
}

async function processCashfreeWebhook(payload: CashfreeWebhookPayload, headers: {
  attempt?: string | null;
  idempotencyKey?: string | null;
  version?: string | null;
}) {
  const merchantOrderId = payload.data?.order?.order_id;
  const paymentStatus = payload.data?.payment?.payment_status || null;
  const providerEventId = buildProviderEventId(payload, headers.idempotencyKey);

  if (!merchantOrderId) {
    await logPaymentWebhookEvent({
      eventType: payload.type || 'cashfree.webhook.unknown',
      eventStatus: paymentStatus || 'missing_order_id',
      providerEventId,
      payload: payload as Record<string, any>,
      signatureVerified: true,
      errorMessage: 'Missing order_id in Cashfree webhook payload',
    });
    logger.warn('Cashfree webhook missing order_id', { type: payload.type, providerEventId });
    return;
  }

  const existing = await getPaymentOrderByMerchantOrderId(merchantOrderId);
  if (!existing) {
    await logPaymentWebhookEvent({
      eventType: payload.type || 'cashfree.webhook.unmatched',
      eventStatus: paymentStatus || 'unmatched_order',
      providerEventId,
      payload: payload as Record<string, any>,
      signatureVerified: true,
      errorMessage: `No payment order found for merchant order ${merchantOrderId}`,
    });
    logger.warn('Cashfree webhook for unknown merchant order', { merchantOrderId, providerEventId });
    return;
  }

  const nextStatus = paymentStatus
    ? mapCashfreeWebhookPaymentStatus(paymentStatus)
    : existing.status;
  const finalStatus = existing.status === 'paid' && nextStatus !== 'paid'
    ? 'paid'
    : nextStatus;
  const providerOrderStatus = existing.status === 'paid' && nextStatus !== 'paid'
    ? existing.provider_order_status || paymentStatus || payload.type || null
    : paymentStatus || payload.type || existing.provider_order_status || null;
  const paidAt = existing.paid_at || (finalStatus === 'paid'
    ? payload.data?.payment?.payment_time || payload.event_time || new Date().toISOString()
    : null);

  const query = new URLSearchParams();
  query.set('id', eq(existing.id));
  query.set('organization_id', eq(existing.organization_id));

  const updated = (await supabaseRestAsService('payment_orders', query, {
    method: 'PATCH',
    body: {
      provider_order_id:
        existing.provider_order_id ||
        payload.data?.payment_gateway_details?.gateway_order_id ||
        null,
      provider_order_status: providerOrderStatus,
      status: finalStatus,
      paid_at: paidAt,
      updated_at: new Date().toISOString(),
      metadata: mergeWebhookMetadata(existing.metadata || {}, payload, headers),
    },
  })) as Array<Record<string, any>> | null;

  const row = updated?.[0] || existing;

  if (finalStatus === 'paid') {
    try {
      const reviewWorkItem = await ensurePaymentReviewWorkItem({
        order: row,
        payload,
        providerEventId,
      });
      const reviewedRow = await updatePaymentOrderFulfillmentState({
        order: row,
        workItemId: reviewWorkItem.id,
      });

      await persistOrganizationBillingState({
        order: reviewedRow,
        providerEventId,
        workItemId: reviewWorkItem.id,
      });

      if (reviewWorkItem.created) {
        await auditLog.log({
          user_id: reviewedRow.created_by || '',
          action: 'payments.review.queued',
          resource_type: 'payment_order',
          resource_id: reviewedRow.id,
          organization_id: reviewedRow.organization_id,
          metadata: {
            merchant_order_id: reviewedRow.merchant_order_id,
            work_item_id: reviewWorkItem.id,
            provider_event_id: providerEventId,
          },
        });
      }
    } catch (error: any) {
      logger.warn('Cashfree payment fulfilled but manual review sync failed', {
        paymentOrderId: row.id,
        merchantOrderId: row.merchant_order_id,
        error: error?.message || String(error),
      });
    }
  }

  await logPaymentWebhookEvent({
    organizationId: row.organization_id,
    paymentOrderId: row.id,
    providerEventId,
    eventType: payload.type || 'cashfree.webhook.received',
    eventStatus: paymentStatus || finalStatus,
    payload: payload as Record<string, any>,
    signatureVerified: true,
  });

  await auditLog.log({
    user_id: row.created_by || '',
    action: finalStatus === 'paid' ? 'payments.order.paid' : 'payments.order.webhook_updated',
    resource_type: 'payment_order',
    resource_id: row.id,
    organization_id: row.organization_id,
    metadata: {
      merchant_order_id: row.merchant_order_id,
      provider_event_id: providerEventId,
      webhook_type: payload.type || null,
      payment_status: paymentStatus,
    },
  });
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      logger.error('Cashfree webhook received non-Buffer body — check express.raw() mount');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const signature = req.get('x-webhook-signature')?.trim();
    const timestamp = req.get('x-webhook-timestamp')?.trim();
    const idempotencyKey = req.get('x-idempotency-key')?.trim() || null;
    const version = req.get('x-webhook-version')?.trim() || null;
    const attempt = req.get('x-webhook-attempt')?.trim() || null;

    if (!signature || !timestamp) {
      return res.status(400).json({ error: 'Missing Cashfree webhook signature headers' });
    }

    const secret = getCashfreeWebhookSigningSecret();
    if (!verifyCashfreeWebhookSignature({ rawBody, timestamp, signature, secret })) {
      logger.warn('Cashfree webhook signature verification failed', { idempotencyKey, version });
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    let payload: CashfreeWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as CashfreeWebhookPayload;
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    res.status(200).send('');

    void processCashfreeWebhook(payload, { attempt, idempotencyKey, version }).catch((error: any) => {
      logger.error('Cashfree webhook processing failed', {
        error: error?.message || String(error),
        merchantOrderId: payload.data?.order?.order_id,
        idempotencyKey,
      });
    });
  } catch (error: any) {
    if (error instanceof CashfreeConfigError) {
      logger.error('Cashfree webhook configuration error', { error: error.message });
      return res.status(503).json({ error: error.message });
    }
    logger.error('Cashfree webhook request failed', { error: error?.message || String(error) });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;