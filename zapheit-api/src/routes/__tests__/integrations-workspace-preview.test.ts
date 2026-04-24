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
    if (normalized === 'zendesk') {
      return {
        id: 'zendesk',
        name: 'Zendesk',
        authType: 'api_key',
        category: 'SUPPORT',
      };
    }
    if (normalized === 'intercom') {
      return {
        id: 'intercom',
        name: 'Intercom',
        authType: 'oauth2',
        category: 'SUPPORT',
      };
    }
    if (normalized === 'stripe') {
      return {
        id: 'stripe',
        name: 'Stripe',
        authType: 'api_key',
        category: 'FINANCE',
      };
    }
    if (normalized === 'cashfree') {
      return {
        id: 'cashfree',
        name: 'Cashfree',
        authType: 'api_key',
        category: 'FINANCE',
      };
    }
    if (normalized === 'salesforce') {
      return {
        id: 'salesforce',
        name: 'Salesforce',
        authType: 'oauth2',
        category: 'CRM',
      };
    }
    if (normalized === 'hubspot') {
      return {
        id: 'hubspot',
        name: 'HubSpot',
        authType: 'oauth2',
        category: 'CRM',
      };
    }
    if (normalized === 'cleartax') {
      return {
        id: 'cleartax',
        name: 'ClearTax',
        authType: 'api_key',
        category: 'COMPLIANCE',
      };
    }
    if (normalized === 'brevo') {
      return {
        id: 'brevo',
        name: 'Brevo',
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
    if (normalized === 'kandji') {
      return {
        id: 'kandji',
        name: 'Kandji',
        authType: 'api_key',
        category: 'ITSM',
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

  it('returns Zendesk workspace preview using API token credentials', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-zd',
          service_type: 'zendesk',
          status: 'connected',
          service_name: 'Zendesk',
        }];
      }
      if (table === 'integration_credentials') {
        return [
          { key: 'subdomain', value: 'acme', is_sensitive: false, expires_at: null },
          { key: 'email', value: 'admin@acme.com', is_sensitive: false, expires_at: null },
          { key: 'api_token', value: 'zd-token', is_sensitive: true, expires_at: null },
        ];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-zd' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/users/me.json')) {
        return {
          ok: true,
          json: async () => ({ user: { email: 'admin@acme.com', name: 'Acme Admin', role: 'admin' } }),
        } as Response;
      }
      if (url.includes('/tickets/recent.json')) {
        return {
          ok: true,
          json: async () => ({
            tickets: [
              { id: 11, subject: 'Refund request', status: 'open', priority: 'high', updated_at: '2026-04-03T10:00:00.000Z', requester_id: 99 },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/zendesk/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.email).toBe('admin@acme.com');
    expect(res.body.data.conversations).toHaveLength(1);
    expect(res.body.data.metrics.open_count).toBe(1);
  });

  it('returns Intercom workspace preview using OAuth credentials', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-ic',
          service_type: 'intercom',
          status: 'connected',
          service_name: 'Intercom',
        }];
      }
      if (table === 'integration_credentials') {
        return [
          { key: 'access_token', value: 'ic-token', is_sensitive: true, expires_at: null },
        ];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-ic' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/admins')) {
        return {
          ok: true,
          json: async () => ({
            admins: [
              { id: 'a-1', email: 'owner@intercom.io', name: 'Intercom Owner' },
            ],
          }),
        } as Response;
      }
      if (url.includes('/conversations?per_page=8')) {
        return {
          ok: true,
          json: async () => ({
            conversations: [
              { id: 'c-1', title: 'Upgrade request', state: 'open', updated_at: 1712121600 },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/intercom/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.email).toBe('owner@intercom.io');
    expect(res.body.data.conversations).toHaveLength(1);
  });

  it('returns Stripe workspace preview using API key credentials', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-stripe',
          service_type: 'stripe',
          status: 'connected',
          service_name: 'Stripe',
        }];
      }
      if (table === 'integration_credentials') {
        return [
          { key: 'secret_key', value: 'sk_test_123', is_sensitive: true, expires_at: null },
        ];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-stripe' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/v1/account')) {
        return {
          ok: true,
          json: async () => ({ email: 'finance@acme.com', business_profile: { name: 'Acme Finance' } }),
        } as Response;
      }
      if (url.includes('/v1/payouts?limit=5')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'po_1', amount: 120000, currency: 'usd', status: 'paid', arrival_date: 1712121600 },
            ],
          }),
        } as Response;
      }
      if (url.includes('/v1/charges?limit=5')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'ch_1', amount: 5000, currency: 'usd', status: 'succeeded', created: 1712121600, billing_details: { email: 'buyer@example.com' } },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/stripe/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.email).toBe('finance@acme.com');
    expect(res.body.data.records).toHaveLength(1);
    expect(res.body.data.metrics.payouts_loaded).toBe(1);
    expect(res.body.data.metrics.pending_payouts).toBe(0);
  });

  it('returns Cashfree workspace preview using API key credentials', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-rzp',
          service_type: 'cashfree',
          status: 'connected',
          service_name: 'Cashfree',
        }];
      }
      if (table === 'integration_credentials') {
        return [
          { key: 'key_id', value: 'rzp_id', is_sensitive: true, expires_at: null },
          { key: 'key_secret', value: 'rzp_secret', is_sensitive: true, expires_at: null },
        ];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-rzp' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/v1/payments?count=8')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: 'pay_1', description: 'Invoice payment', amount: 230000, currency: 'INR', status: 'captured', created_at: 1712121600 },
            ],
          }),
        } as Response;
      }
      if (url.includes('/v1/settlements?count=5')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: 'set_1', amount: 230000, status: 'processed', created_at: 1712121600 },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/cashfree/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.records).toHaveLength(1);
    expect(res.body.data.settlements).toHaveLength(1);
    expect(res.body.data.metrics.captured_count).toBe(1);
  });

  it('returns ClearTax workspace preview using API key credentials', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-cleartax',
          service_type: 'cleartax',
          status: 'connected',
          service_name: 'ClearTax',
        }];
      }
      if (table === 'integration_credentials') {
        return [
          { key: 'api_key', value: 'ct-token', is_sensitive: true, expires_at: null },
          { key: 'gstin', value: '22AAAAA0000A1Z5', is_sensitive: false, expires_at: null },
        ];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-cleartax' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/compliance/status?gstin=')) {
        return {
          ok: true,
          json: async () => ({ status: 'green', filing_state: 'on_track', last_filed_period: '2026-03' }),
        } as Response;
      }
      if (url.includes('/notices?limit=8')) {
        return {
          ok: true,
          json: async () => ({
            notices: [
              { id: 'n-1', title: 'GST reminder', severity: 'medium', issued_at: '2026-04-01T00:00:00.000Z' },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/cleartax/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.records).toHaveLength(1);
    expect(res.body.data.profile.gstin).toBe('22AAAAA0000A1Z5');
    expect(res.body.data.metrics.notices_loaded).toBe(1);
    expect(res.body.data.metrics.open_notices).toBe(1);
    expect(res.body.data.notes).toBeDefined();
  });

  it('returns Salesforce workspace preview using OAuth credentials', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-sf',
          service_type: 'salesforce',
          status: 'connected',
          service_name: 'Salesforce',
        }];
      }
      if (table === 'integration_credentials') {
        return [
          { key: 'access_token', value: 'sf-token', is_sensitive: true, expires_at: null },
          { key: 'instance_url', value: 'https://acme.my.salesforce.com', is_sensitive: false, expires_at: null },
        ];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-sf' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/services/oauth2/userinfo')) {
        return {
          ok: true,
          json: async () => ({ email: 'owner@acme.com', name: 'Pipeline Owner', organization_id: 'org-1' }),
        } as Response;
      }
      if (url.includes('FROM%20Lead')) {
        return {
          ok: true,
          json: async () => ({
            records: [
              { Id: 'lead-1', Name: 'Ada Lovelace', Company: 'Analytical Engines', Status: 'Open', CreatedDate: '2026-04-03T10:00:00.000Z' },
            ],
          }),
        } as Response;
      }
      if (url.includes('FROM%20Opportunity')) {
        return {
          ok: true,
          json: async () => ({
            records: [
              { Id: 'opp-1', Name: 'Enterprise Deal', StageName: 'Proposal', Amount: 25000, LastModifiedDate: '2026-04-03T11:00:00.000Z' },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/salesforce/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.email).toBe('owner@acme.com');
    expect(res.body.data.records).toHaveLength(1);
    expect(res.body.data.deals).toHaveLength(1);
    expect(res.body.data.metrics.opportunity_count).toBe(1);
  });

  it('returns HubSpot workspace preview using OAuth credentials', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-hs',
          service_type: 'hubspot',
          status: 'connected',
          service_name: 'HubSpot',
        }];
      }
      if (table === 'integration_credentials') {
        return [
          { key: 'access_token', value: 'hs-token', is_sensitive: true, expires_at: null },
        ];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-hs' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/crm/v3/objects/contacts')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              { id: 'c-1', properties: { firstname: 'Grace', lastname: 'Hopper', email: 'grace@example.com', lastmodifieddate: '2026-04-03T09:00:00.000Z' } },
            ],
          }),
        } as Response;
      }
      if (url.includes('/crm/v3/objects/deals')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              { id: 'd-1', properties: { dealname: 'Expansion', dealstage: 'qualifiedtobuy', amount: '18000', hs_lastmodifieddate: '2026-04-03T12:00:00.000Z' } },
            ],
          }),
        } as Response;
      }
      if (url.includes('/v3/owners')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              { email: 'owner@hubspot.com', firstName: 'Hub', lastName: 'Spot' },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/hubspot/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.email).toBe('owner@hubspot.com');
    expect(res.body.data.records).toHaveLength(1);
    expect(res.body.data.deals).toHaveLength(1);
    expect(res.body.data.metrics.deal_count).toBe(1);
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

  it('returns Brevo workspace preview using API key credentials', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-5',
          service_type: 'brevo',
          status: 'connected',
          service_name: 'Brevo',
        }];
      }
      if (table === 'integration_credentials') {
        return [
          { key: 'api_key', value: 'brevo-key', is_sensitive: true, expires_at: null },
        ];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-5' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/v3/emailCampaigns?limit=5')) {
        return {
          ok: true,
          json: async () => ({
            count: 1,
            campaigns: [
              {
                id: 91,
                name: 'April Retention',
                status: 'sent',
                modifiedAt: '2026-04-03T10:00:00.000Z',
                type: 'classic',
              },
            ],
          }),
        } as Response;
      }
      if (url.includes('/v3/contacts?limit=5')) {
        return {
          ok: true,
          json: async () => ({
            count: 1,
            contacts: [
              {
                id: 17,
                email: 'user@example.com',
                listIds: [1, 2],
              },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/brevo/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.records).toHaveLength(1);
    expect(res.body.data.audiences).toHaveLength(1);
    expect(res.body.data.metrics.campaign_count).toBe(1);
    expect(res.body.data.metrics.contact_count).toBe(1);
    expect(res.body.data.suggested_next_action).toContain('Review live campaigns');
  });

  it('returns Kandji workspace preview using API key credentials', async () => {
    mockUserRest.mockImplementation(async (_jwt, table, _query, options) => {
      if (table === 'integrations') {
        return [{
          id: 'integration-6',
          service_type: 'kandji',
          status: 'connected',
          service_name: 'Kandji',
        }];
      }
      if (table === 'integration_credentials') {
        return [
          { key: 'base_url', value: 'https://tenant.api.kandji.io', is_sensitive: false, expires_at: null },
          { key: 'api_key', value: 'kandji-token', is_sensitive: true, expires_at: null },
        ];
      }
      if (table === 'integration_connection_logs' && options?.method === 'POST') {
        return [{ id: 'log-6' }];
      }
      return [];
    });

    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.endsWith('/devices')) {
        return {
          ok: true,
          json: async () => ({
            devices: [
              {
                id: 'dev-1',
                device_name: 'MacBook Pro',
                status: 'managed',
                serial_number: 'SER123',
                last_check_in: '2026-04-03T10:00:00.000Z',
              },
            ],
          }),
        } as Response;
      }
      if (url.endsWith('/blueprints')) {
        return {
          ok: true,
          json: async () => ({
            blueprints: [
              { id: 'bp-1', name: 'Engineering Macs', install_application_count: 12 },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as any;

    const res = await invokeRoute('/kandji/workspace-preview');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.records).toHaveLength(1);
    expect(res.body.data.groups).toHaveLength(1);
    expect(res.body.data.metrics.device_count).toBe(1);
    expect(res.body.data.metrics.group_count).toBe(1);
    expect(res.body.data.suggested_next_action).toContain('Review managed devices and blueprint coverage');
  });
});
