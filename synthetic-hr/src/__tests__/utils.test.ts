import { describe, it, expect, beforeEach } from '@jest/globals';
import { cn, loadFromStorage, saveToStorage, detectIncidents, calculateCost, STORAGE_KEYS } from '../lib/utils';

// Mock the security module to isolate utils
jest.mock('../lib/security', () => ({
  webhookRateLimiter: {
    isAllowed: jest.fn().mockReturnValue(true),
  },
}));

describe('cn (class name merger)', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
  });

  it('deduplicates Tailwind classes (last wins)', () => {
    const result = cn('text-red-500', 'text-blue-500');
    expect(result).toBe('text-blue-500');
  });
});

describe('localStorage helpers', () => {
  beforeEach(() => {
    (localStorage.getItem as jest.Mock).mockReset();
    (localStorage.setItem as jest.Mock).mockReset();
  });

  describe('loadFromStorage', () => {
    it('returns parsed value when key exists', () => {
      (localStorage.getItem as jest.Mock).mockReturnValue('{"count":42}');
      expect(loadFromStorage('key', {})).toEqual({ count: 42 });
    });

    it('returns defaultValue when key is absent', () => {
      (localStorage.getItem as jest.Mock).mockReturnValue(null);
      expect(loadFromStorage('missing', [])).toEqual([]);
    });

    it('returns defaultValue on invalid JSON', () => {
      (localStorage.getItem as jest.Mock).mockReturnValue('not-json{{{');
      expect(loadFromStorage('bad', 'default')).toBe('default');
    });
  });

  describe('saveToStorage', () => {
    it('serializes and stores the value', () => {
      saveToStorage('key', { a: 1 });
      expect(localStorage.setItem).toHaveBeenCalledWith('key', '{"a":1}');
    });

    it('throws a friendly error on QuotaExceededError', () => {
      (localStorage.setItem as jest.Mock).mockImplementation(() => {
        const err = new DOMException('quota exceeded', 'QuotaExceededError');
        throw err;
      });
      expect(() => saveToStorage('k', 'v')).toThrow('Storage quota exceeded');
    });
  });

  it('STORAGE_KEYS are stable strings', () => {
    expect(STORAGE_KEYS.AGENTS).toBe('synthetic_hr_agents');
    expect(STORAGE_KEYS.INCIDENTS).toBe('synthetic_hr_incidents');
    expect(STORAGE_KEYS.COST_DATA).toBe('synthetic_hr_cost_data');
    expect(STORAGE_KEYS.API_KEYS).toBe('synthetic_hr_api_keys');
  });
});

describe('detectIncidents', () => {
  it('detects email addresses as PII', () => {
    const result = detectIncidents('Contact us at john.doe@example.com for help.');
    expect(result.detected).toBe(true);
    expect(result.type).toBe('pii_leak');
    expect(result.severity).toBe('critical');
  });

  it('detects SSN patterns as PII', () => {
    const result = detectIncidents('My SSN is 123-45-6789');
    expect(result.detected).toBe(true);
    expect(result.type).toBe('pii_leak');
  });

  it('detects credit card numbers as PII', () => {
    const result = detectIncidents('Card: 4111 1111 1111 1111');
    expect(result.detected).toBe(true);
    expect(result.type).toBe('pii_leak');
  });

  it('detects refund abuse phrases', () => {
    const result = detectIncidents('Please approve refund for the customer.');
    expect(result.detected).toBe(true);
    expect(result.type).toBe('refund_abuse');
  });

  it('detects legal advice requests', () => {
    const result = detectIncidents('You should seek legal advice from an attorney.');
    expect(result.detected).toBe(true);
    expect(result.type).toBe('legal_advice');
  });

  it('detects toxic content', () => {
    const result = detectIncidents('This is a racist remark.');
    expect(result.detected).toBe(true);
    expect(result.type).toBe('toxic_output');
    expect(result.severity).toBe('critical');
  });

  it('returns no incident for clean content', () => {
    const result = detectIncidents('Thank you for your purchase. Your order will arrive in 3-5 days.');
    expect(result.detected).toBe(false);
    expect(result.type).toBeNull();
    expect(result.severity).toBe('low');
  });
});

describe('calculateCost', () => {
  it('calculates gpt-4o cost', () => {
    const cost = calculateCost(1_000_000, 'gpt-4o');
    expect(cost).toBeGreaterThan(0);
    // 400k input @ $0.005/1M + 600k output @ $0.015/1M = $2 + $9 = $11 per 1M
    expect(cost).toBeCloseTo(0.000011, 5); // per token
  });

  it('falls back to default pricing for unknown model', () => {
    const costUnknown = calculateCost(1000, 'unknown-model-xyz');
    const costDefault = calculateCost(1000, 'unknown-model-xyz');
    expect(costUnknown).toBe(costDefault);
    expect(costUnknown).toBeGreaterThan(0);
  });

  it('returns 0 for 0 tokens', () => {
    expect(calculateCost(0, 'gpt-4o')).toBe(0);
  });
});
