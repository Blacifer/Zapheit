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
});
