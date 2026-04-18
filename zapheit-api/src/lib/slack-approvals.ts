/**
 * slack-approvals.ts
 *
 * Sends a Block Kit Slack message with Approve / Deny interactive buttons
 * whenever an approval request is created.
 *
 * Requires the Slack app's Interactivity URL to be set to:
 *   POST <API_URL>/events/slack-actions
 *
 * The button payloads are handled by routes/slack-actions.ts which already
 * recognises action_id values `rasi_approve` and `rasi_deny`.
 */

import { notifySlackApproval } from './slack-notify';
import { supabaseRestAsService, eq } from './supabase-rest';
import { buildFrontendUrl } from './frontend-url';
import { logger } from './logger';

export interface ApprovalNotifyParams {
  organizationId: string;
  approvalId: string;
  agentId?: string | null;
  agentName?: string | null;
  service: string;
  action: string;
  requestedByEmail?: string | null;
  jobId?: string;
}

/**
 * Resolves the agent name from the DB when not provided by the caller.
 */
async function resolveAgentName(agentId?: string | null): Promise<string | null> {
  if (!agentId) return null;
  try {
    const q = new URLSearchParams();
    q.set('id', eq(agentId));
    q.set('select', 'name');
    q.set('limit', '1');
    const rows = await supabaseRestAsService('ai_agents', q) as any[];
    return rows?.[0]?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Send an interactive Block Kit approval request to the org's Slack channel.
 * Call this fire-and-forget style — it swallows all errors internally.
 */
export async function notifySlackApprovalRequest(params: ApprovalNotifyParams): Promise<void> {
  try {
    const agentName = params.agentName ?? await resolveAgentName(params.agentId);
    const dashboardUrl = buildFrontendUrl('/dashboard/approvals');

    const actionLabel = `${params.service}:${params.action}`;
    const details = params.jobId ? `Job ID: \`${params.jobId}\`` : undefined;

    await notifySlackApproval(params.organizationId, {
      approvalId: params.approvalId,
      action: actionLabel,
      agentName: agentName ?? undefined,
      requestedBy: params.requestedByEmail ?? undefined,
      details,
      dashboardUrl,
    });

    logger.info('slack-approvals: approval Block Kit sent', {
      org_id: params.organizationId,
      approval_id: params.approvalId,
      action: actionLabel,
    });
  } catch (err: any) {
    logger.warn('slack-approvals: failed to send approval notification', {
      org_id: params.organizationId,
      approval_id: params.approvalId,
      error: err?.message,
    });
  }
}

/** Fire-and-forget wrapper for use in route handlers */
export function notifySlackApprovalRequestAsync(params: ApprovalNotifyParams): void {
  void notifySlackApprovalRequest(params).catch(() => {
    // already swallowed inside notifySlackApprovalRequest
  });
}
