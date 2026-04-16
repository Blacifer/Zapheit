/// <reference types="jest" />
import http from 'http';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

// ── Mocks ────────────────────────────────────────────────────────────────────

class MockSupabaseRestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'SupabaseRestError';
  }
}

jest.mock('../../lib/supabase-rest', () => ({
  supabaseRestAsUser: jest.fn(),
  supabaseRestAsService: jest.fn(),
  supabaseRest: jest.fn(),
  SupabaseRestError: MockSupabaseRestError,
  eq: (v: string | number) => `eq.${encodeURIComponent(String(v))}`,
  gte: (v: any) => `gte.${encodeURIComponent(String(v))}`,
  in_: (vals: any[]) => `in.(${vals.join(',')})`,
  lt: (v: any) => `lt.${encodeURIComponent(String(v))}`,
  lte: (v: any) => `lte.${encodeURIComponent(String(v))}`,
  not: (v: any) => `not.${String(v)}`,
  is: (v: any) => `is.${String(v)}`,
}));

jest.mock('../../lib/audit-logger', () => ({
  auditLog: { log: jest.fn() },
}));

jest.mock('../../lib/webhook-relay', () => ({
  fireAndForgetWebhookEvent: jest.fn(),
}));

jest.mock('../../lib/slack-notify', () => ({
  notifySlackApproval: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/notification-service', () => ({
  notifyApprovalAssignedAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/correction-memory', () => ({
  storeCorrection: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/agentic-tool-execution', () => ({
  markApprovalDeniedExecution: jest.fn().mockResolvedValue(undefined),
  resumeApprovedToolCall: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/email', () => ({
  sendTransactionalEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_USER_ID   = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID  = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const TEST_ORG_ID    = '22222222-2222-4222-8222-222222222222';
const APPROVAL_ID    = '33333333-3333-4333-8333-333333333333';

import { supabaseRestAsUser, supabaseRestAsService } from '../../lib/supabase-rest';
const mockedRestUser    = supabaseRestAsUser    as jest.MockedFunction<typeof supabaseRestAsUser>;
const mockedRestService = supabaseRestAsService as jest.MockedFunction<typeof supabaseRestAsService>;

// ── App factory ───────────────────────────────────────────────────────────────

function createApprovalApp(role = 'super_admin', userId = TEST_USER_ID) {
  const app = express();
  app.use(express.json());
  app.use('/api/approvals', (req: any, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header) return _res.status(401).json({ success: false, error: 'Missing authentication token' });
    req.user = { id: userId, email: 'test@example.com', organization_id: TEST_ORG_ID, role };
    req.userJwt = 'mock-jwt';
    next();
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  app.use('/api/approvals', require('../../routes/approvals').default);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Approval flow', () => {
  let server: http.Server;

  beforeAll((done) => { server = createApprovalApp().listen(0, done); });
  afterAll((done) => { server.close(done); });

  beforeEach(() => {
    mockedRestUser.mockReset();
    mockedRestService.mockReset();
  });

  // ── POST /api/approvals — create ─────────────────────────────────────────

  describe('POST /api/approvals', () => {
    const VALID_BODY = {
      service: 'crm',
      action: 'delete_contact',
      action_payload: { contact_id: 'c123' },
      required_role: 'manager',
      expires_in_hours: 24,
    };

    it('returns 401 when no Authorization header is provided', async () => {
      const res = await request(server).post('/api/approvals').send(VALID_BODY);
      expect(res.status).toBe(401);
    });

    it('creates an approval request and returns 200 with the new record', async () => {
      // No linked action_policy_id → skip policy lookup
      mockedRestUser.mockResolvedValueOnce([{
        id: APPROVAL_ID,
        organization_id: TEST_ORG_ID,
        service: 'crm',
        action: 'delete_contact',
        status: 'pending',
        required_role: 'manager',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        created_at: new Date().toISOString(),
      }]);

      const res = await request(server)
        .post('/api/approvals')
        .set('Authorization', 'Bearer token')
        .send(VALID_BODY);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.status).toBe('pending');
    });
  });

  // ── POST /api/approvals/:id/approve — matching approver ──────────────────

  describe('POST /api/approvals/:id/approve', () => {
    const pendingRow = {
      id: APPROVAL_ID,
      organization_id: TEST_ORG_ID,
      status: 'pending',
      required_role: 'manager',
      assigned_to: null, // not restricted to specific reviewer
      service: 'crm',
      action: 'delete_contact',
      action_payload: {},
      agent_id: null,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };

    it('returns 401 when no Authorization header is provided', async () => {
      const res = await request(server)
        .post(`/api/approvals/${APPROVAL_ID}/approve`)
        .send({});
      expect(res.status).toBe(401);
    });

    it('approves the request when the reviewer has sufficient role and no assignment constraint', async () => {
      mockedRestUser
        .mockResolvedValueOnce([pendingRow])              // fetch approval row
        .mockResolvedValueOnce([{ ...pendingRow, status: 'approved', reviewer_id: TEST_USER_ID }]); // PATCH

      const res = await request(server)
        .post(`/api/approvals/${APPROVAL_ID}/approve`)
        .set('Authorization', 'Bearer token')
        .send({ note: 'LGTM' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('approved');
    });

    it('returns 403 when approval is assigned to a different reviewer', async () => {
      const assignedRow = { ...pendingRow, assigned_to: OTHER_USER_ID };
      mockedRestUser.mockResolvedValueOnce([assignedRow]);

      const res = await request(server)
        .post(`/api/approvals/${APPROVAL_ID}/approve`)
        .set('Authorization', 'Bearer token')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('returns 403 when the reviewer role is insufficient', async () => {
      const highRoleRow = { ...pendingRow, required_role: 'super_admin' };
      mockedRestUser.mockResolvedValueOnce([highRoleRow]);

      // Create an app where the user is a viewer trying to approve a super_admin-required request
      const viewerApp = createApprovalApp('viewer', TEST_USER_ID);

      await new Promise<void>((resolve, reject) => {
        const viewerServer = viewerApp.listen(0, async () => {
          try {
            const res = await request(viewerServer)
              .post(`/api/approvals/${APPROVAL_ID}/approve`)
              .set('Authorization', 'Bearer token')
              .send({});
            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            viewerServer.close(() => resolve());
          } catch (err) {
            viewerServer.close(() => reject(err));
          }
        });
      });
    });

    it('returns 404 when the approval request does not exist', async () => {
      mockedRestUser.mockResolvedValueOnce([]); // empty result

      const res = await request(server)
        .post(`/api/approvals/${APPROVAL_ID}/approve`)
        .set('Authorization', 'Bearer token')
        .send({});

      expect(res.status).toBe(404);
    });

    it('approves a governed job approval through the approvals endpoint when the id belongs to agent_job_approvals', async () => {
      mockedRestUser.mockImplementation(async (_jwt: string, table: string, _query: any, options?: any) => {
        const method = options?.method || 'GET';
        if (table === 'approval_requests' && method === 'GET') return [];
        if (table === 'agent_job_approvals' && method === 'GET') {
          return [{
            id: APPROVAL_ID,
            job_id: 'job-1',
            status: 'pending',
            requested_by: TEST_USER_ID,
            required_approvals: 1,
            approval_history: [],
            policy_snapshot: { required_role: 'manager', workflow: { source: 'apps', source_ref: 'job-1' } },
            created_at: new Date().toISOString(),
          }];
        }
        if (table === 'agent_jobs' && method === 'GET') {
          return [{
            id: 'job-1',
            organization_id: TEST_ORG_ID,
            agent_id: null,
            type: 'connector_action',
            status: 'pending_approval',
            input: { connector: { service: 'slack', action: 'comms.message.send', params: { channel: '#ops' } } },
            output: {},
            created_at: new Date().toISOString(),
          }];
        }
        if (table === 'agent_job_approvals' && method === 'PATCH') {
          return [{
            id: APPROVAL_ID,
            job_id: 'job-1',
            status: 'approved',
            requested_by: TEST_USER_ID,
            approved_by: TEST_USER_ID,
            required_approvals: 1,
            approval_history: [{ reviewer_id: TEST_USER_ID, decision: 'approved', decided_at: new Date().toISOString() }],
            policy_snapshot: { required_role: 'manager', workflow: { source: 'apps', source_ref: 'job-1' } },
            created_at: new Date().toISOString(),
            decided_at: new Date().toISOString(),
          }];
        }
        if (table === 'agent_jobs' && method === 'PATCH') {
          return [{
            id: 'job-1',
            organization_id: TEST_ORG_ID,
            agent_id: null,
            type: 'connector_action',
            status: 'queued',
            input: { connector: { service: 'slack', action: 'comms.message.send', params: { channel: '#ops' } } },
            output: {},
            created_at: new Date().toISOString(),
          }];
        }
        return [];
      });

      const res = await request(server)
        .post(`/api/approvals/${APPROVAL_ID}/approve`)
        .set('Authorization', 'Bearer token')
        .send({ note: 'Ship it' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.approval_source).toBe('job_approval');
      expect(res.body.data.status).toBe('approved');
      expect(res.body.data.job_id).toBe('job-1');
      expect(res.body.execution.resumed).toBe(true);
    });
  });
});
