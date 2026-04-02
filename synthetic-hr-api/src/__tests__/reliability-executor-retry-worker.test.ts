import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockCheckCircuitBreaker = jest.fn();
const mockRecordSuccess = jest.fn();
const mockRecordFailure = jest.fn();
const mockExecuteConnectorAction = jest.fn();
const mockSupabaseRest = jest.fn();

jest.mock('../lib/circuit-breaker', () => ({
  checkCircuitBreaker: (...args: any[]) => mockCheckCircuitBreaker(...args),
  recordSuccess: (...args: any[]) => mockRecordSuccess(...args),
  recordFailure: (...args: any[]) => mockRecordFailure(...args),
}));

jest.mock('../lib/connectors/action-executor', () => ({
  executeConnectorAction: (...args: any[]) => mockExecuteConnectorAction(...args),
}));

jest.mock('../lib/supabase-rest', () => ({
  supabaseRest: (...args: any[]) => mockSupabaseRest(...args),
  eq: (value: string | number) => `eq.${encodeURIComponent(String(value))}`,
  lte: (value: string | number) => `lte.${encodeURIComponent(String(value))}`,
  gte: (value: string | number) => `gte.${encodeURIComponent(String(value))}`,
}));

import { runRetryWorkerCycleForTests } from '../lib/retry-worker';

describe('Reliability - executor and retry worker', () => {
  beforeEach(() => {
    mockCheckCircuitBreaker.mockReset();
    mockRecordSuccess.mockReset();
    mockRecordFailure.mockReset();
    mockExecuteConnectorAction.mockReset();
    mockSupabaseRest.mockReset();
  });

  it('marks retry items recovered when retry succeeds', async () => {
    const queuePatches: any[] = [];
    (mockCheckCircuitBreaker as any).mockResolvedValue('closed');
    (mockExecuteConnectorAction as any).mockResolvedValue({ success: true, data: { ok: true } });
    (mockRecordSuccess as any).mockResolvedValue(undefined);

    (mockSupabaseRest as any).mockImplementation(async (table: string, _query: any, options: any = {}) => {
      const method = options?.method || 'GET';
      if (table === 'connector_retry_queue' && method === 'GET') {
        return [{
          id: 'retry-1',
          organization_id: 'org-1',
          connector_id: 'slack',
          action: 'comms.message.send',
          params: { channel: 'ops', text: 'retry' },
          credentials_ref: null,
          attempt_count: 0,
        }];
      }
      if (table === 'integration_credentials') return [];
      if (table === 'connector_retry_queue' && method === 'PATCH') {
        queuePatches.push(options.body);
        return [options.body];
      }
      return [];
    });

    await runRetryWorkerCycleForTests();

    expect(mockExecuteConnectorAction).toHaveBeenCalled();
    expect(mockRecordSuccess).toHaveBeenCalledWith('org-1', 'slack');
    expect(queuePatches.some((body) => body.status === 'recovered' && body.attempt_count === 1)).toBe(true);
  });
});
