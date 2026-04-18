// ---------------------------------------------------------------------------
// DPDP Retention TTL Worker
//
// Background scheduler that runs periodically to:
// 1. Expire consent records whose expires_at has passed
// 2. Auto-purge personal data per data_retention_policies
// 3. Flag overdue Data Principal requests
//
// Uses the same pattern as retry-worker.ts / redteam-scheduler.ts.
// ---------------------------------------------------------------------------

import { supabaseRestAsService, eq, lte } from './supabase-rest';
import { logger } from './logger';

// Run every 15 minutes
const POLL_INTERVAL_MS = 15 * 60 * 1000;

// Known table → timestamp column mappings for auto-purge
const PURGEABLE_TABLES: Record<string, { timestampCol: string; orgCol: string }> = {
  whatsapp_messages:  { timestampCol: 'created_at', orgCol: 'organization_id' },
  whatsapp_contacts:  { timestampCol: 'updated_at', orgCol: 'organization_id' },
  conversations:      { timestampCol: 'created_at', orgCol: 'organization_id' },
  messages:           { timestampCol: 'created_at', orgCol: 'organization_id' },
  audit_logs:         { timestampCol: 'created_at', orgCol: 'organization_id' },
  compliance_events:  { timestampCol: 'created_at', orgCol: 'organization_id' },
};

/**
 * Step 1: Expire consent records past their expires_at.
 */
async function expireConsents(): Promise<number> {
  try {
    const now = new Date().toISOString();

    // Find active consents that have expired
    const expired = (await supabaseRestAsService(
      'consent_records',
      new URLSearchParams({
        status: eq('active'),
        [`expires_at`]: `lt.${now}`,
        select: 'id,organization_id,purpose,principal_type',
      }),
    )) as any[] | null;

    if (!expired?.length) return 0;

    // Batch update to 'expired'
    for (const consent of expired) {
      try {
        await supabaseRestAsService(
          'consent_records',
          new URLSearchParams({ id: eq(consent.id) }),
          {
            method: 'PATCH',
            body: { status: 'expired', updated_at: now },
          },
        );

        // Log compliance event
        await supabaseRestAsService('compliance_events', new URLSearchParams(), {
          method: 'POST',
          body: {
            organization_id: consent.organization_id,
            event_type: 'consent_change',
            severity: 'warning',
            resource_type: 'consent_record',
            resource_id: consent.id,
            details: { action: 'auto_expired', purpose: consent.purpose, principal_type: consent.principal_type },
            remediation_status: 'in_progress',
            created_at: now,
          },
        });
      } catch (err: any) {
        logger.warn('[dpdp-ttl] Failed to expire consent', { id: consent.id, error: err?.message });
      }
    }

    return expired.length;
  } catch (err: any) {
    logger.error('[dpdp-ttl] expireConsents failed', { error: err?.message });
    return 0;
  }
}

/**
 * Step 2: Purge data per retention policies.
 * For each active policy with applies_to_table set, delete rows older than retention_days.
 */
async function enforceRetentionPolicies(): Promise<number> {
  let purgedTotal = 0;

  try {
    const policies = (await supabaseRestAsService(
      'data_retention_policies',
      new URLSearchParams({
        is_active: eq('true'),
        select: '*',
      }),
    )) as any[] | null;

    if (!policies?.length) return 0;

    for (const policy of policies) {
      if (!policy.applies_to_table || policy.retention_days <= 0) continue;

      const tableInfo = PURGEABLE_TABLES[policy.applies_to_table];
      if (!tableInfo) {
        logger.debug('[dpdp-ttl] Unknown table in retention policy, skipping', {
          table: policy.applies_to_table,
          policy_id: policy.id,
        });
        continue;
      }

      const cutoff = new Date(Date.now() - policy.retention_days * 86400000).toISOString();

      try {
        if (policy.purge_strategy === 'delete') {
          // Delete rows older than the retention period for this org
          await supabaseRestAsService(
            policy.applies_to_table,
            new URLSearchParams({
              [tableInfo.orgCol]: eq(policy.organization_id),
              [tableInfo.timestampCol]: `lt.${cutoff}`,
            }),
            { method: 'DELETE' },
          );
          purgedTotal++;
        } else if (policy.purge_strategy === 'anonymize') {
          // For audit_logs and similar, null out PII columns instead of deleting
          // This preserves the audit trail structure per DPDP Act Sec 8(7)
          if (policy.applies_to_table === 'audit_logs') {
            await supabaseRestAsService(
              'audit_logs',
              new URLSearchParams({
                [tableInfo.orgCol]: eq(policy.organization_id),
                [tableInfo.timestampCol]: `lt.${cutoff}`,
              }),
              {
                method: 'PATCH',
                body: {
                  user_id: null,
                  ip_address: null,
                  user_agent: '[ANONYMIZED_BY_RETENTION_POLICY]',
                },
              },
            );
            purgedTotal++;
          }
        }
        // 'archive' strategy — not implemented yet, would export to cold storage
      } catch (err: any) {
        logger.warn('[dpdp-ttl] Retention purge failed for table', {
          table: policy.applies_to_table,
          org: policy.organization_id,
          error: err?.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('[dpdp-ttl] enforceRetentionPolicies failed', { error: err?.message });
  }

  return purgedTotal;
}

/**
 * Step 3: Flag overdue Data Principal requests.
 * Requests past their due_at that are still pending/in_progress get escalated.
 */
async function flagOverdueRequests(): Promise<number> {
  try {
    const now = new Date().toISOString();

    const overdue = (await supabaseRestAsService(
      'data_principal_requests',
      new URLSearchParams({
        status: 'in.(pending,in_progress)',
        [`due_at`]: `lt.${now}`,
        select: 'id,organization_id,request_type,principal_type,due_at',
      }),
    )) as any[] | null;

    if (!overdue?.length) return 0;

    for (const request of overdue) {
      try {
        // Escalate the request
        await supabaseRestAsService(
          'data_principal_requests',
          new URLSearchParams({ id: eq(request.id) }),
          {
            method: 'PATCH',
            body: {
              status: 'escalated',
              priority: 'urgent',
              updated_at: now,
            },
          },
        );

        // Log critical compliance event — DPDP deadline breach
        await supabaseRestAsService('compliance_events', new URLSearchParams(), {
          method: 'POST',
          body: {
            organization_id: request.organization_id,
            event_type: 'policy_violation',
            severity: 'critical',
            resource_type: 'data_principal_request',
            resource_id: request.id,
            details: {
              action: 'dpr_deadline_breach',
              request_type: request.request_type,
              principal_type: request.principal_type,
              due_at: request.due_at,
              breached_at: now,
              regulation: 'DPDP Act 2023 Sec 11',
            },
            remediation_status: 'in_progress',
            created_at: now,
          },
        });
      } catch (err: any) {
        logger.warn('[dpdp-ttl] Failed to escalate overdue request', { id: request.id, error: err?.message });
      }
    }

    return overdue.length;
  } catch (err: any) {
    logger.error('[dpdp-ttl] flagOverdueRequests failed', { error: err?.message });
    return 0;
  }
}

/**
 * Main tick: runs all three steps.
 */
async function tick(): Promise<void> {
  try {
    const [expiredCount, purgedCount, overdueCount, warnedCount] = await Promise.all([
      expireConsents(),
      enforceRetentionPolicies(),
      flagOverdueRequests(),
      warnExpiringConsents(),
    ]);

    if (expiredCount > 0 || purgedCount > 0 || overdueCount > 0 || warnedCount > 0) {
      logger.info('[dpdp-ttl] Cycle completed', {
        consents_expired: expiredCount,
        retention_purges: purgedCount,
        requests_escalated: overdueCount,
        expiry_warnings: warnedCount,
      });
    }
  } catch (err: any) {
    logger.error('[dpdp-ttl] Tick failed', { error: err?.message });
  }
}

/**
 * Step 4: Warn about consents expiring within 30 days.
 * Logs a consent_expiry_warning compliance event for each one.
 * Rate-limited to once per 24h via module-level timestamp to avoid re-firing every 15 min.
 */
let lastWarnAt = 0;

async function warnExpiringConsents(): Promise<number> {
  const now = Date.now();
  // Only run once per 24 hours
  if (now - lastWarnAt < 24 * 60 * 60 * 1000) return 0;
  lastWarnAt = now;

  try {
    const nowIso = new Date(now).toISOString();
    const in30d = new Date(now + 30 * 86400000).toISOString();

    // Consents expiring between now and now+30d that are still active
    const params = new URLSearchParams();
    params.set('status', eq('active'));
    params.set('select', 'id,organization_id,purpose,principal_type,expires_at');
    params.append('expires_at', `gt.${nowIso}`);
    params.append('expires_at', `lt.${in30d}`);
    const expiring = (await supabaseRestAsService(
      'consent_records',
      params,
    )) as any[] | null;

    if (!expiring?.length) return 0;

    for (const consent of expiring) {
      const daysLeft = Math.ceil((new Date(consent.expires_at).getTime() - now) / 86400000);
      try {
        await supabaseRestAsService('compliance_events', new URLSearchParams(), {
          method: 'POST',
          body: {
            organization_id: consent.organization_id,
            event_type: 'consent_change',
            severity: daysLeft <= 7 ? 'warning' : 'info',
            resource_type: 'consent_record',
            resource_id: consent.id,
            details: {
              action: 'consent_expiry_warning',
              purpose: consent.purpose,
              principal_type: consent.principal_type,
              expires_at: consent.expires_at,
              days_remaining: daysLeft,
            },
            remediation_status: 'in_progress',
            created_at: nowIso,
          },
        });
      } catch (err: any) {
        logger.warn('[dpdp-ttl] Failed to log expiry warning', { id: consent.id, error: err?.message });
      }
    }

    logger.info('[dpdp-ttl] Consent expiry warnings logged', { count: expiring.length });
    return expiring.length;
  } catch (err: any) {
    logger.error('[dpdp-ttl] warnExpiringConsents failed', { error: err?.message });
    return 0;
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startDpdpRetentionWorker(): void {
  if (intervalId) return;

  // Run once immediately on startup
  void tick();

  intervalId = setInterval(() => void tick(), POLL_INTERVAL_MS);
  logger.info('[dpdp-ttl] DPDP retention worker started', { interval_ms: POLL_INTERVAL_MS });
}

export function stopDpdpRetentionWorker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
