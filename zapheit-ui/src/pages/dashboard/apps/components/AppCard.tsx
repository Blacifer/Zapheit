import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { UnifiedApp } from '../types';
import { AppLogo } from './AppLogo';
import { trustTierTone, maturityTone } from '../helpers';
import { certificationTone } from '../../../../lib/production-readiness';

interface AppCardProps {
  app: UnifiedApp;
  onClick: () => void;
}

export function AppCard({ app, onClick }: AppCardProps) {
  return (
    <button
      onClick={onClick}
      className="group w-full text-left rounded-2xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-150 p-4 flex flex-col gap-3"
    >
      <AppLogo appId={app.appId} logoLetter={app.logoLetter} colorHex={app.colorHex} size="lg" />

      <div className="space-y-1 flex-1 min-w-0">
        {app.badge && (
          <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/20 mb-1">
            {app.badge}
          </span>
        )}
        <p className="font-semibold text-white text-sm leading-tight truncate">{app.name}</p>
        <p className="text-xs text-slate-500 leading-snug line-clamp-2">{app.description}</p>
      </div>

      {/* Governance badges — front and center */}
      {(app.trustTier || app.maturity || app.connectorCertification) && (
        <div className="flex flex-wrap gap-1">
          {app.trustTier && (
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md border font-medium', trustTierTone(app.trustTier))}>
              {app.trustTier}
            </span>
          )}
          {app.maturity && app.maturity !== 'connected' && (
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md border font-medium', maturityTone(app.maturity))}>
              {app.maturity}
            </span>
          )}
          {app.connectorCertification && (
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md border font-medium', certificationTone(app.connectorCertification.state))}>
              {app.connectorCertification.label}
            </span>
          )}
        </div>
      )}

      {app.connected && (
        <div className="flex items-center gap-1.5">
          {app.status === 'error' ? (
            <AlertCircle className="w-3 h-3 text-rose-400" />
          ) : (
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          )}
          <span className={cn('text-[11px] font-medium', app.status === 'error' ? 'text-rose-400' : 'text-emerald-400')}>
            {app.status === 'error' ? 'Error' : 'Connected'}
          </span>
        </div>
      )}
    </button>
  );
}
