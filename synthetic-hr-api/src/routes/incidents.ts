import express, { Request, Response } from 'express';
import { z } from 'zod';
import { requirePermission, requireRole } from '../middleware/rbac';
import { supabaseRestAsUser, eq } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { validateRequestBody, incidentSchemas } from '../schemas/validation';
import { auditLog } from '../lib/audit-logger';
import { fireAndForgetWebhookEvent } from '../lib/webhook-relay';
import { firePlaybookTriggers } from '../lib/trigger-evaluator';
import { notifySlackIncident } from '../lib/slack-notify';
import { incidentDetection } from '../services/incident-detection';
import { errorResponse, getOrgId, getUserJwt, safeLimit } from '../lib/route-helpers';

const router = express.Router();

// Get incidents
router.get('/incidents', requirePermission('incidents.read'), async (req: Request, res: Response) => {
  try {
    const { agent_id, severity, status, limit = 50 } = req.query;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.info('Fetching incidents', { org_id: orgId, agent_id, severity, status });

    const incidentsQuery = new URLSearchParams();
    incidentsQuery.set('organization_id', eq(orgId));
    incidentsQuery.set('order', 'created_at.desc');
    incidentsQuery.set('limit', String(safeLimit(limit)));
    if (agent_id) incidentsQuery.set('agent_id', eq(String(agent_id)));
    if (severity) incidentsQuery.set('severity', eq(String(severity)));
    if (status) incidentsQuery.set('status', eq(String(status)));

    const data = await supabaseRestAsUser(getUserJwt(req), 'incidents', incidentsQuery);

    logger.info('Incidents fetched successfully', { count: data?.length, org_id: orgId });

    res.json({ success: true, data, count: data?.length || 0 });
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

    auditLog.log({
      user_id: req.user?.id || 'system',
      action: 'incident.created',
      resource_type: 'incident',
      resource_id: data?.[0]?.id,
      organization_id: orgId,
      metadata: { incident_type, severity, title },
    });

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

export default router;
