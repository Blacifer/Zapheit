/**
 * policy-engine.ts
 * Policy-as-Code engine for Rasi.
 *
 * Parses YAML policy definitions, evaluates them against a request/response
 * context, and returns enforcement decisions (block, warn, redact,
 * require_approval, route_to_model).
 *
 * YAML schema example:
 * ---
 * name: "Block PII in external webhooks"
 * description: "GDPR - prevent PII leaving the org via webhooks"
 * enforcement_level: block
 * rules:
 *   - id: r1
 *     description: "Block emails in outbound webhook payloads"
 *     condition:
 *       all_of:
 *         - field: context.service
 *           op: eq
 *           value: webhook
 *         - field: content
 *           op: matches
 *           value: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}"
 *     action: block
 *     reason: "PII (email) detected in outbound webhook payload"
 */

import * as yaml from 'js-yaml';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EnforcementLevel = 'block' | 'warn' | 'audit';
export type RuleAction = 'block' | 'warn' | 'redact' | 'require_approval' | 'route_to_model';
export type ConditionOp =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'not_contains' | 'matches' | 'not_matches'
  | 'in' | 'not_in' | 'exists' | 'not_exists';

export interface SimpleCondition {
  field: string;
  op: ConditionOp;
  value?: unknown;
}

export interface CompositeCondition {
  all_of?: Array<SimpleCondition | CompositeCondition>;
  any_of?: Array<SimpleCondition | CompositeCondition>;
  not?: SimpleCondition | CompositeCondition;
}

export type Condition = SimpleCondition | CompositeCondition;

export interface PolicyRule {
  id: string;
  description?: string;
  condition: Condition;
  action: RuleAction;
  reason?: string;
  /** For route_to_model: which model to use */
  target_model?: string;
  /** For require_approval: minimum role required */
  required_role?: string;
}

export interface PolicyDefinition {
  name: string;
  description?: string;
  enforcement_level: EnforcementLevel;
  rules: PolicyRule[];
}

export interface PolicyViolation {
  rule_id: string;
  rule_description?: string;
  action: RuleAction;
  reason: string;
  policy_name: string;
}

export interface PolicyEvalResult {
  /** Final decision: block > require_approval > warn > audit > allow */
  decision: 'block' | 'require_approval' | 'warn' | 'allow';
  violations: PolicyViolation[];
  /** For require_approval: minimum role required across all violations */
  required_role?: string;
  /** For route_to_model: first matched target */
  target_model?: string;
}

export interface EvalContext {
  /** The full message/prompt text being evaluated */
  content?: string;
  /** Arbitrary metadata (service, action, amount, agent_id, etc.) */
  context?: Record<string, unknown>;
  /** Extra flat fields merged into root for field resolution */
  [key: string]: unknown;
}

// ── YAML Parsing ──────────────────────────────────────────────────────────────

export function parsePolicy(yamlSource: string): PolicyDefinition {
  const raw = yaml.load(yamlSource) as Record<string, unknown>;

  if (!raw || typeof raw !== 'object') {
    throw new Error('Policy YAML must be a mapping object');
  }
  if (typeof raw.name !== 'string') {
    throw new Error('Policy must have a string "name" field');
  }
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) {
    throw new Error('Policy must have at least one rule in the "rules" array');
  }

  const validLevels: EnforcementLevel[] = ['block', 'warn', 'audit'];
  const level = (raw.enforcement_level as EnforcementLevel) ?? 'warn';
  if (!validLevels.includes(level)) {
    throw new Error(`Invalid enforcement_level: "${level}". Must be one of: ${validLevels.join(', ')}`);
  }

  const validActions: RuleAction[] = ['block', 'warn', 'redact', 'require_approval', 'route_to_model'];
  const rules: PolicyRule[] = (raw.rules as Array<Record<string, unknown>>).map((r, i) => {
    if (!r.id) throw new Error(`Rule at index ${i} is missing an "id"`);
    if (!r.condition) throw new Error(`Rule "${r.id}" is missing a "condition"`);
    if (!r.action || !validActions.includes(r.action as RuleAction)) {
      throw new Error(`Rule "${r.id}" has invalid action: "${r.action}"`);
    }
    return r as unknown as PolicyRule;
  });

  return {
    name: raw.name,
    description: raw.description as string | undefined,
    enforcement_level: level,
    rules,
  };
}

export function validateYaml(yamlSource: string): { valid: boolean; error?: string } {
  try {
    parsePolicy(yamlSource);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

// ── Field Resolution ──────────────────────────────────────────────────────────

function resolveDotPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function resolveField(ctx: EvalContext, field: string): unknown {
  // Allow dot-paths like context.service or context.amount
  return resolveDotPath(ctx as unknown as Record<string, unknown>, field);
}

// ── Condition Evaluation ──────────────────────────────────────────────────────

function isSimpleCondition(c: Condition): c is SimpleCondition {
  return 'field' in c;
}

function evalSimple(cond: SimpleCondition, ctx: EvalContext): boolean {
  const actual = resolveField(ctx, cond.field);
  const expected = cond.value;

  switch (cond.op) {
    case 'exists':    return actual !== undefined && actual !== null;
    case 'not_exists': return actual === undefined || actual === null;
    case 'eq':        return actual === expected;
    case 'neq':       return actual !== expected;
    case 'gt':        return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte':       return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt':        return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte':       return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'contains':
      if (typeof actual === 'string') return actual.includes(String(expected));
      if (Array.isArray(actual)) return actual.includes(expected);
      return false;
    case 'not_contains':
      if (typeof actual === 'string') return !actual.includes(String(expected));
      if (Array.isArray(actual)) return !actual.includes(expected);
      return true;
    case 'matches': {
      if (typeof actual !== 'string' || typeof expected !== 'string') return false;
      try { return new RegExp(expected, 'i').test(actual); } catch { return false; }
    }
    case 'not_matches': {
      if (typeof actual !== 'string' || typeof expected !== 'string') return true;
      try { return !new RegExp(expected, 'i').test(actual); } catch { return true; }
    }
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual);
    default:
      return false;
  }
}

function evalCondition(cond: Condition, ctx: EvalContext): boolean {
  if (isSimpleCondition(cond)) {
    return evalSimple(cond, ctx);
  }

  const composite = cond as CompositeCondition;

  if (composite.all_of) {
    return composite.all_of.every(c => evalCondition(c, ctx));
  }
  if (composite.any_of) {
    return composite.any_of.some(c => evalCondition(c, ctx));
  }
  if (composite.not !== undefined) {
    return !evalCondition(composite.not, ctx);
  }
  return false;
}

// ── Policy Evaluation ─────────────────────────────────────────────────────────

export function evaluatePolicy(policy: PolicyDefinition, ctx: EvalContext): PolicyEvalResult {
  const violations: PolicyViolation[] = [];

  for (const rule of policy.rules) {
    if (evalCondition(rule.condition, ctx)) {
      violations.push({
        rule_id: rule.id,
        rule_description: rule.description,
        action: rule.action,
        reason: rule.reason ?? `Rule "${rule.id}" matched`,
        policy_name: policy.name,
      });
    }
  }

  if (violations.length === 0) {
    return { decision: 'allow', violations: [] };
  }

  // Determine final decision by priority: block > require_approval > warn > allow
  let decision: PolicyEvalResult['decision'] = 'allow';
  let required_role: string | undefined;
  let target_model: string | undefined;

  for (const v of violations) {
    const rule = policy.rules.find(r => r.id === v.rule_id)!;
    if (v.action === 'block') {
      decision = 'block';
      break;
    }
    if (v.action === 'require_approval') {
      if ((decision as string) !== 'block') decision = 'require_approval';
      if (rule.required_role && (!required_role || roleLevel(rule.required_role) > roleLevel(required_role))) {
        required_role = rule.required_role;
      }
    }
    if (v.action === 'route_to_model' && !target_model) {
      target_model = rule.target_model;
    }
    if (v.action === 'warn' && decision === 'allow') {
      decision = 'warn';
    }
  }

  return { decision, violations, required_role, target_model };
}

/** Evaluate an array of policies; first block wins, otherwise escalate. */
export function evaluatePolicies(policies: PolicyDefinition[], ctx: EvalContext): PolicyEvalResult {
  const allViolations: PolicyViolation[] = [];
  let finalDecision: PolicyEvalResult['decision'] = 'allow';
  let required_role: string | undefined;
  let target_model: string | undefined;

  for (const policy of policies) {
    const result = evaluatePolicy(policy, ctx);
    allViolations.push(...result.violations);

    if (result.decision === 'block') {
      finalDecision = 'block';
      break;
    }
    if (result.decision === 'require_approval' && (finalDecision as string) !== 'block') {
      finalDecision = 'require_approval';
      if (result.required_role) {
        required_role = result.required_role;
      }
    }
    if (result.decision === 'warn' && finalDecision === 'allow') {
      finalDecision = 'warn';
    }
    if (result.target_model && !target_model) {
      target_model = result.target_model;
    }
  }

  return { decision: finalDecision, violations: allViolations, required_role, target_model };
}

// ── Utility ───────────────────────────────────────────────────────────────────

function roleLevel(role: string): number {
  const levels: Record<string, number> = {
    viewer: 1, manager: 2, admin: 3, super_admin: 4,
  };
  return levels[role] ?? 0;
}

/** Compute Shannon entropy of a string (bits per character). */
export function computeEntropy(text: string): number {
  if (!text || text.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const ch of text) {
    freq[ch] = (freq[ch] ?? 0) + 1;
  }
  const len = text.length;
  return Object.values(freq).reduce((acc, count) => {
    const p = count / len;
    return acc - p * Math.log2(p);
  }, 0);
}

/** Built-in compliance policy YAML templates. */
export const POLICY_TEMPLATES: Record<string, string> = {
  gdpr: `
name: "GDPR — PII Protection"
description: "Block PII in outbound webhooks and flag data access"
enforcement_level: block
rules:
  - id: gdpr_pii_email
    description: "Block email addresses in external payloads"
    condition:
      all_of:
        - field: context.service
          op: eq
          value: webhook
        - field: content
          op: matches
          value: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}"
    action: block
    reason: "GDPR: Email (PII) detected in outbound webhook"
  - id: gdpr_pii_phone
    description: "Block phone numbers in external payloads"
    condition:
      all_of:
        - field: context.service
          op: eq
          value: webhook
        - field: content
          op: matches
          value: "\\\\+?[0-9\\\\s\\\\-().]{10,}"
    action: block
    reason: "GDPR: Phone number (PII) detected in outbound webhook"
`.trim(),

  hipaa: `
name: "HIPAA — PHI Protection"
description: "Block Protected Health Information from leaving the org"
enforcement_level: block
rules:
  - id: hipaa_ssn
    description: "Block SSN patterns"
    condition:
      field: content
      op: matches
      value: "\\\\b\\\\d{3}-\\\\d{2}-\\\\d{4}\\\\b"
    action: block
    reason: "HIPAA: SSN (PHI) detected"
  - id: hipaa_dob
    description: "Flag date-of-birth patterns for review"
    condition:
      field: content
      op: matches
      value: "\\\\b(DOB|date of birth|born on)\\\\b"
    action: require_approval
    required_role: admin
    reason: "HIPAA: Date of birth reference requires admin approval"
`.trim(),

  eu_ai_act: `
name: "EU AI Act — High-Risk Decision Review"
description: "Require human review for high-risk AI decisions"
enforcement_level: warn
rules:
  - id: eu_ai_high_risk
    description: "Require approval for high-risk actions"
    condition:
      any_of:
        - field: context.risk_score
          op: gte
          value: 0.7
        - field: context.action
          op: in
          value: ["terminate", "deny", "reject", "dismiss"]
    action: require_approval
    required_role: manager
    reason: "EU AI Act: High-risk decision requires human review"
`.trim(),

  soc2: `
name: "SOC2 — Access Control"
description: "Enforce access controls and audit requirements"
enforcement_level: audit
rules:
  - id: soc2_sensitive_data
    description: "Audit all access to sensitive data categories"
    condition:
      field: context.resource_type
      op: in
      value: ["credentials", "api_keys", "payment_info", "personal_data"]
    action: warn
    reason: "SOC2: Sensitive data access logged for audit"
`.trim(),

  cost_guardrails: `
name: "Cost Guardrails"
description: "Block requests exceeding per-agent token budget"
enforcement_level: block
rules:
  - id: cost_high_token_request
    description: "Block requests with very large token counts"
    condition:
      field: context.estimated_tokens
      op: gte
      value: 50000
    action: block
    reason: "Cost guardrail: Request exceeds 50k token limit"
`.trim(),
};
