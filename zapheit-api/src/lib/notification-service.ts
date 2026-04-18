/**
 * Completion notifications for playbook jobs.
 *
 * Fires a `playbook.completed` webhook event and, if Slack is connected,
 * sends a DM to the job's submitter with a result summary.
 */
import { supabaseRestAsService, eq } from './supabase-rest';
import { fireAndForgetWebhookEvent } from './webhook-relay';
import { decryptSecret } from './integrations/encryption';
import { logger } from './logger';

function extractResultText(output: any): string {
  if (!output) return '';
  if (output.final?.message) return output.final.message;
  if (output.message) return output.message;
  const steps = Array.isArray(output.steps) ? output.steps : [];
  const last = steps[steps.length - 1];
  if (last?.message) return last.message;
  return '';
}

function truncate(text: string, max = 300): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export async function notifyJobCompleted(params: {
  organizationId: string;
  jobId: string;
  playbookId: string | null;
  agentId: string | null;
  status: 'succeeded' | 'failed';
  output: any;
  error: string | null;
  createdBy: string | null;
}): Promise<void> {
  const { organizationId, jobId, playbookId, status, output, error, createdBy } = params;

  const playbookName = playbookId
    ? playbookId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Playbook';
  const resultText = extractResultText(output);

  // 1. Fire playbook.completed webhook event.
  fireAndForgetWebhookEvent(organizationId, 'playbook.completed', {
    id: `evt_playbook_${jobId}`,
    type: 'playbook.completed',
    created_at: new Date().toISOString(),
    organization_id: organizationId,
    data: {
      job_id: jobId,
      playbook_id: playbookId,
      status,
      result_preview: truncate(resultText, 200),
      error: error || null,
    },
  });

  // 2. Slack DM to submitter if connected.
  if (!createdBy) return;

  try {
    // Find Slack integration.
    const integQ = new URLSearchParams();
    integQ.set('organization_id', eq(organizationId));
    integQ.set('service_type', eq('slack'));
    integQ.set('status', eq('connected'));
    integQ.set('select', 'id');
    integQ.set('limit', '1');
    const integrations = (await supabaseRestAsService('integrations', integQ)) as Array<{ id: string }>;
    if (!integrations?.length) return;

    // Get access token.
    const credQ = new URLSearchParams();
    credQ.set('integration_id', eq(integrations[0].id));
    credQ.set('key', eq('access_token'));
    credQ.set('select', 'value');
    credQ.set('limit', '1');
    const creds = (await supabaseRestAsService('integration_credentials', credQ)) as Array<{ value: string }>;
    if (!creds?.length) return;

    const accessToken = decryptSecret(creds[0].value);

    // Look up Slack user ID for the submitter.
    const userQ = new URLSearchParams();
    userQ.set('id', eq(createdBy));
    userQ.set('select', 'email');
    userQ.set('limit', '1');
    const users = (await supabaseRestAsService('users', userQ)) as Array<{ email: string }>;
    const email = users?.[0]?.email;
    if (!email) return;

    // Resolve Slack user by email.
    const lookupRes = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const lookupJson: any = await lookupRes.json().catch(() => null);
    const slackUserId: string | undefined = lookupJson?.user?.id;
    if (!slackUserId) return;

    // Build message.
    const icon = status === 'succeeded' ? '✅' : '❌';
    const lines: string[] = [
      `${icon} *${playbookName}* finished — *${status}*`,
    ];
    if (status === 'succeeded' && resultText) {
      lines.push(`\n${truncate(resultText, 280)}`);
    } else if (status === 'failed' && error) {
      lines.push(`\nError: ${truncate(error, 200)}`);
    }
    const text = lines.join('\n');

    // Post DM.
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: slackUserId, text }),
    });
  } catch (err: any) {
    // Non-fatal — log and move on.
    logger.warn('[notifications] Slack DM failed', { job_id: jobId, error: err?.message });
  }
}

/**
 * Fire-and-forget wrapper.
 */
export function notifyJobCompletedAsync(params: Parameters<typeof notifyJobCompleted>[0]): void {
  void notifyJobCompleted(params).catch((err: any) => {
    logger.error('[notifications] unhandled error', { error: err?.message });
  });
}

/**
 * Notify a specific user they have been assigned to approve an action.
 * Used by B10 routing rules when `required_user_id` matches.
 */
export async function notifyApprovalAssigned(params: {
  organizationId: string;
  assignedToUserId: string;
  service: string;
  action: string;
  referenceId: string; // job ID or approval request ID
}): Promise<void> {
  const { organizationId, assignedToUserId, service, action, referenceId } = params;
  try {
    const integQ = new URLSearchParams();
    integQ.set('organization_id', eq(organizationId));
    integQ.set('service_type', eq('slack'));
    integQ.set('status', eq('connected'));
    integQ.set('select', 'id');
    integQ.set('limit', '1');
    const integrations = (await supabaseRestAsService('integrations', integQ)) as Array<{ id: string }>;
    if (!integrations?.length) return;

    const credQ = new URLSearchParams();
    credQ.set('integration_id', eq(integrations[0].id));
    credQ.set('key', eq('access_token'));
    credQ.set('select', 'value');
    credQ.set('limit', '1');
    const creds = (await supabaseRestAsService('integration_credentials', credQ)) as Array<{ value: string }>;
    if (!creds?.length) return;

    const accessToken = decryptSecret(creds[0].value);

    const userQ = new URLSearchParams();
    userQ.set('id', eq(assignedToUserId));
    userQ.set('select', 'email');
    userQ.set('limit', '1');
    const users = (await supabaseRestAsService('users', userQ)) as Array<{ email: string }>;
    const email = users?.[0]?.email;
    if (!email) return;

    const lookupRes = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const lookupJson: any = await lookupRes.json().catch(() => null);
    const slackUserId: string | undefined = lookupJson?.user?.id;
    if (!slackUserId) return;

    const text = `🔔 *Approval required* — \`${service}:${action}\`\nYou have been assigned as the required approver for this action. Reference ID: \`${referenceId}\``;
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: slackUserId, text }),
    });
  } catch (err: any) {
    logger.warn('[notifications] Slack notify assigned approver failed', { reference_id: referenceId, error: err?.message });
  }
}

export function notifyApprovalAssignedAsync(params: Parameters<typeof notifyApprovalAssigned>[0]): void {
  void notifyApprovalAssigned(params).catch((err: any) => {
    logger.error('[notifications] approval assigned notify error', { error: err?.message });
  });
}
