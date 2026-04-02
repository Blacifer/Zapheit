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

jest.mock('../../lib/audit-logger', () => ({
  auditLog: { log: jest.fn() },
}));

jest.mock('../../lib/webhook-relay', () => ({
  fireAndForgetWebhookEvent: jest.fn(),
}));

jest.mock('../../lib/slack-notify', () => ({
  notifySlackApproval: jest.fn(),
}));

jest.mock('../../lib/notification-service', () => ({
  notifyApprovalAssignedAsync: jest.fn(),
}));

jest.mock('../../lib/correction-memory', () => ({
  storeCorrection: jest.fn(),
}));

import approvalsRouter from '../approvals';

describe('Approvals Routes - normalized reason model', () => {
  let mockUserRest: jest.MockedFunction<typeof supabaseRestAsUser>;
  let mockServiceRest: jest.MockedFunction<typeof supabaseRestAsService>;

  beforeEach(() => {
    mockUserRest = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;
    mockServiceRest = supabaseRestAsService as jest.MockedFunction<typeof supabaseRestAsService>;
    mockUserRest.mockReset();
    mockServiceRest.mockReset();
    mockServiceRest.mockResolvedValue([]);
  });

  async function invokeApprovalsListRoute() {
    const req: any = {
      method: 'GET',
      url: '/',
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
      (approvalsRouter as any).handle(req, res, (err: any) => (err ? reject(err) : resolve()));
      tick();
    });

    return { statusCode: res.statusCode, body: payload };
  }

  it('maps approval statuses to reason fields for operator clarity', async () => {
    mockUserRest.mockResolvedValue([
      {
        id: 'pending-1',
        status: 'pending',
      },
      {
        id: 'denied-1',
        status: 'denied',
        reviewer_note: 'Denied due to destination policy.',
      },
      {
        id: 'expired-1',
        status: 'expired',
      },
      {
        id: 'cancelled-1',
        status: 'cancelled',
      },
      {
        id: 'approved-1',
        status: 'approved',
      },
    ] as any);

    const res = await invokeApprovalsListRoute();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const byId = new Map<string, any>((res.body.data || []).map((row: any) => [row.id, row] as [string, any]));

    expect(byId.get('pending-1')?.reason_category).toBe('approval_required');
    expect(byId.get('pending-1')?.reason_message).toContain('Human approval is required');
    expect(byId.get('pending-1')?.recommended_next_action).toContain('Review payload');

    expect(byId.get('denied-1')?.reason_category).toBe('policy_blocked');
    expect(byId.get('denied-1')?.reason_message).toBe('Denied due to destination policy.');

    expect(byId.get('expired-1')?.reason_category).toBe('execution_failed');
    expect(byId.get('cancelled-1')?.reason_category).toBe('execution_failed');

    expect(byId.get('approved-1')?.reason_category).toBeNull();
    expect(byId.get('approved-1')?.reason_message).toBeNull();
    expect(byId.get('approved-1')?.recommended_next_action).toBeNull();
  });
});
