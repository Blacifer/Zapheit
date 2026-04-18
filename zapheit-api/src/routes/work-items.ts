import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { SupabaseRestError, eq, supabaseRestAsUser } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { auditLog } from '../lib/audit-logger';

const router = Router();

const getOrgId = (req: any): string | null => req.user?.organization_id || null;
const getUserId = (req: any): string | null => req.user?.id || null;
const getUserJwt = (req: any): string => {
  const jwt = req.userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

function safeError(res: Response, err: any, statusCode = 500) {
  const resolved = err instanceof SupabaseRestError ? err.status : statusCode;
  const message = err instanceof SupabaseRestError ? err.responseBody : (err?.message || 'Internal error');
  logger.error('Work-items route error', { status: resolved, message });
  return res.status(resolved).json({ success: false, error: message });
}

function nowIso() {
  return new Date().toISOString();
}

const listQuerySchema = z.object({
  status: z.string().optional(),
  stage: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

const supportTicketCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20000).optional(),
  priority: z.string().optional(),
  customer_email: z.string().email().optional(),
  tags: z.array(z.string()).optional(),
});

const salesLeadCreateSchema = z.object({
  company_name: z.string().min(1).max(200),
  contact_name: z.string().max(200).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().max(50).optional(),
  stage: z.string().optional(),
  score: z.number().int().min(0).max(10).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.record(z.any()).optional(),
});

const accessRequestCreateSchema = z.object({
  subject: z.string().min(1).max(200),
  requestor_email: z.string().email().optional(),
  system_name: z.string().max(200).optional(),
  requested_access: z.record(z.any()).optional(),
  justification: z.string().max(20000).optional(),
});

// =========================
// Support Tickets
// =========================
router.get('/support-tickets', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    if (parsed.data.status) query.set('status', eq(parsed.data.status));
    if (parsed.data.limit) query.set('limit', String(parsed.data.limit));

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'support_tickets', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.post('/support-tickets', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const parsed = supportTicketCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'support_tickets', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        title: parsed.data.title,
        description: parsed.data.description || null,
        priority: parsed.data.priority || 'medium',
        status: 'open',
        customer_email: parsed.data.customer_email || null,
        tags: parsed.data.tags || [],
        source: 'manual',
        created_by: userId,
        created_at: now,
        updated_at: now,
      },
    })) as any[];

    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create ticket' });

    await auditLog.log({
      user_id: userId,
      action: 'workitem.support_ticket.created',
      resource_type: 'support_ticket',
      resource_id: row.id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { title: row.title, priority: row.priority },
    });

    return res.status(201).json({ success: true, data: row });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// =========================
// Sales Leads
// =========================
router.get('/sales-leads', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    const stage = parsed.data.stage || parsed.data.status;
    if (stage) query.set('stage', eq(stage));
    if (parsed.data.limit) query.set('limit', String(parsed.data.limit));

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'sales_leads', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.post('/sales-leads', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const parsed = salesLeadCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'sales_leads', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        company_name: parsed.data.company_name,
        contact_name: parsed.data.contact_name || null,
        contact_email: parsed.data.contact_email || null,
        contact_phone: parsed.data.contact_phone || null,
        stage: parsed.data.stage || 'new',
        score: typeof parsed.data.score === 'number' ? parsed.data.score : 0,
        tags: parsed.data.tags || [],
        notes: parsed.data.notes || {},
        source: 'manual',
        created_by: userId,
        created_at: now,
        updated_at: now,
      },
    })) as any[];

    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create lead' });

    await auditLog.log({
      user_id: userId,
      action: 'workitem.sales_lead.created',
      resource_type: 'sales_lead',
      resource_id: row.id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { company_name: row.company_name, stage: row.stage, score: row.score },
    });

    return res.status(201).json({ success: true, data: row });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// =========================
// IT Access Requests
// =========================
router.get('/access-requests', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    if (parsed.data.status) query.set('status', eq(parsed.data.status));
    if (parsed.data.limit) query.set('limit', String(parsed.data.limit));

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'it_access_requests', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.post('/access-requests', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const parsed = accessRequestCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'it_access_requests', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        subject: parsed.data.subject,
        requestor_email: parsed.data.requestor_email || null,
        system_name: parsed.data.system_name || null,
        requested_access: parsed.data.requested_access || {},
        justification: parsed.data.justification || null,
        status: 'pending',
        source: 'manual',
        created_by: userId,
        created_at: now,
        updated_at: now,
      },
    })) as any[];

    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create access request' });

    await auditLog.log({
      user_id: userId,
      action: 'workitem.access_request.created',
      resource_type: 'it_access_request',
      resource_id: row.id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { subject: row.subject, system_name: row.system_name, status: row.status },
    });

    return res.status(201).json({ success: true, data: row });
  } catch (err: any) {
    return safeError(res, err);
  }
});

export default router;
