import { ArrowUpRight, ExternalLink, type LucideIcon, ShieldCheck, Zap } from 'lucide-react';

export type IntegrationTagTone = 'blue' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate';

export type IntegrationTag = {
  label: string;
  tone: IntegrationTagTone;
};

export type IntegrationItem = {
  id: string;
  name: string;
  category: string;
  description: string;
  authType: string;
  guideUrl?: string;
  icon: LucideIcon;
  iconTone: string;
  tags: IntegrationTag[];
};

export type IntegrationConnectionMeta = {
  status?: string;
  statusLabel: string;
  tone: 'connected' | 'pending' | 'error' | 'neutral';
  lastChecked?: string;
  accountLabel?: string;
  error?: string;
};

const toneClasses: Record<IntegrationTagTone, string> = {
  blue: 'border-blue-400/20 bg-blue-400/10 text-blue-200',
  emerald: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
  violet: 'border-violet-400/20 bg-violet-400/10 text-violet-200',
  amber: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
  rose: 'border-rose-400/20 bg-rose-400/10 text-rose-200',
  slate: 'border-white/10 bg-white/[0.06] text-slate-300',
};

const statusToneClasses: Record<IntegrationConnectionMeta['tone'], string> = {
  connected: 'border-emerald-400/20 bg-emerald-400/12 text-emerald-100',
  pending: 'border-amber-400/20 bg-amber-400/12 text-amber-100',
  error: 'border-rose-400/20 bg-rose-400/12 text-rose-100',
  neutral: 'border-white/10 bg-white/[0.05] text-slate-300',
};

export default function IntegrationCard({
  integration,
  onConnect,
  isConnected = false,
  connection,
}: {
  integration: IntegrationItem;
  onConnect: (integration: IntegrationItem) => void;
  isConnected?: boolean;
  connection?: IntegrationConnectionMeta;
}) {
  const Icon = integration.icon;
  const statusLabel = connection?.statusLabel ?? (isConnected ? 'Connected' : 'Ready');
  const statusTone = connection?.tone ?? (isConnected ? 'connected' : 'neutral');

  return (
    <article className="group flex h-full flex-col rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(15,23,42,0.72))] p-5 shadow-[0_20px_60px_rgba(2,6,23,0.24)] transition-all duration-200 hover:-translate-y-1 hover:border-cyan-400/25 hover:shadow-[0_28px_80px_rgba(8,47,73,0.32)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {integration.tags.map((tag) => (
            <span
              key={`${integration.id}-${tag.label}`}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${toneClasses[tag.tone]}`}
            >
              {tag.label}
            </span>
          ))}
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusToneClasses[statusTone]}`}>
          <ShieldCheck className="h-3 w-3" />
          {statusLabel}
        </span>
      </div>

      <div className="mt-5 flex items-start gap-4">
        <div className={`rounded-2xl border border-white/10 bg-white/[0.05] p-3 ${integration.iconTone}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-white">{integration.name}</h3>
          <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-slate-500">{integration.category}</p>
        </div>
      </div>

      <p className="mt-5 flex-1 text-sm leading-7 text-slate-300">
        {integration.description}
      </p>

      {connection?.accountLabel || connection?.lastChecked || connection?.error ? (
        <div className="mt-4 space-y-1 text-xs text-slate-400">
          {connection.accountLabel ? (
            <p className="text-slate-300">Account: {connection.accountLabel}</p>
          ) : null}
          {connection.lastChecked ? (
            <p>Last checked: {connection.lastChecked}</p>
          ) : null}
          {connection.error ? (
            <p className="text-rose-300">Issue: {connection.error}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
          <ArrowUpRight className="h-3.5 w-3.5" />
          {integration.authType}
        </span>
      </div>

      <div className="mt-6 flex gap-3">
        {integration.guideUrl ? (
          <a
            href={integration.guideUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] hover:text-white"
          >
            <ExternalLink className="h-4 w-4" />
            Guide
          </a>
        ) : null}
        <button
          onClick={() => onConnect(integration)}
          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-[0_16px_35px_rgba(34,211,238,0.18)] transition-all ${isConnected
            ? 'border border-emerald-400/20 bg-emerald-400/12 text-emerald-100 hover:bg-emerald-400/18'
            : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400'
            }`}
        >
          <Zap className="h-4 w-4" />
          {isConnected ? 'Manage Connection' : 'Connect'}
        </button>
      </div>
    </article>
  );
}
