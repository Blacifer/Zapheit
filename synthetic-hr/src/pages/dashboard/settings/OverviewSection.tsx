import { ChevronRight } from 'lucide-react';

type OverviewCard = {
  label: string;
  value: string;
  detail: string;
  cta: string;
  action: () => void;
};

export function OverviewSection({
  title,
  subtitle,
  cards,
  recommendedActions,
  orgName,
  activeMembers,
  configuredChannels,
  dataRetention,
}: {
  title: string;
  subtitle: string;
  cards: OverviewCard[];
  recommendedActions: Array<{ key: string; action: () => void; title: string; detail: string; tone: 'amber' | 'cyan' | 'rose' }>;
  orgName: string;
  activeMembers: number;
  configuredChannels: number;
  dataRetention: number;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">{title}</h2>
        <p className="text-slate-400 text-sm">{subtitle}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((card) => (
          <button
            key={card.label}
            onClick={card.action}
            className="text-left rounded-2xl border border-slate-700/50 bg-slate-800/40 hover:bg-slate-700/40 hover:border-cyan-500/30 p-5 transition-all"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
            <p className="mt-3 text-xl font-bold text-white">{card.value}</p>
            <p className="mt-1 text-sm text-slate-400">{card.detail}</p>
            <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-300">
              {card.cta}
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
          <h3 className="text-base font-semibold text-white">Recommended next actions</h3>
          <div className="mt-4 space-y-3">
            {recommendedActions.map((item) => (
              <button
                key={item.key}
                onClick={item.action}
                className={`w-full text-left rounded-xl px-4 py-3 transition-colors ${
                  item.tone === 'amber'
                    ? 'border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10'
                    : item.tone === 'rose'
                      ? 'border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10'
                      : 'border border-cyan-500/20 bg-cyan-500/5 hover:bg-cyan-500/10'
                }`}
              >
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="text-xs text-slate-400 mt-1">{item.detail}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
          <h3 className="text-base font-semibold text-white">At a glance</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-slate-900/40 px-3 py-2.5">
              <span className="text-slate-400">Workspace</span>
              <span className="text-white font-medium">{orgName || 'Unset'}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-900/40 px-3 py-2.5">
              <span className="text-slate-400">Team</span>
              <span className="text-white font-medium">{activeMembers} active</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-900/40 px-3 py-2.5">
              <span className="text-slate-400">Alerts</span>
              <span className="text-white font-medium">{configuredChannels}/3 configured</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-900/40 px-3 py-2.5">
              <span className="text-slate-400">Retention</span>
              <span className="text-white font-medium">{dataRetention} days</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
