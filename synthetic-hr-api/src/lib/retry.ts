/**
 * Retry utility with exponential backoff and jitter
 * Ensures reliable delivery of critical operations like webhooks and alerts
 */

import { logger } from './logger';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitterFactor?: number; // 0-1, adds randomness to prevent thundering herd
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  multiplier: number,
  jitterFactor: number
): number {
  const exponentialDelay = initialDelay * Math.pow(multiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelay);
  const jitter = cappedDelay * jitterFactor * (Math.random() - 0.5) * 2;
  return Math.max(0, cappedDelay + jitter);
}

/**
 * Retry an async operation with exponential backoff
 * @param operation - The async function to retry
 * @param options - Retry configuration
 * @param context - Optional context for logging
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
  context?: Record<string, any>
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      const data = await operation();
      
      if (attempt > 0) {
        logger.info('Operation succeeded after retry', {
          ...context,
          attempt: attempt + 1,
          totalAttempts: opts.maxAttempts,
          totalDelayMs,
        });
      }

      return {
        success: true,
        data,
        attempts: attempt + 1,
        totalDelayMs,
      };
    } catch (error) {
      lastError = error as Error;
      
      const isLastAttempt = attempt === opts.maxAttempts - 1;
      
      if (isLastAttempt) {
        logger.error('Operation failed after all retry attempts', {
          ...context,
          error: lastError.message,
          totalAttempts: opts.maxAttempts,
          totalDelayMs,
        });
        break;
      }

      const delayMs = calculateDelay(
        attempt,
        opts.initialDelayMs,
        opts.maxDelayMs,
        opts.backoffMultiplier,
        opts.jitterFactor
      );

      logger.warn('Operation failed, retrying...', {
        ...context,
        error: lastError.message,
        attempt: attempt + 1,
        maxAttempts: opts.maxAttempts,
        nextRetryInMs: delayMs,
      });

      totalDelayMs += delayMs;
      await sleep(delayMs);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: opts.maxAttempts,
    totalDelayMs,
  };
}

/**
 * Retry an operation with custom condition checking
 * Useful for operations that don't throw errors but return error states
 */
export async function retryUntil<T>(
  operation: () => Promise<T>,
  isSuccess: (result: T) => boolean,
  options: RetryOptions = {},
  context?: Record<string, any>
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastResult: T | undefined;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      lastResult = await operation();
      
      if (isSuccess(lastResult)) {
        if (attempt > 0) {
          logger.info('Operation succeeded after retry', {
            ...context,
            attempt: attempt + 1,
            totalAttempts: opts.maxAttempts,
            totalDelayMs,
          });
        }

        return {
          success: true,
          data: lastResult,
          attempts: attempt + 1,
          totalDelayMs,
        };
      }

      const isLastAttempt = attempt === opts.maxAttempts - 1;
      
      if (isLastAttempt) {
        logger.error('Operation failed condition check after all attempts', {
          ...context,
          totalAttempts: opts.maxAttempts,
          totalDelayMs,
        });
        break;
      }

      const delayMs = calculateDelay(
        attempt,
        opts.initialDelayMs,
        opts.maxDelayMs,
        opts.backoffMultiplier,
        opts.jitterFactor
      );

      logger.warn('Operation failed condition check, retrying...', {
        ...context,
        attempt: attempt + 1,
        maxAttempts: opts.maxAttempts,
        nextRetryInMs: delayMs,
      });

      totalDelayMs += delayMs;
      await sleep(delayMs);
    } catch (error) {
      logger.error('Operation threw error during retry', {
        ...context,
        error: (error as Error).message,
        attempt: attempt + 1,
      });
      
      return {
        success: false,
        error: error as Error,
        attempts: attempt + 1,
        totalDelayMs,
      };
    }
  }

  return {
    success: false,
    error: new Error('Operation failed condition check after all attempts'),
    data: lastResult,
    attempts: opts.maxAttempts,
    totalDelayMs,
  };
}

/**
 * Create an idempotency key for deduplication
 * Format: {prefix}:{organizationId}:{incidentId}:{timestamp}
 */
export function generateIdempotencyKey(
  prefix: string,
  organizationId: string,
  incidentId: string
): string {
  const timestamp = Date.now();
  return `${prefix}:${organizationId}:${incidentId}:${timestamp}`;
}

/**
 * Check if an operation should be retried based on error type
 */
export function isRetryableError(error: any): boolean {
  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  // HTTP status codes that are retryable
  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  if (error.response && retryableStatusCodes.includes(error.response.status)) {
    return true;
  }

  return false;
}
