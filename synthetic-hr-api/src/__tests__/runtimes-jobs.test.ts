import http from 'http';
import request from 'supertest';
import express from 'express';
import { SignJWT } from 'jose';

import runtimesRouter from '../routes/runtimes';
import jobsRouter from '../routes/jobs';
import { hashToken } from '../lib/runtime-auth';
import { supabaseRestAsService, supabaseRestAsUser } from '../lib/supabase-rest';

jest.mock('../lib/supabase-rest', () => ({
  supabaseRestAsService: jest.fn(),
  supabaseRestAsUser: jest.fn(),
  eq: (value: string | number) => `eq.${encodeURIComponent(String(value))}`,
  SupabaseRestError: class SupabaseRestError extends Error {
    status: number;
    responseBody: string;
    constructor(status: number, responseBody: string) {
      super(`Supabase REST API error: ${status} ${responseBody}`);
      this.status = status;
      this.responseBody = responseBody;
    }
  },
}));

const mockedService = supabaseRestAsService as jest.MockedFunction<typeof supabaseRestAsService>;
const mockedUser = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_ORG_ID = '22222222-2222-4222-8222-222222222222';
const TEST_AGENT_ID = '33333333-3333-4333-8333-333333333333';
const TEST_RUNTIME_ID = '44444444-4444-4444-8444-444444444444';

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Emulate index.ts: runtime endpoints bypass user auth, other /api endpoints require user context.
  app.use('/api', (req: any, _res, next) => {
    const isRuntimeEndpoint =
      (req.path === '/runtimes/enroll' && req.method === 'POST') ||
      (req.path === '/runtimes/heartbeat' && req.method === 'POST') ||
      req.path.startsWith('/runtimes/jobs/');

    if (isRuntimeEndpoint) return next();

    const authHeader = String(req.headers.authorization || '');
    if (!authHeader.startsWith('Bearer ')) return next();
    const token = authHeader.slice('Bearer '.length).trim();

    req.user = {
      id: TEST_USER_ID,
      email: 'test@example.com',
      organization_id: TEST_ORG_ID,
      role: token,
    };
    req.userJwt = 'test-user-jwt';
    next();
  });

  app.use('/api/runtimes', runtimesRouter);
  app.use('/api/jobs', jobsRouter);
  return app;
}

describe('Runtime + Jobs orchestration', () => {
  const app = createTestApp();
  let server: http.Server;

  beforeAll((done) => { server = app.listen(0, done); });
  afterAll((done) => { server.close(done); });

  const state: any = {
    runtime: null as any,
    deployment: null as any,
    job: null as any,
    approval: null as any,
  };

  const enrollmentToken = 'enroll_test_token_abcdefghijklmnopqrstuvwxyz';
  const enrollmentHash = hashToken(enrollmentToken);
  const enrollmentExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  let runtimeSecretForAuth = 'runtime_secret_plaintext_for_tests';

  beforeEach(() => {
    mockedService.mockReset();
    mockedUser.mockReset();

    mockedUser.mockImplementation(async (_jwt: string, table: string, _query: any, options: any = {}) => {
      const method = options?.method || 'GET';

      if (table === 'runtime_instances' && method === 'POST') {
        state.runtime = {
          id: TEST_RUNTIME_ID,
          organization_id: TEST_ORG_ID,
          name: options.body.name,
          mode: options.body.mode,
          status: options.body.status,
          last_heartbeat_at: null,
          version: null,
          capabilities: {},
          metadata: {},
          created_at: options.body.created_at,
          updated_at: options.body.updated_at,
          enrollment_token_hash: options.body.enrollment_token_hash,
          enrollment_expires_at: options.body.enrollment_expires_at,
          enrollment_used_at: null,
          runtime_secret_enc: null,
        };
        return [state.runtime];
      }

      if (table === 'runtime_instances' && method === 'GET') {
        return state.runtime ? [state.runtime] : [];
      }

      if (table === 'agent_deployments' && method === 'GET') {
        return state.deployment ? [state.deployment] : [];
      }

      if (table === 'agent_deployments' && method === 'POST') {
        state.deployment = {
          id: 'dep-1',
          organization_id: TEST_ORG_ID,
          agent_id: options.body.agent_id,
          runtime_instance_id: options.body.runtime_instance_id,
          status: 'active',
          execution_policy: options.body.execution_policy,
          created_at: options.body.created_at,
          updated_at: options.body.updated_at,
        };
        return [state.deployment];
      }

      if (table === 'agent_jobs' && method === 'POST') {
        state.job = {
          id: 'job-1',
          organization_id: TEST_ORG_ID,
          agent_id: options.body.agent_id,
          runtime_instance_id: options.body.runtime_instance_id,
          type: options.body.type,
          status: options.body.status,
          input: options.body.input,
          output: {},
          error: null,
          created_by: options.body.created_by,
          created_at: options.body.created_at,
          started_at: null,
          finished_at: null,
        };
        return [state.job];
      }

      if (table === 'agent_jobs' && method === 'GET') {
        return state.job ? [state.job] : [];
      }

      if (table === 'agent_jobs' && method === 'PATCH') {
        if (!state.job) return [];
        state.job = { ...state.job, ...options.body };
        return [state.job];
      }

      if (table === 'agent_job_approvals' && method === 'POST') {
        state.approval = {
          id: 'appr-1',
          job_id: options.body.job_id,
          requested_by: options.body.requested_by,
          approved_by: null,
          status: options.body.status,
          policy_snapshot: options.body.policy_snapshot,
          created_at: options.body.created_at,
          decided_at: null,
        };
        return [state.approval];
      }

      if (table === 'agent_job_approvals' && method === 'GET') {
        return state.approval ? [state.approval] : [];
      }

      if (table === 'agent_job_approvals' && method === 'PATCH') {
        if (!state.approval) return [];
        state.approval = { ...state.approval, ...options.body };
        return [state.approval];
      }

      if (table === 'agent_deployments' && method === 'PATCH') {
        if (!state.deployment) return [];
        state.deployment = { ...state.deployment, ...options.body };
        return [state.deployment];
      }

      return [];
    });

    mockedService.mockImplementation(async (table: string, _query: any, options: any = {}) => {
      const method = options?.method || 'GET';

      if (table === 'runtime_instances' && method === 'GET') {
        // Enrollment + auth lookups
        return [{
          id: TEST_RUNTIME_ID,
          organization_id: TEST_ORG_ID,
          enrollment_token_hash: state.runtime?.enrollment_token_hash || enrollmentHash,
          enrollment_expires_at: state.runtime?.enrollment_expires_at || enrollmentExpiresAt,
          enrollment_used_at: state.runtime?.enrollment_used_at || null,
          runtime_secret_enc: state.runtime?.runtime_secret_enc || null,
          status: state.runtime?.status || 'pending',
          version: null,
          capabilities: {},
          metadata: {},
        }];
      }

      if (table === 'runtime_instances' && method === 'PATCH') {
        state.runtime = { ...(state.runtime || { id: TEST_RUNTIME_ID, organization_id: TEST_ORG_ID }), ...options.body };
        return [state.runtime];
      }

      if (table === 'agent_jobs' && method === 'GET') {
        // Runtime polls queued jobs
        if (state.job?.status === 'queued') return [state.job];
        return [];
      }

      if (table === 'agent_jobs' && method === 'PATCH') {
        // Claim or complete
        if (!state.job) return [];
        state.job = { ...state.job, ...options.body };
        return [state.job];
      }

      return [];
    });
  });

  it('creates a runtime instance (user)', async () => {
    const res = await request(server)
      .post('/api/runtimes')
      .set('Authorization', 'Bearer manager')
      .send({ name: 'Customer VPC runtime', mode: 'vpc' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.enrollment_token).toBe('string');
  });

  it('enrolls a runtime and returns a runtime JWT (runtime)', async () => {
    // Seed runtime row the way create would have
    state.runtime = {
      id: TEST_RUNTIME_ID,
      organization_id: TEST_ORG_ID,
      enrollment_token_hash: enrollmentHash,
      enrollment_expires_at: enrollmentExpiresAt,
      enrollment_used_at: null,
      runtime_secret_enc: null,
    };

    const res = await request(server)
      .post('/api/runtimes/enroll')
      .send({ runtime_id: TEST_RUNTIME_ID, enrollment_token: enrollmentToken, version: 'test' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.runtime_id).toBe(TEST_RUNTIME_ID);
    expect(typeof res.body.runtime_jwt).toBe('string');
    expect(typeof res.body.runtime_secret).toBe('string');
    runtimeSecretForAuth = res.body.runtime_secret as string;
  });

  it('creates a deployment, creates a job, approves it, and runtime can poll+complete', async () => {
    // Enroll runtime for this test so runtime JWT validation can succeed.
    state.runtime = {
      id: TEST_RUNTIME_ID,
      organization_id: TEST_ORG_ID,
      enrollment_token_hash: enrollmentHash,
      enrollment_expires_at: enrollmentExpiresAt,
      enrollment_used_at: null,
      runtime_secret_enc: null,
    };

    const enrollRes = await request(server)
      .post('/api/runtimes/enroll')
      .send({ runtime_id: TEST_RUNTIME_ID, enrollment_token: enrollmentToken, version: 'test' });
    expect(enrollRes.status).toBe(200);
    runtimeSecretForAuth = enrollRes.body.runtime_secret as string;

    // Create deployment
    const depRes = await request(server)
      .post('/api/runtimes/deployments')
      .set('Authorization', 'Bearer manager')
      .send({ agent_id: TEST_AGENT_ID, runtime_instance_id: TEST_RUNTIME_ID });
    expect(depRes.status).toBe(201);
    expect(depRes.body.success).toBe(true);

    // Create job (pending approval — connector_action requires approval)
    const jobRes = await request(server)
      .post('/api/jobs')
      .set('Authorization', 'Bearer manager')
      .send({ agent_id: TEST_AGENT_ID, type: 'connector_action', input: { connector: { service: 'support', action: 'support.test', params: {} } } });
    expect(jobRes.status).toBe(201);
    expect(jobRes.body.success).toBe(true);

    // Approve job -> queued
    const decisionRes = await request(server)
      .post('/api/jobs/job-1/decision')
      .set('Authorization', 'Bearer manager')
      .send({ decision: 'approved' });
    expect(decisionRes.status).toBe(200);
    expect(decisionRes.body.data.job.status).toBe('queued');

    // Runtime auth token
    const jwt = await new SignJWT({ runtime_id: TEST_RUNTIME_ID, organization_id: TEST_ORG_ID })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(runtimeSecretForAuth));

    // Poll -> running
    const pollRes = await request(server)
      .get('/api/runtimes/jobs/poll?limit=1')
      .set('Authorization', `Bearer ${jwt}`);
    expect(pollRes.status).toBe(200);
    expect(pollRes.body.success).toBe(true);
    expect(pollRes.body.data[0].status).toBe('running');

    // Complete -> succeeded
    const completeRes = await request(server)
      .post('/api/runtimes/jobs/job-1/complete')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ status: 'succeeded', output: { ok: true } });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.status).toBe('succeeded');
  });
});
