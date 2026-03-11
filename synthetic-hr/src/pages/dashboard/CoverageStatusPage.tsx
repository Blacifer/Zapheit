import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, KeyRound, Radar, ShieldCheck, Users, Workflow } from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';

const COVERAGE_FOCUS_STORAGE_KEY = 'synthetic_hr_coverage_focus';

type CoverageStatusResponse = {
  generatedAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    createdAt: string;
  } | null;
  bootstrap: {
    organizationReady: boolean;
    currentUserProfileReady: boolean;
    operatorReady: boolean;
    pendingInvites: number;
  };
  users: {
    total: number;
    admins: number;
    operators: number;
  };
  agents: {
    total: number;
    active: number;
    paused: number;
    terminated: number;
  };
  apiKeys: {
    total: number;
    active: number;
    recentlyUsed30d: number;
    lastUsedAt: string | null;
  };
  telemetry: {
    gatewayObserved: boolean;
    coverageScore: number;
    status: 'healthy' | 'partial' | 'at_risk';
    lastTrackedAt: string | null;
    lastTrackedModel: string | null;
    lastTrackedEndpoint: string | null;
    costRecords30d: number;
    requests30d: number;
    tokens30d: number;
    spend30dUsd: number;
  };
  providerReconciliation: {
    configured: boolean;
    totalReportedSpendUsd: number | null;
    gapUsd: number | null;
    lastSyncedAt: string | null;
    providers: Array<{
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
      reportedSpendUsd: number;
      source: 'manual' | 'api';
      lastSyncedAt: string | null;
      notes: string | null;
      updatedAt: string;
    }>;
  };
  providerSync: {
    providers: Array<{
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
      enabled: boolean;
      organizationId: string | null;
      projectId: string | null;
      updatedAt: string;
      updatedBy: string | null;
      lastTestAt?: string | null;
      lastTestStatus?: 'ok' | 'failed' | null;
      lastTestMessage?: string | null;
      lastSyncAt?: string | null;
      lastSyncStatus?: 'ok' | 'failed' | null;
      lastSyncMessage?: string | null;
      credentialsAvailable: boolean;
      automatedSyncSupported: boolean;
    }>;
    history: Array<{
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
      ok: boolean;
      message: string;
      runAt: string;
      trigger: 'manual' | 'scheduler';
      importedSpendUsd?: number | null;
    }>;
    scheduler: {
      lastRunAt: string | null;
      lastRunFinishedAt: string | null;
      nextRunAt: string | null;
      running: boolean;
      lastTrigger: 'manual' | 'scheduler' | null;
      lastSummary: {
        organizations: number;
        attempted: number;
        okCount: number;
        failedCount: number;
      } | null;
    };
  };
  reconciliationAlerts: Array<{
    severity: 'info' | 'warning' | 'critical';
    code: string;
    provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other' | 'all';
    title: string;
    message: string;
  }>;
  reconciliationAlertConfig: {
    channels: {
      inApp: boolean;
      email: boolean;
      webhook: boolean;
    };
    thresholds: {
      absoluteGapUsd: number;
      relativeGapRatio: number;
      staleSyncHours: number;
    };
    updatedAt?: string;
    updatedBy?: string | null;
  };
  reconciliationNotifications: {
    history: Array<{
      id: string;
      code: string;
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other' | 'all';
      severity: 'warning' | 'critical';
      title: string;
      message: string;
      sentAt: string;
    }>;
  };
  incidents: {
    open: number;
    critical: number;
    lastIncidentAt: string | null;
  };
  notes: string[];
};

const statusConfig = {
  healthy: {
    label: 'Healthy coverage',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    icon: CheckCircle2,
  },
  partial: {
    label: 'Partial coverage',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    icon: AlertTriangle,
  },
  at_risk: {
    label: 'Coverage at risk',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    icon: AlertTriangle,
  },
} as const;

const providerCatalog: Array<{
  id: 'openai' | 'anthropic' | 'google' | 'openrouter';
  label: string;
  availability: 'live' | 'manual';
}> = [
  { id: 'openai', label: 'OpenAI', availability: 'live' },
  { id: 'anthropic', label: 'Anthropic', availability: 'live' },
  { id: 'google', label: 'Google', availability: 'manual' },
  { id: 'openrouter', label: 'OpenRouter', availability: 'live' },
];

function formatDateTime(value: string | null) {
  if (!value) return 'Not observed yet';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(value: string | null) {
  if (!value) return 'No recent activity';
  const now = Date.now();
  const then = new Date(value).getTime();
  const deltaMinutes = Math.max(0, Math.round((now - then) / 60000));
  if (deltaMinutes < 1) return 'Just now';
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10'}`}>
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-rose-300" />}
        <span className={`text-sm font-medium ${ok ? 'text-emerald-200' : 'text-rose-200'}`}>{label}</span>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, note }: { icon: any; label: string; value: string; note: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <Icon className="h-4 w-4 text-cyan-300" />
      </div>
      <p className="mt-4 text-3xl font-black tracking-[-0.04em] text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{note}</p>
    </div>
  );
}

export default function CoverageStatusPage() {
  const [data, setData] = useState<CoverageStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'google' | 'openrouter' | 'other'>('openai');
  const [reportedSpendUsd, setReportedSpendUsd] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [removingProvider, setRemovingProvider] = useState<string | null>(null);
  const [openAiSyncEnabled, setOpenAiSyncEnabled] = useState(false);
  const [openAiOrgId, setOpenAiOrgId] = useState('');
  const [openAiProjectId, setOpenAiProjectId] = useState('');
  const [anthropicSyncEnabled, setAnthropicSyncEnabled] = useState(false);
  const [openRouterSyncEnabled, setOpenRouterSyncEnabled] = useState(false);
  const [savingSyncConfigProvider, setSavingSyncConfigProvider] = useState<'openai' | 'anthropic' | 'openrouter' | null>(null);
  const [testingSyncProvider, setTestingSyncProvider] = useState<'openai' | 'anthropic' | 'openrouter' | null>(null);
  const [syncingCostsProvider, setSyncingCostsProvider] = useState<'openai' | 'anthropic' | 'openrouter' | null>(null);
  const [runningSweep, setRunningSweep] = useState(false);
  const [alertChannelsInApp, setAlertChannelsInApp] = useState(true);
  const [alertChannelsEmail, setAlertChannelsEmail] = useState(true);
  const [alertChannelsWebhook, setAlertChannelsWebhook] = useState(true);
  const [alertAbsoluteGapUsd, setAlertAbsoluteGapUsd] = useState('5');
  const [alertRelativeGapPercent, setAlertRelativeGapPercent] = useState('15');
  const [alertStaleSyncHours, setAlertStaleSyncHours] = useState('36');
  const [savingAlertConfig, setSavingAlertConfig] = useState(false);
  const [focusContext, setFocusContext] = useState<{
    id: string;
    title: string;
    message: string;
    timestamp: string;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const response = await api.admin.getCoverageStatus();
    if (!response.success || !response.data) {
      setError(response.error || 'Unable to load coverage status.');
      setLoading(false);
      return;
    }
    setData(response.data);
    const openAiConfig = response.data.providerSync.providers.find((entry) => entry.provider === 'openai');
    const anthropicConfig = response.data.providerSync.providers.find((entry) => entry.provider === 'anthropic');
    const openRouterConfig = response.data.providerSync.providers.find((entry) => entry.provider === 'openrouter');
    setOpenAiSyncEnabled(Boolean(openAiConfig?.enabled));
    setOpenAiOrgId(openAiConfig?.organizationId || '');
    setOpenAiProjectId(openAiConfig?.projectId || '');
    setAnthropicSyncEnabled(Boolean(anthropicConfig?.enabled));
    setOpenRouterSyncEnabled(Boolean(openRouterConfig?.enabled));
    setAlertChannelsInApp(response.data.reconciliationAlertConfig.channels.inApp);
    setAlertChannelsEmail(response.data.reconciliationAlertConfig.channels.email);
    setAlertChannelsWebhook(response.data.reconciliationAlertConfig.channels.webhook);
    setAlertAbsoluteGapUsd(String(response.data.reconciliationAlertConfig.thresholds.absoluteGapUsd));
    setAlertRelativeGapPercent(String(response.data.reconciliationAlertConfig.thresholds.relativeGapRatio * 100));
    setAlertStaleSyncHours(String(response.data.reconciliationAlertConfig.thresholds.staleSyncHours));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COVERAGE_FOCUS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.id && parsed?.title) {
        setFocusContext(parsed);
      }
    } catch {
      setFocusContext(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-[30px] border border-rose-500/25 bg-rose-500/10 p-8">
        <p className="text-xs uppercase tracking-[0.22em] text-rose-300">Coverage status unavailable</p>
        <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-white">Admin coverage view could not be loaded</h1>
        <p className="mt-3 text-sm text-rose-100/80">{error || 'This organization does not have access to the coverage summary yet.'}</p>
      </div>
    );
  }

  const status = statusConfig[data.telemetry.status];
  const StatusIcon = status.icon;
  const reconciliationGap = data.providerReconciliation.gapUsd;
  const openAiSync = data.providerSync.providers.find((entry) => entry.provider === 'openai') || null;
  const anthropicSync = data.providerSync.providers.find((entry) => entry.provider === 'anthropic') || null;
  const openRouterSync = data.providerSync.providers.find((entry) => entry.provider === 'openrouter') || null;
  const clearCoverageFocus = () => {
    localStorage.removeItem(COVERAGE_FOCUS_STORAGE_KEY);
    setFocusContext(null);
  };

  const submitProviderReconciliation = async () => {
    const parsedSpend = Number(reportedSpendUsd);
    if (!Number.isFinite(parsedSpend) || parsedSpend < 0) {
      toast.error('Enter a valid provider-reported spend amount.');
      return;
    }

    setSaving(true);
    const response = await api.admin.updateProviderReconciliation({
      provider,
      reportedSpendUsd: parsedSpend,
      source: 'manual',
      notes: notes.trim() || null,
      lastSyncedAt: new Date().toISOString(),
    });

    if (!response.success) {
      toast.error(response.error || 'Failed to update provider reconciliation.');
      setSaving(false);
      return;
    }

    toast.success(`Updated ${provider} reconciliation total.`);
    setReportedSpendUsd('');
    setNotes('');
    setSaving(false);
    await load();
  };

  const removeProviderReconciliation = async (providerId: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other') => {
    setRemovingProvider(providerId);
    const response = await api.admin.deleteProviderReconciliation(providerId);
    if (!response.success) {
      toast.error(response.error || 'Failed to remove provider reconciliation entry.');
      setRemovingProvider(null);
      return;
    }

    toast.success(`Removed ${providerId} reconciliation entry.`);
    setRemovingProvider(null);
    await load();
  };

  const saveOpenAiSyncConfig = async () => {
    setSavingSyncConfigProvider('openai');
    const response = await api.admin.updateProviderSyncConfig({
      provider: 'openai',
      enabled: openAiSyncEnabled,
      organizationId: openAiOrgId.trim() || null,
      projectId: openAiProjectId.trim() || null,
    });

    if (!response.success) {
      toast.error(response.error || 'Failed to save OpenAI sync config.');
      setSavingSyncConfigProvider(null);
      return;
    }

    toast.success('Saved OpenAI sync configuration.');
    setSavingSyncConfigProvider(null);
    await load();
  };

  const testOpenAiSync = async () => {
    setTestingSyncProvider('openai');
    const response = await api.admin.testOpenAIProviderSync();
    if (!response.success) {
      toast.error(response.error || 'OpenAI sync test failed.');
      setTestingSyncProvider(null);
      await load();
      return;
    }

    toast.success('OpenAI sync credentials validated successfully.');
    setTestingSyncProvider(null);
    await load();
  };

  const syncOpenAiCosts = async () => {
    setSyncingCostsProvider('openai');
    const response = await api.admin.syncOpenAIProviderCosts(30);
    if (!response.success) {
      toast.error(response.error || 'OpenAI cost sync failed.');
      setSyncingCostsProvider(null);
      await load();
      return;
    }

    toast.success(response.data?.message || 'OpenAI costs synced successfully.');
    setSyncingCostsProvider(null);
    await load();
  };

  const saveAnthropicSyncConfig = async () => {
    setSavingSyncConfigProvider('anthropic');
    const response = await api.admin.updateProviderSyncConfig({
      provider: 'anthropic',
      enabled: anthropicSyncEnabled,
      organizationId: null,
      projectId: null,
    });

    if (!response.success) {
      toast.error(response.error || 'Failed to save Anthropic sync config.');
      setSavingSyncConfigProvider(null);
      return;
    }

    toast.success('Saved Anthropic sync configuration.');
    setSavingSyncConfigProvider(null);
    await load();
  };

  const testAnthropicSync = async () => {
    setTestingSyncProvider('anthropic');
    const response = await api.admin.testAnthropicProviderSync();
    if (!response.success) {
      toast.error(response.error || 'Anthropic sync test failed.');
      setTestingSyncProvider(null);
      await load();
      return;
    }

    toast.success('Anthropic sync credentials validated successfully.');
    setTestingSyncProvider(null);
    await load();
  };

  const syncAnthropicCosts = async () => {
    setSyncingCostsProvider('anthropic');
    const response = await api.admin.syncAnthropicProviderCosts(30);
    if (!response.success) {
      toast.error(response.error || 'Anthropic cost sync failed.');
      setSyncingCostsProvider(null);
      await load();
      return;
    }

    toast.success(response.data?.message || 'Anthropic costs synced successfully.');
    setSyncingCostsProvider(null);
    await load();
  };

  const saveOpenRouterSyncConfig = async () => {
    setSavingSyncConfigProvider('openrouter');
    const response = await api.admin.updateProviderSyncConfig({
      provider: 'openrouter',
      enabled: openRouterSyncEnabled,
      organizationId: null,
      projectId: null,
    });

    if (!response.success) {
      toast.error(response.error || 'Failed to save OpenRouter sync config.');
      setSavingSyncConfigProvider(null);
      return;
    }

    toast.success('Saved OpenRouter sync configuration.');
    setSavingSyncConfigProvider(null);
    await load();
  };

  const testOpenRouterSync = async () => {
    setTestingSyncProvider('openrouter');
    const response = await api.admin.testOpenRouterProviderSync();
    if (!response.success) {
      toast.error(response.error || 'OpenRouter sync test failed.');
      setTestingSyncProvider(null);
      await load();
      return;
    }

    toast.success('OpenRouter sync credentials validated successfully.');
    setTestingSyncProvider(null);
    await load();
  };

  const syncOpenRouterCosts = async () => {
    setSyncingCostsProvider('openrouter');
    const response = await api.admin.syncOpenRouterProviderCosts(30);
    if (!response.success) {
      toast.error(response.error || 'OpenRouter cost sync failed.');
      setSyncingCostsProvider(null);
      await load();
      return;
    }

    toast.success(response.data?.message || 'OpenRouter costs synced successfully.');
    setSyncingCostsProvider(null);
    await load();
  };

  const runProviderSweep = async () => {
    setRunningSweep(true);
    const response = await api.admin.runProviderSyncSweep(30);
    if (!response.success) {
      toast.error(response.error || 'Provider sync sweep failed.');
      setRunningSweep(false);
      return;
    }

    const result = response.data;
    toast.success(
      result
        ? `Provider sweep finished: ${result.okCount} ok, ${result.failedCount} failed`
        : 'Provider sync sweep completed.',
    );
    setRunningSweep(false);
    await load();
  };

  const saveAlertConfig = async () => {
    const absoluteGapUsd = Number(alertAbsoluteGapUsd);
    const relativeGapPercent = Number(alertRelativeGapPercent);
    const staleSyncHours = Number(alertStaleSyncHours);

    if (!Number.isFinite(absoluteGapUsd) || absoluteGapUsd < 0) {
      toast.error('Enter a valid absolute drift threshold.');
      return;
    }
    if (!Number.isFinite(relativeGapPercent) || relativeGapPercent < 0 || relativeGapPercent > 100) {
      toast.error('Enter a valid relative drift percentage between 0 and 100.');
      return;
    }
    if (!Number.isFinite(staleSyncHours) || staleSyncHours < 1) {
      toast.error('Enter a valid stale-sync threshold in hours.');
      return;
    }

    setSavingAlertConfig(true);
    const response = await api.admin.updateReconciliationAlertConfig({
      channels: {
        inApp: alertChannelsInApp,
        email: alertChannelsEmail,
        webhook: alertChannelsWebhook,
      },
      thresholds: {
        absoluteGapUsd,
        relativeGapRatio: relativeGapPercent / 100,
        staleSyncHours,
      },
    });

    if (!response.success) {
      toast.error(response.error || 'Failed to save reconciliation alert config.');
      setSavingAlertConfig(false);
      return;
    }

    toast.success('Reconciliation alert settings saved.');
    setSavingAlertConfig(false);
    await load();
  };

  return (
    <div className="space-y-6">
      {focusContext ? (
        <section className="rounded-[24px] border border-cyan-500/25 bg-cyan-500/10 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Opened from notifications</p>
              <h2 className="mt-2 text-xl font-black tracking-[-0.03em] text-white">{focusContext.title}</h2>
              <p className="mt-2 text-sm leading-7 text-cyan-50/90">{focusContext.message}</p>
              <p className="mt-2 text-xs text-cyan-200/70">{formatDateTime(focusContext.timestamp)}</p>
            </div>
            <button
              type="button"
              onClick={clearCoverageFocus}
              className="rounded-2xl border border-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:border-cyan-400/40 hover:text-cyan-200"
            >
              Clear focus
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_28%),linear-gradient(135deg,rgba(8,15,35,0.98),rgba(12,20,38,0.94))] p-7 shadow-[0_24px_80px_rgba(2,6,23,0.28)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300/80">Admin control</p>
            <h1 className="mt-3 text-4xl font-black tracking-[-0.04em] text-white">Coverage and readiness</h1>
            <p className="mt-4 text-base leading-8 text-slate-300">
              One place to confirm that this organization is fully bootstrapped, operator-owned, and sending live RASI-observed traffic through the tracked path.
            </p>
            <div className={`mt-5 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${status.badge}`}>
              <StatusIcon className="h-4 w-4" />
              {status.label}
              <span className="text-white/70">• {data.telemetry.coverageScore}% coverage</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:w-[420px]">
            <MetricCard
              icon={Radar}
              label="Last tracked traffic"
              value={formatRelative(data.telemetry.lastTrackedAt)}
              note={data.telemetry.lastTrackedEndpoint || 'No gateway endpoint observed yet'}
            />
            <MetricCard
              icon={Activity}
              label="Observed requests"
              value={data.telemetry.requests30d.toLocaleString('en-IN')}
              note={`${data.telemetry.tokens30d.toLocaleString('en-IN')} tokens in the last 30 days`}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <MetricCard
          icon={ShieldCheck}
          label="Bootstrap"
          value={data.bootstrap.operatorReady && data.bootstrap.organizationReady ? 'Ready' : 'Blocked'}
          note={`${data.users.admins} admin operators, ${data.bootstrap.pendingInvites} pending invites`}
        />
        <MetricCard
          icon={Users}
          label="Operators"
          value={data.users.operators.toString()}
          note={`${data.users.total} total workspace users`}
        />
        <MetricCard
          icon={Workflow}
          label="Fleet"
          value={data.agents.active.toString()}
          note={`${data.agents.total} total agents, ${data.agents.paused} paused`}
        />
        <MetricCard
          icon={KeyRound}
          label="API keys"
          value={data.apiKeys.active.toString()}
          note={data.apiKeys.lastUsedAt ? `Last used ${formatRelative(data.apiKeys.lastUsedAt)}` : 'No API key traffic observed yet'}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr,1fr]">
        <div className="rounded-[30px] border border-white/10 bg-slate-950/80 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Bootstrap checks</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">
                {data.organization?.name || 'Organization'} readiness
              </h2>
            </div>
            <p className="text-sm text-slate-400">Updated {formatRelative(data.generatedAt)}</p>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <StatusPill ok={data.bootstrap.organizationReady} label="Organization record present" />
            <StatusPill ok={data.bootstrap.currentUserProfileReady} label="Current user mapped to org profile" />
            <StatusPill ok={data.bootstrap.operatorReady} label="Admin operator assigned" />
            <StatusPill ok={data.telemetry.gatewayObserved} label="Gateway-observed traffic recorded" />
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/60 p-5">
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Organization</p>
                <p className="mt-2 text-lg font-semibold text-white">{data.organization?.name || 'Unknown organization'}</p>
                <p className="mt-1 text-sm text-slate-400">{data.organization?.slug || 'No slug assigned'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Plan and created</p>
                <p className="mt-2 text-lg font-semibold text-white">{data.organization?.plan || 'unknown plan'}</p>
                <p className="mt-1 text-sm text-slate-400">{formatDateTime(data.organization?.createdAt || null)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Last tracked model</p>
                <p className="mt-2 text-lg font-semibold text-white">{data.telemetry.lastTrackedModel || 'No tracked model yet'}</p>
                <p className="mt-1 text-sm text-slate-400">{data.telemetry.lastTrackedEndpoint || 'No gateway endpoint recorded'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Open incidents</p>
                <p className="mt-2 text-lg font-semibold text-white">{data.incidents.open} open / {data.incidents.critical} critical</p>
                <p className="mt-1 text-sm text-slate-400">Last incident {formatRelative(data.incidents.lastIncidentAt)}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[30px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Coverage notes</p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">What still needs attention</h2>

          {data.notes.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-emerald-500/25 bg-emerald-500/10 p-5 text-emerald-100">
              All core readiness checks are in place. This org has operators, active keys, and recorded RASI-observed traffic.
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {data.notes.map((note) => (
                <div key={note} className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                  {note}
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Observed spend</p>
            <p className="mt-2 text-3xl font-black tracking-[-0.04em] text-white">
              ${data.telemetry.spend30dUsd.toFixed(2)}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Based only on RASI-observed traffic. Provider console totals can exceed this when requests bypass the gateway.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <div className="rounded-[30px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Provider reconciliation</p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">Observed vs provider-reported spend</h2>
          <p className="mt-3 text-sm leading-7 text-slate-400">
            Use this to compare RASI-observed runtime spend against the invoice-side total from OpenAI, Anthropic, Google, or other providers. Until automated sync exists, these provider figures are manual entries.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <MetricCard
              icon={Activity}
              label="RASI-observed"
              value={`$${data.telemetry.spend30dUsd.toFixed(2)}`}
              note="Tracked through gateway and RASI-observed cost records"
            />
            <MetricCard
              icon={ShieldCheck}
              label="Provider-reported"
              value={data.providerReconciliation.totalReportedSpendUsd !== null ? `$${data.providerReconciliation.totalReportedSpendUsd.toFixed(2)}` : '—'}
              note={data.providerReconciliation.lastSyncedAt ? `Last synced ${formatRelative(data.providerReconciliation.lastSyncedAt)}` : 'No provider total recorded yet'}
            />
            <MetricCard
              icon={AlertTriangle}
              label="Coverage gap"
              value={reconciliationGap !== null ? `$${reconciliationGap.toFixed(2)}` : '—'}
              note={reconciliationGap === null
                ? 'Gap appears after a provider-reported total is entered'
                : reconciliationGap > 0
                  ? 'Provider spend exceeds RASI-observed spend'
                  : reconciliationGap < 0
                    ? 'RASI-observed spend exceeds provider-reported entry'
                    : 'Observed and provider totals match'}
            />
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/60 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              {data.providerReconciliation.providers.length === 0 ? (
                <div className="md:col-span-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                  No provider totals have been recorded yet. Add at least one provider total to start measuring the invoice gap.
                </div>
              ) : (
                data.providerReconciliation.providers.map((entry) => (
                  <div key={entry.provider} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white">{entry.provider}</p>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
                          {entry.source}
                        </span>
                        <button
                          type="button"
                          onClick={() => void removeProviderReconciliation(entry.provider)}
                          disabled={removingProvider === entry.provider}
                          className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300 transition hover:border-rose-400/40 hover:text-rose-200 disabled:cursor-not-allowed disabled:text-slate-500"
                        >
                          {removingProvider === entry.provider ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </div>
                    <p className="mt-3 text-2xl font-black tracking-[-0.04em] text-white">${entry.reportedSpendUsd.toFixed(2)}</p>
                    <p className="mt-2 text-sm text-slate-400">Last sync {formatDateTime(entry.lastSyncedAt)}</p>
                    {entry.notes ? <p className="mt-2 text-sm text-slate-500">{entry.notes}</p> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="rounded-[30px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Manual provider entry</p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">Record invoice-side totals</h2>
          <p className="mt-3 text-sm leading-7 text-slate-400">
            Until automatic billing sync is added, use this form to capture the provider-side total for the current 30-day window.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label htmlFor="recon-provider" className="block text-sm font-medium text-slate-300">Provider</label>
              <select
                id="recon-provider"
                name="recon_provider"
                value={provider}
                onChange={(event) => setProvider(event.target.value as typeof provider)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/60"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google</option>
                <option value="openrouter">OpenRouter</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="recon-spend" className="block text-sm font-medium text-slate-300">Provider-reported spend (USD)</label>
              <input
                id="recon-spend"
                name="recon_spend"
                type="number"
                min="0"
                step="0.01"
                value={reportedSpendUsd}
                onChange={(event) => setReportedSpendUsd(event.target.value)}
                placeholder="0.00"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/60"
              />
            </div>

            <div>
              <label htmlFor="recon-notes" className="block text-sm font-medium text-slate-300">Notes</label>
              <textarea
                id="recon-notes"
                name="recon_notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                placeholder="Example: Pulled from OpenAI usage dashboard for the same 30-day window."
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/60"
              />
            </div>

            <button
              type="button"
              onClick={() => void submitProviderReconciliation()}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {saving ? 'Saving…' : 'Save provider total'}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[30px] border border-white/10 bg-slate-950/80 p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Reconciliation alerting</p>
        <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">Spend drift and sync health alerts</h2>
        <p className="mt-3 text-sm leading-7 text-slate-400">
          Alerts appear here when provider-reported totals drift materially from RASI-observed spend, or when enabled provider syncs fail or go stale.
        </p>

        <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Notification controls</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3">
              <input
                id="recon-alert-inapp"
                name="recon_alert_inapp"
                type="checkbox"
                checked={alertChannelsInApp}
                onChange={(event) => setAlertChannelsInApp(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400"
              />
              <span className="text-sm font-medium text-white">Show alerts in dashboard bell and inbox</span>
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3">
              <input
                id="recon-alert-email"
                name="recon_alert_email"
                type="checkbox"
                checked={alertChannelsEmail}
                onChange={(event) => setAlertChannelsEmail(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400"
              />
              <span className="text-sm font-medium text-white">Email admin operators for warning and critical alerts</span>
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3">
              <input
                id="recon-alert-webhook"
                name="recon_alert_webhook"
                type="checkbox"
                checked={alertChannelsWebhook}
                onChange={(event) => setAlertChannelsWebhook(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400"
              />
              <span className="text-sm font-medium text-white">Send reconciliation alerts to subscribed webhooks</span>
            </label>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="recon-absolute-gap" className="block text-sm font-medium text-slate-300">Absolute drift threshold (USD)</label>
              <input
                id="recon-absolute-gap"
                name="recon_absolute_gap"
                type="number"
                min="0"
                step="0.01"
                value={alertAbsoluteGapUsd}
                onChange={(event) => setAlertAbsoluteGapUsd(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label htmlFor="recon-relative-gap" className="block text-sm font-medium text-slate-300">Relative drift threshold (%)</label>
              <input
                id="recon-relative-gap"
                name="recon_relative_gap"
                type="number"
                min="0"
                max="100"
                step="1"
                value={alertRelativeGapPercent}
                onChange={(event) => setAlertRelativeGapPercent(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/60"
              />
            </div>
            <div>
              <label htmlFor="recon-stale-hours" className="block text-sm font-medium text-slate-300">Stale sync threshold (hours)</label>
              <input
                id="recon-stale-hours"
                name="recon_stale_hours"
                type="number"
                min="1"
                step="1"
                value={alertStaleSyncHours}
                onChange={(event) => setAlertStaleSyncHours(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/60"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void saveAlertConfig()}
              disabled={savingAlertConfig}
              className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {savingAlertConfig ? 'Saving…' : 'Save alert settings'}
            </button>
            <p className="text-sm text-slate-500">
              Current config updates alert generation, dashboard inbox visibility, and email relay behavior.
            </p>
          </div>
        </div>

        {data.reconciliationAlerts.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            No reconciliation alerts are active. Provider syncs and observed totals are within the current tolerance window.
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {data.reconciliationAlerts.map((alert) => (
              <div
                key={`${alert.code}-${alert.provider}-${alert.title}`}
                className={`rounded-2xl border p-4 ${
                  focusContext && focusContext.title === alert.title
                    ? 'ring-2 ring-cyan-400/70'
                    : ''
                } ${
                  alert.severity === 'critical'
                    ? 'border-rose-500/25 bg-rose-500/10 text-rose-100'
                    : alert.severity === 'warning'
                      ? 'border-amber-500/25 bg-amber-500/10 text-amber-100'
                      : 'border-cyan-500/25 bg-cyan-500/10 text-cyan-100'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold uppercase tracking-[0.18em]">{alert.title}</span>
                    <span className="rounded-full border border-current/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
                      {alert.provider}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                    {alert.severity}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-7 opacity-90">{alert.message}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr,1fr]">
        <div className="rounded-[30px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Provider sync framework</p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">Provider sync configuration</h2>
          <p className="mt-3 text-sm leading-7 text-slate-400">
            SyntheticHR now uses one shared provider-sync framework. OpenAI, Anthropic, and OpenRouter are live adapters; the others still reconcile through manual totals until their sync adapters are implemented.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void runProviderSweep()}
              disabled={runningSweep}
              className="inline-flex items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-400/40 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-500"
            >
              {runningSweep ? 'Running sweep…' : 'Run enabled provider syncs now'}
            </button>
            <p className="self-center text-sm text-slate-500">
              Automatic backend sweeps can now use the same sync path as the manual controls.
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {providerCatalog.map((providerEntry) => {
              const syncState = data.providerSync.providers.find((entry) => entry.provider === providerEntry.id) || null;
              const providerTotal = data.providerReconciliation.providers.find((entry) => entry.provider === providerEntry.id) || null;
              return (
                <div key={providerEntry.id} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white">{providerEntry.label}</p>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                      providerEntry.availability === 'live'
                        ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                        : 'border border-amber-500/20 bg-amber-500/10 text-amber-100'
                    }`}>
                      {providerEntry.availability === 'live' ? 'live adapter' : 'manual only'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-400">
                    {providerEntry.availability === 'live'
                      ? syncState?.lastSyncStatus === 'ok'
                        ? `Last synced ${formatRelative(syncState.lastSyncAt || null)}`
                        : syncState?.lastTestStatus === 'ok'
                          ? 'Connection verified; sync ready'
                          : 'Configure headers and test connection'
                      : providerTotal
                        ? 'Manual reconciliation entry present'
                        : 'Use manual provider totals for now'}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-6 rounded-3xl border border-cyan-500/15 bg-cyan-500/5 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-300/80">Live adapter</p>
                <h3 className="mt-2 text-xl font-black tracking-[-0.03em] text-white">OpenAI</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <StatusPill ok={Boolean(openAiSync?.automatedSyncSupported)} label="Automated OpenAI sync path prepared" />
                <StatusPill ok={Boolean(openAiSync?.credentialsAvailable)} label="Backend OpenAI admin key available" />
              </div>
            </div>

            <div className="mt-6 space-y-4">
            <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3">
              <input
                id="openai-sync-enabled"
                name="openai_sync_enabled"
                type="checkbox"
                checked={openAiSyncEnabled}
                onChange={(event) => setOpenAiSyncEnabled(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400"
              />
              <span className="text-sm font-medium text-white">Enable OpenAI provider sync configuration for this org</span>
            </label>

            <div>
              <label htmlFor="openai-org-id" className="block text-sm font-medium text-slate-300">OpenAI organization ID</label>
              <input
                id="openai-org-id"
                name="openai_org_id"
                type="text"
                value={openAiOrgId}
                onChange={(event) => setOpenAiOrgId(event.target.value)}
                placeholder="org_..."
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/60"
              />
            </div>

            <div>
              <label htmlFor="openai-project-id" className="block text-sm font-medium text-slate-300">OpenAI project ID</label>
              <input
                id="openai-project-id"
                name="openai_project_id"
                type="text"
                value={openAiProjectId}
                onChange={(event) => setOpenAiProjectId(event.target.value)}
                placeholder="proj_..."
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/60"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void saveOpenAiSyncConfig()}
                disabled={savingSyncConfigProvider !== null}
                className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {savingSyncConfigProvider === 'openai' ? 'Saving…' : 'Save sync config'}
              </button>
              <button
                type="button"
                onClick={() => void testOpenAiSync()}
                disabled={testingSyncProvider !== null || !openAiSync?.credentialsAvailable}
                className="inline-flex items-center justify-center rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-cyan-400/40 hover:text-cyan-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
              >
                {testingSyncProvider === 'openai' ? 'Testing…' : 'Test OpenAI connection'}
              </button>
              <button
                type="button"
                onClick={() => void syncOpenAiCosts()}
                disabled={syncingCostsProvider !== null || !openAiSync?.credentialsAvailable || !openAiSyncEnabled}
                className="inline-flex items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm font-semibold text-emerald-100 transition hover:border-emerald-400/40 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-500"
              >
                {syncingCostsProvider === 'openai' ? 'Syncing…' : 'Sync OpenAI costs now'}
              </button>
            </div>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-violet-500/15 bg-violet-500/5 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-violet-300/80">Live adapter</p>
                <h3 className="mt-2 text-xl font-black tracking-[-0.03em] text-white">Anthropic</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <StatusPill ok={Boolean(anthropicSync?.automatedSyncSupported)} label="Automated Anthropic sync path prepared" />
                <StatusPill ok={Boolean(anthropicSync?.credentialsAvailable)} label="Backend Anthropic admin key available" />
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3">
                <input
                  id="anthropic-sync-enabled"
                  name="anthropic_sync_enabled"
                  type="checkbox"
                  checked={anthropicSyncEnabled}
                  onChange={(event) => setAnthropicSyncEnabled(event.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-slate-950 text-violet-400"
                />
                <span className="text-sm font-medium text-white">Enable Anthropic provider sync configuration for this org</span>
              </label>

              <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm leading-7 text-slate-300">
                Anthropic sync currently uses the backend admin key and organization cost-report API. No additional workspace headers are required for the first importer pass.
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void saveAnthropicSyncConfig()}
                  disabled={savingSyncConfigProvider !== null}
                  className="inline-flex items-center justify-center rounded-2xl bg-violet-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-violet-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {savingSyncConfigProvider === 'anthropic' ? 'Saving…' : 'Save sync config'}
                </button>
                <button
                  type="button"
                  onClick={() => void testAnthropicSync()}
                  disabled={testingSyncProvider !== null || !anthropicSync?.credentialsAvailable}
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-violet-400/40 hover:text-violet-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                >
                  {testingSyncProvider === 'anthropic' ? 'Testing…' : 'Test Anthropic connection'}
                </button>
                <button
                  type="button"
                  onClick={() => void syncAnthropicCosts()}
                  disabled={syncingCostsProvider !== null || !anthropicSync?.credentialsAvailable || !anthropicSyncEnabled}
                  className="inline-flex items-center justify-center rounded-2xl border border-violet-500/20 bg-violet-500/10 px-5 py-3 text-sm font-semibold text-violet-100 transition hover:border-violet-400/40 hover:bg-violet-500/15 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-500"
                >
                  {syncingCostsProvider === 'anthropic' ? 'Syncing…' : 'Sync Anthropic costs now'}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-sky-500/15 bg-sky-500/5 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-sky-300/80">Live adapter</p>
                <h3 className="mt-2 text-xl font-black tracking-[-0.03em] text-white">OpenRouter</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <StatusPill ok={Boolean(openRouterSync?.automatedSyncSupported)} label="Automated OpenRouter sync path prepared" />
                <StatusPill ok={Boolean(openRouterSync?.credentialsAvailable)} label="Backend OpenRouter admin key available" />
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3">
                <input
                  id="openrouter-sync-enabled"
                  name="openrouter_sync_enabled"
                  type="checkbox"
                  checked={openRouterSyncEnabled}
                  onChange={(event) => setOpenRouterSyncEnabled(event.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-slate-950 text-sky-400"
                />
                <span className="text-sm font-medium text-white">Enable OpenRouter provider sync configuration for this org</span>
              </label>

              <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm leading-7 text-slate-300">
                OpenRouter sync uses the management API. Connection tests validate the credits endpoint, and cost imports sum the last 30 completed UTC days from the activity endpoint.
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void saveOpenRouterSyncConfig()}
                  disabled={savingSyncConfigProvider !== null}
                  className="inline-flex items-center justify-center rounded-2xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {savingSyncConfigProvider === 'openrouter' ? 'Saving…' : 'Save sync config'}
                </button>
                <button
                  type="button"
                  onClick={() => void testOpenRouterSync()}
                  disabled={testingSyncProvider !== null || !openRouterSync?.credentialsAvailable}
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-sky-400/40 hover:text-sky-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                >
                  {testingSyncProvider === 'openrouter' ? 'Testing…' : 'Test OpenRouter connection'}
                </button>
                <button
                  type="button"
                  onClick={() => void syncOpenRouterCosts()}
                  disabled={syncingCostsProvider !== null || !openRouterSync?.credentialsAvailable || !openRouterSyncEnabled}
                  className="inline-flex items-center justify-center rounded-2xl border border-sky-500/20 bg-sky-500/10 px-5 py-3 text-sm font-semibold text-sky-100 transition hover:border-sky-400/40 hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-500"
                >
                  {syncingCostsProvider === 'openrouter' ? 'Syncing…' : 'Sync OpenRouter costs now'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[30px] border border-white/10 bg-slate-950/80 p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Live adapter status</p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">Provider adapter sync status</h2>

          <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Scheduler status</p>
            <p className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">
              {data.providerSync.scheduler.running ? 'Running' : 'Idle'}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Last run {formatDateTime(data.providerSync.scheduler.lastRunFinishedAt || data.providerSync.scheduler.lastRunAt)}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Next run {formatDateTime(data.providerSync.scheduler.nextRunAt)}
            </p>
            {data.providerSync.scheduler.lastSummary ? (
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Last {data.providerSync.scheduler.lastTrigger || 'scheduled'} sweep touched {data.providerSync.scheduler.lastSummary.attempted} provider connection{data.providerSync.scheduler.lastSummary.attempted === 1 ? '' : 's'} across {data.providerSync.scheduler.lastSummary.organizations} orgs, with {data.providerSync.scheduler.lastSummary.okCount} success and {data.providerSync.scheduler.lastSummary.failedCount} failure.
              </p>
            ) : (
              <p className="mt-4 text-sm leading-7 text-slate-300">
                No scheduler sweep has completed yet.
              </p>
            )}
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Status</p>
            <p className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">
              {openAiSync?.lastTestStatus === 'ok' ? 'Connected' : openAiSync?.lastTestStatus === 'failed' ? 'Failed' : 'Not tested'}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {openAiSync?.lastTestAt ? `Last tested ${formatDateTime(openAiSync.lastTestAt)}` : 'No OpenAI connection test has been run yet.'}
            </p>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              {openAiSync?.lastTestMessage || 'Save the sync config, then run a connection test to verify that the backend key and any organization/project headers are accepted by OpenAI.'}
            </p>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Last cost sync</p>
            <p className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">
              {openAiSync?.lastSyncStatus === 'ok' ? 'Imported' : openAiSync?.lastSyncStatus === 'failed' ? 'Failed' : 'Not synced'}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {openAiSync?.lastSyncAt ? `Last synced ${formatDateTime(openAiSync.lastSyncAt)}` : 'No OpenAI cost sync has been run yet.'}
            </p>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              {openAiSync?.lastSyncMessage || 'After the connection test passes, run a sync to import the last 30 days of OpenAI cost buckets into provider reconciliation.'}
            </p>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Anthropic connection status</p>
            <p className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">
              {anthropicSync?.lastTestStatus === 'ok' ? 'Connected' : anthropicSync?.lastTestStatus === 'failed' ? 'Failed' : 'Not tested'}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {anthropicSync?.lastTestAt ? `Last tested ${formatDateTime(anthropicSync.lastTestAt)}` : 'No Anthropic connection test has been run yet.'}
            </p>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              {anthropicSync?.lastTestMessage || 'Save the sync config, then run a connection test to verify that the backend Anthropic admin key can access the organization cost-report API.'}
            </p>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Anthropic cost sync</p>
            <p className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">
              {anthropicSync?.lastSyncStatus === 'ok' ? 'Imported' : anthropicSync?.lastSyncStatus === 'failed' ? 'Failed' : 'Not synced'}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {anthropicSync?.lastSyncAt ? `Last synced ${formatDateTime(anthropicSync.lastSyncAt)}` : 'No Anthropic cost sync has been run yet.'}
            </p>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              {anthropicSync?.lastSyncMessage || 'After the connection test passes, run a sync to import the last 30 days of Anthropic cost buckets into provider reconciliation.'}
            </p>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">OpenRouter connection status</p>
            <p className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">
              {openRouterSync?.lastTestStatus === 'ok' ? 'Connected' : openRouterSync?.lastTestStatus === 'failed' ? 'Failed' : 'Not tested'}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {openRouterSync?.lastTestAt ? `Last tested ${formatDateTime(openRouterSync.lastTestAt)}` : 'No OpenRouter connection test has been run yet.'}
            </p>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              {openRouterSync?.lastTestMessage || 'Save the sync config, then run a connection test to verify that the backend OpenRouter management key can access the credits endpoint.'}
            </p>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">OpenRouter cost sync</p>
            <p className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">
              {openRouterSync?.lastSyncStatus === 'ok' ? 'Imported' : openRouterSync?.lastSyncStatus === 'failed' ? 'Failed' : 'Not synced'}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {openRouterSync?.lastSyncAt ? `Last synced ${formatDateTime(openRouterSync.lastSyncAt)}` : 'No OpenRouter activity sync has been run yet.'}
            </p>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              {openRouterSync?.lastSyncMessage || 'After the connection test passes, run a sync to import the last 30 completed UTC days of OpenRouter activity into provider reconciliation.'}
            </p>
          </div>

          <div className="mt-6 rounded-3xl border border-amber-500/20 bg-amber-500/10 p-5 text-sm leading-7 text-amber-100">
            OpenAI, Anthropic, and OpenRouter imports use official provider admin endpoints and require backend admin keys. Google remains on manual reconciliation until its sync adapter is implemented.
          </div>
        </div>
      </section>

      <section className="rounded-[30px] border border-white/10 bg-slate-950/80 p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Recent sync runs</p>
        <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">Provider sync history</h2>
        <p className="mt-3 text-sm leading-7 text-slate-400">
          This log shows the latest manual and scheduled sync results recorded for this organization.
        </p>

        {data.providerSync.history.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-300">
            No provider sync runs have been recorded for this organization yet.
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {data.providerSync.history.map((entry) => (
              <div key={`${entry.provider}-${entry.runAt}-${entry.message}`} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold uppercase tracking-[0.18em] text-white">{entry.provider}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                      entry.ok ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/20 bg-rose-500/10 text-rose-200'
                    }`}>
                      {entry.ok ? 'ok' : 'failed'}
                    </span>
                    <span className="rounded-full border border-white/10 bg-slate-950/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                      {entry.trigger}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400">{formatDateTime(entry.runAt)}</p>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-300">{entry.message}</p>
                {typeof entry.importedSpendUsd === 'number' ? (
                  <p className="mt-2 text-sm text-slate-400">Imported ${entry.importedSpendUsd.toFixed(2)}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[30px] border border-white/10 bg-slate-950/80 p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Notification relay</p>
        <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">Reconciliation notifications sent</h2>
        <p className="mt-3 text-sm leading-7 text-slate-400">
          Warning and critical reconciliation alerts are emailed to admin operators once per alert fingerprint, and recorded here for auditability.
        </p>

        {data.reconciliationNotifications.history.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-300">
            No reconciliation notifications have been sent for this organization yet.
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {data.reconciliationNotifications.history.map((entry) => (
              <div
                key={entry.id}
                className={`rounded-2xl border border-white/10 bg-slate-900/60 p-4 ${
                  focusContext && focusContext.id === `recon:${entry.id}` ? 'ring-2 ring-cyan-400/70' : ''
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold uppercase tracking-[0.18em] text-white">{entry.title}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                      entry.severity === 'critical'
                        ? 'border border-rose-500/20 bg-rose-500/10 text-rose-200'
                        : 'border border-amber-500/20 bg-amber-500/10 text-amber-100'
                    }`}>
                      {entry.severity}
                    </span>
                    <span className="rounded-full border border-white/10 bg-slate-950/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                      {entry.provider}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400">{formatDateTime(entry.sentAt)}</p>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-300">{entry.message}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
