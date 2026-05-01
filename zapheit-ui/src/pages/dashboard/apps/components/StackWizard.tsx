import { useState } from 'react';
import { ArrowRight, CheckCircle2, Loader2, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { AppDef, AppStack } from '../data/catalog';
import { AppLogo } from './AppLogo';

interface StackWizardProps {
  stack: AppStack;
  apps: AppDef[];
  onConnect: (app: AppDef, creds?: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

export function StackWizard({ stack, apps, onConnect, onClose }: StackWizardProps) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const current = apps[step];
  const isLast = step === apps.length - 1;
  const allDone = done.size === apps.length;

  const handleConnect = async (creds?: Record<string, string>) => {
    if (!current) return;
    setBusy(true);
    try {
      if (current.auth === 'oauth') {
        window.location.href = `/api/oauth/authorize?service=${current.serviceId}&redirect=/dashboard/apps`;
        return;
      }
      await onConnect(current, creds);
      setDone((d) => new Set([...d, current.appId]));
      if (!isLast) { setStep((s) => s + 1); setFormValues({}); }
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    if (!isLast) { setStep((s) => s + 1); setFormValues({}); }
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f1825] shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between px-6 py-5 border-b border-white/8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${stack.colorHex}22`, border: `1px solid ${stack.colorHex}33` }}>
              <span style={{ color: stack.colorHex }}><stack.Icon className="w-4 h-4" /></span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{stack.name} Setup</p>
              <p className="text-[11px] text-slate-400">{apps.length} apps · step {Math.min(step + 1, apps.length)} of {apps.length}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-0 px-6 pt-4">
          {apps.map((app, i) => (
            <div key={app.appId} className="flex items-center flex-1 min-w-0">
              <div className={cn(
                'flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0 transition-colors',
                done.has(app.appId) ? 'bg-emerald-500 text-white' : i === step ? 'bg-blue-600 text-white' : 'bg-white/[0.08] text-slate-500',
              )}>
                {done.has(app.appId) ? '✓' : i + 1}
              </div>
              <p className={cn('text-[10px] ml-1.5 truncate', i === step ? 'text-white font-medium' : 'text-slate-500')}>
                {app.name}
              </p>
              {i < apps.length - 1 && <div className="mx-2 flex-1 h-px bg-white/[0.08]" />}
            </div>
          ))}
        </div>

        {allDone ? (
          <div className="px-6 py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-400/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-base font-semibold text-white mb-1">{stack.name} connected!</p>
            <p className="text-xs text-slate-400 mb-6">All {apps.length} apps are set up and ready.</p>
            <button onClick={onClose} className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors">
              Done
            </button>
          </div>
        ) : current && (
          <div className="px-6 py-5">
            <div className="flex items-center gap-3 mb-4">
              <AppLogo appId={current.appId} logoLetter={current.logoLetter} colorHex={current.colorHex} size="sm" />
              <div>
                <p className="text-sm font-semibold text-white">{current.name}</p>
                <p className="text-[11px] text-slate-400">{current.description}</p>
              </div>
            </div>

            {current.auth === 'oauth' ? (
              <button
                onClick={() => void handleConnect()}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                Connect with OAuth
              </button>
            ) : current.fields ? (
              <div className="space-y-3">
                {current.fields.map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-slate-300 mb-1">{f.label}</label>
                    {f.helpText && <p className="text-[10px] text-slate-500 mb-1">{f.helpText}</p>}
                    <input
                      type={f.type}
                      value={formValues[f.key] ?? ''}
                      onChange={(e) => setFormValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-white text-xs placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
                      placeholder={f.helpText || f.label}
                    />
                  </div>
                ))}
                <button
                  onClick={() => void handleConnect(formValues)}
                  disabled={busy || (current.fields ?? []).some((f) => !formValues[f.key]?.trim())}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-40"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Connect & Continue'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => void handleConnect()}
                disabled={busy}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-40"
              >
                Connect
              </button>
            )}

            <button onClick={skip} className="w-full mt-2 text-xs text-slate-500 hover:text-slate-300 transition-colors py-1">
              Skip for now →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
