import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { supabaseRestAsService, supabaseRestAsUser, eq, in_ } from '../lib/supabase-rest';
import { requirePermission } from '../middleware/rbac';
import { logger } from '../lib/logger';
import { auditLog } from '../lib/audit-logger';
import { buildUsageSeries, getApiKeyUsageState, summarizeUsage } from '../lib/api-key-usage';

const router = express.Router();

const PRESET_PERMISSIONS: Record<string, string[]> = {
  read_only: ['agents.read'],
  operations: ['agents.read', 'agents.update', 'incidents.read', 'incidents.create'],
  billing: ['costs.read'],
  full_access: ['agents.read', 'agents.update', 'costs.read', 'incidents.read', 'incidents.create', 'incidents.update'],
};

const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name required').max(255),
  environment: z.enum(['production', 'staging', 'development']).default('production'),
  preset: z.enum(['read_only', 'operations', 'billing', 'full_access', 'custom']).default('read_only'),
  permissions: z.array(z.string()).optional().default([]),
  description: z.string().max(500).optional(),
  expiresAt: z.string().optional(),
  manager_ids: z.array(z.string().uuid()).optional(),
  rateLimit: z.number().int().min(10).max(100000).optional().default(1000),
});

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: z.enum(['active', 'expired', 'revoked']).optional(),
  environment: z.enum(['production', 'staging', 'development']).optional(),
  preset: z.enum(['read_only', 'operations', 'billing', 'full_access', 'custom']).optional(),
  permissions: z.array(z.string()).optional(),
  manager_ids: z.array(z.string().uuid()).optional(),
  expiresAt: z.string().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  rateLimit: z.number().int().min(10).max(100000).optional(),
});

const generateApiKey = (): { key: string; keyHash: string; lastFour: string } => {
  const key = `sk_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  const lastFour = key.slice(-4);
  return { key, keyHash, lastFour };
};

const getOrgId = (req: Request): string | null => req.user?.organization_id || null;

const getUserJwt = (req: Request): string => {
  const jwt = (req as any).userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

async function listOrganizationUsers(orgId: string, userJwt: string) {
  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('select', '*');
  const users = (await supabaseRestAsUser(userJwt, 'users', query)) as any[];
  return users || [];
}

async function getDefaultManagerIds(orgId: string, userJwt: string) {
  const users = await listOrganizationUsers(orgId, userJwt);
  const admins = users
    .filter((user) => ['super_admin', 'admin'].includes(user.role))
    .map((user) => user.id);
  return admins;
}

function resolvePermissions(preset: string, permissions: string[]) {
  if (preset === 'custom') {
    return Array.from(new Set(permissions));
  }
  return PRESET_PERMISSIONS[preset] || Array.from(new Set(permissions));
}

function getMetadata(record: any): Record<string, any> {
  return (record?.metadata || {}) as Record<string, any>;
}

function buildMaskedKey(record: any) {
  return `sk_••••••••••••••••${record.last_four || '••••'}`;
}

async function enrichApiKeyRecord(record: any, orgUsers: any[], usageState?: Awaited<ReturnType<typeof getApiKeyUsageState>>) {
  const metadata = getMetadata(record);
  const permissions = Array.isArray(metadata.permissions) ? metadata.permissions : [];
  const preset = metadata.preset || 'custom';
  const managerIds = Array.isArray(metadata.manager_ids) ? metadata.manager_ids : [];
  const createdBy = metadata.created_by || null;
  const createdByUser = orgUsers.find((user) => user.id === createdBy);
  const managerUsers = managerIds
    .map((id) => orgUsers.find((user) => user.id === id))
    .filter(Boolean)
    .map((user) => ({ id: user.id, email: user.email, name: user.full_name || user.name || user.email, role: user.role }));
  const usage = usageState ? summarizeUsage(usageState, record.id, 30) : { totalRequests: 0, totalErrors: 0, series: [] };
  const usage7d = usageState ? summarizeUsage(usageState, record.id, 7) : { totalRequests: 0, totalErrors: 0, series: [] };

  return {
    id: record.id,
    name: record.name,
    status: record.status || 'active',
    environment: metadata.environment || 'production',
    masked_key: buildMaskedKey(record),
    key_prefix: `sk_...${record.last_four || '••••'}`,
    created_at: record.created_at,
    created_by: createdBy,
    created_by_user: createdByUser
      ? { id: createdByUser.id, email: createdByUser.email, name: createdByUser.full_name || createdByUser.email, role: createdByUser.role }
      : createdBy
        ? { id: createdBy, name: 'Unknown user', email: '', role: 'unknown' }
        : null,
    last_used: record.last_used || null,
    permissions,
    preset,
    manager_ids: managerIds,
    manager_users: managerUsers.length > 0
      ? managerUsers
      : managerIds.map((id) => ({ id, name: 'Unknown user', email: '', role: 'unknown' })),
    description: metadata.description || null,
    expires_at: metadata.expires_at || null,
    rate_limit: record.rate_limit_per_minute || null,
    usage_7d: usage7d.series,
    usage_30d: usage.series,
    requests_30d: usage.totalRequests,
    errors_30d: usage.totalErrors,
  };
}

async function getApiKeyRecord(id: string, orgId: string, userJwt: string) {
  const query = new URLSearchParams();
  query.set('id', eq(id));
  query.set('organization_id', eq(orgId));
  const rows = (await supabaseRestAsUser(userJwt, 'api_keys', query)) as any[];
  return rows?.[0] || null;
}

async function writeApiKeyRecord(id: string, orgId: string, body: Record<string, any>, userJwt: string) {
  const query = new URLSearchParams();
  query.set('id', eq(id));
  query.set('organization_id', eq(orgId));
  const rows = (await supabaseRestAsUser(userJwt, 'api_keys', query, {
    method: 'PATCH',
    body,
  })) as any[];
  return rows?.[0] || null;
}

router.post('/api-keys', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const parsed = createApiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map((item) => item.message),
      });
    }

    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const userJwt = getUserJwt(req);
    const { name, environment, preset, permissions, description, expiresAt, rateLimit } = parsed.data;
    const managerIds = parsed.data.manager_ids && parsed.data.manager_ids.length > 0
      ? parsed.data.manager_ids
      : await getDefaultManagerIds(orgId, userJwt);

    const resolvedPermissions = resolvePermissions(preset, permissions);
    const { key, keyHash, lastFour } = generateApiKey();

    const apiKeyData = {
      organization_id: orgId,
      name,
      key_hash: keyHash,
      last_four: lastFour,
      rate_limit_per_minute: rateLimit,
      rate_limit_per_day: rateLimit * 60 * 24,
      status: 'active',
      allowed_models: ['gpt-4', 'gpt-4o', 'claude-3'],
      metadata: {
        permissions: resolvedPermissions,
        environment,
        preset,
        manager_ids: managerIds,
        created_by: req.user?.id || null,
        description: description || null,
        expires_at: expiresAt || null,
      },
    };

    const created = (await supabaseRestAsUser(userJwt, 'api_keys', '', {
      method: 'POST',
      body: apiKeyData,
    })) as any[];

    if (!created || created.length === 0) {
      throw new Error('Failed to create API key');
    }

    auditLog.log({
      user_id: req.user?.id || 'unknown',
      action: 'api_key.created',
      resource_type: 'api_key',
      resource_id: created[0].id,
      organization_id: orgId,
      metadata: { name, preset, permissions: resolvedPermissions, environment, manager_ids: managerIds },
    });

    const users = await listOrganizationUsers(orgId, userJwt);
    const usageState = await getApiKeyUsageState(orgId);
    const safeRecord = await enrichApiKeyRecord(created[0], users, usageState);

    return res.status(201).json({
      success: true,
      data: {
        ...safeRecord,
        key,
      },
      warning: 'Copy this token now. You will not be able to see it again.',
    });
  } catch (error: any) {
    logger.error('API key creation failed', { error: error.message });
    return res.status(500).json({ success: false, error: error.message || 'Failed to create API key' });
  }
});

router.get('/api-keys', requirePermission('settings.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }
    const userJwt = getUserJwt(req);

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    const keys = (await supabaseRestAsUser(userJwt, 'api_keys', query)) as any[];

    const users = await listOrganizationUsers(orgId, userJwt);
    const usageState = await getApiKeyUsageState(orgId);
    const safeKeys = await Promise.all((keys || []).map((record) => enrichApiKeyRecord(record, users, usageState)));

    return res.json({ success: true, data: safeKeys, count: safeKeys.length });
  } catch (error: any) {
    logger.error('API keys list failed', { error: error.message });
    return res.status(500).json({ success: false, error: error.message || 'Failed to load API keys' });
  }
});

router.get('/api-keys/:id', requirePermission('settings.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }
    const userJwt = getUserJwt(req);

    const record = await getApiKeyRecord(req.params.id, orgId, userJwt);
    if (!record) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }

    const users = await listOrganizationUsers(orgId, userJwt);
    const usageState = await getApiKeyUsageState(orgId);
    const safeRecord = await enrichApiKeyRecord(record, users, usageState);
    return res.json({ success: true, data: safeRecord });
  } catch (error: any) {
    logger.error('API key retrieval failed', { error: error.message });
    return res.status(500).json({ success: false, error: error.message || 'Failed to load API key' });
  }
});

router.get('/api-keys/:id/activity', requirePermission('settings.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }
    const userJwt = getUserJwt(req);

    const record = await getApiKeyRecord(req.params.id, orgId, userJwt);
    if (!record) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }

    const usageState = await getApiKeyUsageState(orgId);
    return res.json({
      success: true,
      data: {
        usage_7d: buildUsageSeries(usageState, req.params.id, 7),
        usage_30d: buildUsageSeries(usageState, req.params.id, 30),
      },
    });
  } catch (error: any) {
    logger.error('API key activity load failed', { error: error.message });
    return res.status(500).json({ success: false, error: error.message || 'Failed to load API key activity' });
  }
});

router.patch('/api-keys/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const parsed = updateApiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map((item) => item.message),
      });
    }

    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const userJwt = getUserJwt(req);
    const current = await getApiKeyRecord(req.params.id, orgId, userJwt);
    if (!current) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }

    const currentMetadata = getMetadata(current);
    const nextPreset = parsed.data.preset || currentMetadata.preset || 'custom';
    const nextPermissions = parsed.data.permissions !== undefined
      ? resolvePermissions(nextPreset, parsed.data.permissions)
      : (currentMetadata.permissions || []);

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.rateLimit !== undefined) {
      updates.rate_limit_per_minute = parsed.data.rateLimit;
      updates.rate_limit_per_day = parsed.data.rateLimit * 60 * 24;
    }

    updates.metadata = {
      ...currentMetadata,
      permissions: nextPermissions,
      environment: parsed.data.environment || currentMetadata.environment || 'production',
      preset: nextPreset,
      manager_ids: parsed.data.manager_ids || currentMetadata.manager_ids || [],
      expires_at: parsed.data.expiresAt !== undefined ? parsed.data.expiresAt : (currentMetadata.expires_at || null),
      description: parsed.data.description !== undefined ? parsed.data.description : (currentMetadata.description || null),
      created_by: currentMetadata.created_by || null,
    };

    const updated = await writeApiKeyRecord(req.params.id, orgId, updates, userJwt);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }

    auditLog.log({
      user_id: req.user?.id || 'unknown',
      action: 'api_key.updated',
      resource_type: 'api_key',
      resource_id: req.params.id,
      organization_id: orgId,
      metadata: { changes: parsed.data },
    });

    const users = await listOrganizationUsers(orgId, userJwt);
    const usageState = await getApiKeyUsageState(orgId);
    const safeRecord = await enrichApiKeyRecord(updated, users, usageState);
    return res.json({ success: true, data: safeRecord });
  } catch (error: any) {
    logger.error('API key update failed', { error: error.message });
    return res.status(500).json({ success: false, error: error.message || 'Failed to update API key' });
  }
});

router.delete('/api-keys/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const userJwt = getUserJwt(req);
    const current = await getApiKeyRecord(req.params.id, orgId, userJwt);
    if (!current) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }

    const updated = await writeApiKeyRecord(req.params.id, orgId, {
      status: 'revoked',
      updated_at: new Date().toISOString(),
    }, userJwt);

    // PostgREST can legally return an empty body for PATCH (204) depending on RLS/Prefer support.
    // If the key exists but the user-scoped update returns no representation, fall back to
    // a service-role update scoped by org.
    if (!updated) {
      const query = new URLSearchParams();
      query.set('id', eq(req.params.id));
      query.set('organization_id', eq(orgId));
      const rows = (await supabaseRestAsService('api_keys', query, {
        method: 'PATCH',
        body: {
          status: 'revoked',
          updated_at: new Date().toISOString(),
        },
      })) as any[] | null;

      if (!rows || rows.length === 0) {
        return res.status(500).json({ success: false, error: 'Failed to revoke API key' });
      }
    }

    auditLog.log({
      user_id: req.user?.id || 'unknown',
      action: 'api_key.revoked',
      resource_type: 'api_key',
      resource_id: req.params.id,
      organization_id: orgId,
      metadata: { reason: 'User revocation' },
    });

    return res.json({ success: true, message: 'API key revoked successfully' });
  } catch (error: any) {
    logger.error('API key revocation failed', { error: error.message });
    return res.status(500).json({ success: false, error: error.message || 'Failed to revoke API key' });
  }
});

router.post('/api-keys/:id/refresh', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const userJwt = getUserJwt(req);
    const current = await getApiKeyRecord(req.params.id, orgId, userJwt);
    if (!current) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }

    const { key, keyHash, lastFour } = generateApiKey();
    const updated = await writeApiKeyRecord(req.params.id, orgId, {
      key_hash: keyHash,
      last_four: lastFour,
      last_used: null,
      updated_at: new Date().toISOString(),
    }, userJwt);

    auditLog.log({
      user_id: req.user?.id || 'unknown',
      action: 'api_key.rotated',
      resource_type: 'api_key',
      resource_id: req.params.id,
      organization_id: orgId,
      metadata: { rotation_reason: 'User initiated rotation' },
    });

    const users = await listOrganizationUsers(orgId, userJwt);
    const usageState = await getApiKeyUsageState(orgId);
    const safeRecord = await enrichApiKeyRecord(updated, users, usageState);

    return res.json({
      success: true,
      data: {
        ...safeRecord,
        key,
      },
      warning: 'Copy this new token now. The previous token is no longer valid.',
    });
  } catch (error: any) {
    logger.error('API key rotation failed', { error: error.message });
    return res.status(500).json({ success: false, error: error.message || 'Failed to rotate API key' });
  }
});

export default router;
