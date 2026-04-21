import { AlertCircle, Unplug, RefreshCw, Inbox, Search } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

export interface EmptyStateProps {
  type?: 'no-data' | 'disconnected' | 'error' | 'no-results';
  title?: string;
  description?: string;
  /** Pass a Lucide icon component or any ReactNode */
  icon?: ComponentType<{ className?: string }> | ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

const DEFAULTS: Record<string, { Icon: ComponentType<{ className?: string }>; title: string; description: string }> = {
  'no-data':     { Icon: Inbox,        title: 'No data yet',        description: 'Data will appear here once the connection is active.' },
  disconnected:  { Icon: Unplug,       title: 'App not connected',  description: 'Connect this app to view and manage its data.' },
  error:         { Icon: AlertCircle,  title: 'Something went wrong', description: "We couldn't load the data. Please try again." },
  'no-results':  { Icon: Search,       title: 'No results found',   description: 'Try adjusting your search or filters.' },
};

export function EmptyState({ type = 'no-data', title, description, icon, action, secondaryAction }: EmptyStateProps) {
  const defaults = DEFAULTS[type] ?? DEFAULTS['no-data'];

  const iconNode = (() => {
    if (!icon) return <defaults.Icon className="w-7 h-7 text-slate-400" />;
    if (typeof icon === 'function') {
      const IconComp = icon as ComponentType<{ className?: string }>;
      return <IconComp className="w-7 h-7 text-slate-400" />;
    }
    return icon as ReactNode;
  })();

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 rounded-2xl border border-white/10 bg-white/[0.04] flex items-center justify-center mb-5">
        {iconNode}
      </div>
      <h3 className="text-base font-semibold text-white mb-1.5">
        {title ?? defaults.title}
      </h3>
      <p className="text-sm text-slate-400 max-w-xs mb-5 leading-relaxed">
        {description ?? defaults.description}
      </p>
      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {action && (
            <button
              onClick={action.onClick}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-cyan-500 hover:bg-cyan-400 text-white transition-colors"
            >
              {type === 'error' && <RefreshCw className="w-3.5 h-3.5" />}
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border border-white/10 text-slate-300 hover:bg-white/[0.06] transition-colors"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
