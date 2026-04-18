import { sanitizeString, isValidEmail } from '../lib/security';


describe('sanitizeString', () => {
  it('removes angle brackets to prevent XSS', () => {
    expect(sanitizeString('<script>alert(1)</script>')).not.toContain('<');
    expect(sanitizeString('<script>alert(1)</script>')).not.toContain('>');
  });

  it('removes javascript: protocol', () => {
    expect(sanitizeString('javascript:alert(1)')).not.toContain('javascript:');
  });

  it('removes inline event handlers', () => {
    expect(sanitizeString('onclick=evil()')).not.toContain('onclick=');
  });

  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('passes clean text unchanged (minus trim)', () => {
    expect(sanitizeString('Hello, world!')).toBe('Hello, world!');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeString(null as any)).toBe('');
    expect(sanitizeString(undefined as any)).toBe('');
    expect(sanitizeString(123 as any)).toBe('');
  });
});

describe('isValidEmail', () => {
  it('accepts valid email addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('user+tag@sub.domain.org')).toBe(true);
  });

  it('rejects invalid email addresses', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('@nodomain')).toBe(false);
    expect(isValidEmail('noatsign.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});
