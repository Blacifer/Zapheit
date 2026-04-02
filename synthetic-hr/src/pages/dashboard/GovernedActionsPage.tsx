import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, TimerReset } from 'lucide-react';
import { PageHero } from '../../components/dashboard/PageHero';
import { ReasonCallout } from '../../components/dashboard/ReasonCallout';
import { api } from '../../lib/api-client';
import type { ApprovalRequest } from '../../lib/api/approvals';
import { toast } from '../../lib/toast';

type GovernedAction = {
  id: string;
  connector_id: string;
  action: string;
  success: boolean;
  error_message: string | null;
  duration_ms: number | null;
  approval_required: boolean;
  approval_id: string | null;
  reliability_state?: 'queued_for_retry' | 'paused_by_circuit_breaker' | 'recovered' | 'ok' | null;
  retry_count?: number | null;
  next_retry_at?: string | null;
  breaker_open?: boolean | null;
  recovered_at?: string | null;
  reason_category?: 'policy_blocked' | 'approval_required' | 'reliability_degraded' | 'execution_failed' | null;
  reason_message?: string | null;
  recommended_next_action?: string | null;
  decision?: 'allow' | 'block' | 'require_approval' | 'defer_reliability' | null;
  delegated_actor?: string | null;
  audit_ref?: string | null;
  requested_by?: string | null;
  policy_snapshot?: {
    constraints?: {
      threshold_amount?: number | null;
      threshold_count?: number | null;
      threshold_required_role?: string | null;
      allowed_domains?: string[] | null;
      max_rows?: number | null;
    } | null;
    constraint_evaluation?: {
      dualApproval?: boolean;
      requiredRole?: string | null;
      approvalReasons?: string[];
      thresholdTriggered?: boolean;
      thresholdType?: string | null;
      thresholdAmount?: number | null;
      thresholdCount?: number | null;
      domainRestricted?: boolean;
      blockedDomains?: string[];
      maxRowsExceeded?: boolean;
      observedRows?: number | null;
      maxRows?: number | null;
    } | null;
  } | null;
  created_at: string;
  governance?: {
    source: 'gateway' | 'connector_console' | 'runtime';
    decision: 'executed' | 'pending_approval' | 'blocked';
    result: 'succeeded' | 'failed' | 'pending' | 'blocked';
    policy_id?: string | null;
    required_role?: string | null;
    block_reasons?: string[];
    approval_reasons?: string[];
    idempotency_key?: string | null;
    job_id?: string | null;
    agent_id?: string | null;
    requested_by?: string | null;
    delegated_actor?: string | null;
    audit_ref?: string | null;
  } | null;
};

const ROLE_ORDER: Record<'viewer' | 'manager' | 'admin' | 'super_admin', number> = {
  viewer: 0,
  manager: 1,
  admin: 2,
  super_admin: 3,
};

function fmtRelative(value: string) {
  const date = new Date(value);
  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

function fmtRelativeOrFuture(value: string) {
  const date = new Date(value);
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60000);
  if (diffMinutes > 0) {
    if (diffMinutes < 60) return `in ${diffMinutes}m`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `in ${diffHours}h`;
    return `in ${Math.round(diffHours / 24)}d`;
  }
  return fmtRelative(value);
}

function fmtDeadline(value: string) {
  const date = new Date(value);
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60000);
  if (diffMinutes <= 0) return 'expired';
  if (diffMinutes < 60) return `${diffMinutes}m left`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h left`;
  return `${Math.round(diffHours / 24)}d left`;
}

function fmtCompactNumber(value: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function buildStructuredReasons(args: {
  item: GovernedAction;
  approval?: ApprovalRequest;
  assignedElsewhere: boolean;
  roleAllowed: boolean;
  approvalExpired: boolean;
}) {
  const { item, approval, assignedElsewhere, roleAllowed, approvalExpired } = args;
  const evaluation = item.policy_snapshot?.constraint_evaluation;
  const reasons: Array<{ tone: 'amber' | 'rose' | 'cyan'; label: string; detail: string }> = [];

  if (item.governance?.decision === 'blocked') {
    reasons.push({
      tone: 'rose',
      label: 'Policy block',
      detail: item.governance?.block_reasons?.[0] || item.error_message || 'This action was stopped by a governance rule.',
    });
  }
  if (approval) {
    reasons.push({
      tone: 'amber',
      label: 'Approval gate',
      detail: `Requires ${approval.required_role} or higher before execution can continue.`,
    });
  }
  if (assignedElsewhere) {
    reasons.push({
      tone: 'amber',
      label: 'Assigned reviewer',
      detail: `This request is assigned to ${truncateMiddle(approval?.assigned_to || '')}.`,
    });
  }
  if (!roleAllowed && approval?.required_role) {
    reasons.push({
      tone: 'amber',
      label: 'Role restriction',
      detail: `Your current role is below ${approval.required_role}.`,
    });
  }
  if (approvalExpired) {
    reasons.push({
      tone: 'rose',
      label: 'Expired approval',
      detail: 'The approval window has closed and needs to be recreated or escalated.',
    });
  }
  if (evaluation?.thresholdTriggered) {
    const thresholdValue = evaluation.thresholdAmount ?? evaluation.thresholdCount;
    reasons.push({
      tone: 'cyan',
      label: 'Threshold hit',
      detail: thresholdValue != null
        ? `A ${evaluation.thresholdType || 'configured'} threshold triggered at ${thresholdValue}.`
        : 'A configured amount or count threshold triggered extra governance.',
    });
  }
  if (evaluation?.domainRestricted) {
    reasons.push({
      tone: 'rose',
      label: 'Domain restriction',
      detail: evaluation.blockedDomains?.length
        ? `Blocked destination: ${evaluation.blockedDomains.slice(0, 2).join(', ')}`
        : 'Destination domain policy prevented this action.',
    });
  }
  if (evaluation?.maxRowsExceeded) {
    reasons.push({
      tone: 'cyan',
      label: 'Blast radius limit',
      detail: `Observed ${evaluation.observedRows ?? 'n/a'} rows against a limit of ${evaluation.maxRows ?? 'n/a'}.`,
    });
  }
  return reasons;
}

function toneClasses(result?: string | null) {
  if (result === 'succeeded') return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200';
  if (result === 'pending') return 'border-amber-400/20 bg-amber-500/10 text-amber-200';
  return 'border-rose-400/20 bg-rose-500/10 text-rose-200';
}

function reliabilityToneClasses(state?: GovernedAction['reliability_state']) {
  if (state === 'recovered') return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200';
  if (state === 'queued_for_retry') return 'border-amber-400/20 bg-amber-500/10 text-amber-200';
  if (state === 'paused_by_circuit_breaker') return 'border-rose-400/20 bg-rose-500/10 text-rose-200';
  return 'border-slate-400/20 bg-slate-500/10 text-slate-200';
}

function truncateMiddle(value: string, head = 8, tail = 6) {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function buildAppsHistoryRoute(service: string) {
  const params = new URLSearchParams({ service, drawerTab: 'history' });
  return `apps?${params.toString()}`;
}

function buildApprovalRoute(approvalId: string, service?: string | null) {
  const params = new URLSearchParams({ approvalId });
  if (service) params.set('service', service);
  return `approvals?${params.toString()}`;
}

function buildJobRoute(jobId: string, decision?: 'executed' | 'pending_approval' | 'blocked') {
  const params = new URLSearchParams({ jobId });
  if (decision === 'pending_approval') params.set('tab', 'pending');
  return `jobs?${params.toString()}`;
}

export default function GovernedActionsPage({
  onNavigate,
  currentUserId,
  currentRole,
}: {
  onNavigate: (page: string) => void;
  currentUserId?: string | null;
  currentRole?: string | null;
}) {
  const [actions, setActions] = useState<GovernedAction[]>([]);
  const [approvalsById, setApprovalsById] = useState<Record<string, ApprovalRequest>>({});
  const [healthByService, setHealthByService] = useState<Record<string, {
    status: string;
    last_error_msg: string | null;
    last_error_at?: string | null;
    last_tested_at: string | null;
    last_test_result: string | null;
  }>>({});
  const [loading, setLoading] = useState(true);
  const [actingApprovalId, setActingApprovalId] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<'all' | 'executed' | 'pending_approval' | 'blocked'>('all');
  const [source, setSource] = useState<'all' | 'gateway' | 'connector_console' | 'runtime'>('all');
  const [service, setService] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    const [actionsRes, approvalsRes, healthRes] = await Promise.all([
      api.integrations.getGovernedActions({
        ...(decision !== 'all' ? { decision } : {}),
        ...(source !== 'all' ? { source } : {}),
        ...(service !== 'all' ? { service } : {}),
        limit: 100,
      }),
      api.approvals.list({ status: 'pending', limit: 200 }),
      api.integrations.getHealthSummary(),
    ]);
    if (actionsRes.success) {
      setActions((actionsRes.data as GovernedAction[]) || []);
    } else {
      setActions([]);
    }
    if (approvalsRes.success) {
      const next = Object.fromEntries(((approvalsRes.data as ApprovalRequest[]) || []).map((item) => [item.id, item]));
      setApprovalsById(next);
    } else {
      setApprovalsById({});
    }
    if (healthRes.success) {
      setHealthByService(
        Object.fromEntries(((healthRes.data as Array<any>) || []).map((item) => [item.service, item])),
      );
    } else {
      setHealthByService({});
    }
    setLoading(false);
  }, [decision, service, source]);

  useEffect(() => {
    void load();
  }, [load]);

  const services = useMemo(
    () => Array.from(new Set(actions.map((item) => item.connector_id))).sort(),
    [actions],
  );

  const counts = useMemo(() => {
    const pending = actions.filter((item) => item.governance?.result === 'pending').length;
    const blocked = actions.filter((item) => item.governance?.result === 'blocked').length;
    const succeeded = actions.filter((item) => item.governance?.result === 'succeeded' || (!item.governance && item.success)).length;
    return {
      total: actions.length,
      pending,
      blocked,
      succeeded,
    };
  }, [actions]);

  const recommendation = counts.pending > 0
    ? {
        label: 'Recommended Next Step',
        title: 'Clear pending approvals first',
        detail: `${counts.pending} governed action${counts.pending === 1 ? '' : 's'} are waiting on approval before they can execute.`,
      }
    : counts.blocked > 0
      ? {
          label: 'Recommended Next Step',
          title: 'Review blocked actions',
          detail: `${counts.blocked} governed action${counts.blocked === 1 ? '' : 's'} were blocked by policy, DLP, or constraints and need operator review.`,
        }
      : {
          label: 'Recommended Next Step',
          title: 'Use this page as your control ledger',
          detail: 'Track what executed, what got stopped, and what is waiting on human approval across your connected apps.',
        };

  const handleApprovalDecision = useCallback(async (approvalId: string, nextDecision: 'approve' | 'deny') => {
    setActingApprovalId(approvalId);
    const note = decisionNotes[approvalId]?.trim() || undefined;
    const res = nextDecision === 'approve'
      ? await api.approvals.approve(approvalId, note)
      : await api.approvals.deny(approvalId, note);
    if (res.success) {
      toast.success(nextDecision === 'approve' ? 'Approval recorded' : 'Approval denied');
      setDecisionNotes((current) => {
        const next = { ...current };
        delete next[approvalId];
        return next;
      });
      await load();
    } else {
      toast.error(res.error || `Failed to ${nextDecision} approval`);
    }
    setActingApprovalId(null);
  }, [decisionNotes, load]);

  const handleApprovalEscalation = useCallback(async (approvalId: string) => {
    setActingApprovalId(approvalId);
    const res = await api.approvals.escalate(approvalId);
    if (res.success) {
      toast.success('Approval escalated');
      await load();
    } else {
      toast.error(res.error || 'Failed to escalate approval');
    }
    setActingApprovalId(null);
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Governed Actions"
        title="Every controlled app action in one ledger"
        subtitle="Track blocked writes, approval-gated operations, and completed governed actions across apps without digging through each app drawer separately."
        recommendation={recommendation}
        stats={[
          { label: 'Total actions', value: `${counts.total}`, detail: 'Current filtered view' },
          { label: 'Pending approval', value: `${counts.pending}`, detail: 'Waiting on human decision' },
          { label: 'Blocked', value: `${counts.blocked}`, detail: 'Stopped by governance controls' },
          { label: 'Succeeded', value: `${counts.succeeded}`, detail: 'Executed and recorded' },
        ]}
        actions={[
          { label: 'Open approvals', onClick: () => onNavigate('approvals') },
          { label: 'Open apps', onClick: () => onNavigate('apps'), variant: 'secondary' },
        ]}
      />

      <section className="rounded-[28px] border border-slate-800/90 bg-slate-900/50 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Filter the ledger</h2>
            <p className="mt-1 text-sm text-slate-400">Narrow governed actions by decision, source, and app service.</p>
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.09]"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <select
            value={decision}
            onChange={(event) => setDecision(event.target.value as typeof decision)}
            className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none"
          >
            <option value="all">All decisions</option>
            <option value="executed">Executed</option>
            <option value="pending_approval">Pending approval</option>
            <option value="blocked">Blocked</option>
          </select>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as typeof source)}
            className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none"
          >
            <option value="all">All sources</option>
            <option value="gateway">Gateway</option>
            <option value="connector_console">Console</option>
            <option value="runtime">Runtime</option>
          </select>
          <select
            value={service}
            onChange={(event) => setService(event.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none"
          >
            <option value="all">All apps</option>
            {services.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-800/90 bg-slate-900/50 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Governed action feed</h2>
            <p className="mt-1 text-sm text-slate-400">Decision, reason, role, and source for each outbound controlled action.</p>
          </div>
          <div className="text-xs text-slate-500">{counts.total} items</div>
        </div>

        <div className="mt-5 space-y-3">
          {loading ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6 text-sm text-slate-400">Loading governed actions…</div>
          ) : actions.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6 text-sm text-slate-400">
              No governed actions match this filter yet.
            </div>
          ) : actions.map((item) => {
            const governance = item.governance;
            const result = governance?.result || (item.success ? 'succeeded' : 'failed');
            const approvalId = item.approval_id;
            const jobId = governance?.job_id ?? null;
            const approval = approvalId ? approvalsById[approvalId] : undefined;
            const health = healthByService[item.connector_id];
            const approvalRole = approval?.required_role || governance?.required_role || 'viewer';
            const roleAllowed = approvalRole in ROLE_ORDER && currentRole
              ? ROLE_ORDER[currentRole as keyof typeof ROLE_ORDER] >= ROLE_ORDER[approvalRole as keyof typeof ROLE_ORDER]
              : true;
            const assignedElsewhere = Boolean(approval?.assigned_to && currentUserId && approval.assigned_to !== currentUserId);
            const approvalExpired = Boolean(approval?.expires_at && new Date(approval.expires_at) <= new Date());
            const inlineDecisionDisabled = actingApprovalId === approval?.id || assignedElsewhere || !roleAllowed || approvalExpired;
            const inlineDecisionReason = assignedElsewhere
              ? 'Assigned to another reviewer'
              : !roleAllowed
                ? `Requires ${approvalRole} or higher`
                : approvalExpired
                  ? 'Approval request expired'
                  : null;
            const degraded = health?.status === 'error' || health?.status === 'expired' || health?.last_test_result === 'error';
            const syncing = health?.status === 'syncing';
            const reliabilityState = item.reliability_state || 'ok';
            const structuredReasons = buildStructuredReasons({
              item,
              approval,
              assignedElsewhere,
              roleAllowed,
              approvalExpired,
            });
            const constraints = item.policy_snapshot?.constraints;
            const evaluation = item.policy_snapshot?.constraint_evaluation;
            const reasons = governance?.block_reasons?.length
              ? governance.block_reasons
              : governance?.approval_reasons?.length
                ? governance.approval_reasons
                : item.error_message
                  ? [item.error_message]
                  : [];

            return (
              <div key={item.id} className="rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,rgba(2,6,23,0.28),rgba(2,6,23,0.5))] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${toneClasses(result)}`}>
                    {result.replace(/_/g, ' ')}
                  </span>
                  {degraded ? (
                    <span className="rounded-full border border-rose-400/20 bg-rose-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-200">
                      degraded rail
                    </span>
                  ) : syncing ? (
                    <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">
                      syncing
                    </span>
                  ) : health?.last_test_result === 'ok' ? (
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-200">
                      healthy rail
                    </span>
                  ) : null}
                  {governance?.source ? (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                      {governance.source === 'connector_console' ? 'console' : governance.source}
                    </span>
                  ) : null}
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${reliabilityToneClasses(reliabilityState)}`}>
                    {reliabilityState.replace(/_/g, ' ')}
                  </span>
                  {item.approval_required ? (
                    <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">
                      approval gated
                    </span>
                  ) : null}
                  <span className="ml-auto text-[11px] text-slate-500">{fmtRelative(item.created_at)}</span>
                </div>

                <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-white">
                      <ShieldCheck className="h-4 w-4 text-cyan-300" />
                      <p className="font-semibold">{item.connector_id}.{item.action}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                      <span>Decision: {governance?.decision?.replace(/_/g, ' ') || 'executed'}</span>
                      <span>Role: {governance?.required_role || 'n/a'}</span>
                      <span>Duration: {item.duration_ms ? `${item.duration_ms} ms` : 'n/a'}</span>
                      {approval?.assigned_to ? <span>Assigned reviewer: {truncateMiddle(approval.assigned_to)}</span> : null}
                      {approval?.expires_at ? <span>Expires: {fmtDeadline(approval.expires_at)}</span> : null}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Requested by</p>
                        <p className="mt-1 text-sm text-slate-200">{governance?.requested_by || item.requested_by || 'system'}</p>
                      </div>
                      <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Agent</p>
                        <p className="mt-1 text-sm text-slate-200 font-mono">
                          {governance?.agent_id ? truncateMiddle(governance.agent_id) : 'n/a'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Policy</p>
                        <p className="mt-1 text-sm text-slate-200 font-mono">
                          {governance?.policy_id ? truncateMiddle(governance.policy_id) : 'default'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Idempotency</p>
                        <p className="mt-1 text-sm text-slate-200 font-mono">
                          {governance?.idempotency_key ? truncateMiddle(governance.idempotency_key) : 'not recorded'}
                        </p>
                      </div>
                    </div>
                    {health ? (
                      <div className="mt-3 rounded-xl border border-white/8 bg-black/20 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Reliability state</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <p className="text-sm text-slate-300">Connection state: <span className="text-white">{health.status}</span></p>
                          <p className="text-sm text-slate-300">Last test: <span className="text-white">{health.last_test_result || 'not run'}</span></p>
                          {health.last_tested_at ? (
                            <p className="text-sm text-slate-300">Last tested: <span className="text-white">{fmtRelative(health.last_tested_at)}</span></p>
                          ) : null}
                          {health.last_error_at ? (
                            <p className="text-sm text-slate-300">Last failure: <span className="text-white">{fmtRelative(health.last_error_at)}</span></p>
                          ) : null}
                          {item.next_retry_at ? (
                            <p className="text-sm text-slate-300">Next retry: <span className="text-white">{fmtRelativeOrFuture(item.next_retry_at)}</span></p>
                          ) : null}
                          {item.retry_count != null ? (
                            <p className="text-sm text-slate-300">Retry count: <span className="text-white">{item.retry_count}</span></p>
                          ) : null}
                          {item.recovered_at ? (
                            <p className="text-sm text-slate-300">Recovered: <span className="text-white">{fmtRelative(item.recovered_at)}</span></p>
                          ) : null}
                        </div>
                        {health.last_error_msg ? (
                          <p className="mt-2 text-sm text-rose-200">{health.last_error_msg}</p>
                        ) : degraded ? (
                          <p className="mt-2 text-sm text-rose-200">The integration is degraded, so execution risk is higher even if governance allows this action.</p>
                        ) : syncing ? (
                          <p className="mt-2 text-sm text-amber-200">The integration is still syncing. Retry-sensitive actions may need a short wait.</p>
                        ) : null}
                      </div>
                    ) : null}
                    {structuredReasons.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {structuredReasons.map((reason) => (
                          <div
                            key={`${item.id}-${reason.label}`}
                            className={
                              reason.tone === 'rose'
                                ? 'rounded-xl border border-rose-400/15 bg-rose-500/8 px-3 py-2'
                                : reason.tone === 'cyan'
                                  ? 'rounded-xl border border-cyan-400/15 bg-cyan-500/8 px-3 py-2'
                                  : 'rounded-xl border border-amber-400/15 bg-amber-500/8 px-3 py-2'
                            }
                          >
                            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-300/90">{reason.label}</p>
                            <p className="mt-1 text-sm text-slate-100">{reason.detail}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <ReasonCallout
                      className="mt-3 rounded-xl py-3"
                      labelClassName="tracking-[0.16em]"
                      messageClassName="text-sm text-slate-100"
                      nextActionClassName="mt-2 text-sm text-cyan-100"
                      reasonMessage={item.reason_category ? item.reason_message : null}
                      recommendedNextAction={item.reason_category ? item.recommended_next_action : null}
                    />
                    {(constraints || evaluation?.thresholdTriggered || evaluation?.maxRowsExceeded || evaluation?.domainRestricted) ? (
                      <div className="mt-3 rounded-xl border border-white/8 bg-black/20 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Constraint context</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {constraints?.threshold_amount != null ? (
                            <p className="text-sm text-slate-300">Amount threshold: <span className="text-white">{fmtCompactNumber(constraints.threshold_amount)}</span></p>
                          ) : null}
                          {constraints?.threshold_count != null ? (
                            <p className="text-sm text-slate-300">Count threshold: <span className="text-white">{fmtCompactNumber(constraints.threshold_count)}</span></p>
                          ) : null}
                          {constraints?.max_rows != null ? (
                            <p className="text-sm text-slate-300">Max rows: <span className="text-white">{fmtCompactNumber(constraints.max_rows)}</span></p>
                          ) : null}
                          {constraints?.threshold_required_role ? (
                            <p className="text-sm text-slate-300">Escalates to: <span className="text-white">{constraints.threshold_required_role}</span></p>
                          ) : null}
                          {evaluation?.observedRows != null ? (
                            <p className="text-sm text-slate-300">Observed rows: <span className="text-white">{fmtCompactNumber(evaluation.observedRows)}</span></p>
                          ) : null}
                          {constraints?.allowed_domains?.length ? (
                            <p className="text-sm text-slate-300">Allowed domains: <span className="text-white">{constraints.allowed_domains.slice(0, 2).join(', ')}</span></p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {approval ? (
                      <div className="mt-3 rounded-xl border border-amber-400/15 bg-amber-500/8 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">
                            Approval queue
                          </span>
                          <span className="text-xs text-amber-100/80">Needs {approval.required_role} or higher</span>
                          {approval.risk_score != null ? (
                            <span className="text-xs text-amber-100/80">Risk {Math.round(approval.risk_score * 100)}%</span>
                          ) : null}
                          {approvalExpired ? (
                            <span className="rounded-full border border-rose-400/20 bg-rose-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-200">
                              Expired
                            </span>
                          ) : null}
                        </div>
                        {inlineDecisionReason ? (
                          <p className="mt-2 text-xs text-amber-100/85">{inlineDecisionReason}</p>
                        ) : (
                          <p className="mt-2 text-xs text-amber-100/70">You can review this request directly from the ledger.</p>
                        )}
                        <textarea
                          value={decisionNotes[approval.id] || ''}
                          onChange={(event) => setDecisionNotes((current) => ({ ...current, [approval.id]: event.target.value }))}
                          placeholder="Optional review note…"
                          className="mt-3 min-h-[84px] w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500"
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => void handleApprovalDecision(approval.id, 'approve')}
                            disabled={inlineDecisionDisabled}
                            className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-60"
                          >
                            {actingApprovalId === approval.id ? 'Approving…' : 'Approve here'}
                          </button>
                          <button
                            onClick={() => void handleApprovalDecision(approval.id, 'deny')}
                            disabled={inlineDecisionDisabled}
                            className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-60"
                          >
                            {actingApprovalId === approval.id ? 'Working…' : 'Deny here'}
                          </button>
                          <button
                            onClick={() => void handleApprovalEscalation(approval.id)}
                            disabled={actingApprovalId === approval.id || approvalExpired}
                            className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-60"
                          >
                            {actingApprovalId === approval.id ? 'Working…' : 'Escalate'}
                          </button>
                          <button
                            onClick={() => onNavigate(buildApprovalRoute(approval.id, item.connector_id))}
                            className="rounded-xl border border-white/12 bg-white/[0.05] px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.09]"
                          >
                            Open full approval
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {reasons.length > 0 ? (
                      <div className="mt-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Why</p>
                        <div className="mt-1 space-y-1">
                          {reasons.slice(0, 2).map((reason) => (
                            <p key={reason} className="text-sm text-slate-300">{reason}</p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:w-[320px]">
                    <button
                      onClick={() => onNavigate(buildAppsHistoryRoute(item.connector_id))}
                      className="rounded-xl border border-white/12 bg-white/[0.05] px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.09]"
                    >
                      Open app history
                    </button>
                    {item.approval_required && approvalId ? (
                      <button
                        onClick={() => onNavigate(buildApprovalRoute(approvalId, item.connector_id))}
                        className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/15"
                      >
                        Open matching approval
                      </button>
                    ) : jobId ? (
                      <button
                        onClick={() => onNavigate(buildJobRoute(jobId, governance?.decision))}
                        className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/15"
                      >
                        Open linked run
                      </button>
                    ) : (
                      <button
                        onClick={() => onNavigate('jobs')}
                        className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/15"
                      >
                        Open run history
                      </button>
                    )}
                  </div>
                </div>

                {governance?.idempotency_key ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                    <TimerReset className="h-3.5 w-3.5" />
                    Duplicate-write protection recorded for this action.
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-[28px] border border-slate-800/90 bg-slate-900/50 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-300" />
            <h2 className="text-base font-semibold text-white">Use this page for</h2>
          </div>
          <div className="mt-4 space-y-2 text-sm text-slate-300">
            <p>Finding blocked writes before teams assume an app is broken.</p>
            <p>Seeing which actions are waiting on human approval.</p>
            <p>Checking whether controlled writes actually executed after review.</p>
          </div>
        </div>
        <div className="rounded-[28px] border border-slate-800/90 bg-slate-900/50 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
            <h2 className="text-base font-semibold text-white">Next layers to add</h2>
          </div>
          <div className="mt-4 space-y-2 text-sm text-slate-300">
            <p>Inline filters for app, decision, and source chips instead of only selects.</p>
            <p>Deep links into exact app history entries and approval records.</p>
            <p>Budget and blast-radius details next to the decision reason.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
