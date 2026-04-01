// ---------------------------------------------------------------------------
// Pre-Flight Execution Gate
//
// Mandatory checkpoint called before every connector action fires.
// Enforces action policies, scans outbound params for PII, and checks
// per-agent daily action limits (blast radius).
//
// On block  → returns { allowed: false, blockReason }
// On pending approval → returns { allowed: false, blockReason, approvalRequired: true }
// On clear  → returns { allowed: true }
// ---------------------------------------------------------------------------

import crypto from 'crypto';
import { evaluatePolicyConstraints } from './action-policy-constraints';
import { incidentDetection } from '../services/incident-detection';
import { supabaseRest, eq, gte } from './supabase-rest';
import { logger } from './logger';

export type PreflightResult =
  | { allowed: true }
  | { allowed: false; blockReason: string; approvalRequired?: boolean; approvalData?: ApprovalData };

type ApprovalData = {
  service: string;
  action: string;
  action_payload: Record<string, any>;
  required_role: string;
  action_policy_id?: string;
  agent_id?: string;
};

// Scan all string leaf values in a params object for PII.
function flattenParamValues(params: Record<string, any>): string {
  const parts: string[] = [];
  function walk(node: any) {
    if (typeof node === 'string') {
      parts.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  }
  walk(params);
  return parts.join(' ');
}

// Find the first string field key that contains PII (for error messaging).
function firstPiiField(params: Record<string, any>): string | null {
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      const result = incidentDetection.detectPII(value);
      if (result.detected) return key;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = firstPiiField(value as Record<string, any>);
      if (nested) return `${key}.${nested}`;
    }
  }
  return null;
}

export async function runPreflightGate(
  orgId: string,
  connectorId: string,
  action: string,
  params: Record<string, any>,
  agentId?: string | null,
): Promise<PreflightResult> {
  // -------------------------------------------------------------------
  // 1. Look up action policy for this connector + action (or wildcard '*')
  // -------------------------------------------------------------------
  let policy: any = null;
  try {
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('enabled', 'eq.true');
    // Try exact match first
    q.set('service', eq(connectorId));
    q.set('action', eq(action));
    q.set('limit', '1');
    const rows = (await supabaseRest('action_policies', q)) as any[];
    policy = rows?.[0] ?? null;

    // Fallback: wildcard action '*' for this connector
    if (!policy) {
      const q2 = new URLSearchParams();
      q2.set('organization_id', eq(orgId));
      q2.set('enabled', 'eq.true');
      q2.set('service', eq(connectorId));
      q2.set('action', 'eq.*');
      q2.set('limit', '1');
      const rows2 = (await supabaseRest('action_policies', q2)) as any[];
      policy = rows2?.[0] ?? null;
    }
  } catch (err: any) {
    // Policy lookup failure → fail open (don't block legitimate traffic)
    logger.warn('[preflight] Policy lookup failed, proceeding without policy check', {
      orgId, connectorId, action, error: err?.message,
    });
  }

  // -------------------------------------------------------------------
  // 2. Policy constraints evaluation (emergency disable, entity scope,
  //    amount thresholds, business hours, dual approval)
  // -------------------------------------------------------------------
  if (policy) {
    if (!policy.enabled) {
      return {
        allowed: false,
        blockReason: `Action "${connectorId}.${action}" is disabled by policy`,
      };
    }

    const constraints = policy.policy_constraints ?? {};
    const evaluation = evaluatePolicyConstraints(params, constraints);

    if (evaluation.blocked) {
      return {
        allowed: false,
        blockReason: evaluation.blockReasons.join('; '),
      };
    }

    const needsApproval = evaluation.approvalRequired || policy.require_approval;
    if (needsApproval) {
      return {
        allowed: false,
        blockReason: `Action "${connectorId}.${action}" requires human approval before it can execute. ${evaluation.approvalReasons.join('; ')}`.trim(),
        approvalRequired: true,
        approvalData: {
          service: connectorId,
          action,
          action_payload: params,
          required_role: evaluation.requiredRole ?? policy.required_role ?? 'manager',
          action_policy_id: policy.id,
          ...(agentId ? { agent_id: agentId } : {}),
        },
      };
    }

    // -------------------------------------------------------------------
    // 3. Blast-radius / daily action limit check
    // -------------------------------------------------------------------
    const dailyLimit: number | null = constraints.daily_action_limit ?? null;
    if (dailyLimit != null && Number.isFinite(dailyLimit) && dailyLimit > 0) {
      try {
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const countQ = new URLSearchParams();
        countQ.set('organization_id', eq(orgId));
        countQ.set('connector_id', eq(connectorId));
        countQ.set('created_at', gte(todayStart.toISOString()));
        countQ.set('select', 'id');
        const rows = (await supabaseRest('connector_action_executions', countQ)) as any[];
        const todayCount = rows?.length ?? 0;
        if (todayCount >= dailyLimit) {
          return {
            allowed: false,
            blockReason: `Daily action limit of ${dailyLimit} for "${connectorId}" exceeded (${todayCount} actions taken today). Try again tomorrow or raise the limit in Action Policies.`,
          };
        }
      } catch (err: any) {
        logger.warn('[preflight] Blast-radius count query failed, skipping limit check', {
          orgId, connectorId, error: err?.message,
        });
      }
    }
  }

  // -------------------------------------------------------------------
  // 4. Capability enforcement: check enabled_capabilities for this connector.
  //    Empty array (the default) means all capabilities are allowed.
  // -------------------------------------------------------------------
  try {
    const capQ = new URLSearchParams();
    capQ.set('organization_id', eq(orgId));
    capQ.set('service_type', eq(connectorId));
    capQ.set('select', 'enabled_capabilities');
    capQ.set('limit', '1');
    const capRows = (await supabaseRest('integrations', capQ)) as any[];
    const enabledCaps: string[] = capRows?.[0]?.enabled_capabilities ?? [];
    if (enabledCaps.length > 0 && !enabledCaps.includes(action)) {
      return {
        allowed: false,
        blockReason: `Capability "${action}" is not enabled for ${connectorId}. Enable it in Apps → Permissions.`,
      };
    }
  } catch (err: any) {
    logger.warn('[preflight] Capability check failed, allowing through', { orgId, connectorId, action, error: err?.message });
  }

  // -------------------------------------------------------------------
  // 5. Request-side DLP: scan outbound param values for PII
  // -------------------------------------------------------------------
  const flatText = flattenParamValues(params);
  if (flatText.trim()) {
    const piiResult = incidentDetection.detectPII(flatText);
    if (piiResult.detected && (piiResult.severity === 'high' || piiResult.severity === 'critical')) {
      const fieldHint = firstPiiField(params);
      const fieldMsg = fieldHint ? ` (detected in field "${fieldHint}")` : '';
      return {
        allowed: false,
        blockReason: `Action blocked by DLP policy: outbound params contain ${piiResult.details}${fieldMsg}. Remove sensitive data and retry.`,
      };
    }
  }

  return { allowed: true };
}

// Generate a SHA-256 idempotency fingerprint for a connector action.
// Used to detect duplicate calls across retries or network failures.
export function connectorActionFingerprint(
  orgId: string,
  connectorId: string,
  action: string,
  params: Record<string, any>,
): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  return crypto
    .createHash('sha256')
    .update(`${orgId}:${connectorId}:${action}:${sorted}`)
    .digest('hex');
}
