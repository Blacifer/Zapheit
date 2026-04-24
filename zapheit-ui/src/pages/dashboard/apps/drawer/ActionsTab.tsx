import { Loader2, Shield } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { UnifiedApp } from '../types';
import { trustTierTone, financeConnectorMode, getAppServiceId, isTallyConnector, isClearTaxConnector, isNaukriConnector, isSlackRail } from '../helpers';
import {
  financeActionGuidance, tallyActionGuidance,
  clearTaxActionGuidance, naukriActionGuidance, slackActionGuidance,
} from '../domain-guidance';

interface ActionsTabProps {
  app: UnifiedApp;
  catalog: any[];
  catalogLoading: boolean;
  seedingPolicies: boolean;
  onToggleAction: (item: any) => void;
  onSeedWave1: () => void;
}

export function ActionsTab({ app, catalog, catalogLoading, seedingPolicies, onToggleAction, onSeedWave1 }: ActionsTabProps) {
  const rawId = getAppServiceId(app);
  const isWave1 = app.wave === 1;
  const financeMode = financeConnectorMode(rawId);
  const isTally = isTallyConnector(rawId);
  const isClearTax = isClearTaxConnector(rawId);
  const isNaukri = isNaukriConnector(rawId);
  const isSlack = isSlackRail(rawId);

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs text-slate-400">Review what this app can safely do, what requires approval, and which actions are currently enabled.</p>
        {isWave1 && (
          <button
            onClick={onSeedWave1}
            disabled={seedingPolicies}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-medium text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
          >
            {seedingPolicies ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
            Apply Wave 1 guardrails
          </button>
        )}
      </div>

      {/* Domain workflow recommendations */}
      {financeMode && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Recommended finance workflow</p>
          <div className="mt-2 space-y-1.5 text-[11px] text-slate-300">
            {financeMode === 'cashfree' ? (
              <><p>1. Review payment activity or settlement status.</p><p>2. Confirm refund reason, amount, and threshold routing.</p><p>3. Use execution history as the evidence trail for finance review.</p></>
            ) : (
              <><p>1. Verify customer payment state before issuing a refund.</p><p>2. For payouts, validate beneficiary and amount before release.</p><p>3. Require explicit approval notes on high-value disbursements.</p></>
            )}
          </div>
        </div>
      )}
      {isTally && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Recommended accounting workflow</p>
          <div className="mt-2 space-y-1.5 text-[11px] text-slate-300">
            <p>1. Review ledger context and account state before changing voucher records.</p>
            <p>2. Reconcile mismatches with explicit evidence instead of silent accounting updates.</p>
            <p>3. Post vouchers only after the approver trail and before/after state are complete.</p>
          </div>
        </div>
      )}
      {isClearTax && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Recommended compliance workflow</p>
          <div className="mt-2 space-y-1.5 text-[11px] text-slate-300">
            <p>1. Assess compliance posture and notice context before creating filing actions.</p>
            <p>2. Use TDS and GST preparation steps to build evidence and approval context.</p>
            <p>3. File only when the approval chain and remediation path are visible from history.</p>
          </div>
        </div>
      )}
      {isNaukri && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Recommended recruiting workflow</p>
          <div className="mt-2 space-y-1.5 text-[11px] text-slate-300">
            <p>1. Search and review candidate context before creating or updating a shortlist.</p>
            <p>2. Parse resume evidence so recruiters can validate structured signals against the source document.</p>
            <p>3. Publish jobs only after role content and approval routing are confirmed.</p>
          </div>
        </div>
      )}
      {isSlack && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Recommended communication workflow</p>
          <div className="mt-2 space-y-1.5 text-[11px] text-slate-300">
            <p>1. Review channel or user context before sending a message.</p>
            <p>2. Preview outbound content and let policy decide whether approval or business-hours delay applies.</p>
            <p>3. Use execution history to confirm where the message landed and whether follow-up is needed.</p>
          </div>
        </div>
      )}

      {catalogLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 text-slate-500 animate-spin" /></div>
      ) : catalog.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-8">No actions defined for this app.</p>
      ) : (
        catalog.map((item, i) => (
          <div key={item.id || item.action || i} className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-200">{item.label || item.action}</p>
              {item.description && <p className="text-[11px] text-slate-500 mt-0.5">{item.description}</p>}
              <div className="flex flex-wrap gap-1.5 mt-1">
                {item.risk && (
                  <span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded-md border font-medium',
                    item.risk === 'high' || item.risk === 'money' ? 'border-rose-400/20 bg-rose-400/10 text-rose-100'
                    : item.risk === 'medium' ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
                    : 'border-white/10 bg-white/5 text-slate-300'
                  )}>{item.risk} risk</span>
                )}
                {item.operation && <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-300 font-medium">{item.operation}</span>}
                {item.objectType && <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-300 font-medium">{item.objectType}</span>}
                {item.trustTier && <span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded-md border font-medium', trustTierTone(item.trustTier))}>{item.trustTier}</span>}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {item.policySummary || (item.requireApproval ? 'Approval required' : 'Direct execution')}
                {item.requiredRole ? ` · ${item.requiredRole}+` : ''}
                {item.reversible ? ' · reversible' : ''}
              </p>
              {financeMode && financeActionGuidance(financeMode, item.action) && (
                <div className="mt-1.5 rounded-lg border border-white/8 bg-black/10 px-2.5 py-2">
                  <p className="text-[11px] text-slate-300">{financeActionGuidance(financeMode, item.action)}</p>
                </div>
              )}
              {isTally && tallyActionGuidance(item.action) && (
                <div className="mt-1.5 rounded-lg border border-white/8 bg-black/10 px-2.5 py-2">
                  <p className="text-[11px] text-slate-300">{tallyActionGuidance(item.action)}</p>
                </div>
              )}
              {isClearTax && clearTaxActionGuidance(item.action) && (
                <div className="mt-1.5 rounded-lg border border-white/8 bg-black/10 px-2.5 py-2">
                  <p className="text-[11px] text-slate-300">{clearTaxActionGuidance(item.action)}</p>
                </div>
              )}
              {isNaukri && naukriActionGuidance(item.action) && (
                <div className="mt-1.5 rounded-lg border border-white/8 bg-black/10 px-2.5 py-2">
                  <p className="text-[11px] text-slate-300">{naukriActionGuidance(item.action)}</p>
                </div>
              )}
              {isSlack && slackActionGuidance(item.action) && (
                <div className="mt-1.5 rounded-lg border border-white/8 bg-black/10 px-2.5 py-2">
                  <p className="text-[11px] text-slate-300">{slackActionGuidance(item.action)}</p>
                </div>
              )}
              {Array.isArray(item.constraints) && item.constraints.slice(0, 2).map((c: string) => (
                <p key={c} className="text-[10px] text-slate-600 mt-0.5">• {c}</p>
              ))}
            </div>
            <button
              onClick={() => onToggleAction(item)}
              className={cn('shrink-0 w-9 h-5 rounded-full transition-colors relative', item.enabled ? 'bg-emerald-500' : 'bg-white/10')}
            >
              <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', item.enabled ? 'translate-x-4' : 'translate-x-0.5')} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
