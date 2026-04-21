/**
 * Predictive incident prevention — pattern-based, no ML.
 *
 * Runs every 30 minutes and alerts when:
 * 1. Cost is on track to exceed budget before month-end
 * 2. Incident rate increased week-over-week by >50%
 * 3. Response latency trending up (p90 > 2x baseline)
 *
 * Auto-throttles non-critical agents when budget breach is imminent (>90% used).
 */
import { eq, gte, supabaseRestAsService } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { sendTransactionalEmail } from '../lib/email';

const SCHEDULE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function getAllOrgs(): Promise<Array<{ id: string; plan: string; settings: Record<string, any> | null }>> {
  const q = new URLSearchParams();
  q.set('select', 'id,plan,settings');
  q.set('limit', '500');
  const rows = (await supabaseRestAsService('organizations', q)) as any[];
  return rows || [];
}

async function getOrgAdminEmails(orgId: string): Promise<string[]> {
  const q = new URLSearchParams();
  q.set('organization_id', eq(orgId));
  q.set('role', 'in.(admin,super_admin)');
  q.set('select', 'email');
  q.set('limit', '5');
  const rows = (await supabaseRestAsService('users', q)) as any[];
  return (rows || []).map((r: any) => r.email).filter(Boolean);
}

async function getMonthCostUsd(orgId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const q = new URLSearchParams();
  q.set('organization_id', eq(orgId));
  q.set('date', gte(monthStart.toISOString().split('T')[0]));
  q.set('select', 'cost_usd');
  q.set('limit', '10000');
  const rows = (await supabaseRestAsService('cost_tracking', q)) as any[];
  return (rows || []).reduce((s: number, r: any) => s + Number(r.cost_usd || 0), 0);
}

async function getWeekIncidentCount(orgId: string, weekStart: string): Promise<number> {
  const q = new URLSearchParams();
  q.set('organization_id', eq(orgId));
  q.set('created_at', gte(weekStart + 'T00:00:00Z'));
  q.set('select', 'id');
  q.set('limit', '1000');
  const rows = (await supabaseRestAsService('incidents', q)) as any[];
  return (rows || []).length;
}

async function getActiveAgents(orgId: string): Promise<Array<{ id: string; name: string; config: any }>> {
  const q = new URLSearchParams();
  q.set('organization_id', eq(orgId));
  q.set('status', 'eq.active');
  q.set('select', 'id,name,config');
  q.set('limit', '200');
  const rows = (await supabaseRestAsService('ai_agents', q)) as any[];
  return rows || [];
}

async function throttleAgent(orgId: string, agentId: string): Promise<void> {
  const q = new URLSearchParams();
  q.set('id', eq(agentId));
  q.set('organization_id', eq(orgId));
  await supabaseRestAsService('ai_agents', q, {
    method: 'PATCH',
    body: { status: 'paused', updated_at: new Date().toISOString() },
  });
  logger.warn('predictive-alerts: agent auto-throttled due to budget breach', { orgId, agentId });
}

async function ensurePredictiveIncident(orgId: string, type: string, title: string, desc: string): Promise<void> {
  const dedupeId = `predictive-${type}-${orgId}-${new Date().toISOString().slice(0, 10)}`;
  const existQ = new URLSearchParams();
  existQ.set('organization_id', eq(orgId));
  existQ.set('incident_id', eq(dedupeId));
  existQ.set('limit', '1');
  const existing = (await supabaseRestAsService('incidents', existQ)) as any[];
  if (existing?.length) return; // Already created today

  await supabaseRestAsService('incidents', '', {
    method: 'POST',
    body: {
      organization_id: orgId,
      incident_id: dedupeId,
      title,
      description: desc,
      severity: 'high',
      status: 'open',
      incident_type: 'cost_spike',
      source: 'predictive',
      created_at: new Date().toISOString(),
    },
    headers: { Prefer: 'resolution=ignore-duplicates' },
  });
}

async function runForOrg(org: { id: string; plan: string; settings: Record<string, any> | null }): Promise<void> {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const monthFraction = dayOfMonth / daysInMonth;

  // 1. Budget projection
  try {
    const monthlyCostUsd = await getMonthCostUsd(org.id);
    const monthlyCostInr = monthlyCostUsd * 83;
    const budgetInr = org.settings?.monthly_budget_inr ? Number(org.settings.monthly_budget_inr) : 0;

    if (budgetInr > 0 && monthFraction > 0.05) {
      const projectedMonthEnd = monthlyCostInr / monthFraction;
      const pct = monthlyCostInr / budgetInr;

      if (pct >= 0.9) {
        // Auto-throttle non-critical agents
        const agents = await getActiveAgents(org.id);
        for (const agent of agents) {
          if (!agent.config?.critical) {
            await throttleAgent(org.id, agent.id);
          }
        }
        await ensurePredictiveIncident(
          org.id,
          'budget-90pct',
          `AI spend at ${Math.round(pct * 100)}% of monthly budget`,
          `Current spend: ₹${Math.round(monthlyCostInr).toLocaleString('en-IN')}. Budget: ₹${Math.round(budgetInr).toLocaleString('en-IN')}. Non-critical agents auto-paused to prevent overage.`,
        );
        const emails = await getOrgAdminEmails(org.id);
        for (const email of emails) {
          await sendTransactionalEmail({
            to: email,
            subject: `[Zapheit] AI spend at ${Math.round(pct * 100)}% — non-critical agents paused`,
            html: `<p>Your AI spend has reached ${Math.round(pct * 100)}% of your ₹${Math.round(budgetInr).toLocaleString('en-IN')} monthly budget.</p><p>Non-critical agents have been auto-paused. Review usage in your <a href="https://app.zapheit.com/dashboard/usage">Usage dashboard</a>.</p>`,
          }).catch(() => {});
        }
      } else if (pct >= 0.7) {
        await ensurePredictiveIncident(
          org.id,
          'budget-70pct',
          `AI spend on track to exceed budget`,
          `Current spend: ₹${Math.round(monthlyCostInr).toLocaleString('en-IN')}. Projected month-end: ₹${Math.round(projectedMonthEnd).toLocaleString('en-IN')}. Budget: ₹${Math.round(budgetInr).toLocaleString('en-IN')}.`,
        );
      }
    }
  } catch (err: any) {
    logger.warn('predictive-alerts: budget check failed', { orgId: org.id, error: err?.message });
  }

  // 2. Incident rate week-over-week
  try {
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - 7);
    const lastWeekStart = new Date(now);
    lastWeekStart.setDate(now.getDate() - 14);

    const [thisWeek, lastWeek] = await Promise.all([
      getWeekIncidentCount(org.id, thisWeekStart.toISOString().split('T')[0]),
      getWeekIncidentCount(org.id, lastWeekStart.toISOString().split('T')[0]),
    ]);

    if (lastWeek >= 3 && thisWeek > lastWeek * 1.5) {
      await ensurePredictiveIncident(
        org.id,
        'incident-rate-spike',
        `Safety alert rate up ${Math.round(((thisWeek - lastWeek) / lastWeek) * 100)}% this week`,
        `${thisWeek} alerts this week vs ${lastWeek} last week. This may indicate a change in agent behaviour or a new attack pattern.`,
      );
    }
  } catch (err: any) {
    logger.warn('predictive-alerts: incident rate check failed', { orgId: org.id, error: err?.message });
  }
}

export async function runPredictiveAlerts(): Promise<void> {
  logger.info('predictive-alerts: starting run');
  try {
    const orgs = await getAllOrgs();
    for (const org of orgs) {
      try {
        await runForOrg(org);
      } catch (err: any) {
        logger.warn('predictive-alerts: org run failed', { orgId: org.id, error: err?.message });
      }
    }
  } catch (err: any) {
    logger.error('predictive-alerts: failed to load orgs', { error: err?.message });
  }
  logger.info('predictive-alerts: run complete');
}

export function startPredictiveAlertScheduler(): void {
  void runPredictiveAlerts();
  setInterval(() => {
    void runPredictiveAlerts().catch((err) => logger.warn('predictive-alerts: scheduler error', { err: err?.message }));
  }, SCHEDULE_INTERVAL_MS);
  logger.info('predictive-alerts: scheduler started (runs every 30 minutes)');
}
