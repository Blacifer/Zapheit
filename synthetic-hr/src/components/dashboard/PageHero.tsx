import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

type HeroStat = {
  label: string;
  value: string;
  detail?: string;
};

type HeroAction = {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  icon?: ReactNode;
};

export function PageHero({
  eyebrow,
  title,
  subtitle,
  recommendation,
  stats = [],
  actions = [],
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  recommendation?: { label: string; title: string; detail: string };
  stats?: HeroStat[];
  actions?: HeroAction[];
}) {
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_36%),linear-gradient(135deg,rgba(15,23,42,0.94),rgba(2,6,23,0.98))] p-6 shadow-[0_18px_60px_rgba(2,6,23,0.24)]">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent_42%)]" />
      <div className="relative z-10 grid gap-6 xl:grid-cols-[1.35fr_0.9fr]">
        <div>
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300">{eyebrow}</p>
          ) : null}
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">{subtitle}</p>

          {actions.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-3">
              {actions.map((action) => (
                <button
                  key={action.label}
                  onClick={action.onClick}
                  className={action.variant === 'secondary'
                    ? 'inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.09]'
                    : 'inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300'}
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}

          {stats.length > 0 ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 backdrop-blur-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{stat.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{stat.value}</p>
                  {stat.detail ? <p className="mt-1 text-xs text-slate-400">{stat.detail}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {recommendation ? (
          <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/[0.08] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200">{recommendation.label}</p>
            <h2 className="mt-3 text-xl font-semibold text-white">{recommendation.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">{recommendation.detail}</p>
            <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-cyan-200">
              Focus next
              <ArrowRight className="h-4 w-4" />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
