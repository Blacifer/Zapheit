import crypto from 'crypto';
import { logger } from './logger';
import { supabaseAdmin } from './supabase';

export interface PromptCachePolicy {
  enabled: boolean;
  minContextTokens: number;
  retentionHours: number;
  cacheScope: 'organization' | 'agent';
  matchMode: 'exact' | 'normalized';
}

interface PromptCacheEntry {
  id: string;
  keyHash: string;
  keyPreview: string;
  modelName: string;
  endpoint: string;
  contextTokens: number;
  firstSeenAt: string;
  lastUsedAt: string;
  hits: number;
  requestsSeen: number;
  estimatedSavedTokens: number;
  estimatedSavedCostUsd: number;
}

interface PromptCacheStats {
  totalObservedRequests: number;
  eligibleRequests: number;
  observedHits: number;
  estimatedSavedTokens: number;
  estimatedSavedCostUsd: number;
  hitRate: number;
  averageSavingsPercent: number;
  lastUpdatedAt: string | null;
}

interface PromptCachingState {
  policy: PromptCachePolicy;
  telemetry: {
    stats: PromptCacheStats;
    entries: PromptCacheEntry[];
  };
}

const DEFAULT_POLICY: PromptCachePolicy = {
  enabled: true,
  minContextTokens: 1200,
  retentionHours: 24,
  cacheScope: 'organization',
  matchMode: 'normalized',
};

const DEFAULT_STATS: PromptCacheStats = {
  totalObservedRequests: 0,
  eligibleRequests: 0,
  observedHits: 0,
  estimatedSavedTokens: 0,
  estimatedSavedCostUsd: 0,
  hitRate: 0,
  averageSavingsPercent: 0,
  lastUpdatedAt: null,
};

const MAX_ENTRIES = 50;

function normalizeText(input: string) {
  return input.replace(/\s+/g, ' ').trim();
}

function estimateTokenCount(input: string) {
  return Math.ceil(input.length / 4);
}

function sanitizeEntries(entries: PromptCacheEntry[] | undefined) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, MAX_ENTRIES);
}

function buildState(settings: Record<string, any> | null | undefined): PromptCachingState {
  const stored = settings?.rasi_prompt_caching || {};
  return {
    policy: {
      ...DEFAULT_POLICY,
      ...(stored.policy || {}),
    },
    telemetry: {
      stats: {
        ...DEFAULT_STATS,
        ...(stored.telemetry?.stats || {}),
      },
      entries: sanitizeEntries(stored.telemetry?.entries),
    },
  };
}

async function loadOrgState(orgId: string): Promise<{ settings: Record<string, any>; state: PromptCachingState }> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('settings')
    .eq('id', orgId)
    .single();

  if (error) throw error;

  const settings = (data?.settings as Record<string, any> | null) || {};
  return { settings, state: buildState(settings) };
}

async function persistOrgState(orgId: string, settings: Record<string, any>, state: PromptCachingState) {
  const nextSettings = {
    ...settings,
    rasi_prompt_caching: state,
  };

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ settings: nextSettings })
    .eq('id', orgId);

  if (error) throw error;
}

export async function getPromptCachingState(orgId: string) {
  const { state } = await loadOrgState(orgId);
  return state;
}

export async function updatePromptCachingPolicy(orgId: string, updates: Partial<PromptCachePolicy>) {
  const { settings, state } = await loadOrgState(orgId);
  state.policy = {
    ...state.policy,
    ...updates,
  };
  await persistOrgState(orgId, settings, state);
  return state;
}

export async function recordPromptCacheObservation(params: {
  orgId: string;
  modelName: string;
  endpoint: string;
  messages: Array<{ role: string; content: string }>;
  totalTokens: number;
  costUsd: number;
}) {
  const { orgId, modelName, endpoint, messages, totalTokens, costUsd } = params;

  try {
    const { settings, state } = await loadOrgState(orgId);
    const policy = state.policy;
    if (!policy.enabled) return;

    const prefixMessages = messages.length > 1
      ? messages.slice(0, -1)
      : messages.filter((message) => message.role !== 'user');

    const rawContext = prefixMessages
      .map((message) => `[${message.role}] ${message.content}`)
      .join('\n\n')
      .trim();

    if (!rawContext) return;

    const comparableText = policy.matchMode === 'normalized' ? normalizeText(rawContext) : rawContext;
    const contextTokens = estimateTokenCount(comparableText);
    if (contextTokens < policy.minContextTokens) return;

    const keyHash = crypto.createHash('sha256').update(comparableText).digest('hex');
    const keyPreview = `${normalizeText(rawContext).slice(0, 120)}${rawContext.length > 120 ? '...' : ''}`;
    const nowIso = new Date().toISOString();
    const retentionMs = policy.retentionHours * 60 * 60 * 1000;

    state.telemetry.entries = state.telemetry.entries
      .filter((entry) => (Date.now() - new Date(entry.lastUsedAt).getTime()) <= retentionMs)
      .slice(0, MAX_ENTRIES);

    state.telemetry.stats.totalObservedRequests += 1;
    state.telemetry.stats.eligibleRequests += 1;

    const existing = state.telemetry.entries.find((entry) => entry.keyHash === keyHash && entry.modelName === modelName);
    if (existing) {
      existing.hits += 1;
      existing.requestsSeen += 1;
      existing.lastUsedAt = nowIso;
      existing.estimatedSavedTokens += contextTokens;

      const estimatedSavedCostUsd = totalTokens > 0
        ? costUsd * Math.min(1, contextTokens / totalTokens) * 0.9
        : 0;
      existing.estimatedSavedCostUsd += estimatedSavedCostUsd;

      state.telemetry.stats.observedHits += 1;
      state.telemetry.stats.estimatedSavedTokens += contextTokens;
      state.telemetry.stats.estimatedSavedCostUsd += estimatedSavedCostUsd;
    } else {
      state.telemetry.entries.unshift({
        id: `pc_${crypto.randomUUID()}`,
        keyHash,
        keyPreview,
        modelName,
        endpoint,
        contextTokens,
        firstSeenAt: nowIso,
        lastUsedAt: nowIso,
        hits: 0,
        requestsSeen: 1,
        estimatedSavedTokens: 0,
        estimatedSavedCostUsd: 0,
      });
    }

    state.telemetry.entries = state.telemetry.entries.slice(0, MAX_ENTRIES);
    state.telemetry.stats.hitRate = state.telemetry.stats.eligibleRequests > 0
      ? Math.round((state.telemetry.stats.observedHits / state.telemetry.stats.eligibleRequests) * 100)
      : 0;
    state.telemetry.stats.averageSavingsPercent = state.telemetry.stats.eligibleRequests > 0
      ? Math.round((state.telemetry.stats.observedHits / state.telemetry.stats.eligibleRequests) * (policy.matchMode === 'normalized' ? 38 : 28))
      : 0;
    state.telemetry.stats.lastUpdatedAt = nowIso;

    await persistOrgState(orgId, settings, state);
  } catch (error: any) {
    logger.warn('Prompt cache observation failed', {
      orgId,
      error: error?.message,
    });
  }
}
