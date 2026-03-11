import express, { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../lib/logger';
import { supabaseRestAsUser, eq } from '../lib/supabase-rest';
import {
  buildSyncProvidersWithRuntimeStatus,
  getProviderSyncSchedulerStatus,
  type ProviderReconciliationEntry,
  type ProviderSyncConfigEntry,
  syncEnabledProviderCostsForAllOrganizations,
  syncProviderCostsForOrganization,
  testProviderConnectionForOrganization,
  upsertProviderSyncEntry,
} from '../lib/provider-sync';
import { deriveReconciliationAlerts, getReconciliationAlertConfig } from '../lib/reconciliation-alerts';
import { requireRole } from '../middleware/rbac';

const router = express.Router();

const getUserJwt = (req: Request): string => {
  const jwt = (req as any).userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

// Role assignment schema
const assignRoleSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  role: z.enum(['super_admin', 'admin', 'manager', 'viewer']),
});

const providerReconciliationSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'google', 'openrouter', 'other']),
  reportedSpendUsd: z.number().min(0),
  source: z.enum(['manual', 'api']).default('manual'),
  lastSyncedAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional().nullable(),
});

const providerSyncConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'google', 'openrouter', 'other']),
  enabled: z.boolean().default(true),
  organizationId: z.string().min(1).optional().nullable(),
  projectId: z.string().min(1).optional().nullable(),
});

const reconciliationAlertConfigSchema = z.object({
  channels: z.object({
    inApp: z.boolean(),
    email: z.boolean(),
    webhook: z.boolean(),
  }),
  thresholds: z.object({
    absoluteGapUsd: z.number().min(0),
    relativeGapRatio: z.number().min(0).max(1),
    staleSyncHours: z.number().min(1).max(720),
  }),
});

/**
 * Assign role to a user (super_admin only)
 * POST /admin/assign-role
 */
router.post('/assign-role', requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const result = assignRoleSchema.safeParse(req.body);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map(e => e.message),
      });
    }

    const { userId, role } = result.data;
    const orgId = req.user?.organization_id;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'Organization not found',
      });
    }

    logger.info('Assigning role', { 
      userId, 
      role, 
      assignedBy: req.user?.id,
      organization: orgId 
    });

    // Update user role in users table
    const query = new URLSearchParams();
    query.set('id', `eq.${encodeURIComponent(userId)}`);
    query.set('organization_id', `eq.${encodeURIComponent(orgId)}`);

    const data = await supabaseRestAsUser(
      getUserJwt(req),
      'users',
      query,
      {
        method: 'PATCH',
        body: { role, updated_at: new Date().toISOString() },
      }
    );

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found in this organization',
      });
    }

    logger.info('Role assigned successfully', { userId, role });

    res.json({
      success: true,
      message: `Role '${role}' assigned to user successfully`,
      data: data[0],
    });
  } catch (error: any) {
    logger.error('Role assignment failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to assign role',
    });
  }
});

/**
 * Get all users in organization with roles (admin+)
 * GET /admin/users
 */
router.get('/users', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'Organization not found',
      });
    }

    logger.info('Fetching organization users', { organization: orgId });

    const query = new URLSearchParams();
    query.set('organization_id', `eq.${encodeURIComponent(orgId)}`);
    query.set('select', '*');
    query.set('order', 'created_at.desc');

    const data = await supabaseRestAsUser(getUserJwt(req), 'users', query);

    res.json({
      success: true,
      data,
      count: data?.length || 0,
    });
  } catch (error: any) {
    logger.error('Failed to fetch users', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users',
    });
  }
});

/**
 * Get organization coverage and readiness status (admin only)
 * GET /admin/coverage-status
 */
router.get('/coverage-status', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'Organization not found',
      });
    }

    const buildOrgQuery = () => {
      const query = new URLSearchParams();
      query.set('id', eq(orgId));
      query.set('limit', '1');
      return query;
    };

    const buildScopedQuery = (order?: string, limit?: number) => {
      const query = new URLSearchParams();
      query.set('organization_id', eq(orgId));
      if (order) query.set('order', order);
      if (limit) query.set('limit', String(limit));
      return query;
    };

    const [
      organizations,
      users,
      agents,
      apiKeys,
      costs,
      incidents,
      pendingInvites,
    ] = await Promise.all([
      supabaseRestAsUser(getUserJwt(req), 'organizations', buildOrgQuery()),
      supabaseRestAsUser(getUserJwt(req), 'users', buildScopedQuery('created_at.asc')),
      supabaseRestAsUser(getUserJwt(req), 'ai_agents', buildScopedQuery('created_at.desc')),
      supabaseRestAsUser(getUserJwt(req), 'api_keys', buildScopedQuery('created_at.desc')),
      supabaseRestAsUser(getUserJwt(req), 'cost_tracking', buildScopedQuery('created_at.desc', 250)),
      supabaseRestAsUser(getUserJwt(req), 'incidents', buildScopedQuery('created_at.desc', 100)),
      supabaseRestAsUser(getUserJwt(req), 'invites', (() => {
        const query = buildScopedQuery('created_at.desc');
        query.set('status', eq('pending'));
        return query;
      })()),
    ]);

    const organization = Array.isArray(organizations) ? organizations[0] : null;
    const userRows = Array.isArray(users) ? users as any[] : [];
    const agentRows = Array.isArray(agents) ? agents as any[] : [];
    const apiKeyRows = Array.isArray(apiKeys) ? apiKeys as any[] : [];
    const costRows = Array.isArray(costs) ? costs as any[] : [];
    const incidentRows = Array.isArray(incidents) ? incidents as any[] : [];
    const inviteRows = Array.isArray(pendingInvites) ? pendingInvites as any[] : [];

    const adminUsers = userRows.filter((user) => ['super_admin', 'admin'].includes(String(user.role || '').toLowerCase()));
    const operatorUsers = userRows.filter((user) => ['super_admin', 'admin', 'manager'].includes(String(user.role || '').toLowerCase()));
    const activeAgents = agentRows.filter((agent) => agent.status === 'active');
    const pausedAgents = agentRows.filter((agent) => agent.status === 'paused');
    const activeKeys = apiKeyRows.filter((key) => key.status === 'active');
    const recentKeyUsage = activeKeys
      .map((key) => key.last_used)
      .filter(Boolean)
      .sort()
      .reverse();
    const openIncidents = incidentRows.filter((incident) => !['resolved', 'false_positive'].includes(String(incident.status || '').toLowerCase()));
    const criticalIncidents = openIncidents.filter((incident) => String(incident.severity || '').toLowerCase() === 'critical');
    const latestTrackedRecord = costRows
      .slice()
      .sort((a, b) => new Date(b.created_at || b.date).getTime() - new Date(a.created_at || a.date).getTime())[0] || null;
    const totalRequests30d = costRows.reduce((sum, row) => sum + Number(row.request_count || 0), 0);
    const totalTokens30d = costRows.reduce((sum, row) => sum + Number(row.total_tokens || 0), 0);
    const totalSpend30d = costRows.reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);
    const gatewayObserved = Boolean(latestTrackedRecord);
    const currentUserProfileReady = userRows.some((user) => user.id === req.user?.id && user.organization_id === orgId);
    const settings = (organization?.settings || {}) as Record<string, any>;
    const reconciliationAlertConfig = getReconciliationAlertConfig(settings);
    const providerEntries = Array.isArray(settings?.providerReconciliation?.providers)
      ? settings.providerReconciliation.providers as ProviderReconciliationEntry[]
      : [];
    const providerSyncEntries = Array.isArray(settings?.providerSync?.providers)
      ? settings.providerSync.providers as ProviderSyncConfigEntry[]
      : [];
    const providerSyncHistory = Array.isArray(settings?.providerSync?.history)
      ? settings.providerSync.history as Array<{
          provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
          ok: boolean;
          message: string;
          runAt: string;
          trigger: 'manual' | 'scheduler';
          importedSpendUsd?: number | null;
        }>
      : [];
    const reconciliationNotificationHistory = Array.isArray(settings?.reconciliationNotifications?.history)
      ? settings.reconciliationNotifications.history as Array<{
          id: string;
          code: string;
          provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other' | 'all';
          severity: 'warning' | 'critical';
          title: string;
          message: string;
          sentAt: string;
        }>
      : [];
    const providerSyncRuntime = buildSyncProvidersWithRuntimeStatus(providerSyncEntries);
    const totalProviderReportedSpendUsd = providerEntries.length > 0
      ? Number(providerEntries.reduce((sum, entry) => sum + Number(entry.reportedSpendUsd || 0), 0).toFixed(6))
      : null;
    const lastProviderSyncAt = providerEntries
      .map((entry) => entry.lastSyncedAt)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;
    const gapUsd = totalProviderReportedSpendUsd === null
      ? null
      : Number((totalProviderReportedSpendUsd - totalSpend30d).toFixed(6));
    const reconciliationAlerts = deriveReconciliationAlerts({
      totalSpend30d,
      totalProviderReportedSpendUsd,
      gapUsd,
      providerSyncEntries: providerSyncRuntime,
      config: reconciliationAlertConfig,
    });

    let coverageScore = 0;
    if (organization) coverageScore += 20;
    if (adminUsers.length > 0) coverageScore += 20;
    if (activeAgents.length > 0) coverageScore += 15;
    if (activeKeys.length > 0) coverageScore += 15;
    if (gatewayObserved) coverageScore += 20;
    if (recentKeyUsage.length > 0) coverageScore += 10;

    const notes: string[] = [];
    if (!organization) notes.push('Organization record is missing.');
    if (adminUsers.length === 0) notes.push('No admin or super admin operator is assigned to this organization.');
    if (!currentUserProfileReady) notes.push('The current signed-in user is not fully mapped in the users profile table.');
    if (activeAgents.length === 0) notes.push('No active agents are registered yet.');
    if (activeKeys.length === 0) notes.push('No active RASI API keys are available for tracked traffic.');
    if (!gatewayObserved) notes.push('No RASI-observed traffic has been recorded yet.');
    if (providerEntries.length === 0) notes.push('Provider-reported spend has not been recorded yet, so invoice reconciliation is incomplete.');
    if (inviteRows.length > 0) notes.push(`${inviteRows.length} pending team invite${inviteRows.length === 1 ? '' : 's'} still require acceptance.`);

    const status = coverageScore >= 85
      ? 'healthy'
      : coverageScore >= 55
        ? 'partial'
        : 'at_risk';

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        organization: organization
          ? {
              id: organization.id,
              name: organization.name,
              slug: organization.slug,
              plan: organization.plan,
              createdAt: organization.created_at,
            }
          : null,
        bootstrap: {
          organizationReady: Boolean(organization),
          currentUserProfileReady,
          operatorReady: adminUsers.length > 0,
          pendingInvites: inviteRows.length,
        },
        users: {
          total: userRows.length,
          admins: adminUsers.length,
          operators: operatorUsers.length,
        },
        agents: {
          total: agentRows.length,
          active: activeAgents.length,
          paused: pausedAgents.length,
          terminated: agentRows.filter((agent) => agent.status === 'terminated').length,
        },
        apiKeys: {
          total: apiKeyRows.length,
          active: activeKeys.length,
          recentlyUsed30d: activeKeys.filter((key) => key.last_used).length,
          lastUsedAt: recentKeyUsage[0] || null,
        },
        telemetry: {
          gatewayObserved,
          coverageScore,
          status,
          lastTrackedAt: latestTrackedRecord?.created_at || latestTrackedRecord?.date || null,
          lastTrackedModel: latestTrackedRecord?.model_name || null,
          lastTrackedEndpoint: latestTrackedRecord?.metadata?.endpoint || null,
          costRecords30d: costRows.length,
          requests30d: totalRequests30d,
          tokens30d: totalTokens30d,
          spend30dUsd: Number(totalSpend30d.toFixed(6)),
        },
        providerReconciliation: {
          configured: providerEntries.length > 0,
          totalReportedSpendUsd: totalProviderReportedSpendUsd,
          gapUsd,
          lastSyncedAt: lastProviderSyncAt,
          providers: providerEntries,
        },
        providerSync: {
          providers: providerSyncRuntime,
          history: providerSyncHistory,
          scheduler: getProviderSyncSchedulerStatus(),
        },
        reconciliationAlerts,
        reconciliationAlertConfig,
        reconciliationNotifications: {
          history: reconciliationNotificationHistory,
        },
        incidents: {
          open: openIncidents.length,
          critical: criticalIncidents.length,
          lastIncidentAt: incidentRows[0]?.created_at || null,
        },
        notes,
      },
    });
  } catch (error: any) {
    logger.error('Failed to load coverage status', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to load coverage status',
    });
  }
});

router.put('/provider-sync-config', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const result = providerSyncConfigSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map((e) => e.message),
      });
    }

    const query = new URLSearchParams();
    query.set('id', eq(orgId));
    query.set('limit', '1');
    const organizations = await supabaseRestAsUser(getUserJwt(req), 'organizations', query) as any[];
    const organization = organizations?.[0];
    if (!organization) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }

    const settings = { ...(organization.settings || {}) } as Record<string, any>;
    const existingProviders = Array.isArray(settings?.providerSync?.providers)
      ? settings.providerSync.providers as ProviderSyncConfigEntry[]
      : [];
    const now = new Date().toISOString();
    const nextEntry: ProviderSyncConfigEntry = {
      provider: result.data.provider,
      enabled: result.data.enabled,
      organizationId: result.data.organizationId || null,
      projectId: result.data.projectId || null,
      updatedAt: now,
      updatedBy: req.user?.id || null,
      lastTestAt: existingProviders.find((e) => e.provider === result.data.provider)?.lastTestAt || null,
      lastTestStatus: existingProviders.find((e) => e.provider === result.data.provider)?.lastTestStatus || null,
      lastTestMessage: existingProviders.find((e) => e.provider === result.data.provider)?.lastTestMessage || null,
      lastSyncAt: existingProviders.find((e) => e.provider === result.data.provider)?.lastSyncAt || null,
      lastSyncStatus: existingProviders.find((e) => e.provider === result.data.provider)?.lastSyncStatus || null,
      lastSyncMessage: existingProviders.find((e) => e.provider === result.data.provider)?.lastSyncMessage || null,
    };

    const mergedProviders = upsertProviderSyncEntry(existingProviders, nextEntry);

    const nextSettings = {
      ...settings,
      providerSync: {
        providers: mergedProviders,
        updatedAt: now,
        updatedBy: req.user?.id || null,
      },
    };

    await supabaseRestAsUser(getUserJwt(req), 'organizations', query, {
      method: 'PATCH',
      body: {
        settings: nextSettings,
        updated_at: now,
      },
    });

    res.json({ success: true, data: { providers: mergedProviders } });
  } catch (error: any) {
    logger.error('Failed to update provider sync config', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update provider sync config' });
  }
});

router.put('/reconciliation-alert-config', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const result = reconciliationAlertConfigSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map((e) => e.message),
      });
    }

    const query = new URLSearchParams();
    query.set('id', eq(orgId));
    query.set('limit', '1');
    const organizations = await supabaseRestAsUser(getUserJwt(req), 'organizations', query) as any[];
    const organization = organizations?.[0];
    if (!organization) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }

    const settings = { ...(organization.settings || {}) } as Record<string, any>;
    const now = new Date().toISOString();
    const nextConfig = {
      channels: {
        inApp: result.data.channels.inApp,
        email: result.data.channels.email,
        webhook: result.data.channels.webhook,
      },
      thresholds: {
        absoluteGapUsd: result.data.thresholds.absoluteGapUsd,
        relativeGapRatio: result.data.thresholds.relativeGapRatio,
        staleSyncHours: result.data.thresholds.staleSyncHours,
      },
      updatedAt: now,
      updatedBy: req.user?.id || null,
    };

    await supabaseRestAsUser(getUserJwt(req), 'organizations', query, {
      method: 'PATCH',
      body: {
        settings: {
          ...settings,
          reconciliationAlertConfig: nextConfig,
        },
        updated_at: now,
      },
    });

    return res.json({
      success: true,
      data: nextConfig,
    });
  } catch (error: any) {
    logger.error('Failed to update reconciliation alert config', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to update reconciliation alert config',
    });
  }
});

router.post('/provider-sync/openai/test', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const result = await testProviderConnectionForOrganization(orgId, 'openai');
    res.status(result.statusCode).json({
      success: result.ok,
      data: result.data,
      error: result.error,
    });
  } catch (error: any) {
    logger.error('Failed to test OpenAI sync connection', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to test OpenAI sync connection' });
  }
});

router.post('/provider-sync/openai/sync', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const result = await syncProviderCostsForOrganization({
      orgId,
      provider: 'openai',
      days: Number(req.body?.days || 30),
      actorId: req.user?.id || null,
    });
    return res.status(result.statusCode).json({
      success: result.ok,
      data: result.data,
      error: result.error,
    });
  } catch (error: any) {
    logger.error('Failed to sync OpenAI provider costs', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to sync OpenAI provider costs',
    });
  }
});

router.post('/provider-sync/anthropic/test', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const result = await testProviderConnectionForOrganization(orgId, 'anthropic');
    return res.status(result.statusCode).json({
      success: result.ok,
      data: result.data,
      error: result.error,
    });
  } catch (error: any) {
    logger.error('Failed to test Anthropic sync connection', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to test Anthropic sync connection' });
  }
});

router.post('/provider-sync/anthropic/sync', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const result = await syncProviderCostsForOrganization({
      orgId,
      provider: 'anthropic',
      days: Number(req.body?.days || 30),
      actorId: req.user?.id || null,
    });
    return res.status(result.statusCode).json({
      success: result.ok,
      data: result.data,
      error: result.error,
    });
  } catch (error: any) {
    logger.error('Failed to sync Anthropic provider costs', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to sync Anthropic provider costs',
    });
  }
});

router.post('/provider-sync/openrouter/test', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const result = await testProviderConnectionForOrganization(orgId, 'openrouter');
    return res.status(result.statusCode).json({
      success: result.ok,
      data: result.data,
      error: result.error,
    });
  } catch (error: any) {
    logger.error('Failed to test OpenRouter sync connection', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to test OpenRouter sync connection' });
  }
});

router.post('/provider-sync/openrouter/sync', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const result = await syncProviderCostsForOrganization({
      orgId,
      provider: 'openrouter',
      days: Number(req.body?.days || 30),
      actorId: req.user?.id || null,
    });
    return res.status(result.statusCode).json({
      success: result.ok,
      data: result.data,
      error: result.error,
    });
  } catch (error: any) {
    logger.error('Failed to sync OpenRouter provider costs', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to sync OpenRouter provider costs',
    });
  }
});

router.post('/provider-sync/run', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.body?.days || 30)));
    const result = await syncEnabledProviderCostsForAllOrganizations(days, 'manual');
    return res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Failed to run scheduled provider sync sweep', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to run provider sync sweep',
    });
  }
});

/**
 * Upsert provider reconciliation spend for the organization (admin only)
 * PUT /admin/provider-reconciliation
 */
router.put('/provider-reconciliation', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'Organization not found',
      });
    }

    const result = providerReconciliationSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map((e) => e.message),
      });
    }

    const query = new URLSearchParams();
    query.set('id', eq(orgId));
    query.set('limit', '1');

    const organizations = await supabaseRestAsUser(getUserJwt(req), 'organizations', query) as any[];
    const organization = organizations?.[0];
    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
      });
    }

    const settings = { ...(organization.settings || {}) } as Record<string, any>;
    const existingProviders = Array.isArray(settings?.providerReconciliation?.providers)
      ? settings.providerReconciliation.providers as ProviderReconciliationEntry[]
      : [];

    const now = new Date().toISOString();
    const nextEntry: ProviderReconciliationEntry = {
      provider: result.data.provider,
      reportedSpendUsd: Number(result.data.reportedSpendUsd.toFixed(6)),
      source: result.data.source,
      lastSyncedAt: result.data.lastSyncedAt || now,
      notes: result.data.notes || null,
      updatedAt: now,
    };

    const mergedProviders = [
      ...existingProviders.filter((entry) => entry.provider !== nextEntry.provider),
      nextEntry,
    ].sort((a, b) => a.provider.localeCompare(b.provider));

    const nextSettings = {
      ...settings,
      providerReconciliation: {
        providers: mergedProviders,
        updatedAt: now,
        updatedBy: req.user?.id || null,
      },
    };

    await supabaseRestAsUser(getUserJwt(req), 'organizations', query, {
      method: 'PATCH',
      body: {
        settings: nextSettings,
        updated_at: now,
      },
    });

    res.json({
      success: true,
      data: {
        providers: mergedProviders,
      },
      message: `Updated ${nextEntry.provider} provider reconciliation data`,
    });
  } catch (error: any) {
    logger.error('Failed to update provider reconciliation', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to update provider reconciliation',
    });
  }
});

/**
 * Remove provider reconciliation spend entry for the organization (admin only)
 * DELETE /admin/provider-reconciliation/:provider
 */
router.delete('/provider-reconciliation/:provider', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'Organization not found',
      });
    }

    const provider = req.params.provider as ProviderReconciliationEntry['provider'];
    if (!['openai', 'anthropic', 'google', 'openrouter', 'other'].includes(provider)) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported provider',
      });
    }

    const query = new URLSearchParams();
    query.set('id', eq(orgId));
    query.set('limit', '1');

    const organizations = await supabaseRestAsUser(getUserJwt(req), 'organizations', query) as any[];
    const organization = organizations?.[0];
    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
      });
    }

    const settings = { ...(organization.settings || {}) } as Record<string, any>;
    const existingProviders = Array.isArray(settings?.providerReconciliation?.providers)
      ? settings.providerReconciliation.providers as ProviderReconciliationEntry[]
      : [];

    const nextProviders = existingProviders.filter((entry) => entry.provider !== provider);
    const now = new Date().toISOString();
    const nextSettings = {
      ...settings,
      providerReconciliation: {
        providers: nextProviders,
        updatedAt: now,
        updatedBy: req.user?.id || null,
      },
    };

    await supabaseRestAsUser(getUserJwt(req), 'organizations', query, {
      method: 'PATCH',
      body: {
        settings: nextSettings,
        updated_at: now,
      },
    });

    res.json({
      success: true,
      data: {
        providers: nextProviders,
      },
      message: `Removed ${provider} provider reconciliation data`,
    });
  } catch (error: any) {
    logger.error('Failed to delete provider reconciliation', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to delete provider reconciliation',
    });
  }
});

/**
 * Remove user from organization (admin+)
 * DELETE /admin/users/:userId
 */
router.delete('/users/:userId', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const orgId = req.user?.organization_id;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'Organization not found',
      });
    }

    // Prevent self-removal
    if (userId === req.user?.id) {
      return res.status(400).json({
        success: false,
        error: 'You cannot remove yourself from the organization',
      });
    }

    logger.info('Removing user from organization', { 
      userId, 
      removedBy: req.user?.id,
      organization: orgId 
    });

    const query = new URLSearchParams();
    query.set('id', `eq.${encodeURIComponent(userId)}`);
    query.set('organization_id', `eq.${encodeURIComponent(orgId)}`);

    const data = await supabaseRestAsUser(
      getUserJwt(req),
      'users',
      query,
      { method: 'DELETE' }
    );

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found in this organization',
      });
    }

    logger.info('User removed from organization', { userId });

    res.json({
      success: true,
      message: 'User removed from organization successfully',
    });
  } catch (error: any) {
    logger.error('Failed to remove user', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to remove user',
    });
  }
});

// ===== MONITORING ENDPOINTS =====

/**
 * Get current metrics snapshot (admin only)
 * GET /admin/monitoring/metrics
 */
router.get('/monitoring/metrics', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { getMetricsSnapshot } = await import('../middleware/metrics');
    const { monitoring } = await import('../lib/monitoring');
    
    const metrics = getMetricsSnapshot();
    const resources = monitoring.getResourceMetrics();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      metrics,
      resources,
    });
  } catch (error: any) {
    logger.error('Failed to get metrics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve metrics',
    });
  }
});

/**
 * Get active alerts (admin only)
 * GET /admin/monitoring/alerts/active
 */
router.get('/monitoring/alerts/active', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { monitoring } = await import('../lib/monitoring');
    const activeAlerts = monitoring.getActiveAlerts();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: activeAlerts.length,
      alerts: activeAlerts,
    });
  } catch (error: any) {
    logger.error('Failed to get active alerts', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve active alerts',
    });
  }
});

/**
 * Get alert history (admin only)
 * GET /admin/monitoring/alerts/history
 */
router.get('/monitoring/alerts/history', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { monitoring } = await import('../lib/monitoring');
    const limit = parseInt(req.query.limit as string) || 100;
    const history = monitoring.getAlertHistory(limit);
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: history.length,
      alerts: history,
    });
  } catch (error: any) {
    logger.error('Failed to get alert history', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve alert history',
    });
  }
});

/**
 * Get alert rules (admin only)
 * GET /admin/monitoring/alerts/rules
 */
router.get('/monitoring/alerts/rules', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { monitoring } = await import('../lib/monitoring');
    const rules = monitoring.getAlertRules();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: rules.length,
      rules,
    });
  } catch (error: any) {
    logger.error('Failed to get alert rules', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve alert rules',
    });
  }
});

/**
 * Update alert rule (super_admin only)
 * PATCH /admin/monitoring/alerts/rules/:name
 */
router.patch('/monitoring/alerts/rules/:name', requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const { monitoring } = await import('../lib/monitoring');
    const { name } = req.params;
    const updates = req.body;
    
    monitoring.updateAlertRule(name, updates);
    
    res.json({
      success: true,
      message: `Alert rule '${name}' updated`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Failed to update alert rule', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to update alert rule',
    });
  }
});

/**
 * Enable/disable alert rule (super_admin only)
 * POST /admin/monitoring/alerts/rules/:name/toggle
 */
router.post('/monitoring/alerts/rules/:name/toggle', requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const { monitoring } = await import('../lib/monitoring');
    const { name } = req.params;
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled field must be a boolean',
      });
    }
    
    monitoring.setAlertRuleEnabled(name, enabled);
    
    res.json({
      success: true,
      message: `Alert rule '${name}' ${enabled ? 'enabled' : 'disabled'}`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Failed to toggle alert rule', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to toggle alert rule',
    });
  }
});

export default router;
