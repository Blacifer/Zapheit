import { auditLog } from './audit-logger';
import { logger } from './logger';

export type ProductionReadinessStatus =
  | 'not_configured'
  | 'needs_policy'
  | 'ready'
  | 'deployed'
  | 'degraded'
  | 'blocked';

export type ProductionActivityType =
  | 'approval'
  | 'incident'
  | 'job'
  | 'connector'
  | 'audit'
  | 'cost';

export type ProductionActivityTone = 'info' | 'success' | 'warn' | 'risk';

export interface UnifiedProductionActivityEvent {
  id: string;
  type: ProductionActivityType;
  at: string;
  title: string;
  detail: string;
  status: ProductionReadinessStatus;
  tone: ProductionActivityTone;
  route?: string;
  actor?: string | null;
  sourceRef?: string | null;
  evidenceRef?: string | null;
}

export async function recordProductionActivity(input: {
  organizationId: string;
  actorId?: string | null;
  auditAction: string;
  resourceType: string;
  resourceId?: string | null;
  event: Omit<UnifiedProductionActivityEvent, 'id' | 'at'> & {
    id?: string;
    at?: string;
  };
  metadata?: Record<string, any>;
}): Promise<UnifiedProductionActivityEvent> {
  const event: UnifiedProductionActivityEvent = {
    id: input.event.id || input.event.sourceRef || input.event.evidenceRef || `${input.event.type}:${Date.now()}`,
    at: input.event.at || new Date().toISOString(),
    type: input.event.type,
    title: input.event.title,
    detail: input.event.detail,
    status: input.event.status,
    tone: input.event.tone,
    route: input.event.route,
    actor: input.event.actor ?? input.actorId ?? null,
    sourceRef: input.event.sourceRef ?? input.resourceId ?? null,
    evidenceRef: input.event.evidenceRef ?? null,
  };

  try {
    await auditLog.log({
      user_id: input.actorId || 'system',
      action: input.auditAction,
      resource_type: input.resourceType,
      resource_id: input.resourceId || undefined,
      organization_id: input.organizationId,
      metadata: {
        ...(input.metadata || {}),
        unified_activity_event: event,
      },
    });
  } catch (error: any) {
    logger.warn('Failed to record production activity', {
      action: input.auditAction,
      resource_type: input.resourceType,
      error: error?.message,
    });
  }

  return event;
}

export function connectorActionTitle(connectorId: string, action: string) {
  return `${connectorId.replace(/[-_]/g, ' ')} · ${action.replace(/[-_]/g, ' ')}`;
}
