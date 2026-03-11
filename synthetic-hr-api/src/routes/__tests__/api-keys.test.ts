import express, { Request, Response } from 'express';
import request from 'supertest';
import { supabaseRestAsUser } from '../../lib/supabase-rest';

// Mock Supabase
jest.mock('../../lib/supabase-rest');
jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));
jest.mock('../../lib/audit-logger', () => ({
  auditLog: {
    log: jest.fn(),
  },
}));

import apiKeysRouter from '../api-keys';

describe('API Keys Routes', () => {
  let app: express.Application;
  let mock: jest.MockedFunction<typeof supabaseRestAsUser>;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    app.use((req: any, res: Response, next) => {
      req.user = {
        id: '11111111-1111-4111-8111-111111111111',
        organization_id: '22222222-2222-4222-8222-222222222222',
        role: 'admin',
      };
      req.userJwt = 'mock-jwt';
      next();
    });

    app.use(apiKeysRouter);

    mock = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;
    mock.mockResolvedValue([]);
  });

  afterEach(() => {
    mock.mockReset();
  });

  describe('POST /api-keys - Create API Key', () => {
    it('should create a new API key and return it once', async () => {
      const mockKeyData = {
        id: '55555555-5555-4555-8555-555555555555',
        organization_id: '22222222-2222-4222-8222-222222222222',
        name: 'Integration Key',
        last_four: 'ab12',
        rate_limit_per_minute: 1000,
        status: 'active',
        created_at: new Date().toISOString(),
        metadata: { permissions: ['read'], preset: 'custom', manager_ids: [] },
      };
      // Route call order:
      // 1. getDefaultManagerIds -> listOrganizationUsers
      // 2. POST api_keys
      // 3. listOrganizationUsers (enrich)
      // 4. getApiKeyUsageState (enrich)
      mock.mockResolvedValueOnce([]);            // getDefaultManagerIds users
      mock.mockResolvedValueOnce([mockKeyData]); // POST create
      mock.mockResolvedValueOnce([]);            // enrich: users
      mock.mockResolvedValueOnce([]);            // enrich: usage

      const res = await request(app)
        .post('/api-keys')
        .send({ name: 'Integration Key', permissions: ['read'], rateLimit: 1000 })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id', mockKeyData.id);
      expect(res.body.data).toHaveProperty('key');
      expect(res.body.warning).toContain('Copy this token now');
    });

    it('should validate required fields', async () => {
      const res = await request(app)
        .post('/api-keys')
        .send({ permissions: ['read'] })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeDefined();
    });

    it('should enforce rate limit constraints', async () => {
      const res = await request(app)
        .post('/api-keys')
        .send({ name: 'Test Key', rateLimit: 999999999 })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api-keys - List API Keys', () => {
    it('should list all API keys for organization (without hashes)', async () => {
      const mockKeys = [
        {
          id: '55555555-5555-4555-8555-555555555555',
          organization_id: '22222222-2222-4222-8222-222222222222',
          name: 'Production Key',
          last_four: 'ab12',
          key_hash: 'should_not_be_returned',
          status: 'active',
          created_at: new Date().toISOString(),
          metadata: { permissions: [], preset: 'custom', manager_ids: [] },
        },
      ];
      // Route: list keys, enrich users, enrich usage
      mock.mockResolvedValueOnce(mockKeys);
      mock.mockResolvedValueOnce([]);
      mock.mockResolvedValueOnce([]);

      const res = await request(app).get('/api-keys').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].key_hash).toBeUndefined();
      expect(res.body.data[0].key_prefix).toBeDefined();
    });

    it('should return count of keys', async () => {
      const mockKeys = [
        { id: '1', name: 'Key 1', last_four: '0001', status: 'active', metadata: {} },
        { id: '2', name: 'Key 2', last_four: '0002', status: 'revoked', metadata: {} },
      ];
      mock.mockResolvedValueOnce(mockKeys);
      mock.mockResolvedValueOnce([]);
      mock.mockResolvedValueOnce([]);

      const res = await request(app).get('/api-keys').expect(200);

      expect(res.body.count).toBe(2);
    });
  });

  describe('GET /api-keys/:id - Get Specific Key', () => {
    it('should retrieve a specific API key', async () => {
      const mockKey = {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Specific Key',
        last_four: 'xyz1',
        status: 'active',
        metadata: { permissions: [], preset: 'custom', manager_ids: [] },
      };
      // Route: GET key, enrich users, enrich usage
      mock.mockResolvedValueOnce([mockKey]);
      mock.mockResolvedValueOnce([]);
      mock.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api-keys/55555555-5555-4555-8555-555555555555')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Specific Key');
    });

    it('should return 404 if key not found', async () => {
      mock.mockResolvedValueOnce([]);

      const res = await request(app).get('/api-keys/nonexistent-id').expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('PATCH /api-keys/:id - Update API Key', () => {
    it('should update rate limit', async () => {
      const mockKey = {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Updated Key',
        last_four: 'ab12',
        rate_limit_per_minute: 5000,
        status: 'active',
        metadata: { permissions: [], preset: 'custom', manager_ids: [], environment: 'production' },
      };
      // Route: GET current, PATCH result, enrich users, enrich usage
      mock.mockResolvedValueOnce([mockKey]);
      mock.mockResolvedValueOnce([{ ...mockKey, rate_limit_per_minute: 5000 }]);
      mock.mockResolvedValueOnce([]);
      mock.mockResolvedValueOnce([]);

      const res = await request(app)
        .patch('/api-keys/55555555-5555-4555-8555-555555555555')
        .send({ rateLimit: 5000 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.rate_limit).toBe(5000);
    });

    it('should update status', async () => {
      const mockKey = {
        id: '55555555-5555-4555-8555-555555555555',
        last_four: 'ab12',
        status: 'revoked',
        metadata: { permissions: [], preset: 'custom', manager_ids: [], environment: 'production' },
      };
      // Route: GET current, PATCH result, enrich users, enrich usage
      mock.mockResolvedValueOnce([mockKey]);
      mock.mockResolvedValueOnce([mockKey]);
      mock.mockResolvedValueOnce([]);
      mock.mockResolvedValueOnce([]);

      const res = await request(app)
        .patch('/api-keys/55555555-5555-4555-8555-555555555555')
        .send({ status: 'revoked' })
        .expect(200);

      expect(res.body.data.status).toBe('revoked');
    });
  });

  describe('DELETE /api-keys/:id - Revoke API Key', () => {
    it('should revoke an API key', async () => {
      const mockKey = { id: '55555555-5555-4555-8555-555555555555', status: 'revoked' };
      // Route: PATCH to mark as revoked (writeApiKeyRecord)
      mock.mockResolvedValueOnce([mockKey]);

      const res = await request(app)
        .delete('/api-keys/55555555-5555-4555-8555-555555555555')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('revoked');
    });

    it('should return 404 if key not found', async () => {
      // writeApiKeyRecord returns [] -> null -> 404
      mock.mockResolvedValueOnce([]);

      const res = await request(app).delete('/api-keys/nonexistent-id').expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api-keys/:id/refresh - Rotate API Key', () => {
    it('should generate a new API key and return it', async () => {
      const mockKey = {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Rotated Key',
        last_four: 'rot1',
        status: 'active',
        metadata: { permissions: [], preset: 'custom', manager_ids: [] },
      };
      // Route: GET current, PATCH new hash, enrich users, enrich usage
      mock.mockResolvedValueOnce([mockKey]);
      mock.mockResolvedValueOnce([mockKey]);
      mock.mockResolvedValueOnce([]);
      mock.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api-keys/55555555-5555-4555-8555-555555555555/refresh')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('key');
      expect(res.body.warning).toContain('The previous token is no longer valid');
    });
  });
});
