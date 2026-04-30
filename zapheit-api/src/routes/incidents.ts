import express, { Request, Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { supabaseRestAsUser, eq } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { validateRequestBody, incidentSchemas } from '../schemas/validation';
import { auditLog } from '../lib/audit-logger';
import { fireAndForgetWebhookEvent } from '../lib/webhook-relay';
import { firePlaybookTriggers } from '../lib/trigger-evaluator';
import { notifySlackIncident } from '../lib/slack-notify';
import { notifyAlertChannels } from '../lib/alert-channels';
import { buildFrontendUrl } from '../lib/frontend-url';
import { incidentDetection } from '../services/incident-detection';
import { attemptSelfHeal, revertSelfHeal, type SelfHealIncidentType } from '../services/self-healing';
import { errorResponse, getOrgId, getUserJwt, safeLimit } from '../lib/route-helpers';
import { parseCursorParams, buildCursorResponse, buildCursorFilter } from '../lib/pagination';
import { recordProductionActivity } from '../lib/production-activity';

const router = express.Router();

// ---------------------------------------------------------------------------
// SSE client registry — push new incidents to connected dashboards in real-time
// ---------------------------------------------------------------------------
type SseClient = Response & { orgId?: string };
const sseClients = new Map<string, Set<SseClient>>();

/**
 * Push a new incident payload to all SSE clients subscribed for this org.
 * Called from POST /incidents, POST /detect, and gateway incident detection.
 */
export function pushIncidentEvent(orgId: string, incident: Record<string, unknown>): void {
  const clients = sseClients.get(orgId);
  if (!clients || clients.size === 0) return;
  const payload = JSON.stringify(incident);
  for (const client of clients) {
    try {
      client.write(`event: incident.new\ndata: ${payload}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

// Get incidents
router.get('/incidents', requirePermission('incidents.read'), async (req: Request, res: Response) => {
  try {
    const { agent_id, severity, status } = req.query;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.info('Fetching incidents', { org_id: orgId, agent_id, severity, status });

    const { limit, cursorId, cursorCreatedAt } = parseCursorParams(req);
    const cursorFilter = buildCursorFilter(cursorId, cursorCreatedAt);

    const incidentsQuery = new URLSearchParams();
    incidentsQuery.set('organization_id', eq(orgId));
    incidentsQuery.set('order', 'created_at.desc,id.desc');
    incidentsQuery.set('limit', String(limit + 1));
    if (cursorFilter) incidentsQuery.set('or', cursorFilter);
    if (agent_id) incidentsQuery.set('agent_id', eq(String(agent_id)));
    if (severity) incidentsQuery.set('severity', eq(String(severity)));
    if (status) incidentsQuery.set('status', eq(String(status)));

    const rows = await supabaseRestAsUser(getUserJwt(req), 'incidents', incidentsQuery) as any[];
    const paged = buildCursorResponse(rows || [], limit);

    logger.info('Incidents fetched successfully', { count: paged.data?.length, org_id: orgId });

    res.json({ success: true, data: paged.data, count: paged.data?.length || 0, next_cursor: paged.next_cursor, has_more: paged.has_more });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// Create incident
router.post('/incidents', requirePermission('incidents.create'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    const { valid, data: validatedData, errors } = validateRequestBody<z.infer<typeof incidentSchemas.create>>(incidentSchemas.create, req.body);
    if (!valid || !validatedData) {
      logger.warn('Invalid incident creation request', { errors });
      return res.status(400).json({ success: false, errors });
    }

    const {
      agent_id,
      conversation_id,
      incident_type,
      severity,
      title,
      description,
      trigger_content,
      ai_response,
    } = validatedData;

    logger.info('Creating incident', { org_id: orgId, incident_type, severity });

    const data = await supabaseRestAsUser(
      getUserJwt(req),
      'incidents',
      '',
      {
        method: 'POST',
        body: {
          organization_id: orgId,
          agent_id,
          conversation_id,
          incident_type,
          severity: severity || 'medium',
          title,
          description,
          trigger_content,
          ai_response,
          status: 'open',
        },
      }
    );

    // Update agent risk score if critical or high
    if (severity === 'critical' || severity === 'high') {
      const supabaseUrl = process.env.SUPABASE_URL;
      const anonKey = process.env.SUPABASE_ANON_KEY;
      const apiKey = anonKey || '';
      try {
        await fetch(`${supabaseUrl}/rest/v1/rpc/increment_agent_risk_score`, {
          method: 'POST',
          headers: {
            'apikey': apiKey,
            'Authorization': `Bearer ${getUserJwt(req)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            agent_id,
            increment: severity === 'critical' ? 20 : 10,
          }),
        });
      } catch (rpcError) {
        logger.warn('Failed to update agent risk score via RPC', { error: rpcError });
      }
    }

    logger.info('Incident created successfully', { incident_id: data?.[0]?.id, severity });

    // Push to SSE clients for this org
    if (data?.[0]) pushIncidentEvent(orgId, data[0]);

    auditLog.log({
      user_id: req.user?.id || 'system',
      action: 'incident.created',
      resource_type: 'incident',
      resource_id: data?.[0]?.id,
      organization_id: orgId,
      metadata: { incident_type, severity, title },
    });

    if (data?.[0]?.id) {
      const incidentSeverity = severity || 'medium';
      await recordProductionActivity({
        organizationId: orgId,
        actorId: req.user?.id || 'system',
        auditAction: 'incident.opened',
        resourceType: 'incident',
        resourceId: data[0].id,
        event: {
          type: 'incident',
          title: `Incident opened: ${title}`,
          detail: `${incidentSeverity} · ${description || incident_type}`,
          status: ['critical', 'high'].includes(String(incidentSeverity).toLowerCase()) ? 'blocked' : 'degraded',
          tone: ['critical', 'high'].includes(String(incidentSeverity).toLowerCase()) ? 'risk' : 'warn',
          route: 'incidents',
          sourceRef: data[0].id,
          evidenceRef: data[0].id,
        },
        metadata: {
          production_journey: { stage: 'incident_opened', source: 'incident_api' },
          incident_type,
          severity: incidentSeverity,
          agent_id,
          conversation_id,
        },
      });
    }

    fireAndForgetWebhookEvent(orgId, 'incident.created', {
      id: `evt_incident_${data?.[0]?.id || crypto.randomUUID()}`,
      type: 'incident.created',
      created_at: new Date().toISOString(),
      organization_id: orgId,
      data: {
        incident_id: data?.[0]?.id,
        agent_id,
        conversation_id,
        severity: severity || 'medium',
        incident_type,
        title,
        description,
      },
    });

    // Slack notification (fire and forget)
    void notifySlackIncident(orgId, {
      incidentId: data?.[0]?.id,
      title,
      severity: severity || 'medium',
      incidentType: incident_type,
      agentId: agent_id,
      description,
    });

    // Alert channels: PagerDuty / Teams / Opsgenie / email (fire and forget)
    void notifyAlertChannels(orgId, {
      incidentId: data?.[0]?.id,
      title,
      severity: (severity || 'medium') as any,
      incidentType: incident_type,
      agentId: agent_id,
      description,
      dashboardUrl: buildFrontendUrl('/dashboard/incidents'),
    });

    // Evaluate playbook triggers for incident.created event.
    firePlaybookTriggers(orgId, 'incident.created', {
      incident_id: data?.[0]?.id,
      agent_id,
      conversation_id,
      severity: severity || 'medium',
      incident_type,
      title,
      description,
    });

    res.status(201).json({ success: true, data });

    // Self-healing: attempt automatic remediation for supported incident types.
    const incidentId = data?.[0]?.id;
    const SELF_HEAL_TYPES: SelfHealIncidentType[] = ['pii_leak', 'cost_spike', 'policy_breach', 'latency_breach', 'hallucination'];
    if (incidentId && agent_id && SELF_HEAL_TYPES.includes(incident_type as SelfHealIncidentType)) {
      void (async () => {
        const result = await attemptSelfHeal(incidentId, agent_id, orgId, incident_type as SelfHealIncidentType);
        if (result.healed) {
          logger.info('self-heal: incident auto-resolved', { incidentId, stepsApplied: result.stepsApplied });
        }
      })();
    }
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// Resolve incident
router.put('/incidents/:id/resolve', requirePermission('incidents.resolve'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { resolution_notes } = req.body;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.info('Resolving incident', { incident_id: id, org_id: orgId });

    const resolveQuery = new URLSearchParams();
    resolveQuery.set('id', eq(id));
    resolveQuery.set('organization_id', eq(orgId));

    const data = await supabaseRestAsUser(
      getUserJwt(req),
      'incidents',
      resolveQuery,
      {
        method: 'PATCH',
        body: {
          status: 'resolved',
          resolution_notes,
          resolved_at: new Date().toISOString(),
        },
      }
    );

    if (!data?.length) {
      return errorResponse(res, new Error('Incident not found'), 404);
    }

    auditLog.incidentResolved(
      req.user?.id || 'unknown',
      id,
      orgId,
      resolution_notes
    );

    await recordProductionActivity({
      organizationId: orgId,
      actorId: req.user?.id || 'unknown',
      auditAction: 'incident.resolved',
      resourceType: 'incident',
      resourceId: id,
      event: {
        type: 'incident',
        title: `Incident resolved: ${data[0]?.title || id}`,
        detail: resolution_notes || 'Incident moved to resolved state with audit evidence.',
        status: 'deployed',
        tone: 'success',
        route: 'incidents',
        sourceRef: id,
        evidenceRef: id,
      },
      metadata: {
        production_journey: { stage: 'incident_resolved', source: 'incident_api' },
        resolution_notes: resolution_notes || null,
      },
    });

    fireAndForgetWebhookEvent(orgId, 'incident.resolved', {
      id: `evt_incident_resolve_${id}`,
      type: 'incident.resolved',
      created_at: new Date().toISOString(),
      organization_id: orgId,
      data: {
        incident_id: id,
        resolved_by: req.user?.id || 'unknown',
        resolution_notes: resolution_notes || null,
      },
    });

    logger.info('Incident resolved successfully', { incident_id: id });

    res.json({ success: true, data: data[0] });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// Delete incident
router.delete('/incidents/:id', requirePermission('incidents.delete'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    const deleteQuery = new URLSearchParams();
    deleteQuery.set('id', eq(id));
    deleteQuery.set('organization_id', eq(orgId));

    const deleted = (await supabaseRestAsUser(getUserJwt(req), 'incidents', deleteQuery, {
      method: 'DELETE',
    })) as any[];

    if (!deleted || deleted.length === 0) {
      return errorResponse(res, new Error('Incident not found'), 404);
    }

    auditLog.log({
      user_id: req.user?.id || 'unknown',
      action: 'incident.deleted',
      resource_type: 'incident',
      resource_id: id,
      organization_id: orgId,
      metadata: {
        performed_by_email: req.user?.email || 'unknown',
      },
    });

    return res.json({
      success: true,
      message: 'Incident deleted successfully',
      data: { id },
    });
  } catch (error: any) {
    return errorResponse(res, error);
  }
});

// Update incident metadata fields
router.patch('/incidents/:id', requirePermission('incidents.resolve'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const ALLOWED_FIELDS = ['owner', 'priority', 'source', 'notes', 'next_action', 'status'] as const;

    const updates: Record<string, string> = {};
    for (const field of ALLOWED_FIELDS) {
      if (field in req.body && req.body[field] !== undefined) {
        updates[field] = String(req.body[field]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return errorResponse(res, new Error('No valid fields to update'), 400);
    }

    if (updates.status === 'resolved' && !(updates as any).resolved_at) {
      (updates as any).resolved_at = new Date().toISOString();
    }

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));

    const data = await supabaseRestAsUser(getUserJwt(req), 'incidents', q, {
      method: 'PATCH',
      body: updates,
    });

    if (!data?.length) return errorResponse(res, new Error('Incident not found'), 404);

    return res.json({ success: true, data: data[0] });
  } catch (error: any) {
    return errorResponse(res, error);
  }
});

// Detect potential incidents in AI agent output
router.post('/detect', requirePermission('incidents.create'), async (req: Request, res: Response) => {
  try {
    const { content, agent_id } = req.body;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    if (!content) {
      return errorResponse(res, new Error('Content is required'), 400);
    }

    logger.info('Running incident detection', { org_id: orgId, agent_id });

    const results = incidentDetection.fullScan(content);
    const highest = incidentDetection.getHighestSeverity(results);

    if (highest && (highest.severity === 'critical' || highest.severity === 'high')) {
      // Auto-suppress: skip if >5 false positives for this type in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      try {
        const fpQuery = new URLSearchParams({
          select: 'id',
          organization_id: eq(orgId),
          incident_type: eq(String(highest.type)),
          status: eq('false_positive'),
          created_at: `gte.${thirtyDaysAgo}`,
        });
        const fpRows = await supabaseRestAsUser(getUserJwt(req), 'incidents', fpQuery) as any[];
        if (Array.isArray(fpRows) && fpRows.length > 5) {
          logger.info('Auto-suppressed incident (>5 FP in 30d)', { type: highest.type, orgId });
          return res.json({ success: true, results, highest, needsIncident: false, suppressed: true });
        }
      } catch { /* non-fatal */ }

      const incidentRows = await supabaseRestAsUser(
        getUserJwt(req),
        'incidents',
        '',
        {
          method: 'POST',
          body: {
            organization_id: orgId,
            agent_id,
            incident_type: highest.type,
            severity: highest.severity,
            title: `${highest.type?.replace('_', ' ').toUpperCase()} Detected`,
            description: highest.details,
            trigger_content: content,
            status: 'open',
            confidence: highest.confidence,
          },
        }
      );
      const incident = incidentRows?.[0];
      logger.warn('Incident detected and created', { incident_type: highest.type, severity: highest.severity });

      // Push to SSE clients
      if (incident) pushIncidentEvent(orgId, incident);

      if (incident?.id) {
        const detectedTitle = `${highest.type?.replace('_', ' ').toUpperCase()} Detected`;
        await recordProductionActivity({
          organizationId: orgId,
          actorId: req.user?.id || 'system',
          auditAction: 'incident.detected',
          resourceType: 'incident',
          resourceId: incident.id,
          event: {
            type: 'incident',
            title: `Incident detected: ${detectedTitle}`,
            detail: `${highest.severity} · ${highest.details}`,
            status: 'blocked',
            tone: 'risk',
            route: 'incidents',
            sourceRef: incident.id,
            evidenceRef: incident.id,
          },
          metadata: {
            production_journey: { stage: 'incident_detected', source: 'incident_detection' },
            incident_type: highest.type,
            severity: highest.severity,
            confidence: highest.confidence,
            agent_id,
          },
        });
      }

      // Slack + alert channels (fire-and-forget, all three notification paths)
      if (incident) {
        const detectedTitle = `${highest.type?.replace('_', ' ').toUpperCase()} Detected`;
        void notifySlackIncident(orgId, {
          incidentId: incident.id,
          title: detectedTitle,
          severity: highest.severity,
          incidentType: highest.type || '',
          agentId: agent_id || undefined,
          description: highest.details,
        });
        void notifyAlertChannels(orgId, {
          incidentId: incident.id,
          title: detectedTitle,
          severity: highest.severity as any,
          incidentType: highest.type || '',
          agentId: agent_id || undefined,
          description: highest.details,
          dashboardUrl: buildFrontendUrl('/dashboard/incidents'),
        });
      }

      fireAndForgetWebhookEvent(orgId, 'incident.created', {
        id: `evt_detect_${incident?.id || crypto.randomUUID()}`,
        type: 'incident.created',
        created_at: new Date().toISOString(),
        organization_id: orgId,
        data: {
          incident_id: incident?.id,
          agent_id,
          severity: highest.severity,
          incident_type: highest.type,
          title: `${highest.type?.replace('_', ' ').toUpperCase()} Detected`,
          description: highest.details,
        },
      });

      // Playbook triggers (same as POST /incidents path)
      firePlaybookTriggers(orgId, 'incident.created', {
        incident_id: incident?.id,
        agent_id,
        severity: highest.severity,
        incident_type: highest.type,
        title: `${highest.type?.replace('_', ' ').toUpperCase()} Detected`,
        description: highest.details,
      });
    }

    res.json({
      success: true,
      results,
      highest,
      needsIncident: highest !== null,
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// SSE stream endpoint — clients connect here to receive real-time incident events
router.get('/incidents/stream', requirePermission('incidents.read'), (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(401).json({ success: false, error: 'Organization not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const client = res as SseClient;
  client.orgId = orgId;

  if (!sseClients.has(orgId)) sseClients.set(orgId, new Set());
  sseClients.get(orgId)!.add(client);

  // Send connected event so the client knows the stream is live
  res.write('event: connected\ndata: {}\n\n');

  const pingTimer = setInterval(() => {
    try {
      res.write('event: ping\ndata: {}\n\n');
    } catch {
      clearInterval(pingTimer);
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(pingTimer);
    sseClients.get(orgId)?.delete(client);
    if (sseClients.get(orgId)?.size === 0) sseClients.delete(orgId);
  });
});

/**
 * POST /incidents/:id/revert-self-heal
 * Human override: undo automatic remediation within the grace period.
 */
router.post('/incidents/:id/revert-self-heal', requirePermission('incidents.resolve'), async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const userId = req.user?.id;
  const incidentId = req.params.id;

  if (!orgId || !userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  // Look up which agent this incident belongs to
  const incidentRows = await (async () => {
    try {
      return await supabaseRestAsUser(getUserJwt(req), 'incidents', new URLSearchParams({
        select: 'agent_id',
        id: `eq.${incidentId}`,
        organization_id: `eq.${orgId}`,
        limit: '1',
      })) as any[];
    } catch {
      return [];
    }
  })();

  const agentId = Array.isArray(incidentRows) ? incidentRows[0]?.agent_id : null;
  if (!agentId) return res.status(404).json({ success: false, error: 'Incident not found or no agent attached' });

  const reverted = await revertSelfHeal(agentId, orgId, userId);
  if (!reverted) {
    return res.status(400).json({ success: false, error: 'No self-heal snapshot found or revert failed' });
  }
  return res.json({ success: true, message: 'Agent restored to pre-self-heal state' });
});

export default router;
