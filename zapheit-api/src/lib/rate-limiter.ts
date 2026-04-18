/**
 * rate-limiter.ts
 *
 * Distributed-safe rate limiting for per-agent RPM/RPD enforcement.
 *
 * Strategy:
 *   - If REDIS_URL is set: use Redis INCR + EXPIRE (atomic, multi-pod safe)
 *   - Otherwise: fall back to module-level in-memory Map (safe for single-pod)
 *
 * This lets the codebase work correctly today (single Helm replica, single
 * Docker Compose container) and upgrade to distributed enforcement by simply
 * setting REDIS_URL in the environment — no code change required.
 */

import { logger } from './logger';

// ── Redis client (lazy, optional) ────────────────────────────────────────────

let redisClient: any = null;
let redisAvailable = false;

async function getRedis(): Promise<any> {
  if (redisClient) return redisClient;

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

    client.on('error', (err: Error) => {
      if (redisAvailable) {
        logger.warn('rate-limiter: Redis connection lost — falling back to in-memory', { err: err.message });
      }
      redisAvailable = false;
    });

    client.on('connect', () => {
      redisAvailable = true;
      logger.info('rate-limiter: Redis connected — distributed rate limiting active');
    });

    await client.connect();
    redisClient = client;
    return redisClient;
  } catch (err: any) {
    logger.warn('rate-limiter: Redis unavailable — using in-memory fallback', { err: err?.message });
    return null;
  }
}

// Warm up on startup if REDIS_URL is present
if (process.env.REDIS_URL) {
  getRedis().catch(() => null);
}

// ── In-memory fallback ────────────────────────────────────────────────────────

interface InMemCounter { rpm: number; rpmReset: number; rpd: number; rpdReset: number }
const inMemCounters = new Map<string, InMemCounter>();

function inMemCheck(agentId: string, limitRpm: number, limitRpd: number): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const counter = inMemCounters.get(agentId) || { rpm: 0, rpmReset: now + 60_000, rpd: 0, rpdReset: now + 86_400_000 };

  if (now >= counter.rpmReset) { counter.rpm = 0; counter.rpmReset = now + 60_000; }
  if (now >= counter.rpdReset) { counter.rpd = 0; counter.rpdReset = now + 86_400_000; }

  if (limitRpm > 0 && counter.rpm >= limitRpm) return { allowed: false, retryAfter: Math.ceil((counter.rpmReset - now) / 1000) };
  if (limitRpd > 0 && counter.rpd >= limitRpd) return { allowed: false, retryAfter: Math.ceil((counter.rpdReset - now) / 1000) };

  counter.rpm += 1;
  counter.rpd += 1;
  inMemCounters.set(agentId, counter);
  return { allowed: true };
}

// ── Redis-backed check ────────────────────────────────────────────────────────

async function redisCheck(
  redis: any,
  agentId: string,
  limitRpm: number,
  limitRpd: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  try {
    const pipeline = redis.pipeline();
    const rpmKey = `rl:rpm:${agentId}`;
    const rpdKey = `rl:rpd:${agentId}`;

    if (limitRpm > 0) {
      pipeline.incr(rpmKey);
      pipeline.expire(rpmKey, 60, 'NX'); // only set TTL on first creation
    }
    if (limitRpd > 0) {
      pipeline.incr(rpdKey);
      pipeline.expire(rpdKey, 86400, 'NX');
    }

    const results: any[] = await pipeline.exec();

    let idx = 0;
    if (limitRpm > 0) {
      const rpmCount = results[idx]?.[1] as number;
      idx += 2; // incr + expire
      if (rpmCount > limitRpm) {
        const ttl: number = await redis.ttl(rpmKey);
        return { allowed: false, retryAfter: Math.max(ttl, 1) };
      }
    }
    if (limitRpd > 0) {
      const rpdCount = results[idx]?.[1] as number;
      if (rpdCount > limitRpd) {
        const ttl: number = await redis.ttl(rpdKey);
        return { allowed: false, retryAfter: Math.max(ttl, 1) };
      }
    }

    return { allowed: true };
  } catch (err: any) {
    // Redis error mid-request — fail open (don't block legitimate traffic)
    logger.warn('rate-limiter: Redis check failed — failing open', { agentId, err: err?.message });
    return { allowed: true };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check and increment rate limit counters for an agent.
 * Uses Redis when available (distributed), in-memory when not (single-pod).
 */
export async function checkAgentRateLimitDistributed(
  agentId: string,
  config: Record<string, any>
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const limitRpm = Number(config?.rate_limit_rpm) || 0;
  const limitRpd = Number(config?.rate_limit_rpd) || 0;
  if (!limitRpm && !limitRpd) return { allowed: true };

  const redis = await getRedis();
  if (redis && redisAvailable) {
    return redisCheck(redis, agentId, limitRpm, limitRpd);
  }

  return inMemCheck(agentId, limitRpm, limitRpd);
}

/** Returns true if Redis is connected and being used. Useful for health checks. */
export function isRedisConnected(): boolean {
  return redisAvailable;
}
