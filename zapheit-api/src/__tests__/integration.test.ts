/// <reference types="jest" />
import http from 'http';
import request from 'supertest';
import express from 'express';
import apiRouter from '../routes/api';
import { supabaseRestAsUser } from '../lib/supabase-rest';

jest.mock('../lib/supabase-rest', () => ({
  supabaseRestAsUser: jest.fn(),
  supabaseRest: jest.fn(),
  eq: (value: string | number) => `eq.${encodeURIComponent(String(value))}`,
  gte: (value: string | number) => `gte.${encodeURIComponent(String(value))}`,
  in_: (values: any[]) => `in.(${values.join(',')})`,
}));

const mockedSupabaseRest = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_ORG_ID = '22222222-2222-4222-8222-222222222222';

function createTestApp() {
  const app = express();
  app.use(express.json());

  app.use('/api', (req: any, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Missing authentication token' });
    }

    const token = String(authHeader).replace('Bearer ', '').trim();
    if (!token || token === 'invalid') {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    req.user = {
      id: TEST_USER_ID,
      email: 'test@example.com',
      organization_id: TEST_ORG_ID,
      role: token,
    };
    req.userJwt = 'mock-jwt';
    next();
  });

  app.use('/api', apiRouter);
  return app;
}

describe('API Integration Tests', () => {
  const app = createTestApp();
  let server: http.Server;

  beforeAll((done) => { server = app.listen(0, done); });
  afterAll((done) => { server.close(done); });

  beforeEach(() => {
    mockedSupabaseRest.mockReset();
    mockedSupabaseRest.mockImplementation(async (_jwt: string, table: string, _query?: any, options?: any) => {
      const method = options?.method || 'GET';

      if (table === 'ai_agents' && method === 'POST') {
        return [{ id: '33333333-3333-4333-8333-333333333333', name: 'Agent' }];
      }

      if (table === 'ai_agents' && method === 'PATCH') {
        return [{ id: '33333333-3333-4333-8333-333333333333', status: 'terminated' }];
      }

      if (table === 'incidents' && method === 'PATCH') {
        return [{ id: '44444444-4444-4444-8444-444444444444', status: 'resolved' }];
      }

      if (table === 'incidents' && method === 'POST') {
        return [{ id: '44444444-4444-4444-8444-444444444444' }];
      }

      if (table === 'audit_logs' && method === 'POST') {
        return [{ id: '55555555-5555-4555-8555-555555555555' }];
      }

      if (table === 'ai_agents' && method === 'GET') {
        return [];
      }

      return [];
    });
  });

  describe('Authentication', () => {
    it('should reject requests without auth token', async () => {
      const response = await request(server).post('/api/agents').send({});
      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid auth token', async () => {
      const response = await request(server)
        .post('/api/agents')
        .set('Authorization', 'Bearer invalid')
        .send({});

      expect(response.status).toBe(401);
    });
  });

  describe('Agents API', () => {
    it('should list agents for authenticated user', async () => {
      const response = await request(server)
        .get('/api/agents')
        .set('Authorization', 'Bearer viewer');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should create agent with valid data', async () => {
      const response = await request(server)
        .post('/api/agents')
        .set('Authorization', 'Bearer manager')
        .send({
          name: 'Agent Test',
          agent_type: 'support',
          platform: 'openai',
          model_name: 'gpt-4o',
          description: 'test',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should reject agent creation without required permissions', async () => {
      const response = await request(server)
        .post('/api/agents')
        .set('Authorization', 'Bearer viewer')
        .send({
          name: 'Agent Test',
          agent_type: 'support',
          platform: 'openai',
          model_name: 'gpt-4o',
        });

      expect(response.status).toBe(403);
    });

    it('should activate kill switch with admin role', async () => {
      const response = await request(server)
        .post('/api/agents/33333333-3333-4333-8333-333333333333/kill')
        .set('Authorization', 'Bearer admin')
        .send({ level: 2, reason: 'security test' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject kill switch without admin role', async () => {
      const response = await request(server)
        .post('/api/agents/33333333-3333-4333-8333-333333333333/kill')
        .set('Authorization', 'Bearer manager')
        .send({ level: 1, reason: 'security test' });

      expect(response.status).toBe(403);
    });

    it('should persist publish state for an agent', async () => {
      mockedSupabaseRest.mockResolvedValueOnce([
        {
          id: '33333333-3333-4333-8333-333333333333',
          organization_id: TEST_ORG_ID,
          metadata: {},
          config: {},
        },
      ]);
      mockedSupabaseRest.mockResolvedValueOnce([
        {
          id: '33333333-3333-4333-8333-333333333333',
          organization_id: TEST_ORG_ID,
          metadata: {
            publish: {
              publish_status: 'live',
              primary_pack: 'support',
              integration_ids: ['zendesk'],
            },
          },
          config: {},
        },
      ]);
      mockedSupabaseRest.mockResolvedValueOnce([
        {
          id: 'integration-row-1',
          service_type: 'zendesk',
          service_name: 'Zendesk',
          category: 'SUPPORT',
          status: 'connected',
          last_sync_at: '2026-03-13T10:00:00.000Z',
        },
      ]);

      const response = await request(server)
        .put('/api/agents/33333333-3333-4333-8333-333333333333/publish')
        .set('Authorization', 'Bearer manager')
        .send({
          publish_status: 'live',
          primary_pack: 'support',
          integration_ids: ['zendesk'],
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.publishStatus).toBe('live');
      expect(response.body.data.integrationIds).toEqual(['zendesk']);
      expect(response.body.data.connectedTargets).toHaveLength(1);
    });

    it('should include publish metadata when listing agents', async () => {
      mockedSupabaseRest.mockResolvedValueOnce([
        {
          id: '33333333-3333-4333-8333-333333333333',
          organization_id: TEST_ORG_ID,
          name: 'Support Bot',
          config: {},
          metadata: {
            publish: {
              publish_status: 'live',
              primary_pack: 'support',
              integration_ids: ['zendesk'],
            },
          },
        },
      ]);
      mockedSupabaseRest.mockResolvedValueOnce([]);
      mockedSupabaseRest.mockResolvedValueOnce([
        {
          id: 'integration-row-1',
          service_type: 'zendesk',
          service_name: 'Zendesk',
          category: 'SUPPORT',
          status: 'connected',
          last_sync_at: '2026-03-13T10:00:00.000Z',
        },
      ]);

      const response = await request(server)
        .get('/api/agents')
        .set('Authorization', 'Bearer viewer');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data[0].publishStatus).toBe('live');
      expect(response.body.data[0].primaryPack).toBe('support');
      expect(response.body.data[0].integrationIds).toEqual(['zendesk']);
      expect(response.body.data[0].connectedTargets).toHaveLength(1);
    });
  });

  describe('Incidents API', () => {
    it('should list incidents for organization', async () => {
      const response = await request(server)
        .get('/api/incidents')
        .set('Authorization', 'Bearer viewer');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should resolve incident with permission', async () => {
      const response = await request(server)
        .put('/api/incidents/44444444-4444-4444-8444-444444444444/resolve')
        .set('Authorization', 'Bearer manager')
        .send({ resolution_notes: 'resolved for test' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject resolve without permission', async () => {
      const response = await request(server)
        .put('/api/incidents/44444444-4444-4444-8444-444444444444/resolve')
        .set('Authorization', 'Bearer viewer')
        .send({ resolution_notes: 'resolved for test' });

      expect(response.status).toBe(403);
    });
  });
});
