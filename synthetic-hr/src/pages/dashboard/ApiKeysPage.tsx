import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Copy,
  Gauge,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { ApiKey } from '../../types';
import { api } from '../../lib/api-client';
import { supabase } from '../../lib/supabase-client';
import { getFrontendConfig } from '../../lib/config';
import { toast } from '../../lib/toast';

const API_BASE = (getFrontendConfig().apiUrl || 'http://localhost:3001/api').replace(/\/$/, '');
const ADMIN_BASE = API_BASE.endsWith('/api') ? API_BASE.slice(0, -4) : API_BASE;

type Environment = 'production' | 'staging' | 'development';
type Preset = 'read_only' | 'operations' | 'billing' | 'full_access' | 'custom';
type ViewMode = 'keys' | 'usage' | 'limits';

type OrgUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

type SecretReveal = {
  id: string;
  name: string;
  environment: Environment;
  maskedKey: string;
  key: string;
};

type UsagePoint = {
  date: string;
  requests: number;
  errors: number;
  last_used_at?: string;
};

const PRESET_OPTIONS: Array<{
  id: Preset;
  title: string;
  summary: string;
  scopes: string[];
}> = [
  { id: 'read_only', title: 'Read-only', summary: 'Inspect agents, conversations, and incident state.', scopes: ['agents.read'] },
  { id: 'operations', title: 'Operations', summary: 'Run incident and fleet workflows from secure services.', scopes: ['agents.read', 'agents.update', 'incidents.read', 'incidents.create'] },
  { id: 'billing', title: 'Usage', summary: 'Read runtime usage and cost surfaces.', scopes: ['costs.read'] },
  { id: 'full_access', title: 'Full access', summary: 'All operational scopes for backend services.', scopes: ['agents.read', 'agents.update', 'costs.read', 'incidents.read', 'incidents.create', 'incidents.update'] },
];

const SCOPE_OPTIONS = [
  { id: 'agents.read', label: 'Read agents', description: 'List governed agents and inspect live status.' },
  { id: 'agents.update', label: 'Manage agents', description: 'Update agents, pause them, or change settings.' },
  { id: 'costs.read', label: 'Read usage', description: 'Inspect runtime usage and cost views.' },
  { id: 'incidents.read', label: 'Read incidents', description: 'View incidents and investigation state.' },
  { id: 'incidents.create', label: 'Create incidents', description: 'Send incident records from an external service.' },
  { id: 'incidents.update', label: 'Update incidents', description: 'Resolve or amend incident records.' },
] as const;

const VIEW_OPTIONS: Array<{
  id: ViewMode;
  label: string;
  icon: ReactNode;
  description: string;
}> = [
  { id: 'keys', label: 'API keys', icon: <KeyRound className="h-4 w-4" />, description: 'Create and manage secret keys' },
  { id: 'usage', label: 'Usage', icon: <BarChart3 className="h-4 w-4" />, description: 'Inspect key traffic and recent activity' },
  { id: 'limits', label: 'Limits', icon: <SlidersHorizontal className="h-4 w-4" />, description: 'Review per-key request ceilings' },
];

function mapApiKey(record: any): ApiKey {
  return {
    id: record.id,
    name: record.name,
    key: record.key,
    masked_key: record.masked_key || record.key_prefix,
    created: record.created_at,
    lastUsed: record.last_used || null,
    permissions: record.permissions || [],
    status: record.status,
    environment: record.environment,
    preset: record.preset,
    description: record.description || null,
    expiresAt: record.expires_at || null,
    rateLimit: record.rate_limit ?? null,
    createdBy: record.created_by || null,
    createdByUser: record.created_by_user || null,
    managerIds: record.manager_ids || [],
    managers: record.manager_users || [],
    requests30d: record.requests_30d || 0,
    errors30d: record.errors_30d || 0,
    usage7d: record.usage_7d || [],
    usage30d: record.usage_30d || [],
  };
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function formatRelativeTime(value?: string | null) {
  if (!value) return 'Never used';
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN').format(value);
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function getStatusPill(status?: string, lastUsed?: string | null) {
  if (status === 'revoked') return 'border-rose-500/20 bg-rose-500/10 text-rose-300';
  if (status === 'expired') return 'border-amber-500/20 bg-amber-500/10 text-amber-300';
  if (!lastUsed) return 'border-slate-600 bg-slate-800/80 text-slate-300';
  return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
}

function usageHasTraffic(key: ApiKey) {
  return (key.usage7d || []).some((point) => point.requests > 0);
}

function sumUsage(points: UsagePoint[]) {
  return points.reduce((sum, point) => sum + point.requests, 0);
}

function sumErrors(points: UsagePoint[]) {
  return points.reduce((sum, point) => sum + point.errors, 0);
}

function mergeUsage(keys: ApiKey[]) {
  const grouped = new Map<string, { requests: number; errors: number }>();
  keys.forEach((key) => {
    (key.usage30d || []).forEach((point) => {
      const current = grouped.get(point.date) || { requests: 0, errors: 0 };
      current.requests += point.requests || 0;
      current.errors += point.errors || 0;
      grouped.set(point.date, current);
    });
  });

  return Array.from(grouped.entries())
    .map(([date, value]) => ({ date, requests: value.requests, errors: value.errors }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export default function ApiKeysPage({
  apiKeys,
  setApiKeys,
  initialView = 'keys',
  onNavigate,
}: {
  apiKeys: ApiKey[];
  setApiKeys: (keys: ApiKey[]) => void;
  initialView?: ViewMode;
  onNavigate?: (route: string) => void;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [secretReveal, setSecretReveal] = useState<SecretReveal | null>(null);
  const [managerOptions, setManagerOptions] = useState<OrgUser[]>([]);
  const [savingLimitId, setSavingLimitId] = useState<string | null>(null);
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});

  const loadKeys = useCallback(async () => {
    setFetching(true);
    try {
      const response = await api.apiKeys.list();
      const keys = (response.data || []).map(mapApiKey);
      setApiKeys(keys);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load API keys');
    } finally {
      setFetching(false);
    }
  }, [setApiKeys]);

  const loadManagers = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const response = await fetch(`${ADMIN_BASE}/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const payload = await response.json();
      const users = Array.isArray(payload.data)
        ? payload.data.map((user: any) => ({
          id: user.id,
          email: user.email,
          name: user.full_name || user.email,
          role: user.role,
        }))
        : [];
      setManagerOptions(users);
    } catch {
      // Optional metadata only.
    }
  }, []);

  useEffect(() => {
    void loadKeys();
    void loadManagers();
  }, [loadKeys, loadManagers]);

  useEffect(() => {
    setViewMode(initialView);
  }, [initialView]);

  useEffect(() => {
    setLimitDrafts((current) => {
      const next = { ...current };
      apiKeys.forEach((key) => {
        if (!(key.id in next)) next[key.id] = key.rateLimit ? String(key.rateLimit) : '';
      });
      return next;
    });
  }, [apiKeys]);

  const activeKeys = useMemo(() => apiKeys.filter((key) => key.status !== 'revoked'), [apiKeys]);
  const aggregatedUsage = useMemo(() => mergeUsage(activeKeys), [activeKeys]);
  const totalRequests30d = activeKeys.reduce((sum, key) => sum + (key.requests30d || 0), 0);
  const totalErrors30d = activeKeys.reduce((sum, key) => sum + (key.errors30d || 0), 0);
  const activeManagers = new Set(activeKeys.flatMap((key) => (key.managers || []).map((manager) => manager.id))).size;
  const latestUsed = activeKeys.map((key) => key.lastUsed).filter(Boolean).sort().reverse()[0] || null;
  const keysWithTraffic = activeKeys.filter((key) => (key.requests30d || 0) > 0);
  const combinedRateLimit = activeKeys.reduce((sum, key) => sum + (key.rateLimit || 0), 0);
  const usageTier = totalRequests30d > 100000 ? 'Tier 3' : totalRequests30d > 20000 ? 'Tier 2' : 'Tier 1';
  const averageErrorRate = totalRequests30d > 0 ? (totalErrors30d / totalRequests30d) * 100 : 0;

  const issueKey = async (payload: {
    name: string;
    environment: Environment;
    preset: Preset;
    permissions: string[];
    manager_ids: string[];
    rateLimit?: number;
  }) => {
    setLoading(true);
    try {
      const response = await api.apiKeys.create(payload);
      if (!response.data) {
        throw new Error(response.error || 'API key was not returned');
      }
      const created = mapApiKey(response.data);
      setApiKeys([created, ...apiKeys]);
      setSecretReveal({
        id: created.id,
        name: created.name,
        environment: created.environment || 'production',
        maskedKey: created.masked_key || created.key || '',
        key: response.data.key,
      });
      setShowIssueModal(false);
      toast.success('API key created');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to issue API key');
    } finally {
      setLoading(false);
    }
  };

  const revokeKey = async (id: string, name: string) => {
    if (!confirm(`Delete ${name}? Anything using this key will stop working immediately.`)) return;
    try {
      await api.apiKeys.revoke(id);
      setApiKeys(apiKeys.map((key) => (key.id === id ? { ...key, status: 'revoked' } : key)));
      toast.success('API key revoked');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to revoke API key');
    }
  };

  const saveRateLimit = async (key: ApiKey) => {
    const draft = limitDrafts[key.id] ?? '';
    const nextValue = draft.trim() ? Number(draft) : null;
    if (draft.trim() && (!Number.isFinite(nextValue) || Number(nextValue) < 0)) {
      toast.error('Enter a valid request-per-minute limit');
      return;
    }

    setSavingLimitId(key.id);
    try {
      await api.apiKeys.update(key.id, { rateLimit: nextValue === null ? undefined : Number(nextValue) });
      setApiKeys(apiKeys.map((item) => item.id === key.id ? { ...item, rateLimit: nextValue } : item));
      toast.success('Rate limit updated');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update limit');
    } finally {
      setSavingLimitId(null);
    }
  };

  const copyToClipboard = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success('Copied');
  };

  const handleCopyKey = async (key: ApiKey) => {
    if (key.key) {
      await copyToClipboard(key.key);
      return;
    }
    toast.info('Full secret is shown only once at creation.');
  };

  return (
    <div className="mx-auto w-full max-w-[1480px]">
      <div className="min-w-0 space-y-6">
        <div className="flex flex-col gap-4 rounded-[34px] border border-slate-800 bg-slate-900/70 px-6 py-6 shadow-[0_20px_80px_rgba(2,6,23,0.35)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-300">API access</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight text-white">{VIEW_OPTIONS.find((view) => view.id === viewMode)?.label}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                {viewMode === 'keys' && 'Create and manage secret keys for backend services, automations, and integrations. Full secrets appear once after creation and are never shown again.'}
                {viewMode === 'usage' && 'Review real API-key traffic across the last 30 days. This page reflects request activity only after keys are actually used. For organization-wide usage, see the Usage page.'}
                {viewMode === 'limits' && 'Set request-per-minute guardrails per key so backend services stay inside predictable operational boundaries. These are per-key controls, not billing budgets.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('api-analytics')}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm font-medium text-cyan-300 transition hover:border-cyan-500/40 hover:bg-slate-900"
                >
                  <BarChart3 className="h-4 w-4" /> API Analytics
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadKeys()}
                disabled={fetching}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-900"
              >
                <RefreshCw className={`h-4 w-4 ${fetching ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <button
                type="button"
                onClick={() => setShowIssueModal(true)}
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
              >
                <Plus className="h-4 w-4" /> Create new secret key
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 rounded-[26px] border border-slate-800 bg-slate-950/60 p-2">
            {VIEW_OPTIONS.map((view) => {
              const active = viewMode === view.id;
              return (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setViewMode(view.id)}
                  className={`flex min-w-[180px] flex-1 items-start gap-3 rounded-2xl px-4 py-3 text-left transition ${active ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-slate-900 hover:text-white'}`}
                >
                  <div className={`mt-0.5 ${active ? 'text-slate-950' : 'text-slate-500'}`}>{view.icon}</div>
                  <div>
                    <p className="text-sm font-semibold">{view.label}</p>
                    <p className={`mt-1 text-xs ${active ? 'text-slate-600' : 'text-slate-500'}`}>{view.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {viewMode === 'keys' && (
          <>
            <div className="rounded-[34px] border border-slate-800 bg-slate-900/70 px-6 py-6">
              <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
                <div className="space-y-4">
                  <p className="text-base leading-8 text-slate-300">
                    You have permission to view and manage all API keys in this workspace. Do not share a secret key or expose it in the browser or other client-side code.
                  </p>
                  <p className="text-sm leading-7 text-slate-400">
                    Use these keys for backend services only. Usage, limits, and access state remain visible here so operational changes do not get hidden across different pages.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <MetricTile label="Active keys" value={String(activeKeys.filter((key) => key.status === 'active').length)} hint="Live backend credentials" icon={<KeyRound className="h-5 w-5 text-cyan-300" />} />
                  <MetricTile label="Keys with traffic" value={String(keysWithTraffic.length)} hint="Used in the last 30 days" icon={<Activity className="h-5 w-5 text-violet-300" />} />
                  <MetricTile label="Active managers" value={String(activeManagers)} hint="Workspace users responsible for one or more active keys" icon={<Users className="h-5 w-5 text-emerald-300" />} />
                </div>
              </div>
            </div>

            <section className="overflow-hidden rounded-[34px] border border-slate-800 bg-slate-900/70">
              <div className="border-b border-slate-800 px-6 py-5">
                <h3 className="text-xl font-semibold text-white">Secret keys</h3>
                <p className="mt-1 text-sm text-slate-400">Each row below is a real key record with usage, owners, and access metadata. This table is the primary control surface for secure backend access.</p>
              </div>

              {fetching ? (
                <div className="px-6 py-16 text-center text-slate-400">Loading API keys…</div>
              ) : activeKeys.length === 0 ? (
                <EmptyPanel
                  icon={<KeyRound className="h-8 w-8 text-slate-500" />}
                  title="No active API keys"
                  body="Create a key when a backend worker, server route, automation, or integration needs secure access to RASI."
                  actionLabel="Create API key"
                  onAction={() => setShowIssueModal(true)}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[1280px] w-full border-collapse text-left">
                    <thead className="bg-slate-950/40 text-xs uppercase tracking-[0.18em] text-slate-500">
                      <tr>
                        <th className="px-6 py-4 font-medium">Name</th>
                        <th className="px-4 py-4 font-medium">Status</th>
                        <th className="px-4 py-4 font-medium">Secret key</th>
                        <th className="px-4 py-4 font-medium">Created</th>
                        <th className="px-4 py-4 font-medium">Last used</th>
                        <th className="px-4 py-4 font-medium">Created by</th>
                        <th className="px-4 py-4 font-medium">Permissions</th>
                        <th className="px-6 py-4 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/90">
                      {activeKeys.map((key) => (
                        <tr key={key.id} className="transition hover:bg-slate-950/30">
                          <td className="px-6 py-5">
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/80">
                                <KeyRound className="h-4.5 w-4.5 text-cyan-300" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold text-white">{key.name}</p>
                                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] font-medium capitalize text-slate-400">{key.environment}</span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">{key.description || 'No description set'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-5">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusPill(key.status, key.lastUsed)}`}>
                              {key.status === 'active' ? (key.lastUsed ? 'Active' : 'Unused') : key.status === 'expired' ? 'Expired' : 'Revoked'}
                            </span>
                          </td>
                          <td className="px-4 py-5">
                            <div className="flex items-center gap-2">
                              <code className="rounded-xl bg-slate-950/80 px-3 py-2 font-mono text-xs text-slate-300">{key.masked_key || key.key || 'Hidden'}</code>
                              <button
                                type="button"
                                onClick={() => void handleCopyKey(key)}
                                className={`rounded-lg p-2 transition ${key.key ? 'text-slate-500 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-900/60 hover:text-slate-400'}`}
                                title={key.key ? 'Copy full secret' : 'Full secret shown once at creation'}
                              >
                                <Copy className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-5 text-sm text-white">{formatCompactDate(key.created)}</td>
                          <td className="px-4 py-5">
                            <div className="text-sm text-white">{formatRelativeTime(key.lastUsed)}</div>
                            <div className="mt-1 text-xs text-slate-500">{formatDateTime(key.lastUsed)}</div>
                          </td>
                          <td className="px-4 py-5">
                            <div className="text-sm text-white">{key.createdByUser?.name || 'Unknown user'}</div>
                            <div className="mt-1 text-xs text-slate-500">{key.createdByUser?.email || 'No creator metadata'}</div>
                          </td>
                          <td className="px-4 py-5">
                            <div className="flex max-w-[260px] flex-wrap gap-2">
                              {key.permissions.map((permission) => (
                                <span key={permission} className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-1 text-xs text-slate-300">
                                  {permission}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <button
                              type="button"
                              onClick={() => void revokeKey(key.id, key.name)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/60 text-slate-400 transition hover:border-rose-500/40 hover:text-rose-300"
                              title="Delete API key"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {viewMode === 'usage' && (
          <>
            <div className="rounded-[34px] border border-amber-500/20 bg-amber-500/10 px-6 py-5">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Usage here is RASI-observed key traffic</h3>
                  <p className="mt-1 max-w-4xl text-sm leading-7 text-amber-100/80">
                    This page shows request activity seen on RASI-issued keys. It does not import provider billing dashboards automatically, so OpenAI or Anthropic console totals may be higher if traffic bypasses RASI.
                  </p>
                  <p className="mt-2 text-xs text-amber-100/70">Need org-wide usage? Open the Usage page for aggregated traffic across the workspace.</p>
                </div>
                <div className="rounded-2xl border border-amber-400/20 bg-slate-950/40 px-4 py-3 text-sm text-amber-100">
                  Source of truth: requests observed through RASI
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <section className="rounded-[34px] border border-slate-800 bg-slate-900/70">
                <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5">
                  <div>
                    <h3 className="text-xl font-semibold text-white">Observed request usage</h3>
                    <p className="mt-1 text-sm text-slate-400">Last 30 days of API-key-authenticated traffic seen by RASI.</p>
                  </div>
                  <span className="rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-sm text-slate-300">30d window</span>
                </div>
                <div className="px-6 py-6">
                  {aggregatedUsage.length === 0 ? (
                    <EmptyPanel
                      compact
                      icon={<BarChart3 className="h-8 w-8 text-slate-500" />}
                      title="No usage yet"
                      body="Usage appears after a real backend or integration starts sending requests with one of your keys."
                    />
                  ) : (
                    <UsageBars points={aggregatedUsage} />
                  )}
                </div>
              </section>

              <div className="space-y-4">
                <MetricTile label="Observed requests · 30d" value={formatNumber(totalRequests30d)} hint="Across all active keys in the last 30 days" icon={<Activity className="h-5 w-5 text-violet-300" />} />
                <MetricTile label="Error rate" value={formatPercent(averageErrorRate)} hint={`${formatNumber(totalErrors30d)} error responses across all keys`} icon={<ShieldAlert className="h-5 w-5 text-amber-300" />} />
                <MetricTile label="Active managers" value={String(activeManagers)} hint="Users assigned to manage one or more active keys" icon={<Users className="h-5 w-5 text-cyan-300" />} />
                <MetricTile label="Last key activity" value={latestUsed ? formatRelativeTime(latestUsed) : 'Never'} hint={latestUsed ? formatDateTime(latestUsed) : 'No key activity recorded'} icon={<CalendarClock className="h-5 w-5 text-emerald-300" />} />
              </div>
            </div>

            <section className="overflow-hidden rounded-[34px] border border-slate-800 bg-slate-900/70">
              <div className="border-b border-slate-800 px-6 py-5">
                <h3 className="text-xl font-semibold text-white">Per-key activity</h3>
                <p className="mt-1 text-sm text-slate-400">Usage only appears here after the corresponding key has handled live traffic through RASI.</p>
              </div>
              {activeKeys.length === 0 ? (
                <EmptyPanel
                  icon={<Activity className="h-8 w-8 text-slate-500" />}
                  title="No keys to measure"
                  body="Create an API key first, then usage can be attributed per key."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[980px] w-full border-collapse text-left">
                    <thead className="bg-slate-950/40 text-xs uppercase tracking-[0.18em] text-slate-500">
                      <tr>
                        <th className="px-6 py-4 font-medium">Key</th>
                        <th className="px-4 py-4 font-medium">Requests (30d)</th>
                        <th className="px-4 py-4 font-medium">Errors (30d)</th>
                        <th className="px-4 py-4 font-medium">7-day trend</th>
                        <th className="px-6 py-4 font-medium">Last used</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/90">
                      {[...activeKeys].sort((a, b) => (b.requests30d || 0) - (a.requests30d || 0)).map((key) => (
                        <tr key={key.id} className="transition hover:bg-slate-950/30">
                          <td className="px-6 py-5">
                            <div className="font-semibold text-white">{key.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{key.masked_key || key.key || 'Hidden'}</div>
                          </td>
                          <td className="px-4 py-5 text-sm text-white">{formatNumber(key.requests30d || 0)}</td>
                          <td className="px-4 py-5 text-sm text-white">{formatNumber(key.errors30d || 0)}</td>
                          <td className="px-4 py-5">
                            {usageHasTraffic(key) ? (
                              <div className="space-y-2">
                                <UsageSparkline points={key.usage7d || []} stroke="#8b5cf6" />
                                <div className="text-xs text-slate-400">{formatNumber(sumUsage((key.usage7d || []) as UsagePoint[]))} requests in 7d</div>
                              </div>
                            ) : (
                              <span className="text-sm text-slate-500">No activity yet</span>
                            )}
                          </td>
                          <td className="px-6 py-5">
                            <div className="text-sm text-white">{formatRelativeTime(key.lastUsed)}</div>
                            <div className="mt-1 text-xs text-slate-500">{formatDateTime(key.lastUsed)}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {viewMode === 'limits' && (
          <>
            <div className="rounded-[34px] border border-slate-800 bg-slate-900/70 px-6 py-5">
              <p className="text-sm text-slate-300">
                Limits here apply to individual API keys only. They do not change org-wide usage metrics or billing totals.
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <section className="rounded-[34px] border border-slate-800 bg-slate-900/70">
                <div className="border-b border-slate-800 px-6 py-5">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-semibold text-white">Organization guardrails</h3>
                    <span className="rounded-xl bg-emerald-500/10 px-2.5 py-1 text-sm font-semibold text-emerald-300">Usage {usageTier}</span>
                  </div>
                </div>
                <div className="space-y-5 px-6 py-6">
                  <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
                    <p className="text-sm text-slate-400">Combined request ceiling</p>
                    <p className="mt-2 text-4xl font-semibold text-white">{combinedRateLimit > 0 ? `${formatNumber(combinedRateLimit)} RPM` : 'No custom limits set'}</p>
                    <div className="mt-4 h-4 rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-300"
                        style={{ width: `${Math.min(combinedRateLimit > 0 ? (totalRequests30d / Math.max(combinedRateLimit * 60 * 24 * 30, 1)) * 100 : 0, 100)}%` }}
                      />
                    </div>
                    <p className="mt-3 text-sm text-slate-500">
                      This bar compares 30-day request volume to configured per-key request ceilings. Leave a limit blank if a key should inherit backend defaults.
                    </p>
                  </div>
                </div>
              </section>

              <div className="space-y-4">
                <MetricTile label="Keys with limits" value={String(activeKeys.filter((key) => Number(key.rateLimit || 0) > 0).length)} hint="Active keys using custom request ceilings" icon={<Gauge className="h-5 w-5 text-cyan-300" />} />
                <MetricTile label="Unlimited keys" value={String(activeKeys.filter((key) => !key.rateLimit).length)} hint="Keys currently inheriting backend defaults" icon={<Shield className="h-5 w-5 text-slate-300" />} />
              </div>
            </div>

            <section className="overflow-hidden rounded-[34px] border border-slate-800 bg-slate-900/70">
              <div className="border-b border-slate-800 px-6 py-5">
                <h3 className="text-xl font-semibold text-white">Per-key rate limits</h3>
                <p className="mt-1 text-sm text-slate-400">Configure request-per-minute ceilings for real keys. These limits are operational guardrails, not billing budgets.</p>
              </div>
              {activeKeys.length === 0 ? (
                <EmptyPanel
                  icon={<SlidersHorizontal className="h-8 w-8 text-slate-500" />}
                  title="No keys available"
                  body="Create an API key before setting rate limits."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[980px] w-full border-collapse text-left">
                    <thead className="bg-slate-950/40 text-xs uppercase tracking-[0.18em] text-slate-500">
                      <tr>
                        <th className="px-6 py-4 font-medium">Key</th>
                        <th className="px-4 py-4 font-medium">Environment</th>
                        <th className="px-4 py-4 font-medium">Preset</th>
                        <th className="px-4 py-4 font-medium">Current 30d usage</th>
                        <th className="px-4 py-4 font-medium">Rate limit (RPM)</th>
                        <th className="px-6 py-4 text-right font-medium">Save</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/90">
                      {activeKeys.map((key) => (
                        <tr key={key.id} className="transition hover:bg-slate-950/30">
                          <td className="px-6 py-5">
                            <div className="font-semibold text-white">{key.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{key.masked_key || key.key || 'Hidden'}</div>
                          </td>
                          <td className="px-4 py-5">
                            <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-xs capitalize text-slate-300">{key.environment}</span>
                          </td>
                          <td className="px-4 py-5 text-sm text-white">{key.preset?.replace('_', ' ') || 'custom'}</td>
                          <td className="px-4 py-5 text-sm text-white">{formatNumber(key.requests30d || 0)} requests</td>
                          <td className="px-4 py-5">
                            <input
                              id={`rate-limit-${key.id}`}
                              name={`rate_limit_${key.id}`}
                              type="number"
                              min="0"
                              value={limitDrafts[key.id] ?? ''}
                              onChange={(event) => setLimitDrafts((current) => ({ ...current, [key.id]: event.target.value }))}
                              placeholder="No limit"
                              className="w-44 rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400"
                            />
                          </td>
                          <td className="px-6 py-5 text-right">
                            <button
                              type="button"
                              disabled={savingLimitId === key.id}
                              onClick={() => void saveRateLimit(key)}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-2 text-sm font-medium text-white transition hover:border-slate-600 hover:bg-slate-900 disabled:opacity-50"
                            >
                              {savingLimitId === key.id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />} Save
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {showIssueModal ? (
          <IssueTokenModal
            loading={loading}
            managerOptions={managerOptions}
            onClose={() => setShowIssueModal(false)}
            onSubmit={issueKey}
          />
        ) : null}

        {secretReveal ? (
          <SecretRevealModal
            token={secretReveal}
            onClose={() => setSecretReveal(null)}
            onCopy={() => void copyToClipboard(secretReveal.key)}
          />
        ) : null}
      </div>
    </div>
  );
}

function MetricTile({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: ReactNode }) {
  return (
    <div className="rounded-[28px] border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-3 font-mono text-4xl font-semibold tracking-tight text-white">{value}</p>
          <p className="mt-2 text-sm text-slate-400">{hint}</p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-950/80 p-3">{icon}</div>
      </div>
    </div>
  );
}

function EmptyPanel({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`px-6 ${compact ? 'py-10' : 'py-16'} text-center`}>
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/80">
        {icon}
      </div>
      <h3 className="text-lg font-medium text-white">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">{body}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-slate-100"
        >
          <Plus className="h-4 w-4" /> {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function UsageSparkline({ points, stroke = '#22d3ee' }: { points: Array<{ date: string; requests: number }>; stroke?: string }) {
  const values = points.map((point) => point.requests);
  const max = Math.max(...values, 1);
  const width = 120;
  const height = 28;
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - (point.requests / max) * (height - 4) - 2;
      return `${index === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function UsageBars({ points }: { points: Array<{ date: string; requests: number; errors: number }> }) {
  const max = Math.max(...points.map((point) => point.requests), 1);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        <StatChip label="Total requests" value={formatNumber(points.reduce((sum, point) => sum + point.requests, 0))} />
        <StatChip label="Total errors" value={formatNumber(points.reduce((sum, point) => sum + point.errors, 0))} />
        <StatChip label="Peak day" value={formatNumber(Math.max(...points.map((point) => point.requests), 0))} />
      </div>
      <div className="flex h-72 items-end gap-2 rounded-3xl border border-slate-800 bg-slate-950/60 px-4 pb-6 pt-4">
        {points.map((point) => (
          <div key={point.date} className="flex flex-1 flex-col items-center justify-end gap-2">
            <div className="w-full rounded-t-xl bg-gradient-to-t from-violet-500 to-violet-300" style={{ height: `${Math.max((point.requests / max) * 190, point.requests > 0 ? 10 : 2)}px` }} />
            <span className="text-[11px] text-slate-500">{formatCompactDate(point.date)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function IssueTokenModal({
  loading,
  managerOptions,
  onClose,
  onSubmit,
}: {
  loading: boolean;
  managerOptions: OrgUser[];
  onClose: () => void;
  onSubmit: (payload: { name: string; environment: Environment; preset: Preset; permissions: string[]; manager_ids: string[]; rateLimit?: number }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<Environment>('production');
  const [preset, setPreset] = useState<Preset>('read_only');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(PRESET_OPTIONS[0].scopes);
  const [selectedManagers, setSelectedManagers] = useState<string[]>(managerOptions.filter((user) => ['admin', 'super_admin'].includes(user.role)).map((user) => user.id));
  const [showAdvancedPermissions, setShowAdvancedPermissions] = useState(false);
  const [rateLimit, setRateLimit] = useState('');

  useEffect(() => {
    setSelectedManagers(managerOptions.filter((user) => ['admin', 'super_admin'].includes(user.role)).map((user) => user.id));
  }, [managerOptions]);

  useEffect(() => {
    if (preset !== 'custom') {
      const presetConfig = PRESET_OPTIONS.find((option) => option.id === preset);
      setSelectedPermissions(presetConfig ? [...presetConfig.scopes] : []);
    }
  }, [preset]);

  useEffect(() => {
    setShowAdvancedPermissions(preset === 'custom');
  }, [preset]);

  const togglePermission = (permission: string) => {
    setPreset('custom');
    setSelectedPermissions((current) => current.includes(permission)
      ? current.filter((item) => item !== permission)
      : [...current, permission]);
  };

  const toggleManager = (managerId: string) => {
    setSelectedManagers((current) => current.includes(managerId)
      ? current.filter((item) => item !== managerId)
      : [...current, managerId]);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({
      name,
      environment,
      preset,
      permissions: selectedPermissions,
      manager_ids: selectedManagers,
      rateLimit: rateLimit.trim() ? Number(rateLimit) : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 px-3 py-4 backdrop-blur-sm sm:px-5 sm:py-6">
      <div className="flex min-h-full items-start justify-center">
        <div className="flex h-[min(860px,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl shadow-slate-950/60">
          <div className="flex items-start justify-between border-b border-slate-800 px-6 py-4">
            <div>
              <h2 className="text-2xl font-semibold text-white">Create secret key</h2>
              <p className="mt-1.5 text-sm text-slate-400">This creates a real RASI API key for backend services, scripts, or integrations.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 bg-slate-900/60 p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-6 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">API key name</label>
                  <input
                    id="api-key-name"
                    name="api_key_name"
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400"
                    placeholder="e.g. production worker"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Environment</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['production', 'staging', 'development'] as Environment[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setEnvironment(option)}
                        className={`rounded-2xl border px-3 py-3 text-sm font-medium capitalize transition ${environment === option ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200' : 'border-slate-700 bg-slate-950/60 text-slate-400 hover:bg-slate-900'}`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Initial rate limit (RPM)</label>
                  <input
                    id="api-key-rate-limit"
                    name="api_key_rate_limit"
                    type="number"
                    min="0"
                    value={rateLimit}
                    onChange={(event) => setRateLimit(event.target.value)}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400"
                    placeholder="Leave blank for backend defaults"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Who can manage this key</label>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3.5">
                    {managerOptions.length === 0 ? (
                      <p className="text-sm text-slate-500">Org managers will default to admins when the key is created.</p>
                    ) : (
                      <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1">
                        {managerOptions.map((manager) => {
                          const active = selectedManagers.includes(manager.id);
                          return (
                            <button
                              key={manager.id}
                              type="button"
                              onClick={() => toggleManager(manager.id)}
                              className={`rounded-full border px-3 py-1.5 text-sm transition ${active ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200' : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-600'}`}
                            >
                              {manager.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Access level</label>
                  <div className="grid gap-2.5">
                    {PRESET_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setPreset(option.id)}
                        className={`rounded-2xl border p-3.5 text-left transition ${preset === option.id ? 'border-cyan-400 bg-cyan-400/10' : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-white">{option.title}</p>
                            <p className="mt-1 text-xs text-slate-400">{option.summary}</p>
                          </div>
                          {preset === option.id ? <CheckCircle2 className="h-5 w-5 text-cyan-300" /> : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label className="block text-sm font-medium text-slate-300">Advanced permissions</label>
                    <button
                      type="button"
                      onClick={() => setShowAdvancedPermissions((current) => !current)}
                      className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:text-white"
                    >
                      {showAdvancedPermissions ? 'Hide details' : 'Show details'}
                    </button>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3.5">
                    <p className="text-sm text-slate-400">
                      Access level already chooses the right defaults. Open this only if you need custom permission control.
                    </p>
                    {showAdvancedPermissions ? (
                      <div className="mt-4 max-h-40 space-y-2 overflow-y-auto pr-1">
                        {SCOPE_OPTIONS.map((scope) => {
                          const active = selectedPermissions.includes(scope.id);
                          return (
                            <label key={scope.id} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-transparent px-3 py-2 transition hover:border-slate-800 hover:bg-slate-900/70">
                              <input id={`scope-${scope.id}`} name={`scope_${scope.id}`} type="checkbox" checked={active} onChange={() => togglePermission(scope.id)} className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-cyan-400" />
                              <div>
                                <p className="text-sm font-medium text-white">{scope.label}</p>
                                <p className="mt-1 text-xs text-slate-500">{scope.description}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {selectedPermissions.map((permission) => (
                          <span key={permission} className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
                            {permission}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 flex shrink-0 items-center justify-between gap-4 border-t border-slate-800 bg-slate-900/95 px-6 py-4 backdrop-blur">
              <p className="max-w-xl text-sm text-slate-500">The full key is shown once after creation and stored securely in hashed form on the server.</p>
              <div className="flex items-center gap-3">
                <button type="button" onClick={onClose} className="rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800">Cancel</button>
                <button
                  type="submit"
                  disabled={loading || !name.trim() || selectedPermissions.length === 0}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />} Create API key
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function SecretRevealModal({ token, onClose, onCopy }: { token: SecretReveal; onClose: () => void; onCopy: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl shadow-slate-950/60">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3">
            <Shield className="h-6 w-6 text-emerald-300" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-white">Secret key created</h2>
            <p className="mt-1 text-sm text-slate-400">Copy this key now. You won’t be able to see it again.</p>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">{token.name}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{token.environment}</p>
            </div>
            <code className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs text-slate-300">{token.maskedKey}</code>
          </div>
          <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-slate-900/80 p-4">
            <code className="block break-all font-mono text-lg text-cyan-200">{token.key}</code>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCopy} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 font-semibold text-slate-950 transition hover:bg-slate-100">
            <Copy className="h-4 w-4" /> Copy key
          </button>
          <button type="button" onClick={onClose} className="inline-flex flex-1 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-3 font-medium text-white transition hover:bg-slate-800">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
