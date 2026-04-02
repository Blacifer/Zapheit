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

import integrationsRouter from '../integrations';

describe('Integrations Routes - Governed Actions reliability states', () => {
  let mockUserRest: jest.MockedFunction<typeof supabaseRestAsUser>;
  let mockServiceRest: jest.MockedFunction<typeof supabaseRestAsService>;

  beforeEach(async () => {
    mockUserRest = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;
    mockServiceRest = supabaseRestAsService as jest.MockedFunction<typeof supabaseRestAsService>;
    mockServiceRest.mockResolvedValue([]);
    mockUserRest.mockReset();
  });

  afterEach(async () => {
    mockUserRest.mockReset();
    mockServiceRest.mockReset();
  });

  async function invokeGovernedActionsRoute() {
    const req: any = {
      method: 'GET',
      url: '/governed-actions',
      headers: {},
      query: {},
      user: {
        id: '11111111-1111-4111-8111-111111111111',
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

  it('returns queued_for_retry, paused_by_circuit_breaker, recovered, and ok from backend state', async () => {
    const baseExecution = {
      organization_id: '22222222-2222-4222-8222-222222222222',
      agent_id: null,
      integration_id: null,
      params: {},
      result: {},
      success: false,
      error_message: null,
      duration_ms: 10,
      approval_required: false,
      approval_id: null,
      requested_by: null,
      policy_snapshot: {},
      before_state: {},
      after_state: {},
      remediation: {},
    };

    const executionRows = [
      {
        ...baseExecution,
        id: 'exec-queued',
        connector_id: 'slack',
        action: 'comms.message.send',
        created_at: '2026-04-02T10:00:00.000Z',
      },
      {
        ...baseExecution,
        id: 'exec-paused',
        connector_id: 'zendesk',
        action: 'support.ticket.update',
        created_at: '2026-04-02T10:01:00.000Z',
      },
      {
        ...baseExecution,
        id: 'exec-recovered',
        connector_id: 'hubspot',
        action: 'crm.lead.update',
        success: true,
        created_at: '2026-04-02T10:03:00.000Z',
      },
      {
        ...baseExecution,
        id: 'exec-ok',
        connector_id: 'salesforce',
        action: 'crm.note.create',
        success: true,
        created_at: '2026-04-02T10:04:00.000Z',
      },
    ];

    const retryRows = [
      {
        connector_id: 'slack',
        action: 'comms.message.send',
        attempt_count: 2,
        next_attempt_at: '2026-04-02T10:06:00.000Z',
        status: 'queued_for_retry',
        updated_at: '2026-04-02T10:05:00.000Z',
      },
    ];

    const breakerRows = [
      {
        connector_id: 'zendesk',
        state: 'open',
        opened_at: '2026-04-02T09:59:00.000Z',
      },
      {
        connector_id: 'hubspot',
        state: 'open',
        opened_at: '2026-04-02T10:02:00.000Z',
      },
      {
        connector_id: 'salesforce',
        state: 'closed',
        opened_at: null,
      },
    ];

    mockUserRest.mockImplementation(async (_jwt, table, _query, _options) => {
      if (table === 'connector_action_executions') return executionRows;
      if (table === 'connector_retry_queue') return retryRows;
      if (table === 'connector_circuit_breakers') return breakerRows;
      return [];
    });

    const res = await invokeGovernedActionsRoute();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const byId = new Map<string, any>((res.body.data || []).map((row: any) => [row.id, row] as [string, any]));

    expect(byId.get('exec-queued')?.reliability_state).toBe('queued_for_retry');
    expect(byId.get('exec-queued')?.retry_count).toBe(2);
    expect(byId.get('exec-queued')?.next_retry_at).toBe('2026-04-02T10:06:00.000Z');
    expect(byId.get('exec-queued')?.reason_category).toBe('reliability_degraded');
    expect(byId.get('exec-queued')?.reason_message).toContain('queued for retry');
    expect(byId.get('exec-queued')?.recommended_next_action).toContain('scheduled retry');

    expect(byId.get('exec-paused')?.reliability_state).toBe('paused_by_circuit_breaker');
    expect(byId.get('exec-paused')?.breaker_open).toBe(true);
    expect(byId.get('exec-paused')?.reason_category).toBe('reliability_degraded');
    expect(byId.get('exec-paused')?.reason_message).toContain('circuit breaker is open');
    expect(byId.get('exec-paused')?.recommended_next_action).toContain('breaker');

    expect(byId.get('exec-recovered')?.reliability_state).toBe('recovered');
    expect(byId.get('exec-recovered')?.recovered_at).toBe('2026-04-02T10:03:00.000Z');
    expect(byId.get('exec-recovered')?.reason_category).toBeNull();
    expect(byId.get('exec-recovered')?.reason_message).toBeNull();
    expect(byId.get('exec-recovered')?.recommended_next_action).toBeNull();

    expect(byId.get('exec-ok')?.reliability_state).toBe('ok');
    expect(byId.get('exec-ok')?.reason_category).toBeNull();
    expect(byId.get('exec-ok')?.reason_message).toBeNull();
    expect(byId.get('exec-ok')?.recommended_next_action).toBeNull();
  });
});
