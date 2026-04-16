import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { eq, in_, supabaseRestAsUser, supabaseRestAsService } from '../lib/supabase-rest'; // supabaseRestAsService used for routing rule policy lookup
import { logger } from '../lib/logger';
import { auditLog } from '../lib/audit-logger';
import { fireAndForgetWebhookEvent } from '../lib/webhook-relay';
import { errorResponse, getOrgId, getUserJwt, safeLimit } from '../lib/route-helpers';
import { notifySlackApproval } from '../lib/slack-notify';
import { notifyApprovalAssignedAsync } from '../lib/notification-service';
import { storeCorrection } from '../lib/correction-memory';
import { markApprovalDeniedExecution, resumeApprovedToolCall } from '../lib/agentic-tool-execution';
import { sendTransactionalEmail } from '../lib/email';
import {
  buildApprovalSummaryFromApprovalRequest,
  buildApprovalSummaryFromJobApproval,
  buildGovernedExecutionSummary,
  mapJobStatusToGovernedStatus,
  normalizeApprovalStatus,
} from '../lib/governed-workflow';

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

// ─── Risk Scoring ──────────────────────────────────────────────────────────

const PII_PATTERNS = [/\b[\w.+-]+@[\w-]+\.\w{2,}\b/i, /\b\d{3}-\d{2}-\d{4}\b/, /\b\d{10,12}\b/];
const HIGH_RISK_ACTIONS = ['terminate', 'delete', 'dismiss', 'deny', 'reject', 'remove', 'ban', 'revoke'];

function computeApprovalRiskScore(payload: Record<string, any>, service: string, action: string): number {
  let score = 0.2; // baseline

  // Amount-based risk
  const amount = Number(payload?.amount ?? payload?.value ?? 0);
  if (amount > 100000) score += 0.4;
  else if (amount > 10000) score += 0.25;
  else if (amount > 1000) score += 0.1;

  // High-risk action keywords
  const actionLower = action.toLowerCase();
  if (HIGH_RISK_ACTIONS.some(k => actionLower.includes(k))) score += 0.3;

  // PII in payload
  const payloadStr = JSON.stringify(payload);
  if (PII_PATTERNS.some(p => p.test(payloadStr))) score += 0.2;

  // Unknown/untrusted service
  const knownServices = ['zendesk', 'slack', 'razorpay', 'stripe', 'github', 'jira', 'hubspot'];
  if (!knownServices.includes(service.toLowerCase())) score += 0.1;

  return Math.min(1, Math.round(score * 1000) / 1000);
}

function roleForRiskScore(score: number): string {
  if (score >= 0.7) return 'admin';
  if (score >= 0.4) return 'manager';
  return 'viewer';
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

function approvalReasonModel(row: any): {
  reason_category?: 'policy_blocked' | 'approval_required' | 'reliability_degraded' | 'execution_failed' | null;
  reason_message?: string | null;
  recommended_next_action?: string | null;
} {
  if (row.status === 'pending') {
    return {
      reason_category: 'approval_required',
      reason_message: 'Human approval is required before execution can continue.',
      recommended_next_action: 'Review payload, then approve, deny, or escalate this request.',
    };
  }
  if (row.status === 'denied') {
    return {
      reason_category: 'policy_blocked',
      reason_message: row.reviewer_note || 'Request was denied by the assigned reviewer.',
      recommended_next_action: 'Adjust policy or payload and create a new governed request if needed.',
    };
  }
  if (row.status === 'expired') {
    return {
      reason_category: 'execution_failed',
      reason_message: 'Approval window expired before a decision was recorded.',
      recommended_next_action: 'Create a new approval request and route it to the correct reviewer.',
    };
  }
  if (row.status === 'cancelled') {
    return {
      reason_category: 'execution_failed',
      reason_message: 'Approval request was cancelled before completion.',
      recommended_next_action: 'Recreate the request only if the action is still required.',
    };
  }
  return {
    reason_category: null,
    reason_message: null,
    recommended_next_action: null,
  };
}

function jobApprovalReasonModel(row: any): {
  reason_category?: 'policy_blocked' | 'approval_required' | 'reliability_degraded' | 'execution_failed' | null;
  reason_message?: string | null;
  recommended_next_action?: string | null;
} {
  const status = normalizeApprovalStatus(row.status);
  if (status === 'pending') {
    return {
      reason_category: 'approval_required',
      reason_message: 'Human approval is required before this governed execution can continue.',
      recommended_next_action: 'Review the request details, then approve or deny the governed job.',
    };
  }
  if (status === 'denied') {
    return {
      reason_category: 'policy_blocked',
      reason_message: row.reviewer_note || 'The governed job was denied by a reviewer.',
      recommended_next_action: 'Adjust the payload or policy and submit a new governed execution if needed.',
    };
  }
  return {
    reason_category: null,
    reason_message: null,
    recommended_next_action: null,
  };
}

function decorateApprovalRequest(row: any, execution: any = null) {
  const approvalSummary = buildApprovalSummaryFromApprovalRequest(row, null);
  const governedExecution = buildGovernedExecutionSummary({
    approval: row,
    execution,
    approvalSummary,
  });
  return {
    ...row,
    ...approvalReasonModel(row),
    approval_source: approvalSummary.approval_source,
    decision_at: approvalSummary.decision_at,
    approver: approvalSummary.approver,
    job_id: approvalSummary.job_id,
    source: approvalSummary.source,
    source_ref: approvalSummary.source_ref,
    governance_status: governedExecution.status,
    approval_summary: approvalSummary,
    governed_execution: governedExecution,
    audit_ref: governedExecution.audit_ref,
    cost_status: governedExecution.cost_status,
    incident_ref: governedExecution.incident_ref,
  };
}

function decorateJobApproval(job: any, approval: any) {
  const connector = job?.input?.connector && typeof job.input.connector === 'object' ? job.input.connector : {};
  const approvalSummary = buildApprovalSummaryFromJobApproval(approval, job);
  const governedExecution = buildGovernedExecutionSummary({
    job,
    approval,
    approvalSummary,
  });
  const history = Array.isArray(approval?.approval_history) ? approval.approval_history : [];
  const latestDecision = history.length ? history[history.length - 1] : null;
  return {
    id: approval.id,
    organization_id: job.organization_id,
    agent_id: job.agent_id || null,
    conversation_id: null,
    action_policy_id: approval?.policy_snapshot?.connector_policy?.policy_id || null,
    service: String(connector.service || '').trim() || 'connector',
    action: String(connector.action || '').trim() || 'connector_action',
    action_payload: connector.params && typeof connector.params === 'object' ? connector.params : {},
    requested_by: approval.requested_by || job.created_by || 'agent',
    status: approvalSummary.status,
    required_role: approvalSummary.required_role || 'manager',
    assigned_to: approval?.policy_snapshot?.assigned_to || null,
    risk_score: null,
    sla_deadline: null,
    reviewer_id: approval.approved_by || latestDecision?.reviewer_id || null,
    reviewer_note: null,
    expires_at: approval.created_at || job.created_at,
    reviewed_at: approval.decided_at || latestDecision?.decided_at || null,
    created_at: approval.created_at || job.created_at,
    updated_at: approval.decided_at || job.finished_at || job.started_at || job.created_at,
    ...jobApprovalReasonModel(approval),
    approval_source: approvalSummary.approval_source,
    decision_at: approvalSummary.decision_at,
    approver: approvalSummary.approver,
    job_id: approvalSummary.job_id,
    source: approvalSummary.source,
    source_ref: approvalSummary.source_ref,
    governance_status: governedExecution.status,
    approval_summary: approvalSummary,
    governed_execution: governedExecution,
    audit_ref: governedExecution.audit_ref,
    cost_status: governedExecution.cost_status,
    incident_ref: governedExecution.incident_ref,
  };
}

async function loadApprovalExecutions(orgId: string, approvalIds: string[]) {
  if (!approvalIds.length) return new Map<string, any>();
  const executionQuery = new URLSearchParams();
  executionQuery.set('organization_id', eq(orgId));
  executionQuery.set('approval_id', in_(approvalIds));
  executionQuery.set('select', 'id,approval_id,connector_id,action,policy_snapshot,result,requested_by,success,error_message');
  executionQuery.set('order', 'created_at.desc');
  const rows = (await supabaseRestAsService('connector_action_executions', executionQuery).catch(() => [])) as any[];
  const byApprovalId = new Map<string, any>();
  for (const row of rows || []) {
    if (row?.approval_id && !byApprovalId.has(row.approval_id)) {
      byApprovalId.set(row.approval_id, row);
    }
  }
  return byApprovalId;
}

async function loadJobApprovalsForOrg(req: Request, orgId: string, status?: string, limit = 100, filters?: { service?: string; action?: string }) {
  const jobsQuery = new URLSearchParams();
  jobsQuery.set('organization_id', eq(orgId));
  jobsQuery.set('type', eq('connector_action'));
  jobsQuery.set('select', '*');
  jobsQuery.set('order', 'created_at.desc');
  jobsQuery.set('limit', String(limit));
  if (status === 'pending') jobsQuery.set('status', eq('pending_approval'));
  if (status === 'denied') jobsQuery.set('status', eq('canceled'));

  const jobs = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', jobsQuery).catch(() => [])) as any[];
  if (!jobs.length) return [];

  const approvalsQuery = new URLSearchParams();
  approvalsQuery.set('job_id', in_(jobs.map((job: any) => job.id)));
  approvalsQuery.set('select', '*');
  approvalsQuery.set('order', 'created_at.desc');
  const approvals = (await supabaseRestAsUser(getUserJwt(req), 'agent_job_approvals', approvalsQuery).catch(() => [])) as any[];
  const approvalByJobId = new Map<string, any>();
  for (const approval of approvals || []) {
    if (approval?.job_id && !approvalByJobId.has(approval.job_id)) approvalByJobId.set(approval.job_id, approval);
  }

  return jobs
    .map((job: any) => {
      const approval = approvalByJobId.get(job.id);
      if (!approval) return null;
      const normalizedStatus = normalizeApprovalStatus(approval.status);
      if (status && normalizedStatus !== status) return null;
      const decorated = decorateJobApproval(job, approval);
      if (filters?.service && decorated.service !== filters.service) return null;
      if (filters?.action && decorated.action !== filters.action) return null;
      return decorated;
    })
    .filter(Boolean);
}

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
    const executionsByApprovalId = await loadApprovalExecutions(
      orgId,
      (rows || []).map((row: any) => String(row.id || '')).filter(Boolean),
    );
    const enriched = (rows || []).map((row: any) => decorateApprovalRequest(row, executionsByApprovalId.get(row.id) || null));
    const jobApprovals = await loadJobApprovalsForOrg(req, orgId, parsed.data?.status, safeLimit(parsed.data?.limit ?? 100), {
      service: parsed.data?.service,
      action: parsed.data?.action,
    });
    const merged = [...enriched, ...jobApprovals]
      .sort((a: any, b: any) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
      .slice(0, safeLimit(parsed.data?.limit ?? 100));
    return res.json({ success: true, data: merged, count: merged.length });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// GET /:id — fetch a single approval request
router.get('/:id', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'id is required' });

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', q)) as any[];
    if (rows?.length) {
      const executionsByApprovalId = await loadApprovalExecutions(orgId, [id]);
      const row = decorateApprovalRequest(rows[0], executionsByApprovalId.get(id) || null);
      return res.json({ success: true, data: row });
    }

    const jobApprovalQuery = new URLSearchParams();
    jobApprovalQuery.set('id', eq(id));
    jobApprovalQuery.set('select', '*');
    jobApprovalQuery.set('limit', '1');
    const jobApprovalRows = (await supabaseRestAsUser(getUserJwt(req), 'agent_job_approvals', jobApprovalQuery).catch(() => [])) as any[];
    const approval = jobApprovalRows?.[0];
    if (!approval?.job_id) return res.status(404).json({ success: false, error: 'Approval request not found' });

    const jobQuery = new URLSearchParams();
    jobQuery.set('id', eq(approval.job_id));
    jobQuery.set('organization_id', eq(orgId));
    jobQuery.set('select', '*');
    jobQuery.set('limit', '1');
    const jobRows = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', jobQuery).catch(() => [])) as any[];
    const job = jobRows?.[0];
    if (!job) return res.status(404).json({ success: false, error: 'Approval request not found' });

    return res.json({ success: true, data: decorateJobApproval(job, approval) });
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
    const slaDeadline = new Date(Date.now() + 4 * 3600 * 1000).toISOString(); // 4-hour SLA default
    const now = new Date().toISOString();

    // Compute risk score and potentially elevate required role
    const riskScore = computeApprovalRiskScore((action_payload as Record<string, any>) || {}, service, action);
    if (!action_policy_id) {
      // Only auto-elevate role when not governed by an explicit policy
      const scoredRole = roleForRiskScore(riskScore);
      const current = ROLE_ORDER[effectiveRole] ?? 0;
      const scored = ROLE_ORDER[scoredRole] ?? 0;
      if (scored > current) effectiveRole = scoredRole as typeof baseRole;
    }

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
        risk_score: riskScore,
        sla_deadline: slaDeadline,
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

    if (!row) {
      const jobApprovalQuery = new URLSearchParams();
      jobApprovalQuery.set('id', eq(id));
      jobApprovalQuery.set('select', '*');
      jobApprovalQuery.set('limit', '1');
      const jobApprovalRows = (await supabaseRestAsUser(getUserJwt(req), 'agent_job_approvals', jobApprovalQuery).catch(() => [])) as any[];
      const jobApproval = jobApprovalRows?.[0];
      if (!jobApproval?.job_id) return res.status(404).json({ success: false, error: 'Approval request not found' });

      const jobQuery = new URLSearchParams();
      jobQuery.set('id', eq(jobApproval.job_id));
      jobQuery.set('organization_id', eq(orgId));
      jobQuery.set('select', '*');
      jobQuery.set('limit', '1');
      const jobRows = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', jobQuery).catch(() => [])) as any[];
      const job = jobRows?.[0];
      if (!job) return res.status(404).json({ success: false, error: 'Approval request not found' });

      const approvalHistory = Array.isArray(jobApproval.approval_history) ? jobApproval.approval_history : [];
      const requiredApprovals = Math.max(1, Number(jobApproval.required_approvals || 1));
      const snapshotAssignedTo: string | null = jobApproval.policy_snapshot?.assigned_to || null;
      const priorApprovals = approvalHistory.filter((entry: any) => entry?.decision === 'approved');
      const awaitingAdditionalApproval = priorApprovals.length > 0 && priorApprovals.length < requiredApprovals;

      if (normalizeApprovalStatus(jobApproval.status) !== 'pending') {
        return res.status(409).json({ success: false, error: `Cannot approve a request with status "${jobApproval.status}"` });
      }
      if (snapshotAssignedTo && snapshotAssignedTo !== userId && !awaitingAdditionalApproval) {
        return res.status(403).json({ success: false, error: 'This approval is assigned to a specific reviewer — only they can approve it' });
      }
      const requiredRole = String(jobApproval.policy_snapshot?.required_role || job.required_role || 'manager');
      if (!canReview(userRole, requiredRole)) {
        return res.status(403).json({ success: false, error: `Approving this request requires role "${requiredRole}" or higher` });
      }
      if (approvalHistory.some((entry: any) => entry?.reviewer_id === userId && entry?.decision === 'approved')) {
        return res.status(409).json({ success: false, error: 'This approver has already approved the job' });
      }

      const now = new Date().toISOString();
      const nextHistory = [
        ...approvalHistory,
        { reviewer_id: userId, decision: 'approved', decided_at: now },
      ];
      const approvedCount = nextHistory.filter((entry: any) => entry?.decision === 'approved').length;
      const finalDecision = approvedCount < requiredApprovals ? 'pending' : 'approved';

      const updatedApprovals = (await supabaseRestAsUser(getUserJwt(req), 'agent_job_approvals', new URLSearchParams([['id', eq(jobApproval.id)]]), {
        method: 'PATCH',
        body: {
          status: finalDecision,
          approved_by: finalDecision === 'approved' ? userId : null,
          approval_history: nextHistory,
          ...(finalDecision === 'pending' ? {} : { decided_at: now }),
        },
      })) as any[];

      let updatedJob = job;
      if (finalDecision === 'approved') {
        const updatedJobs = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', new URLSearchParams([['id', eq(job.id)], ['organization_id', eq(orgId)]]), {
          method: 'PATCH',
          body: { status: 'queued' },
        })) as any[];
        updatedJob = updatedJobs?.[0] || { ...job, status: 'queued' };
      }

      const normalized = decorateJobApproval(updatedJob, updatedApprovals?.[0] || { ...jobApproval, status: finalDecision, approval_history: nextHistory, decided_at: finalDecision === 'approved' ? now : null, approved_by: finalDecision === 'approved' ? userId : null });
      return res.json({
        success: true,
        data: normalized,
        execution: {
          resumed: finalDecision === 'approved',
          state: mapJobStatusToGovernedStatus(updatedJob.status, finalDecision),
          job_id: job.id,
        },
      });
    }
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

    // Store correction in seniority memory (fire-and-forget)
    void storeCorrection(orgId, row.agent_id, { id, service: row.service, action: row.action, action_payload: row.action_payload }, 'approved', parsed.data?.note);

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

    // Portal email actions: send directly via email service (no connector execution needed)
    if (row.service === 'email' && row.action === 'send_email') {
      const { to, subject, body } = (row.action_payload || {}) as { to?: string; subject?: string; body?: string };
      if (to && subject && body) {
        try {
          await sendTransactionalEmail({
            to,
            subject,
            html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
            text: body,
          });
          logger.info('Portal email sent after approval', { approval_id: id, to });
          auditLog.log({
            user_id: userId,
            action: 'email.sent',
            resource_type: 'approval_request',
            resource_id: id,
            organization_id: orgId,
            ip_address: req.ip || (req.socket as any)?.remoteAddress,
            user_agent: req.get('user-agent') || undefined,
            metadata: { recipient: to, subject, approval_id: id },
          });
        } catch (emailErr: any) {
          logger.warn('Portal email send failed after approval', { approval_id: id, error: emailErr?.message });
          // Don't fail the response — approval stands; delivery failure is a separate concern
        }
      }
      return res.json({
        success: true,
        data: decorateApprovalRequest(updated?.[0] || row),
        execution: { resumed: true, connector_id: 'email', action: 'send_email', result: { sent: true }, audit_ref: null },
      });
    }

    let resumed: any = null;
    try {
      resumed = await resumeApprovedToolCall({
        orgId,
        approvalId: id,
        reviewerId: userId,
        reviewerNote: parsed.data?.note || null,
      });
    } catch (resumeErr: any) {
      logger.error('Failed to resume approved connector action', {
        approval_id: id,
        org_id: orgId,
        error: resumeErr?.message,
      });
      return res.status(500).json({
        success: false,
        error: resumeErr?.message || 'Approval recorded, but execution resume failed',
      });
    }

    return res.json({
      success: true,
      data: decorateApprovalRequest(updated?.[0] || row),
      execution: {
        resumed: true,
        connector_id: resumed?.connectorId || row.service,
        action: resumed?.action || row.action,
        result: resumed?.result || null,
        audit_ref: resumed?.auditRef || null,
      },
    });
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

    if (!row) {
      const jobApprovalQuery = new URLSearchParams();
      jobApprovalQuery.set('id', eq(id));
      jobApprovalQuery.set('select', '*');
      jobApprovalQuery.set('limit', '1');
      const jobApprovalRows = (await supabaseRestAsUser(getUserJwt(req), 'agent_job_approvals', jobApprovalQuery).catch(() => [])) as any[];
      const jobApproval = jobApprovalRows?.[0];
      if (!jobApproval?.job_id) return res.status(404).json({ success: false, error: 'Approval request not found' });

      const jobQuery = new URLSearchParams();
      jobQuery.set('id', eq(jobApproval.job_id));
      jobQuery.set('organization_id', eq(orgId));
      jobQuery.set('select', '*');
      jobQuery.set('limit', '1');
      const jobRows = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', jobQuery).catch(() => [])) as any[];
      const job = jobRows?.[0];
      if (!job) return res.status(404).json({ success: false, error: 'Approval request not found' });

      const approvalHistory = Array.isArray(jobApproval.approval_history) ? jobApproval.approval_history : [];
      const snapshotAssignedTo: string | null = jobApproval.policy_snapshot?.assigned_to || null;
      const requiredRole = String(jobApproval.policy_snapshot?.required_role || job.required_role || 'manager');
      if (normalizeApprovalStatus(jobApproval.status) !== 'pending') {
        return res.status(409).json({ success: false, error: `Cannot deny a request with status "${jobApproval.status}"` });
      }
      if (snapshotAssignedTo && snapshotAssignedTo !== userId) {
        return res.status(403).json({ success: false, error: 'This approval is assigned to a specific reviewer — only they can deny it' });
      }
      if (!canReview(userRole, requiredRole)) {
        return res.status(403).json({ success: false, error: `Denying this request requires role "${requiredRole}" or higher` });
      }

      const now = new Date().toISOString();
      const nextHistory = [
        ...approvalHistory,
        { reviewer_id: userId, decision: 'rejected', decided_at: now },
      ];
      const updatedApprovals = (await supabaseRestAsUser(getUserJwt(req), 'agent_job_approvals', new URLSearchParams([['id', eq(jobApproval.id)]]), {
        method: 'PATCH',
        body: {
          status: 'rejected',
          approved_by: null,
          approval_history: nextHistory,
          decided_at: now,
        },
      })) as any[];
      const updatedJobs = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', new URLSearchParams([['id', eq(job.id)], ['organization_id', eq(orgId)]]), {
        method: 'PATCH',
        body: { status: 'canceled' },
      })) as any[];
      const updatedJob = updatedJobs?.[0] || { ...job, status: 'canceled' };
      const normalized = decorateJobApproval(updatedJob, updatedApprovals?.[0] || { ...jobApproval, status: 'rejected', approval_history: nextHistory, decided_at: now });
      return res.json({
        success: true,
        data: normalized,
        execution: {
          resumed: false,
          state: 'denied',
          job_id: job.id,
        },
      });
    }
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

    // Store correction in seniority memory (fire-and-forget)
    void storeCorrection(orgId, row.agent_id, { id, service: row.service, action: row.action, action_payload: row.action_payload }, 'denied', parsed.data?.note);

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

    void markApprovalDeniedExecution({
      orgId,
      approvalId: id,
      reviewerId: userId,
      reviewerNote: parsed.data?.note || null,
    }).catch((markErr: any) => {
      logger.warn('Failed to mark denied connector execution', {
        approval_id: id,
        org_id: orgId,
        error: markErr?.message,
      });
    });

    return res.json({
      success: true,
      data: decorateApprovalRequest(updated?.[0] || row),
      execution: {
        resumed: false,
        state: 'denied',
      },
    });
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

// POST /:id/snooze — snooze a pending approval
router.post('/:id/snooze', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    const userId = req.user?.id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const hours = Number(req.body?.hours ?? 4);
    if (![1, 4, 24].includes(hours)) {
      return res.status(400).json({ success: false, error: 'hours must be 1, 4, or 24' });
    }

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));
    q.set('status', eq('pending'));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', q)) as any[];
    if (!rows?.length) return res.status(404).json({ success: false, error: 'Pending approval not found' });

    const snoozedUntil = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(id));
    patchQ.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', patchQ, {
      method: 'PATCH',
      body: { snoozed_until: snoozedUntil, updated_at: new Date().toISOString() },
    })) as any[];

    auditLog.log({
      user_id: userId || 'system',
      action: 'approval_request.snoozed',
      resource_type: 'approval_request',
      resource_id: id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { snoozed_until: snoozedUntil, hours },
    });

    return res.json({ success: true, data: updated?.[0] || rows[0] });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// POST /:id/escalate — escalate an approval to a higher role
router.post('/:id/escalate', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    const userId = req.user?.id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', q)) as any[];
    if (!rows?.length) return res.status(404).json({ success: false, error: 'Approval not found' });

    const row = rows[0];
    const currentRole = row.required_role as string;
    const roleOrder = ['viewer', 'manager', 'admin', 'super_admin'];
    const currentIdx = roleOrder.indexOf(currentRole);
    const escalatedRole = roleOrder[Math.min(currentIdx + 1, roleOrder.length - 1)];

    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(id));
    patchQ.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', patchQ, {
      method: 'PATCH',
      body: { required_role: escalatedRole, status: 'pending', updated_at: new Date().toISOString() },
    })) as any[];

    auditLog.log({
      user_id: userId || 'system',
      action: 'approval_request.escalated',
      resource_type: 'approval_request',
      resource_id: id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { from_role: currentRole, to_role: escalatedRole },
    });

    return res.json({ success: true, data: updated?.[0] || row });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// GET /:id/comments — list comments on an approval
router.get('/:id/comments', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const q = new URLSearchParams();
    q.set('approval_request_id', eq(id));
    q.set('organization_id', eq(orgId));
    q.set('order', 'created_at.asc');
    const comments = (await supabaseRestAsUser(getUserJwt(req), 'approval_comments', q)) as any[];
    return res.json({ success: true, data: comments || [] });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// POST /:id/comments — add a comment to an approval
router.post('/:id/comments', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    const userId = req.user?.id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { content, mention_ids } = z.object({
      content: z.string().min(1).max(5000),
      mention_ids: z.array(z.string().uuid()).optional().default([]),
    }).parse(req.body);

    // Verify the approval belongs to this org
    const aq = new URLSearchParams();
    aq.set('id', eq(id));
    aq.set('organization_id', eq(orgId));
    aq.set('select', 'id');
    const ar = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', aq)) as any[];
    if (!ar?.length) return res.status(404).json({ success: false, error: 'Approval not found' });

    const created = (await supabaseRestAsUser(getUserJwt(req), 'approval_comments', '', {
      method: 'POST',
      body: {
        approval_request_id: id,
        organization_id: orgId,
        author_id: userId,
        content,
        mention_ids: mention_ids || [],
      },
    })) as any[];

    return res.status(201).json({ success: true, data: created?.[0] });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// PATCH /:id/subtasks — update sub-tasks on an approval
router.patch('/:id/subtasks', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const { sub_tasks } = z.object({
      sub_tasks: z.array(z.object({
        title: z.string().min(1).max(500),
        completed: z.boolean().default(false),
        created_by: z.string().uuid().optional(),
      })).max(20),
    }).parse(req.body);

    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(id));
    patchQ.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', patchQ, {
      method: 'PATCH',
      body: { sub_tasks, updated_at: new Date().toISOString() },
    })) as any[];

    return res.json({ success: true, data: updated?.[0] });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// POST /bulk-approve — approve multiple pending approvals
router.post('/bulk-approve', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = req.user?.id;
    const userRole = req.user?.role || 'viewer';
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const { ids, note } = z.object({
      ids: z.array(z.string().uuid()).min(1).max(50),
      note: z.string().max(2000).optional(),
    }).parse(req.body);

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const id of ids) {
      try {
        const q = new URLSearchParams();
        q.set('id', eq(id));
        q.set('organization_id', eq(orgId));
        q.set('status', eq('pending'));
        const rows = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', q)) as any[];
        if (!rows?.length) { results.push({ id, success: false, error: 'Not found or not pending' }); continue; }
        const row = rows[0];
        if (!canReview(userRole, row.required_role)) { results.push({ id, success: false, error: 'Insufficient role' }); continue; }
        if (row.assigned_to && row.assigned_to !== userId) { results.push({ id, success: false, error: 'Assigned to another user' }); continue; }

        const patchQ = new URLSearchParams();
        patchQ.set('id', eq(id));
        patchQ.set('organization_id', eq(orgId));
        await supabaseRestAsUser(getUserJwt(req), 'approval_requests', patchQ, {
          method: 'PATCH',
          body: { status: 'approved', reviewer_id: userId, reviewer_note: note || null, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        });
        results.push({ id, success: true });
      } catch (e: any) {
        results.push({ id, success: false, error: e?.message });
      }
    }

    const approved = results.filter(r => r.success).length;
    logger.info('Bulk approval completed', { orgId, approved, total: ids.length });
    return res.json({ success: true, data: results, approved, total: ids.length });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// POST /bulk-deny — deny multiple pending approvals
router.post('/bulk-deny', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = req.user?.id;
    const userRole = req.user?.role || 'viewer';
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const { ids, note } = z.object({
      ids: z.array(z.string().uuid()).min(1).max(50),
      note: z.string().max(2000).optional(),
    }).parse(req.body);

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const id of ids) {
      try {
        const q = new URLSearchParams();
        q.set('id', eq(id));
        q.set('organization_id', eq(orgId));
        q.set('status', eq('pending'));
        const rows = (await supabaseRestAsUser(getUserJwt(req), 'approval_requests', q)) as any[];
        if (!rows?.length) { results.push({ id, success: false, error: 'Not found or not pending' }); continue; }
        const row = rows[0];
        if (!canReview(userRole, row.required_role)) { results.push({ id, success: false, error: 'Insufficient role' }); continue; }

        const patchQ = new URLSearchParams();
        patchQ.set('id', eq(id));
        patchQ.set('organization_id', eq(orgId));
        await supabaseRestAsUser(getUserJwt(req), 'approval_requests', patchQ, {
          method: 'PATCH',
          body: { status: 'denied', reviewer_id: userId, reviewer_note: note || null, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        });
        results.push({ id, success: true });
      } catch (e: any) {
        results.push({ id, success: false, error: e?.message });
      }
    }

    const denied = results.filter(r => r.success).length;
    return res.json({ success: true, data: results, denied, total: ids.length });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// PATCH /approvals/:id/delegate — re-assign approval to another user
router.patch('/approvals/:id/delegate', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const jwt = getUserJwt(req);
    const { id } = req.params;
    const { delegate_to_user_id } = req.body as { delegate_to_user_id: string };

    if (!delegate_to_user_id) {
      return res.status(400).json({ success: false, error: 'delegate_to_user_id is required' });
    }

    // Verify approval exists + belongs to org + is pending
    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId!));
    q.set('status', eq('pending'));
    const rows = (await supabaseRestAsUser(jwt, 'approval_requests', q)) as any[];
    if (!rows?.length) {
      return res.status(404).json({ success: false, error: 'Approval not found or not pending' });
    }

    // Update delegate
    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(id));
    patchQ.set('organization_id', eq(orgId!));
    await supabaseRestAsUser(jwt, 'approval_requests', patchQ, {
      method: 'PATCH',
      body: { delegate_to_user_id, updated_at: new Date().toISOString() },
    });

    auditLog.log({
      user_id: req.user?.id || 'system',
      action: 'approval.delegated',
      resource_type: 'approval_request',
      resource_id: id,
      organization_id: orgId!,
      metadata: { delegate_to_user_id },
    });

    return res.json({ success: true, data: { id, delegate_to_user_id } });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

export default router;
