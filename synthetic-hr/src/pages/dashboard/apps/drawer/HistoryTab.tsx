import { Loader2, RefreshCw } from 'lucide-react';
import { ReasonCallout } from '../../../../components/dashboard/ReasonCallout';
import { cn } from '../../../../lib/utils';
import type { UnifiedApp, ConnectorExecution, ConnectionLog } from '../types';
import { fmtDate, financeConnectorMode, isTallyConnector, isClearTaxConnector, isNaukriConnector, isSlackRail } from '../helpers';
import {
  financeExecutionSummary, tallyExecutionSummary,
  clearTaxExecutionSummary, naukriExecutionSummary, slackExecutionSummary,
} from '../domain-guidance';

interface HistoryTabProps {
  app: UnifiedApp;
  executions: ConnectorExecution[];
  logs: ConnectionLog[];
  executionsLoading: boolean;
  logsLoading: boolean;
  onRefresh: () => void;
}

export function HistoryTab({ app, executions, logs, executionsLoading, onRefresh }: HistoryTabProps) {
  const rawId = app.source === 'marketplace' ? app.appData?.id : app.integrationData?.id;
  const financeMode = financeConnectorMode(rawId);
  const isTally = isTallyConnector(rawId);
  const isClearTax = isClearTaxConnector(rawId);
  const isNaukri = isNaukriConnector(rawId);
  const isSlack = isSlackRail(rawId);
  const blockedCount = executions.filter((execution) => execution.governance?.result === 'blocked').length;
  const pendingCount = executions.filter((execution) => execution.governance?.result === 'pending').length;
  const successCount = executions.filter((execution) => execution.governance?.result === 'succeeded' || (execution.governance == null && execution.success)).length;
  const sourceCounts = executions.reduce<Record<string, number>>((acc, execution) => {
    const source = execution.governance?.source || 'connector_console';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-400">Recent governed activity and connection events</p>
        <button onClick={onRefresh} className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {!executionsLoading && executions.length > 0 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            { label: 'Succeeded', value: successCount, tone: 'text-emerald-200 border-emerald-400/15 bg-emerald-500/8' },
            { label: 'Pending', value: pendingCount, tone: 'text-amber-200 border-amber-400/15 bg-amber-500/8' },
            { label: 'Blocked', value: blockedCount, tone: 'text-rose-200 border-rose-400/15 bg-rose-500/8' },
            {
              label: 'Primary source',
              value: Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0]?.replace(/_/g, ' ') || 'console',
              tone: 'text-slate-200 border-white/10 bg-white/[0.03]',
            },
          ].map((card) => (
            <div key={card.label} className={`rounded-xl border px-3 py-2.5 ${card.tone}`}>
              <p className="text-[10px] uppercase tracking-wider opacity-70">{card.label}</p>
              <p className="mt-1 text-sm font-semibold">{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Domain evidence checklists */}
      {financeMode && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Finance evidence checklist</p>
          <div className="mt-2 grid grid-cols-1 gap-1.5 text-[11px] text-slate-300">
            <p>Capture the payment or beneficiary reference for every money-moving action.</p>
            <p>Record reviewer intent before approval when thresholds or dual approval apply.</p>
            <p>Use before/after state and remediation notes to close reconciliation gaps.</p>
          </div>
        </div>
      )}
      {isTally && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Accounting evidence checklist</p>
          <div className="mt-2 grid grid-cols-1 gap-1.5 text-[11px] text-slate-300">
            <p>Capture voucher identifiers, mismatch counts, and ledger snapshots for each accounting workflow.</p>
            <p>Use before/after state to explain exactly what changed in a posting or reconciliation step.</p>
            <p>Document remediation when finance has to correct a mismatch or replay a posting.</p>
          </div>
        </div>
      )}
      {isClearTax && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Compliance evidence checklist</p>
          <div className="mt-2 grid grid-cols-1 gap-1.5 text-[11px] text-slate-300">
            <p>Capture filing identifiers, notice context, and approval rationale for every regulated action.</p>
            <p>Persist TDS inputs and outputs so calculations can be reviewed after the fact.</p>
            <p>Use remediation notes to track missed deadlines, rejected submissions, or notice follow-up.</p>
          </div>
        </div>
      )}
      {isNaukri && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Recruiting evidence checklist</p>
          <div className="mt-2 grid grid-cols-1 gap-1.5 text-[11px] text-slate-300">
            <p>Capture search criteria, candidate identifiers, and reviewer rationale for shortlist actions.</p>
            <p>Preserve resume parsing output so recruiting teams can explain why a profile was advanced.</p>
            <p>Use publishing evidence and remediation notes when job postings need correction or rollback.</p>
          </div>
        </div>
      )}
      {isSlack && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Communication evidence checklist</p>
          <div className="mt-2 grid grid-cols-1 gap-1.5 text-[11px] text-slate-300">
            <p>Capture destination channel, message intent, and any approval rationale for outbound messages.</p>
            <p>Preserve thread references so replies can be traced back to the triggering conversation.</p>
            <p>Use remediation notes when a message is blocked, revised, or requires follow-up communication.</p>
          </div>
        </div>
      )}

      {executionsLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 text-slate-500 animate-spin" /></div>
      ) : executions.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-4">No governed actions recorded yet.</p>
      ) : null}

      {executions.map((execution) => {
        const fSummary = financeMode ? financeExecutionSummary(financeMode, execution) : null;
        const tSummary = isTally ? tallyExecutionSummary(execution) : null;
        const cSummary = isClearTax ? clearTaxExecutionSummary(execution) : null;
        const nSummary = isNaukri ? naukriExecutionSummary(execution) : null;
        const sSummary = isSlack ? slackExecutionSummary(execution) : null;
        const governance = execution.governance;
        const statusLabel =
          governance?.result === 'pending' ? 'pending approval'
          : governance?.result === 'blocked' ? 'blocked'
          : execution.success ? 'success'
          : 'failed';
        const statusClass =
          governance?.result === 'pending'
            ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
            : governance?.result === 'blocked'
              ? 'border-rose-400/20 bg-rose-400/10 text-rose-100'
              : execution.success
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                : 'border-rose-400/20 bg-rose-400/10 text-rose-100';

        return (
          <div key={execution.id} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md border font-medium', statusClass)}>{statusLabel}</span>
              {execution.approval_required && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-amber-400/20 bg-amber-400/10 text-amber-100 font-medium">approval gated</span>
              )}
              {governance?.source && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-300 font-medium">
                  {governance.source === 'connector_console' ? 'console' : governance.source}
                </span>
              )}
              <p className="text-xs text-slate-300 flex-1 truncate">{execution.action}</p>
              <p className="text-[10px] text-slate-600 shrink-0">{fmtDate(execution.created_at)}</p>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {execution.duration_ms ? `${execution.duration_ms} ms` : 'Duration unavailable'}
              {execution.error_message ? ` · ${execution.error_message}` : ''}
            </p>
            {[fSummary, tSummary, cSummary, nSummary, sSummary].filter(Boolean).map((summary) => (
              <div key={summary!.title} className="mt-2 rounded-lg border border-white/8 bg-black/10 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{summary!.title}</p>
                <div className="mt-1 space-y-1">
                  {summary!.lines.map((line) => <p key={line} className="text-[11px] text-slate-300">{line}</p>)}
                </div>
              </div>
            ))}
            {governance && (
              <div className="mt-2 rounded-lg border border-white/8 bg-black/10 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Governance record</p>
                <div className="mt-1 space-y-1">
                  <p className="text-[11px] text-slate-300">
                    Decision: <span className="text-slate-100">{governance.decision.replace(/_/g, ' ')}</span>
                    {governance.required_role ? <> · Required role: <span className="text-slate-100">{governance.required_role}</span></> : null}
                  </p>
                  {governance.policy_id && (
                    <p className="text-[11px] text-slate-300">Policy: <span className="font-mono text-slate-100">{governance.policy_id}</span></p>
                  )}
                  {governance.block_reasons && governance.block_reasons.length > 0 && (
                    <p className="text-[11px] text-rose-200">Reason: {governance.block_reasons.join(' · ')}</p>
                  )}
                  {governance.approval_reasons && governance.approval_reasons.length > 0 && (
                    <p className="text-[11px] text-amber-200">Approval basis: {governance.approval_reasons.join(' · ')}</p>
                  )}
                  {governance.idempotency_key && (
                    <p className="text-[11px] text-slate-400">Idempotency key recorded for duplicate-write protection.</p>
                  )}
                </div>
              </div>
            )}
            <ReasonCallout
              className="mt-2 bg-black/10"
              messageClassName="text-[11px]"
              nextActionClassName="text-[11px]"
              reasonMessage={execution.reason_category ? execution.reason_message : null}
              recommendedNextAction={execution.reason_category ? execution.recommended_next_action : null}
            />
            {(execution.requested_by || execution.policy_snapshot || execution.before_state || execution.after_state || execution.remediation) && (
              <div className="mt-2 space-y-2 border-t border-white/[0.06] pt-2">
                {execution.requested_by && (
                  <p className="text-[11px] text-slate-500">Requested by <span className="font-mono text-slate-300">{execution.requested_by}</span></p>
                )}
                {execution.policy_snapshot && Object.keys(execution.policy_snapshot).length > 0 && (
                  <details className="text-[11px] text-slate-500">
                    <summary className="cursor-pointer text-slate-400">Policy snapshot</summary>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-black/20 p-2 text-[10px] text-slate-300">{JSON.stringify(execution.policy_snapshot, null, 2)}</pre>
                  </details>
                )}
                {execution.before_state && Object.keys(execution.before_state).length > 0 && (
                  <details className="text-[11px] text-slate-500">
                    <summary className="cursor-pointer text-slate-400">Before state</summary>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-black/20 p-2 text-[10px] text-slate-300">{JSON.stringify(execution.before_state, null, 2)}</pre>
                  </details>
                )}
                {execution.after_state && Object.keys(execution.after_state).length > 0 && (
                  <details className="text-[11px] text-slate-500">
                    <summary className="cursor-pointer text-slate-400">After state</summary>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-black/20 p-2 text-[10px] text-slate-300">{JSON.stringify(execution.after_state, null, 2)}</pre>
                  </details>
                )}
                {execution.remediation && Object.keys(execution.remediation).length > 0 && (
                  <details className="text-[11px] text-slate-500">
                    <summary className="cursor-pointer text-slate-400">Remediation</summary>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-black/20 p-2 text-[10px] text-slate-300">{JSON.stringify(execution.remediation, null, 2)}</pre>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })}

      {logs.length > 0 && (
        <>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider pt-2">Connection events</p>
          {logs.map((log) => (
            <div key={log.id} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md border font-medium',
                  log.status === 'success' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                  : log.status === 'error' ? 'border-rose-400/20 bg-rose-400/10 text-rose-100'
                  : 'border-white/10 bg-white/5 text-slate-300'
                )}>{log.status}</span>
                <p className="text-xs text-slate-300 flex-1 truncate">{log.action}</p>
                <p className="text-[10px] text-slate-600 shrink-0">{fmtDate(log.created_at)}</p>
              </div>
              {log.message && <p className="text-[11px] text-slate-500 mt-1 font-mono">{log.message}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
