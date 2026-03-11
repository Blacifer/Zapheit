import crypto from 'crypto';
import { sendTransactionalEmail } from './email';
import { logger } from './logger';
import { eq, supabaseRest } from './supabase-rest';
import { fireAndForgetWebhookEvent } from './webhook-relay';

type ProviderId = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';

export type ReconciliationAlert = {
  severity: 'info' | 'warning' | 'critical';
  code: string;
  provider: ProviderId | 'all';
  title: string;
  message: string;
};

type ProviderSyncConfigEntry = {
  provider: ProviderId;
  enabled: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus?: 'ok' | 'failed' | null;
  lastSyncMessage?: string | null;
  automatedSyncSupported?: boolean;
};

type OrganizationRow = {
  id: string;
  name?: string | null;
  settings?: Record<string, any> | null;
};

export type ReconciliationAlertConfig = {
  channels: {
    inApp: boolean;
    email: boolean;
    webhook: boolean;
  };
  thresholds: {
    absoluteGapUsd: number;
    relativeGapRatio: number;
    staleSyncHours: number;
  };
};

export const DEFAULT_RECONCILIATION_ALERT_CONFIG: ReconciliationAlertConfig = {
  channels: {
    inApp: true,
    email: true,
    webhook: true,
  },
  thresholds: {
    absoluteGapUsd: 5,
    relativeGapRatio: 0.15,
    staleSyncHours: 36,
  },
};

export function getReconciliationAlertConfig(settings: Record<string, any>): ReconciliationAlertConfig {
  const config = settings?.reconciliationAlertConfig || {};
  return {
    channels: {
      inApp: config?.channels?.inApp !== false,
      email: config?.channels?.email !== false,
      webhook: config?.channels?.webhook !== false,
    },
    thresholds: {
      absoluteGapUsd: Math.max(0, Number(config?.thresholds?.absoluteGapUsd ?? DEFAULT_RECONCILIATION_ALERT_CONFIG.thresholds.absoluteGapUsd)),
      relativeGapRatio: Math.max(0, Number(config?.thresholds?.relativeGapRatio ?? DEFAULT_RECONCILIATION_ALERT_CONFIG.thresholds.relativeGapRatio)),
      staleSyncHours: Math.max(1, Number(config?.thresholds?.staleSyncHours ?? DEFAULT_RECONCILIATION_ALERT_CONFIG.thresholds.staleSyncHours)),
    },
  };
}

function providerHasAutomation(provider: ProviderId) {
  return provider === 'openai' || provider === 'anthropic' || provider === 'openrouter';
}

export function deriveReconciliationAlerts(input: {
  totalSpend30d: number;
  totalProviderReportedSpendUsd: number | null;
  gapUsd: number | null;
  providerSyncEntries: ProviderSyncConfigEntry[];
  config?: ReconciliationAlertConfig;
}) {
  const alerts: ReconciliationAlert[] = [];
  const {
    totalSpend30d,
    totalProviderReportedSpendUsd,
    gapUsd,
    providerSyncEntries,
    config = DEFAULT_RECONCILIATION_ALERT_CONFIG,
  } = input;

  if (totalProviderReportedSpendUsd !== null && gapUsd !== null) {
    const absoluteGap = Math.abs(gapUsd);
    const alertThresholdUsd = Math.max(config.thresholds.absoluteGapUsd, totalSpend30d * config.thresholds.relativeGapRatio);
    if (absoluteGap >= alertThresholdUsd) {
      alerts.push({
        severity: gapUsd > 0 ? 'warning' : 'critical',
        code: 'reconciliation_gap',
        provider: 'all',
        title: 'Provider-reported spend drift detected',
        message: `The current provider-reported total differs from RASI-observed spend by ${absoluteGap.toFixed(2)} USD across the last 30-day window.`,
      });
    }
  }

  for (const entry of providerSyncEntries.filter((provider) => provider.enabled && (provider.automatedSyncSupported ?? providerHasAutomation(provider.provider)))) {
    if (entry.lastSyncStatus === 'failed') {
      alerts.push({
        severity: 'warning',
        code: 'sync_failed',
        provider: entry.provider,
        title: `${entry.provider} sync last failed`,
        message: entry.lastSyncMessage || `The latest ${entry.provider} provider sync did not complete successfully.`,
      });
      continue;
    }

    if (!entry.lastSyncAt) {
      alerts.push({
        severity: 'info',
        code: 'sync_not_run',
        provider: entry.provider,
        title: `${entry.provider} sync not run yet`,
        message: 'This provider is enabled for automated reconciliation, but no successful cost import has been recorded yet.',
      });
      continue;
    }

    const hoursSinceLastSync = (Date.now() - new Date(entry.lastSyncAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastSync > config.thresholds.staleSyncHours) {
      alerts.push({
        severity: 'warning',
        code: 'sync_stale',
        provider: entry.provider,
        title: `${entry.provider} sync is stale`,
        message: `The last successful ${entry.provider} cost sync was ${Math.round(hoursSinceLastSync)} hour(s) ago.`,
      });
    }
  }

  return alerts;
}

export async function dispatchReconciliationAlertsForOrganization(orgId: string) {
  const orgQuery = new URLSearchParams();
  orgQuery.set('id', eq(orgId));
  orgQuery.set('limit', '1');
  const organizations = await supabaseRest('organizations', orgQuery) as OrganizationRow[];
  const organization = organizations?.[0];
  if (!organization) return { sent: 0, alerts: [] as ReconciliationAlert[] };

  const settings = { ...(organization.settings || {}) } as Record<string, any>;
  const config = getReconciliationAlertConfig(settings);
  const providerEntries = Array.isArray(settings?.providerReconciliation?.providers)
    ? settings.providerReconciliation.providers as Array<{ reportedSpendUsd?: number }>
    : [];
  const providerSyncEntries = Array.isArray(settings?.providerSync?.providers)
    ? settings.providerSync.providers as ProviderSyncConfigEntry[]
    : [];

  const costQuery = new URLSearchParams();
  costQuery.set('organization_id', eq(orgId));
  costQuery.set('order', 'created_at.desc');
  costQuery.set('limit', '250');
  const costRows = await supabaseRest('cost_tracking', costQuery) as Array<{ cost_usd?: number }>;
  const totalSpend30d = (costRows || []).reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);
  const totalProviderReportedSpendUsd = providerEntries.length > 0
    ? Number(providerEntries.reduce((sum, entry) => sum + Number(entry.reportedSpendUsd || 0), 0).toFixed(6))
    : null;
  const gapUsd = totalProviderReportedSpendUsd === null
    ? null
    : Number((totalProviderReportedSpendUsd - totalSpend30d).toFixed(6));

  const alerts = deriveReconciliationAlerts({
    totalSpend30d,
    totalProviderReportedSpendUsd,
    gapUsd,
    providerSyncEntries,
    config,
  });

  const actionableAlerts = alerts.filter((alert) => alert.severity !== 'info');
  if (actionableAlerts.length === 0 || !config.channels.email) {
    return { sent: 0, alerts };
  }

  const history = Array.isArray(settings?.reconciliationNotifications?.history)
    ? settings.reconciliationNotifications.history as Array<{
        id: string;
        code: string;
        provider: string;
        severity: string;
        title: string;
        message: string;
        sentAt: string;
      }>
    : [];
  const sentKeys = Array.isArray(settings?.reconciliationNotifications?.sentKeys)
    ? settings.reconciliationNotifications.sentKeys as string[]
    : [];

  const newAlerts = actionableAlerts.filter((alert) => {
    const fingerprint = crypto.createHash('sha1').update(`${alert.code}:${alert.provider}:${alert.message}`).digest('hex');
    return !sentKeys.includes(fingerprint);
  });

  if (newAlerts.length === 0) {
    return { sent: 0, alerts };
  }

  const userQuery = new URLSearchParams();
  userQuery.set('organization_id', eq(orgId));
  const users = await supabaseRest('users', userQuery) as Array<{ email?: string | null; role?: string | null }>;
  const recipients = (users || [])
    .filter((user) => ['super_admin', 'admin'].includes(String(user.role || '').toLowerCase()))
    .map((user) => user.email)
    .filter((email): email is string => Boolean(email));

  for (const alert of newAlerts) {
    if (recipients.length > 0) {
      await Promise.allSettled(recipients.map((email) => sendTransactionalEmail({
        to: email,
        subject: `[SyntheticHR] ${alert.title}`,
        text: `${alert.title}\n\n${alert.message}\n\nOrganization: ${organization.name || orgId}`,
        html: `<p><strong>${alert.title}</strong></p><p>${alert.message}</p><p>Organization: ${organization.name || orgId}</p>`,
      })));
    }
  }

  const nowIso = new Date().toISOString();
  const nextSentKeys = [
    ...sentKeys,
    ...newAlerts.map((alert) => crypto.createHash('sha1').update(`${alert.code}:${alert.provider}:${alert.message}`).digest('hex')),
  ].slice(-100);
  const nextHistory = [
    ...newAlerts.map((alert) => ({
      id: crypto.randomUUID(),
      code: alert.code,
      provider: alert.provider,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      sentAt: nowIso,
    })),
    ...history,
  ].slice(0, 50);

  if (config.channels.webhook !== false) {
    for (const alert of newAlerts) {
      fireAndForgetWebhookEvent(orgId, 'reconciliation.alert', {
        id: `evt_reconciliation_${crypto.randomUUID()}`,
        type: 'reconciliation.alert',
        created_at: nowIso,
        organization_id: orgId,
        data: {
          provider: alert.provider,
          severity: alert.severity,
          code: alert.code,
          title: alert.title,
          message: alert.message,
        },
      });
    }
  }

  await supabaseRest('organizations', orgQuery, {
    method: 'PATCH',
    body: {
      settings: {
        ...settings,
        reconciliationNotifications: {
          sentKeys: nextSentKeys,
          history: nextHistory,
          updatedAt: nowIso,
        },
      },
      updated_at: nowIso,
    },
  });

  logger.info('Reconciliation alerts dispatched', {
    organizationId: orgId,
    recipients: recipients.length,
    alerts: newAlerts.length,
  });

  return { sent: newAlerts.length, alerts };
}
