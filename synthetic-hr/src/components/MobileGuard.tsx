import { Monitor, CheckCircle2, type LucideIcon } from 'lucide-react';
import { useIsMobile } from '../hooks/use-mobile';

interface QuickAction {
  label: string;
  icon: LucideIcon;
}

interface MobileGuardProps {
  children: React.ReactNode;
  /** Name of workspace e.g. "Jira" */
  appName: string;
  /** Quick actions available on mobile */
  quickActions?: QuickAction[];
}

/**
 * Wraps workspace pages. On mobile, shows an "Open on Desktop" message
 * with available quick actions instead of the full workspace.
 */
export function MobileGuard({ children, appName, quickActions = [] }: MobileGuardProps) {
  const isMobile = useIsMobile();

  if (!isMobile) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-6">
      <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-white/[0.08] flex items-center justify-center">
        <Monitor className="w-7 h-7 text-slate-400" />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-white">
          {appName} Workspace
        </h2>
        <p className="text-sm text-slate-400 max-w-xs">
          The full workspace experience is optimized for desktop. Open this page on a larger screen for the best experience.
        </p>
      </div>

      {quickActions.length > 0 && (
        <div className="w-full max-w-xs space-y-2">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Available on mobile</p>
          <div className="space-y-1.5">
            {quickActions.map((a) => (
              <div
                key={a.label}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-left"
              >
                <a.icon className="w-4 h-4 text-slate-500 shrink-0" />
                <span className="text-sm text-slate-300">{a.label}</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 ml-auto shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
