// Input validation and sanitization utilities
// Protects against XSS, injection attacks, and invalid data

// Sanitize string input - remove potentially dangerous characters
export const sanitizeString = (input: string): string => {
  if (typeof input !== 'string') return '';

  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
};

// Sanitize for HTML display
export const sanitizeHtml = (input: string): string => {
  if (typeof input !== 'string') return '';

  const div = document.createElement('div');
  div.textContent = input;
  return div.innerHTML;
};

// Validate email format
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Validate URL format
export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Validate Slack webhook URL
export const isValidSlackWebhook = (url: string): boolean => {
  return isValidUrl(url) && url.includes('hooks.slack.com');
};

// Validate UUID format
export const isValidUUID = (id: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

// Validate password strength
export const validatePassword = (password: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

// Validate API key format
export const isValidApiKeyFormat = (key: string): boolean => {
  // Must start with sk_ and be at least 40 characters
  return key.startsWith('sk_') && key.length >= 40;
};

// Sanitize object recursively
export const sanitizeObject = <T extends Record<string, any>>(obj: T, fields: (keyof T)[]): Partial<T> => {
  const sanitized: Partial<T> = {};

  for (const field of fields) {
    const value = obj[field];
    if (typeof value === 'string') {
      (sanitized as any)[field] = sanitizeString(value);
    } else if (value !== undefined) {
      (sanitized as any)[field] = value;
    }
  }

  return sanitized;
};

// Validate number within range
export const isInRange = (value: number, min: number, max: number): boolean => {
  return typeof value === 'number' && value >= min && value <= max;
};

// Validate agent name
export const isValidAgentName = (name: string): boolean => {
  // Alphanumeric, spaces, hyphens, underscores, 3-50 chars
  const nameRegex = /^[a-zA-Z0-9\s\-_]{3,50}$/;
  return nameRegex.test(name);
};

// Validate incident severity
export const isValidSeverity = (severity: string): severity is 'low' | 'medium' | 'high' | 'critical' => {
  return ['low', 'medium', 'high', 'critical'].includes(severity);
};

// Validate role
export const isValidRole = (role: string): role is 'super_admin' | 'admin' | 'manager' | 'viewer' => {
  return ['super_admin', 'admin', 'manager', 'viewer'].includes(role);
};

// Rate limiting helper
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 10) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];

    // Remove old timestamps outside the window
    const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);

    if (validTimestamps.length >= this.maxRequests) {
      this.requests.set(key, validTimestamps);
      return false;
    }

    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);
    return true;
  }

  pruneStaleKeys(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.requests.entries()) {
      if (!timestamps.some(ts => now - ts < this.windowMs)) {
        this.requests.delete(key);
      }
    }
  }

  reset(key: string): void {
    this.requests.delete(key);
  }

  getRemainingRequests(key: string): number {
    const timestamps = this.requests.get(key) || [];
    const now = Date.now();
    const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);
    return Math.max(0, this.maxRequests - validTimestamps.length);
  }
}

// Create default rate limiter instances
export const webhookRateLimiter = new RateLimiter(60000, 5); // 5 webhooks per minute
export const apiRateLimiter = new RateLimiter(60000, 60); // 60 API calls per minute

// Prune stale keys every 10 minutes to prevent unbounded Map growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    webhookRateLimiter.pruneStaleKeys();
    apiRateLimiter.pruneStaleKeys();
  }, 10 * 60 * 1000);
}
