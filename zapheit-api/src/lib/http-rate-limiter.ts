/**
 * http-rate-limiter.ts
 *
 * Factory for creating express-rate-limit instances that are distributed-safe
 * when REDIS_URL is set, and fall back to in-memory for single-pod deploys.
 *
 * Uses ioredis (already installed) to implement the express-rate-limit Store
 * interface without an additional dependency.
 *
 * Usage:
 *   const limiter = buildRateLimiter({ windowMs: 15 * 60 * 1000, max: 1000 });
 *   app.use('/api', limiter);
 */

import rateLimit, { Options, Store, IncrementResponse } from 'express-rate-limit';
import { logger } from './logger';

// ── Redis store implementation ────────────────────────────────────────────────

class RedisStore implements Store {
  prefix: string;
  private windowMs: number;
  private redis: any;

  constructor(redis: any, windowMs: number, prefix = 'rl:http:') {
    this.redis = redis;
    this.windowMs = windowMs;
    this.prefix = prefix;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const redisKey = `${this.prefix}${key}`;
    const windowSecs = Math.ceil(this.windowMs / 1000);

    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(redisKey);
      pipeline.pttl(redisKey);
      const [[, count], [, pttl]] = await pipeline.exec();

      // Set TTL only on first creation (NX = only if not exists)
      if (pttl === -1) {
        await this.redis.pexpire(redisKey, this.windowMs);
      }

      const resetTimeMs = pttl > 0 ? Date.now() + pttl : Date.now() + this.windowMs;

      return {
        totalHits: count as number,
        resetTime: new Date(resetTimeMs),
      };
    } catch (err: any) {
      logger.warn('http-rate-limiter: Redis increment failed', { key, err: err?.message });
      // Return a permissive response on Redis failure to avoid blocking traffic
      return { totalHits: 0, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.redis.decr(`${this.prefix}${key}`);
    } catch {
      // ignore
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.redis.del(`${this.prefix}${key}`);
    } catch {
      // ignore
    }
  }
}

// ── Lazy Redis client ─────────────────────────────────────────────────────────

let sharedRedis: any = null;
let redisReady = false;

async function getSharedRedis(): Promise<any> {
  if (sharedRedis) return sharedRedis;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    client.on('connect', () => {
      redisReady = true;
      logger.info('http-rate-limiter: Redis connected — distributed HTTP rate limiting active');
    });

    client.on('error', (err: Error) => {
      if (redisReady) {
        logger.warn('http-rate-limiter: Redis connection lost — falling back to in-memory', { err: err.message });
      }
      redisReady = false;
    });

    await client.connect();
    sharedRedis = client;
    return sharedRedis;
  } catch (err: any) {
    logger.warn('http-rate-limiter: Redis unavailable — using in-memory fallback', { err: err?.message });
    return null;
  }
}

// Warm up immediately if REDIS_URL is present
if (process.env.REDIS_URL) {
  getSharedRedis().catch(() => null);
}

// ── Public factory ────────────────────────────────────────────────────────────

type BuildOptions = Omit<Partial<Options>, 'store'> & {
  windowMs: number;
  max: number;
  /** Prefix to namespace Redis keys (useful when sharing a Redis instance). */
  keyPrefix?: string;
};

/**
 * Build a rate-limiter middleware.
 *
 * When REDIS_URL is configured and Redis is reachable, uses a Redis-backed
 * store for distributed enforcement across multiple pods.
 * Falls back to express-rate-limit's default in-memory store otherwise.
 */
export function buildRateLimiter(opts: BuildOptions): ReturnType<typeof rateLimit> {
  const { keyPrefix, windowMs, max, ...rest } = opts;

  if (process.env.REDIS_URL && redisReady && sharedRedis) {
    return rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore(sharedRedis, windowMs, keyPrefix ?? 'rl:http:'),
      ...rest,
    });
  }

  // In-memory fallback — same behaviour as before, safe for single-pod
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...rest,
  });
}

/**
 * Re-initialise rate limiters once Redis connects.
 * Call this from the app after server start if you need limiters to upgrade
 * to Redis dynamically (optional — limiters built at startup still work).
 */
export async function warmUpHttpRateLimiter(): Promise<void> {
  await getSharedRedis();
}

export { redisReady as isHttpRateLimiterRedisActive };
