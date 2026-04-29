import type { ReactNode } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';

interface ProductionTruthBannerProps {
  title?: string;
  connectorName: string;
  children?: ReactNode;
}

export function ProductionTruthBanner({
  title = 'Sample data visible',
  connectorName,
  children,
}: ProductionTruthBannerProps) {
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-amber-100">{title}</p>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200">
              <ShieldCheck className="h-3 w-3" />
              Not pilot evidence
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-amber-100/75">
            {children ?? (
              <>
                This workspace is showing sample records because {connectorName} has not returned production data for this view.
                Connect or repair the connector before using these records for customer proof, audit evidence, ROI, or approvals.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
