import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../middleware/rbac';
import { supabaseRestAsUser } from '../lib/supabase-rest';
import { errorResponse, getOrgId, getUserJwt, safeLimit } from '../lib/route-helpers';

const router = Router();

// Model pricing map (per 1M tokens, USD) — used for cost estimation
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 5, output: 15 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] || { input: 1, output: 3 };
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// GET /api/traces
router.get('/traces', requirePermission('incidents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    const jwt = getUserJwt(req);
    const {
      agent_id,
      model,
      from,
      to,
      min_latency,
      limit: rawLimit = '100',
      offset: rawOffset = '0',
      sort_by = 'created_at',
      sort_dir = 'desc',
    } = req.query;

    const limit = safeLimit(rawLimit as string);
    const offset = Math.max(0, parseInt(rawOffset as string, 10) || 0);

    const params = new URLSearchParams();
    params.set('organization_id', `eq.${orgId}`);
    params.set('order', `${sort_by}.${sort_dir}`);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    if (agent_id) params.set('agent_id', `eq.${agent_id}`);
    if (model) params.set('model', `eq.${model}`);
    if (from) params.set('created_at', `gte.${from}`);
    if (to) {
      // If both from and to — use AND filter via multiple params
      params.append('created_at', `lte.${to}`);
    }
    if (min_latency) params.set('latency_ms', `gte.${min_latency}`);

    // Fetch traces + agent names in one REST call using embedding
    params.set('select', 'id,agent_id,conversation_id,request_id,model,input_tokens,output_tokens,total_tokens,latency_ms,tool_calls,risk_score,policy_violations,interceptors_applied,metadata,created_at,ai_agents(name)');

    const data = await supabaseRestAsUser(jwt, 'gateway_reasoning_traces', params);
    const rows: any[] = Array.isArray(data) ? data : [];

    // Annotate with cost
    const annotated = rows.map((r) => ({
      ...r,
      agent_name: r.ai_agents?.name || null,
      cost_usd: estimateCost(r.model || '', r.input_tokens || 0, r.output_tokens || 0),
      tool_calls_count: Array.isArray(r.tool_calls) ? r.tool_calls.length : 0,
    }));

    // Stats (computed from current page — for precise stats the caller can pass larger limit)
    const latencies = annotated.map((r) => r.latency_ms).filter((v) => v != null).sort((a, b) => a - b);
    const avgLatency = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0;
    const p95Latency = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1] : 0;
    const totalCost = annotated.reduce((s, r) => s + r.cost_usd, 0);
    const modelCounts: Record<string, number> = {};
    for (const r of annotated) {
      if (r.model) modelCounts[r.model] = (modelCounts[r.model] || 0) + 1;
    }
    const topModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return res.json({
      success: true,
      data: {
        traces: annotated,
        total: annotated.length,
        stats: {
          avg_latency_ms: avgLatency,
          p95_latency_ms: p95Latency,
          total_cost_usd: parseFloat(totalCost.toFixed(6)),
          top_model: topModel,
        },
      },
    });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

export default router;
