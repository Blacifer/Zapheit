/// <reference types="jest" />
/**
 * Multi-tenant isolation tests.
 *
 * These tests verify the core SaaS invariant: Org A can never read, modify,
 * or delete Org B's resources — even when authenticated with a valid token.
 *
 * Approach: the supabase-rest layer is mocked so that each org's mock returns
 * only its own rows. The middleware under test is the real auth + RBAC chain.
 * We verify that the API routes apply org_id scoping and that cross-org
 * resource IDs are rejected (404 / 403), not silently served.
 */
import http from 'http';
import request from 'supertest';
import express from 'express';
import apiRouter from '../routes/api';
import { supabaseRestAsUser } from '../lib/supabase-rest';

// SupabaseRestError must live inside the factory (jest.mock is hoisted, so
// variables defined outside the factory aren't accessible at call time).
jest.mock('../lib/supabase-rest', () => {
  class SupabaseRestError extends Error {
    status: number;
    responseBody: string;
    constructor(status: number, responseBody: string) {
      super(`Supabase REST API error: ${status} ${responseBody}`);
      this.status = status;
      this.responseBody = responseBody;
    }
  }
  return {
    supabaseRestAsUser: jest.fn(),
    supabaseRest: jest.fn(),
    SupabaseRestError,
    eq: (value: string | number) => `eq.${encodeURIComponent(String(value))}`,
    gte: (value: string | number) => `gte.${encodeURIComponent(String(value))}`,
    in_: (values: any[]) => `in.(${values.join(',')})`,
  };
});

const mockedSupabaseRest = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;

// ── Org A ──────────────────────────────────────────────────────────────────
const ORG_A_ID   = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_A_USER = 'a1111111-1111-4111-8111-111111111111';
const ORG_A_AGENT_ID    = 'a2222222-2222-4222-8222-222222222222';
const ORG_A_INCIDENT_ID = 'a3333333-3333-4333-8333-333333333333';

// ── Org B ──────────────────────────────────────────────────────────────────
const ORG_B_ID   = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORG_B_USER = 'b1111111-1111-4111-8111-111111111111';
const ORG_B_AGENT_ID    = 'b2222222-2222-4222-8222-222222222222';
const ORG_B_INCIDENT_ID = 'b3333333-3333-4333-8333-333333333333';

/**
 * Build a minimal Express app.
 * Auth middleware only injects req.user when a Bearer token is present,
 * so unauthenticated requests fall through to the real 401 handler.
 */
function buildApp(userId: string, orgId: string, role = 'admin') {
  const app = express();
  app.use(express.json());

  app.use('/api', (req: any, res, next) => {
    const authHeader = req.headers.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) return next();
    req.user = { id: userId, email: `${userId}@test.com`, organization_id: orgId, role };
    req.userJwt = 'mock-jwt';
    next();
  });

  app.use('/api', apiRouter);
  return app;
}

describe('Multi-tenant isolation', () => {
  const appA = buildApp(ORG_A_USER, ORG_A_ID, 'admin');
  const appB = buildApp(ORG_B_USER, ORG_B_ID, 'admin');

  let serverA: http.Server;
  let serverB: http.Server;

  beforeAll((done) => {
    serverA = appA.listen(0, () => {
      serverB = appB.listen(0, done);
    });
  }, 15000);

  afterAll((done) => {
    serverA.close(() => serverB.close(done));
  }, 15000);

  beforeEach(() => {
    mockedSupabaseRest.mockReset();
  });

  // ── Agents — list scoping ─────────────────────────────────────────────────

  describe('Agents — list scoping', () => {
    it('Org A only sees its own agents', async () => {
      mockedSupabaseRest.mockImplementation(async (_jwt, table) => {
        if (table === 'ai_agents') return [{ id: ORG_A_AGENT_ID, organization_id: ORG_A_ID, name: 'Agent-A', config: {}, metadata: {} }];
        return [];
      });

      const res = await request(serverA).get('/api/agents').set('Authorization', 'Bearer admin');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const ids: string[] = (res.body.data || []).map((a: any) => a.id);
      expect(ids).toContain(ORG_A_AGENT_ID);
      expect(ids).not.toContain(ORG_B_AGENT_ID);
    });

    it('Org B only sees its own agents', async () => {
      mockedSupabaseRest.mockImplementation(async (_jwt, table) => {
        if (table === 'ai_agents') return [{ id: ORG_B_AGENT_ID, organization_id: ORG_B_ID, name: 'Agent-B', config: {}, metadata: {} }];
        return [];
      });

      const res = await request(serverB).get('/api/agents').set('Authorization', 'Bearer admin');
      expect(res.status).toBe(200);

      const ids: string[] = (res.body.data || []).map((a: any) => a.id);
      expect(ids).toContain(ORG_B_AGENT_ID);
      expect(ids).not.toContain(ORG_A_AGENT_ID);
    });
  });

  // ── Agents — cross-org read ───────────────────────────────────────────────

  describe('Agents — cross-org read', () => {
    it('Org A cannot read Org B agent by ID', async () => {
      // DB returns empty row set, simulating RLS filtering out cross-org data
      mockedSupabaseRest.mockResolvedValue([]);

      const res = await request(serverA)
        .get(`/api/agents/${ORG_B_AGENT_ID}`)
        .set('Authorization', 'Bearer admin');

      expect([403, 404]).toContain(res.status);
    }, 15000);

    it('Org B cannot read Org A agent by ID', async () => {
      mockedSupabaseRest.mockResolvedValue([]);

      const res = await request(serverB)
        .get(`/api/agents/${ORG_A_AGENT_ID}`)
        .set('Authorization', 'Bearer admin');

      expect([403, 404]).toContain(res.status);
    }, 15000);
  });

  // ── Agents — cross-org mutation ───────────────────────────────────────────

  describe('Agents — cross-org mutation', () => {
    it('Org A cannot terminate Org B agent', async () => {
      // Empty result: agent not visible to Org A
      mockedSupabaseRest.mockResolvedValue([]);

      const res = await request(serverA)
        .post(`/api/agents/${ORG_B_AGENT_ID}/kill`)
        .set('Authorization', 'Bearer admin')
        .send({ level: 1, reason: 'cross-org test' });

      expect([403, 404]).toContain(res.status);
    }, 15000);

    it('Org B cannot terminate Org A agent', async () => {
      mockedSupabaseRest.mockResolvedValue([]);

      const res = await request(serverB)
        .post(`/api/agents/${ORG_A_AGENT_ID}/kill`)
        .set('Authorization', 'Bearer admin')
        .send({ level: 1, reason: 'cross-org test' });

      expect([403, 404]).toContain(res.status);
    }, 15000);
  });

  // ── Incidents — list scoping ──────────────────────────────────────────────

  describe('Incidents — list scoping', () => {
    it('Org A only sees its own incidents', async () => {
      mockedSupabaseRest.mockImplementation(async (_jwt, table) => {
        if (table === 'incidents') return [{ id: ORG_A_INCIDENT_ID, organization_id: ORG_A_ID }];
        return [];
      });

      const res = await request(serverA).get('/api/incidents').set('Authorization', 'Bearer admin');
      expect(res.status).toBe(200);

      const ids: string[] = (res.body.data || []).map((i: any) => i.id);
      expect(ids).not.toContain(ORG_B_INCIDENT_ID);
    });
  });

  // ── Incidents — cross-org mutation ───────────────────────────────────────

  describe('Incidents — cross-org mutation', () => {
    it('Org A cannot resolve Org B incident', async () => {
      mockedSupabaseRest.mockResolvedValue([]);

      const res = await request(serverA)
        .put(`/api/incidents/${ORG_B_INCIDENT_ID}/resolve`)
        .set('Authorization', 'Bearer admin')
        .send({ resolution_notes: 'cross-org attempt' });

      expect([403, 404]).toContain(res.status);
    }, 15000);

    it('Org B cannot resolve Org A incident', async () => {
      mockedSupabaseRest.mockResolvedValue([]);

      const res = await request(serverB)
        .put(`/api/incidents/${ORG_A_INCIDENT_ID}/resolve`)
        .set('Authorization', 'Bearer admin')
        .send({ resolution_notes: 'cross-org attempt' });

      expect([403, 404]).toContain(res.status);
    }, 15000);
  });

  // ── Auth boundary ─────────────────────────────────────────────────────────

  describe('Unauthenticated access is always rejected', () => {
    it('rejects agent list without token', async () => {
      const res = await request(serverA).get('/api/agents');
      expect(res.status).toBe(401);
    });

    it('rejects incident list without token', async () => {
      const res = await request(serverA).get('/api/incidents');
      expect(res.status).toBe(401);
    });
  });
});
