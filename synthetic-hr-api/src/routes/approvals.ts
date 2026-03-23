import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { eq, supabaseRestAsUser, supabaseRestAsService } from '../lib/supabase-rest'; // supabaseRestAsService used for routing rule policy lookup
import { logger } from '../lib/logger';
import { auditLog } from '../lib/audit-logger';
import { fireAndForgetWebhookEvent } from '../lib/webhook-relay';
import { errorResponse, getOrgId, getUserJwt, safeLimit } from '../lib/route-helpers';
import { notifySlackApproval } from '../lib/slack-notify';
import { notifyApprovalAssignedAsync } from '../lib/notification-service';

const router = Router();

const ROLE_ORDER: Record<string, number> = {
  viewer: 0,
  manager: 1,
  admin: 2,
  super_admin: 3,
};

function canReview(userRole: string, requiredRole: string): boolean {
  return (ROLE_ORDER[userRole] ?? -1) >= (ROLE_ORDER[requiredRole] ?? 999);
}

// ─── Routing rule helpers ──────────────────────────────────────────────────

type RoutingRule = {
  condition?: string | null;
  required_role: string;
  required_user_id?: string | null;
};

/**
 * Evaluate a simple condition string against action_payload.
 * Supported formats:
 *   amount > 5000
 *   status == pending
 *   description contains urgent
 *   (null/empty → always matches)
 */
function evaluateCondition(condition: string | null | undefined, payload: Record<string, any>): boolean {
  if (!condition) return true;
  const trimmed = condition.trim();
  if (!trimmed) return true;

  // Parse: <field> <operator> <value>
  const match = trimmed.match(/^(\w[\w.]*)\s*(>=|<=|===|!==|==|!=|>|<|contains)\s*(.+)$/);
  if (!match) return true; // Unknown format → allow (fail open)

  const [, fieldPath, operator, rawValue] = match;

  // Resolve field (supports dot notation one level deep)
  const fieldValue = fieldPath.split('.').reduce((obj: any, key: string) => obj?.[key], payload);
  const strValue = rawValue.trim().replace(/^['"]|['"]$/g, ''); // strip quotes
  const numValue = parseFloat(strValue);

  switch (operator) {
    case '>':   return parseFloat(String(fieldValue)) > numValue;
    case '<':   return parseFloat(String(fieldValue)) < numValue;
    case '>=':  return parseFloat(String(fieldValue)) >= numValue;
    case '<=':  return parseFloat(String(fieldValue)) <= numValue;
    case '===':
    case '==':  return String(fieldValue).toLowerCase() === strValue.toLowerCase();
    case '!==':
    case '!=':  return String(fieldValue).toLowerCase() !== strValue.toLowerCase();
    case 'contains': return String(fieldValue ?? '').toLowerCase().includes(strValue.toLowerCase());
    default:    return true;
  }
}

function applyRoutingRules(
  rules: RoutingRule[],
  payload: Record<string, any>,
  defaultRole: string,
): { required_role: string; assigned_to: string | null } {
  for (const rule of rules) {
    if (evaluateCondition(rule.condition, payload)) {
      return {
        required_role: rule.required_role || defaultRole,
        assigned_to: rule.required_user_id || null,
      };
    }
  }
  return { required_role: defaultRole, assigned_to: null };
}

const listSchema = z.object({
  status: z.string().optional(),
  agent_id: z.string().uuid().optional(),
  service: z.string().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

const createSchema = z.object({
  agent_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
  action_policy_id: z.string().uuid().optional(),
  service: z.string().min(1).max(50),
  action: z.string().min(1).max(200),
  action_payload: z.record(z.unknown()).optional().default({}),
  requested_by: z.string().max(255).optional().default('agent'),
  required_role: z.enum(['viewer', 'manager', 'admin', 'super_admin']).optional().default('manager'),
  expires_in_hours: z.number().min(1).max(168).optional().default(24),
  // Optionally override assigned approver (routing rules auto-set this)
  assigned_to: z.string().uuid().optional().nullable(),
});

const reviewSchema = z.object({
  note: z.string().max(2000).optional(),
});

// GET / — list approval requests
router.get('/', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });

    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'created_at.desc');
    q.set('limit', String(safeLimit(parsed.data?.limit ?? 100)));
    if (parsed.data?.status) q.set('status', eq(parsed.data.status));
    if (parsed.data?.agent_id) q.set('agent_id', eq(parsed.data.agent_id));
    if (parsed.data?.service) q.set('service', eq(parsed.data.service));
    if (parsed.data?.action) q.set('action', eq(parsed.data.action));

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', q)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// POST / — create approval request
router.post('/', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = req.user?.id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = createSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });

    const {
      agent_id, conversation_id, action_policy_id,
      service, action, action_payload, requested_by,
      required_role: baseRole, expires_in_hours,
    } = parsed.data;

    // Apply routing rules from the linked action policy (if any).
    let effectiveRole = baseRole;
    let assignedTo: string | null = parsed.data.assigned_to || null;

    if (action_policy_id) {
      try {
        const policyQ = new URLSearchParams();
        policyQ.set('id', eq(action_policy_id));
        policyQ.set('organization_id', eq(orgId));
        policyQ.set('select', 'required_role,routing_rules');
        policyQ.set('limit', '1');
        const policies = (await supabaseRestAsService('action_policies', policyQ)) as Array<{ required_role: string; routing_rules: RoutingRule[] }>;
        const policy = policies?.[0];
        if (policy) {
          const resolved = applyRoutingRules(
            policy.routing_rules || [],
            (action_payload as Record<string, any>) || {},
            policy.required_role || baseRole,
          );
          effectiveRole = resolved.required_role as typeof baseRole;
          if (!assignedTo) assignedTo = resolved.assigned_to;
        }
      } catch (err: any) {
        logger.warn('[approvals] Failed to evaluate routing rules', { action_policy_id, error: err?.message });
      }
    }

    const expiresAt = new Date(Date.now() + expires_in_hours * 3600 * 1000).toISOString();
    const now = new Date().toISOString();

    const created = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        ...(agent_id ? { agent_id } : {}),
        ...(conversation_id ? { conversation_id } : {}),
        ...(action_policy_id ? { action_policy_id } : {}),
        service,
        action,
        action_payload: action_payload || {},
        requested_by,
        status: 'pending',
        required_role: effectiveRole,
        ...(assignedTo ? { assigned_to: assignedTo } : {}),
        expires_at: expiresAt,
        created_at: now,
        updated_at: now,
      },
    })) as any[];

    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create approval request' });

    logger.info('Approval request created', { approval_id: row.id, service, action, org_id: orgId, assigned_to: assignedTo });

    auditLog.log({
      user_id: userId || 'system',
      action: 'approval_request.created',
      resource_type: 'approval_request',
      resource_id: row.id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { service, action, requested_by, required_role: effectiveRole, assigned_to: assignedTo },
    });

    // Notify assigned approver via Slack if routing rules specified one.
    if (assignedTo) {
      notifyApprovalAssignedAsync({ organizationId: orgId, assignedToUserId: assignedTo, service, action, referenceId: row.id });
    }

    fireAndForgetWebhookEvent(orgId, 'approval.requested', {
      id: `evt_approval_${row.id}`,
      type: 'approval.requested',
      created_at: now,
      organization_id: orgId,
      data: {
        approval_id: row.id,
        agent_id: agent_id || null,
        service,
        action,
        requested_by,
        required_role: effectiveRole,
        assigned_to: assignedTo,
        expires_at: expiresAt,
      },
    });

    void notifySlackApproval(orgId, {
      approvalId: row.id,
      action: `${service}.${action}`,
      agentName: agent_id || undefined,
      requestedBy: requested_by || undefined,
      details: req.body?.details || undefined,
    });

    return res.status(201).json({ success: true, data: row });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// POST /:id/approve
router.post('/:id/approve', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = req.user?.id;
    const userRole = req.user?.role || 'viewer';
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'id is required' });

    const parsed = reviewSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', q)) as any[];
    const row = rows?.[0];

    if (!row) return res.status(404).json({ success: false, error: 'Approval request not found' });
    if (row.status !== 'pending') return res.status(409).json({ success: false, error: `Cannot approve a request with status "${row.status}"` });
    if (row.assigned_to && row.assigned_to !== userId) {
      return res.status(403).json({ success: false, error: 'This approval is assigned to a specific reviewer — only they can approve it' });
    }
    if (new Date(row.expires_at) < new Date()) {
      const expQ = new URLSearchParams();
      expQ.set('id', eq(id));
      expQ.set('organization_id', eq(orgId));
      await supabaseRestAsUser(getUserJwt(req), 'approval_requests', expQ, {
        method: 'PATCH',
        body: { status: 'expired', updated_at: new Date().toISOString() },
      });
      return res.status(409).json({ success: false, error: 'This approval request has expired' });
    }
    if (!canReview(userRole, row.required_role)) {
      return res.status(403).json({ success: false, error: `Approving this request requires role "${row.required_role}" or higher` });
    }

    const now = new Date().toISOString();
    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(id));
    patchQ.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', patchQ, {
      method: 'PATCH',
      body: {
        status: 'approved',
        reviewer_id: userId,
        reviewer_note: parsed.data?.note || null,
        reviewed_at: now,
        updated_at: now,
      },
    })) as any[];

    logger.info('Approval request approved', { approval_id: id, reviewer_id: userId, org_id: orgId });

    auditLog.log({
      user_id: userId,
      action: 'approval_request.approved',
      resource_type: 'approval_request',
      resource_id: id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { service: row.service, action: row.action, note: parsed.data?.note },
    });

    fireAndForgetWebhookEvent(orgId, 'approval.completed', {
      id: `evt_approval_resolve_${id}`,
      type: 'approval.completed',
      created_at: now,
      organization_id: orgId,
      data: {
        approval_id: id,
        decision: 'approved',
        reviewer_id: userId,
        service: row.service,
        action: row.action,
      },
    });

    return res.json({ success: true, data: updated?.[0] || row });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// POST /:id/deny
router.post('/:id/deny', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = req.user?.id;
    const userRole = req.user?.role || 'viewer';
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'id is required' });

    const parsed = reviewSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', q)) as any[];
    const row = rows?.[0];

    if (!row) return res.status(404).json({ success: false, error: 'Approval request not found' });
    if (row.status !== 'pending') return res.status(409).json({ success: false, error: `Cannot deny a request with status "${row.status}"` });
    if (row.assigned_to && row.assigned_to !== userId) {
      return res.status(403).json({ success: false, error: 'This approval is assigned to a specific reviewer — only they can deny it' });
    }
    if (!canReview(userRole, row.required_role)) {
      return res.status(403).json({ success: false, error: `Denying this request requires role "${row.required_role}" or higher` });
    }

    const now = new Date().toISOString();
    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(id));
    patchQ.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', patchQ, {
      method: 'PATCH',
      body: {
        status: 'denied',
        reviewer_id: userId,
        reviewer_note: parsed.data?.note || null,
        reviewed_at: now,
        updated_at: now,
      },
    })) as any[];

    logger.info('Approval request denied', { approval_id: id, reviewer_id: userId, org_id: orgId });

    auditLog.log({
      user_id: userId,
      action: 'approval_request.denied',
      resource_type: 'approval_request',
      resource_id: id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { service: row.service, action: row.action, note: parsed.data?.note },
    });

    fireAndForgetWebhookEvent(orgId, 'approval.completed', {
      id: `evt_approval_resolve_${id}`,
      type: 'approval.completed',
      created_at: now,
      organization_id: orgId,
      data: {
        approval_id: id,
        decision: 'denied',
        reviewer_id: userId,
        service: row.service,
        action: row.action,
      },
    });

    return res.json({ success: true, data: updated?.[0] || row });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// POST /:id/cancel
router.post('/:id/cancel', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = req.user?.id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'id is required' });

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', q)) as any[];
    const row = rows?.[0];

    if (!row) return res.status(404).json({ success: false, error: 'Approval request not found' });
    if (row.status !== 'pending') return res.status(409).json({ success: false, error: `Cannot cancel a request with status "${row.status}"` });

    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(id));
    patchQ.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', patchQ, {
      method: 'PATCH',
      body: { status: 'cancelled', updated_at: new Date().toISOString() },
    })) as any[];

    auditLog.log({
      user_id: userId || 'system',
      action: 'approval_request.cancelled',
      resource_type: 'approval_request',
      resource_id: id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: {},
    });

    return res.json({ success: true, data: updated?.[0] || row });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

export default router;
