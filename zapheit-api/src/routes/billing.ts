/**
 * Billing routes — Cashfree checkout + plan status
 *
 * POST /billing/checkout  — create a Cashfree payment order for a plan upgrade
 * GET  /billing/status    — current plan, quota usage, payment history
 * GET  /billing/verify/:orderId — poll payment status after Cashfree redirect
 */
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { createCashfreeOrder, getCashfreeOrder, mapCashfreeOrderStatus, CashfreeConfigError } from '../lib/cashfree';
import { supabaseRest, supabaseRestAsService, eq } from '../lib/supabase-rest';
import { errorResponse, getOrgId } from '../lib/route-helpers';
import { logger } from '../lib/logger';
import { auditLog } from '../lib/audit-logger';

const router = express.Router();

// ── Plan catalog ──────────────────────────────────────────────────────────────

const PLANS = {
  pro_monthly:      { name: 'Pro',      cycle: 'monthly', amountINR: 4_999,   planCode: 'pro' },
  pro_annual:       { name: 'Pro',      cycle: 'annual',  amountINR: 49_999,  planCode: 'pro' },
  business_monthly: { name: 'Business', cycle: 'monthly', amountINR: 19_999,  planCode: 'business' },
  business_annual:  { name: 'Business', cycle: 'annual',  amountINR: 1_99_999, planCode: 'business' },
} as const;

type OfferCode = keyof typeof PLANS;

const checkoutSchema = z.object({
  offer_code:    z.enum(['pro_monthly', 'pro_annual', 'business_monthly', 'business_annual']),
  customer_name:  z.string().min(1).max(255),
  customer_email: z.string().email(),
  customer_phone: z.string().min(10).max(15),
  company_name:   z.string().max(255).optional(),
  return_url:     z.string().url().optional(),
});

function generateMerchantOrderId(orgId: string, offerCode: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  const orgSuffix = orgId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `ZPH-${orgSuffix}-${offerCode.slice(0, 4).toUpperCase()}-${ts}`;
}

// ── POST /billing/checkout ────────────────────────────────────────────────────

router.post('/billing/checkout', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    }

    const orgId = getOrgId(req);
    const userId = req.user?.id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const { offer_code, customer_name, customer_email, customer_phone, company_name, return_url } = parsed.data;
    const plan = PLANS[offer_code as OfferCode];
    const merchantOrderId = generateMerchantOrderId(orgId, offer_code);

    const apiBase = process.env.API_BASE_URL || 'https://api.zapheit.com';
    const uiBase = process.env.FRONTEND_URL || 'https://app.zapheit.com';

    const order = await createCashfreeOrder({
      merchantOrderId,
      amount: plan.amountINR,
      currency: 'INR',
      customer: {
        customerId: orgId,
        customerName: customer_name,
        customerEmail: customer_email,
        customerPhone: customer_phone,
      },
      returnUrl: return_url || `${uiBase}/dashboard/billing/success?order_id=${merchantOrderId}`,
      notifyUrl: `${apiBase}/webhooks/cashfree`,
      note: `Zapheit ${plan.name} (${plan.cycle})`,
    });

    // Persist payment order record
    await supabaseRestAsService('payment_orders', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        created_by: userId || null,
        provider: 'cashfree',
        offer_code,
        offer_name: `Zapheit ${plan.name} — ${plan.cycle === 'annual' ? 'Annual' : 'Monthly'}`,
        merchant_order_id: merchantOrderId,
        provider_order_id: order.cfOrderId || null,
        provider_payment_session_id: order.paymentSessionId || null,
        provider_order_status: order.orderStatus || null,
        status: 'created',
        currency: 'INR',
        amount: plan.amountINR,
        customer_name,
        customer_email,
        customer_phone,
        company_name: company_name || null,
        return_url: return_url || null,
        metadata: { plan_code: plan.planCode, cycle: plan.cycle },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      headers: { Prefer: 'return=representation' },
    });

    await auditLog.log({
      user_id: userId || '',
      action: 'billing.checkout.initiated',
      resource_type: 'payment_order',
      resource_id: merchantOrderId,
      organization_id: orgId,
      metadata: { offer_code, amount: plan.amountINR },
    });

    // Cashfree hosted checkout URL
    const env = process.env.CASHFREE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
    const checkoutBase = env === 'production'
      ? 'https://payments.cashfree.com/forms'
      : 'https://payments-test.cashfree.com/forms';

    return res.json({
      success: true,
      data: {
        merchant_order_id: merchantOrderId,
        payment_session_id: order.paymentSessionId,
        checkout_url: order.paymentSessionId ? `${checkoutBase}/${order.paymentSessionId}` : null,
        amount: plan.amountINR,
        offer_name: `Zapheit ${plan.name} — ${plan.cycle === 'annual' ? 'Annual' : 'Monthly'}`,
      },
    });
  } catch (err: any) {
    if (err instanceof CashfreeConfigError) {
      logger.error('Cashfree not configured', { error: err.message });
      return res.status(503).json({ success: false, error: 'Payment gateway not configured. Contact support@zapheit.com.' });
    }
    logger.error('Billing checkout failed', { error: err?.message });
    errorResponse(res, err);
  }
});

// ── GET /billing/status ───────────────────────────────────────────────────────

router.get('/billing/status', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const orgRows = await supabaseRest('organizations', `id=eq.${orgId}&select=plan,plan_tier,grace_period_ends_at`, { method: 'GET' }) as any[];
    const org = orgRows?.[0];

    const orderQuery = new URLSearchParams();
    orderQuery.set('organization_id', eq(orgId));
    orderQuery.set('order', 'created_at.desc');
    orderQuery.set('limit', '5');
    const orders = await supabaseRest('payment_orders', orderQuery.toString(), { method: 'GET' }) as any[];

    return res.json({
      success: true,
      data: {
        plan: org?.plan || 'free',
        plan_tier: org?.plan_tier || {},
        grace_period_ends_at: org?.grace_period_ends_at || null,
        recent_orders: Array.isArray(orders) ? orders.map(o => ({
          id: o.id,
          merchant_order_id: o.merchant_order_id,
          offer_name: o.offer_name,
          amount: o.amount,
          status: o.status,
          paid_at: o.paid_at,
          created_at: o.created_at,
        })) : [],
      },
    });
  } catch (err: any) {
    errorResponse(res, err);
  }
});

// ── GET /billing/verify/:orderId ──────────────────────────────────────────────

router.get('/billing/verify/:orderId', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const merchantOrderId = req.params.orderId;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    // Check DB first (webhook may have already updated it)
    const dbQuery = new URLSearchParams();
    dbQuery.set('merchant_order_id', eq(merchantOrderId));
    dbQuery.set('organization_id', eq(orgId));
    dbQuery.set('limit', '1');
    const rows = await supabaseRest('payment_orders', dbQuery.toString(), { method: 'GET' }) as any[];
    const dbOrder = rows?.[0];

    if (dbOrder?.status === 'paid') {
      return res.json({ success: true, data: { status: 'paid', plan: dbOrder.metadata?.plan_code || 'pro' } });
    }

    // Fallback: poll Cashfree directly
    try {
      const cfOrder = await getCashfreeOrder(merchantOrderId);
      const status = mapCashfreeOrderStatus(cfOrder.orderStatus);

      if (status === 'paid' && dbOrder?.id) {
        // Activate plan immediately (webhook may be delayed)
        const offerCode = dbOrder.offer_code as OfferCode;
        const planCode = PLANS[offerCode]?.planCode || 'pro';
        await activatePlan(orgId, planCode, merchantOrderId);
      }

      return res.json({ success: true, data: { status, plan: dbOrder?.metadata?.plan_code || null } });
    } catch (cfErr: any) {
      logger.warn('Cashfree order poll failed', { merchantOrderId, error: cfErr?.message });
      return res.json({ success: true, data: { status: dbOrder?.status || 'pending', plan: null } });
    }
  } catch (err: any) {
    errorResponse(res, err);
  }
});

// ── Plan activation helper (also exported for webhook use) ────────────────────

export async function activatePlan(orgId: string, planCode: string, merchantOrderId: string): Promise<void> {
  try {
    const orgQuery = new URLSearchParams();
    orgQuery.set('id', eq(orgId));
    await supabaseRestAsService('organizations', orgQuery.toString(), {
      method: 'PATCH',
      body: {
        plan: planCode,
        grace_period_ends_at: null,
        updated_at: new Date().toISOString(),
      },
    });

    const orderQuery = new URLSearchParams();
    orderQuery.set('merchant_order_id', eq(merchantOrderId));
    orderQuery.set('organization_id', eq(orgId));
    await supabaseRestAsService('payment_orders', orderQuery.toString(), {
      method: 'PATCH',
      body: { status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    });

    logger.info('Plan activated', { orgId, planCode, merchantOrderId });
  } catch (err: any) {
    logger.error('Plan activation failed', { orgId, planCode, merchantOrderId, error: err?.message });
    throw err;
  }
}

export default router;
