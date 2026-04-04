import { supabaseRestAsUser, supabaseRestAsService } from '../../lib/supabase-rest';

jest.mock('../../lib/supabase-rest', () => ({
  supabaseRestAsUser: jest.fn(),
  supabaseRestAsService: jest.fn(),
  eq: (value: string | number) => `eq.${encodeURIComponent(String(value))}`,
  in_: (values: Array<string | number>) => `in.(${values.map((v) => encodeURIComponent(String(v))).join(',')})`,
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

jest.mock('../../lib/integrations/encryption', () => ({
  encryptSecret: jest.fn(async (value: string) => value),
  decryptSecret: jest.fn((value: string) => value),
}));

jest.mock('../../lib/integrations/spec-registry', () => ({
  IMPLEMENTED_INTEGRATIONS: [],
  getIntegrationSpec: (service: string) => {
    const normalized = String(service || '').replace(/_/g, '-');
    if (normalized === 'google-workspace') {
      return {
        id: 'google_workspace',
        name: 'Google Workspace',
        authType: 'oauth2',
        category: 'HR',
      };
    }
    if (normalized === 'microsoft-365') {
      return {
        id: 'microsoft_365',
        name: 'Microsoft 365',
        authType: 'oauth2',
        category: 'HR',
      };
    }
    if (normalized === 'mailchimp') {
      return {
        id: 'mailchimp',
        name: 'Mailchimp',
        authType: 'api_key',
        category: 'PRODUCTIVITY',
      };
    }
    if (normalized === 'onelogin') {
      return {
        id: 'onelogin',
        name: 'OneLogin',
        authType: 'api_key',
        category: 'IAM',
      };
    }
    return null;
  },
}));

jest.mock('../../lib/integrations/adapters', () => ({
  getAdapter: jest.fn(() => ({ id: 'mock-adapter' })),
}));

import integrationsRouter from '../integrations';

describe('Integrations Routes - workspace preview', () => {
  let mockUserRest: jest.MockedFunction<typeof supabaseRestAsUser>;
  let mockServiceRest: jest.MockedFunction<typeof supabaseRestAsService>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockUserRest = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;
    mockServiceRest = supabaseRestAsService as jest.MockedFunction<typeof supabaseRestAsService>;
    mockServiceRest.mockReset();
    mockUserRest.mockReset();
    mockServiceRest.mockResolvedValue([]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockUserRest.mockReset();
    mockServiceRest.mockReset();
  });

  async function invokeRoute(url: string) {
    const req: any = {
      method: 'GET',
      url,
      headers: {},
      query: {},
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'admin@example.com',
        organization_id: '22222222-2222-4222-8222-222222222222',
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
      json(body: any) {
        payload = body;
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
      (integrationsRouter as any).handle(req, res, (err: any) => (err ? reject(err) : resolve()));
      tick();
    });

    return { statusCode: res.statusCode, body: payload };
  }

  it('returns a Google collaboration workspace preview and resolves alias service ids', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-1',
          service_type: 'google_workspace',
          status: 'connected',
          service_name: 'Google Workspace',
        }];
      }
      if (table === 'integration_credentials') {
        return [{
          key: 'access_token',
          value: 'google-token',
          is_sensitive: true,
          expires_at: null,
        }];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-1' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('oauth2/v2/userinfo')) {
        return {
          ok: true,
          json: async () => ({ email: 'admin@workspace.example', name: 'Workspace Admin', picture: 'https://example.com/p.png' }),
        } as Response;
      }
      if (url.includes('calendar/v3/calendars/primary/events')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: 'evt-1',
                summary: 'Weekly hiring sync',
                start: { dateTime: '2026-04-03T10:00:00.000Z' },
                end: { dateTime: '2026-04-03T10:30:00.000Z' },
                organizer: { email: 'admin@workspace.example' },
              },
            ],
          }),
        } as Response;
      }
      if (url.includes('admin.googleapis.com/admin/directory/v1/users')) {
        return {
          ok: true,
          json: async () => ({
            users: [
              { id: 'u-1', primaryEmail: 'agent1@example.com', name: { fullName: 'Agent One' }, suspended: false },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/google-workspace/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.email).toBe('admin@workspace.example');
    expect(res.body.data.events).toHaveLength(1);
    expect(res.body.data.users).toHaveLength(1);
    expect(res.body.data.suggested_next_action).toContain('Review upcoming calendar commitments');
  });

  it('returns Microsoft collaboration preview with graceful scope fallback notes', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-2',
          service_type: 'microsoft_365',
          status: 'connected',
          service_name: 'Microsoft 365',
        }];
      }
      if (table === 'integration_credentials') {
        return [{
          key: 'access_token',
          value: 'microsoft-token',
          is_sensitive: true,
          expires_at: null,
        }];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-2' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('graph.microsoft.com/v1.0/me/calendarview')) {
        return {
          ok: false,
          json: async () => ({ error: { message: 'Insufficient privileges to complete the operation.' } }),
        } as Response;
      }
      if (url.includes('graph.microsoft.com/v1.0/me')) {
        return {
          ok: true,
          json: async () => ({ displayName: 'MS Admin', userPrincipalName: 'admin@m365.example', jobTitle: 'IT Lead' }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/microsoft-365/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.email).toBe('admin@m365.example');
    expect(res.body.data.events).toHaveLength(0);
    expect(res.body.data.notes[0]).toContain('broader Microsoft Graph scopes');
    expect(res.body.data.suggested_next_action).toContain('Reconnect with broader Microsoft Graph scopes');
  });

  it('returns Mailchimp workspace preview without requiring an OAuth access token', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-3',
          service_type: 'mailchimp',
          status: 'connected',
          service_name: 'Mailchimp',
        }];
      }
      if (table === 'integration_credentials') {
        return [
          { key: 'api_key', value: 'testkey-us5', is_sensitive: true, expires_at: null },
        ];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-3' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/campaigns?count=5')) {
        return {
          ok: true,
          json: async () => ({
            total_items: 1,
            campaigns: [
              {
                id: 'cmp-1',
                status: 'sent',
                create_time: '2026-04-03T12:00:00.000Z',
                settings: { title: 'April Hiring Push', subject_line: 'Hiring update' },
                recipients: { list_name: 'Hiring Leads' },
              },
            ],
          }),
        } as Response;
      }
      if (url.includes('/lists?count=5')) {
        return {
          ok: true,
          json: async () => ({
            total_items: 1,
            lists: [
              { id: 'aud-1', name: 'Hiring Leads', stats: { member_count: 124 } },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/mailchimp/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.records).toHaveLength(1);
    expect(res.body.data.audiences).toHaveLength(1);
    expect(res.body.data.metrics.campaign_count).toBe(1);
    expect(res.body.data.suggested_next_action).toContain('Review campaign state');
  });

  it('returns OneLogin identity preview using API credentials', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-4',
          service_type: 'onelogin',
          status: 'connected',
          service_name: 'OneLogin',
        }];
      }
      if (table === 'integration_credentials') {
        return [
          { key: 'domain', value: 'example.onelogin.com', is_sensitive: false, expires_at: null },
          { key: 'client_id', value: 'client-123', is_sensitive: true, expires_at: null },
          { key: 'client_secret', value: 'secret-456', is_sensitive: true, expires_at: null },
        ];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-4' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes('/auth/oauth2/v2/token')) {
        expect(init?.method).toBe('POST');
        return {
          ok: true,
          json: async () => ({ data: [{ access_token: 'ol-token' }] }),
        } as Response;
      }
      if (url.includes('/api/1/users')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 1,
                firstname: 'Ada',
                lastname: 'Lovelace',
                email: 'ada@example.com',
                status: 'active',
                updated_at: '2026-04-03T09:00:00.000Z',
              },
            ],
          }),
        } as Response;
      }
      if (url.includes('/api/2/roles')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 7, name: 'Admins', users_count: 3 },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/onelogin/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.records).toHaveLength(1);
    expect(res.body.data.groups).toHaveLength(1);
    expect(res.body.data.metrics.user_count).toBe(1);
    expect(res.body.data.suggested_next_action).toContain('Review OneLogin users');
  });
});
