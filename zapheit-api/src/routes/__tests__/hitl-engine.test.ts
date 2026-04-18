import { supabaseRestAsService, supabaseRestAsUser } from '../../lib/supabase-rest';
import { runPreflightGate } from '../../lib/preflight-gate';
import { executeConnectorAction } from '../../lib/connectors/action-executor';

jest.mock('../../lib/supabase-rest', () => ({
  supabaseRestAsUser: jest.fn(),
  supabaseRestAsService: jest.fn(),
  supabaseRest: jest.fn(),
  eq: (value: string | number) => `eq.${encodeURIComponent(String(value))}`,
  gte: (value: string | number) => `gte.${encodeURIComponent(String(value))}`,
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

jest.mock('../../lib/supabase', () => ({
  supabase: {},
  supabaseAdmin: {},
  DEMO_ORG_ID: '00000000-0000-0000-0000-000000000000',
  __esModule: true,
  default: {},
}));

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = req.user || {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'test@example.com',
      organization_id: '22222222-2222-4222-8222-222222222222',
      role: 'admin',
    };
    req.userJwt = req.userJwt || 'mock-jwt';
    next();
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
  __esModule: true,
  default: {
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

jest.mock('../../lib/preflight-gate', () => ({
  runPreflightGate: jest.fn(),
}));

jest.mock('../../lib/connectors/action-executor', () => ({
  executeConnectorAction: jest.fn(),
}));

jest.mock('../../lib/integrations/encryption', () => ({
  decryptSecret: (value: string) => `decrypted:${value}`,
}));

import connectorsRouter from '../connectors';
import approvalsRouter from '../approvals';

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_ORG_ID = '22222222-2222-4222-8222-222222222222';

type ApprovalRow = Record<string, any>;
type ExecutionRow = Record<string, any>;
type AuditRow = Record<string, any>;
type IntegrationRow = Record<string, any>;
type CredentialRow = Record<string, any>;

async function invokeRouter(router: any, method: string, url: string, body?: Record<string, any>) {
  const req: any = {
    method,
    url,
    originalUrl: url,
    headers: {},
    query: {},
    body: body || {},
    user: {
      id: TEST_USER_ID,
      email: 'test@example.com',
      organization_id: TEST_ORG_ID,
      role: 'admin',
    },
    userJwt: 'mock-jwt',
    get() {
      return undefined;
    },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
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
    router.handle(req, res, (err: any) => (err ? reject(err) : resolve()));
    tick();
  });

  return { statusCode: res.statusCode, body: payload };
}

function getQueryValue(query: string | URLSearchParams | undefined, key: string): string | null {
  if (!query) return null;
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  return params.get(key);
}

function decodeEq(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith('eq.')) return value;
  return decodeURIComponent(value.slice(3));
}

describe('HITL engine smoke test', () => {
  let approvalRequests: ApprovalRow[];
  let executions: ExecutionRow[];
  let auditChain: AuditRow[];
  let integrations: IntegrationRow[];
  let credentials: CredentialRow[];
  let approvalCounter = 0;
  let executionCounter = 0;
  let auditCounter = 0;

  const mockUserRest = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;
  const mockServiceRest = supabaseRestAsService as jest.MockedFunction<typeof supabaseRestAsService>;
  const mockPreflight = runPreflightGate as jest.MockedFunction<typeof runPreflightGate>;
  const mockExecuteConnectorAction = executeConnectorAction as jest.MockedFunction<typeof executeConnectorAction>;

  beforeEach(() => {
    approvalCounter = 0;
    executionCounter = 0;
    auditCounter = 0;
    approvalRequests = [];
    executions = [];
    auditChain = [];
    integrations = [
      {
        id: 'integration-1',
        organization_id: TEST_ORG_ID,
        service_type: 'slack',
        status: 'connected',
      },
    ];
    credentials = [
      {
        integration_id: 'integration-1',
        key: 'botToken',
        value: 'encrypted-bot-token',
      },
    ];

    mockPreflight.mockReset();
    mockExecuteConnectorAction.mockReset();
    mockUserRest.mockReset();
    mockServiceRest.mockReset();

    mockPreflight.mockImplementation(async (_orgId, connectorId, action, params, agentId) => ({
      allowed: false,
      decision: 'require_approval',
      reasonCategory: 'approval_required',
      reasonMessage: `Action "${connectorId}.${action}" requires approval`,
      recommendedNextAction: 'Review the request in HITL approvals.',
      blockReason: `Action "${connectorId}.${action}" requires approval`,
      approvalRequired: true,
      approvalData: {
        service: connectorId,
        action,
        action_payload: params,
        required_role: 'manager',
        action_policy_id: 'policy-1',
        ...(agentId ? { agent_id: agentId } : {}),
      },
      policySnapshot: { policy_id: 'policy-1' },
      budgetSnapshot: {},
      dlpSnapshot: {},
      auditRef: `pf_${connectorId}_${action}`,
    }) as any);

    mockExecuteConnectorAction.mockResolvedValue({
      success: true,
      data: { ok: true, provider_message_id: 'provider-123' },
      statusCode: 200,
      idempotencyKey: 'idem-1',
    });

    const serviceSelect = (table: string, query: string | URLSearchParams | undefined) => {
      const id = decodeEq(getQueryValue(query, 'id'));
      const orgId = decodeEq(getQueryValue(query, 'organization_id'));
      const approvalId = decodeEq(getQueryValue(query, 'approval_id'));
      const integrationId = decodeEq(getQueryValue(query, 'integration_id'));
      const serviceType = decodeEq(getQueryValue(query, 'service_type'));

      if (table === 'approval_requests') {
        return approvalRequests.filter((row) =>
          (!id || row.id === id) &&
          (!orgId || row.organization_id === orgId),
        );
      }
      if (table === 'connector_action_executions') {
        return executions.filter((row) =>
          (!id || row.id === id) &&
          (!orgId || row.organization_id === orgId) &&
          (!approvalId || row.approval_id === approvalId),
        );
      }
      if (table === 'audit_event_chain') {
        return [...auditChain];
      }
      if (table === 'integrations') {
        return integrations.filter((row) =>
          (!orgId || row.organization_id === orgId) &&
          (!serviceType || row.service_type === serviceType),
        );
      }
      if (table === 'integration_credentials') {
        return credentials.filter((row) =>
          (!integrationId || row.integration_id === integrationId),
        );
      }
      return [];
    };

    const applyPatch = (rows: Array<Record<string, any>>, patch: Record<string, any>) =>
      rows.map((row) => ({ ...row, ...patch }));

    mockServiceRest.mockImplementation(async (table: string, query?: string | URLSearchParams, options?: any) => {
      const method = options?.method || 'GET';
      if (method === 'GET') {
        const rows = serviceSelect(table, query);
        if (table === 'audit_event_chain') {
          const ordered = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
          const limit = Number(getQueryValue(query, 'limit') || ordered.length);
          return ordered.slice(0, limit);
        }
        return rows;
      }

      if (table === 'approval_requests' && method === 'POST') {
        approvalCounter += 1;
        const row = {
          id: `approval-${approvalCounter}`,
          ...options.body,
        };
        approvalRequests.push(row);
        return [row];
      }

      if (table === 'connector_action_executions' && method === 'POST') {
        executionCounter += 1;
        const row = {
          id: `execution-${executionCounter}`,
          created_at: options.body.created_at || new Date().toISOString(),
          ...options.body,
        };
        executions.push(row);
        return [row];
      }

      if (table === 'connector_action_executions' && method === 'PATCH') {
        const id = decodeEq(getQueryValue(query, 'id'));
        const orgId = decodeEq(getQueryValue(query, 'organization_id'));
        const patched = executions.filter((row) => row.id === id && row.organization_id === orgId);
        executions = executions.map((row) => row.id === id && row.organization_id === orgId ? { ...row, ...options.body } : row);
        return applyPatch(patched, options.body);
      }

      if (table === 'audit_event_chain' && method === 'POST') {
        auditCounter += 1;
        const row = {
          id: `audit-${auditCounter}`,
          created_at: new Date(Date.now() + auditCounter).toISOString(),
          ...options.body,
        };
        auditChain.push(row);
        return [row];
      }

      throw new Error(`Unhandled service rest call: ${table} ${method}`);
    });

    mockUserRest.mockImplementation(async (_jwt: string, table: string, query?: string | URLSearchParams, options?: any) => {
      const method = options?.method || 'GET';
      const id = decodeEq(getQueryValue(query, 'id'));
      const orgId = decodeEq(getQueryValue(query, 'organization_id'));
      const status = decodeEq(getQueryValue(query, 'status'));

      if (table === 'approval_requests' && method === 'GET') {
        return approvalRequests.filter((row) =>
          (!id || row.id === id) &&
          (!orgId || row.organization_id === orgId) &&
          (!status || row.status === status),
        );
      }

      if (table === 'approval_requests' && method === 'PATCH') {
        const patched = approvalRequests.filter((row) => row.id === id && row.organization_id === orgId);
        approvalRequests = approvalRequests.map((row) =>
          row.id === id && row.organization_id === orgId ? { ...row, ...options.body } : row,
        );
        return applyPatch(patched, options.body);
      }

      throw new Error(`Unhandled user rest call: ${table} ${method}`);
    });
  });

  async function pauseToolCall() {
    return invokeRouter(connectorsRouter as any, 'POST', '/slack/tool-call', {
      action: 'send_message',
      params: { channel: 'ops-alerts', text: 'Ship refund' },
      agentId: 'agent-1',
    });
  }

  it('pauses a write tool-call and appends a pending approval audit event', async () => {
    const response = await pauseToolCall();

    expect(response.statusCode).toBe(202);
    expect(response.body.success).toBe(true);
    expect(response.body.data.paused).toBe(true);
    expect(response.body.data.state).toBe('pending_approval');
    expect(response.body.data.approvalId).toBe('approval-1');

    expect(approvalRequests).toHaveLength(1);
    expect(approvalRequests[0].status).toBe('pending');
    expect(approvalRequests[0].service).toBe('slack');
    expect(approvalRequests[0].action).toBe('send_message');

    expect(executions).toHaveLength(1);
    expect(executions[0].approval_required).toBe(true);
    expect(executions[0].approval_id).toBe('approval-1');
    expect(executions[0].result).toEqual(expect.objectContaining({
      pending: true,
      queued: true,
      state: 'pending_approval',
    }));

    const pendingAudit = auditChain.find((row) => row.event_type === 'governed_action.pending_approval');
    expect(pendingAudit).toBeTruthy();
    expect(pendingAudit?.entity_type).toBe('approval_request');
    expect(pendingAudit?.payload).toEqual(expect.objectContaining({
      status: 'pending_approval',
      approval_id: 'approval-1',
      connector_id: 'slack',
      action: 'send_message',
    }));
  });

  it('denies a paused execution and appends a denied audit event without calling the provider', async () => {
    await pauseToolCall();

    const denyResponse = await invokeRouter(approvalsRouter as any, 'POST', '/approval-1/deny', {
      note: 'Denied by reviewer',
    });

    expect(denyResponse.statusCode).toBe(200);
    expect(denyResponse.body.success).toBe(true);
    expect(denyResponse.body.execution).toEqual(expect.objectContaining({
      resumed: false,
      state: 'denied',
    }));
    expect(mockExecuteConnectorAction).not.toHaveBeenCalled();

    expect(approvalRequests[0].status).toBe('denied');
    expect(executions[0].result).toEqual(expect.objectContaining({
      denied: true,
      reviewer_id: TEST_USER_ID,
      reviewer_note: 'Denied by reviewer',
    }));
    expect(executions[0].policy_snapshot?.approval_flow?.state).toBe('denied');

    const deniedAudit = auditChain.find((row) => row.event_type === 'governed_action.denied');
    expect(deniedAudit).toBeTruthy();
    expect(deniedAudit?.payload).toEqual(expect.objectContaining({
      status: 'denied',
      approval_id: 'approval-1',
      reviewer_id: TEST_USER_ID,
    }));
  });

  it('approves a paused execution, injects credentials, executes the provider call, and appends approved/executed audit events', async () => {
    await pauseToolCall();

    const approveResponse = await invokeRouter(approvalsRouter as any, 'POST', '/approval-1/approve', {
      note: 'Looks good',
    });

    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.body.success).toBe(true);
    expect(approveResponse.body.execution).toEqual(expect.objectContaining({
      resumed: true,
      connector_id: 'slack',
      action: 'send_message',
      audit_ref: expect.any(String),
    }));

    expect(mockExecuteConnectorAction).toHaveBeenCalledTimes(1);
    expect(mockExecuteConnectorAction).toHaveBeenCalledWith(
      'slack',
      'send_message',
      { channel: 'ops-alerts', text: 'Ship refund' },
      expect.objectContaining({ botToken: 'decrypted:encrypted-bot-token' }),
      TEST_ORG_ID,
      'agent-1',
      'integration-1',
    );

    expect(approvalRequests[0].status).toBe('approved');
    expect(executions[0].integration_id).toBe('integration-1');
    expect(executions[0].success).toBe(true);
    expect(executions[0].result).toEqual(expect.objectContaining({
      ok: true,
      provider_message_id: 'provider-123',
    }));
    expect(executions[0].policy_snapshot?.approval_flow?.state).toBe('approved_and_executed');

    const approvedAudit = auditChain.find((row) => row.event_type === 'governed_action.approved');
    expect(approvedAudit).toBeTruthy();
    expect(approvedAudit?.payload).toEqual(expect.objectContaining({
      status: 'approved',
      approval_id: 'approval-1',
      reviewer_id: TEST_USER_ID,
    }));

    const executedAudit = auditChain.find((row) => row.event_type === 'governed_action.executed' && row.entity_type === 'approval_request');
    expect(executedAudit).toBeTruthy();
    expect(executedAudit?.payload).toEqual(expect.objectContaining({
      status: 'executed',
      approval_id: 'approval-1',
      connector_id: 'slack',
      action: 'send_message',
      requested_by: TEST_USER_ID,
      agent_id: 'agent-1',
      idempotency_key: 'idem-1',
    }));
  });
});
