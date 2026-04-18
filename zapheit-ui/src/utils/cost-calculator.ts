/**
 * AI Model Cost Calculator
 * Calculates token-based costs for various LLM providers and models
 */

export interface ModelPricing {
  [model: string]: {
    input: number;   // Cost per 1M input tokens
    output: number;  // Cost per 1M output tokens
  };
}

const PRICING: ModelPricing = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  'gemini-pro': { input: 0.000125, output: 0.000375 },
};

const DEFAULT_PRICING = { input: 0.01, output: 0.03 };

/**
 * Calculate cost for tokens
 * Assumes 40% input tokens, 60% output tokens
 */
export const calculateTokenCost = (totalTokens: number, model: string): number => {
  const rates = PRICING[model] || DEFAULT_PRICING;
  const inputTokens = Math.floor(totalTokens * 0.4);
  const outputTokens = Math.floor(totalTokens * 0.6);

  const inputCost = (inputTokens / 1000000) * rates.input;
  const outputCost = (outputTokens / 1000000) * rates.output;

  return inputCost + outputCost;
};

/**
 * Calculate cost breakdown by token type
 */
export const calculateTokenCostBreakdown = (
  inputTokens: number,
  outputTokens: number,
  model: string
): { input: number; output: number; total: number } => {
  const rates = PRICING[model] || DEFAULT_PRICING;

  const inputCost = (inputTokens / 1000000) * rates.input;
  const outputCost = (outputTokens / 1000000) * rates.output;

  return {
    input: inputCost,
    output: outputCost,
    total: inputCost + outputCost,
  };
};

/**
 * Get pricing for a specific model
 */
export const getModelPricing = (model: string) => {
  return PRICING[model] || DEFAULT_PRICING;
};

/**
 * Format cost as USD currency string
 */
export const formatCost = (cost: number): string => {
  return `$${cost.toFixed(4)}`;
};

/**
 * Estimate daily cost based on request count and avg tokens
 */
export const estimateDailyCost = (
  requestCount: number,
  avgTokensPerRequest: number,
  model: string
): number => {
  const costPerRequest = calculateTokenCost(avgTokensPerRequest, model);
  return costPerRequest * requestCount;
};
