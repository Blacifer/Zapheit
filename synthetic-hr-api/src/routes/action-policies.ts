import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { SupabaseRestError, eq, supabaseRestAsUser } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { auditLog } from '../lib/audit-logger';
import { invalidateInterceptorCache } from '../lib/gateway-interceptors';

const router = Router();

const getOrgId = (req: any): string | null => req.user?.organization_id || null;
const getUserId = (req: any): string | null => req.user?.id || null;
const getUserJwt = (req: any): string => {
  const jwt = req.userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

function nowIso() {
  return new Date().toISOString();
}

function safeError(res: Response, err: any, statusCode = 500) {
  const resolved = err instanceof SupabaseRestError ? err.status : statusCode;
  const message = err instanceof SupabaseRestError ? err.responseBody : (err?.message || 'Internal error');
  logger.error('Action-policies route error', { status: resolved, message });
  return res.status(resolved).json({ success: false, error: message });
}

const listSchema = z.object({
  service: z.string().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

const routingRuleSchema = z.object({
  condition: z.string().max(500).nullable().optional(),
  required_role: z.enum(['viewer', 'manager', 'admin', 'super_admin']),
  required_user_id: z.string().uuid().nullable().optional(),
});

// Interceptor rules for __gateway__ service policies (patch_request, patch_response, route_model)
const interceptorRuleSchema = z.object({
  id: z.string().optional(),
  enabled: z.boolean().optional(),
  // For patch_request / patch_response:
  match_type: z.enum(['always', 'pii_detected', 'keyword', 'regex']).optional(),
  match_value: z.string().max(500).optional(),
  transform: z.enum(['redact_pii', 'replace', 'append_system', 'prepend_system']).optional(),
  find: z.string().max(500).optional(),
  replacement: z.string().max(500).optional(),
  text: z.string().max(2000).optional(),
  // For route_model conditions:
  condition: z.enum(['always', 'risk_score_above', 'monthly_cost_above']).optional(),
  threshold: z.number().min(0).optional(),
  target_model: z.string().max(200).optional(),
}).passthrough();

const upsertSchema = z.object({
  service: z.string().min(1).max(50),
  action: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
  require_approval: z.boolean().optional(),
  required_role: z.enum(['viewer', 'manager', 'admin', 'super_admin']).optional(),
  webhook_allowlist: z.array(z.string()).optional(),
  routing_rules: z.array(routingRuleSchema).max(20).optional(),
  interceptor_rules: z.array(interceptorRuleSchema).max(50).optional(),
  notes: z.string().max(5000).optional(),
});

router.get('/', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'updated_at.desc');
    if (parsed.data.service) q.set('service', eq(parsed.data.service));
    if (parsed.data.action) q.set('action', eq(parsed.data.action));
    if (parsed.data.limit) q.set('limit', String(parsed.data.limit));

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'action_policies', q)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.put('/', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const parsed = upsertSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const existingQ = new URLSearchParams();
    existingQ.set('organization_id', eq(orgId));
    existingQ.set('service', eq(parsed.data.service));
    existingQ.set('action', eq(parsed.data.action));
    existingQ.set('select', '*');
    const existing = (await supabaseRestAsUser(getUserJwt(req), 'action_policies', existingQ)) as any[];
    const row = existing?.[0] || null;

    const now = nowIso();
    const payload = {
      ...(typeof parsed.data.enabled === 'boolean' ? { enabled: parsed.data.enabled } : {}),
      ...(typeof parsed.data.require_approval === 'boolean' ? { require_approval: parsed.data.require_approval } : {}),
      ...(parsed.data.required_role ? { required_role: parsed.data.required_role } : {}),
      ...(parsed.data.webhook_allowlist ? { webhook_allowlist: parsed.data.webhook_allowlist } : {}),
      ...(typeof parsed.data.notes === 'string' ? { notes: parsed.data.notes } : {}),
      ...(parsed.data.routing_rules !== undefined ? { routing_rules: parsed.data.routing_rules } : {}),
      ...(parsed.data.interceptor_rules !== undefined ? { interceptor_rules: parsed.data.interceptor_rules } : {}),
      updated_by: userId,
      updated_at: now,
    };

    if (row?.id) {
      const patchQ = new URLSearchParams();
      patchQ.set('id', eq(row.id));
      patchQ.set('organization_id', eq(orgId));
      const patched = (await supabaseRestAsUser(getUserJwt(req), 'action_policies', patchQ, {
        method: 'PATCH',
        body: payload,
      })) as any[];
      const updated = patched?.[0] || null;
      if (!updated) return res.status(500).json({ success: false, error: 'Failed to update action policy' });

      await auditLog.log({
        user_id: userId,
        action: 'action_policy.updated',
        resource_type: 'action_policy',
        resource_id: updated.id,
        organization_id: orgId,
        ip_address: req.ip || (req.socket as any)?.remoteAddress,
        user_agent: req.get('user-agent') || undefined,
        metadata: { service: updated.service, action: updated.action, enabled: updated.enabled, required_role: updated.required_role },
      });

      if (parsed.data.service === '__gateway__') invalidateInterceptorCache(orgId);
      return res.json({ success: true, data: updated });
    }

    const created = (await supabaseRestAsUser(getUserJwt(req), 'action_policies', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        service: parsed.data.service,
        action: parsed.data.action,
        enabled: typeof parsed.data.enabled === 'boolean' ? parsed.data.enabled : true,
        require_approval: typeof parsed.data.require_approval === 'boolean' ? parsed.data.require_approval : true,
        required_role: parsed.data.required_role || 'manager',
        webhook_allowlist: parsed.data.webhook_allowlist || [],
        notes: typeof parsed.data.notes === 'string' ? parsed.data.notes : null,
        routing_rules: parsed.data.routing_rules || [],
        interceptor_rules: parsed.data.interceptor_rules || [],
        updated_by: userId,
        updated_at: now,
      },
    })) as any[];

    const createdRow = created?.[0] || null;
    if (!createdRow) return res.status(500).json({ success: false, error: 'Failed to create action policy' });

    await auditLog.log({
      user_id: userId,
      action: 'action_policy.created',
      resource_type: 'action_policy',
      resource_id: createdRow.id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { service: createdRow.service, action: createdRow.action, enabled: createdRow.enabled, required_role: createdRow.required_role },
    });

    if (parsed.data.service === '__gateway__') invalidateInterceptorCache(orgId);
    return res.status(201).json({ success: true, data: createdRow });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.delete('/:id', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'id is required' });

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));

    await supabaseRestAsUser(getUserJwt(req), 'action_policies', q, { method: 'DELETE' });

    await auditLog.log({
      user_id: userId,
      action: 'action_policy.deleted',
      resource_type: 'action_policy',
      resource_id: id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: {},
    });

    return res.json({ success: true, data: { id } });
  } catch (err: any) {
    return safeError(res, err);
  }
});

export default router;

