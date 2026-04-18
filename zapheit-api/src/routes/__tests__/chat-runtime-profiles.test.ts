import { supabaseRestAsUser } from '../../lib/supabase-rest';
import { auditLog } from '../../lib/audit-logger';

jest.mock('../../lib/supabase-rest', () => ({
  supabaseRestAsUser: jest.fn(),
  eq: (value: string | number) => `eq.${encodeURIComponent(String(value))}`,
}));

jest.mock('../../middleware/rbac', () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../lib/audit-logger', () => ({
  auditLog: {
    log: jest.fn(),
  },
}));

jest.mock('../../lib/integrations/encryption', () => ({
  encryptSecret: jest.fn((value: string) => `enc:${value}`),
  decryptSecret: jest.fn((value: string) => value.replace(/^enc:/, '')),
}));

import chatRouter from '../chat';

describe('Chat Routes - runtime profiles', () => {
  let mockUserRest: jest.MockedFunction<typeof supabaseRestAsUser>;

  beforeEach(() => {
    mockUserRest = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;
    mockUserRest.mockReset();
    (auditLog.log as jest.Mock).mockReset();
  });

  async function invokeRoute(method: 'GET' | 'POST' | 'DELETE', url: string, body?: Record<string, unknown>) {
    const req: any = {
      method,
      url,
      path: url,
      originalUrl: url,
      headers: {},
      query: {},
      body: body || {},
      params: {},
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        organization_id: '22222222-2222-4222-8222-222222222222',
        email: 'operator@zapheit.com',
        role: 'admin',
      },
      userJwt: 'mock-jwt',
    };

    let done = false;
    let payload: any = null;

    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(responseBody: any) {
        payload = responseBody;
        done = true;
        return this;
      },
      setHeader() {
        return undefined;
      },
    };

    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (done) return resolve();
        setTimeout(tick, 0);
      };
      (chatRouter as any).handle(req, res, (err: any) => (err ? reject(err) : resolve()));
      tick();
    });

    return { statusCode: res.statusCode, body: payload };
  }

  it('lists encrypted runtime profiles without exposing raw keys', async () => {
    mockUserRest.mockResolvedValue([
      {
        id: 'profile-1',
        organization_id: '22222222-2222-4222-8222-222222222222',
        kind: 'provider',
        provider: 'openai',
        label: 'Ops OpenAI',
        api_key_encrypted: 'enc:sk-provider-1234',
        status: 'active',
        created_at: '2026-04-16T12:00:00.000Z',
        updated_at: '2026-04-16T12:00:00.000Z',
      },
    ] as any);

    const res = await invokeRoute('GET', '/chat/runtime-profiles');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        id: 'profile-1',
        provider: 'openai',
        label: 'Ops OpenAI',
        masked_key: '••••1234',
      }),
    ]);
  });

  it('creates a backend-managed runtime profile', async () => {
    mockUserRest.mockImplementation(async (_jwt: string, table: string, _query?: any, options?: any) => {
      if (table === 'chat_runtime_profiles' && options?.method === 'POST') {
        return [{
          id: 'profile-2',
          organization_id: '22222222-2222-4222-8222-222222222222',
          kind: options.body.kind,
          provider: options.body.provider,
          label: options.body.label,
          api_key_encrypted: options.body.api_key_encrypted,
          status: 'active',
          created_at: '2026-04-16T12:10:00.000Z',
          updated_at: '2026-04-16T12:10:00.000Z',
        }] as any;
      }
      return [];
    });

    const res = await invokeRoute('POST', '/chat/runtime-profiles', {
      kind: 'provider',
      provider: 'anthropic',
      label: 'Analyst Claude',
      api_key: 'sk-ant-1234',
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(expect.objectContaining({
      id: 'profile-2',
      provider: 'anthropic',
      label: 'Analyst Claude',
      masked_key: '••••1234',
    }));
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'chat_runtime_profile.created',
      resource_id: 'profile-2',
    }));
  });

  it('deletes a runtime profile by id', async () => {
    mockUserRest.mockImplementation(async (_jwt: string, table: string, _query?: any, options?: any) => {
      if (table === 'chat_runtime_profiles' && !options) {
        return [{
          id: 'profile-3',
          organization_id: '22222222-2222-4222-8222-222222222222',
          kind: 'gateway',
          provider: 'zapheit_gateway',
          label: 'Gateway key',
          api_key_encrypted: 'enc:gw-1234',
          status: 'active',
        }] as any;
      }
      if (table === 'chat_runtime_profiles' && options?.method === 'DELETE') {
        return [] as any;
      }
      return [];
    });

    const res = await invokeRoute('DELETE', '/chat/runtime-profiles/profile-3');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('profile-3');
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'chat_runtime_profile.deleted',
      resource_id: 'profile-3',
    }));
  });
});
