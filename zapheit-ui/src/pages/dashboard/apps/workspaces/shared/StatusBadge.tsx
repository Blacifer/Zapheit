export interface StatusBadgeProps {
  status: string;
  label?: string;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  connected:     { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Connected' },
  healthy:       { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Healthy' },
  active:        { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Active' },
  success:       { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Success' },
  open:          { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    dot: 'bg-cyan-400',    label: 'Open' },
  syncing:       { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    dot: 'bg-cyan-400',    label: 'Syncing' },
  pending:       { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Pending' },
  sample_data:   { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Sample Data' },
  demo:          { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Sample Data' },
  degraded:      { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Degraded' },
  in_progress:   { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'In Progress' },
  warning:       { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Warning' },
  error:         { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Error' },
  failed:        { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Failed' },
  expired:       { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Expired' },
  disconnected:  { bg: 'bg-zinc-500/10',    text: 'text-zinc-400',    dot: 'bg-zinc-500',    label: 'Disconnected' },
  not_connected: { bg: 'bg-zinc-500/10',    text: 'text-zinc-400',    dot: 'bg-zinc-500',    label: 'Not Connected' },
  unknown:       { bg: 'bg-zinc-500/10',    text: 'text-zinc-400',    dot: 'bg-zinc-500',    label: 'Unknown' },
  blocked:       { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Blocked' },
  closed:        { bg: 'bg-zinc-500/10',    text: 'text-zinc-400',    dot: 'bg-zinc-500',    label: 'Closed' },
  resolved:      { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Resolved' },
};

const FALLBACK = { bg: 'bg-zinc-500/10', text: 'text-zinc-400', dot: 'bg-zinc-500', label: 'Unknown' };

export function StatusBadge({ status, label, size = 'sm' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status?.toLowerCase()] || FALLBACK;
  const displayLabel = label || config.label;

  const sizeClasses = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1';
  const dotSize = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${config.bg} ${config.text} ${sizeClasses}`}
    >
      <span className={`${dotSize} rounded-full ${config.dot}`} />
      {displayLabel}
    </span>
  );
}
