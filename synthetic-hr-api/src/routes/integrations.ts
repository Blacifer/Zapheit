import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { SignJWT, jwtVerify } from 'jose';
import { logger } from '../lib/logger';
import { requirePermission } from '../middleware/rbac';
import { SupabaseRestError, eq, supabaseRestAsService, supabaseRestAsUser } from '../lib/supabase-rest';
import { encryptSecret, decryptSecret } from '../lib/integrations/encryption';
import { IMPLEMENTED_INTEGRATIONS, getIntegrationSpec } from '../lib/integrations/spec-registry';
import { getAdapter } from '../lib/integrations/adapters';

const router = Router();

const getOrgId = (req: any): string | null => req.user?.organization_id || null;
const getUserJwt = (req: any): string => {
  const jwt = req.userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

type RestOptions = { method?: string; body?: any; headers?: Record<string, string> };
type RestFn = (table: string, query: string | URLSearchParams, options?: RestOptions) => Promise<any>;

const restAsUser = (req: any): RestFn => {
  const jwt = getUserJwt(req);
  return (table, query, options = {}) => supabaseRestAsUser(jwt, table, query, options);
};

const restAsService: RestFn = (table, query, options = {}) => supabaseRestAsService(table, query, options);

type IntegrationStatus = 'disconnected' | 'connected' | 'error' | 'syncing' | 'expired';

type StoredIntegrationRow = {
  id: string;
  organization_id: string;
  service_type: string;
  service_name: string;
  category: string;
  status: IntegrationStatus;
  auth_type: string;
  ai_enabled: boolean;
  last_sync_at: string | null;
  last_error_at: string | null;
  last_error_msg: string | null;
  created_at: string;
  updated_at: string;
};

type StoredCredentialRow = {
  id: string;
  integration_id: string;
  key: string;
  value: string;
  is_sensitive: boolean;
  expires_at: string | null;
  label: string | null;
  last_rotated: string | null;
  created_at: string;
  updated_at: string;
};

type StoredConnectionLogRow = {
  id: string;
  integration_id: string;
  action: string;
  status: string;
  message: string | null;
  metadata: any;
  created_at: string;
};

async function safeQuery<T>(rest: RestFn, table: string, query: URLSearchParams): Promise<T[]> {
  try {
    return (await rest(table, query)) as T[];
  } catch (err: any) {
    if (err instanceof SupabaseRestError) {
      // Missing table (migration not applied) or policy issues should not crash the UI.
      logger.warn('Integration route supabase query failed', { table, status: err.status });
      return [];
    }
    logger.warn('Integration route query failed', { table, error: err?.message || String(err) });
    return [];
  }
}

async function upsertIntegration(rest: RestFn, orgId: string, serviceType: string, updates: Partial<StoredIntegrationRow>) {
  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('service_type', eq(serviceType));
  query.set('select', '*');
  const existing = await safeQuery<StoredIntegrationRow>(rest, 'integrations', query);

  const now = new Date().toISOString();
  if (existing.length > 0) {
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(existing[0].id));
    const patched = await rest('integrations', patchQuery, {
      method: 'PATCH',
      body: {
        ...updates,
        updated_at: now,
      },
    }) as any[];
    return patched?.[0] || existing[0];
  }

  const spec = getIntegrationSpec(serviceType);
  const created = await rest('integrations', '', {
    method: 'POST',
    body: {
      organization_id: orgId,
      service_type: serviceType,
      service_name: spec?.name || serviceType,
      category: spec?.category || 'OTHER',
      status: 'connected',
      auth_type: spec?.authType || 'api_key',
      ai_enabled: Boolean(spec?.aiFeatures?.enabled),
      ...updates,
      created_at: now,
      updated_at: now,
    },
  }) as any[];
  return created?.[0] || null;
}

async function upsertCredential(rest: RestFn, integrationId: string, key: string, value: string, isSensitive = true, expiresAt?: string | null) {
  const query = new URLSearchParams();
  query.set('integration_id', eq(integrationId));
  query.set('key', eq(key));
  query.set('select', '*');
  const existing = await safeQuery<StoredCredentialRow>(rest, 'integration_credentials', query);
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
    const patched = await rest('integration_credentials', patchQuery, { method: 'PATCH', body: payload }) as any[];
    return patched?.[0] || existing[0];
  }

  const created = await rest('integration_credentials', '', {
    method: 'POST',
    body: {
      ...payload,
      created_at: now,
    },
  }) as any[];

  return created?.[0] || null;
}

async function readCredentials(rest: RestFn, integrationId: string) {
  const query = new URLSearchParams();
  query.set('integration_id', eq(integrationId));
  query.set('select', 'key,value,is_sensitive,expires_at');
  const rows = await safeQuery<Pick<StoredCredentialRow, 'key' | 'value' | 'is_sensitive' | 'expires_at'>>(rest, 'integration_credentials', query);
  const out: Record<string, string> = {};
  rows.forEach((row) => {
    out[row.key] = row.is_sensitive ? decryptSecret(row.value) : row.value;
  });
  return out;
}

async function writeConnectionLog(
  rest: RestFn,
  integrationId: string,
  action: string,
  status: 'success' | 'failed',
  message?: string,
  metadata?: Record<string, any>
) {
  try {
    await rest('integration_connection_logs', '', {
      method: 'POST',
      body: {
        integration_id: integrationId,
        action,
        status,
        message: message || null,
        metadata: metadata || {},
        created_at: new Date().toISOString(),
      },
    }) as StoredConnectionLogRow[];
  } catch (err: any) {
    // Never break primary flows for logging failures.
    logger.warn('Failed to write integration connection log', { integrationId, action, error: err?.message || String(err) });
  }
}

function getApiBaseUrl(req: any): string {
  const fromEnv = process.env.API_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.replace(/\/+$/, '');

  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function getFrontendUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//')) return null;
  return trimmed;
}

function normalizeDomainInput(value: string): string {
  let v = value.trim();
  v = v.replace(/^https?:\/\//i, '');
  v = v.replace(/\/.*$/, '');
  return v;
}

function resolveUrlTemplate(template: string, connection: Record<string, string>) {
  let out = template;
  Object.entries(connection).forEach(([k, v]) => {
    out = out.split(`{${k}}`).join(encodeURIComponent(v));
  });
  return out;
}

async function signOAuthState(payload: Record<string, any>): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || '');
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secret);
}

async function verifyOAuthState(token: string): Promise<Record<string, any> | null> {
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || '');
    const verified = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return verified.payload as any;
  } catch (err: any) {
    logger.warn('OAuth state verification failed', { error: err?.message || String(err) });
    return null;
  }
}

async function postForm(url: string, data: Record<string, string>): Promise<any> {
  const body = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => body.set(k, v));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const raw = await res.text();
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = { raw };
  }

  if (!res.ok) {
    const message = json?.error_description || json?.error || json?.message || `Token exchange failed (${res.status})`;
    throw new Error(message);
  }

  return json;
}

async function buildOAuthAuthorizeUrl(params: {
  req: any;
  orgId: string;
  userId: string | null;
  service: string;
  returnTo: string;
  spec: any;
  connection: Record<string, string>;
}): Promise<{ url: string }> {
  const { req, orgId, userId, service, returnTo, spec, connection } = params;
  const apiBase = getApiBaseUrl(req);
  const redirectUri = `${apiBase}${spec.oauthConfig.redirectPath}`;

  const state = await signOAuthState({
    orgId,
    userId,
    service,
    returnTo,
    connection,
    nonce: crypto.randomUUID(),
  });

  const oauthResolvedAuthUrl = resolveUrlTemplate(spec.oauthConfig.authorizationUrl, connection);
  const authUrl = new URL(oauthResolvedAuthUrl);

  let clientIdEnv = '';
  const needsOffline = ['zoho_people', 'zoho_recruit', 'zoho_learn', 'google_workspace', 'microsoft_365', 'teams', 'deel', 'gusto', 'flock', 'okta', 'digilocker'].includes(service);

  if (service === 'zoho_people' || service === 'zoho_recruit' || service === 'zoho_learn') clientIdEnv = 'ZOHO_CLIENT_ID';
  else if (service === 'linkedin') clientIdEnv = 'LINKEDIN_CLIENT_ID';
  else if (service === 'digilocker') clientIdEnv = 'DIGILOCKER_CLIENT_ID';
  else if (service === 'google_workspace') clientIdEnv = 'GOOGLE_CLIENT_ID';
  else if (service === 'microsoft_365' || service === 'teams') clientIdEnv = 'MICROSOFT_CLIENT_ID';
  else if (service === 'slack') clientIdEnv = 'SLACK_CLIENT_ID';
  else if (service === 'deel') clientIdEnv = 'DEEL_CLIENT_ID';
  else if (service === 'gusto') clientIdEnv = 'GUSTO_CLIENT_ID';
  else if (service === 'flock') clientIdEnv = 'FLOCK_CLIENT_ID';
  else if (service === 'okta') clientIdEnv = 'OKTA_CLIENT_ID';
  else throw new Error('OAuth provider not implemented');

  const clientId = process.env[clientIdEnv];
  if (!clientId) throw new Error(`${clientIdEnv} is not configured`);

  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', spec.oauthConfig.scopes.join(' '));

  if (service === 'google_workspace') {
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');
  }
  if (service === 'zoho_people' || service === 'zoho_recruit' || service === 'zoho_learn') {
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
  }
  if (needsOffline && (service === 'microsoft_365' || service === 'teams')) {
    authUrl.searchParams.set('prompt', 'consent');
  }
  if (service === 'okta') {
    authUrl.searchParams.set('nonce', crypto.randomUUID());
  }

  return { url: authUrl.toString() };
}

// Catalog: registry only
router.get('/catalog', requirePermission('connectors.read'), async (_req, res) => {
  return res.json({
    success: true,
    data: {
      phase: 4,
      integrations: IMPLEMENTED_INTEGRATIONS,
    },
  });
});

// List: registry merged with org state
router.get('/', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('order', 'created_at.desc');
  const rows = await safeQuery<StoredIntegrationRow>(rest, 'integrations', query);

  const byType = new Map(rows.map((row) => [row.service_type, row]));

  const data = IMPLEMENTED_INTEGRATIONS.map((spec) => {
    const row = byType.get(spec.id);
    return {
      id: spec.id,
      name: spec.name,
      category: spec.category,
      description: spec.description,
      authType: spec.authType,
      tags: spec.tags,
      color: spec.color,
      priority: spec.priority,
      requiredFields: spec.apiKeyConfig?.requiredFields || spec.connectionFields || [],
      status: row?.status || 'disconnected',
      lastSyncAt: row?.last_sync_at || null,
      lastErrorAt: row?.last_error_at || null,
      lastErrorMsg: row?.last_error_msg || null,
      aiEnabled: row?.ai_enabled ?? Boolean(spec.aiFeatures?.enabled),
      connectionId: row?.id || null,
    };
  });

  return res.json({ success: true, data });
});

// OAuth init: returns provider authorization URL (JWT-authenticated; frontend then redirects).
router.post('/oauth/init', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const schema = z.object({
    service: z.string().min(1),
    returnTo: z.string().optional(),
    connection: z.record(z.string(), z.string()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid payload' });

  const service = parsed.data.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });
  if (spec.authType !== 'oauth2' || !spec.oauthConfig) return res.status(400).json({ success: false, error: 'Integration is not OAuth2 based' });

  const returnTo = safeReturnPath(parsed.data.returnTo) || '/dashboard/integrations';
  const connection: Record<string, string> = {};
  Object.entries(parsed.data.connection || {}).forEach(([k, v]) => {
    if (!v) return;
    connection[k] = k.includes('domain') || k.includes('subdomain') ? normalizeDomainInput(v) : v.trim();
  });

  // Enforce required connection fields, if any.
  for (const field of spec.connectionFields || []) {
    if (field.required && !connection[field.name]) {
      return res.status(400).json({ success: false, error: `Missing required field: ${field.name}` });
    }
  }

  try {
    const out = await buildOAuthAuthorizeUrl({
      req,
      orgId,
      userId: req.user?.id || null,
      service,
      returnTo,
      spec,
      connection,
    });
    return res.json({ success: true, data: out });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to start OAuth flow' });
  }
});

// Connection logs for a specific integration
router.get('/:service/logs', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });

  const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 20;

  const iQuery = new URLSearchParams();
  iQuery.set('organization_id', eq(orgId));
  iQuery.set('service_type', eq(service));
  iQuery.set('select', 'id');
  const rows = await safeQuery<Pick<StoredIntegrationRow, 'id'>>(rest, 'integrations', iQuery);
  const integrationId = rows?.[0]?.id;

  if (!integrationId) {
    return res.json({ success: true, data: [] });
  }

  const logQuery = new URLSearchParams();
  logQuery.set('integration_id', eq(integrationId));
  logQuery.set('order', 'created_at.desc');
  logQuery.set('limit', String(limit));
  logQuery.set('select', 'id,action,status,message,metadata,created_at');
  const logs = await safeQuery<Pick<StoredConnectionLogRow, 'id' | 'action' | 'status' | 'message' | 'metadata' | 'created_at'>>(
    rest,
    'integration_connection_logs',
    logQuery
  );

  return res.json({ success: true, data: logs });
});

// Manual token refresh (OAuth only)
router.post('/refresh/:service', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });
  if (spec.authType !== 'oauth2') return res.status(400).json({ success: false, error: 'Integration is not OAuth2 based' });

  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('service_type', eq(service));
  query.set('select', '*');
  const rows = await safeQuery<StoredIntegrationRow>(rest, 'integrations', query);
  const row = rows?.[0];
  if (!row?.id) return res.status(400).json({ success: false, error: 'Integration not connected' });

  const adapter = getAdapter(service);
  if (!adapter?.refreshToken) return res.status(501).json({ success: false, error: 'Refresh token not implemented for this provider' });

  const creds = await readCredentials(rest, row.id);
  if (!creds.refresh_token) return res.status(400).json({ success: false, error: 'No refresh token stored. Please reconnect.' });

  try {
    const token = await adapter.refreshToken(creds);
    const expiresIn = Number(token?.expires_in || 0);
    const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    await upsertCredential(rest, row.id, 'access_token', encryptSecret(String(token.access_token)), true, expiresAt);
    if (token.refresh_token) {
      await upsertCredential(rest, row.id, 'refresh_token', encryptSecret(String(token.refresh_token)), true, null);
    }

    await writeConnectionLog(rest, row.id, 'refresh', 'success', 'Token refreshed', { service });
    return res.json({ success: true, data: { refreshed: true, expiresAt } });
  } catch (err: any) {
    await writeConnectionLog(rest, row.id, 'refresh', 'failed', err?.message || 'Token refresh failed', { service });
    return res.status(500).json({ success: false, error: err?.message || 'Token refresh failed' });
  }
});

// OAuth authorize: redirects the user to the provider.
router.get('/oauth/authorize/:service', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });
  if (spec.authType !== 'oauth2' || !spec.oauthConfig) return res.status(400).json({ success: false, error: 'Integration is not OAuth2 based' });

  const returnTo = safeReturnPath(req.query.return_to) || '/dashboard/integrations';
  const connection: Record<string, string> = {};
  (spec.connectionFields || []).forEach((field) => {
    const raw = req.query[field.name];
    if (typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    connection[field.name] = field.name.includes('domain') || field.name.includes('subdomain')
      ? normalizeDomainInput(trimmed)
      : trimmed;
  });

  for (const field of spec.connectionFields || []) {
    if (field.required && !connection[field.name]) {
      return res.status(400).json({ success: false, error: `Missing required field: ${field.name}` });
    }
  }

  try {
    const out = await buildOAuthAuthorizeUrl({
      req,
      orgId,
      userId: req.user?.id || null,
      service,
      returnTo,
      spec,
      connection,
    });
    return res.redirect(302, out.url);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to start OAuth flow' });
  }
});

// OAuth callback: public endpoint invoked by provider redirects.
router.get('/oauth/callback/:service', async (req, res) => {
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec || spec.authType !== 'oauth2' || !spec.oauthConfig) return res.status(404).send('Integration not found');

  const frontendUrl = getFrontendUrl();
  const error = typeof req.query.error === 'string' ? req.query.error : null;
  const errorDescription = typeof req.query.error_description === 'string' ? req.query.error_description : null;
  if (error) {
    const params = new URLSearchParams({
      status: 'error',
      service,
      message: errorDescription || error,
    });
    return res.redirect(302, `${frontendUrl}/dashboard/integrations?${params.toString()}`);
  }

  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  if (!code || !state) {
    const params = new URLSearchParams({ status: 'error', service, message: 'Missing code/state' });
    return res.redirect(302, `${frontendUrl}/dashboard/integrations?${params.toString()}`);
  }

  const parsedState = await verifyOAuthState(state);
  if (!parsedState?.orgId || parsedState?.service !== service) {
    const params = new URLSearchParams({ status: 'error', service, message: 'Invalid state' });
    return res.redirect(302, `${frontendUrl}/dashboard/integrations?${params.toString()}`);
  }

  const orgId = String(parsedState.orgId);
  const connection = (parsedState.connection && typeof parsedState.connection === 'object') ? (parsedState.connection as Record<string, string>) : {};
  const apiBase = getApiBaseUrl(req);
  const redirectUri = `${apiBase}${spec.oauthConfig.redirectPath}`;

  try {
    const rest = restAsService;
    let token: any = null;
    const tokenUrl = resolveUrlTemplate(spec.oauthConfig.tokenUrl, connection);
    const secretOrNull = (name: string) => {
      const v = process.env[name];
      return v && v.trim().length > 0 ? v : null;
    };

    if (service === 'slack') {
      const clientId = secretOrNull('SLACK_CLIENT_ID');
      const clientSecret = secretOrNull('SLACK_CLIENT_SECRET');
      if (!clientId || !clientSecret) throw new Error('Slack OAuth env vars are not configured');

      // Slack returns {ok, access_token, ...}
      const slack = await postForm(tokenUrl, {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      });
      if (!slack?.ok) throw new Error(slack?.error || 'Slack token exchange failed');
      token = slack;
    } else {
      // Standard OAuth2 code exchange
      let clientIdEnv = '';
      let clientSecretEnv: string | null = null;

      if (service === 'zoho_people' || service === 'zoho_recruit' || service === 'zoho_learn') {
        clientIdEnv = 'ZOHO_CLIENT_ID';
        clientSecretEnv = 'ZOHO_CLIENT_SECRET';
      } else if (service === 'linkedin') {
        clientIdEnv = 'LINKEDIN_CLIENT_ID';
        clientSecretEnv = 'LINKEDIN_CLIENT_SECRET';
      } else if (service === 'digilocker') {
        clientIdEnv = 'DIGILOCKER_CLIENT_ID';
        clientSecretEnv = 'DIGILOCKER_CLIENT_SECRET';
      } else if (service === 'google_workspace') {
        clientIdEnv = 'GOOGLE_CLIENT_ID';
        clientSecretEnv = 'GOOGLE_CLIENT_SECRET';
      } else if (service === 'microsoft_365' || service === 'teams') {
        clientIdEnv = 'MICROSOFT_CLIENT_ID';
        clientSecretEnv = 'MICROSOFT_CLIENT_SECRET';
      } else if (service === 'deel') {
        clientIdEnv = 'DEEL_CLIENT_ID';
        clientSecretEnv = 'DEEL_CLIENT_SECRET';
      } else if (service === 'gusto') {
        clientIdEnv = 'GUSTO_CLIENT_ID';
        clientSecretEnv = 'GUSTO_CLIENT_SECRET';
      } else if (service === 'flock') {
        clientIdEnv = 'FLOCK_CLIENT_ID';
        clientSecretEnv = 'FLOCK_CLIENT_SECRET';
      } else if (service === 'okta') {
        clientIdEnv = 'OKTA_CLIENT_ID';
        clientSecretEnv = 'OKTA_CLIENT_SECRET';
      } else {
        throw new Error('OAuth provider not implemented');
      }

      const clientId = secretOrNull(clientIdEnv);
      const clientSecret = clientSecretEnv ? secretOrNull(clientSecretEnv) : null;
      if (!clientId || !clientSecret) throw new Error('OAuth env vars are not configured');

      token = await postForm(tokenUrl, {
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      });
    }

    const accessToken = token?.access_token;
    const refreshToken = token?.refresh_token;
    const expiresIn = Number(token?.expires_in || token?.expires_in_sec || token?.expires || 0);

    if (!accessToken) throw new Error('No access token returned by provider');

    const integration = await upsertIntegration(rest, orgId, spec.id, {
      status: 'connected',
      auth_type: spec.authType,
      category: spec.category,
      service_name: spec.name,
      last_error_at: null,
      last_error_msg: null,
      last_sync_at: null,
    });

    if (!integration?.id) throw new Error('Failed to store integration');

    const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    await upsertCredential(rest, integration.id, 'access_token', encryptSecret(String(accessToken)), true, expiresAt);
    if (refreshToken) {
      await upsertCredential(rest, integration.id, 'refresh_token', encryptSecret(String(refreshToken)), true, null);
    }
    // Persist connection fields (non-sensitive) such as domain for Okta.
    await Promise.all(Object.entries(connection).map(async ([k, v]) => {
      if (!v) return;
      const stored = k === 'domain' || k === 'subdomain' ? normalizeDomainInput(String(v)) : String(v);
      await upsertCredential(rest, integration.id, k, stored, false, null);
    }));

    await writeConnectionLog(rest, integration.id, 'connect', 'success', 'OAuth integration connected', { service, authType: 'oauth2' });

    const returnTo = safeReturnPath(parsedState.returnTo) || '/dashboard/integrations';
    const params = new URLSearchParams({ status: 'connected', service });
    return res.redirect(302, `${frontendUrl}${returnTo}?${params.toString()}`);
  } catch (err: any) {
    logger.warn('OAuth callback failed', { service, error: err?.message || String(err) });
    const params = new URLSearchParams({ status: 'error', service, message: err?.message || 'OAuth failed' });
    return res.redirect(302, `${frontendUrl}/dashboard/integrations?${params.toString()}`);
  }
});

// Connect (API key style)
router.post('/:service/connect', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });
  if (spec.authType !== 'api_key' && spec.authType !== 'client_credentials') {
    return res.status(400).json({ success: false, error: 'Integration is not connectable via credentials' });
  }

  const schema = z.object({
    credentials: z.record(z.string(), z.string()),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid payload' });

  const required = spec.apiKeyConfig?.requiredFields || spec.connectionFields || [];
  for (const field of required) {
    if (field.required && !parsed.data.credentials[field.name]) {
      return res.status(400).json({ success: false, error: `Missing required field: ${field.name}` });
    }
  }

  const integration = await upsertIntegration(rest, orgId, spec.id, {
    status: 'connected',
    auth_type: spec.authType,
    category: spec.category,
    service_name: spec.name,
    last_error_at: null,
    last_error_msg: null,
  });

  if (!integration?.id) return res.status(500).json({ success: false, error: 'Failed to store integration' });

  await Promise.all(Object.entries(parsed.data.credentials).map(async ([key, value]) => {
    const descriptor = required.find((f) => f.name === key);
    const sensitive = descriptor ? descriptor.type === 'password' : true;
    const stored = sensitive
      ? encryptSecret(value)
      : (key.includes('domain') || key.includes('subdomain') ? normalizeDomainInput(value) : value);
    await upsertCredential(rest, integration.id, key, stored, sensitive);
  }));

  await writeConnectionLog(rest, integration.id, 'connect', 'success', 'Credential integration connected', { service: spec.id, authType: spec.authType });

  return res.json({ success: true, message: 'Integration connected', data: { id: integration.id, service: spec.id } });
});

// Disconnect
router.post('/:service/disconnect', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });

  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('service_type', eq(service));
  query.set('select', '*');
  const rows = await safeQuery<StoredIntegrationRow>(rest, 'integrations', query);
  const row = rows?.[0];
  if (!row?.id) return res.json({ success: true, message: 'Already disconnected' });

  const patchQuery = new URLSearchParams();
  patchQuery.set('id', eq(row.id));
  await rest('integrations', patchQuery, {
    method: 'PATCH',
    body: {
      status: 'disconnected',
      last_error_at: null,
      last_error_msg: null,
      updated_at: new Date().toISOString(),
    },
  });

  // Best-effort remove credentials.
  try {
    const credQuery = new URLSearchParams();
    credQuery.set('integration_id', eq(row.id));
    await rest('integration_credentials', credQuery, { method: 'DELETE' });
  } catch (err) {
    logger.warn('Failed to delete integration credentials', { service, error: (err as any)?.message });
  }

  await writeConnectionLog(rest, row.id, 'disconnect', 'success', 'Integration disconnected', { service });

  return res.json({ success: true, message: 'Integration disconnected' });
});

// Test connection
router.post('/test/:service', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });

  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('service_type', eq(service));
  query.set('select', '*');
  const rows = await safeQuery<StoredIntegrationRow>(rest, 'integrations', query);
  const row = rows?.[0];
  if (!row?.id) return res.status(400).json({ success: false, error: 'Integration not connected' });

  const creds = await readCredentials(rest, row.id);
  const adapter = getAdapter(service);
  if (!adapter) return res.status(501).json({ success: false, error: 'Adapter not implemented' });

  let result = await adapter.testConnection(creds);

  // If an OAuth token is expired and we have a refresh path, attempt one refresh then retry once.
  const maybeExpired = !result.success && /expired/i.test(result.message);
  if (maybeExpired && adapter.refreshToken && creds.refresh_token) {
    try {
      const token = await adapter.refreshToken(creds);
      const expiresIn = Number(token?.expires_in || 0);
      const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

      await upsertCredential(rest, row.id, 'access_token', encryptSecret(String(token.access_token)), true, expiresAt);
      if (token.refresh_token) {
        await upsertCredential(rest, row.id, 'refresh_token', encryptSecret(String(token.refresh_token)), true, null);
      }
      await writeConnectionLog(rest, row.id, 'refresh', 'success', 'Token refreshed during test', { service });

      result = await adapter.testConnection({ ...creds, access_token: String(token.access_token) });
    } catch (err: any) {
      await writeConnectionLog(rest, row.id, 'refresh', 'failed', err?.message || 'Token refresh failed during test', { service });
    }
  }

  const patchQuery = new URLSearchParams();
  patchQuery.set('id', eq(row.id));
  await rest('integrations', patchQuery, {
    method: 'PATCH',
    body: {
      status: result.success ? 'connected' : 'error',
      last_error_at: result.success ? null : new Date().toISOString(),
      last_error_msg: result.success ? null : result.message,
      updated_at: new Date().toISOString(),
    },
  });

  await writeConnectionLog(rest, row.id, 'test', result.success ? 'success' : 'failed', result.message, { service });

  return res.json({ success: true, data: result });
});

export default router;
