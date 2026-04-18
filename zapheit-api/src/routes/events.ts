import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { validateApiKey } from '../middleware/api-key-validation';
import { supabaseRestAsService, eq } from '../lib/supabase-rest';
import { logger } from '../lib/logger';

const router = express.Router();

// All routes require a valid API key.
router.use(validateApiKey);

const inboundEventSchema = z.object({
  event_type: z.string().min(1).max(100),
  source: z.string().min(1).max(100),
  agent_id: z.string().optional(),
  idempotency_key: z.string().max(255).optional(),
  timestamp: z.string().datetime().optional(),
  payload: z.record(z.any()).optional().default({}),
});

/**
 * Derive a work-item type and summary from the inbound event so that it can
 * be surfaced in the Zapheit dashboard without the caller knowing our internal
 * data model.
 */
function classifyEvent(eventType: string, source: string, payload: Record<string, any>) {
  const type = eventType.toLowerCase();

  if (type.includes('refund') || type.includes('payout') || type.includes('payment')) {
    return {
      workItemType: 'support_ticket' as const,
      title: payload.title || `Refund / Payment event from ${source}`,
      description: payload.description || `Inbound event: ${eventType}`,
      priority: type.includes('fail') ? 'high' : 'medium',
    };
  }

  if (type.includes('lead') || type.includes('deal') || type.includes('crm')) {
    return {
      workItemType: 'sales_lead' as const,
      title: payload.company_name || payload.title || `Lead event from ${source}`,
      description: payload.description || `Inbound event: ${eventType}`,
    };
  }

  if (type.includes('access') || type.includes('provision') || type.includes('identity')) {
    return {
      workItemType: 'access_request' as const,
      title: payload.subject || payload.title || `Access event from ${source}`,
      description: payload.description || `Inbound event: ${eventType}`,
    };
  }

  // Default: surface as a support ticket so operators see it.
  return {
    workItemType: 'support_ticket' as const,
    title: payload.title || `${eventType} from ${source}`,
    description: payload.description || `Inbound agent event received from ${source}.`,
    priority: 'medium',
  };
}

// POST /events/inbound
router.post('/inbound', async (req: Request, res: Response) => {
  try {
    const parsed = inboundEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map((e) => e.message),
      });
    }

    const orgId = req.apiKey?.organization_id;
    if (!orgId) {
      return res.status(401).json({ success: false, error: 'Invalid API key — no organization found' });
    }

    const { event_type, source, agent_id, idempotency_key, payload } = parsed.data;
    const eventId = `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    // Idempotency: skip duplicates stored in the last hour.
    if (idempotency_key) {
      const existing = (await supabaseRestAsService('work_items', new URLSearchParams({
        organization_id: eq(orgId),
        'metadata->>inbound_idempotency_key': eq(idempotency_key),
        'created_at': `gte.${new Date(Date.now() - 60 * 60 * 1000).toISOString()}`,
        select: 'id',
        limit: '1',
      }))) as any[];

      if (existing && existing.length > 0) {
        return res.status(200).json({
          success: true,
          duplicate: true,
          event_id: eventId,
          message: 'Event already processed (idempotency key matched).',
        });
      }
    }

    // Resolve agent reference (optional — soft-link only).
    let resolvedAgentId: string | null = null;
    if (agent_id) {
      const agents = (await supabaseRestAsService('ai_agents', new URLSearchParams({
        organization_id: eq(orgId),
        id: eq(agent_id),
        select: 'id',
        limit: '1',
      }))) as any[];
      resolvedAgentId = agents?.[0]?.id || null;
    }

    const classification = classifyEvent(event_type, source, payload);

    // Persist as a work item so it appears in the Jobs / Work Items dashboard.
    const workItemBody: Record<string, any> = {
      organization_id: orgId,
      type: classification.workItemType,
      status: 'open',
      stage: 'new',
      title: classification.title,
      description: classification.description,
      priority: (classification as any).priority || 'medium',
      created_at: now,
      updated_at: now,
      metadata: {
        inbound_event: true,
        event_id: eventId,
        event_type,
        source,
        ...(idempotency_key ? { inbound_idempotency_key: idempotency_key } : {}),
        ...(resolvedAgentId ? { agent_id: resolvedAgentId } : {}),
        raw_payload: payload,
      },
    };

    const created = (await supabaseRestAsService('work_items', '', {
      method: 'POST',
      body: workItemBody,
    })) as any[];

    const workItem = Array.isArray(created) ? created[0] : created;

    logger.info('Inbound event received', {
      event_id: eventId,
      event_type,
      source,
      org_id: orgId,
      work_item_id: workItem?.id,
    });

    return res.status(201).json({
      success: true,
      event_id: eventId,
      work_item_id: workItem?.id || null,
      message: 'Event received and queued.',
    });
  } catch (error: any) {
    logger.error('Failed to process inbound event', { error: error.message });
    return res.status(500).json({ success: false, error: error.message || 'Failed to process event' });
  }
});

// GET /events/inbound — list recent inbound events for this org.
router.get('/inbound', async (req: Request, res: Response) => {
  try {
    const orgId = req.apiKey?.organization_id;
    if (!orgId) {
      return res.status(401).json({ success: false, error: 'Invalid API key' });
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const query = new URLSearchParams({
      organization_id: eq(orgId),
      'metadata->>inbound_event': eq('true'),
      order: 'created_at.desc',
      limit: String(limit),
      select: 'id,type,status,title,priority,created_at,metadata',
    });

    const items = (await supabaseRestAsService('work_items', query)) as any[];

    return res.json({ success: true, data: items || [] });
  } catch (error: any) {
    logger.error('Failed to list inbound events', { error: error.message });
    return res.status(500).json({ success: false, error: error.message || 'Failed to list events' });
  }
});

export default router;
