/**
 * Cache Layer with TTL
 * Demotes localStorage to cache-only with backend as source of truth
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  version: number;
}

export interface CacheMetadata {
  key: string;
  lastSync: number | null;
  isStale: boolean;
  isSyncing: boolean;
  hasConflict: boolean;
}

// Default TTL: 5 minutes
const DEFAULT_TTL_MS = 5 * 60 * 1000;

// Cache metadata tracking
const cacheMetadata = new Map<string, CacheMetadata>();

/**
 * Get data from cache with TTL check
 */
export function getCached<T>(key: string): { data: T | null; isStale: boolean; metadata: CacheMetadata } {
  try {
    if (typeof window === 'undefined') {
      return { data: null, isStale: true, metadata: getMetadata(key) };
    }

    const stored = localStorage.getItem(key);
    if (!stored) {
      return { data: null, isStale: true, metadata: getMetadata(key) };
    }

    const entry: CacheEntry<T> = JSON.parse(stored);
    const now = Date.now();
    const isStale = now > entry.expiresAt;

    const metadata = getMetadata(key);
    metadata.isStale = isStale;
    metadata.lastSync = entry.timestamp;
    cacheMetadata.set(key, metadata);

    return { data: entry.data, isStale, metadata };
  } catch (error) {
    console.error(`Failed to get cached data (${key}):`, error);
    return { data: null, isStale: true, metadata: getMetadata(key) };
  }
}

/**
 * Set data in cache with TTL
 */
export function setCached<T>(
  key: string,
  data: T,
  ttlMs: number = DEFAULT_TTL_MS,
  version: number = 1
): void {
  try {
    if (typeof window === 'undefined') {
      return;
    }

    const now = Date.now();
    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      expiresAt: now + ttlMs,
      version,
    };

    localStorage.setItem(key, JSON.stringify(entry));

    const metadata = getMetadata(key);
    metadata.lastSync = now;
    metadata.isStale = false;
    cacheMetadata.set(key, metadata);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      // Clear old cache entries
      clearStaleCache();
      // Retry once
      try {
        localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now(), expiresAt: Date.now() + ttlMs, version }));
      } catch (retryError) {
        console.error('Cache quota exceeded after cleanup:', retryError);
      }
    } else {
      console.error(`Failed to set cached data (${key}):`, error);
    }
  }
}

/**
 * Invalidate cache entry (mark as stale)
 */
export function invalidateCache(key: string): void {
  const metadata = getMetadata(key);
  metadata.isStale = true;
  cacheMetadata.set(key, metadata);
}

/**
 * Clear a specific cache entry
 */
export function clearCache(key: string): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(key);
    }
    cacheMetadata.delete(key);
  } catch (error) {
    console.error(`Failed to clear cache (${key}):`, error);
  }
}

/**
 * Clear all stale cache entries
 */
export function clearStaleCache(): void {
  try {
    if (typeof window === 'undefined') {
      return;
    }

    const now = Date.now();
    const keysToRemove: string[] = [];

    // Find expired entries
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('synthetic_hr_')) continue;

      try {
        const stored = localStorage.getItem(key);
        if (!stored) continue;

        const entry = JSON.parse(stored);
        if (entry.expiresAt && now > entry.expiresAt) {
          keysToRemove.push(key);
        }
      } catch {
        // Invalid format, mark for removal
        keysToRemove.push(key);
      }
    }

    // Remove expired entries
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    console.error('Failed to clear stale cache:', error);
  }
}

/**
 * Mark cache as syncing
 */
export function setSyncing(key: string, syncing: boolean): void {
  const metadata = getMetadata(key);
  metadata.isSyncing = syncing;
  cacheMetadata.set(key, metadata);
}

/**
 * Mark cache as having conflict
 */
export function setConflict(key: string, hasConflict: boolean): void {
  const metadata = getMetadata(key);
  metadata.hasConflict = hasConflict;
  cacheMetadata.set(key, metadata);
}

/**
 * Get cache metadata
 */
export function getMetadata(key: string): CacheMetadata {
  if (!cacheMetadata.has(key)) {
    cacheMetadata.set(key, {
      key,
      lastSync: null,
      isStale: true,
      isSyncing: false,
      hasConflict: false,
    });
  }
  return cacheMetadata.get(key)!;
}

/**
 * Get all cache metadata
 */
export function getAllMetadata(): CacheMetadata[] {
  return Array.from(cacheMetadata.values());
}

/**
 * Conflict resolution strategy
 */
export enum ConflictStrategy {
  SERVER_WINS = 'server_wins', // Always use server version
  CLIENT_WINS = 'client_wins', // Always use client version
  NEWEST_WINS = 'newest_wins', // Use version with latest timestamp
  MERGE = 'merge', // Attempt to merge changes
}

/**
 * Resolve conflict between cached and server data
 */
export function resolveConflict<T>(
  cachedData: T & { updated_at?: string },
  serverData: T & { updated_at?: string },
  strategy: ConflictStrategy = ConflictStrategy.SERVER_WINS
): T {
  switch (strategy) {
    case ConflictStrategy.SERVER_WINS:
      return serverData;

    case ConflictStrategy.CLIENT_WINS:
      return cachedData;

    case ConflictStrategy.NEWEST_WINS:
      if (cachedData.updated_at && serverData.updated_at) {
        return new Date(cachedData.updated_at) > new Date(serverData.updated_at)
          ? cachedData
          : serverData;
      }
      return serverData;

    case ConflictStrategy.MERGE:
      // Simple merge: spread server data, then cached data
      // More sophisticated merge logic could be implemented per data type
      return { ...serverData, ...cachedData };

    default:
      return serverData;
  }
}

/**
 * Sync cache with server data
 */
export async function syncWithServer<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
  conflictStrategy: ConflictStrategy = ConflictStrategy.SERVER_WINS
): Promise<T> {
  setSyncing(key, true);

  try {
    const { data: cachedData } = getCached<T>(key);
    const serverData = await fetchFn();

    // Check for conflicts if we have cached data
    if (cachedData) {
      const hasConflict = JSON.stringify(cachedData) !== JSON.stringify(serverData);
      setConflict(key, hasConflict);

      if (hasConflict) {
        const resolved = resolveConflict(
          cachedData as any,
          serverData as any,
          conflictStrategy
        );
        setCached(key, resolved, ttlMs);
        return resolved;
      }
    }

    // No conflict or no cached data - use server data
    setCached(key, serverData, ttlMs);
    setConflict(key, false);
    return serverData;
  } finally {
    setSyncing(key, false);
  }
}

/**
 * Cache-aware data loader
 * Returns cached data immediately, then syncs with server in background
 */
export async function loadWithCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
  options: {
    ttlMs?: number;
    conflictStrategy?: ConflictStrategy;
    skipCache?: boolean;
  } = {}
): Promise<{ data: T; fromCache: boolean; metadata: CacheMetadata }> {
  const { ttlMs = DEFAULT_TTL_MS, conflictStrategy = ConflictStrategy.SERVER_WINS, skipCache = false } = options;

  if (skipCache) {
    const data = await syncWithServer(key, fetchFn, ttlMs, conflictStrategy);
    return { data, fromCache: false, metadata: getMetadata(key) };
  }

  // Try cache first
  const { data: cachedData, isStale, metadata } = getCached<T>(key);

  if (cachedData && !isStale) {
    // Cache hit and fresh - return immediately, optionally sync in background
    syncWithServer(key, fetchFn, ttlMs, conflictStrategy).catch((err) => {
      console.error('Background sync failed:', err);
    });

    return { data: cachedData, fromCache: true, metadata };
  }

  // Cache miss or stale - fetch from server
  const data = await syncWithServer(key, fetchFn, ttlMs, conflictStrategy);
  return { data, fromCache: false, metadata };
}
