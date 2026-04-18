/**
 * integration-service.ts
 *
 * Business logic for OAuth token refresh and credential management.
 * Routes pass the user-scoped RestFn instead of the raw request so this
 * module stays testable without Express.
 */

import { getIntegrationSpec } from '../lib/integrations/spec-registry';
import { getAdapter } from '../lib/integrations/adapters';
import { encryptSecret } from '../lib/integrations/encryption';
import { eq } from '../lib/supabase-rest';
import {
  type RestFn,
  type StoredIntegrationRow,
  safeQuery,
  readCredentials,
  upsertCredential,
  writeConnectionLog,
} from '../routes/integrations';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RefreshResult {
  ok: boolean;
  expiresAt?: string | null;
  error?: string;
  status?: 400 | 404 | 500 | 501;
}

// ── refreshOAuthToken ─────────────────────────────────────────────────────────

/**
 * Refresh the OAuth access token for a connected integration.
 * @param orgId   Organization that owns the integration
 * @param service Service key (e.g. 'slack', 'hubspot')
 * @param rest    Supabase RestFn scoped to the requesting user's JWT
 */
export async function refreshOAuthToken(
  orgId: string,
  service: string,
  rest: RestFn,
): Promise<RefreshResult> {
  const spec = getIntegrationSpec(service);
  if (!spec) return { ok: false, status: 404, error: 'Integration not found' };
  if (spec.authType !== 'oauth2') {
    return { ok: false, status: 400, error: 'Integration is not OAuth2 based' };
  }

  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('service_type', eq(service));
  query.set('select', '*');
  const rows = await safeQuery<StoredIntegrationRow>(rest, 'integrations', query);
  const row = rows?.[0];
  if (!row?.id) return { ok: false, status: 400, error: 'Integration not connected' };

  const adapter = getAdapter(service);
  if (!adapter?.refreshToken) {
    return { ok: false, status: 501, error: 'Refresh token not implemented for this provider' };
  }

  const creds = await readCredentials(rest, row.id);
  if (!creds.refresh_token) {
    return { ok: false, status: 400, error: 'No refresh token stored. Please reconnect.' };
  }

  try {
    const token = await adapter.refreshToken(creds);
    const expiresIn = Number(token?.expires_in || 0);
    const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    await upsertCredential(rest, row.id, 'access_token', encryptSecret(String(token.access_token)), true, expiresAt);
    if (token.refresh_token) {
      await upsertCredential(rest, row.id, 'refresh_token', encryptSecret(String(token.refresh_token)), true, null);
    }

    await writeConnectionLog(rest, row.id, 'refresh', 'success', 'Token refreshed', { service });
    return { ok: true, expiresAt };
  } catch (err: any) {
    await writeConnectionLog(rest, row.id, 'refresh', 'failed', err?.message || 'Token refresh failed', { service });
    return { ok: false, status: 500, error: err?.message || 'Token refresh failed' };
  }
}
