import express, { Request, Response } from 'express';
import { z } from 'zod';
import { OpenAIService, AnthropicService } from '../services/ai-service';
import { requirePermission } from '../middleware/rbac';
import { supabaseRestAsUser, eq } from '../lib/supabase-rest';
import { errorResponse, getOrgId, getUserJwt } from '../lib/route-helpers';
import { logger } from '../lib/logger';
import { auditLog } from '../lib/audit-logger';
import { decryptSecret, encryptSecret } from '../lib/integrations/encryption';
import { fireChatInstrumentation } from '../lib/chat-instrumentation';

const SYSTEM_PROMPTS: Record<'operator' | 'employee' | 'external', string> = {
  operator: 'You are an AI assistant for an enterprise operator. Be concise and professional.',
  employee: 'You are an AI assistant helping an employee. For questions about payroll, personal data, or legal matters, refer employees to HR or the relevant team.',
  external: 'You are an AI assistant representing the company. Be helpful, accurate, and do not share internal information.',
};

const router = express.Router();

const runtimeProfileSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['provider', 'gateway']),
  provider: z.enum(['openai', 'anthropic', 'openrouter', 'zapheit_gateway']),
  label: z.string().min(1),
  api_key: z.string().min(1),
});

const runtimeProfileInputSchema = z.object({
  kind: z.enum(['provider', 'gateway']),
  provider: z.enum(['openai', 'anthropic', 'openrouter', 'zapheit_gateway']),
  label: z.string().min(1).max(120),
  api_key: z.string().min(1).max(4096),
}).superRefine((value, ctx) => {
  if (value.kind === 'gateway' && value.provider !== 'zapheit_gateway') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Gateway profiles must use the Zapheit gateway provider.',
      path: ['provider'],
    });
  }
  if (value.kind === 'provider' && value.provider === 'zapheit_gateway') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provider profiles must use an external provider.',
      path: ['provider'],
    });
  }
});

const createSessionSchema = z.object({
  mode: z.enum(['operator', 'employee', 'external']).optional().default('operator'),
  runtime_source: z.enum(['managed', 'provider_key', 'gateway_key']),
  runtime_profile_id: z.string().uuid().nullish(),
  runtime_profile: runtimeProfileSchema.nullish(),
  model: z.string().min(1),
});

const sendMessageSchema = z.object({
  prompt: z.string().min(1).max(20_000),
  mode: z.enum(['operator', 'employee', 'external']).optional().default('operator'),
  runtime_source: z.enum(['managed', 'provider_key', 'gateway_key']),
  runtime_profile_id: z.string().uuid().nullish(),
  runtime_profile: runtimeProfileSchema.nullish(),
  model: z.string().min(1),
});

type RuntimeSource = 'managed' | 'provider_key' | 'gateway_key';
type BillingMode = 'managed' | 'byok_provider' | 'gateway_key';
type RuntimeProfileKind = 'provider' | 'gateway';
type RuntimeProvider = 'openai' | 'anthropic' | 'openrouter' | 'zapheit_gateway';

type StoredRuntimeProfileRow = {
  id: string;
  organization_id: string;
  created_by?: string | null;
  kind: RuntimeProfileKind;
  provider: RuntimeProvider;
  label: string;
  api_key_encrypted: string;
  status?: 'active' | 'revoked' | null;
  last_used_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ResolvedRuntimeProfile = {
  id: string;
  kind: RuntimeProfileKind;
  provider: RuntimeProvider;
  label: string;
  api_key: string;
};

function nowIso() {
  return new Date().toISOString();
}

function summarizePrompt(text: string) {
  return text.trim().replace(/\s+/g, ' ').slice(0, 80) || 'New chat';
}

function inferProviderFromModel(model: string): 'openai' | 'anthropic' | 'openrouter' {
  if (model.startsWith('openai/')) return 'openai';
  if (model.startsWith('anthropic/')) return 'anthropic';
  return 'openrouter';
}

function upstreamModel(model: string) {
  return model.includes('/') ? model.split('/').slice(1).join('/') : model;
}

function billingModeForRuntimeSource(runtimeSource: RuntimeSource): BillingMode {
  if (runtimeSource === 'provider_key') return 'byok_provider';
  if (runtimeSource === 'gateway_key') return 'gateway_key';
  return 'managed';
}

function maskApiKey(secret: string) {
  const trimmed = secret.trim();
  if (!trimmed) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

function serializeRuntimeProfile(row: StoredRuntimeProfileRow) {
  let maskedKey = '••••';
  try {
    maskedKey = maskApiKey(decryptSecret(row.api_key_encrypted || ''));
  } catch {
    maskedKey = '••••';
  }
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    label: row.label,
    status: row.status || 'active',
    masked_key: maskedKey,
    last_used_at: row.last_used_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function fetchRuntimeProfile(jwt: string, orgId: string, profileId: string) {
  const query = new URLSearchParams();
  query.set('id', eq(profileId));
  query.set('organization_id', eq(orgId));
  const rows = await supabaseRestAsUser(jwt, 'chat_runtime_profiles', query) as StoredRuntimeProfileRow[];
  return rows?.[0] || null;
}

async function touchRuntimeProfile(jwt: string, orgId: string, profileId: string) {
  await supabaseRestAsUser(jwt, 'chat_runtime_profiles', new URLSearchParams([
    ['id', eq(profileId)],
    ['organization_id', eq(orgId)],
  ]), {
    method: 'PATCH',
    body: {
      last_used_at: nowIso(),
      updated_at: nowIso(),
    },
  }).catch(() => []);
}

async function resolveRuntimeProfile(
  jwt: string,
  orgId: string,
  runtimeSource: RuntimeSource,
  runtimeProfileId?: string | null,
  inlineRuntimeProfile?: z.infer<typeof runtimeProfileSchema> | null,
): Promise<ResolvedRuntimeProfile | null> {
  if (runtimeSource === 'managed') return null;

  let profile: ResolvedRuntimeProfile | null = null;
  if (runtimeProfileId) {
    const stored = await fetchRuntimeProfile(jwt, orgId, runtimeProfileId);
    if (!stored || stored.status === 'revoked') {
      throw new Error('Chat runtime profile not found');
    }
    profile = {
      id: stored.id,
      kind: stored.kind,
      provider: stored.provider,
      label: stored.label,
      api_key: decryptSecret(stored.api_key_encrypted || ''),
    };
  } else if (inlineRuntimeProfile) {
    profile = {
      id: inlineRuntimeProfile.id,
      kind: inlineRuntimeProfile.kind,
      provider: inlineRuntimeProfile.provider,
      label: inlineRuntimeProfile.label,
      api_key: inlineRuntimeProfile.api_key,
    };
  }

  if (!profile) {
    throw new Error('A saved runtime profile is required for this runtime source.');
  }

  if (runtimeSource === 'gateway_key' && profile.kind !== 'gateway') {
    throw new Error('Gateway mode requires a Zapheit gateway profile.');
  }
  if (runtimeSource === 'provider_key' && profile.kind !== 'provider') {
    throw new Error('Provider-key mode requires an external provider profile.');
  }

  return profile;
}

async function fetchConversation(jwt: string, orgId: string, conversationId: string) {
  const conversationQuery = new URLSearchParams();
  conversationQuery.set('id', eq(conversationId));
  conversationQuery.set('organization_id', eq(orgId));
  const conversationRows = await supabaseRestAsUser(jwt, 'conversations', conversationQuery) as any[];
  return conversationRows?.[0] || null;
}

async function fetchConversationWithMessages(jwt: string, orgId: string, conversationId: string) {
  const conversation = await fetchConversation(jwt, orgId, conversationId);
  if (!conversation) return null;

  const messagesQuery = new URLSearchParams();
  messagesQuery.set('conversation_id', eq(conversationId));
  messagesQuery.set('order', 'created_at.asc');
  const messages = await supabaseRestAsUser(jwt, 'messages', messagesQuery) as any[];
  return { ...conversation, messages: messages || [] };
}

async function createConversation(jwt: string, orgId: string, userId: string, input: {
  mode: 'operator' | 'employee' | 'external';
  runtimeSource: RuntimeSource;
  runtimeProfileId?: string | null;
  runtimeLabel?: string | null;
  model: string;
}) {
  const created = await supabaseRestAsUser(jwt, 'conversations', '', {
    method: 'POST',
    body: {
      organization_id: orgId,
      user_id: userId,
      platform: 'internal',
      status: 'active',
      started_at: nowIso(),
      created_at: nowIso(),
      metadata: {
        session_type: 'standard_chat_session',
        mode: input.mode,
        runtime_source: input.runtimeSource,
        runtime_profile_id: input.runtimeProfileId || null,
        runtime_label: input.runtimeLabel || null,
        model: input.model,
        topic: 'New chat',
        preview: '',
      },
    },
    headers: { Prefer: 'return=representation' },
  }) as any[];

  return created?.[0] || null;
}

async function callOpenRouter(model: string, apiKey: string, messages: Array<{ role: string; content: string }>) {
  type OpenRouterPayload = {
    error?: { message?: string };
    message?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
  };
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://zapheit.com',
      'X-Title': 'Zapheit Chat',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });

  const payload = await response.json().catch(() => ({})) as OpenRouterPayload;
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `OpenRouter request failed: ${response.status}`);
  }

  return {
    content: payload?.choices?.[0]?.message?.content || '',
    usage: {
      input_tokens: Number(payload?.usage?.prompt_tokens || 0),
      output_tokens: Number(payload?.usage?.completion_tokens || 0),
      total_tokens: Number(payload?.usage?.total_tokens || 0),
      cost_usd: Number(payload?.usage?.cost || 0) || null,
    },
  };
}

async function callGatewayCompletion(req: Request, apiKey: string, model: string, messages: Array<{ role: string; content: string }>) {
  type GatewayPayload = {
    error?: { message?: string };
    message?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
  };
  const gatewayBase = getGatewayBase(req);

  const response = await fetch(`${gatewayBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });

  const payload = await response.json().catch(() => ({})) as GatewayPayload;
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Gateway request failed: ${response.status}`);
  }

  return {
    content: payload?.choices?.[0]?.message?.content || '',
    usage: {
      input_tokens: Number(payload?.usage?.prompt_tokens || 0),
      output_tokens: Number(payload?.usage?.completion_tokens || 0),
      total_tokens: Number(payload?.usage?.total_tokens || 0),
      cost_usd: Number(payload?.usage?.cost || 0) || null,
    },
  };
}

function getGatewayBase(req: Request) {
  const explicitBase = (process.env.INTERNAL_API_BASE_URL || process.env.PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
  const derivedBase = `${req.protocol || 'http'}://${req.get('host') || 'localhost:3001'}`;
  return explicitBase || derivedBase;
}

async function runStandardChatCompletion(req: Request, input: {
  runtimeSource: RuntimeSource;
  runtimeProfile?: z.infer<typeof runtimeProfileSchema> | null;
  model: string;
  mode: 'operator' | 'employee' | 'external';
  messages: Array<{ role: string; content: string }>;
}) {
  const provider = input.runtimeSource === 'provider_key'
    ? input.runtimeProfile?.provider === 'zapheit_gateway'
      ? 'openrouter'
      : (input.runtimeProfile?.provider || inferProviderFromModel(input.model))
    : inferProviderFromModel(input.model);

  const messagesWithSystemPrompt = [
    { role: 'system', content: SYSTEM_PROMPTS[input.mode] },
    ...input.messages,
  ];

  if (input.runtimeSource === 'gateway_key') {
    if (!input.runtimeProfile?.api_key) throw new Error('Gateway key profile is missing a usable key.');
    const t0 = Date.now();
    const result = await callGatewayCompletion(req, input.runtimeProfile.api_key, input.model, messagesWithSystemPrompt);
    return { ...result, latency_ms: Date.now() - t0, provider: 'gateway' };
  }

  if (provider === 'openai') {
    const apiKey = input.runtimeSource === 'provider_key'
      ? input.runtimeProfile?.api_key
      : (process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '');
    if (!apiKey) throw new Error('OpenAI provider key missing.');
    const service = new OpenAIService(apiKey);
    const t0 = Date.now();
    const result = await service.chat(messagesWithSystemPrompt, upstreamModel(input.model), { temperature: 0.7 });
    return {
      content: result.content,
      latency_ms: Date.now() - t0,
      provider: 'openai',
      usage: {
        input_tokens: result.tokenCount.input,
        output_tokens: result.tokenCount.output,
        total_tokens: result.tokenCount.total,
        cost_usd: result.costUSD,
      },
    };
  }

  if (provider === 'anthropic') {
    const apiKey = input.runtimeSource === 'provider_key'
      ? input.runtimeProfile?.api_key
      : (process.env.RASI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '');
    if (!apiKey) throw new Error('Anthropic provider key missing.');
    const service = new AnthropicService(apiKey);
    const t0 = Date.now();
    const result = await service.chat(messagesWithSystemPrompt, upstreamModel(input.model), { temperature: 0.7 });
    return {
      content: result.content,
      latency_ms: Date.now() - t0,
      provider: 'anthropic',
      usage: {
        input_tokens: result.tokenCount.input,
        output_tokens: result.tokenCount.output,
        total_tokens: result.tokenCount.total,
        cost_usd: result.costUSD,
      },
    };
  }

  const openRouterKey = input.runtimeSource === 'provider_key'
    ? input.runtimeProfile?.api_key
    : (process.env.RASI_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '');
  if (!openRouterKey) throw new Error('OpenRouter provider key missing.');
  const t0 = Date.now();
  const result = await callOpenRouter(input.model, openRouterKey, messagesWithSystemPrompt);
  return { ...result, latency_ms: Date.now() - t0, provider: 'openrouter' };
}

router.get('/chat/runtime-profiles', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const jwt = getUserJwt(req);
    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    const rows = await supabaseRestAsUser(jwt, 'chat_runtime_profiles', query) as StoredRuntimeProfileRow[];

    res.json({
      success: true,
      data: (rows || []).map(serializeRuntimeProfile),
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.post('/chat/runtime-profiles', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const parsed = runtimeProfileInputSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((error) => error.message) });
    }

    const orgId = getOrgId(req);
    const userId = req.user?.id;
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);
    if (!userId) return errorResponse(res, new Error('Authentication required'), 401);

    const jwt = getUserJwt(req);
    const now = nowIso();
    const created = await supabaseRestAsUser(jwt, 'chat_runtime_profiles', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        created_by: userId,
        kind: parsed.data.kind,
        provider: parsed.data.provider,
        label: parsed.data.label.trim(),
        api_key_encrypted: encryptSecret(parsed.data.api_key.trim()),
        status: 'active',
        metadata: {},
        created_at: now,
        updated_at: now,
      },
      headers: { Prefer: 'return=representation' },
    }) as StoredRuntimeProfileRow[];

    const profile = created?.[0];
    if (!profile) {
      return res.status(500).json({ success: false, error: 'Failed to save chat runtime profile' });
    }

    await auditLog.log({
      user_id: userId,
      action: 'chat_runtime_profile.created',
      resource_type: 'chat_runtime_profile',
      resource_id: profile.id,
      organization_id: orgId,
      metadata: {
        kind: profile.kind,
        provider: profile.provider,
        label: profile.label,
      },
    });

    res.status(201).json({
      success: true,
      data: serializeRuntimeProfile(profile),
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.delete('/chat/runtime-profiles/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = req.user?.id;
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);
    if (!userId) return errorResponse(res, new Error('Authentication required'), 401);

    const jwt = getUserJwt(req);
    const existing = await fetchRuntimeProfile(jwt, orgId, req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Chat runtime profile not found' });
    }

    await supabaseRestAsUser(jwt, 'chat_runtime_profiles', new URLSearchParams([
      ['id', eq(req.params.id)],
      ['organization_id', eq(orgId)],
    ]), {
      method: 'DELETE',
    });

    await auditLog.log({
      user_id: userId,
      action: 'chat_runtime_profile.deleted',
      resource_type: 'chat_runtime_profile',
      resource_id: existing.id,
      organization_id: orgId,
      metadata: {
        provider: existing.provider,
        label: existing.label,
      },
    });

    res.json({
      success: true,
      data: { id: existing.id },
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.get('/chat/runtime-profiles/:id/models', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const jwt = getUserJwt(req);
    const profile = await fetchRuntimeProfile(jwt, orgId, req.params.id);
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Chat runtime profile not found' });
    }
    if (profile.kind !== 'gateway') {
      return res.status(400).json({ success: false, error: 'Only gateway profiles can list gateway models' });
    }

    const apiKey = decryptSecret(profile.api_key_encrypted || '');
    const response = await fetch(`${getGatewayBase(req)}/v1/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: (payload as any)?.error?.message || (payload as any)?.message || 'Failed to load gateway models',
      });
    }

    res.json({
      success: true,
      data: payload,
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.post('/chat/sessions', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const parsed = createSessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((error) => error.message) });
    }

    const orgId = getOrgId(req);
    const userId = req.user?.id;
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);
    if (!userId) return errorResponse(res, new Error('Authentication required'), 401);
    const jwt = getUserJwt(req);
    let runtimeProfile: ResolvedRuntimeProfile | null = null;
    try {
      runtimeProfile = await resolveRuntimeProfile(
        jwt,
        orgId,
        parsed.data.runtime_source,
        parsed.data.runtime_profile_id || null,
        parsed.data.runtime_profile || null,
      );
    } catch (error: any) {
      const status = String(error?.message || '').includes('not found') ? 404 : 400;
      return errorResponse(res, error, status);
    }

    const session = await createConversation(jwt, orgId, userId, {
      mode: parsed.data.mode,
      runtimeSource: parsed.data.runtime_source,
      runtimeProfileId: runtimeProfile?.id || null,
      runtimeLabel: runtimeProfile?.label || (parsed.data.runtime_source === 'managed' ? 'Zapheit Managed' : null),
      model: parsed.data.model,
    });

    if (!session?.id) {
      return res.status(500).json({ success: false, error: 'Failed to create chat session' });
    }

    res.json({
      success: true,
      data: {
        session_id: session.id,
        session_type: 'standard_chat_session',
        runtime_source: parsed.data.runtime_source,
        runtime_profile_id: runtimeProfile?.id || null,
        runtime_label: runtimeProfile?.label || (parsed.data.runtime_source === 'managed' ? 'Zapheit Managed' : null),
        model: parsed.data.model,
        billing_mode: billingModeForRuntimeSource(parsed.data.runtime_source),
        conversation: session,
      },
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.post('/chat/sessions/:id/messages', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const parsed = sendMessageSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((error) => error.message) });
    }

    const orgId = getOrgId(req);
    const userId = req.user?.id;
    const jwt = getUserJwt(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);
    if (!userId) return errorResponse(res, new Error('Authentication required'), 401);
    let runtimeProfile: ResolvedRuntimeProfile | null = null;
    try {
      runtimeProfile = await resolveRuntimeProfile(
        jwt,
        orgId,
        parsed.data.runtime_source,
        parsed.data.runtime_profile_id || null,
        parsed.data.runtime_profile || null,
      );
    } catch (error: any) {
      const status = String(error?.message || '').includes('not found') ? 404 : 400;
      return errorResponse(res, error, status);
    }

    const conversation = await fetchConversation(jwt, orgId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Chat session not found' });
    }

    if (conversation.metadata?.session_type && conversation.metadata.session_type !== 'standard_chat_session') {
      return res.status(409).json({ success: false, error: 'This session is not a standard chat session' });
    }

    const messagesQuery = new URLSearchParams();
    messagesQuery.set('conversation_id', eq(conversation.id));
    messagesQuery.set('order', 'created_at.asc');
    const historyRows = await supabaseRestAsUser(jwt, 'messages', messagesQuery) as any[];

    const prompt = parsed.data.prompt.trim();
    const now = nowIso();

    const createdUserMessage = await supabaseRestAsUser(jwt, 'messages', '', {
      method: 'POST',
      body: {
        conversation_id: conversation.id,
        role: 'user',
        content: prompt,
        token_count: 0,
        created_at: now,
      },
      headers: { Prefer: 'return=representation' },
    }) as any[];

    const llmMessages = [
      ...((historyRows || []).map((message: any) => ({
        role: String(message.role || 'user'),
        content: String(message.content || ''),
      }))),
      { role: 'user', content: prompt },
    ];

    const completion = await runStandardChatCompletion(req, {
      runtimeSource: parsed.data.runtime_source,
      runtimeProfile: runtimeProfile ? {
        id: runtimeProfile.id,
        kind: runtimeProfile.kind,
        provider: runtimeProfile.provider,
        label: runtimeProfile.label,
        api_key: runtimeProfile.api_key,
      } : null,
      model: parsed.data.model,
      mode: parsed.data.mode,
      messages: llmMessages,
    });

    const assistantContent = completion.content || 'No response returned.';
    const createdAssistantMessage = await supabaseRestAsUser(jwt, 'messages', '', {
      method: 'POST',
      body: {
        conversation_id: conversation.id,
        role: 'assistant',
        content: assistantContent,
        token_count: completion.usage.total_tokens,
        cost_usd: completion.usage.cost_usd,
        metadata: {
          runtime_source: parsed.data.runtime_source,
          runtime_profile_id: runtimeProfile?.id || null,
          runtime_label: runtimeProfile?.label || (parsed.data.runtime_source === 'managed' ? 'Zapheit Managed' : null),
          billing_mode: billingModeForRuntimeSource(parsed.data.runtime_source),
          model: parsed.data.model,
          usage: completion.usage,
        },
        created_at: nowIso(),
      },
      headers: { Prefer: 'return=representation' },
    }) as any[];

    void fireChatInstrumentation({
      orgId,
      conversationId: conversation.id,
      agentId: conversation.agent_id || null,
      model: parsed.data.model,
      provider: completion.provider || inferProviderFromModel(parsed.data.model),
      inputTokens: completion.usage.input_tokens,
      outputTokens: completion.usage.output_tokens,
      costUSD: completion.usage.cost_usd || 0,
      latencyMs: completion.latency_ms || 0,
      messages: llmMessages,
      assistantContent,
      requestId: req.headers['x-request-id'] as string || conversation.id,
    });

    const topic = summarizePrompt(prompt);
    const updatedConversation = await supabaseRestAsUser(jwt, 'conversations', new URLSearchParams([
      ['id', eq(conversation.id)],
      ['organization_id', eq(orgId)],
    ]), {
      method: 'PATCH',
      body: {
        metadata: {
          ...(conversation.metadata && typeof conversation.metadata === 'object' ? conversation.metadata : {}),
          session_type: 'standard_chat_session',
          mode: parsed.data.mode,
          runtime_source: parsed.data.runtime_source,
          runtime_profile_id: runtimeProfile?.id || null,
          runtime_label: runtimeProfile?.label || (parsed.data.runtime_source === 'managed' ? 'Zapheit Managed' : null),
          model: parsed.data.model,
          billing_mode: billingModeForRuntimeSource(parsed.data.runtime_source),
          topic,
          preview: assistantContent.slice(0, 200),
          last_user_message: prompt.slice(0, 200),
          last_runtime_usage: completion.usage,
        },
      },
      headers: { Prefer: 'return=representation' },
    }) as any[];

    const conversationWithMessages = await fetchConversationWithMessages(jwt, orgId, conversation.id);
    const finalConversation = conversationWithMessages || { ...(updatedConversation?.[0] || conversation), messages: [] };
    if (runtimeProfile?.id) {
      await touchRuntimeProfile(jwt, orgId, runtimeProfile.id);
    }

    res.json({
      success: true,
      data: {
        session_id: conversation.id,
        session_type: 'standard_chat_session',
        runtime_source: parsed.data.runtime_source,
        runtime_profile_id: runtimeProfile?.id || null,
        runtime_label: runtimeProfile?.label || (parsed.data.runtime_source === 'managed' ? 'Zapheit Managed' : null),
        model: parsed.data.model,
        billing_mode: billingModeForRuntimeSource(parsed.data.runtime_source),
        usage: completion.usage,
        message: createdAssistantMessage?.[0] || null,
        conversation: finalConversation,
      },
    });
  } catch (error: any) {
    logger.error('Standard chat send failed', { error: error?.message || String(error) });
    errorResponse(res, error);
  }
});

// POST /chat/sessions/:id/messages/stream — SSE streaming variant of standard chat.
// Set Cloud Run --timeout=3600 so long completions are not killed at the default 60s.
// Falls back: clients may add ?stream=false to use the non-streaming endpoint instead.
router.post('/chat/sessions/:id/messages/stream', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  const sseWrite = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const parsed = sendMessageSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });
    }

    const orgId = getOrgId(req);
    const userId = req.user?.id;
    const jwt = getUserJwt(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    let runtimeProfile: ResolvedRuntimeProfile | null = null;
    try {
      runtimeProfile = await resolveRuntimeProfile(
        jwt, orgId,
        parsed.data.runtime_source,
        parsed.data.runtime_profile_id || null,
        parsed.data.runtime_profile || null,
      );
    } catch (error: any) {
      const status = String(error?.message || '').includes('not found') ? 404 : 400;
      return res.status(status).json({ success: false, error: error.message });
    }

    const conversation = await fetchConversation(jwt, orgId, req.params.id);
    if (!conversation) return res.status(404).json({ success: false, error: 'Chat session not found' });
    if (conversation.metadata?.session_type && conversation.metadata.session_type !== 'standard_chat_session') {
      return res.status(409).json({ success: false, error: 'This session is not a standard chat session' });
    }

    const messagesQuery = new URLSearchParams();
    messagesQuery.set('conversation_id', eq(conversation.id));
    messagesQuery.set('order', 'created_at.asc');
    const historyRows = await supabaseRestAsUser(jwt, 'messages', messagesQuery) as any[];

    const prompt = parsed.data.prompt.trim();

    await supabaseRestAsUser(jwt, 'messages', '', {
      method: 'POST',
      body: { conversation_id: conversation.id, role: 'user', content: prompt, token_count: 0, created_at: nowIso() },
      headers: { Prefer: 'return=representation' },
    });

    const llmMessages = [
      ...((historyRows || []).map((m: any) => ({ role: String(m.role || 'user'), content: String(m.content || '') }))),
      { role: 'user', content: prompt },
    ];

    const messagesWithSystem = [
      { role: 'system', content: SYSTEM_PROMPTS[parsed.data.mode] },
      ...llmMessages,
    ];

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();

    let aborted = false;
    req.on('close', () => { aborted = true; });

    const provider = parsed.data.runtime_source === 'provider_key'
      ? (runtimeProfile?.provider === 'zapheit_gateway' ? 'openrouter' : (runtimeProfile?.provider || inferProviderFromModel(parsed.data.model)))
      : inferProviderFromModel(parsed.data.model);

    let accumulated = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let costUSD = 0;
    const t0 = Date.now();

    try {
      // gateway_key falls back to non-streaming since callGatewayCompletion does not yet stream
      if (parsed.data.runtime_source === 'gateway_key') {
        if (!runtimeProfile?.api_key) throw new Error('Gateway key profile is missing a usable key.');
        const result = await callGatewayCompletion(req, runtimeProfile.api_key, parsed.data.model, messagesWithSystem);
        accumulated = result.content || '';
        inputTokens = result.usage?.input_tokens || 0;
        outputTokens = result.usage?.output_tokens || 0;
        costUSD = result.usage?.cost_usd || 0;
        sseWrite({ type: 'delta', content: accumulated });
      } else if (provider === 'openai') {
        const apiKey = parsed.data.runtime_source === 'provider_key'
          ? runtimeProfile?.api_key
          : (process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '');
        if (!apiKey) throw new Error('OpenAI provider key missing.');
        const service = new OpenAIService(apiKey);
        for await (const chunk of service.chatStream(messagesWithSystem, upstreamModel(parsed.data.model), { temperature: 0.7 })) {
          if (aborted) break;
          if ('delta' in chunk) {
            accumulated += chunk.delta;
            sseWrite({ type: 'delta', content: chunk.delta });
          } else {
            inputTokens = chunk.inputTokens;
            outputTokens = chunk.outputTokens;
            costUSD = chunk.costUSD;
          }
        }
      } else if (provider === 'anthropic') {
        const apiKey = parsed.data.runtime_source === 'provider_key'
          ? runtimeProfile?.api_key
          : (process.env.RASI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '');
        if (!apiKey) throw new Error('Anthropic provider key missing.');
        const service = new AnthropicService(apiKey);
        for await (const chunk of service.chatStream(messagesWithSystem, upstreamModel(parsed.data.model), { temperature: 0.7 })) {
          if (aborted) break;
          if ('delta' in chunk) {
            accumulated += chunk.delta;
            sseWrite({ type: 'delta', content: chunk.delta });
          } else {
            inputTokens = chunk.inputTokens;
            outputTokens = chunk.outputTokens;
            costUSD = chunk.costUSD;
          }
        }
      } else {
        const openRouterKey = parsed.data.runtime_source === 'provider_key'
          ? runtimeProfile?.api_key
          : (process.env.RASI_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '');
        if (!openRouterKey) throw new Error('OpenRouter provider key missing.');
        const result = await callOpenRouter(parsed.data.model, openRouterKey, messagesWithSystem);
        accumulated = result.content || '';
        inputTokens = result.usage?.input_tokens || 0;
        outputTokens = result.usage?.output_tokens || 0;
        costUSD = result.usage?.cost_usd || 0;
        sseWrite({ type: 'delta', content: accumulated });
      }
    } catch (streamErr: any) {
      sseWrite({ type: 'error', error: streamErr?.message || 'Stream error' });
      res.end();
      return;
    }

    if (aborted) {
      res.end();
      return;
    }

    const assistantContent = accumulated || 'No response returned.';
    const latencyMs = Date.now() - t0;

    const createdAssistantMessage = await supabaseRestAsUser(jwt, 'messages', '', {
      method: 'POST',
      body: {
        conversation_id: conversation.id,
        role: 'assistant',
        content: assistantContent,
        token_count: inputTokens + outputTokens,
        cost_usd: costUSD,
        metadata: {
          runtime_source: parsed.data.runtime_source,
          runtime_profile_id: runtimeProfile?.id || null,
          runtime_label: runtimeProfile?.label || (parsed.data.runtime_source === 'managed' ? 'Zapheit Managed' : null),
          billing_mode: billingModeForRuntimeSource(parsed.data.runtime_source),
          model: parsed.data.model,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens, cost_usd: costUSD },
        },
        created_at: nowIso(),
      },
      headers: { Prefer: 'return=representation' },
    }) as any[];

    void fireChatInstrumentation({
      orgId,
      conversationId: conversation.id,
      agentId: conversation.agent_id || null,
      model: parsed.data.model,
      provider: String(provider),
      inputTokens,
      outputTokens,
      costUSD,
      latencyMs,
      messages: llmMessages,
      assistantContent,
      requestId: req.headers['x-request-id'] as string || conversation.id,
    });

    if (runtimeProfile?.id) {
      await touchRuntimeProfile(jwt, orgId, runtimeProfile.id);
    }

    sseWrite({
      type: 'done',
      message: createdAssistantMessage?.[0] || null,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens, cost_usd: costUSD },
    });
    res.end();
  } catch (error: any) {
    logger.error('Standard chat stream failed', { error: error?.message || String(error) });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Internal server error' });
    } else {
      try { sseWrite({ type: 'error', error: 'Internal server error' }); res.end(); } catch { /* already closed */ }
    }
  }
});

export default router;
