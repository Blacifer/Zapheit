import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Check, Sparkles, Building2,
  Briefcase, ShoppingCart, Cpu, Zap, X,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { api } from '../../../lib/api-client';
import type { AIAgent } from '../../../types';
import { APP_CATALOG, STACKS } from './data/catalog';
import type { AppDef } from './data/catalog';
import { INTENTS, LOGO_DOMAINS } from './constants';
import { ConnectWizard } from './connect-wizard/ConnectWizard';
import { deriveConnectorCertification, type ReadinessStatus } from '../../../lib/production-readiness';
import type { UnifiedApp } from './types';

/* ─── Industry options ──────────────────────────────────────────────────── */

const INDUSTRIES = [
  { id: 'tech',          label: 'Tech / SaaS',         Icon: Cpu,          color: 'text-blue-400',    border: 'border-blue-500/30',    bg: 'bg-blue-500/10',    stackIds: ['support-stack','hr-stack'] },
  { id: 'hr',            label: 'HR & Consulting',      Icon: Briefcase,    color: 'text-pink-400',    border: 'border-pink-500/30',    bg: 'bg-pink-500/10',    stackIds: ['hr-stack','recruitment-stack'] },
  { id: 'finance',       label: 'Finance & Accounting', Icon: Building2,    color: 'text-rose-400',    border: 'border-rose-500/30',    bg: 'bg-rose-500/10',    stackIds: ['finance-stack'] },
  { id: 'ecommerce',     label: 'E-Commerce / Retail',  Icon: ShoppingCart, color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', stackIds: ['support-stack'] },
  { id: 'manufacturing', label: 'Manufacturing',         Icon: Zap,          color: 'text-amber-400',   border: 'border-amber-500/30',   bg: 'bg-amber-500/10',   stackIds: ['hr-stack','finance-stack'] },
  { id: 'healthcare',    label: 'Healthcare',            Icon: Sparkles,     color: 'text-cyan-400',    border: 'border-cyan-500/30',    bg: 'bg-cyan-500/10',    stackIds: ['support-stack','hr-stack'] },
];

/* ─── Logo helper ───────────────────────────────────────────────────────── */

function appLogoSrc(app: AppDef): string | null {
  const domain = LOGO_DOMAINS[app.appId];
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : null;
}

function AppLogo({ app, size = 28 }: { app: AppDef; size?: number }) {
  const [err, setErr] = useState(false);
  const src = appLogoSrc(app);
  if (!err && src) {
    return (
      <img src={src} alt={app.name} width={size} height={size}
        className="rounded-md object-contain" onError={() => setErr(true)} />
    );
  }
  return (
    <div className="rounded-md bg-white/[0.07] flex items-center justify-center text-[10px] font-bold text-slate-400"
      style={{ width: size, height: size }}>
      {app.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

/* ─── Adapter AppDef → UnifiedApp for ConnectWizard ────────────────────── */

function toUnifiedApp(def: AppDef): UnifiedApp {
  const certification = deriveConnectorCertification({
    connectorId: def.appId,
    comingSoon: def.productionStatus === 'coming_soon',
    connected: false,
    status: 'disconnected',
  });
  const readinessStatus: ReadinessStatus = def.productionStatus === 'coming_soon' ? 'blocked' : 'not_configured';
  return {
    id: `app:${def.appId}`,
    appId: def.appId,
    name: def.name,
    description: def.description || '',
    category: def.category,
    source: 'marketplace',
    connectionType: def.auth === 'oauth' ? 'oauth_connector' : 'native_connector',
    primarySetupMode: def.auth === 'oauth' ? 'oauth' : 'api_key',
    advancedSetupModes: [def.auth === 'oauth' ? 'oauth' : 'api_key'],
    logoLetter: def.logoLetter,
    colorHex: def.colorHex,
    installCount: 0,
    comingSoon: def.productionStatus === 'coming_soon',
    connected: false,
    status: 'disconnected',
    authType: def.auth === 'oauth' ? 'oauth2' : 'api_key',
    requiredFields: def.fields?.map((f) => ({
      name: f.key, label: f.label, type: f.type,
      placeholder: f.type === 'password' ? '••••••••' : f.label,
      required: !f.optional,
    })),
    permissions: [], actionsUnlocked: [], featured: false,
    trustTier: (def.category === 'finance' || def.category === 'it' || def.category === 'compliance')
      ? 'high-trust-operational' : 'observe-only',
    maturity: 'connected',
    governanceSummary: { readCount: 0, actionCount: 0, enabledActionCount: 0 },
    agentCapabilities: [], capabilityPolicies: [], mcpTools: [],
    primaryServiceId: def.serviceId,
    readinessStatus,
    connectorCertification: certification,
  };
}

/* ─── Step bar ──────────────────────────────────────────────────────────── */

const STEP_LABELS = ['Industry', 'Your tools', 'Goals', 'Your stack', 'Connect'];

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center gap-1">
            <div className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
              i < step   ? 'bg-blue-500 text-white' :
              i === step ? 'bg-blue-600/40 border border-blue-500 text-blue-300' :
                           'bg-white/[0.05] border border-white/10 text-slate-500',
            )}>
              {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span className={cn('text-[10px] hidden sm:block', i === step ? 'text-blue-300' : 'text-slate-600')}>
              {label}
            </span>
          </div>
          {i < STEP_LABELS.length - 1 && (
            <div className={cn('flex-1 h-px mx-1', i < step ? 'bg-blue-500/50' : 'bg-white/[0.06]')} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ─── Step 1: Industry ──────────────────────────────────────────────────── */

function Step1({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">What does your company do?</h2>
      <p className="text-sm text-slate-400 mb-6">We'll recommend the right integrations for your industry.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {INDUSTRIES.map((ind) => (
          <button key={ind.id} onClick={() => onChange(ind.id)}
            className={cn(
              'flex flex-col items-start gap-2 p-4 rounded-2xl border transition-all text-left',
              value === ind.id
                ? `${ind.border} ${ind.bg} ring-1 ring-inset ring-white/10`
                : 'border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06]',
            )}
          >
            <ind.Icon className={cn('w-5 h-5', ind.color)} />
            <span className="text-sm font-medium text-white leading-tight">{ind.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Step 2: Existing tools ─────────────────────────────────────────────── */

function Step2({ selected, onToggle }: { selected: Set<string>; onToggle: (id: string) => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const base = APP_CATALOG.filter((a) => a.productionStatus !== 'coming_soon').slice(0, 60);
    if (!q) return base;
    const lq = q.toLowerCase();
    return base.filter((a) => a.name.toLowerCase().includes(lq) || a.category.toLowerCase().includes(lq));
  }, [q]);

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Which tools do you already use?</h2>
      <p className="text-sm text-slate-400 mb-4">Select everything you have — we'll skip recommending duplicates.</p>
      <input
        type="text" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search tools…"
        className="w-full mb-4 bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/40"
      />
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-64 overflow-y-auto pr-1">
        {list.map((app) => {
          const on = selected.has(app.appId);
          return (
            <button key={app.appId} onClick={() => onToggle(app.appId)}
              className={cn(
                'flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-center transition-all',
                on ? 'border-blue-500/40 bg-blue-500/10' : 'border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06]',
              )}
            >
              <div className="relative">
                <AppLogo app={app} size={24} />
                {on && (
                  <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-blue-500 flex items-center justify-center">
                    <Check className="w-2 h-2 text-white" />
                  </div>
                )}
              </div>
              <span className="text-[10px] text-slate-300 leading-tight line-clamp-2">{app.name}</span>
            </button>
          );
        })}
      </div>
      {selected.size > 0 && (
        <p className="mt-3 text-xs text-slate-500">{selected.size} tool{selected.size !== 1 ? 's' : ''} selected</p>
      )}
    </div>
  );
}

/* ─── Step 3: Goals ──────────────────────────────────────────────────────── */

function Step3({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">What do you want to automate?</h2>
      <p className="text-sm text-slate-400 mb-6">Your primary goal shapes your recommended stack.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {INTENTS.map((intent) => (
          <button key={intent.id} onClick={() => onChange(intent.id)}
            className={cn(
              'flex flex-col items-start gap-2 p-4 rounded-2xl border transition-all text-left',
              value === intent.id
                ? 'border-white/20 bg-white/[0.08] ring-1 ring-inset ring-white/10'
                : 'border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06]',
            )}
            style={value === intent.id ? { borderColor: intent.color + '60' } : {}}
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: intent.color + '20' }}>
              <intent.Icon className="w-4 h-4" style={{ color: intent.color }} />
            </div>
            <span className="text-sm font-medium text-white">{intent.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Step 4: Recommended stack ─────────────────────────────────────────── */

function Step4({
  industry, existing, intent, onContinue,
}: {
  industry: string; existing: Set<string>; intent: string; onContinue: (apps: AppDef[]) => void;
}) {
  const recommended = useMemo<AppDef[]>(() => {
    const intentObj = INTENTS.find((i) => i.id === intent);
    const intentStack = STACKS.find((s) => s.id === intentObj?.bundleId);
    const ind = INDUSTRIES.find((i) => i.id === industry);
    const ids = new Set<string>();
    intentStack?.appIds.forEach((id) => ids.add(id));
    ind?.stackIds.forEach((sid) => {
      const s = STACKS.find((x) => x.id === sid);
      s?.appIds.forEach((id) => ids.add(id));
    });
    return [...ids]
      .map((id) => APP_CATALOG.find((a) => a.appId === id))
      .filter((a): a is AppDef => Boolean(a))
      .slice(0, 8);
  }, [industry, intent]);

  const toConnect = recommended.filter((a) => !existing.has(a.appId));
  const alreadyHave = recommended.filter((a) => existing.has(a.appId));

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-blue-400" />
        <h2 className="text-xl font-semibold text-white">Your recommended stack</h2>
      </div>
      <p className="text-sm text-slate-400 mb-5">Personalized for your industry and goals.</p>

      {toConnect.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Connect these ({toConnect.length})</p>
          <div className="space-y-2">
            {toConnect.map((app) => (
              <div key={app.appId} className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                <AppLogo app={app} size={28} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{app.name}</p>
                  <p className="text-xs text-slate-500 capitalize">{app.category}</p>
                </div>
                {app.isIndiaNative && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-300">India</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {alreadyHave.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Already in your toolkit ({alreadyHave.length})</p>
          <div className="flex flex-wrap gap-2">
            {alreadyHave.map((app) => (
              <div key={app.appId} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                <AppLogo app={app} size={16} />
                <span className="text-xs text-emerald-300">{app.name}</span>
                <Check className="w-3 h-3 text-emerald-400" />
              </div>
            ))}
          </div>
        </div>
      )}

      {toConnect.length === 0 && (
        <div className="py-6 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center mx-auto mb-3">
            <Check className="w-6 h-6 text-emerald-400" />
          </div>
          <p className="text-sm text-white font-medium">You already have everything!</p>
          <p className="text-xs text-slate-400 mt-1">All recommended apps are in your existing toolkit.</p>
        </div>
      )}

      <button
        onClick={() => onContinue(toConnect)}
        disabled={toConnect.length === 0}
        className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-40"
      >
        <Zap className="w-4 h-4" />
        {toConnect.length > 0 ? `Connect ${toConnect.length} app${toConnect.length > 1 ? 's' : ''}` : 'All connected'}
      </button>
    </div>
  );
}

/* ─── Step 5: Connect one-by-one ─────────────────────────────────────────── */

function Step5({ apps, agents, onDone }: { apps: AppDef[]; agents: AIAgent[]; onDone: () => void }) {
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [wizardApp, setWizardApp] = useState<AppDef | null>(null);

  const current = apps[idx];
  const total = apps.length;
  const finished = done.size + skipped.size;

  async function handleConnect(_unified: UnifiedApp, creds: Record<string, string>) {
    if (!current) return;
    if (current.auth === 'oauth') {
      const res = await api.integrations.initOAuth(current.serviceId, '/dashboard/apps/build-stack');
      if (res.success && (res.data as any)?.url) {
        window.location.href = (res.data as any).url;
      } else {
        throw new Error((res as any).error || 'OAuth failed');
      }
      return;
    }
    const res = await api.integrations.connect(current.serviceId, creds);
    if (!res.success) throw new Error((res as any).error || 'Connection failed');
    setDone((d) => new Set([...d, current.appId]));
    setWizardApp(null);
    if (idx + 1 < total) setIdx((i) => i + 1);
  }

  function handleSkip() {
    setSkipped((s) => new Set([...s, current.appId]));
    if (idx + 1 < total) setIdx((i) => i + 1);
  }

  if (finished === total || apps.length === 0) {
    return (
      <div className="py-12 text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center mx-auto">
          <Sparkles className="w-7 h-7 text-emerald-400" />
        </div>
        <div>
          <p className="text-lg font-semibold text-white">Your stack is ready!</p>
          <p className="text-sm text-slate-400 mt-1">
            {done.size} app{done.size !== 1 ? 's' : ''} connected{skipped.size > 0 ? ` · ${skipped.size} skipped` : ''}
          </p>
        </div>
        <button onClick={onDone} className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors">
          Go to Apps
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Connect your apps</h2>
      <p className="text-sm text-slate-400 mb-4">{idx + 1} of {total} — {current.name}</p>

      {/* Progress segments */}
      <div className="flex gap-1.5 mb-6">
        {apps.map((a, i) => (
          <div key={a.appId} className={cn(
            'flex-1 h-1.5 rounded-full transition-colors',
            done.has(a.appId)    ? 'bg-emerald-500' :
            skipped.has(a.appId) ? 'bg-slate-600' :
            i === idx            ? 'bg-blue-500' :
                                   'bg-white/[0.08]',
          )} />
        ))}
      </div>

      {/* Current app */}
      <div className="flex items-center gap-4 p-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] mb-5">
        <AppLogo app={current} size={40} />
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-white">{current.name}</p>
          <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{current.description || current.category}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/10 text-slate-400 capitalize">
              {current.auth === 'oauth' ? 'OAuth' : 'API Key'}
            </span>
            {current.isIndiaNative && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-300">India-native</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleSkip}
          className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:bg-white/[0.04] transition-colors">
          Skip for now
        </button>
        <button onClick={() => setWizardApp(current)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors">
          <Zap className="w-3.5 h-3.5" /> Connect
        </button>
      </div>

      {wizardApp && (
        <ConnectWizard
          app={toUnifiedApp(wizardApp)}
          agents={agents}
          onConnect={handleConnect}
          onClose={() => setWizardApp(null)}
        />
      )}
    </div>
  );
}

/* ─── Main wizard page ────────────────────────────────────────────────────── */

export default function BuildStackWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [industry, setIndustry] = useState('');
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [intent, setIntent] = useState('');
  const [appsToConnect, setAppsToConnect] = useState<AppDef[]>([]);
  const [agents, setAgents] = useState<AIAgent[]>([]);

  useEffect(() => {
    api.agents.getAll().then((r) => { if (r.success) setAgents((r.data as any) ?? []); });
  }, []);

  function toggleExisting(id: string) {
    setExisting((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const canNext = [Boolean(industry), true, Boolean(intent), true, true][step];

  function next() { if (step < 4) setStep((s) => s + 1); }
  function back() { if (step > 0) setStep((s) => s - 1); }

  return (
    <div className="min-h-screen bg-[#080f1a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <button onClick={() => navigate('/dashboard/apps')}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Apps
        </button>
        <div className="flex items-center gap-1.5 text-sm font-medium text-white">
          <Zap className="w-4 h-4 text-blue-400" /> Build Your Stack
        </div>
        <button onClick={() => navigate('/dashboard/apps')} className="p-1 text-slate-600 hover:text-slate-400 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-start justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-xl">
          <StepBar step={step} />

          <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-6 min-h-[320px]">
            {step === 0 && <Step1 value={industry} onChange={setIndustry} />}
            {step === 1 && <Step2 selected={existing} onToggle={toggleExisting} />}
            {step === 2 && <Step3 value={intent} onChange={setIntent} />}
            {step === 3 && (
              <Step4
                industry={industry} existing={existing} intent={intent}
                onContinue={(apps) => { setAppsToConnect(apps); setStep(4); }}
              />
            )}
            {step === 4 && (
              <Step5 apps={appsToConnect} agents={agents} onDone={() => navigate('/dashboard/apps')} />
            )}
          </div>

          {/* Back/Next nav — only for steps 0–2 */}
          {step < 3 && (
            <div className="flex justify-between mt-4">
              <button onClick={back} disabled={step === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm transition-colors disabled:opacity-30">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button onClick={next} disabled={!canNext}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-40">
                {step === 2 ? 'See my stack' : 'Continue'} <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
          {step === 3 && (
            <div className="flex justify-start mt-4">
              <button onClick={back}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
