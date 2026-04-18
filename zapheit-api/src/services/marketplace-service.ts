/**
 * marketplace-service.ts
 *
 * Business logic for marketplace app install and uninstall.
 * Routes stay thin: validate → call service → return result.
 */

import crypto from 'crypto';
import { logger } from '../lib/logger';
import { encryptSecret } from '../lib/integrations/encryption';
import { eq, supabaseRestAsService } from '../lib/supabase-rest';
import {
  PARTNER_APP_CATALOG,
  buildOAuthUrl,
  findInstalledIntegrationByAliases,
} from '../routes/marketplace';

// ── Types ─────────────────────────────────────────────────────────────────────

export type InstallResult =
  | { type: 'oauth'; authUrl: string; state: string; appName: string }
  | { type: 'direct'; integrationId: string; appName: string }
  | { type: 'error'; status: 400 | 401 | 404 | 500; error: string; code?: string };

export interface UninstallResult {
  ok: boolean;
  status?: 400 | 401 | 404 | 500;
  error?: string;
}

// ── installApp ────────────────────────────────────────────────────────────────

/**
 * Install a marketplace partner app for an org.
 * For OAuth apps: builds the auth URL and stores the pending state.
 * For API-key apps: validates fields, upserts the integration record, stores credentials.
 */
export async function installApp(
  orgId: string,
  actorId: string | null,
  appId: string,
  credentials: Record<string, string>,
  callbackBaseUrl: string,
): Promise<InstallResult> {
  const app = PARTNER_APP_CATALOG.find((a) => a.id === appId);
  if (!app) return { type: 'error', status: 404, error: 'App not found' };

  // OAuth flow
  if (app.installMethod === 'oauth2') {
    const state = crypto.randomUUID();
    const callbackUrl = `${callbackBaseUrl}/api/marketplace/oauth/callback`;
    const authUrl = buildOAuthUrl(app.id, state, callbackUrl);
    if (!authUrl) {
      return {
        type: 'error',
        status: 400,
        code: 'OAUTH_NOT_CONFIGURED',
        error: `OAuth for ${app.name} is not yet configured.`,
      };
    }

    await supabaseRestAsService('integration_oauth_states', '', {
      method: 'POST',
      body: {
        state,
        organization_id: orgId,
        user_id: actorId,
        provider_name: app.id,
        app_id: app.id,
        redirect_uri: callbackUrl,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    });

    return { type: 'oauth', authUrl, state, appName: app.name };
  }

  // API key flow — validate required fields
  if (app.installMethod === 'api_key' && app.requiredFields) {
    const missing = app.requiredFields
      .filter((f) => f.required && !credentials[f.name])
      .map((f) => f.label);
    if (missing.length > 0) {
      return { type: 'error', status: 400, error: `Missing required fields: ${missing.join(', ')}` };
    }
  }

  const now = new Date().toISOString();

  // Upsert integration row
  const existingRows = (await supabaseRestAsService(
    'integrations',
    new URLSearchParams({
      organization_id: eq(orgId),
      service_type: eq(app.id),
      select: 'id,status',
      limit: '1',
    }),
  )) as Array<{ id: string; status: string }>;

  let integrationId: string;

  if (existingRows?.length > 0) {
    integrationId = existingRows[0].id;
    await supabaseRestAsService(
      'integrations',
      new URLSearchParams({ id: eq(integrationId) }),
      {
        method: 'PATCH',
        body: {
          service_name: app.name,
          category: app.category.toUpperCase(),
          auth_type: app.installMethod,
          status: 'configured',
          ai_enabled: true,
          updated_at: now,
          metadata: { marketplace_app: 'true', developer: app.developer },
        },
      },
    );
  } else {
    const created = (await supabaseRestAsService('integrations', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        service_type: app.id,
        service_name: app.name,
        category: app.category.toUpperCase(),
        auth_type: app.installMethod,
        status: 'configured',
        ai_enabled: true,
        created_at: now,
        updated_at: now,
        metadata: { marketplace_app: 'true', developer: app.developer },
      },
    })) as any[];

    const integration = Array.isArray(created) ? created[0] : created;
    integrationId = integration?.id;
    if (!integrationId) {
      return { type: 'error', status: 500, error: 'Failed to create integration record' };
    }
  }

  // Store credentials (encrypted)
  if (app.installMethod === 'api_key' && Object.keys(credentials).length > 0) {
    const credInserts = await Promise.allSettled(
      Object.entries(credentials).map(async ([key, value]) => {
        const field = app.requiredFields?.find((f) => f.name === key);
        const isSensitive = field?.type === 'password';
        const encrypted = isSensitive ? await encryptSecret(value) : value;
        return supabaseRestAsService('integration_credentials', '', {
          method: 'POST',
          body: {
            integration_id: integrationId,
            key,
            value: encrypted,
            is_sensitive: isSensitive,
            label: field?.label || key,
            created_at: now,
            updated_at: now,
          },
        });
      }),
    );
    const failed = credInserts.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn('Some credentials failed to store', { integrationId, count: failed.length });
    }
  }

  logger.info('Marketplace app installed', { app_id: app.id, org_id: orgId, integration_id: integrationId });

  // Track install event (fire-and-forget)
  void supabaseRestAsService('marketplace_install_events', '', {
    method: 'POST',
    body: { app_id: app.id, organization_id: orgId, action: 'install', actor_id: actorId },
  }).catch((err: any) => {
    logger.warn('Failed to record marketplace install event', { app_id: app.id, error: err?.message });
  });

  return { type: 'direct', integrationId, appName: app.name };
}

// ── uninstallApp ──────────────────────────────────────────────────────────────

/**
 * Uninstall a marketplace app for an org.
 */
export async function uninstallApp(
  orgId: string,
  appId: string,
  actorId: string | null,
): Promise<UninstallResult> {
  const installed = await findInstalledIntegrationByAliases(orgId, appId);
  if (!installed) return { ok: false, status: 404, error: 'App not installed' };

  await supabaseRestAsService(
    'integrations',
    new URLSearchParams({ id: eq(installed.id) }),
    { method: 'DELETE' },
  );

  logger.info('Marketplace app uninstalled', { app_id: appId, org_id: orgId });

  void supabaseRestAsService('marketplace_install_events', '', {
    method: 'POST',
    body: { app_id: appId, organization_id: orgId, action: 'uninstall', actor_id: actorId },
  }).catch(() => {});

  return { ok: true };
}

export { buildOAuthUrl };
