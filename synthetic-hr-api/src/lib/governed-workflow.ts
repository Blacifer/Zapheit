export type WorkflowEntrySource = 'apps' | 'chat' | 'template';
export type GovernedWorkflowStatus =
  | 'initiated'
  | 'policy_evaluated'
  | 'pending_approval'
  | 'approved'
  | 'denied'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ApprovalSource = 'approval_request' | 'job_approval';

export type CostStatusSummary = {
  state: 'captured' | 'unavailable' | 'outside_scope';
  amount: number | null;
  currency: 'USD' | null;
  reason: string | null;
};

export type ApprovalSummary = {
  approval_source: ApprovalSource;
  approval_id: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
  required_role: string | null;
  decision_at: string | null;
  approver: string | null;
  job_id: string | null;
  source: WorkflowEntrySource;
  source_ref: string | null;
};

export type GovernedExecutionSummary = {
  source: WorkflowEntrySource;
  source_ref: string | null;
  job_id: string | null;
  status: GovernedWorkflowStatus;
  policy_result: {
    policy_id: string | null;
    required_role: string | null;
    approval_required: boolean;
    reasons: string[];
  };
  approval: ApprovalSummary | null;
  audit_ref: string | null;
  cost_status: CostStatusSummary;
  incident_ref: string | null;
};

type GenericJob = {
  id?: string | null;
  type?: string | null;
  status?: string | null;
  input?: any;
  output?: any;
  error?: string | null;
  approval?: any;
  required_role?: string | null;
};

type GenericExecution = {
  id?: string | null;
  connector_id?: string | null;
  action?: string | null;
  approval_required?: boolean | null;
  approval_id?: string | null;
  success?: boolean | null;
  error_message?: string | null;
  policy_snapshot?: Record<string, any> | null;
  audit_ref?: string | null;
  result?: Record<string, any> | null;
};

type GenericApproval = {
  id?: string | null;
  status?: string | null;
  required_role?: string | null;
  reviewed_at?: string | null;
  reviewer_id?: string | null;
  reviewer_note?: string | null;
  action_payload?: Record<string, any> | null;
  expires_at?: string | null;
  job_id?: string | null;
  approved_by?: string | null;
  decided_at?: string | null;
  policy_snapshot?: Record<string, any> | null;
};

function workflowMetaFromRecord(record: any): Record<string, any> {
  if (!record || typeof record !== 'object') return {};
  if (record.workflow && typeof record.workflow === 'object') return record.workflow;
  if (record._workflow && typeof record._workflow === 'object') return record._workflow;
  return {};
}

export function inferWorkflowEntrySource(args: {
  job?: GenericJob | null;
  approval?: GenericApproval | null;
  execution?: GenericExecution | null;
  fallback?: WorkflowEntrySource;
}): WorkflowEntrySource {
  const workflowHints = [
    workflowMetaFromRecord(args.job?.input),
    workflowMetaFromRecord(args.job?.output),
    workflowMetaFromRecord(args.approval?.action_payload),
    workflowMetaFromRecord(args.approval?.policy_snapshot),
    workflowMetaFromRecord(args.execution?.policy_snapshot),
  ];

  for (const hint of workflowHints) {
    const source = String(hint?.source || '').trim().toLowerCase();
    if (source === 'apps' || source === 'chat' || source === 'template') return source;
  }

  const jobType = String(args.job?.type || '').trim().toLowerCase();
  if (jobType === 'chat_turn') return 'chat';
  if (jobType === 'workflow_run') return 'template';
  if (jobType === 'connector_action') return 'apps';
  return args.fallback || 'apps';
}

export function inferWorkflowSourceRef(args: {
  job?: GenericJob | null;
  approval?: GenericApproval | null;
}): string | null {
  const candidates = [
    workflowMetaFromRecord(args.job?.input)?.source_ref,
    workflowMetaFromRecord(args.job?.output)?.source_ref,
    workflowMetaFromRecord(args.approval?.action_payload)?.source_ref,
    workflowMetaFromRecord(args.approval?.policy_snapshot)?.source_ref,
    args.approval?.job_id,
    args.job?.id,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }
  return null;
}

export function normalizeApprovalStatus(status: string | null | undefined): ApprovalSummary['status'] {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'approved') return 'approved';
  if (normalized === 'rejected' || normalized === 'denied') return 'denied';
  if (normalized === 'expired') return 'expired';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  return 'pending';
}

export function mapJobStatusToGovernedStatus(jobStatus: string | null | undefined, approvalStatus?: string | null): GovernedWorkflowStatus {
  const normalizedJobStatus = String(jobStatus || '').trim().toLowerCase();
  const normalizedApprovalStatus = normalizeApprovalStatus(approvalStatus);

  if (normalizedJobStatus === 'running') return 'executing';
  if (normalizedJobStatus === 'succeeded') return 'completed';
  if (normalizedJobStatus === 'failed') return 'failed';
  if (normalizedJobStatus === 'canceled' || normalizedJobStatus === 'cancelled') return 'cancelled';
  if (normalizedJobStatus === 'pending_approval') return 'pending_approval';
  if (normalizedApprovalStatus === 'denied') return 'denied';
  if (normalizedApprovalStatus === 'approved') return normalizedJobStatus === 'queued' ? 'approved' : 'policy_evaluated';
  if (normalizedJobStatus === 'queued') return 'policy_evaluated';
  return 'initiated';
}

export function extractCostStatus(args: {
  job?: GenericJob | null;
  execution?: GenericExecution | null;
  source?: WorkflowEntrySource;
}): CostStatusSummary {
  const jobOutput = args.job?.output && typeof args.job.output === 'object' ? args.job.output : {};
  const executionResult = args.execution?.result && typeof args.execution.result === 'object' ? args.execution.result : {};

  const amountCandidates = [
    jobOutput?.cost_status?.amount,
    jobOutput?.usage?.cost_usd,
    jobOutput?.cost_usd,
    jobOutput?.total_cost_usd,
    executionResult?.usage?.cost_usd,
    executionResult?.cost_usd,
    executionResult?.total_cost_usd,
  ];

  for (const candidate of amountCandidates) {
    const amount = Number(candidate);
    if (Number.isFinite(amount) && amount >= 0) {
      return {
        state: 'captured',
        amount,
        currency: 'USD',
        reason: null,
      };
    }
  }

  if ((args.source || inferWorkflowEntrySource({ job: args.job || null })) === 'apps') {
    return {
      state: 'outside_scope',
      amount: null,
      currency: null,
      reason: 'Zapheit-observed cost is not captured for direct connector execution paths yet.',
    };
  }

  return {
    state: 'unavailable',
    amount: null,
    currency: null,
    reason: 'Zapheit-observed cost was not attached to this execution.',
  };
}

function buildPolicyResult(args: {
  job?: GenericJob | null;
  approval?: GenericApproval | null;
  execution?: GenericExecution | null;
}) {
  const approvalSnapshot = args.approval?.policy_snapshot && typeof args.approval.policy_snapshot === 'object'
    ? args.approval.policy_snapshot
    : {};
  const executionSnapshot = args.execution?.policy_snapshot && typeof args.execution.policy_snapshot === 'object'
    ? args.execution.policy_snapshot
    : {};
  const connectorPolicy = approvalSnapshot.connector_policy && typeof approvalSnapshot.connector_policy === 'object'
    ? approvalSnapshot.connector_policy
    : {};
  const governed = executionSnapshot.governed_action && typeof executionSnapshot.governed_action === 'object'
    ? executionSnapshot.governed_action
    : {};

  const approvalReasons = Array.isArray(governed.approval_reasons)
    ? governed.approval_reasons
    : Array.isArray(connectorPolicy.constraint_evaluation?.approvalReasons)
      ? connectorPolicy.constraint_evaluation.approvalReasons
      : [];
  const blockReasons = Array.isArray(governed.block_reasons) ? governed.block_reasons : [];

  return {
    policy_id: String(governed.policy_id || connectorPolicy.policy_id || approvalSnapshot.policy_id || '').trim() || null,
    required_role: String(governed.required_role || approvalSnapshot.required_role || args.job?.required_role || '').trim() || null,
    approval_required: Boolean(
      governed.approval_required
      || args.execution?.approval_required
      || connectorPolicy.approval_required
      || normalizeApprovalStatus(args.approval?.status) === 'pending'
    ),
    reasons: [...approvalReasons, ...blockReasons].filter((reason) => typeof reason === 'string' && reason.trim().length > 0),
  };
}

export function buildApprovalSummaryFromApprovalRequest(row: GenericApproval, job?: GenericJob | null): ApprovalSummary {
  const source = inferWorkflowEntrySource({ job: job || null, approval: row || null });
  return {
    approval_source: 'approval_request',
    approval_id: String(row.id || ''),
    status: normalizeApprovalStatus(row.status),
    required_role: String(row.required_role || '').trim() || null,
    decision_at: row.reviewed_at || null,
    approver: row.reviewer_id || null,
    job_id: row.job_id || null,
    source,
    source_ref: inferWorkflowSourceRef({ job: job || null, approval: row || null }),
  };
}

export function buildApprovalSummaryFromJobApproval(row: GenericApproval, job?: GenericJob | null): ApprovalSummary {
  const source = inferWorkflowEntrySource({ job: job || null, approval: row || null });
  return {
    approval_source: 'job_approval',
    approval_id: String(row.id || ''),
    status: normalizeApprovalStatus(row.status),
    required_role: String(
      row.policy_snapshot?.required_role
      || row.required_role
      || job?.required_role
      || ''
    ).trim() || null,
    decision_at: row.decided_at || null,
    approver: row.approved_by || null,
    job_id: row.job_id || job?.id || null,
    source,
    source_ref: inferWorkflowSourceRef({ job: job || null, approval: row || null }),
  };
}

export function buildGovernedExecutionSummary(args: {
  job?: GenericJob | null;
  approval?: GenericApproval | null;
  execution?: GenericExecution | null;
  approvalSummary?: ApprovalSummary | null;
}): GovernedExecutionSummary {
  const source = inferWorkflowEntrySource({
    job: args.job || null,
    approval: args.approval || null,
    execution: args.execution || null,
  });
  const approval = args.approvalSummary || null;
  const auditRef =
    String(
      args.execution?.audit_ref
      || args.execution?.policy_snapshot?.governed_action?.audit_ref
      || args.job?.output?.audit_ref
      || args.job?.approval?.policy_snapshot?.governed_action?.audit_ref
      || ''
    ).trim() || null;

  return {
    source,
    source_ref: inferWorkflowSourceRef({ job: args.job || null, approval: args.approval || null }),
    job_id: args.job?.id || args.approval?.job_id || null,
    status: mapJobStatusToGovernedStatus(args.job?.status, approval?.status || args.approval?.status),
    policy_result: buildPolicyResult(args),
    approval,
    audit_ref: auditRef,
    cost_status: extractCostStatus({ job: args.job || null, execution: args.execution || null, source }),
    incident_ref: String(args.job?.output?.incident_ref || args.execution?.result?.incident_ref || '').trim() || null,
  };
}
