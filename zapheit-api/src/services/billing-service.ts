/**
 * billing-service.ts
 *
 * Extracted from routes/gateway.ts.
 * Owns budget-check and cost-recording business logic.
 * Routes call these functions instead of embedding the DB logic inline.
 *
 * Testable in isolation: inject mock supabaseRest in tests.
 */

import { supabaseRest, eq, gte } from '../lib/supabase-rest';
import { usdToInr } from '../lib/currency';
import { logger } from '../lib/logger';
import { checkAgentRateLimitDistributed } from '../lib/rate-limiter';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BudgetCheckOk {
  ok: true;
  agent: Record<string, any>;
  agentId: string;
}

export interface BudgetCheckFail {
  ok: false;
  status: 402 | 404 | 429;
  body: object;
}

export type BudgetCheckResult = BudgetCheckOk | BudgetCheckFail;

export interface CostRecord {
  organizationId: string;
  agentId: string | null;
  modelId: string;
  modelProvider: string;
  billedModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUSD: number;
  latencyMs: number;
  apiKeyId: string;
  requestId: string;
  endpoint: string;
}

// ── Budget check ─────────────────────────────────────────────────────────────

/**
 * Validates that an agent exists for the org, is within rate and budget limits.
 * Returns the agent row on success so the caller can re-use it.
 */
export async function checkAgentBudget(
  orgId: string,
  agentId: string,
): Promise<BudgetCheckResult> {
  try {
    const query = new URLSearchParams();
    query.set('id', eq(agentId));
    query.set('organization_id', eq(orgId));
    const agents = (await supabaseRest('ai_agents', query)) as any[];

    if (!agents || agents.length === 0) {
      return {
        ok: false,
        status: 404,
        body: { error: { message: 'Agent not found', type: 'invalid_request_error' } },
      };
    }

    const agent = agents[0];

    // Per-agent rate limiting (Redis-backed when REDIS_URL is set)
    const rl = await checkAgentRateLimitDistributed(agentId, agent.config || {});
    if (!rl.allowed) {
      return {
        ok: false,
        status: 429,
        body: {
          error: {
            message: 'Agent rate limit exceeded',
            type: 'rate_limit_error',
            retry_after: rl.retryAfter,
          },
        },
      };
    }

    const budgetLimit = Number(agent.config?.budget_limit ?? 0);

    if (budgetLimit > 0) {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      const costQuery = new URLSearchParams();
      costQuery.set('organization_id', eq(orgId));
      costQuery.set('agent_id', eq(agentId));
      costQuery.set('date', gte(monthStart.toISOString().split('T')[0]));
      const costRows = (await supabaseRest('cost_tracking', costQuery)) as any[];
      const totalCostUsd = (costRows || []).reduce(
        (sum, row) => sum + Number(row?.cost_usd || 0),
        0,
      );
      const currentSpend = usdToInr(totalCostUsd);

      if (currentSpend >= budgetLimit) {
        return {
          ok: false,
          status: 402,
          body: { error: { message: 'Budget limit exceeded', type: 'payment_required_error' } },
        };
      }
    }

    return { ok: true, agent, agentId };
  } catch (err) {
    logger.error('[billing] Failed to check agent budget', { error: err });
    // Fail open — let the request proceed to avoid blocking on transient DB errors
    return { ok: true, agent: {}, agentId };
  }
}

// ── Cost recording ────────────────────────────────────────────────────────────

/**
 * Writes a cost_tracking row and updates the agent's cached current_spend.
 * Fire-and-forget safe: catches and logs errors without throwing.
 */
export async function recordCost(record: CostRecord): Promise<void> {
  try {
    await supabaseRest('cost_tracking', '', {
      method: 'POST',
      body: {
        organization_id: record.organizationId,
        agent_id: record.agentId || undefined,
        date: new Date().toISOString().split('T')[0],
        model_name: record.modelId,
        input_tokens: record.inputTokens,
        output_tokens: record.outputTokens,
        total_tokens: record.totalTokens,
        cost_usd: record.costUSD,
        request_count: 1,
        avg_latency_ms: record.latencyMs,
        metadata: {
          api_key_id: record.apiKeyId,
          provider: record.modelProvider,
          billed_model: record.billedModel,
          gateway_model_id: record.modelId,
          endpoint: record.endpoint,
          request_id: record.requestId,
        },
      },
    });

    if (record.agentId && record.costUSD > 0) {
      const agentQuery = new URLSearchParams();
      agentQuery.set('id', eq(record.agentId));
      const agents = (await supabaseRest('ai_agents', agentQuery)) as any[];
      if (agents?.length > 0) {
        const agent = agents[0];
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        const costQuery = new URLSearchParams();
        costQuery.set('organization_id', eq(record.organizationId));
        costQuery.set('agent_id', eq(record.agentId));
        costQuery.set('date', gte(monthStart.toISOString().split('T')[0]));
        const costRows = (await supabaseRest('cost_tracking', costQuery)) as any[];
        const totalCostUsd = (costRows || []).reduce(
          (sum, row) => sum + Number(row?.cost_usd || 0),
          0,
        );
        const newSpend = usdToInr(totalCostUsd);
        const newConfig = { ...agent.config, current_spend: newSpend };
        await supabaseRest('ai_agents', agentQuery, {
          method: 'PATCH',
          body: { config: newConfig },
        });
      }
    }
  } catch (err) {
    logger.error('[billing] Failed to record cost', { error: err });
  }
}
