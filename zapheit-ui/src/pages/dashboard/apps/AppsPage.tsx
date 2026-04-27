import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Loader2, ChevronDown, ChevronUp, X, Eye, EyeOff, ExternalLink,
  Search, CheckCircle2, AlertCircle, Clock, Zap, ArrowRight,
  Building2, Users, Receipt, MessageSquare, Shield, TrendingUp,
  Headphones, BarChart3, Scale, LayoutGrid, Landmark, RefreshCw,
  Bell, BellOff, ChevronRight, Activity,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { api } from '../../../lib/api-client';
import { authenticatedFetch } from '../../../lib/api/_helpers';
import { toast } from '../../../lib/toast';
import type { AIAgent } from '../../../types';
import { AppLogo } from './components/AppLogo';
import { useAppsData } from './hooks/useAppsData';
import { getAppServiceId } from './helpers';
import { ConnectWizard } from './connect-wizard/ConnectWizard';
import { IntentPicker } from './components/IntentPicker';
import type { UnifiedApp } from './types';
import type { AuthType, ProductionStatus, CredField, AppDef, AppStack } from './data/catalog';
import { APP_CATALOG, CATEGORY_TABS, STACKS, INDIA_POPULAR_IDS } from './data/catalog';
import { GOV_LABEL, GOV_COLOR, getGovTier } from './data/governance';
import { LIVE_METRICS } from './data/live-metrics';
import { CONNECTOR_ACTIONS, RISK_COLOR } from './data/connector-actions';
import { AppCardSkeleton } from './components/AppCardSkeleton';
import { setupScore, SetupScoreBar } from './components/SetupScoreBar';
import { getNotifiedApps, toggleNotifyApp } from './data/notifications';

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────── */

type ConnStatus = 'connected' | 'disconnected' | 'error';

function resolveStatus(app: AppDef, backendApp: any): ConnStatus {
  if (!backendApp) return 'disconnected';
  const s = backendApp.status || backendApp.connectionStatus || backendApp.connection_status || '';
  const connected = Boolean(
    backendApp.connected
    || backendApp.installed
    || backendApp.is_connected
    || s === 'connected',
  );
  if (s === 'connected') return 'connected';
  if ((s === 'error' || s === 'expired') && connected) return 'error';
  return 'disconnected';
}

function resolveHealth(backendApp: any): { label: string; good: boolean } | null {
  if (!backendApp) return null;
  const lastSync = backendApp.last_sync_at || backendApp.lastSyncAt;
  const lastErr = backendApp.last_error_at || backendApp.lastErrorAt;
  if (lastErr && (!lastSync || new Date(lastErr) > new Date(lastSync))) {
    const msg = backendApp.last_error_msg || backendApp.lastErrorMsg || 'Connection error';
    return { label: msg.slice(0, 40), good: false };
  }
  if (lastSync) {
    const mins = Math.round((Date.now() - new Date(lastSync).getTime()) / 60000);
    const label = mins < 2 ? 'Just synced' : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
    return { label: `Last sync ${label}`, good: true };
  }
  return null;
}

function formatLastSync(backendApp: any): string | null {
  const ts = backendApp?.last_sync_at || backendApp?.lastSyncAt || backendApp?.connected_at;
  if (!ts) return null;
  const d = new Date(ts);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* Bridge AppDef → UnifiedApp so ConnectWizard can receive it */
function appDefToUnifiedApp(def: AppDef, backendUnified?: UnifiedApp | null): UnifiedApp {
  if (backendUnified) return backendUnified;
  return {
    id: `app:${def.appId}`,
    appId: def.appId,
    name: def.name,
    description: def.description,
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
      name: f.key,
      label: f.label,
      type: f.type,
      placeholder: f.type === 'password' ? '••••••••' : f.label,
      required: !f.optional,
    })),
    permissions: [],
    actionsUnlocked: [],
    featured: false,
    trustTier: (def.category === 'finance' || def.category === 'it' || def.category === 'compliance')
      ? 'high-trust-operational' : 'observe-only',
    maturity: 'connected',
    governanceSummary: { readCount: 0, actionCount: 0, enabledActionCount: 0 },
    agentCapabilities: [],
    capabilityPolicies: [],
    mcpTools: [],
    primaryServiceId: def.serviceId,
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   CredForm — enhanced with helpText + test-connection step
──────────────────────────────────────────────────────────────────────────── */

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

function CredForm({
  app,
  onSubmit,
  onCancel,
  submitting,
}: {
  app: AppDef;
  onSubmit: (creds: Record<string, string>) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const fields = app.fields ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [testState, setTestState] = useState<TestState>('idle');
  const [testError, setTestError] = useState('');

  const set = (k: string, v: string) => { setValues((p) => ({ ...p, [k]: v })); setTestState('idle'); };
  const toggle = (k: string) => setShown((p) => ({ ...p, [k]: !p[k] }));
  const ready = fields.filter((f) => !f.optional).every((f) => values[f.key]?.trim());

  const handleConnect = async () => {
    setTestState('testing');
    setTestError('');
    try {
      const res = await authenticatedFetch<{ success: boolean; message?: string }>(`/marketplace/apps/${app.appId}/test`, {
        method: 'POST',
        body: JSON.stringify({ credentials: values }),
      });
      if (!res.success || res.data?.success === false) {
        setTestState('fail');
        setTestError((res.data as any)?.message || res.error || "That API key didn't work. Double-check it in your app settings and try again.");
        return;
      }
      setTestState('ok');
      onSubmit(values);
    } catch (err) {
      console.warn('[CredForm] connection test failed:', err);
      setTestState('fail');
      setTestError("Couldn't reach the server. Check your internet connection and try again.");
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            {f.label}
            {f.optional
              ? <span className="ml-1 text-slate-600 font-normal">(optional)</span>
              : <span className="ml-0.5 text-rose-400" title="Required">*</span>
            }
          </label>
          <div className="flex items-center gap-1">
            <input
              type={f.type === 'password' && !shown[f.key] ? 'password' : 'text'}
              value={values[f.key] || ''}
              onChange={(e) => set(f.key, e.target.value)}
              className="flex-1 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/50 transition-colors"
              placeholder={f.type === 'password' ? '••••••••' : f.label}
            />
            {f.type === 'password' && (
              <button type="button" onClick={() => toggle(f.key)} className="p-2 text-slate-500 hover:text-slate-300">
                {shown[f.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            )}
          </div>
          {f.helpText && (
            <p className="mt-1 text-[11px] text-slate-500">
              <span className="text-blue-400/70">Where to find it:</span> {f.helpText}
            </p>
          )}
        </div>
      ))}

      {testState === 'fail' && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />
          <p className="text-xs text-rose-300">{testError}</p>
        </div>
      )}

      {testState === 'ok' && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-300">Connection verified — saving…</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready || submitting || testState === 'testing' || testState === 'ok'}
          onClick={handleConnect}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-40"
        >
          {testState === 'testing' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Testing connection…</>
          ) : submitting || testState === 'ok' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
          ) : (
            'Test & Connect'
          )}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Request Access Modal
──────────────────────────────────────────────────────────────────────────── */

function RequestAccessModal({ appName, onClose }: { appName: string; onClose: () => void }) {
  const [form, setForm] = useState({ app_name: appName, name: '', email: '', company: '', use_case: '' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const ready = form.name && form.email && form.company && form.use_case;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await authenticatedFetch('/api/marketplace/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appName.toLowerCase().replace(/\s+/g, '-'), app_name: form.app_name, use_case: `${form.name} (${form.company}, ${form.email}): ${form.use_case}` }),
      });
      setDone(true);
    } catch (err) {
      console.warn('[RequestAccessModal] submit failed:', err);
      toast.error('Failed to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1829] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Request access — {appName}</h2>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        {done ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-white">Request submitted!</p>
            <p className="text-xs text-slate-400">We'll notify you at {form.email} when {appName} is ready.</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 rounded-xl bg-white/[0.07] text-sm text-slate-300 hover:bg-white/[0.12] transition-colors">Close</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Tell us about your use case — this becomes our roadmap signal.</p>
            {[
              { k: 'name' as const, label: 'Your name', type: 'text' },
              { k: 'email' as const, label: 'Work email', type: 'email' },
              { k: 'company' as const, label: 'Company name', type: 'text' },
            ].map(({ k, label, type }) => (
              <div key={k}>
                <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
                <input
                  type={type}
                  value={form[k]}
                  onChange={(e) => set(k, e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/50 transition-colors"
                />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Use case</label>
              <textarea
                rows={3}
                value={form.use_case}
                onChange={(e) => set('use_case', e.target.value)}
                placeholder="What would you automate if this app were connected?"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/50 transition-colors resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
              <button
                disabled={!ready || submitting}
                onClick={handleSubmit}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-40"
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Submit request
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Stack Setup Card
──────────────────────────────────────────────────────────────────────────── */

function StackCard({ stack, onSelect }: { stack: AppStack; onSelect: () => void }) {
  const apps = stack.appIds.map((id) => APP_CATALOG.find((a) => a.appId === id)).filter(Boolean) as AppDef[];
  return (
    <button
      onClick={onSelect}
      className="shrink-0 w-56 rounded-2xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.07] p-4 text-left transition-all hover:border-white/15 group"
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ background: `${stack.colorHex}22`, border: `1px solid ${stack.colorHex}33` }}>
        <span style={{ color: stack.colorHex }} className="flex items-center justify-center"><stack.Icon className="w-4 h-4" /></span>
      </div>
      <p className="text-sm font-semibold text-white mb-1">{stack.name}</p>
      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">{stack.description}</p>
      <div className="flex items-center gap-1 flex-wrap">
        {apps.map((a) => (
          <span key={a.appId} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.07] text-slate-400 font-medium">{a.name}</span>
        ))}
      </div>
      <div className="flex items-center gap-1 mt-3 text-[11px] font-semibold group-hover:text-blue-400 text-slate-500 transition-colors">
        Set up <ArrowRight className="w-3 h-3" />
      </div>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Stack Setup Wizard
──────────────────────────────────────────────────────────────────────────── */

function StackWizard({
  stack,
  apps,
  onConnect,
  onClose,
}: {
  stack: AppStack;
  apps: AppDef[];
  onConnect: (app: AppDef, creds?: Record<string, string>) => Promise<void>;
  onClose: () => void;
}) {
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

        {/* Header */}
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

        {/* Progress steps */}
        <div className="flex items-center gap-0 px-6 pt-4">
          {apps.map((app, i) => (
            <div key={app.appId} className="flex items-center flex-1 min-w-0">
              <div className={cn(
                'flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0 transition-colors',
                done.has(app.appId) ? 'bg-emerald-500 text-white' :
                i === step ? 'bg-blue-600 text-white' :
                'bg-white/[0.08] text-slate-500',
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

        {/* Step content */}
        {allDone ? (
          <div className="px-6 py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-400/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-base font-semibold text-white mb-1">{stack.name} connected!</p>
            <p className="text-xs text-slate-400 mb-6">All {apps.length} apps are set up and ready. Your agents can now act across this stack.</p>
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

/* ─────────────────────────────────────────────────────────────────────────
   App Card
──────────────────────────────────────────────────────────────────────────── */

/* 5-minute cache for live metrics to avoid re-fetching on every re-render */
const METRIC_CACHE = new Map<string, { value: string; expiresAt: number }>();

function AppCard({
  app,
  status,
  backendApp,
  backendUnified,
  onConnect,
  onDisconnect,
  onOpenWorkspace,
  onOpenWizard,
  onRequestAccess,
  onNavigate,
}: {
  app: AppDef;
  status: ConnStatus;
  backendApp: any;
  backendUnified: UnifiedApp | null;
  onConnect: (app: AppDef, creds?: Record<string, string>) => Promise<void>;
  onDisconnect: (app: AppDef) => Promise<void>;
  onOpenWorkspace: (app: AppDef) => void;
  onOpenWizard: (app: AppDef, backendUnified: UnifiedApp | null) => void;
  onRequestAccess: (app: AppDef) => void;
  onNavigate?: (route: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [liveMetric, setLiveMetric] = useState<string | null>(null);
  const [notified, setNotified] = useState(() => getNotifiedApps().has(app.appId));
  const [actionsOpen, setActionsOpen] = useState(false);
  const [usageCount, setUsageCount] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const metricFetched = useRef(false);
  const usageFetched = useRef(false);

  // Fetch live metric only when card enters viewport (IntersectionObserver throttle)
  useEffect(() => {
    if (status !== 'connected' || metricFetched.current) return;
    const config = LIVE_METRICS[app.appId];
    if (!config) return;

    const cached = METRIC_CACHE.get(app.appId);
    if (cached && cached.expiresAt > Date.now()) { setLiveMetric(cached.value); metricFetched.current = true; return; }

    const el = cardRef.current;
    if (!el) return;
    let cancelled = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || metricFetched.current) return;
      metricFetched.current = true;
      observer.disconnect();
      api.unifiedConnectors.executeAction(app.appId, config.action, config.params)
        .then((res) => {
          if (cancelled) return;
          const payload = res.data?.data ?? res.data;
          const label = config.extract(payload);
          if (label) { setLiveMetric(label); METRIC_CACHE.set(app.appId, { value: label, expiresAt: Date.now() + 5 * 60 * 1000 }); }
        })
        .catch((err) => console.warn('[AppCard] live metric fetch failed:', err));
    }, { threshold: 0.1 });
    observer.observe(el);
    return () => { cancelled = true; observer.disconnect(); };
  }, [app.appId, status]);

  // Fetch usage count when card enters viewport
  useEffect(() => {
    if (status !== 'connected' || usageFetched.current) return;
    const el = cardRef.current;
    if (!el) return;
    let cancelled = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || usageFetched.current) return;
      usageFetched.current = true;
      observer.disconnect();
      const from = new Date();
      from.setDate(1); from.setHours(0, 0, 0, 0);
      api.auditLogs.list({ search: app.appId, from: from.toISOString(), limit: 100 })
        .then((res) => {
          if (cancelled) return;
          const count = (res as any).total ?? res.data?.length ?? 0;
          if (count > 0) setUsageCount(count);
        })
        .catch((err) => console.warn('[AppCard] usage count fetch failed:', err));
    }, { threshold: 0.1 });
    observer.observe(el);
    return () => { cancelled = true; observer.disconnect(); };
  }, [app.appId, status]);

  const connect = async (creds?: Record<string, string>) => {
    setBusy(true);
    try { await onConnect(app, creds); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true);
    try { await onDisconnect(app); }
    finally { setBusy(false); }
  };

  const handleNotifyToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = toggleNotifyApp(app.appId);
    setNotified(next);
    toast.success(next ? `We'll notify you when ${app.name} is ready.` : `Notification removed for ${app.name}.`);
  };

  const health = resolveHealth(backendApp);
  const lastSync = formatLastSync(backendApp);
  const isConnected = status === 'connected';
  const isError = status === 'error';
  const govTier = getGovTier(app.appId);
  const score = setupScore(isConnected, health, false);
  const connectorActions = CONNECTOR_ACTIONS[app.appId] ?? [];

  return (
    <div
      ref={cardRef}
      className={cn(
        'rounded-2xl border p-5 transition-all',
        isConnected ? 'border-emerald-500/15 bg-emerald-500/[0.03]' : 'border-white/8 bg-white/[0.02] hover:border-white/12',
      )}
    >
      <div className="flex items-start gap-4">
        {/* Logo */}
        <div className="relative shrink-0">
          <AppLogo appId={app.appId} logoLetter={app.logoLetter} colorHex={app.colorHex} size="md" />
          {app.isIndiaNative && (
            <span className="absolute -top-1 -right-1 text-[10px] leading-none" title="India-native app">🇮🇳</span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white">{app.name}</h3>

            {/* Status badge */}
            {isConnected && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 text-emerald-300 font-medium">
                Connected
              </span>
            )}
            {status === 'error' && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-rose-400/20 bg-rose-500/10 text-rose-300 font-medium">
                Error
              </span>
            )}
            {app.productionStatus === 'coming_soon' && !isConnected && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-600/40 bg-white/[0.04] text-slate-500 font-medium">
                Coming Soon
              </span>
            )}
            {app.productionStatus === 'special' && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-400/20 bg-amber-500/10 text-amber-300 font-medium">
                Requires Approval
              </span>
            )}

            {/* Auth type */}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.07] text-slate-500 font-mono">
              {app.auth === 'oauth' ? 'OAuth 2.0' : 'API Key'}
            </span>

            {/* Governance tier */}
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', GOV_COLOR[govTier])}>
              {GOV_LABEL[govTier]}
            </span>
          </div>

          <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-lg">{app.description}</p>

          {/* Live metric + usage counter chips */}
          {isConnected && (liveMetric || usageCount != null) && (
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              {liveMetric && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-amber-400/25 bg-amber-500/[0.08] text-amber-300 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  {liveMetric}
                </span>
              )}
              {usageCount != null && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-violet-400/20 bg-violet-500/[0.07] text-violet-300 font-medium">
                  <Activity className="w-3 h-3" />
                  Used {usageCount}× this month
                </span>
              )}
            </div>
          )}

          {/* Connected details */}
          {isConnected && (
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              {app.workspaceRoute && (
                <button
                  onClick={() => onOpenWorkspace(app)}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" /> Open Workspace
                </button>
              )}
              {lastSync && (
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <Clock className="w-3 h-3" /> {lastSync}
                </span>
              )}
            </div>
          )}

          {/* Health indicator */}
          {isConnected && health && (
            <div className={cn('mt-1.5 flex items-center gap-1.5 text-[11px]', health.good ? 'text-emerald-400/70' : 'text-amber-400')}>
              {health.good
                ? <RefreshCw className="w-3 h-3" />
                : <AlertCircle className="w-3 h-3" />}
              {health.label}
            </div>
          )}

          {/* Setup quality score */}
          {isConnected && (
            <SetupScoreBar
              score={score}
              isConnected={isConnected}
              onAttachAgent={() => {
                if (app.suggestedAgent && onNavigate) {
                  onNavigate(`agents/new?template=${encodeURIComponent(app.suggestedAgent.toLowerCase().replace(/\s+/g, '-'))}`);
                }
              }}
            />
          )}

          {/* Actions preview — expandable "What can my agent do?" */}
          {isConnected && connectorActions.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setActionsOpen((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                {actionsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                What can my agent do?
                <span className="ml-1 text-[10px] px-1 rounded bg-white/[0.06] text-slate-500">{connectorActions.length}</span>
              </button>
              {actionsOpen && (
                <div className="mt-2 grid grid-cols-1 gap-1">
                  {connectorActions.map((action, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className={cn(
                        'w-1.5 h-1.5 rounded-full shrink-0',
                        action.type === 'read' ? 'bg-blue-400/60' : (action.risk === 'high' ? 'bg-rose-400' : action.risk === 'medium' ? 'bg-amber-400' : 'bg-emerald-400'),
                      )} />
                      <span className="text-slate-300">{action.label}</span>
                      <span className={cn('ml-auto text-[10px]', action.type === 'read' ? 'text-blue-400/60' : RISK_COLOR[action.risk ?? 'low'])}>
                        {action.type === 'read' ? 'Read' : `Write · ${action.risk ?? 'low'} risk`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Notify-me toggle for coming soon apps */}
          {app.productionStatus === 'coming_soon' && !isConnected && (
            <button
              onClick={handleNotifyToggle}
              className={cn(
                'mt-2 flex items-center gap-1.5 text-[11px] transition-colors',
                notified ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300',
              )}
              title={notified ? 'Click to stop notifications' : 'Notify me when available'}
            >
              {notified ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
              {notified ? 'Notifying me when ready' : 'Notify me when available'}
            </button>
          )}
        </div>

        {/* Action button */}
        <div className="shrink-0">
          {isConnected ? (
            <div className="flex flex-col items-end gap-1.5">
              {app.workspaceRoute && (
                <button
                  onClick={() => onOpenWorkspace(app)}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
                >
                  Open Workspace
                </button>
              )}
              <button
                onClick={() => void disconnect()}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl border border-rose-400/20 bg-rose-500/10 text-rose-300 text-xs font-semibold hover:bg-rose-500/20 transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Disconnect'}
              </button>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-end gap-1.5">
              <button
                onClick={() => app.auth === 'oauth' ? void connect() : onOpenWizard(app, backendUnified)}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-semibold transition-colors disabled:opacity-40"
              >
                <AlertCircle className="w-3.5 h-3.5" />
                Fix Connection
              </button>
            </div>
          ) : app.productionStatus === 'coming_soon' ? (
            <button
              className="px-3 py-1.5 rounded-xl border border-slate-600/40 bg-white/[0.04] text-slate-500 text-xs font-semibold cursor-default"
              disabled
            >
              Coming Soon
            </button>
          ) : app.productionStatus === 'special' ? (
            <button
              onClick={() => onRequestAccess(app)}
              className="px-3 py-1.5 rounded-xl border border-amber-400/20 bg-amber-500/10 text-amber-300 text-xs font-semibold hover:bg-amber-500/20 transition-colors"
            >
              Request Access
            </button>
          ) : app.auth === 'oauth' ? (
            <button
              onClick={() => void connect()}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Connect
            </button>
          ) : (
            <button
              onClick={() => onOpenWizard(app, backendUnified)}
              disabled={busy}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold transition-all"
            >
              Connect
            </button>
          )}
        </div>
      </div>

    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Page
──────────────────────────────────────────────────────────────────────────── */

interface AppsPageProps {
  agents?: AIAgent[];
  onNavigate?: (route: string) => void;
}

export default function AppsPage({ agents = [], onNavigate }: AppsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [requestApp, setRequestApp] = useState<AppDef | null>(null);
  const [stackFilter, setStackFilter] = useState<string[] | null>(null);
  const [activeWizard, setActiveWizard] = useState<AppStack | null>(null);
  const [wizardApp, setWizardApp] = useState<{ def: AppDef; unified: UnifiedApp } | null>(null);

  const { allApps, loading, reload, markDisconnected } = useAppsData(agents);

  // Handle OAuth callback — supports both integrations flow (?status=&service=)
  // and marketplace flow (?marketplace_connected=&marketplace_app= / ?marketplace_error=)
  useEffect(() => {
    const status     = searchParams.get('status');
    const service    = searchParams.get('service') || searchParams.get('provider');
    const message    = searchParams.get('message');
    const mConnected = searchParams.get('marketplace_connected');
    const mApp       = searchParams.get('marketplace_app');
    const mError     = searchParams.get('marketplace_error');

    let needsClean = false;

    // Integrations OAuth callback
    if (status && service) {
      needsClean = true;
      if (status === 'connected') {
        void reload().then(() => {
          const app = APP_CATALOG.find((a) => a.serviceId === service || a.appId === service);
          toast.success(`${app?.name ?? service} connected`);
          if (app?.workspaceRoute && onNavigate) onNavigate(app.workspaceRoute);
        });
      } else if (status === 'error') {
        toast.error(message || 'Connection failed');
      }
    }

    // Marketplace OAuth callback
    if (mConnected === 'true' && mApp) {
      needsClean = true;
      void reload().then(() => {
        const app = APP_CATALOG.find((a) => a.appId === mApp || a.serviceId === mApp);
        toast.success(`${app?.name ?? mApp} connected`);
        if (app?.workspaceRoute && onNavigate) onNavigate(app.workspaceRoute);
      });
    }

    if (mError) {
      needsClean = true;
      const appName = mApp ? (APP_CATALOG.find((a) => a.appId === mApp)?.name ?? mApp) : 'App';
      toast.error(`${appName}: OAuth failed — ${mError}`);
    }

    if (needsClean) {
      setSearchParams((p) => {
        ['status', 'service', 'provider', 'message', 'marketplace_connected', 'marketplace_app', 'marketplace_error']
          .forEach((k) => p.delete(k));
        return p;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams, reload, onNavigate]);

  // Merge backend status
  const apps = useMemo(() => APP_CATALOG.map((def) => {
    const backendUnified = allApps.find((a) => {
      const sid = getAppServiceId(a);
      return a.appId === def.appId || sid === def.serviceId;
    }) ?? null;
    return { def, status: resolveStatus(def, backendUnified), backendApp: backendUnified, backendUnified };
  }), [allApps]);

  // Filter
  const filtered = useMemo(() => {
    let list = apps;
    if (stackFilter) list = list.filter(({ def }) => stackFilter.includes(def.appId));
    else if (activeCategory !== 'all') list = list.filter(({ def }) => def.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(({ def }) =>
        def.name.toLowerCase().includes(q) ||
        def.description.toLowerCase().includes(q) ||
        def.category.toLowerCase().includes(q),
      );
    }
    // India-native apps sort to top within category
    return [...list].sort((a, b) => {
      if (a.def.isIndiaNative && !b.def.isIndiaNative) return -1;
      if (!a.def.isIndiaNative && b.def.isIndiaNative) return 1;
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (a.status !== 'connected' && b.status === 'connected') return 1;
      return 0;
    });
  }, [apps, activeCategory, search, stackFilter]);

  const connected = useMemo(() => apps.filter((a) => a.status === 'connected'), [apps]);

  const needsAttention = useMemo(() => connected.filter(({ status, backendApp }) => {
    if (status === 'error') return true;
    const raw = backendApp as any;
    const lastErr = raw?.last_error_at || raw?.lastErrorAt;
    const lastSync = raw?.last_sync_at || raw?.lastSyncAt;
    return lastErr && (!lastSync || new Date(lastErr) > new Date(lastSync));
  }), [connected]);
  const indiaNativeCount = useMemo(() => APP_CATALOG.filter((a) => a.isIndiaNative).length, []);
  const comingSoonCount = useMemo(() => APP_CATALOG.filter((a) => a.productionStatus === 'coming_soon').length, []);

  const popularInIndia = useMemo(
    () => INDIA_POPULAR_IDS.map((id) => apps.find(({ def }) => def.appId === id)).filter(Boolean) as typeof apps,
    [apps],
  );

  /* Connect handler */
  const handleConnect = useCallback(async (app: AppDef, creds?: Record<string, string>) => {
    if (app.auth === 'oauth') {
      // Must use initOAuth (authenticated fetch) — direct browser navigation never sends
      // the Authorization header so the authorize route returns 401.
      const res = await api.integrations.initOAuth(app.serviceId, '/dashboard/apps');
      if (res.success && (res.data as any)?.url) {
        window.location.href = (res.data as any).url;
      } else {
        toast.error((res as any).error || 'Failed to start OAuth flow');
      }
      return;
    }
    if (!creds) return;
    const res = await api.integrations.connect(app.serviceId, creds);
    if (res.success) {
      toast.success(`${app.name} connected`);
      void reload();
    } else {
      toast.error((res as any).error || 'Connection failed');
    }
  }, [reload]);

  const handleDisconnect = useCallback(async (app: AppDef) => {
    // Optimistically remove from UI immediately — reload() may fail if auth session is
    // degraded, which would leave the card showing Connected despite a successful API call.
    markDisconnected(app.serviceId);
    const res = await api.integrations.disconnect(app.serviceId);
    if (res.success) {
      toast.success(`${app.name} disconnected`);
    } else {
      toast.error((res as any).error || 'Disconnect failed');
    }
    void reload();
  }, [reload, markDisconnected]);

  const handleOpenWizard = useCallback((def: AppDef, backendUnified: UnifiedApp | null) => {
    setWizardApp({ def, unified: appDefToUnifiedApp(def, backendUnified) });
  }, []);

  const handleWizardConnect = useCallback(async (_unified: UnifiedApp, creds: Record<string, string>) => {
    const def = wizardApp?.def;
    if (!def) return;

    if (def.auth === 'oauth') {
      // OAuth apps: initiate provider redirect — browser navigates away
      const res = await api.integrations.initOAuth(def.serviceId, '/dashboard/apps');
      if (res.success && (res.data as any)?.url) {
        window.location.href = (res.data as any).url;
      } else {
        throw new Error((res as any).error || 'Failed to start OAuth flow');
      }
      return;
    }

    const res = await api.integrations.connect(def.serviceId, creds);
    if (!res.success) throw new Error((res as any).error || 'Connection failed');
    void reload();
  }, [wizardApp, reload]);

  const handleOpenWorkspace = useCallback((app: AppDef) => {
    if (app.workspaceRoute && onNavigate) onNavigate(app.workspaceRoute);
  }, [onNavigate]);

  const handleStackSelect = (stack: AppStack) => {
    setActiveWizard(stack);
  };

  const clearStackFilter = () => setStackFilter(null);

  return (
    <div className="min-h-full bg-[#080f1a] px-6 py-6">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* Header */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-400/80 mb-1">Apps</p>
          <h1 className="text-2xl font-bold text-white">Connect your tools</h1>
          <p className="text-sm text-slate-400 mt-1">
            Connect once — every action governed, every approval tracked, every audit logged automatically.
          </p>
        </div>

        {/* Stats bar */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {[
            { label: 'Connected', value: connected.length, color: 'text-emerald-400' },
            { label: 'Available now', value: APP_CATALOG.filter((a) => a.productionStatus === 'production_ready').length, color: 'text-blue-400' },
            { label: 'Coming soon', value: comingSoonCount, color: 'text-slate-400' },
            { label: 'India-native', value: indiaNativeCount, color: 'text-orange-400' },
            { label: 'Categories', value: CATEGORY_TABS.length - 1, color: 'text-slate-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className={cn('font-bold text-base', color)}>{value}</span>
              <span className="text-slate-500 text-xs">{label}</span>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search 150+ apps by name or category…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setStackFilter(null); }}
            className="w-full rounded-xl border border-white/10 bg-white/[0.05] pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500/40 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Stack filter banner */}
        {stackFilter && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-2">
            <span className="text-xs text-blue-300 font-medium">Showing stack apps</span>
            <button onClick={clearStackFilter} className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
              <X className="w-3 h-3" /> Clear filter
            </button>
          </div>
        )}

        {/* Popular in India — only on "All" tab with no search/stack filter */}
        {!search && !stackFilter && activeCategory === 'all' && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-white">🇮🇳 Popular in India</span>
              <span className="text-[10px] text-slate-500 font-medium px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/8">Featured</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {popularInIndia.map(({ def, status, backendApp }) => (
                <button
                  key={def.appId}
                  onClick={() => {
                    if (status === 'connected' && def.workspaceRoute) handleOpenWorkspace(def);
                    else { setSearch(def.name); }
                  }}
                  className={cn(
                    'flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all hover:border-white/15',
                    status === 'connected' ? 'border-emerald-500/15 bg-emerald-500/[0.03]' : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.05]',
                  )}
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ background: def.colorHex }}
                  >
                    {def.logoLetter.slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{def.name}</p>
                    <p className="text-[10px] text-slate-500">{status === 'connected' ? '✓ Connected' : def.productionStatus === 'production_ready' ? 'Ready' : 'Coming soon'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* One-click Stacks — only on "All" tab with no search/stack filter */}
        {!search && !stackFilter && activeCategory === 'all' && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-white">Set up a Stack</span>
              <span className="text-[10px] text-slate-500">Connect multiple apps at once</span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
              {STACKS.map((stack) => (
                <StackCard key={stack.id} stack={stack} onSelect={() => handleStackSelect(stack)} />
              ))}
            </div>
          </div>
        )}

        {/* Connected highlight strip */}
        {connected.length > 0 && !search && !stackFilter && (
          <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4">
            <p className="text-xs font-semibold text-emerald-400 mb-3">Connected ({connected.length})</p>
            <div className="flex flex-wrap gap-2">
              {connected.map(({ def }) => (
                <button
                  key={def.appId}
                  onClick={() => def.workspaceRoute && onNavigate?.(def.workspaceRoute)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-xl border border-emerald-500/20 bg-white/[0.04]',
                    'text-xs font-medium text-slate-200 hover:bg-white/[0.08] transition-colors',
                    !def.workspaceRoute && 'cursor-default',
                  )}
                >
                  <span
                    className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                    style={{ background: def.colorHex }}
                  >
                    {def.logoLetter[0]}
                  </span>
                  {def.name}
                  {def.isIndiaNative && <span className="text-[9px]">🇮🇳</span>}
                  {def.workspaceRoute && <ExternalLink className="w-3 h-3 text-slate-500" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category tabs */}
        {!stackFilter && (
          <div className="flex gap-1 flex-wrap">
            {CATEGORY_TABS.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  activeCategory === cat.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white/[0.05] text-slate-400 hover:text-slate-200 hover:bg-white/[0.09]',
                )}
              >
                <cat.Icon className="w-3 h-3" />
                {cat.label}
              </button>
            ))}
          </div>
        )}

        {/* Attention strip — apps with errors or stale sync */}
        {needsAttention.length > 0 && !search && !stackFilter && (
          <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.06] px-4 py-3">
            <div className="flex items-center gap-2 mb-2.5">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-xs font-semibold text-amber-300">Attention needed</span>
              <span className="text-[10px] text-amber-400/60">{needsAttention.length} app{needsAttention.length !== 1 ? 's' : ''} need attention</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {needsAttention.map(({ def, backendUnified }) => (
                <div
                  key={def.appId}
                  className="flex items-center gap-2 pl-2.5 pr-1 py-1 rounded-lg border border-amber-400/20 bg-white/[0.04]"
                >
                  <span
                    className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                    style={{ background: def.colorHex }}
                  >
                    {def.logoLetter[0]}
                  </span>
                  <span className="text-xs text-slate-300 font-medium">{def.name}</span>
                  <button
                    onClick={() => handleOpenWizard(def, backendUnified)}
                    className="text-[10px] text-amber-400 hover:text-amber-300 font-medium px-1.5 py-0.5 rounded hover:bg-amber-400/10 transition-colors"
                  >
                    Reconnect
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Intent picker — shown on All tab with no filters */}
        {!search && !stackFilter && activeCategory === 'all' && (
          <IntentPicker onSelect={(bundleId) => {
            const stack = STACKS.find((s) => s.id === bundleId);
            if (stack) { setActiveWizard(stack); } else { setSearch(bundleId); }
          }} />
        )}

        {/* App list */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => <AppCardSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-500 text-sm">
            <p>No apps found{search ? ` for "${search}"` : ''}.</p>
            <button
              onClick={() => setRequestApp({ appId: search, serviceId: search, name: search, description: '', category: '', auth: 'api_key', logoLetter: search[0] ?? '?', colorHex: '#666', productionStatus: 'coming_soon' })}
              className="mt-3 text-xs text-blue-400 hover:text-blue-300"
            >
              Request this app →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(({ def, status, backendApp, backendUnified }) => (
              <AppCard
                key={def.appId}
                app={def}
                status={status}
                backendApp={backendApp}
                backendUnified={backendUnified}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                onOpenWorkspace={handleOpenWorkspace}
                onOpenWizard={handleOpenWizard}
                onRequestAccess={setRequestApp}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}

        {/* "Don't see your app?" footer */}
        {!search && (
          <div className="border-t border-white/8 pt-6 text-center">
            <p className="text-xs text-slate-500">
              Don't see your app?{' '}
              <button
                onClick={() => setRequestApp({ appId: '', serviceId: '', name: '', description: '', category: '', auth: 'api_key', logoLetter: '?', colorHex: '#666', productionStatus: 'coming_soon' })}
                className="text-blue-400 hover:text-blue-300 transition-colors"
              >
                Request an integration
              </button>
            </p>
          </div>
        )}
      </div>

      {/* Request Access Modal */}
      {requestApp && (
        <RequestAccessModal
          appName={requestApp.name || 'Custom app'}
          onClose={() => setRequestApp(null)}
        />
      )}

      {activeWizard && (
        <StackWizard
          stack={activeWizard}
          apps={activeWizard.appIds
            .map((id) => APP_CATALOG.find((a) => a.appId === id))
            .filter((a): a is AppDef => !!a && a.productionStatus === 'production_ready')}
          onConnect={handleConnect}
          onClose={() => setActiveWizard(null)}
        />
      )}

      {wizardApp && (
        <ConnectWizard
          app={wizardApp.unified}
          agents={agents}
          onConnect={handleWizardConnect}
          onClose={() => setWizardApp(null)}
          onOpenWorkspace={(unifiedApp) => {
            const def = APP_CATALOG.find((d) => d.appId === unifiedApp.appId);
            if (def?.workspaceRoute && onNavigate) onNavigate(def.workspaceRoute);
            setWizardApp(null);
          }}
        />
      )}
    </div>
  );
}
