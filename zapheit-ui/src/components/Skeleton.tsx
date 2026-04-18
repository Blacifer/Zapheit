/** Reusable skeleton loader components — skeleton-shimmer moving gradient pattern */

/** A single skeleton row mirroring an incident list item */
export function SkeletonIncidentRow() {
  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-4">
      <div className="flex items-start gap-3">
        <div className="w-4 h-4 skeleton-shimmer mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="h-4 w-48 skeleton-shimmer" />
            <div className="h-5 w-16 skeleton-shimmer rounded-full" />
            <div className="h-5 w-20 skeleton-shimmer rounded-full" />
          </div>
          <div className="h-3 w-72 skeleton-shimmer" />
          <div className="flex items-center gap-3">
            <div className="h-3 w-24 skeleton-shimmer" />
            <div className="h-3 w-20 skeleton-shimmer" />
          </div>
        </div>
        <div className="h-5 w-24 skeleton-shimmer rounded-full flex-shrink-0" />
      </div>
    </div>
  );
}

/** A single skeleton row mirroring an agent card in Fleet */
export function SkeletonAgentCard() {
  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="h-5 w-40 skeleton-shimmer" />
            <div className="h-5 w-16 skeleton-shimmer rounded-full" />
            <div className="h-5 w-20 skeleton-shimmer rounded-full" />
            <div className="h-5 w-24 skeleton-shimmer rounded-full" />
          </div>
          <div className="h-3 w-80 skeleton-shimmer" />
          <div className="flex items-center gap-4">
            <div className="h-3 w-28 skeleton-shimmer" />
            <div className="h-3 w-24 skeleton-shimmer" />
            <div className="h-3 w-20 skeleton-shimmer" />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="h-8 w-20 skeleton-shimmer rounded-lg" />
          <div className="h-8 w-8 skeleton-shimmer rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** A stat/metric card skeleton */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-800/60 bg-slate-900/40 p-4 ${className}`}>
      <div className="h-3 w-24 skeleton-shimmer mb-3" />
      <div className="h-7 w-20 skeleton-shimmer mb-2" />
      <div className="h-3 w-32 skeleton-shimmer" />
    </div>
  );
}
