import { createHash } from 'crypto';
import { executeConnectorAction } from './connectors/action-executor';
import { buildGovernedActionSnapshot } from './governed-actions';
import { decryptSecret } from './integrations/encryption';
import { logger } from './logger';
import { type PreflightResult, runPreflightGate } from './preflight-gate';
import { connectorActionTitle, recordProductionActivity } from './production-activity';
import { appendAuditChainEvent } from './trust-audit-chain';
import { eq, supabaseRestAsService } from './supabase-rest';

type GovernedSource = 'gateway' | 'connector_console' | 'runtime';

type InterceptArgs = {
  orgId: string;
  connectorId: string;
  action: string;
  params: Record<string, any>;
  agentId?: string | null;
  requestedBy?: string | null;
  delegatedActor?: string | null;
  source: GovernedSource;
};

type ResumeArgs = {
  orgId: string;
  approvalId: string;
  reviewerId: string;
  reviewerNote?: string | null;
};

type BlockedPreflight = Extract<PreflightResult, { allowed: false }>;

function approvalAuditEntityId(approvalId: string) {
  return `approval:${approvalId}`;
}

function buildAuditRef(orgId: string, connectorId: string, action: string) {
  return `exec_${createHash('sha1').update(`${orgId}:${connectorId}:${action}:${Date.now()}`).digest('hex').slice(0, 16)}`;
}

async function loadConnectedIntegration(orgId: string, connectorId: string) {
  const integrations = (await supabaseRestAsService('integrations', new URLSearchParams({
    organization_id: eq(orgId),
    service_type: eq(connectorId),
    select: 'id,status',
    order: 'created_at.desc',
    limit: '1',
  }))) as Array<{ id: string; status: string }>;

  if (!integrations?.length || integrations[0].status !== 'connected') {
    throw new Error(`${connectorId} is not connected`);
  }

  const integrationId = integrations[0].id;
  const credRows = (await supabaseRestAsService('integration_credentials', new URLSearchParams({
    integration_id: eq(integrationId),
    select: 'key,value,expires_at',
  }))) as Array<{ key: string; value: string }>;

  const credentials: Record<string, string> = {};
  for (const row of credRows || []) {
    try {
      credentials[row.key] = decryptSecret(row.value);
    } catch {
      credentials[row.key] = row.value;
    }
  }

  return { integrationId, credentials };
}

async function createPendingApproval(args: {
  orgId: string;
  connectorId: string;
  action: string;
  params: Record<string, any>;
  agentId?: string | null;
  requestedBy?: string | null;
  requiredRole?: string | null;
  actionPolicyId?: string | null;
}) {
  const now = new Date().toISOString();
  const approvalRows = (await supabaseRestAsService('approval_requests', '', {
    method: 'POST',
    body: {
      organization_id: args.orgId,
      ...(args.agentId ? { agent_id: args.agentId } : {}),
      ...(args.actionPolicyId ? { action_policy_id: args.actionPolicyId } : {}),
      service: args.connectorId,
      action: args.action,
      action_payload: args.params,
      requested_by: args.requestedBy || 'agent',
      required_role: args.requiredRole || 'manager',
      status: 'pending',
      assigned_to: null,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      sla_deadline: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
      created_at: now,
      updated_at: now,
    },
  })) as any[];

  return approvalRows?.[0]?.id || null;
}

async function insertPendingExecution(args: {
  orgId: string;
  connectorId: string;
  action: string;
  params: Record<string, any>;
  agentId?: string | null;
  approvalId: string | null;
  requestedBy?: string | null;
  delegatedActor?: string | null;
  source: GovernedSource;
  preflight: BlockedPreflight;
}) {
  const now = new Date().toISOString();
  await supabaseRestAsService('connector_action_executions', '', {
    method: 'POST',
    body: {
      organization_id: args.orgId,
      agent_id: args.agentId || null,
      integration_id: null,
      connector_id: args.connectorId,
      action: args.action,
      params: args.params,
      result: { pending: true, queued: true, state: 'pending_approval' },
      success: false,
      error_message: args.preflight.blockReason,
      approval_required: true,
      approval_id: args.approvalId,
      requested_by: args.requestedBy || null,
      policy_snapshot: buildGovernedActionSnapshot({
        source: args.source,
        service: args.connectorId,
        action: args.action,
        recordedAt: now,
        decision: 'pending_approval',
        result: 'pending',
        policyId: args.preflight.approvalData?.action_policy_id || null,
        requiredRole: args.preflight.approvalData?.required_role || null,
        approvalRequired: true,
        approvalId: args.approvalId,
        approvalReasons: [args.preflight.blockReason],
        requestedBy: args.requestedBy || null,
        delegatedActor: args.delegatedActor || null,
        auditRef: args.preflight.auditRef,
        agentId: args.agentId || null,
        existingSnapshot: {
          reason_category: args.preflight.reasonCategory,
          reason_message: args.preflight.reasonMessage,
          recommended_next_action: args.preflight.recommendedNextAction,
          policy_gate: args.preflight.policySnapshot,
          budget_gate: args.preflight.budgetSnapshot,
          dlp_gate: args.preflight.dlpSnapshot,
          approval_flow: { state: 'pending_approval', approval_id: args.approvalId },
        },
      }),
      remediation: { suggested: 'Waiting for human approval before the external tool call is executed.' },
      created_at: now,
    },
  });
}

export async function interceptAgentToolCall(args: InterceptArgs) {
  const preflight = await runPreflightGate(args.orgId, args.connectorId, args.action, args.params, args.agentId || null);
  if (!preflight.allowed) {
    const blockedPreflight: BlockedPreflight = preflight;
    if (blockedPreflight.approvalRequired && blockedPreflight.approvalData) {
      const approvalId = await createPendingApproval({
        orgId: args.orgId,
        connectorId: args.connectorId,
        action: args.action,
        params: args.params,
        agentId: args.agentId || null,
        requestedBy: args.requestedBy || 'agent',
        requiredRole: blockedPreflight.approvalData.required_role || 'manager',
        actionPolicyId: blockedPreflight.approvalData.action_policy_id || null,
      });

      await insertPendingExecution({
        orgId: args.orgId,
        connectorId: args.connectorId,
        action: args.action,
        params: args.params,
        agentId: args.agentId || null,
        approvalId,
        requestedBy: args.requestedBy || 'agent',
        delegatedActor: args.delegatedActor || 'agent',
        source: args.source,
        preflight: blockedPreflight,
      });

      await appendAuditChainEvent({
        organization_id: args.orgId,
        event_type: 'governed_action.pending_approval',
        entity_type: 'approval_request',
        entity_id: approvalAuditEntityId(approvalId || `${args.connectorId}:${args.action}`),
        payload: {
          status: 'pending_approval',
          approval_id: approvalId,
          connector_id: args.connectorId,
          action: args.action,
          params: args.params,
          requested_by: args.requestedBy || 'agent',
          agent_id: args.agentId || null,
          reason_category: blockedPreflight.reasonCategory,
          reason_message: blockedPreflight.reasonMessage,
          recommended_next_action: blockedPreflight.recommendedNextAction,
          audit_ref: blockedPreflight.auditRef,
        },
      });

      await recordProductionActivity({
        organizationId: args.orgId,
        actorId: args.requestedBy || 'agent',
        auditAction: 'approval.requested',
        resourceType: 'approval_request',
        resourceId: approvalId,
        event: {
          type: 'approval',
          title: `Approval waiting: ${connectorActionTitle(args.connectorId, args.action)}`,
          detail: blockedPreflight.reasonMessage || blockedPreflight.blockReason,
          status: 'needs_policy',
          tone: 'warn',
          route: 'approvals',
          sourceRef: approvalId,
          evidenceRef: blockedPreflight.auditRef,
        },
        metadata: {
          production_journey: { stage: 'approval_requested', source: args.source },
          connector_id: args.connectorId,
          connector_action: args.action,
          approval_id: approvalId,
          agent_id: args.agentId || null,
          reason_category: blockedPreflight.reasonCategory,
          recommended_next_action: blockedPreflight.recommendedNextAction,
        },
      });

      return {
        success: true,
        paused: true,
        queued: true,
        state: 'pending_approval' as const,
        approvalId,
        decision: blockedPreflight.decision,
        reason_category: blockedPreflight.reasonCategory,
        reason_message: blockedPreflight.reasonMessage,
        recommended_next_action: blockedPreflight.recommendedNextAction,
        audit_ref: blockedPreflight.auditRef,
        message: blockedPreflight.blockReason,
      };
    }

    await appendAuditChainEvent({
      organization_id: args.orgId,
      event_type: 'governed_action.blocked',
      entity_type: 'connector_action',
      entity_id: `${args.connectorId}:${args.action}`,
      payload: {
        status: 'blocked',
        connector_id: args.connectorId,
        action: args.action,
        params: args.params,
        requested_by: args.requestedBy || 'agent',
        agent_id: args.agentId || null,
        reason_category: blockedPreflight.reasonCategory,
        reason_message: blockedPreflight.reasonMessage,
        recommended_next_action: blockedPreflight.recommendedNextAction,
        audit_ref: blockedPreflight.auditRef,
      },
    });

    await recordProductionActivity({
      organizationId: args.orgId,
      actorId: args.requestedBy || 'agent',
      auditAction: 'connector.action.blocked',
      resourceType: 'connector_action',
      event: {
        type: 'connector',
        title: `Blocked: ${connectorActionTitle(args.connectorId, args.action)}`,
        detail: blockedPreflight.reasonMessage || blockedPreflight.blockReason,
        status: 'blocked',
        tone: 'risk',
        route: 'governed-actions',
        sourceRef: `${args.connectorId}:${args.action}`,
        evidenceRef: blockedPreflight.auditRef,
      },
      metadata: {
        production_journey: { stage: 'policy_blocked', source: args.source },
        connector_id: args.connectorId,
        connector_action: args.action,
        agent_id: args.agentId || null,
        reason_category: blockedPreflight.reasonCategory,
        recommended_next_action: blockedPreflight.recommendedNextAction,
      },
    });

    return {
      success: false,
      paused: false,
      queued: false,
      state: 'blocked' as const,
      decision: blockedPreflight.decision,
      reason_category: blockedPreflight.reasonCategory,
      reason_message: blockedPreflight.reasonMessage,
      recommended_next_action: blockedPreflight.recommendedNextAction,
      audit_ref: blockedPreflight.auditRef,
      error: blockedPreflight.blockReason,
    };
  }

  const { integrationId, credentials } = await loadConnectedIntegration(args.orgId, args.connectorId);
  const startedAt = Date.now();
  const result = await executeConnectorAction(
    args.connectorId,
    args.action,
    args.params,
    credentials,
    args.orgId,
    args.agentId || null,
    integrationId,
  );
  const durationMs = Date.now() - startedAt;
  const auditRef = buildAuditRef(args.orgId, args.connectorId, args.action);

  const executionRows = await supabaseRestAsService('connector_action_executions', '', {
    method: 'POST',
    body: {
      organization_id: args.orgId,
      agent_id: args.agentId || null,
      integration_id: integrationId,
      connector_id: args.connectorId,
      action: args.action,
      params: args.params,
      result: result.data || result.error || {},
      success: result.success,
      error_message: result.error || null,
      duration_ms: durationMs,
      requested_by: args.requestedBy || null,
      ...(result.idempotencyKey ? { idempotency_key: result.idempotencyKey } : {}),
      policy_snapshot: buildGovernedActionSnapshot({
        source: args.source,
        service: args.connectorId,
        action: args.action,
        recordedAt: new Date().toISOString(),
        decision: 'executed',
        result: result.success ? 'succeeded' : 'failed',
        requestedBy: args.requestedBy || null,
        delegatedActor: args.delegatedActor || null,
        agentId: args.agentId || null,
        durationMs,
        idempotencyKey: result.idempotencyKey || null,
        auditRef,
      }),
      remediation: result.success ? {} : { suggested: 'Check connector credentials, provider state, and retry conditions.' },
    },
  }).catch((err: any) => {
    logger.warn('Failed to persist agent tool execution', { connectorId: args.connectorId, action: args.action, error: err?.message });
    return [];
  });
  const executionId = Array.isArray(executionRows) ? executionRows?.[0]?.id || null : null;

  await appendAuditChainEvent({
    organization_id: args.orgId,
    event_type: result.success ? 'governed_action.executed' : 'governed_action.failed',
    entity_type: 'connector_action',
    entity_id: `${args.connectorId}:${args.action}`,
    payload: {
      status: result.success ? 'executed' : 'execution_failed',
      connector_id: args.connectorId,
      action: args.action,
      requested_by: args.requestedBy || 'agent',
      agent_id: args.agentId || null,
      audit_ref: auditRef,
      idempotency_key: result.idempotencyKey || null,
      status_code: result.statusCode || null,
    },
  });

  await recordProductionActivity({
    organizationId: args.orgId,
    actorId: args.requestedBy || 'agent',
    auditAction: result.success ? 'connector.action.executed' : 'connector.action.failed',
    resourceType: 'connector_action_execution',
    resourceId: executionId,
    event: {
      type: 'connector',
      title: `${result.success ? 'Executed' : 'Failed'}: ${connectorActionTitle(args.connectorId, args.action)}`,
      detail: result.success
        ? `Provider call completed in ${durationMs}ms with audit evidence.`
        : result.error || 'Provider call failed after policy checks.',
      status: result.success ? 'deployed' : 'degraded',
      tone: result.success ? 'success' : 'risk',
      route: 'apps',
      sourceRef: executionId || `${args.connectorId}:${args.action}`,
      evidenceRef: auditRef,
    },
    metadata: {
      production_journey: { stage: result.success ? 'connector_executed' : 'connector_failed', source: args.source },
      connector_id: args.connectorId,
      connector_action: args.action,
      agent_id: args.agentId || null,
      integration_id: integrationId,
      duration_ms: durationMs,
      idempotency_key: result.idempotencyKey || null,
      status_code: result.statusCode || null,
    },
  });

  return {
    success: true,
    paused: false,
    queued: false,
    state: result.success ? 'executed' as const : 'execution_failed' as const,
    data: result,
    audit_ref: auditRef,
  };
}

export async function resumeApprovedToolCall(args: ResumeArgs) {
  const approvals = (await supabaseRestAsService('approval_requests', new URLSearchParams({
    id: eq(args.approvalId),
    organization_id: eq(args.orgId),
    select: 'id,agent_id,service,action,action_payload,status,required_role,reviewer_id,reviewer_note',
    limit: '1',
  }))) as Array<Record<string, any>>;
  const approval = approvals?.[0];
  if (!approval) {
    throw new Error('Approval request not found');
  }

  const executions = (await supabaseRestAsService('connector_action_executions', new URLSearchParams({
    organization_id: eq(args.orgId),
    approval_id: eq(args.approvalId),
    select: 'id,agent_id,integration_id,connector_id,action,params,policy_snapshot,requested_by',
    order: 'created_at.desc',
    limit: '1',
  })).catch(() => [])) as Array<Record<string, any>>;
  const execution = executions?.[0];

  const connectorId = String(execution?.connector_id || approval.service || '').trim();
  const action = String(execution?.action || approval.action || '').trim();
  const params = (execution?.params || approval.action_payload || {}) as Record<string, any>;
  const agentId = execution?.agent_id || approval.agent_id || null;
  const requestedBy = execution?.requested_by || approval.requested_by || null;

  if (!connectorId || !action) {
    throw new Error('Approval is missing connector execution context');
  }

  const { integrationId, credentials } = await loadConnectedIntegration(args.orgId, connectorId);
  const start = Date.now();
  const result = await executeConnectorAction(connectorId, action, params, credentials, args.orgId, agentId, integrationId);
  const durationMs = Date.now() - start;
  const auditRef = buildAuditRef(args.orgId, connectorId, action);
  const now = new Date().toISOString();

  const snapshot = buildGovernedActionSnapshot({
    source: 'runtime',
    service: connectorId,
    action,
    recordedAt: now,
    decision: 'executed',
    result: result.success ? 'succeeded' : 'failed',
    approvalRequired: true,
    approvalId: args.approvalId,
    requestedBy: requestedBy || null,
    delegatedActor: args.reviewerId,
    agentId,
    durationMs,
    idempotencyKey: result.idempotencyKey || null,
    auditRef,
    existingSnapshot: {
      ...(execution?.policy_snapshot || {}),
      approval_flow: {
        state: result.success ? 'approved_and_executed' : 'approved_but_execution_failed',
        approval_id: args.approvalId,
        reviewer_id: args.reviewerId,
        reviewer_note: args.reviewerNote || null,
      },
    },
  });

  let executionId: string | null = execution?.id || null;

  if (execution?.id) {
    await supabaseRestAsService('connector_action_executions', new URLSearchParams({
      id: eq(execution.id),
      organization_id: eq(args.orgId),
    }), {
      method: 'PATCH',
      body: {
        integration_id: integrationId,
        result: result.data || result.error || {},
        success: result.success,
        error_message: result.error || null,
        duration_ms: durationMs,
        requested_by: requestedBy || null,
        ...(result.idempotencyKey ? { idempotency_key: result.idempotencyKey } : {}),
        policy_snapshot: snapshot,
        remediation: result.success ? {} : { suggested: 'Approval was granted, but the downstream provider call failed. Review connector state and retry safely.' },
        updated_at: now,
      },
    });
  } else {
    const insertedRows = await supabaseRestAsService('connector_action_executions', '', {
      method: 'POST',
      body: {
        organization_id: args.orgId,
        agent_id: agentId,
        integration_id: integrationId,
        connector_id: connectorId,
        action,
        params,
        result: result.data || result.error || {},
        success: result.success,
        error_message: result.error || null,
        duration_ms: durationMs,
        approval_required: true,
        approval_id: args.approvalId,
        requested_by: requestedBy || null,
        ...(result.idempotencyKey ? { idempotency_key: result.idempotencyKey } : {}),
        policy_snapshot: snapshot,
        remediation: result.success ? {} : { suggested: 'Approved action failed during final provider execution. Review state and retry safely.' },
        created_at: now,
      },
    });
    executionId = Array.isArray(insertedRows) ? insertedRows?.[0]?.id || null : null;
  }

  await appendAuditChainEvent({
    organization_id: args.orgId,
    event_type: 'governed_action.approved',
    entity_type: 'approval_request',
    entity_id: approvalAuditEntityId(args.approvalId),
    payload: {
      status: 'approved',
      approval_id: args.approvalId,
      connector_id: connectorId,
      action,
      reviewer_id: args.reviewerId,
      reviewer_note: args.reviewerNote || null,
      audit_ref: auditRef,
    },
  });

  await recordProductionActivity({
    organizationId: args.orgId,
    actorId: args.reviewerId,
    auditAction: 'approval.approved',
    resourceType: 'approval_request',
    resourceId: args.approvalId,
    event: {
      type: 'approval',
      title: `Approved: ${connectorActionTitle(connectorId, action)}`,
      detail: args.reviewerNote || 'Human approval released the governed connector action.',
      status: 'deployed',
      tone: 'success',
      route: 'approvals',
      sourceRef: args.approvalId,
      evidenceRef: auditRef,
    },
    metadata: {
      production_journey: { stage: 'approval_approved', source: 'runtime' },
      connector_id: connectorId,
      connector_action: action,
      approval_id: args.approvalId,
      reviewer_note: args.reviewerNote || null,
    },
  });

  await appendAuditChainEvent({
    organization_id: args.orgId,
    event_type: result.success ? 'governed_action.executed' : 'governed_action.failed',
    entity_type: 'approval_request',
    entity_id: approvalAuditEntityId(args.approvalId),
    payload: {
      status: result.success ? 'executed' : 'execution_failed',
      approval_id: args.approvalId,
      connector_id: connectorId,
      action,
      reviewer_id: args.reviewerId,
      requested_by: requestedBy || null,
      agent_id: agentId,
      audit_ref: auditRef,
      status_code: result.statusCode || null,
      idempotency_key: result.idempotencyKey || null,
    },
  });

  await recordProductionActivity({
    organizationId: args.orgId,
    actorId: args.reviewerId,
    auditAction: result.success ? 'connector.action.executed' : 'connector.action.failed',
    resourceType: 'connector_action_execution',
    resourceId: executionId,
    event: {
      type: 'connector',
      title: `${result.success ? 'Executed after approval' : 'Failed after approval'}: ${connectorActionTitle(connectorId, action)}`,
      detail: result.success
        ? `Approved connector action completed in ${durationMs}ms.`
        : result.error || 'Approval was granted, but the provider call failed.',
      status: result.success ? 'deployed' : 'degraded',
      tone: result.success ? 'success' : 'risk',
      route: 'apps',
      sourceRef: executionId || args.approvalId,
      evidenceRef: auditRef,
    },
    metadata: {
      production_journey: { stage: result.success ? 'approved_connector_executed' : 'approved_connector_failed', source: 'runtime' },
      connector_id: connectorId,
      connector_action: action,
      approval_id: args.approvalId,
      agent_id: agentId,
      integration_id: integrationId,
      duration_ms: durationMs,
      idempotency_key: result.idempotencyKey || null,
      status_code: result.statusCode || null,
    },
  });

  return {
    connectorId,
    action,
    result,
    auditRef,
  };
}

export async function markApprovalDeniedExecution(args: {
  orgId: string;
  approvalId: string;
  reviewerId: string;
  reviewerNote?: string | null;
}) {
  const executions = (await supabaseRestAsService('connector_action_executions', new URLSearchParams({
    organization_id: eq(args.orgId),
    approval_id: eq(args.approvalId),
    select: 'id,connector_id,action,params,policy_snapshot,requested_by,agent_id',
    order: 'created_at.desc',
    limit: '1',
  })).catch(() => [])) as Array<Record<string, any>>;
  const execution = executions?.[0];

  if (execution?.id) {
    await supabaseRestAsService('connector_action_executions', new URLSearchParams({
      id: eq(execution.id),
      organization_id: eq(args.orgId),
    }), {
      method: 'PATCH',
      body: {
        success: false,
        error_message: args.reviewerNote || 'Denied by reviewer',
        result: {
          denied: true,
          reviewer_id: args.reviewerId,
          reviewer_note: args.reviewerNote || null,
        },
        policy_snapshot: buildGovernedActionSnapshot({
          source: 'runtime',
          service: execution.connector_id,
          action: execution.action,
          recordedAt: new Date().toISOString(),
          decision: 'blocked',
          result: 'blocked',
          approvalRequired: true,
          approvalId: args.approvalId,
          requestedBy: execution.requested_by || null,
          delegatedActor: args.reviewerId,
          agentId: execution.agent_id || null,
          existingSnapshot: {
            ...(execution.policy_snapshot || {}),
            approval_flow: {
              state: 'denied',
              approval_id: args.approvalId,
              reviewer_id: args.reviewerId,
              reviewer_note: args.reviewerNote || null,
            },
          },
        }),
        remediation: { suggested: 'Action was denied. Update the payload or policy before attempting this operation again.' },
        updated_at: new Date().toISOString(),
      },
    });
  }

  await appendAuditChainEvent({
    organization_id: args.orgId,
    event_type: 'governed_action.denied',
    entity_type: 'approval_request',
    entity_id: approvalAuditEntityId(args.approvalId),
    payload: {
      status: 'denied',
      approval_id: args.approvalId,
      reviewer_id: args.reviewerId,
      reviewer_note: args.reviewerNote || null,
    },
  });

  await recordProductionActivity({
    organizationId: args.orgId,
    actorId: args.reviewerId,
    auditAction: 'approval.rejected',
    resourceType: 'approval_request',
    resourceId: args.approvalId,
    event: {
      type: 'approval',
      title: execution?.connector_id && execution?.action
        ? `Denied: ${connectorActionTitle(String(execution.connector_id), String(execution.action))}`
        : 'Approval denied',
      detail: args.reviewerNote || 'Reviewer denied the governed connector action.',
      status: 'blocked',
      tone: 'risk',
      route: 'approvals',
      sourceRef: args.approvalId,
    },
    metadata: {
      production_journey: { stage: 'approval_denied', source: 'runtime' },
      connector_id: execution?.connector_id || null,
      connector_action: execution?.action || null,
      approval_id: args.approvalId,
      reviewer_note: args.reviewerNote || null,
    },
  });
}
