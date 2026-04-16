import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { logger } from '../lib/logger';
import { SupabaseRestError, eq, lte, supabaseRestAsService, supabaseRestAsUser } from '../lib/supabase-rest';
import { encryptSecret, decryptSecret } from '../lib/integrations/encryption';
import { generateOpaqueToken, hashToken, requireRuntimeAuth, signRuntimeJwt, type RuntimeAuthContext } from '../lib/runtime-auth';
import { firePlaybookTriggers } from '../lib/trigger-evaluator';
import { notifyJobCompletedAsync } from '../lib/notification-service';
import { runtimeSchemas, validateRequestBody } from '../schemas/validation';
import { evaluatePolicyConstraints } from '../lib/action-policy-constraints';
import { buildGovernedActionSnapshot } from '../lib/governed-actions';

const router = Router();

const GCP_RUNTIME_SECRET_NAME = 'SYNTHETICHR_RUNTIME_SECRET';

async function persistRuntimeSecretToGCPFromAPI(secret: string, orgId: string): Promise<void> {
  try {
    // Use GCP metadata service to get an access token (works on Cloud Run)
    const tokenRes = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) }
    );
    if (!tokenRes.ok) return;
    const projectRes = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/project/project-id',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) }
    );
    if (!projectRes.ok) return;
    const { access_token: accessToken } = await tokenRes.json() as { access_token: string };
    const project = (await projectRes.text()).trim();

    const payload = JSON.stringify({ secret, org_id: orgId });
    const url = `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${GCP_RUNTIME_SECRET_NAME}:addVersion`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { data: Buffer.from(payload, 'utf8').toString('base64') } }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      logger.info('[enrollment] runtime secret persisted to Secret Manager');
    } else {
      const err = await res.text();
      logger.warn(`[enrollment] Secret Manager write failed (${res.status}): ${err.slice(0, 200)}`);
    }
  } catch (err: any) {
    logger.warn(`[enrollment] could not persist runtime secret to Secret Manager: ${err?.message || String(err)}`);
  }
}

const getOrgId = (req: any): string | null => req.user?.organization_id || null;
const getUserJwt = (req: any): string => {
  const jwt = req.userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

type RuntimeInstanceRow = {
  id: string;
  organization_id: string;
  name: string;
  mode: string;
  status: string;
  last_heartbeat_at: string | null;
  version: string | null;
  capabilities: any;
  metadata: any;
  enrollment_expires_at?: string | null;
  enrollment_used_at?: string | null;
  created_at: string;
  updated_at: string;
};

type AgentDeploymentRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  runtime_instance_id: string;
  status: string;
  execution_policy: any;
  created_at: string;
  updated_at: string;
};

const ENROLLMENT_TTL_MINUTES = Math.max(5, Number(process.env.RUNTIME_ENROLLMENT_TTL_MINUTES || 30));

function nowIso() {
  return new Date().toISOString();
}

function addMinutesISO(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function safeError(res: Response, err: any, statusCode = 500) {
  const resolved = err instanceof SupabaseRestError ? err.status : statusCode;
  const message = err instanceof SupabaseRestError ? err.responseBody : (err?.message || 'Internal error');
  logger.error('Runtime route error', { status: resolved, message });
  return res.status(resolved).json({ success: false, error: message });
}

const internalActionSchema = z.object({
  job_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  action: z.string().min(1).max(200),
  payload: z.record(z.any()).optional(),
});

const actionPolicyQuerySchema = z.object({
  service: z.string().min(1).max(50),
  action: z.string().min(1).max(200),
});

function pickText(value: any, max = 20000): string | null {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > max ? s.slice(0, max) : s;
}

// =========================
// Runtime instance management (user auth)
// =========================

router.get('/', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'runtime_instances', query)) as RuntimeInstanceRow[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.post('/', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const { valid, data, errors } = validateRequestBody<z.infer<typeof runtimeSchemas.create>>(runtimeSchemas.create, req.body);
    if (!valid || !data) return res.status(400).json({ success: false, errors });

    const enrollmentToken = generateOpaqueToken(32);
    const enrollmentHash = hashToken(enrollmentToken);
    const now = nowIso();
    const expiresAt = addMinutesISO(ENROLLMENT_TTL_MINUTES);

    const created = (await supabaseRestAsUser(getUserJwt(req), 'runtime_instances', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        name: data.name,
        mode: data.mode || 'vpc',
        status: 'pending',
        enrollment_token_hash: enrollmentHash,
        enrollment_expires_at: expiresAt,
        enrollment_used_at: null,
        created_at: now,
        updated_at: now,
      },
    })) as RuntimeInstanceRow[];

    const row = created?.[0] || null;
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create runtime instance' });

    return res.status(201).json({
      success: true,
      data: row,
      enrollment_token: enrollmentToken,
      enrollment_expires_at: expiresAt,
    });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.post('/:id/rotate-enrollment', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const enrollmentToken = generateOpaqueToken(32);
    const enrollmentHash = hashToken(enrollmentToken);
    const expiresAt = addMinutesISO(ENROLLMENT_TTL_MINUTES);

    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(id));
    patchQuery.set('organization_id', eq(orgId));

    const patched = (await supabaseRestAsUser(getUserJwt(req), 'runtime_instances', patchQuery, {
      method: 'PATCH',
      body: {
        enrollment_token_hash: enrollmentHash,
        enrollment_expires_at: expiresAt,
        enrollment_used_at: null,
        updated_at: nowIso(),
      },
    })) as RuntimeInstanceRow[];

    if (!patched?.length) return res.status(404).json({ success: false, error: 'Runtime instance not found' });

    return res.json({
      success: true,
      data: patched[0],
      enrollment_token: enrollmentToken,
      enrollment_expires_at: expiresAt,
    });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.delete('/:id', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const { id } = req.params;
    const delQuery = new URLSearchParams();
    delQuery.set('id', eq(id));
    delQuery.set('organization_id', eq(orgId));

    const deleted = (await supabaseRestAsUser(getUserJwt(req), 'runtime_instances', delQuery, {
      method: 'DELETE',
    })) as RuntimeInstanceRow[];

    if (!deleted?.length) return res.status(404).json({ success: false, error: 'Runtime not found' });
    return res.json({ success: true, data: { id } });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// =========================
// Deployments (user auth)
// =========================

router.get('/deployments', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    if (req.query.agent_id) query.set('agent_id', eq(String(req.query.agent_id)));

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'agent_deployments', query)) as AgentDeploymentRow[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.post('/deployments', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const { valid, data, errors } = validateRequestBody<z.infer<typeof runtimeSchemas.createDeployment>>(runtimeSchemas.createDeployment, req.body);
    if (!valid || !data) return res.status(400).json({ success: false, errors });

    const now = nowIso();

    // Upsert based on (organization_id, agent_id) unique constraint
    const existingQuery = new URLSearchParams();
    existingQuery.set('organization_id', eq(orgId));
    existingQuery.set('agent_id', eq(data.agent_id));
    existingQuery.set('select', '*');
    const existing = (await supabaseRestAsUser(getUserJwt(req), 'agent_deployments', existingQuery)) as AgentDeploymentRow[];

    if (existing?.length) {
      const patchQuery = new URLSearchParams();
      patchQuery.set('id', eq(existing[0].id));
      patchQuery.set('organization_id', eq(orgId));
      const patched = (await supabaseRestAsUser(getUserJwt(req), 'agent_deployments', patchQuery, {
        method: 'PATCH',
        body: {
          runtime_instance_id: data.runtime_instance_id,
          execution_policy: data.execution_policy || existing[0].execution_policy || {},
          status: 'active',
          updated_at: now,
        },
      })) as AgentDeploymentRow[];
      return res.json({ success: true, data: patched?.[0] || existing[0] });
    }

    const created = (await supabaseRestAsUser(getUserJwt(req), 'agent_deployments', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        agent_id: data.agent_id,
        runtime_instance_id: data.runtime_instance_id,
        status: 'active',
        execution_policy: data.execution_policy || {
          approvals: { required: true },
          llm: { route: 'synthetichr_gateway' },
          secrets: { mode: 'mixed' },
        },
        created_at: now,
        updated_at: now,
      },
    })) as AgentDeploymentRow[];

    if (!created?.length) return res.status(500).json({ success: false, error: 'Failed to create deployment' });
    return res.status(201).json({ success: true, data: created[0] });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// =========================
// Runtime enrollment + runtime-auth endpoints (public, runtime JWT)
// =========================

router.post('/enroll', async (req: Request, res: Response) => {
  try {
    const { valid, data, errors } = validateRequestBody<z.infer<typeof runtimeSchemas.enroll>>(runtimeSchemas.enroll, req.body);
    if (!valid || !data) return res.status(400).json({ success: false, errors });

    const query = new URLSearchParams();
    query.set('id', eq(data.runtime_id));
    query.set('select', '*');
    const rows = (await supabaseRestAsService('runtime_instances', query)) as any[];
    const runtime = rows?.[0];
    if (!runtime) return res.status(404).json({ success: false, error: 'Runtime instance not found' });

    const expiresAt = runtime.enrollment_expires_at ? new Date(runtime.enrollment_expires_at).getTime() : 0;
    if (!expiresAt || Date.now() > expiresAt) {
      return res.status(401).json({ success: false, error: 'Enrollment token expired' });
    }
    if (runtime.enrollment_used_at) {
      return res.status(401).json({ success: false, error: 'Enrollment token already used' });
    }

    const expectedHash = String(runtime.enrollment_token_hash || '');
    const gotHash = hashToken(data.enrollment_token);
    if (!expectedHash || gotHash !== expectedHash) {
      return res.status(401).json({ success: false, error: 'Invalid enrollment token' });
    }

    const runtimeSecret = generateOpaqueToken(48);
    const secretEnc = encryptSecret(runtimeSecret);
    const now = nowIso();

    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(data.runtime_id));
    const patched = (await supabaseRestAsService('runtime_instances', patchQuery, {
      method: 'PATCH',
      body: {
        runtime_secret_enc: secretEnc,
        enrollment_used_at: now,
        status: 'online',
        last_heartbeat_at: now,
        version: data.version || runtime.version || null,
        capabilities: data.capabilities || runtime.capabilities || {},
        updated_at: now,
      },
    })) as any[];

    const finalRuntime = patched?.[0] || runtime;

    logger.info('[enrollment] DB patch result', {
      rows_returned: patched?.length ?? 0,
      secret_enc_prefix: secretEnc.slice(0, 6),
      secret_enc_len: secretEnc.length,
      runtime_id: data.runtime_id,
      used_fallback: !patched?.[0],
    });

    const jwt = await signRuntimeJwt(runtimeSecret, {
      runtime_id: finalRuntime.id,
      organization_id: finalRuntime.organization_id,
    });

    // Persist secret to GCP Secret Manager in the background so the runtime
    // survives Cloud Run restarts without re-enrollment.
    void persistRuntimeSecretToGCPFromAPI(runtimeSecret, finalRuntime.organization_id);

    return res.json({
      success: true,
      runtime_id: finalRuntime.id,
      organization_id: finalRuntime.organization_id,
      runtime_secret: runtimeSecret, // shown once; runtime should store securely
      runtime_jwt: jwt, // convenience for immediate boot
      expires_in_seconds: 300,
    });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.post('/heartbeat', requireRuntimeAuth(), async (req: Request, res: Response) => {
  try {
    const ctx = (req as any).runtime as RuntimeAuthContext;
    const { valid, data, errors } = validateRequestBody<z.infer<typeof runtimeSchemas.heartbeat>>(runtimeSchemas.heartbeat, req.body || {});
    if (!valid) return res.status(400).json({ success: false, errors });

    const now = nowIso();
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(ctx.runtime_id));

    const patched = (await supabaseRestAsService('runtime_instances', patchQuery, {
      method: 'PATCH',
      body: {
        status: data?.status || 'online',
        last_heartbeat_at: now,
        ...(data?.version ? { version: data.version } : {}),
        ...(data?.capabilities ? { capabilities: data.capabilities } : {}),
        updated_at: now,
      },
    })) as RuntimeInstanceRow[];

    return res.json({ success: true, data: patched?.[0] || null });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Runtime pulls queued jobs (poll-based)
// Job claim visibility timeout: jobs claimed but not heartbeated for this long are returned to queue by the reaper.
const JOB_CLAIM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

router.get('/jobs/poll', requireRuntimeAuth(), async (req: Request, res: Response) => {
  try {
    const ctx = (req as any).runtime as RuntimeAuthContext;
    const limit = Math.max(1, Math.min(20, Number(req.query.limit || 5)));

    // Atomic claim: only pick up jobs that are either unclaimed OR whose claim has
    // expired (the claiming runtime crashed without completing or heartbeating).
    const staleThreshold = new Date(Date.now() - JOB_CLAIM_TIMEOUT_MS).toISOString();

    const query = new URLSearchParams();
    query.set('organization_id', eq(ctx.organization_id));
    query.set('runtime_instance_id', eq(ctx.runtime_id));
    query.set('status', eq('queued'));
    query.set('or', `(claimed_by.is.null,claimed_at.lt.${staleThreshold})`);
    query.set('order', 'created_at.asc');
    query.set('limit', String(limit));
    const rows = (await supabaseRestAsService('agent_jobs', query)) as any[];

    const claimed: any[] = [];
    const now = nowIso();

    for (const job of rows || []) {
      // Conditional PATCH: only succeeds if status is still 'queued' — prevents double-dispatch
      const claimQuery = new URLSearchParams();
      claimQuery.set('id', eq(job.id));
      claimQuery.set('status', eq('queued'));
      claimQuery.set('runtime_instance_id', eq(ctx.runtime_id));

      const patched = (await supabaseRestAsService('agent_jobs', claimQuery, {
        method: 'PATCH',
        body: {
          status: 'running',
          started_at: now,
          claimed_by: ctx.runtime_id,
          claimed_at: now,
        },
      })) as any[];

      if (patched?.length) {
        claimed.push(patched[0]);
      }
    }

    return res.json({ success: true, data: claimed, count: claimed.length });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Runtime heartbeat for an in-progress job — refreshes claimed_at to prevent reaper reclaim.
router.post('/jobs/:id/heartbeat', requireRuntimeAuth(), async (req: Request, res: Response) => {
  try {
    const ctx = (req as any).runtime as RuntimeAuthContext;
    const { id } = req.params;

    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(id));
    patchQuery.set('runtime_instance_id', eq(ctx.runtime_id));
    patchQuery.set('status', eq('running'));

    const patched = (await supabaseRestAsService('agent_jobs', patchQuery, {
      method: 'PATCH',
      body: { claimed_at: nowIso() },
    })) as any[];

    if (!patched?.length) {
      return res.status(404).json({ success: false, error: 'Job not found, not running, or not owned by this runtime' });
    }
    return res.json({ success: true });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Runtime receives a stream of jobs (SSE). This is outbound-first and firewall friendly.
router.get('/jobs/stream', requireRuntimeAuth(), async (req: Request, res: Response) => {
  const ctx = (req as any).runtime as RuntimeAuthContext;
  const limit = Math.max(1, Math.min(10, Number(req.query.limit || 1)));
  const pollMs = Math.max(500, Math.min(5000, Number(req.query.poll_ms || 1500)));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  req.on('close', () => { closed = true; });

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('ready', { ok: true, runtime_id: ctx.runtime_id });

  const interval = setInterval(async () => {
    if (closed) return;
    try {
      const query = new URLSearchParams();
      query.set('organization_id', eq(ctx.organization_id));
      query.set('runtime_instance_id', eq(ctx.runtime_id));
      query.set('status', eq('queued'));
      query.set('order', 'created_at.asc');
      query.set('limit', String(limit));
      const rows = (await supabaseRestAsService('agent_jobs', query)) as any[];
      if (!rows?.length) return;

      const now = nowIso();
      for (const job of rows) {
        const claimQuery = new URLSearchParams();
        claimQuery.set('id', eq(job.id));
        claimQuery.set('status', eq('queued'));
        claimQuery.set('runtime_instance_id', eq(ctx.runtime_id));

        const patched = (await supabaseRestAsService('agent_jobs', claimQuery, {
          method: 'PATCH',
          body: { status: 'running', started_at: now },
        })) as any[];

        if (patched?.length) {
          send('job', patched[0]);
        }
      }
    } catch (err: any) {
      send('error', { message: err?.message || String(err) });
    }
  }, pollMs);

  const keepAlive = setInterval(() => {
    if (closed) return;
    res.write(`event: ping\ndata: ${JSON.stringify({ ts: nowIso() })}\n\n`);
  }, 15000);

  const cleanup = () => {
    clearInterval(interval);
    clearInterval(keepAlive);
    try { res.end(); } catch { /* ignore */ }
  };

  req.on('close', cleanup);
});

router.post('/jobs/:id/complete', requireRuntimeAuth(), async (req: Request, res: Response) => {
  try {
    const ctx = (req as any).runtime as RuntimeAuthContext;
    const { id } = req.params;

    const { valid, data, errors } = validateRequestBody<z.infer<typeof runtimeSchemas.completeJob>>(runtimeSchemas.completeJob, req.body);
    if (!valid || !data) return res.status(400).json({ success: false, errors });

    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(id));
    patchQuery.set('runtime_instance_id', eq(ctx.runtime_id));

    const now = nowIso();
    const patched = (await supabaseRestAsService('agent_jobs', patchQuery, {
      method: 'PATCH',
      body: {
        status: data.status,
        finished_at: now,
        ...(data.output ? { output: data.output } : {}),
        ...(data.error ? { error: data.error } : {}),
      },
    })) as any[];

    if (!patched?.length) return res.status(404).json({ success: false, error: 'Job not found for this runtime' });

    const completedJob = patched[0];

    if (completedJob?.type === 'chat_turn' || completedJob?.type === 'workflow_run') {
      const input = completedJob.input && typeof completedJob.input === 'object' ? completedJob.input : {};
      const conversationId = typeof input.conversation_id === 'string' ? input.conversation_id.trim() : '';
      if (conversationId) {
        const output = data.output && typeof data.output === 'object' ? data.output : {};
        const usage = output?.raw?.usage && typeof output.raw.usage === 'object' ? output.raw.usage : {};
        const assistantText =
          typeof output?.final?.message === 'string' && output.final.message.trim().length > 0
            ? output.final.message
            : typeof output?.message === 'string' && output.message.trim().length > 0
              ? output.message
              : data.status === 'failed'
                ? `I could not complete this request: ${data.error || 'Execution failed.'}`
                : '';

        if (assistantText) {
          await supabaseRestAsService('messages', '', {
            method: 'POST',
            body: {
              conversation_id: conversationId,
              role: 'assistant',
              content: assistantText,
              token_count: Number(usage.completion_tokens || usage.output_tokens || 0) || 0,
              cost_usd: Number(usage.cost_usd || output?.raw?.usage?.cost_usd || 0) || 0,
              created_at: now,
            },
          }).catch(() => void 0);
        }

        const conversationQuery = new URLSearchParams();
        conversationQuery.set('id', eq(conversationId));
        conversationQuery.set('organization_id', eq(ctx.organization_id));
        conversationQuery.set('select', 'id,metadata');
        conversationQuery.set('limit', '1');
        const conversationRows = (await supabaseRestAsService('conversations', conversationQuery).catch(() => [])) as any[];
        const conversation = conversationRows?.[0] || null;
        const conversationPatchQuery = new URLSearchParams();
        conversationPatchQuery.set('id', eq(conversationId));
        conversationPatchQuery.set('organization_id', eq(ctx.organization_id));
        await supabaseRestAsService('conversations', conversationPatchQuery, {
          method: 'PATCH',
          body: {
            status: data.status === 'failed' ? 'error' : 'active',
            ended_at: data.status === 'failed' ? now : null,
            metadata: {
              ...(conversation?.metadata && typeof conversation.metadata === 'object' ? conversation.metadata : {}),
              latest_job_id: completedJob.id,
              latest_job_status: data.status,
            },
          },
        }).catch(() => void 0);
      }
    }

    // Fire job.completed triggers when a playbook job succeeds.
    if (data.status === 'succeeded' && completedJob?.playbook_id) {
      firePlaybookTriggers(ctx.organization_id, 'job.completed', {
        job_id: completedJob.id,
        playbook_id: completedJob.playbook_id,
        agent_id: completedJob.agent_id,
        output: data.output || {},
      });
    }

    // Notify submitter on completion (webhook + Slack DM) for playbook jobs.
    if ((data.status === 'succeeded' || data.status === 'failed') && completedJob?.playbook_id) {
      notifyJobCompletedAsync({
        organizationId: ctx.organization_id,
        jobId: completedJob.id,
        playbookId: completedJob.playbook_id,
        agentId: completedJob.agent_id || null,
        status: data.status,
        output: data.output || null,
        error: data.error || null,
        createdBy: completedJob.created_by || null,
      });
    }

    return res.json({ success: true, data: completedJob });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.post('/jobs/:id/log', requireRuntimeAuth(), async (req: Request, res: Response) => {
  try {
    const ctx = (req as any).runtime as RuntimeAuthContext;
    const { id } = req.params;
    const { valid, data, errors } = validateRequestBody<z.infer<typeof runtimeSchemas.appendJobLog>>(runtimeSchemas.appendJobLog, req.body);
    if (!valid || !data) return res.status(400).json({ success: false, errors });

    const query = new URLSearchParams();
    query.set('id', eq(id));
    query.set('runtime_instance_id', eq(ctx.runtime_id));
    query.set('select', 'id,output');
    const rows = (await supabaseRestAsService('agent_jobs', query)) as any[];
    if (!rows?.length) return res.status(404).json({ success: false, error: 'Job not found for this runtime' });

    const currentOutput = rows[0].output && typeof rows[0].output === 'object' ? rows[0].output : {};
    const currentLogs = Array.isArray(currentOutput.logs) ? currentOutput.logs : [];
    const nextLogs = [...currentLogs, { line: data.line, level: data.level || 'info', ts: data.ts || nowIso() }].slice(-200);

    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(id));
    patchQuery.set('runtime_instance_id', eq(ctx.runtime_id));
    const patched = (await supabaseRestAsService('agent_jobs', patchQuery, {
      method: 'PATCH',
      body: {
        output: {
          ...currentOutput,
          logs: nextLogs,
        },
      },
    })) as any[];

    return res.json({ success: true, data: patched?.[0] || null });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// =========================
// Runtime internal connector actions (runtime auth)
// =========================

router.get('/actions/policy', requireRuntimeAuth(), async (req: Request, res: Response) => {
  try {
    const ctx = (req as any).runtime as RuntimeAuthContext;
    const parsed = actionPolicyQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });
    }

    const q = new URLSearchParams();
    q.set('organization_id', eq(ctx.organization_id));
    q.set('service', eq(parsed.data.service));
    q.set('action', eq(parsed.data.action));
    q.set('select', '*');
    q.set('limit', '1');

    const rows = (await supabaseRestAsService('action_policies', q)) as any[];
    const row = rows?.[0] || null;

    return res.json({ success: true, data: row });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.post('/actions/execute', requireRuntimeAuth(), async (req: Request, res: Response) => {
  try {
    const ctx = (req as any).runtime as RuntimeAuthContext;
    const parsed = internalActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });
    }

    const action = parsed.data.action;
    const payload = parsed.data.payload || {};
    const now = nowIso();

    // Enforce action policy (runtime-side defense-in-depth).
    {
      const polQ = new URLSearchParams();
      polQ.set('organization_id', eq(ctx.organization_id));
      polQ.set('service', eq('internal'));
      polQ.set('action', eq(action));
      polQ.set('select', '*');
      polQ.set('limit', '1');
      const polRows = (await supabaseRestAsService('action_policies', polQ)) as any[];
      const policy = polRows?.[0] || null;
      if (policy && policy.enabled === false) {
        const created = (await supabaseRestAsService('agent_action_runs', '', {
          method: 'POST',
          body: {
            organization_id: ctx.organization_id,
            agent_id: parsed.data.agent_id || null,
            job_id: parsed.data.job_id || null,
            action_type: action,
            status: 'failed',
            input: payload,
            output: {},
            error: 'Action disabled by policy',
            created_at: now,
          },
        })) as any[];
        return res.status(403).json({ success: false, error: 'Action disabled by policy', action_run: created?.[0] || null });
      }
    }

    const makeActionRun = async (result: { status: 'ok' | 'failed'; input: any; output: any; error?: string | null }) => {
      const created = (await supabaseRestAsService('agent_action_runs', '', {
        method: 'POST',
        body: {
          organization_id: ctx.organization_id,
          agent_id: parsed.data.agent_id || null,
          job_id: parsed.data.job_id || null,
          action_type: action,
          status: result.status,
          input: result.input || {},
          output: result.output || {},
          error: result.error || null,
          created_at: now,
        },
      })) as any[];
      return created?.[0] || null;
    };

    // support.ticket.create
    if (action === 'support.ticket.create') {
      const title = pickText(payload.title ?? payload.subject ?? 'Support ticket', 200) || 'Support ticket';
      const description = pickText(payload.description ?? payload.body ?? payload.ticket_text ?? null, 20000);
      const priority = pickText(payload.priority ?? 'medium', 20) || 'medium';
      const customer_email = pickText(payload.customer_email ?? null, 320);
      const tags = Array.isArray(payload.tags) ? payload.tags.map((t: any) => String(t)).slice(0, 20) : [];

      const createdTickets = (await supabaseRestAsService('support_tickets', '', {
        method: 'POST',
        body: {
          organization_id: ctx.organization_id,
          title,
          description,
          priority,
          status: 'open',
          customer_email,
          tags,
          source: 'agent',
          created_by: null,
          created_at: now,
          updated_at: now,
        },
      })) as any[];

      const ticket = createdTickets?.[0] || null;
      if (!ticket) {
        const run = await makeActionRun({ status: 'failed', input: payload, output: {}, error: 'Failed to create support ticket' });
        return res.status(500).json({ success: false, error: 'Failed to create support ticket', action_run: run });
      }

      const run = await makeActionRun({ status: 'ok', input: payload, output: { ticket_id: ticket.id, resource_type: 'support_ticket', resource_id: ticket.id } });
      if (run?.id) {
        const patchQ = new URLSearchParams();
        patchQ.set('id', eq(ticket.id));
        patchQ.set('organization_id', eq(ctx.organization_id));
        await supabaseRestAsService('support_tickets', patchQ, {
          method: 'PATCH',
          body: { job_id: parsed.data.job_id || null, action_run_id: run.id, updated_at: now },
        }).catch(() => void 0);
      }
      return res.json({ success: true, data: { resource: ticket, action_run: run } });
    }

    // support.ticket.update_status
    if (action === 'support.ticket.update_status') {
      const ticketId = pickText(payload.ticket_id ?? payload.id ?? null, 60);
      const status = pickText(payload.status ?? null, 20);
      if (!ticketId || !status) {
        const run = await makeActionRun({ status: 'failed', input: payload, output: {}, error: 'ticket_id and status are required' });
        return res.status(400).json({ success: false, error: 'ticket_id and status are required', action_run: run });
      }

      const patchQuery = new URLSearchParams();
      patchQuery.set('id', eq(ticketId));
      patchQuery.set('organization_id', eq(ctx.organization_id));

      const patched = (await supabaseRestAsService('support_tickets', patchQuery, {
        method: 'PATCH',
        body: { status, updated_at: now },
      })) as any[];

      const updated = patched?.[0] || null;
      if (!updated) {
        const run = await makeActionRun({ status: 'failed', input: payload, output: {}, error: 'Support ticket not found' });
        return res.status(404).json({ success: false, error: 'Support ticket not found', action_run: run });
      }

      const run = await makeActionRun({ status: 'ok', input: payload, output: { ticket_id: updated.id, status: updated.status, resource_type: 'support_ticket', resource_id: updated.id } });
      if (run?.id) {
        await supabaseRestAsService('support_tickets', patchQuery, {
          method: 'PATCH',
          body: { job_id: parsed.data.job_id || updated.job_id || null, action_run_id: run.id, updated_at: now },
        }).catch(() => void 0);
      }
      return res.json({ success: true, data: { resource: updated, action_run: run } });
    }

    // sales.lead.create
    if (action === 'sales.lead.create') {
      const company_name = pickText(payload.company_name ?? payload.company ?? payload.account ?? 'Lead', 200) || 'Lead';
      const contact_name = pickText(payload.contact_name ?? payload.name ?? null, 200);
      const contact_email = pickText(payload.contact_email ?? payload.email ?? null, 320);
      const contact_phone = pickText(payload.contact_phone ?? payload.phone ?? null, 50);
      const stage = pickText(payload.stage ?? 'new', 20) || 'new';
      const score = Number.isFinite(Number(payload.score)) ? Math.max(0, Math.min(10, Number(payload.score))) : 0;
      const tags = Array.isArray(payload.tags) ? payload.tags.map((t: any) => String(t)).slice(0, 20) : [];
      const notes = payload.notes && typeof payload.notes === 'object' ? payload.notes : { raw: payload };

      const createdLeads = (await supabaseRestAsService('sales_leads', '', {
        method: 'POST',
        body: {
          organization_id: ctx.organization_id,
          company_name,
          contact_name,
          contact_email,
          contact_phone,
          stage,
          score,
          tags,
          notes,
          source: 'agent',
          created_by: null,
          created_at: now,
          updated_at: now,
        },
      })) as any[];

      const lead = createdLeads?.[0] || null;
      if (!lead) {
        const run = await makeActionRun({ status: 'failed', input: payload, output: {}, error: 'Failed to create sales lead' });
        return res.status(500).json({ success: false, error: 'Failed to create sales lead', action_run: run });
      }

      const run = await makeActionRun({ status: 'ok', input: payload, output: { lead_id: lead.id, resource_type: 'sales_lead', resource_id: lead.id } });
      if (run?.id) {
        const patchQ = new URLSearchParams();
        patchQ.set('id', eq(lead.id));
        patchQ.set('organization_id', eq(ctx.organization_id));
        await supabaseRestAsService('sales_leads', patchQ, {
          method: 'PATCH',
          body: { job_id: parsed.data.job_id || null, action_run_id: run.id, updated_at: now },
        }).catch(() => void 0);
      }
      return res.json({ success: true, data: { resource: lead, action_run: run } });
    }

    // sales.lead.update_stage
    if (action === 'sales.lead.update_stage') {
      const leadId = pickText(payload.lead_id ?? payload.id ?? null, 60);
      const stage = pickText(payload.stage ?? null, 20);
      if (!leadId || !stage) {
        const run = await makeActionRun({ status: 'failed', input: payload, output: {}, error: 'lead_id and stage are required' });
        return res.status(400).json({ success: false, error: 'lead_id and stage are required', action_run: run });
      }

      const patchQuery = new URLSearchParams();
      patchQuery.set('id', eq(leadId));
      patchQuery.set('organization_id', eq(ctx.organization_id));

      const patched = (await supabaseRestAsService('sales_leads', patchQuery, {
        method: 'PATCH',
        body: { stage, updated_at: now },
      })) as any[];

      const updated = patched?.[0] || null;
      if (!updated) {
        const run = await makeActionRun({ status: 'failed', input: payload, output: {}, error: 'Sales lead not found' });
        return res.status(404).json({ success: false, error: 'Sales lead not found', action_run: run });
      }

      const run = await makeActionRun({ status: 'ok', input: payload, output: { lead_id: updated.id, stage: updated.stage, resource_type: 'sales_lead', resource_id: updated.id } });
      if (run?.id) {
        await supabaseRestAsService('sales_leads', patchQuery, {
          method: 'PATCH',
          body: { job_id: parsed.data.job_id || updated.job_id || null, action_run_id: run.id, updated_at: now },
        }).catch(() => void 0);
      }
      return res.json({ success: true, data: { resource: updated, action_run: run } });
    }

    // it.access_request.create
    if (action === 'it.access_request.create') {
      const subject = pickText(payload.subject ?? payload.title ?? 'Access request', 200) || 'Access request';
      const requestor_email = pickText(payload.requestor_email ?? payload.email ?? null, 320);
      const system_name = pickText(payload.system_name ?? payload.system ?? null, 200);
      const requested_access = payload.requested_access && typeof payload.requested_access === 'object'
        ? payload.requested_access
        : { raw: payload.requested_access ?? payload.access ?? payload };
      const justification = pickText(payload.justification ?? payload.reason ?? null, 20000);

      const createdRequests = (await supabaseRestAsService('it_access_requests', '', {
        method: 'POST',
        body: {
          organization_id: ctx.organization_id,
          subject,
          requestor_email,
          system_name,
          requested_access,
          justification,
          status: 'pending',
          source: 'agent',
          created_by: null,
          created_at: now,
          updated_at: now,
        },
      })) as any[];

      const accessRequest = createdRequests?.[0] || null;
      if (!accessRequest) {
        const run = await makeActionRun({ status: 'failed', input: payload, output: {}, error: 'Failed to create access request' });
        return res.status(500).json({ success: false, error: 'Failed to create access request', action_run: run });
      }

      const run = await makeActionRun({ status: 'ok', input: payload, output: { access_request_id: accessRequest.id, resource_type: 'it_access_request', resource_id: accessRequest.id } });
      if (run?.id) {
        const patchQ = new URLSearchParams();
        patchQ.set('id', eq(accessRequest.id));
        patchQ.set('organization_id', eq(ctx.organization_id));
        await supabaseRestAsService('it_access_requests', patchQ, {
          method: 'PATCH',
          body: { job_id: parsed.data.job_id || null, action_run_id: run.id, updated_at: now },
        }).catch(() => void 0);
      }
      return res.json({ success: true, data: { resource: accessRequest, action_run: run } });
    }

    // it.access_request.decide
    if (action === 'it.access_request.decide') {
      const requestId = pickText(payload.access_request_id ?? payload.id ?? null, 60);
      const decision = pickText(payload.decision ?? null, 20);
      if (!requestId || !decision || !['approved', 'rejected'].includes(decision)) {
        const run = await makeActionRun({ status: 'failed', input: payload, output: {}, error: 'access_request_id and decision (approved|rejected) are required' });
        return res.status(400).json({ success: false, error: 'access_request_id and decision (approved|rejected) are required', action_run: run });
      }

      const patchQuery = new URLSearchParams();
      patchQuery.set('id', eq(requestId));
      patchQuery.set('organization_id', eq(ctx.organization_id));

      const patched = (await supabaseRestAsService('it_access_requests', patchQuery, {
        method: 'PATCH',
        body: {
          status: decision,
          decided_at: now,
          updated_at: now,
        },
      })) as any[];

      const updated = patched?.[0] || null;
      if (!updated) {
        const run = await makeActionRun({ status: 'failed', input: payload, output: {}, error: 'Access request not found' });
        return res.status(404).json({ success: false, error: 'Access request not found', action_run: run });
      }

      const run = await makeActionRun({ status: 'ok', input: payload, output: { access_request_id: updated.id, status: updated.status, resource_type: 'it_access_request', resource_id: updated.id } });
      if (run?.id) {
        await supabaseRestAsService('it_access_requests', patchQuery, {
          method: 'PATCH',
          body: { job_id: parsed.data.job_id || updated.job_id || null, action_run_id: run.id, updated_at: now },
        }).catch(() => void 0);
      }
      return res.json({ success: true, data: { resource: updated, action_run: run } });
    }

    const run = await makeActionRun({ status: 'failed', input: payload, output: {}, error: `Unsupported internal action: ${action}` });
    return res.status(400).json({ success: false, error: `Unsupported internal action: ${action}`, action_run: run });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// =========================
// External connector action execution (runtime auth)
// Looks up org's integration credentials and calls the provider API.
// =========================

async function getIntegrationCredentials(orgId: string, serviceType: string): Promise<Record<string, string> | null> {
  const intQ = new URLSearchParams();
  intQ.set('organization_id', eq(orgId));
  intQ.set('service_type', eq(serviceType));
  intQ.set('select', 'id,status');
  const integrations = (await supabaseRestAsService('integrations', intQ)) as any[];
  const integration = integrations?.[0];
  if (!integration || integration.status === 'disconnected') return null;

  const credQ = new URLSearchParams();
  credQ.set('integration_id', eq(integration.id));
  credQ.set('select', 'key,value,is_sensitive');
  const rows = (await supabaseRestAsService('integration_credentials', credQ)) as any[];
  const creds: Record<string, string> = {};
  for (const row of rows) {
    creds[row.key] = row.is_sensitive ? decryptSecret(row.value) : row.value;
  }
  return creds;
}

async function executeExternalAction(
  service: string,
  action: string,
  creds: Record<string, string>,
  payload: Record<string, any>,
): Promise<{ ok: boolean; output: any; error?: string }> {
  // ── SUPPORT: Zendesk ──
  if (service === 'zendesk') {
    const subdomain = String(creds.subdomain || '').replace(/\.zendesk\.com$/, '');
    const auth = Buffer.from(`${creds.email}/token:${creds.apiToken}`).toString('base64');
    const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };

    if (action === 'support.ticket.reply') {
      const ticketId = payload.ticketId || payload.ticket_id;
      if (!ticketId) return { ok: false, output: {}, error: 'payload.ticketId is required for ticket reply' };
      const res = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets/${ticketId}.json`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ticket: { comment: { body: String(payload.comment || payload.message || ''), public: payload.public !== false } } }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, output: data, error: data?.error || `Zendesk reply failed (${res.status})` };
      return { ok: true, output: { ticket_id: data?.ticket?.id, status: data?.ticket?.status } };
    }
    if (action === 'support.ticket.update_status') {
      const ticketId = payload.ticketId || payload.ticket_id;
      const status = payload.status || 'solved';
      if (!ticketId) return { ok: false, output: {}, error: 'payload.ticketId is required for status update' };
      const res = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets/${ticketId}.json`, {
        method: 'PUT', headers,
        body: JSON.stringify({ ticket: { status } }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, output: data, error: data?.error || `Zendesk status update failed (${res.status})` };
      return { ok: true, output: { ticket_id: data?.ticket?.id, status: data?.ticket?.status } };
    }
  }

  // ── SUPPORT: Freshdesk ──
  if (service === 'freshdesk') {
    const subdomain = String(creds.subdomain || '').replace(/\.freshdesk\.com$/, '');
    const auth = Buffer.from(`${creds.apiKey}:X`).toString('base64');
    const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };

    if (action === 'support.ticket.reply') {
      const ticketId = payload.ticketId || payload.ticket_id;
      if (!ticketId) return { ok: false, output: {}, error: 'payload.ticketId is required for ticket reply' };
      const res = await fetch(`https://${subdomain}.freshdesk.com/api/v2/tickets/${ticketId}/reply`, {
        method: 'POST', headers,
        body: JSON.stringify({ body: String(payload.comment || payload.message || '') }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, output: data, error: data?.description || `Freshdesk reply failed (${res.status})` };
      return { ok: true, output: { conversation_id: data?.id } };
    }
    if (action === 'support.ticket.update_status') {
      const ticketId = payload.ticketId || payload.ticket_id;
      const statusMap: Record<string, number> = { open: 2, pending: 3, resolved: 4, closed: 5 };
      const status = statusMap[String(payload.status || 'resolved')] ?? 4;
      if (!ticketId) return { ok: false, output: {}, error: 'payload.ticketId is required for status update' };
      const res = await fetch(`https://${subdomain}.freshdesk.com/api/v2/tickets/${ticketId}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ status }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, output: data, error: data?.description || `Freshdesk status update failed (${res.status})` };
      return { ok: true, output: { ticket_id: data?.id, status: data?.status } };
    }
  }

  // ── SUPPORT: Intercom ──
  if (service === 'intercom') {
    const headers = { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json', 'Intercom-Version': '2.10' };
    if (action === 'support.ticket.reply') {
      const conversationId = payload.conversationId || payload.conversation_id;
      if (!conversationId) return { ok: false, output: {}, error: 'payload.conversationId is required for Intercom reply' };
      const res = await fetch(`https://api.intercom.io/conversations/${conversationId}/reply`, {
        method: 'POST', headers,
        body: JSON.stringify({ message_type: 'note', type: 'admin', admin_id: creds.adminId || payload.adminId, body: String(payload.message || payload.comment || '') }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, output: data, error: data?.errors?.[0]?.message || `Intercom reply failed (${res.status})` };
      return { ok: true, output: { conversation_id: data?.id } };
    }
  }

  // ── SALES: HubSpot ──
  if (service === 'hubspot') {
    const headers = { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' };
    if (action === 'sales.lead.update') {
      const contactId = payload.contactId || payload.contact_id;
      if (!contactId) return { ok: false, output: {}, error: 'payload.contactId is required for HubSpot lead update' };
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ properties: payload.properties || {} }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, output: data, error: data?.message || `HubSpot lead update failed (${res.status})` };
      return { ok: true, output: { contact_id: data?.id, properties: data?.properties } };
    }
    if (action === 'sales.deal.update') {
      const dealId = payload.dealId || payload.deal_id;
      if (!dealId) return { ok: false, output: {}, error: 'payload.dealId is required for HubSpot deal update' };
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ properties: payload.properties || {} }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, output: data, error: data?.message || `HubSpot deal update failed (${res.status})` };
      return { ok: true, output: { deal_id: data?.id, properties: data?.properties } };
    }
    if (action === 'sales.lead.create') {
      const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST', headers,
        body: JSON.stringify({ properties: payload.properties || { email: payload.email, firstname: payload.firstName, lastname: payload.lastName, company: payload.company } }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, output: data, error: data?.message || `HubSpot contact create failed (${res.status})` };
      return { ok: true, output: { contact_id: data?.id } };
    }
  }

  // ── SALES: Salesforce ──
  if (service === 'salesforce') {
    const instanceUrl = String(creds.instanceUrl || '').replace(/\/+$/, '');
    const headers = { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' };
    if (action === 'sales.lead.create') {
      const res = await fetch(`${instanceUrl}/services/data/v58.0/sobjects/Lead`, {
        method: 'POST', headers,
        body: JSON.stringify({ FirstName: payload.firstName, LastName: payload.lastName || 'Unknown', Company: payload.company || 'Unknown', Email: payload.email, LeadSource: payload.leadSource || 'Web', ...payload.extra }),
      });
      const data: any = await res.json().catch(() => ({}));
      const errMsg = Array.isArray(data) ? data[0]?.message : data?.message;
      if (!res.ok) return { ok: false, output: data, error: errMsg || `Salesforce lead create failed (${res.status})` };
      return { ok: true, output: { lead_id: data?.id } };
    }
    if (action === 'sales.lead.update' || action === 'sales.opportunity.update') {
      const sobject = action.includes('opportunity') ? 'Opportunity' : 'Lead';
      const recordId = payload.recordId || payload.leadId || payload.opportunityId;
      if (!recordId) return { ok: false, output: {}, error: `payload.recordId is required for Salesforce ${sobject} update` };
      const res = await fetch(`${instanceUrl}/services/data/v58.0/sobjects/${sobject}/${recordId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify(payload.properties || {}),
      });
      if (!res.ok) {
        const data: any = await res.json().catch(() => ({}));
        return { ok: false, output: data, error: Array.isArray(data) ? data[0]?.message : `Salesforce update failed (${res.status})` };
      }
      return { ok: true, output: { record_id: recordId, sobject } };
    }
  }

  // ── IT: Okta ──
  if (service === 'okta') {
    const domain = String(creds.domain || '').replace(/\/+$/, '');
    const headers = { Authorization: `SSWS ${creds.apiToken}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (action === 'identity.user.provision') {
      const email = payload.email || payload.login;
      if (!email) return { ok: false, output: {}, error: 'payload.email is required for Okta user provisioning' };
      const res = await fetch(`https://${domain}/api/v1/users?activate=${payload.activate !== false}`, {
        method: 'POST', headers,
        body: JSON.stringify({ profile: { firstName: payload.firstName || 'New', lastName: payload.lastName || 'User', email, login: email }, credentials: payload.tempPassword ? { password: { value: payload.tempPassword } } : undefined }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, output: data, error: data?.errorSummary || `Okta user provision failed (${res.status})` };
      return { ok: true, output: { user_id: data?.id, status: data?.status, login: data?.profile?.login } };
    }
    if (action === 'identity.user.deactivate') {
      const userId = payload.userId || payload.user_id;
      if (!userId) return { ok: false, output: {}, error: 'payload.userId is required for Okta user deactivation' };
      const res = await fetch(`https://${domain}/api/v1/users/${userId}/lifecycle/deactivate`, { method: 'POST', headers });
      if (!res.ok) {
        const data: any = await res.json().catch(() => ({}));
        return { ok: false, output: data, error: data?.errorSummary || `Okta deactivate failed (${res.status})` };
      }
      return { ok: true, output: { user_id: userId, status: 'DEPROVISIONED' } };
    }
    if (action === 'identity.group.assign') {
      const userId = payload.userId || payload.user_id;
      const groupId = payload.groupId || payload.group_id;
      if (!userId || !groupId) return { ok: false, output: {}, error: 'payload.userId and payload.groupId are required for group assignment' };
      const res = await fetch(`https://${domain}/api/v1/groups/${groupId}/users/${userId}`, { method: 'PUT', headers });
      if (!res.ok) {
        const data: any = await res.json().catch(() => ({}));
        return { ok: false, output: data, error: data?.errorSummary || `Okta group assign failed (${res.status})` };
      }
      return { ok: true, output: { user_id: userId, group_id: groupId } };
    }
  }

  // ── FINANCE: Stripe ──
  if (service === 'stripe') {
    const auth = Buffer.from(`${creds.secretKey}:`).toString('base64');
    if (action === 'finance.refund.create') {
      const paymentIntentId = payload.paymentIntentId || payload.payment_intent;
      if (!paymentIntentId) return { ok: false, output: {}, error: 'payload.paymentIntentId is required for Stripe refund' };
      const params = new URLSearchParams({ payment_intent: paymentIntentId });
      if (payload.amount) params.set('amount', String(payload.amount));
      if (payload.reason) params.set('reason', String(payload.reason));
      const res = await fetch('https://api.stripe.com/v1/refunds', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, output: data, error: data?.error?.message || `Stripe refund failed (${res.status})` };
      return { ok: true, output: { refund_id: data?.id, status: data?.status, amount: data?.amount } };
    }
  }

  // ── FINANCE: RazorpayX ──
  if (service === 'razorpayx') {
    const auth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64');
    const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };
    if (action === 'finance.payout.initiate') {
      const required = ['fund_account_id', 'amount', 'currency', 'mode', 'purpose'];
      const missing = required.filter((k) => !payload[k]);
      if (missing.length) return { ok: false, output: {}, error: `Missing required payout fields: ${missing.join(', ')}` };
      const res = await fetch('https://api.razorpay.com/v1/payouts', {
        method: 'POST', headers,
        body: JSON.stringify({
          account_number: creds.accountNumber,
          fund_account_id: payload.fund_account_id,
          amount: payload.amount,
          currency: payload.currency,
          mode: payload.mode,
          purpose: payload.purpose,
          queue_if_low_balance: payload.queue_if_low_balance ?? true,
          narration: payload.narration || 'RASI agent payout',
          notes: { source: 'rasi-agent', ...(payload.notes || {}) },
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.id) return { ok: false, output: data, error: data?.error?.description || `RazorpayX payout failed (${res.status})` };
      return { ok: true, output: { payout_id: data.id, status: data.status, utr: data.utr } };
    }
  }

  // ── COMPLIANCE: ClearTax ──
  if (service === 'cleartax') {
    const headers = { Authorization: `Bearer ${creds.authToken}`, 'Content-Type': 'application/json' };
    if (action === 'compliance.gst.file') {
      const gstin = payload.gstin || creds.gstin;
      if (!gstin) return { ok: false, output: {}, error: 'payload.gstin is required for GST filing' };
      const res = await fetch(`https://api.cleartax.in/v1/gst/returns`, {
        method: 'POST', headers,
        body: JSON.stringify({ gstin, return_type: payload.return_type || 'GSTR1', year: payload.year, period: payload.period, data: payload.data || {} }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, output: data, error: data?.message || `ClearTax GST filing failed (${res.status})` };
      return { ok: true, output: { transaction_id: data?.transaction_id, status: data?.status } };
    }
    if (action === 'compliance.tds.calculate') {
      const res = await fetch('https://api.cleartax.in/v1/tds/calculate', {
        method: 'POST', headers,
        body: JSON.stringify({ pan: payload.pan, payment_amount: payload.amount, section: payload.section || '194C' }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, output: data, error: data?.message || `ClearTax TDS calculation failed (${res.status})` };
      return { ok: true, output: { tds_amount: data?.tds_amount, rate: data?.rate } };
    }
  }

  return { ok: false, output: {}, error: `Action '${action}' is not implemented for provider '${service}'` };
}

const externalActionSchema = z.object({
  job_id: z.string().optional(),
  agent_id: z.string().uuid().optional(),
  service: z.string().min(1),
  action: z.string().min(1),
  payload: z.record(z.any()).optional().default({}),
});

router.post('/actions/execute-external', requireRuntimeAuth(), async (req: Request, res: Response) => {
  try {
    const ctx = (req as any).runtime as RuntimeAuthContext;
    const parsed = externalActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });
    }
    const { job_id, agent_id, service, action, payload } = parsed.data;
    const now = nowIso();

    const makeActionRun = async (result: { status: 'ok' | 'failed'; input: any; output: any; error?: string | null }) => {
      const created = (await supabaseRestAsService('agent_action_runs', '', {
        method: 'POST',
        body: {
          organization_id: ctx.organization_id,
          agent_id: agent_id || null,
          job_id: job_id || null,
          action_type: `${service}.${action}`,
          status: result.status,
          input: result.input || {},
          output: result.output || {},
          error: result.error || null,
          created_at: now,
        },
      })) as any[];
      return created?.[0] || null;
    };

    // Check policy
    {
      const polQ = new URLSearchParams();
      polQ.set('organization_id', eq(ctx.organization_id));
      polQ.set('service', eq(service));
      polQ.set('action', eq(action));
      polQ.set('select', '*');
      polQ.set('limit', '1');
      const polRows = (await supabaseRestAsService('action_policies', polQ)) as any[];
      const policy = polRows?.[0] || null;
      if (policy && policy.enabled === false) {
        const run = await makeActionRun({ status: 'failed', input: payload, output: {}, error: 'Action disabled by policy' });
        return res.status(403).json({ success: false, error: 'Action disabled by policy', action_run: run });
      }
      const constraintEvaluation = evaluatePolicyConstraints(payload || {}, policy?.policy_constraints || {});
      if (constraintEvaluation.blocked) {
        const run = await makeActionRun({ status: 'failed', input: payload, output: { policy_reasons: constraintEvaluation.blockReasons }, error: constraintEvaluation.blockReasons[0] || 'Action blocked by policy constraints' });
        return res.status(403).json({ success: false, error: constraintEvaluation.blockReasons[0] || 'Action blocked by policy constraints', action_run: run });
      }
      if (constraintEvaluation.approvalRequired && !job_id) {
        const run = await makeActionRun({ status: 'failed', input: payload, output: { approval_reasons: constraintEvaluation.approvalReasons }, error: 'Action requires an approved job before runtime execution' });
        return res.status(409).json({ success: false, error: 'Action requires an approved job before runtime execution', action_run: run });
      }
    }

    // Look up credentials
    const creds = await getIntegrationCredentials(ctx.organization_id, service);
    if (!creds) {
      const run = await makeActionRun({ status: 'failed', input: payload, output: {}, error: `No active integration found for service: ${service}` });
      return res.status(404).json({ success: false, error: `No active integration found for service: ${service}`, action_run: run });
    }

    // Execute
    const result = await executeExternalAction(service, action, creds, payload);
    const run = await makeActionRun({
      status: result.ok ? 'ok' : 'failed',
      input: payload,
      output: result.output,
      error: result.error || null,
    });

    try {
      let approvalId: string | null = null;
      let policySnapshot: Record<string, any> = {};
      if (job_id) {
        const approvalQ = new URLSearchParams();
        approvalQ.set('job_id', eq(job_id));
        approvalQ.set('select', 'id,policy_snapshot');
        approvalQ.set('limit', '1');
        const approvalRows = (await supabaseRestAsService('agent_job_approvals', approvalQ)) as Array<{ id: string; policy_snapshot: Record<string, any> }>;
        approvalId = approvalRows?.[0]?.id || null;
        policySnapshot = approvalRows?.[0]?.policy_snapshot || {};
      }

      await supabaseRestAsService('connector_action_executions', '', {
        method: 'POST',
        body: {
          organization_id: ctx.organization_id,
          agent_id: agent_id || null,
          integration_id: null,
          connector_id: service,
          action,
          params: payload,
          result: result.output || {},
          success: result.ok,
          error_message: result.error || null,
          approval_required: Boolean(approvalId),
          approval_id: approvalId,
          requested_by: null,
          policy_snapshot: buildGovernedActionSnapshot({
            source: 'runtime',
            service,
            action,
            recordedAt: now,
            decision: 'executed',
            result: result.ok ? 'succeeded' : 'failed',
            approvalRequired: Boolean(approvalId),
            approvalId,
            requestedBy: null,
            agentId: agent_id || null,
            durationMs: null,
            existingSnapshot: policySnapshot,
          }),
          before_state: {},
          after_state: result.ok ? (result.output || {}) : {},
          remediation: result.ok ? {} : { suggested: 'Review connector credentials, provider state, and approval policy' },
          created_at: now,
        },
      });
    } catch { /* non-critical */ }

    if (!result.ok) {
      return res.status(422).json({ success: false, error: result.error, action_run: run });
    }
    return res.json({ success: true, data: result.output, action_run: run });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// =========================
// Scheduler tick (runtime auth)
// =========================

/**
 * Parse a single cron field into the set of matching integers.
 * Handles: * , - / (standard 5-field cron syntax).
 */
function parseCronField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) result.add(i);
    } else if (part.includes('/')) {
      const [rangeStr, stepStr] = part.split('/');
      const step = Math.max(1, parseInt(stepStr, 10));
      let lo = min;
      let hi = max;
      if (rangeStr !== '*') {
        if (rangeStr.includes('-')) {
          [lo, hi] = rangeStr.split('-').map(Number);
        } else {
          lo = hi = parseInt(rangeStr, 10);
        }
      }
      for (let i = lo; i <= hi; i += step) result.add(i);
    } else if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number);
      for (let i = lo; i <= hi; i++) result.add(i);
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) result.add(n);
    }
  }
  return result;
}

/**
 * Compute the next UTC datetime after `after` that matches a 5-field cron expression.
 * Fields: minute hour dom month dow (0-indexed for dow: 0=Sun, 6=Sat).
 * Returns null if no match found within 1 year.
 */
function nextCronRun(cronExpr: string, after: Date): Date | null {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [mf, hf, domf, monthf, dowf] = parts;
  const minutes = parseCronField(mf, 0, 59);
  const hours   = parseCronField(hf, 0, 23);
  const doms    = parseCronField(domf, 1, 31);
  const months  = parseCronField(monthf, 1, 12);
  const dows    = parseCronField(dowf, 0, 6);

  // Start scanning from the next whole minute after `after`.
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const limit = new Date(after.getTime() + 366 * 24 * 60 * 60 * 1000);

  while (cursor < limit) {
    if (
      months.has(cursor.getUTCMonth() + 1) &&
      doms.has(cursor.getUTCDate()) &&
      dows.has(cursor.getUTCDay()) &&
      hours.has(cursor.getUTCHours()) &&
      minutes.has(cursor.getUTCMinutes())
    ) {
      return new Date(cursor);
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  return null;
}

/**
 * POST /runtimes/schedules/tick
 *
 * Called by the runtime worker on a regular interval (e.g. every 60 s).
 * Finds all enabled playbook schedules whose next_run_at has passed,
 * creates a queued agent_job for each, then advances the schedule timestamps.
 */
router.post('/schedules/tick', requireRuntimeAuth(), async (req: Request, res: Response) => {
  try {
    const ctx = (req as any).runtime as RuntimeAuthContext;
    const now = new Date();
    const nowIsoStr = now.toISOString();

    // Find due schedules for this org.
    const schedQ = new URLSearchParams();
    schedQ.set('organization_id', eq(ctx.organization_id));
    schedQ.set('enabled', eq('true'));
    schedQ.set('next_run_at', lte(nowIsoStr));
    schedQ.set('order', 'next_run_at.asc');
    schedQ.set('limit', '20');

    const dueSchedules = (await supabaseRestAsService('playbook_schedules', schedQ)) as Array<{
      id: string;
      organization_id: string;
      playbook_id: string;
      agent_id: string;
      input_template: any;
      cron_expression: string;
      enabled: boolean;
      created_by: string | null;
    }>;

    if (!dueSchedules || dueSchedules.length === 0) {
      return res.json({ success: true, jobs_created: 0 });
    }

    const createdJobIds: string[] = [];

    for (const schedule of dueSchedules) {
      try {
        // Create the agent job.
        const jobBody: Record<string, any> = {
          organization_id: schedule.organization_id,
          agent_id: schedule.agent_id,
          runtime_instance_id: ctx.runtime_id,
          type: 'workflow_run',
          status: 'queued',
          input: schedule.input_template && Object.keys(schedule.input_template).length > 0
            ? schedule.input_template
            : { workflow: { steps: [], final_step: '' } },
          playbook_id: schedule.playbook_id || null,
          created_by: schedule.created_by || null,
          created_at: nowIsoStr,
          updated_at: nowIsoStr,
        };

        const created = (await supabaseRestAsService('agent_jobs', '', {
          method: 'POST',
          body: jobBody,
        })) as any[];

        const job = created?.[0];
        if (job?.id) {
          createdJobIds.push(job.id);

          // Also create a pre-approved approval record so audit trail is preserved.
          await supabaseRestAsService('agent_job_approvals', '', {
            method: 'POST',
            body: {
              organization_id: schedule.organization_id,
              job_id: job.id,
              status: 'approved',
              decided_by: null,
              decision_note: 'Auto-approved: scheduled run',
              created_at: nowIsoStr,
              updated_at: nowIsoStr,
            },
          }).catch(() => void 0); // non-fatal
        }

        // Advance the schedule timestamps.
        const nextRun = nextCronRun(schedule.cron_expression, now);
        const schedUpdateQ = new URLSearchParams();
        schedUpdateQ.set('id', eq(schedule.id));
        await supabaseRestAsService('playbook_schedules', schedUpdateQ, {
          method: 'PATCH',
          body: {
            last_run_at: nowIsoStr,
            next_run_at: nextRun ? nextRun.toISOString() : null,
            updated_at: nowIsoStr,
          },
        }).catch((e: any) => {
          logger.warn(`[schedules/tick] failed to update schedule ${schedule.id}: ${e?.message}`);
        });
      } catch (jobErr: any) {
        // Don't abort the whole tick if one schedule fails.
        logger.error(`[schedules/tick] failed to create job for schedule ${schedule.id}: ${jobErr?.message}`);
      }
    }

    return res.json({ success: true, jobs_created: createdJobIds.length, job_ids: createdJobIds });
  } catch (err: any) {
    return safeError(res, err);
  }
});

export default router;
