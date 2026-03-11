import crypto from 'crypto';
import { supabaseAdmin } from './supabase';

export interface PricingModelRate {
  id: string;
  label: string;
  provider: string;
  category: string;
  tokenPriceInr: number;
}

export interface PricingConfig {
  requestPriceInr: number;
  batchDiscount: number;
  gstRate: number;
  models: PricingModelRate[];
}

export interface SavedPricingQuote {
  id: string;
  name: string;
  scenarioId: string;
  scenarioName: string;
  createdAt: string;
  totalInr: number;
  totalWithoutCachingInr: number;
  annualRunRateInr: number;
  gstMode: 'excluded' | 'included';
  monthlyRequests: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  repeatableContext: number;
  batchShare: number;
  agentCount: number;
  cacheEnabled: boolean;
  mixRows: Array<{ modelId: string; allocation: number }>;
  shareUrl?: string;
}

const MAX_QUOTES = 24;

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  requestPriceInr: 0.002,
  batchDiscount: 0.2,
  gstRate: 0.18,
  models: [
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI', category: 'Best value', tokenPriceInr: 0.00002 },
    { id: 'openai/gpt-4o', label: 'GPT-4o', provider: 'OpenAI', category: 'Premium reasoning', tokenPriceInr: 0.00009 },
    { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'OpenAI', category: 'Fast iteration', tokenPriceInr: 0.00003 },
    { id: 'anthropic/claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', provider: 'Anthropic', category: 'Long-form quality', tokenPriceInr: 0.0001 },
    { id: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku', provider: 'Anthropic', category: 'Low-latency', tokenPriceInr: 0.000018 },
    { id: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'Google', category: 'Cost efficient', tokenPriceInr: 0.000015 },
    { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B', provider: 'Meta', category: 'Open model', tokenPriceInr: 0.000022 },
    { id: 'mistral/mistral-large', label: 'Mistral Large', provider: 'Mistral', category: 'Enterprise drafting', tokenPriceInr: 0.00005 },
  ],
};

function sanitizeModels(models: any): PricingModelRate[] {
  if (!Array.isArray(models) || models.length === 0) return DEFAULT_PRICING_CONFIG.models;
  return models
    .filter((model) => model && typeof model.id === 'string' && typeof model.label === 'string')
    .map((model) => ({
      id: String(model.id),
      label: String(model.label),
      provider: String(model.provider || 'Custom'),
      category: String(model.category || 'Custom'),
      tokenPriceInr: Number(model.tokenPriceInr || 0),
    }))
    .filter((model) => Number.isFinite(model.tokenPriceInr) && model.tokenPriceInr >= 0);
}

function sanitizeQuotes(quotes: any): SavedPricingQuote[] {
  if (!Array.isArray(quotes)) return [];
  return quotes.slice(0, MAX_QUOTES).filter((quote) => quote && typeof quote.id === 'string');
}

async function loadOrgSettings(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('settings')
    .eq('id', orgId)
    .single();

  if (error) throw error;
  return (data?.settings as Record<string, any> | null) || {};
}

async function persistOrgSettings(orgId: string, settings: Record<string, any>) {
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ settings })
    .eq('id', orgId);

  if (error) throw error;
}

export async function getPricingState(orgId: string) {
  const settings = await loadOrgSettings(orgId);
  const pricing = settings.rasi_pricing || {};
  return {
    config: {
      requestPriceInr: Number(pricing.config?.requestPriceInr ?? DEFAULT_PRICING_CONFIG.requestPriceInr),
      batchDiscount: Number(pricing.config?.batchDiscount ?? DEFAULT_PRICING_CONFIG.batchDiscount),
      gstRate: Number(pricing.config?.gstRate ?? DEFAULT_PRICING_CONFIG.gstRate),
      models: sanitizeModels(pricing.config?.models),
    },
    quotes: sanitizeQuotes(pricing.quotes),
  };
}

export async function updatePricingConfig(orgId: string, updates: Partial<PricingConfig>) {
  const settings = await loadOrgSettings(orgId);
  const current = await getPricingState(orgId);
  const next = {
    config: {
      requestPriceInr: Number(updates.requestPriceInr ?? current.config.requestPriceInr),
      batchDiscount: Number(updates.batchDiscount ?? current.config.batchDiscount),
      gstRate: Number(updates.gstRate ?? current.config.gstRate),
      models: updates.models ? sanitizeModels(updates.models) : current.config.models,
    },
    quotes: current.quotes,
  };

  await persistOrgSettings(orgId, {
    ...settings,
    rasi_pricing: next,
  });

  return next;
}

export async function savePricingQuote(orgId: string, quote: Omit<SavedPricingQuote, 'id' | 'createdAt'>) {
  const settings = await loadOrgSettings(orgId);
  const current = await getPricingState(orgId);
  const nextQuote: SavedPricingQuote = {
    ...quote,
    id: `quote_${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  };

  const next = {
    config: current.config,
    quotes: [nextQuote, ...current.quotes].slice(0, MAX_QUOTES),
  };

  await persistOrgSettings(orgId, {
    ...settings,
    rasi_pricing: next,
  });

  return next;
}

export async function deletePricingQuote(orgId: string, quoteId: string) {
  const settings = await loadOrgSettings(orgId);
  const current = await getPricingState(orgId);
  const next = {
    config: current.config,
    quotes: current.quotes.filter((quote) => quote.id !== quoteId),
  };

  await persistOrgSettings(orgId, {
    ...settings,
    rasi_pricing: next,
  });

  return next;
}
