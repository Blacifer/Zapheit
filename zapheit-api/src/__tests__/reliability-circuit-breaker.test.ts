import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('../lib/supabase-rest', () => ({
  supabaseRest: jest.fn(async () => []),
  eq: (value: string | number) => `eq.${encodeURIComponent(String(value))}`,
}));

import { checkCircuitBreaker, recordFailure, recordSuccess } from '../lib/circuit-breaker';

describe('Reliability - circuit breaker transitions', () => {
  const orgId = 'org-reliability';
  const connectorId = 'slack';

  let nowSpy: jest.SpiedFunction<typeof Date.now> | null = null;

  beforeEach(() => {
    nowSpy?.mockRestore();
    nowSpy = null;
  });

  afterEach(() => {
    nowSpy?.mockRestore();
  });

  it('trips to open after repeated failures, then moves to half_open and closes on success', async () => {
    await recordFailure(orgId, connectorId);
    await recordFailure(orgId, connectorId);
    await recordFailure(orgId, connectorId);

    const openState = await checkCircuitBreaker(orgId, connectorId);
    expect(openState).toBe('open');

    const openedAt = Date.now();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(openedAt + 61_000);

    const halfOpenState = await checkCircuitBreaker(orgId, connectorId);
    expect(halfOpenState).toBe('half_open');

    await recordSuccess(orgId, connectorId);
    const closedState = await checkCircuitBreaker(orgId, connectorId);
    expect(closedState).toBe('closed');
  });
});

