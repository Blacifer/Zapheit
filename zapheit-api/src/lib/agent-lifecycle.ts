/**
 * Agent Lifecycle State Machine
 *
 * Enforces legal transitions between lifecycle states and writes an immutable
 * audit trail to agent_lifecycle_transitions.
 *
 * States (HR metaphor):
 *   draft          → job posting
 *   provisioning   → onboarding
 *   active         → employed
 *   suspended      → leave of absence
 *   decommissioning → notice period
 *   terminated     → terminated (terminal)
 */

import { supabaseRestAsService, eq } from './supabase-rest';
import { auditLog } from './audit-logger';
import { dispatchWebhookEvent, WebhookEventId } from './webhook-relay';
import { logger } from './logger';

export type LifecycleState =
  | 'draft'
  | 'provisioning'
  | 'active'
  | 'suspended'
  | 'decommissioning'
  | 'terminated';

/** Legal transitions: fromState → allowed toStates */
const TRANSITION_MATRIX: Record<LifecycleState, LifecycleState[]> = {
  draft:           ['provisioning'],
  provisioning:    ['active', 'terminated'],
  active:          ['suspended', 'decommissioning', 'terminated'],
  suspended:       ['active', 'decommissioning', 'terminated'],
  decommissioning: ['terminated'],
  terminated:      [],
};

/** Map lifecycle transitions to webhook events where applicable */
const TRANSITION_WEBHOOK: Partial<Record<LifecycleState, WebhookEventId>> = {
  suspended:  'agent.suspended',
};

export interface LifecycleTransitionResult {
  agentId: string;
  fromState: LifecycleState;
  toState: LifecycleState;
  transitionId: string;
}

export class LifecycleTransitionError extends Error {
  constructor(
    public readonly fromState: LifecycleState,
    public readonly toState: LifecycleState,
  ) {
    super(
      `Illegal lifecycle transition: ${fromState} → ${toState}. ` +
      `Allowed: ${TRANSITION_MATRIX[fromState].join(', ') || 'none (terminal state)'}`,
    );
    this.name = 'LifecycleTransitionError';
  }
}

/**
 * Transition an agent to a new lifecycle state.
 *
 * @param agentId    UUID of the agent
 * @param orgId      UUID of the owning organization (for audit + webhook scoping)
 * @param toState    Target state
 * @param reason     Human-readable reason for the transition
 * @param actorEmail Email of the user initiating the transition (for audit trail)
 * @param actorId    User ID for audit log
 */
export async function transitionLifecycle(
  agentId: string,
  orgId: string,
  toState: LifecycleState,
  reason?: string,
  actorEmail?: string,
  actorId?: string,
): Promise<LifecycleTransitionResult> {
  // 1. Fetch current lifecycle state
  const query = new URLSearchParams();
  query.set('id', eq(agentId));
  query.set('select', 'id,lifecycle_state,name');

  const rows = await supabaseRestAsService('ai_agents', query) as any[];
  if (!rows || rows.length === 0) {
    throw new Error(`Agent ${agentId} not found`);
  }

  const agent = rows[0];
  const fromState: LifecycleState = (agent.lifecycle_state ?? 'active') as LifecycleState;

  // 2. Validate the transition
  const allowed = TRANSITION_MATRIX[fromState] ?? [];
  if (!allowed.includes(toState)) {
    throw new LifecycleTransitionError(fromState, toState);
  }

  // 3. Update lifecycle_state on the agent
  const updateQuery = new URLSearchParams();
  updateQuery.set('id', eq(agentId));

  await supabaseRestAsService('ai_agents', updateQuery, {
    method: 'PATCH',
    body: { lifecycle_state: toState, updated_at: new Date().toISOString() },
  });

  // 4. Write transition audit record
  const transitionRows = await supabaseRestAsService('agent_lifecycle_transitions', '', {
    method: 'POST',
    body: {
      agent_id:        agentId,
      organization_id: orgId,
      from_state:      fromState,
      to_state:        toState,
      reason:          reason ?? null,
      actor_email:     actorEmail ?? null,
    },
  }) as any[];

  const transitionId: string = transitionRows?.[0]?.id ?? 'unknown';

  // 5. Structured audit log
  await auditLog.log({
    user_id:        actorId ?? '',
    action:         `agent.lifecycle.${toState}`,
    resource_type:  'agent',
    resource_id:    agentId,
    organization_id: orgId,
    metadata: { fromState, toState, reason, actorEmail, transitionId },
  });

  // 6. Fire webhook event if this transition has a mapped event
  const webhookEvent = TRANSITION_WEBHOOK[toState];
  if (webhookEvent) {
    try {
      await dispatchWebhookEvent(orgId, webhookEvent, {
        agentId,
        agentName: agent.name,
        fromState,
        toState,
        reason,
        actorEmail,
        transitionId,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      // Webhook dispatch failure must not block the response
      logger.warn('lifecycle webhook dispatch failed', { agentId, webhookEvent, error: err?.message });
    }
  }

  logger.info('agent lifecycle transition', { agentId, fromState, toState, actorEmail });

  return { agentId, fromState, toState, transitionId };
}

/**
 * Fetch the full transition history for an agent.
 */
export async function getLifecycleHistory(agentId: string): Promise<Array<{
  id: string;
  from_state: LifecycleState;
  to_state: LifecycleState;
  reason: string | null;
  actor_email: string | null;
  created_at: string;
}>> {
  const query = new URLSearchParams();
  query.set('agent_id', eq(agentId));
  query.set('order', 'created_at.asc');

  const rows = await supabaseRestAsService('agent_lifecycle_transitions', query) as any[];
  return rows ?? [];
}
