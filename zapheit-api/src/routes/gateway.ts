import crypto from 'crypto';
import express, { Request, Response } from 'express';
import multer from 'multer';
import { AnthropicService, OpenAIService, type ConnectorTool, type ToolCall } from '../services/ai-service';
import { incidentDetection } from '../services/incident-detection';
import { validateApiKey } from '../middleware/api-key-validation';
import { buildFrontendUrl } from '../lib/frontend-url';
import { logger } from '../lib/logger';
import { supabaseRest, eq, gte } from '../lib/supabase-rest';
import { fireAndForgetWebhookEvent } from '../lib/webhook-relay';
import { sendTransactionalEmail } from '../lib/email';
import { notifySlackIncident } from '../lib/slack-notify';
import { applyRequestInterceptors, applyResponseInterceptors, resolveModelRouting, classifyQueryComplexity } from '../lib/gateway-interceptors';
import { recordPromptCacheObservation, lookupSemanticCache, storeSemanticCacheResponse } from '../lib/prompt-caching';
import { ACTION_REGISTRY } from '../lib/connectors/action-registry';
import { executeConnectorAction } from '../lib/connectors/action-executor';
import { decryptSecret, encryptSecret } from '../lib/integrations/encryption';
import { getAdapter } from '../lib/integrations/adapters';
import { computeEntropy } from '../services/policy-engine';
import { runPreflightGate } from '../lib/preflight-gate';
import { buildGovernedActionSnapshot } from '../lib/governed-actions';
import { fetchRelevantCorrections } from '../lib/correction-memory';
import { pushIncidentEvent } from './incidents';
import { notifyAlertChannels } from '../lib/alert-channels';
import { firePlaybookTriggers } from '../lib/trigger-evaluator';
import { usdToInr } from '../lib/currency';
import { appendAuditChainEvent } from '../lib/trust-audit-chain';
import { checkAgentBudget as checkAgentBudgetService, recordCost } from '../services/billing-service';
import { applyCrossBorderMasking, reinjectMaskedValues } from '../lib/cross-border-pii';

const router = express.Router();

interface GatewayModel {
  id: string;
  provider: 'openai' | 'anthropic' | 'openrouter';
  upstreamModel: string;
  ownedBy: string;
  contextLength?: number;
  pricing?: { prompt: string; completion: string };
  capabilities?: string[];
}

const ANTHROPIC_MODEL_ALIASES: Record<string, string> = {
  // Legacy Claude 3 → current equivalents
  'claude-3-opus': 'claude-sonnet-4-6',
  'claude-3-opus-20240229': 'claude-sonnet-4-6',
  'claude-3-sonnet': 'claude-sonnet-4-6',
  'claude-3-sonnet-20240229': 'claude-sonnet-4-6',
  'claude-3-haiku': 'claude-haiku-4-5',
  'claude-3-haiku-20240307': 'claude-haiku-4-5',
  'claude-3.5-sonnet': 'claude-sonnet-4-6',
  'claude-3-5-sonnet-20240620': 'claude-sonnet-4-6',
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
  'claude-3.5-haiku': 'claude-haiku-4-5',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5',
  // Claude 4 aliases
  'claude-sonnet-4': 'claude-sonnet-4-6',
  'claude-sonnet-4-0': 'claude-sonnet-4-6',
};

const GATEWAY_MODELS: GatewayModel[] = [
  // OpenAI — native direct route
  { id: 'openai/gpt-4o', provider: 'openai', upstreamModel: 'gpt-4o', ownedBy: 'openai', contextLength: 128000, pricing: { prompt: '0.000005', completion: '0.000015' }, capabilities: ['vision', 'function_calling'] },
  { id: 'openai/gpt-4o-mini', provider: 'openai', upstreamModel: 'gpt-4o-mini', ownedBy: 'openai', contextLength: 128000, pricing: { prompt: '0.00000015', completion: '0.0000006' }, capabilities: ['vision', 'function_calling'] },
  { id: 'openai/gpt-4o-mini-transcribe', provider: 'openai', upstreamModel: 'gpt-4o-mini-transcribe', ownedBy: 'openai', contextLength: 128000, pricing: { prompt: '0.00000015', completion: '0.0000006' }, capabilities: ['audio'] },
  { id: 'openai/whisper-1', provider: 'openai', upstreamModel: 'whisper-1', ownedBy: 'openai', capabilities: ['audio'] },
  { id: 'openai/gpt-4-turbo', provider: 'openai', upstreamModel: 'gpt-4-turbo', ownedBy: 'openai', contextLength: 128000, pricing: { prompt: '0.00001', completion: '0.00003' }, capabilities: ['vision', 'function_calling'] },
  { id: 'openai/gpt-3.5-turbo', provider: 'openai', upstreamModel: 'gpt-3.5-turbo', ownedBy: 'openai', contextLength: 16385, pricing: { prompt: '0.0000005', completion: '0.0000015' }, capabilities: ['function_calling'] },
  { id: 'openai/text-embedding-3-small', provider: 'openai', upstreamModel: 'text-embedding-3-small', ownedBy: 'openai', capabilities: ['embeddings'] },
  { id: 'openai/text-embedding-3-large', provider: 'openai', upstreamModel: 'text-embedding-3-large', ownedBy: 'openai', capabilities: ['embeddings'] },
  // Anthropic — native direct route; legacy IDs aliased to current supported upstream
  { id: 'anthropic/claude-sonnet-4-6', provider: 'anthropic', upstreamModel: 'claude-sonnet-4-6', ownedBy: 'anthropic', contextLength: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, capabilities: ['vision', 'function_calling'] },
  { id: 'anthropic/claude-haiku-4-5', provider: 'anthropic', upstreamModel: 'claude-haiku-4-5', ownedBy: 'anthropic', contextLength: 200000, pricing: { prompt: '0.0000008', completion: '0.000004' }, capabilities: ['vision', 'function_calling'] },
  // Legacy IDs kept for backwards compatibility — aliased to current models above
  { id: 'anthropic/claude-sonnet-4', provider: 'anthropic', upstreamModel: 'claude-sonnet-4-6', ownedBy: 'anthropic', contextLength: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, capabilities: ['vision', 'function_calling'] },
  { id: 'anthropic/claude-3-5-sonnet', provider: 'anthropic', upstreamModel: 'claude-sonnet-4-6', ownedBy: 'anthropic', contextLength: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, capabilities: ['vision', 'function_calling'] },
  { id: 'anthropic/claude-3-sonnet', provider: 'anthropic', upstreamModel: 'claude-sonnet-4-6', ownedBy: 'anthropic', contextLength: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, capabilities: ['vision', 'function_calling'] },
  { id: 'anthropic/claude-3-haiku', provider: 'anthropic', upstreamModel: 'claude-haiku-4-5', ownedBy: 'anthropic', contextLength: 200000, pricing: { prompt: '0.0000008', completion: '0.000004' }, capabilities: ['function_calling'] },
  // Pinned OpenRouter models that should always be present regardless of catalog state
  { id: 'google/gemini-2.0-flash', provider: 'openrouter', upstreamModel: 'google/gemini-2.0-flash', ownedBy: 'google', contextLength: 1048576, pricing: { prompt: '0.0000001', completion: '0.0000004' }, capabilities: ['vision', 'function_calling'] },
  { id: 'meta-llama/llama-3.1-70b-instruct', provider: 'openrouter', upstreamModel: 'meta-llama/llama-3.1-70b-instruct', ownedBy: 'meta-llama', contextLength: 128000, pricing: { prompt: '0.000000059', completion: '0.000000079' }, capabilities: ['function_calling'] },
];

const keyWindow = new Map<string, { windowStartMs: number; count: number }>();
const RATE_WINDOW_MS = 60 * 1000;
const OPENROUTER_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
const STREAM_CHUNK_SIZE = 80;
const MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_MAX_KEY_LENGTH = 128;
const IDEMPOTENCY_MAX_CACHE_ENTRIES = 5000;

const gatewayUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AUDIO_UPLOAD_BYTES,
  },
});

const transcriptionUploadMiddleware = (req: Request, res: Response, next: express.NextFunction) => {
  gatewayUpload.single('file')(req, res, (err: any) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: {
            message: `Audio file too large. Max upload size is ${Math.floor(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024))}MB.`,
            type: 'invalid_request_error',
          },
        });
        return;
      }

      res.status(400).json({
        error: {
          message: `Multipart upload error: ${err.message}`,
          type: 'invalid_request_error',
        },
      });
      return;
    }

    res.status(400).json({
      error: {
        message: 'Invalid multipart payload for audio transcription.',
        type: 'invalid_request_error',
      },
    });
  });
};

const lastUserMessage = (messages: Array<{ role: string; content: string }>) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === 'user' && typeof msg.content === 'string' && msg.content.trim()) {
      return msg.content.trim();
    }
  }
  return '';
};

const maybeCreateIncidentFromCompletion = async (params: {
  orgId: string;
  agentId: string;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  completion: { content: string };
  requestId?: string;
}) => {
  try {
    const scanResults = incidentDetection.fullScan(params.completion.content || '');
    // Also scan the user's last message for data extraction attempts (fires even when agent refuses)
    const userMsg = lastUserMessage(params.messages) || '';
    const userScanResults = [incidentDetection.detectDataExtractionAttempt(userMsg)].filter(r => r.detected);
    const allResults = [...scanResults, ...userScanResults];
    const highest = incidentDetection.getHighestSeverity(allResults);
    if (!highest || (highest.severity !== 'critical' && highest.severity !== 'high')) return;

    const trigger = lastUserMessage(params.messages);
    const title = `${String(highest.type || 'incident').replace(/_/g, ' ').toUpperCase()} Detected`;

    // Auto-suppress: skip if >5 false positives for this type in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const fpRows = await supabaseRest(
        'incidents',
        `select=id&organization_id=eq.${params.orgId}&incident_type=eq.${highest.type}&status=eq.false_positive&created_at=gte.${thirtyDaysAgo}`
      ) as any[];
      if (Array.isArray(fpRows) && fpRows.length > 5) {
        logger.info('Gateway auto-suppressed incident (>5 FP in 30d)', { type: highest.type, orgId: params.orgId });
        return;
      }
    } catch { /* non-fatal — proceed with incident creation */ }

    const rows = await supabaseRest(
      'incidents',
      '',
      {
        method: 'POST',
        body: {
          organization_id: params.orgId,
          agent_id: params.agentId,
          incident_type: highest.type,
          severity: highest.severity,
          title,
          description: highest.details,
          trigger_content: trigger || undefined,
          ai_response: params.completion.content,
          status: 'open',
          confidence: highest.confidence,
        },
      }
    );

    const incident = Array.isArray(rows) ? rows[0] : null;
    if (incident) pushIncidentEvent(params.orgId, incident);
    logger.warn('Gateway incident created', {
      incident_id: incident?.id,
      orgId: params.orgId,
      agentId: params.agentId,
      incident_type: highest.type,
      severity: highest.severity,
      requestId: params.requestId,
      model: params.modelId,
    });

    fireAndForgetWebhookEvent(params.orgId, 'incident.created', {
      id: `evt_gateway_detect_${incident?.id || crypto.randomUUID()}`,
      type: 'incident.created',
      created_at: new Date().toISOString(),
      organization_id: params.orgId,
      data: {
        incident_id: incident?.id,
        agent_id: params.agentId,
        severity: highest.severity,
        incident_type: highest.type,
        title,
        description: highest.details,
      },
    });

    void notifySlackIncident(params.orgId, {
      incidentId: incident?.id,
      title,
      severity: highest.severity,
      incidentType: highest.type || 'unknown',
      agentId: params.agentId,
      description: highest.details,
      confidence: highest.confidence,
    });

    if (incident) {
      void notifyAlertChannels(params.orgId, {
        incidentId: incident.id,
        title,
        severity: highest.severity as any,
        incidentType: highest.type || 'unknown',
        agentId: params.agentId || undefined,
        description: highest.details,
        dashboardUrl: buildFrontendUrl('/dashboard/incidents'),
      });

      firePlaybookTriggers(params.orgId, 'incident.created', {
        incident_id: incident.id,
        agent_id: params.agentId,
        severity: highest.severity,
        incident_type: highest.type,
        title,
        description: highest.details,
      });
    }
  } catch (error: any) {
    logger.error('Gateway incident detection failed', {
      error: String(error?.message || error),
      requestId: params.requestId,
      orgId: params.orgId,
      agentId: params.agentId,
      model: params.modelId,
    });
  }
};

// ── Reasoning Trace Capture ───────────────────────────────────────────────────

interface CaptureTraceParams {
  orgId: string;
  agentId?: string | null;
  conversationId?: string | null;
  requestId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  toolCalls: Array<{ name: string; arguments: string; result?: string; latency_ms?: number }>;
  interceptorsApplied: string[];
  responseContent: string;
  policyViolations?: Array<{ policy_id?: string; policy_name: string; rule: string; action_taken: string }>;
}

const captureReasoningTrace = async (params: CaptureTraceParams): Promise<void> => {
  try {
    // Compute risk score from a quick incident scan
    const scanResults = incidentDetection.fullScan(params.responseContent || '');
    const highest = incidentDetection.getHighestSeverity(scanResults);
    const riskScore = highest ? highest.confidence : null;

    // Shannon entropy of response text (higher = more unpredictable/random output)
    const responseEntropy = computeEntropy(params.responseContent || '');

    await supabaseRest('gateway_reasoning_traces', '', {
      method: 'POST',
      body: {
        organization_id: params.orgId,
        agent_id: params.agentId ?? null,
        conversation_id: params.conversationId ?? null,
        request_id: params.requestId ?? null,
        model: params.model,
        input_tokens: params.inputTokens,
        output_tokens: params.outputTokens,
        latency_ms: params.latencyMs,
        tool_calls: params.toolCalls,
        interceptors_applied: params.interceptorsApplied,
        risk_score: riskScore,
        response_entropy: responseEntropy,
        policy_violations: params.policyViolations ?? [],
      },
    });
  } catch (err: any) {
    // Non-fatal — never block the response for trace capture failures
    logger.debug('captureReasoningTrace failed (non-fatal)', { err: err?.message, orgId: params.orgId });
  }
};

// Extended cache also stores per-model pricing from OpenRouter for accurate cost estimation
let openRouterModelsCache: {
  expiresAt: number;
  models: GatewayModel[];
  pricingMap: Record<string, { input: number; output: number }>;
} = {
  expiresAt: 0,
  models: [],
  pricingMap: {},
};

type IdempotencyCompletedEntry = {
  type: 'completed';
  fingerprint: string;
  status: number;
  contentType: 'json' | 'text';
  payload: any;
  createdAt: number;
};

type IdempotencyPendingEntry = {
  type: 'pending';
  fingerprint: string;
  createdAt: number;
};

type IdempotencyEntry = IdempotencyCompletedEntry | IdempotencyPendingEntry;

interface DbIdempotencyRow {
  id: string;
  organization_id: string;
  api_key_id: string;
  route_path: string;
  idempotency_key: string;
  request_fingerprint: string;
  status: 'pending' | 'completed' | string;
  http_status: number | null;
  content_type: 'json' | 'text' | null;
  response_payload: any | null;
  response_text: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string;
  last_seen_at: string | null;
}

const idempotencyCache = new Map<string, IdempotencyEntry>();
const IDEMPOTENCY_TABLE = 'gateway_idempotency_keys';

const getProviderKey = (provider: 'openai' | 'anthropic' | 'openrouter'): string | null => {
  if (provider === 'openai') {
    return process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY || null;
  }

  if (provider === 'openrouter') {
    return process.env.RASI_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || null;
  }

  // Accept legacy/mistyped env var names for resilience in hosted deployments.
  return (
    process.env.RASI_ANTHROPIC_API_KEY ||
    process.env.RASI_ANTHROPIC_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_KEY ||
    null
  );
};

const normalizeModel = (model: string): GatewayModel | null => {
  const exact = GATEWAY_MODELS.find((m) => m.id === model || m.upstreamModel === model);
  if (exact) return exact;

  if (model.startsWith('openai/')) {
    const upstream = model.slice('openai/'.length);
    return { id: model, provider: 'openai', upstreamModel: upstream, ownedBy: 'openai' };
  }

  if (model.startsWith('anthropic/') || model.startsWith('claude-')) {
    const upstream = model.startsWith('anthropic/') ? model.slice('anthropic/'.length) : model;
    // Normalize legacy Anthropic IDs so older saved agents still route to
    // currently-supported models without requiring manual edits.
    const normalizedUpstream = ANTHROPIC_MODEL_ALIASES[upstream] || upstream;
    const id = `anthropic/${normalizedUpstream}`;
    const known = GATEWAY_MODELS.find((m) => m.id === id);
    if (known) return known;
    return { id, provider: 'anthropic', upstreamModel: normalizedUpstream, ownedBy: 'anthropic' };
  }

  if (model.startsWith('openrouter/')) {
    const upstream = model.slice('openrouter/'.length);
    return { id: model, provider: 'openrouter', upstreamModel: upstream, ownedBy: 'openrouter' };
  }

  // Local/Ollama models — route to OLLAMA_BASE_URL (e.g. http://localhost:11434)
  if (model.startsWith('local/')) {
    const upstream = model.slice('local/'.length);
    return { id: model, provider: 'openai', upstreamModel: upstream, ownedBy: 'local' };
  }

  // Any provider-style model (e.g. google/gemini-2.0-flash) can route via OpenRouter.
  if (model.includes('/')) {
    return { id: model, provider: 'openrouter', upstreamModel: model, ownedBy: model.split('/')[0] || 'openrouter' };
  }

  // Bare OpenAI model names without a provider prefix (e.g. "gpt-4o", "o3-mini").
  if (
    model.startsWith('gpt-') ||
    model.startsWith('o1') ||
    model.startsWith('o3') ||
    model.startsWith('o4') ||
    model.startsWith('text-embedding-') ||
    model.startsWith('dall-e-')
  ) {
    return { id: `openai/${model}`, provider: 'openai', upstreamModel: model, ownedBy: 'openai' };
  }

  // Catch-all: route any remaining bare model name via OpenRouter, which supports 340+ models
  // (Gemini, Llama, Mistral, Cohere, Command, Qwen, DeepSeek, etc.).
  return { id: model, provider: 'openrouter', upstreamModel: model, ownedBy: 'openrouter' };
};

const mergeModels = (base: GatewayModel[], extra: GatewayModel[]): GatewayModel[] => {
  const map = new Map<string, GatewayModel>();

  for (const model of base) {
    map.set(model.id, model);
  }

  for (const model of extra) {
    if (!map.has(model.id)) {
      map.set(model.id, model);
    }
  }

  return Array.from(map.values());
};

const fetchOpenRouterModels = async (): Promise<GatewayModel[]> => {
  const key = getProviderKey('openrouter');
  if (!key) {
    return [];
  }

  if (Date.now() < openRouterModelsCache.expiresAt) {
    return openRouterModelsCache.models;
  }

  const response = await fetch('https://openrouter.ai/api/v1/models', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI model catalog fetch failed: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
      architecture?: { modality?: string };
    }>;
  };

  const pricingMap: Record<string, { input: number; output: number }> = {};
  const models = (payload.data || [])
    .filter((m) => typeof m.id === 'string' && m.id.includes('/'))
    .map((m) => {
      const inputPrice = parseFloat(m.pricing?.prompt || '0') * 1_000_000;
      const outputPrice = parseFloat(m.pricing?.completion || '0') * 1_000_000;
      if (inputPrice > 0 || outputPrice > 0) {
        pricingMap[m.id] = { input: inputPrice, output: outputPrice };
      }
      const modality = m.architecture?.modality || '';
      const capabilities: string[] = [];
      if (modality.includes('image')) capabilities.push('vision');
      if (modality.includes('audio')) capabilities.push('audio');
      return {
        id: m.id,
        provider: 'openrouter' as const,
        upstreamModel: m.id,
        ownedBy: m.id.split('/')[0] || 'rasi-ai',
        contextLength: m.context_length,
        pricing: m.pricing
          ? { prompt: m.pricing.prompt || '0', completion: m.pricing.completion || '0' }
          : undefined,
        capabilities,
      };
    });

  openRouterModelsCache = {
    expiresAt: Date.now() + OPENROUTER_MODELS_CACHE_TTL_MS,
    models,
    pricingMap,
  };

  return models;
};

// Pricing per 1M tokens for models routed via OpenRouter (provider/model format)
const OPENROUTER_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  'openai/gpt-4o': { input: 5, output: 15 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/gpt-4-turbo': { input: 10, output: 30 },
  'openai/gpt-4': { input: 30, output: 60 },
  'openai/gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'openai/gpt-5.4': { input: 5, output: 15 }, // approximate — no official price yet
  // Anthropic
  'anthropic/claude-sonnet-4-6': { input: 3, output: 15 },
  'anthropic/claude-haiku-4-5': { input: 0.8, output: 4 },
  // Legacy Anthropic IDs (backwards compat)
  'anthropic/claude-3-5-sonnet': { input: 3, output: 15 },
  'anthropic/claude-3-opus': { input: 15, output: 75 },
  'anthropic/claude-3-haiku': { input: 0.8, output: 4 },
  // Google
  'google/gemini-pro': { input: 0.5, output: 1.5 },
  'google/gemini-flash': { input: 0.075, output: 0.3 },
  // Meta
  'meta-llama/llama-3-70b-instruct': { input: 0.59, output: 0.79 },
  'meta-llama/llama-3-8b-instruct': { input: 0.07, output: 0.07 },
  // DeepSeek
  'deepseek/deepseek-r1': { input: 0.55, output: 2.19 },
  'deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
  // AI21
  'ai21/jamba-large-1.7': { input: 2, output: 8 },
  'ai21/jamba-mini': { input: 0.2, output: 0.4 },
};

const estimateOpenRouterCost = (model: string, inputTokens: number, outputTokens: number): number => {
  // 1. Live pricing from OpenRouter catalog (most accurate, refreshed every 5 min)
  const livePricing = openRouterModelsCache.pricingMap[model]
    ?? Object.entries(openRouterModelsCache.pricingMap).find(([k]) => model.startsWith(k))?.[1];
  if (livePricing) {
    return ((inputTokens * livePricing.input) + (outputTokens * livePricing.output)) / 1_000_000;
  }
  // 2. Hardcoded fallback table for well-known models (covers cold-start / no-key scenarios)
  const pricing = OPENROUTER_PRICING[model]
    ?? Object.entries(OPENROUTER_PRICING).find(([k]) => model.startsWith(k))?.[1]
    ?? { input: 1, output: 3 }; // conservative default ~gpt-4 class
  return ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1_000_000;
};

const routeViaOpenRouter = async (
  model: string,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<{ content: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; costUSD: number; latency: number }> => {
  const key = getProviderKey('openrouter');
  if (!key) {
    throw new Error('AI gateway provider key missing');
  }

  const startTime = Date.now();

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:5173',
      'X-Title': 'Zapheit Gateway',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
      ...(typeof options.maxTokens === 'number' ? { max_tokens: options.maxTokens } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI completion failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as any;
  const latency = Date.now() - startTime;

  const inputTokens = data?.usage?.prompt_tokens || 0;
  const outputTokens = data?.usage?.completion_tokens || 0;
  const totalTokens = data?.usage?.total_tokens || (inputTokens + outputTokens);
  // OpenRouter doesn't return cost in usage — compute from our pricing table
  const costUSD = Number(data?.usage?.cost || 0) || estimateOpenRouterCost(model, inputTokens, outputTokens);

  return {
    content: data?.choices?.[0]?.message?.content || '',
    model: data?.model || model,
    inputTokens,
    outputTokens,
    totalTokens,
    costUSD,
    latency,
  };
};

/** Route a request to a local Ollama instance (OpenAI-compatible API). */
const routeViaOllama = async (
  model: string,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<{ content: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; costUSD: number; latency: number }> => {
  const ollamaBase = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
  const startTime = Date.now();

  const response = await fetch(`${ollamaBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ollama' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
      ...(typeof options.maxTokens === 'number' ? { max_tokens: options.maxTokens } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama completion failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as any;
  const latency = Date.now() - startTime;
  const inputTokens = data?.usage?.prompt_tokens || 0;
  const outputTokens = data?.usage?.completion_tokens || 0;
  return {
    content: data?.choices?.[0]?.message?.content || '',
    model: data?.model || model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUSD: 0, // local — no cost
    latency,
  };
};


// ─── Connector Tool Injection ─────────────────────────────────────────────────

const MAX_TOOL_LOOPS = 5;

type CredentialMap = Record<string, string>;

interface McpServerEntry { id: string; url: string; authToken?: string }
interface AgentToolContext {
  tools: ConnectorTool[];
  /** Map of connectorId → decrypted credentials for that connector */
  credentialsByConnector: Record<string, CredentialMap>;
  /** MCP servers indexed by tool prefix `mcp__{server_id}` */
  mcpServers?: Record<string, McpServerEntry>;
}

// 60-second in-memory cache for agent tool contexts, keyed by `orgId:agentId`.
// Avoids repeated DB reads on every message in a multi-turn conversation.
const agentToolCache = new Map<string, { ctx: AgentToolContext; expiresAt: number }>();
const AGENT_TOOL_CACHE_TTL_MS = 60_000;

/**
 * OAuth token refresh: if an OAuth connector's access_token is within 5 minutes
 * of expiry (or already expired), delegate to the provider adapter's refreshToken
 * method and persist the updated credentials back to `integration_credentials`.
 *
 * Returns the (possibly updated) credential map — original creds on any failure.
 */
async function refreshOAuthIfNeeded(
  connectorId: string,
  integrationId: string,
  creds: CredentialMap,
): Promise<CredentialMap> {
  if (!creds.refresh_token || !creds.expires_at) return creds;
  const expiresAt = new Date(creds.expires_at).getTime();
  if (expiresAt > Date.now() + 5 * 60_000) return creds; // still valid for 5+ minutes

  const adapter = getAdapter(connectorId);
  if (!adapter?.refreshToken) return creds; // adapter doesn't support refresh

  try {
    const token = await adapter.refreshToken(creds);
    if (!token?.access_token) return creds;

    const newExpiry = token.expires_in
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : new Date(Date.now() + 3600_000).toISOString();

    const updates: Record<string, string> = {
      access_token: String(token.access_token),
      expires_at: newExpiry,
      ...(token.refresh_token ? { refresh_token: String(token.refresh_token) } : {}),
    };

    // Persist each updated credential back to DB (PATCH by integration_id + key)
    for (const [key, value] of Object.entries(updates)) {
      const q = new URLSearchParams();
      q.set('integration_id', eq(integrationId));
      q.set('key', eq(key));
      await supabaseRest('integration_credentials', q, {
        method: 'PATCH',
        body: { value: encryptSecret(value) },
      }).catch((e) => logger.warn('Failed to persist refreshed credential', { connectorId, key, error: e?.message }));
    }

    logger.info('OAuth token refreshed', { connectorId, newExpiry });
    return { ...creds, ...updates };
  } catch (err: any) {
    logger.warn('OAuth token refresh error', { connectorId, error: err?.message });
    return creds;
  }
}

/**
 * Load the tools available to an agent based on its linked connector IDs.
 * Results are cached for 60 seconds per (orgId, agentId) pair to avoid
 * repeated DB round-trips on every message in a conversation.
 */
const loadAgentTools = async (agentId: string, orgId: string): Promise<AgentToolContext> => {
  // Cache hit
  const cacheKey = `${orgId}:${agentId}`;
  const hit = agentToolCache.get(cacheKey);
  if (hit && Date.now() < hit.expiresAt) return hit.ctx;

  const empty: AgentToolContext = { tools: [], credentialsByConnector: {} };
  try {
    // 1. Load agent metadata to read integration_ids
    const agentQuery = new URLSearchParams();
    agentQuery.set('id', eq(agentId));
    agentQuery.set('organization_id', eq(orgId));
    const agents = await supabaseRest('ai_agents', agentQuery) as any[];
    if (!agents || agents.length === 0) return empty;

    const publish = agents[0]?.metadata?.publish;
    const integrationIds: string[] = Array.isArray(publish?.integration_ids)
      ? publish.integration_ids.filter((id: any) => typeof id === 'string')
      : [];
    if (integrationIds.length === 0) return empty;

    // 2. Filter to connectors that have an ACTION_REGISTRY entry
    const actionableIds = integrationIds.filter((id) => !!ACTION_REGISTRY[id]);
    if (actionableIds.length === 0) return empty;

    // 3. Load connected integrations from DB for this org
    const intQuery = new URLSearchParams();
    intQuery.set('organization_id', eq(orgId));
    intQuery.set('status', eq('connected'));
    const allIntegrations = await supabaseRest('integrations', intQuery) as any[];
    const connectedServiceTypes = new Set(
      (allIntegrations || []).map((i: any) => i.service_type).filter(Boolean)
    );

    // 4. Intersect with actionable IDs that are actually connected
    const connectedActionable = actionableIds.filter((id) => connectedServiceTypes.has(id));
    if (connectedActionable.length === 0) return empty;

    // 5. For each connected connector, load + decrypt credentials, then refresh
    //    OAuth tokens that are near-expiry before they are used in tool calls.
    const credentialsByConnector: Record<string, CredentialMap> = {};
    for (const connectorId of connectedActionable) {
      const integration = (allIntegrations || []).find((i: any) => i.service_type === connectorId);
      if (!integration?.id) continue;

      const credQuery = new URLSearchParams();
      credQuery.set('integration_id', eq(integration.id));
      const credRows = await supabaseRest('integration_credentials', credQuery) as Array<{ key: string; value: string }>;
      let creds: CredentialMap = {};
      for (const row of credRows || []) {
        try { creds[row.key] = decryptSecret(row.value); } catch { creds[row.key] = row.value; }
      }

      // Refresh OAuth token if near-expiry (modifies creds + updates DB)
      creds = await refreshOAuthIfNeeded(connectorId, integration.id, creds);

      credentialsByConnector[connectorId] = creds;
    }

    // 6. Build the merged tools array from the ACTION_REGISTRY
    const tools: ConnectorTool[] = connectedActionable.flatMap(
      (id) => (ACTION_REGISTRY[id] as any)?.tools || []
    );

    // 7. Load MCP server tools from organizations.settings.mcp_servers
    const mcpServers: Record<string, McpServerEntry> = {};
    try {
      const orgQ = new URLSearchParams();
      orgQ.set('id', eq(orgId));
      orgQ.set('select', 'settings');
      const orgRows = await supabaseRest('organizations', orgQ) as any[];
      const mcpList: any[] = orgRows?.[0]?.settings?.mcp_servers || [];
      for (const srv of mcpList) {
        if (!srv?.id || !srv?.url) continue;
        const authToken = srv.auth_token_encrypted ? (() => { try { return decryptSecret(srv.auth_token_encrypted); } catch { return ''; } })() : '';
        try {
          const manifestRes = await fetch(`${srv.url}/tools/list`, {
            headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(5000),
          });
          if (!manifestRes.ok) continue;
          const manifest = await manifestRes.json().catch(() => null);
          const serverTools: any[] = (manifest as any)?.tools || [];
          for (const t of serverTools) {
            if (!t?.name) continue;
            tools.push({
              name: `mcp__${srv.id}__${t.name}`,
              description: t.description || `MCP tool: ${t.name}`,
              inputSchema: t.inputSchema || { type: 'object', properties: {} },
            } as unknown as ConnectorTool);
          }
          mcpServers[`mcp__${srv.id}`] = { id: srv.id, url: srv.url, authToken };
          logger.info('MCP server tools loaded', { serverId: srv.id, count: serverTools.length });
        } catch (mcpErr: any) {
          logger.warn('MCP server tool fetch failed', { serverId: srv.id, error: mcpErr?.message });
        }
      }
    } catch (mcpLoadErr: any) {
      logger.warn('MCP server registry load failed', { error: mcpLoadErr?.message });
    }

    const ctx: AgentToolContext = { tools, credentialsByConnector, mcpServers };
    agentToolCache.set(cacheKey, { ctx, expiresAt: Date.now() + AGENT_TOOL_CACHE_TTL_MS });
    return ctx;
  } catch (err) {
    logger.warn('loadAgentTools failed — continuing without tools', { error: (err as any)?.message, agentId });
    return empty;
  }
};

/**
 * Execute a single tool call and return the result as a stringified JSON content.
 */
const executeSingleToolCall = async (
  tc: ToolCall,
  credentialsByConnector: Record<string, CredentialMap>,
  orgId: string,
  agentId: string | null,
  mcpServers?: Record<string, McpServerEntry>,
): Promise<string> => {
  // MCP tool dispatch — prefix `mcp__{server_id}__{tool_name}`
  if (tc.function.name.startsWith('mcp__')) {
    const parts = tc.function.name.split('__');
    const serverId = parts[1];
    const toolName = parts.slice(2).join('__');
    const srv = mcpServers?.[`mcp__${serverId}`];
    if (!srv) return JSON.stringify({ error: `MCP server '${serverId}' not found` });
    let mcpParams: Record<string, any> = {};
    try { mcpParams = JSON.parse(tc.function.arguments); } catch { /* use empty */ }
    try {
      const mcpRes = await fetch(`${srv.url}/tools/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(srv.authToken ? { Authorization: `Bearer ${srv.authToken}` } : {}),
        },
        body: JSON.stringify({ name: toolName, arguments: mcpParams }),
        signal: AbortSignal.timeout(30_000),
      });
      const mcpData = await mcpRes.json().catch(() => ({ error: 'Invalid JSON from MCP server' }));
      logger.info('MCP tool executed', { serverId, toolName, status: mcpRes.status });
      return JSON.stringify(mcpData);
    } catch (err: any) {
      logger.warn('MCP tool call failed', { serverId, toolName, error: err?.message });
      return JSON.stringify({ error: err?.message || 'MCP call failed' });
    }
  }

  const [connectorId, action] = tc.function.name.split('__');
  let params: Record<string, any> = {};
  try { params = JSON.parse(tc.function.arguments); } catch { /* use empty */ }

  // Pre-Flight Gate: policy check, DLP scan, blast-radius limit.
  const preflight = await runPreflightGate(orgId, connectorId, action, params, agentId);
  if (!preflight.allowed) {
    let approvalId: string | null = null;
    if (preflight.approvalRequired && preflight.approvalData) {
      const ad = preflight.approvalData;
      const approvalRows = await supabaseRest('approval_requests', '', {
        method: 'POST',
        body: {
          organization_id: orgId,
          service: ad.service,
          action: ad.action,
          action_payload: ad.action_payload,
          requested_by: 'agent',
          required_role: ad.required_role,
          ...(ad.action_policy_id ? { action_policy_id: ad.action_policy_id } : {}),
          ...(ad.agent_id ? { agent_id: ad.agent_id } : {}),
          expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          sla_deadline: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
          status: 'pending',
        },
      }).catch(() => []);
      approvalId = Array.isArray(approvalRows) ? approvalRows?.[0]?.id || null : null;
    }
    if (agentId) {
      supabaseRest('connector_action_executions', '', {
        method: 'POST',
        body: {
          organization_id: orgId,
          agent_id: agentId,
          connector_id: connectorId,
          action,
          params,
          result: { blocked: true, reason: preflight.blockReason },
          success: false,
          error_message: preflight.blockReason,
          approval_required: Boolean(preflight.approvalRequired),
          approval_id: approvalId,
          policy_snapshot: buildGovernedActionSnapshot({
            source: 'gateway',
            service: connectorId,
            action,
            recordedAt: new Date().toISOString(),
            decision: preflight.approvalRequired ? 'pending_approval' : 'blocked',
            result: preflight.approvalRequired ? 'pending' : 'blocked',
            approvalRequired: Boolean(preflight.approvalRequired),
            approvalId,
            requiredRole: preflight.approvalData?.required_role || null,
            blockReasons: [preflight.blockReason],
            approvalReasons: preflight.approvalRequired ? [preflight.blockReason] : [],
            agentId,
            auditRef: preflight.auditRef,
            requestedBy: 'agent',
            existingSnapshot: {
              reason_category: preflight.reasonCategory,
              reason_message: preflight.reasonMessage,
              recommended_next_action: preflight.recommendedNextAction,
              policy_gate: preflight.policySnapshot,
              budget_gate: preflight.budgetSnapshot,
              dlp_gate: preflight.dlpSnapshot,
            },
          }),
          remediation: preflight.approvalRequired
            ? { suggested: 'Review and approve the action before retrying.' }
            : { suggested: 'Update the payload, policy, or connector permissions before retrying.' },
        },
      }).catch(() => {/* non-critical */});
    }
    void appendAuditChainEvent({
      organization_id: orgId,
      event_type: 'governed_action.blocked',
      entity_type: 'connector_action',
      entity_id: `${connectorId}:${action}`,
      payload: {
        decision: preflight.decision,
        reason_category: preflight.reasonCategory,
        reason_message: preflight.reasonMessage,
        approval_required: Boolean(preflight.approvalRequired),
        audit_ref: preflight.auditRef,
      },
    });
    return JSON.stringify({
      blocked: true,
      decision: preflight.decision,
      reason_category: preflight.reasonCategory,
      reason_message: preflight.reasonMessage,
      recommended_next_action: preflight.recommendedNextAction,
      audit_ref: preflight.auditRef,
      reason: preflight.blockReason,
      approvalRequired: Boolean(preflight.approvalRequired),
      approvalId,
      action: tc.function.name,
    });
  }

  const credentials = credentialsByConnector[connectorId] || {};
  const result = await executeConnectorAction(connectorId, action, params, credentials, orgId, agentId);

  // Log the execution (non-critical)
  if (agentId) {
    supabaseRest('connector_action_executions', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        agent_id: agentId,
        connector_id: connectorId,
        action,
        params,
        result: result.data || result.error || {},
        success: result.success,
        error_message: result.error || null,
        ...(result.idempotencyKey ? { idempotency_key: result.idempotencyKey } : {}),
        policy_snapshot: buildGovernedActionSnapshot({
          source: 'gateway',
          service: connectorId,
          action,
          recordedAt: new Date().toISOString(),
          decision: 'executed',
          result: result.success ? 'succeeded' : 'failed',
          idempotencyKey: result.idempotencyKey || null,
          agentId,
          requestedBy: 'agent',
          delegatedActor: 'agent',
          auditRef: `exec_${crypto.randomUUID()}`,
        }),
        remediation: result.success ? {} : { suggested: 'Check connector state, credentials, and downstream provider health.' },
      },
    }).catch(() => {/* non-critical */});
  }
  void appendAuditChainEvent({
    organization_id: orgId,
    event_type: result.success ? 'governed_action.executed' : 'governed_action.failed',
    entity_type: 'connector_action',
    entity_id: `${connectorId}:${action}`,
    payload: {
      success: result.success,
      status_code: result.statusCode || null,
      idempotency_key: result.idempotencyKey || null,
      agent_id: agentId,
    },
  });

  return JSON.stringify(result);
};

const enforceApiKeyRateLimit = async (req: Request, res: Response): Promise<boolean> => {
  if (!req.apiKey) {
    res.status(401).json({ error: { message: 'Missing API key context', type: 'auth_error' } });
    return false;
  }

  const keyId = req.apiKey.id;
  const now = Date.now();
  const current = keyWindow.get(keyId);

  if (!current || now - current.windowStartMs >= RATE_WINDOW_MS) {
    keyWindow.set(keyId, { windowStartMs: now, count: 1 });
    return true;
  }

  if (current.count >= req.apiKey.rate_limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil(((current.windowStartMs + RATE_WINDOW_MS) - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));

    fireAndForgetWebhookEvent(req.apiKey.organization_id, 'rate_limit.exceeded', {
      id: `evt_rate_limit_${crypto.randomUUID()}`,
      type: 'rate_limit.exceeded',
      created_at: new Date().toISOString(),
      organization_id: req.apiKey.organization_id,
      data: {
        api_key_id: req.apiKey.id,
        scope: 'api_key',
        allowed: req.apiKey.rate_limit,
        observed: current.count,
        window: '1m',
        retry_after_seconds: retryAfterSeconds,
      },
    });

    res.status(429).json({
      error: {
        message: 'Rate limit exceeded for this API key',
        type: 'rate_limit_error',
      },
    });
    return false;
  }

  current.count += 1;
  keyWindow.set(keyId, current);
  return true;
};

// Monthly request quotas per plan. -1 = unlimited.
const PLAN_MONTHLY_QUOTAS: Record<string, number> = {
  free: 10_000,
  audit: 50_000,
  retainer: 200_000,
  enterprise: -1,
};

const getCurrentMonth = () => new Date().toISOString().slice(0, 7); // 'YYYY-MM'

const enforceOrgMonthlyQuota = async (req: Request, res: Response): Promise<boolean> => {
  if (!req.apiKey) return true; // already caught by validateApiKey

  const orgId = req.apiKey.organization_id;
  const month = getCurrentMonth();

  try {
    const orgRows = await supabaseRest('organizations', `id=eq.${orgId}&select=plan,settings`, { method: 'GET' });
    const org = Array.isArray(orgRows) ? orgRows[0] : null;
    const plan = String(org?.plan || 'free').toLowerCase();
    const quota = PLAN_MONTHLY_QUOTAS[plan] ?? PLAN_MONTHLY_QUOTAS.free;

    if (quota === -1) return true;

    const usageRows = await supabaseRest('gateway_usage', `org_id=eq.${orgId}&month=eq.${month}`, { method: 'GET' });
    const usage = Array.isArray(usageRows) ? usageRows[0] : null;
    const currentCount: number = usage?.request_count ?? 0;

    if (currentCount >= quota) {
      res.status(429).json({
        error: {
          message: `Monthly gateway quota of ${quota.toLocaleString()} requests exceeded for your plan (${plan}). Upgrade to continue.`,
          type: 'rate_limit_error',
          code: 'monthly_quota_exceeded',
          plan,
          quota,
          used: currentCount,
        },
      });
      return false;
    }

    // Fire quota warning webhook + email at 80% threshold (once per crossing)
    const newCount = currentCount + 1;
    const percentUsed = Math.floor((newCount / quota) * 100);
    const wasBelow80 = Math.floor((currentCount / quota) * 100) < 80;
    if (percentUsed >= 80 && wasBelow80) {
      fireAndForgetWebhookEvent(orgId, 'quota.warning', {
        id: `evt_quota_${orgId}_${month}`,
        type: 'quota.warning',
        created_at: new Date().toISOString(),
        organization_id: orgId,
        data: { plan, quota, used: newCount, percent_used: percentUsed, threshold_percent: 80 },
      });

      // Send email alert — fire-and-forget
      const alertTo: string = org?.settings?.incident_email_recipient || process.env.ALERT_EMAIL_TO || '';
      if (alertTo) {
        const remaining = quota - newCount;
        sendTransactionalEmail({
          to: alertTo,
          subject: `[Zapheit] Gateway quota warning — ${percentUsed}% used this month`,
          html: `
            <p>Hi,</p>
            <p>Your Zapheit gateway has used <strong>${percentUsed}%</strong> of your monthly quota
            (${newCount.toLocaleString()} of ${quota.toLocaleString()} requests).</p>
            <p>You have <strong>${remaining.toLocaleString()} requests remaining</strong> for ${month}.
            Requests will be blocked when you reach 100%.</p>
            <p>Plan: <strong>${plan}</strong></p>
            <p>To increase your quota, reply to this email or visit your dashboard settings.</p>
            <br/>
            <p style="color:#64748b;font-size:12px">Zapheit · zapheit.com</p>
          `,
          text: `Zapheit quota warning: ${percentUsed}% used (${newCount.toLocaleString()}/${quota.toLocaleString()} requests). ${remaining.toLocaleString()} remaining for ${month}. Requests block at 100%.`,
        }).catch((err) => logger.warn('Quota warning email failed', { orgId, error: String(err?.message || err) }));
      }
    }

    // Increment usage fire-and-forget — don't block the request
    if (usage) {
      supabaseRest('gateway_usage', `org_id=eq.${orgId}&month=eq.${month}`, {
        method: 'PATCH',
        body: { request_count: newCount },
      }).catch(() => {});
    } else {
      supabaseRest('gateway_usage', '', {
        method: 'POST',
        body: { org_id: orgId, month, request_count: 1, quota },
      }).catch(() => {});
    }
  } catch (err: any) {
    // Non-blocking: if quota check fails, allow the request through
    logger.warn('Gateway monthly quota check failed (allowing request)', {
      orgId,
      error: String(err?.message || err),
    });
  }

  return true;
};

const buildIdempotencyFingerprint = (req: Request): string => {
  const sanitizedBody = { ...(req.body || {}) } as Record<string, any>;

  // Avoid storing/transmitting huge body payloads in cache while still differentiating requests.
  for (const key of ['file_base64', 'audio_base64', 'file']) {
    if (typeof sanitizedBody[key] === 'string') {
      sanitizedBody[key] = `__base64_length:${sanitizedBody[key].length}`;
    }
  }

  if (req.file) {
    sanitizedBody.__multipart_file = {
      size: req.file.size,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    };
  }

  const payload = JSON.stringify({
    method: req.method,
    path: req.path,
    query: req.query || {},
    body: sanitizedBody,
  });

  return crypto.createHash('sha256').update(payload).digest('hex');
};

const pruneIdempotencyCache = () => {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache.entries()) {
    if (now - entry.createdAt > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }

  if (idempotencyCache.size <= IDEMPOTENCY_MAX_CACHE_ENTRIES) {
    return;
  }

  const entriesByAge = Array.from(idempotencyCache.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
  const removeCount = idempotencyCache.size - IDEMPOTENCY_MAX_CACHE_ENTRIES;
  for (let i = 0; i < removeCount; i += 1) {
    idempotencyCache.delete(entriesByAge[i][0]);
  }
};

// Prune stale idempotency entries on a background interval instead of per-request
setInterval(pruneIdempotencyCache, 60_000).unref();

const pruneIdempotencyEntry = (cacheKey: string, entry: IdempotencyEntry) => {
  if (Date.now() - entry.createdAt > IDEMPOTENCY_TTL_MS) {
    idempotencyCache.delete(cacheKey);
    return true;
  }
  return false;
};

const buildIdempotencyLookupQuery = (apiKeyId: string, routePath: string, idempotencyKey: string) => {
  const query = new URLSearchParams();
  query.set('api_key_id', eq(apiKeyId));
  query.set('route_path', eq(routePath));
  query.set('idempotency_key', eq(idempotencyKey));
  query.set('limit', '1');
  return query;
};

const loadDbIdempotencyRecord = async (
  apiKeyId: string,
  routePath: string,
  idempotencyKey: string
): Promise<DbIdempotencyRow | null> => {
  const query = buildIdempotencyLookupQuery(apiKeyId, routePath, idempotencyKey);
  const rows = (await supabaseRest(IDEMPOTENCY_TABLE, query)) as DbIdempotencyRow[];
  return rows?.[0] || null;
};

const writeDbPendingIdempotencyRecord = async (params: {
  organizationId: string;
  apiKeyId: string;
  routePath: string;
  idempotencyKey: string;
  fingerprint: string;
}) => {
  await supabaseRest(IDEMPOTENCY_TABLE, '', {
    method: 'POST',
    body: {
      organization_id: params.organizationId,
      api_key_id: params.apiKeyId,
      route_path: params.routePath,
      idempotency_key: params.idempotencyKey,
      request_fingerprint: params.fingerprint,
      status: 'pending',
      expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
      last_seen_at: new Date().toISOString(),
    },
  });
};

const updateDbPendingLastSeen = async (rowId: string) => {
  const query = new URLSearchParams();
  query.set('id', eq(rowId));
  await supabaseRest(IDEMPOTENCY_TABLE, query, {
    method: 'PATCH',
    body: {
      last_seen_at: new Date().toISOString(),
    },
  });
};

const clearDbIdempotencyRecord = async (rowId: string) => {
  const query = new URLSearchParams();
  query.set('id', eq(rowId));
  await supabaseRest(IDEMPOTENCY_TABLE, query, {
    method: 'DELETE',
  });
};

const prepareIdempotency = async (
  req: Request,
  res: Response,
  options: { supportsStreaming: boolean }
): Promise<{ cacheKey?: string; dbRowId?: string; handled: boolean }> => {
  const rawKey = req.header('Idempotency-Key');
  if (!rawKey) {
    return { handled: false };
  }

  if (rawKey.length > IDEMPOTENCY_MAX_KEY_LENGTH) {
    res.status(400).json({
      error: {
        message: `Idempotency-Key too long (max ${IDEMPOTENCY_MAX_KEY_LENGTH} chars)`,
        type: 'invalid_request_error',
      },
    });
    return { handled: true };
  }

  const stream = Boolean(req.body?.stream);
  if (stream && !options.supportsStreaming) {
    res.status(400).json({
      error: {
        message: 'Idempotency-Key is not supported for this streaming route yet',
        type: 'invalid_request_error',
      },
    });
    return { handled: true };
  }

  const apiKeyId = req.apiKey?.id;
  const orgId = req.apiKey?.organization_id;
  if (!apiKeyId) {
    res.status(401).json({
      error: {
        message: 'Missing API key context for idempotency',
        type: 'auth_error',
      },
    });
    return { handled: true };
  }

  if (!orgId) {
    res.status(401).json({
      error: {
        message: 'Missing organization context for idempotency',
        type: 'auth_error',
      },
    });
    return { handled: true };
  }

  const cacheKey = `${apiKeyId}:${req.path}:${rawKey}`;
  const fingerprint = buildIdempotencyFingerprint(req);
  const existing = idempotencyCache.get(cacheKey);
  if (existing) {
    if (pruneIdempotencyEntry(cacheKey, existing)) {
      return { cacheKey, handled: false };
    }

    if (existing.fingerprint !== fingerprint) {
      res.status(409).json({
        error: {
          message: 'Idempotency-Key reuse with different request payload is not allowed',
          type: 'idempotency_error',
        },
      });
      return { handled: true };
    }

    if (existing.type === 'pending') {
      res.setHeader('Retry-After', '1');
      res.status(409).json({
        error: {
          message: 'A request with this Idempotency-Key is already in progress',
          type: 'idempotency_error',
        },
      });
      return { handled: true };
    }

    res.setHeader('Idempotent-Replayed', 'true');
    if (existing.contentType === 'text') {
      res.status(existing.status).type('text/plain').send(String(existing.payload));
    } else {
      res.status(existing.status).json(existing.payload);
    }
    return { handled: true };
  }

  try {
    const dbRecord = await loadDbIdempotencyRecord(apiKeyId, req.path, rawKey);
    if (dbRecord) {
      const expired = new Date(dbRecord.expires_at).getTime() <= Date.now();
      if (expired) {
        await clearDbIdempotencyRecord(dbRecord.id);
      } else {
        if (dbRecord.request_fingerprint !== fingerprint) {
          res.status(409).json({
            error: {
              message: 'Idempotency-Key reuse with different request payload is not allowed',
              type: 'idempotency_error',
            },
          });
          return { handled: true };
        }

        if (dbRecord.status === 'pending') {
          await updateDbPendingLastSeen(dbRecord.id);
          res.setHeader('Retry-After', '1');
          res.status(409).json({
            error: {
              message: 'A request with this Idempotency-Key is already in progress',
              type: 'idempotency_error',
            },
          });
          return { handled: true };
        }

        if (dbRecord.status === 'completed') {
          const status = dbRecord.http_status || 200;
          const contentType = (dbRecord.content_type || 'json') as 'json' | 'text';
          res.setHeader('Idempotent-Replayed', 'true');
          if (contentType === 'text') {
            res.status(status).type('text/plain').send(dbRecord.response_text || '');
          } else {
            res.status(status).json(dbRecord.response_payload || {});
          }

          idempotencyCache.set(cacheKey, {
            type: 'completed',
            fingerprint,
            status,
            contentType,
            payload: contentType === 'text' ? (dbRecord.response_text || '') : (dbRecord.response_payload || {}),
            createdAt: Date.now(),
          });

          return { handled: true };
        }
      }
    }

    await writeDbPendingIdempotencyRecord({
      organizationId: orgId,
      apiKeyId,
      routePath: req.path,
      idempotencyKey: rawKey,
      fingerprint,
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes('duplicate key value') || message.includes('23505')) {
      res.setHeader('Retry-After', '1');
      res.status(409).json({
        error: {
          message: 'A request with this Idempotency-Key already exists',
          type: 'idempotency_error',
        },
      });
      return { handled: true };
    }

    logger.error('Failed to prepare DB idempotency state', {
      error: message,
      requestId: req.requestId,
      apiKeyId,
    });
    res.status(500).json({
      error: {
        message: 'Failed to initialize idempotency state',
        type: 'server_error',
      },
    });
    return { handled: true };
  }

  idempotencyCache.set(cacheKey, {
    type: 'pending',
    fingerprint,
    createdAt: Date.now(),
  });

  const dbRecord = await loadDbIdempotencyRecord(apiKeyId, req.path, rawKey);
  return { cacheKey, dbRowId: dbRecord?.id, handled: false };
};

const completeIdempotency = async (
  cacheKey: string | undefined,
  dbRowId: string | undefined,
  entry: { status?: number; contentType: 'json' | 'text'; payload: any }
) => {
  if (!cacheKey) return;

  const existing = idempotencyCache.get(cacheKey);
  const fingerprint = existing?.fingerprint || '';

  idempotencyCache.set(cacheKey, {
    type: 'completed',
    fingerprint,
    status: entry.status || 200,
    contentType: entry.contentType,
    payload: entry.payload,
    createdAt: Date.now(),
  });

  if (!dbRowId) return;

  const query = new URLSearchParams();
  query.set('id', eq(dbRowId));
  await supabaseRest(IDEMPOTENCY_TABLE, query, {
    method: 'PATCH',
    body: {
      status: 'completed',
      http_status: entry.status || 200,
      content_type: entry.contentType,
      response_payload: entry.contentType === 'json' ? entry.payload : null,
      response_text: entry.contentType === 'text' ? String(entry.payload ?? '') : null,
      completed_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    },
  });
};

const failIdempotency = async (cacheKey: string | undefined, dbRowId?: string) => {
  if (!cacheKey) return;
  idempotencyCache.delete(cacheKey);

  if (!dbRowId) return;
  await clearDbIdempotencyRecord(dbRowId);
};

const streamCompletionResponse = (
  res: Response,
  params: { modelId: string; content: string; completionTokens: number }
) => {
  const completionId = `chatcmpl_${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const writeChunk = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Initial role delta
  writeChunk({
    id: completionId,
    object: 'chat.completion.chunk',
    created,
    model: params.modelId,
    choices: [
      {
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null,
      },
    ],
  });

  for (let i = 0; i < params.content.length; i += STREAM_CHUNK_SIZE) {
    const piece = params.content.slice(i, i + STREAM_CHUNK_SIZE);
    writeChunk({
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: params.modelId,
      choices: [
        {
          index: 0,
          delta: { content: piece },
          finish_reason: null,
        },
      ],
    });
  }

  // Final chunk with finish reason and usage
  writeChunk({
    id: completionId,
    object: 'chat.completion.chunk',
    created,
    model: params.modelId,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
      },
    ],
    usage: {
      completion_tokens: params.completionTokens,
    },
  });

  res.write('data: [DONE]\n\n');
  res.end();
};

const streamLegacyCompletionResponse = (
  res: Response,
  params: { modelId: string; text: string }
) => {
  const completionId = `cmpl_${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const writeChunk = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  for (let i = 0; i < params.text.length; i += STREAM_CHUNK_SIZE) {
    const piece = params.text.slice(i, i + STREAM_CHUNK_SIZE);
    writeChunk({
      id: completionId,
      object: 'text_completion',
      created,
      model: params.modelId,
      choices: [
        {
          index: 0,
          text: piece,
          finish_reason: null,
        },
      ],
    });
  }

  writeChunk({
    id: completionId,
    object: 'text_completion',
    created,
    model: params.modelId,
    choices: [
      {
        index: 0,
        text: '',
        finish_reason: 'stop',
      },
    ],
  });

  res.write('data: [DONE]\n\n');
  res.end();
};

const streamResponsesApiOutput = (
  res: Response,
  params: { modelId: string; text: string; responseId: string }
) => {
  const createdAt = Math.floor(Date.now() / 1000);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const writeEvent = (event: string, payload: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  writeEvent('response.created', {
    type: 'response.created',
    response: {
      id: params.responseId,
      object: 'response',
      created_at: createdAt,
      status: 'in_progress',
      model: params.modelId,
    },
  });

  for (let i = 0; i < params.text.length; i += STREAM_CHUNK_SIZE) {
    const piece = params.text.slice(i, i + STREAM_CHUNK_SIZE);
    writeEvent('response.output_text.delta', {
      type: 'response.output_text.delta',
      response_id: params.responseId,
      delta: piece,
    });
  }

  writeEvent('response.completed', {
    type: 'response.completed',
    response: {
      id: params.responseId,
      object: 'response',
      created_at: createdAt,
      status: 'completed',
      model: params.modelId,
      output_text: params.text,
    },
  });

  res.write('data: [DONE]\n\n');
  res.end();
};

const createSimpleEmbedding = (text: string, dimensions = 1536): number[] => {
  const vector = new Array(dimensions).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    vector[i % dimensions] += (code % 97) / 97;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + (v * v), 0)) || 1;
  return vector.map((v) => v / magnitude);
};

const fetchOpenAIEmbeddings = async (
  apiKey: string,
  model: string,
  input: string[]
): Promise<{ embeddings: number[][]; promptTokens: number; totalTokens: number }> => {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI embeddings failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as any;
  const embeddings = (data?.data || []).map((item: any) => item.embedding as number[]);
  const promptTokens = data?.usage?.prompt_tokens || 0;
  const totalTokens = data?.usage?.total_tokens || promptTokens;

  return { embeddings, promptTokens, totalTokens };
};

const fetchOpenRouterEmbeddings = async (
  apiKey: string,
  model: string,
  input: string[]
): Promise<{ embeddings: number[][]; promptTokens: number; totalTokens: number }> => {
  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:5173',
      'X-Title': 'Zapheit Gateway',
    },
    body: JSON.stringify({ model, input }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI embeddings request failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as any;
  const embeddings = (data?.data || []).map((item: any) => item.embedding as number[]);
  const promptTokens = data?.usage?.prompt_tokens || 0;
  const totalTokens = data?.usage?.total_tokens || promptTokens;

  return { embeddings, promptTokens, totalTokens };
};

const normalizeBase64Audio = (value: string): Buffer => {
  const base64Payload = value.includes('base64,') ? value.split('base64,')[1] : value;
  return Buffer.from(base64Payload, 'base64');
};

const transcribeViaProvider = async (params: {
  provider: 'openai' | 'openrouter';
  apiKey: string;
  model: string;
  audioBuffer: Buffer;
  filename: string;
  mimeType: string;
  prompt?: string;
  language?: string;
  temperature?: number;
  responseFormat?: 'json' | 'text' | 'verbose_json' | 'srt' | 'vtt';
}): Promise<{ text: string; raw: any }> => {
  const formData = new FormData();
  const blob = new Blob([params.audioBuffer], { type: params.mimeType });
  formData.append('file', blob, params.filename);
  formData.append('model', params.model);
  if (params.prompt) formData.append('prompt', params.prompt);
  if (params.language) formData.append('language', params.language);
  if (typeof params.temperature === 'number') formData.append('temperature', String(params.temperature));
  if (params.responseFormat) formData.append('response_format', params.responseFormat);

  const isOpenRouter = params.provider === 'openrouter';
  const url = isOpenRouter
    ? 'https://openrouter.ai/api/v1/audio/transcriptions'
    : 'https://api.openai.com/v1/audio/transcriptions';

  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
  };

  if (isOpenRouter) {
    headers['HTTP-Referer'] = process.env.FRONTEND_URL || 'http://localhost:5173';
    headers['X-Title'] = 'Zapheit Gateway';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI transcription failed: ${response.status} ${body}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    return { text, raw: text };
  }

  const data = (await response.json()) as any;
  const text = typeof data?.text === 'string' ? data.text : '';
  return { text, raw: data };
};

router.use(validateApiKey);

router.get('/models', async (req: Request, res: Response) => {
  if (!(await enforceApiKeyRateLimit(req, res))) {
    return;
  }

  let combinedModels = [...GATEWAY_MODELS];

  try {
    const openRouterModels = await fetchOpenRouterModels();
    combinedModels = mergeModels(combinedModels, openRouterModels);
  } catch (error: any) {
    logger.warn('Extended model catalog temporarily unavailable, using core models', {
      error: error.message,
      requestId: req.requestId,
    });
  }

  res.json({
    object: 'list',
    data: combinedModels.map((model) => ({
      id: model.id,
      object: 'model',
      created: 0,
      owned_by: model.ownedBy,
      provider: model.provider,
      context_length: model.contextLength ?? null,
      pricing: model.pricing ?? null,
      capabilities: model.capabilities ?? [],
    })),
  });
});

router.post('/chat/completions', async (req: Request, res: Response) => {
  if (!(await enforceApiKeyRateLimit(req, res))) {
    return;
  }

  if (!(await enforceOrgMonthlyQuota(req, res))) {
    return;
  }

  const _agentIdHeader = (req.header('x-zapheit-agent-id') || req.header('x-rasi-agent-id') || req.body?.agent_id) as string | undefined;
  let agentId: string | null = _agentIdHeader || null;
  if (_agentIdHeader && req.apiKey) {
    const _budgetResult = await checkAgentBudgetService(req.apiKey.organization_id, _agentIdHeader);
    if (!_budgetResult.ok) {
      res.status(_budgetResult.status).json(_budgetResult.body);
      return;
    }
    agentId = _budgetResult.agentId;
  }

  const idem = await prepareIdempotency(req, res, { supportsStreaming: false });
  if (idem.handled) return;

  try {
    const { model, messages, stream, temperature, max_tokens } = req.body ?? {};

    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: { message: 'model is required', type: 'invalid_request_error' } });
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages must be a non-empty array', type: 'invalid_request_error' } });
    }

    let modelConfig = normalizeModel(model);
    if (!modelConfig) {
      return res.status(400).json({
        error: {
          message: `Unsupported model: ${model}`,
          type: 'invalid_request_error',
        },
      });
    }

    const providerKey = getProviderKey(modelConfig.provider);
    if (!providerKey) {
      return res.status(503).json({
        error: {
          message: `Provider key missing for ${modelConfig.provider}`,
          type: 'service_unavailable_error',
        },
      });
    }

    let normalizedMessages: { role: string; content: any }[] = messages.map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
    let maskingTokenMap: Record<string, string> = {};

    // Load agent tools (no-op if agentId is null or agent has no connectors)
    const orgId = req.apiKey?.organization_id || '';

    // ── 4A/4B: Apply gateway interceptors ──────────────────────────────────
    // Model routing: may override the requested model based on risk/cost signals
    if (orgId) {
      const routedModelId = await resolveModelRouting(orgId, modelConfig.id, normalizedMessages);
      if (routedModelId) {
        const routedConfig = normalizeModel(routedModelId);
        if (routedConfig) modelConfig = routedConfig;
      }

      // Smart tier routing: classify query complexity and reroute if a tier policy exists
      try {
        const tierPolicyRows = (await supabaseRest('action_policies', new URLSearchParams({
          organization_id: eq(orgId),
          action: 'eq.model_tier_routing',
          service: 'eq.__gateway__',
          enabled: 'eq.true',
        }))) as any[];
        const tierPolicy = tierPolicyRows?.[0];
        if (tierPolicy?.interceptor_rules) {
          const tierMap = Array.isArray(tierPolicy.interceptor_rules) ? tierPolicy.interceptor_rules[0] : tierPolicy.interceptor_rules;
          if (tierMap && (tierMap.tier_1 || tierMap.tier_2 || tierMap.tier_3)) {
            const { tier } = classifyQueryComplexity(normalizedMessages);
            const targetModelId: string | undefined =
              tier === 'simple' ? tierMap.tier_1 :
              tier === 'standard' ? tierMap.tier_2 :
              tierMap.tier_3;
            if (targetModelId) {
              const tieredConfig = normalizeModel(targetModelId);
              if (tieredConfig) {
                logger.info('gateway: smart tier routing applied', { orgId, tier, from: modelConfig.id, to: targetModelId });
                modelConfig = tieredConfig;
              }
            }
          }
        }
      } catch {
        // Tier routing is best-effort; never block the request
      }

      // Request interception: redact PII, replace patterns, inject system instructions
      normalizedMessages = await applyRequestInterceptors(orgId, normalizedMessages);
      if (process.env.CROSS_BORDER_PII_MASKING === 'true') {
        const masked = applyCrossBorderMasking(normalizedMessages);
        normalizedMessages = masked.maskedMessages;
        maskingTokenMap = masked.tokenMap;
      }

      // Seniority Engine: inject relevant past human corrections into the system prompt
      if (agentId) {
        try {
          const lastUserMsg = [...normalizedMessages].reverse().find((m) => m.role === 'user');
          const corrections = await fetchRelevantCorrections(orgId, agentId, lastUserMsg?.content || '', 5);
          if (corrections.length > 0) {
            const correctionBlock = `\n\n<past_corrections>\nThe following human corrections from your organisation's review history are relevant to this request. Learn from them and avoid repeating these mistakes:\n${corrections.map((c) => `- ${c}`).join('\n')}\n</past_corrections>`;
            const sysIdx = normalizedMessages.findIndex((m) => m.role === 'system');
            if (sysIdx >= 0) {
              normalizedMessages[sysIdx] = {
                ...normalizedMessages[sysIdx],
                content: normalizedMessages[sysIdx].content + correctionBlock,
              };
            }
          }
        } catch {
          // Fail-open: correction injection is best-effort, never block the request
        }
      }
    }
    // ───────────────────────────────────────────────────────────────────────

    const toolContext = (agentId && orgId && modelConfig.provider !== 'openrouter')
      ? await loadAgentTools(agentId, orgId)
      : { tools: [], credentialsByConnector: {} };

    const chatOptions = {
      temperature: typeof temperature === 'number' ? temperature : undefined,
      maxTokens: typeof max_tokens === 'number' ? max_tokens : undefined,
      tools: toolContext.tools.length > 0 ? toolContext.tools : undefined,
    };

    let completion: {
      content: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUSD: number;
      latency: number;
    };

    // ── Semantic cache lookup (before upstream call) ───────────────────────────
    if (req.apiKey?.organization_id && !stream) {
      const cachedResponse = await lookupSemanticCache({
        orgId: req.apiKey.organization_id,
        messages: normalizedMessages,
        modelName: modelConfig.id,
      }).catch(() => null);
      if (cachedResponse) {
        logger.info('Semantic cache hit — returning cached response', { orgId: req.apiKey.organization_id, model: modelConfig.id });
        const nowSec = Math.floor(Date.now() / 1000);
        const cacheBody = {
          id: `chatcmpl-cache-${crypto.randomBytes(8).toString('hex')}`,
          object: 'chat.completion',
          created: nowSec,
          model: modelConfig.id,
          choices: [{ index: 0, message: { role: 'assistant', content: cachedResponse }, finish_reason: 'stop', logprobs: null }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          x_rasi_cached: true,
        };
        await completeIdempotency(idem.cacheKey, idem.dbRowId, { contentType: 'json', payload: cacheBody });
        return res.json(cacheBody);
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    // ── Tool-call continuation loop ────────────────────────────────────────────
    const conversationMessages = [...normalizedMessages];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUSD = 0;
    let totalLatency = 0;
    let finalContent = '';
    const capturedToolCalls: Array<{ name: string; arguments: string; result?: string; latency_ms?: number }> = [];

    for (let loopCount = 0; loopCount < MAX_TOOL_LOOPS; loopCount++) {
      let aiResponse: { content: string; tokenCount: { input: number; output: number; total: number }; costUSD: number; latency: number; toolCalls?: ToolCall[] };

      if (modelConfig.ownedBy === 'local') {
        // Local Ollama model — OpenAI-compatible, no tool support; single pass
        const ollamaResponse = await routeViaOllama(modelConfig.upstreamModel, conversationMessages, chatOptions);
        totalInputTokens += ollamaResponse.inputTokens;
        totalOutputTokens += ollamaResponse.outputTokens;
        totalCostUSD += ollamaResponse.costUSD;
        totalLatency += ollamaResponse.latency;
        finalContent = ollamaResponse.content;
        break;
      } else if (modelConfig.provider === 'openai') {
        aiResponse = await new OpenAIService(providerKey).chat(conversationMessages, modelConfig.upstreamModel, chatOptions);
      } else if (modelConfig.provider === 'anthropic') {
        aiResponse = await new AnthropicService(providerKey).chat(conversationMessages, modelConfig.upstreamModel, chatOptions);
      } else {
        // OpenRouter — no tool support; single pass
        const orResponse = await routeViaOpenRouter(modelConfig.upstreamModel, conversationMessages, chatOptions);
        totalInputTokens += orResponse.inputTokens;
        totalOutputTokens += orResponse.outputTokens;
        totalCostUSD += orResponse.costUSD;
        totalLatency += orResponse.latency;
        finalContent = orResponse.content;
        break;
      }

      totalInputTokens += aiResponse.tokenCount.input;
      totalOutputTokens += aiResponse.tokenCount.output;
      totalCostUSD += aiResponse.costUSD;
      totalLatency += aiResponse.latency;

      // No tool calls → we have the final answer
      if (!aiResponse.toolCalls || aiResponse.toolCalls.length === 0) {
        finalContent = aiResponse.content;
        break;
      }

      // Append the assistant's tool-call turn
      conversationMessages.push({
        role: 'assistant',
        content: aiResponse.content || null,
        tool_calls: aiResponse.toolCalls,
      } as any);

      // Execute each tool call and append results
      for (const tc of aiResponse.toolCalls) {
        const tcStart = Date.now();
        const resultContent = await executeSingleToolCall(tc, toolContext.credentialsByConnector, orgId, agentId, toolContext.mcpServers);
        capturedToolCalls.push({
          name: tc.function.name,
          arguments: tc.function.arguments,
          result: typeof resultContent === 'string' ? resultContent.slice(0, 500) : undefined,
          latency_ms: Date.now() - tcStart,
        });
        conversationMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultContent,
        } as any);
      }

      // If this is the last allowed iteration, make one final call without tools to get a text answer
      if (loopCount === MAX_TOOL_LOOPS - 1) {
        logger.warn('Tool loop hit MAX_TOOL_LOOPS — forcing final text response', { agentId, loopCount });
        const finalOptions = { ...chatOptions, tools: undefined };
        const finalAi = modelConfig.provider === 'openai'
          ? await new OpenAIService(providerKey).chat(conversationMessages, modelConfig.upstreamModel, finalOptions)
          : await new AnthropicService(providerKey).chat(conversationMessages, modelConfig.upstreamModel, finalOptions);
        totalInputTokens += finalAi.tokenCount.input;
        totalOutputTokens += finalAi.tokenCount.output;
        totalCostUSD += finalAi.costUSD;
        totalLatency += finalAi.latency;
        finalContent = finalAi.content;
      }
    }

    // ── 4A: Response interception — redact/replace in LLM output ───────────
    if (orgId) {
      finalContent = await applyResponseInterceptors(orgId, finalContent);
    }
    if (Object.keys(maskingTokenMap).length > 0) {
      finalContent = reinjectMaskedValues(finalContent, maskingTokenMap);
    }
    // ───────────────────────────────────────────────────────────────────────

    completion = {
      content: finalContent,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      costUSD: totalCostUSD,
      latency: totalLatency,
    };

    await recordCost({
      organizationId: req.apiKey?.organization_id || '',
      agentId,
      modelId: modelConfig.id,
      modelProvider: modelConfig.provider,
      billedModel: modelConfig.upstreamModel,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
      totalTokens: completion.totalTokens,
      costUSD: completion.costUSD,
      latencyMs: completion.latency,
      apiKeyId: req.apiKey?.id || '',
      requestId: req.requestId || '',
      endpoint: req.path,
    });

    if (req.apiKey?.organization_id) {
      void recordPromptCacheObservation({
        orgId: req.apiKey.organization_id,
        modelName: modelConfig.id,
        endpoint: '/v1/chat/completions',
        messages: normalizedMessages,
        totalTokens: completion.totalTokens,
        costUsd: completion.costUSD,
      });
      // Store response for future semantic cache hits (fire-and-forget)
      if (completion.content) {
        void storeSemanticCacheResponse({
          orgId: req.apiKey.organization_id,
          messages: normalizedMessages,
          modelName: modelConfig.id,
          response: completion.content,
        }).catch(() => { /* non-fatal */ });
      }
    }

    if (req.apiKey?.organization_id && agentId) {
      void maybeCreateIncidentFromCompletion({
        orgId: req.apiKey.organization_id,
        agentId,
        modelId: modelConfig.id,
        messages: normalizedMessages,
        completion: { content: completion.content },
        requestId: req.requestId,
      }).catch((err: any) => {
        logger.error('Failed to create incident from completion', { err: err.message, agentId, requestId: req.requestId });
      });
    }

    // ── Reasoning trace capture (fire-and-forget, non-blocking) ────────────
    if (req.apiKey?.organization_id) {
      void captureReasoningTrace({
        orgId: req.apiKey.organization_id,
        agentId: agentId ?? null,
        conversationId: (req.body?.conversation_id as string | undefined) ?? null,
        requestId: req.requestId,
        model: modelConfig.id,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        latencyMs: completion.latency,
        toolCalls: capturedToolCalls,
        interceptorsApplied: [],
        responseContent: completion.content,
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    const nowSeconds = Math.floor(Date.now() / 1000);

    if (stream === true) {
      await failIdempotency(idem.cacheKey, idem.dbRowId);
      streamCompletionResponse(res, {
        modelId: modelConfig.id,
        content: completion.content,
        completionTokens: completion.outputTokens,
      });
      return;
    }

    const responseBody = {
      id: `chatcmpl_${crypto.randomUUID()}`,
      object: 'chat.completion',
      created: nowSeconds,
      model: modelConfig.id,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: completion.content,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: completion.inputTokens,
        completion_tokens: completion.outputTokens,
        total_tokens: completion.totalTokens,
      },
    };

    await completeIdempotency(idem.cacheKey, idem.dbRowId, { contentType: 'json', payload: responseBody });
    return res.json(responseBody);
  } catch (error: any) {
    await failIdempotency(idem.cacheKey, idem.dbRowId);

    const providerStatus = typeof error?.status === 'number'
      ? error.status
      : typeof error?.response?.status === 'number'
        ? error.response.status
        : null;

    const providerMessage = (() => {
      if (typeof error?.message === 'string' && error.message) return error.message;
      if (typeof error?.error?.message === 'string' && error.error.message) return error.error.message;
      if (typeof error?.response?.data?.error?.message === 'string' && error.response.data.error.message) return error.response.data.error.message;
      return 'Gateway completion failed';
    })();

    logger.error('Gateway completion failed', {
      error: providerMessage,
      providerStatus,
      requestId: req.requestId,
      orgId: req.apiKey?.organization_id,
      keyId: req.apiKey?.id,
    });

    const status = providerStatus && providerStatus >= 400 && providerStatus < 600 ? providerStatus : 500;

    return res.status(status).json({
      error: {
        message: providerMessage,
        type: status >= 500 ? 'server_error' : 'invalid_request_error',
      },
    });
  }
});

// OpenAI legacy text completion compatibility route
router.post('/completions', async (req: Request, res: Response) => {
  if (!(await enforceApiKeyRateLimit(req, res))) {
    return;
  }

  if (!(await enforceOrgMonthlyQuota(req, res))) {
    return;
  }

  const idem = await prepareIdempotency(req, res, { supportsStreaming: false });
  if (idem.handled) return;

  try {
    const { model, prompt, max_tokens, stream, temperature } = req.body ?? {};

    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: { message: 'model is required', type: 'invalid_request_error' } });
    }

    const prompts = Array.isArray(prompt) ? prompt : [prompt];
    const promptText = prompts.filter((p) => typeof p === 'string').join('\n');
    if (!promptText) {
      return res.status(400).json({ error: { message: 'prompt is required', type: 'invalid_request_error' } });
    }

    const modelConfig = normalizeModel(model);
    if (!modelConfig) {
      return res.status(400).json({ error: { message: `Unsupported model: ${model}`, type: 'invalid_request_error' } });
    }

    const providerKey = getProviderKey(modelConfig.provider);
    if (!providerKey) {
      return res.status(503).json({ error: { message: `Provider key missing for ${modelConfig.provider}`, type: 'service_unavailable_error' } });
    }

    const messages = [{ role: 'user', content: promptText }];
    const chatOptions = {
      temperature: typeof temperature === 'number' ? temperature : undefined,
      maxTokens: typeof max_tokens === 'number' ? max_tokens : undefined,
    };

    let completion: {
      text: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUSD: number;
      latency: number;
    };

    if (modelConfig.provider === 'openai') {
      const aiResponse = await new OpenAIService(providerKey).chat(messages, modelConfig.upstreamModel, chatOptions);
      completion = {
        text: aiResponse.content,
        inputTokens: aiResponse.tokenCount.input,
        outputTokens: aiResponse.tokenCount.output,
        totalTokens: aiResponse.tokenCount.total,
        costUSD: aiResponse.costUSD,
        latency: aiResponse.latency,
      };
    } else if (modelConfig.provider === 'anthropic') {
      const aiResponse = await new AnthropicService(providerKey).chat(messages, modelConfig.upstreamModel, chatOptions);
      completion = {
        text: aiResponse.content,
        inputTokens: aiResponse.tokenCount.input,
        outputTokens: aiResponse.tokenCount.output,
        totalTokens: aiResponse.tokenCount.total,
        costUSD: aiResponse.costUSD,
        latency: aiResponse.latency,
      };
    } else {
      const aiResponse = await routeViaOpenRouter(modelConfig.upstreamModel, messages, chatOptions);
      completion = {
        text: aiResponse.content,
        inputTokens: aiResponse.inputTokens,
        outputTokens: aiResponse.outputTokens,
        totalTokens: aiResponse.totalTokens,
        costUSD: aiResponse.costUSD,
        latency: aiResponse.latency,
      };
    }

    if (req.apiKey) {
      await supabaseRest('cost_tracking', '', {
        method: 'POST',
        body: {
          organization_id: req.apiKey.organization_id,
          date: new Date().toISOString().split('T')[0],
          model_name: modelConfig.id,
          input_tokens: completion.inputTokens,
          output_tokens: completion.outputTokens,
          total_tokens: completion.totalTokens,
          cost_usd: completion.costUSD,
          request_count: 1,
          avg_latency_ms: completion.latency,
          metadata: {
            api_key_id: req.apiKey.id,
            provider: modelConfig.provider,
            endpoint: '/v1/completions',
            request_id: req.requestId,
          },
        },
      });

      void recordPromptCacheObservation({
        orgId: req.apiKey.organization_id,
        modelName: modelConfig.id,
        endpoint: '/v1/completions',
        messages,
        totalTokens: completion.totalTokens,
        costUsd: completion.costUSD,
      });
    }

    if (stream === true) {
      await failIdempotency(idem.cacheKey, idem.dbRowId);
      streamLegacyCompletionResponse(res, {
        modelId: modelConfig.id,
        text: completion.text,
      });
      return;
    }

    const responseBody = {
      id: `cmpl_${crypto.randomUUID()}`,
      object: 'text_completion',
      created: Math.floor(Date.now() / 1000),
      model: modelConfig.id,
      choices: [
        {
          text: completion.text,
          index: 0,
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: completion.inputTokens,
        completion_tokens: completion.outputTokens,
        total_tokens: completion.totalTokens,
      },
    };

    await completeIdempotency(idem.cacheKey, idem.dbRowId, { contentType: 'json', payload: responseBody });
    return res.json(responseBody);
  } catch (error: any) {
    await failIdempotency(idem.cacheKey, idem.dbRowId);
    logger.error('Legacy completion failed', {
      error: error.message,
      requestId: req.requestId,
      orgId: req.apiKey?.organization_id,
      keyId: req.apiKey?.id,
    });

    return res.status(500).json({
      error: {
        message: error.message || 'Legacy completion failed',
        type: 'server_error',
      },
    });
  }
});

router.post('/embeddings', async (req: Request, res: Response) => {
  if (!(await enforceApiKeyRateLimit(req, res))) {
    return;
  }

  if (!(await enforceOrgMonthlyQuota(req, res))) {
    return;
  }

  const idem = await prepareIdempotency(req, res, { supportsStreaming: false });
  if (idem.handled) return;

  try {
    const { model, input } = req.body ?? {};

    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: { message: 'model is required', type: 'invalid_request_error' } });
    }

    const normalizedInput = Array.isArray(input)
      ? input.filter((v) => typeof v === 'string')
      : typeof input === 'string'
        ? [input]
        : [];

    if (!normalizedInput.length) {
      return res.status(400).json({ error: { message: 'input must be a string or array of strings', type: 'invalid_request_error' } });
    }

    const modelConfig = normalizeModel(model);
    if (!modelConfig) {
      return res.status(400).json({ error: { message: `Unsupported model: ${model}`, type: 'invalid_request_error' } });
    }

    const providerKey = getProviderKey(modelConfig.provider);
    if (!providerKey) {
      return res.status(503).json({ error: { message: `Provider key missing for ${modelConfig.provider}`, type: 'service_unavailable_error' } });
    }

    let embeddings: number[][] = [];
    let promptTokens = 0;
    let totalTokens = 0;
    const startedAt = Date.now();

    if (modelConfig.provider === 'openai' && modelConfig.upstreamModel.includes('embedding')) {
      const result = await fetchOpenAIEmbeddings(providerKey, modelConfig.upstreamModel, normalizedInput);
      embeddings = result.embeddings;
      promptTokens = result.promptTokens;
      totalTokens = result.totalTokens;
    } else if (modelConfig.provider === 'openrouter') {
      const result = await fetchOpenRouterEmbeddings(providerKey, modelConfig.upstreamModel, normalizedInput);
      embeddings = result.embeddings;
      promptTokens = result.promptTokens;
      totalTokens = result.totalTokens;
    } else {
      // Fallback deterministic embeddings to preserve compatibility even when provider lacks embeddings API.
      embeddings = normalizedInput.map((text) => createSimpleEmbedding(text));
      promptTokens = normalizedInput.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
      totalTokens = promptTokens;
    }

    const latencyMs = Date.now() - startedAt;
    const data = embeddings.map((embedding, index) => ({
      object: 'embedding',
      index,
      embedding,
    }));

    if (req.apiKey) {
      await supabaseRest('cost_tracking', '', {
        method: 'POST',
        body: {
          organization_id: req.apiKey.organization_id,
          date: new Date().toISOString().split('T')[0],
          model_name: modelConfig.id,
          input_tokens: promptTokens,
          output_tokens: 0,
          total_tokens: totalTokens,
          cost_usd: 0,
          request_count: 1,
          avg_latency_ms: latencyMs,
          metadata: {
            api_key_id: req.apiKey.id,
            provider: modelConfig.provider,
            endpoint: '/v1/embeddings',
            request_id: req.requestId,
            vector_count: data.length,
            dimensions: data[0]?.embedding?.length || 0,
          },
        },
      });

    }

    const responseBody = {
      object: 'list',
      data,
      model: modelConfig.id,
      usage: {
        prompt_tokens: promptTokens,
        total_tokens: totalTokens,
      },
    };

    await completeIdempotency(idem.cacheKey, idem.dbRowId, { contentType: 'json', payload: responseBody });
    return res.json(responseBody);
  } catch (error: any) {
    await failIdempotency(idem.cacheKey, idem.dbRowId);
    logger.error('Embeddings request failed', {
      error: error.message,
      requestId: req.requestId,
      orgId: req.apiKey?.organization_id,
      keyId: req.apiKey?.id,
    });

    return res.status(500).json({
      error: {
        message: error.message || 'Embeddings request failed',
        type: 'server_error',
      },
    });
  }
});

router.post('/responses', async (req: Request, res: Response) => {
  if (!(await enforceApiKeyRateLimit(req, res))) {
    return;
  }

  if (!(await enforceOrgMonthlyQuota(req, res))) {
    return;
  }

  const idem = await prepareIdempotency(req, res, { supportsStreaming: true });
  if (idem.handled) return;

  try {
    const { model, input, stream, temperature, max_tokens } = req.body ?? {};

    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: { message: 'model is required', type: 'invalid_request_error' } });
    }

    const modelConfig = normalizeModel(model);
    if (!modelConfig) {
      return res.status(400).json({ error: { message: `Unsupported model: ${model}`, type: 'invalid_request_error' } });
    }

    const providerKey = getProviderKey(modelConfig.provider);
    if (!providerKey) {
      return res.status(503).json({ error: { message: `Provider key missing for ${modelConfig.provider}`, type: 'service_unavailable_error' } });
    }

    let normalizedMessages: Array<{ role: string; content: string }> = [];

    if (typeof input === 'string') {
      normalizedMessages = [{ role: 'user', content: input }];
    } else if (Array.isArray(input)) {
      normalizedMessages = input.map((item: any) => {
        const role = item?.role || 'user';
        if (typeof item?.content === 'string') {
          return { role, content: item.content };
        }

        if (Array.isArray(item?.content)) {
          const textParts = item.content
            .filter((c: any) => c?.type === 'input_text' || c?.type === 'text' || typeof c?.text === 'string')
            .map((c: any) => c?.text || '')
            .join('\n');
          return { role, content: textParts };
        }

        return { role, content: '' };
      }).filter((m) => m.content.length > 0);
    }

    if (!normalizedMessages.length) {
      return res.status(400).json({ error: { message: 'input must be a string or message array', type: 'invalid_request_error' } });
    }

    const chatOptions = {
      temperature: typeof temperature === 'number' ? temperature : undefined,
      maxTokens: typeof max_tokens === 'number' ? max_tokens : undefined,
    };

    let completion: {
      text: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUSD: number;
      latency: number;
    };

    if (modelConfig.provider === 'openai') {
      const aiResponse = await new OpenAIService(providerKey).chat(normalizedMessages, modelConfig.upstreamModel, chatOptions);
      completion = {
        text: aiResponse.content,
        inputTokens: aiResponse.tokenCount.input,
        outputTokens: aiResponse.tokenCount.output,
        totalTokens: aiResponse.tokenCount.total,
        costUSD: aiResponse.costUSD,
        latency: aiResponse.latency,
      };
    } else if (modelConfig.provider === 'anthropic') {
      const aiResponse = await new AnthropicService(providerKey).chat(normalizedMessages, modelConfig.upstreamModel, chatOptions);
      completion = {
        text: aiResponse.content,
        inputTokens: aiResponse.tokenCount.input,
        outputTokens: aiResponse.tokenCount.output,
        totalTokens: aiResponse.tokenCount.total,
        costUSD: aiResponse.costUSD,
        latency: aiResponse.latency,
      };
    } else {
      const aiResponse = await routeViaOpenRouter(modelConfig.upstreamModel, normalizedMessages, chatOptions);
      completion = {
        text: aiResponse.content,
        inputTokens: aiResponse.inputTokens,
        outputTokens: aiResponse.outputTokens,
        totalTokens: aiResponse.totalTokens,
        costUSD: aiResponse.costUSD,
        latency: aiResponse.latency,
      };
    }

    if (req.apiKey) {
      await supabaseRest('cost_tracking', '', {
        method: 'POST',
        body: {
          organization_id: req.apiKey.organization_id,
          date: new Date().toISOString().split('T')[0],
          model_name: modelConfig.id,
          input_tokens: completion.inputTokens,
          output_tokens: completion.outputTokens,
          total_tokens: completion.totalTokens,
          cost_usd: completion.costUSD,
          request_count: 1,
          avg_latency_ms: completion.latency,
          metadata: {
            api_key_id: req.apiKey.id,
            provider: modelConfig.provider,
            endpoint: '/v1/responses',
            request_id: req.requestId,
          },
        },
      });
    }

    const responseId = `resp_${crypto.randomUUID()}`;
    const createdAt = Math.floor(Date.now() / 1000);

    if (stream === true) {
      await failIdempotency(idem.cacheKey, idem.dbRowId);
      streamResponsesApiOutput(res, {
        modelId: modelConfig.id,
        text: completion.text,
        responseId,
      });
      return;
    }

    const responseBody = {
      id: responseId,
      object: 'response',
      created_at: createdAt,
      status: 'completed',
      model: modelConfig.id,
      output: [
        {
          type: 'message',
          id: `msg_${crypto.randomUUID()}`,
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: completion.text,
            },
          ],
        },
      ],
      output_text: completion.text,
      usage: {
        input_tokens: completion.inputTokens,
        output_tokens: completion.outputTokens,
        total_tokens: completion.totalTokens,
      },
    };

    await completeIdempotency(idem.cacheKey, idem.dbRowId, { contentType: 'json', payload: responseBody });
    return res.json(responseBody);
  } catch (error: any) {
    await failIdempotency(idem.cacheKey, idem.dbRowId);
    logger.error('Responses API request failed', {
      error: error.message,
      requestId: req.requestId,
      orgId: req.apiKey?.organization_id,
      keyId: req.apiKey?.id,
    });

    return res.status(500).json({
      error: {
        message: error.message || 'Responses API request failed',
        type: 'server_error',
      },
    });
  }
});

router.post('/audio/transcriptions', transcriptionUploadMiddleware, async (req: Request, res: Response) => {
  if (!(await enforceApiKeyRateLimit(req, res))) {
    return;
  }

  if (!(await enforceOrgMonthlyQuota(req, res))) {
    return;
  }

  const idem = await prepareIdempotency(req, res, { supportsStreaming: false });
  if (idem.handled) return;

  try {
    const {
      model = 'openai/whisper-1',
      file_base64,
      audio_base64,
      file,
      filename = 'audio.webm',
      mime_type = 'audio/webm',
      prompt,
      language,
      temperature,
      response_format = 'json',
      stream,
    } = req.body ?? {};

    if (stream === true) {
      await failIdempotency(idem.cacheKey, idem.dbRowId);
      return res.status(501).json({ error: { message: 'stream=true is not yet supported for audio transcription', type: 'invalid_request_error' } });
    }

    if (typeof model !== 'string') {
      return res.status(400).json({ error: { message: 'model must be a string', type: 'invalid_request_error' } });
    }

    const uploadedFile = req.file;
    const base64Input = file_base64 || audio_base64 || file;

    if (!uploadedFile && (!base64Input || typeof base64Input !== 'string')) {
      return res.status(400).json({
        error: {
          message: 'Provide audio as multipart field `file` or as file_base64/audio_base64 string.',
          type: 'invalid_request_error',
        },
      });
    }

    const modelConfig = normalizeModel(model);
    if (!modelConfig) {
      return res.status(400).json({ error: { message: `Unsupported model: ${model}`, type: 'invalid_request_error' } });
    }

    const providerKey = getProviderKey(modelConfig.provider);
    if (!providerKey) {
      return res.status(503).json({ error: { message: `Provider key missing for ${modelConfig.provider}`, type: 'service_unavailable_error' } });
    }

    const audioBuffer = uploadedFile?.buffer || normalizeBase64Audio(base64Input);
    const resolvedFilename = uploadedFile?.originalname || filename;
    const resolvedMimeType = uploadedFile?.mimetype || mime_type;
    const startedAt = Date.now();

    let transcriptionText = '';
    let rawTranscription: any = null;

    if (modelConfig.provider === 'openai') {
      const result = await transcribeViaProvider({
        provider: 'openai',
        apiKey: providerKey,
        model: modelConfig.upstreamModel,
        audioBuffer,
        filename: resolvedFilename,
        mimeType: resolvedMimeType,
        prompt,
        language,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        responseFormat: response_format,
      });
      transcriptionText = result.text;
      rawTranscription = result.raw;
    } else if (modelConfig.provider === 'openrouter') {
      const result = await transcribeViaProvider({
        provider: 'openrouter',
        apiKey: providerKey,
        model: modelConfig.upstreamModel,
        audioBuffer,
        filename: resolvedFilename,
        mimeType: resolvedMimeType,
        prompt,
        language,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        responseFormat: response_format,
      });
      transcriptionText = result.text;
      rawTranscription = result.raw;
    } else {
      return res.status(400).json({ error: { message: 'Anthropic does not support transcription on this compatibility route yet', type: 'invalid_request_error' } });
    }

    const latencyMs = Date.now() - startedAt;
    const estimatedTokens = Math.ceil((transcriptionText || '').length / 4);

    if (req.apiKey) {
      await supabaseRest('cost_tracking', '', {
        method: 'POST',
        body: {
          organization_id: req.apiKey.organization_id,
          date: new Date().toISOString().split('T')[0],
          model_name: modelConfig.id,
          input_tokens: estimatedTokens,
          output_tokens: 0,
          total_tokens: estimatedTokens,
          cost_usd: 0,
          request_count: 1,
          avg_latency_ms: latencyMs,
          metadata: {
            api_key_id: req.apiKey.id,
            provider: modelConfig.provider,
            endpoint: '/v1/audio/transcriptions',
            request_id: req.requestId,
            audio_bytes: audioBuffer.byteLength,
            filename: resolvedFilename,
            mime_type: resolvedMimeType,
            transport: uploadedFile ? 'multipart' : 'base64',
          },
        },
      });
    }

    if (response_format === 'text') {
      await completeIdempotency(idem.cacheKey, idem.dbRowId, { contentType: 'text', payload: transcriptionText });
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(transcriptionText);
    }

    if (response_format === 'verbose_json' && rawTranscription) {
      await completeIdempotency(idem.cacheKey, idem.dbRowId, { contentType: 'json', payload: rawTranscription });
      return res.json(rawTranscription);
    }

    const responseBody = { text: transcriptionText };
    await completeIdempotency(idem.cacheKey, idem.dbRowId, { contentType: 'json', payload: responseBody });
    return res.json(responseBody);
  } catch (error: any) {
    await failIdempotency(idem.cacheKey, idem.dbRowId);
    logger.error('Audio transcription failed', {
      error: error.message,
      requestId: req.requestId,
      orgId: req.apiKey?.organization_id,
      keyId: req.apiKey?.id,
    });

    return res.status(500).json({
      error: {
        message: error.message || 'Audio transcription failed',
        type: 'server_error',
      },
    });
  }
});

/**
 * Initialize idempotency cache from database on startup.
 * Loads non-expired completed requests to prevent duplicate processing on restart.
 */
export const initializeIdempotencyCache = async (): Promise<void> => {
  try {
    const now = new Date();
    const query = new URLSearchParams();
    query.set('status', eq('completed'));
    query.set('expires_at', `gt.${now.toISOString()}`);
    query.set('limit', String(IDEMPOTENCY_MAX_CACHE_ENTRIES));
    query.set('order', 'created_at.desc');

    const records = (await supabaseRest(IDEMPOTENCY_TABLE, query)) as DbIdempotencyRow[];

    if (!records || records.length === 0) {
      logger.info('Idempotency cache warm-up: no recent records found', {
        timestamp: now.toISOString(),
      });
      return;
    }

    for (const record of records) {
      const cacheKey = `${record.api_key_id}:${record.route_path}:${record.idempotency_key}`;
      const contentType = (record.content_type || 'json') as 'json' | 'text';

      idempotencyCache.set(cacheKey, {
        type: 'completed',
        fingerprint: record.request_fingerprint,
        status: record.http_status || 200,
        contentType,
        payload: contentType === 'json' ? (record.response_payload || {}) : (record.response_text || ''),
        createdAt: new Date(record.created_at).getTime(),
      });
    }

    logger.info('Idempotency cache warm-up completed', {
      recordsLoaded: records.length,
      cacheSize: idempotencyCache.size,
      oldestRecord: records[records.length - 1]?.created_at,
      newestRecord: records[0]?.created_at,
    });
  } catch (error: any) {
    logger.error('Failed to initialize idempotency cache on startup', {
      error: error?.message || 'Unknown error',
    });
    // Non-blocking: don't fail server startup if cache warm-up fails
    // In-memory cache will be empty, but DB fallback will still work
  }
};

// ─── Simple Agent Chat Endpoint ──────────────────────────────────────────────
// Public-facing endpoint for widget embeds, API integrations, and terminal use.
// Auth: API key (sk_...) or website widget key (wk_...) — no Supabase JWT required.
// POST /v1/agents/:agentId/chat
// Body: { message: string }
// Response: { success: true, reply: string, agent_id: string, usage: {...} }

// Preflight — allow widget.js to be embedded on any third-party origin.
// Authentication is via API key so no credentials/cookies are involved.
router.options('/agents/:agentId/chat', (_req: Request, res: Response) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(204);
});

router.post('/agents/:agentId/chat', async (req: Request, res: Response) => {
  // Allow widget embeds from any origin — auth is via API key, not cookies
  res.header('Access-Control-Allow-Origin', '*');
  if (!(await enforceApiKeyRateLimit(req, res))) {
    return;
  }

  try {
    const { agentId } = req.params;
    const { message, conversation_id: existingConversationId } = req.body ?? {};
    const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';

    if (req.apiKey?.allowed_origins && req.apiKey.allowed_origins.length > 0 && requestOrigin) {
      if (!req.apiKey.allowed_origins.includes(requestOrigin)) {
        return res.status(403).json({ success: false, error: 'Origin not allowed for this website key' });
      }
    }

    if (req.apiKey?.allowed_agent_ids && req.apiKey.allowed_agent_ids.length > 0) {
      if (!req.apiKey.allowed_agent_ids.includes(agentId)) {
        return res.status(403).json({ success: false, error: 'API key is not allowed to access this agent' });
      }
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }

    if (!req.apiKey) {
      return res.status(401).json({ success: false, error: 'API key required' });
    }

    // Fetch agent and validate org ownership
    const agentQuery = new URLSearchParams();
    agentQuery.set('id', eq(agentId));
    agentQuery.set('organization_id', eq(req.apiKey.organization_id));
    const agents = (await supabaseRest('ai_agents', agentQuery)) as any[];

    if (!agents || agents.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const agent = agents[0];

    if (agent.status === 'terminated') {
      return res.status(403).json({ success: false, error: 'Agent is terminated' });
    }

    // Check budget
    const budgetLimit = Number(agent.config?.budget_limit ?? 0);
    let currentSpend = Number(agent.config?.current_spend ?? 0);
    if (budgetLimit > 0) {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      const costQuery = new URLSearchParams();
      costQuery.set('organization_id', eq(req.apiKey.organization_id));
      costQuery.set('agent_id', eq(agentId));
      costQuery.set('date', gte(monthStart.toISOString().split('T')[0]));
      const costRows = await supabaseRest('cost_tracking', costQuery) as any[];
      const totalCostUsd = (costRows || []).reduce((sum, row) => sum + Number(row?.cost_usd || 0), 0);
      currentSpend = usdToInr(totalCostUsd);
    }
    if (budgetLimit > 0 && currentSpend >= budgetLimit) {
      return res.status(402).json({ success: false, error: 'Budget limit exceeded' });
    }

    const modelConfig = normalizeModel(agent.model_name || 'openai/gpt-4o-mini');
    if (!modelConfig) {
      return res.status(400).json({ success: false, error: `Unsupported model: ${agent.model_name}` });
    }

    const providerKey = getProviderKey(modelConfig.provider);
    if (!providerKey) {
      return res.status(503).json({ success: false, error: `Provider unavailable for ${modelConfig.provider}` });
    }

    const messages = [
      { role: 'system' as const, content: agent.system_prompt || 'You are a helpful assistant.' },
      { role: 'user' as const, content: message.trim() },
    ];

    let completion: {
      content: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUSD: number;
      latency: number;
    };

    if (modelConfig.provider === 'openai') {
      const aiResponse = await new OpenAIService(providerKey).chat(messages, modelConfig.upstreamModel, {});
      completion = {
        content: aiResponse.content,
        inputTokens: aiResponse.tokenCount.input,
        outputTokens: aiResponse.tokenCount.output,
        totalTokens: aiResponse.tokenCount.total,
        costUSD: aiResponse.costUSD,
        latency: aiResponse.latency,
      };
    } else if (modelConfig.provider === 'anthropic') {
      const aiResponse = await new AnthropicService(providerKey).chat(messages, modelConfig.upstreamModel, {});
      completion = {
        content: aiResponse.content,
        inputTokens: aiResponse.tokenCount.input,
        outputTokens: aiResponse.tokenCount.output,
        totalTokens: aiResponse.tokenCount.total,
        costUSD: aiResponse.costUSD,
        latency: aiResponse.latency,
      };
    } else {
      const aiResponse = await routeViaOpenRouter(modelConfig.upstreamModel, messages, {});
      completion = {
        content: aiResponse.content,
        inputTokens: aiResponse.inputTokens,
        outputTokens: aiResponse.outputTokens,
        totalTokens: aiResponse.totalTokens,
        costUSD: aiResponse.costUSD,
        latency: aiResponse.latency,
      };
    }

    // Resolve or create conversation (awaited so we can return conversation_id in response)
    let conversationId: string | undefined = existingConversationId || undefined;
    if (!conversationId) {
      try {
        const convRows = (await supabaseRest('conversations', '', {
          method: 'POST',
          body: {
            organization_id: req.apiKey!.organization_id,
            agent_id: agentId,
            platform: 'api',
            status: 'active',
            started_at: new Date().toISOString(),
            metadata: {
              last_user_message: message.trim().slice(0, 200),
              platform_label: 'Terminal API',
              user_label: req.apiKey?.name ? `API key: ${req.apiKey.name}` : 'API caller',
              api_key_name: req.apiKey?.name || null,
            },
          },
        })) as any[];
        conversationId = convRows?.[0]?.id;
      } catch (err: any) {
        logger.error('Failed to create conversation for agent chat', { error: err.message, agentId });
      }
    }

    // Save messages (fire and forget — non-blocking)
    if (conversationId) {
      void Promise.all([
        supabaseRest('messages', '', {
          method: 'POST',
          body: { conversation_id: conversationId, role: 'user', content: message.trim(), token_count: completion.inputTokens, created_at: new Date().toISOString() },
        }),
        supabaseRest('messages', '', {
          method: 'POST',
          body: { conversation_id: conversationId, role: 'assistant', content: completion.content, token_count: completion.outputTokens, cost_usd: completion.costUSD, created_at: new Date().toISOString() },
        }),
      ]).catch((err: any) => {
        logger.error('Failed to save messages for agent chat', { error: err.message, agentId });
      });
    }

    // Incident detection (fire and forget)
    void maybeCreateIncidentFromCompletion({
      orgId: req.apiKey.organization_id,
      agentId,
      modelId: modelConfig.id,
      messages,
      completion: { content: completion.content },
      requestId: req.requestId,
    }).catch((err: any) => {
      logger.error('Failed to run incident detection on agent chat', { err: err.message, agentId });
    });

    // Cost tracking (fire and forget)
    void recordCost({
      organizationId: req.apiKey?.organization_id || '',
      agentId,
      modelId: modelConfig.id,
      modelProvider: modelConfig.provider,
      billedModel: modelConfig.upstreamModel,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
      totalTokens: completion.totalTokens,
      costUSD: completion.costUSD,
      latencyMs: completion.latency,
      apiKeyId: req.apiKey?.id || '',
      requestId: req.requestId || '',
      endpoint: req.path,
    }).catch((err: any) => {
      logger.error('Failed to log cost for agent chat', { err: err.message, agentId });
    });

    logger.info('Agent chat completed', {
      agentId,
      model: modelConfig.id,
      latency: completion.latency,
      tokens: completion.totalTokens,
      requestId: req.requestId,
    });

    return res.json({
      success: true,
      reply: completion.content,
      agent_id: agentId,
      conversation_id: conversationId ?? null,
      usage: {
        input_tokens: completion.inputTokens,
        output_tokens: completion.outputTokens,
        total_tokens: completion.totalTokens,
        cost_usd: completion.costUSD,
      },
    });
  } catch (error: any) {
    logger.error('Agent chat failed', {
      error: error.message,
      agentId: req.params.agentId,
      requestId: req.requestId,
    });
    return res.status(500).json({ success: false, error: 'Agent chat failed' });
  }
});

export default router;
