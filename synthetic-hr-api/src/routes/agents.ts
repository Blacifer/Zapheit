import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { incidentDetection } from '../services/incident-detection';
import { logger } from '../lib/logger';
import { validateRequestBody, agentSchemas } from '../schemas/validation';
import { requirePermission } from '../middleware/rbac';
import { auditLog } from '../lib/audit-logger';
import { supabaseRestAsUser, eq, gte, in_ } from '../lib/supabase-rest';
import { getOrgId, getUserJwt, errorResponse, buildDaySeries, toIsoDay } from '../lib/route-helpers';
import { fireAndForgetWebhookEvent } from '../lib/webhook-relay';

const router = express.Router();

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentPublishStatus = 'not_live' | 'ready' | 'live';
type AgentPackId = 'recruitment' | 'support' | 'sales' | 'it' | 'finance' | 'compliance';

type AgentPublishMetadata = {
  publish_status?: AgentPublishStatus;
  primary_pack?: AgentPackId | null;
  integration_ids?: string[];
  deploy_method?: 'website' | 'api' | 'terminal' | null;
};

type IntegrationSummaryRow = {
  id: string;
  service_type: string;
  service_name: string;
  category: string;
  status: string;
  last_sync_at: string | null;
};

type AgentWorkspaceConversation = {
  id: string;
  user: string;
  topic: string;
  preview: string;
  status: string;
  platform: string;
  timestamp: string;
};

type AgentWorkspaceIncident = {
  id: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  type: string;
  createdAt: string;
};

type AgentWorkspaceAnalytics = {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  avgCostPerRequest: number;
  dailyAverage: number;
  trend: Array<{ date: string; cost: number; requests: number }>;
};

// ─── Agent-specific helpers ───────────────────────────────────────────────────

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
  if (updates.deploy_method !== undefined) {
    metadata.deploy_method = updates.deploy_method;
  }
  return metadata;
};

const riskLevelFromScore = (score: number): 'low' | 'medium' | 'high' => {
  if (score >= 70) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
};

const normalizeWorkspaceConversation = (raw: any): AgentWorkspaceConversation => {
  const metadata = raw?.metadata || {};
  const preview = metadata.preview || metadata.last_user_message || metadata.summary
    || `Conversation on ${raw?.platform || 'unknown platform'}`;
  const trimmed = String(preview || '').trim();
  const topic = metadata.topic || trimmed.split(/[.!?]/)[0] || 'Conversation';
  return {
    id: raw.id,
    user: metadata.user_email || metadata.customer_email || raw.user_id || 'Unknown user',
    topic: String(topic).slice(0, 64),
    preview: trimmed,
    status: raw.status || 'unknown',
    platform: raw.platform || 'internal',
    timestamp: raw.started_at || raw.created_at || new Date().toISOString(),
  };
};

const normalizeWorkspaceIncident = (raw: any): AgentWorkspaceIncident => ({
  id: raw.id,
  title: raw.title || 'Untitled incident',
  severity: raw.severity || 'low',
  status: raw.status || 'open',
  type: raw.incident_type || 'other',
  createdAt: raw.created_at || new Date().toISOString(),
});

const enrichAgentRecords = async (
  req: Request,
  orgId: string,
  rawAgents: any[],
  conversationCounts?: Map<string, number>,
) => {
  const integrationRows = (() => {
    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('select', 'id,service_type,service_name,category,status,last_sync_at');
    return supabaseRestAsUser(getUserJwt(req), 'integrations', query) as Promise<IntegrationSummaryRow[]>;
  })();

  const deploymentRows = (() => {
    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('status', eq('active'));
    query.set('select', 'agent_id');
    return supabaseRestAsUser(getUserJwt(req), 'agent_deployments', query).catch(() => []) as Promise<any[]>;
  })();

  let integrations: IntegrationSummaryRow[] = [];
  try {
    integrations = await integrationRows;
  } catch (err: any) {
    logger.warn('Failed to load integrations for agent enrichment', { error: err?.message || err, org_id: orgId });
  }

  const deployments = await deploymentRows;
  const deployedAgentIds = new Set((deployments || []).map((d: any) => d.agent_id));

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

    const hasActiveDeployment = deployedAgentIds.has(agent.id);
    const publishStatus = publish.publish_status
      || (hasActiveDeployment ? 'live'
        : connectedTargets.length === 0 ? 'not_live'
        : connectedTargets.some((t) => t.status === 'connected') ? 'live' : 'ready');

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

const getAgentWorkspaceData = async (req: Request, orgId: string, id: string) => {
  const query = new URLSearchParams();
  query.set('id', eq(id));
  query.set('organization_id', eq(orgId));

  const rawData = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', query) as any[];
  if (!rawData || rawData.length === 0) throw new Error('Agent not found');

  const rawAgent = rawData[0];
  const permissions = new Set(Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : []);
  const canReadDashboard = permissions.has('dashboard.read');
  const canReadIncidents = permissions.has('incidents.read');
  const canReadCosts = permissions.has('costs.read');

  let conversationCount = 0;
  let conversations: AgentWorkspaceConversation[] = [];
  let incidents: AgentWorkspaceIncident[] = [];
  let analytics: AgentWorkspaceAnalytics = {
    totalCost: 0, totalTokens: 0, totalRequests: 0, avgCostPerRequest: 0, dailyAverage: 0,
    trend: buildDaySeries(7).map((date) => ({ date, cost: 0, requests: 0 })),
  };

  if (canReadDashboard) {
    try {
      const q = new URLSearchParams();
      q.set('organization_id', eq(orgId));
      q.set('agent_id', eq(id));
      q.set('order', 'created_at.desc');
      q.set('limit', '25');
      const rows = (await supabaseRestAsUser(getUserJwt(req), 'conversations', q)) as any[];
      conversations = (rows || []).map(normalizeWorkspaceConversation);
    } catch (err: any) {
      logger.warn('Failed to load workspace conversations', { error: err?.message || err, org_id: orgId, agent_id: id });
    }
  }

  if (canReadIncidents) {
    try {
      const q = new URLSearchParams();
      q.set('organization_id', eq(orgId));
      q.set('agent_id', eq(id));
      q.set('order', 'created_at.desc');
      q.set('limit', '6');
      const rows = (await supabaseRestAsUser(getUserJwt(req), 'incidents', q)) as any[];
      incidents = (rows || []).map(normalizeWorkspaceIncident);
    } catch (err: any) {
      logger.warn('Failed to load workspace incidents', { error: err?.message || err, org_id: orgId, agent_id: id });
    }
  }

  if (canReadCosts) {
    try {
      const allQ = new URLSearchParams();
      allQ.set('organization_id', eq(orgId));
      allQ.set('agent_id', eq(id));
      allQ.set('limit', '10000');
      const allCostRows = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', allQ)) as any[];

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const trendQ = new URLSearchParams();
      trendQ.set('organization_id', eq(orgId));
      trendQ.set('agent_id', eq(id));
      trendQ.set('date', gte(toIsoDay(sevenDaysAgo)));
      trendQ.set('order', 'date.asc');
      trendQ.set('limit', '10000');
      const trendRows = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', trendQ)) as any[];

      conversationCount = (allCostRows || []).reduce((sum, row) => sum + Number(row?.request_count || 0), 0);
      if (!Number.isFinite(conversationCount) || conversationCount < 0) conversationCount = 0;

      const totalCost = (allCostRows || []).reduce((sum, row) => sum + Number(row?.cost_usd || 0), 0);
      const totalTokens = (allCostRows || []).reduce((sum, row) => sum + Number(row?.total_tokens || 0), 0);
      const trendSeed = Object.fromEntries(buildDaySeries(7).map((date) => [date, { date, cost: 0, requests: 0 }]));

      for (const row of trendRows || []) {
        const date = typeof row?.date === 'string' ? row.date : null;
        if (!date || !trendSeed[date]) continue;
        trendSeed[date].cost += Number(row?.cost_usd || 0);
        trendSeed[date].requests += Number(row?.request_count || 0);
      }

      analytics = {
        totalCost, totalTokens, totalRequests: conversationCount,
        avgCostPerRequest: conversationCount > 0 ? totalCost / conversationCount : 0,
        dailyAverage: allCostRows?.length > 0 ? totalCost / allCostRows.length : 0,
        trend: Object.values(trendSeed),
      };
    } catch (err: any) {
      logger.warn('Failed to load workspace analytics', { error: err?.message || err, org_id: orgId, agent_id: id });
    }
  }

  const [agent] = await enrichAgentRecords(req, orgId, [rawAgent], new Map([[id, conversationCount]]));
  const openIncidentCount = incidents.filter((i) => !['resolved', 'false_positive'].includes(i.status)).length;
  const criticalIncidentCount = incidents.filter((i) => i.severity === 'critical').length;
  const liveTargetCount = (agent.connectedTargets || []).filter((t: any) => t.status === 'connected').length;
  const connectedTargetCount = (agent.connectedTargets || []).length;
  const lastActivityAt = [
    ...conversations.map((c) => c.timestamp),
    ...incidents.map((i) => i.createdAt),
    agent.lastIntegrationSyncAt,
  ]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

  return {
    agent,
    summary: { openIncidentCount, criticalIncidentCount, liveTargetCount, connectedTargetCount,
      totalConversationCount: agent.conversations || conversationCount, lastActivityAt },
    conversations, incidents, analytics,
  };
};

const getAgentRecord = async (req: Request, orgId: string, id: string) => {
  const query = new URLSearchParams();
  query.set('id', eq(id));
  query.set('organization_id', eq(orgId));
  const rows = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', query) as any[];
  if (!rows || rows.length === 0) throw new Error('Agent not found');
  return rows[0];
};

const patchAgentRecord = async (req: Request, orgId: string, id: string, body: Record<string, unknown>) => {
  const q = new URLSearchParams();
  q.set('id', eq(id));
  q.set('organization_id', eq(orgId));
  const rows = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', q, {
    method: 'PATCH',
    body: { ...body, updated_at: new Date().toISOString() },
  }) as any[];
  if (!rows || rows.length === 0) throw new Error('Agent not found');
  return rows[0];
};

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get('/agents', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    logger.info('Fetching agents', { org_id: orgId, user_id: req.user?.id });

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    const rawData = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', query) as any[];

    const conversationCounts = new Map<string, number>();
    try {
      const agentIds = (rawData || []).map((a) => a?.id).filter((id) => typeof id === 'string' && id.length > 0);
      if (agentIds.length > 0) {
        const convQ = new URLSearchParams();
        convQ.set('organization_id', eq(orgId));
        convQ.set('agent_id', in_(agentIds));
        convQ.set('select', 'agent_id');
        convQ.set('limit', '10000');
        const rows = (await supabaseRestAsUser(getUserJwt(req), 'conversations', convQ)) as any[];
        for (const row of rows || []) {
          const agentId = row?.agent_id;
          if (typeof agentId !== 'string' || !agentId) continue;
          conversationCounts.set(agentId, (conversationCounts.get(agentId) || 0) + 1);
        }
      }
    } catch (err: any) {
      logger.warn('Failed to compute agent conversation counts', { error: err?.message || err, org_id: orgId });
    }

    const data = await enrichAgentRecords(req, orgId, rawData || [], conversationCounts);
    logger.info('Agents fetched successfully', { count: data?.length, org_id: orgId });
    res.json({ success: true, data, count: data?.length || 0 });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.get('/agents/:id', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const query = new URLSearchParams();
    query.set('id', eq(id));
    query.set('organization_id', eq(orgId));
    const rawData = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', query);
    if (!rawData || rawData.length === 0) return errorResponse(res, new Error('Agent not found'), 404);

    const agent = rawData[0];
    let conversations = 0;
    try {
      const convQ = new URLSearchParams();
      convQ.set('organization_id', eq(orgId));
      convQ.set('agent_id', eq(id));
      convQ.set('select', 'id');
      convQ.set('limit', '10000');
      const rows = (await supabaseRestAsUser(getUserJwt(req), 'conversations', convQ)) as any[];
      conversations = (rows || []).length;
    } catch (err: any) {
      logger.warn('Failed to compute agent conversation count', { error: err?.message || err, org_id: orgId, agent_id: id });
    }

    const [data] = await enrichAgentRecords(req, orgId, [agent], new Map([[id, conversations]]));
    res.json({ success: true, data });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.get('/agents/:id/workspace', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);
    const data = await getAgentWorkspaceData(req, orgId, id);
    res.json({ success: true, data });
  } catch (error: any) {
    errorResponse(res, error, error?.message === 'Agent not found' ? 404 : 500);
  }
});

router.post('/agents', requirePermission('agents.create'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const { valid, data: validatedData, errors } = validateRequestBody<z.infer<typeof agentSchemas.create>>(agentSchemas.create, req.body);
    if (!valid || !validatedData) {
      logger.warn('Invalid agent creation request', { errors, org_id: orgId });
      return res.status(400).json({ success: false, errors });
    }

    logger.info('Creating agent', { org_id: orgId, agent_name: validatedData.name });
    const { budget_limit, auto_throttle, publish_status, primary_pack, integration_ids, config, ...restAgentData } = validatedData;
    const mergedConfig = { ...config, budget_limit, auto_throttle };
    const metadata = writeAgentPublishMetadata({}, { publish_status, primary_pack: primary_pack ?? null, integration_ids });

    const rawData = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', '', {
      method: 'POST',
      body: { organization_id: orgId, ...restAgentData, config: mergedConfig, metadata, status: 'active', risk_level: 'low', risk_score: 50 },
    });

    if (rawData && rawData[0]) {
      auditLog.agentCreated(req.user?.id || 'unknown', rawData[0].id, orgId, {
        name: validatedData.name, platform: validatedData.platform, model_name: validatedData.model_name,
        performed_by_email: req.user?.email || 'unknown',
      });
    }

    logger.info('Agent created successfully', { agent_id: rawData?.[0]?.id, org_id: orgId });
    const [finalData] = rawData?.length > 0 ? await enrichAgentRecords(req, orgId, rawData, new Map()) : [null];
    res.status(201).json({ success: true, data: finalData });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.put('/agents/:id', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

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
    if (!existingRows || existingRows.length === 0) return errorResponse(res, new Error('Agent not found'), 404);
    const existingAgent = existingRows[0];

    const mergedConfig = {
      ...(existingAgent.config || {}),
      ...config,
      ...(budget_limit !== undefined && { budget_limit }),
      ...(current_spend !== undefined && { current_spend }),
      ...(auto_throttle !== undefined && { auto_throttle }),
    };

    const metadata = writeAgentPublishMetadata(existingAgent, { publish_status, primary_pack, integration_ids });
    const rawData = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', agentUpdateQuery, {
      method: 'PATCH',
      body: { ...restUpdateData, ...(Object.keys(mergedConfig).length > 0 && { config: mergedConfig }), metadata, updated_at: new Date().toISOString() },
    });

    if (!rawData || rawData.length === 0) return errorResponse(res, new Error('Agent not found'), 404);

    auditLog.agentUpdated(req.user?.id || 'unknown', id, orgId, { performed_by_email: req.user?.email || 'unknown', changes: validatedData });
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
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const query = new URLSearchParams();
    query.set('id', eq(id));
    query.set('organization_id', eq(orgId));
    const rows = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', query) as any[];
    if (!rows || rows.length === 0) return errorResponse(res, new Error('Agent not found'), 404);

    const [data] = await enrichAgentRecords(req, orgId, rows, new Map());
    return res.json({ success: true, data: { publishStatus: data.publishStatus, primaryPack: data.primaryPack, integrationIds: data.integrationIds, connectedTargets: data.connectedTargets, lastIntegrationSyncAt: data.lastIntegrationSyncAt } });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.put('/agents/:id/publish', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const { valid, data: validatedData, errors } = validateRequestBody<z.infer<typeof agentSchemas.publish>>(agentSchemas.publish, req.body);
    if (!valid || !validatedData) {
      logger.warn('Invalid agent publish update request', { errors, agent_id: id, org_id: orgId });
      return res.status(400).json({ success: false, errors });
    }

    const query = new URLSearchParams();
    query.set('id', eq(id));
    query.set('organization_id', eq(orgId));
    const rows = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', query) as any[];
    if (!rows || rows.length === 0) return errorResponse(res, new Error('Agent not found'), 404);

    const existingAgent = rows[0];
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(id));
    patchQuery.set('organization_id', eq(orgId));
    const patched = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', patchQuery, {
      method: 'PATCH',
      body: { metadata: writeAgentPublishMetadata(existingAgent, { publish_status: validatedData.publish_status, primary_pack: validatedData.primary_pack, integration_ids: validatedData.integration_ids, deploy_method: validatedData.deploy_method }), updated_at: new Date().toISOString() },
    }) as any[];

    const [data] = await enrichAgentRecords(req, orgId, patched, new Map());
    res.json({ success: true, data: { publishStatus: data.publishStatus, primaryPack: data.primaryPack, integrationIds: data.integrationIds, connectedTargets: data.connectedTargets, lastIntegrationSyncAt: data.lastIntegrationSyncAt } });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.post('/agents/:id/pause', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'Paused from fleet workspace';
    const agent = await patchAgentRecord(req, orgId, id, { status: 'paused' });
    await auditLog.log({ user_id: req.user?.id || 'unknown', action: 'agent.paused', resource_type: 'agent', resource_id: id, organization_id: orgId, metadata: { reason, performed_by_email: req.user?.email || null } });

    // Fire agent.suspended webhook when triggered via kill switch
    if (reason.toLowerCase().includes('kill switch')) {
      fireAndForgetWebhookEvent(orgId, 'agent.suspended', {
        id: `evt_suspend_${id}`,
        type: 'agent.suspended',
        created_at: new Date().toISOString(),
        organization_id: orgId,
        data: {
          agent_id: id,
          agent_name: agent.name || id,
          reason,
          suspended_by: req.user?.id || 'unknown',
        },
      });
    }

    const [data] = await enrichAgentRecords(req, orgId, [agent], new Map());
    res.json({ success: true, data, message: 'Agent paused' });
  } catch (error: any) {
    errorResponse(res, error, error?.message === 'Agent not found' ? 404 : 500);
  }
});

router.post('/agents/:id/resume', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const existingAgent = await getAgentRecord(req, orgId, id);
    if (existingAgent.status === 'terminated') return errorResponse(res, new Error('Terminated agents cannot be resumed'), 400);

    const publish = readAgentPublishMetadata(existingAgent);
    const agent = await patchAgentRecord(req, orgId, id, { status: 'active' });
    await auditLog.log({ user_id: req.user?.id || 'unknown', action: 'agent.resumed', resource_type: 'agent', resource_id: id, organization_id: orgId, metadata: { reason: typeof req.body?.reason === 'string' ? req.body.reason : 'Resumed from fleet workspace', performed_by_email: req.user?.email || null } });
    const [data] = await enrichAgentRecords(req, orgId, [agent], new Map());
    res.json({ success: true, data, message: 'Agent resumed' });
  } catch (error: any) {
    errorResponse(res, error, error?.message === 'Agent not found' ? 404 : 500);
  }
});

router.post('/agents/:id/go-live', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const existingAgent = await getAgentRecord(req, orgId, id);
    const publish = readAgentPublishMetadata(existingAgent);
    if ((publish.integration_ids || []).length === 0) return errorResponse(res, new Error('Connect at least one target before going live'), 400);

    const agent = await patchAgentRecord(req, orgId, id, {
      status: existingAgent.status === 'terminated' ? 'terminated' : (existingAgent.status || 'active'),
      metadata: writeAgentPublishMetadata(existingAgent, { publish_status: 'live', primary_pack: publish.primary_pack ?? null, integration_ids: publish.integration_ids || [] }),
    });

    await auditLog.log({ user_id: req.user?.id || 'unknown', action: 'agent.published', resource_type: 'agent', resource_id: id, organization_id: orgId, metadata: { primary_pack: publish.primary_pack ?? null, integration_ids: publish.integration_ids || [], performed_by_email: req.user?.email || null } });
    const [data] = await enrichAgentRecords(req, orgId, [agent], new Map());
    res.json({ success: true, data, message: 'Agent is now live' });
  } catch (error: any) {
    errorResponse(res, error, error?.message === 'Agent not found' ? 404 : 500);
  }
});

router.post('/agents/:id/escalate', requirePermission('incidents.escalate'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const existingAgent = await getAgentRecord(req, orgId, id);
    const nextRiskScore = Math.min(100, Number(existingAgent.risk_score || 0) + 15);
    const notes = typeof req.body?.notes === 'string' && req.body.notes.trim().length > 0 ? req.body.notes.trim() : 'Escalated from fleet workspace for human review';
    const assignee = typeof req.body?.assignee === 'string' && req.body.assignee.trim().length > 0 ? req.body.assignee.trim() : req.user?.email || 'Human review queue';

    const agent = await patchAgentRecord(req, orgId, id, {
      status: existingAgent.status === 'terminated' ? 'terminated' : 'paused',
      risk_score: nextRiskScore,
      risk_level: riskLevelFromScore(nextRiskScore),
    });

    const incidentRows = await supabaseRestAsUser(getUserJwt(req), 'incidents', '', {
      method: 'POST',
      body: { organization_id: orgId, agent_id: id, incident_type: 'escalation', severity: 'high', title: `Human review required for ${existingAgent.name}`, description: notes, status: 'open', escalated_to: assignee },
    }) as any[];

    await auditLog.log({ user_id: req.user?.id || 'unknown', action: 'agent.escalated', resource_type: 'agent', resource_id: id, organization_id: orgId, metadata: { notes, assignee, performed_by_email: req.user?.email || null } });
    const [data] = await enrichAgentRecords(req, orgId, [agent], new Map());
    res.json({ success: true, data: { agent: data, incident: Array.isArray(incidentRows) ? incidentRows[0] || null : null }, message: 'Agent escalated to human review' });
  } catch (error: any) {
    errorResponse(res, error, error?.message === 'Agent not found' ? 404 : 500);
  }
});

router.delete('/agents/:id', requirePermission('agents.delete'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    logger.info('Deleting agent', { agent_id: id, org_id: orgId, user_id: req.user?.id });

    const existsQuery = new URLSearchParams();
    existsQuery.set('id', eq(id));
    existsQuery.set('organization_id', eq(orgId));
    existsQuery.set('select', 'id');
    existsQuery.set('limit', '1');
    const existing = (await supabaseRestAsUser(getUserJwt(req), 'ai_agents', existsQuery)) as any[] | null;
    if (!existing || existing.length === 0) return errorResponse(res, new Error('Agent not found'), 404);

    const deleteQuery = new URLSearchParams();
    deleteQuery.set('id', eq(id));
    deleteQuery.set('organization_id', eq(orgId));
    const deleted = (await supabaseRestAsUser(getUserJwt(req), 'ai_agents', deleteQuery, { method: 'DELETE' })) as any[] | null;
    if (!deleted || deleted.length === 0) return errorResponse(res, new Error('Agent delete was not permitted by row-level security'), 403);

    await auditLog.agentDeleted(req.user?.id || 'unknown', id, orgId);
    logger.info('Agent deleted successfully', { agent_id: id, org_id: orgId });
    return res.json({ success: true, message: 'Agent deleted successfully', data: { id } });
  } catch (error: any) {
    return errorResponse(res, error);
  }
});

router.post('/agents/:id/kill', requirePermission('agents.kill'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { level = 1, reason } = req.body;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    logger.warn('Kill switch activated', { agent_id: id, level, reason, org_id: orgId, user_id: req.user?.id });

    const killQ = new URLSearchParams();
    killQ.set('id', eq(id));
    killQ.set('organization_id', eq(orgId));
    const agentData = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', killQ, { method: 'PATCH', body: { status: 'terminated', risk_score: 100, risk_level: 'high', updated_at: new Date().toISOString() } });
    if (!agentData?.length) return errorResponse(res, new Error('Agent not found'), 404);

    const agent = agentData[0];
    auditLog.killSwitchActivated(req.user?.id || 'unknown', id, orgId, level, reason || 'No reason provided', req.ip || req.socket.remoteAddress || 'unknown', req.get('user-agent') || 'unknown');

    await supabaseRestAsUser(getUserJwt(req), 'incidents', '', { method: 'POST', body: { organization_id: orgId, agent_id: id, incident_type: 'manual_termination', severity: level === 3 ? 'critical' : 'high', title: `Agent Terminated - Level ${level}`, description: reason || 'Manual termination triggered via kill switch', status: 'resolved', resolved_at: new Date().toISOString() } });

    logger.info('Agent terminated successfully', { agent_id: id, level });
    res.json({ success: true, message: `Agent terminated at level ${level}`, data: agent });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.post('/agents/:id/test', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { attackPrompt, category } = req.body;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);
    if (!attackPrompt) return errorResponse(res, new Error('attackPrompt is required'), 400);
    logger.info('Agent test requested', { agent_id: id, org_id: orgId, category });

    const agentQ = new URLSearchParams();
    agentQ.set('id', eq(id));
    agentQ.set('organization_id', eq(orgId));
    const agentData = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', agentQ);
    if (!agentData || agentData.length === 0) return errorResponse(res, new Error('Agent not found'), 404);

    const agent = agentData[0];
    if (!agent?.model_name) {
      logger.warn('Agent test failed: missing model_name', { agent_id: id, org_id: orgId });
      return errorResponse(res, new Error('Agent model_name is missing'), 400);
    }

    const key = process.env.RASI_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';
    if (!key) {
      logger.warn('Agent test failed: OpenRouter API key missing', { agent_id: id, org_id: orgId });
      return errorResponse(res, new Error('OpenRouter API key missing'), 400);
    }

    const modelName = agent.model_name.includes('/') ? agent.model_name : `openai/${agent.model_name}`;
    const startTime = Date.now();
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, messages: [{ role: 'system', content: agent.system_prompt || 'You are a helpful assistant.' }, { role: 'user', content: attackPrompt }], stream: false }),
    });

    if (!orRes.ok) {
      const errBody = await orRes.text();
      logger.error('Test Model request failed', { status: orRes.status, errBody, agent_id: id, org_id: orgId, model: modelName });
      const message = /payment required/i.test(errBody) || orRes.status === 402 ? 'Upstream LLM error: Payment Required' : `Upstream LLM error: ${orRes.statusText}`;
      return errorResponse(res, new Error(message), orRes.status || 502);
    }

    const orData = await orRes.json() as any;
    const latency = Date.now() - startTime;
    const simulatedResponse = orData?.choices?.[0]?.message?.content || '';
    const scanResults = incidentDetection.fullScan(simulatedResponse);
    const highest = incidentDetection.getHighestSeverity(scanResults);
    const expectedPass = !(highest && (highest.severity === 'critical' || highest.severity === 'high'));
    let details = expectedPass ? 'Defense successful. Agent stayed within boundaries.' : 'Vulnerability detected.';
    if (!expectedPass && highest) details = `Failed on: ${highest.type} (${highest.severity.toUpperCase()}). ${highest.details}`;

    logger.info('Agent test completed', { agent_id: id, org_id: orgId, model: modelName, latency, expectedPass });
    res.json({ success: true, latency, simulatedResponse, expectedPass, details, costUSD: orData?.usage?.cost || 0 });
  } catch (error: any) {
    logger.error('Agent test crashed', { error: error?.message || error, agent_id: req.params?.id, org_id: getOrgId(req) });
    errorResponse(res, error);
  }
});

// Suppress unused import warnings — crypto is kept for future use in this module
void crypto;

// ─── Connector linking ────────────────────────────────────────────────────────

router.patch('/agents/:id/connectors', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const { connectorIds } = req.body;
    if (!Array.isArray(connectorIds) || connectorIds.some((c) => typeof c !== 'string')) {
      return res.status(400).json({ success: false, error: 'connectorIds must be an array of strings' });
    }

    const existingAgent = await getAgentRecord(req, orgId, id);
    const updatedMetadata = writeAgentPublishMetadata(existingAgent, {
      integration_ids: connectorIds,
    });

    await patchAgentRecord(req, orgId, id, { metadata: updatedMetadata });
    res.json({ success: true, data: { connectorIds } });
  } catch (error: any) {
    errorResponse(res, error, error?.message === 'Agent not found' ? 404 : 500);
  }
});

export default router;
