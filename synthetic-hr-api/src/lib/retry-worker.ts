// ---------------------------------------------------------------------------
// Connector Retry Worker
//
// Background interval (every 30 s) that drains the connector_retry_queue.
// When a circuit breaker trips to 'open', the action executor enqueues the
// failed action here. Once the circuit transitions to 'half_open' (after the
// cool-down), this worker re-executes the action and updates the queue entry.
// ---------------------------------------------------------------------------

import { supabaseRest, eq, lte } from './supabase-rest';
import { executeConnectorAction } from './connectors/action-executor';
import { checkCircuitBreaker, recordSuccess, recordFailure } from './circuit-breaker';
import { decryptSecret } from './integrations/encryption';
import { logger } from './logger';

const POLL_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_SECONDS = [60, 300, 900]; // 1 min, 5 min, 15 min

async function fetchDueItems(): Promise<any[]> {
  try {
    // Build this filter manually: PostgREST expects the raw ISO timestamp in the
    // comparator value, and URLSearchParams would re-encode the helper output.
    const q = `status=${eq('pending')}&next_attempt_at=${lte(new Date().toISOString())}&order=next_attempt_at.asc&limit=20`;
    return ((await supabaseRest('connector_retry_queue', q)) as any[]) ?? [];
  } catch (err: any) {
    logger.warn('[retry-worker] Failed to fetch due items', { error: err?.message });
    return [];
  }
}

async function fetchCredentials(orgId: string, credentialsRef: string | null): Promise<Record<string, string>> {
  if (!credentialsRef) return {};
  try {
    const q = new URLSearchParams();
    q.set('integration_id', eq(credentialsRef));
    const rows = (await supabaseRest('integration_credentials', q)) as Array<{ key: string; value: string }>;
    const creds: Record<string, string> = {};
    for (const row of rows ?? []) {
      try { creds[row.key] = decryptSecret(row.value); } catch { creds[row.key] = row.value; }
    }
    return creds;
  } catch (err: any) {
    logger.warn('[retry-worker] Failed to fetch credentials', { orgId, credentialsRef, error: err?.message });
    return {};
  }
}

async function updateItem(id: string, patch: Record<string, any>): Promise<void> {
  try {
    await supabaseRest('connector_retry_queue', `id=eq.${id}`, {
      method: 'PATCH',
      body: { ...patch, updated_at: new Date().toISOString() },
    });
  } catch (err: any) {
    logger.warn('[retry-worker] Failed to update queue item', { id, error: err?.message });
  }
}

async function processItem(item: any): Promise<void> {
  const { id, organization_id: orgId, connector_id: connectorId, action, params, credentials_ref, attempt_count } = item;

  const circuitState = await checkCircuitBreaker(orgId, connectorId);
  if (circuitState === 'open') {
    // Not ready yet — leave for next poll cycle
    return;
  }

  const newAttemptCount = (attempt_count ?? 0) + 1;
  const credentials = await fetchCredentials(orgId, credentials_ref);

  let result;
  try {
    result = await executeConnectorAction(connectorId, action, params ?? {}, credentials, orgId);
  } catch (err: any) {
    result = { success: false, error: err?.message || 'Unknown error' };
  }

  if (result.success) {
    await recordSuccess(orgId, connectorId);
    await updateItem(id, { status: 'succeeded', attempt_count: newAttemptCount, last_error: null });
    logger.info('[retry-worker] Retry succeeded', { id, orgId, connectorId, action, attempts: newAttemptCount });
  } else {
    await recordFailure(orgId, connectorId);
    if (newAttemptCount >= MAX_ATTEMPTS) {
      await updateItem(id, { status: 'abandoned', attempt_count: newAttemptCount, last_error: result.error });
      logger.warn('[retry-worker] Retry abandoned after max attempts', { id, orgId, connectorId, action });
    } else {
      const backoffSecs = RETRY_BACKOFF_SECONDS[newAttemptCount - 1] ?? 900;
      const nextAttempt = new Date(Date.now() + backoffSecs * 1000).toISOString();
      await updateItem(id, {
        status: 'pending',
        attempt_count: newAttemptCount,
        last_error: result.error,
        next_attempt_at: nextAttempt,
      });
      logger.info('[retry-worker] Retry failed, scheduled next attempt', {
        id, orgId, connectorId, action, backoffSecs, nextAttempt,
      });
    }
  }
}

async function runOnce(): Promise<void> {
  const items = await fetchDueItems();
  if (items.length === 0) return;
  logger.info('[retry-worker] Processing retry queue', { count: items.length });
  await Promise.allSettled(items.map(processItem));
}

export function startRetryWorker(): void {
  logger.info('[retry-worker] Started', { intervalMs: POLL_INTERVAL_MS });
  setInterval(() => {
    void runOnce().catch((err: any) => {
      logger.error('[retry-worker] Unhandled error in run cycle', { error: err?.message });
    });
  }, POLL_INTERVAL_MS);
}

/**
 * Enqueue a connector action for later retry (called by action-executor when circuit is open).
 */
export async function enqueueRetry(
  orgId: string,
  connectorId: string,
  action: string,
  params: Record<string, any>,
  agentId: string | null | undefined,
  credentialsRef: string | null | undefined,
): Promise<void> {
  try {
    await supabaseRest('connector_retry_queue', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        connector_id: connectorId,
        action,
        params,
        credentials_ref: credentialsRef ?? null,
        ...(agentId ? { agent_id: agentId } : {}),
        max_attempts: MAX_ATTEMPTS,
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(), // retry after 1 minute
        status: 'pending',
      },
    });
  } catch (err: any) {
    logger.warn('[retry-worker] Failed to enqueue retry item', { orgId, connectorId, action, error: err?.message });
  }
}
