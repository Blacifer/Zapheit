import http from 'http';
import express, { Request, Response } from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { supabaseRestAsService, supabaseRestAsUser } from '../../lib/supabase-rest';

// Mock dependencies
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
jest.mock('../../lib/email', () => ({
  sendTransactionalEmail: jest.fn().mockResolvedValue(true),
}));

import invitesRouter from '../invites';

describe('Team Invites Routes', () => {
  let app: express.Application;
  let server: http.Server;
  let mockSupabaseUser: jest.MockedFunction<typeof supabaseRestAsUser>;
  let mockSupabaseService: jest.MockedFunction<typeof supabaseRestAsService>;

  beforeEach(async () => {
    // Set required environment variables
    process.env.FRONTEND_URL = 'http://localhost:5173';

    app = express();
    app.use(express.json());

    // Mock authenticated user middleware ONLY for protected routes
    // Skip auth for /invites/accept and /invites/:id/reject (public endpoints)
    app.use((req: any, res: Response, next) => {
      if (req.path === '/invites/accept' || req.path.includes('/reject')) {
        return next();
      }
      req.user = {
        id: '11111111-1111-4111-8111-111111111111',
        organization_id: '22222222-2222-4222-8222-222222222222',
        role: 'admin',
      };
      req.userJwt = 'mock-jwt';
      next();
    });

    app.use(invitesRouter);

    mockSupabaseUser = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;
    mockSupabaseService = supabaseRestAsService as jest.MockedFunction<typeof supabaseRestAsService>;
    mockSupabaseUser.mockResolvedValue([]);
    mockSupabaseService.mockResolvedValue([]);

    await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
  });

  afterEach(async () => {
    mockSupabaseUser.mockReset();
    mockSupabaseService.mockReset();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('POST /invites - Create Invitation', () => {
    it('should create a new team invitation', async () => {
      const mockInvite = {
        id: '55555555-5555-4555-8555-555555555555',
        organization_id: '22222222-2222-4222-8222-222222222222',
        email: 'newuser@example.com',
        role: 'manager',
        status: 'pending',
        token: 'abc123',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      };

      // Mock checks
      mockSupabaseUser.mockResolvedValueOnce([]); // No existing user
      mockSupabaseUser.mockResolvedValueOnce([]); // No existing invite
      mockSupabaseUser.mockResolvedValueOnce([mockInvite]); // Create invite

      const res = await request(server)
        .post('/invites')
        .send({
          email: 'newuser@example.com',
          role: 'manager',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('newuser@example.com');
      expect(res.body.data.token).toBeUndefined(); // Token should not be exposed
      expect(res.body.message).toContain('Invitation sent');
    });

    it('should validate email format', async () => {
      const res = await request(server)
        .post('/invites')
        .send({
          email: 'invalid-email',
          role: 'manager',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeDefined();
    });

    it('should reject if user already exists in organization', async () => {
      const existingUser = {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'existing@example.com',
        organization_id: '22222222-2222-4222-8222-222222222222',
      };

      mockSupabaseUser.mockResolvedValueOnce([existingUser]); // User exists

      const res = await request(server)
        .post('/invites')
        .send({
          email: 'existing@example.com',
          role: 'manager',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('already exists');
    });

    it('should reject if pending invite already exists', async () => {
      const existingInvite = {
        id: '44444444-4444-4444-8444-444444444444',
        email: 'pending@example.com',
        status: 'pending',
      };

      mockSupabaseUser.mockResolvedValueOnce([]); // No user
      mockSupabaseUser.mockResolvedValueOnce([existingInvite]); // Invite exists

      const res = await request(server)
        .post('/invites')
        .send({
          email: 'pending@example.com',
          role: 'manager',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('already sent');
    });
  });

  describe('GET /invites - List Invitations', () => {
    it('should list all invitations for organization', async () => {
      const mockInvites = [
        {
          id: '55555555-5555-4555-8555-555555555555',
          email: 'user1@example.com',
          role: 'manager',
          status: 'pending',
          token: 'secret1',
          created_at: new Date().toISOString(),
        },
        {
          id: '66666666-6666-4666-8666-666666666666',
          email: 'user2@example.com',
          role: 'viewer',
          status: 'accepted',
          token: 'secret2',
          created_at: new Date().toISOString(),
        },
      ];

      mockSupabaseUser.mockResolvedValueOnce(mockInvites);

      const res = await request(server)
        .get('/invites')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.count).toBe(2);
      expect(res.body.data[0].token).toBeUndefined(); // Tokens should be removed
    });

    it('should filter by status', async () => {
      const mockPendingInvites = [
        {
          id: '55555555-5555-4555-8555-555555555555',
          email: 'pending@example.com',
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      ];

      mockSupabaseUser.mockResolvedValueOnce(mockPendingInvites);

      const res = await request(server)
        .get('/invites?status=pending')
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('pending');
    });
  });

  describe('GET /invites/:id - Get Specific Invite', () => {
    it('should retrieve a specific invitation', async () => {
      const mockInvite = {
        id: '55555555-5555-4555-8555-555555555555',
        email: 'specific@example.com',
        role: 'manager',
        status: 'pending',
        token: 'secret',
      };

      mockSupabaseUser.mockResolvedValueOnce([mockInvite]);

      const res = await request(server)
        .get('/invites/55555555-5555-4555-8555-555555555555')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('specific@example.com');
      expect(res.body.data.token).toBeUndefined(); // Token should not be exposed
    });

    it('should return 404 if invite not found', async () => {
      mockSupabaseUser.mockResolvedValueOnce([]);

      const res = await request(server)
        .get('/invites/nonexistent-id')
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /invites/accept - Accept Invitation', () => {
    it('should accept a valid invitation', async () => {
      const mockInvite = {
        id: '55555555-5555-4555-8555-555555555555',
        organization_id: '22222222-2222-4222-8222-222222222222',
        email: 'newuser@example.com',
        role: 'manager',
        status: 'pending',
        token: 'abcdef1234567890abcdef1234567890abcdef1234567890',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };

      mockSupabaseService.mockResolvedValueOnce([mockInvite]); // Find invite

      const res = await request(server)
        .post('/invites/accept')
        .send({ token: 'abcdef1234567890abcdef1234567890abcdef1234567890' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('verified');
      expect(res.body.data.organization_id).toBe('22222222-2222-4222-8222-222222222222');
    });

    it('should reject expired invitation', async () => {
      const expiredInvite = {
        id: '55555555-5555-4555-8555-555555555555',
        email: 'expired@example.com',
        token: 'expired1234567890expired1234567890',
        status: 'pending',
        expires_at: new Date(Date.now() - 1000).toISOString(), // Expired
      };

      mockSupabaseService.mockResolvedValueOnce([expiredInvite]); // Find invite
      mockSupabaseService.mockResolvedValueOnce([{}]); // Mark as expired

      const res = await request(server)
        .post('/invites/accept')
        .send({ token: 'expired1234567890expired1234567890' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('expired');
    });

    it('should return 404 for invalid token', async () => {
      mockSupabaseService.mockResolvedValueOnce([]); // No invite found

      const res = await request(server)
        .post('/invites/accept')
        .send({ token: 'invalid1234567890invalid1234567890' })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid or expired');
    });
  });

  describe('POST /invites/:id/reject - Reject Invitation', () => {
    it('should reject an invitation', async () => {
      const mockInvite = {
        id: '55555555-5555-4555-8555-555555555555',
        email: 'reject@example.com',
        token: 'reject-token-1234567890abcdefghijklmn',
        status: 'pending',
      };

      mockSupabaseService.mockResolvedValueOnce([mockInvite]); // Find invite
      mockSupabaseService.mockResolvedValueOnce([{}]); // Mark as rejected

      const res = await request(server)
        .post('/invites/55555555-5555-4555-8555-555555555555/reject')
        .send({ token: 'reject-token-1234567890abcdefghijklmn' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('rejected');
    });

    it('should return 404 for invalid token', async () => {
      mockSupabaseService.mockResolvedValueOnce([]);

      const res = await request(server)
        .post('/invites/55555555-5555-4555-8555-555555555555/reject')
        .send({ token: 'wrong-token-1234567890abcdefghijklmn' })
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe('DELETE /invites/:id - Cancel Invitation', () => {
    it('should cancel an invitation', async () => {
      const mockInvite = {
        id: '55555555-5555-4555-8555-555555555555',
        email: 'cancel@example.com',
        status: 'cancelled',
      };

      mockSupabaseUser.mockResolvedValueOnce([mockInvite]);

      const res = await request(server)
        .delete('/invites/55555555-5555-4555-8555-555555555555')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('cancelled');
    });

    it('should return 404 if invite not found', async () => {
      mockSupabaseUser.mockResolvedValueOnce([]);

      const res = await request(server)
        .delete('/invites/nonexistent-id')
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });
});
