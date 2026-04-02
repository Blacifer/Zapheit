import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, TimerReset } from 'lucide-react';
import { PageHero } from '../../components/dashboard/PageHero';
import { api } from '../../lib/api-client';

type GovernedAction = {
  id: string;
  connector_id: string;
  action: string;
  success: boolean;
  error_message: string | null;
  duration_ms: number | null;
  approval_required: boolean;
  approval_id: string | null;
  requested_by?: string | null;
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
  } | null;
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

function toneClasses(result?: string | null) {
  if (result === 'succeeded') return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200';
  if (result === 'pending') return 'border-amber-400/20 bg-amber-500/10 text-amber-200';
  return 'border-rose-400/20 bg-rose-500/10 text-rose-200';
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
}: {
  onNavigate: (page: string) => void;
}) {
  const [actions, setActions] = useState<GovernedAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<'all' | 'executed' | 'pending_approval' | 'blocked'>('all');
  const [source, setSource] = useState<'all' | 'gateway' | 'connector_console' | 'runtime'>('all');
  const [service, setService] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.integrations.getGovernedActions({
      ...(decision !== 'all' ? { decision } : {}),
      ...(source !== 'all' ? { source } : {}),
      ...(service !== 'all' ? { service } : {}),
      limit: 100,
    });
    if (res.success) {
      setActions((res.data as GovernedAction[]) || []);
    } else {
      setActions([]);
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
                  {governance?.source ? (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                      {governance.source === 'connector_console' ? 'console' : governance.source}
                    </span>
                  ) : null}
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
