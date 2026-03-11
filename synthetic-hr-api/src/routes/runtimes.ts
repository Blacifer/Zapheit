import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { logger } from '../lib/logger';
import { SupabaseRestError, eq, supabaseRestAsService, supabaseRestAsUser } from '../lib/supabase-rest';
import { encryptSecret } from '../lib/integrations/encryption';
import { generateOpaqueToken, hashToken, requireRuntimeAuth, signRuntimeJwt, type RuntimeAuthContext } from '../lib/runtime-auth';
import { runtimeSchemas, validateRequestBody } from '../schemas/validation';

const router = Router();

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

    const jwt = await signRuntimeJwt(runtimeSecret, {
      runtime_id: finalRuntime.id,
      organization_id: finalRuntime.organization_id,
    });

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
router.get('/jobs/poll', requireRuntimeAuth(), async (req: Request, res: Response) => {
  try {
    const ctx = (req as any).runtime as RuntimeAuthContext;
    const limit = Math.max(1, Math.min(20, Number(req.query.limit || 5)));

    const query = new URLSearchParams();
    query.set('organization_id', eq(ctx.organization_id));
    query.set('runtime_instance_id', eq(ctx.runtime_id));
    query.set('status', eq('queued'));
    query.set('order', 'created_at.asc');
    query.set('limit', String(limit));
    const rows = (await supabaseRestAsService('agent_jobs', query)) as any[];

    const claimed: any[] = [];
    const now = nowIso();

    for (const job of rows || []) {
      const claimQuery = new URLSearchParams();
      claimQuery.set('id', eq(job.id));
      claimQuery.set('status', eq('queued'));
      claimQuery.set('runtime_instance_id', eq(ctx.runtime_id));

      const patched = (await supabaseRestAsService('agent_jobs', claimQuery, {
        method: 'PATCH',
        body: {
          status: 'running',
          started_at: now,
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
    return res.json({ success: true, data: patched[0] });
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

export default router;
