import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { hasPermission, requirePermission, type Role } from '../middleware/rbac';
import { logger } from '../lib/logger';
import { SupabaseRestError, eq, supabaseRestAsUser } from '../lib/supabase-rest';
import { runtimeSchemas, validateRequestBody } from '../schemas/validation';
import { auditLog } from '../lib/audit-logger';

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
}> {
  const q = new URLSearchParams();
  q.set('organization_id', eq(orgId));
  q.set('service', eq(service));
  q.set('action', eq(action));
  q.set('select', 'id,enabled,require_approval,required_role');
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
    const userRole = String((req.user as any)?.role || 'viewer');

    let policy = null as Awaited<ReturnType<typeof getActionPolicy>>;
    if (isConnectorAction && connectorService && connectorAction) {
      policy = await getActionPolicy(getUserJwt(req), orgId, connectorService, connectorAction);
    }

    if (isConnectorAction) {
      if (!hasPermission(userRole, 'workitems.manage')) {
        return res.status(403).json({ success: false, error: 'Insufficient permissions', required_permission: 'workitems.manage' });
      }

      const requiredRole = policy?.required_role || requireRoleForConnectorAction(connectorAction);
      if (roleRank(userRole) < roleRank(requiredRole)) {
        return res.status(403).json({ success: false, error: 'Insufficient role privileges', required_role: requiredRole });
      }

      if (policy && policy.enabled === false) {
        return res.status(403).json({ success: false, error: 'Action disabled by policy' });
      }
    }

    const initialStatus = (isConnectorAction && policy && policy.require_approval === false) ? 'queued' : 'pending_approval';

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
      },
    })) as any[];

    const job = createdJobs?.[0];
    if (!job) return res.status(500).json({ success: false, error: 'Failed to create job' });

    const policySnapshot = deployment.execution_policy || {
      approvals: { required: true },
      llm: { route: 'synthetichr_gateway' },
      secrets: { mode: 'mixed' },
    };

    const autoApproved = initialStatus === 'queued';
    const approvals = (await supabaseRestAsUser(getUserJwt(req), 'agent_job_approvals', '', {
      method: 'POST',
      body: {
        job_id: job.id,
        requested_by: userId,
        approved_by: autoApproved ? userId : null,
        status: autoApproved ? 'approved' : 'pending',
        policy_snapshot: policySnapshot,
        created_at: now,
        ...(autoApproved ? { decided_at: now } : {}),
      },
    })) as any[];

    const approval = approvals?.[0] || null;

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

    return res.status(201).json({ success: true, data: { job, approval } });
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
    query.set('limit', String(Math.max(1, Math.min(200, Number(req.query.limit || 50)))));

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
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

    return res.json({ success: true, data: { job } });
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

    const now = nowIso();
    const decision = data.decision;

    // Update approval
    const apprPatchQ = new URLSearchParams();
    apprPatchQ.set('id', eq(approval.id));
    const updatedApprovals = (await supabaseRestAsUser(getUserJwt(req), 'agent_job_approvals', apprPatchQ, {
      method: 'PATCH',
      body: {
        status: decision,
        approved_by: decision === 'approved' ? userId : null,
        decided_at: now,
      },
    })) as any[];

    // Update job status
    const jobPatchQ = new URLSearchParams();
    jobPatchQ.set('id', eq(id));
    jobPatchQ.set('organization_id', eq(orgId));
    const newJobStatus = decision === 'approved' ? 'queued' : 'canceled';
    const updatedJobs = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', jobPatchQ, {
      method: 'PATCH',
      body: {
        status: newJobStatus,
      },
    })) as any[];

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
        previous_status: job.status,
        new_status: newJobStatus,
        approval_id: approval.id,
        agent_id: job.agent_id || null,
      },
    });

    return res.json({
      success: true,
      data: {
        job: updatedJobs?.[0] || job,
        approval: updatedApprovals?.[0] || approval,
      },
    });
  } catch (err: any) {
    return safeError(res, err);
  }
});

export default router;
