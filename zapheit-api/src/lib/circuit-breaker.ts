// ---------------------------------------------------------------------------
// Circuit Breaker
//
// Prevents agents from hammering external apps that are down.
// State machine per (org, connector):
//   closed   → healthy, calls allowed
//   open     → tripped after N failures, calls fast-fail for HALF_OPEN_AFTER_MS
//   half_open → probe state: one call allowed; on success → closed, on failure → open
//
// State is held in-memory for speed and synced to connector_circuit_breakers
// in Supabase so state survives restarts.
// ---------------------------------------------------------------------------

import { supabaseRest, eq } from './supabase-rest';
import { logger } from './logger';

export type CircuitState = 'closed' | 'open' | 'half_open';

const CIRCUIT_OPEN_AFTER = 3;           // consecutive failures before tripping
const HALF_OPEN_AFTER_MS = 60_000;      // 1 minute before allowing a probe

type BreakerEntry = {
  state: CircuitState;
  failureCount: number;
  openedAt: number | null;
  lastSync: number;
};

const cache = new Map<string, BreakerEntry>();

function cacheKey(orgId: string, connectorId: string): string {
  return `${orgId}:${connectorId}`;
}

function now(): number {
  return Date.now();
}

async function syncToDb(orgId: string, connectorId: string, entry: BreakerEntry): Promise<void> {
  try {
    await supabaseRest('connector_circuit_breakers', '', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: {
        organization_id: orgId,
        connector_id: connectorId,
        state: entry.state,
        failure_count: entry.failureCount,
        last_failure_at: entry.state !== 'closed' && entry.openedAt
          ? new Date(entry.openedAt).toISOString()
          : null,
        opened_at: entry.openedAt ? new Date(entry.openedAt).toISOString() : null,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    logger.warn('[circuit-breaker] DB sync failed', { orgId, connectorId, error: err?.message });
  }
}

async function loadFromDb(orgId: string, connectorId: string): Promise<BreakerEntry | null> {
  try {
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('connector_id', eq(connectorId));
    q.set('limit', '1');
    const rows = (await supabaseRest('connector_circuit_breakers', q)) as any[];
    const row = rows?.[0];
    if (!row) return null;
    return {
      state: row.state as CircuitState,
      failureCount: row.failure_count ?? 0,
      openedAt: row.opened_at ? new Date(row.opened_at).getTime() : null,
      lastSync: now(),
    };
  } catch {
    return null;
  }
}

async function getEntry(orgId: string, connectorId: string): Promise<BreakerEntry> {
  const key = cacheKey(orgId, connectorId);
  let entry = cache.get(key);
  if (!entry) {
    const fromDb = await loadFromDb(orgId, connectorId);
    entry = fromDb ?? { state: 'closed', failureCount: 0, openedAt: null, lastSync: now() };
    cache.set(key, entry);
  }
  return entry;
}

/**
 * Check whether a connector call is allowed.
 * Returns the current circuit state. Callers should refuse to execute if 'open'.
 * When 'half_open', the caller should treat the probe as a single allowed attempt.
 */
export async function checkCircuitBreaker(
  orgId: string,
  connectorId: string,
): Promise<CircuitState> {
  const entry = await getEntry(orgId, connectorId);

  if (entry.state === 'open') {
    // Transition to half_open after the cool-down period
    if (entry.openedAt && now() - entry.openedAt >= HALF_OPEN_AFTER_MS) {
      entry.state = 'half_open';
      cache.set(cacheKey(orgId, connectorId), entry);
      void syncToDb(orgId, connectorId, entry);
      return 'half_open';
    }
    return 'open';
  }

  return entry.state;
}

/**
 * Record a successful connector call. Resets the circuit to closed.
 */
export async function recordSuccess(orgId: string, connectorId: string): Promise<void> {
  const key = cacheKey(orgId, connectorId);
  const entry = cache.get(key) ?? { state: 'closed' as CircuitState, failureCount: 0, openedAt: null, lastSync: now() };
  if (entry.state === 'closed' && entry.failureCount === 0) return; // already healthy, skip DB write
  entry.state = 'closed';
  entry.failureCount = 0;
  entry.openedAt = null;
  cache.set(key, entry);
  void syncToDb(orgId, connectorId, entry);
}

/**
 * Record a failed connector call. Increments failure count and trips the circuit
 * to 'open' once CIRCUIT_OPEN_AFTER threshold is reached.
 */
export async function recordFailure(orgId: string, connectorId: string): Promise<void> {
  const key = cacheKey(orgId, connectorId);
  const entry = await getEntry(orgId, connectorId);
  entry.failureCount += 1;
  if (entry.state === 'half_open' || entry.failureCount >= CIRCUIT_OPEN_AFTER) {
    entry.state = 'open';
    entry.openedAt = now();
    logger.warn('[circuit-breaker] Circuit tripped to OPEN', { orgId, connectorId, failureCount: entry.failureCount });
  }
  cache.set(key, entry);
  void syncToDb(orgId, connectorId, entry);
}
