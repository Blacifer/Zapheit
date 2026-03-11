import express, { Request, Response } from 'express';
import { supabaseRestAsUser, eq } from '../lib/supabase-rest';
import { requirePermission } from '../middleware/rbac';
import { logger } from '../lib/logger';
import { z } from 'zod';

const router = express.Router();

// Schema for generating performance reviews
const generateReviewSchema = z.object({
  agentId: z.string().uuid('Invalid agent ID'),
  periodStartDate: z.string().optional(),
  periodEndDate: z.string().optional(),
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

/**
 * POST /api/performance-reviews/generate
 * Generate a performance review for an AI agent
 */
router.post('/performance-reviews/generate', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const result = generateReviewSchema.safeParse(req.body);
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

    const { agentId, periodStartDate, periodEndDate } = result.data;

    // Verify agent belongs to org
    const agentQuery = new URLSearchParams();
    agentQuery.set('id', eq(agentId));
    agentQuery.set('organization_id', eq(orgId));
    const agents = (await supabaseRestAsUser(getUserJwt(req), 'ai_agents', agentQuery)) as any[];

    if (!agents || agents.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const agent = agents[0];

    // Get conversations for this agent
    const convQuery = new URLSearchParams();
    convQuery.set('agent_id', eq(agentId));
    convQuery.set('organization_id', eq(orgId));
    const conversations = (await supabaseRestAsUser(getUserJwt(req), 'conversations', convQuery)) as any[];

    // Get incidents for this agent
    const incidentQuery = new URLSearchParams();
    incidentQuery.set('agent_id', eq(agentId));
    incidentQuery.set('organization_id', eq(orgId));
    const incidents = (await supabaseRestAsUser(getUserJwt(req), 'incidents', incidentQuery)) as any[];

    // Get cost data for this agent
    const costQuery = new URLSearchParams();
    costQuery.set('agent_id', eq(agentId));
    costQuery.set('organization_id', eq(orgId));
    const costData = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', costQuery)) as any[];

    // Calculate metrics
    const totalConversations = conversations?.length || 0;
    const completedConversations = conversations?.filter((c) => c.status === 'completed').length || 0;
    const avgSatisfactionScore = 4.2; // Placeholder - would come from feedback data
    const openIncidents = incidents?.filter((i) => i.status === 'open').length || 0;
    const totalIncidents = incidents?.length || 0;
    const incidentRate = totalConversations > 0 ? (totalIncidents / totalConversations) * 100 : 0;

    // Calculate accuracy score (based on incident types and resolution)
    const resolvedIncidents = incidents?.filter((i) => i.status === 'resolved').length || 0;
    const criticalIncidents = incidents?.filter((i) => i.severity === 'critical').length || 0;
    const accuracyScore = Math.max(
      50,
      Math.min(100, 100 - (incidentRate * 2) - (criticalIncidents * 5))
    );

    // Calculate tone score (based on behavior and incident types)
    const toneIssues = incidents?.filter((i) => ['angry_user', 'toxic_output'].includes(i.incident_type)).length || 0;
    const toneScore = Math.max(50, Math.min(100, 100 - toneIssues * 10));

    // Calculate cost efficiency
    const totalCost = costData?.reduce((sum, c) => sum + (c.cost_usd || 0), 0) || 0;
    const costPerConversation = totalConversations > 0 ? totalCost / totalConversations : 0;

    // Generate recommendations
    const recommendations: string[] = [];

    if (incidentRate > 5) {
      recommendations.push('High incident rate detected. Consider refining system prompts or adding safety constraints.');
    }
    if (criticalIncidents > 0) {
      recommendations.push(`${criticalIncidents} critical incidents detected. Immediate action required to prevent escalation.`);
    }
    if (costPerConversation > 0.05) {
      recommendations.push('High cost per conversation. Consider downgrading to a more efficient model.');
    }
    if (accuracyScore < 70) {
      recommendations.push('Low accuracy score. Review agent outputs and update system prompts.');
    }
    if (toneScore < 70) {
      recommendations.push('Tone/behavior issues detected. Add guardrails to prevent inappropriate responses.');
    }
    if (totalConversations === 0) {
      recommendations.push('No conversation data available yet. Deploy the agent and gather baseline metrics.');
    }

    // Create review record
    const now = new Date();
    const reviewData = {
      organization_id: orgId,
      agent_id: agentId,
      review_period_start: periodStartDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
      review_period_end: periodEndDate || now.toISOString().split('T')[0],
      total_conversations: totalConversations,
      avg_satisfaction_score: parseFloat(avgSatisfactionScore.toFixed(2)),
      accuracy_score: parseFloat(accuracyScore.toFixed(2)),
      tone_score: parseFloat(toneScore.toFixed(2)),
      incident_count: totalIncidents,
      total_cost_usd: parseFloat(totalCost.toFixed(2)),
      recommendations: recommendations.join(' | '),
    };

    const reviewResult = (await supabaseRestAsUser(getUserJwt(req), 'performance_reviews', '', {
      method: 'POST',
      body: reviewData,
    })) as any[];

    if (!reviewResult || reviewResult.length === 0) {
      throw new Error('Failed to create performance review');
    }

    const review = reviewResult[0];

    logger.info('Performance review generated', {
      org_id: orgId,
      agent_id: agentId,
      accuracy: accuracyScore,
      tone: toneScore,
    });

    res.status(201).json({
      success: true,
      data: {
        ...review,
        metrics: {
          totalConversations,
          completedConversations,
          incidentRate: incidentRate.toFixed(2),
          costPerConversation: costPerConversation.toFixed(4),
          averageSatisfactionScore: avgSatisfactionScore,
        },
        summary: {
          status: accuracyScore >= 80 ? 'excellent' : accuracyScore >= 70 ? 'good' : 'needs_improvement',
          recommendations,
        },
      },
    });
  } catch (error: any) {
    logger.error('Performance review generation failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/performance-reviews
 * Get all performance reviews for an organization
 */
router.get('/performance-reviews', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const { agentId } = req.query;

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');

    if (agentId) {
      query.set('agent_id', eq(agentId as string));
    }

    const reviews = (await supabaseRestAsUser(getUserJwt(req), 'performance_reviews', query)) as any[];

    logger.info('Performance reviews fetched', { org_id: orgId, count: reviews?.length || 0 });

    res.json({
      success: true,
      data: reviews || [],
      count: reviews?.length || 0,
    });
  } catch (error: any) {
    logger.error('Failed to fetch performance reviews', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/performance-reviews/:id
 * Get a specific performance review
 */
router.get('/performance-reviews/:id', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const query = new URLSearchParams();
    query.set('id', eq(id));
    query.set('organization_id', eq(orgId));

    const reviews = (await supabaseRestAsUser(getUserJwt(req), 'performance_reviews', query)) as any[];

    if (!reviews || reviews.length === 0) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }

    res.json({ success: true, data: reviews[0] });
  } catch (error: any) {
    logger.error('Failed to fetch performance review', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
