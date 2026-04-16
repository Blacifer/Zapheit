import { supabaseRestAsUser } from '../../lib/supabase-rest';

jest.mock('../../lib/supabase-rest', () => ({
  supabaseRestAsUser: jest.fn(),
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

import conversationsRouter from '../conversations';

describe('Conversations Routes - governed chat workflow', () => {
  let mockUserRest: jest.MockedFunction<typeof supabaseRestAsUser>;

  beforeEach(() => {
    mockUserRest = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;
    mockUserRest.mockReset();
  });

  async function invokeChatRoute(body: Record<string, unknown>) {
    const req: any = {
      method: 'POST',
      url: '/conversations/chat',
      headers: {},
      query: {},
      body,
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
      (conversationsRouter as any).handle(req, res, (err: any) => (err ? reject(err) : resolve()));
      tick();
    });

    return { statusCode: res.statusCode, body: payload };
  }

  it('creates a normalized governed session for a standard chat turn', async () => {
    mockUserRest.mockImplementation(async (_jwt: string, table: string, _query?: any, options?: any) => {
      if (table === 'ai_agents') {
        return [{
          id: 'agent-1',
          name: 'Ops Agent',
          system_prompt: 'Help safely.',
          model_name: 'gpt-5.4',
          status: 'active',
        }] as any;
      }
      if (table === 'agent_deployments') {
        return [{
          id: 'deployment-1',
          agent_id: 'agent-1',
          runtime_id: 'runtime-1',
          status: 'active',
        }] as any;
      }
      if (table === 'conversations' && options?.method === 'POST') {
        return [{
          id: 'conversation-1',
          agent_id: 'agent-1',
          platform: 'internal',
          status: 'active',
          metadata: {
            topic: 'Summarize the latest customer issue',
          },
        }] as any;
      }
      if (table === 'messages' && options?.method === 'POST') {
        return [{
          id: 'message-1',
          role: 'user',
          content: 'Summarize the latest customer issue.',
          token_count: 0,
          created_at: '2026-04-16T11:00:00.000Z',
        }] as any;
      }
      if (table === 'messages') {
        return [{
          id: 'message-1',
          role: 'user',
          content: 'Summarize the latest customer issue.',
          token_count: 0,
          created_at: '2026-04-16T11:00:00.000Z',
        }] as any;
      }
      if (table === 'agent_jobs' && options?.method === 'POST') {
        return [{
          id: 'job-1',
          type: 'chat_turn',
          status: 'queued',
          input: {
            conversation_id: 'conversation-1',
            messages: [{ role: 'user', content: 'Summarize the latest customer issue.' }],
            workflow: { source: 'chat', source_ref: 'conversation-1' },
          },
          output: {},
          created_at: '2026-04-16T11:00:00.000Z',
        }] as any;
      }
      if (table === 'agent_job_approvals' && options?.method === 'POST') {
        return [{
          id: 'approval-1',
          job_id: 'job-1',
          status: 'approved',
          requested_by: '11111111-1111-4111-8111-111111111111',
          approved_by: '11111111-1111-4111-8111-111111111111',
          policy_snapshot: {
            workflow: { source: 'chat', source_ref: 'conversation-1' },
          },
          created_at: '2026-04-16T11:00:00.000Z',
          decided_at: '2026-04-16T11:00:01.000Z',
        }] as any;
      }
      if (table === 'conversations' && options?.method === 'PATCH') {
        return [{
          id: 'conversation-1',
          agent_id: 'agent-1',
          platform: 'internal',
          status: 'active',
          metadata: {
            latest_job_id: 'job-1',
            mode: 'operator',
          },
        }] as any;
      }
      return [];
    });

    const res = await invokeChatRoute({
      agent_id: 'agent-1',
      prompt: 'Summarize the latest customer issue.',
      mode: 'operator',
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session.mode).toBe('operator');
    expect(res.body.data.session.source).toBe('chat');
    expect(res.body.data.session.source_ref).toBe('conversation-1');
    expect(res.body.data.job.type).toBe('chat_turn');
    expect(res.body.data.job.approval_summary?.approval_source).toBe('job_approval');
    expect(res.body.data.job.governed_execution?.status).toBe('approved');
    expect(res.body.data.job.governed_execution?.source).toBe('chat');
    expect(res.body.data.job.cost_status?.state).toBe('unavailable');
  });

  it('uses template workflow semantics when chat is started from a template', async () => {
    mockUserRest.mockImplementation(async (_jwt: string, table: string, _query?: any, options?: any) => {
      if (table === 'ai_agents') {
        return [{
          id: 'agent-2',
          name: 'Compliance Agent',
          system_prompt: 'Review carefully.',
          model_name: 'gpt-5.4',
          status: 'active',
        }] as any;
      }
      if (table === 'agent_deployments') {
        return [{
          id: 'deployment-2',
          agent_id: 'agent-2',
          runtime_id: 'runtime-2',
          status: 'active',
        }] as any;
      }
      if (table === 'conversations' && options?.method === 'POST') {
        return [{
          id: 'conversation-2',
          agent_id: 'agent-2',
          platform: 'internal',
          status: 'active',
          metadata: {
            template_id: 'compliance-evidence-assistant',
          },
        }] as any;
      }
      if (table === 'messages' && options?.method === 'POST') {
        return [{
          id: 'message-2',
          role: 'user',
          content: 'Prepare the evidence summary.',
          token_count: 0,
          created_at: '2026-04-16T12:00:00.000Z',
        }] as any;
      }
      if (table === 'messages') {
        return [{
          id: 'message-2',
          role: 'user',
          content: 'Prepare the evidence summary.',
          token_count: 0,
          created_at: '2026-04-16T12:00:00.000Z',
        }] as any;
      }
      if (table === 'agent_jobs' && options?.method === 'POST') {
        return [{
          id: 'job-2',
          type: 'workflow_run',
          status: 'queued',
          input: {
            workflow: { source: 'template', source_ref: 'conversation-2' },
          },
          output: {},
          created_at: '2026-04-16T12:00:00.000Z',
        }] as any;
      }
      if (table === 'agent_job_approvals' && options?.method === 'POST') {
        return [{
          id: 'approval-2',
          job_id: 'job-2',
          status: 'approved',
          requested_by: '11111111-1111-4111-8111-111111111111',
          approved_by: '11111111-1111-4111-8111-111111111111',
          policy_snapshot: {
            workflow: { source: 'template', source_ref: 'conversation-2' },
            template_id: 'compliance-evidence-assistant',
          },
          created_at: '2026-04-16T12:00:00.000Z',
          decided_at: '2026-04-16T12:00:01.000Z',
        }] as any;
      }
      if (table === 'conversations' && options?.method === 'PATCH') {
        return [{
          id: 'conversation-2',
          agent_id: 'agent-2',
          platform: 'internal',
          status: 'active',
          metadata: {
            latest_job_id: 'job-2',
            mode: 'operator',
            template_id: 'compliance-evidence-assistant',
          },
        }] as any;
      }
      return [];
    });

    const res = await invokeChatRoute({
      agent_id: 'agent-2',
      prompt: 'Prepare the evidence summary.',
      mode: 'operator',
      template_id: 'compliance-evidence-assistant',
      template_context: {
        name: 'Compliance Evidence Assistant',
        businessPurpose: 'Prepare an evidence pack for review.',
        riskLevel: 'medium',
        approvalDefault: 'manager_review',
        requiredSystems: ['Google Workspace', 'Jira'],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session.source).toBe('template');
    expect(res.body.data.session.template_id).toBe('compliance-evidence-assistant');
    expect(res.body.data.job.type).toBe('workflow_run');
    expect(res.body.data.job.governed_execution?.source).toBe('template');
    expect(res.body.data.job.approval_summary?.job_id).toBe('job-2');
    expect(res.body.data.job.cost_status?.state).toBe('unavailable');
  });
});
