import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const mockCheckCircuitBreaker = jest.fn();
const mockRecordSuccess = jest.fn();
const mockRecordFailure = jest.fn();
const mockEnqueueRetry = jest.fn();
const mockSupabaseRest = jest.fn();

jest.mock('../lib/circuit-breaker', () => ({
  checkCircuitBreaker: (...args: any[]) => mockCheckCircuitBreaker(...args),
  recordSuccess: (...args: any[]) => mockRecordSuccess(...args),
  recordFailure: (...args: any[]) => mockRecordFailure(...args),
}));

jest.mock('../lib/retry-worker', () => ({
  enqueueRetry: (...args: any[]) => mockEnqueueRetry(...args),
}));

jest.mock('../lib/supabase-rest', () => ({
  supabaseRest: (...args: any[]) => mockSupabaseRest(...args),
  eq: (value: string | number) => `eq.${encodeURIComponent(String(value))}`,
  gte: (value: string | number) => `gte.${encodeURIComponent(String(value))}`,
}));

import { executeConnectorAction } from '../lib/connectors/action-executor';

describe('Reliability - idempotency regression', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch> | null = null;

  beforeEach(() => {
    mockCheckCircuitBreaker.mockReset();
    mockRecordSuccess.mockReset();
    mockRecordFailure.mockReset();
    mockEnqueueRetry.mockReset();
    mockSupabaseRest.mockReset();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = null;
  });

  it('returns cached successful result on duplicate write fingerprint and skips outbound call', async () => {
    (mockCheckCircuitBreaker as any).mockResolvedValue('closed');
    (mockSupabaseRest as any).mockImplementation(async (table: string) => {
      if (table === 'connector_action_executions') {
        return [{ id: 'existing', result: { cached: true, value: 42 } }];
      }
      return [];
    });

    const result = await executeConnectorAction(
      'slack',
      'send_message',
      { channel: 'ops-alerts', text: 'duplicate-safe' },
      { access_token: 'token-123' },
      'org-1',
      'agent-1',
      'integration-1',
    );

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.data).toEqual({ cached: true, value: 42 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockRecordSuccess).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(mockEnqueueRetry).not.toHaveBeenCalled();
  });
});

