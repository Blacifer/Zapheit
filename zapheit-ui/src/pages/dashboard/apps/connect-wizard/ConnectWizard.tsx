import { useState, useCallback } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Key,
  Link2,
  Loader2,
  Settings2,
  Shield,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { RequestIntegrationModal } from '../components/RequestIntegrationModal';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../lib/api-client';
import type { AIAgent } from '../../../../types';
import type { UnifiedApp, CapabilityPolicy } from '../types';
import { AppLogo } from '../components/AppLogo';
import { getAppServiceId } from '../helpers';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Step = 'preview' | 'auth' | 'configure' | 'link-agents' | 'test' | 'done';

const STEPS: Step[] = ['preview', 'auth', 'configure', 'link-agents', 'test', 'done'];

const STEP_LABELS: Record<Step, string> = {
  preview: 'Preview',
  auth: 'Authenticate',
  configure: 'Configure',
  'link-agents': 'Link Agents',
  test: 'Test',
  done: 'Done',
};

interface ConnectWizardProps {
  app: UnifiedApp;
  agents: AIAgent[];
  onConnect: (app: UnifiedApp, creds: Record<string, string>) => Promise<void>;
  onClose: () => void;
  onOpenWorkspace?: (app: UnifiedApp) => void;
  initialStep?: Step;
}

/* ------------------------------------------------------------------ */
/*  Wizard                                                             */
/* ------------------------------------------------------------------ */

export function ConnectWizard({ app, agents, onConnect, onClose, onOpenWorkspace, initialStep }: ConnectWizardProps) {
  const [step, setStep] = useState<Step>(initialStep ?? 'preview');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [linkedAgents, setLinkedAgents] = useState<Set<string>>(new Set());
  const [policies, setPolicies] = useState<CapabilityPolicy[]>(
    () => (app.capabilityPolicies || []).map((p) => ({ ...p })),
  );
  const [oauthNotConfigured, setOauthNotConfigured] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);

  const stepIdx = STEPS.indexOf(step);

  const goNext = useCallback(() => {
    const next = STEPS[stepIdx + 1];
    if (next) setStep(next);
  }, [stepIdx]);

  const goBack = useCallback(() => {
    const prev = STEPS[stepIdx - 1];
    if (prev) setStep(prev);
  }, [stepIdx]);

  /* -- Auth submit ------------------------------------------------- */
  const handleAuth = async () => {
    setBusy(true);
    setOauthNotConfigured(false);
    try {
      await onConnect(app, creds);
      goNext();
    } catch (err: any) {
      if (err?.code === 'OAUTH_NOT_CONFIGURED' || err?.message?.includes('OAUTH_NOT_CONFIGURED')) {
        setOauthNotConfigured(true);
      } else {
        setTestError(err?.message || 'Authentication failed');
      }
    } finally {
      setBusy(false);
    }
  };

  /* -- Finish: persist policies + agent links ----------------------- */
  const handleFinish = async () => {
    setBusy(true);
    setFinishError(null);
    try {
      const serviceId = getAppServiceId(app);
      await Promise.all([
        policies.length > 0
          ? api.integrations.upsertActions(
              policies.map((p) => ({ service: serviceId, action: p.capability, enabled: p.enabled })),
            )
          : Promise.resolve(),
        ...Array.from(linkedAgents).map((agentId) => {
          const agent = agents.find((a) => a.id === agentId);
          const existing = agent?.integrationIds ?? [];
          const merged = Array.from(new Set([...existing, app.appId]));
          return api.unifiedConnectors.updateAgentConnectors(agentId, merged);
        }),
      ]);
      goNext();
    } catch (err: any) {
      setFinishError(err?.message || 'Failed to save configuration. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  /* -- Test connection ---------------------------------------------- */
  const runTest = async () => {
    setTestResult('running');
    setTestError(null);
    try {
      const serviceId = getAppServiceId(app);
      // Try marketplace test first, then integrations test
      const res = app.source === 'marketplace'
        ? await api.marketplace.testConnection(app.appId, creds)
        : await api.integrations.test(serviceId);

      if (res.success) {
        setTestResult('success');
      } else {
        setTestResult('error');
        setTestError((res as any).error || 'Connection test failed');
      }
    } catch (err: any) {
      setTestResult('error');
      setTestError(err?.message || 'Connection test failed');
    }
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0e1117] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/8">
          <div className="flex items-center gap-3">
            <AppLogo appId={app.appId} logoLetter={app.logoLetter} colorHex={app.colorHex} logoUrl={app.logoUrl} size="md" />
            <div>
              <p className="font-bold text-white text-sm">{app.name}</p>
              <p className="text-[11px] text-slate-500">{STEP_LABELS[step]}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 py-3 border-b border-white/5">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={cn(
                'w-2 h-2 rounded-full transition-all',
                i < stepIdx
                  ? 'bg-cyan-400'
                  : i === stepIdx
                  ? 'bg-cyan-400 ring-2 ring-cyan-400/30'
                  : 'bg-white/10',
              )}
            />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 'preview' && <PreviewStep app={app} />}
          {step === 'auth' && !oauthNotConfigured && (
            <AuthStep app={app} creds={creds} setCreds={setCreds} busy={busy} />
          )}
          {step === 'auth' && oauthNotConfigured && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-3">
              <p className="text-sm font-semibold text-amber-200">OAuth not available yet</p>
              <p className="text-xs text-slate-400 leading-relaxed">
                The OAuth connection for <strong className="text-white">{app.name}</strong> isn't configured yet.
                Request it and we'll prioritise it for you.
              </p>
              <button
                onClick={() => setShowRequestModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500/20 border border-amber-500/30 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/30 transition-colors"
              >
                Request this integration
              </button>
            </div>
          )}
          {step === 'configure' && (
            <ConfigureStep policies={policies} setPolicies={setPolicies} />
          )}
          {step === 'link-agents' && (
            <LinkAgentsStep
              agents={agents}
              linkedAgents={linkedAgents}
              setLinkedAgents={setLinkedAgents}
            />
          )}
          {step === 'test' && <TestStep result={testResult} onRetry={runTest} errorMessage={testError} />}
          {step === 'done' && <DoneStep app={app} />}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-white/8">
          {stepIdx > 0 && step !== 'done' ? (
            <button
              onClick={goBack}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          ) : (
            <div />
          )}

          {step === 'preview' && (
            <button
              onClick={goNext}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-semibold transition-all"
            >
              Continue <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {step === 'auth' && (
            <button
              onClick={() => void handleAuth()}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-semibold transition-all disabled:opacity-50"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {app.authType === 'oauth2' ? `Connect with ${app.name}` : 'Authenticate'}
            </button>
          )}

          {step === 'configure' && (
            <button
              onClick={goNext}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-semibold transition-all"
            >
              Continue <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {step === 'link-agents' && (
            <button
              onClick={() => { goNext(); void runTest(); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-semibold transition-all"
            >
              Test Connection <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {step === 'test' && testResult === 'success' && (
            <div className="flex flex-col items-end gap-1.5">
              {finishError && (
                <p className="text-[11px] text-rose-400 text-right">{finishError}</p>
              )}
              <button
                onClick={() => void handleFinish()}
                disabled={busy}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-semibold transition-all disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {busy ? 'Saving…' : 'Finish'}
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-medium transition-colors"
              >
                Connect another
              </button>
              {onOpenWorkspace && (
                <button
                  onClick={() => onOpenWorkspace(app)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-semibold transition-all"
                >
                  Open workspace <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showRequestModal && (
        <RequestIntegrationModal
          appId={app.appId}
          appName={app.name}
          onClose={() => setShowRequestModal(false)}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/*  Step Components                                                    */
/* ================================================================== */

function PreviewStep({ app }: { app: UnifiedApp }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400 leading-relaxed">{app.description}</p>

      {/* Capabilities */}
      {(app.agentCapabilities?.length || app.permissions?.length) ? (
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-amber-400" /> Capabilities
          </p>
          <ul className="space-y-1.5">
            {(app.agentCapabilities || app.actionsUnlocked || []).slice(0, 6).map((a) => (
              <li key={a} className="flex items-start gap-2 text-xs text-slate-300">
                <Zap className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />{a}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Permissions */}
      {app.permissions?.length ? (
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1.5">
            <Key className="w-3 h-3" /> Permissions required
          </p>
          <ul className="space-y-1.5">
            {app.permissions.slice(0, 4).map((p) => (
              <li key={p} className="flex items-start gap-2 text-xs text-slate-400">
                <Key className="w-3 h-3 text-slate-500 mt-0.5 shrink-0" />{p}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Governance info */}
      {app.governanceSummary && (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/8 text-xs text-slate-400">
          <Shield className="w-4 h-4 text-slate-500 shrink-0" />
          <span>
            {app.governanceSummary.actionCount} actions available
            {app.governanceSummary.enabledActionCount > 0 && ` · ${app.governanceSummary.enabledActionCount} enabled`}
          </span>
        </div>
      )}

      {/* Trust & maturity */}
      <div className="flex flex-wrap gap-2">
        {app.trustTier && (
          <span className="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-400 font-medium">
            {app.trustTier}
          </span>
        )}
        {app.maturity && app.maturity !== 'connected' && (
          <span className="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-400 font-medium">
            {app.maturity}
          </span>
        )}
      </div>
    </div>
  );
}

function AuthStep({
  app,
  creds,
  setCreds,
  busy,
}: {
  app: UnifiedApp;
  creds: Record<string, string>;
  setCreds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      {app.authType === 'oauth2' && (
        <div className="px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 flex items-start gap-2">
          <Link2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          You'll be redirected to {app.name} to authorize access.
        </div>
      )}

      {app.authType === 'api_key' && app.requiredFields && (
        <div className="space-y-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1">
            <Key className="w-3 h-3" /> Credentials
          </p>
          {app.requiredFields.map((f) => (
            <div key={f.name}>
              <label className="text-xs text-slate-400 block mb-1">{f.label}</label>
              <input
                type={f.type}
                placeholder={f.placeholder}
                value={creds[f.name] || ''}
                onChange={(e: { target: { value: string } }) =>
                  setCreds((p: Record<string, string>) => ({ ...p, [f.name]: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder:text-slate-600 outline-none focus:border-cyan-500/40 transition-colors"
                disabled={busy}
              />
            </div>
          ))}
        </div>
      )}

      {!app.requiredFields?.length && app.authType !== 'oauth2' && (
        <p className="text-sm text-slate-400">No credentials required. Click Authenticate to continue.</p>
      )}
    </div>
  );
}

function ConfigureStep({
  policies,
  setPolicies,
}: {
  policies: CapabilityPolicy[];
  setPolicies: React.Dispatch<React.SetStateAction<CapabilityPolicy[]>>;
}) {
  const riskColor = (level: string) => {
    if (level === 'high') return 'text-rose-400 border-rose-500/20 bg-rose-500/10';
    if (level === 'medium') return 'text-amber-400 border-amber-500/20 bg-amber-500/10';
    return 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10';
  };

  if (!policies.length) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-slate-500" />
          <p className="text-sm text-slate-400">No configurable capability policies for this app.</p>
        </div>
        <p className="text-xs text-slate-500">Default governance settings will be applied.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1.5">
        <Shield className="w-3 h-3" /> Capability Policies
      </p>
      <div className="space-y-2">
        {policies.map((p, i) => (
          <div
            key={p.capability}
            className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-white/8 bg-white/[0.02]"
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white font-medium truncate">{p.capability}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn('text-[9px] px-1.5 py-0.5 rounded border font-medium', riskColor(p.risk_level))}>
                  {p.risk_level}
                </span>
                {p.requires_human_approval && (
                  <span className="text-[9px] text-amber-300">requires approval</span>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                const updated = [...policies];
                updated[i] = { ...updated[i], enabled: !updated[i].enabled };
                setPolicies(updated);
              }}
              className={cn(
                'w-9 h-5 rounded-full transition-colors relative',
                p.enabled ? 'bg-cyan-500' : 'bg-white/10',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                  p.enabled ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LinkAgentsStep({
  agents,
  linkedAgents,
  setLinkedAgents,
}: {
  agents: AIAgent[];
  linkedAgents: Set<string>;
  setLinkedAgents: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const toggle = (id: string) => {
    setLinkedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!agents.length) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-slate-500" />
          <p className="text-sm text-slate-400">No agents available to link.</p>
        </div>
        <p className="text-xs text-slate-500">You can link agents later from the Agent Studio.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1.5">
        <Sparkles className="w-3 h-3" /> Link agents to this app
      </p>
      <p className="text-xs text-slate-400">Select agents that should have access to this app's capabilities.</p>
      <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => toggle(agent.id)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left',
              linkedAgents.has(agent.id)
                ? 'border-cyan-500/30 bg-cyan-500/[0.06]'
                : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.05]',
            )}
          >
            <div
              className={cn(
                'w-5 h-5 rounded border flex items-center justify-center transition-all shrink-0',
                linkedAgents.has(agent.id)
                  ? 'bg-cyan-500 border-cyan-500'
                  : 'border-white/20 bg-white/5',
              )}
            >
              {linkedAgents.has(agent.id) && (
                <CheckCircle2 className="w-3 h-3 text-white" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white font-medium truncate">{agent.name}</p>
              {agent.description && (
                <p className="text-[10px] text-slate-500 truncate">{agent.description}</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TestStep({
  result,
  onRetry,
  errorMessage,
}: {
  result: 'idle' | 'running' | 'success' | 'error';
  onRetry: () => void;
  errorMessage?: string | null;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 space-y-4">
      {result === 'idle' && (
        <>
          <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-sm text-slate-400">Preparing connection test…</p>
        </>
      )}

      {result === 'running' && (
        <>
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
          <p className="text-sm text-white font-medium">Testing connection…</p>
          <p className="text-xs text-slate-500">Verifying credentials and connectivity</p>
        </>
      )}

      {result === 'success' && (
        <>
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          </div>
          <p className="text-sm text-white font-medium">Connection successful</p>
          <p className="text-xs text-slate-500">Everything is working correctly</p>
        </>
      )}

      {result === 'error' && (
        <>
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
            <AlertCircle className="w-5 h-5 text-rose-400" />
          </div>
          <p className="text-sm text-white font-medium">Connection failed</p>
          <p className="text-xs text-slate-500">{errorMessage || 'Check your credentials and try again'}</p>
          <button
            onClick={onRetry}
            className="text-xs text-cyan-400 hover:text-cyan-300 font-medium transition-colors"
          >
            Retry test
          </button>
        </>
      )}
    </div>
  );
}

function DoneStep({ app }: { app: UnifiedApp }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 space-y-4">
      <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
        <CheckCircle2 className="w-7 h-7 text-emerald-400" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm text-white font-semibold">{app.name} is connected</p>
        <p className="text-xs text-slate-500">
          You can now read data, execute actions, and automate workflows with your agents.
        </p>
      </div>
    </div>
  );
}
