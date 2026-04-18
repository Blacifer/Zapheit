// ---------------------------------------------------------------------------
// Filing Deadline Scheduler Worker
//
// Background scheduler that runs periodically to:
// 1. Generate upcoming filing submissions for the current period
// 2. Mark overdue submissions
// 3. Create reminder/overdue alerts
//
// Same pattern as dpdp-retention-worker.ts.
// ---------------------------------------------------------------------------

import { supabaseRestAsService, eq } from './supabase-rest';
import { logger } from './logger';

// Run every 6 hours (filing deadlines don't change minute-to-minute)
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Step 1: Mark overdue submissions.
 * Any pending/in_progress submission past its due_date gets flagged.
 */
async function markOverdueSubmissions(): Promise<number> {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    const overdue = (await supabaseRestAsService(
      'filing_submissions',
      new URLSearchParams({
        status: 'in.(pending,in_progress)',
        due_date: `lt.${today}`,
        select: 'id,organization_id,deadline_id,period_label,due_date',
      }),
    )) as any[] | null;

    if (!overdue?.length) return 0;

    for (const sub of overdue) {
      try {
        await supabaseRestAsService(
          'filing_submissions',
          new URLSearchParams({ id: eq(sub.id) }),
          {
            method: 'PATCH',
            body: { status: 'overdue', updated_at: now.toISOString() },
          },
        );

        // Create overdue alert
        await supabaseRestAsService('filing_alerts', new URLSearchParams(), {
          method: 'POST',
          body: {
            organization_id: sub.organization_id,
            submission_id: sub.id,
            deadline_id: sub.deadline_id,
            alert_type: 'overdue',
            severity: 'critical',
            title: `Filing overdue: ${sub.period_label}`,
            message: `Filing for ${sub.period_label} was due on ${sub.due_date} and has not been submitted. Penalties may apply.`,
          },
        });
      } catch (err: any) {
        logger.warn('[filing-scheduler] Failed to mark overdue', { id: sub.id, error: err?.message });
      }
    }

    return overdue.length;
  } catch (err: any) {
    logger.error('[filing-scheduler] markOverdueSubmissions failed', { error: err?.message });
    return 0;
  }
}

/**
 * Step 2: Create reminder alerts for upcoming deadlines.
 * Generates alerts for submissions due within 3 days that don't have a recent reminder.
 */
async function createReminderAlerts(): Promise<number> {
  try {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 86400000).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];

    const upcoming = (await supabaseRestAsService(
      'filing_submissions',
      (() => {
        const p = new URLSearchParams({
          status: 'in.(pending,in_progress)',
          select: 'id,organization_id,deadline_id,period_label,due_date',
        });
        // PostgREST range filter: due_date between today and 3 days from now
        p.append('due_date', `gte.${today}`);
        p.append('due_date', `lte.${threeDaysFromNow}`);
        return p;
      })(),
    )) as any[] | null;

    if (!upcoming?.length) return 0;

    let created = 0;
    for (const sub of upcoming) {
      try {
        // Check for existing recent reminder (last 24h)
        const yesterday = new Date(now.getTime() - 86400000).toISOString();
        const existingAlerts = (await supabaseRestAsService(
          'filing_alerts',
          new URLSearchParams({
            submission_id: eq(sub.id),
            alert_type: 'in.(reminder,due_today)',
            created_at: `gte.${yesterday}`,
            select: 'id',
            limit: '1',
          }),
        )) as any[] | null;

        if (existingAlerts?.length) continue;

        const isDueToday = sub.due_date === today;
        await supabaseRestAsService('filing_alerts', new URLSearchParams(), {
          method: 'POST',
          body: {
            organization_id: sub.organization_id,
            submission_id: sub.id,
            deadline_id: sub.deadline_id,
            alert_type: isDueToday ? 'due_today' : 'reminder',
            severity: isDueToday ? 'warning' : 'info',
            title: isDueToday
              ? `Filing due today: ${sub.period_label}`
              : `Filing due soon: ${sub.period_label}`,
            message: `Filing for ${sub.period_label} is due on ${sub.due_date}.`,
          },
        });
        created++;
      } catch (err: any) {
        logger.warn('[filing-scheduler] Failed to create reminder', { id: sub.id, error: err?.message });
      }
    }

    return created;
  } catch (err: any) {
    logger.error('[filing-scheduler] createReminderAlerts failed', { error: err?.message });
    return 0;
  }
}

/**
 * Main tick: runs all steps.
 */
async function tick(): Promise<void> {
  try {
    const [overdueCount, reminderCount] = await Promise.all([
      markOverdueSubmissions(),
      createReminderAlerts(),
    ]);

    if (overdueCount > 0 || reminderCount > 0) {
      logger.info('[filing-scheduler] Cycle completed', {
        overdue_marked: overdueCount,
        reminders_created: reminderCount,
      });
    }
  } catch (err: any) {
    logger.error('[filing-scheduler] Tick failed', { error: err?.message });
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startFilingScheduler(): void {
  if (intervalId) return;

  // Run once immediately on startup
  void tick();

  intervalId = setInterval(() => void tick(), POLL_INTERVAL_MS);
  logger.info('[filing-scheduler] Filing deadline scheduler started', { interval_ms: POLL_INTERVAL_MS });
}

export function stopFilingScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
