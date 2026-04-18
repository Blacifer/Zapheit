import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { auditLog } from '../lib/audit-logger';
import {
  assertCashfreeConfigured,
  CashfreeApiError,
  CashfreeConfigError,
  createCashfreeOrder,
  getCashfreeEnvironment,
  getCashfreeFrontendMode,
  getCashfreeOrder,
  mapCashfreeOrderStatus,
} from '../lib/cashfree';
import { logger } from '../lib/logger';
import { eq, supabaseRestAsUser } from '../lib/supabase-rest';
import { requirePermission } from '../middleware/rbac';

const router = express.Router();

const AUDIT_OFFER = {
  code: 'audit',
  name: 'The Audit',
  description: 'One-time AI governance assessment',
  amount: 25000,
  currency: 'INR',
};

const createOrderSchema = z.object({
  offerCode: z.literal('audit').default('audit'),
  customerName: z.string().trim().min(1, 'Customer name is required').max(255),
  customerEmail: z.string().trim().email().optional(),
  customerPhone: z.string().trim().regex(/^[0-9]{10,15}$/, 'Customer phone must be 10 to 15 digits'),
  companyName: z.string().trim().max(255).optional(),
  returnPath: z.string().trim().optional(),
  note: z.string().trim().max(500).optional(),
});

const listOrdersSchema = z.object({
  status: z.enum(['created', 'pending', 'paid', 'failed', 'cancelled', 'expired']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const getOrgId = (req: Request): string | null => req.user?.organization_id || null;
const getUserId = (req: Request): string | null => req.user?.id || null;
const getUserJwt = (req: Request): string => {
  const jwt = req.userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

function safeReturnPath(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//')) return null;
  return trimmed;
}

function getFrontendUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function buildReturnUrl(merchantOrderId: string, customReturnPath?: string): string {
  const frontendUrl = getFrontendUrl();
  const path = safeReturnPath(customReturnPath) || '/billing/cashfree/return';
  const url = new URL(`${frontendUrl}${path}`);
  url.searchParams.set('merchant_order_id', merchantOrderId);
  return url.toString();
}

function createMerchantOrderId(orgId: string, offerCode: string): string {
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${offerCode}-${orgId.slice(0, 8)}-${Date.now()}-${suffix}`.slice(0, 60);
}

function sanitizePaymentOrder(row: Record<string, any>) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    createdBy: row.created_by || null,
    provider: row.provider,
    offerCode: row.offer_code,
    offerName: row.offer_name,
    merchantOrderId: row.merchant_order_id,
    providerOrderId: row.provider_order_id || null,
    paymentSessionId: row.provider_payment_session_id || null,
    providerOrderStatus: row.provider_order_status || null,
    status: row.status,
    currency: row.currency,
    amount: Number(row.amount || 0),
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    companyName: row.company_name || null,
    returnUrl: row.return_url || null,
    paidAt: row.paid_at || null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getOrganization(orgId: string, userJwt: string) {
  const query = new URLSearchParams();
  query.set('id', eq(orgId));
  query.set('select', 'id,name,slug,plan');
  query.set('limit', '1');
  const rows = (await supabaseRestAsUser(userJwt, 'organizations', query)) as any[];
  return rows?.[0] || null;
}

async function getPaymentOrderById(id: string, orgId: string, userJwt: string) {
  const query = new URLSearchParams();
  query.set('id', eq(id));
  query.set('organization_id', eq(orgId));
  query.set('limit', '1');
  const rows = (await supabaseRestAsUser(userJwt, 'payment_orders', query)) as any[];
  return rows?.[0] || null;
}

async function getPaymentOrderByMerchantOrderId(merchantOrderId: string, orgId: string, userJwt: string) {
  const query = new URLSearchParams();
  query.set('merchant_order_id', eq(merchantOrderId));
  query.set('organization_id', eq(orgId));
  query.set('limit', '1');
  const rows = (await supabaseRestAsUser(userJwt, 'payment_orders', query)) as any[];
  return rows?.[0] || null;
}

async function logPaymentEvent(input: {
  userJwt: string;
  organizationId: string;
  paymentOrderId?: string | null;
  eventType: string;
  eventStatus: string;
  payload: Record<string, any>;
  providerEventId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    await supabaseRestAsUser(input.userJwt, 'payment_events', '', {
      method: 'POST',
      headers: input.providerEventId
        ? { Prefer: 'resolution=merge-duplicates,return=representation' }
        : { Prefer: 'return=representation' },
      body: {
        organization_id: input.organizationId,
        payment_order_id: input.paymentOrderId || null,
        provider: 'cashfree',
        provider_event_id: input.providerEventId || null,
        event_type: input.eventType,
        event_status: input.eventStatus,
        signature_verified: false,
        payload: input.payload,
        error_message: input.errorMessage || null,
        processed_at: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    logger.warn('Failed to log payment event', {
      eventType: input.eventType,
      organizationId: input.organizationId,
      error: error?.message || String(error),
    });
  }
}

function handleRouteError(res: Response, error: any) {
  if (error instanceof CashfreeConfigError) {
    return res.status(503).json({ success: false, error: error.message });
  }
  if (error instanceof CashfreeApiError) {
    return res.status(502).json({ success: false, error: error.responseBody || error.message });
  }
  logger.error('Payments route error', { error: error?.message || String(error) });
  return res.status(500).json({ success: false, error: error?.message || 'Internal error' });
}

router.get('/payments/offers', requirePermission('settings.read'), async (_req: Request, res: Response) => {
  return res.json({
    success: true,
    data: [
      {
        ...AUDIT_OFFER,
        mode: 'one_time',
        provider: 'cashfree',
        checkoutMode: getCashfreeFrontendMode(),
        activationMode: 'manual_review',
      },
    ],
  });
});

router.get('/payments/orders', requirePermission('settings.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = listOrdersSchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map((item) => item.message),
      });
    }

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    query.set('limit', String(parsed.data.limit));
    if (parsed.data.status) query.set('status', eq(parsed.data.status));

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'payment_orders', query)) as any[];
    return res.json({ success: true, data: (rows || []).map(sanitizePaymentOrder) });
  } catch (error: any) {
    return handleRouteError(res, error);
  }
});

router.get('/payments/orders/by-merchant/:merchantOrderId', requirePermission('settings.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const row = await getPaymentOrderByMerchantOrderId(req.params.merchantOrderId, orgId, getUserJwt(req));
    if (!row) return res.status(404).json({ success: false, error: 'Payment order not found' });

    return res.json({ success: true, data: sanitizePaymentOrder(row) });
  } catch (error: any) {
    return handleRouteError(res, error);
  }
});

router.get('/payments/orders/:id', requirePermission('settings.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const row = await getPaymentOrderById(req.params.id, orgId, getUserJwt(req));
    if (!row) return res.status(404).json({ success: false, error: 'Payment order not found' });

    return res.json({ success: true, data: sanitizePaymentOrder(row) });
  } catch (error: any) {
    return handleRouteError(res, error);
  }
});

router.post('/payments/orders', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    assertCashfreeConfigured();

    const orgId = getOrgId(req);
    const userId = getUserId(req);
    const userJwt = getUserJwt(req);

    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const parsed = createOrderSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map((item) => item.message),
      });
    }

    const organization = await getOrganization(orgId, userJwt);
    if (!organization) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }

    const merchantOrderId = createMerchantOrderId(orgId, AUDIT_OFFER.code);
    const customerEmail = parsed.data.customerEmail || req.user?.email;
    if (!customerEmail) {
      return res.status(400).json({ success: false, error: 'Customer email is required' });
    }

    const returnUrl = buildReturnUrl(merchantOrderId, parsed.data.returnPath);
    const createdOrder = await createCashfreeOrder({
      merchantOrderId,
      amount: AUDIT_OFFER.amount,
      currency: AUDIT_OFFER.currency,
      customer: {
        customerId: `${orgId}:${userId}`.slice(0, 50),
        customerName: parsed.data.customerName,
        customerEmail,
        customerPhone: parsed.data.customerPhone,
      },
      returnUrl,
      note: parsed.data.note || `${AUDIT_OFFER.name} payment for ${organization.name}`,
    });

    const status = mapCashfreeOrderStatus(createdOrder.orderStatus);
    const inserted = (await supabaseRestAsUser(userJwt, 'payment_orders', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        created_by: userId,
        provider: 'cashfree',
        offer_code: AUDIT_OFFER.code,
        offer_name: AUDIT_OFFER.name,
        merchant_order_id: merchantOrderId,
        provider_order_id: createdOrder.cfOrderId,
        provider_payment_session_id: createdOrder.paymentSessionId,
        provider_order_status: createdOrder.orderStatus,
        status,
        currency: AUDIT_OFFER.currency,
        amount: AUDIT_OFFER.amount,
        customer_name: parsed.data.customerName,
        customer_email: customerEmail,
        customer_phone: parsed.data.customerPhone,
        company_name: parsed.data.companyName || organization.name,
        return_url: returnUrl,
        metadata: {
          offerDescription: AUDIT_OFFER.description,
          checkoutMode: getCashfreeFrontendMode(),
          activationMode: 'manual_review',
          environment: getCashfreeEnvironment(),
        },
      },
    })) as any[];

    const row = inserted?.[0];
    if (!row) throw new Error('Failed to persist payment order');

    await logPaymentEvent({
      userJwt,
      organizationId: orgId,
      paymentOrderId: row.id,
      providerEventId: createdOrder.cfOrderId,
      eventType: 'cashfree.order.created',
      eventStatus: status,
      payload: createdOrder.raw,
    });

    await auditLog.log({
      user_id: userId,
      action: 'payments.order.created',
      resource_type: 'payment_order',
      resource_id: row.id,
      organization_id: orgId,
      ip_address: req.ip,
      user_agent: req.get('user-agent'),
      metadata: {
        offer_code: AUDIT_OFFER.code,
        merchant_order_id: merchantOrderId,
        provider_order_id: createdOrder.cfOrderId,
        amount: AUDIT_OFFER.amount,
        currency: AUDIT_OFFER.currency,
      },
    });

    return res.status(201).json({
      success: true,
      data: sanitizePaymentOrder(row),
      checkout: {
        provider: 'cashfree',
        mode: getCashfreeFrontendMode(),
        environment: getCashfreeEnvironment(),
        paymentSessionId: createdOrder.paymentSessionId,
        orderId: merchantOrderId,
        returnUrl,
      },
    });
  } catch (error: any) {
    return handleRouteError(res, error);
  }
});

router.post('/payments/orders/:id/sync', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    assertCashfreeConfigured();

    const orgId = getOrgId(req);
    const userId = getUserId(req);
    const userJwt = getUserJwt(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const existing = await getPaymentOrderById(req.params.id, orgId, userJwt);
    if (!existing) return res.status(404).json({ success: false, error: 'Payment order not found' });

    const providerOrder = await getCashfreeOrder(existing.merchant_order_id);
    const status = mapCashfreeOrderStatus(providerOrder.orderStatus);
    const paidAt = status === 'paid' ? existing.paid_at || new Date().toISOString() : null;

    const query = new URLSearchParams();
    query.set('id', eq(existing.id));
    query.set('organization_id', eq(orgId));

    const updated = (await supabaseRestAsUser(userJwt, 'payment_orders', query, {
      method: 'PATCH',
      body: {
        provider_order_id: providerOrder.cfOrderId || existing.provider_order_id || null,
        provider_payment_session_id: providerOrder.paymentSessionId || existing.provider_payment_session_id || null,
        provider_order_status: providerOrder.orderStatus,
        status,
        paid_at: paidAt,
        updated_at: new Date().toISOString(),
      },
    })) as any[];

    const row = updated?.[0];
    if (!row) throw new Error('Failed to update payment order');

    await logPaymentEvent({
      userJwt,
      organizationId: orgId,
      paymentOrderId: row.id,
      providerEventId: providerOrder.cfOrderId,
      eventType: 'cashfree.order.synced',
      eventStatus: status,
      payload: providerOrder.raw,
    });

    await auditLog.log({
      user_id: userId,
      action: 'payments.order.synced',
      resource_type: 'payment_order',
      resource_id: row.id,
      organization_id: orgId,
      ip_address: req.ip,
      user_agent: req.get('user-agent'),
      metadata: {
        merchant_order_id: row.merchant_order_id,
        provider_order_id: row.provider_order_id,
        status,
      },
    });

    return res.json({ success: true, data: sanitizePaymentOrder(row) });
  } catch (error: any) {
    return handleRouteError(res, error);
  }
});

router.post('/payments/orders/by-merchant/:merchantOrderId/sync', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    assertCashfreeConfigured();

    const orgId = getOrgId(req);
    const userId = getUserId(req);
    const userJwt = getUserJwt(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const existing = await getPaymentOrderByMerchantOrderId(req.params.merchantOrderId, orgId, userJwt);
    if (!existing) return res.status(404).json({ success: false, error: 'Payment order not found' });

    const providerOrder = await getCashfreeOrder(existing.merchant_order_id);
    const status = mapCashfreeOrderStatus(providerOrder.orderStatus);
    const paidAt = status === 'paid' ? existing.paid_at || new Date().toISOString() : null;

    const query = new URLSearchParams();
    query.set('id', eq(existing.id));
    query.set('organization_id', eq(orgId));

    const updated = (await supabaseRestAsUser(userJwt, 'payment_orders', query, {
      method: 'PATCH',
      body: {
        provider_order_id: providerOrder.cfOrderId || existing.provider_order_id || null,
        provider_payment_session_id: providerOrder.paymentSessionId || existing.provider_payment_session_id || null,
        provider_order_status: providerOrder.orderStatus,
        status,
        paid_at: paidAt,
        updated_at: new Date().toISOString(),
      },
    })) as any[];

    const row = updated?.[0];
    if (!row) throw new Error('Failed to update payment order');

    await logPaymentEvent({
      userJwt,
      organizationId: orgId,
      paymentOrderId: row.id,
      providerEventId: providerOrder.cfOrderId,
      eventType: 'cashfree.order.synced',
      eventStatus: status,
      payload: providerOrder.raw,
    });

    await auditLog.log({
      user_id: userId,
      action: 'payments.order.synced',
      resource_type: 'payment_order',
      resource_id: row.id,
      organization_id: orgId,
      ip_address: req.ip,
      user_agent: req.get('user-agent'),
      metadata: {
        merchant_order_id: row.merchant_order_id,
        provider_order_id: row.provider_order_id,
        status,
      },
    });

    return res.json({ success: true, data: sanitizePaymentOrder(row) });
  } catch (error: any) {
    return handleRouteError(res, error);
  }
});

export default router;