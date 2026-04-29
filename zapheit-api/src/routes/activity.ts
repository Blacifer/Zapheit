import { Router, type Request, type Response } from 'express';
import { eq, gt, supabaseRestAsUser } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import type {
  ProductionActivityTone,
  ProductionActivityType,
  ProductionReadinessStatus,
  UnifiedProductionActivityEvent,
} from '../lib/production-activity';

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const STREAM_BOOTSTRAP_LIMIT = 25;
const STREAM_POLL_INTERVAL_MS = 5000;
const ACTIVITY_SELECT = 'id,action,resource_type,resource_id,user_id,created_at,details';
const APPROVAL_SELECT = 'id,service,action,status,required_role,requested_by,reviewer_id,agent_id,created_at,updated_at,reviewed_at,expires_at';
const JOB_SELECT = 'id,agent_id,runtime_instance_id,type,status,error,created_by,created_at,started_at,finished_at,input,output';
const INCIDENT_SELECT = 'id,agent_id,incident_type,severity,status,title,description,created_at,resolved_at';
const CONNECTOR_EXECUTION_SELECT = 'id,agent_id,connector_id,action,success,error_message,duration_ms,approval_required,approval_id,created_at';
const INTEGRATION_SELECT = 'id,service_type,service_name,category,status,last_sync_at,last_error_at,last_error_msg,created_at,updated_at';
const COST_SELECT = 'id,agent_id,conversation_id,date,model_name,total_tokens,cost_usd,request_count,created_at';

type AuditLogActivityRow = {
  id: string;
  action?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  user_id?: string | null;
  created_at?: string | null;
  details?: Record<string, any> | null;
};

type ApprovalActivityRow = {
  id: string;
  service?: string | null;
  action?: string | null;
  status?: string | null;
  required_role?: string | null;
  requested_by?: string | null;
  reviewer_id?: string | null;
  agent_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  reviewed_at?: string | null;
  expires_at?: string | null;
};

type JobActivityRow = {
  id: string;
  agent_id?: string | null;
  runtime_instance_id?: string | null;
  type?: string | null;
  status?: string | null;
  error?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  input?: Record<string, any> | null;
  output?: Record<string, any> | null;
};

type IncidentActivityRow = {
  id: string;
  agent_id?: string | null;
  incident_type?: string | null;
  severity?: string | null;
  status?: string | null;
  title?: string | null;
  description?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
};

type ConnectorExecutionActivityRow = {
  id: string;
  agent_id?: string | null;
  connector_id?: string | null;
  action?: string | null;
  success?: boolean | null;
  error_message?: string | null;
  duration_ms?: number | null;
  approval_required?: boolean | null;
  approval_id?: string | null;
  created_at?: string | null;
};

type IntegrationActivityRow = {
  id: string;
  service_type?: string | null;
  service_name?: string | null;
  category?: string | null;
  status?: string | null;
  last_sync_at?: string | null;
  last_error_at?: string | null;
  last_error_msg?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CostActivityRow = {
  id: string;
  agent_id?: string | null;
  conversation_id?: string | null;
  date?: string | null;
  model_name?: string | null;
  total_tokens?: number | null;
  cost_usd?: number | string | null;
  request_count?: number | null;
  created_at?: string | null;
};

const ACTIVITY_TYPES = new Set<ProductionActivityType>(['approval', 'incident', 'job', 'connector', 'audit', 'cost']);
const READINESS_STATUSES = new Set<ProductionReadinessStatus>(['not_configured', 'needs_policy', 'ready', 'deployed', 'degraded', 'blocked']);
const ACTIVITY_TONES = new Set<ProductionActivityTone>(['info', 'success', 'warn', 'risk']);

function parseLimit(value: unknown, fallback = DEFAULT_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)));
}

function parseSince(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  return timestamp.toISOString();
}

function cleanText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function cleanNullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function eventTime(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function serviceLabel(value?: string | null) {
  return cleanText(value, 'connector')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatUsd(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount >= 1 ? 2 : 4,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function titleFromAuditAction(action: string) {
  return action
    .replace(/[._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeActivityEvent(row: AuditLogActivityRow): UnifiedProductionActivityEvent {
  const createdAt = row.created_at || new Date().toISOString();
  const action = cleanText(row.action, 'audit.event');
  const resourceType = cleanText(row.resource_type, 'resource');
  const raw = row.details?.unified_activity_event;

  if (raw && typeof raw === 'object') {
    const type = ACTIVITY_TYPES.has(raw.type) ? raw.type : 'audit';
    const status = READINESS_STATUSES.has(raw.status) ? raw.status : 'deployed';
    const tone = ACTIVITY_TONES.has(raw.tone) ? raw.tone : 'success';

    return {
      id: cleanText(raw.id, `audit-${row.id}`),
      type,
      at: cleanText(raw.at, createdAt),
      title: cleanText(raw.title, titleFromAuditAction(action)),
      detail: cleanText(raw.detail, `${resourceType.replace(/_/g, ' ')} · audit evidence recorded`),
      status,
      tone,
      route: cleanNullableText(raw.route) || 'audit-log',
      actor: cleanNullableText(raw.actor) || row.user_id || null,
      sourceRef: cleanNullableText(raw.sourceRef) || row.resource_id || row.id,
      evidenceRef: cleanNullableText(raw.evidenceRef) || row.id,
    };
  }

  return {
    id: `audit-${row.id}`,
    type: 'audit',
    at: createdAt,
    title: titleFromAuditAction(action),
    detail: `${resourceType.replace(/_/g, ' ')} · audit evidence recorded`,
    status: 'deployed',
    tone: 'success',
    route: 'audit-log',
    actor: row.user_id || null,
    sourceRef: row.resource_id || row.id,
    evidenceRef: row.id,
  };
}

function normalizeApprovalEvent(row: ApprovalActivityRow): UnifiedProductionActivityEvent {
  const status = cleanText(row.status, 'pending').toLowerCase();
  const service = serviceLabel(row.service);
  const action = serviceLabel(row.action);
  const reviewed = Boolean(row.reviewed_at);
  const at = eventTime(reviewed ? row.reviewed_at : row.created_at, row.updated_at, row.created_at);
  const statusMap: Record<string, { readiness: ProductionReadinessStatus; tone: ProductionActivityTone; verb: string }> = {
    pending: { readiness: 'needs_policy', tone: 'warn', verb: 'Approval requested' },
    approved: { readiness: 'deployed', tone: 'success', verb: 'Approval approved' },
    denied: { readiness: 'blocked', tone: 'risk', verb: 'Approval denied' },
    expired: { readiness: 'blocked', tone: 'warn', verb: 'Approval expired' },
    cancelled: { readiness: 'blocked', tone: 'warn', verb: 'Approval cancelled' },
  };
  const mapped = statusMap[status] || statusMap.pending;

  return {
    id: `approval-${row.id}-${status}`,
    type: 'approval',
    at,
    title: `${mapped.verb}: ${service} · ${action}`,
    detail: `${cleanText(row.required_role, 'manager')} review · requested by ${cleanText(row.requested_by, 'agent')}`,
    status: mapped.readiness,
    tone: mapped.tone,
    route: 'approvals',
    actor: row.reviewer_id || row.requested_by || null,
    sourceRef: row.id,
    evidenceRef: row.id,
  };
}

function normalizeJobEvent(row: JobActivityRow): UnifiedProductionActivityEvent {
  const status = cleanText(row.status, 'queued').toLowerCase();
  const type = cleanText(row.type, 'job').replace(/_/g, ' ');
  const at = eventTime(
    status === 'succeeded' || status === 'failed' || status === 'canceled' ? row.finished_at : null,
    status === 'running' ? row.started_at : null,
    row.created_at,
  );
  const statusMap: Record<string, { readiness: ProductionReadinessStatus; tone: ProductionActivityTone; verb: string }> = {
    pending_approval: { readiness: 'needs_policy', tone: 'warn', verb: 'Job waiting for approval' },
    queued: { readiness: 'ready', tone: 'info', verb: 'Runtime job queued' },
    running: { readiness: 'deployed', tone: 'info', verb: 'Runtime job running' },
    succeeded: { readiness: 'deployed', tone: 'success', verb: 'Runtime job succeeded' },
    failed: { readiness: 'blocked', tone: 'risk', verb: 'Runtime job failed' },
    canceled: { readiness: 'blocked', tone: 'warn', verb: 'Runtime job canceled' },
  };
  const mapped = statusMap[status] || statusMap.queued;
  const costUsd = Number(row.output?.cost_usd || row.output?.usage?.cost_usd || row.output?.raw?.usage?.cost_usd || 0);
  const costDetail = Number.isFinite(costUsd) && costUsd > 0 ? ` · ${formatUsd(costUsd)}` : '';

  return {
    id: `job-${row.id}-${status}`,
    type: 'job',
    at,
    title: `${mapped.verb}: ${type}`,
    detail: `${row.runtime_instance_id ? `Runtime ${row.runtime_instance_id}` : 'Runtime pending'}${costDetail}${row.error ? ` · ${row.error}` : ''}`,
    status: mapped.readiness,
    tone: mapped.tone,
    route: 'jobs',
    actor: row.created_by || null,
    sourceRef: row.id,
    evidenceRef: row.id,
  };
}

function normalizeIncidentEvent(row: IncidentActivityRow): UnifiedProductionActivityEvent {
  const incidentStatus = cleanText(row.status, 'open').toLowerCase();
  const severity = cleanText(row.severity, 'low').toLowerCase();
  const resolved = incidentStatus === 'resolved' || incidentStatus === 'false_positive';
  const severe = severity === 'critical' || severity === 'high';

  return {
    id: `incident-${row.id}-${incidentStatus}`,
    type: 'incident',
    at: eventTime(resolved ? row.resolved_at : row.created_at, row.created_at),
    title: resolved
      ? `Incident ${incidentStatus.replace(/_/g, ' ')}: ${cleanText(row.title, serviceLabel(row.incident_type))}`
      : `Incident opened: ${cleanText(row.title, serviceLabel(row.incident_type))}`,
    detail: `${severity} · ${incidentStatus}${row.description ? ` · ${row.description}` : ''}`,
    status: resolved ? 'deployed' : severe ? 'blocked' : 'degraded',
    tone: resolved ? 'success' : severe ? 'risk' : 'warn',
    route: 'incidents',
    actor: null,
    sourceRef: row.id,
    evidenceRef: row.id,
  };
}

function normalizeConnectorExecutionEvent(row: ConnectorExecutionActivityRow): UnifiedProductionActivityEvent {
  const connector = serviceLabel(row.connector_id);
  const action = serviceLabel(row.action);
  const success = row.success === true;
  const approvalRequired = row.approval_required === true;
  const duration = typeof row.duration_ms === 'number' && row.duration_ms >= 0 ? ` · ${row.duration_ms}ms` : '';

  return {
    id: `connector-execution-${row.id}-${success ? 'succeeded' : 'failed'}`,
    type: 'connector',
    at: eventTime(row.created_at),
    title: `${connector} · ${action} ${success ? 'executed' : approvalRequired ? 'needs review' : 'failed'}`,
    detail: success
      ? `Production action recorded${duration}`
      : `${approvalRequired ? 'Approval required' : 'Execution failed'}${row.error_message ? ` · ${row.error_message}` : ''}`,
    status: success ? 'deployed' : approvalRequired ? 'needs_policy' : 'degraded',
    tone: success ? 'success' : approvalRequired ? 'warn' : 'risk',
    route: 'apps',
    actor: null,
    sourceRef: row.id,
    evidenceRef: row.approval_id || row.id,
  };
}

function normalizeIntegrationEvent(row: IntegrationActivityRow): UnifiedProductionActivityEvent {
  const status = cleanText(row.status, 'disconnected').toLowerCase();
  const degraded = status === 'error' || status === 'expired';
  const connected = status === 'connected' || status === 'syncing';
  const appName = cleanText(row.service_name, serviceLabel(row.service_type));

  return {
    id: `connector-health-${row.id}-${status}`,
    type: 'connector',
    at: eventTime(row.last_error_at, row.last_sync_at, row.updated_at, row.created_at),
    title: `${appName} connector ${status.replace(/_/g, ' ')}`,
    detail: degraded
      ? cleanText(row.last_error_msg, 'Connector credentials or provider health needs attention')
      : `${cleanText(row.category, 'App')} · ${connected ? 'available for production workflows' : 'not connected'}`,
    status: degraded ? 'degraded' : connected ? 'deployed' : 'not_configured',
    tone: degraded ? 'warn' : connected ? 'success' : 'info',
    route: 'apps',
    actor: null,
    sourceRef: row.id,
    evidenceRef: row.id,
  };
}

function normalizeCostEvent(row: CostActivityRow): UnifiedProductionActivityEvent {
  const requests = Number(row.request_count || 0);
  const tokens = Number(row.total_tokens || 0);

  return {
    id: `cost-${row.id}`,
    type: 'cost',
    at: eventTime(row.created_at, row.date),
    title: `Cost recorded: ${formatUsd(row.cost_usd)}`,
    detail: `${cleanText(row.model_name, 'model unknown')} · ${requests.toLocaleString()} request(s) · ${tokens.toLocaleString()} tokens`,
    status: 'deployed',
    tone: 'info',
    route: 'costs',
    actor: null,
    sourceRef: row.id,
    evidenceRef: row.id,
  };
}

function requireUserJwt(req: Request, res: Response): string | null {
  const userJwt = req.userJwt;
  if (!userJwt) {
    res.status(401).json({ success: false, error: 'Unauthorized', requestId: req.requestId });
    return null;
  }
  return userJwt;
}

function requireOrganizationId(req: Request, res: Response): string | null {
  const organizationId = req.user?.organization_id;
  if (!organizationId) {
    res.status(409).json({
      success: false,
      error: 'Workspace not provisioned for this account. Complete setup and try again.',
      code: 'WORKSPACE_NOT_PROVISIONED',
      requestId: req.requestId,
    });
    return null;
  }
  return organizationId;
}

async function loadActivityEvents(args: {
  userJwt: string;
  organizationId: string;
  limit: number;
  since?: string | null;
  ascending?: boolean;
}) {
  const direction = args.ascending ? 'asc' : 'desc';
  const buildQuery = (select: string, orderColumn = 'created_at', sinceFilter?: string) => {
    const query = new URLSearchParams();
    query.set('select', select);
    query.set('organization_id', eq(args.organizationId));
    query.set('order', `${orderColumn}.${direction}`);
    query.set('limit', String(args.limit));
    if (args.since) {
      if (sinceFilter) {
        query.set('or', sinceFilter);
      } else {
        query.set(orderColumn, gt(args.since));
      }
    }
    return query;
  };

  const loadSource = async <TRow>(
    source: string,
    table: string,
    query: URLSearchParams,
    normalize: (row: TRow) => UnifiedProductionActivityEvent,
  ) => {
    try {
      const rows = (await supabaseRestAsUser(args.userJwt, table, query)) as TRow[];
      return (rows || []).map(normalize);
    } catch (error: any) {
      logger.warn('Activity source query failed', {
        source,
        table,
        error: error?.message,
      });
      return [];
    }
  };

  const [
    auditEvents,
    approvalEvents,
    jobEvents,
    incidentEvents,
    connectorExecutionEvents,
    integrationEvents,
    costEvents,
  ] = await Promise.all([
    loadSource<AuditLogActivityRow>(
      'audit_logs',
      'audit_logs',
      buildQuery(ACTIVITY_SELECT),
      normalizeActivityEvent,
    ),
    loadSource<ApprovalActivityRow>(
      'approval_requests',
      'approval_requests',
      buildQuery(
        APPROVAL_SELECT,
        'created_at',
        `(created_at.gt.${args.since},updated_at.gt.${args.since},reviewed_at.gt.${args.since})`,
      ),
      normalizeApprovalEvent,
    ),
    loadSource<JobActivityRow>(
      'agent_jobs',
      'agent_jobs',
      buildQuery(
        JOB_SELECT,
        'created_at',
        `(created_at.gt.${args.since},started_at.gt.${args.since},finished_at.gt.${args.since})`,
      ),
      normalizeJobEvent,
    ),
    loadSource<IncidentActivityRow>(
      'incidents',
      'incidents',
      buildQuery(
        INCIDENT_SELECT,
        'created_at',
        `(created_at.gt.${args.since},resolved_at.gt.${args.since})`,
      ),
      normalizeIncidentEvent,
    ),
    loadSource<ConnectorExecutionActivityRow>(
      'connector_action_executions',
      'connector_action_executions',
      buildQuery(CONNECTOR_EXECUTION_SELECT),
      normalizeConnectorExecutionEvent,
    ),
    loadSource<IntegrationActivityRow>(
      'integrations',
      'integrations',
      buildQuery(
        INTEGRATION_SELECT,
        'updated_at',
        `(updated_at.gt.${args.since},last_sync_at.gt.${args.since},last_error_at.gt.${args.since})`,
      ),
      normalizeIntegrationEvent,
    ),
    loadSource<CostActivityRow>(
      'cost_tracking',
      'cost_tracking',
      buildQuery(COST_SELECT),
      normalizeCostEvent,
    ),
  ]);

  const events = [
    ...auditEvents,
    ...approvalEvents,
    ...jobEvents,
    ...incidentEvents,
    ...connectorExecutionEvents,
    ...integrationEvents,
    ...costEvents,
  ].filter((event) => event.at);

  const seen = new Set<string>();
  return events
    .sort((a, b) => {
      const delta = new Date(a.at).getTime() - new Date(b.at).getTime();
      return args.ascending ? delta : -delta;
    })
    .filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .slice(0, args.limit);
}

function writeSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function latestTimestamp(current: string | null, events: UnifiedProductionActivityEvent[]) {
  return events.reduce((latest, event) => {
    if (!latest) return event.at;
    return new Date(event.at).getTime() > new Date(latest).getTime() ? event.at : latest;
  }, current);
}

router.get('/events', async (req: Request, res: Response) => {
  const userJwt = requireUserJwt(req, res);
  if (!userJwt) return;

  const organizationId = requireOrganizationId(req, res);
  if (!organizationId) return;

  try {
    const limit = parseLimit(req.query.limit);
    const since = parseSince(req.query.since);
    const events = await loadActivityEvents({
      userJwt,
      organizationId,
      limit,
      since,
      ascending: false,
    });

    res.json({
      success: true,
      data: {
        events,
        generatedAt: new Date().toISOString(),
        nextCursor: events[0]?.at || null,
      },
      requestId: req.requestId,
    });
  } catch (error: any) {
    logger.error('Activity events query failed', {
      requestId: req.requestId,
      error: error?.message,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to load activity events',
      requestId: req.requestId,
    });
  }
});

router.get('/stream', async (req: Request, res: Response) => {
  const userJwt = requireUserJwt(req, res);
  if (!userJwt) return;

  const organizationId = requireOrganizationId(req, res);
  if (!organizationId) return;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  req.socket.setKeepAlive(true);

  let closed = false;
  let cursor = parseSince(req.query.since);

  const emitEvents = async (limit: number) => {
    const hasCursor = Boolean(cursor);
    const events = await loadActivityEvents({
      userJwt,
      organizationId,
      limit,
      since: cursor,
      ascending: hasCursor,
    });
    const eventsToEmit = hasCursor ? events : [...events].reverse();

    for (const event of eventsToEmit) {
      writeSse(res, 'activity', event);
    }

    cursor = latestTimestamp(cursor, eventsToEmit);
    return eventsToEmit.length;
  };

  try {
    const bootstrapCount = await emitEvents(STREAM_BOOTSTRAP_LIMIT);
    writeSse(res, 'ready', {
      at: new Date().toISOString(),
      bootstrapCount,
    });
  } catch (error: any) {
    logger.warn('Activity stream bootstrap failed', {
      requestId: req.requestId,
      error: error?.message,
    });
    writeSse(res, 'stream_error', {
      at: new Date().toISOString(),
      message: 'Activity stream source is temporarily unavailable',
    });
  }

  const interval = setInterval(async () => {
    if (closed) return;
    try {
      const count = await emitEvents(STREAM_BOOTSTRAP_LIMIT);
      writeSse(res, 'heartbeat', {
        at: new Date().toISOString(),
        emitted: count,
      });
    } catch (error: any) {
      logger.warn('Activity stream poll failed', {
        requestId: req.requestId,
        error: error?.message,
      });
      writeSse(res, 'stream_error', {
        at: new Date().toISOString(),
        message: 'Activity stream source is temporarily unavailable',
      });
    }
  }, STREAM_POLL_INTERVAL_MS);

  req.on('close', () => {
    closed = true;
    clearInterval(interval);
  });
});

export default router;
