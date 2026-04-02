import { describe, it, expect, beforeEach, jest } from '@jest/globals';

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

describe('Reliability - connector action executor', () => {
  beforeEach(() => {
    mockCheckCircuitBreaker.mockReset();
    mockRecordSuccess.mockReset();
    mockRecordFailure.mockReset();
    mockEnqueueRetry.mockReset();
    mockSupabaseRest.mockReset();
  });

  it('queues action and returns 503 when circuit breaker is open', async () => {
    (mockCheckCircuitBreaker as any).mockResolvedValue('open');
    (mockEnqueueRetry as any).mockResolvedValue(undefined);

    const result = await executeConnectorAction(
      'slack',
      'comms.message.send',
      { channel: 'ops', text: 'hello' },
      { token: 'x' },
      'org-1',
      'agent-1',
      'integration-1',
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.error || '').toContain('queued');
    expect(mockEnqueueRetry).toHaveBeenCalledWith(
      'org-1',
      'slack',
      'comms.message.send',
      { channel: 'ops', text: 'hello' },
      'agent-1',
      'integration-1',
    );
  });
});
