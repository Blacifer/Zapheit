import { Bot, BriefcaseBusiness, Gavel, HandCoins, Loader2, MessageSquare, Shield, X, Zap, CheckCircle2, Settings2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { UnifiedApp } from '../types';
import { trustTierTone, maturityTone, guardrailTone, fmtDate, financeConnectorMode, getAppServiceId, getSetupModeLabel, getSetupModeSummary, getTrustTierLabel, getMaturityLabel, isTallyConnector, isClearTaxConnector, isNaukriConnector, isSlackRail } from '../helpers';

interface OverviewTabProps {
  app: UnifiedApp;
  agentNames: string[];
  onConfigure: (app: UnifiedApp) => void;
  onDisconnect: (app: UnifiedApp) => Promise<void>;
}

export function OverviewTab({ app, agentNames, onConfigure: _onConfigure, onDisconnect }: OverviewTabProps) {
  const rawId = getAppServiceId(app);
  const isWave1 = app.wave === 1;
  const financeMode = financeConnectorMode(rawId);
  const isTally = isTallyConnector(rawId);
  const isClearTax = isClearTaxConnector(rawId);
  const isNaukri = isNaukriConnector(rawId);
  const isSlack = isSlackRail(rawId);
  const row = app.integrationData;
  const advancedModes = (app.advancedSetupModes || []).filter((mode) => mode !== app.primarySetupMode);

  return (
    <div className="space-y-5">
      {app.description && <p className="text-sm text-slate-300 leading-relaxed">{app.description}</p>}

      <div className="rounded-xl border border-cyan-400/15 bg-cyan-500/[0.04] p-4">
        <p className="text-[10px] uppercase tracking-wider text-cyan-300">What this app lets agents do</p>
        <p className="mt-1 text-xs text-slate-300">
          {app.connected
            ? 'Connected agents can use governed capabilities from this app through Zapheit. Read actions can run directly; higher-risk write actions pause for approval when policy requires it.'
            : 'Connect this app once, then assign which agents can use it and supervise every governed action from Zapheit.'}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-white/8 bg-black/10 px-3 py-2">
            <p className="text-[10px] text-slate-500">Capabilities</p>
            <p className="text-sm font-semibold text-white">{app.agentCapabilities?.length || 0}</p>
          </div>
          <div className="rounded-lg border border-white/8 bg-black/10 px-3 py-2">
            <p className="text-[10px] text-slate-500">Linked agents</p>
            <p className="text-sm font-semibold text-white">{agentNames.length}</p>
          </div>
        </div>
        {app.secureCredentialHandling === 'server_injected' && (
          <p className="mt-3 text-[11px] text-slate-400">Credentials stay server-side. Agents never receive raw OAuth tokens or API keys.</p>
        )}
      </div>

      {/* Governance grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
          <p className="text-[10px] text-slate-500 mb-1">Action policy</p>
          <span className={cn('inline-flex text-[10px] px-2 py-1 rounded-md border font-medium', trustTierTone(app.trustTier))}>
            {getTrustTierLabel(app.trustTier)}
          </span>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
          <p className="text-[10px] text-slate-500 mb-1">Readiness</p>
          <span className={cn('inline-flex text-[10px] px-2 py-1 rounded-md border font-medium', maturityTone(app.maturity))}>
            {getMaturityLabel(app.maturity)}
          </span>
        </div>
        {app.governanceSummary && (
          <>
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
              <p className="text-[10px] text-slate-500 mb-0.5">Capabilities</p>
              <p className="text-xs text-slate-200 font-medium">
                {app.governanceSummary.readCount} reads · {app.governanceSummary.actionCount} actions
              </p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
              <p className="text-[10px] text-slate-500 mb-0.5">Enabled actions</p>
              <p className="text-xs text-slate-200 font-medium">
                {app.governanceSummary.enabledActionCount}/{app.governanceSummary.actionCount} enabled
              </p>
            </div>
          </>
        )}
        {isWave1 && (
          <div className="col-span-2 rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <p className="text-[10px] text-slate-500 mb-1">Wave 1 guardrails</p>
            <div className="flex items-center justify-between gap-3">
              <span className={cn('inline-flex text-[10px] px-2 py-1 rounded-md border font-medium', guardrailTone(app.wave1GuardrailsStatus))}>
                {app.wave1GuardrailsStatus || 'missing'}
              </span>
              <span className="text-xs text-slate-300">
                {app.wave1GuardrailsApplied || 0}/{app.wave1GuardrailsTotal || 0} policies applied
              </span>
            </div>
          </div>
        )}
      </div>

      {advancedModes.length > 0 && (
        <div className="rounded-xl border border-indigo-400/15 bg-indigo-500/[0.04] p-4">
          <div className="flex items-start gap-3">
            <Settings2 className="w-4 h-4 text-indigo-300 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Advanced setup</p>
              <p className="text-xs text-slate-300 mt-1">
                This app has one primary connection path in the catalog. Alternate connection methods stay here so operators can switch setup strategy without creating duplicate app cards.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="text-[10px] px-2 py-1 rounded-md border border-emerald-400/20 bg-emerald-500/10 text-emerald-200 font-medium">
                  Primary: {getSetupModeLabel(app.primarySetupMode, app.connectionType)}
                </span>
                {advancedModes.map((mode) => (
                  <span key={mode} className="text-[10px] px-2 py-1 rounded-md border border-white/10 bg-black/10 text-slate-300 font-medium">
                    Alternate: {getSetupModeLabel(mode, app.connectionType)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Domain-specific guidance boxes */}
      {financeMode && (
        <div className="rounded-xl border border-rose-400/15 bg-rose-500/[0.04] p-4 space-y-3">
          <div className="flex items-start gap-3">
            <HandCoins className="w-4 h-4 text-rose-300 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">
                {financeMode === 'cashfree' ? 'Refund and settlement control' : 'Refund and payout control'}
              </p>
              <p className="text-xs text-slate-300 mt-1">
                {financeMode === 'cashfree'
                  ? 'Use this connector as the governed surface for payment investigation, customer refunds, and settlement checks.'
                  : 'Use this connector as the governed surface for payment verification, refunds, and approval-gated disbursements.'}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {(financeMode === 'cashfree'
              ? ['Start with payment review, then move to refund initiation only after reason and amount are confirmed.',
                 'Use settlement checks when finance needs evidence for reconciliation or delayed settlement cases.',
                 'Refunds should include customer-facing reason, payment reference, and approver trail.']
              : ['Verify payment state before issuing refunds or escalating failed collection issues.',
                 'Treat payouts as release actions: beneficiary, amount, and business context should all be reviewed.',
                 'Use payout approvals to separate finance verification from final release authority.']
            ).map((line) => (
              <div key={line} className="rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-[11px] text-slate-300">{line}</div>
            ))}
          </div>
        </div>
      )}

      {isTally && (
        <div className="rounded-xl border border-blue-400/15 bg-blue-500/[0.04] p-4 space-y-3">
          <div className="flex items-start gap-3">
            <HandCoins className="w-4 h-4 text-blue-300 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Accounting and reconciliation control</p>
              <p className="text-xs text-slate-300 mt-1">Use Tally as the governed rail for ledger review, voucher reconciliation, and approval-gated accounting writes.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {['Review ledger context before modifying accounting records.',
              'Use voucher reconciliation to surface mismatches with evidence, not just status changes.',
              'Voucher posting should preserve before/after state and reviewer intent for audit.',
            ].map((line) => (
              <div key={line} className="rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-[11px] text-slate-300">{line}</div>
            ))}
          </div>
        </div>
      )}

      {isClearTax && (
        <div className="rounded-xl border border-sky-400/15 bg-sky-500/[0.04] p-4 space-y-3">
          <div className="flex items-start gap-3">
            <Gavel className="w-4 h-4 text-sky-300 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Compliance filing and notice control</p>
              <p className="text-xs text-slate-300 mt-1">Use ClearTax as the governed rail for compliance posture review, TDS calculations, and approval-gated GST filings.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {['Check compliance posture and notices before taking filing actions.',
              'Use TDS calculations as evidence-backed preparation, not as a hidden intermediate step.',
              'Treat GST filing as an exportable evidence event with approval chain and remediation path.',
            ].map((line) => (
              <div key={line} className="rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-[11px] text-slate-300">{line}</div>
            ))}
          </div>
        </div>
      )}

      {isNaukri && (
        <div className="rounded-xl border border-fuchsia-400/15 bg-fuchsia-500/[0.04] p-4 space-y-3">
          <div className="flex items-start gap-3">
            <BriefcaseBusiness className="w-4 h-4 text-fuchsia-300 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Recruiting search and publishing control</p>
              <p className="text-xs text-slate-300 mt-1">Use Naukri as the governed rail for candidate search, resume evidence, shortlist review, and approval-gated job publishing.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {['Capture recruiter query context before shortlisting candidates.',
              'Treat resume parsing as evidence generation for human screening, not as an autonomous decision step.',
              'Gate job publishing behind approval so role details and audience are deliberate.',
            ].map((line) => (
              <div key={line} className="rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-[11px] text-slate-300">{line}</div>
            ))}
          </div>
        </div>
      )}

      {isSlack && (
        <div className="rounded-xl border border-cyan-400/15 bg-cyan-500/[0.04] p-4 space-y-3">
          <div className="flex items-start gap-3">
            <MessageSquare className="w-4 h-4 text-cyan-300 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Communication and escalation control</p>
              <p className="text-xs text-slate-300 mt-1">Use Slack as the governed rail for channel review, outbound messages, and approval-aware replies into operational threads.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {['Review channel context before posting high-stakes or customer-facing messages.',
              'Use approval and business-hours policies to control outbound communication.',
              'Keep reply trails attributable so operators can explain what was sent, where, and why.',
            ].map((line) => (
              <div key={line} className="rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-[11px] text-slate-300">{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* Agents using this */}
      {agentNames.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Bot className="w-3 h-3" /> Used by</p>
          <div className="flex flex-wrap gap-1.5">
            {agentNames.map((n) => <span key={n} className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-300">{n}</span>)}
          </div>
        </div>
      )}

      {/* Actions unlocked */}
      {app.agentCapabilities && app.agentCapabilities.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Zap className="w-3 h-3 text-amber-300" /> Agent Capabilities</p>
          <div className="flex flex-wrap gap-1.5">
            {app.agentCapabilities.map((a) => <span key={a} className="text-xs px-2 py-1 rounded-lg border border-amber-400/15 bg-amber-500/8 text-amber-200">{a}</span>)}
          </div>
        </div>
      )}

      {/* Permissions */}
      {app.permissions && app.permissions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Shield className="w-3 h-3" /> Permissions</p>
          <ul className="space-y-1.5">
            {app.permissions.map((p) => <li key={p} className="flex items-start gap-2 text-xs text-slate-300"><CheckCircle2 className="w-3 h-3 text-slate-500 mt-0.5 shrink-0" />{p}</li>)}
          </ul>
        </div>
      )}

      {/* Connection health and readiness */}
      {row && (
        <>
          <div className={cn(
            'rounded-xl border px-4 py-3',
            app.status === 'error' || app.status === 'expired'
              ? 'border-rose-400/20 bg-rose-500/[0.05]'
              : app.status === 'syncing'
                ? 'border-amber-400/20 bg-amber-500/[0.05]'
                : 'border-emerald-400/15 bg-emerald-500/[0.04]'
          )}>
            <p className="text-xs font-semibold text-slate-400 mb-1">Reliability state</p>
            <p className={cn(
              'text-xs',
              app.status === 'error' || app.status === 'expired'
                ? 'text-rose-300'
                : app.status === 'syncing'
                  ? 'text-amber-300'
                  : 'text-emerald-300'
            )}>
              {app.status === 'error'
                ? 'Degraded'
                : app.status === 'expired'
                  ? 'Credentials expired'
                  : app.status === 'syncing'
                    ? 'Syncing'
                    : 'Healthy'}
              {row.lastErrorMsg ? ` · ${row.lastErrorMsg}` : ''}
            </p>
            <p className="mt-2 text-[11px] text-slate-300">
              {app.status === 'error' || app.status === 'expired'
                ? 'Resolve the connector issue before trusting blocked or retried actions to complete cleanly.'
                : app.status === 'syncing'
                  ? 'Wait for sync to settle before treating retries or delayed actions as final.'
                  : 'Connection health is stable. Governed action outcomes are more likely to reflect policy, not rail instability.'}
            </p>
          </div>
          {row.tokenExpiresAt && (
            <div className={cn('rounded-xl border px-4 py-3', row.tokenExpired || row.tokenExpiresSoon ? 'border-amber-400/20 bg-amber-500/[0.05]' : 'border-white/8 bg-white/[0.02]')}>
              <p className="text-xs font-semibold text-slate-400 mb-1">Token Expiry</p>
              <p className={cn('text-xs', row.tokenExpired ? 'text-rose-300' : row.tokenExpiresSoon ? 'text-amber-300' : 'text-slate-300')}>
                {row.tokenExpired ? 'Expired' : row.tokenExpiresSoon ? 'Expiring soon' : 'Valid'} · {fmtDate(row.tokenExpiresAt)}
              </p>
            </div>
          )}
          {row.readiness?.items?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Setup Checklist</p>
              <div className="space-y-1.5">
                {row.readiness.items.map((item: any) => (
                  <div key={item.id} className="flex items-start gap-2">
                    <span className={cn('mt-0.5 shrink-0 text-[10px] px-1.5 py-0.5 rounded-md border font-medium',
                      item.status === 'ok' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                      : item.status === 'blocked' ? 'border-rose-400/20 bg-rose-400/10 text-rose-100'
                      : 'border-amber-400/20 bg-amber-400/10 text-amber-100'
                    )}>{item.status}</span>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-300">{item.label}</p>
                      {item.detail && <p className="text-[10px] text-slate-500 mt-0.5">{item.detail}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        {app.developer && (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <p className="text-[10px] text-slate-500 mb-0.5">Provider</p>
            <p className="text-xs text-slate-200 font-medium">{app.developer}</p>
          </div>
        )}
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
          <p className="text-[10px] text-slate-500 mb-0.5">Connection mode</p>
          <p className="text-xs text-slate-200 font-medium">
            {getSetupModeSummary(app.primarySetupMode, app.connectionType)}
          </p>
        </div>
        {app.setupTimeMinutes != null && (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <p className="text-[10px] text-slate-500 mb-0.5">Setup time</p>
            <p className="text-xs text-slate-200 font-medium">~{app.setupTimeMinutes} min</p>
          </div>
        )}
      </div>

      {/* Error detail */}
      {app.lastErrorMsg && (
        <div className="rounded-xl border border-rose-400/20 bg-rose-500/[0.05] px-4 py-3">
          <p className="text-xs font-semibold text-rose-300 mb-1">Last error</p>
          <p className="text-xs text-slate-300 font-mono break-all">{app.lastErrorMsg}</p>
        </div>
      )}

      {/* Governance note */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 flex items-start gap-3">
        <Shield className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-400">This app is exposed as a governed operational rail. Actions can be blocked, approval-gated, audited, and investigated from Zapheit.</p>
      </div>

      {/* Danger zone */}
      <div className="pt-2 border-t border-white/8">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Danger zone</p>
        <button
          onClick={() => void onDisconnect(app)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-400/20 bg-rose-500/[0.05] text-rose-400 hover:bg-rose-500/10 text-xs font-medium transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Disconnect
        </button>
      </div>
    </div>
  );
}
