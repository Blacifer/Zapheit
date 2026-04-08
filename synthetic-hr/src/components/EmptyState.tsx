import { AlertCircle, Unplug, RefreshCw, Inbox, Search } from 'lucide-react';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  type?: 'no-data' | 'disconnected' | 'error' | 'no-results';
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const DEFAULTS: Record<string, { icon: typeof Inbox; title: string; description: string }> = {
  'no-data': {
    icon: Inbox,
    title: 'No data yet',
    description: 'Data will appear here once the connection is active.',
  },
  disconnected: {
    icon: Unplug,
    title: 'App not connected',
    description: 'Connect this app to view and manage its data.',
  },
  error: {
    icon: AlertCircle,
    title: 'Something went wrong',
    description: 'We couldn\'t load the data. Please try again.',
  },
  'no-results': {
    icon: Search,
    title: 'No results found',
    description: 'Try adjusting your search or filters.',
  },
};

export function EmptyState({
  type = 'no-data',
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  const defaults = DEFAULTS[type] || DEFAULTS['no-data'];
  const Icon = defaults.icon;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
        {icon || <Icon className="w-5 h-5 text-zinc-500" />}
      </div>
      <h3 className="text-sm font-medium text-zinc-300 mb-1">
        {title || defaults.title}
      </h3>
      <p className="text-xs text-zinc-500 max-w-xs mb-4">
        {description || defaults.description}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
        >
          {type === 'error' && <RefreshCw className="w-3.5 h-3.5" />}
          {action.label}
        </button>
      )}
    </div>
  );
}
