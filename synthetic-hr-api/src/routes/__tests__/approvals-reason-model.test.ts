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
    mockUserRest.mockImplementation(async (_jwt: string, table: string) => {
      if (table === 'approval_requests') return [];
      if (table === 'agent_jobs') return [];
      if (table === 'agent_job_approvals') return [];
      return [];
    });
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
    mockUserRest.mockImplementation(async (_jwt: string, table: string) => {
      if (table === 'approval_requests') {
        return [
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
        ] as any;
      }
      if (table === 'agent_jobs') return [];
      if (table === 'agent_job_approvals') return [];
      return [];
    });

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

  it('merges governed job approvals into the approvals inbox with normalized metadata', async () => {
    mockUserRest.mockImplementation(async (_jwt: string, table: string) => {
      if (table === 'approval_requests') return [];
      if (table === 'agent_jobs') {
        return [{
          id: 'job-1',
          organization_id: '22222222-2222-4222-8222-222222222222',
          agent_id: 'agent-1',
          type: 'connector_action',
          status: 'pending_approval',
          input: {
            connector: {
              service: 'slack',
              action: 'comms.message.send',
              params: { channel: '#ops' },
            },
          },
          output: {},
          created_at: '2026-04-16T10:00:00.000Z',
        }] as any;
      }
      if (table === 'agent_job_approvals') {
        return [{
          id: 'job-approval-1',
          job_id: 'job-1',
          status: 'pending',
          requested_by: 'user-1',
          policy_snapshot: {
            required_role: 'manager',
            workflow: { source: 'apps', source_ref: 'job-1' },
          },
          created_at: '2026-04-16T10:00:00.000Z',
        }] as any;
      }
      return [];
    });

    const res = await invokeApprovalsListRoute();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const item = (res.body.data || [])[0];
    expect(item.id).toBe('job-approval-1');
    expect(item.approval_source).toBe('job_approval');
    expect(item.service).toBe('slack');
    expect(item.action).toBe('comms.message.send');
    expect(item.source).toBe('apps');
    expect(item.job_id).toBe('job-1');
    expect(item.governed_execution?.status).toBe('pending_approval');
    expect(item.cost_status?.state).toBe('outside_scope');
  });
});
