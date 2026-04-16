import express, { Request, Response } from 'express';
import { z } from 'zod';
import { supabaseRestAsUser, eq } from '../lib/supabase-rest';
import { requirePermission } from '../middleware/rbac';
import { logger } from '../lib/logger';
import { auditLog } from '../lib/audit-logger';
import { sendTransactionalEmail } from '../lib/email';
import { retryWithBackoff, generateIdempotencyKey, isRetryableError } from '../lib/retry';

const router = express.Router();

// Schemas
const escalateIncidentSchema = z.object({
  channel: z.enum(['slack', 'pagerduty', 'email']),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  assignee: z.string().optional(),
  notes: z.string().optional(),
});

const updateEscalationSchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved']).optional(),
  notes: z.string().optional(),
});

const incidentAlertSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  incident_type: z.string().min(1),
  agent_name: z.string().optional(),
  assignee: z.string().optional(),
  notes: z.string().optional(),
});

// Helper: Get organization from authenticated user
const getOrgId = (req: Request): string | null => {
  return req.user?.organization_id || null;
};

const getUserJwt = (req: Request): string => {
  const jwt = (req as any).userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

function logAlertDelivery(event: {
  channel: 'slack' | 'pagerduty' | 'email';
  status: 'success' | 'failed';
  source: 'incident_alert_relay' | 'incident_escalation';
  incidentId: string;
  severity: string;
  orgId: string;
  requestId?: string;
  httpStatus?: number;
  error?: string;
}) {
  const payload = {
    channel: event.channel,
    status: event.status,
    source: event.source,
    incident_id: event.incidentId,
    severity: event.severity,
    org_id: event.orgId,
    request_id: event.requestId,
    http_status: event.httpStatus,
    error: event.error,
  };

  if (event.status === 'success') {
    logger.info('Alert delivery', payload);
    return;
  }

  logger.warn('Alert delivery', payload);
}

/**
 * POST /api/alerts/incident
 * Server-side alert relay for incident notifications (no browser-side webhook secrets)
 */
router.post('/alerts/incident', requirePermission('incidents.escalate'), async (req: Request, res: Response) => {
  try {
    const parsed = incidentAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map((e) => e.message),
      });
    }

    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const incident = {
      id: `adhoc-${Date.now()}`,
      incident_type: parsed.data.incident_type,
      issue_description: parsed.data.description,
      description: parsed.data.description,
      agent_name: parsed.data.agent_name || 'Unknown Agent',
      title: parsed.data.title,
    };

    const orgQuery = new URLSearchParams();
    orgQuery.set('id', eq(orgId));
    const orgs = (await supabaseRestAsUser(getUserJwt(req), 'organizations', orgQuery)) as any[];
    const org = orgs?.[0] || { settings: {} };
    const settings = org.settings || {};

    const delivery: Record<string, any> = {};
    const notes = parsed.data.notes;
    const assignee = parsed.data.assignee;

    // Slack delivery if configured
    if (settings.slack_webhook_url || process.env.SLACK_WEBHOOK_URL) {
      try {
        delivery.slack = await escalateToSlack(incident, parsed.data.severity, assignee, notes, settings);
        logAlertDelivery({
          channel: 'slack',
          status: 'success',
          source: 'incident_alert_relay',
          incidentId: incident.id,
          severity: parsed.data.severity,
          orgId,
          requestId: req.requestId,
          httpStatus: delivery.slack.slack_status_code,
        });
      } catch (error: any) {
        logAlertDelivery({
          channel: 'slack',
          status: 'failed',
          source: 'incident_alert_relay',
          incidentId: incident.id,
          severity: parsed.data.severity,
          orgId,
          requestId: req.requestId,
          error: error.message,
        });
      }
    }

    // Email delivery if recipient can be resolved
    if (assignee || settings.incident_email_recipient || process.env.ALERT_EMAIL_TO) {
      try {
        delivery.email = await escalateToEmail(incident, parsed.data.severity, assignee, notes, org);
        logAlertDelivery({
          channel: 'email',
          status: 'success',
          source: 'incident_alert_relay',
          incidentId: incident.id,
          severity: parsed.data.severity,
          orgId,
          requestId: req.requestId,
        });
      } catch (error: any) {
        logAlertDelivery({
          channel: 'email',
          status: 'failed',
          source: 'incident_alert_relay',
          incidentId: incident.id,
          severity: parsed.data.severity,
          orgId,
          requestId: req.requestId,
          error: error.message,
        });
      }
    }

    // PagerDuty for high/critical when configured
    const hasPagerDuty = Boolean(
      settings.pagerduty_integration_key ||
      settings.pagerduty_api_token ||
      process.env.PAGERDUTY_INTEGRATION_KEY ||
      process.env.PAGERDUTY_API_TOKEN
    );
    if (hasPagerDuty && (parsed.data.severity === 'high' || parsed.data.severity === 'critical')) {
      try {
        delivery.pagerduty = await escalateToPagerDuty(incident, parsed.data.severity, assignee, notes, settings, orgId);
        logAlertDelivery({
          channel: 'pagerduty',
          status: 'success',
          source: 'incident_alert_relay',
          incidentId: incident.id,
          severity: parsed.data.severity,
          orgId,
          requestId: req.requestId,
          httpStatus: delivery.pagerduty.pagerduty_status_code,
        });
      } catch (error: any) {
        logAlertDelivery({
          channel: 'pagerduty',
          status: 'failed',
          source: 'incident_alert_relay',
          incidentId: incident.id,
          severity: parsed.data.severity,
          orgId,
          requestId: req.requestId,
          error: error.message,
        });
      }
    }

    if (Object.keys(delivery).length === 0) {
      return res.status(202).json({
        success: true,
        message: 'Alert logged. No external channels configured — set up Slack, PagerDuty, or email in Settings to enable notifications.',
        data: { channels_configured: false },
      });
    }

    return res.status(202).json({
      success: true,
      message: 'Incident alert dispatched from backend',
      data: delivery,
    });
  } catch (error: any) {
    logger.error('Incident alert relay failed', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/incidents/:id/escalate
 * Escalate an incident to Slack, PagerDuty, or Email
 */
router.post('/incidents/:id/escalate', requirePermission('incidents.escalate'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = escalateIncidentSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map((e) => e.message),
      });
    }

    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const { channel, severity, assignee, notes } = result.data;

    // Get incident details
    const incidentQuery = new URLSearchParams();
    incidentQuery.set('id', eq(id));
    incidentQuery.set('organization_id', eq(orgId));
    const incidents = (await supabaseRestAsUser(getUserJwt(req), 'incidents', incidentQuery)) as any[];

    if (!incidents || incidents.length === 0) {
      return res.status(404).json({ success: false, error: 'Incident not found' });
    }

    const incident = incidents[0];

    // Get organization settings for webhook URLs
    const orgQuery = new URLSearchParams();
    orgQuery.set('id', eq(orgId));
    const orgs = (await supabaseRestAsUser(getUserJwt(req), 'organizations', orgQuery)) as any[];
    if (!orgs || orgs.length === 0) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }

    const org = orgs[0];
    const settings = org.settings || {};

    // Send to specified channel
    let escalationDetails: any = {
      channel,
      incident_id: id,
      severity,
      timestamp: new Date().toISOString(),
    };

    try {
      if (channel === 'slack') {
        escalationDetails = await escalateToSlack(incident, severity, assignee, notes, settings);
        logAlertDelivery({
          channel: 'slack',
          status: 'success',
          source: 'incident_escalation',
          incidentId: id,
          severity,
          orgId,
          requestId: req.requestId,
          httpStatus: escalationDetails.slack_status_code,
        });
      } else if (channel === 'pagerduty') {
        escalationDetails = await escalateToPagerDuty(incident, severity, assignee, notes, settings, orgId);
        logAlertDelivery({
          channel: 'pagerduty',
          status: 'success',
          source: 'incident_escalation',
          incidentId: id,
          severity,
          orgId,
          requestId: req.requestId,
          httpStatus: escalationDetails.pagerduty_status_code,
        });
      } else if (channel === 'email') {
        escalationDetails = await escalateToEmail(incident, severity, assignee, notes, org);
        logAlertDelivery({
          channel: 'email',
          status: 'success',
          source: 'incident_escalation',
          incidentId: id,
          severity,
          orgId,
          requestId: req.requestId,
        });
      }
    } catch (escalationError: any) {
      logger.error('Escalation failed', { error: escalationError.message, channel });
      logAlertDelivery({
        channel,
        status: 'failed',
        source: 'incident_escalation',
        incidentId: id,
        severity,
        orgId,
        requestId: req.requestId,
        error: escalationError.message,
      });
      return res.status(500).json({
        success: false,
        error: `Failed to escalate to ${channel}: ${escalationError.message}`,
      });
    }

    // Store escalation record
    const escalationData = {
      organization_id: orgId,
      incident_id: id,
      channel,
      severity,
      status: 'open',
      assignee: assignee || null,
      escalation_details: escalationDetails,
      created_at: new Date().toISOString(),
    };

    const escalations = (await supabaseRestAsUser(getUserJwt(req), 'escalations', '', {
      method: 'POST',
      body: escalationData,
    })) as any[];

    if (!escalations || escalations.length === 0) {
      throw new Error('Failed to store escalation record');
    }

    // Audit log
    auditLog.log({
      user_id: req.user?.id || 'unknown',
      action: 'incident.escalated',
      resource_type: 'incident',
      resource_id: id,
      organization_id: orgId,
      metadata: { channel, severity, assignee },
    });

    logger.info('Incident escalated successfully', {
      incident_id: id,
      org_id: orgId,
      channel,
      escalation_id: escalations[0].id,
    });

    res.status(201).json({
      success: true,
      data: escalations[0],
      message: `Incident escalated to ${channel}`,
    });
  } catch (error: any) {
    logger.error('Escalation endpoint error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/escalations
 * List escalations for the organization
 */
router.get('/escalations', requirePermission('incidents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');

    const escalations = (await supabaseRestAsUser(getUserJwt(req), 'escalations', query)) as any[];

    logger.info('Escalations listed', { org_id: orgId, count: escalations?.length || 0 });

    res.json({
      success: true,
      data: escalations || [],
      count: escalations?.length || 0,
    });
  } catch (error: any) {
    logger.error('Escalations list failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/escalations/:id
 * Get a specific escalation
 */
router.get('/escalations/:id', requirePermission('incidents.read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const query = new URLSearchParams();
    query.set('id', eq(id));
    query.set('organization_id', eq(orgId));

    const escalations = (await supabaseRestAsUser(getUserJwt(req), 'escalations', query)) as any[];

    if (!escalations || escalations.length === 0) {
      return res.status(404).json({ success: false, error: 'Escalation not found' });
    }

    logger.info('Escalation retrieved', { escalation_id: id, org_id: orgId });

    res.json({ success: true, data: escalations[0] });
  } catch (error: any) {
    logger.error('Escalation retrieval failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/escalations/:id
 * Update escalation status (acknowledge, resolve)
 */
router.patch('/escalations/:id', requirePermission('incidents.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = updateEscalationSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map((e) => e.message),
      });
    }

    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const updates = result.data;

    const query = new URLSearchParams();
    query.set('id', eq(id));
    query.set('organization_id', eq(orgId));

    const escalations = (await supabaseRestAsUser(getUserJwt(req), 'escalations', query, {
      method: 'PATCH',
      body: updates,
    })) as any[];

    if (!escalations || escalations.length === 0) {
      return res.status(404).json({ success: false, error: 'Escalation not found' });
    }

    // Audit log
    auditLog.log({
      user_id: req.user?.id || 'unknown',
      action: 'escalation.updated',
      resource_type: 'escalation',
      resource_id: id,
      organization_id: orgId,
      metadata: { updates },
    });

    logger.info('Escalation updated', { escalation_id: id, org_id: orgId });

    res.json({ success: true, data: escalations[0] });
  } catch (error: any) {
    logger.error('Escalation update failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== Helper Functions =====

/**
 * Escalate to Slack webhook
 */
async function escalateToSlack(
  incident: any,
  severity: string,
  assignee: string | undefined,
  notes: string | undefined,
  settings: any
): Promise<Record<string, any>> {
  const slackWebhookUrl = settings.slack_webhook_url || process.env.SLACK_WEBHOOK_URL;
  if (!slackWebhookUrl) {
    throw new Error('Slack webhook URL not configured');
  }

  const severityColor = {
    low: '#36a64f',
    medium: '#ff9900',
    high: '#ff6600',
    critical: '#ff0000',
  }[severity] || '#cccccc';

  const payload = {
    attachments: [
      {
        color: severityColor,
        title: `Incident Escalation: ${incident.incident_type}`,
        title_link: `${process.env.FRONTEND_URL}/incidents/${incident.id}`,
        fields: [
          {
            title: 'Incident ID',
            value: incident.id,
            short: true,
          },
          {
            title: 'Severity',
            value: severity.toUpperCase(),
            short: true,
          },
          {
            title: 'Agent',
            value: incident.agent_name || 'Unknown',
            short: true,
          },
          {
            title: 'Issue',
            value: incident.issue_description || 'No description',
            short: false,
          },
          {
            title: 'Notes',
            value: notes || 'No additional notes',
            short: false,
          },
        ],
        timestamp: Math.floor(Date.now() / 1000),
      },
    ],
  };

  // Wrap in retry logic
  const result = await retryWithBackoff(
    async () => {
      const response = await fetch(slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        const error: any = new Error(`Slack webhook failed: ${response.status} ${body}`);
        error.response = { status: response.status };
        throw error;
      }

      return {
        slack_response: 'Message posted',
        slack_status_code: response.status,
        assignee_mentioned: assignee ? `@${assignee}` : 'None',
      };
    },
    {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
    },
    {
      operation: 'escalateToSlack',
      incidentId: incident.id,
      severity,
    }
  );

  if (!result.success) {
    throw result.error || new Error('Slack escalation failed after retries');
  }

  return result.data!;
}

/**
 * Escalate to PagerDuty
 */
async function escalateToPagerDuty(
  incident: any,
  severity: string,
  assignee: string | undefined,
  notes: string | undefined,
  settings: any,
  orgId: string
): Promise<Record<string, any>> {
  const pdToken = settings.pagerduty_api_token || process.env.PAGERDUTY_API_TOKEN;
  const pdServiceId = settings.pagerduty_service_id || process.env.PAGERDUTY_SERVICE_ID;
  const pdIntegrationKey = settings.pagerduty_integration_key || process.env.PAGERDUTY_INTEGRATION_KEY;

  if (!pdToken && !pdIntegrationKey) {
    throw new Error('PagerDuty credentials not configured');
  }

  // Map severity to PagerDuty severity
  const pdSeverity =
    {
      low: 'info',
      medium: 'warning',
      high: 'error',
      critical: 'critical',
    }[severity] || 'error';

  const description = `${incident.incident_type}: ${incident.issue_description || 'No description'}`;

  // Use Integration Key (Enqueue Event API) for simpler setup
  if (pdIntegrationKey) {
    const result = await retryWithBackoff(
      async () => {
        const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            routing_key: pdIntegrationKey,
            event_action: 'trigger',
            dedup_key: `incident_${incident.id}`,
            payload: {
              summary: description,
              severity: pdSeverity,
              source: 'Zapheit',
              component: incident.agent_name || 'Unknown Agent',
              custom_details: {
                incident_id: incident.id,
                org_id: orgId,
                escalated_by: assignee || 'System',
                notes,
              },
            },
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          const error: any = new Error(`PagerDuty enqueue failed: ${response.status} ${body}`);
          error.response = { status: response.status };
          throw error;
        }

        return {
          pagerduty_status: 'Event created',
          pagerduty_status_code: response.status,
          dedup_key: `incident_${incident.id}`,
        };
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
      },
      {
        operation: 'escalateToPagerDuty',
        incidentId: incident.id,
        severity,
      }
    );

    if (!result.success) {
      throw result.error || new Error('PagerDuty escalation failed after retries');
    }

    return result.data!;
  }

  // Fallback to REST API if token is provided
  const result = await retryWithBackoff(
    async () => {
      const response = await fetch('https://api.pagerduty.com/incidents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token token=${pdToken}`,
          From: 'synthetic-hr@example.com',
        },
        body: JSON.stringify({
          incidents: [
            {
              type: 'incident',
              title: description,
              service: {
                type: 'service_reference',
                id: pdServiceId,
              },
              urgency: severity === 'critical' ? 'high' : 'low',
              body: {
                type: 'incident_body',
                details: notes || 'Escalated from Zapheit',
              },
            },
          ],
        }),
      });

      const responseData = (await response.json()) as any;

      if (!response.ok) {
        const error: any = new Error(`PagerDuty incident API failed: ${response.status} ${JSON.stringify(responseData)}`);
        error.response = { status: response.status };
        throw error;
      }

      const incident_id = responseData?.incidents?.[0]?.id;
      return {
        pagerduty_status: 'Incident created',
        pagerduty_status_code: response.status,
        pagerduty_incident_id: incident_id,
      };
    },
    {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
    },
    {
      operation: 'escalateToPagerDuty',
      incidentId: incident.id,
      severity,
    }
  );

  if (!result.success) {
    throw result.error || new Error('PagerDuty escalation failed after retries');
  }

  return result.data!;
}

async function escalateToEmail(
  incident: any,
  severity: string,
  assignee: string | undefined,
  notes: string | undefined,
  org: any
): Promise<Record<string, any>> {
  const recipientFromSettings = org?.settings?.incident_email_recipient;
  const fallbackRecipient = process.env.ALERT_EMAIL_TO;
  const recipient = assignee || recipientFromSettings || fallbackRecipient;

  if (!recipient) {
    throw new Error('No escalation email recipient configured (assignee, org.settings.incident_email_recipient, or ALERT_EMAIL_TO)');
  }

  const subject = `[${severity.toUpperCase()}] Zapheit Incident: ${incident.incident_type}`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <h2 style="margin-bottom: 8px;">Incident Escalation</h2>
      <p><strong>Incident ID:</strong> ${incident.id}</p>
      <p><strong>Severity:</strong> ${severity.toUpperCase()}</p>
      <p><strong>Agent:</strong> ${incident.agent_name || 'Unknown Agent'}</p>
      <p><strong>Issue:</strong> ${incident.issue_description || incident.description || 'No description provided'}</p>
      <p><strong>Notes:</strong> ${notes || 'No additional notes'}</p>
    </div>
  `;

  await sendTransactionalEmail({
    to: recipient,
    subject,
    html,
    text: `Incident ${incident.id} | ${severity.toUpperCase()} | ${incident.incident_type}`,
  });

  logger.info('Email escalation sent', {
    incident_id: incident.id,
    severity,
    recipient,
  });

  return {
    email_status: 'Sent',
    recipient,
  };
}

export default router;
