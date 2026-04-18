import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';
import type { CostData } from '../../types';

/**
 * Cost API methods
 */
export const costApi = {
  /**
   * Get comprehensive cost insights and breakdown
   */
  async getInsights(filters?: {
    startDate?: string;
    endDate?: string;
    agentId?: string;
  }): Promise<ApiResponse<{
    insights: {
      totalCost: number;
      totalTokens: number;
      avgCostPerRequest: number;
      avgTokensPerRequest: number;
      topAgents: Array<{ agentId: string; cost: number }>;
      costByModel: Record<string, { cost: number; tokens: number; requests: number }>;
      dailyAverage: number;
    };
  }>> {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.agentId) params.append('agentId', filters.agentId);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const res: any = await authenticatedFetch(`/costs/insights${queryString}`, {
      method: 'GET',
    });

    // The backend returns { success: true, insights } directly, map it to { success, data: { insights } }
    return { success: res.success, data: { insights: res.insights }, error: res.error };
  },

  /**
   * Get cost trend over time (daily breakdown)
   */
  async getTrend(options?: {
    days?: number;
    agentId?: string;
  }): Promise<ApiResponse<{
    trend: Array<{
      date: string;
      cost: number;
      tokens: number;
      requests: number;
    }>;
  }>> {
    const params = new URLSearchParams();
    if (options?.days) params.append('days', options.days.toString());
    if (options?.agentId) params.append('agentId', options.agentId);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const res: any = await authenticatedFetch(`/costs/trend${queryString}`, {
      method: 'GET',
    });

    return { success: res.success, data: { trend: res.trend }, error: res.error };
  },

  /**
   * Get cost comparison between agents and models
   */
  async getComparison(): Promise<ApiResponse<{
    comparison: {
      agents: Array<{
        agentId: string;
        agentName: string;
        cost: number;
        tokens: number;
        requests: number;
      }>;
      models: Array<{
        model: string;
        cost: number;
        tokens: number;
        requests: number;
      }>;
    };
  }>> {
    return authenticatedFetch(`/costs/comparison`, {
      method: 'GET',
    });
  },

  /**
   * Get AI-powered cost optimization recommendations
   */
  async getOptimizationRecommendations(): Promise<ApiResponse<{
    recommendations: Array<{
      type: 'model_downgrade' | 'model_optimization';
      priority: 'low' | 'medium' | 'high';
      from?: string;
      to?: string;
      agent?: string;
      current?: string;
      recommendation?: string;
      agents?: string[];
      currentCost: number;
      estimatedSavings: number;
      percentSavings: number;
      rationale: string;
    }>;
  }>> {
    return authenticatedFetch(`/costs/optimization-recommendations`, {
      method: 'GET',
    });
  },

  /**
   * Get cost analytics with optional filters (legacy endpoint)
   */
  async getAnalytics(filters?: {
    agent_id?: string;
    period?: '7d' | '30d' | '90d' | 'all';
  }): Promise<ApiResponse<{
    data: CostData[];
    totals: {
      totalCost: number;
      totalTokens: number;
      totalRequests: number;
    };
    byDate: Record<string, { cost: number; tokens: number; requests: number }>;
    period: number;
  }>> {
    const params = new URLSearchParams();
    if (filters?.agent_id) params.append('agent_id', filters.agent_id);
    if (filters?.period) params.append('period', filters.period);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return authenticatedFetch(`/costs${queryString}`, {
      method: 'GET',
    });
  },

  /**
   * Record a cost entry (for webhook/integration)
   */
  async record(costData: {
    agent_id: string;
    conversation_id?: string;
    model_name: string;
    input_tokens: number;
    output_tokens: number;
    request_count?: number;
    avg_latency_ms?: number;
  }): Promise<ApiResponse<CostData>> {
    return authenticatedFetch<CostData>('/costs', {
      method: 'POST',
      body: JSON.stringify(costData),
    });
  },
};

/**
 * Metrics API
 */
export const metricsApi = {
  async getSystemMetrics(): Promise<ApiResponse<any>> {
    return authenticatedFetch('/metrics/system', {
      method: 'GET',
    });
  },

  async getDeliveryMetrics(): Promise<ApiResponse<any>> {
    return authenticatedFetch('/metrics/delivery', {
      method: 'GET',
    });
  },

  async getIncidentMetrics(): Promise<ApiResponse<any>> {
    return authenticatedFetch('/metrics/incidents', {
      method: 'GET',
    });
  },
};
