/**
 * gateway-interceptors.ts
 *
 * Real-time prompt/response interception and model routing.
 * Loads action_policies with service='__gateway__' for an org and applies:
 *
 *  action='patch_request'  → transform user/system messages BEFORE sending to LLM
 *  action='patch_response' → transform LLM response BEFORE returning to caller
 *  action='route_model'    → override the requested model based on risk/cost signals
 */

import { supabaseRest, eq } from './supabase-rest';
import { incidentDetection } from '../services/incident-detection';
import { logger } from './logger';

// ── Types ────────────────────────────────────────────────────────────────────

export type InterceptorTransform =
  | 'redact_pii'
  | 'replace'
  | 'append_system'
  | 'prepend_system';

export type InterceptorMatchType = 'always' | 'pii_detected' | 'keyword' | 'regex';

export type InterceptorRule = {
  id?: string;
  enabled?: boolean;
  // Matching
  match_type: InterceptorMatchType;
  match_value?: string;        // keyword string or regex source
  // Transform
  transform: InterceptorTransform;
  find?: string;               // for 'replace': literal or regex source to find
  replacement?: string;        // for 'replace': replacement text (default: '[REDACTED]')
  text?: string;               // for 'append_system' / 'prepend_system'
};

export type RoutingConditionType = 'always' | 'risk_score_above' | 'monthly_cost_above';

export type RoutingCondition = {
  id?: string;
  enabled?: boolean;
  condition: RoutingConditionType;
  threshold?: number;          // 0–100 for risk_score_above; USD for monthly_cost_above
  target_model: string;        // gateway model id to switch to
};

type GatewayPolicyRow = {
  id: string;
  action: string;
  enabled: boolean;
  interceptor_rules: (InterceptorRule | RoutingCondition)[];
};

type GatewayMessage = { role: string; content: any };

// ── In-memory policy cache (30s TTL per org) ─────────────────────────────────

const CACHE_TTL_MS = 30_000;
const policyCache = new Map<string, { expiresAt: number; policies: GatewayPolicyRow[] }>();

async function loadPolicies(orgId: string): Promise<GatewayPolicyRow[]> {
  const cached = policyCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.policies;

  try {
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('service', eq('__gateway__'));
    q.set('enabled', 'eq.true');
    const rows = (await supabaseRest('action_policies', q)) as any[];
    const policies: GatewayPolicyRow[] = (rows || []).map((r: any) => ({
      id: r.id,
      action: r.action,
      enabled: r.enabled !== false,
      interceptor_rules: Array.isArray(r.interceptor_rules) ? r.interceptor_rules : [],
    }));
    policyCache.set(orgId, { expiresAt: Date.now() + CACHE_TTL_MS, policies });
    return policies;
  } catch (err: any) {
    logger.warn('gateway-interceptors: failed to load policies', { orgId, err: err?.message });
    return [];
  }
}

/** Invalidate cache for an org (call when policies are saved). */
export function invalidateInterceptorCache(orgId: string) {
  policyCache.delete(orgId);
}

// ── PII redaction helpers ────────────────────────────────────────────────────

// Ordered from most specific to least — mirrors incident-detection.ts PII_PATTERNS
const PII_REDACT: Array<[RegExp, string]> = [
  [/\b\d{4}[-\s]\d{4}[-\s]\d{4}\b/g,                                                    '[AADHAAR REDACTED]'],
  [/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,                                                        '[PAN REDACTED]'],
  [/\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,                                                    '[SSN REDACTED]'],
  [/(?:account\s*(?:no\.?|number|#)\s*[:=]?\s*)(\d{9,18})/gi,                           '[ACCT REDACTED]'],
  [/(?:passport\s*(?:no\.?|number|#)\s*[:=]?\s*)([A-Z][0-9]{7,8})/gi,                  '[PASSPORT REDACTED]'],
  [/\b[a-zA-Z0-9._-]+@(?:paytm|okaxis|oksbi|ybl|okhdfcbank|okicici|upi|apl|fbl|hdfcbank|axisbank|kotak|indus|sbi|icici|rbl|federal|sc|hsbc|pnb|iob|canara|union|boi|bob)\b/gi, '[UPI REDACTED]'],
  [/\b\d[\d\s-]{11,17}\d\b/g,                                                            '[CARD REDACTED]'],
  [/(?:\+?\d[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,                           '[PHONE REDACTED]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,                               '[EMAIL REDACTED]'],
];

function redactPii(text: string): string {
  // Use new RegExp instances each call to avoid stale lastIndex with global flag
  let result = text;
  for (const [pattern, replacement] of PII_REDACT) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), replacement);
  }
  return result;
}

// ── Match helpers ────────────────────────────────────────────────────────────

function textMatches(text: string, rule: InterceptorRule): boolean {
  switch (rule.match_type) {
    case 'always':
      return true;
    case 'pii_detected': {
      const results = incidentDetection.fullScan(text);
      return results.some(r => r.detected && r.type === 'pii_leak');
    }
    case 'keyword':
      return !!rule.match_value && text.toLowerCase().includes(rule.match_value.toLowerCase());
    case 'regex': {
      if (!rule.match_value) return false;
      try {
        return new RegExp(rule.match_value, 'i').test(text);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

// ── Transform helpers ────────────────────────────────────────────────────────

function applyTransformToText(text: string, rule: InterceptorRule): string {
  switch (rule.transform) {
    case 'redact_pii':
      return redactPii(text);
    case 'replace': {
      if (!rule.find) return text;
      try {
        const re = new RegExp(rule.find, 'gi');
        return text.replace(re, rule.replacement ?? '[REDACTED]');
      } catch {
        // Fall back to literal string replace if pattern is invalid regex
        return text.split(rule.find).join(rule.replacement ?? '[REDACTED]');
      }
    }
    // append/prepend_system are handled at the message level, not text level
    default:
      return text;
  }
}

// ── Public: request interception ────────────────────────────────────────────

/**
 * Apply PATCH_REQUEST interceptors to the message array in-place.
 * Returns the (potentially modified) messages array.
 */
export async function applyRequestInterceptors(
  orgId: string,
  messages: GatewayMessage[]
): Promise<GatewayMessage[]> {
  const policies = await loadPolicies(orgId);
  const policy = policies.find(p => p.action === 'patch_request');
  if (!policy || !policy.interceptor_rules.length) return messages;

  const rules = (policy.interceptor_rules as InterceptorRule[]).filter(r => r.enabled !== false);
  if (!rules.length) return messages;

  // Work on a shallow copy of the messages array
  const result: GatewayMessage[] = messages.map(m => ({ ...m }));

  for (const rule of rules) {
    for (const msg of result) {
      const textContent = typeof msg.content === 'string' ? msg.content : '';

      if (rule.transform === 'append_system' || rule.transform === 'prepend_system') {
        // Only apply to system messages (or inject one if none exists)
        if (msg.role === 'system') {
          if (textMatches(textContent, rule)) {
            const extra = rule.text || '';
            msg.content = rule.transform === 'append_system'
              ? `${textContent}\n${extra}`.trim()
              : `${extra}\n${textContent}`.trim();
          }
        }
      } else if (msg.role === 'user' || msg.role === 'system') {
        if (textMatches(textContent, rule)) {
          msg.content = applyTransformToText(textContent, rule);
        }
      }
    }

    // If append/prepend_system and there is no system message, inject one at position 0
    if ((rule.transform === 'append_system' || rule.transform === 'prepend_system') && rule.text) {
      const hasSystem = result.some(m => m.role === 'system');
      if (!hasSystem && rule.match_type === 'always') {
        result.unshift({ role: 'system', content: rule.text });
      }
    }
  }

  const appliedCount = rules.length;
  logger.debug('gateway-interceptors: applied request interceptors', { orgId, appliedCount });
  return result;
}

// ── Public: response interception ───────────────────────────────────────────

/**
 * Apply PATCH_RESPONSE interceptors to the LLM response content string.
 */
export async function applyResponseInterceptors(
  orgId: string,
  content: string
): Promise<string> {
  const policies = await loadPolicies(orgId);
  const policy = policies.find(p => p.action === 'patch_response');
  if (!policy || !policy.interceptor_rules.length) return content;

  const rules = (policy.interceptor_rules as InterceptorRule[]).filter(r => r.enabled !== false);
  if (!rules.length) return content;

  let result = content;
  for (const rule of rules) {
    if (rule.transform === 'append_system' || rule.transform === 'prepend_system') continue; // N/A for responses
    if (textMatches(result, rule)) {
      result = applyTransformToText(result, rule);
    }
  }

  logger.debug('gateway-interceptors: applied response interceptors', { orgId });
  return result;
}

// ── Public: model routing ────────────────────────────────────────────────────

/**
 * Check ROUTE_MODEL policies. Returns an override model id string, or null
 * if no routing condition matches. The caller resolves the model via normalizeModel().
 */
export async function resolveModelRouting(
  orgId: string,
  requestedModelId: string,
  messages: GatewayMessage[]
): Promise<string | null> {
  const policies = await loadPolicies(orgId);
  const policy = policies.find(p => p.action === 'route_model');
  if (!policy || !policy.interceptor_rules.length) return null;

  const conditions = (policy.interceptor_rules as RoutingCondition[]).filter(r => r.enabled !== false);
  if (!conditions.length) return null;

  for (const cond of conditions) {
    let matched = false;

    if (cond.condition === 'always') {
      matched = true;
    } else if (cond.condition === 'risk_score_above') {
      const riskScore = computePreflightRiskScore(messages);
      matched = riskScore > (cond.threshold ?? 70);
      if (matched) {
        logger.info('gateway-interceptors: model rerouted — risk score exceeded threshold', {
          orgId, requestedModelId, riskScore, threshold: cond.threshold, targetModel: cond.target_model,
        });
      }
    } else if (cond.condition === 'monthly_cost_above') {
      const monthlyCost = await getOrgMonthlyCostUSD(orgId);
      matched = monthlyCost > (cond.threshold ?? 10);
      if (matched) {
        logger.info('gateway-interceptors: model rerouted — monthly cost exceeded threshold', {
          orgId, requestedModelId, monthlyCost, threshold: cond.threshold, targetModel: cond.target_model,
        });
      }
    }

    if (matched && cond.target_model && cond.target_model !== requestedModelId) {
      return cond.target_model;
    }
  }

  return null;
}

// ── Helpers for model routing ────────────────────────────────────────────────

/**
 * Scan user messages and return a 0–100 risk score based on the highest
 * severity incident detected in the pre-flight text.
 */
function computePreflightRiskScore(messages: GatewayMessage[]): number {
  const userContent = messages
    .filter(m => m.role === 'user')
    .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');

  if (!userContent.trim()) return 0;

  const results = incidentDetection.fullScan(userContent);
  const highest = incidentDetection.getHighestSeverity(results);
  if (!highest || !highest.detected) return 0;

  const severityScore: Record<string, number> = { low: 20, medium: 45, high: 75, critical: 95 };
  return severityScore[highest.severity] ?? 0;
}

// ── Smart Model Tier Routing ─────────────────────────────────────────────────

export type QueryComplexityTier = 'simple' | 'standard' | 'complex';

/**
 * Classify the query complexity to support smart tier routing.
 * Uses heuristics only — no external API call required.
 *
 * simple (0–3): short messages, FAQ-like, no code/math → tier_1 model
 * standard (4–7): medium context, some reasoning → tier_2 model
 * complex (8–10): long context, code/math, multi-step → tier_3 model
 */
export function classifyQueryComplexity(messages: GatewayMessage[]): { tier: QueryComplexityTier; score: number } {
  const userMessages = messages.filter((m) => m.role === 'user');
  const lastUser = userMessages[userMessages.length - 1];
  const lastContent = lastUser ? (typeof lastUser.content === 'string' ? lastUser.content : JSON.stringify(lastUser.content)) : '';

  const allContent = messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join(' ');

  let score = 0;

  // Token count heuristic (4 chars ≈ 1 token)
  const totalTokens = Math.ceil(allContent.length / 4);
  if (totalTokens > 2000) score += 3;
  else if (totalTokens > 800) score += 2;
  else if (totalTokens > 300) score += 1;

  // Code/math indicators
  if (/```|function\s*\(|def\s+\w+|class\s+\w+|\$\{|=>|lambda|import\s+\w|SELECT\s|equation|formula|integral|derivative/i.test(lastContent)) {
    score += 2;
  }

  // Multi-step reasoning indicators
  if (/step[s]?\s+\d|compare|analyze|explain why|break down|summarize|pros and cons|trade.?off/i.test(lastContent)) {
    score += 2;
  }

  // Long last message
  if (lastContent.length > 600) score += 1;

  // Multi-turn conversation adds complexity
  if (messages.length > 6) score += 1;

  const tier: QueryComplexityTier = score <= 3 ? 'simple' : score <= 7 ? 'standard' : 'complex';
  return { tier, score };
}

/**
 * Sum this month's cost_usd for the org from cost_tracking table.
 */
async function getOrgMonthlyCostUSD(orgId: string): Promise<number> {
  try {
    const firstDay = new Date();
    firstDay.setDate(1);
    firstDay.setHours(0, 0, 0, 0);
    const q = `select=cost_usd&organization_id=eq.${orgId}&date=gte.${firstDay.toISOString().split('T')[0]}`;
    const rows = (await supabaseRest('cost_tracking', q)) as any[];
    return (rows || []).reduce((sum: number, r: any) => sum + (Number(r.cost_usd) || 0), 0);
  } catch {
    return 0; // fail open
  }
}
