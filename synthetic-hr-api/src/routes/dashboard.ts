import express, { Request, Response } from 'express';
import { requirePermission } from '../middleware/rbac';
import { supabaseRestAsUser, eq, gte } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { errorResponse, getOrgId, getUserJwt, clampDays, buildDaySeries, toIsoDay } from '../lib/route-helpers';

const router = express.Router();

// In-memory OpenRouter models cache (5-min TTL)
let modelsCache: { data: any[]; expiresAt: number } = { data: [], expiresAt: 0 };

// GET /api/dashboard — dashboard summary
router.get('/dashboard', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.info('Fetching dashboard summary', { org_id: orgId });

    const agentSummaryQuery = new URLSearchParams();
    agentSummaryQuery.set('organization_id', eq(orgId));
    agentSummaryQuery.set('select', 'id,name,status,risk_level,risk_score,agent_type');
    const agents = await supabaseRestAsUser(getUserJwt(req), 'ai_agents', agentSummaryQuery);

    const incidentSummaryQuery = new URLSearchParams();
    incidentSummaryQuery.set('organization_id', eq(orgId));
    incidentSummaryQuery.set('select', 'severity,status');
    const incidents = await supabaseRestAsUser(getUserJwt(req), 'incidents', incidentSummaryQuery);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    const costSummaryQuery = new URLSearchParams();
    costSummaryQuery.set('organization_id', eq(orgId));
    costSummaryQuery.set('date', gte(thirtyDaysAgoStr));
    costSummaryQuery.set('select', 'cost_usd,total_tokens');
    const costs = await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', costSummaryQuery);

    const activeAgents = agents?.filter((a: any) => a.status === 'active').length || 0;
    const highRiskAgents = agents?.filter((a: any) => a.risk_level === 'high').length || 0;
    const openIncidents = incidents?.filter((i: any) => i.status === 'open').length || 0;
    const criticalIncidents = incidents?.filter((i: any) => i.severity === 'critical').length || 0;
    const totalCost = costs?.reduce((acc: number, c: any) => acc + (c.cost_usd || 0), 0) || 0;
    const totalTokens = costs?.reduce((acc: number, c: any) => acc + (c.total_tokens || 0), 0) || 0;

    const avgRiskScore = agents?.length
      ? Math.round(agents.reduce((acc: number, a: any) => acc + (a.risk_score || 0), 0) / agents.length)
      : 50;

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

// GET /api/dashboard/telemetry — sparkline and movement cards
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

    let costRows: Array<{ date: string; cost_usd?: number; request_count?: number }> = [];

    try {
      const costQuery = new URLSearchParams();
      costQuery.set('organization_id', eq(orgId));
      costQuery.set('date', gte(previousDayIso));
      costQuery.set('select', 'date,cost_usd,request_count');
      costQuery.set('order', 'date.asc');
      costRows = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', costQuery)) as typeof costRows;
    } catch (costError: any) {
      logger.warn('Overview telemetry could not load full cost tracking shape; retrying fallback query', { org_id: orgId, error: costError?.message });
      try {
        const fallbackCostQuery = new URLSearchParams();
        fallbackCostQuery.set('organization_id', eq(orgId));
        fallbackCostQuery.set('date', gte(previousDayIso));
        fallbackCostQuery.set('select', 'date,cost_usd');
        fallbackCostQuery.set('order', 'date.asc');
        const fallbackRows = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', fallbackCostQuery)) as Array<{ date: string; cost_usd?: number }>;
        costRows = fallbackRows.map((row) => ({ ...row, request_count: 0 }));
      } catch (fallbackCostError: any) {
        logger.warn('Overview telemetry could not load cost tracking; defaulting to empty state', { org_id: orgId, error: fallbackCostError?.message });
        costRows = [];
      }
    }

    let incidentRows: Array<{ id: string; created_at: string; severity?: string; status?: string }> = [];

    try {
      const incidentQuery = new URLSearchParams();
      incidentQuery.set('organization_id', eq(orgId));
      incidentQuery.set('created_at', gte(new Date(`${previousDayIso}T00:00:00.000Z`).toISOString()));
      incidentQuery.set('select', 'id,created_at,severity,status');
      incidentQuery.set('order', 'created_at.asc');
      incidentRows = (await supabaseRestAsUser(getUserJwt(req), 'incidents', incidentQuery)) as typeof incidentRows;
    } catch (incidentError: any) {
      logger.warn('Overview telemetry could not load incidents; defaulting to empty state', { org_id: orgId, error: incidentError?.message });
      incidentRows = [];
    }

    let integrationRows: Array<{ id: string; status?: string; updated_at?: string }> = [];

    try {
      const integrationQuery = new URLSearchParams();
      integrationQuery.set('organization_id', eq(orgId));
      integrationQuery.set('select', 'id,status,updated_at');
      integrationRows = (await supabaseRestAsUser(getUserJwt(req), 'platform_integrations', integrationQuery)) as typeof integrationRows;
    } catch (integrationError: any) {
      logger.warn('Overview telemetry could not load platform integrations; defaulting to empty state', { org_id: orgId, error: integrationError?.message });
      integrationRows = [];
    }

    const costByDay: Record<string, number> = Object.fromEntries(seriesDays.map((day) => [day, 0]));
    const requestsByDay: Record<string, number> = Object.fromEntries(seriesDays.map((day) => [day, 0]));
    const incidentsByDay: Record<string, number> = Object.fromEntries(seriesDays.map((day) => [day, 0]));

    let currentDaySpend = 0;
    let previousDaySpend = 0;
    let currentDayRequests = 0;
    let previousDayRequests = 0;

    // "last 24h" spans a UTC midnight boundary for users in non-UTC timezones,
    // so include both today and yesterday to avoid showing ₹0 for costs recorded
    // at e.g. 22:30 UTC that were incurred "today" in the user's local timezone.
    const todayIso = seriesDays[seriesDays.length - 1];
    const yesterdayIso = seriesDays.length >= 2 ? seriesDays[seriesDays.length - 2] : '';
    const twoDaysAgoIso = seriesDays.length >= 3 ? seriesDays[seriesDays.length - 3] : '';

    for (const row of costRows) {
      if (row.date === todayIso || row.date === yesterdayIso) {
        currentDaySpend += row.cost_usd || 0;
        currentDayRequests += row.request_count || 0;
      }
      if (row.date === twoDaysAgoIso) {
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

    for (const row of incidentRows) {
      const day = row.created_at?.split('T')[0];
      if (day && day in incidentsByDay) {
        incidentsByDay[day] += 1;
      }
    }

    const healthyIntegrations = integrationRows.filter((row) =>
      ['connected', 'active', 'live'].includes((row.status || '').toLowerCase())
    ).length;
    const degradedIntegrations = Math.max(0, integrationRows.length - healthyIntegrations);

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
          total: integrationRows.length || 0,
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

// GET /api/models — live model catalog from OpenRouter
router.get('/models', async (req: Request, res: Response) => {
  try {
    if (Date.now() < modelsCache.expiresAt && modelsCache.data.length > 0) {
      return res.json({ success: true, data: modelsCache.data });
    }

    const openRouterKey = process.env.RASI_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      return res.json({
        success: true,
        data: [
          { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
          { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
          { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
          { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'Anthropic' },
          { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'Google' },
          { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'Meta' },
          { id: 'mistralai/mistral-large', name: 'Mistral Large', provider: 'Mistral' },
        ],
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

const PLAN_QUOTAS: Record<string, number> = {
  free: 10_000,
  audit: 50_000,
  retainer: 200_000,
  enterprise: -1,
};

const PLAN_AGENT_LIMITS: Record<string, number> = {
  free: 3,
  audit: 5,
  retainer: 50,
  enterprise: -1,
};

const PLAN_DISPLAY: Record<string, string> = {
  free: 'Free',
  audit: 'The Audit',
  retainer: 'The Retainer',
  enterprise: 'Enterprise',
};

// GET /api/usage — current plan + gateway usage for this month
router.get('/usage', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const month = new Date().toISOString().slice(0, 7);

    const jwt = getUserJwt(req);
    const orgParams = new URLSearchParams();
    orgParams.set('id', eq(orgId));
    orgParams.set('select', 'plan,name');
    const orgRows = await supabaseRestAsUser(jwt, 'organizations', orgParams);
    const org = Array.isArray(orgRows) ? orgRows[0] : null;
    const planKey = String(org?.plan || 'free').toLowerCase();
    const quota = PLAN_QUOTAS[planKey] ?? PLAN_QUOTAS.free;
    const planName = PLAN_DISPLAY[planKey] ?? planKey;

    const usageParams = new URLSearchParams();
    usageParams.set('org_id', eq(orgId));
    usageParams.set('month', `eq.${month}`);

    const agentCountParams = new URLSearchParams();
    agentCountParams.set('organization_id', eq(orgId));
    agentCountParams.set('status', 'neq.terminated');
    agentCountParams.set('select', 'id');

    const [usageRows, agentRows] = await Promise.all([
      supabaseRestAsUser(jwt, 'gateway_usage', usageParams),
      supabaseRestAsUser(jwt, 'ai_agents', agentCountParams),
    ]);
    const usage = Array.isArray(usageRows) ? usageRows[0] : null;
    const used: number = usage?.request_count ?? 0;
    const agentCount: number = Array.isArray(agentRows) ? agentRows.length : 0;
    const agentLimit: number = PLAN_AGENT_LIMITS[planKey] ?? PLAN_AGENT_LIMITS.free;

    return res.json({
      success: true,
      data: { used, quota, plan: planName, planKey, month, agentCount, agentLimit },
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

export default router;
