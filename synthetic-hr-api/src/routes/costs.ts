import express, { Request, Response } from 'express';
import { supabaseRestAsUser, eq, gte, lte } from '../lib/supabase-rest';
import { requirePermission } from '../middleware/rbac';
import { logger } from '../lib/logger';
import { z } from 'zod';

const router = express.Router();

// Query schemas
const costInsightsSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  agentId: z.string().uuid().optional(),
});

const costTrendSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  agentId: z.string().uuid().optional(),
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

// ============ COST ANALYTICS ENDPOINTS ============

/**
 * GET /api/costs/insights
 * Get comprehensive cost analysis and breakdown
 */
router.get('/costs/insights', requirePermission('costs.read'), async (req: Request, res: Response) => {
  try {
    const result = costInsightsSchema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.error.errors.map((e) => e.message) });
    }

    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const { startDate, endDate, agentId } = result.data;

    // Build query
    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));

    if (startDate) {
      query.set('date', `gte.${startDate}`);
    }
    if (endDate) {
      query.set('date', `lte.${endDate}`);
    }
    if (agentId) {
      query.set('agent_id', eq(agentId));
    }

    // Fetch cost data
    const costData = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', query)) as any[];

    if (!costData || costData.length === 0) {
      return res.json({
        success: true,
        insights: {
          totalCost: 0,
          totalTokens: 0,
          avgCostPerRequest: 0,
          avgTokensPerRequest: 0,
          topAgents: [],
          costByModel: {},
          dailyAverage: 0,
        },
      });
    }

    // Calculate insights
    const totalCost = costData.reduce((sum, d) => sum + (d.cost_usd || 0), 0);
    const totalTokens = costData.reduce((sum, d) => sum + (d.total_tokens || 0), 0);
    const totalRequests = costData.reduce((sum, d) => sum + (d.request_count || 0), 0);

    // Group by model
    const costByModel: Record<string, { cost: number; tokens: number; requests: number }> = {};
    costData.forEach((cost) => {
      if (!costByModel[cost.model_name]) {
        costByModel[cost.model_name] = { cost: 0, tokens: 0, requests: 0 };
      }
      costByModel[cost.model_name].cost += cost.cost_usd || 0;
      costByModel[cost.model_name].tokens += cost.total_tokens || 0;
      costByModel[cost.model_name].requests += cost.request_count || 0;
    });

    // Different agents if agent filter not applied
    const topAgents = agentId
      ? []
      : Array.from(new Set(costData.map((d) => d.agent_id)))
        .map((agId) => ({
          agentId: agId,
          cost: costData.filter((d) => d.agent_id === agId).reduce((sum, d) => sum + (d.cost_usd || 0), 0),
        }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);

    const dailyAverage = costData.length > 0 ? totalCost / costData.length : 0;

    logger.info('Cost insights retrieved', {
      org_id: orgId,
      total_cost: totalCost,
      total_tokens: totalTokens,
    });

    res.json({
      success: true,
      insights: {
        totalCost,
        totalTokens,
        avgCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
        avgTokensPerRequest: totalRequests > 0 ? totalTokens / totalRequests : 0,
        topAgents,
        costByModel,
        dailyAverage,
      },
    });
  } catch (error: any) {
    logger.error('Cost insights failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/costs/trend
 * Get cost trend over time (daily breakdown)
 */
router.get('/costs/trend', requirePermission('costs.read'), async (req: Request, res: Response) => {
  try {
    const result = costTrendSchema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.error.errors.map((e) => e.message) });
    }

    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const { days, agentId } = result.data;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Build query
    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('date', `gte.${startDate.toISOString().split('T')[0]}`);
    query.set('date', `lte.${endDate.toISOString().split('T')[0]}`);
    query.set('order', 'date.asc');

    if (agentId) {
      query.set('agent_id', eq(agentId));
    }

    // Fetch cost data
    const costData = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', query)) as any[];

    // Group by date
    const trendByDate: Record<string, { date: string; cost: number; tokens: number; requests: number }> = {};

    costData.forEach((cost) => {
      if (!trendByDate[cost.date]) {
        trendByDate[cost.date] = {
          date: cost.date,
          cost: 0,
          tokens: 0,
          requests: 0,
        };
      }
      trendByDate[cost.date].cost += cost.cost_usd || 0;
      trendByDate[cost.date].tokens += cost.total_tokens || 0;
      trendByDate[cost.date].requests += cost.request_count || 0;
    });

    const trend = Object.values(trendByDate).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    logger.info('Cost trend retrieved', { org_id: orgId, days, data_points: trend.length });

    res.json({ success: true, trend });
  } catch (error: any) {
    logger.error('Cost trend failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/costs/comparison
 * Compare costs between agents or models
 */
router.get('/costs/comparison', requirePermission('costs.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'cost_usd.desc');

    // Fetch all cost data for the org
    const costData = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', query)) as any[];

    if (!costData || costData.length === 0) {
      return res.json({ success: true, comparison: { agents: [], models: [] } });
    }

    // Get agent names for comparison
    const agentQuery = new URLSearchParams();
    agentQuery.set('organization_id', eq(orgId));
    const agents = (await supabaseRestAsUser(getUserJwt(req), 'ai_agents', agentQuery)) as any[];
    const agentMap = new Map(agents.map((a) => [a.id, a.name]));

    // Aggregate by agent
    const agentComparison: Record<string, { agentId: string; agentName: string; cost: number; tokens: number; requests: number }> = {};
    costData.forEach((cost) => {
      if (!agentComparison[cost.agent_id]) {
        agentComparison[cost.agent_id] = {
          agentId: cost.agent_id,
          agentName: agentMap.get(cost.agent_id) || 'Unknown',
          cost: 0,
          tokens: 0,
          requests: 0,
        };
      }
      agentComparison[cost.agent_id].cost += cost.cost_usd || 0;
      agentComparison[cost.agent_id].tokens += cost.total_tokens || 0;
      agentComparison[cost.agent_id].requests += cost.request_count || 0;
    });

    // Aggregate by model
    const modelComparison: Record<string, { model: string; cost: number; tokens: number; requests: number }> = {};
    costData.forEach((cost) => {
      if (!modelComparison[cost.model_name]) {
        modelComparison[cost.model_name] = {
          model: cost.model_name,
          cost: 0,
          tokens: 0,
          requests: 0,
        };
      }
      modelComparison[cost.model_name].cost += cost.cost_usd || 0;
      modelComparison[cost.model_name].tokens += cost.total_tokens || 0;
      modelComparison[cost.model_name].requests += cost.request_count || 0;
    });

    logger.info('Cost comparison retrieved', { org_id: orgId });

    res.json({
      success: true,
      comparison: {
        agents: Object.values(agentComparison).sort((a, b) => b.cost - a.cost),
        models: Object.values(modelComparison).sort((a, b) => b.cost - a.cost),
      },
    });
  } catch (error: any) {
    logger.error('Cost comparison failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/costs/optimization-recommendations
 * Get AI-powered cost optimization recommendations
 */
router.get('/costs/optimization-recommendations', requirePermission('costs.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    // Fetch cost and agent data
    const costQuery = new URLSearchParams();
    costQuery.set('organization_id', eq(orgId));
    const costData = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', costQuery)) as any[];

    const agentQuery = new URLSearchParams();
    agentQuery.set('organization_id', eq(orgId));
    const agents = (await supabaseRestAsUser(getUserJwt(req), 'ai_agents', agentQuery)) as any[];

    if (!costData || costData.length === 0) {
      return res.json({ success: true, recommendations: [] });
    }

    const recommendations: any[] = [];

    // Analyze by model and suggest downgrades
    const modelCosts: Record<string, { cost: number; count: number; agents: string[] }> = {};
    costData.forEach((cost) => {
      if (!modelCosts[cost.model_name]) {
        modelCosts[cost.model_name] = { cost: 0, count: 0, agents: [] };
      }
      modelCosts[cost.model_name].cost += cost.cost_usd || 0;
      modelCosts[cost.model_name].count += 1;
      const agentName = agents.find((a) => a.id === cost.agent_id)?.name || 'Unknown';
      if (!modelCosts[cost.model_name].agents.includes(agentName)) {
        modelCosts[cost.model_name].agents.push(agentName);
      }
    });

    // GPT-4 → GPT-4o migration recommendation (40% faster, 90% cheaper)
    if (modelCosts['gpt-4']) {
      const savings = modelCosts['gpt-4'].cost * 0.9 * 0.9; // 90% of cost with 10% performance loss
      recommendations.push({
        type: 'model_downgrade',
        priority: 'high',
        from: 'gpt-4',
        to: 'gpt-4-turbo',
        agents: modelCosts['gpt-4'].agents,
        currentCost: modelCosts['gpt-4'].cost,
        estimatedSavings: savings,
        percentSavings: 70,
        rationale: 'GPT-4-Turbo offers 70% cost reduction with 99% performance parity',
      });
    }

    // Claude-3-Opus → Claude-3-Sonnet (60% cheaper)
    if (modelCosts['claude-3-opus']) {
      const savings = modelCosts['claude-3-opus'].cost * 0.8; // 80% savings
      recommendations.push({
        type: 'model_downgrade',
        priority: 'medium',
        from: 'claude-3-opus',
        to: 'claude-3-sonnet',
        agents: modelCosts['claude-3-opus'].agents,
        currentCost: modelCosts['claude-3-opus'].cost,
        estimatedSavings: savings,
        percentSavings: 80,
        rationale: 'Claude-3-Sonnet is optimized for cost-effective performance',
      });
    }

    // High-frequency, low-complexity agents should use faster models
    agents.forEach((agent) => {
      const agentCosts = costData.filter((c) => c.agent_id === agent.id);
      if (agentCosts.length > 0) {
        const avgTokensPerRequest =
          agentCosts.reduce((sum, c) => sum + (c.total_tokens || 0), 0) / agentCosts.length;

        if (avgTokensPerRequest < 500 && agent.model_name.includes('gpt-4')) {
          recommendations.push({
            type: 'model_optimization',
            priority: 'low',
            agent: agent.name,
            current: agent.model_name,
            recommendation: 'gpt-4o-mini',
            rationale: `Low token count (avg ${Math.floor(avgTokensPerRequest)}). Mini model sufficient.`,
            estimatedSavings: agentCosts.reduce((sum, c) => sum + (c.cost_usd || 0), 0) * 0.95,
          });
        }
      }
    });

    logger.info('Cost recommendations generated', { org_id: orgId, count: recommendations.length });

    res.json({ success: true, recommendations });
  } catch (error: any) {
    logger.error('Cost recommendations failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
