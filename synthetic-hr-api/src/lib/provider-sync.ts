import { logger } from './logger';
import { dispatchReconciliationAlertsForOrganization } from './reconciliation-alerts';
import { eq, supabaseRest } from './supabase-rest';

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';

export type ProviderReconciliationEntry = {
  provider: ProviderId;
  reportedSpendUsd: number;
  source: 'manual' | 'api';
  lastSyncedAt: string | null;
  notes: string | null;
  updatedAt: string;
};

export type ProviderSyncConfigEntry = {
  provider: ProviderId;
  enabled: boolean;
  organizationId: string | null;
  projectId: string | null;
  updatedAt: string;
  updatedBy: string | null;
  lastTestAt?: string | null;
  lastTestStatus?: 'ok' | 'failed' | null;
  lastTestMessage?: string | null;
  lastSyncAt?: string | null;
  lastSyncStatus?: 'ok' | 'failed' | null;
  lastSyncMessage?: string | null;
};

export const SUPPORTED_AUTOMATED_SYNC_PROVIDERS = new Set<ProviderId>(['openai', 'anthropic', 'openrouter']);
const PROVIDER_SYNC_HISTORY_LIMIT = 12;

type OrganizationRow = {
  id: string;
  settings?: Record<string, any> | null;
};

type ProviderSyncRunHistoryEntry = {
  provider: ProviderId;
  ok: boolean;
  message: string;
  runAt: string;
  trigger: 'manual' | 'scheduler';
  importedSpendUsd?: number | null;
};

type ProviderRuntimeStatusEntry = ProviderSyncConfigEntry & {
  credentialsAvailable: boolean;
  automatedSyncSupported: boolean;
};

const schedulerStatus = {
  lastRunAt: null as string | null,
  lastRunFinishedAt: null as string | null,
  nextRunAt: null as string | null,
  running: false,
  lastTrigger: null as 'manual' | 'scheduler' | null,
  lastSummary: null as {
    organizations: number;
    attempted: number;
    okCount: number;
    failedCount: number;
  } | null,
};

export function getProviderAdminKey(provider: ProviderId) {
  if (provider === 'openai') {
    return process.env.RASI_OPENAI_ADMIN_KEY || process.env.OPENAI_ADMIN_KEY || process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY || null;
  }

  if (provider === 'anthropic') {
    return process.env.RASI_ANTHROPIC_ADMIN_KEY || process.env.ANTHROPIC_ADMIN_KEY || process.env.RASI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || null;
  }

  if (provider === 'openrouter') {
    return process.env.RASI_OPENROUTER_ADMIN_KEY || process.env.OPENROUTER_ADMIN_KEY || process.env.RASI_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || null;
  }

  return null;
}

export function buildSyncProvidersWithRuntimeStatus(entries: ProviderSyncConfigEntry[]): ProviderRuntimeStatusEntry[] {
  return entries.map((entry) => ({
    ...entry,
    credentialsAvailable: Boolean(getProviderAdminKey(entry.provider)),
    automatedSyncSupported: SUPPORTED_AUTOMATED_SYNC_PROVIDERS.has(entry.provider),
  }));
}

export function upsertProviderSyncEntry(
  existingProviders: ProviderSyncConfigEntry[],
  nextEntry: ProviderSyncConfigEntry,
) {
  return [
    ...existingProviders.filter((entry) => entry.provider !== nextEntry.provider),
    nextEntry,
  ].sort((a, b) => a.provider.localeCompare(b.provider));
}

async function getOrganizationById(orgId: string): Promise<OrganizationRow | null> {
  const query = new URLSearchParams();
  query.set('id', eq(orgId));
  query.set('limit', '1');
  const organizations = await supabaseRest('organizations', query) as OrganizationRow[];
  return organizations?.[0] || null;
}

async function patchOrganizationSettings(orgId: string, settings: Record<string, any>, updatedAt: string) {
  const query = new URLSearchParams();
  query.set('id', eq(orgId));
  await supabaseRest('organizations', query, {
    method: 'PATCH',
    body: {
      settings,
      updated_at: updatedAt,
    },
  });
}

function getProviderSyncEntries(settings: Record<string, any>) {
  return Array.isArray(settings?.providerSync?.providers)
    ? settings.providerSync.providers as ProviderSyncConfigEntry[]
    : [];
}

function getProviderReconciliationEntries(settings: Record<string, any>) {
  return Array.isArray(settings?.providerReconciliation?.providers)
    ? settings.providerReconciliation.providers as ProviderReconciliationEntry[]
    : [];
}

function appendProviderSyncHistory(settings: Record<string, any>, entry: ProviderSyncRunHistoryEntry) {
  const existingHistory = Array.isArray(settings?.providerSync?.history)
    ? settings.providerSync.history as ProviderSyncRunHistoryEntry[]
    : [];

  return [entry, ...existingHistory].slice(0, PROVIDER_SYNC_HISTORY_LIMIT);
}

export function getProviderSyncSchedulerStatus() {
  return { ...schedulerStatus };
}

export function setProviderSyncSchedulerNextRun(nextRunAt: string | null) {
  schedulerStatus.nextRunAt = nextRunAt;
}

export async function testProviderConnectionForOrganization(orgId: string, provider: Extract<ProviderId, 'openai' | 'anthropic' | 'openrouter'>) {
  const providerKey = getProviderAdminKey(provider);
  if (!providerKey) {
    return {
      ok: false,
      statusCode: 503,
      error: `${provider.toUpperCase()}_ADMIN_KEY is not configured on the backend`,
    };
  }

  const organization = await getOrganizationById(orgId);
  if (!organization) {
    return {
      ok: false,
      statusCode: 404,
      error: 'Organization not found',
    };
  }

  const settings = { ...(organization.settings || {}) } as Record<string, any>;
  const existingProviders = getProviderSyncEntries(settings);
  const currentConfig = existingProviders.find((entry) => entry.provider === provider) || null;
  const now = new Date().toISOString();

  let testStatus: ProviderSyncConfigEntry['lastTestStatus'] = 'failed';
  let testMessage = 'Connection test did not run';

  try {
    if (provider === 'openai') {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${providerKey}`,
        'Content-Type': 'application/json',
      };
      if (currentConfig?.organizationId) headers['OpenAI-Organization'] = currentConfig.organizationId;
      if (currentConfig?.projectId) headers['OpenAI-Project'] = currentConfig.projectId;

      const response = await fetch('https://api.openai.com/v1/models', { method: 'GET', headers });
      if (response.ok) {
        testStatus = 'ok';
        testMessage = 'OpenAI credentials and organization/project headers were accepted.';
      } else {
        testMessage = `OpenAI connection test failed: ${response.status} ${await response.text()}`;
      }
    }

    if (provider === 'anthropic') {
      const testUrl = new URL('https://api.anthropic.com/v1/organizations/cost_report');
      const yesterdayIso = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
      testUrl.searchParams.set('starting_at', yesterdayIso);
      testUrl.searchParams.set('ending_at', now);
      testUrl.searchParams.set('limit', '1');

      const response = await fetch(testUrl.toString(), {
        method: 'GET',
        headers: {
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'x-api-key': providerKey,
        },
      });

      if (response.ok) {
        testStatus = 'ok';
        testMessage = 'Anthropic admin credentials were accepted.';
      } else {
        testMessage = `Anthropic connection test failed: ${response.status} ${await response.text()}`;
      }
    }

    if (provider === 'openrouter') {
      const response = await fetch('https://openrouter.ai/api/v1/credits', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${providerKey}`,
        },
      });

      if (response.ok) {
        testStatus = 'ok';
        testMessage = 'OpenRouter management key was accepted.';
      } else {
        testMessage = `OpenRouter connection test failed: ${response.status} ${await response.text()}`;
      }
    }
  } catch (error: any) {
    const providerLabel = provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Anthropic' : 'OpenRouter';
    testMessage = `${providerLabel} connection test failed: ${error.message}`;
  }

  const mergedProviders = upsertProviderSyncEntry(existingProviders, {
    provider,
    enabled: currentConfig?.enabled ?? false,
    organizationId: currentConfig?.organizationId || null,
    projectId: currentConfig?.projectId || null,
    updatedAt: currentConfig?.updatedAt || now,
    updatedBy: currentConfig?.updatedBy || null,
    lastTestAt: now,
    lastTestStatus: testStatus,
    lastTestMessage: testMessage,
    lastSyncAt: currentConfig?.lastSyncAt || null,
    lastSyncStatus: currentConfig?.lastSyncStatus || null,
    lastSyncMessage: currentConfig?.lastSyncMessage || null,
  });

  await patchOrganizationSettings(orgId, {
    ...settings,
    providerSync: {
      providers: mergedProviders,
      updatedAt: now,
      updatedBy: currentConfig?.updatedBy || null,
    },
  }, now);

  return {
    ok: testStatus === 'ok',
    statusCode: testStatus === 'ok' ? 200 : 502,
    data: {
      provider,
      lastTestAt: now,
      lastTestStatus: testStatus,
      lastTestMessage: testMessage,
    },
    error: testStatus === 'ok' ? undefined : testMessage,
  };
}

export async function syncProviderCostsForOrganization(params: {
  orgId: string;
  provider: Extract<ProviderId, 'openai' | 'anthropic' | 'openrouter'>;
  days?: number;
  actorId?: string | null;
  trigger?: 'manual' | 'scheduler';
}) {
  const { orgId, provider, actorId = null, trigger = 'manual' } = params;
  const days = provider === 'openai'
    ? Math.min(90, Math.max(1, Number(params.days || 30)))
    : provider === 'anthropic'
      ? Math.min(31, Math.max(1, Number(params.days || 30)))
      : Math.min(30, Math.max(1, Number(params.days || 30)));

  const providerKey = getProviderAdminKey(provider);
  if (!providerKey) {
    return {
      ok: false,
      statusCode: 503,
      error: `${provider.toUpperCase()}_ADMIN_KEY is not configured on the backend`,
    };
  }

  const organization = await getOrganizationById(orgId);
  if (!organization) {
    return {
      ok: false,
      statusCode: 404,
      error: 'Organization not found',
    };
  }

  const settings = { ...(organization.settings || {}) } as Record<string, any>;
  const existingSyncProviders = getProviderSyncEntries(settings);
  const existingReconProviders = getProviderReconciliationEntries(settings);
  const currentConfig = existingSyncProviders.find((entry) => entry.provider === provider) || null;
  const nowIso = new Date().toISOString();

  try {
    let importedSpendUsd = 0;
    let bucketCount = 0;

    if (provider === 'openai') {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${providerKey}`,
        'Content-Type': 'application/json',
      };
      if (currentConfig?.organizationId) headers['OpenAI-Organization'] = currentConfig.organizationId;
      if (currentConfig?.projectId) headers['OpenAI-Project'] = currentConfig.projectId;

      const nowUnix = Math.floor(Date.now() / 1000);
      const startTime = nowUnix - (days * 24 * 60 * 60);
      const costsUrl = new URL('https://api.openai.com/v1/organization/costs');
      costsUrl.searchParams.set('start_time', String(startTime));
      costsUrl.searchParams.set('bucket_width', '1d');
      costsUrl.searchParams.set('limit', String(days));

      const response = await fetch(costsUrl.toString(), { method: 'GET', headers });
      if (!response.ok) {
        throw new Error(`OpenAI cost sync failed: ${response.status} ${await response.text()}`);
      }

      const payload = await response.json() as {
        data?: Array<{ results?: Array<{ amount?: { value?: number } }> }>;
      };
      const buckets = Array.isArray(payload.data) ? payload.data : [];
      bucketCount = buckets.length;
      importedSpendUsd = buckets.reduce((sum, bucket) => sum + (bucket.results || []).reduce((inner, result) => inner + Number(result?.amount?.value || 0), 0), 0);
    }

    if (provider === 'anthropic') {
      const endingAt = new Date();
      const startingAt = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
      const costUrl = new URL('https://api.anthropic.com/v1/organizations/cost_report');
      costUrl.searchParams.set('starting_at', startingAt.toISOString());
      costUrl.searchParams.set('ending_at', endingAt.toISOString());
      costUrl.searchParams.set('limit', String(days));

      let page: string | null = null;
      do {
        const pagedUrl = new URL(costUrl.toString());
        if (page) pagedUrl.searchParams.set('page', page);

        const response = await fetch(pagedUrl.toString(), {
          method: 'GET',
          headers: {
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'x-api-key': providerKey,
          },
        });
        if (!response.ok) {
          throw new Error(`Anthropic cost sync failed: ${response.status} ${await response.text()}`);
        }

        const payload = await response.json() as {
          data?: Array<{ results?: Array<{ amount?: string }> }>;
          has_more?: boolean;
          next_page?: string | null;
        };
        const buckets = Array.isArray(payload.data) ? payload.data : [];
        bucketCount += buckets.length;
        importedSpendUsd += buckets.reduce((sum, bucket) => sum + (bucket.results || []).reduce((inner, result) => inner + Number.parseFloat(String(result?.amount || '0')), 0), 0);
        page = payload.has_more ? payload.next_page || null : null;
      } while (page);
    }

    if (provider === 'openrouter') {
      const activityUrl = new URL('https://openrouter.ai/api/v1/activity');
      const response = await fetch(activityUrl.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${providerKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`OpenRouter cost sync failed: ${response.status} ${await response.text()}`);
      }

      const payload = await response.json() as {
        data?: Array<{
          usage?: number;
          requests?: number;
        }>;
      };
      const rows = Array.isArray(payload.data) ? payload.data : [];
      bucketCount = rows.length;
      importedSpendUsd = rows.reduce((sum, row) => sum + Number(row?.usage || 0), 0);
    }

    importedSpendUsd = Number(importedSpendUsd.toFixed(6));
    const providerLabel = provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Anthropic' : 'OpenRouter';
    const syncMessage = provider === 'openrouter'
      ? `Imported ${importedSpendUsd.toFixed(6)} USD from ${bucketCount} OpenRouter activity rows covering the last 30 completed UTC day(s).`
      : `Imported ${importedSpendUsd.toFixed(6)} USD from ${bucketCount} ${providerLabel} cost buckets for the last ${days} day(s).`;

    const mergedReconProviders = [
      ...existingReconProviders.filter((entry) => entry.provider !== provider),
      {
        provider,
        reportedSpendUsd: importedSpendUsd,
        source: 'api',
        lastSyncedAt: nowIso,
        notes: syncMessage,
        updatedAt: nowIso,
      } satisfies ProviderReconciliationEntry,
    ].sort((a, b) => a.provider.localeCompare(b.provider));

    const mergedSyncProviders = upsertProviderSyncEntry(existingSyncProviders, {
      provider,
      enabled: currentConfig?.enabled ?? true,
      organizationId: currentConfig?.organizationId || null,
      projectId: currentConfig?.projectId || null,
      updatedAt: nowIso,
      updatedBy: actorId,
      lastTestAt: currentConfig?.lastTestAt || null,
      lastTestStatus: currentConfig?.lastTestStatus || null,
      lastTestMessage: currentConfig?.lastTestMessage || null,
      lastSyncAt: nowIso,
      lastSyncStatus: 'ok',
      lastSyncMessage: syncMessage,
    });

    await patchOrganizationSettings(orgId, {
      ...settings,
      providerReconciliation: {
        providers: mergedReconProviders,
        updatedAt: nowIso,
        updatedBy: actorId,
      },
      providerSync: {
        providers: mergedSyncProviders,
        history: appendProviderSyncHistory(settings, {
          provider,
          ok: true,
          message: syncMessage,
          runAt: nowIso,
          trigger,
          importedSpendUsd,
        }),
        updatedAt: nowIso,
        updatedBy: actorId,
      },
    }, nowIso);

    await dispatchReconciliationAlertsForOrganization(orgId);

    return {
      ok: true,
      statusCode: 200,
      data: {
        provider,
        importedSpendUsd,
        bucketCount,
        days,
        syncedAt: nowIso,
        message: syncMessage,
      },
    };
  } catch (error: any) {
    const failedMessage = error instanceof Error ? error.message : `Failed to sync ${provider} provider costs`;
    const mergedProviders = upsertProviderSyncEntry(existingSyncProviders, {
      provider,
      enabled: currentConfig?.enabled ?? true,
      organizationId: currentConfig?.organizationId || null,
      projectId: currentConfig?.projectId || null,
      updatedAt: nowIso,
      updatedBy: actorId,
      lastTestAt: currentConfig?.lastTestAt || null,
      lastTestStatus: currentConfig?.lastTestStatus || null,
      lastTestMessage: currentConfig?.lastTestMessage || null,
      lastSyncAt: nowIso,
      lastSyncStatus: 'failed',
      lastSyncMessage: failedMessage,
    });

    await patchOrganizationSettings(orgId, {
      ...settings,
      providerSync: {
        providers: mergedProviders,
        history: appendProviderSyncHistory(settings, {
          provider,
          ok: false,
          message: failedMessage,
          runAt: nowIso,
          trigger,
          importedSpendUsd: null,
        }),
        updatedAt: nowIso,
        updatedBy: actorId,
      },
    }, nowIso);

    await dispatchReconciliationAlertsForOrganization(orgId);

    return {
      ok: false,
      statusCode: 502,
      error: failedMessage,
    };
  }
}

export async function syncEnabledProviderCostsForAllOrganizations(days = 30, trigger: 'manual' | 'scheduler' = 'scheduler') {
  schedulerStatus.running = true;
  schedulerStatus.lastRunAt = new Date().toISOString();
  schedulerStatus.lastTrigger = trigger;

  const organizations = await supabaseRest(
    'organizations',
    new URLSearchParams('select=id,settings&limit=1000'),
  ) as OrganizationRow[];

  const results: Array<{
    organizationId: string;
    provider: ProviderId;
    ok: boolean;
    message: string;
  }> = [];

  for (const organization of organizations || []) {
    const settings = { ...(organization.settings || {}) } as Record<string, any>;
    const providerSyncEntries = getProviderSyncEntries(settings);
    const enabledProviders = providerSyncEntries.filter((entry) => entry.enabled && SUPPORTED_AUTOMATED_SYNC_PROVIDERS.has(entry.provider));

    for (const entry of enabledProviders) {
      const result = await syncProviderCostsForOrganization({
        orgId: organization.id,
        provider: entry.provider as Extract<ProviderId, 'openai' | 'anthropic' | 'openrouter'>,
        days,
        actorId: 'system',
        trigger,
      });

      results.push({
        organizationId: organization.id,
        provider: entry.provider,
        ok: result.ok,
        message: result.ok ? (result.data?.message || 'Synced') : (result.error || 'Sync failed'),
      });
    }
  }

  const okCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - okCount;
  schedulerStatus.running = false;
  schedulerStatus.lastRunFinishedAt = new Date().toISOString();
  schedulerStatus.lastSummary = {
    organizations: organizations?.length || 0,
    attempted: results.length,
    okCount,
    failedCount,
  };
  logger.info('Provider sync scheduler completed', {
    organizations: organizations?.length || 0,
    attempted: results.length,
    okCount,
    failedCount,
  });

  return {
    organizations: organizations?.length || 0,
    attempted: results.length,
    okCount,
    failedCount,
    results,
  };
}
