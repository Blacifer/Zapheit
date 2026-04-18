/**
 * Playbook trigger evaluator.
 *
 * Called after key system events (incident.created, job.completed, etc.).
 * Queries playbook_triggers for matching rules, maps event payload fields
 * to playbook input fields, and creates queued agent_jobs.
 */
import { supabaseRestAsService, eq } from './supabase-rest';
import { logger } from './logger';

export type TriggerEventType =
  | 'incident.created'
  | 'conversation.ended'
  | 'job.completed'
  | 'webhook.received';

function getByPath(obj: any, path: string): any {
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
  let cur: any = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Evaluate all enabled playbook_triggers for the given org and event type.
 * For each matching trigger, build the job input by mapping event payload
 * fields via trigger.field_mappings, then create a queued agent_job.
 *
 * This is fire-and-forget — call without awaiting from route handlers.
 */
export async function evaluateTriggers(
  organizationId: string,
  eventType: TriggerEventType,
  eventPayload: Record<string, any>,
): Promise<void> {
  try {
    const q = new URLSearchParams();
    q.set('organization_id', eq(organizationId));
    q.set('event_type', eq(eventType));
    q.set('enabled', eq('true'));
    q.set('limit', '20');

    const triggers = (await supabaseRestAsService('playbook_triggers', q)) as Array<{
      id: string;
      organization_id: string;
      playbook_id: string;
      agent_id: string;
      event_type: string;
      event_filter: Record<string, any> | null;
      field_mappings: Record<string, string>;
      enabled: boolean;
      created_by: string | null;
    }>;

    if (!triggers || triggers.length === 0) return;

    const now = nowIso();

    for (const trigger of triggers) {
      try {
        // Optional filter check: if event_filter is set, all keys must match.
        if (trigger.event_filter && typeof trigger.event_filter === 'object') {
          const filterPassed = Object.entries(trigger.event_filter).every(([key, expected]) => {
            const actual = getByPath(eventPayload, key);
            return actual === expected || String(actual) === String(expected);
          });
          if (!filterPassed) continue;
        }

        // Build job input by mapping event payload fields → playbook input fields.
        const mappedInput: Record<string, string> = {};
        if (trigger.field_mappings && typeof trigger.field_mappings === 'object') {
          for (const [playbookField, eventPath] of Object.entries(trigger.field_mappings)) {
            const value = getByPath(eventPayload, eventPath);
            if (value != null) {
              mappedInput[playbookField] = typeof value === 'string' ? value : JSON.stringify(value);
            }
          }
        }

        // Wrap in a minimal workflow_run input so the runtime can execute it.
        const jobInput = {
          trigger_event: eventType,
          trigger_id: trigger.id,
          playbook_id: trigger.playbook_id,
          fields: mappedInput,
          // Workflow steps will be empty — the runtime will need the playbook template.
          // For now the job records that it was triggered; a future enhancement
          // can store the full workflow in the trigger's field_mappings.
          workflow: {
            steps: [
              {
                id: 'step_1',
                kind: 'llm',
                messages: [
                  {
                    role: 'system',
                    content: `You are running the "${trigger.playbook_id}" playbook triggered by the "${eventType}" event.`,
                  },
                  {
                    role: 'user',
                    content: `Event payload:\n${JSON.stringify(eventPayload, null, 2)}\n\nMapped fields:\n${JSON.stringify(mappedInput, null, 2)}\n\nGenerate an appropriate response for this playbook.`,
                  },
                ],
              },
            ],
            final_step: 'step_1',
          },
        };

        // Find an active runtime for this org to route the job to.
        const runtimeQ = new URLSearchParams();
        runtimeQ.set('organization_id', eq(organizationId));
        runtimeQ.set('status', eq('online'));
        runtimeQ.set('order', 'last_heartbeat_at.desc');
        runtimeQ.set('limit', '1');
        const runtimes = (await supabaseRestAsService('runtime_instances', runtimeQ)) as Array<{ id: string }>;
        const runtimeId = runtimes?.[0]?.id || null;

        // Create the queued job.
        const created = (await supabaseRestAsService('agent_jobs', '', {
          method: 'POST',
          body: {
            organization_id: organizationId,
            agent_id: trigger.agent_id,
            runtime_instance_id: runtimeId,
            type: 'workflow_run',
            status: 'queued',
            input: jobInput,
            playbook_id: trigger.playbook_id,
            created_by: trigger.created_by || null,
            created_at: now,
            updated_at: now,
          },
        })) as any[];

        const job = created?.[0];
        if (job?.id) {
          // Pre-approve for audit trail.
          await supabaseRestAsService('agent_job_approvals', '', {
            method: 'POST',
            body: {
              organization_id: organizationId,
              job_id: job.id,
              status: 'approved',
              decided_by: null,
              decision_note: `Auto-approved: trigger "${eventType}"`,
              created_at: now,
              updated_at: now,
            },
          }).catch(() => void 0);

          logger.info('[trigger-evaluator] created job from trigger', {
            trigger_id: trigger.id,
            job_id: job.id,
            event_type: eventType,
            playbook_id: trigger.playbook_id,
          });
        }
      } catch (triggerErr: any) {
        // Don't abort evaluation of remaining triggers if one fails.
        logger.error('[trigger-evaluator] failed to process trigger', {
          trigger_id: trigger.id,
          error: triggerErr?.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('[trigger-evaluator] evaluation failed', {
      org_id: organizationId,
      event_type: eventType,
      error: err?.message,
    });
  }
}

/**
 * Fire-and-forget wrapper — safe to call from any route handler.
 */
export function firePlaybookTriggers(
  organizationId: string,
  eventType: TriggerEventType,
  eventPayload: Record<string, any>,
): void {
  void evaluateTriggers(organizationId, eventType, eventPayload).catch((err: any) => {
    logger.error('[trigger-evaluator] unhandled error', { error: err?.message });
  });
}
