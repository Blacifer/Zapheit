type GovernedActionSource = 'gateway' | 'connector_console' | 'runtime';
type GovernedActionDecision = 'executed' | 'pending_approval' | 'blocked';
type GovernedActionResult = 'succeeded' | 'failed' | 'pending' | 'blocked';

export type GovernedActionSummary = {
  version: 1;
  source: GovernedActionSource;
  decision: GovernedActionDecision;
  result: GovernedActionResult;
  service: string;
  action: string;
  recorded_at: string;
  policy_id?: string | null;
  required_role?: string | null;
  approval_required?: boolean;
  approval_id?: string | null;
  block_reasons?: string[];
  approval_reasons?: string[];
  idempotency_key?: string | null;
  job_id?: string | null;
  agent_id?: string | null;
  requested_by?: string | null;
  delegated_actor?: string | null;
  audit_ref?: string | null;
  duration_ms?: number | null;
};

type SnapshotArgs = {
  source: GovernedActionSource;
  service: string;
  action: string;
  recordedAt: string;
  decision: GovernedActionDecision;
  result: GovernedActionResult;
  policyId?: string | null;
  requiredRole?: string | null;
  approvalRequired?: boolean;
  approvalId?: string | null;
  constraints?: Record<string, any>;
  constraintEvaluation?: Record<string, any>;
  idempotencyKey?: string | null;
  jobId?: string | null;
  agentId?: string | null;
  requestedBy?: string | null;
  delegatedActor?: string | null;
  auditRef?: string | null;
  durationMs?: number | null;
  blockReasons?: string[];
  approvalReasons?: string[];
  existingSnapshot?: Record<string, any> | null;
};

export function buildGovernedActionSnapshot({
  source,
  service,
  action,
  recordedAt,
  decision,
  result,
  policyId = null,
  requiredRole = null,
  approvalRequired = false,
  approvalId = null,
  constraints = {},
  constraintEvaluation = {},
  idempotencyKey = null,
  jobId = null,
  agentId = null,
  requestedBy = null,
  delegatedActor = null,
  auditRef = null,
  durationMs = null,
  blockReasons = [],
  approvalReasons = [],
  existingSnapshot = {},
}: SnapshotArgs): Record<string, any> {
  return {
    ...(existingSnapshot || {}),
    policy_id: policyId,
    require_approval: approvalRequired,
    required_role: requiredRole,
    constraints,
    constraint_evaluation: constraintEvaluation,
    governed_action: {
      version: 1,
      source,
      decision,
      result,
      service,
      action,
      recorded_at: recordedAt,
      policy_id: policyId,
      required_role: requiredRole,
      approval_required: approvalRequired,
      approval_id: approvalId,
      block_reasons: blockReasons,
      approval_reasons: approvalReasons,
      idempotency_key: idempotencyKey,
      job_id: jobId,
      agent_id: agentId,
      requested_by: requestedBy,
      delegated_actor: delegatedActor,
      audit_ref: auditRef,
      duration_ms: durationMs,
    } satisfies GovernedActionSummary,
  };
}

export function normalizeGovernedActionSummary(row: {
  connector_id: string;
  action: string;
  success: boolean;
  error_message?: string | null;
  approval_required?: boolean;
  approval_id?: string | null;
  requested_by?: string | null;
  agent_id?: string | null;
  created_at: string;
  duration_ms?: number | null;
  policy_snapshot?: Record<string, any> | null;
}): GovernedActionSummary {
  const governed = row.policy_snapshot?.governed_action as Partial<GovernedActionSummary> | undefined;
  if (governed && typeof governed === 'object') {
    return {
      version: 1,
      source: governed.source || 'connector_console',
      decision: governed.decision || 'executed',
      result: governed.result || (row.success ? 'succeeded' : row.approval_required ? 'pending' : 'failed'),
      service: governed.service || row.connector_id,
      action: governed.action || row.action,
      recorded_at: governed.recorded_at || row.created_at,
      policy_id: governed.policy_id ?? row.policy_snapshot?.policy_id ?? null,
      required_role: governed.required_role ?? row.policy_snapshot?.required_role ?? null,
      approval_required: governed.approval_required ?? row.approval_required ?? false,
      approval_id: governed.approval_id ?? row.approval_id ?? null,
      block_reasons: Array.isArray(governed.block_reasons) ? governed.block_reasons : [],
      approval_reasons: Array.isArray(governed.approval_reasons) ? governed.approval_reasons : [],
      idempotency_key: governed.idempotency_key ?? null,
      job_id: governed.job_id ?? null,
      agent_id: governed.agent_id ?? row.agent_id ?? null,
      requested_by: governed.requested_by ?? row.requested_by ?? null,
      delegated_actor: governed.delegated_actor ?? null,
      audit_ref: governed.audit_ref ?? null,
      duration_ms: governed.duration_ms ?? row.duration_ms ?? null,
    };
  }

  return {
    version: 1,
    source: 'connector_console',
    decision: row.approval_required && row.approval_id && !row.success ? 'pending_approval' : 'executed',
    result: row.approval_required && row.approval_id && !row.success ? 'pending' : row.success ? 'succeeded' : 'failed',
    service: row.connector_id,
    action: row.action,
    recorded_at: row.created_at,
    policy_id: row.policy_snapshot?.policy_id ?? null,
    required_role: row.policy_snapshot?.required_role ?? null,
    approval_required: row.approval_required ?? false,
    approval_id: row.approval_id ?? null,
    block_reasons: row.error_message && !row.success ? [row.error_message] : [],
    approval_reasons: [],
    idempotency_key: null,
    job_id: null,
    agent_id: row.agent_id ?? null,
    requested_by: row.requested_by ?? null,
    delegated_actor: null,
    audit_ref: null,
    duration_ms: row.duration_ms ?? null,
  };
}
