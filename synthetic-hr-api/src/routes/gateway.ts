import crypto from 'crypto';
import express, { Request, Response } from 'express';
import multer from 'multer';
import { AnthropicService, OpenAIService } from '../services/ai-service';
import { validateApiKey } from '../middleware/api-key-validation';
import { logger } from '../lib/logger';
import { supabaseRest, eq } from '../lib/supabase-rest';
import { fireAndForgetWebhookEvent } from '../lib/webhook-relay';
import { recordPromptCacheObservation } from '../lib/prompt-caching';

const router = express.Router();

interface GatewayModel {
  id: string;
  provider: 'openai' | 'anthropic' | 'openrouter';
  upstreamModel: string;
  ownedBy: string;
}

const GATEWAY_MODELS: GatewayModel[] = [
  { id: 'openai/gpt-4o', provider: 'openai', upstreamModel: 'gpt-4o', ownedBy: 'openai' },
  { id: 'openai/gpt-4o-mini', provider: 'openai', upstreamModel: 'gpt-4o-mini', ownedBy: 'openai' },
  { id: 'openai/gpt-4o-mini-transcribe', provider: 'openai', upstreamModel: 'gpt-4o-mini-transcribe', ownedBy: 'openai' },
  { id: 'openai/whisper-1', provider: 'openai', upstreamModel: 'whisper-1', ownedBy: 'openai' },
  { id: 'openai/gpt-4-turbo', provider: 'openai', upstreamModel: 'gpt-4-turbo', ownedBy: 'openai' },
  { id: 'openai/gpt-3.5-turbo', provider: 'openai', upstreamModel: 'gpt-3.5-turbo', ownedBy: 'openai' },
  { id: 'openai/text-embedding-3-small', provider: 'openai', upstreamModel: 'text-embedding-3-small', ownedBy: 'openai' },
  { id: 'openai/text-embedding-3-large', provider: 'openai', upstreamModel: 'text-embedding-3-large', ownedBy: 'openai' },
  // Anthropic model IDs evolve quickly; route legacy names to currently-supported upstream IDs.
  { id: 'anthropic/claude-3-5-sonnet', provider: 'anthropic', upstreamModel: 'claude-sonnet-4-0', ownedBy: 'anthropic' },
  { id: 'anthropic/claude-3-sonnet', provider: 'anthropic', upstreamModel: 'claude-sonnet-4-0', ownedBy: 'anthropic' },
  { id: 'anthropic/claude-3-haiku', provider: 'anthropic', upstreamModel: 'claude-3-haiku-20240307', ownedBy: 'anthropic' },
  { id: 'anthropic/claude-sonnet-4', provider: 'anthropic', upstreamModel: 'claude-sonnet-4-0', ownedBy: 'anthropic' },
  { id: 'google/gemini-2.0-flash', provider: 'openrouter', upstreamModel: 'google/gemini-2.0-flash', ownedBy: 'google' },
  { id: 'meta-llama/llama-3.1-70b-instruct', provider: 'openrouter', upstreamModel: 'meta-llama/llama-3.1-70b-instruct', ownedBy: 'meta' },
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

let openRouterModelsCache: { expiresAt: number; models: GatewayModel[] } = {
  expiresAt: 0,
  models: [],
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

  if (model.startsWith('anthropic/')) {
    const upstream = model.slice('anthropic/'.length);
    // Backwards-compat model aliases (older UI/agent configs used dot notation).
    const normalizedUpstream = upstream
      .replace('claude-3.5-sonnet', 'claude-3-5-sonnet')
      .replace('claude-3.5-haiku', 'claude-3-haiku');
    const id = `anthropic/${normalizedUpstream}`;
    const known = GATEWAY_MODELS.find((m) => m.id === id);
    if (known) return known;
    return { id, provider: 'anthropic', upstreamModel: normalizedUpstream, ownedBy: 'anthropic' };
  }

  if (model.startsWith('openrouter/')) {
    const upstream = model.slice('openrouter/'.length);
    return { id: model, provider: 'openrouter', upstreamModel: upstream, ownedBy: 'openrouter' };
  }

  // Any provider-style model (e.g. google/gemini-2.0-flash) can route via OpenRouter.
  if (model.includes('/')) {
    return { id: model, provider: 'openrouter', upstreamModel: model, ownedBy: model.split('/')[0] || 'openrouter' };
  }

  return null;
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

  const payload = (await response.json()) as { data?: Array<{ id: string; name?: string }> };
  const models = (payload.data || [])
    .filter((m) => typeof m.id === 'string' && m.id.includes('/'))
    .slice(0, 200)
    .map((m) => ({
      id: m.id,
      provider: 'openrouter' as const,
      upstreamModel: m.id,
      ownedBy: m.id.split('/')[0] || 'rasi-ai',
    }));

  openRouterModelsCache = {
    expiresAt: Date.now() + OPENROUTER_MODELS_CACHE_TTL_MS,
    models,
  };

  return models;
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
      'X-Title': 'Rasi Synthetic HR Gateway',
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
  const costUSD = Number(data?.usage?.cost || 0);

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

const checkAgentBudget = async (req: Request, res: Response): Promise<string | null | false> => {
  const agentId = req.header('x-rasi-agent-id') || req.body?.agent_id;
  if (!agentId || !req.apiKey) return null;

  try {
    const query = new URLSearchParams();
    query.set('id', eq(agentId));
    query.set('organization_id', eq(req.apiKey.organization_id));
    const agents = await supabaseRest('ai_agents', query) as any[];

    if (!agents || agents.length === 0) {
      res.status(404).json({ error: { message: 'Agent not found for budget check', type: 'invalid_request_error' } });
      return false;
    }

    const agent = agents[0];
    const budgetLimit = Number(agent.config?.budget_limit ?? 0);
    const currentSpend = Number(agent.config?.current_spend ?? 0);

    if (budgetLimit > 0 && currentSpend >= budgetLimit) {
      res.status(402).json({
        error: {
          message: `Agent ${agent.name} has exceeded its budget limit of $${budgetLimit}`,
          type: 'payment_required_error'
        }
      });
      return false;
    }

    return agentId;
  } catch (err) {
    logger.error('Failed to check agent budget limit', { error: err });
    // Fail open if db error for resiliency
    return agentId;
  }
};

const updateAgentBudgetAndLogCost = async (
  req: Request,
  agentId: string | null,
  modelId: string,
  modelProvider: string,
  completion: { inputTokens: number; outputTokens: number; totalTokens: number; costUSD: number; latency: number; }
) => {
  if (!req.apiKey) return;

  try {
    await supabaseRest('cost_tracking', '', {
      method: 'POST',
      body: {
        organization_id: req.apiKey.organization_id,
        agent_id: agentId || undefined,
        date: new Date().toISOString().split('T')[0],
        model_name: modelId,
        input_tokens: completion.inputTokens,
        output_tokens: completion.outputTokens,
        total_tokens: completion.totalTokens,
        cost_usd: completion.costUSD,
        request_count: 1,
        avg_latency_ms: completion.latency,
        metadata: {
          api_key_id: req.apiKey.id,
          provider: modelProvider,
          endpoint: req.path,
          request_id: req.requestId,
        },
      },
    });

    if (agentId && completion.costUSD > 0) {
      const query = new URLSearchParams();
      query.set('id', eq(agentId));
      const agents = await supabaseRest('ai_agents', query) as any[];
      if (agents && agents.length > 0) {
        const agent = agents[0];
        const newSpend = Number(agent.config?.current_spend ?? 0) + completion.costUSD;
        // Also atomic update isn't directly supported by pure rest patch config JSONB,
        // but this is acceptable for now.
        const newConfig = { ...agent.config, current_spend: newSpend };
        await supabaseRest('ai_agents', query, {
          method: 'PATCH',
          body: { config: newConfig }
        });
      }
    }
  } catch (err) {
    logger.error('Failed to log cost or update budget', { error: err });
  }
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

  pruneIdempotencyCache();

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
      'X-Title': 'Rasi Synthetic HR Gateway',
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
    headers['X-Title'] = 'Rasi Synthetic HR Gateway';
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
      owned_by: model.provider === 'openrouter' ? 'rasi-ai' : model.ownedBy,
    })),
  });
});

router.post('/chat/completions', async (req: Request, res: Response) => {
  if (!(await enforceApiKeyRateLimit(req, res))) {
    return;
  }

  const agentId = await checkAgentBudget(req, res);
  if (agentId === false) return; // budget exceeded or agent not found

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

    const modelConfig = normalizeModel(model);
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

    const normalizedMessages = messages.map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const chatOptions = {
      temperature: typeof temperature === 'number' ? temperature : undefined,
      maxTokens: typeof max_tokens === 'number' ? max_tokens : undefined,
    };

    let completion: {
      content: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUSD: number;
      latency: number;
    };

    if (modelConfig.provider === 'openai') {
      const aiResponse = await new OpenAIService(providerKey).chat(normalizedMessages, modelConfig.upstreamModel, chatOptions);
      completion = {
        content: aiResponse.content,
        inputTokens: aiResponse.tokenCount.input,
        outputTokens: aiResponse.tokenCount.output,
        totalTokens: aiResponse.tokenCount.total,
        costUSD: aiResponse.costUSD,
        latency: aiResponse.latency,
      };
    } else if (modelConfig.provider === 'anthropic') {
      const aiResponse = await new AnthropicService(providerKey).chat(normalizedMessages, modelConfig.upstreamModel, chatOptions);
      completion = {
        content: aiResponse.content,
        inputTokens: aiResponse.tokenCount.input,
        outputTokens: aiResponse.tokenCount.output,
        totalTokens: aiResponse.tokenCount.total,
        costUSD: aiResponse.costUSD,
        latency: aiResponse.latency,
      };
    } else {
      const aiResponse = await routeViaOpenRouter(modelConfig.upstreamModel, normalizedMessages, chatOptions);
      completion = {
        content: aiResponse.content,
        inputTokens: aiResponse.inputTokens,
        outputTokens: aiResponse.outputTokens,
        totalTokens: aiResponse.totalTokens,
        costUSD: aiResponse.costUSD,
        latency: aiResponse.latency,
      };
    }

    await updateAgentBudgetAndLogCost(req, agentId, modelConfig.id, modelConfig.provider, completion);

    if (req.apiKey?.organization_id) {
      void recordPromptCacheObservation({
        orgId: req.apiKey.organization_id,
        modelName: modelConfig.id,
        endpoint: '/v1/chat/completions',
        messages: normalizedMessages,
        totalTokens: completion.totalTokens,
        costUsd: completion.costUSD,
      });
    }

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
    logger.error('Gateway completion failed', {
      error: error.message,
      requestId: req.requestId,
      orgId: req.apiKey?.organization_id,
      keyId: req.apiKey?.id,
    });

    return res.status(500).json({
      error: {
        message: error.message || 'Gateway completion failed',
        type: 'server_error',
      },
    });
  }
});

// OpenAI legacy text completion compatibility route
router.post('/completions', async (req: Request, res: Response) => {
  if (!(await enforceApiKeyRateLimit(req, res))) {
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

export default router;
