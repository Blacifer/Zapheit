import { Shield, ShieldAlert, ShieldCheck, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export interface ActionBarAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  governance?: 'auto' | 'needs_approval' | 'blocked';
  loading?: boolean;
  disabled?: boolean;
}

export interface ActionBarProps {
  actions: ActionBarAction[];
  className?: string;
}

const VARIANT_CLASSES = {
  primary: 'bg-cyan-600 hover:bg-cyan-500 text-white',
  secondary: 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200',
  danger: 'bg-red-600/80 hover:bg-red-600 text-white',
};

const GOVERNANCE_BADGE = {
  auto: { icon: ShieldCheck, label: 'Auto', color: 'text-emerald-400' },
  needs_approval: { icon: ShieldAlert, label: 'Approval required', color: 'text-amber-400' },
  blocked: { icon: Shield, label: 'Blocked by policy', color: 'text-red-400' },
};

export function ActionBar({ actions, className = '' }: ActionBarProps) {
  if (actions.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {actions.map((action) => {
        const variant = action.variant || 'secondary';
        const govInfo = action.governance ? GOVERNANCE_BADGE[action.governance] : null;
        const isDisabled = action.disabled || action.loading || action.governance === 'blocked';

        return (
          <button
            key={action.id}
            onClick={action.onClick}
            disabled={isDisabled}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              isDisabled ? 'opacity-50 cursor-not-allowed' : ''
            } ${VARIANT_CLASSES[variant]}`}
          >
            {action.loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : action.icon ? (
              action.icon
            ) : null}
            {action.label}
            {govInfo && (
              <span className={`inline-flex items-center gap-1 text-xs ${govInfo.color}`} title={govInfo.label}>
                <govInfo.icon className="w-3 h-3" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
