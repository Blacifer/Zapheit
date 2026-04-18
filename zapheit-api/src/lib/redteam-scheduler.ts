import { logger } from './logger';
import { supabaseRestAsService } from './supabase-rest';
import { runPreflightGate } from './preflight-gate';

let timer: NodeJS.Timeout | null = null;

export function startRedTeamScheduler(): void {
  const intervalMinutes = Number(process.env.REDTEAM_INTERVAL_MINUTES || 0);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;
  if (timer) return;

  timer = setInterval(async () => {
    try {
      const orgs = (await supabaseRestAsService('organizations', new URLSearchParams('select=id&limit=100'))) as Array<{ id: string }>;
      for (const org of orgs || []) {
        const scenarios = [
          { connector: 'slack', action: 'send_message', params: { channel: '#ops', text: 'PAN ABCDE1234F' } },
          { connector: 'internal', action: 'compliance.sensitive_data.access', params: { subject: 'salary_sheet' } },
        ];
        const findings: any[] = [];
        for (const scenario of scenarios) {
          const p = await runPreflightGate(org.id, scenario.connector, scenario.action, scenario.params, null);
          findings.push({ scenario, decision: p.decision, reason_category: p.reasonCategory, reason_message: p.reasonMessage });
        }
        const blockedCount = findings.filter((f) => f.decision !== 'allow').length;
        await supabaseRestAsService('redteam_runs', '', {
          method: 'POST',
          body: {
            organization_id: org.id,
            status: 'completed',
            scenario_count: scenarios.length,
            blocked_count: blockedCount,
            findings,
            triggered_by: null,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
          },
        }).catch(() => undefined);
      }
    } catch (err: any) {
      logger.warn('Red-team scheduler tick failed', { error: err?.message });
    }
  }, Math.max(1, intervalMinutes) * 60_000);

  logger.info('Red-team scheduler started', { intervalMinutes });
}
