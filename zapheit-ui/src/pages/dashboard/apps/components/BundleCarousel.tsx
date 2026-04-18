import { ArrowRight, CheckCircle2, Layers } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { UnifiedApp } from '../types';
import { BUNDLE_ICONS } from '../constants';

interface AppBundle {
  id: string;
  name: string;
  description: string;
  colorHex: string;
  icon: string;
  appIds: string[];
}

interface BundleCarouselProps {
  bundles: AppBundle[];
  apps: UnifiedApp[];
  highlightBundle: string | null;
  onInstallAll: (bundle: AppBundle) => void;
}

function BundleCard({ bundle, apps, onInstallAll }: {
  bundle: AppBundle;
  apps: UnifiedApp[];
  onInstallAll: (b: AppBundle) => void;
}) {
  const BundleIcon = BUNDLE_ICONS[bundle.icon] || Layers;
  const bundleApps = apps.filter((a) => bundle.appIds.includes(a.appId));
  const allDone = bundleApps.length > 0 && bundleApps.every((a) => a.connected);
  const doneCount = bundleApps.filter((a) => a.connected).length;

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 flex flex-col gap-3 min-w-[260px] max-w-[300px] shrink-0">
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: bundle.colorHex + '25', border: `1px solid ${bundle.colorHex}40` }}
        >
          <BundleIcon className="w-4.5 h-4.5" style={{ color: bundle.colorHex }} />
        </div>
        <div>
          <p className="text-sm font-bold text-white">{bundle.name}</p>
          <p className="text-xs text-slate-400 mt-0.5">{bundle.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {bundleApps.map((app) => (
          <div
            key={app.id}
            title={app.name}
            className={cn('w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0', app.connected && 'ring-2 ring-emerald-400/40')}
            style={{ backgroundColor: app.colorHex }}
          >
            {app.logoLetter}
          </div>
        ))}
        <span className="text-[10px] text-slate-500 ml-1">{bundleApps.length} apps</span>
      </div>
      {allDone ? (
        <div className="flex items-center gap-1.5 text-xs text-emerald-300 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />All added
        </div>
      ) : (
        <button
          onClick={() => onInstallAll(bundle)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors border"
          style={{ borderColor: bundle.colorHex + '40', backgroundColor: bundle.colorHex + '15', color: bundle.colorHex }}
        >
          {doneCount > 0 ? `Add remaining ${bundleApps.length - doneCount}` : 'Install stack'}
          <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export function BundleCarousel({ bundles, apps, highlightBundle, onInstallAll }: BundleCarouselProps) {
  return (
    <div id="browse-bundles">
      <div className="flex items-center gap-2 mb-3">
        <Layers className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-white">Install a stack</h3>
        <span className="text-xs text-slate-500">— get a full workflow in one click</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
        {bundles.map((b) => (
          <BundleCard key={b.id} bundle={b} apps={apps} onInstallAll={onInstallAll} />
        ))}
      </div>
      {highlightBundle && (
        <p className="text-xs text-violet-300 mt-2 flex items-center gap-1">
          Showing recommended stack for your use case.
        </p>
      )}
    </div>
  );
}

export type { AppBundle };
