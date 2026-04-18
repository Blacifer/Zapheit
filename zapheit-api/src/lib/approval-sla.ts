/**
 * approval-sla.ts
 *
 * Finds pending approval_requests that have breached their SLA (sla_hours),
 * notifies alert channels, and stamps escalated_at.
 *
 * Called fire-and-forget from the telemetry endpoint so it never blocks a
 * user-facing request.
 */

import { buildFrontendUrl } from './frontend-url';
import { logger } from './logger';
import { supabaseRest } from './supabase-rest';

export async function checkApprovalSLAs(orgId: string): Promise<void> {
  try {
    // Find pending approvals that are overdue and not yet escalated
    const params = new URLSearchParams();
    params.set('organization_id', `eq.${orgId}`);
    params.set('status', 'eq.pending');
    params.set('escalated_at', 'is.null');
    params.set('select', 'id,requested_by,action_type,action_payload,created_at,sla_hours');

    const rows: any[] = await supabaseRest('approval_requests', params);
    if (!Array.isArray(rows) || rows.length === 0) return;

    const now = Date.now();
    const breached = rows.filter((r) => {
      const slaHours = r.sla_hours ?? 24;
      const createdAt = new Date(r.created_at).getTime();
      const dueAt = createdAt + slaHours * 60 * 60 * 1000;
      return now > dueAt;
    });

    if (breached.length === 0) return;

    logger.info('approval-sla: SLA breaches found', { orgId, count: breached.length });

    // Lazy-import notifyAlertChannels to avoid circular deps
    const { notifyAlertChannels } = await import('./alert-channels');

    for (const approval of breached) {
      const slaHours = approval.sla_hours ?? 24;

      // Mark escalated
      await supabaseRest(
        'approval_requests',
        new URLSearchParams(`id=eq.${approval.id}`),
        {
          method: 'PATCH',
          body: { escalated_at: new Date().toISOString() },
        },
      );

      // Notify channels
      await notifyAlertChannels(orgId, {
        incidentId: `approval-sla-${approval.id}`,
        title: `Approval SLA breached — ${approval.action_type || 'unknown action'}`,
        severity: 'high',
        incidentType: 'approval_sla_breach',
        agentId: approval.action_payload?.agent_id,
        description: `An approval request has been pending for more than ${slaHours}h without action. Requested by ${approval.requested_by || 'unknown'}.`,
        dashboardUrl: buildFrontendUrl('/dashboard/approvals'),
      }).catch((err: any) => {
        logger.warn('approval-sla: notifyAlertChannels failed', { err: err?.message });
      });
    }
  } catch (err: any) {
    // Fire-and-forget — never propagate
    logger.warn('approval-sla: checkApprovalSLAs error', { orgId, err: err?.message });
  }
}
