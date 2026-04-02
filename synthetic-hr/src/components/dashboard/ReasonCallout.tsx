import { cn } from '../../lib/utils';

type ReasonCalloutProps = {
  reasonMessage?: string | null;
  recommendedNextAction?: string | null;
  className?: string;
  messageClassName?: string;
  nextActionClassName?: string;
  labelClassName?: string;
  label?: string;
};

export function ReasonCallout({
  reasonMessage,
  recommendedNextAction,
  className,
  messageClassName,
  nextActionClassName,
  labelClassName,
  label = 'Cannot proceed because',
}: ReasonCalloutProps) {
  if (!reasonMessage) return null;

  return (
    <div className={cn('rounded-lg border border-white/8 bg-black/20 px-3 py-2', className)}>
      <p className={cn('text-[10px] uppercase tracking-wider text-slate-500', labelClassName)}>{label}</p>
      <p className={cn('mt-1 text-xs text-slate-200', messageClassName)}>{reasonMessage}</p>
      {recommendedNextAction ? (
        <p className={cn('mt-1 text-xs text-cyan-200', nextActionClassName)}>Next step: {recommendedNextAction}</p>
      ) : null}
    </div>
  );
}
