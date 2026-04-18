import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { eq, supabaseRestAsUser } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { fetchWithTimeout } from '../lib/timeouts';
import { retryWithBackoff } from '../lib/retry';

const router = express.Router();

const getUserJwt = (req: Request): string => {
  const jwt = (req as any).userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

const WEBHOOK_SETTINGS_KEY = 'rasi_webhooks';
const WEBHOOK_LOGS_KEY = 'rasi_webhook_logs';
const MAX_LOGS = 100;

const eventIds = [
  'usage.updated',
  'cost.alert',
  'reconciliation.alert',
  'error.occurred',
  'rate_limit.exceeded',
  'model.deprecated',
  'incident.created',
  'incident.resolved',
  'approval.requested',
  'approval.completed',
  'agent.suspended',
  'quota.warning',
  'policy.violated',
] as const;

const webhookCreateSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(eventIds)).min(1),
});

const webhookUpdateSchema = z.object({
  status: z.enum(['not_tested', 'healthy', 'failing', 'disabled']).optional(),
});

const webhookTestSchema = z.object({
  event: z.enum(eventIds),
});

type EventId = typeof eventIds[number];

type StoredWebhook = {
  id: string;
  url: string;
  events: EventId[];
  secret: string;
  status: 'not_tested' | 'healthy' | 'failing' | 'disabled';
  createdAt: string;
  updatedAt: string;
  lastTestedAt?: string;
  lastDeliveryAt?: string;
  successCount: number;
  failureCount: number;
};

type StoredWebhookLog = {
  id: string;
  webhookId: string;
  event: EventId;
  endpoint: string;
  attemptedAt: string;
  status: 'delivered' | 'failed';
  responseCode?: number;
  latencyMs?: number;
  note: string;
};

const getOrgId = (req: Request): string | null => req.user?.organization_id || null;

const sampleEventPayload = (event: EventId) => {
  const timestamp = new Date().toISOString();
  switch (event) {
    case 'usage.updated':
      return {
        id: 'evt_usage_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          agent_id: 'agent_sales_support',
          requests: 124,
          spend_inr: 1820,
          model: 'gpt-4o-mini',
        },
      };
    case 'cost.alert':
      return {
        id: 'evt_cost_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          threshold_percent: 85,
          projected_monthly_spend_inr: 248000,
          configured_limit_inr: 250000,
        },
      };
    case 'reconciliation.alert':
      return {
        id: 'evt_reconciliation_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          provider: 'openrouter',
          severity: 'warning',
          title: 'Provider-reported spend drift detected',
          message: 'The current provider-reported total differs from Zapheit-observed spend by 14.20 USD across the last 30-day window.',
        },
      };
    case 'error.occurred':
      return {
        id: 'evt_error_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          agent_id: 'agent_sales_support',
          severity: 'high',
          message: 'Provider timeout while routing request',
        },
      };
    case 'rate_limit.exceeded':
      return {
        id: 'evt_rate_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          scope: 'organization',
          window: '1m',
          allowed: 1000,
          observed: 1174,
        },
      };
    case 'model.deprecated':
      return {
        id: 'evt_model_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          model: 'gpt-4',
          replacement: 'gpt-4.1',
          effective_date: '2026-05-31',
        },
      };
    case 'incident.created':
      return {
        id: 'evt_incident_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          incident_id: 'inc_abc123',
          agent_id: 'agent_sales_support',
          severity: 'high',
          incident_type: 'pii_extraction',
          title: 'PII EXTRACTION Detected',
          description: 'Aadhaar number pattern found in agent response',
        },
      };
    case 'incident.resolved':
      return {
        id: 'evt_incident_resolve_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          incident_id: 'inc_abc123',
          resolved_by: 'user_xyz',
          resolution_notes: 'False positive — test data in staging environment',
        },
      };
    case 'approval.requested':
      return {
        id: 'evt_approval_req_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          approval_id: 'apr_abc123',
          agent_id: 'agent_sales_support',
          service: 'razorpay',
          action: 'initiate_refund',
          requested_by: 'user_xyz',
          required_role: 'admin',
          assigned_to: 'user_admin',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        },
      };
    case 'approval.completed':
      return {
        id: 'evt_approval_done_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          approval_id: 'apr_abc123',
          decision: 'approved',
          reviewer_id: 'user_admin',
          service: 'razorpay',
          action: 'initiate_refund',
        },
      };
    case 'agent.suspended':
      return {
        id: 'evt_suspend_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          agent_id: 'agent_sales_support',
          agent_name: 'Sales Support Bot',
          reason: 'Kill switch activated — emergency stop',
          suspended_by: 'user_xyz',
        },
      };
    case 'quota.warning':
      return {
        id: 'evt_quota_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          plan: 'retainer',
          quota: 200000,
          used: 162000,
          percent_used: 81,
          threshold_percent: 80,
        },
      };
    case 'policy.violated':
      return {
        id: 'evt_policy_001',
        type: event,
        created_at: timestamp,
        organization_id: 'org_demo',
        data: {
          agent_id: 'agent_sales_support',
          policy_id: 'pol_abc123',
          policy_name: 'No Refunds Over ₹50,000',
          action_blocked: 'initiate_refund',
          reason: 'Refund amount ₹75,000 exceeds policy limit',
        },
      };
  }
};

const generateSecret = () => `whsec_${crypto.randomUUID().replace(/-/g, '')}`;

const getOrgRecord = async (orgId: string, userJwt: string) => {
  const query = new URLSearchParams();
  query.set('id', eq(orgId));
  const orgs = (await supabaseRestAsUser(userJwt, 'organizations', query)) as any[];
  return orgs?.[0] || null;
};

const persistOrgSettings = async (orgId: string, userJwt: string, settings: Record<string, any>) => {
  const query = new URLSearchParams();
  query.set('id', eq(orgId));
  const updated = (await supabaseRestAsUser(userJwt, 'organizations', query, {
    method: 'PATCH',
    body: {
      settings,
      updated_at: new Date().toISOString(),
    },
  })) as any[];
  return updated?.[0] || null;
};

const readWebhookState = async (orgId: string, userJwt: string) => {
  const org = await getOrgRecord(orgId, userJwt);
  const settings = org?.settings || {};
  return {
    settings,
    webhooks: (settings[WEBHOOK_SETTINGS_KEY] || []) as StoredWebhook[],
    logs: (settings[WEBHOOK_LOGS_KEY] || []) as StoredWebhookLog[],
  };
};

const writeWebhookState = async (
  orgId: string,
  userJwt: string,
  settings: Record<string, any>,
  webhooks: StoredWebhook[],
  logs: StoredWebhookLog[]
) => {
  const nextSettings = {
    ...settings,
    [WEBHOOK_SETTINGS_KEY]: webhooks,
    [WEBHOOK_LOGS_KEY]: logs.slice(0, MAX_LOGS),
  };
  await persistOrgSettings(orgId, userJwt, nextSettings);
  return nextSettings;
};

router.get('/webhooks', requirePermission('settings.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const { webhooks, logs } = await readWebhookState(orgId, getUserJwt(req));

    return res.json({
      success: true,
      data: {
        webhooks,
        logs: logs.slice(0, 30),
      },
    });
  } catch (error: any) {
    logger.error('Failed to load webhooks', { error: error.message, user_id: req.user?.id });
    return res.status(500).json({ success: false, error: error.message || 'Failed to load webhooks' });
  }
});

router.post('/webhooks', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const parsed = webhookCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((item) => item.message) });
    }

    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const { settings, webhooks, logs } = await readWebhookState(orgId, getUserJwt(req));
    const trimmedUrl = parsed.data.url.trim();

    if (webhooks.some((webhook) => webhook.url === trimmedUrl)) {
      return res.status(409).json({ success: false, error: 'Webhook URL already exists' });
    }

    const timestamp = new Date().toISOString();
    const webhook: StoredWebhook = {
      id: `wh_${crypto.randomUUID().slice(0, 8)}`,
      url: trimmedUrl,
      events: parsed.data.events,
      secret: generateSecret(),
      status: 'not_tested',
      createdAt: timestamp,
      updatedAt: timestamp,
      successCount: 0,
      failureCount: 0,
    };

    await writeWebhookState(orgId, getUserJwt(req), settings, [webhook, ...webhooks], logs);

    return res.status(201).json({ success: true, data: webhook });
  } catch (error: any) {
    logger.error('Failed to create webhook', { error: error.message, user_id: req.user?.id });
    return res.status(500).json({ success: false, error: error.message || 'Failed to create webhook' });
  }
});

router.patch('/webhooks/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const parsed = webhookUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((item) => item.message) });
    }

    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const { id } = req.params;
    const { settings, webhooks, logs } = await readWebhookState(orgId, getUserJwt(req));
    const index = webhooks.findIndex((webhook) => webhook.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }

    const updatedWebhook = {
      ...webhooks[index],
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    } as StoredWebhook;

    const nextWebhooks = [...webhooks];
    nextWebhooks[index] = updatedWebhook;
    await writeWebhookState(orgId, getUserJwt(req), settings, nextWebhooks, logs);

    return res.json({ success: true, data: updatedWebhook });
  } catch (error: any) {
    logger.error('Failed to update webhook', { error: error.message, user_id: req.user?.id });
    return res.status(500).json({ success: false, error: error.message || 'Failed to update webhook' });
  }
});

router.post('/webhooks/:id/rotate-secret', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const { id } = req.params;
    const { settings, webhooks, logs } = await readWebhookState(orgId, getUserJwt(req));
    const index = webhooks.findIndex((webhook) => webhook.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }

    const updatedWebhook: StoredWebhook = {
      ...webhooks[index],
      secret: generateSecret(),
      status: 'not_tested',
      updatedAt: new Date().toISOString(),
    };

    const nextWebhooks = [...webhooks];
    nextWebhooks[index] = updatedWebhook;
    await writeWebhookState(orgId, getUserJwt(req), settings, nextWebhooks, logs);

    return res.json({ success: true, data: updatedWebhook });
  } catch (error: any) {
    logger.error('Failed to rotate webhook secret', { error: error.message, user_id: req.user?.id });
    return res.status(500).json({ success: false, error: error.message || 'Failed to rotate secret' });
  }
});

router.delete('/webhooks/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const { id } = req.params;
    const { settings, webhooks, logs } = await readWebhookState(orgId, getUserJwt(req));
    const existing = webhooks.find((webhook) => webhook.id === id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }

    await writeWebhookState(
      orgId,
      getUserJwt(req),
      settings,
      webhooks.filter((webhook) => webhook.id !== id),
      logs.filter((log) => log.webhookId !== id),
    );

    return res.json({ success: true, data: { id } });
  } catch (error: any) {
    logger.error('Failed to delete webhook', { error: error.message, user_id: req.user?.id });
    return res.status(500).json({ success: false, error: error.message || 'Failed to delete webhook' });
  }
});

router.post('/webhooks/:id/test', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const parsed = webhookTestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((item) => item.message) });
    }

    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const { id } = req.params;
    const { settings, webhooks, logs } = await readWebhookState(orgId, getUserJwt(req));
    const index = webhooks.findIndex((webhook) => webhook.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }

    const webhook = webhooks[index];
    if (webhook.status === 'disabled') {
      return res.status(400).json({ success: false, error: 'Webhook is disabled. Enable it before testing.' });
    }

    const attemptedAt = new Date().toISOString();
    const eventType = parsed.data.event;
    const payload = sampleEventPayload(eventType);
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const deliveryId = `dlv_${crypto.randomUUID()}`;
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    const startedAt = Date.now();
    const result = await retryWithBackoff(
      async () => {
        const response = await fetchWithTimeout(
          webhook.url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Zapheit-WebhookRelay/1.0',
              'X-Zapheit-Event': eventType,
              'X-Zapheit-Delivery-Id': deliveryId,
              'X-Zapheit-Timestamp': timestamp,
              'X-Zapheit-Signature': `sha256=${signature}`,
            },
            body,
          },
          { timeoutMs: 10000, retries: 0 },
        );

        const responseText = await response.text();
        if (!response.ok) {
          throw new Error(`Endpoint responded ${response.status}: ${responseText || response.statusText}`);
        }

        return {
          responseCode: response.status,
          responseText,
        };
      },
      { maxAttempts: 2, initialDelayMs: 500, maxDelayMs: 2000 },
      { webhook_id: webhook.id, org_id: orgId, event_type: eventType },
    );

    const latencyMs = Date.now() - startedAt;
    const deliveryLog: StoredWebhookLog = {
      id: deliveryId,
      webhookId: webhook.id,
      event: eventType,
      endpoint: webhook.url,
      attemptedAt,
      status: result.success ? 'delivered' : 'failed',
      responseCode: result.data?.responseCode,
      latencyMs,
      note: result.success ? 'Server-side signed POST delivered successfully.' : (result.error?.message || 'Delivery failed'),
    };

    const nextWebhook: StoredWebhook = {
      ...webhook,
      status: result.success ? 'healthy' : 'failing',
      updatedAt: attemptedAt,
      lastTestedAt: attemptedAt,
      lastDeliveryAt: attemptedAt,
      successCount: webhook.successCount + (result.success ? 1 : 0),
      failureCount: webhook.failureCount + (result.success ? 0 : 1),
    };

    const nextWebhooks = [...webhooks];
    nextWebhooks[index] = nextWebhook;
    const nextLogs = [deliveryLog, ...logs].slice(0, MAX_LOGS);

    await writeWebhookState(orgId, getUserJwt(req), settings, nextWebhooks, nextLogs);

    return res.json({
      success: true,
      data: {
        webhook: nextWebhook,
        log: deliveryLog,
        payload,
        deliveryMode: 'server_signed_post',
      },
    });
  } catch (error: any) {
    logger.error('Failed to test webhook delivery', { error: error.message, user_id: req.user?.id });
    return res.status(500).json({ success: false, error: error.message || 'Failed to test webhook delivery' });
  }
});

export default router;
