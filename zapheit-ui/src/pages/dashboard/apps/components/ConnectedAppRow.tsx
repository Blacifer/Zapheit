import { useRef, useState } from 'react';
import { AlertCircle, Bot, ExternalLink, Loader2, MoreHorizontal, Zap } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { UnifiedApp } from '../types';
import { trustTierTone, maturityTone, guardrailTone, getTrustTierLabel, getMaturityLabel, useOutsideClick } from '../helpers';
import { AppLogo } from './AppLogo';
import { StatusBadge } from '../workspaces/shared';

interface ConnectedAppRowProps {
  app: UnifiedApp;
  agentNames: string[];
  onClick: (app: UnifiedApp) => void;
  onConfigure: (app: UnifiedApp) => void;
  onDisconnect: (app: UnifiedApp) => void;
  healthResult?: 'ok' | 'error' | null;
}

export function ConnectedAppRow({ app, agentNames, onClick, onConfigure, onDisconnect, healthResult }: ConnectedAppRowProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideClick(menuRef, () => setShowMenu(false));
  const hasError = app.status === 'error' || app.status === 'expired';

  return (
    <div
      onClick={() => onClick(app)}
      className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 px-4 rounded-2xl border border-white/8 bg-white/[0.02] hover:bg-white/[0.05] transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <AppLogo appId={app.appId} logoLetter={app.logoLetter} colorHex={app.colorHex} logoUrl={app.logoUrl} size="sm" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white leading-tight">{app.name}</p>
            <StatusBadge
              status={
                healthResult === 'ok' ? 'healthy'
                  : healthResult === 'error' ? 'error'
                  : app.supportsHealthTest === false ? 'unknown'
                  : 'connected'
              }
            />
          </div>
          <div className="hidden sm:flex items-center gap-2 flex-wrap mt-0.5">
            {app.trustTier && (
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md border font-medium', trustTierTone(app.trustTier))}>
                {getTrustTierLabel(app.trustTier)}
              </span>
            )}
            {app.wave === 1 && app.wave1GuardrailsStatus && (
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md border font-medium', guardrailTone(app.wave1GuardrailsStatus))}>
                {app.wave1GuardrailsStatus === 'applied' ? 'guardrails applied'
                  : app.wave1GuardrailsStatus === 'partial' ? 'guardrails partial'
                  : 'guardrails missing'}
              </span>
            )}
            {app.maturity && (
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md border font-medium', maturityTone(app.maturity))}>
                {getMaturityLabel(app.maturity)}
              </span>
            )}
          </div>
        {agentNames.length > 0 && (
          <div className="flex items-center gap-1 mt-0.5">
            <Bot className="w-3 h-3 text-slate-500 shrink-0" />
            <p className="text-[11px] text-slate-500 truncate">
              {agentNames.slice(0, 3).join(', ')}{agentNames.length > 3 ? ` +${agentNames.length - 3}` : ''}
            </p>
          </div>
        )}
        {app.integrationData?.last_tested_at && (
          <p className="text-[11px] text-slate-600 mt-0.5">Last tested {new Date(app.integrationData.last_tested_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
        )}
        {app.lastErrorMsg && (
          <p className="text-[11px] text-rose-400 mt-0.5 truncate">{app.lastErrorMsg}</p>
        )}
        </div>
      </div>

      {app.governanceSummary && !hasError && (
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          <Zap className="w-3 h-3 text-amber-400" />
          <span className="text-xs text-slate-500">
            {app.governanceSummary.enabledActionCount}/{app.governanceSummary.actionCount} actions enabled
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 shrink-0 pl-0 sm:pl-0" onClick={(e) => e.stopPropagation()}>
        {hasError ? (
          <button
            onClick={() => onConfigure(app)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-400/25 bg-rose-500/10 text-rose-300 text-xs font-medium hover:bg-rose-500/20 transition-colors"
          >
            <AlertCircle className="w-3.5 h-3.5" /> Reconnect
          </button>
        ) : app.status === 'syncing' ? (
          <span className="flex items-center gap-1.5 text-xs text-amber-300 font-medium px-3 py-1.5 rounded-xl border border-amber-400/20 bg-amber-500/10">
            <Loader2 className="w-3 h-3 animate-spin" /> Syncing
          </span>
        ) : (
          <button
            onClick={() => onClick(app)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white text-xs font-medium transition-colors"
          >
            <ExternalLink className="w-3 h-3" /> Open workspace
          </button>
        )}

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {showMenu && (
            <div className="absolute top-full mt-1 right-0 w-44 rounded-xl border border-white/10 bg-[#161b26] shadow-xl z-10 overflow-hidden">
              <button
                onClick={() => { onConfigure(app); setShowMenu(false); }}
                className="w-full text-left px-3.5 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
              >
                {app.authType === 'oauth2' ? 'Reauthorize' : 'Update credentials'}
              </button>
              <button
                onClick={() => { onClick(app); setShowMenu(false); }}
                className="w-full text-left px-3.5 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
              >
                View details
              </button>
              <div className="border-t border-white/8" />
              <button
                onClick={() => { onDisconnect(app); setShowMenu(false); }}
                className="w-full text-left px-3.5 py-2.5 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
