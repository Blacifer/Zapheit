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
    <section className="relative overflow-hidden rounded-2xl border border-white/[0.10] bg-white/[0.05] p-6 glass glass-glow">
      <div className="relative z-10 grid gap-6 xl:grid-cols-[1.35fr_0.9fr]">
        <div>
          {eyebrow ? (
            <p className="text-xs font-medium uppercase tracking-widest text-cyan-400/70">{eyebrow}</p>
          ) : null}
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">{subtitle}</p>

          {actions.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-3">
              {actions.map((action) => (
                <button
                  key={action.label}
                  onClick={action.onClick}
                  className={action.variant === 'secondary'
                    ? 'inline-flex items-center gap-2 rounded-xl border border-white/[0.10] bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] glass-sm'
                    : 'btn-primary px-4 py-2.5 text-sm'}
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
                <div key={stat.label} className="rounded-xl border border-white/[0.10] bg-white/[0.04] px-4 py-4 glass-sm" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}>
                  <p className="text-xs font-medium uppercase tracking-widest text-slate-500">{stat.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{stat.value}</p>
                  {stat.detail ? <p className="mt-1 text-xs text-slate-400">{stat.detail}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {recommendation ? (
          <div className="rounded-2xl border border-white/[0.10] bg-white/[0.04] p-5 glass-sm" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
            <p className="text-xs font-medium uppercase tracking-widest text-cyan-400/60">{recommendation.label}</p>
            <h2 className="mt-3 text-lg font-semibold text-white">{recommendation.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{recommendation.detail}</p>
            <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-cyan-300 hover:text-white transition-colors">
              Focus next
              <ArrowRight className="h-4 w-4" />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
