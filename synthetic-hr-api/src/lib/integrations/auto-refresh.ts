import { SupabaseRestError, eq, in_, supabaseRest } from '../supabase-rest';
import { decryptSecret, encryptSecret } from './encryption';
import { getAdapter } from './adapters';
import { logger } from '../logger';

type IntegrationRow = {
  id: string;
  service_type: string;
  auth_type: string;
  status: string;
};

type CredentialRow = {
  id: string;
  integration_id: string;
  key: string;
  value: string;
  is_sensitive: boolean;
  expires_at: string | null;
};

async function safeQuery<T>(table: string, query: URLSearchParams): Promise<T[]> {
  try {
    return (await supabaseRest(table, query)) as T[];
  } catch (err: any) {
    if (err instanceof SupabaseRestError) {
      logger.warn('Integration auto-refresh supabase query failed', { table, status: err.status });
      return [];
    }
    logger.warn('Integration auto-refresh query failed', { table, error: err?.message || String(err) });
    return [];
  }
}

async function writeConnectionLog(integrationId: string, action: string, status: 'success' | 'failed', message?: string, metadata?: Record<string, any>) {
  try {
    await supabaseRest('integration_connection_logs', '', {
      method: 'POST',
      body: {
        integration_id: integrationId,
        action,
        status,
        message: message || null,
        metadata: metadata || {},
        created_at: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    logger.warn('Integration auto-refresh log write failed', { integrationId, action, error: err?.message || String(err) });
  }
}

async function upsertCredential(integrationId: string, key: string, value: string, isSensitive = true, expiresAt?: string | null) {
  const query = new URLSearchParams();
  query.set('integration_id', eq(integrationId));
  query.set('key', eq(key));
  query.set('select', '*');
  const existing = await safeQuery<CredentialRow>('integration_credentials', query);
  const now = new Date().toISOString();

  const payload = {
    integration_id: integrationId,
    key,
    value,
    is_sensitive: isSensitive,
    expires_at: expiresAt || null,
    updated_at: now,
  };

  if (existing.length > 0) {
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(existing[0].id));
    await supabaseRest('integration_credentials', patchQuery, { method: 'PATCH', body: payload });
    return;
  }

  await supabaseRest('integration_credentials', '', { method: 'POST', body: { ...payload, created_at: now } });
}

function parseExpiresAt(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

let running = false;

export function startIntegrationTokenRefreshScheduler() {
  const enabled = process.env.INTEGRATIONS_AUTO_REFRESH !== 'false';
  if (!enabled) {
    logger.info('Integration token auto-refresh disabled');
    return;
  }

  const intervalMs = Number(process.env.INTEGRATIONS_AUTO_REFRESH_INTERVAL_MS || 5 * 60 * 1000);
  const windowMs = Number(process.env.INTEGRATIONS_AUTO_REFRESH_WINDOW_MS || 10 * 60 * 1000);

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();

      const q = new URLSearchParams();
      q.set('auth_type', eq('oauth2'));
      q.set('status', in_(['connected', 'error', 'expired', 'syncing']));
      q.set('select', 'id,service_type,auth_type,status');
      const integrations = await safeQuery<IntegrationRow>('integrations', q);
      if (integrations.length === 0) return;

      for (const integration of integrations) {
        const adapter = getAdapter(integration.service_type);
        if (!adapter?.refreshToken) continue;

        const credQ = new URLSearchParams();
        credQ.set('integration_id', eq(integration.id));
        credQ.set('key', in_(['access_token', 'refresh_token']));
        credQ.set('select', 'id,integration_id,key,value,is_sensitive,expires_at');
        const rows = await safeQuery<CredentialRow>('integration_credentials', credQ);

        const access = rows.find((r) => r.key === 'access_token');
        const refresh = rows.find((r) => r.key === 'refresh_token');
        const expiresAt = parseExpiresAt(access?.expires_at || null);
        if (!access || !expiresAt) continue; // no expiry means nothing to refresh
        if (expiresAt > now + windowMs) continue;
        if (!refresh) continue;

        const creds: Record<string, string> = {
          access_token: access.is_sensitive ? decryptSecret(access.value) : access.value,
          refresh_token: refresh.is_sensitive ? decryptSecret(refresh.value) : refresh.value,
        };

        try {
          const token = await adapter.refreshToken(creds);
          const expiresIn = Number(token?.expires_in || 0);
          const nextExpiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

          await upsertCredential(integration.id, 'access_token', encryptSecret(String(token.access_token)), true, nextExpiresAt);
          if (token.refresh_token) {
            await upsertCredential(integration.id, 'refresh_token', encryptSecret(String(token.refresh_token)), true, null);
          }

          await writeConnectionLog(integration.id, 'refresh', 'success', 'Token auto-refreshed', {
            service: integration.service_type,
            expiresAt: nextExpiresAt,
          });
        } catch (err: any) {
          await writeConnectionLog(integration.id, 'refresh', 'failed', err?.message || 'Token auto-refresh failed', {
            service: integration.service_type,
          });
        }
      }
    } catch (err: any) {
      logger.warn('Integration token auto-refresh tick failed', { error: err?.message || String(err) });
    } finally {
      running = false;
    }
  };

  // Fire once on boot and then on interval.
  void tick();
  setInterval(() => void tick(), intervalMs);
  logger.info('Integration token auto-refresh scheduler started', { intervalMs, windowMs });
}
