import { ChevronRight, Building2, Shield, Bell, Users } from 'lucide-react';

type OverviewCard = {
  label: string;
  value: string;
  detail: string;
  cta: string;
  action: () => void;
};

const CARD_ICONS: Record<string, React.ElementType> = {
  'Workspace health': Building2,
  'Security status': Shield,
  'Alert coverage': Bell,
  'Team access': Users,
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
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">{title}</h2>
        <p className="text-slate-400 text-sm">{subtitle}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((card) => {
          const Icon = CARD_ICONS[card.label] || ChevronRight;
          return (
            <button
              key={card.label}
              onClick={card.action}
              className="group text-left rounded-2xl border border-white/[0.10] bg-white/[0.05] glass glass-glow hover:bg-white/[0.04] hover:border-white/[0.12] p-5 transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">
                  <Icon className="w-4 h-4 text-slate-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-widest text-slate-500">{card.label}</p>
                  <p className="mt-2 text-lg font-semibold text-white">{card.value}</p>
                  <p className="mt-1 text-sm text-slate-400">{card.detail}</p>
                  <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-slate-300 group-hover:text-white transition-colors">
                    {card.cta}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-2xl border border-white/[0.10] bg-white/[0.05] glass glass-glow p-6">
          <h3 className="text-base font-semibold text-white">Recommended actions</h3>
          <p className="text-xs text-slate-500 mt-1">Complete these to improve your workspace security and reliability.</p>
          <div className="mt-4 space-y-3">
            {recommendedActions.length > 0 ? recommendedActions.map((item) => (
              <button
                key={item.key}
                onClick={item.action}
                className="w-full text-left rounded-xl px-4 py-3 border border-white/[0.08] bg-white/[0.04] glass-sm hover:bg-white/[0.04] transition-colors"
              >
                <p className="text-sm font-medium text-white">{item.title}</p>
                <p className="text-xs text-slate-400 mt-1">{item.detail}</p>
              </button>
            )) : (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] glass-sm p-5">
                <p className="text-sm font-medium text-emerald-300">All set</p>
                <p className="mt-1 text-sm text-slate-400">
                  Workspace access, alerts, and security are configured. Refine settings in the sections on the left.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.10] bg-white/[0.05] glass glass-glow p-6">
          <h3 className="text-base font-semibold text-white">At a glance</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2.5">
              <span className="text-slate-400">Workspace</span>
              <span className="text-white font-medium">{orgName || 'Unset'}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2.5">
              <span className="text-slate-400">Team</span>
              <span className="text-white font-medium">{activeMembers} active</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2.5">
              <span className="text-slate-400">Alerts</span>
              <span className="text-white font-medium">{configuredChannels}/3 configured</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2.5">
              <span className="text-slate-400">Retention</span>
              <span className="text-white font-medium">{dataRetention} days</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
