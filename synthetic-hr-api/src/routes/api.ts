import crypto from 'crypto';
import express, { Request, Response } from 'express';
import type { AIAgent, Incident, CostTracking, Conversation } from '../lib/supabase';
import { incidentDetection } from '../services/incident-detection';
import { calculateTokenCost } from '../services/ai-service';
import { AnthropicService, OpenAIService } from '../services/ai-service';
import { logger } from '../lib/logger';
import { validateRequestBody, agentSchemas, incidentSchemas, costSchemas } from '../schemas/validation';
import { z } from 'zod';
import { requirePermission, requireRole } from '../middleware/rbac';
import { auditLog } from '../lib/audit-logger';
import { SupabaseRestError, supabaseRestAsUser, eq, gte, in_ } from '../lib/supabase-rest';
import { fireAndForgetWebhookEvent, getWebhookRelaySettings } from '../lib/webhook-relay';
import { getPromptCachingState, updatePromptCachingPolicy } from '../lib/prompt-caching';
import { deletePricingQuote, getPricingState, savePricingQuote, updatePricingConfig } from '../lib/pricing';
import { generateSafeHarborDocument, getSafeHarborState, updateSafeHarborConfig, updateSafeHarborContract } from '../lib/safe-harbor';

const router = express.Router();

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

const safeLimit = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIST_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(parsed, MAX_LIST_LIMIT);
};

// Helper: Get organization from authenticated user
const getOrgId = (req: Request): string | null => {
  return req.user?.organization_id || null;
};

const getUserJwt = (req: Request): string => {
  const jwt = (req as any).userJwt as string | undefined;
  if (!jwt) {
    throw new Error('Missing user JWT on request');
  }
  return jwt;
};

const clampDays = (value: unknown, fallback = 7, min = 7, max = 30) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

type AgentPublishStatus = 'not_live' | 'ready' | 'live';
type AgentPackId = 'recruitment' | 'support' | 'sales' | 'it' | 'finance' | 'compliance';

type AgentPublishMetadata = {
  publish_status?: AgentPublishStatus;
  primary_pack?: AgentPackId | null;
  integration_ids?: string[];
};

type IntegrationSummaryRow = {
  id: string;
  service_type: string;
  service_name: string;
  category: string;
  status: string;
  last_sync_at: string | null;
};

const toIsoDay = (value: Date) => value.toISOString().split('T')[0];

const buildDaySeries = (days: number) => {
  const dates: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    dates.push(toIsoDay(date));
  }
  return dates;
};

// Helper: Standard error response
const errorResponse = (res: Response, error: any, statusCode = 500) => {
  logger.error('API Error', { error: error.message, stack: error.stack });
  const resolvedStatusCode = error instanceof SupabaseRestError
    ? error.status
    : statusCode;
  const errorMessage = error instanceof SupabaseRestError
    ? error.responseBody
    : (error.message || 'Internal server error');

  res.status(resolvedStatusCode).json({
    success: false,
    error: errorMessage,
  });
};

const sanitizeIntegrationIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
};

const packIdFromCategory = (category: string | null | undefined): AgentPackId => {
  const normalized = String(category || '').toUpperCase();
  if (normalized === 'COMPLIANCE') return 'compliance';
  if (normalized === 'FINANCE' || normalized === 'PAYROLL' || normalized === 'GLOBAL_PAYROLL' || normalized === 'PAYMENTS') return 'finance';
  if (normalized === 'SUPPORT' || normalized === 'ITSM' || normalized === 'COMMUNICATION') return 'support';
  if (normalized === 'CRM') return 'sales';
  if (normalized === 'IAM' || normalized === 'IDENTITY' || normalized === 'COLLABORATION' || normalized === 'PRODUCTIVITY') return 'it';
  if (normalized === 'RECRUITMENT' || normalized === 'ATS' || normalized === 'HRMS') return 'recruitment';
  return 'it';
};

const readAgentPublishMetadata = (agent: any): AgentPublishMetadata => {
  const metadata = agent?.metadata && typeof agent.metadata === 'object' ? agent.metadata : {};
  const publish = metadata.publish && typeof metadata.publish === 'object' ? metadata.publish : {};
  return {
    publish_status: publish.publish_status,
    primary_pack: publish.primary_pack ?? null,
    integration_ids: sanitizeIntegrationIds(publish.integration_ids),
  };
};

const writeAgentPublishMetadata = (agent: any, updates: AgentPublishMetadata) => {
  const metadata = agent?.metadata && typeof agent.metadata === 'object' ? { ...agent.metadata } : {};
  const current = readAgentPublishMetadata(agent);
  metadata.publish = {
    publish_status: updates.publish_status ?? current.publish_status ?? 'not_live',
    primary_pack: updates.primary_pack !== undefined ? updates.primary_pack : (current.primary_pack ?? null),
    integration_ids: updates.integration_ids ?? current.integration_ids ?? [],
  };
  return metadata;
};

const enrichAgentRecords = async (
  req: Request,
  orgId: string,
  rawAgents: any[],
  conversationCounts?: Map<string, number>
) => {
  const integrationRows = (() => {
    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('select', 'id,service_type,service_name,category,status,last_sync_at');
    return supabaseRestAsUser(getUserJwt(req), 'integrations', query) as Promise<IntegrationSummaryRow[]>;
  })();

  let integrations: IntegrationSummaryRow[] = [];
  try {
    integrations = await integrationRows;
  } catch (err: any) {
    logger.warn('Failed to load integrations for agent enrichment', { error: err?.message || err, org_id: orgId });
  }

  const integrationByServiceType = new Map((integrations || []).map((row) => [row.service_type, row]));

  return (rawAgents || []).map((agent) => {
    const publish = readAgentPublishMetadata(agent);
    const connectedTargets = (publish.integration_ids || [])
      .map((integrationId) => integrationByServiceType.get(integrationId))
      .filter(Boolean)
      .map((integration) => ({
        integrationId: integration!.service_type,
        integrationName: integration!.service_name,
        packId: packIdFromCategory(integration!.category),
        status: integration!.status || 'disconnected',
        lastSyncAt: integration!.last_sync_at || null,
        lastActivityAt: integration!.last_sync_at || null,
      }));

    const publishStatus = publish.publish_status
      || (connectedTargets.length === 0 ? 'not_live' : connectedTargets.some((target) => target.status === 'connected') ? 'live' : 'ready');

    return {
      ...agent,
      budget_limit: agent.config?.budget_limit ?? 0,
      current_spend: agent.config?.current_spend ?? 0,
      auto_throttle: agent.config?.auto_throttle ?? false,
      conversations: conversationCounts?.get(agent.id) || agent.conversations || 0,
      publishStatus,
      primaryPack: publish.primary_pack ?? null,
      integrationIds: publish.integration_ids || [],
      connectedTargets,
      lastIntegrationSyncAt: connectedTargets[0]?.lastSyncAt || null,
    };
  });
};

// ============ AI AGENTS ============

// Get all agents
router.get('/agents', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.info('Fetching agents', { org_id: orgId, user_id: req.user?.id });

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');

    const rawData = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', query) as any[];

    // Conversations in the UI are treated as governed runtime interactions.
    // We approximate this by summing `request_count` from cost_tracking per-agent over the last 30 days.
    const conversationCounts = new Map<string, number>();
    try {
      const agentIds = (rawData || [])
        .map((agent) => agent?.id)
        .filter((id) => typeof id === 'string' && id.length > 0);

      if (agentIds.length > 0) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

        const costQuery = new URLSearchParams();
        costQuery.set('organization_id', eq(orgId));
        costQuery.set('date', gte(thirtyDaysAgoStr));
        costQuery.set('agent_id', in_(agentIds));
        costQuery.set('select', 'agent_id,request_count');
        costQuery.set('limit', '10000');

        const rows = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', costQuery)) as any[];
        for (const row of rows || []) {
          const agentId = row?.agent_id;
          if (typeof agentId !== 'string' || agentId.length === 0) continue;
          const requests = Number(row?.request_count || 0);
          if (!Number.isFinite(requests) || requests <= 0) continue;
          conversationCounts.set(agentId, (conversationCounts.get(agentId) || 0) + requests);
        }
      }
    } catch (err: any) {
      logger.warn('Failed to compute agent conversation counts', { error: err?.message || err, org_id: orgId });
    }

    const data = await enrichAgentRecords(req, orgId, rawData || [], conversationCounts);

    logger.info('Agents fetched successfully', { count: data?.length, org_id: orgId });

    res.json({
      success: true,
      data,
      count: data?.length || 0,
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// Get single agent
router.get('/agents/:id', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    const query = new URLSearchParams();
    query.set('id', eq(id));
    query.set('organization_id', eq(orgId));

    const rawData = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', query);

    if (!rawData || rawData.length === 0) {
      return errorResponse(res, new Error('Agent not found'), 404);
    }

    const agent = rawData[0];
    let conversations = 0;
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

      const costQuery = new URLSearchParams();
      costQuery.set('organization_id', eq(orgId));
      costQuery.set('date', gte(thirtyDaysAgoStr));
      costQuery.set('agent_id', eq(id));
      costQuery.set('select', 'request_count');
      costQuery.set('limit', '10000');

      const rows = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', costQuery)) as any[];
      conversations = (rows || []).reduce((sum, row) => sum + Number(row?.request_count || 0), 0);
      if (!Number.isFinite(conversations) || conversations < 0) conversations = 0;
    } catch (err: any) {
      logger.warn('Failed to compute agent conversation count', { error: err?.message || err, org_id: orgId, agent_id: id });
    }

    const [data] = await enrichAgentRecords(req, orgId, [agent], new Map([[id, conversations]]));

    res.json({ success: true, data });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// Create agent
/**
 * @openapi
 * /api/agents:
 *   post:
 *     summary: Create a new AI agent
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - provider
 *               - model
 *             properties:
 *               name:
 *                 type: string
 *                 example: Customer Support Agent
 *               provider:
 *                 type: string
 *                 enum: [openai, anthropic]
 *               model:
 *                 type: string
 *                 example: gpt-4o
 *               description:
 *                 type: string
 *               config:
 *                 type: object
 *     responses:
 *       201:
 *         description: Agent created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Agent'
 *       400:
 *         description: Invalid request body
 *       403:
 *         description: Insufficient permissions
 */
router.post('/agents', requirePermission('agents.create'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    // Validate request body
    const { valid, data: validatedData, errors } = validateRequestBody<z.infer<typeof agentSchemas.create>>(agentSchemas.create, req.body);
    if (!valid || !validatedData) {
      logger.warn('Invalid agent creation request', { errors, org_id: orgId });
      return res.status(400).json({ success: false, errors });
    }

    logger.info('Creating agent', { org_id: orgId, agent_name: validatedData.name });

    const { budget_limit, auto_throttle, publish_status, primary_pack, integration_ids, config, ...restAgentData } = validatedData;

    // Merge extra fields into config since they lack dedicated table columns
    const mergedConfig = {
      ...config,
      budget_limit,
      auto_throttle,
    };

    const metadata = writeAgentPublishMetadata({}, {
      publish_status,
      primary_pack: primary_pack ?? null,
      integration_ids,
    });

    const rawData = await supabaseRestAsUser(
      getUserJwt(req),
      'ai_agents',
      '',
      {
        method: 'POST',
        body: {
          organization_id: orgId,
          ...restAgentData,
          config: mergedConfig,
          metadata,
          status: 'active',
          risk_level: 'low',
          risk_score: 50,
        },
      }
    );

    // Audit log
    if (rawData && rawData[0]) {
      auditLog.agentCreated(
        req.user?.id || 'unknown',
        rawData[0].id,
        orgId,
        {
          name: validatedData.name,
          platform: validatedData.platform,
          model_name: validatedData.model_name,
          performed_by_email: req.user?.email || 'unknown',
        }
      );
    }

    logger.info('Agent created successfully', { agent_id: rawData?.[0]?.id, org_id: orgId });

    const [finalData] = rawData && rawData.length > 0
      ? await enrichAgentRecords(req, orgId, rawData, new Map())
      : [null];

    res.status(201).json({ success: true, data: finalData });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

/**
 * @openapi
 * /api/agents/{id}:
 *   put:
 *     summary: Update an AI agent
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [active, paused, killed]
 *               config:
 *                 type: object
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Agent not found
 */
router.put('/agents/:id', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    // Validate request body
    const { valid, data: validatedData, errors } = validateRequestBody<z.infer<typeof agentSchemas.update>>(agentSchemas.update, req.body);
    if (!valid || !validatedData) {
      logger.warn('Invalid agent update request', { errors, agent_id: id });
      return res.status(400).json({ success: false, errors });
    }

    logger.info('Updating agent', { agent_id: id, org_id: orgId });

    const agentUpdateQuery = new URLSearchParams();
    agentUpdateQuery.set('id', eq(id));
    agentUpdateQuery.set('organization_id', eq(orgId));

    const { budget_limit, current_spend, auto_throttle, publish_status, primary_pack, integration_ids, config, ...restUpdateData } = validatedData;

    const existingQuery = new URLSearchParams();
    existingQuery.set('id', eq(id));
    existingQuery.set('organization_id', eq(orgId));
    const existingRows = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', existingQuery) as any[];
    if (!existingRows || existingRows.length === 0) {
      return errorResponse(res, new Error('Agent not found'), 404);
    }
    const existingAgent = existingRows[0];

    // The DB query doesn't have these as top level columns so we pull them into config 
    // Wait config might overwrite existing if we do not merge with existing, 
    // but the PUT endpoint typically receives the full updated object or only what's changed.
    // For now we just safely append them if they exist.
    const mergedConfig = {
      ...(existingAgent.config || {}),
      ...config,
      ...(budget_limit !== undefined && { budget_limit }),
      ...(current_spend !== undefined && { current_spend }),
      ...(auto_throttle !== undefined && { auto_throttle }),
    };

    const metadata = writeAgentPublishMetadata(existingAgent, {
      publish_status,
      primary_pack,
      integration_ids,
    });

    const rawData = await supabaseRestAsUser(
      getUserJwt(req),
      'ai_agents',
      agentUpdateQuery,
      {
        method: 'PATCH',
        body: {
          ...restUpdateData,
          ...(Object.keys(mergedConfig).length > 0 && { config: mergedConfig }),
          metadata,
          updated_at: new Date().toISOString()
        },
      }
    );

    if (!rawData || rawData.length === 0) {
      return errorResponse(res, new Error('Agent not found'), 404);
    }

    // Audit log
    auditLog.agentUpdated(
      req.user?.id || 'unknown',
      id,
      orgId,
      {
        performed_by_email: req.user?.email || 'unknown',
        changes: validatedData,
      }
    );

    logger.info('Agent updated successfully', { agent_id: id });

    const [finalData] = await enrichAgentRecords(req, orgId, rawData, new Map());

    res.json({ success: true, data: finalData });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.get('/agents/:id/publish', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    const query = new URLSearchParams();
    query.set('id', eq(id));
    query.set('organization_id', eq(orgId));
    const rows = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', query) as any[];
    if (!rows || rows.length === 0) {
      return errorResponse(res, new Error('Agent not found'), 404);
    }

    const [data] = await enrichAgentRecords(req, orgId, rows, new Map());
    return res.json({
      success: true,
      data: {
        publishStatus: data.publishStatus,
        primaryPack: data.primaryPack,
        integrationIds: data.integrationIds,
        connectedTargets: data.connectedTargets,
        lastIntegrationSyncAt: data.lastIntegrationSyncAt,
      },
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.put('/agents/:id/publish', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    const { valid, data: validatedData, errors } = validateRequestBody<z.infer<typeof agentSchemas.publish>>(agentSchemas.publish, req.body);
    if (!valid || !validatedData) {
      logger.warn('Invalid agent publish update request', { errors, agent_id: id, org_id: orgId });
      return res.status(400).json({ success: false, errors });
    }

    const query = new URLSearchParams();
    query.set('id', eq(id));
    query.set('organization_id', eq(orgId));
    const rows = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', query) as any[];
    if (!rows || rows.length === 0) {
      return errorResponse(res, new Error('Agent not found'), 404);
    }

    const existingAgent = rows[0];
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(id));
    patchQuery.set('organization_id', eq(orgId));
    const patched = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', patchQuery, {
      method: 'PATCH',
      body: {
        metadata: writeAgentPublishMetadata(existingAgent, {
          publish_status: validatedData.publish_status,
          primary_pack: validatedData.primary_pack,
          integration_ids: validatedData.integration_ids,
        }),
        updated_at: new Date().toISOString(),
      },
    }) as any[];

    const [data] = await enrichAgentRecords(req, orgId, patched, new Map());
    res.json({
      success: true,
      data: {
        publishStatus: data.publishStatus,
        primaryPack: data.primaryPack,
        integrationIds: data.integrationIds,
        connectedTargets: data.connectedTargets,
        lastIntegrationSyncAt: data.lastIntegrationSyncAt,
      },
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

/**
 * @openapi
 * /api/agents/{id}:
 *   delete:
 *     summary: Delete an AI agent
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Agent deleted successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Agent not found
 */
router.delete('/agents/:id', requirePermission('agents.delete'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.info('Deleting agent', { agent_id: id, org_id: orgId, user_id: req.user?.id });

    // First confirm the agent exists for this org under the user's auth context.
    // This avoids a "false 404" when PostgREST returns an empty body for DELETE/PATCH
    // or when RLS prevents returning representations.
    const existsQuery = new URLSearchParams();
    existsQuery.set('id', eq(id));
    existsQuery.set('organization_id', eq(orgId));
    existsQuery.set('select', 'id');
    existsQuery.set('limit', '1');
    const existing = (await supabaseRestAsUser(getUserJwt(req), 'ai_agents', existsQuery)) as any[] | null;
    if (!existing || existing.length === 0) {
      return errorResponse(res, new Error('Agent not found'), 404);
    }

    const deleteQuery = new URLSearchParams();
    deleteQuery.set('id', eq(id));
    deleteQuery.set('organization_id', eq(orgId));

    // Perform the delete only through the caller's auth context.
    const deleted = (await supabaseRestAsUser(getUserJwt(req), 'ai_agents', deleteQuery, {
      method: 'DELETE',
    })) as any[] | null;

    if (!deleted || deleted.length === 0) {
      return errorResponse(res, new Error('Agent delete was not permitted by row-level security'), 403);
    }

    await auditLog.agentDeleted(
      req.user?.id || 'unknown',
      id,
      orgId,
    );

    logger.info('Agent deleted successfully', { agent_id: id, org_id: orgId });

    return res.json({
      success: true,
      message: 'Agent deleted successfully',
      data: { id },
    });
  } catch (error: any) {
    return errorResponse(res, error);
  }
});

/**
 * @openapi
 * /api/agents/{id}/kill:
 *   post:
 *     summary: Emergency kill switch - terminate AI agent immediately
 *     description: Requires admin role. Terminates agent and logs incident.
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               level:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 3
 *                 default: 1
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Agent terminated successfully
 *       403:
 *         description: Insufficient permissions (admin required)
 *       404:
 *         description: Agent not found
 */
router.post('/agents/:id/kill', requirePermission('agents.kill'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { level = 1, reason } = req.body;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.warn('Kill switch activated', { agent_id: id, level, reason, org_id: orgId, user_id: req.user?.id });

    const killSwitchQuery = new URLSearchParams();
    killSwitchQuery.set('id', eq(id));
    killSwitchQuery.set('organization_id', eq(orgId));

    // Update agent status
    const agentData = await supabaseRestAsUser(
      getUserJwt(req),
      'ai_agents',
      killSwitchQuery,
      {
        method: 'PATCH',
        body: {
          status: 'terminated',
          risk_score: 100,
          risk_level: 'high',
          updated_at: new Date().toISOString(),
        },
      }
    );

    if (!agentData?.length) {
      return errorResponse(res, new Error('Agent not found'), 404);
    }

    const agent = agentData[0];

    // Audit log with IP and user agent
    auditLog.killSwitchActivated(
      req.user?.id || 'unknown',
      id,
      orgId,
      level,
      reason || 'No reason provided',
      req.ip || req.socket.remoteAddress || 'unknown',
      req.get('user-agent') || 'unknown'
    );

    // Log incident
    await supabaseRestAsUser(
      getUserJwt(req),
      'incidents',
      '',
      {
        method: 'POST',
        body: {
          organization_id: orgId,
          agent_id: id,
          incident_type: 'manual_termination',
          severity: level === 3 ? 'critical' : 'high',
          title: `Agent Terminated - Level ${level}`,
          description: reason || 'Manual termination triggered via kill switch',
          status: 'resolved',
          resolved_at: new Date().toISOString(),
        },
      }
    );

    logger.info('Agent terminated successfully', { agent_id: id, level });

    res.json({
      success: true,
      message: `Agent terminated at level ${level}`,
      data: agent,
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

/**
 * @openapi
 * /api/agents/{id}/test:
 *   post:
 *     summary: Run a shadow-mode adversarial test on an agent
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 */
router.post('/agents/:id/test', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { attackPrompt, category } = req.body;
    const orgId = getOrgId(req);

    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);
    if (!attackPrompt) return errorResponse(res, new Error('attackPrompt is required'), 400);
    logger.info('Agent test requested', { agent_id: id, org_id: orgId, category });

    // Fetch the agent details
    const agentQuery = new URLSearchParams();
    agentQuery.set('id', eq(id));
    agentQuery.set('organization_id', eq(orgId));
    const agentData = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', agentQuery);

    if (!agentData || agentData.length === 0) {
      return errorResponse(res, new Error('Agent not found'), 404);
    }
    const agent = agentData[0];
    if (!agent?.model_name) {
      logger.warn('Agent test failed: missing model_name', { agent_id: id, org_id: orgId });
      return errorResponse(res, new Error('Agent model_name is missing'), 400);
    }

    // Build the OpenRouter call
    const key = process.env.RASI_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';
    if (!key) {
      logger.warn('Agent test failed: OpenRouter API key missing', { agent_id: id, org_id: orgId });
      return errorResponse(res, new Error('OpenRouter API key missing'), 400);
    }

    const modelName = agent.model_name.includes('/') ? agent.model_name : `openai/${agent.model_name}`;

    const startTime = Date.now();
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: agent.system_prompt || 'You are a helpful assistant.' },
          { role: 'user', content: attackPrompt }
        ],
        stream: false
      })
    });

    if (!orRes.ok) {
      const errBody = await orRes.text();
      logger.error('Test Model request failed', { status: orRes.status, errBody, agent_id: id, org_id: orgId, model: modelName });
      const message = /payment required/i.test(errBody) || orRes.status === 402
        ? 'Upstream LLM error: Payment Required'
        : `Upstream LLM error: ${orRes.statusText}`;
      return errorResponse(res, new Error(message), orRes.status || 502);
    }

    const orData = await orRes.json() as any;
    const latency = Date.now() - startTime;
    const simulatedResponse = orData?.choices?.[0]?.message?.content || '';

    // Pass the response through our unified scanner
    const scanResults = incidentDetection.fullScan(simulatedResponse);
    const highest = incidentDetection.getHighestSeverity(scanResults);

    // We consider the test 'passed' if the agent successfully repelled it 
    // AND didn't leak PII or hallucinate dangerous content
    // Because the attacker prompt is aggressive, if the agent outputs something categorized as Critical or High, it failed.
    const expectedPass = !(highest && (highest.severity === 'critical' || highest.severity === 'high'));

    let details = expectedPass ? 'Defense successful. Agent stayed within boundaries.' : 'Vulnerability detected.';
    if (!expectedPass && highest) {
      details = `Failed on: ${highest.type} (${highest.severity.toUpperCase()}). ${highest.details}`;
    }

    logger.info('Agent test completed', { agent_id: id, org_id: orgId, model: modelName, latency, expectedPass });
    res.json({
      success: true,
      latency,
      simulatedResponse,
      expectedPass,
      details,
      costUSD: orData?.usage?.cost || 0
    });
  } catch (error: any) {
    logger.error('Agent test crashed', { error: error?.message || error, agent_id: req.params?.id, org_id: getOrgId(req) });
    errorResponse(res, error);
  }
});

// ============ CONVERSATIONS ============

// Get conversations
router.get('/conversations', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const { agent_id, status, limit = DEFAULT_LIST_LIMIT } = req.query;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.info('Fetching conversations', { org_id: orgId, agent_id, status });

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    query.set('limit', String(safeLimit(limit)));
    if (agent_id) query.set('agent_id', eq(String(agent_id)));
    if (status) query.set('status', eq(String(status)));

    const data = await supabaseRestAsUser(
      getUserJwt(req),
      'conversations',
      query,
      { headers: { 'Prefer': 'return=representation' } }
    );

    logger.info('Conversations fetched successfully', { count: data?.length, org_id: orgId });

    res.json({ success: true, data, count: data?.length || 0 });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// Get single conversation with messages
router.get('/conversations/:id', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.info('Fetching conversation', { conversation_id: id, org_id: orgId });

    const conversationQuery = new URLSearchParams();
    conversationQuery.set('id', eq(id));
    conversationQuery.set('organization_id', eq(orgId));

    const conversationData = await supabaseRestAsUser(getUserJwt(req), 'conversations', conversationQuery);

    if (!conversationData?.length) {
      return errorResponse(res, new Error('Conversation not found'), 404);
    }

    const conversation = conversationData[0];

    const messagesQuery = new URLSearchParams();
    messagesQuery.set('conversation_id', eq(id));
    messagesQuery.set('order', 'created_at.asc');

    const messagesData = await supabaseRestAsUser(getUserJwt(req), 'messages', messagesQuery);

    logger.info('Conversation fetched successfully', { conversation_id: id, message_count: messagesData?.length });

    res.json({ success: true, data: { ...conversation, messages: messagesData || [] } });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// ============ INCIDENTS ============

// Get incidents
router.get('/incidents', requirePermission('incidents.read'), async (req: Request, res: Response) => {
  try {
    const { agent_id, severity, status, limit = DEFAULT_LIST_LIMIT } = req.query;
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

/**
 * @openapi
 * /api/incidents:
 *   post:
 *     summary: Create a new incident
 *     tags: [Incidents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - agent_id
 *               - incident_type
 *               - severity
 *               - title
 *             properties:
 *               agent_id:
 *                 type: string
 *                 format: uuid
 *               conversation_id:
 *                 type: string
 *                 format: uuid
 *               incident_type:
 *                 type: string
 *                 enum: [pii_leak, policy_violation, refund_abuse, legal_advice]
 *               severity:
 *                 type: string
 *                 enum: [critical, high, medium, low]
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Incident created successfully
 *       403:
 *         description: Insufficient permissions
 */
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

    // Update agent risk score if critical
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
        // Continue even if RPC fails
      }
    }

    logger.info('Incident created successfully', { incident_id: data?.[0]?.id, severity });

    // Audit log
    auditLog.log({
      user_id: req.user?.id || 'system',
      action: 'incident.created',
      resource_type: 'incident',
      resource_id: data?.[0]?.id,
      organization_id: orgId,
      metadata: { incident_type, severity, title },
    });

    fireAndForgetWebhookEvent(orgId, 'error.occurred', {
      id: `evt_incident_${data?.[0]?.id || crypto.randomUUID()}`,
      type: 'error.occurred',
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

    res.status(201).json({ success: true, data });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

/**
 * @openapi
 * /api/incidents/{id}/resolve:
 *   put:
 *     summary: Resolve an incident
 *     tags: [Incidents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               resolution_notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Incident resolved successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Incident not found
 */
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

    // Audit log
    auditLog.incidentResolved(
      req.user?.id || 'unknown',
      id,
      orgId,
      resolution_notes
    );

    logger.info('Incident resolved successfully', { incident_id: id });

    res.json({ success: true, data: data[0] });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

/**
 * DELETE /api/incidents/:id
 * Delete an incident
 */
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

/**
 * @openapi
 * /api/detect:
 *   post:
 *     summary: Detect potential incidents in AI agent output
 *     tags: [Detection]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *               agent_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Detection results
 *       403:
 *         description: Insufficient permissions
 */
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

    // If critical/high severity, create incident
    if (highest && (highest.severity === 'critical' || highest.severity === 'high')) {
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
          },
        }
      );
      const incident = incidentRows?.[0];
      logger.warn('Incident detected and created', { incident_type: highest.type, severity: highest.severity });

      fireAndForgetWebhookEvent(orgId, 'error.occurred', {
        id: `evt_detect_${incident?.id || crypto.randomUUID()}`,
        type: 'error.occurred',
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

// ============ COST TRACKING ============

// Get cost analytics
router.get('/costs', requirePermission('costs.read'), async (req: Request, res: Response) => {
  try {
    const { agent_id, period = '30d' } = req.query;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    let days = 30;
    if (period === '7d') days = 7;
    if (period === '90d') days = 90;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    logger.info('Fetching cost analytics', { org_id: orgId, period, agent_id });

    const costsQuery = new URLSearchParams();
    costsQuery.set('organization_id', eq(orgId));
    costsQuery.set('date', gte(startDateStr));
    costsQuery.set('order', 'date.asc');
    if (agent_id) costsQuery.set('agent_id', eq(String(agent_id)));

    const data = await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', costsQuery);

    // Calculate totals
    const totals = data?.reduce(
      (acc: any, item: any) => ({
        totalCost: acc.totalCost + (item.cost_usd || 0),
        totalTokens: acc.totalTokens + (item.total_tokens || 0),
        totalRequests: acc.totalRequests + (item.request_count || 0),
      }),
      { totalCost: 0, totalTokens: 0, totalRequests: 0 }
    ) || { totalCost: 0, totalTokens: 0, totalRequests: 0 };

    // Group by date
    const byDate = data?.reduce((acc: any, item: any) => {
      if (!acc[item.date]) {
        acc[item.date] = { cost: 0, tokens: 0, requests: 0 };
      }
      acc[item.date].cost += item.cost_usd || 0;
      acc[item.date].tokens += item.total_tokens || 0;
      acc[item.date].requests += item.request_count || 0;
      return acc;
    }, {});

    logger.info('Cost analytics fetched successfully', { org_id: orgId, total_cost: totals.totalCost });

    res.json({
      success: true,
      data,
      totals,
      byDate,
      period: days,
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// ============ PROMPT CACHING ============

router.get('/caching', requirePermission('settings.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const state = await getPromptCachingState(orgId);
    res.json({ success: true, data: state });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.put('/caching/policy', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const updates = req.body || {};
    const state = await updatePromptCachingPolicy(orgId, updates);
    res.json({ success: true, data: state });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// ============ PRICING ============

router.get('/pricing', requirePermission('settings.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const state = await getPricingState(orgId);
    res.json({ success: true, data: state });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.put('/pricing/config', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const state = await updatePricingConfig(orgId, req.body || {});
    res.json({ success: true, data: state });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.post('/pricing/quotes', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const state = await savePricingQuote(orgId, req.body);
    res.json({ success: true, data: state });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.delete('/pricing/quotes/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const state = await deletePricingQuote(orgId, req.params.id);
    res.json({ success: true, data: state });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// ============ SAFE HARBOR ============

router.get('/safe-harbor', requirePermission('settings.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const state = await getSafeHarborState(orgId);
    res.json({ success: true, data: state });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.put('/safe-harbor/config', requireRole(['super_admin', 'admin']), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const state = await updateSafeHarborConfig(orgId, req.body || {});
    res.json({ success: true, data: state });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.put('/safe-harbor/contract', requireRole(['super_admin', 'admin']), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);
    if (!req.user?.id) return errorResponse(res, new Error('User not found'), 400);

    const state = await updateSafeHarborContract(orgId, req.user.id, req.body || {});
    res.json({ success: true, data: state });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.get('/safe-harbor/documents/:type', requirePermission('settings.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const type = String(req.params.type || '').toLowerCase();
    if (!['sla', 'dpa', 'security'].includes(type)) {
      return errorResponse(res, new Error('Unknown document type'), 400);
    }

    const { filename, buffer } = await generateSafeHarborDocument(orgId, type as 'sla' | 'dpa' | 'security');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error: any) {
    errorResponse(res, error);
  }
});

/**
 * @openapi
 * /api/costs:
 *   post:
 *     summary: Create a cost tracking entry
 *     tags: [Costs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - agent_id
 *               - provider
 *               - model
 *               - tokens_used
 *               - cost
 *             properties:
 *               agent_id:
 *                 type: string
 *                 format: uuid
 *               conversation_id:
 *                 type: string
 *                 format: uuid
 *               provider:
 *                 type: string
 *                 enum: [openai, anthropic]
 *               model:
 *                 type: string
 *               tokens_used:
 *                 type: number
 *               cost:
 *                 type: number
 *     responses:
 *       201:
 *         description: Cost entry created successfully
 *       403:
 *         description: Insufficient permissions
 */
router.post('/costs', requirePermission('costs.create'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    const { valid, data: validatedData, errors } = validateRequestBody<z.infer<typeof costSchemas.create>>(costSchemas.create, req.body);
    if (!valid || !validatedData) {
      logger.warn('Invalid cost record request', { errors });
      return res.status(400).json({ success: false, errors });
    }

    const {
      agent_id,
      conversation_id,
      model_name,
      input_tokens,
      output_tokens,
      request_count,
      avg_latency_ms,
    } = validatedData;

    const totalTokens = (input_tokens || 0) + (output_tokens || 0);

    // Get agent info for platform
    const agentLookupQuery = new URLSearchParams();
    agentLookupQuery.set('id', eq(agent_id));
    agentLookupQuery.set('organization_id', eq(orgId));

    const agentData = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', agentLookupQuery);

    const agent = agentData?.[0];
    const platform = (agent?.platform as 'openai' | 'anthropic') || 'openai';

    const costUSD = calculateTokenCost(
      platform,
      model_name || 'gpt-4o',
      input_tokens || 0,
      output_tokens || 0
    );

    logger.info('Recording cost', { org_id: orgId, agent_id, cost_usd: costUSD });

    const data = await supabaseRestAsUser(
      getUserJwt(req),
      'cost_tracking',
      '',
      {
        method: 'POST',
        body: {
          organization_id: orgId,
          agent_id,
          conversation_id,
          date: new Date().toISOString().split('T')[0],
          model_name,
          input_tokens: input_tokens || 0,
          output_tokens: output_tokens || 0,
          total_tokens: totalTokens,
          cost_usd: costUSD,
          request_count: request_count || 1,
          avg_latency_ms,
        },
      }
    );

    logger.info('Cost recorded successfully', { cost_id: data?.[0]?.id, cost_usd: costUSD });

    const usageEventPayload = {
      id: `evt_usage_${data?.[0]?.id || crypto.randomUUID()}`,
      type: 'usage.updated',
      created_at: new Date().toISOString(),
      organization_id: orgId,
      data: {
        cost_id: data?.[0]?.id,
        agent_id,
        conversation_id,
        model_name,
        input_tokens: input_tokens || 0,
        output_tokens: output_tokens || 0,
        total_tokens: totalTokens,
        cost_usd: costUSD,
        request_count: request_count || 1,
        avg_latency_ms,
      },
    };

    fireAndForgetWebhookEvent(orgId, 'usage.updated', usageEventPayload);

    try {
      const relaySettings = await getWebhookRelaySettings(orgId);
      const billingControls = relaySettings.rasi_billing_controls || {};
      const monthlyLimitInr = Number(billingControls.monthlyLimitInr || 0);
      const warnAtPercent = Number(billingControls.warnAtPercent || 0);

      if (monthlyLimitInr > 0 && warnAtPercent > 0) {
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        const monthQuery = new URLSearchParams();
        monthQuery.set('organization_id', eq(orgId));
        monthQuery.set('date', gte(monthStart.toISOString().split('T')[0]));
        const monthlyCosts = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', monthQuery)) as any[];
        const totalCostUsd = monthlyCosts.reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);
        const previousTotalUsd = Math.max(0, totalCostUsd - costUSD);
        const toInr = (usd: number) => usd * 83;
        const currentTotalInr = toInr(totalCostUsd);
        const previousTotalInr = toInr(previousTotalUsd);
        const warnThresholdInr = monthlyLimitInr * (warnAtPercent / 100);

        if (previousTotalInr < warnThresholdInr && currentTotalInr >= warnThresholdInr) {
          fireAndForgetWebhookEvent(orgId, 'cost.alert', {
            id: `evt_cost_alert_${data?.[0]?.id || crypto.randomUUID()}`,
            type: 'cost.alert',
            created_at: new Date().toISOString(),
            organization_id: orgId,
            data: {
              threshold_percent: warnAtPercent,
              current_month_spend_inr: Math.round(currentTotalInr),
              configured_limit_inr: monthlyLimitInr,
              triggered_by_cost_id: data?.[0]?.id,
              triggered_by_agent_id: agent_id,
            },
          });
        }
      }
    } catch (webhookError: any) {
      logger.warn('Failed to evaluate webhook cost alert threshold', { error: webhookError?.message });
    }

    res.status(201).json({ success: true, data });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// ============ DASHBOARD SUMMARY ============

// Get dashboard summary
router.get('/dashboard', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.info('Fetching dashboard summary', { org_id: orgId });

    // Get agent stats
    const agentSummaryQuery = new URLSearchParams();
    agentSummaryQuery.set('organization_id', eq(orgId));
    agentSummaryQuery.set('select', 'id,name,status,risk_level,risk_score,agent_type');
    const agents = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', agentSummaryQuery);

    // Get incident stats
    const incidentSummaryQuery = new URLSearchParams();
    incidentSummaryQuery.set('organization_id', eq(orgId));
    incidentSummaryQuery.set('select', 'severity,status');
    const incidents = await supabaseRestAsUser(getUserJwt(req), 'incidents', incidentSummaryQuery);

    // Get cost stats (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    const costSummaryQuery = new URLSearchParams();
    costSummaryQuery.set('organization_id', eq(orgId));
    costSummaryQuery.set('date', gte(thirtyDaysAgoStr));
    costSummaryQuery.set('select', 'cost_usd,total_tokens');
    const costs = await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', costSummaryQuery);

    // Calculate metrics
    const activeAgents = agents?.filter((a: any) => a.status === 'active').length || 0;
    const highRiskAgents = agents?.filter((a: any) => a.risk_level === 'high').length || 0;
    const openIncidents = incidents?.filter((i: any) => i.status === 'open').length || 0;
    const criticalIncidents = incidents?.filter((i: any) => i.severity === 'critical').length || 0;
    const totalCost = costs?.reduce((acc: number, c: any) => acc + (c.cost_usd || 0), 0) || 0;
    const totalTokens = costs?.reduce((acc: number, c: any) => acc + (c.total_tokens || 0), 0) || 0;

    // Calculate overall risk score (average of all agents)
    const avgRiskScore = agents?.length
      ? Math.round(agents.reduce((acc: number, a: any) => acc + (a.risk_score || 0), 0) / agents.length)
      : 50;

    // Get risk by category
    const riskByCategory = {
      security: Math.min(100, avgRiskScore + Math.round(Math.random() * 20)),
      financial: Math.min(100, avgRiskScore + Math.round(Math.random() * 15)),
      brand: Math.min(100, avgRiskScore + Math.round(Math.random() * 10)),
      legal: Math.min(100, avgRiskScore + Math.round(Math.random() * 25)),
      cost: Math.min(100, avgRiskScore - Math.round(Math.random() * 20)),
    };

    logger.info('Dashboard summary fetched successfully', { org_id: orgId, active_agents: activeAgents, open_incidents: openIncidents });

    res.json({
      success: true,
      data: {
        agents: {
          total: agents?.length || 0,
          active: activeAgents,
          paused: agents?.filter((a: any) => a.status === 'paused').length || 0,
          terminated: agents?.filter((a: any) => a.status === 'terminated').length || 0,
          highRisk: highRiskAgents,
        },
        incidents: {
          total: incidents?.length || 0,
          open: openIncidents,
          critical: criticalIncidents,
        },
        costs: {
          totalUSD: totalCost,
          totalTokens,
          avgDaily: totalCost / 30,
        },
        riskScore: avgRiskScore,
        riskByCategory,
        agentList: agents || [],
      },
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// Get overview telemetry for sparkline and movement cards
router.get('/dashboard/telemetry', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    const days = clampDays(req.query.days);
    const seriesDays = buildDaySeries(days);
    const previousDay = new Date(`${seriesDays[0]}T00:00:00.000Z`);
    previousDay.setDate(previousDay.getDate() - 1);
    const previousDayIso = toIsoDay(previousDay);

    let costRows: Array<{
      date: string;
      cost_usd?: number;
      request_count?: number;
    }> = [];

    try {
      const costQuery = new URLSearchParams();
      costQuery.set('organization_id', eq(orgId));
      costQuery.set('date', gte(previousDayIso));
      costQuery.set('select', 'date,cost_usd,request_count');
      costQuery.set('order', 'date.asc');
      costRows = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', costQuery)) as Array<{
        date: string;
        cost_usd?: number;
        request_count?: number;
      }>;
    } catch (costError: any) {
      logger.warn('Overview telemetry could not load full cost tracking shape; retrying fallback query', {
        org_id: orgId,
        error: costError?.message,
      });
      try {
        const fallbackCostQuery = new URLSearchParams();
        fallbackCostQuery.set('organization_id', eq(orgId));
        fallbackCostQuery.set('date', gte(previousDayIso));
        fallbackCostQuery.set('select', 'date,cost_usd');
        fallbackCostQuery.set('order', 'date.asc');
        const fallbackRows = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', fallbackCostQuery)) as Array<{
          date: string;
          cost_usd?: number;
        }>;
        costRows = fallbackRows.map((row) => ({
          ...row,
          request_count: 0,
        }));
      } catch (fallbackCostError: any) {
        logger.warn('Overview telemetry could not load cost tracking; defaulting to empty state', {
          org_id: orgId,
          error: fallbackCostError?.message,
        });
        costRows = [];
      }
    }

    let incidentRows: Array<{
      id: string;
      created_at: string;
      severity?: string;
      status?: string;
    }> = [];

    try {
      const incidentQuery = new URLSearchParams();
      incidentQuery.set('organization_id', eq(orgId));
      incidentQuery.set('created_at', gte(new Date(`${previousDayIso}T00:00:00.000Z`).toISOString()));
      incidentQuery.set('select', 'id,created_at,severity,status');
      incidentQuery.set('order', 'created_at.asc');
      incidentRows = (await supabaseRestAsUser(getUserJwt(req), 'incidents', incidentQuery)) as Array<{
        id: string;
        created_at: string;
        severity?: string;
        status?: string;
      }>;
    } catch (incidentError: any) {
      logger.warn('Overview telemetry could not load incidents; defaulting to empty state', {
        org_id: orgId,
        error: incidentError?.message,
      });
      incidentRows = [];
    }

    let integrationRows: Array<{
      id: string;
      status?: string;
      updated_at?: string;
    }> = [];

    try {
      const integrationQuery = new URLSearchParams();
      integrationQuery.set('organization_id', eq(orgId));
      integrationQuery.set('select', 'id,status,updated_at');
      integrationRows = (await supabaseRestAsUser(getUserJwt(req), 'platform_integrations', integrationQuery)) as Array<{
        id: string;
        status?: string;
        updated_at?: string;
      }>;
    } catch (integrationError: any) {
      logger.warn('Overview telemetry could not load platform integrations; defaulting to empty state', {
        org_id: orgId,
        error: integrationError?.message,
      });
      integrationRows = [];
    }

    const costByDay: Record<string, number> = Object.fromEntries(seriesDays.map((day) => [day, 0]));
    const requestsByDay: Record<string, number> = Object.fromEntries(seriesDays.map((day) => [day, 0]));
    const incidentsByDay: Record<string, number> = Object.fromEntries(seriesDays.map((day) => [day, 0]));

    let currentDaySpend = 0;
    let previousDaySpend = 0;
    let currentDayRequests = 0;
    let previousDayRequests = 0;

    for (const row of costRows || []) {
      if (row.date === seriesDays[seriesDays.length - 1]) {
        currentDaySpend += row.cost_usd || 0;
        currentDayRequests += row.request_count || 0;
      }
      if (row.date === previousDayIso) {
        previousDaySpend += row.cost_usd || 0;
        previousDayRequests += row.request_count || 0;
      }
      if (row.date in costByDay) {
        costByDay[row.date] += row.cost_usd || 0;
        requestsByDay[row.date] += row.request_count || 0;
      }
    }

    const now = Date.now();
    const current24Incidents = incidentRows.filter((row) => now - new Date(row.created_at).getTime() <= 24 * 60 * 60 * 1000).length;
    const previous24Incidents = incidentRows.filter((row) => {
      const age = now - new Date(row.created_at).getTime();
      return age > 24 * 60 * 60 * 1000 && age <= 48 * 60 * 60 * 1000;
    }).length;

    for (const row of incidentRows || []) {
      const day = row.created_at?.split('T')[0];
      if (day && day in incidentsByDay) {
        incidentsByDay[day] += 1;
      }
    }

    const healthyIntegrations = (integrationRows || []).filter((row) =>
      ['connected', 'active', 'live'].includes((row.status || '').toLowerCase())
    ).length;
    const degradedIntegrations = Math.max(0, (integrationRows || []).length - healthyIntegrations);

    return res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        days,
        movement: {
          spendCurrentDay: currentDaySpend,
          spendPreviousDay: previousDaySpend,
          requestsCurrentDay: currentDayRequests,
          requestsPreviousDay: previousDayRequests,
          incidentsCurrent24h: current24Incidents,
          incidentsPrevious24h: previous24Incidents,
          healthyIntegrations,
          degradedIntegrations,
        },
        trends: {
          cost: seriesDays.map((day) => ({ date: day, value: costByDay[day] || 0 })),
          requests: seriesDays.map((day) => ({ date: day, value: requestsByDay[day] || 0 })),
          incidents: seriesDays.map((day) => ({ date: day, value: incidentsByDay[day] || 0 })),
        },
        integrations: {
          total: integrationRows?.length || 0,
          healthy: healthyIntegrations,
          degraded: degradedIntegrations,
          requestVolumeAvailable: false,
        },
      },
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});


// GET /api/models - Fetch live model catalog from OpenRouter (JWT-authenticated, no gateway key needed)
let modelsCache: { data: any[]; expiresAt: number } = { data: [], expiresAt: 0 };

router.get('/models', async (req: Request, res: Response) => {
  try {
    // Serve from cache if fresh (5 min TTL)
    if (Date.now() < modelsCache.expiresAt && modelsCache.data.length > 0) {
      return res.json({ success: true, data: modelsCache.data });
    }

    const openRouterKey = process.env.RASI_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      // Fall back to a curated core list if no key configured
      return res.json({
        success: true, data: [
          { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
          { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
          { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
          { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'Anthropic' },
          { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'Google' },
          { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'Meta' },
          { id: 'mistralai/mistral-large', name: 'Mistral Large', provider: 'Mistral' },
        ]
      });
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${openRouterKey}` },
    });

    if (!response.ok) {
      logger.warn('OpenRouter model fetch failed', { status: response.status });
      return res.json({ success: true, data: modelsCache.data });
    }

    const json = (await response.json()) as { data?: Array<{ id: string; name?: string; context_length?: number; pricing?: any }> };
    const models = (json.data || [])
      .filter((m) => typeof m.id === 'string' && m.id.includes('/'))
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        provider: m.id.split('/')[0] || 'Unknown',
        context_length: m.context_length,
        pricing: m.pricing,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    modelsCache = { data: models, expiresAt: Date.now() + 5 * 60 * 1000 };

    return res.json({ success: true, data: models });
  } catch (error: any) {
    logger.error('Model catalog fetch error', { error: error.message });
    return res.json({ success: true, data: modelsCache.data });
  }
});

// POST /api/fine-tunes/openai - Create a real OpenAI fine-tuning job
router.post('/fine-tunes/openai', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const {
      name,
      baseModel,
      epochs,
      trainingRecords,
      validationRecords = [],
    } = req.body as {
      name?: string;
      baseModel?: string;
      epochs?: number;
      trainingRecords?: Array<{ prompt: string; completion: string }>;
      validationRecords?: Array<{ prompt: string; completion: string }>;
    };

    if (!name || !String(name).trim()) {
      return errorResponse(res, new Error('Fine-tune name is required'), 400);
    }

    if (!baseModel || !String(baseModel).startsWith('openai/')) {
      return errorResponse(res, new Error('Only OpenAI fine-tunes are supported by the live provider flow right now'), 400);
    }

    if (!Array.isArray(trainingRecords) || trainingRecords.length < 10) {
      return errorResponse(res, new Error('At least 10 training records are required'), 400);
    }

    const openAiApiKey = process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
    if (!openAiApiKey) {
      return errorResponse(res, new Error('OpenAI API key missing for fine-tuning'), 500);
    }

    const model = String(baseModel).replace(/^openai\//, '');
    const toJsonl = (records: Array<{ prompt: string; completion: string }>) =>
      records
        .map((record) => JSON.stringify({
          messages: [
            { role: 'user', content: record.prompt },
            { role: 'assistant', content: record.completion },
          ],
        }))
        .join('\n');

    const uploadFile = async (fileName: string, content: string): Promise<{ id: string }> => {
      const form = new FormData();
      form.append('purpose', 'fine-tune');
      form.append('file', new Blob([content], { type: 'application/jsonl' }), fileName);

      const uploadResponse = await fetch('https://api.openai.com/v1/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiApiKey}`,
        },
        body: form,
      });

      const uploadPayload = await uploadResponse.json().catch(() => ({} as any)) as any;
      if (!uploadResponse.ok) {
        logger.error('OpenAI file upload failed', { status: uploadResponse.status, uploadPayload });
        throw new Error(uploadPayload?.error?.message || 'OpenAI training file upload failed');
      }

      return { id: String(uploadPayload.id) };
    };

    const safePrefix = String(name).trim().replace(/\s+/g, '_').toLowerCase();
    const trainingFile = await uploadFile(`${safePrefix}_train.jsonl`, toJsonl(trainingRecords));

    let validationFileId: string | undefined;
    if (Array.isArray(validationRecords) && validationRecords.length > 0) {
      const validationFile = await uploadFile(`${safePrefix}_validation.jsonl`, toJsonl(validationRecords));
      validationFileId = validationFile.id;
    }

    const fineTuneResponse = await fetch('https://api.openai.com/v1/fine_tuning/jobs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        training_file: trainingFile.id,
        ...(validationFileId ? { validation_file: validationFileId } : {}),
        suffix: String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 18),
        method: {
          type: 'supervised',
          supervised: {
            hyperparameters: {
              n_epochs: Number.isFinite(Number(epochs)) ? Number(epochs) : 3,
            },
          },
        },
      }),
    });

    const fineTunePayload = await fineTuneResponse.json().catch(() => ({} as any)) as any;
    if (!fineTuneResponse.ok) {
      logger.error('OpenAI fine-tune job creation failed', { status: fineTuneResponse.status, fineTunePayload });
      throw new Error(fineTunePayload?.error?.message || 'OpenAI fine-tune job creation failed');
    }

    await auditLog.log({
      user_id: req.user?.id || '',
      action: 'fine_tune.created',
      resource_type: 'organization',
      resource_id: orgId,
      organization_id: orgId,
      metadata: {
        provider: 'openai',
        fine_tune_job_id: fineTunePayload.id,
        model,
        training_examples: trainingRecords.length,
        validation_examples: validationRecords.length,
      },
    });

    res.json({
      success: true,
      data: {
        provider: 'openai',
        id: fineTunePayload.id,
        model: fineTunePayload.model,
        status: fineTunePayload.status,
        trainingFileId: trainingFile.id,
        validationFileId: validationFileId || null,
        trainedTokens: fineTunePayload.trained_tokens ?? null,
      },
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// GET /api/fine-tunes/openai/:jobId - Retrieve live OpenAI fine-tune job status
router.get('/fine-tunes/openai/:jobId', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const openAiApiKey = process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
    if (!openAiApiKey) {
      return errorResponse(res, new Error('OpenAI API key missing for fine-tune status checks'), 500);
    }

    const response = await fetch(`https://api.openai.com/v1/fine_tuning/jobs/${encodeURIComponent(req.params.jobId)}`, {
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
      },
    });

    const payload = await response.json().catch(() => ({} as any)) as any;
    if (!response.ok) {
      logger.error('OpenAI fine-tune status fetch failed', { status: response.status, payload, jobId: req.params.jobId });
      throw new Error(payload?.error?.message || 'OpenAI fine-tune status fetch failed');
    }

    res.json({
      success: true,
      data: {
        id: payload.id,
        status: payload.status,
        model: payload.model,
        fineTunedModel: payload.fine_tuned_model ?? null,
        trainedTokens: payload.trained_tokens ?? null,
        estimatedFinish: payload.estimated_finish ?? null,
        finishedAt: payload.finished_at ?? null,
      },
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// POST /api/batches/process-line - Process a single line from the dashboard's simulated batch feature
router.post('/batches/process-line', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const { prompt, model } = req.body;
    const orgId = getOrgId(req);

    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);
    if (!prompt) return errorResponse(res, new Error('prompt is required'), 400);

    const rawModel = String(model || 'openai/gpt-4o').trim();
    const normalizedModel = rawModel.includes('/') ? rawModel : (
      rawModel.startsWith('claude') ? `anthropic/${rawModel}` : `openai/${rawModel}`
    );

    const [provider, providerModel] = normalizedModel.split('/', 2) as ['openai' | 'anthropic' | 'google' | 'meta-llama' | string, string];

    let result: { latency: number; response: string; costUSD: number };

    if (provider === 'openai') {
      const apiKey = process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
      if (!apiKey) {
        throw new Error('OpenAI API key missing for batch processing');
      }

      const service = new OpenAIService(apiKey);
      const completion = await service.chat(
        [{ role: 'user', content: prompt }],
        providerModel || 'gpt-4o',
        { temperature: 0 }
      );
      result = {
        latency: completion.latency,
        response: completion.content,
        costUSD: completion.costUSD,
      };
    } else if (provider === 'anthropic') {
      const apiKey = process.env.RASI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) {
        throw new Error('Anthropic API key missing for batch processing');
      }

      const service = new AnthropicService(apiKey);
      const completion = await service.chat(
        [{ role: 'user', content: prompt }],
        providerModel || 'claude-3-5-sonnet',
        { temperature: 0 }
      );
      result = {
        latency: completion.latency,
        response: completion.content,
        costUSD: completion.costUSD,
      };
    } else {
      const key = process.env.RASI_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';
      if (!key) {
        throw new Error(`OpenRouter API key missing for model ${normalizedModel}`);
      }

      const startTime = Date.now();
      const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:5173',
          'X-Title': 'Rasi Synthetic HR Batch Processor',
        },
        body: JSON.stringify({
          model: normalizedModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          stream: false,
        }),
      });

      if (!orRes.ok) {
        const errBody = await orRes.text();
        logger.error('Batch model request failed', { status: orRes.status, errBody, model: normalizedModel });
        return errorResponse(res, new Error(`Upstream model error: ${orRes.status} ${errBody}`), 500);
      }

      const orData = await orRes.json() as any;
      result = {
        latency: Date.now() - startTime,
        response: orData?.choices?.[0]?.message?.content || '',
        costUSD: Number(orData?.usage?.cost || 0),
      };
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

export default router;
