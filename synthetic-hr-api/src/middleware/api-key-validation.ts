import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { supabaseRest, eq } from '../lib/supabase-rest';
import { recordApiKeyUsage } from '../lib/api-key-usage';
import { logger } from '../lib/logger';

declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: string;
        organization_id: string;
        name: string;
        permissions: string[];
        rate_limit: number;
      };
    }
  }
}

const API_KEY_CACHE = new Map<string, {
  hash: string;
  id: string;
  orgId: string;
  name: string;
  permissions: string[];
  rateLimit: number;
  cachedAt: number;
}>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

/**
 * API Key Validation Middleware
 * Supports: Authorization: Bearer sk_...
 * Or query param: ?api_key=sk_...
 */
export const validateApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Skip if already authenticated via JWT
    if (req.user) {
      return next();
    }

    // Extract API key from Authorization header or query param
    const authHeader = req.headers.authorization;
    let apiKeyPlaintext: string | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      apiKeyPlaintext = authHeader.substring(7);
    } else if (req.query.api_key && process.env.NODE_ENV !== 'production') {
      apiKeyPlaintext = req.query.api_key as string;
    }

    if (!apiKeyPlaintext) {
      return res.status(401).json({ success: false, error: 'Missing API key' });
    }

    // Only accept properly formatted keys
    if (!apiKeyPlaintext.startsWith('sk_') || apiKeyPlaintext.length < 50) {
      return res.status(401).json({ success: false, error: 'Invalid API key format' });
    }

    // Hash the provided key — used as the cache key so the raw key is not held in memory
    const providedHash = crypto.createHash('sha256').update(apiKeyPlaintext).digest('hex');

    // Check cache by hash. Finding an entry by its hash key already proves the hash matches —
    // no secondary comparison needed.
    const cached = API_KEY_CACHE.get(providedHash);
    if (cached) {
      if ((Date.now() - cached.cachedAt) < CACHE_TTL) {
        req.apiKey = {
          id: cached.id,
          organization_id: cached.orgId,
          name: cached.name,
          permissions: cached.permissions,
          rate_limit: cached.rateLimit,
        };

        const usedAt = new Date().toISOString();
        let usageRecorded = false;
        const finalizeUsage = () => {
          if (usageRecorded) return;
          usageRecorded = true;
          void supabaseRest('api_keys', `id=${eq(cached.id)}`, {
            method: 'PATCH',
            body: { last_used: usedAt },
          }).catch((err: any) => {
            logger.error('Failed to update cached key last_used', { error: err.message });
          });
          void recordApiKeyUsage({
            orgId: cached.orgId,
            apiKeyId: cached.id,
            statusCode: res.statusCode,
            usedAt,
          }).catch((err: any) => {
            logger.error('Failed to record cached API key usage', { error: err.message, key_id: cached.id });
          });
        };

        res.on('finish', finalizeUsage);
        res.on('close', finalizeUsage);
        return next();
      } else {
        API_KEY_CACHE.delete(providedHash);
      }
    }

    // Query database for matching key
    const query = new URLSearchParams();
    query.set('key_hash', eq(providedHash));
    query.set('status', eq('active'));

    const keys = (await supabaseRest('api_keys', query)) as any[];

    if (!keys || keys.length === 0) {
      logger.warn('Invalid API key attempt', { key_prefix: apiKeyPlaintext.substring(0, 20) });
      return res.status(401).json({ success: false, error: 'Invalid API key' });
    }

    const apiKey = keys[0];

    // Check expiration
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      logger.warn('Expired API key attempted', { key_id: apiKey.id });
      return res.status(401).json({ success: false, error: 'API key expired' });
    }

    const metadata = (apiKey.metadata || {}) as Record<string, any>;
    const permissions = Array.isArray(metadata.permissions) ? metadata.permissions : [];
    const rateLimit = apiKey.rate_limit_per_minute || apiKey.rate_limit || 1000;

    // Cache by hash so the raw key is not stored in memory
    API_KEY_CACHE.set(providedHash, {
      hash: providedHash,
      id: apiKey.id,
      orgId: apiKey.organization_id,
      name: apiKey.name,
      permissions,
      rateLimit,
      cachedAt: Date.now(),
    });

    // Set on request for downstream middleware
    req.apiKey = {
      id: apiKey.id,
      organization_id: apiKey.organization_id,
      name: apiKey.name,
      permissions,
      rate_limit: rateLimit,
    };

    const usedAt = new Date().toISOString();
    let usageRecorded = false;
    const finalizeUsage = () => {
      if (usageRecorded) return;
      usageRecorded = true;
      void supabaseRest('api_keys', `id=${eq(apiKey.id)}`, {
        method: 'PATCH',
        body: { last_used: usedAt },
      }).catch((err: any) => {
        logger.error('Failed to update last_used', { error: err.message });
      });
      void recordApiKeyUsage({
        orgId: apiKey.organization_id,
        apiKeyId: apiKey.id,
        statusCode: res.statusCode,
        usedAt,
      }).catch((err: any) => {
        logger.error('Failed to record API key usage', { error: err.message, key_id: apiKey.id });
      });
    };

    res.on('finish', finalizeUsage);
    res.on('close', finalizeUsage);

    logger.info('API key validated', { key_id: apiKey.id, org_id: apiKey.organization_id });

    next();
  } catch (error: any) {
    logger.error('API key validation error', { error: error.message });
    res.status(500).json({ success: false, error: 'Key validation failed' });
  }
};

/**
 * Immediately evict a specific key from the cache by its database ID.
 * Call this on revoke and rotate so the old key stops working instantly
 * rather than waiting for the 5-minute TTL to expire.
 */
export const invalidateApiKeyById = (keyId: string): void => {
  for (const [hashKey, entry] of API_KEY_CACHE.entries()) {
    if (entry.id === keyId) {
      API_KEY_CACHE.delete(hashKey);
      logger.info('API key evicted from cache', { key_id: keyId });
      break;
    }
  }
};

/**
 * Cache clear function for testing
 */
export const clearApiKeyCache = () => {
  API_KEY_CACHE.clear();
};
