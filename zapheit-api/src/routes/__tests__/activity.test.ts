import { supabaseRestAsUser } from '../../lib/supabase-rest';
import activityRouter, { normalizeActivityEvent } from '../activity';

const router: any = activityRouter;

jest.mock('../../lib/supabase-rest', () => ({
  supabaseRestAsUser: jest.fn(),
  eq: (value: string | number) => `eq.${String(value)}`,
  gt: (value: string | number) => `gt.${String(value)}`,
}));

jest.mock('../../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';

async function invokeActivityRoute(url: string, query: Record<string, string> = {}) {
  const req: any = {
    method: 'GET',
    url,
    originalUrl: url,
    params: {},
    query,
    headers: {},
    userJwt: 'mock-jwt',
    user: {
      id: USER_ID,
      email: 'admin@example.com',
      organization_id: ORG_ID,
      role: 'admin',
    },
    requestId: 'req-1',
    socket: { setKeepAlive: jest.fn() },
    on: jest.fn(),
  };

  let statusCode = 200;
  let responseBody: any = null;

  const res: any = {
    statusCode: 200,
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      responseBody = body;
      return this;
    },
    setHeader: jest.fn(),
    write: jest.fn(),
    flushHeaders: jest.fn(),
  };

  await new Promise<void>((resolve, reject) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    router.handle(req, res, (error: any) => error ? reject(error) : done());
    const check = setInterval(() => {
      if (responseBody !== null) {
        clearInterval(check);
        done();
      }
    }, 5);
    setTimeout(() => {
      clearInterval(check);
      done();
    }, 1000);
  });

  return { statusCode, body: responseBody };
}

describe('normalizeActivityEvent', () => {
  it('uses a stored unified activity event when audit evidence includes one', () => {
    const event = normalizeActivityEvent({
      id: 'audit-1',
      action: 'connector.executed',
      resource_type: 'connector_action',
      resource_id: 'execution-1',
      user_id: USER_ID,
      created_at: '2026-04-30T00:00:00.000Z',
      details: {
        unified_activity_event: {
          id: 'connector-execution-1',
          type: 'connector',
          status: 'deployed',
          tone: 'success',
          at: '2026-04-30T00:00:01.000Z',
          title: 'GitHub · create issue',
          detail: 'Approval-gated write executed',
          route: 'apps',
        },
      },
    });

    expect(event).toMatchObject({
      id: 'connector-execution-1',
      type: 'connector',
      status: 'deployed',
      tone: 'success',
      title: 'GitHub · create issue',
      evidenceRef: 'audit-1',
      sourceRef: 'execution-1',
    });
  });

  it('falls back to a truthful audit event when no unified payload exists', () => {
    const event = normalizeActivityEvent({
      id: 'audit-2',
      action: 'agent.paused',
      resource_type: 'agent',
      resource_id: 'agent-1',
      user_id: USER_ID,
      created_at: '2026-04-30T00:00:00.000Z',
      details: {},
    });

    expect(event).toMatchObject({
      id: 'audit-audit-2',
      type: 'audit',
      title: 'Agent Paused',
      detail: 'agent · audit evidence recorded',
      status: 'deployed',
      tone: 'success',
      evidenceRef: 'audit-2',
    });
  });
});

describe('GET /events', () => {
  let mockRest: jest.MockedFunction<typeof supabaseRestAsUser>;

  beforeEach(() => {
    mockRest = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;
    mockRest.mockReset();
  });

  it('returns activity events from RLS-scoped audit logs', async () => {
    mockRest.mockResolvedValueOnce([
      {
        id: 'audit-3',
        action: 'approval.requested',
        resource_type: 'approval_request',
        resource_id: 'approval-1',
        user_id: USER_ID,
        created_at: '2026-04-30T00:00:00.000Z',
        details: {},
      },
    ]);

    const { statusCode, body } = await invokeActivityRoute('/events', { limit: '10' });

    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.events).toHaveLength(1);
    expect(body.data.events[0]).toMatchObject({
      id: 'audit-audit-3',
      title: 'Approval Requested',
      evidenceRef: 'audit-3',
    });
    expect(mockRest).toHaveBeenCalledWith(
      'mock-jwt',
      'audit_logs',
      expect.any(URLSearchParams),
    );
    const query = mockRest.mock.calls[0][2] as URLSearchParams;
    expect(query.get('organization_id')).toBe(`eq.${ORG_ID}`);
    expect(query.get('limit')).toBe('10');
  });

  it('merges approvals, jobs, incidents, connector health, executions, costs, and audit evidence', async () => {
    mockRest
      .mockResolvedValueOnce([
        {
          id: 'audit-4',
          action: 'policy.violated',
          resource_type: 'policy',
          resource_id: 'policy-1',
          user_id: USER_ID,
          created_at: '2026-04-30T00:00:06.000Z',
          details: {},
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'approval-1',
          service: 'github',
          action: 'create_issue',
          status: 'pending',
          required_role: 'manager',
          requested_by: 'agent',
          created_at: '2026-04-30T00:00:05.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'job-1',
          type: 'connector_action',
          status: 'running',
          runtime_instance_id: 'runtime-1',
          created_by: USER_ID,
          created_at: '2026-04-30T00:00:04.000Z',
          started_at: '2026-04-30T00:00:04.500Z',
          output: {},
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'incident-1',
          incident_type: 'pii_leak',
          severity: 'high',
          status: 'open',
          title: 'PII detected',
          description: 'Sensitive data detected in output',
          created_at: '2026-04-30T00:00:03.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'execution-1',
          connector_id: 'github',
          action: 'create_issue',
          success: true,
          duration_ms: 320,
          approval_required: true,
          approval_id: 'approval-1',
          created_at: '2026-04-30T00:00:02.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'integration-1',
          service_type: 'github',
          service_name: 'GitHub',
          category: 'DEVOPS',
          status: 'connected',
          created_at: '2026-04-30T00:00:01.000Z',
          updated_at: '2026-04-30T00:00:01.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'cost-1',
          model_name: 'gpt-4o',
          total_tokens: 1200,
          cost_usd: '0.024',
          request_count: 1,
          date: '2026-04-30',
          created_at: '2026-04-30T00:00:00.000Z',
        },
      ]);

    const { statusCode, body } = await invokeActivityRoute('/events', { limit: '20' });

    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.events).toHaveLength(7);
    expect(body.data.events.map((event: any) => event.type)).toEqual([
      'audit',
      'approval',
      'job',
      'incident',
      'connector',
      'connector',
      'cost',
    ]);
    expect(body.data.events[1]).toMatchObject({
      title: 'Approval requested: Github · Create Issue',
      status: 'needs_policy',
      route: 'approvals',
    });
    expect(body.data.events[3]).toMatchObject({
      title: 'Incident opened: PII detected',
      tone: 'risk',
      route: 'incidents',
    });
    expect(body.data.events[6]).toMatchObject({
      title: 'Cost recorded: $0.024',
      route: 'costs',
    });
  });

  it('filters activity by production source type', async () => {
    mockRest.mockResolvedValueOnce([
      {
        id: 'incident-filtered-1',
        incident_type: 'prompt_injection',
        severity: 'critical',
        status: 'open',
        title: 'Prompt injection detected',
        description: 'Prompt injection attempt detected.',
        created_at: '2026-04-30T00:00:03.000Z',
      },
    ]);

    const { statusCode, body } = await invokeActivityRoute('/events', { limit: '20', type: 'incident' });

    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.events).toHaveLength(1);
    expect(body.data.events[0]).toMatchObject({
      type: 'incident',
      title: 'Incident opened: Prompt injection detected',
      status: 'blocked',
      route: 'incidents',
    });
    expect(mockRest).toHaveBeenCalledTimes(1);
    expect(mockRest).toHaveBeenCalledWith(
      'mock-jwt',
      'incidents',
      expect.any(URLSearchParams),
    );
  });
});
