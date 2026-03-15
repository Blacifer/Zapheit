import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { SignJWT, jwtVerify } from 'jose';
import { logger } from '../lib/logger';
import { requirePermission } from '../middleware/rbac';
import { SupabaseRestError, eq, in_, supabaseRestAsService, supabaseRestAsUser } from '../lib/supabase-rest';
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

type IntegrationStatus = 'disconnected' | 'configured' | 'connected' | 'error' | 'syncing' | 'expired';

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

type StoredActionPolicyRow = {
  id: string;
  organization_id: string;
  service: string;
  action: string;
  enabled: boolean;
  require_approval: boolean;
  required_role: string;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
};

type StoredAgentRow = {
  id: string;
  organization_id: string;
  metadata?: Record<string, any> | null;
};

type AgentPublishStatus = 'not_live' | 'ready' | 'live';
type AgentPackId = 'recruitment' | 'support' | 'sales' | 'it' | 'finance' | 'compliance';

function sanitizeIntegrationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
}

function packIdFromCategory(category: string | null | undefined): AgentPackId {
  const normalized = String(category || '').toUpperCase();
  if (normalized === 'COMPLIANCE') return 'compliance';
  if (normalized === 'FINANCE' || normalized === 'PAYROLL' || normalized === 'GLOBAL_PAYROLL' || normalized === 'PAYMENTS') return 'finance';
  if (normalized === 'SUPPORT' || normalized === 'ITSM' || normalized === 'COMMUNICATION') return 'support';
  if (normalized === 'CRM') return 'sales';
  if (normalized === 'IAM' || normalized === 'IDENTITY' || normalized === 'COLLABORATION' || normalized === 'PRODUCTIVITY') return 'it';
  if (normalized === 'RECRUITMENT' || normalized === 'ATS' || normalized === 'HRMS') return 'recruitment';
  return 'it';
}

function readAgentPublish(agent: StoredAgentRow) {
  const metadata = agent?.metadata && typeof agent.metadata === 'object' ? agent.metadata : {};
  const publish = metadata.publish && typeof metadata.publish === 'object' ? metadata.publish : {};
  return {
    publish_status: publish.publish_status as AgentPublishStatus | undefined,
    primary_pack: (publish.primary_pack ?? null) as AgentPackId | null,
    integration_ids: sanitizeIntegrationIds(publish.integration_ids),
  };
}

function writeAgentPublish(agent: StoredAgentRow, updates: {
  publish_status: AgentPublishStatus;
  primary_pack: AgentPackId | null;
  integration_ids: string[];
}) {
  const metadata = agent?.metadata && typeof agent.metadata === 'object' ? { ...agent.metadata } : {};
  metadata.publish = updates;
  return metadata;
}

async function pruneDisconnectedIntegrationFromAgents(rest: RestFn, orgId: string, serviceType: string) {
  const agentsQuery = new URLSearchParams();
  agentsQuery.set('organization_id', eq(orgId));
  agentsQuery.set('select', 'id,organization_id,metadata');
  const agents = await safeQuery<StoredAgentRow>(rest, 'ai_agents', agentsQuery);
  if (!agents.length) return;

  const integrationQuery = new URLSearchParams();
  integrationQuery.set('organization_id', eq(orgId));
  integrationQuery.set('select', 'service_type,status,category');
  const integrations = await safeQuery<Array<{ service_type: string; status: string; category: string }>[number]>(rest, 'integrations', integrationQuery);
  const integrationMap = new Map(integrations.map((row) => [row.service_type, row]));

  await Promise.all(agents.map(async (agent) => {
    const publish = readAgentPublish(agent);
    if (!publish.integration_ids.includes(serviceType)) return;

    const remainingIntegrationIds = publish.integration_ids.filter((integrationId) => integrationId !== serviceType);
    const remainingRows = remainingIntegrationIds
      .map((integrationId) => integrationMap.get(integrationId))
      .filter(Boolean) as Array<{ service_type: string; status: string; category: string }>;

    const publishStatus: AgentPublishStatus = remainingRows.length === 0
      ? 'not_live'
      : remainingRows.some((row) => row.status === 'connected')
        ? 'live'
        : 'ready';

    const primaryPack = remainingRows[0] ? packIdFromCategory(remainingRows[0].category) : null;
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(agent.id));
    patchQuery.set('organization_id', eq(orgId));
    await rest('ai_agents', patchQuery, {
      method: 'PATCH',
      body: {
        metadata: writeAgentPublish(agent, {
          publish_status: publishStatus,
          primary_pack: primaryPack,
          integration_ids: remainingIntegrationIds,
        }),
        updated_at: new Date().toISOString(),
      },
    });
  }));
}

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

async function upsertActionPolicy(
  rest: RestFn,
  orgId: string,
  service: string,
  action: string,
  updates: Partial<StoredActionPolicyRow>
) {
  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('service', eq(service));
  query.set('action', eq(action));
  query.set('select', '*');
  const existing = await safeQuery<StoredActionPolicyRow>(rest, 'action_policies', query);

  const now = new Date().toISOString();
  if (existing.length > 0) {
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(existing[0].id));
    const patched = await rest('action_policies', patchQuery, {
      method: 'PATCH',
      body: {
        ...updates,
        updated_at: now,
      },
    }) as any[];
    return patched?.[0] || existing[0];
  }

  const created = await rest('action_policies', '', {
    method: 'POST',
    body: {
      organization_id: orgId,
      service,
      action,
      enabled: updates.enabled ?? true,
      require_approval: updates.require_approval ?? true,
      required_role: updates.required_role ?? 'manager',
      notes: updates.notes ?? null,
      updated_by: (updates as any).updated_by ?? null,
      updated_at: now,
    },
  }) as any[];
  return created?.[0] || null;
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

async function postForm(url: string, data: Record<string, string>, extraHeaders?: Record<string, string>): Promise<any> {
  const body = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => body.set(k, v));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(extraHeaders || {}) },
    body,
  });

  const raw = await res.text();
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = { raw };
  }

  if (!res.ok || (json && json.error && !json.access_token)) {
    const message = json?.error_description || json?.error || json?.message || `Token exchange failed (${res.status})`;
    logger.warn('OAuth token exchange error', { url, status: res.status, body: raw.slice(0, 500) });
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

  const needsPkce = service === 'salesforce';
  const codeVerifier = needsPkce ? crypto.randomBytes(32).toString('base64url') : undefined;

  const state = await signOAuthState({
    orgId,
    userId,
    service,
    returnTo,
    connection,
    nonce: crypto.randomUUID(),
    ...(codeVerifier ? { codeVerifier } : {}),
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
  else if (service === 'salesforce') clientIdEnv = 'SALESFORCE_CLIENT_ID';
  else if (service === 'intercom') clientIdEnv = 'INTERCOM_CLIENT_ID';
  else if (service === 'quickbooks') clientIdEnv = 'QUICKBOOKS_CLIENT_ID';
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
  if (needsPkce && codeVerifier) {
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
  }

  return { url: authUrl.toString() };
}

function oauthEnvKeysForService(service: string): string[] {
  switch (service) {
    case 'zoho_people':
    case 'zoho_recruit':
    case 'zoho_learn':
      return ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET'];
    case 'linkedin':
      return ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'];
    case 'digilocker':
      return ['DIGILOCKER_CLIENT_ID', 'DIGILOCKER_CLIENT_SECRET'];
    case 'google_workspace':
      return ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    case 'microsoft_365':
    case 'teams':
      return ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'];
    case 'slack':
      return ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'];
    case 'deel':
      return ['DEEL_CLIENT_ID', 'DEEL_CLIENT_SECRET'];
    case 'gusto':
      return ['GUSTO_CLIENT_ID', 'GUSTO_CLIENT_SECRET'];
    case 'flock':
      return ['FLOCK_CLIENT_ID', 'FLOCK_CLIENT_SECRET'];
    case 'okta':
      return ['OKTA_CLIENT_ID', 'OKTA_CLIENT_SECRET'];
    case 'salesforce':
      return ['SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET'];
    case 'intercom':
      return ['INTERCOM_CLIENT_ID', 'INTERCOM_CLIENT_SECRET'];
    case 'quickbooks':
      return ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'];
    default:
      return [];
  }
}

type ReadinessItemStatus = 'ok' | 'todo' | 'blocked';

type IntegrationReadinessItem = {
  id: string;
  label: string;
  status: ReadinessItemStatus;
  detail?: string | null;
};

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

  const integrationIds = rows.map((r) => r.id).filter(Boolean);
  const credentialIntegrationIdSet = new Set<string>();
  const accessTokenExpiryByIntegrationId = new Map<string, string | null>();
  if (integrationIds.length > 0) {
    const credQuery = new URLSearchParams();
    credQuery.set('integration_id', in_(integrationIds));
    credQuery.set('select', 'integration_id');
    const creds = await safeQuery<Pick<StoredCredentialRow, 'integration_id'>>(rest, 'integration_credentials', credQuery);
    (creds || []).forEach((c) => {
      if (c.integration_id) credentialIntegrationIdSet.add(String(c.integration_id));
    });

    // Access token expiry is stored on the credential row where key=access_token.
    const expQuery = new URLSearchParams();
    expQuery.set('integration_id', in_(integrationIds));
    expQuery.set('key', eq('access_token'));
    expQuery.set('select', 'integration_id,expires_at');
    const expRows = await safeQuery<Pick<StoredCredentialRow, 'integration_id' | 'expires_at'>>(rest, 'integration_credentials', expQuery);
    (expRows || []).forEach((r) => {
      if (!r.integration_id) return;
      accessTokenExpiryByIntegrationId.set(String(r.integration_id), r.expires_at || null);
    });
  }

  const lifecycleFromRow = (row: StoredIntegrationRow | undefined | null): 'not_configured' | 'configured' | IntegrationStatus => {
    if (!row?.id) return 'not_configured';
    const hasCredentials = credentialIntegrationIdSet.has(row.id);
    if (!hasCredentials) return 'not_configured';
    if ((row.status as any) === 'configured') return 'configured';
    return row.status;
  };

  const data = IMPLEMENTED_INTEGRATIONS.map((spec) => {
    const row = byType.get(spec.id);
    const lifecycleStatus = spec.id === 'internal' ? 'connected' : lifecycleFromRow(row);
    const oauthKeys = spec.authType === 'oauth2' ? oauthEnvKeysForService(spec.id) : [];
    const oauthMissingEnv = oauthKeys.filter((k) => !(process.env[k] && String(process.env[k]).trim().length > 0));
    const oauthMeta = spec.authType === 'oauth2'
      ? { ready: oauthMissingEnv.length === 0, missingEnv: oauthMissingEnv }
      : null;

    const expectedRedirectUrl =
      spec.authType === 'oauth2' && spec.oauthConfig
        ? `${getApiBaseUrl(req)}${spec.oauthConfig.redirectPath}`
        : null;

    const missingCoreEnv = ['JWT_SECRET', 'FRONTEND_URL'].filter((k) => !(process.env[k] && String(process.env[k]).trim().length > 0));
    const coreEnvReady = missingCoreEnv.length === 0;

    const requiredFields = spec.apiKeyConfig?.requiredFields || spec.connectionFields || [];
    const credentialHint = requiredFields.length > 0 ? requiredFields.map((f) => f.label).join(', ') : '—';

    const readiness: { expectedRedirectUrl: string | null; items: IntegrationReadinessItem[] } = {
      expectedRedirectUrl,
      items: [],
    };

    readiness.items.push({
      id: 'core_env',
      label: 'Backend env configured',
      status: coreEnvReady ? 'ok' : 'blocked',
      detail: coreEnvReady ? null : `Missing: ${missingCoreEnv.join(', ')}`,
    });

    if (spec.id === 'internal') {
      readiness.items.push({
        id: 'credentials',
        label: 'Credentials saved',
        status: 'ok',
        detail: 'Not required (built-in).',
      });
      readiness.items.push({
        id: 'validated',
        label: 'Connection validated',
        status: 'ok',
        detail: 'Built-in provider.',
      });
    } else if (spec.authType === 'oauth2') {
      readiness.items.push({
        id: 'oauth_app',
        label: 'OAuth app keys set',
        status: oauthMeta?.ready ? 'ok' : 'blocked',
        detail: oauthMeta?.ready ? null : `Missing: ${(oauthMeta?.missingEnv || []).join(', ')}`,
      });
      readiness.items.push({
        id: 'redirect_url',
        label: 'Redirect URL added in provider console',
        // If already connected the redirect URL is clearly registered — mark ok.
        status: lifecycleStatus === 'connected' ? 'ok' : (expectedRedirectUrl ? 'todo' : 'blocked'),
        detail: lifecycleStatus === 'connected' ? null : (expectedRedirectUrl || 'Could not compute redirect URL'),
      });
      readiness.items.push({
        id: 'validated',
        label: 'Connection validated',
        status: lifecycleStatus === 'connected' ? 'ok' : lifecycleStatus === 'error' || lifecycleStatus === 'expired' ? 'blocked' : 'todo',
        detail: lifecycleStatus === 'connected' ? null : (row?.last_error_msg || null),
      });
    } else {
      readiness.items.push({
        id: 'credentials',
        label: 'Credentials saved',
        status: lifecycleStatus === 'not_configured' ? 'todo' : 'ok',
        detail: lifecycleStatus === 'not_configured' ? `Required: ${credentialHint}` : null,
      });
      readiness.items.push({
        id: 'validated',
        label: 'Connection validated',
        status: lifecycleStatus === 'connected' ? 'ok' : lifecycleStatus === 'error' || lifecycleStatus === 'expired' ? 'blocked' : 'todo',
        detail: lifecycleStatus === 'connected' ? null : (row?.last_error_msg || null),
      });
    }

    const tokenExpiresAt = row?.id ? (accessTokenExpiryByIntegrationId.get(row.id) || null) : null;
    const tokenExpiresAtMs = tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : NaN;
    const nowMs = Date.now();
    const tokenExpired = Number.isFinite(tokenExpiresAtMs) ? tokenExpiresAtMs <= nowMs : false;
    const tokenExpiresSoon = Number.isFinite(tokenExpiresAtMs) ? (tokenExpiresAtMs - nowMs) <= 1000 * 60 * 60 * 24 * 7 : false;

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
      capabilities: spec.capabilities || { reads: [], writes: [] },
      oauth: oauthMeta,
      readiness,
      tokenExpiresAt,
      tokenExpired,
      tokenExpiresSoon,
      // Backwards-compatible field for older UIs.
      status: spec.id === 'internal' ? 'connected' : (row?.status || 'disconnected'),
      // New lifecycle field: use this in UIs to show "visible but disabled until configured".
      lifecycleStatus,
      lastSyncAt: row?.last_sync_at || null,
      lastErrorAt: row?.last_error_at || null,
      lastErrorMsg: row?.last_error_msg || null,
      aiEnabled: row?.ai_enabled ?? Boolean(spec.aiFeatures?.enabled),
      connectionId: row?.id || null,
    };
  });

  return res.json({ success: true, data });
});

// Action catalog: spec-driven write capabilities merged with org enablement (action_policies).
router.get('/actions', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('select', 'service,action,enabled,require_approval,required_role,updated_at');
  const policies = await safeQuery<Pick<StoredActionPolicyRow, 'service' | 'action' | 'enabled' | 'require_approval' | 'required_role' | 'updated_at'>>(
    rest,
    'action_policies',
    query
  );
  const policyMap = new Map(policies.map((p) => [`${p.service}:${p.action}`, p]));

  const actions = IMPLEMENTED_INTEGRATIONS.flatMap((spec) => {
    const writes = spec.capabilities?.writes || [];
    return writes.map((w) => {
      const key = `${spec.id}:${w.id}`;
      const policy = policyMap.get(key);
      return {
        service: spec.id,
        providerName: spec.name,
        providerCategory: spec.category,
        action: w.id,
        label: w.label,
        risk: w.risk,
        pack: w.pack || null,
        enabled: policy ? Boolean(policy.enabled) : false,
        requireApproval: policy ? Boolean(policy.require_approval) : true,
        requiredRole: policy?.required_role || 'manager',
        updatedAt: policy?.updated_at || null,
      };
    });
  });

  return res.json({ success: true, data: actions });
});

// Upsert action enablement for spec actions (writes only).
router.post('/actions', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const schema = z.object({
    items: z.array(z.object({
      service: z.string().min(1),
      action: z.string().min(1),
      enabled: z.boolean(),
    })).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid payload' });

  const implemented = new Set(IMPLEMENTED_INTEGRATIONS.map((i) => i.id));
  const writeSet = new Set<string>();
  IMPLEMENTED_INTEGRATIONS.forEach((spec) => {
    (spec.capabilities?.writes || []).forEach((w) => writeSet.add(`${spec.id}:${w.id}`));
  });

  for (const item of parsed.data.items) {
    if (!implemented.has(item.service)) {
      return res.status(400).json({ success: false, error: `Unknown integration service: ${item.service}` });
    }
    if (!writeSet.has(`${item.service}:${item.action}`)) {
      return res.status(400).json({ success: false, error: `Unknown action for service: ${item.service}:${item.action}` });
    }

    await upsertActionPolicy(rest, orgId, item.service, item.action, {
      enabled: item.enabled,
      require_approval: true,
      required_role: 'manager',
      updated_by: req.user?.id || null,
      notes: null,
    });
  }

  return res.json({ success: true, data: { updated: parsed.data.items.length } });
});

// OAuth init: returns provider authorization URL (JWT-authenticated; frontend then redirects).
router.post('/oauth/init', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const schema = z.object({
    service: z.string().min(1),
    returnTo: z.string().optional(),
    connection: z.record(z.string(), z.string()).optional(),
    popup: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid payload' });

  const service = parsed.data.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });
  if (spec.authType !== 'oauth2' || !spec.oauthConfig) return res.status(400).json({ success: false, error: 'Integration is not OAuth2 based' });

  const returnTo = parsed.data.popup
    ? '/oauth/popup'
    : (safeReturnPath(parsed.data.returnTo) || '/dashboard/integrations');
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

function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stableSeed(orgId: string, service: string): number {
  const hex = crypto.createHash('sha256').update(`${orgId}:${service}`).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16) >>> 0;
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function sampleCandidateData(orgId: string, service: string) {
  const rng = mulberry32(stableSeed(orgId, service));
  const firstNames = ['Aarav', 'Diya', 'Ishaan', 'Meera', 'Kabir', 'Ananya', 'Rohan', 'Sara', 'Vikram', 'Naina', 'Arjun', 'Priya'];
  const lastNames = ['Sharma', 'Patel', 'Gupta', 'Iyer', 'Singh', 'Reddy', 'Khan', 'Verma', 'Nair', 'Mehta', 'Bose', 'Kapoor'];
  const cities = ['Bengaluru', 'Hyderabad', 'Pune', 'Mumbai', 'Delhi', 'Chennai', 'Kolkata', 'Ahmedabad'];
  const roles = ['Software Engineer', 'HR Generalist', 'Talent Acquisition', 'Accountant', 'Payroll Specialist', 'Data Analyst', 'Customer Success'];
  const skillPool = ['React', 'Node.js', 'TypeScript', 'Python', 'PostgreSQL', 'Recruiting', 'Sourcing', 'Excel', 'Tally', 'Payroll', 'Communication', 'Stakeholder management'];

  const now = Date.now();
  const candidates = Array.from({ length: 20 }).map((_, idx) => {
    const name = `${pick(rng, firstNames)} ${pick(rng, lastNames)}`;
    const role = pick(rng, roles);
    const skills = Array.from({ length: 6 }).map(() => pick(rng, skillPool));
    const uniqueSkills = Array.from(new Set(skills)).slice(0, 5);
    const experienceYears = Math.max(0, Math.round(rng() * 10));
    const score = Math.round(55 + rng() * 40);
    const updatedAt = new Date(now - Math.floor(rng() * 1000 * 60 * 60 * 24 * 14)).toISOString();

    return {
      id: `${service}_cand_${idx + 1}`,
      source: service,
      full_name: name,
      headline: `${role} • ${experienceYears} yrs`,
      location: pick(rng, cities),
      experience_years: experienceYears,
      skills: uniqueSkills,
      match_score: score,
      summary:
        experienceYears >= 5
          ? 'Senior profile with strong delivery ownership and cross-functional collaboration.'
          : 'Early-career profile with high learning velocity and good fundamentals.',
      last_updated_at: updatedAt,
    };
  });

  const jds = [
    { id: 'jd_1', title: 'Senior Software Engineer (React/Node)', location: 'Bengaluru', seniority: 'Senior' },
    { id: 'jd_2', title: 'Talent Acquisition Specialist', location: 'Hyderabad', seniority: 'Mid' },
    { id: 'jd_3', title: 'Payroll & Compliance Associate', location: 'Pune', seniority: 'Junior' },
  ];

  return { candidates, jds };
}

// Sample pull: a fast "see it" endpoint used by the new Integrations Hub.
router.post('/:service/sample-pull', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });

  const iQuery = new URLSearchParams();
  iQuery.set('organization_id', eq(orgId));
  iQuery.set('service_type', eq(service));
  iQuery.set('select', 'id,status');
  const rows = await safeQuery<Pick<StoredIntegrationRow, 'id' | 'status'>>(rest, 'integrations', iQuery);
  const integrationId = rows?.[0]?.id || null;
  const status = rows?.[0]?.status || 'disconnected';
  if (!integrationId || status !== 'connected') {
    return res.status(400).json({ success: false, error: 'Integration not connected' });
  }

  const sample = sampleCandidateData(orgId, service);
  await writeConnectionLog(rest, integrationId, 'sample_pull', 'success', 'Generated sample pull preview', {
    service,
    count: sample.candidates.length,
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });

  return res.json({ success: true, data: sample });
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
  const pkceVerifier = typeof parsedState.codeVerifier === 'string' ? parsedState.codeVerifier : undefined;
  const apiBase = getApiBaseUrl(req);
  const redirectUri = `${apiBase}${spec.oauthConfig.redirectPath}`;

  // Zoho sends a `location` query param (e.g. "in", "eu", "au") indicating which DC the
  // user's account lives in. The token exchange MUST go to accounts.zoho.{location} — if we
  // always use accounts.zoho.com Zoho returns invalid_code for non-US accounts.
  const zohoLocation = typeof req.query.location === 'string' ? req.query.location.trim().toLowerCase() : null;

  try {
    const rest = restAsService;
    let token: any = null;
    let tokenUrl = resolveUrlTemplate(spec.oauthConfig.tokenUrl, connection);

    // Override Zoho token URL to match the DC that issued the authorization code.
    if (zohoLocation && (service === 'zoho_people' || service === 'zoho_recruit' || service === 'zoho_learn')) {
      const zohoDomain = zohoLocation === 'com' ? 'zoho.com' : `zoho.${zohoLocation}`;
      tokenUrl = `https://accounts.${zohoDomain}/oauth/v2/token`;
      logger.info('Zoho DC-aware token exchange', { service, location: zohoLocation, tokenUrl });
    }
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
      } else if (service === 'salesforce') {
        clientIdEnv = 'SALESFORCE_CLIENT_ID';
        clientSecretEnv = 'SALESFORCE_CLIENT_SECRET';
      } else if (service === 'intercom') {
        clientIdEnv = 'INTERCOM_CLIENT_ID';
        clientSecretEnv = 'INTERCOM_CLIENT_SECRET';
      } else if (service === 'quickbooks') {
        clientIdEnv = 'QUICKBOOKS_CLIENT_ID';
        clientSecretEnv = 'QUICKBOOKS_CLIENT_SECRET';
      } else {
        throw new Error('OAuth provider not implemented');
      }

      const clientId = secretOrNull(clientIdEnv);
      const clientSecret = clientSecretEnv ? secretOrNull(clientSecretEnv) : null;
      if (!clientId || !clientSecret) throw new Error('OAuth env vars are not configured');

      // QuickBooks (Intuit) requires credentials in Authorization: Basic header, not the POST body.
      if (service === 'quickbooks') {
        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        token = await postForm(tokenUrl, {
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code,
        }, { Authorization: `Basic ${basic}` });
      } else {
        token = await postForm(tokenUrl, {
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
          ...(pkceVerifier ? { code_verifier: pkceVerifier } : {}),
        });
      }
    }

    const accessToken = token?.access_token;
    const refreshToken = token?.refresh_token;
    const expiresIn = Number(token?.expires_in || token?.expires_in_sec || token?.expires || 0);

    if (!accessToken) {
      // Log the sanitised token response to aid debugging (no secret values)
      const safeToken = token ? Object.fromEntries(
        Object.entries(token).filter(([k]) => !['access_token','refresh_token','id_token'].includes(k))
      ) : null;
      logger.error('No access token in provider response', { service, safeToken });
      throw new Error(token?.error_description || token?.error || 'No access token returned by provider');
    }

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

    // For Slack: store team_id so the inbound webhook can route events to the correct org.
    if (service === 'slack' && token?.team?.id) {
      await upsertCredential(rest, integration.id, 'team_id', String(token.team.id), false, null);
    }

    // For Zoho: store api_domain returned in the token response (required for API calls).
    if ((service === 'zoho_people' || service === 'zoho_recruit' || service === 'zoho_learn') && token?.api_domain) {
      await upsertCredential(rest, integration.id, 'api_domain', String(token.api_domain), false, null);
    }

    await writeConnectionLog(rest, integration.id, 'connect', 'success', 'OAuth integration connected', { service, authType: 'oauth2' });

    const returnTo = safeReturnPath(parsedState.returnTo) || '/dashboard/integrations';
    const params = new URLSearchParams({ status: 'connected', service });
    return res.redirect(302, `${frontendUrl}${returnTo}?${params.toString()}`);
  } catch (err: any) {
    logger.warn('OAuth callback failed', { service, error: err?.message || String(err) });
    const params = new URLSearchParams({ status: 'error', service, message: err?.message || 'OAuth failed' });
    const errReturnTo = safeReturnPath((parsedState as any)?.returnTo) || '/dashboard/integrations';
    return res.redirect(302, `${frontendUrl}${errReturnTo}?${params.toString()}`);
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

  // Prepare stored credentials and a test payload (adapters expect sensitive fields to be encrypted).
  const storedCredentials: Record<string, string> = {};
  Object.entries(parsed.data.credentials).forEach(([key, value]) => {
    const descriptor = required.find((f) => f.name === key);
    const sensitive = descriptor ? descriptor.type === 'password' : true;
    storedCredentials[key] = sensitive
      ? encryptSecret(value)
      : (key.includes('domain') || key.includes('subdomain') ? normalizeDomainInput(value) : value);
  });

  const integration = await upsertIntegration(rest, orgId, spec.id, {
    // Optimistically connect; validation below can downgrade to error if needed.
    status: 'connected',
    auth_type: spec.authType,
    category: spec.category,
    service_name: spec.name,
    last_error_at: null,
    last_error_msg: null,
  });

  if (!integration?.id) return res.status(500).json({ success: false, error: 'Failed to store integration' });

  await Promise.all(Object.entries(storedCredentials).map(async ([key, stored]) => {
    const descriptor = required.find((f) => f.name === key);
    const sensitive = descriptor ? descriptor.type === 'password' : true;
    await upsertCredential(rest, integration.id, key, stored, sensitive);
  }));

  // Validate credentials with the adapter when available to avoid false "Connected" states.
  const adapter = getAdapter(service);
  if (!adapter) {
  await writeConnectionLog(rest, integration.id, 'connect', 'success', 'Credential integration stored (no adapter validation)', {
    service: spec.id,
    authType: spec.authType,
    validation: 'adapter_missing',
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });
    return res.json({ success: true, message: 'Integration stored', data: { id: integration.id, service: spec.id, validated: false } });
  }

  const testResult = await adapter.testConnection(storedCredentials);
  if (!testResult.success) {
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(integration.id));
    await rest('integrations', patchQuery, {
      method: 'PATCH',
      body: {
        status: 'error',
        last_error_at: new Date().toISOString(),
        last_error_msg: testResult.message || 'Credential validation failed',
        updated_at: new Date().toISOString(),
      },
    });

    await writeConnectionLog(rest, integration.id, 'connect', 'failed', testResult.message || 'Credential validation failed', {
      service: spec.id,
      authType: spec.authType,
      actor_user_id: req.user?.id || null,
      actor_email: req.user?.email || null,
    });
    return res.status(400).json({ success: false, error: testResult.message || 'Credential validation failed' });
  }

  const patchQuery = new URLSearchParams();
  patchQuery.set('id', eq(integration.id));
  await rest('integrations', patchQuery, {
    method: 'PATCH',
    body: {
      status: 'connected',
      last_error_at: null,
      last_error_msg: null,
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });

  await writeConnectionLog(rest, integration.id, 'connect', 'success', 'Credential integration connected (validated)', {
    service: spec.id,
    authType: spec.authType,
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });

  return res.json({ success: true, message: 'Integration connected', data: { id: integration.id, service: spec.id, validated: true } });
});

// Configure (store credentials without validation)
router.post('/:service/configure', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });
  if (spec.authType !== 'api_key' && spec.authType !== 'client_credentials') {
    return res.status(400).json({ success: false, error: 'Integration is not configurable via credentials' });
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

  const storedCredentials: Record<string, string> = {};
  Object.entries(parsed.data.credentials).forEach(([key, value]) => {
    const descriptor = required.find((f) => f.name === key);
    const sensitive = descriptor ? descriptor.type === 'password' : true;
    storedCredentials[key] = sensitive
      ? encryptSecret(value)
      : (key.includes('domain') || key.includes('subdomain') ? normalizeDomainInput(value) : value);
  });

  const integration = await upsertIntegration(rest, orgId, spec.id, {
    status: 'configured' as any,
    auth_type: spec.authType,
    category: spec.category,
    service_name: spec.name,
    last_error_at: null,
    last_error_msg: null,
  });

  if (!integration?.id) return res.status(500).json({ success: false, error: 'Failed to store integration' });

  await Promise.all(Object.entries(storedCredentials).map(async ([key, stored]) => {
    const descriptor = required.find((f) => f.name === key);
    const sensitive = descriptor ? descriptor.type === 'password' : true;
    await upsertCredential(rest, integration.id, key, stored, sensitive);
  }));

  await writeConnectionLog(rest, integration.id, 'configure', 'success', 'Credentials stored (not validated)', {
    service: spec.id,
    authType: spec.authType,
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });

  return res.json({ success: true, message: 'Integration configured', data: { id: integration.id, service: spec.id } });
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

  await writeConnectionLog(rest, row.id, 'disconnect', 'success', 'Integration disconnected', {
    service,
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });

  try {
    await pruneDisconnectedIntegrationFromAgents(rest, orgId, service);
  } catch (err: any) {
    logger.warn('Failed to prune disconnected integration from agent publish state', {
      service,
      org_id: orgId,
      error: err?.message || String(err),
    });
  }

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

  await writeConnectionLog(rest, row.id, 'test', result.success ? 'success' : 'failed', result.message, {
    service,
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });

  return res.json({ success: true, data: result });
});

// ─── Slack Inbox ──────────────────────────────────────────────────────────────

// GET /api/integrations/slack/messages
// List inbound Slack messages for the authenticated org.
router.get('/slack/messages', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;

  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('order', 'created_at.desc');
  query.set('limit', String(limit));
  query.set('offset', String(offset));
  query.set('select', 'id,slack_channel_id,slack_channel_name,slack_user_id,slack_user_name,slack_ts,thread_ts,text,event_type,status,metadata,created_at,updated_at');
  if (statusFilter) query.set('status', eq(statusFilter));

  const messages = await safeQuery<Record<string, any>>(rest, 'slack_messages', query);
  return res.json({ success: true, data: messages });
});

// POST /api/integrations/slack/messages/:id/reply
// Send a reply into the Slack thread and mark the message as replied.
router.post('/slack/messages/:id/reply', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const messageId = req.params.id;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ success: false, error: 'text is required' });

  const rest = restAsUser(req);

  // Load the target message (RLS enforces org ownership)
  const messages = await safeQuery<Record<string, any>>(
    rest,
    'slack_messages',
    new URLSearchParams({ id: eq(messageId), organization_id: eq(orgId), select: '*', limit: '1' }),
  );
  if (!messages.length) return res.status(404).json({ success: false, error: 'Message not found' });
  const message = messages[0];

  // Load Slack integration for this org
  const integrations = await safeQuery<StoredIntegrationRow>(
    restAsService,
    'integrations',
    new URLSearchParams({ organization_id: eq(orgId), service_type: eq('slack'), status: eq('connected'), select: 'id', limit: '1' }),
  );
  if (!integrations.length) return res.status(400).json({ success: false, error: 'Slack integration not connected' });

  // Load access_token credential
  const creds = await safeQuery<StoredCredentialRow>(
    restAsService,
    'integration_credentials',
    new URLSearchParams({ integration_id: eq(integrations[0].id), key: eq('access_token'), select: 'value', limit: '1' }),
  );
  if (!creds.length) return res.status(400).json({ success: false, error: 'Slack access token not found' });

  const accessToken = decryptSecret(creds[0].value);

  // Post to Slack as a threaded reply
  const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: message.slack_channel_id,
      text,
      thread_ts: message.slack_ts,
    }),
  });
  const slackJson: any = await slackRes.json().catch(() => null);
  if (!slackJson?.ok) {
    return res.status(502).json({ success: false, error: slackJson?.error || 'Slack API error' });
  }

  // Mark message as replied
  await restAsService(
    'slack_messages',
    new URLSearchParams({ id: eq(messageId), organization_id: eq(orgId) }),
    { method: 'PATCH', body: { status: 'replied', updated_at: new Date().toISOString() } },
  );

  return res.json({ success: true, data: { slack_ts: slackJson.ts } });
});

// POST /api/integrations/slack/messages/:id/status
// Update the status of a Slack message (reviewed / dismissed / new).
router.post('/slack/messages/:id/status', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const messageId = req.params.id;
  const status = typeof req.body?.status === 'string' ? req.body.status : '';
  const validStatuses = ['new', 'reviewed', 'replied', 'dismissed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  const rest = restAsUser(req);
  await rest(
    'slack_messages',
    new URLSearchParams({ id: eq(messageId), organization_id: eq(orgId) }),
    { method: 'PATCH', body: { status, updated_at: new Date().toISOString() } },
  );

  return res.json({ success: true });
});

export default router;
