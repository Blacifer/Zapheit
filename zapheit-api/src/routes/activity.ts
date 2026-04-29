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

type AuditLogActivityRow = {
  id: string;
  action?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  user_id?: string | null;
  created_at?: string | null;
  details?: Record<string, any> | null;
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
  const query = new URLSearchParams();
  query.set('select', ACTIVITY_SELECT);
  query.set('organization_id', eq(args.organizationId));
  query.set('order', `created_at.${args.ascending ? 'asc' : 'desc'}`);
  query.set('limit', String(args.limit));
  if (args.since) {
    query.set('created_at', gt(args.since));
  }

  const rows = (await supabaseRestAsUser(args.userJwt, 'audit_logs', query)) as AuditLogActivityRow[];
  return (rows || []).map(normalizeActivityEvent);
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
