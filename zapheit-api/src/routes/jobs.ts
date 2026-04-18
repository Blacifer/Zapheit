import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { hasPermission, requirePermission, type Role } from '../middleware/rbac';
import { logger } from '../lib/logger';
import { SupabaseRestError, eq, supabaseRestAsUser } from '../lib/supabase-rest';
import { runtimeSchemas, validateRequestBody } from '../schemas/validation';
import { auditLog } from '../lib/audit-logger';
import { notifyApprovalAssignedAsync } from '../lib/notification-service';
import { notifySlackApprovalRequestAsync } from '../lib/slack-approvals';
import { evaluatePolicyConstraints, type PolicyConstraints } from '../lib/action-policy-constraints';
import {
  buildApprovalSummaryFromJobApproval,
  buildGovernedExecutionSummary,
  inferWorkflowEntrySource,
} from '../lib/governed-workflow';

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
  logger.error('Jobs route error', { status: resolved, message });
  return res.status(resolved).json({ success: false, error: message });
}

function roleRank(role: string): number {
  if (role === 'super_admin') return 4;
  if (role === 'admin') return 3;
  if (role === 'manager') return 2;
  return 1; // viewer/unknown
}

function requireRoleForConnectorAction(action: string): Role {
  if (action.startsWith('it.')) return 'admin';
  if (action.startsWith('sales.') || action.startsWith('support.')) return 'manager';
  return 'admin';
}

type RoutingRule = { condition?: string | null; required_role: string; required_user_id?: string | null };

/** Simple condition evaluator for routing rules — matches "field op value" against action_payload. */
function evalRoutingCondition(condition: string | null | undefined, payload: Record<string, any>): boolean {
  if (!condition?.trim()) return true;
  const m = condition.trim().match(/^(\w[\w.]*)\s*(>=|<=|===|!==|==|!=|>|<|contains)\s*(.+)$/);
  if (!m) return true;
  const [, fieldPath, op, rawValue] = m;
  const fieldValue = fieldPath.split('.').reduce((o: any, k: string) => o?.[k], payload);
  const strValue = rawValue.trim().replace(/^['"]|['"]$/g, '');
  const numValue = parseFloat(strValue);
  switch (op) {
    case '>':   return parseFloat(String(fieldValue)) > numValue;
    case '<':   return parseFloat(String(fieldValue)) < numValue;
    case '>=':  return parseFloat(String(fieldValue)) >= numValue;
    case '<=':  return parseFloat(String(fieldValue)) <= numValue;
    case '===': case '==': return String(fieldValue).toLowerCase() === strValue.toLowerCase();
    case '!==': case '!=': return String(fieldValue).toLowerCase() !== strValue.toLowerCase();
    case 'contains': return String(fieldValue ?? '').toLowerCase().includes(strValue.toLowerCase());
    default:    return true;
  }
}

function resolveRoutingRules(rules: RoutingRule[], payload: Record<string, any>, defaultRole: Role): { required_role: Role; assigned_to: string | null } {
  for (const rule of rules) {
    if (evalRoutingCondition(rule.condition, payload)) {
      const role = (['super_admin', 'admin', 'manager', 'viewer'].includes(rule.required_role) ? rule.required_role : defaultRole) as Role;
      return { required_role: role, assigned_to: rule.required_user_id || null };
    }
  }
  return { required_role: defaultRole, assigned_to: null };
}

type ApprovalHistoryEntry = {
  reviewer_id: string;
  decision: 'approved' | 'rejected';
  decided_at: string;
};

async function loadJobApproval(userJwt: string, jobId: string) {
  const apprQ = new URLSearchParams();
  apprQ.set('job_id', eq(jobId));
  apprQ.set('select', '*');
  apprQ.set('limit', '1');
  const apprs = (await supabaseRestAsUser(userJwt, 'agent_job_approvals', apprQ)) as any[];
  return apprs?.[0] || null;
}

function decorateJob(job: any, approval: any = null) {
  if (!approval && job?.approval) approval = job.approval;
  if (!approval) {
    const governedExecution = buildGovernedExecutionSummary({ job });
    return {
      ...job,
      governed_execution: governedExecution,
      cost_status: governedExecution.cost_status,
      audit_ref: governedExecution.audit_ref,
      incident_ref: governedExecution.incident_ref,
    };
  }
  const approvalSummary = buildApprovalSummaryFromJobApproval(approval, job);
  const governedExecution = buildGovernedExecutionSummary({ job, approval, approvalSummary });
  return {
    ...job,
    approval,
    approval_summary: approvalSummary,
    governed_execution: governedExecution,
    cost_status: governedExecution.cost_status,
    audit_ref: governedExecution.audit_ref,
    incident_ref: governedExecution.incident_ref,
    source: approvalSummary.source,
    source_ref: approvalSummary.source_ref,
    governance_status: governedExecution.status,
  };
}

async function getActionPolicy(
  userJwt: string,
  orgId: string,
  service: string,
  action: string
): Promise<null | {
  id: string;
  enabled: boolean;
  require_approval: boolean;
  required_role: Role;
  routing_rules: RoutingRule[];
  policy_constraints: PolicyConstraints;
}> {
  const q = new URLSearchParams();
  q.set('organization_id', eq(orgId));
  q.set('service', eq(service));
  q.set('action', eq(action));
  q.set('select', 'id,enabled,require_approval,required_role,routing_rules,policy_constraints');
  q.set('limit', '1');

  const rows = (await supabaseRestAsUser(userJwt, 'action_policies', q)) as any[];
  const row = rows?.[0];
  if (!row) return null;

  const requiredRole = (['super_admin', 'admin', 'manager', 'viewer'].includes(String(row.required_role))
    ? String(row.required_role)
    : 'manager') as Role;

  return {
    id: String(row.id),
    enabled: row.enabled !== false,
    require_approval: row.require_approval !== false,
    required_role: requiredRole,
    routing_rules: Array.isArray(row.routing_rules) ? row.routing_rules : [],
    policy_constraints: row.policy_constraints && typeof row.policy_constraints === 'object' ? row.policy_constraints : {},
  };
}

// Create job + approval (pending)
router.post('/', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const { valid, data, errors } = validateRequestBody<z.infer<typeof runtimeSchemas.createJob>>(runtimeSchemas.createJob, req.body);
    if (!valid || !data) return res.status(400).json({ success: false, errors });

    // Find deployment for agent (binds it to a runtime instance).
    const depQuery = new URLSearchParams();
    depQuery.set('organization_id', eq(orgId));
    depQuery.set('agent_id', eq(data.agent_id));
    depQuery.set('select', '*');
    const deployments = (await supabaseRestAsUser(getUserJwt(req), 'agent_deployments', depQuery)) as any[];
    const deployment = deployments?.[0];
    if (!deployment) {
      return res.status(409).json({ success: false, error: 'Agent is not deployed to any runtime instance' });
    }
    if (deployment.status && deployment.status !== 'active') {
      return res.status(409).json({ success: false, error: `Agent deployment is not active (${deployment.status})` });
    }

    const now = nowIso();

    const isConnectorAction = data.type === 'connector_action';
    const connectorService = isConnectorAction ? String((data.input as any)?.connector?.service || '') : '';
    const connectorAction = isConnectorAction ? String((data.input as any)?.connector?.action || '') : '';
    const actionPayload = isConnectorAction ? (((data.input as any)?.connector?.params || {}) as Record<string, any>) : {};
    const userRole = String((req.user as any)?.role || 'viewer');

    let policy = null as Awaited<ReturnType<typeof getActionPolicy>>;
    if (isConnectorAction && connectorService && connectorAction) {
      policy = await getActionPolicy(getUserJwt(req), orgId, connectorService, connectorAction);
    }
    const constraintEvaluation = isConnectorAction
      ? evaluatePolicyConstraints(actionPayload, policy?.policy_constraints || {})
      : { blocked: false, blockReasons: [], approvalRequired: false, approvalReasons: [], requiredRole: null, dualApproval: false };

    if (isConnectorAction) {
      if (!hasPermission(userRole, 'workitems.manage')) {
        return res.status(403).json({ success: false, error: 'Insufficient permissions', required_permission: 'workitems.manage' });
      }

      if (policy && policy.enabled === false) {
        return res.status(403).json({ success: false, error: 'Action disabled by policy' });
      }
      if (constraintEvaluation.blocked) {
        return res.status(403).json({
          success: false,
          error: constraintEvaluation.blockReasons[0] || 'Action blocked by policy constraints',
          policy_reasons: constraintEvaluation.blockReasons,
        });
      }
    }

    // chat_turn and workflow_run have no side effects — run immediately.
    // connector_action requires explicit approval unless the policy waives it.
    const effectiveRequiredRole = constraintEvaluation.requiredRole || policy?.required_role || requireRoleForConnectorAction(connectorAction);
    const approvalRequired = isConnectorAction
      ? (policy ? policy.require_approval !== false : true) || constraintEvaluation.approvalRequired
      : false;
    if (isConnectorAction && !approvalRequired && roleRank(userRole) < roleRank(effectiveRequiredRole)) {
      return res.status(403).json({ success: false, error: 'Insufficient role privileges', required_role: effectiveRequiredRole });
    }
    const initialStatus = !isConnectorAction
      ? 'queued'
      : (approvalRequired ? 'pending_approval' : 'queued');

    const createdJobs = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        agent_id: data.agent_id,
        runtime_instance_id: deployment.runtime_instance_id,
        type: data.type,
        status: initialStatus,
        input: data.input || {},
        output: {},
        created_by: userId,
        created_at: now,
        ...(data.playbook_id ? { playbook_id: data.playbook_id } : {}),
        ...(data.batch_id ? { batch_id: data.batch_id } : {}),
        ...(data.parent_job_id ? { parent_job_id: data.parent_job_id } : {}),
      },
    })) as any[];

    const job = createdJobs?.[0];
    if (!job) return res.status(500).json({ success: false, error: 'Failed to create job' });

    // Evaluate routing rules for connector actions to determine effective role + assigned approver.
    let routedRole: Role | null = null;
    let routedAssignedTo: string | null = null;
    if (isConnectorAction && policy?.routing_rules?.length) {
      const resolved = resolveRoutingRules(policy.routing_rules, actionPayload, effectiveRequiredRole);
      routedRole = resolved.required_role;
      routedAssignedTo = resolved.assigned_to;
    }

    const policySnapshot = {
      ...(deployment.execution_policy || { approvals: { required: true }, llm: { route: 'synthetichr_gateway' }, secrets: { mode: 'mixed' } }),
      ...(routedRole ? { required_role: routedRole } : { required_role: effectiveRequiredRole }),
      ...(routedAssignedTo ? { assigned_to: routedAssignedTo } : {}),
      workflow: {
        source: inferWorkflowEntrySource({ job: { type: data.type, input: data.input } as any }),
        source_ref: data.parent_job_id || data.playbook_id || data.batch_id || null,
      },
      connector_policy: {
        service: connectorService,
        action: connectorAction,
        approval_required: approvalRequired,
        policy_id: policy?.id || null,
        constraints: policy?.policy_constraints || {},
        constraint_evaluation: constraintEvaluation,
      },
    };

    const autoApproved = initialStatus === 'queued';
    const approvalHistory: ApprovalHistoryEntry[] = autoApproved
      ? [{ reviewer_id: userId, decision: 'approved', decided_at: now }]
      : [];
    const approvals = (await supabaseRestAsUser(getUserJwt(req), 'agent_job_approvals', '', {
      method: 'POST',
      body: {
        job_id: job.id,
        requested_by: userId,
        approved_by: autoApproved ? userId : null,
        status: autoApproved ? 'approved' : 'pending',
        required_approvals: constraintEvaluation.dualApproval ? 2 : 1,
        approval_history: approvalHistory,
        policy_snapshot: policySnapshot,
        created_at: now,
        ...(autoApproved ? { decided_at: now } : {}),
      },
    })) as any[];

    // Notify assigned approver via Slack if routing rules specified one.
    if (!autoApproved && routedAssignedTo) {
      notifyApprovalAssignedAsync({
        organizationId: orgId,
        assignedToUserId: routedAssignedTo,
        service: connectorService,
        action: connectorAction,
        referenceId: job.id,
      });
    }

    const approval = approvals?.[0] || null;

    // Send Block Kit approval message with Approve / Deny buttons to the org's Slack channel.
    if (!autoApproved && approval?.id) {
      notifySlackApprovalRequestAsync({
        organizationId: orgId,
        approvalId: approval.id,
        agentId: data.agent_id,
        service: connectorService,
        action: connectorAction,
        requestedByEmail: req.user?.email ?? null,
        jobId: job.id,
      });
    }

    await auditLog.log({
      user_id: userId,
      action: 'job.created',
      resource_type: 'agent_job',
      resource_id: job.id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: {
        agent_id: data.agent_id,
        type: data.type,
        status: job.status,
        approval_id: approval?.id || null,
        connector: isConnectorAction ? { service: connectorService, action: connectorAction, policy_id: policy?.id || null } : null,
      },
    });

    return res.status(201).json({ success: true, data: { job: decorateJob(job, approval), approval } });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.get('/', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    if (req.query.agent_id) query.set('agent_id', eq(String(req.query.agent_id)));
    if (req.query.status) query.set('status', eq(String(req.query.status)));
    if (req.query.batch_id) query.set('batch_id', eq(String(req.query.batch_id)));
    if (req.query.playbook_id) query.set('playbook_id', eq(String(req.query.playbook_id)));
    if (req.query.type) query.set('type', eq(String(req.query.type)));
    query.set('limit', String(Math.max(1, Math.min(200, Number(req.query.limit || 50)))));

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', query)) as any[];
    const data = Array.isArray(rows) ? rows : [];

    await Promise.all(data.map(async (job: any) => {
      if (job?.type !== 'connector_action' || String(job?.status) !== 'pending_approval') return;
      try {
        const approval = await loadJobApproval(getUserJwt(req), job.id);
        if (!approval) return;
        job.approval = approval;
        const history = Array.isArray(approval.approval_history) ? approval.approval_history : [];
        const approvalsRecorded = history.filter((entry: any) => entry?.decision === 'approved').length;
        job.required_approvals = Math.max(1, Number(approval.required_approvals || 1));
        job.approvals_recorded = approvalsRecorded;
        job.approvals_remaining = Math.max(0, job.required_approvals - approvalsRecorded);
        const snapshot = approval.policy_snapshot || {};
        if (snapshot.required_role) job.required_role = snapshot.required_role;
        if (snapshot.assigned_to) job.assigned_to = snapshot.assigned_to;
        if (snapshot.workflow?.source) job.source = snapshot.workflow.source;
        if (snapshot.workflow?.source_ref) job.source_ref = snapshot.workflow.source_ref;
      } catch {
        // non-fatal augmentation
      }
    }));
    return res.json({ success: true, data: data.map((job: any) => decorateJob(job, job.approval || null)), count: data.length || 0 });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Bulk create jobs from a batch (CSV run)
router.post('/bulk', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const { agent_id, type, playbook_id, rows } = req.body || {};
    if (!agent_id || !type || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'agent_id, type, and rows[] are required' });
    }
    if (rows.length > 100) {
      return res.status(400).json({ success: false, error: 'Maximum 100 rows per bulk run' });
    }

    // Find deployment
    const depQuery = new URLSearchParams();
    depQuery.set('organization_id', eq(orgId));
    depQuery.set('agent_id', eq(String(agent_id)));
    depQuery.set('select', '*');
    const deployments = (await supabaseRestAsUser(getUserJwt(req), 'agent_deployments', depQuery)) as any[];
    const deployment = deployments?.[0];
    if (!deployment) return res.status(409).json({ success: false, error: 'Agent is not deployed to any runtime instance' });

    const batchId = crypto.randomUUID();
    const now = nowIso();
    const policySnapshot = deployment.execution_policy || {};
    const jobs: any[] = [];

    for (const rowInput of rows) {
      const jobRows = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', '', {
        method: 'POST',
        body: {
          organization_id: orgId,
          agent_id: String(agent_id),
          runtime_instance_id: deployment.runtime_instance_id,
          type: String(type),
          status: 'queued',
          input: rowInput || {},
          output: {},
          created_by: userId,
          created_at: now,
          batch_id: batchId,
          ...(playbook_id ? { playbook_id: String(playbook_id) } : {}),
        },
      })) as any[];

      const job = jobRows?.[0];
      if (job) {
        jobs.push(job);
        await supabaseRestAsUser(getUserJwt(req), 'agent_job_approvals', '', {
          method: 'POST',
          body: {
            job_id: job.id,
            requested_by: userId,
            approved_by: userId,
            status: 'approved',
            policy_snapshot: policySnapshot,
            created_at: now,
            decided_at: now,
          },
        });
      }
    }

    await auditLog.log({
      user_id: userId,
      action: 'job.bulk_created',
      resource_type: 'agent_job',
      resource_id: batchId,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { batch_id: batchId, job_count: jobs.length, playbook_id },
    });

    return res.status(201).json({ success: true, data: { batch_id: batchId, jobs, count: jobs.length } });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.get('/:id', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const query = new URLSearchParams();
    query.set('id', eq(req.params.id));
    query.set('organization_id', eq(orgId));
    query.set('select', '*');
    query.set('limit', '1');

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', query)) as any[];
    const job = rows?.[0];
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

    // For connector actions, augment with approval metadata for richer review UX.
    if (job.type === 'connector_action') {
      try {
        const approval = await loadJobApproval(getUserJwt(req), job.id);
        const snapshot = approval?.policy_snapshot || {};
        if (snapshot.required_role) job.required_role = snapshot.required_role;
        if (snapshot.assigned_to) job.assigned_to = snapshot.assigned_to;
        if (approval) {
          const history = Array.isArray(approval.approval_history) ? approval.approval_history : [];
          const approvalsRecorded = history.filter((entry: any) => entry?.decision === 'approved').length;
          job.approval = approval;
          job.required_approvals = Math.max(1, Number(approval.required_approvals || 1));
          job.approvals_recorded = approvalsRecorded;
          job.approvals_remaining = Math.max(0, job.required_approvals - approvalsRecorded);
          job.awaiting_additional_approval = approval.status === 'pending' && approvalsRecorded > 0;
        }
      } catch { /* non-fatal */ }
    }

    return res.json({ success: true, data: { job: decorateJob(job, job.approval || null) } });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.post('/:id/decision', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const { id } = req.params;
    const { valid, data, errors } = validateRequestBody<z.infer<typeof runtimeSchemas.approveJob>>(runtimeSchemas.approveJob, req.body);
    if (!valid || !data) return res.status(400).json({ success: false, errors });

    // Load job
    const jobQuery = new URLSearchParams();
    jobQuery.set('id', eq(id));
    jobQuery.set('organization_id', eq(orgId));
    jobQuery.set('select', '*');
    const jobs = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', jobQuery)) as any[];
    const job = jobs?.[0];
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

    // Extra governance: connector actions require work-items permission and higher role depending on action.
    if (String(job.type) === 'connector_action') {
      const userRole = String((req.user as any)?.role || 'viewer');
      if (!hasPermission(userRole, 'workitems.manage')) {
        return res.status(403).json({ success: false, error: 'Insufficient permissions', required_permission: 'workitems.manage' });
      }

      const service = String(job?.input?.connector?.service || '');
      const action = String(job?.input?.connector?.action || '');
      const policy = (service && action)
        ? await getActionPolicy(getUserJwt(req), orgId, service, action)
        : null;

      if (policy && policy.enabled === false) {
        return res.status(403).json({ success: false, error: 'Action disabled by policy' });
      }

      const requiredRole = policy?.required_role || requireRoleForConnectorAction(action);
      if (roleRank(userRole) < roleRank(requiredRole)) {
        return res.status(403).json({ success: false, error: 'Insufficient role privileges', required_role: requiredRole });
      }
    }

    // Load approval row
    const apprQuery = new URLSearchParams();
    apprQuery.set('job_id', eq(id));
    apprQuery.set('select', '*');
    const approvals = (await supabaseRestAsUser(getUserJwt(req), 'agent_job_approvals', apprQuery)) as any[];
    const approval = approvals?.[0];
    if (!approval) return res.status(409).json({ success: false, error: 'Approval row missing for job' });
    if (approval.status !== 'pending') return res.status(409).json({ success: false, error: `Job already decided (${approval.status})` });

    const approvalHistory = Array.isArray(approval.approval_history) ? approval.approval_history as ApprovalHistoryEntry[] : [];
    const requiredApprovals = Math.max(1, Number(approval.required_approvals || 1));

    // Routing rule enforcement: if a specific approver was assigned, only they can decide.
    const snapshotAssignedTo: string | null = (approval.policy_snapshot as any)?.assigned_to || null;
    const priorApprovals = approvalHistory.filter((entry) => entry.decision === 'approved');
    const awaitingAdditionalApproval = priorApprovals.length > 0 && priorApprovals.length < requiredApprovals;
    if (snapshotAssignedTo && snapshotAssignedTo !== userId && !awaitingAdditionalApproval) {
      return res.status(403).json({ success: false, error: 'This action is assigned to a specific approver — only they can approve or reject it', assigned_to: snapshotAssignedTo });
    }

    if (approvalHistory.some((entry) => entry.reviewer_id === userId && entry.decision === 'approved')) {
      return res.status(409).json({ success: false, error: 'This approver has already approved the job', approvals_recorded: priorApprovals.length, required_approvals: requiredApprovals });
    }

    const now = nowIso();
    const decision = data.decision;
    const nextHistory: ApprovalHistoryEntry[] = [
      ...approvalHistory,
      {
        reviewer_id: userId,
        decision,
        decided_at: now,
      },
    ];
    const approvedCount = nextHistory.filter((entry) => entry.decision === 'approved').length;
    const finalDecision = decision === 'approved' && approvedCount < requiredApprovals
      ? 'pending'
      : decision;

    // Update approval
    const apprPatchQ = new URLSearchParams();
    apprPatchQ.set('id', eq(approval.id));
    const updatedApprovals = (await supabaseRestAsUser(getUserJwt(req), 'agent_job_approvals', apprPatchQ, {
      method: 'PATCH',
      body: {
        status: finalDecision,
        approved_by: finalDecision === 'approved' ? userId : null,
        approval_history: nextHistory,
        ...(finalDecision === 'pending' ? {} : { decided_at: now }),
      },
    })) as any[];

    let updatedJobs: any[] = [];
    let newJobStatus = job.status;
    if (finalDecision !== 'pending') {
      const jobPatchQ = new URLSearchParams();
      jobPatchQ.set('id', eq(id));
      jobPatchQ.set('organization_id', eq(orgId));
      newJobStatus = finalDecision === 'approved' ? 'queued' : 'canceled';
      updatedJobs = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', jobPatchQ, {
        method: 'PATCH',
        body: {
          status: newJobStatus,
        },
      })) as any[];
    }

    await auditLog.log({
      user_id: userId,
      action: 'job.decision',
      resource_type: 'agent_job',
      resource_id: id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: {
        decision,
        final_decision: finalDecision,
        previous_status: job.status,
        new_status: newJobStatus,
        approval_id: approval.id,
        agent_id: job.agent_id || null,
        required_approvals: requiredApprovals,
        approvals_recorded: approvedCount,
      },
    });

    return res.json({
      success: true,
      data: {
        job: decorateJob(updatedJobs?.[0] || { ...job, status: newJobStatus }, updatedApprovals?.[0] || approval),
        approval: updatedApprovals?.[0] || approval,
        awaiting_additional_approval: finalDecision === 'pending',
        approvals_remaining: Math.max(0, requiredApprovals - approvedCount),
      },
    });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Generate share link for a completed job
router.post('/:id/share', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const jobQuery = new URLSearchParams();
    jobQuery.set('id', eq(req.params.id));
    jobQuery.set('organization_id', eq(orgId));
    jobQuery.set('select', 'id,status');
    const jobs = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', jobQuery)) as any[];
    const job = jobs?.[0];
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    if (job.status !== 'succeeded') return res.status(409).json({ success: false, error: 'Only succeeded jobs can be shared' });

    const ttlDays = Math.min(30, Math.max(1, Number(req.body?.ttl_days || 7)));
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'playbook_share_links', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        job_id: job.id,
        token,
        expires_at: expiresAt,
        created_by: userId,
        created_at: nowIso(),
      },
    })) as any[];
    const link = rows?.[0];
    if (!link) return res.status(500).json({ success: false, error: 'Failed to create share link' });

    return res.status(201).json({ success: true, data: { token, expires_at: expiresAt, url_path: `/share/${token}` } });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Submit feedback (thumbs up/down) on a completed job
router.post('/:id/feedback', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const feedback = Number(req.body?.feedback);
    if (![1, -1, 0].includes(feedback)) {
      return res.status(400).json({ success: false, error: 'feedback must be 1 (up), -1 (down), or 0 (neutral)' });
    }

    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(req.params.id));
    patchQ.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', patchQ, {
      method: 'PATCH',
      body: { feedback },
    })) as any[];
    if (!updated?.[0]) return res.status(404).json({ success: false, error: 'Job not found' });

    return res.json({ success: true, data: { id: req.params.id, feedback } });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Get/add comments on a job result
router.get('/:id/comments', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('job_id', eq(req.params.id));
    q.set('order', 'created_at.asc');
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'playbook_result_comments', q)) as any[];
    return res.json({ success: true, data: rows || [] });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.post('/:id/comments', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ success: false, error: 'content is required' });

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'playbook_result_comments', '', {
      method: 'POST',
      body: { organization_id: orgId, job_id: req.params.id, user_id: userId, content, created_at: nowIso() },
    })) as any[];
    return res.status(201).json({ success: true, data: rows?.[0] || null });
  } catch (err: any) {
    return safeError(res, err);
  }
});

export default router;
