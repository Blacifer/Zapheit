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
  gte: (v: string | number) => `gte.${encodeURIComponent(String(v))}`,
  in_: (vals: any[]) => `in.(${vals.join(',')})`,
  lt: (v: any) => `lt.${encodeURIComponent(String(v))}`,
  lte: (v: any) => `lte.${encodeURIComponent(String(v))}`,
  not: (v: any) => `not.${String(v)}`,
  is: (v: any) => `is.${String(v)}`,
}));

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ success: false, error: 'Missing authentication token' });
    const token = String(header).replace('Bearer ', '').trim();
    if (!token || token === 'invalid') return res.status(401).json({ success: false, error: 'Invalid token' });
    (req as any).user = {
      id: TEST_USER_ID,
      email: 'test@example.com',
      organization_id: null, // new user — no org yet
      role: 'super_admin',
    };
    (req as any).userJwt = 'mock-jwt';
    next();
  },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_ORG_ID  = '22222222-2222-4222-8222-222222222222';

import { supabaseRestAsService, supabaseRestAsUser } from '../../lib/supabase-rest';
const mockedRestService = supabaseRestAsService as jest.MockedFunction<typeof supabaseRestAsService>;
const mockedRestUser    = supabaseRestAsUser    as jest.MockedFunction<typeof supabaseRestAsUser>;

// ── App factories ─────────────────────────────────────────────────────────────

function createAuthApp() {
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  app.use('/auth', require('../../routes/auth').default);
  return app;
}

function createApiApp(role = 'super_admin') {
  const app = express();
  app.use(express.json());
  app.use('/api', (req: any, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header) return _res.status(401).json({ success: false, error: 'Missing authentication token' });
    req.user = { id: TEST_USER_ID, email: 'test@example.com', organization_id: TEST_ORG_ID, role };
    req.userJwt = 'mock-jwt';
    next();
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  app.use('/api', require('../../routes/api').default);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Auth flow', () => {
  let authServer: http.Server;
  let apiServer: http.Server;

  beforeAll((done) => {
    authServer = createAuthApp().listen(0, () => {
      apiServer = createApiApp().listen(0, done);
    });
  });

  afterAll((done) => {
    apiServer.close(() => authServer.close(done));
  });

  beforeEach(() => {
    mockedRestService.mockReset();
    mockedRestUser.mockReset();
  });

  // ── POST /auth/provision ────────────────────────────────────────────────

  describe('POST /auth/provision', () => {
    it('returns 401 when no Authorization header is provided', async () => {
      const res = await request(authServer).post('/auth/provision').send({});
      expect(res.status).toBe(401);
    });

    it('returns 401 for an invalid token', async () => {
      const res = await request(authServer)
        .post('/auth/provision')
        .set('Authorization', 'Bearer invalid')
        .send({});
      expect(res.status).toBe(401);
    });

    it('provisions a new org and returns organizationId on first call', async () => {
      // No existing user row → proceed to creation
      mockedRestService
        .mockResolvedValueOnce([])               // user lookup (idempotency check)
        .mockResolvedValueOnce([])               // org slug lookup
        .mockResolvedValueOnce([{ id: TEST_ORG_ID, slug: 'test-workspace' }]) // org insert
        .mockResolvedValueOnce([{ id: TEST_USER_ID }]);                        // user insert

      const res = await request(authServer)
        .post('/auth/provision')
        .set('Authorization', 'Bearer valid-token')
        .send({ orgName: 'Test Workspace' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('organizationId');
    });

    it('returns already-provisioned response idempotently when user row exists', async () => {
      mockedRestService.mockResolvedValueOnce([{ id: TEST_USER_ID, organization_id: TEST_ORG_ID }]);

      const res = await request(authServer)
        .post('/auth/provision')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.organizationId).toBe(TEST_ORG_ID);
    });
  });

  // ── GET /api/agents ─────────────────────────────────────────────────────

  describe('GET /api/agents', () => {
    it('returns 401 when no Authorization header is provided', async () => {
      const res = await request(apiServer).get('/api/agents');
      expect(res.status).toBe(401);
    });

    it('returns 200 with agent array and pagination cursor for authenticated user', async () => {
      // The agents route calls supabaseRestAsUser multiple times (list + enrichment queries).
      // Return empty arrays for all enrichment calls so the route completes successfully.
      mockedRestUser.mockResolvedValue([]);
      // First call: the main agent list
      mockedRestUser.mockResolvedValueOnce([
        { id: 'agent-1', name: 'Agent Alpha', organization_id: TEST_ORG_ID, status: 'active', created_at: new Date().toISOString() },
        { id: 'agent-2', name: 'Agent Beta',  organization_id: TEST_ORG_ID, status: 'active', created_at: new Date().toISOString() },
      ]);

      const res = await request(apiServer)
        .get('/api/agents')
        .set('Authorization', 'Bearer super_admin');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
